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

// ---------- Recent trades (for the trade feed) ----------

export interface TradeView {
  side: OrderSide;
  tokenAmount: number;
  zecAmount: number;
  createdAt: string;
}

export async function getRecentTrades(tokenId: string, limit = 50): Promise<TradeView[]> {
  const orders = await prisma.order.findMany({
    where: { tokenId, status: "FILLED" },
    orderBy: { createdAt: "desc" },
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

export async function setOrderAddress(orderId: string, zecAddress: string) {
  const o = await prisma.order.update({ where: { id: orderId }, data: { zecAddress } });
  return toOrderView(o);
}

export async function getOrder(id: string): Promise<OrderView | null> {
  const o = await prisma.order.findUnique({ where: { id } });
  return o ? toOrderView(o) : null;
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
