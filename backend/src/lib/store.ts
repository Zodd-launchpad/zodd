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

/** Which chain a token/order/pending-creation trades on -- see the big
 * comment on Token.currency in schema.prisma. Kept as a plain string union
 * (not re-exporting Prisma's generated enum type) to match how every other
 * status/side field in this file is already typed. */
export type Currency = "ZEC" | "YEC";

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

// ---------- Noir Wallet connect ----------
// Brai, 2026-09-18: "conectas la extension de la wallet NOIR para
// navegador y ya te asocia tu wallet" -- a second way in, alongside
// create/import above. See the big comment on InternalWallet.noirAddress
// and NoirAuthChallenge in schema.prisma for the full design/why.

const NOIR_CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutos para firmar y volver

/** Step 1 of connect-with-Noir: a fresh one-time nonce + the EXACT message
 * text the frontend must have Noir sign. We store the message ourselves
 * (not just the nonce) so verification always checks against what we
 * actually issued, never something reconstructed after the fact. */
export async function createNoirChallenge() {
  const nonce = randomUUID().replace(/-/g, "");
  const message = `Sign in to zodd.fun\n\nNonce: ${nonce}\nIssued: ${new Date().toISOString()}`;
  await prisma.noirAuthChallenge.create({ data: { nonce, message } });
  return { nonce, message };
}

/** Step 3: one-time consume. Deletes the row so the same signature can
 * never be replayed to "log in" twice -- returns null (and still deletes,
 * if found) when the nonce doesn't exist or is past NOIR_CHALLENGE_TTL_MS,
 * so an old tab left open overnight can't be used the next morning. */
export async function consumeNoirChallenge(nonce: string): Promise<{ message: string } | null> {
  let row;
  try {
    row = await prisma.noirAuthChallenge.delete({ where: { nonce } });
  } catch {
    return null; // ya consumido, o nunca existió
  }
  if (Date.now() - row.createdAt.getTime() > NOIR_CHALLENGE_TTL_MS) return null;
  return { message: row.message };
}

export async function findWalletByNoirAddress(noirAddress: string) {
  const wallet = await prisma.internalWallet.findUnique({ where: { noirAddress } });
  return wallet ? { id: wallet.id, walletTag: wallet.walletTag, createdAt: wallet.createdAt.toISOString() } : null;
}

/** Step 4: after the signature over the challenge verifies, either return
 * the existing wallet already linked to this transparent address (so
 * reconnecting the same Noir account always lands you back on the same
 * balances -- the whole point of this being a login mechanism) or create a
 * brand new one. `shieldedAddress` is stashed as defaultRefundAddress so
 * Sell/payout flows pre-fill it immediately, same as any other wallet that
 * has sold before (see setDefaultRefundAddress above) -- always refreshed
 * to whatever Noir just reported, in case the user's primary account in
 * the extension changed. A Noir-connected wallet has no seed phrase at all
 * (seedHashHex null): reconnecting Noir IS the recovery mechanism, there's
 * no 12 words to lose or need to re-enter. */
export async function connectOrCreateNoirWallet(transparentAddress: string, shieldedAddress: string) {
  const existing = await prisma.internalWallet.findUnique({ where: { noirAddress: transparentAddress } });
  if (existing) {
    const updated = await prisma.internalWallet.update({
      where: { id: existing.id },
      data: { defaultRefundAddress: shieldedAddress },
    });
    return { id: updated.id, walletTag: updated.walletTag, createdAt: updated.createdAt.toISOString() };
  }
  const created = await prisma.internalWallet.create({
    data: { walletTag: newWalletTag(), seedHashHex: null, noirAddress: transparentAddress, defaultRefundAddress: shieldedAddress },
  });
  return { id: created.id, walletTag: created.walletTag, createdAt: created.createdAt.toISOString() };
}

// ---------- Tokens ----------

