/**
 * Postgres-backed store via Prisma (prisma/schema.prisma is the source of truth
 * for the shape). Same entities/behavior as the earlier in-memory version, but
 * this one actually persists across restarts and deploys.
 */
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { CurveState, DEFAULT_CURVE_CONFIG, currentPrice } from "./bondingCurve.js";

export const prisma = new PrismaClient();
export { DEFAULT_CURVE_CONFIG };

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return v;
  return Number(v.toString());
}

export function newWalletTag(): string {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

export function freshCurveState(): CurveState {
  return { realZecReserves: 0, tokensSold: 0 };
}

// ---------- Wallets ----------

export async function createWallet(words: string[]) {
  const seedHashHex = createHash("sha256").update(words.join(" ")).digest("hex");
  const wallet = await prisma.internalWallet.create({
    data: { walletTag: newWalletTag(), seedHashHex },
  });
  return { id: wallet.id, walletTag: wallet.walletTag, createdAt: wallet.createdAt.toISOString() };
}

export async function getWallet(id: string) {
  const wallet = await prisma.internalWallet.findUnique({ where: { id } });
  return wallet
    ? { id: wallet.id, walletTag: wallet.walletTag, createdAt: wallet.createdAt.toISOString(), defaultRefundAddress: wallet.defaultRefundAddress }
    : null;
}

/** Remembers the ZEC address a wallet last used to receive a sell payout,
 * so the Sell modal can pre-fill it next time instead of asking the payer
 * to paste it in again for every token (Brai, 2026-09-07). Called after
 * every successful sell with whatever refundAddress was actually used --
 * always overwrites, so it tracks the most recently used address. */
export async function setDefaultRefundAddress(walletId: string, address: string) {
  await prisma.internalWallet.update({ where: { id: walletId }, data: { defaultRefundAddress: address } });
}

/** "Log back in" to a wallet created earlier on another device/session: the
 * 12 words are never stored in the clear (see InternalWallet.seedHashHex),
 * so this just re-hashes what was typed and looks for a match -- same
 * mechanism createWallet used to store it, just in reverse. Returns null
 * if nothing matches (wrong words, or a wallet that was never created here). */
export async function findWalletBySeedWords(words: string[]) {
  const seedHashHex = createHash("sha256").update(words.join(" ")).digest("hex");
  const wallet = await prisma.internalWallet.findFirst({ where: { seedHashHex } });
  return wallet ? { id: wallet.id, walletTag: wallet.walletTag, createdAt: wallet.createdAt.toISOString() } : null;
}

// ---------- Tokens ----------

export interface TokenWithCurve {
  id: string;
  symbol: string;
  name: string;
  totalSupply: number;
  creatorWalletId: string;
  curve: CurveState;
  createdAt: string;
  genesisMemoTxid: string | null;
  creatorPayoutAddress: string | null;
  creatorFeeAccruedZec: number;
  creatorFeeTotalPaidZec: number;
  platformFeeTotalZec: number;
  lastFeePayoutAt: string | null;
  logoDataUrl: string | null;
  description: string | null;
  twitterUrl: string | null;
}

function toTokenWithCurve(t: {
  id: string;
  symbol: string;
  name: string;
  totalSupply: bigint;
  creatorWalletId: string;
  curveReserveZec: unknown;
  curveSoldTokens: bigint;
  createdAt: Date;
  genesisMemoTxid: string | null;
  creatorPayoutAddress: string | null;
  creatorFeeAccruedZec: unknown;
  creatorFeeTotalPaidZec: unknown;
  platformFeeTotalZec: unknown;
  lastFeePayoutAt: Date | null;
  logoDataUrl: string | null;
  description: string | null;
  twitterUrl: string | null;
}): TokenWithCurve {
  return {
    id: t.id,
    symbol: t.symbol,
    name: t.name,
    totalSupply: num(t.totalSupply),
    creatorWalletId: t.creatorWalletId,
    curve: { realZecReserves: num(t.curveReserveZec), tokensSold: num(t.curveSoldTokens) },
    createdAt: t.createdAt.toISOString(),
    genesisMemoTxid: t.genesisMemoTxid,
    creatorPayoutAddress: t.creatorPayoutAddress,
    creatorFeeAccruedZec: num(t.creatorFeeAccruedZec),
    creatorFeeTotalPaidZec: num(t.creatorFeeTotalPaidZec),
    platformFeeTotalZec: num(t.platformFeeTotalZec),
    lastFeePayoutAt: t.lastFeePayoutAt ? t.lastFeePayoutAt.toISOString() : null,
    logoDataUrl: t.logoDataUrl,
    description: t.description,
    twitterUrl: t.twitterUrl,
  };
}

export async function createToken(input: {
  symbol: string;
  name: string;
  totalSupply: number;
  creatorWalletId: string;
  /** Real shielded txid of the on-chain creation inscription. Only set
   * when ZCASH_MODE=real; null in demo/simulated mode (the frontend falls
   * back to the deterministic simulated display in that case). */
  genesisMemoTxid?: string;
  /** Zcash address that receives this token's 1% creator fee share,
   * distributed automatically every 24h. Optional -- if not set, the
   * creator's fee still accrues but is never paid out. */
  creatorPayoutAddress?: string;
  /** Token logo as a data URL (already resized/encoded client-side). */
  logoDataUrl?: string;
  description?: string;
  twitterUrl?: string;
}): Promise<TokenWithCurve> {
  const t = await prisma.token.create({
    data: {
      symbol: input.symbol,
      name: input.name,
      totalSupply: BigInt(Math.round(input.totalSupply)),
      creatorWalletId: input.creatorWalletId,
      curveReserveZec: 0,
      curveSoldTokens: 0n,
      genesisMemoTxid: input.genesisMemoTxid ?? null,
      creatorPayoutAddress: input.creatorPayoutAddress ?? null,
      logoDataUrl: input.logoDataUrl ?? null,
      description: input.description ?? null,
      twitterUrl: input.twitterUrl ?? null,
    },
  });
  const token = toTokenWithCurve(t);
  await recordPricePoint(token.id, token.curve, token.totalSupply);
  return token;
}

export async function getToken(symbol: string): Promise<TokenWithCurve | null> {
  const t = await prisma.token.findUnique({ where: { symbol } });
  return t ? toTokenWithCurve(t) : null;
}

export async function getTokenById(id: string): Promise<TokenWithCurve | null> {
  const t = await prisma.token.findUnique({ where: { id } });
  return t ? toTokenWithCurve(t) : null;
}

export async function listTokens(): Promise<TokenWithCurve[]> {
  const ts = await prisma.token.findMany({ orderBy: { createdAt: "asc" } });
  return ts.map(toTokenWithCurve);
}

export async function updateTokenCurve(tokenId: string, curve: CurveState) {
  const graduated = curve.realZecReserves >= DEFAULT_CURVE_CONFIG.graduationZecThreshold;
  await prisma.token.update({
    where: { id: tokenId },
    data: {
      curveReserveZec: curve.realZecReserves,
      curveSoldTokens: BigInt(Math.max(0, Math.round(curve.tokensSold))),
      graduated,
      graduatedAt: graduated ? new Date() : undefined,
    },
  });
}

// ---------- Balances ----------
// Keyed by tokenId (the schema's foreign key), not symbol.

export async function getBalance(walletId: string, tokenId: string): Promise<number> {
  const b = await prisma.balance.findUnique({
    where: { internalWalletId_tokenId: { internalWalletId: walletId, tokenId } },
  });
  return b ? num(b.amount) : 0;
}

export async function creditBalance(walletId: string, tokenId: string, amount: number) {
  const delta = BigInt(Math.round(amount));
  await prisma.balance.upsert({
    where: { internalWalletId_tokenId: { internalWalletId: walletId, tokenId } },
    create: { internalWalletId: walletId, tokenId, amount: delta },
    update: { amount: { increment: delta } },
  });
}

export async function debitBalance(walletId: string, tokenId: string, amount: number) {
  const current = await getBalance(walletId, tokenId);
  if (current < amount) throw new Error("insufficient balance");
  await prisma.balance.update({
    where: { internalWalletId_tokenId: { internalWalletId: walletId, tokenId } },
    data: { amount: { decrement: BigInt(Math.round(amount)) } },
  });
}

// ---------- Trading fees (3% per trade: 1% creator / 2% platform) ----------

/** Called on every filled buy/sell: adds this trade's fee split to the
 * token's running counters. The creator's share sits here unpaid until
 * the fee distributor sends it out (every 24h, see feeDistributor.ts). */
export async function accrueFees(tokenId: string, creatorFeeZec: number, platformFeeZec: number) {
  await prisma.token.update({
    where: { id: tokenId },
    data: {
      creatorFeeAccruedZec: { increment: creatorFeeZec },
      platformFeeTotalZec: { increment: platformFeeZec },
    },
  });
}

/** Tokens with an unpaid creator fee balance, a payout address on file,
 * and whose last payout (or creation, if never paid) is at least
 * `intervalMs` in the past -- i.e. due for their next 24h distribution.
 *
 * `intervalMs` is skipped entirely when `ignoreInterval` is true: every
 * token with something accrued and a payout address counts as due,
 * regardless of when it was created or last paid. Found 2026-09-07 (Brai
 * ran the new manual admin trigger and got "paid":[] even though he was
 * sure fees had accrued): the interval check was written for the
 * *automatic* 24h cycle, but was also (wrongly) applied to a MANUAL,
 * deliberately-triggered run -- so a token created less than 24h ago
 * (true for everything in this test session) could never have its first
 * payout, no matter how many times the admin route was hit. A manual
 * trigger is Brai choosing the moment on purpose; there's no reason for
 * an internal 24h-since-creation clock to override that. */
export async function getTokensDueForFeePayout(intervalMs: number, ignoreInterval = false): Promise<TokenWithCurve[]> {
  const cutoff = new Date(Date.now() - intervalMs);
  const rows = await prisma.token.findMany({
    where: {
      creatorFeeAccruedZec: { gt: 0 },
      creatorPayoutAddress: { not: null },
      ...(ignoreInterval
        ? {}
        : { OR: [{ lastFeePayoutAt: null, createdAt: { lte: cutoff } }, { lastFeePayoutAt: { lte: cutoff } }] }),
    },
  });
  return rows.map(toTokenWithCurve);
}

/** Records one creator-fee payout and decrements the token's accrued
 * balance by exactly what was paid (a payout can be a partial chunk if
 * the amount due exceeds the per-payout safety cap). */
export async function recordFeePayout(tokenId: string, amountZec: number, toAddress: string, txid: string | null) {
  await prisma.$transaction([
    prisma.creatorFeePayout.create({ data: { tokenId, amountZec, toAddress, txid } }),
    prisma.token.update({
      where: { id: tokenId },
      data: {
        creatorFeeAccruedZec: { decrement: amountZec },
        creatorFeeTotalPaidZec: { increment: amountZec },
        lastFeePayoutAt: new Date(),
      },
    }),
  ]);
}

export interface FeePayoutView {
  amountZec: number;
  toAddress: string;
  txid: string | null;
  createdAt: string;
}

export async function getFeePayoutHistory(tokenId: string, limit = 20): Promise<FeePayoutView[]> {
  const rows = await prisma.creatorFeePayout.findMany({
    where: { tokenId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    amountZec: num(r.amountZec),
    toAddress: r.toAddress,
    txid: r.txid,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ---------- Price history (for the chart) ----------

export async function recordPricePoint(tokenId: string, curve: CurveState, totalSupply: number) {
  const priceZec = currentPrice(curve);
  await prisma.pricePoint.create({
    data: { tokenId, priceZec, mcapZec: priceZec * totalSupply },
  });
}

export interface PricePointView {
  priceZec: number;
  mcapZec: number;
  createdAt: string;
}

export async function getPriceHistory(tokenId: string): Promise<PricePointView[]> {
  const points = await prisma.pricePoint.findMany({
    where: { tokenId },
    orderBy: { createdAt: "asc" },
  });
  return points.map((p) => ({ priceZec: num(p.priceZec), mcapZec: num(p.mcapZec), createdAt: p.createdAt.toISOString() }));
}

/** % change vs. the price ~24h ago, for the "24h" column on the market list.
 * Returns null when the token has no recorded price point older than 24h
 * yet (too new to have a 24h change) -- the frontend shows a dash for that,
 * rather than a misleading 0.00%. */
export async function getPriceChange24hPct(tokenId: string, currentPriceZec: number): Promise<number | null> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const point = await prisma.pricePoint.findFirst({
    where: { tokenId, createdAt: { lte: cutoff } },
    orderBy: { createdAt: "desc" },
  });
  if (!point) return null;
  const oldPrice = num(point.priceZec);
  if (oldPrice <= 0) return null;
  return ((currentPriceZec - oldPrice) / oldPrice) * 100;
}

// ---------- Recent trades (for the trade feed) ----------

export interface TradeView {
  side: OrderSide;
  tokenAmount: number;
  zecAmount: number;
  createdAt: string;
}

export async function getRecentTrades(tokenId: string, limit = 50): Promise<TradeView[]> {
  // Sort by filledAt, not createdAt: an order can sit PENDING for a while
  // waiting on payment (createdAt = when the buy was initiated / address
  // requested), so createdAt and "when this trade actually happened" can
  // diverge a lot -- especially for a repeat-payment clone (see
  // createRepeatBuyOrder), which is born already FILLED. The list below is
  // displayed using filledAt (see `createdAt: (o.filledAt ?? ...)` further
  // down), so it has to be sorted by that same field or trades render out
  // of chronological order (found 2026-09-07, Brai: "quedaron desordenados
  // los tiempos"). Every row here is status FILLED, and every code path
  // that sets that status also sets filledAt, so it's never null here.
  const orders = await prisma.order.findMany({
    where: { tokenId, status: "FILLED" },
    orderBy: { filledAt: "desc" },
    take: limit,
  });
  return orders.map((o) => ({
    side: o.side as OrderSide,
    tokenAmount: num(o.tokenAmount),
    zecAmount: num(o.zecAmount),
    createdAt: (o.filledAt ?? o.createdAt).toISOString(),
  }));
}

export async function getPortfolio(walletId: string) {
  const rows = await prisma.balance.findMany({
    where: { internalWalletId: walletId, amount: { gt: 0 } },
    include: { token: true },
  });
  return rows.map((b) => {
    const curve: CurveState = { realZecReserves: num(b.token.curveReserveZec), tokensSold: num(b.token.curveSoldTokens) };
    return {
      symbol: b.token.symbol,
      name: b.token.name,
      amount: num(b.amount),
      priceZec: currentPrice(curve),
    };
  });
}

// ---------- Orders ----------

export type OrderSide = "BUY" | "SELL";
export type OrderStatus = "PENDING" | "FILLED" | "EXPIRED" | "FAILED";

export interface OrderView {
  id: string;
  internalWalletId: string;
  tokenId: string;
  side: OrderSide;
  status: OrderStatus;
  zecAddress?: string | null;
  refundAddress?: string | null;
  zecAmount?: number | null;
  tokenAmount?: number | null;
  executionTxid?: string | null;
  createdAt: string;
  filledAt?: string | null;
}

function toOrderView(o: {
  id: string;
  internalWalletId: string;
  tokenId: string;
  side: string;
  status: string;
  zecAddress: string | null;
  refundAddress: string | null;
  zecAmount: unknown;
  tokenAmount: bigint | null;
  executionTxid: string | null;
  createdAt: Date;
  filledAt: Date | null;
}): OrderView {
  return {
    id: o.id,
    internalWalletId: o.internalWalletId,
    tokenId: o.tokenId,
    side: o.side as OrderSide,
    status: o.status as OrderStatus,
    zecAddress: o.zecAddress,
    refundAddress: o.refundAddress,
    zecAmount: o.zecAmount === null ? null : num(o.zecAmount),
    tokenAmount: o.tokenAmount === null ? null : num(o.tokenAmount),
    executionTxid: o.executionTxid,
    createdAt: o.createdAt.toISOString(),
    filledAt: o.filledAt ? o.filledAt.toISOString() : null,
  };
}

export async function createBuyOrder(input: { internalWalletId: string; tokenId: string; zecAmount: number }) {
  const o = await prisma.order.create({
    data: {
      internalWalletId: input.internalWalletId,
      tokenId: input.tokenId,
      side: "BUY",
      status: "PENDING",
      zecAmount: input.zecAmount,
    },
  });
  return toOrderView(o);
}

export async function createSellOrder(input: {
  internalWalletId: string;
  tokenId: string;
  tokenAmount: number;
  refundAddress: string;
  zecAmount: number;
  executionTxid: string;
}) {
  const o = await prisma.order.create({
    data: {
      internalWalletId: input.internalWalletId,
      tokenId: input.tokenId,
      side: "SELL",
      status: "FILLED",
      refundAddress: input.refundAddress,
      tokenAmount: BigInt(Math.round(input.tokenAmount)),
      zecAmount: input.zecAmount,
      executionTxid: input.executionTxid,
      filledAt: new Date(),
    },
  });
  return toOrderView(o);
}

/** zecAmount is optional because zcashReal.ts's generateOrderAddress may
 * return an amount that was bumped by a few thousand zatoshis to keep it
 * unique among currently-watched orders (see pickUniqueAmount there) -- when
 * given, this persists that adjusted, real amount so the DB matches what
 * the payer is actually shown/charged. */
export async function setOrderAddress(orderId: string, zecAddress: string, zecAmount?: number) {
  const o = await prisma.order.update({
    where: { id: orderId },
    data: { zecAddress, ...(zecAmount !== undefined ? { zecAmount } : {}) },
  });
  return toOrderView(o);
}

export async function getOrder(id: string): Promise<OrderView | null> {
  const o = await prisma.order.findUnique({ where: { id } });
  return o ? toOrderView(o) : null;
}

/** Same restart-recovery need as getPendingTokenCreationsAwaitingPayment:
 * a real buy order's in-memory watcher is gone after any backend restart,
 * so a payment sent just before a redeploy would otherwise never be
 * detected even once it confirms on-chain. */
export async function getPendingOrdersAwaitingPayment(): Promise<OrderView[]> {
  const rows = await prisma.order.findMany({ where: { status: "PENDING", zecAddress: { not: null } } });
  return rows.map(toOrderView);
}

/** All txids already used to fulfill a payment (a token-creation fee or a
 * filled buy order). Real mode needs this because zingo-cli's `notes`
 * command -- the only source that shows incoming deposits at all (see
 * zcashReal.ts) -- carries no per-diversified-address info, so payments are
 * matched to pending orders by amount, not by address. That means a note
 * that already fulfilled one order could otherwise be matched a second time
 * to a different still-pending order for the same amount (its spend_status
 * stays "unspent" in zingo-cli forever, since we never literally spend it --
 * we just credit the order internally). Seeding the in-memory
 * consumedTxids set from here at boot (see zcashReal.ts's resumeWatching
 * call site in server.ts) closes that gap across restarts, on top of the
 * same-process tracking the poll loop already does. */
export async function getAllKnownPaymentTxids(): Promise<string[]> {
  const [tokens, orders] = await Promise.all([
    prisma.token.findMany({ where: { genesisMemoTxid: { not: null } }, select: { genesisMemoTxid: true } }),
    prisma.order.findMany({ where: { executionTxid: { not: null } }, select: { executionTxid: true } }),
  ]);
  const txids = [
    ...tokens.map((t) => t.genesisMemoTxid),
    ...orders.map((o) => o.executionTxid),
  ].filter((t): t is string => !!t);
  return txids;
}

/** Same-order repeat payment (see isRepeat in zcashReal.ts / server.ts):
 * the ORIGINAL order is already FILLED, so a second (third, ...) send of
 * its exact amount can't fill it again -- instead this creates a brand-new
 * order, already FILLED, that mirrors the original's wallet/token/address
 * and the fresh execution details for that specific repeat payment. */
export async function createRepeatBuyOrder(input: {
  internalWalletId: string;
  tokenId: string;
  zecAddress: string | null;
  zecAmount: number;
  tokenAmount: number;
  executionTxid: string;
}) {
  const o = await prisma.order.create({
    data: {
      internalWalletId: input.internalWalletId,
      tokenId: input.tokenId,
      side: "BUY",
      status: "FILLED",
      zecAddress: input.zecAddress,
      zecAmount: input.zecAmount,
      tokenAmount: BigInt(Math.round(input.tokenAmount)),
      executionTxid: input.executionTxid,
      filledAt: new Date(),
    },
  });
  return toOrderView(o);
}

export async function fillBuyOrder(orderId: string, tokenAmount: number, executionTxid: string) {
  const o = await prisma.order.update({
    where: { id: orderId },
    data: { status: "FILLED", tokenAmount: BigInt(Math.round(tokenAmount)), executionTxid, filledAt: new Date() },
  });
  return toOrderView(o);
}

export async function failOrder(orderId: string) {
  const o = await prisma.order.update({ where: { id: orderId }, data: { status: "FAILED" } });
  return toOrderView(o);
}

// ---------- Pending token creations ----------
// The creator pays the create fee themselves, to a one-time address, same
// mechanism as a buy order (see generateOrderAddress in zcashReal/zcashMock).
// The Token row is only created once that payment is detected -- see
// server.ts's onPaymentDetected handler.

export interface PendingTokenCreationView {
  id: string;
  symbol: string;
  name: string;
  status: "PENDING" | "CREATED" | "EXPIRED" | "FAILED";
  zecAddress: string | null;
  expectedZecAmount: number;
  resultTokenId: string | null;
  createdAt: string;
}

function toPendingTokenCreationView(p: {
  id: string;
  symbol: string;
  name: string;
  status: string;
  zecAddress: string | null;
  expectedZecAmount: unknown;
  resultTokenId: string | null;
  createdAt: Date;
}): PendingTokenCreationView {
  return {
    id: p.id,
    symbol: p.symbol,
    name: p.name,
    status: p.status as PendingTokenCreationView["status"],
    zecAddress: p.zecAddress,
    expectedZecAmount: num(p.expectedZecAmount),
    resultTokenId: p.resultTokenId,
    createdAt: p.createdAt.toISOString(),
  };
}

export async function createPendingTokenCreation(input: {
  symbol: string;
  name: string;
  totalSupply: number;
  creatorWalletId: string;
  creatorPayoutAddress?: string;
  logoDataUrl?: string;
  description?: string;
  twitterUrl?: string;
  expectedZecAmount: number;
}) {
  const p = await prisma.pendingTokenCreation.create({
    data: {
      symbol: input.symbol,
      name: input.name,
      totalSupply: BigInt(Math.round(input.totalSupply)),
      creatorWalletId: input.creatorWalletId,
      creatorPayoutAddress: input.creatorPayoutAddress ?? null,
      logoDataUrl: input.logoDataUrl ?? null,
      description: input.description ?? null,
      twitterUrl: input.twitterUrl ?? null,
      expectedZecAmount: input.expectedZecAmount,
    },
  });
  return toPendingTokenCreationView(p);
}

/** expectedZecAmount is optional for the same reason as setOrderAddress's
 * zecAmount param -- see its comment. */
export async function setPendingTokenCreationAddress(id: string, zecAddress: string, expectedZecAmount?: number) {
  const p = await prisma.pendingTokenCreation.update({
    where: { id },
    data: { zecAddress, ...(expectedZecAmount !== undefined ? { expectedZecAmount } : {}) },
  });
  return toPendingTokenCreationView(p);
}

export async function getPendingTokenCreation(id: string): Promise<PendingTokenCreationView | null> {
  const p = await prisma.pendingTokenCreation.findUnique({ where: { id } });
  return p ? toPendingTokenCreationView(p) : null;
}

/** The in-memory payment watcher (zcashReal.ts) is wiped on every backend
 * restart/redeploy -- this is how the backend re-learns, on boot, which
 * token creations were mid-payment when it went down, so a restart during
 * the 10-15min real confirmation window doesn't silently strand a real
 * payment nobody is watching for anymore. Only rows that already got a
 * zecAddress (i.e. actually reached the "waiting for payment" screen)
 * are worth resuming. */
export async function getPendingTokenCreationsAwaitingPayment(): Promise<PendingTokenCreationView[]> {
  const rows = await prisma.pendingTokenCreation.findMany({ where: { status: "PENDING", zecAddress: { not: null } } });
  return rows.map(toPendingTokenCreationView);
}

/** A symbol that's already claimed by another PENDING reservation can't be
 * reserved again -- same rule as an already-created Token. */
export async function isSymbolReserved(symbol: string): Promise<boolean> {
  const existing = await prisma.pendingTokenCreation.findFirst({ where: { symbol, status: "PENDING" } });
  return existing != null;
}

/** Fee arrived: create the real Token row from the reserved fields and mark
 * this reservation CREATED. Returns the new token. */
export async function completePendingTokenCreation(id: string, genesisMemoTxid: string | undefined) {
  const p = await prisma.pendingTokenCreation.findUnique({ where: { id } });
  if (!p || p.status !== "PENDING") return null;

  const token = await createToken({
    symbol: p.symbol,
    name: p.name,
    totalSupply: num(p.totalSupply),
    creatorWalletId: p.creatorWalletId,
    genesisMemoTxid,
    creatorPayoutAddress: p.creatorPayoutAddress ?? undefined,
    logoDataUrl: p.logoDataUrl ?? undefined,
    description: p.description ?? undefined,
    twitterUrl: p.twitterUrl ?? undefined,
  });

  await prisma.pendingTokenCreation.update({
    where: { id },
    data: { status: "CREATED", resultTokenId: token.id, completedAt: new Date() },
  });

  return token;
}

export async function failPendingTokenCreation(id: string) {
  const p = await prisma.pendingTokenCreation.update({ where: { id }, data: { status: "FAILED" } });
  return toPendingTokenCreationView(p);
}
