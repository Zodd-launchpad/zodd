/**
 * Postgres-backed store via Prisma (prisma/schema.prisma is the source of truth
 * for the shape). Same entities/behavior as the earlier in-memory version, but
 * this one actually persists across restarts and deploys.
 */
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { CurveState, DEFAULT_CURVE_CONFIG, currentPrice, quoteBuy, quoteSell } from "./bondingCurve.js";
import { splitFee } from "./fees.js";

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
  websiteUrl: string | null;
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
  websiteUrl: string | null;
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
    websiteUrl: t.websiteUrl,
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
  websiteUrl?: string;
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
      websiteUrl: input.websiteUrl ?? null,
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
  const ts = await prisma.token.findMany({ where: { hidden: false }, orderBy: { createdAt: "asc" } });
  return ts.map(toTokenWithCurve);
}

/** Sets (or clears) the `hidden` flag on a batch of tokens by symbol --
 * see the big comment on Token.hidden in schema.prisma. Not a delete:
 * only affects listTokens (the public boards/search), a hidden token is
 * still directly reachable by symbol (buy/sell/history keep working) in
 * case that's ever needed. Returns which symbols were actually found and
 * updated, so the caller can flag any typo'd symbol. */
export async function setTokensHidden(symbols: string[], hidden: boolean): Promise<{ updated: string[]; notFound: string[] }> {
  const upper = symbols.map((s) => s.toUpperCase());
  const existing = await prisma.token.findMany({ where: { symbol: { in: upper } }, select: { symbol: true } });
  const foundSymbols: Set<string> = new Set(existing.map((t: { symbol: string }) => t.symbol));
  const notFound = upper.filter((s) => !foundSymbols.has(s));
  const updated: string[] = [...foundSymbols];
  if (updated.length > 0) {
    await prisma.token.updateMany({ where: { symbol: { in: updated } }, data: { hidden } });
  }
  return { updated, notFound };
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

/** Brai, 2026-09-07: found that BAMAMA's website was saved as
 * "https://www.zodd.fun" -- the "www" subdomain has no DNS record (only
 * the bare domain does), so the link 404s/NXDOMAINs even though it was
 * typed correctly and normalizeWebsite worked as intended. There's no
 * "edit token" UI yet, so this is the one-off admin fix for a typo'd
 * link -- pass undefined for a field to leave it as-is, or an empty
 * string to clear it. Gated by ADMIN_TOKEN in server.ts, same as the
 * other admin routes; this only ever touches these two display fields,
 * never balances, the curve, or anything financial. */
export async function setTokenLinks(tokenId: string, links: { twitterUrl?: string | null; websiteUrl?: string | null }) {
  await prisma.token.update({
    where: { id: tokenId },
    data: {
      ...(links.twitterUrl !== undefined ? { twitterUrl: links.twitterUrl || null } : {}),
      ...(links.websiteUrl !== undefined ? { websiteUrl: links.websiteUrl || null } : {}),
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

/** Brai, 2026-09-07: "los fee [de la plataforma], como claimeo" -- the
 * platform's 1% never gets paid out anywhere (it just sits in the real
 * wallet balance), so unlike the creator side there's no per-token
 * "accrued but unpaid" counter to read directly: Token.platformFeeTotalZec
 * is a lifetime total that never decrements. Claimable = everything ever
 * earned across every token, minus everything ever actually withdrawn
 * (PlatformWithdrawal). Deliberately NOT the real wallet's total balance
 * -- most of that balance is the bonding-curve reserve owed to future
 * sellers and unpaid creator fees, not free platform money. */
export async function getPlatformFeeStatus(): Promise<{ totalEarnedZec: number; totalWithdrawnZec: number; claimableZec: number }> {
  const [earned, withdrawn] = await Promise.all([
    prisma.token.aggregate({ _sum: { platformFeeTotalZec: true } }),
    prisma.platformWithdrawal.aggregate({ _sum: { amountZec: true } }),
  ]);
  const totalEarnedZec = num(earned._sum.platformFeeTotalZec ?? 0);
  const totalWithdrawnZec = num(withdrawn._sum.amountZec ?? 0);
  return { totalEarnedZec, totalWithdrawnZec, claimableZec: Math.max(0, totalEarnedZec - totalWithdrawnZec) };
}

/** Records one platform-fee withdrawal so it counts against the claimable
 * balance from then on (see getPlatformFeeStatus). */
export async function recordPlatformWithdrawal(amountZec: number, toAddress: string, txid: string | null) {
  await prisma.platformWithdrawal.create({ data: { amountZec, toAddress, txid } });
}

/**
 * Brai, 2026-09-07: a real sell failed with "insufficient balance" even
 * though the token's own curveReserveZec looked like it should cover it
 * ("no me gusta, ahi tenes que tener un chequeo"). Every token shares ONE
 * real Zcash wallet -- curveReserveZec, creatorFeeAccruedZec and
 * platformFeeTotalZec are all logical/off-chain ledger numbers that
 * together represent everything the platform "owes" out of that one real
 * balance (reserve owed to future sellers, fee owed to creators, fee
 * claimable by the platform). This is a pure read-only audit: sum what's
 * owed across every token so it can be compared against the wallet's
 * actual real spendable balance (see the /api/admin/financial-audit route
 * in server.ts, which adds that real-balance comparison). Never moves
 * funds or changes any stored number -- if it finds a shortfall, that's a
 * real thing to go investigate (e.g. via recomputeCurveFromOrders per
 * token), not something this function fixes on its own. */
export async function getFinancialAudit() {
  const tokens = await prisma.token.findMany({
    select: {
      symbol: true,
      name: true,
      createdAt: true,
      curveReserveZec: true,
      curveSoldTokens: true,
      graduated: true,
      creatorFeeAccruedZec: true,
      creatorFeeTotalPaidZec: true,
      platformFeeTotalZec: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const withdrawn = await prisma.platformWithdrawal.aggregate({ _sum: { amountZec: true } });
  type TokenAuditRow = {
    symbol: string;
    name: string;
    createdAt: string;
    curveReserveZec: number;
    curveSoldTokens: string;
    graduated: boolean;
    creatorFeeAccruedZec: number;
    creatorFeeTotalPaidZec: number;
    platformFeeTotalZec: number;
  };
  const rows: TokenAuditRow[] = tokens.map((t: (typeof tokens)[number]) => ({
    symbol: t.symbol,
    name: t.name,
    createdAt: t.createdAt.toISOString(),
    curveReserveZec: num(t.curveReserveZec),
    curveSoldTokens: t.curveSoldTokens.toString(),
    graduated: t.graduated,
    creatorFeeAccruedZec: num(t.creatorFeeAccruedZec),
    creatorFeeTotalPaidZec: num(t.creatorFeeTotalPaidZec),
    platformFeeTotalZec: num(t.platformFeeTotalZec),
  }));
  const totalReserveOwed = rows.reduce((s: number, r: TokenAuditRow) => s + r.curveReserveZec, 0);
  const totalCreatorFeeOwed = rows.reduce((s: number, r: TokenAuditRow) => s + r.creatorFeeAccruedZec, 0);
  const totalPlatformFeeEarned = rows.reduce((s: number, r: TokenAuditRow) => s + r.platformFeeTotalZec, 0);
  const totalPlatformFeeWithdrawn = num(withdrawn._sum.amountZec ?? 0);
  const totalPlatformFeeClaimable = Math.max(0, totalPlatformFeeEarned - totalPlatformFeeWithdrawn);
  const totalOwed = totalReserveOwed + totalCreatorFeeOwed + totalPlatformFeeClaimable;
  return {
    tokens: rows,
    totalReserveOwed,
    totalCreatorFeeOwed,
    totalPlatformFeeEarned,
    totalPlatformFeeWithdrawn,
    totalPlatformFeeClaimable,
    totalOwed,
  };
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
export async function getTokensDueForFeePayout(intervalMs: number, ignoreInterval = false, minAccruedZec = 0): Promise<TokenWithCurve[]> {
  const cutoff = new Date(Date.now() - intervalMs);
  const rows = await prisma.token.findMany({
    where: {
      creatorFeeAccruedZec: minAccruedZec > 0 ? { gte: minAccruedZec } : { gt: 0 },
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

/** % change vs. the very first recorded price point for this token (set at
 * creation, see recordPricePoint in createToken) -- used only by the
 * scrolling top ticker, NOT the "24h" column on the market list table.
 * getPriceChange24hPct above returns null for any token under 24h old
 * (every token on this platform, as of 2026-09-08 -- it launched
 * yesterday), which the ticker was showing as a permanent "NEW" tag with
 * zero information. Brai, 2026-09-08: "esa barra tiene que decir cuanto
 * subio o bajo la moneda". This is a real, non-fabricated number -- just a
 * "since launch" window instead of a strict 24h one -- which is why it's
 * kept as a separate field instead of changing what getPriceChange24hPct
 * means (that would make the market list's literal "24h" column header a
 * lie for young tokens). */
export async function getPriceChangeSinceLaunchPct(tokenId: string, currentPriceZec: number): Promise<number | null> {
  const point = await prisma.pricePoint.findFirst({
    where: { tokenId },
    orderBy: { createdAt: "asc" },
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

export interface GlobalTradeView extends TradeView {
  symbol: string;
}

// Brai, 2026-09-08: "necsito movimiento en la pagina sino parece que nadie
// esta comprando y vendiendo" -- a site-wide feed (not per-token) for a
// small always-on activity panel. Same FILLED/filledAt sorting rationale
// as getRecentTrades above; joins in the token symbol since this spans
// every token instead of one.
export async function getRecentTradesGlobal(limit = 30): Promise<GlobalTradeView[]> {
  const orders = await prisma.order.findMany({
    where: { status: "FILLED" },
    orderBy: { filledAt: "desc" },
    take: limit,
    include: { token: { select: { symbol: true } } },
  });
  return orders.map((o) => ({
    side: o.side as OrderSide,
    tokenAmount: num(o.tokenAmount),
    zecAmount: num(o.zecAmount),
    symbol: o.token.symbol,
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
  zecSaplingDiversifierHex?: string | null;
  zecOrchardDiversifierHex?: string | null;
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
  zecSaplingDiversifierHex?: string | null;
  zecOrchardDiversifierHex?: string | null;
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
    zecSaplingDiversifierHex: o.zecSaplingDiversifierHex ?? null,
    zecOrchardDiversifierHex: o.zecOrchardDiversifierHex ?? null,
    refundAddress: o.refundAddress,
    zecAmount: o.zecAmount === null ? null : num(o.zecAmount),
    tokenAmount: o.tokenAmount === null ? null : num(o.tokenAmount),
    executionTxid: o.executionTxid,
    createdAt: o.createdAt.toISOString(),
    filledAt: o.filledAt ? o.filledAt.toISOString() : null,
  };
}

export async function createBuyOrder(input: { internalWalletId: string; tokenId: string; zecAmount: number; refundAddress?: string }) {
  const o = await prisma.order.create({
    data: {
      internalWalletId: input.internalWalletId,
      tokenId: input.tokenId,
      side: "BUY",
      status: "PENDING",
      zecAmount: input.zecAmount,
      // Brai, 2026-09-07: "que la gente cuando vaya a comprar te deje la
      // wallet... asi tenemos registrado el comprador y le enviamos el
      // dinero en caso de problemas" -- recorded on the order itself (not
      // just the wallet-level default) so admin recovery for a stray/
      // wrong-amount note has a specific address to work from, per order.
      refundAddress: input.refundAddress ?? null,
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
 * the payer is actually shown/charged.
 *
 * ZODD (2026-09-08): also persists zecAddress's own diversifier (per
 * shielded pool), when generateOrderAddress returned one -- see the ZODD
 * comment on PendingPayment in zcashReal.ts. This is what lets a resumed
 * watcher (after a restart) still match by address instead of falling
 * back to memo/amount. Both null on an unpatched zingo-cli build. */
export async function setOrderAddress(
  orderId: string,
  zecAddress: string,
  zecAmount?: number,
  zecSaplingDiversifierHex?: string | null,
  zecOrchardDiversifierHex?: string | null
) {
  const o = await prisma.order.update({
    where: { id: orderId },
    data: {
      zecAddress,
      ...(zecAmount !== undefined ? { zecAmount } : {}),
      zecSaplingDiversifierHex: zecSaplingDiversifierHex ?? null,
      zecOrchardDiversifierHex: zecOrchardDiversifierHex ?? null,
    },
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

/** Brai, 2026-09-07: "revisa A FONDO esto no puede pasar" -- two real buy
 * payments (0.2 ZEC on ZODD, 0.05 ZEC on ZOOKCAT) landed in the wallet as
 * unclaimed notes instead of filling their orders. Forensics for that needs
 * the actual order row(s) those payments were meant for: status, exact
 * zecAmount (may have been bumped a few thousand zatoshis by
 * pickAndReserveAmount), zecAddress, and timestamps, to compare against the
 * unclaimed note's on-chain time. A small tolerance band (not an exact
 * match) is deliberate, since the persisted amount can be the bumped one,
 * not the round number the buyer typed. Read-only.
 */
/** Same forensics need as findOrdersNearAmount, but against
 * PendingTokenCreation -- in case a stray note was actually meant to pay a
 * token-creation fee, not a buy order (different table entirely). */
export async function findTokenCreationsNearAmount(zecAmount: number, toleranceZec = 0.001) {
  const rows = await prisma.pendingTokenCreation.findMany({
    where: { expectedZecAmount: { gte: zecAmount - toleranceZec, lte: zecAmount + toleranceZec } },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
  return rows.map((c: (typeof rows)[number]) => ({
    id: c.id,
    symbol: c.symbol,
    status: c.status,
    zecAddress: c.zecAddress,
    expectedZecAmount: Number(c.expectedZecAmount),
    creatorPayoutAddress: c.creatorPayoutAddress,
    createdAt: c.createdAt,
    completedAt: c.completedAt,
  }));
}

export async function findOrdersNearAmount(zecAmount: number, toleranceZec = 0.001) {
  const rows = await prisma.order.findMany({
    where: {
      side: "BUY",
      zecAmount: { gte: zecAmount - toleranceZec, lte: zecAmount + toleranceZec },
    },
    orderBy: { createdAt: "desc" },
    take: 25,
    include: { token: { select: { symbol: true } } },
  });
  return rows.map((o: (typeof rows)[number]) => ({
    id: o.id,
    status: o.status,
    symbol: o.token.symbol,
    zecAddress: o.zecAddress,
    zecAmount: o.zecAmount ? Number(o.zecAmount) : null,
    refundAddress: o.refundAddress,
    executionTxid: o.executionTxid,
    createdAt: o.createdAt,
    filledAt: o.filledAt,
  }));
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
  zecSaplingDiversifierHex?: string | null;
  zecOrchardDiversifierHex?: string | null;
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
  zecSaplingDiversifierHex?: string | null;
  zecOrchardDiversifierHex?: string | null;
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
    zecSaplingDiversifierHex: p.zecSaplingDiversifierHex ?? null,
    zecOrchardDiversifierHex: p.zecOrchardDiversifierHex ?? null,
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
  websiteUrl?: string;
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
      websiteUrl: input.websiteUrl ?? null,
      expectedZecAmount: input.expectedZecAmount,
    },
  });
  return toPendingTokenCreationView(p);
}

/** expectedZecAmount is optional for the same reason as setOrderAddress's
 * zecAmount param -- see its comment. Also persists zecAddress's own
 * diversifier the same way setOrderAddress does -- see the ZODD comment
 * there. */
export async function setPendingTokenCreationAddress(
  id: string,
  zecAddress: string,
  expectedZecAmount?: number,
  zecSaplingDiversifierHex?: string | null,
  zecOrchardDiversifierHex?: string | null
) {
  const p = await prisma.pendingTokenCreation.update({
    where: { id },
    data: {
      zecAddress,
      ...(expectedZecAmount !== undefined ? { expectedZecAmount } : {}),
      zecSaplingDiversifierHex: zecSaplingDiversifierHex ?? null,
      zecOrchardDiversifierHex: zecOrchardDiversifierHex ?? null,
    },
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
    websiteUrl: p.websiteUrl ?? undefined,
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

// ---------- Curve data repair ----------

/** Recomputes a token's curve state (curveReserveZec, curveSoldTokens,
 * graduated) from scratch by replaying every FILLED order in chronological
 * order, instead of trusting whatever is currently stored. Fixes drift
 * from the lost-update race that used to be possible when two buys/sells
 * for the same token were processed concurrently (see mutex.ts's big
 * comment -- found 2026-09-07, Brai got "cannot sell more than the curve
 * has issued" trying to sell FLORKY, because past concurrent buys had
 * silently clobbered each other's curve write while the balance ledger,
 * which is always atomic, stayed correct). Balances are NEVER touched
 * here -- they were never wrong -- only the curve's own running totals.
 * Order.zecAmount is always the GROSS amount (before the 2/1/1% fee
 * split) for both sides, matching what quoteBuy/quoteSell expect. */
export async function recomputeCurveFromOrders(tokenId: string): Promise<{ before: CurveState; after: CurveState; ordersReplayed: number }> {
  const token = await prisma.token.findUnique({ where: { id: tokenId } });
  if (!token) throw new Error("token not found");
  const before: CurveState = { realZecReserves: num(token.curveReserveZec), tokensSold: num(token.curveSoldTokens) };

  const orders = await prisma.order.findMany({
    where: { tokenId, status: "FILLED" },
    orderBy: [{ filledAt: "asc" }, { createdAt: "asc" }],
  });

  let state: CurveState = { realZecReserves: 0, tokensSold: 0 };
  for (const o of orders) {
    // Best-effort: skip (rather than abort the whole replay) on anything
    // quoteBuy/quoteSell would reject -- if the ORIGINAL history itself
    // already had a conflict (possible cause, not just effect, of the
    // drift this is fixing), one bad order shouldn't block reconstructing
    // everything else.
    try {
      if (o.side === "BUY") {
        const { net } = splitFee(num(o.zecAmount));
        state = quoteBuy(state, net).newState;
      } else {
        state = quoteSell(state, num(o.tokenAmount)).newState;
      }
    } catch {
      continue;
    }
  }

  const graduated = state.realZecReserves >= DEFAULT_CURVE_CONFIG.graduationZecThreshold;
  await prisma.token.update({
    where: { id: tokenId },
    data: {
      curveReserveZec: state.realZecReserves,
      curveSoldTokens: BigInt(Math.max(0, Math.round(state.tokensSold))),
      graduated,
      graduatedAt: graduated ? (token.graduatedAt ?? new Date()) : null,
    },
  });

  return { before, after: state, ordersReplayed: orders.length };
}