export interface TokenWithCurve {
  id: string;
  symbol: string;
  name: string;
  totalSupply: number;
  creatorWalletId: string;
  /** Which chain this token trades in for its whole life -- see the big
   * comment on Token.currency in schema.prisma. */
  currency: Currency;
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
  currency: string;
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
    currency: t.currency as Currency,
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
  /** Which chain this token trades in -- see Token.currency in
   * schema.prisma. Defaults to ZEC so every pre-multi-currency caller is
   * unaffected. */
  currency?: Currency;
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
      currency: input.currency ?? "ZEC",
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
// Brai, 2026-09-11: `currency` filter added alongside multi-currency support
// -- run-fee-distribution in server.ts is still ZEC-only admin tooling (no
// real YEC wallet exists yet to pay a YEC creator fee out of), so it passes
// currency: "ZEC" here to make sure a YEC token's accrued fee is never
// swept into a ZEC payout by mistake. Omit it to get every currency (not
// used anywhere yet, but kept general).
export async function getTokensDueForFeePayout(
  intervalMs: number,
  ignoreInterval = false,
  minAccruedZec = 0,
  currency?: Currency
): Promise<TokenWithCurve[]> {
  const cutoff = new Date(Date.now() - intervalMs);
  const rows = await prisma.token.findMany({
    where: {
      creatorFeeAccruedZec: minAccruedZec > 0 ? { gte: minAccruedZec } : { gt: 0 },
      creatorPayoutAddress: { not: null },
      ...(currency ? { currency } : {}),
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
  currency: Currency;
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
    currency: o.currency as Currency,
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
    currency: o.currency as Currency,
    tokenAmount: num(o.tokenAmount),
    zecAmount: num(o.zecAmount),
    symbol: o.token.symbol,
    createdAt: (o.filledAt ?? o.createdAt).toISOString(),
  }));
}

// Brai, 2026-09-18 (NFT marketplace launch): "quiero que la compra venta y
// listado de nfts aparezca en el LIVE ACTIVITY tambien" -- a site-wide feed
// mirroring getRecentTradesGlobal above but for NFT events (mint, list,
// sale), merged into the SAME panel on the frontend (see ActivityFeed.tsx).
// Deliberately wallet-free, same lesson as the whitelist by-handle privacy
// fix: this is public and unauthenticated, so it only ever names the PIECE
// (collection + edition), never who owns or listed it.
export type NftActivityKind = "MINT" | "LIST" | "SALE";
export interface NftActivityView {
  kind: NftActivityKind;
  collectionSlug: string;
  editionNumber: number;
  name: string | null;
  priceZec: number;
  currency: Currency;
  createdAt: string;
}

export async function getRecentNftActivityGlobal(limit = 30): Promise<NftActivityView[]> {
  const perKind = Math.min(limit, 30);
  const [mints, listings, sales] = await Promise.all([
    prisma.nftItem.findMany({
      where: { mintedAt: { not: null } },
      orderBy: { mintedAt: "desc" },
      take: perKind,
      select: { editionNumber: true, name: true, mintedAt: true, collection: { select: { slug: true, mintPriceZec: true, currency: true } } },
    }),
    prisma.nftItem.findMany({
      where: { listedAt: { not: null } },
      orderBy: { listedAt: "desc" },
      take: perKind,
      select: { editionNumber: true, name: true, listedAt: true, listedPriceZec: true, collection: { select: { slug: true, currency: true } } },
    }),
    prisma.nftPurchaseOrder.findMany({
      where: { status: "FILLED" },
      orderBy: { filledAt: "desc" },
      take: perKind,
      select: {
        filledAt: true,
        currency: true,
        expectedZecAmount: true,
        item: { select: { editionNumber: true, name: true, collection: { select: { slug: true } } } },
      },
    }),
  ]);

  const rows: NftActivityView[] = [
    ...mints.map((m) => ({
      kind: "MINT" as const,
      collectionSlug: m.collection.slug,
      editionNumber: m.editionNumber,
      name: m.name,
      priceZec: num(m.collection.mintPriceZec),
      currency: m.collection.currency as Currency,
      createdAt: (m.mintedAt as Date).toISOString(),
    })),
    ...listings.map((l) => ({
      kind: "LIST" as const,
      collectionSlug: l.collection.slug,
      editionNumber: l.editionNumber,
      name: l.name,
      priceZec: num(l.listedPriceZec),
      currency: l.collection.currency as Currency,
      createdAt: (l.listedAt as Date).toISOString(),
    })),
    ...sales.map((s) => ({
      kind: "SALE" as const,
      collectionSlug: s.item.collection.slug,
      editionNumber: s.item.editionNumber,
      name: s.item.name,
      priceZec: num(s.expectedZecAmount),
      currency: s.currency as Currency,
      createdAt: (s.filledAt as Date).toISOString(),
    })),
  ];

  rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return rows.slice(0, limit);
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
      // Brai, 2026-09-11: "quiero que puedas trabajar con Ycash y Zcash" --
      // a wallet can now hold both ZEC- and YEC-denominated tokens, so the
      // portfolio view has to say which is which (see PortfolioHolding in
      // frontend/lib/api.ts).
      currency: b.token.currency as Currency,
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
  /** Copied from the parent Token at order-creation time -- see the
   * comment on Order.currency in schema.prisma. */
  currency: Currency;
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
  currency: string;
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
    currency: o.currency as Currency,
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

export async function createBuyOrder(input: {
  internalWalletId: string;
  tokenId: string;
  /** The token's own currency -- caller always has this on hand from the
   * token it just looked up. Defaults ZEC only so nothing else breaks if a
   * caller forgets to pass it. */
  currency?: Currency;
  zecAmount: number;
  refundAddress?: string;
}) {
  const o = await prisma.order.create({
    data: {
      internalWalletId: input.internalWalletId,
      tokenId: input.tokenId,
      side: "BUY",
      status: "PENDING",
      currency: input.currency ?? "ZEC",
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
  currency?: Currency;
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
      currency: input.currency ?? "ZEC",
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
  const [tokens, orders, nftMints, nftPurchases] = await Promise.all([
    prisma.token.findMany({ where: { genesisMemoTxid: { not: null } }, select: { genesisMemoTxid: true } }),
    prisma.order.findMany({ where: { executionTxid: { not: null } }, select: { executionTxid: true } }),
    // Brai, 2026-09-18: NFT mint/purchase payments need the exact same
    // de-dupe protection as everything else here -- see the big comment
    // above and zcashReal.ts's seedConsumedTxids.
    prisma.nftItem.findMany({ where: { mintPaymentTxid: { not: null } }, select: { mintPaymentTxid: true } }),
    prisma.nftPurchaseOrder.findMany({ where: { executionTxid: { not: null } }, select: { executionTxid: true } }),
  ]);
  const txids = [
    ...tokens.map((t) => t.genesisMemoTxid),
    ...orders.map((o) => o.executionTxid),
    ...nftMints.map((n) => n.mintPaymentTxid),
    ...nftPurchases.map((n) => n.executionTxid),
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
  currency?: Currency;
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
      currency: input.currency ?? "ZEC",
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
  creatorWalletId: string;
  /** Which currency the creator is paying in -- becomes the resulting
   * Token's currency. See Token.currency in schema.prisma. */
  currency: Currency;
  zecAddress: string | null;
  zecSaplingDiversifierHex?: string | null;
  zecOrchardDiversifierHex?: string | null;
  expectedZecAmount: number;
  /** Portion of expectedZecAmount that's a bundled first buy, not the
   * create fee -- see the schema comment on PendingTokenCreation. 0 when
   * this creation has no bundled buy. */
  firstBuyZec: number;
  resultTokenId: string | null;
  createdAt: string;
}

function toPendingTokenCreationView(p: {
  id: string;
  symbol: string;
  name: string;
  status: string;
  creatorWalletId: string;
  currency: string;
  zecAddress: string | null;
  zecSaplingDiversifierHex?: string | null;
  zecOrchardDiversifierHex?: string | null;
  expectedZecAmount: unknown;
  firstBuyZec: unknown;
  resultTokenId: string | null;
  createdAt: Date;
}): PendingTokenCreationView {
  return {
    id: p.id,
    symbol: p.symbol,
    name: p.name,
    status: p.status as PendingTokenCreationView["status"],
    creatorWalletId: p.creatorWalletId,
    currency: p.currency as Currency,
    zecAddress: p.zecAddress,
    zecSaplingDiversifierHex: p.zecSaplingDiversifierHex ?? null,
    zecOrchardDiversifierHex: p.zecOrchardDiversifierHex ?? null,
    expectedZecAmount: num(p.expectedZecAmount),
    firstBuyZec: num(p.firstBuyZec),
    resultTokenId: p.resultTokenId,
    createdAt: p.createdAt.toISOString(),
  };
}

export async function createPendingTokenCreation(input: {
  symbol: string;
  name: string;
  totalSupply: number;
  creatorWalletId: string;
  /** Which currency the creator is paying in -- see the comment on
   * PendingTokenCreationView.currency. Defaults ZEC. */
  currency?: Currency;
  creatorPayoutAddress?: string;
  logoDataUrl?: string;
  description?: string;
  twitterUrl?: string;
  websiteUrl?: string;
  expectedZecAmount: number;
  /** Bundled first-buy portion of expectedZecAmount -- see the schema
   * comment on PendingTokenCreation. Defaults to 0 (no bundled buy). */
  firstBuyZec?: number;
}) {
  const p = await prisma.pendingTokenCreation.create({
    data: {
      symbol: input.symbol,
      name: input.name,
      totalSupply: BigInt(Math.round(input.totalSupply)),
      creatorWalletId: input.creatorWalletId,
      currency: input.currency ?? "ZEC",
      creatorPayoutAddress: input.creatorPayoutAddress ?? null,
      logoDataUrl: input.logoDataUrl ?? null,
      description: input.description ?? null,
      twitterUrl: input.twitterUrl ?? null,
      websiteUrl: input.websiteUrl ?? null,
      expectedZecAmount: input.expectedZecAmount,
      firstBuyZec: input.firstBuyZec ?? 0,
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
    currency: p.currency as Currency,
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

// ---------- NFT marketplace ----------
// See the big comment block on this section in schema.prisma for the
// overall design. Mirrors the Token/Order/PendingTokenCreation shapes and
// patterns above on purpose -- same real-ZEC payment machinery, same kind
// of view/create/complete functions.

export type NftMintStatus = "PENDING" | "CREATED" | "EXPIRED" | "FAILED";
export type NftOrderStatus = "PENDING" | "FILLED" | "EXPIRED" | "FAILED";

export interface NftCollectionView {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  currency: Currency;
  totalSupply: number;
  mintPriceZec: number;
  coverImageDataUrl: string | null;
  mintedCount: number;
  createdAt: string;
}

function toNftCollectionView(c: {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  currency: string;
  totalSupply: number;
  mintPriceZec: unknown;
  coverImageDataUrl: string | null;
  mintedCount: number;
  createdAt: Date;
}): NftCollectionView {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    description: c.description,
    currency: c.currency as Currency,
    totalSupply: c.totalSupply,
    mintPriceZec: num(c.mintPriceZec),
    coverImageDataUrl: c.coverImageDataUrl,
    mintedCount: c.mintedCount,
    createdAt: c.createdAt.toISOString(),
  };
}

export async function getNftCollectionBySlug(slug: string): Promise<NftCollectionView | null> {
  const c = await prisma.nftCollection.findUnique({ where: { slug } });
  return c ? toNftCollectionView(c) : null;
}

export async function getNftCollectionById(id: string): Promise<NftCollectionView | null> {
  const c = await prisma.nftCollection.findUnique({ where: { id } });
  return c ? toNftCollectionView(c) : null;
}

/** Read-only stats for the collection header (floor/listed/sales/volume),
 * same idea as zecbit.net's collection banner. All computed on the fly --
 * cheap, since this is one hand-curated collection (at most totalSupply
 * rows), not millions. */
export async function getNftCollectionStats(collectionId: string): Promise<{
  floorZec: number | null;
  listedCount: number;
  salesCount: number;
  volumeZec: number;
}> {
  const [floor, listedCount, sales] = await Promise.all([
    prisma.nftItem.aggregate({
      where: { collectionId, listedPriceZec: { not: null } },
      _min: { listedPriceZec: true },
    }),
    prisma.nftItem.count({ where: { collectionId, listedPriceZec: { not: null } } }),
    prisma.nftPurchaseOrder.aggregate({
      where: { status: "FILLED", item: { collectionId } },
      _sum: { expectedZecAmount: true },
      _count: true,
    }),
  ]);
  return {
    floorZec: floor._min.listedPriceZec != null ? num(floor._min.listedPriceZec) : null,
    listedCount,
    salesCount: sales._count,
    volumeZec: num(sales._sum.expectedZecAmount ?? 0),
  };
}

export interface NftItemView {
  id: string;
  collectionId: string;
  editionNumber: number;
  name: string | null;
  imageDataUrl: string | null;
  traits: unknown;
  mintedAt: string | null;
  mintPaymentTxid: string | null;
  ownerInternalWalletId: string | null;
  ownerWalletTag: string | null;
  listedPriceZec: number | null;
  listedAt: string | null;
  // Brai, 2026-09-11-style precedent: Token.creatorPayoutAddress is already
  // shown publicly (see serializeToken's fee object), so exposing a
  // listing's payout address here too is consistent, not a new kind of
  // disclosure -- shielded addresses don't leak balance, only "this wallet
  // is selling this piece". Needed by the buy route (server.ts) without a
  // second lookup.
  listedPayoutAddress: string | null;
}

function toNftItemView(i: {
  id: string;
  collectionId: string;
  editionNumber: number;
  name: string | null;
  imageDataUrl: string | null;
  traits: unknown;
  mintedAt: Date | null;
  mintPaymentTxid: string | null;
  ownerInternalWalletId: string | null;
  ownerInternalWallet?: { walletTag: string } | null;
  listedPriceZec: unknown;
  listedAt: Date | null;
  listedPayoutAddress: string | null;
}): NftItemView {
  return {
    id: i.id,
    collectionId: i.collectionId,
    editionNumber: i.editionNumber,
    name: i.name,
    imageDataUrl: i.imageDataUrl,
    traits: i.traits ?? null,
    mintedAt: i.mintedAt ? i.mintedAt.toISOString() : null,
    mintPaymentTxid: i.mintPaymentTxid,
    ownerInternalWalletId: i.ownerInternalWalletId,
    ownerWalletTag: i.ownerInternalWallet?.walletTag ?? null,
    listedPriceZec: i.listedPriceZec != null ? num(i.listedPriceZec) : null,
    listedAt: i.listedAt ? i.listedAt.toISOString() : null,
    listedPayoutAddress: i.listedPayoutAddress,
  };
}

export async function listNftItems(
  collectionId: string,
  opts: {
    status?: "listed" | "all";
    ownerWalletId?: string;
    sort?: "price_asc" | "price_desc" | "edition";
    page?: number;
    pageSize?: number;
  } = {}
): Promise<{ items: NftItemView[]; total: number }> {
  const pageSize = Math.min(opts.pageSize ?? 48, 100);
  const page = Math.max(opts.page ?? 1, 1);
  const where: Record<string, unknown> = { collectionId };
  if (opts.status === "listed") where.listedPriceZec = { not: null };
  if (opts.ownerWalletId) where.ownerInternalWalletId = opts.ownerWalletId;
  const orderBy =
    opts.sort === "price_desc"
      ? [{ listedPriceZec: "desc" as const }]
      : opts.sort === "price_asc"
        ? [{ listedPriceZec: "asc" as const }]
        : [{ editionNumber: "asc" as const }];
  const [rows, total] = await Promise.all([
    prisma.nftItem.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { ownerInternalWallet: { select: { walletTag: true } } },
    }),
    prisma.nftItem.count({ where }),
  ]);
  return { items: rows.map(toNftItemView), total };
}

export async function getNftItemByEdition(collectionId: string, editionNumber: number): Promise<NftItemView | null> {
  const i = await prisma.nftItem.findUnique({
    where: { collectionId_editionNumber: { collectionId, editionNumber } },
    include: { ownerInternalWallet: { select: { walletTag: true } } },
  });
  return i ? toNftItemView(i) : null;
}

export async function getNftItemById(id: string): Promise<NftItemView | null> {
  const i = await prisma.nftItem.findUnique({
    where: { id },
    include: { ownerInternalWallet: { select: { walletTag: true } } },
  });
  return i ? toNftItemView(i) : null;
}

export async function getWalletNfts(walletId: string): Promise<NftItemView[]> {
  const rows = await prisma.nftItem.findMany({
    where: { ownerInternalWalletId: walletId },
    orderBy: { mintedAt: "desc" },
    include: { ownerInternalWallet: { select: { walletTag: true } } },
  });
  return rows.map(toNftItemView);
}

/** Owner-checked list/unlist -- both are a plain conditional UPDATE (WHERE
 * id AND ownerInternalWalletId = walletId), so a wallet can never list or
 * unlist a piece it doesn't own, and there's no separate read-then-write
 * race to worry about. */
export async function listNftForSale(
  itemId: string,
  walletId: string,
  priceZec: number,
  payoutAddress: string
): Promise<NftItemView | null> {
  const result = await prisma.nftItem.updateMany({
    where: { id: itemId, ownerInternalWalletId: walletId },
    data: { listedPriceZec: priceZec, listedAt: new Date(), listedPayoutAddress: payoutAddress },
  });
  if (result.count === 0) return null;
  return getNftItemById(itemId);
}

export async function unlistNft(itemId: string, walletId: string): Promise<NftItemView | null> {
  const result = await prisma.nftItem.updateMany({
    where: { id: itemId, ownerInternalWalletId: walletId },
    data: { listedPriceZec: null, listedAt: null, listedPayoutAddress: null },
  });
  if (result.count === 0) return null;
  return getNftItemById(itemId);
}

// Brai, 2026-09-18 (NFT marketplace launch): "empeza a deployar la pagina"
// -- an HTTP-callable twin of scripts/seedNftCollection.ts's upsert logic,
// for seeding art that Claude already holds in memory as base64 (sent
// straight from chat) rather than files sitting on this container's disk.
// Same idempotency guarantees as the CLI version: re-running against the
// same slug upserts the collection in place, and an item that's already
// been minted (ownerInternalWalletId set) is left completely untouched --
// safe to call again as Brai sends more art ("vendran muchos mas").
// ADMIN_TOKEN-gated at the route (see server.ts), same as every other
// admin-only mutation in this file.
export interface NftSeedManifestItem {
  editionNumber: number;
  name?: string | null;
  imageDataUrl: string;
  traits?: Record<string, string> | null;
}
export interface NftSeedManifest {
  slug: string;
  name: string;
  description?: string | null;
  currency?: "ZEC" | "YEC";
  mintPriceZec: number;
  coverImageDataUrl?: string | null;
  items: NftSeedManifestItem[];
}

export async function seedNftCollectionFromManifest(
  manifest: NftSeedManifest
): Promise<{ collectionId: string; totalSupply: number; created: number; updated: number; skippedMinted: number }> {
  if (!manifest.slug || !manifest.name || !manifest.items?.length) {
    throw new Error("manifest needs at least slug, name, and a non-empty items[]");
  }
  if (!(manifest.mintPriceZec > 0)) {
    throw new Error("manifest.mintPriceZec must be a positive number -- this is the real mint price, not a placeholder");
  }
  const editionNumbers = manifest.items.map((i) => i.editionNumber);
  if (new Set(editionNumbers).size !== editionNumbers.length) {
    throw new Error("duplicate editionNumber in manifest.items -- each piece needs a unique number");
  }

  const totalSupply = manifest.items.length;
  const currency = manifest.currency ?? "ZEC";

  const collection = await prisma.nftCollection.upsert({
    where: { slug: manifest.slug },
    create: {
      slug: manifest.slug,
      name: manifest.name,
      description: manifest.description ?? null,
      currency,
      totalSupply,
      mintPriceZec: manifest.mintPriceZec,
      coverImageDataUrl: manifest.coverImageDataUrl ?? null,
      hidden: true, // Brai flips this (or just links /nft) when he's ready for real users
    },
    update: {
      name: manifest.name,
      description: manifest.description ?? null,
      currency,
      totalSupply,
      mintPriceZec: manifest.mintPriceZec,
      ...(manifest.coverImageDataUrl ? { coverImageDataUrl: manifest.coverImageDataUrl } : {}),
    },
  });

  let created = 0;
  let updated = 0;
  let skippedMinted = 0;
  for (const item of manifest.items) {
    const existing = await prisma.nftItem.findUnique({
      where: { collectionId_editionNumber: { collectionId: collection.id, editionNumber: item.editionNumber } },
    });
    if (existing?.ownerInternalWalletId) {
      skippedMinted++;
      continue; // already minted -- never overwrite a piece someone owns
    }
    await prisma.nftItem.upsert({
      where: { collectionId_editionNumber: { collectionId: collection.id, editionNumber: item.editionNumber } },
      create: {
        collectionId: collection.id,
        editionNumber: item.editionNumber,
        name: item.name ?? null,
        imageDataUrl: item.imageDataUrl,
        traits: item.traits ?? undefined,
      },
      update: {
        name: item.name ?? null,
        imageDataUrl: item.imageDataUrl,
        traits: item.traits ?? undefined,
      },
    });
    if (existing) updated++;
    else created++;
  }

  return { collectionId: collection.id, totalSupply, created, updated, skippedMinted };
}

// ---------- Pending NFT mints ----------
// The minter pays a fixed price to a one-time address, same mechanism as a
// token-creation fee -- the piece is only actually assigned once that
// payment is detected (see completePendingNftMint below and the payment
// handler in server.ts).

export interface PendingNftMintView {
  id: string;
  collectionId: string;
  internalWalletId: string;
  currency: Currency;
  zecAddress: string | null;
  zecSaplingDiversifierHex?: string | null;
  zecOrchardDiversifierHex?: string | null;
  expectedZecAmount: number;
  status: NftMintStatus;
  resultItemId: string | null;
  createdAt: string;
}

function toPendingNftMintView(p: {
  id: string;
  collectionId: string;
  internalWalletId: string;
  currency: string;
  zecAddress: string | null;
  zecSaplingDiversifierHex?: string | null;
  zecOrchardDiversifierHex?: string | null;
  expectedZecAmount: unknown;
  status: string;
  resultItemId: string | null;
  createdAt: Date;
}): PendingNftMintView {
  return {
    id: p.id,
    collectionId: p.collectionId,
    internalWalletId: p.internalWalletId,
    currency: p.currency as Currency,
    zecAddress: p.zecAddress,
    zecSaplingDiversifierHex: p.zecSaplingDiversifierHex ?? null,
    zecOrchardDiversifierHex: p.zecOrchardDiversifierHex ?? null,
    expectedZecAmount: num(p.expectedZecAmount),
    status: p.status as NftMintStatus,
    resultItemId: p.resultItemId,
    createdAt: p.createdAt.toISOString(),
  };
}

export async function createPendingNftMint(input: {
  collectionId: string;
  internalWalletId: string;
  currency?: Currency;
  expectedZecAmount: number;
}) {
  const p = await prisma.pendingNftMint.create({
    data: {
      collectionId: input.collectionId,
      internalWalletId: input.internalWalletId,
      currency: input.currency ?? "ZEC",
      expectedZecAmount: input.expectedZecAmount,
    },
  });
  return toPendingNftMintView(p);
}

export async function setPendingNftMintAddress(
  id: string,
  zecAddress: string,
  expectedZecAmount?: number,
  zecSaplingDiversifierHex?: string | null,
  zecOrchardDiversifierHex?: string | null
) {
  const p = await prisma.pendingNftMint.update({
    where: { id },
    data: {
      zecAddress,
      ...(expectedZecAmount !== undefined ? { expectedZecAmount } : {}),
      zecSaplingDiversifierHex: zecSaplingDiversifierHex ?? null,
      zecOrchardDiversifierHex: zecOrchardDiversifierHex ?? null,
    },
  });
  return toPendingNftMintView(p);
}

export async function getPendingNftMint(id: string): Promise<PendingNftMintView | null> {
  const p = await prisma.pendingNftMint.findUnique({ where: { id } });
  return p ? toPendingNftMintView(p) : null;
}

/** Same restart-recovery need as getPendingTokenCreationsAwaitingPayment --
 * see its comment. */
export async function getPendingNftMintsAwaitingPayment(): Promise<PendingNftMintView[]> {
  const rows = await prisma.pendingNftMint.findMany({ where: { status: "PENDING", zecAddress: { not: null } } });
  return rows.map(toPendingNftMintView);
}

export async function failPendingNftMint(id: string) {
  const p = await prisma.pendingNftMint.update({ where: { id }, data: { status: "FAILED" } });
  return toPendingNftMintView(p);
}

/** Atomically claims one random still-unminted NftItem for this collection
 * and assigns it to `walletId`. Postgres' FOR UPDATE SKIP LOCKED inside a
 * CTE makes this safe under concurrency: two mint payments confirming in
 * the same moment race for different rows instead of ever both landing on
 * the same piece (a plain read-then-write from application code would have
 * an obvious TOCTOU gap here). Returns null if nothing is left unminted
 * (sold out). */
async function claimRandomUnmintedNftItem(collectionId: string, walletId: string, txid: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH picked AS (
      SELECT id FROM "NftItem"
      WHERE "collectionId" = ${collectionId} AND "ownerInternalWalletId" IS NULL
      ORDER BY random()
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "NftItem" AS n
    SET "ownerInternalWalletId" = ${walletId}, "mintedAt" = now(), "mintPaymentTxid" = ${txid}
    FROM picked
    WHERE n.id = picked.id
    RETURNING n.id
  `;
  return rows[0]?.id ?? null;
}

/** Payment for a mint confirmed: claims a random unminted piece and marks
 * the reservation CREATED. Returns null if the collection was already sold
 * out by the time this payment landed (an unlucky simultaneous-mint race)
 * -- the payment still arrived for real in that case, so the caller
 * (server.ts) treats that as an admin-recovery case, same philosophy as
 * every other forensics case in this file, rather than silently losing
 * track of it. */
export async function completePendingNftMint(
  id: string,
  txid: string
): Promise<{ collectionSlug: string; itemId: string; editionNumber: number } | null> {
  const p = await prisma.pendingNftMint.findUnique({ where: { id } });
  if (!p || p.status !== "PENDING") return null;

  const itemId = await claimRandomUnmintedNftItem(p.collectionId, p.internalWalletId, txid);
  if (!itemId) return null;

  const [item] = await prisma.$transaction([
    prisma.nftItem.findUniqueOrThrow({ where: { id: itemId } }),
    prisma.nftCollection.update({ where: { id: p.collectionId }, data: { mintedCount: { increment: 1 } } }),
    prisma.pendingNftMint.update({ where: { id }, data: { status: "CREATED", resultItemId: itemId, completedAt: new Date() } }),
  ]);
  const collection = await prisma.nftCollection.findUniqueOrThrow({ where: { id: p.collectionId }, select: { slug: true } });
  return { collectionSlug: collection.slug, itemId: item.id, editionNumber: item.editionNumber };
}

// ---------- NFT whitelist (Twitter, manually reviewed) ----------
// Brai, 2026-09-18: see the long comment on NftWhitelistEntry in
// schema.prisma for the full design. Short version: someone pastes a ZEC
// address + Twitter/X handle (no wallet connection needed to apply), Brai
// reviews by hand (approve/reject), and an APPROVED entry whose address
// matches a connected wallet gets that wallet exactly one free mint.

export type NftWhitelistStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface NftWhitelistEntryView {
  id: string;
  walletAddress: string;
  twitterHandle: string;
  status: NftWhitelistStatus;
  createdAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  claimedAt: string | null;
}

function toNftWhitelistEntryView(e: {
  id: string;
  walletAddress: string;
  twitterHandle: string;
  status: string;
  createdAt: Date;
  reviewedAt: Date | null;
  reviewNote: string | null;
  claimedAt: Date | null;
}): NftWhitelistEntryView {
  return {
    id: e.id,
    walletAddress: e.walletAddress,
    twitterHandle: e.twitterHandle,
    status: e.status as NftWhitelistStatus,
    createdAt: e.createdAt.toISOString(),
    reviewedAt: e.reviewedAt ? e.reviewedAt.toISOString() : null,
    reviewNote: e.reviewNote,
    claimedAt: e.claimedAt ? e.claimedAt.toISOString() : null,
  };
}

/** Strips a leading "@" and lowercases, so "@Brai", "brai" and "BRAI" all
 * land on the same row -- X handles are case-insensitive themselves. */
function normalizeTwitterHandle(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

/** Very loose sanity check, not a real Zcash address validator -- this is
 * typed in by hand by someone who may not even have a wallet open at the
 * time (Brai: "no se necesita conectar la wallet para agregar, solo hay
 * que poner la wallet y el handle"), so we only reject the obviously wrong
 * (empty, whitespace inside, absurdly short/long) and let Brai's own manual
 * review catch anything that looks fishy. Accepts transparent (t1/t3),
 * shielded (zs1/ys1) and unified (u1) addresses alike -- see the long
 * comment on claimFreeNftWhitelistMint below for why the address TYPE
 * someone pastes here matters for whether it gets auto-recognized later. */
function looksLikeZcashAddress(raw: string): boolean {
  const addr = raw.trim();
  return addr.length >= 8 && addr.length <= 200 && !/\s/.test(addr);
}

/** Submits (or re-submits) a whitelist application for a given address.
 * Re-submitting the same address while still PENDING or after a REJECTED
 * just overwrites the handle and resets to PENDING (lets someone fix a
 * typo without emailing Brai about it) -- but an already-APPROVED entry is
 * left untouched, so a stray re-submit can never downgrade an address that
 * already has its free mint locked in. Returns { error } instead of
 * throwing for the user-facing validation cases so server.ts can send a
 * clean 400 either way. */
export async function submitNftWhitelistEntry(
  rawAddress: string,
  rawHandle: string
): Promise<NftWhitelistEntryView | { error: string }> {
  const address = rawAddress.trim();
  if (!looksLikeZcashAddress(address)) {
    return { error: "that doesn't look like a valid Zcash wallet address" };
  }
  const handle = normalizeTwitterHandle(rawHandle);
  if (!/^[a-z0-9_]{1,15}$/.test(handle)) {
    return { error: "that doesn't look like a valid X/Twitter handle" };
  }
  const existing = await prisma.nftWhitelistEntry.findUnique({ where: { walletAddress: address } });
  if (existing?.status === "APPROVED") {
    return toNftWhitelistEntryView(existing);
  }
  const takenByAnotherAddress = await prisma.nftWhitelistEntry.findFirst({
    where: { twitterHandle: handle, walletAddress: { not: address } },
  });
  if (takenByAnotherAddress) {
    return { error: "that X/Twitter handle is already registered with another wallet address" };
  }
  // Brai, 2026-09-18 (v10): "si te doy una lista para whitelistear... al
  // final le dice aprovedd directamente" -- a handle on the standing
  // pre-approved list (see NftWhitelistPreapproved) skips manual review:
  // it goes straight to APPROVED the moment they finish the wizard and
  // submit their wallet address, same as if Brai had reviewed it himself.
  const preapproved = await prisma.nftWhitelistPreapproved.findUnique({ where: { twitterHandle: handle } });
  const data = preapproved
    ? { twitterHandle: handle, status: "APPROVED" as const, reviewedAt: new Date(), reviewNote: "pre-approved list" }
    : { twitterHandle: handle, status: "PENDING" as const, reviewedAt: null, reviewNote: null };
  const entry = await prisma.nftWhitelistEntry.upsert({
    where: { walletAddress: address },
    create: { walletAddress: address, ...data },
    update: data,
  });
  return toNftWhitelistEntryView(entry);
}

/** Bulk-adds handles to the standing pre-approval list (see
 * NftWhitelistPreapproved above). Idempotent -- re-adding an already
 * pre-approved handle just updates its note. Returns the normalized
 * handles that were (already) added, so the caller can sanity-check the
 * count against the list they pasted in. */
export async function preapproveNftWhitelistHandles(
  rawHandles: string[],
  note?: string
): Promise<{ handle: string; alreadyEntered: boolean }[]> {
  const results: { handle: string; alreadyEntered: boolean }[] = [];
  for (const raw of rawHandles) {
    const handle = normalizeTwitterHandle(raw);
    if (!/^[a-z0-9_]{1,15}$/.test(handle)) continue;
    await prisma.nftWhitelistPreapproved.upsert({
      where: { twitterHandle: handle },
      create: { twitterHandle: handle, note: note ?? null },
      update: { note: note ?? null },
    });
    // If they already have a PENDING/REJECTED entry (submitted before Brai
    // handed over the list), flip it to APPROVED right now too -- otherwise
    // someone who already applied would be stuck waiting even though
    // they're on the list.
    const existing = await prisma.nftWhitelistEntry.findFirst({ where: { twitterHandle: handle } });
    let alreadyEntered = false;
    if (existing && existing.status !== "APPROVED") {
      await prisma.nftWhitelistEntry.update({
        where: { id: existing.id },
        data: { status: "APPROVED", reviewedAt: new Date(), reviewNote: "pre-approved list" },
      });
      alreadyEntered = true;
    } else if (existing) {
      alreadyEntered = true;
    }
    results.push({ handle, alreadyEntered });
  }
  return results;
}

export async function getNftWhitelistEntry(walletAddress: string): Promise<NftWhitelistEntryView | null> {
  const entry = await prisma.nftWhitelistEntry.findUnique({ where: { walletAddress: walletAddress.trim() } });
  return entry ? toNftWhitelistEntryView(entry) : null;
}

/** Public-facing shape for the by-handle lookup below. This endpoint is
 * UNAUTHENTICATED and reachable by typing anyone's handle, not just your
 * own -- so it must never leak walletAddress (would deanonymize whoever
 * owns that handle) or reviewNote (Brai's internal review comments). Only
 * the status-relevant fields are safe to expose publicly. */
export interface NftWhitelistPublicStatusView {
  id: string;
  twitterHandle: string;
  status: NftWhitelistStatus;
  createdAt: string;
  reviewedAt: string | null;
  claimedAt: string | null;
}

/** Brai, 2026-09-18 (v8): "si pones tu HANDLE y ya suscribiste te vaya a la
 * 4ta directamente" -- lets the wizard recognize a returning applicant by
 * TYPED HANDLE alone, not just the localStorage-remembered address (a
 * different browser/device has no localStorage entry, but the handle is
 * the same). twitterHandle isn't a DB-level unique constraint, but
 * submitNftWhitelistEntry above enforces it's unique in practice, so
 * findFirst is safe here.
 *
 * Brai, 2026-09-18 (v9, URGENT PRIVACY FIX): "cuando ppones el handle te
 * dice que wallet es, no tiene que aparecer que wallet es se supone que es
 * anonimo" -- this handle lookup has no ownership check (anyone can type
 * anyone's handle), so it must return the wallet-free public view, never
 * the full entry. */
export async function getNftWhitelistEntryByHandle(rawHandle: string): Promise<NftWhitelistPublicStatusView | null> {
  const handle = normalizeTwitterHandle(rawHandle);
  if (!/^[a-z0-9_]{1,15}$/.test(handle)) return null;
  const entry = await prisma.nftWhitelistEntry.findFirst({ where: { twitterHandle: handle } });
  if (!entry) return null;
  return {
    id: entry.id,
    twitterHandle: entry.twitterHandle,
    status: entry.status as NftWhitelistStatus,
    createdAt: entry.createdAt.toISOString(),
    reviewedAt: entry.reviewedAt ? entry.reviewedAt.toISOString() : null,
    claimedAt: entry.claimedAt ? entry.claimedAt.toISOString() : null,
  };
}

/** Brai's review queue -- oldest first (FIFO), same ordering convention as
 * every other admin-facing list in this file. */
export async function listNftWhitelistEntries(status?: NftWhitelistStatus): Promise<NftWhitelistEntryView[]> {
  const entries = await prisma.nftWhitelistEntry.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "asc" },
  });
  return entries.map(toNftWhitelistEntryView);
}

export async function reviewNftWhitelistEntry(
  id: string,
  status: "APPROVED" | "REJECTED",
  note?: string
): Promise<NftWhitelistEntryView | null> {
  try {
    const entry = await prisma.nftWhitelistEntry.update({
      where: { id },
      data: { status, reviewedAt: new Date(), reviewNote: note ?? null },
    });
    return toNftWhitelistEntryView(entry);
  } catch {
    return null; // id doesn't exist
  }
}

/** The payoff: a wallet whose address matches an APPROVED, not-yet-claimed
 * whitelist entry mints a random piece for free, no payment/deposit-address
 * dance at all, and no ZEC moves anywhere for it (Brai, 2026-09-18: "no se
 * descuenta de mi wallet el minteo de los nft, solo son gratis, es
 * publicidad, un gasto administrativo") -- it's a straight assignment,
 * reusing the exact same atomic claimRandomUnmintedNftItem race-safe claim
 * a real paid mint uses. The synthetic txid-shaped string is only for
 * readability in NftItem.mintPaymentTxid/admin logs.
 *
 * Matching "this connecting wallet" back to "that pasted-in address" is
 * best-effort, checked against BOTH addresses this wallet is known by:
 *   - InternalWallet.noirAddress (transparent) -- 100% stable, this is
 *     already the app's own login identity for a Noir-connected wallet
 *     (see the long comment on that field in schema.prisma), so if
 *     whoever applied pasted their transparent address, this always works.
 *   - InternalWallet.defaultRefundAddress (shielded) -- stable in practice
 *     (connectOrCreateNoirWallet refreshes it to Noir's connect-time
 *     shielded address every time, and wallets normally show one steady
 *     default shielded/unified address rather than a fresh one per
 *     connect), but NOT a hard guarantee: Zcash shielded/unified addresses
 *     can be diversified, i.e. the same spending key can legitimately
 *     produce many different valid address strings. If someone pastes a
 *     shielded address here that the wallet later never shows again
 *     verbatim, this simply won't auto-match -- Brai can still see the
 *     APPROVED entry in the admin queue and there's no other side effect.
 *
 * Returns a tagged error instead of throwing for every expected case (no
 * matching approved entry, already used, collection missing/sold out) so
 * server.ts can turn each into a clean, specific 4xx. */
export async function claimFreeNftWhitelistMint(
  collectionSlug: string,
  walletId: string
): Promise<
  | { ok: true; collectionSlug: string; itemId: string; editionNumber: number }
  | { ok: false; error: "not_approved" | "already_claimed" | "collection_not_found" | "sold_out" }
> {
  const wallet = await prisma.internalWallet.findUnique({ where: { id: walletId } });
  if (!wallet) return { ok: false, error: "not_approved" };
  const candidateAddresses = [wallet.noirAddress, wallet.defaultRefundAddress].filter(
    (a): a is string => !!a
  );
  if (candidateAddresses.length === 0) return { ok: false, error: "not_approved" };

  const entry = await prisma.nftWhitelistEntry.findFirst({
    where: { walletAddress: { in: candidateAddresses }, status: "APPROVED" },
  });
  if (!entry) return { ok: false, error: "not_approved" };
  if (entry.claimedAt) return { ok: false, error: "already_claimed" };

  const collection = await prisma.nftCollection.findUnique({ where: { slug: collectionSlug } });
  if (!collection) return { ok: false, error: "collection_not_found" };

  const txid = `whitelist-free-${walletId}-${Date.now()}`;
  const itemId = await claimRandomUnmintedNftItem(collection.id, walletId, txid);
  if (!itemId) return { ok: false, error: "sold_out" };

  const [item] = await prisma.$transaction([
    prisma.nftItem.findUniqueOrThrow({ where: { id: itemId } }),
    prisma.nftCollection.update({ where: { id: collection.id }, data: { mintedCount: { increment: 1 } } }),
    prisma.nftWhitelistEntry.update({
      where: { id: entry.id },
      data: { claimedAt: new Date(), claimedByWalletId: walletId },
    }),
  ]);
  return { ok: true, collectionSlug, itemId: item.id, editionNumber: item.editionNumber };
}

// ---------- NFT secondary-market purchases ----------
// Buying a LISTED piece -- same address-per-order mechanism as a token buy
// order, but the platform relays the payout to the CURRENT OWNER instead
// of keeping it (see handleNftPurchasePayment in server.ts).

export interface NftPurchaseOrderView {
  id: string;
  itemId: string;
  buyerInternalWalletId: string;
  sellerInternalWalletId: string;
  currency: Currency;
  zecAddress: string | null;
  zecSaplingDiversifierHex?: string | null;
  zecOrchardDiversifierHex?: string | null;
  payoutAddress: string;
  expectedZecAmount: number;
  status: NftOrderStatus;
  executionTxid: string | null;
  createdAt: string;
  filledAt: string | null;
}

function toNftPurchaseOrderView(o: {
  id: string;
  itemId: string;
  buyerInternalWalletId: string;
  sellerInternalWalletId: string;
  currency: string;
  zecAddress: string | null;
  zecSaplingDiversifierHex?: string | null;
  zecOrchardDiversifierHex?: string | null;
  payoutAddress: string;
  expectedZecAmount: unknown;
  status: string;
  executionTxid: string | null;
  createdAt: Date;
  filledAt: Date | null;
}): NftPurchaseOrderView {
  return {
    id: o.id,
    itemId: o.itemId,
    buyerInternalWalletId: o.buyerInternalWalletId,
    sellerInternalWalletId: o.sellerInternalWalletId,
    currency: o.currency as Currency,
    zecAddress: o.zecAddress,
    zecSaplingDiversifierHex: o.zecSaplingDiversifierHex ?? null,
    zecOrchardDiversifierHex: o.zecOrchardDiversifierHex ?? null,
    payoutAddress: o.payoutAddress,
    expectedZecAmount: num(o.expectedZecAmount),
    status: o.status as NftOrderStatus,
    executionTxid: o.executionTxid,
    createdAt: o.createdAt.toISOString(),
    filledAt: o.filledAt ? o.filledAt.toISOString() : null,
  };
}

export async function createNftPurchaseOrder(input: {
  itemId: string;
  buyerInternalWalletId: string;
  sellerInternalWalletId: string;
  currency?: Currency;
  payoutAddress: string;
  expectedZecAmount: number;
}) {
  const o = await prisma.nftPurchaseOrder.create({
    data: {
      itemId: input.itemId,
      buyerInternalWalletId: input.buyerInternalWalletId,
      sellerInternalWalletId: input.sellerInternalWalletId,
      currency: input.currency ?? "ZEC",
      payoutAddress: input.payoutAddress,
      expectedZecAmount: input.expectedZecAmount,
    },
  });
  return toNftPurchaseOrderView(o);
}

export async function setNftPurchaseOrderAddress(
  id: string,
  zecAddress: string,
  expectedZecAmount?: number,
  zecSaplingDiversifierHex?: string | null,
  zecOrchardDiversifierHex?: string | null
) {
  const o = await prisma.nftPurchaseOrder.update({
    where: { id },
    data: {
      zecAddress,
      ...(expectedZecAmount !== undefined ? { expectedZecAmount } : {}),
      zecSaplingDiversifierHex: zecSaplingDiversifierHex ?? null,
      zecOrchardDiversifierHex: zecOrchardDiversifierHex ?? null,
    },
  });
  return toNftPurchaseOrderView(o);
}

export async function getNftPurchaseOrder(id: string): Promise<NftPurchaseOrderView | null> {
  const o = await prisma.nftPurchaseOrder.findUnique({ where: { id } });
  return o ? toNftPurchaseOrderView(o) : null;
}

/** Same restart-recovery need as getPendingOrdersAwaitingPayment -- see its
 * comment. */
export async function getPendingNftPurchasesAwaitingPayment(): Promise<NftPurchaseOrderView[]> {
  const rows = await prisma.nftPurchaseOrder.findMany({ where: { status: "PENDING", zecAddress: { not: null } } });
  return rows.map(toNftPurchaseOrderView);
}

export async function failNftPurchaseOrder(id: string) {
  const o = await prisma.nftPurchaseOrder.update({ where: { id }, data: { status: "FAILED" } });
  return toNftPurchaseOrderView(o);
}

/** Payment for a secondary-market purchase confirmed: atomically transfers
 * ownership from seller to buyer, but ONLY if the item is still owned by
 * that exact seller and still listed -- a single conditional UPDATE, which
 * is what makes this race-safe against two buyers paying for the same
 * listing around the same time (whoever's payment lands first here wins
 * the item). Returns null when that race is lost; the caller treats the
 * loser's payment as an admin-recovery case, same philosophy as every
 * other forensics case in this file, since it arrived for real. */
export async function fillNftPurchase(
  purchaseId: string,
  itemId: string,
  sellerWalletId: string,
  buyerWalletId: string,
  txid: string
): Promise<NftItemView | null> {
  const result = await prisma.nftItem.updateMany({
    where: { id: itemId, ownerInternalWalletId: sellerWalletId, listedPriceZec: { not: null } },
    data: { ownerInternalWalletId: buyerWalletId, listedPriceZec: null, listedAt: null, listedPayoutAddress: null },
  });
  if (result.count === 0) return null;
  await prisma.nftPurchaseOrder.update({ where: { id: purchaseId }, data: { status: "FILLED", executionTxid: txid, filledAt: new Date() } });
  return getNftItemById(itemId);
}
