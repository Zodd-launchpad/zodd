/**
 * Postgres-backed store via Prisma (prisma/schema.prisma is the source of truth
 * for the shape). Same entities/behavior as the earlier in-memory version, but
 * this one actually persists across restarts and deploys.
 */
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { CurveState, DEFAULT_CURVE_CONFIG, currentPrice, quoteBuy, quoteSell } from "./bondingCurve.js";
import { splitFee, NFT_WHITELIST_FREE_MINT_LIMIT, NFT_TIER_NUMBERING_START, freeMintLimitForTier, NFT_RESERVATION_MINUTES } from "./fees.js";

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
  // Brai, 2026-09-19: LA PIRAMIDE -- see graduationThresholdFor below and
  // Token.isPyramidToken/graduationZecThresholdOverride in schema.prisma.
  isPyramidToken: boolean;
  graduationZecThresholdOverride: number | null;
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
  isPyramidToken?: boolean;
  graduationZecThresholdOverride?: unknown;
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
    isPyramidToken: t.isPyramidToken ?? false,
    graduationZecThresholdOverride: t.graduationZecThresholdOverride != null ? num(t.graduationZecThresholdOverride) : null,
  };
}

/** The real graduation threshold to use for this token's curve -- 3 ZEC
 * for a Pyramid token (Brai, 2026-09-19: "una curva que a los 3 ZEC
 * bondean"), otherwise the normal DEFAULT_CURVE_CONFIG default. The curve
 * SHAPE (virtualZecReserves/virtualTokenReserves, so price impact per
 * trade) never changes per-token -- only this one number does. */
export function graduationThresholdFor(token: { graduationZecThresholdOverride: number | null }): number {
  return token.graduationZecThresholdOverride ?? DEFAULT_CURVE_CONFIG.graduationZecThreshold;
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
  /** Brai, 2026-09-19: "LA PIRAMIDE" -- true only for a token created
   * through the reliquia-gated flow (checked by the caller via
   * walletOwnsReliquia before this ever runs). Sets a 3 ZEC graduation
   * threshold instead of the normal default -- see graduationThresholdFor. */
  isPyramidToken?: boolean;
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
      isPyramidToken: input.isPyramidToken ?? false,
      graduationZecThresholdOverride: input.isPyramidToken ? 3 : null,
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

export async function updateTokenCurve(tokenId: string, curve: CurveState, graduationZecThreshold: number = DEFAULT_CURVE_CONFIG.graduationZecThreshold) {
  const graduated = curve.realZecReserves >= graduationZecThreshold;
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

// Brai, 2026-09-19: "solucionalo con una venta como si alguien vendiera esa
// cantidad" -- incident recovery for the phantom "repeat buy" credits (see
// the big comment on isNoteFreshEnoughFor in zcashReal.ts for the root
// cause: stale, already-spent notes got re-matched as if they were fresh
// payments, once per poll tick). This is NOT a real sell -- there is no
// real seller and no real ZEC to pay out, so running an actual sell order
// would either fail or, worse, send real ZEC out of the platform wallet for
// nothing. Instead this un-does exactly what the phantom buy did, using the
// exact numbers that were recorded at credit time (order.tokenAmount,
// splitFee(order.zecAmount)) rather than re-quoting the curve -- an exact
// inverse, not an approximation: curveSoldTokens and curveReserveZec go
// back down by precisely what they went up by, the fee accrual this buy
// added is subtracted back out, the buyer's wallet loses the tokens it was
// never paid for, and the fabricated order row is removed so it stops
// showing up in trade history. Only ever touches a FILLED BUY -- refuses
// anything else outright rather than guess.
export async function reversePhantomBuyOrder(
  orderId: string
): Promise<
  | { ok: true; orderId: string; symbol: string; tokenAmount: string; netZecReversed: number; balanceNote: string }
  | { ok: false; orderId: string; reason: string }
> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return { ok: false, orderId, reason: "order not found" };
  if (order.side !== "BUY") return { ok: false, orderId, reason: `refusing: not a BUY order (side=${order.side})` };
  if (order.status !== "FILLED") return { ok: false, orderId, reason: `refusing: not FILLED (status=${order.status})` };

  const token = await prisma.token.findUnique({ where: { id: order.tokenId } });
  if (!token) return { ok: false, orderId, reason: "token not found" };

  const tokenAmountNum = num(order.tokenAmount);
  const { net, creatorFee, platformFee } = splitFee(order.zecAmount);

  const newSold = Math.max(0, num(token.curveSoldTokens) - tokenAmountNum);
  const newReserve = Math.max(0, token.curveReserveZec - net);
  const newCreatorAccrued = Math.max(0, token.creatorFeeAccruedZec - creatorFee);
  const newPlatformTotal = Math.max(0, token.platformFeeTotalZec - platformFee);

  await prisma.token.update({
    where: { id: token.id },
    data: {
      curveSoldTokens: BigInt(Math.round(newSold)),
      curveReserveZec: newReserve,
      creatorFeeAccruedZec: newCreatorAccrued,
      platformFeeTotalZec: newPlatformTotal,
    },
  });

  let balanceNote = "ok";
  try {
    await debitBalance(order.internalWalletId, token.id, tokenAmountNum);
  } catch (err) {
    // The wallet may have already moved/sold some of the phantom tokens --
    // the curve/fee correction above still happened (that's the part that
    // actually matters for solvency); this is just a heads-up for manual
    // follow-up on that specific wallet.
    balanceNote = `balance NOT fully debited (curve/fees were still corrected): ${(err as Error).message}`;
  }

  await prisma.order.delete({ where: { id: orderId } });

  return { ok: true, orderId, symbol: token.symbol, tokenAmount: String(tokenAmountNum), netZecReversed: net, balanceNote };
}

// Brai, 2026-09-19: "esa WALLET no es mia la que vendio, ese monto se
// perdio ... que realices una venta FANTASMA tambien para compensar la
// cantidad de ZEC en la curva para que no haya otra venta con el precio
// inflado que se lleve ZEC que no existe" -- follow-up to
// reversePhantomBuyOrder above. Reversing the 24 phantom buy credits fixed
// the curve for the phantom volume that was NEVER real, but a separate,
// unrelated wallet (confirmed by Brai to not be his own) had already sold
// some of the phantom ZODD tokens it received and been paid REAL ZEC for
// them, while the curve was still inflated by that phantom volume. That ZEC
// genuinely left the platform's real Zcash wallet -- it cannot be recovered
// by running another real sell (a real sell only sends MORE real ZEC out,
// it never brings any back in). What can be fixed is that the curve's
// bookkeeping still claims to hold ZEC that no longer exists in the wallet,
// which would let a future real seller be quoted and paid against a
// shortfall. This function runs the curve side of exactly the trade that
// already happened -- inverting quoteSell's own constant-product formula to
// find how many tokens a real sell would have had to return to the curve to
// produce `zecAmount` of zecOut, then applies that same (tokensSold,
// realZecReserves) delta -- so price/marketcap stay internally consistent
// with the curve's own model instead of just subtracting a flat ZEC number.
// There is no real seller here, so unlike a real sell (or the phantom-buy
// reversal above) this never pays out ZEC and never touches any wallet
// balance -- it only corrects the two curve fields on Token.
export async function applyPhantomSellAdjustment(
  tokenId: string,
  zecAmount: number
): Promise<
  | {
      ok: true;
      tokenId: string;
      symbol: string;
      tokensRemovedFromSupply: string;
      zecRemovedFromReserve: number;
      reserveBefore: number;
      reserveAfter: number;
      priceBefore: number;
      priceAfter: number;
    }
  | { ok: false; reason: string }
> {
  if (!(zecAmount > 0)) return { ok: false, reason: "zecAmount must be > 0" };

  const token = await prisma.token.findUnique({ where: { id: tokenId } });
  if (!token) return { ok: false, reason: "token not found" };

  const state: CurveState = { realZecReserves: num(token.curveReserveZec), tokensSold: num(token.curveSoldTokens) };
  if (zecAmount > state.realZecReserves) {
    return { ok: false, reason: `zecAmount (${zecAmount}) exceeds current curveReserveZec (${state.realZecReserves})` };
  }

  const cfg = DEFAULT_CURVE_CONFIG;
  const zecBefore = cfg.virtualZecReserves + state.realZecReserves;
  const tokensBefore = cfg.virtualTokenReserves - state.tokensSold;
  const k = zecBefore * tokensBefore;

  // Inverse of quoteSell: given the zecOut we need, solve for tokensIn.
  const zecAfter = zecBefore - zecAmount;
  const tokensAfter = k / zecAfter;
  const tokensIn = tokensAfter - tokensBefore;

  if (!(tokensIn > 0) || tokensIn > state.tokensSold) {
    return { ok: false, reason: `computed tokensIn (${tokensIn}) is invalid against current tokensSold (${state.tokensSold})` };
  }

  const priceBefore = currentPrice(state, cfg);
  const newState: CurveState = {
    realZecReserves: Math.max(0, state.realZecReserves - zecAmount),
    tokensSold: Math.max(0, state.tokensSold - tokensIn),
  };
  const priceAfter = currentPrice(newState, cfg);

  await prisma.token.update({
    where: { id: token.id },
    data: {
      curveReserveZec: newState.realZecReserves,
      curveSoldTokens: BigInt(Math.round(newState.tokensSold)),
    },
  });

  return {
    ok: true,
    tokenId: token.id,
    symbol: token.symbol,
    tokensRemovedFromSupply: String(Math.round(tokensIn)),
    zecRemovedFromReserve: zecAmount,
    reserveBefore: state.realZecReserves,
    reserveAfter: newState.realZecReserves,
    priceBefore,
    priceAfter,
  };
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
  const [earned, nftEarned, withdrawn] = await Promise.all([
    prisma.token.aggregate({ _sum: { platformFeeTotalZec: true } }),
    // Brai, 2026-09-19: "el 1% de toda compra y venta de nft es para la
    // plataforma" -- summed in here alongside Token.platformFeeTotalZec so
    // it's withdrawable through the same existing admin flow, rather than
    // needing its own separate claim endpoint. Only FILLED orders ever get
    // a platformFeeZec set (see fillNftPurchase), so this never double
    // counts a still-pending purchase.
    prisma.nftPurchaseOrder.aggregate({ _sum: { platformFeeZec: true }, where: { status: "FILLED" } }),
    prisma.platformWithdrawal.aggregate({ _sum: { amountZec: true } }),
  ]);
  const totalEarnedZec = num(earned._sum.platformFeeTotalZec ?? 0) + num(nftEarned._sum.platformFeeZec ?? 0);
  const totalWithdrawnZec = num(withdrawn._sum.amountZec ?? 0);
  return { totalEarnedZec, totalWithdrawnZec, claimableZec: Math.max(0, totalEarnedZec - totalWithdrawnZec) };
}

/** Records one platform-fee withdrawal so it counts against the claimable
 * balance from then on (see getPlatformFeeStatus). */
export async function recordPlatformWithdrawal(amountZec: number, toAddress: string, txid: string | null) {
  await prisma.platformWithdrawal.create({ data: { amountZec, toAddress, txid } });
}

/** Brai, 2026-09-24: "puedes llevar la contabilidad de la venta de nfts?
 * para saber que monto se recaudo" -- gross ZEC actually collected from NFT
 * sales, across every collection. Deliberately separate from
 * getPlatformFeeStatus above: that one tracks the platform's own CUT
 * (1%/5%), this tracks the full amount that changed hands.
 *   - mintGrossZec: every CONFIRMED mint payment (PendingNftMint.status ===
 *     "CREATED" -- that status name is historical, it means "payment
 *     landed and pieces were claimed", see completePendingNftMint), which
 *     includes both full-price paid mints AND the small
 *     NFT_FREE_MINT_FEE_ZEC charged on a whitelist free claim (see its
 *     comment in fees.ts) -- both are real ZEC that arrived.
 *   - secondaryGrossZec/secondarySalesCount: every FILLED secondary-market
 *     purchase (same source getNftCollectionStats' volumeZec already
 *     reads, summed here across all collections instead of one).
 *   - platformFeeZec: the platform's own cut of all of the above (mint
 *     payments never carry a separate fee line -- the whole mint price IS
 *     the platform's, so this is really just the secondary-market 1%/5%,
 *     same number getPlatformFeeStatus's totalEarnedZec reports). */
export async function getNftSalesAccounting(): Promise<{
  mintGrossZec: number;
  mintCount: number;
  secondaryGrossZec: number;
  secondarySalesCount: number;
  platformFeeZec: number;
}> {
  const [mints, sales, feeStatus] = await Promise.all([
    prisma.pendingNftMint.aggregate({
      where: { status: "CREATED" },
      _sum: { expectedZecAmount: true },
      _count: true,
    }),
    prisma.nftPurchaseOrder.aggregate({
      where: { status: "FILLED" },
      _sum: { expectedZecAmount: true },
      _count: true,
    }),
    getPlatformFeeStatus(),
  ]);
  return {
    mintGrossZec: num(mints._sum.expectedZecAmount ?? 0),
    mintCount: mints._count,
    secondaryGrossZec: num(sales._sum.expectedZecAmount ?? 0),
    secondarySalesCount: sales._count,
    platformFeeZec: feeStatus.totalEarnedZec,
  };
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

// ZODD (2026-09-20, Brai: el egress de Railway no paraba de crecer
// "independientemente de cuanta gente esta entrando"): esta consulta no
// tenia limite -- devolvia TODOS los price points de un token desde que
// existe, y la pagina del token la pide entera cada 3 segundos (ver
// page.tsx). Cuantos mas trades tiene un token con el tiempo, mas grande se
// pone esta respuesta, para SIEMPRE, sin importar cuantos usuarios nuevos
// entren hoy -- justo el patron de "crece cada hora, no para de crecer"
// que Brai señalo. Tope duro a los ultimos 2000 puntos: de sobra para
// dibujar cualquiera de los intervalos del grafico (5m/15m/1h/4h/all, ver
// Chart.tsx), y ahora la respuesta tiene un techo real en vez de crecer sin
// limite.
const PRICE_HISTORY_MAX_POINTS = 2000;

export async function getPriceHistory(tokenId: string): Promise<PricePointView[]> {
  const points = await prisma.pricePoint.findMany({
    where: { tokenId },
    orderBy: { createdAt: "desc" },
    take: PRICE_HISTORY_MAX_POINTS,
  });
  points.reverse(); // back to ascending order, same as before
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
// Brai, 2026-09-25: "quiero que a partir del proximo mint, en LIVE ACTIVITY
// figure los mint y tambien los FORGE que hagan" -- a crafted piece
// (forgeCraft below) was already showing up here, just silently lumped in
// as a plain "MINT" (mintedAt gets set on both a real paid mint AND a
// forge craft) -- there was no way to tell them apart. Split it out by
// mintPaymentTxid === "FORGED" (forgeCraft's own marker, see its comment)
// so a forge shows as its own distinct event instead of looking like a
// real payment.
export type NftActivityKind = "MINT" | "FORGE" | "LIST" | "SALE";
export interface NftActivityView {
  kind: NftActivityKind;
  collectionSlug: string;
  editionNumber: number;
  tier: "PAPIRO" | "FRAGMENTO" | "RELIQUIA";
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
      select: {
        editionNumber: true,
        tier: true,
        name: true,
        mintedAt: true,
        mintPaymentTxid: true,
        collection: { select: { slug: true, mintPriceZec: true, currency: true } },
      },
    }),
    prisma.nftItem.findMany({
      where: { listedAt: { not: null } },
      orderBy: { listedAt: "desc" },
      take: perKind,
      select: { editionNumber: true, tier: true, name: true, listedAt: true, listedPriceZec: true, collection: { select: { slug: true, currency: true } } },
    }),
    prisma.nftPurchaseOrder.findMany({
      where: { status: "FILLED" },
      orderBy: { filledAt: "desc" },
      take: perKind,
      select: {
        filledAt: true,
        currency: true,
        expectedZecAmount: true,
        item: { select: { editionNumber: true, tier: true, name: true, collection: { select: { slug: true } } } },
      },
    }),
  ]);

  const rows: NftActivityView[] = [
    ...mints.map((m) => ({
      // Brai, 2026-09-25: a forge craft never charges ZEC (it burns pieces
      // instead -- see forgeCraft's mintPaymentTxid: "FORGED"), so it shows
      // priceZec 0 here rather than the collection's real mint price, which
      // would misleadingly suggest a payment happened.
      kind: (m.mintPaymentTxid === "FORGED" ? "FORGE" : "MINT") as const,
      collectionSlug: m.collection.slug,
      editionNumber: m.editionNumber,
      tier: m.tier,
      name: m.name,
      priceZec: m.mintPaymentTxid === "FORGED" ? 0 : num(m.collection.mintPriceZec),
      currency: m.collection.currency as Currency,
      createdAt: (m.mintedAt as Date).toISOString(),
    })),
    ...listings.map((l) => ({
      kind: "LIST" as const,
      collectionSlug: l.collection.slug,
      editionNumber: l.editionNumber,
      tier: l.tier,
      name: l.name,
      priceZec: num(l.listedPriceZec),
      currency: l.collection.currency as Currency,
      createdAt: (l.listedAt as Date).toISOString(),
    })),
    ...sales.map((s) => ({
      kind: "SALE" as const,
      collectionSlug: s.item.collection.slug,
      editionNumber: s.item.editionNumber,
      tier: s.item.tier,
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
  /** Brai, 2026-09-19: "LA PIRAMIDE" -- caller already ran
   * walletOwnsReliquia before reserving this. Carried through the payment
   * wait so completePendingTokenCreation can set it on the real Token. */
  isPyramidToken?: boolean;
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
      isPyramidToken: input.isPyramidToken ?? false,
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
    isPyramidToken: p.isPyramidToken,
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

  const graduated = state.realZecReserves >= graduationThresholdFor({ graduationZecThresholdOverride: token.graduationZecThresholdOverride != null ? num(token.graduationZecThresholdOverride) : null });
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

export type NftMintPhase = "locked" | "whitelist" | "public";

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
  whitelistStartsAt: string | null;
  publicStartsAt: string | null;
  /** Computed server-side (never trust a client clock): "locked" before
   * whitelistStartsAt (or if it's unset), "whitelist" from
   * whitelistStartsAt up to publicStartsAt, "public" from publicStartsAt
   * on. Owner wallets bypass this entirely at mint time -- see
   * isOwnerNftWallet in fees.ts -- so this reflects the gate a normal
   * wallet sees, not an absolute "is minting possible" flag. */
  mintPhase: NftMintPhase;
}

/** Brai, 2026-09-19: "la whitelist le activa en cierto horario y la
 * publica a partir de cierto horario" -- the phase a NORMAL (non-owner)
 * wallet is gated by right now. Exported so server.ts's /api/nft/mint can
 * reuse the exact same logic the view uses, instead of re-deriving it. */
export function mintPhaseAt(
  collection: { whitelistStartsAt: Date | string | null; publicStartsAt: Date | string | null },
  now: Date = new Date()
): NftMintPhase {
  const wl = collection.whitelistStartsAt ? new Date(collection.whitelistStartsAt) : null;
  const pub = collection.publicStartsAt ? new Date(collection.publicStartsAt) : null;
  if (!wl || now < wl) return "locked";
  if (!pub || now < pub) return "whitelist";
  return "public";
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
  whitelistStartsAt: Date | null;
  publicStartsAt: Date | null;
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
    whitelistStartsAt: c.whitelistStartsAt ? c.whitelistStartsAt.toISOString() : null,
    publicStartsAt: c.publicStartsAt ? c.publicStartsAt.toISOString() : null,
    mintPhase: mintPhaseAt(c),
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

/** Brai, 2026-09-19: "hagamos un test, la whitelist ahora ponela que se
 * pueda mintear a partir de las 13 horas utc -3, y la publica a partir de
 * las 14 horas utc -3" -- lets the presale schedule be set/changed from
 * the admin routes (POST /api/admin/nft-collection-schedule) without a
 * redeploy. Pass null for either field to clear that gate (e.g. "locked"
 * forever by clearing whitelistStartsAt, or "whitelist never ends" by
 * clearing publicStartsAt) -- undefined leaves it untouched.
 */
export async function setNftCollectionSchedule(
  slug: string,
  input: { whitelistStartsAt?: Date | null; publicStartsAt?: Date | null }
): Promise<NftCollectionView | null> {
  const existing = await prisma.nftCollection.findUnique({ where: { slug } });
  if (!existing) return null;
  const c = await prisma.nftCollection.update({
    where: { slug },
    data: {
      ...(input.whitelistStartsAt !== undefined ? { whitelistStartsAt: input.whitelistStartsAt } : {}),
      ...(input.publicStartsAt !== undefined ? { publicStartsAt: input.publicStartsAt } : {}),
    },
  });
  return toNftCollectionView(c);
}

/** Brai, 2026-09-19: "las wallet del publico mintean a 0.0025" -- lets the
 * collection's base mint price (what a non-owner, non-free-whitelist
 * wallet pays -- see nftMintPriceZecFor in fees.ts) be changed without a
 * full re-seed. The seed/reseed routes (seedNftCollectionFromManifest,
 * seedTieredNftCollection) also set mintPriceZec, but they touch the
 * whole collection/pool and are meant for first-time setup or a
 * deliberate wipe -- this is the narrow "just the price" knob for
 * afterwards. */
export async function setNftCollectionMintPrice(slug: string, mintPriceZec: number): Promise<NftCollectionView | null> {
  const existing = await prisma.nftCollection.findUnique({ where: { slug } });
  if (!existing) return null;
  const c = await prisma.nftCollection.update({ where: { slug }, data: { mintPriceZec } });
  return toNftCollectionView(c);
}

/** Brai, 2026-09-19: "pone un mensaje limite por cada wallet 10" -- total
 * pieces of `collectionId` this wallet has ever minted (free whitelist
 * claims + completed paid mints combined), used to enforce
 * NFT_MAX_MINTS_PER_WALLET in /api/nft/mint. Deliberately counts MINTS,
 * not current holdings -- selling a piece on the secondary market doesn't
 * free up room to mint another one. */
export async function getWalletNftMintCount(collectionId: string, walletId: string): Promise<number> {
  const paidCount = await prisma.pendingNftMint.count({
    where: { collectionId, internalWalletId: walletId, status: "CREATED" },
  });
  const whitelistEntry = await prisma.nftWhitelistEntry.findFirst({
    where: { claimedByWalletId: walletId },
    select: { claimedCount: true },
  });
  // Brai, 2026-09-19: "mintea a precio 0" -- an owner free mint (see
  // claimFreeOwnerNftMint) never creates a PendingNftMint row, so it has
  // to be counted separately. Its synthetic txid (`owner-free-<walletId>-`)
  // is the only record of it and stays put even if the piece is later sold
  // on the secondary market, so this stays accurate for "how many has this
  // wallet ever minted" regardless of what they still hold.
  const ownerFreeCount = await prisma.nftItem.count({
    where: { collectionId, mintPaymentTxid: { startsWith: `owner-free-${walletId}-` } },
  });
  return paidCount + (whitelistEntry?.claimedCount ?? 0) + ownerFreeCount;
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
  // Brai, 2026-09-19: "arriba donde dice MINTED tiene que decir SUPPLY, y
  // ahi tiene que contar el supply en tiempo real, a medida que la gente
  // forja y va quemando tier 1 para hacer tier 2 y tier 2 para hacer tier 3
  // ... el supply debe ir bajando" -- mintedCount only ever goes UP (it's a
  // lifetime counter of base mints, used for the per-wallet cap -- see
  // getWalletNftMintCount), so it can't be what SUPPLY shows. This is a
  // live count instead: every item that currently exists and hasn't been
  // burned (forgeCraft sets burnedAt on the pieces it consumes -- see its
  // comment), across all three tiers, including pieces forgeCraft itself
  // created. A craft burns N pieces to create 1, so aliveSupply drops by
  // (N-1) every time someone forges -- exactly the "va bajando" behavior.
  //
  // Brai, 2026-09-24: "cambie 5 tier 1 por 1 tier 2 y el supply no se
  // redujo... se reduce el minteado, el primer numero pero la idea es que
  // se reduzca el supply. o sea estaba 14/5555 y ahora dice 10/5555, yo
  // quiero que diga 14/5551 porque se han minteado pero tambien quemado" --
  // the opposite of what aliveSupply (above) does: he wants the FIRST
  // number (how many have ever been minted -- mintedCount) to stay put, and
  // the SECOND number (the denominator) to shrink by the net amount forging
  // destroys. burnedCount/forgedCount below are exactly what
  // serializeNftCollection (server.ts) needs to compute that adjusted
  // denominator as `totalSupply - burnedCount + forgedCount` without ever
  // touching NftCollection.totalSupply itself (that field stays the real
  // pre-seeded pool cap that /api/nft/mint's sold-out gate depends on --
  // shrinking IT would wrongly lock out pool pieces that were never
  // touched by forging at all).
  aliveSupply: number;
  burnedCount: number;
  forgedCount: number;
}> {
  const [floor, listedCount, sales, aliveSupply, burnedCount, forgedCount] = await Promise.all([
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
    prisma.nftItem.count({ where: { collectionId, mintedAt: { not: null }, burnedAt: null } }),
    prisma.nftItem.count({ where: { collectionId, burnedAt: { not: null } } }),
    prisma.nftItem.count({ where: { collectionId, mintPaymentTxid: "FORGED" } }),
  ]);
  return {
    floorZec: floor._min.listedPriceZec != null ? num(floor._min.listedPriceZec) : null,
    listedCount,
    salesCount: sales._count,
    volumeZec: num(sales._sum.expectedZecAmount ?? 0),
    aliveSupply,
    burnedCount,
    forgedCount,
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
  // Brai, 2026-09-19: forge tiers -- see NftTier's comment in schema.prisma.
  tier: "PAPIRO" | "FRAGMENTO" | "RELIQUIA";
  // Brai, 2026-09-24: see NftItem.reservedUntil's comment in schema.prisma.
  // Non-null AND in the future means "someone else is mid-purchase, don't
  // let a second buyer start another order for this piece right now" -- the
  // frontend computes that from this timestamp, no separate boolean needed.
  reservedUntil: string | null;
}

// Brai, 2026-09-19: "hace 5555 de supply con las 3 fotos... uno que sea
// tier 1, el otro tier 2 y el otro tier 3" -- pool-seeded pieces (see
// seedTieredNftCollection) don't carry their own imageDataUrl (that would
// mean 5555 copies of 3 images sitting in the DB); this is the shared
// per-tier fallback, resolved once per query and applied to every row that
// has no imageDataUrl of its own. Forged pieces (forgeCraft) don't set one
// either, so they fall back the same way.
//
// Brai, 2026-09-21: "los nfts seran esos videos que son loops" -- v2, each
// tier can now have several named video VARIANTS instead of one flat
// image (see NftCollection.papiroVariants et al). `default` is the old
// single-image fallback (kept for a tier with no variants configured);
// `variants` is looked up by NftItem.mediaVariantKey in toNftItemView.
export interface NftTierVariant {
  key: string;
  name: string;
  videoDataUrl: string;
}
export type NftTierMedia = {
  PAPIRO: { default: string | null; variants: NftTierVariant[] };
  FRAGMENTO: { default: string | null; variants: NftTierVariant[] };
  RELIQUIA: { default: string | null; variants: NftTierVariant[] };
};
/** @deprecated shape, kept as an alias so any external reference to the old
 * name still resolves -- prefer NftTierMedia in new code. */
export type NftTierImages = NftTierMedia;

function parseVariants(v: unknown): NftTierVariant[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (x): x is NftTierVariant => !!x && typeof x === "object" && typeof (x as any).key === "string" && typeof (x as any).videoDataUrl === "string"
  );
}

export async function getCollectionTierImages(collectionId: string): Promise<NftTierMedia> {
  const c = await prisma.nftCollection.findUnique({
    where: { id: collectionId },
    select: {
      papiroImageDataUrl: true,
      fragmentoImageDataUrl: true,
      reliquiaImageDataUrl: true,
      papiroVariants: true,
      fragmentoVariants: true,
      reliquiaVariants: true,
    },
  });
  return {
    PAPIRO: { default: c?.papiroImageDataUrl ?? null, variants: parseVariants(c?.papiroVariants) },
    FRAGMENTO: { default: c?.fragmentoImageDataUrl ?? null, variants: parseVariants(c?.fragmentoVariants) },
    RELIQUIA: { default: c?.reliquiaImageDataUrl ?? null, variants: parseVariants(c?.reliquiaVariants) },
  };
}

// Brai, 2026-09-21: the streaming media route (/api/nft/media/:key in
// server.ts) needs to go straight from a key to a video, without knowing
// which collection it belongs to -- so a variant's `key` is always built as
// `${collectionId}.${tier}.${slug}-${contentHash}` (see
// buildTieredVariants below) and this just splits it back apart, fetches
// THAT collection's tier variants, and finds the match. Returns null for
// any malformed/unknown key rather than throwing -- a bad/old cached URL
// should 404, not 500.
export async function getMediaVariantByKey(key: string): Promise<NftTierVariant | null> {
  const [collectionId, tier] = key.split(".");
  if (!collectionId || !tier || !["PAPIRO", "FRAGMENTO", "RELIQUIA"].includes(tier)) return null;
  const media = await getCollectionTierImages(collectionId);
  const variant = media[tier as keyof NftTierMedia].variants.find((v) => v.key === key);
  return variant ?? null;
}

// Brai, 2026-09-21: PUBLIC_BACKEND_URL is how a variant's key turns into an
// actual fetchable URL for a <video> tag -- see server.ts, same env var
// used by the /api/nft/media/:key route it points at. Falls back to
// NEXT_PUBLIC_API_URL's value if that's ever set here too (same underlying
// backend), and finally to the known production domain so this never
// silently emits a broken relative path.
const PUBLIC_BACKEND_URL = (process.env.PUBLIC_BACKEND_URL ?? process.env.BACKEND_PUBLIC_URL ?? "https://backend-production-e195.up.railway.app").replace(/\/$/, "");

function toNftItemView(
  i: {
    id: string;
    collectionId: string;
    editionNumber: number;
    name: string | null;
    imageDataUrl: string | null;
    mediaVariantKey?: string | null;
    traits: unknown;
    mintedAt: Date | null;
    mintPaymentTxid: string | null;
    ownerInternalWalletId: string | null;
    ownerInternalWallet?: { walletTag: string } | null;
    listedPriceZec: unknown;
    listedAt: Date | null;
    listedPayoutAddress: string | null;
    tier: string;
    reservedUntil?: Date | null;
  },
  tierImages?: NftTierMedia
): NftItemView {
  const tierEntry = tierImages ? tierImages[i.tier as keyof NftTierMedia] : undefined;
  const variant = i.mediaVariantKey ? tierEntry?.variants.find((v) => v.key === i.mediaVariantKey) : undefined;
  // Brai, 2026-09-21: a variant resolves to a small STREAMING URL
  // (/api/nft/media/:key), never the raw base64 video itself -- inlining a
  // multi-MB data: URL on every item of a 48-item listing page would balloon
  // that one response to hundreds of MB. The old single-image tier fallback
  // (tierEntry.default) is still a real small data: URL, inlined directly,
  // same as always -- only video variants get the URL treatment.
  const resolvedImage = i.imageDataUrl ?? (variant ? `${PUBLIC_BACKEND_URL}/api/nft/media/${encodeURIComponent(variant.key)}` : (tierEntry?.default ?? null));
  return {
    id: i.id,
    collectionId: i.collectionId,
    editionNumber: i.editionNumber,
    name: i.name,
    imageDataUrl: resolvedImage,
    traits: i.traits ?? null,
    mintedAt: i.mintedAt ? i.mintedAt.toISOString() : null,
    mintPaymentTxid: i.mintPaymentTxid,
    ownerInternalWalletId: i.ownerInternalWalletId,
    ownerWalletTag: i.ownerInternalWallet?.walletTag ?? null,
    listedPriceZec: i.listedPriceZec != null ? num(i.listedPriceZec) : null,
    listedAt: i.listedAt ? i.listedAt.toISOString() : null,
    listedPayoutAddress: i.listedPayoutAddress,
    tier: i.tier as NftItemView["tier"],
    reservedUntil: i.reservedUntil ? i.reservedUntil.toISOString() : null,
  };
}

export async function listNftItems(
  collectionId: string,
  opts: {
    status?: "listed" | "not_listed" | "all";
    ownerWalletId?: string;
    sort?: "price_asc" | "price_desc" | "edition";
    page?: number;
    pageSize?: number;
  } = {}
): Promise<{ items: NftItemView[]; total: number }> {
  const pageSize = Math.min(opts.pageSize ?? 48, 100);
  const page = Math.max(opts.page ?? 1, 1);
  // Brai, 2026-09-19: a burned piece (fed into the forge, see forgeCraft)
  // never shows up in the marketplace again, same as Token.hidden dropping
  // a token out of every public listing while keeping its row for history.
  const where: Record<string, unknown> = { collectionId, burnedAt: null };
  if (opts.status === "listed") where.listedPriceZec = { not: null };
  // Brai, 2026-09-19 (v14): "Not listed" chip on the Items tab (copying
  // zecbit.net) -- deliberately includes not-yet-minted pieces too, same as
  // "All" already does elsewhere on this page; an unminted piece is,
  // definitionally, not listed for sale either.
  if (opts.status === "not_listed") where.listedPriceZec = null;
  if (opts.ownerWalletId) where.ownerInternalWalletId = opts.ownerWalletId;
  const orderBy =
    opts.sort === "price_desc"
      ? [{ listedPriceZec: "desc" as const }]
      : opts.sort === "price_asc"
        ? [{ listedPriceZec: "asc" as const }]
        : [{ editionNumber: "asc" as const }];
  const [rows, total, tierImages] = await Promise.all([
    prisma.nftItem.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { ownerInternalWallet: { select: { walletTag: true } } },
    }),
    prisma.nftItem.count({ where }),
    getCollectionTierImages(collectionId),
  ]);
  return { items: rows.map((r) => toNftItemView(r, tierImages)), total };
}

// Brai, 2026-09-19 (v14): powers the new Traits tab on /nft/test (copying
// zecbit.net's Items-tab sidebar, but as its own tab per Brai's "varias
// solapas" ask). Aggregated server-side with jsonb_each_text rather than
// paging through every NftItem client-side -- the current test collection
// has 3 pieces, but this needs to still be correct (and fast) once it's a
// real 3000+ piece collection.
export interface NftTraitCount {
  trait: string;
  value: string;
  count: number;
}

export async function getNftTraitCounts(collectionId: string): Promise<NftTraitCount[]> {
  const rows = await prisma.$queryRaw<{ trait: string; value: string; count: bigint }[]>`
    SELECT kv.key AS trait, kv.value AS value, count(*)::bigint AS count
    FROM "NftItem", jsonb_each_text(traits) AS kv(key, value)
    WHERE "collectionId" = ${collectionId} AND traits IS NOT NULL
    GROUP BY kv.key, kv.value
    ORDER BY kv.key ASC, count DESC
  `;
  return rows.map((r) => ({ trait: r.trait, value: r.value, count: Number(r.count) }));
}

// Brai, 2026-09-19: editionNumber is scoped per tier now (see
// NftItem.editionNumber's comment) -- "TIER 1 #1321" and "TIER 2 #1321" can
// both exist, so a lookup needs the tier too, not just the number.
export async function getNftItemByEdition(
  collectionId: string,
  tier: "PAPIRO" | "FRAGMENTO" | "RELIQUIA",
  editionNumber: number
): Promise<NftItemView | null> {
  const [i, tierImages] = await Promise.all([
    prisma.nftItem.findUnique({
      where: { collectionId_tier_editionNumber: { collectionId, tier, editionNumber } },
      include: { ownerInternalWallet: { select: { walletTag: true } } },
    }),
    getCollectionTierImages(collectionId),
  ]);
  return i ? toNftItemView(i, tierImages) : null;
}

export async function getNftItemById(id: string): Promise<NftItemView | null> {
  const i = await prisma.nftItem.findUnique({
    where: { id },
    include: { ownerInternalWallet: { select: { walletTag: true } } },
  });
  if (!i) return null;
  const tierImages = await getCollectionTierImages(i.collectionId);
  return toNftItemView(i, tierImages);
}

export async function getWalletNfts(walletId: string): Promise<NftItemView[]> {
  const rows = await prisma.nftItem.findMany({
    where: { ownerInternalWalletId: walletId, burnedAt: null },
    orderBy: { mintedAt: "desc" },
    include: { ownerInternalWallet: { select: { walletTag: true } } },
  });
  // Brai, 2026-09-19: a wallet's pieces can in principle span more than one
  // collection, so this resolves each row's tier image against its OWN
  // collection rather than assuming a single one.
  const collectionIds: string[] = Array.from(new Set(rows.map((r) => r.collectionId)));
  const tierImagesEntries = await Promise.all(
    collectionIds.map(async (id): Promise<[string, NftTierImages]> => [id, await getCollectionTierImages(id)])
  );
  const tierImagesByCollection = new Map<string, NftTierImages>(tierImagesEntries);
  return rows.map((r) => toNftItemView(r, tierImagesByCollection.get(r.collectionId)));
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
    // burnedAt: null -- a piece fed into the forge (see forgeCraft) can
    // never be re-listed, even though its row (and its owner) still exist.
    where: { id: itemId, ownerInternalWalletId: walletId, burnedAt: null },
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

// ---------- Forge: papiros -> fragmentos -> reliquias ----------
// Brai, 2026-09-19: "si tenes 5 papiros podes crear 1 fragmento, si tenes 3
// fragmentos podes crear una reliquia". A tier-based pool seeded by
// seedTieredNftCollection can mint FRAGMENTO/RELIQUIA pieces directly too
// (claimRandomUnmintedNftItem just claims whatever tier a row already has)
// -- crafting here is an additional way to get there, not the only one.
export const FORGE_RECIPES: Record<"PAPIRO" | "FRAGMENTO", { toTier: "FRAGMENTO" | "RELIQUIA"; count: number }> = {
  PAPIRO: { toTier: "FRAGMENTO", count: 5 },
  FRAGMENTO: { toTier: "RELIQUIA", count: 3 },
};

/** How many not-listed, already-minted pieces of each tier this wallet
 * actually has available to feed into the forge, in this collection.
 * Deliberately excludes listed pieces (see forgeCraft's comment) and
 * burned ones (already spent). */
export async function getForgeInventory(walletId: string, collectionId: string): Promise<{ papiro: number; fragmento: number; reliquia: number }> {
  const rows = await prisma.nftItem.groupBy({
    by: ["tier"],
    where: { collectionId, ownerInternalWalletId: walletId, burnedAt: null, listedPriceZec: null, mintedAt: { not: null } },
    _count: { _all: true },
  });
  const counts = { papiro: 0, fragmento: 0, reliquia: 0 };
  for (const r of rows as { tier: string; _count: { _all: number } }[]) {
    if (r.tier === "PAPIRO") counts.papiro = r._count._all;
    else if (r.tier === "FRAGMENTO") counts.fragmento = r._count._all;
    else if (r.tier === "RELIQUIA") counts.reliquia = r._count._all;
  }
  return counts;
}

// Brai, 2026-09-19: "balancea para que haya 300 personas que tengan
// reliquia incluyendo los que puedan forjar... 300 reliquias en total
// maximo" -- a hard, permanent ceiling on how many non-burned TIER 3
// (RELIQUIA) pieces can ever exist in a collection, counting BOTH the ones
// seeded directly by seedTieredNftCollection AND the ones forged here.
// Checked live (a plain COUNT) inside the same transaction as the burn, so
// once the cap is hit the FRAGMENTO->RELIQUIA craft simply stops working --
// nothing is burned, the wallet keeps its fragmentos, same as any other
// "didn't work, nothing changed" rejection in this file.
export const RELIQUIA_MAX_SUPPLY = 300;

export type ForgeCraftResult = { ok: true; item: NftItemView } | { ok: false; reason: "insufficient" | "cap_reached" };

/**
 * Burns FORGE_RECIPES[fromTier].count pieces of fromTier owned by this
 * wallet (unlisted, already-minted, not already burned) and mints exactly
 * one brand-new piece of the next tier up, owned by the same wallet.
 * Returns { ok: false, reason: "insufficient" } when the wallet doesn't have
 * enough eligible pieces, or { ok: false, reason: "cap_reached" } when
 * crafting into RELIQUIA would exceed RELIQUIA_MAX_SUPPLY (same "didn't
 * work, nothing changed" convention as listNftForSale/unlistNft returning
 * null on a failed owner check -- just discriminated here since the two
 * rejection reasons need different messages, see the /forge/craft route).
 *
 * Race-safe the same way fillNftPurchase is: the burn is a single
 * conditional UPDATE (WHERE id IN (...) AND burnedAt IS NULL) inside a
 * transaction, so if two requests somehow raced for the exact same rows,
 * whichever commits first wins and the loser's updateMany.count comes back
 * short -- caught below and turned into a clean rollback + "insufficient",
 * instead of ever burning fewer than the full recipe count or minting
 * without a full burn to back it.
 */
export async function forgeCraft(walletId: string, collectionId: string, fromTier: "PAPIRO" | "FRAGMENTO"): Promise<ForgeCraftResult> {
  const recipe = FORGE_RECIPES[fromTier];
  try {
    return await prisma.$transaction(async (tx) => {
      if (recipe.toTier === "RELIQUIA") {
        const existingReliquias = await tx.nftItem.count({ where: { collectionId, tier: "RELIQUIA", burnedAt: null } });
        if (existingReliquias >= RELIQUIA_MAX_SUPPLY) {
          return { ok: false, reason: "cap_reached" } as const;
        }
      }
      const candidates = await tx.nftItem.findMany({
        where: { collectionId, ownerInternalWalletId: walletId, tier: fromTier, burnedAt: null, listedPriceZec: null, mintedAt: { not: null } },
        take: recipe.count,
        select: { id: true },
      });
      if (candidates.length < recipe.count) return { ok: false, reason: "insufficient" } as const;
      const ids = candidates.map((c) => c.id);
      const burned = await tx.nftItem.updateMany({
        where: { id: { in: ids }, ownerInternalWalletId: walletId, burnedAt: null },
        data: { burnedAt: new Date() },
      });
      if (burned.count !== recipe.count) {
        throw new Error("__forge_race_lost__");
      }
      // Crafted pieces aren't part of the collection's pre-seeded pool (see
      // NftItem.editionNumber's comment), so they get their own edition
      // number continuing past whatever that TIER's pool highest number is
      // -- each tier keeps its own counter, so a crafted FRAGMENTO piece
      // never jumps into RELIQUIA's or PAPIRO's number range.
      const agg = await tx.nftItem.aggregate({ where: { collectionId, tier: recipe.toTier }, _max: { editionNumber: true } });
      const nextEdition = (agg._max.editionNumber ?? NFT_TIER_NUMBERING_START - 1) + 1;
      // Brai, 2026-09-21: a crafted piece should look like it belongs to the
      // same named-relic pool as everything else, not a generic "TIER X
      // #N" -- so it gets a uniformly-random variant of its target tier too
      // (same as a directly-seeded piece), falling back to the old generic
      // name only for a collection with no variants configured on that
      // tier yet (e.g. still on the single-shared-image scheme).
      const tierImages = await getCollectionTierImages(collectionId);
      const targetVariants = tierImages[recipe.toTier].variants;
      const variant = targetVariants.length ? targetVariants[Math.floor(Math.random() * targetVariants.length)] : null;
      const created = await tx.nftItem.create({
        data: {
          collectionId,
          editionNumber: nextEdition,
          name: variant ? `${variant.name} #${nextEdition}` : `${recipe.toTier === "FRAGMENTO" ? "TIER 2" : "TIER 3"} #${nextEdition}`,
          mediaVariantKey: variant?.key ?? null,
          tier: recipe.toTier,
          mintedAt: new Date(),
          mintPaymentTxid: "FORGED",
          ownerInternalWalletId: walletId,
        },
        include: { ownerInternalWallet: { select: { walletTag: true } } },
      });
      return { ok: true, item: toNftItemView(created, tierImages) } as const;
    });
  } catch (err) {
    if (err instanceof Error && err.message === "__forge_race_lost__") return { ok: false, reason: "insufficient" };
    throw err;
  }
}

/**
 * Brai, 2026-09-25: "resetea la plataforma de nfts a cero. O sea borra
 * todos los minteados y empezamos de nuevo. NO BORRES NINGUN TOKEN DE LOS
 * CREADOS, SOLO NFT" -- clears every mint/listing/reservation on the
 * collection's pre-seeded pool (seedTieredNftCollectionWithVariants) so it
 * goes back to fully unminted, WITHOUT re-seeding: editionNumbers, tiers,
 * and each piece's video variant assignment (mediaVariantKey) all stay
 * exactly as they were, so nothing needs to be re-uploaded.
 *
 * A forged piece (forgeCraft above) is NOT part of that pre-seeded pool --
 * it's a brand-new row created on craft, continuing that tier's edition
 * counter past the pool's range -- so "reset to zero" deletes those
 * outright instead of un-forging them back into their burned ingredients
 * (there's no way to know which pieces were burned to make a given forged
 * piece once this runs).
 *
 * Deliberately narrow: never touches NftWhitelistEntry/NftWhitelistPreapproved
 * (the real applications/approvals -- needed for tomorrow's actual launch)
 * and never touches anything outside the Nft* models (Token/Order/Balance
 * -- an entirely separate feature, explicitly not to be touched here).
 */
export async function resetNftMints(slug: string): Promise<{
  itemsReset: number;
  forgedItemsDeleted: number;
  mintsDeleted: number;
  purchasesDeleted: number;
} | null> {
  const collection = await prisma.nftCollection.findUnique({ where: { slug } });
  if (!collection) return null;

  const allItemIds = (
    await prisma.nftItem.findMany({ where: { collectionId: collection.id }, select: { id: true } })
  ).map((r) => r.id);
  const forgedItemIds = (
    await prisma.nftItem.findMany({
      where: { collectionId: collection.id, mintPaymentTxid: "FORGED" },
      select: { id: true },
    })
  ).map((r) => r.id);

  const [purchasesDel, mintsDel, itemsUpdate, forgedDel] = await prisma.$transaction([
    // Purchase orders reference NftItem by FK -- delete them first (covers
    // both pool pieces we're about to reset AND forged pieces we're about
    // to delete outright) so nothing is left dangling either way.
    prisma.nftPurchaseOrder.deleteMany({ where: { itemId: { in: allItemIds } } }),
    prisma.pendingNftMint.deleteMany({ where: { collectionId: collection.id } }),
    prisma.nftItem.updateMany({
      where: { collectionId: collection.id, mintPaymentTxid: { not: "FORGED" } },
      data: {
        ownerInternalWalletId: null,
        mintedAt: null,
        mintPaymentTxid: null,
        listedPriceZec: null,
        listedAt: null,
        listedPayoutAddress: null,
        reservedUntil: null,
        reservedByOrderId: null,
        burnedAt: null,
      },
    }),
    prisma.nftItem.deleteMany({ where: { id: { in: forgedItemIds } } }),
  ]);
  await prisma.nftCollection.update({ where: { id: collection.id }, data: { mintedCount: 0 } });

  return {
    itemsReset: itemsUpdate.count,
    forgedItemsDeleted: forgedDel.count,
    mintsDeleted: mintsDel.count,
    purchasesDeleted: purchasesDel.count,
  };
}

/** Gate for LA PIRAMIDE (see createPendingTokenCreation's isPyramidToken):
 * "tener la reliquia hace que tengas el privilegio de entrar" -- checked
 * live off current ownership, not a one-time unlock, so selling your only
 * reliquia closes the door again (per Brai's choice on this). */
export async function walletOwnsReliquia(walletId: string): Promise<boolean> {
  const found = await prisma.nftItem.findFirst({
    where: { ownerInternalWalletId: walletId, tier: "RELIQUIA", burnedAt: null },
    select: { id: true },
  });
  return found != null;
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
    // Brai, 2026-09-19: this manifest path has no tier concept (single-tier
    // collections only) -- items land as PAPIRO, same as NftItem.tier's
    // schema default, so the lookup key needs that explicit tier now that
    // editionNumber is scoped per tier (see NftItem.editionNumber's comment).
    const existing = await prisma.nftItem.findUnique({
      where: { collectionId_tier_editionNumber: { collectionId: collection.id, tier: "PAPIRO", editionNumber: item.editionNumber } },
    });
    if (existing?.ownerInternalWalletId) {
      skippedMinted++;
      continue; // already minted -- never overwrite a piece someone owns
    }
    await prisma.nftItem.upsert({
      where: { collectionId_tier_editionNumber: { collectionId: collection.id, tier: "PAPIRO", editionNumber: item.editionNumber } },
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

// Brai, 2026-09-19: "hace 5555 de supply con las 3 fotos que te di... 60%
// tier1, 35% tier2, 5% tier3, calcula para que haya 300 reliquias en total
// maximo. borra todo y resembra de cero" -- a tier-based sibling of
// seedNftCollectionFromManifest above, for a collection whose pieces share
// one image per tier instead of a unique image each (see the tier-image
// fields on NftCollection). Wipes the collection's existing pieces (and
// anything referencing them) first when wipeExisting is true, then bulk-
// inserts totalSupply rows with no per-row imageDataUrl -- they resolve
// through getCollectionTierImages at read time instead.
export interface TieredSeedInput {
  slug: string;
  name: string;
  description?: string | null;
  currency?: "ZEC" | "YEC";
  mintPriceZec: number;
  papiroImageDataUrl: string;
  fragmentoImageDataUrl: string;
  reliquiaImageDataUrl: string;
  tier1Count: number;
  tier2Count: number;
  tier3Count: number;
  wipeExisting: boolean;
}

export async function seedTieredNftCollection(
  input: TieredSeedInput
): Promise<{ collectionId: string; totalSupply: number; wipedItems: number }> {
  if (!input.slug || !input.name) throw new Error("slug and name are required");
  if (!(input.mintPriceZec > 0)) throw new Error("mintPriceZec must be a positive number");
  for (const [k, v] of Object.entries({ tier1Count: input.tier1Count, tier2Count: input.tier2Count, tier3Count: input.tier3Count })) {
    if (!Number.isInteger(v) || v < 0) throw new Error(`${k} must be a non-negative integer`);
  }
  // RELIQUIA_MAX_SUPPLY (see forgeCraft) is a ceiling on RELIQUIA pieces in
  // existence at once, counting direct-mint ones too -- a manifest that
  // seeds more than that directly would make the "300 max" promise false
  // from the moment this runs, before a single craft happens.
  if (input.tier3Count > RELIQUIA_MAX_SUPPLY) {
    throw new Error(`tier3Count (${input.tier3Count}) can't exceed RELIQUIA_MAX_SUPPLY (${RELIQUIA_MAX_SUPPLY})`);
  }
  if (!input.papiroImageDataUrl || !input.fragmentoImageDataUrl || !input.reliquiaImageDataUrl) {
    throw new Error("papiroImageDataUrl, fragmentoImageDataUrl and reliquiaImageDataUrl are all required");
  }

  const totalSupply = input.tier1Count + input.tier2Count + input.tier3Count;
  if (totalSupply <= 0) throw new Error("tier1Count + tier2Count + tier3Count must be greater than zero");

  const collection = await prisma.nftCollection.upsert({
    where: { slug: input.slug },
    create: {
      slug: input.slug,
      name: input.name,
      description: input.description ?? null,
      currency: input.currency ?? "ZEC",
      totalSupply,
      mintPriceZec: input.mintPriceZec,
      papiroImageDataUrl: input.papiroImageDataUrl,
      fragmentoImageDataUrl: input.fragmentoImageDataUrl,
      reliquiaImageDataUrl: input.reliquiaImageDataUrl,
      hidden: true,
      mintedCount: 0,
    },
    update: {
      name: input.name,
      description: input.description ?? null,
      currency: input.currency ?? undefined,
      totalSupply,
      mintPriceZec: input.mintPriceZec,
      papiroImageDataUrl: input.papiroImageDataUrl,
      fragmentoImageDataUrl: input.fragmentoImageDataUrl,
      reliquiaImageDataUrl: input.reliquiaImageDataUrl,
      mintedCount: 0,
    },
  });

  let wipedItems = 0;
  if (input.wipeExisting) {
    const existing = await prisma.nftItem.findMany({ where: { collectionId: collection.id }, select: { id: true } });
    const ids = existing.map((r) => r.id);
    if (ids.length) {
      // NftPurchaseOrder.item is a real FK (RESTRICT) -- has to go before
      // the items themselves, or the delete below fails outright.
      await prisma.nftPurchaseOrder.deleteMany({ where: { itemId: { in: ids } } });
    }
    await prisma.pendingNftMint.deleteMany({ where: { collectionId: collection.id } });
    const del = await prisma.nftItem.deleteMany({ where: { collectionId: collection.id } });
    wipedItems = del.count;
  }

  // Brai, 2026-09-19: "todos sigan un numero tipo TIER 1 #1321" -- each
  // tier gets its OWN counter starting at NFT_TIER_NUMBERING_START, instead
  // of one counter running across all three tiers back to back (which used
  // to put FRAGMENTO/RELIQUIA up in the thousands while PAPIRO started at 1).
  const rows: { collectionId: string; editionNumber: number; tier: "PAPIRO" | "FRAGMENTO" | "RELIQUIA"; name: string }[] = [];
  let papiroEdition = NFT_TIER_NUMBERING_START;
  let fragmentoEdition = NFT_TIER_NUMBERING_START;
  let reliquiaEdition = NFT_TIER_NUMBERING_START;
  for (let i = 0; i < input.tier1Count; i++) {
    rows.push({ collectionId: collection.id, editionNumber: papiroEdition, tier: "PAPIRO", name: `TIER 1 #${papiroEdition}` });
    papiroEdition++;
  }
  for (let i = 0; i < input.tier2Count; i++) {
    rows.push({ collectionId: collection.id, editionNumber: fragmentoEdition, tier: "FRAGMENTO", name: `TIER 2 #${fragmentoEdition}` });
    fragmentoEdition++;
  }
  for (let i = 0; i < input.tier3Count; i++) {
    rows.push({ collectionId: collection.id, editionNumber: reliquiaEdition, tier: "RELIQUIA", name: `TIER 3 #${reliquiaEdition}` });
    reliquiaEdition++;
  }

  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await prisma.nftItem.createMany({ data: rows.slice(i, i + CHUNK) });
  }

  return { collectionId: collection.id, totalSupply, wipedItems };
}

// Brai, 2026-09-21: "los nfts seran esos videos que son loops... invéntale
// el nombre en base a la historia de ZODD y las reliquias" -- v2 of
// seedTieredNftCollection above: instead of exactly one shared image per
// tier, each tier gets a small POOL of named video variants (papiro 1,
// fragmento 3, reliquia 5 in the first real use of this), and every seeded
// piece is randomly assigned one variant of its own tier at seed time --
// its display name becomes "<variant lore name> #<editionNumber>" instead
// of the generic "TIER X #NNNN". Sibling function, not a replacement:
// seedTieredNftCollection (single image per tier) stays for a collection
// that doesn't need per-piece variety.
export interface TieredVariantInput {
  name: string;
  videoDataUrl: string; // data:video/mp4;base64,... -- a LOOPING clip, muted client-side regardless of whether it has an audio track (see the <video> rendering in frontend/lib/nftMedia.tsx)
  // md5 of videoDataUrl computed on the source side -- optional, but should
  // always be sent for anything this size (a multi-MB payload silently
  // corrupted in transit is exactly the incident that produced
  // updateNftCollectionTierImage below, and it's far more likely with video
  // than it was with the small images that first triggered it).
  expectedMd5?: string;
}

export interface TieredSeedWithVariantsInput {
  slug: string;
  name: string;
  description?: string | null;
  currency?: "ZEC" | "YEC";
  mintPriceZec: number;
  papiroVariants: TieredVariantInput[];
  fragmentoVariants: TieredVariantInput[];
  reliquiaVariants: TieredVariantInput[];
  tier1Count: number;
  tier2Count: number;
  tier3Count: number;
  wipeExisting: boolean;
}

function slugifyVariantName(name: string, fallbackIndex: number): string {
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents (á->a etc.) -- key is used in a URL path
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
  return slug || `variant-${fallbackIndex}`;
}

/** Validates + hashes a tier's variant inputs into stored NftTierVariant
 * rows. Throws (aborting the whole reseed -- see the transaction below) on
 * an empty payload or an md5 mismatch, rather than silently writing a
 * corrupted or blank video for anyone to mint. `key` embeds the first 8
 * hex chars of the content hash so a later reseed that changes a variant's
 * video always gets a fresh URL -- no stale browser/CDN cache of the old
 * clip under the same key. */
export function buildTierVariants(collectionId: string, tier: "PAPIRO" | "FRAGMENTO" | "RELIQUIA", inputs: TieredVariantInput[]): NftTierVariant[] {
  return inputs.map((v, idx) => {
    if (!v.name?.trim()) throw new Error(`${tier} variant #${idx + 1} is missing a name`);
    if (!v.videoDataUrl || !v.videoDataUrl.startsWith("data:video/")) {
      throw new Error(`${tier} variant "${v.name}" must be a data:video/... URL`);
    }
    const hash = createHash("md5").update(v.videoDataUrl).digest("hex");
    if (v.expectedMd5 && v.expectedMd5.toLowerCase() !== hash) {
      throw new Error(
        `${tier} variant "${v.name}" failed its md5 check (expected ${v.expectedMd5}, computed ${hash}) -- the video got corrupted on the way here, don't retry blindly, re-send it`
      );
    }
    const slug = slugifyVariantName(v.name, idx + 1);
    return { key: `${collectionId}.${tier}.${slug}-${hash.slice(0, 8)}`, name: v.name.trim(), videoDataUrl: v.videoDataUrl };
  });
}

export async function seedTieredNftCollectionWithVariants(
  input: TieredSeedWithVariantsInput
): Promise<{ collectionId: string; totalSupply: number; wipedItems: number; variantCounts: { PAPIRO: number; FRAGMENTO: number; RELIQUIA: number } }> {
  if (!input.slug || !input.name) throw new Error("slug and name are required");
  if (!(input.mintPriceZec > 0)) throw new Error("mintPriceZec must be a positive number");
  for (const [k, v] of Object.entries({ tier1Count: input.tier1Count, tier2Count: input.tier2Count, tier3Count: input.tier3Count })) {
    if (!Number.isInteger(v) || v < 0) throw new Error(`${k} must be a non-negative integer`);
  }
  if (input.tier3Count > RELIQUIA_MAX_SUPPLY) {
    throw new Error(`tier3Count (${input.tier3Count}) can't exceed RELIQUIA_MAX_SUPPLY (${RELIQUIA_MAX_SUPPLY})`);
  }
  if (input.tier1Count > 0 && !input.papiroVariants?.length) throw new Error("papiroVariants can't be empty when tier1Count > 0");
  if (input.tier2Count > 0 && !input.fragmentoVariants?.length) throw new Error("fragmentoVariants can't be empty when tier2Count > 0");
  if (input.tier3Count > 0 && !input.reliquiaVariants?.length) throw new Error("reliquiaVariants can't be empty when tier3Count > 0");

  const totalSupply = input.tier1Count + input.tier2Count + input.tier3Count;
  if (totalSupply <= 0) throw new Error("tier1Count + tier2Count + tier3Count must be greater than zero");

  // Upsert first (without variants -- those embed the collection's OWN id
  // in their key, so they can only be built once we know it) so both a
  // brand-new slug and an existing one land on the same collection.id
  // either way.
  const collection = await prisma.nftCollection.upsert({
    where: { slug: input.slug },
    create: {
      slug: input.slug,
      name: input.name,
      description: input.description ?? null,
      currency: input.currency ?? "ZEC",
      totalSupply,
      mintPriceZec: input.mintPriceZec,
      hidden: true,
      mintedCount: 0,
    },
    update: {
      name: input.name,
      description: input.description ?? null,
      currency: input.currency ?? undefined,
      totalSupply,
      mintPriceZec: input.mintPriceZec,
      mintedCount: 0,
    },
  });

  const papiroVariants = buildTierVariants(collection.id, "PAPIRO", input.papiroVariants ?? []);
  const fragmentoVariants = buildTierVariants(collection.id, "FRAGMENTO", input.fragmentoVariants ?? []);
  const reliquiaVariants = buildTierVariants(collection.id, "RELIQUIA", input.reliquiaVariants ?? []);

  await prisma.nftCollection.update({
    where: { id: collection.id },
    data: {
      papiroVariants: papiroVariants as unknown as object,
      fragmentoVariants: fragmentoVariants as unknown as object,
      reliquiaVariants: reliquiaVariants as unknown as object,
    },
  });

  let wipedItems = 0;
  if (input.wipeExisting) {
    const existing = await prisma.nftItem.findMany({ where: { collectionId: collection.id }, select: { id: true } });
    const ids = existing.map((r) => r.id);
    if (ids.length) {
      await prisma.nftPurchaseOrder.deleteMany({ where: { itemId: { in: ids } } });
    }
    await prisma.pendingNftMint.deleteMany({ where: { collectionId: collection.id } });
    const del = await prisma.nftItem.deleteMany({ where: { collectionId: collection.id } });
    wipedItems = del.count;
  }

  // Brai, 2026-09-19 (carried over): each tier keeps its own edition
  // counter starting at NFT_TIER_NUMBERING_START. Every piece gets a
  // uniformly-random variant of its own tier -- not round-robin -- so the
  // mix feels organic across a 3000+ piece pool instead of a visible
  // repeating pattern every N items.
  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  const rows: { collectionId: string; editionNumber: number; tier: "PAPIRO" | "FRAGMENTO" | "RELIQUIA"; name: string; mediaVariantKey: string }[] = [];
  let papiroEdition = NFT_TIER_NUMBERING_START;
  let fragmentoEdition = NFT_TIER_NUMBERING_START;
  let reliquiaEdition = NFT_TIER_NUMBERING_START;
  for (let i = 0; i < input.tier1Count; i++) {
    const v = pick(papiroVariants);
    rows.push({ collectionId: collection.id, editionNumber: papiroEdition, tier: "PAPIRO", name: `${v.name} #${papiroEdition}`, mediaVariantKey: v.key });
    papiroEdition++;
  }
  for (let i = 0; i < input.tier2Count; i++) {
    const v = pick(fragmentoVariants);
    rows.push({ collectionId: collection.id, editionNumber: fragmentoEdition, tier: "FRAGMENTO", name: `${v.name} #${fragmentoEdition}`, mediaVariantKey: v.key });
    fragmentoEdition++;
  }
  for (let i = 0; i < input.tier3Count; i++) {
    const v = pick(reliquiaVariants);
    rows.push({ collectionId: collection.id, editionNumber: reliquiaEdition, tier: "RELIQUIA", name: `${v.name} #${reliquiaEdition}`, mediaVariantKey: v.key });
    reliquiaEdition++;
  }

  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await prisma.nftItem.createMany({ data: rows.slice(i, i + CHUNK) });
  }

  return {
    collectionId: collection.id,
    totalSupply,
    wipedItems,
    variantCounts: { PAPIRO: papiroVariants.length, FRAGMENTO: fragmentoVariants.length, RELIQUIA: reliquiaVariants.length },
  };
}

// Brai, 2026-09-21: "los nombres de los nft al igual que toda la plataforma
// EN INGLES" -- the platform's own UI is English by default (see
// translations.ts), so the ZODD lore names given to the 9 video variants
// (originally Spanish -- "Papiro del Genesis" etc.) need to match. Renaming
// a variant does NOT touch its video bytes or its `key` (still built from
// the ORIGINAL content hash -- see buildTierVariants -- so every
// already-minted item's streaming URL keeps working unchanged), just the
// variant's own `name` in the collection's tier JSON and every existing
// NftItem row's baked `name` ("<variant name> #<editionNumber>") for that
// variant. Deliberately a separate, lightweight route from
// seedTieredNftCollectionWithVariants above: re-running the full reseed to
// fix a label would re-upload the whole ~40MB of video AND wipe every
// existing item (losing test mints) just to change a name.
export interface NftVariantRename {
  tier: "PAPIRO" | "FRAGMENTO" | "RELIQUIA";
  key: string;
  newName: string;
}

export async function renameNftTierVariants(
  slug: string,
  renames: NftVariantRename[]
): Promise<{ collectionId: string; updatedVariants: number; updatedItems: number } | null> {
  const collection = await prisma.nftCollection.findUnique({
    where: { slug },
    select: { id: true, papiroVariants: true, fragmentoVariants: true, reliquiaVariants: true },
  });
  if (!collection) return null;

  const fieldByTier: Record<"PAPIRO" | "FRAGMENTO" | "RELIQUIA", "papiroVariants" | "fragmentoVariants" | "reliquiaVariants"> = {
    PAPIRO: "papiroVariants",
    FRAGMENTO: "fragmentoVariants",
    RELIQUIA: "reliquiaVariants",
  };

  const byTier = new Map<"PAPIRO" | "FRAGMENTO" | "RELIQUIA", NftVariantRename[]>();
  for (const r of renames) {
    if (!r.newName?.trim()) throw new Error(`rename for ${r.key} is missing a newName`);
    const list = byTier.get(r.tier) ?? [];
    list.push(r);
    byTier.set(r.tier, list);
  }

  let updatedVariants = 0;
  let updatedItems = 0;

  for (const [tier, list] of byTier) {
    const field = fieldByTier[tier];
    const current = parseVariants((collection as unknown as Record<string, unknown>)[field]);
    const byKey = new Map(list.map((r) => [r.key, r.newName.trim()]));
    const next = current.map((v) => {
      const newName = byKey.get(v.key);
      if (newName === undefined) return v;
      updatedVariants++;
      return { ...v, name: newName };
    });
    await prisma.nftCollection.update({ where: { id: collection.id }, data: { [field]: next as unknown as object } });

    for (const { key, newName } of list) {
      const trimmed = newName.trim();
      const affected = await prisma.$executeRaw`
        UPDATE "NftItem"
        SET "name" = ${trimmed} || ' #' || "editionNumber"::text
        WHERE "collectionId" = ${collection.id} AND "mediaVariantKey" = ${key}
      `;
      updatedItems += Number(affected);
    }
  }

  return { collectionId: collection.id, updatedVariants, updatedItems };
}

// Brai, 2026-09-24: "agrega esos dos NFT a tier 3" -- adds new named video
// variants to a tier's existing pool WITHOUT wiping or re-seeding anything.
// Sibling to renameNftTierVariants above (same "read the tier's variants
// column, patch it, write it back" shape) but appends instead of relabeling.
// Deliberately does NOT touch totalSupply/mintedCount or create any new
// NftItem rows -- adding a variant only means future forgeCraft draws
// (targetVariants[Math.floor(Math.random() * targetVariants.length)]) can
// now land on it; it does not mint anything by itself. Already-minted items
// referencing the tier's older variants are completely unaffected since
// those keys stay in the array untouched. Re-running with the same video
// is safe (idempotent): buildTierVariants' key embeds the content hash, so
// a variant that's already present by key is skipped rather than duplicated.
export async function addNftTierVariants(
  slug: string,
  tier: "PAPIRO" | "FRAGMENTO" | "RELIQUIA",
  inputs: TieredVariantInput[]
): Promise<{ collectionId: string; addedVariants: number; skippedDuplicates: number; totalVariants: number } | null> {
  if (!inputs.length) throw new Error("no variants provided");

  const collection = await prisma.nftCollection.findUnique({
    where: { slug },
    select: { id: true, papiroVariants: true, fragmentoVariants: true, reliquiaVariants: true },
  });
  if (!collection) return null;

  const fieldByTier: Record<"PAPIRO" | "FRAGMENTO" | "RELIQUIA", "papiroVariants" | "fragmentoVariants" | "reliquiaVariants"> = {
    PAPIRO: "papiroVariants",
    FRAGMENTO: "fragmentoVariants",
    RELIQUIA: "reliquiaVariants",
  };
  const field = fieldByTier[tier];
  const current = parseVariants((collection as unknown as Record<string, unknown>)[field]);

  const built = buildTierVariants(collection.id, tier, inputs);
  const existingKeys = new Set(current.map((v) => v.key));
  const deduped = built.filter((v) => !existingKeys.has(v.key));

  const next = [...current, ...deduped];
  await prisma.nftCollection.update({ where: { id: collection.id }, data: { [field]: next as unknown as object } });

  return {
    collectionId: collection.id,
    addedVariants: deduped.length,
    skippedDuplicates: built.length - deduped.length,
    totalVariants: next.length,
  };
}

// Brai, 2026-09-19: "la foto se ve toda dañada en colores raros" -- the
// tiered reseed above went through a manual relay step to get the base64
// image data into the deploy pipeline, and that step silently corrupted a
// few characters of two of the three images (confirmed: production length
// didn't match the source file length for PAPIRO and RELIQUIA). Rather than
// re-run the full wipe+reseed (which would also discard the one piece
// that's already been minted), this updates just the three tier-image
// fields in place -- items and everything else are untouched. expectedMd5
// is optional but should always be sent: it's an md5 of the imageDataUrl
// string computed on the source side, checked against the same hash
// computed here, so a corrupted relay fails loudly instead of writing bad
// data again.
export async function updateNftCollectionTierImage(
  slug: string,
  tier: "PAPIRO" | "FRAGMENTO" | "RELIQUIA",
  imageDataUrl: string,
  expectedMd5?: string
): Promise<{ collectionId: string; tier: string; length: number; md5: string }> {
  if (!imageDataUrl || !imageDataUrl.startsWith("data:image/")) {
    throw new Error("imageDataUrl must be a data:image/... URL");
  }
  const md5 = createHash("md5").update(imageDataUrl).digest("hex");
  if (expectedMd5 && expectedMd5 !== md5) {
    throw new Error(`md5 mismatch: expected ${expectedMd5}, computed ${md5} (relay likely corrupted the data -- not writing it)`);
  }
  const collection = await prisma.nftCollection.findUnique({ where: { slug } });
  if (!collection) throw new Error(`collection ${slug} not found`);

  const field =
    tier === "PAPIRO" ? "papiroImageDataUrl" : tier === "FRAGMENTO" ? "fragmentoImageDataUrl" : "reliquiaImageDataUrl";
  await prisma.nftCollection.update({ where: { id: collection.id }, data: { [field]: imageDataUrl } });

  return { collectionId: collection.id, tier, length: imageDataUrl.length, md5 };
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
  // Brai, 2026-09-19: "la posibilidad de subir la cantidad de nfts a
  // mintear" -- how many pieces this one payment covers, and (once paid)
  // every piece it actually claimed. quantity defaults to 1 so every
  // pre-existing row (all created before this field existed) reads back
  // correctly as a single-piece mint.
  quantity: number;
  resultItemIds: string[];
  createdAt: string;
  // Brai, 2026-09-19: "inclusive los que hacen free mint tienen que hacer
  // una tx" -- true when this pending mint is a whitelist free claim's
  // tiny on-chain fee (NFT_FREE_MINT_FEE_ZEC) rather than a real paid
  // mint, so the frontend can show "FREE MINT -- just cover the network
  // fee" instead of treating it like a normal purchase.
  freeClaim: boolean;
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
  quantity: number;
  resultItemIds: string[];
  createdAt: Date;
  freeClaimWhitelistEntryId?: string | null;
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
    quantity: p.quantity,
    resultItemIds: p.resultItemIds,
    createdAt: p.createdAt.toISOString(),
    freeClaim: !!p.freeClaimWhitelistEntryId,
  };
}

export async function createPendingNftMint(input: {
  collectionId: string;
  internalWalletId: string;
  currency?: Currency;
  expectedZecAmount: number;
  quantity?: number;
  freeClaimWhitelistEntryId?: string;
}) {
  const p = await prisma.pendingNftMint.create({
    data: {
      collectionId: input.collectionId,
      internalWalletId: input.internalWalletId,
      currency: input.currency ?? "ZEC",
      expectedZecAmount: input.expectedZecAmount,
      quantity: input.quantity ?? 1,
      freeClaimWhitelistEntryId: input.freeClaimWhitelistEntryId ?? null,
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

/** Claims up to `count` random unminted pieces one at a time (each single
 * claim is already race-safe -- see claimRandomUnmintedNftItem above), all
 * tagged with the same `txid` since they're covered by the same payment or
 * the same free-mint grant. Stops early and returns whatever it managed to
 * claim (possibly fewer than `count`, possibly zero) if the collection
 * sells out partway through -- callers decide what a partial or empty
 * result means for them. */
async function claimRandomUnmintedNftItems(
  collectionId: string,
  walletId: string,
  txid: string,
  count: number
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = await claimRandomUnmintedNftItem(collectionId, walletId, txid);
    if (!id) break;
    ids.push(id);
  }
  return ids;
}

/** Payment for a mint confirmed: claims `p.quantity` random unminted
 * pieces (Brai, 2026-09-19: "la posibilidad de subir la cantidad de nfts a
 * mintear") and marks the reservation CREATED. Returns null only if NOT
 * EVEN ONE piece could be claimed (collection was already fully sold out
 * by the time this payment landed -- an unlucky simultaneous-mint race);
 * the payment still arrived for real in that case, so the caller
 * (server.ts) treats that as an admin-recovery case, same philosophy as
 * every other forensics case in this file, rather than silently losing
 * track of it. A PARTIAL claim (paid for N, only M < N left) still
 * completes with what it got and is logged loudly by the caller for a
 * manual partial refund -- better than stranding the buyer entirely over
 * an edge case this unlikely. */
export async function completePendingNftMint(
  id: string,
  txid: string
): Promise<{ collectionSlug: string; itemId: string; editionNumber: number; itemIds: string[]; editionNumbers: number[]; shortfall: number } | null> {
  const p = await prisma.pendingNftMint.findUnique({ where: { id } });
  if (!p || p.status !== "PENDING") return null;

  let requestedQty = Math.max(1, p.quantity);
  // Brai, 2026-09-19: this pending mint is a whitelist free claim's tiny
  // on-chain fee (see PendingNftMint.freeClaimWhitelistEntryId's comment),
  // not a real paid mint -- re-check the entry's remaining allowance NOW,
  // right before actually claiming pieces. It was already checked once at
  // request time (getWhitelistFreeClaimEligibility), but that check and
  // this payment confirming are separated by however long the buyer takes
  // to actually send the fee, during which another pending free-claim
  // order for the same entry could've completed first (e.g. two tabs) --
  // clamping here is what keeps a wallet from ever walking away with more
  // than NFT_WHITELIST_FREE_MINT_LIMIT pieces total. Same "partial claim
  // still completes with what it got" philosophy as the sold-out case
  // below, just against the whitelist cap instead of total supply.
  let freeClaimEntry: { claimedAt: Date | null; claimedCount: number; tier: string } | null = null;
  if (p.freeClaimWhitelistEntryId) {
    freeClaimEntry = await prisma.nftWhitelistEntry.findUnique({
      where: { id: p.freeClaimWhitelistEntryId },
      select: { claimedAt: true, claimedCount: true, tier: true },
    });
    const limit = freeClaimEntry ? freeMintLimitForTier(freeClaimEntry.tier as NftWhitelistTier) : NFT_WHITELIST_FREE_MINT_LIMIT;
    const remaining = Math.max(0, limit - (freeClaimEntry?.claimedCount ?? 0));
    requestedQty = Math.min(requestedQty, remaining);
    if (requestedQty === 0) return null;
  }
  const itemIds = await claimRandomUnmintedNftItems(p.collectionId, p.internalWalletId, txid, requestedQty);
  if (itemIds.length === 0) return null;

  const items = await prisma.nftItem.findMany({ where: { id: { in: itemIds } } });
  await prisma.nftCollection.update({ where: { id: p.collectionId }, data: { mintedCount: { increment: itemIds.length } } });
  await prisma.pendingNftMint.update({
    where: { id },
    data: { status: "CREATED", resultItemId: itemIds[0], resultItemIds: itemIds, completedAt: new Date() },
  });
  // The free allowance itself is only actually spent now that the fee
  // payment has genuinely confirmed, same claimedCount/claimedAt/
  // claimedByWalletId bookkeeping the old instant claimFreeNftWhitelistMint
  // used to do at claim time. A wallet that generates a payment address
  // and never pays it never touches this, so it never loses part of its
  // free allowance for nothing.
  if (p.freeClaimWhitelistEntryId) {
    await prisma.nftWhitelistEntry.update({
      where: { id: p.freeClaimWhitelistEntryId },
      data: { claimedAt: freeClaimEntry?.claimedAt ?? new Date(), claimedByWalletId: p.internalWalletId, claimedCount: { increment: itemIds.length } },
    });
  }
  const collection = await prisma.nftCollection.findUniqueOrThrow({ where: { id: p.collectionId }, select: { slug: true } });
  const editionNumbers = itemIds.map((itemId) => items.find((it) => it.id === itemId)!.editionNumber);
  return {
    collectionSlug: collection.slug,
    itemId: itemIds[0],
    editionNumber: editionNumbers[0],
    itemIds,
    editionNumbers,
    shortfall: requestedQty - itemIds.length,
  };
}

// ---------- NFT whitelist (Twitter, manually reviewed) ----------
// Brai, 2026-09-18: see the long comment on NftWhitelistEntry in
// schema.prisma for the full design. Short version: someone pastes a ZEC
// address + Twitter/X handle (no wallet connection needed to apply), Brai
// reviews by hand (approve/reject), and an APPROVED entry whose address
// matches a connected wallet gets that wallet exactly one free mint.

export type NftWhitelistStatus = "PENDING" | "APPROVED" | "REJECTED";
export type NftWhitelistTier = "COLAB" | "APROBBED";

export interface NftWhitelistEntryView {
  id: string;
  walletAddress: string;
  twitterHandle: string;
  status: NftWhitelistStatus;
  createdAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  claimedAt: string | null;
  // Brai, 2026-09-19: exposed so the mint page can show "X of 5 free mints
  // used" and know whether this wallet's free allowance is exhausted,
  // without guessing from claimedAt alone (see NFT_WHITELIST_FREE_MINT_LIMIT
  // in fees.ts).
  claimedCount: number;
  // Brai, 2026-09-24: COLAB (5 free) or APROBBED (1 free) -- see
  // NftWhitelistTier in schema.prisma. Internal-facing only: the PUBLIC
  // status word is always just "Approved" regardless of tier (see
  // NftWhitelistPublicStatusView below), only the mint page's own-wallet
  // view needs to know the tier, via freeMintLimit.
  tier: NftWhitelistTier;
  // This entry's actual free-mint allowance (freeMintLimitForTier(tier)),
  // precomputed here so callers never have to import fees.ts just to know
  // how many free mints THIS entry gets.
  freeMintLimit: number;
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
  claimedCount: number;
  tier: string;
}): NftWhitelistEntryView {
  const tier = e.tier as NftWhitelistTier;
  return {
    id: e.id,
    walletAddress: e.walletAddress,
    twitterHandle: e.twitterHandle,
    status: e.status as NftWhitelistStatus,
    createdAt: e.createdAt.toISOString(),
    reviewedAt: e.reviewedAt ? e.reviewedAt.toISOString() : null,
    reviewNote: e.reviewNote,
    claimedAt: e.claimedAt ? e.claimedAt.toISOString() : null,
    claimedCount: e.claimedCount,
    tier,
    freeMintLimit: freeMintLimitForTier(tier),
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
    ? {
        twitterHandle: handle,
        status: "APPROVED" as const,
        reviewedAt: new Date(),
        reviewNote: "pre-approved list",
        tier: preapproved.tier,
      }
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
  note?: string,
  // Brai, 2026-09-24: which tier this batch gets -- see NftWhitelistTier in
  // schema.prisma. Defaults to APROBBED (1 free mint), the lower tier;
  // pass "COLAB" for a KOL/giveaway-style list (5 free mints).
  tier: NftWhitelistTier = "APROBBED"
): Promise<{ handle: string; alreadyEntered: boolean }[]> {
  const results: { handle: string; alreadyEntered: boolean }[] = [];
  for (const raw of rawHandles) {
    const handle = normalizeTwitterHandle(raw);
    if (!/^[a-z0-9_]{1,15}$/.test(handle)) continue;
    await prisma.nftWhitelistPreapproved.upsert({
      where: { twitterHandle: handle },
      create: { twitterHandle: handle, note: note ?? null, tier },
      update: { note: note ?? null, tier },
    });
    // If they already have a PENDING/REJECTED entry (submitted before Brai
    // handed over the list), flip it to APPROVED right now too -- otherwise
    // someone who already applied would be stuck waiting even though
    // they're on the list. An entry that's already APPROVED still gets its
    // tier upgraded here (e.g. a handle bumped from the APROBBED batch to a
    // later COLAB one), just not its status/reviewedAt/reviewNote touched
    // again.
    const existing = await prisma.nftWhitelistEntry.findFirst({ where: { twitterHandle: handle } });
    let alreadyEntered = false;
    if (existing && existing.status !== "APPROVED") {
      await prisma.nftWhitelistEntry.update({
        where: { id: existing.id },
        data: { status: "APPROVED", reviewedAt: new Date(), reviewNote: "pre-approved list", tier },
      });
      alreadyEntered = true;
    } else if (existing) {
      if (existing.tier !== tier) {
        await prisma.nftWhitelistEntry.update({ where: { id: existing.id }, data: { tier } });
      }
      alreadyEntered = true;
    }
    results.push({ handle, alreadyEntered });
  }
  return results;
}

/** Brai, 2026-09-21: "programar algo para el mint... que se pueda conectar
 * autentificador de twitter y si el handle esta en la lista, pasa
 * directamente a free mint... hay algunos que no conectaron la wallet y
 * voy a autorizar ahora luego del fin de la whitelist y no tendre forma de
 * saber quienes son si no tengo autentificador de twitter" -- the
 * self-service counterpart to submitNftWhitelistEntry, for exactly the
 * case the old wizard can't cover anymore now that it's closed: a handle
 * Brai preapproved (see preapproveNftWhitelistHandles above) that never
 * went through the wallet+handle wizard, so there's no NftWhitelistEntry
 * row -- and therefore no walletAddress -- for it at all. Called from the
 * mint page (frontend/app/nft/test/mint/page.tsx) once X OAuth has proven
 * which handle the visitor owns; the caller (the same-origin
 * /api/nft/whitelist/claim-by-x proxy route, gated by
 * WHITELIST_INTERNAL_TOKEN below just like /api/nft/whitelist) supplies
 * that verified handle, never anything the client could type.
 *
 * Deliberately narrow: a handle that already has ANY NftWhitelistEntry row
 * (PENDING, REJECTED, or APPROVED-with-a-different-wallet) is left for
 * Brai to sort out by hand rather than silently reassigned here -- this
 * only ever fills in the gap of "preapproved, never applied at all". */
export async function claimNftWhitelistByVerifiedHandle(
  walletId: string,
  rawHandle: string,
  rawAddress: string
): Promise<NftWhitelistEntryView | { error: string }> {
  const handle = normalizeTwitterHandle(rawHandle);
  if (!/^[a-z0-9_]{1,15}$/.test(handle)) return { error: "that doesn't look like a valid X/Twitter handle" };

  const wallet = await prisma.internalWallet.findUnique({ where: { id: walletId } });
  if (!wallet) return { error: "wallet not found" };

  const existingByHandle = await prisma.nftWhitelistEntry.findFirst({ where: { twitterHandle: handle } });
  if (existingByHandle) {
    // Same "both addresses this wallet is known by" match as
    // findApprovedNftWhitelistEntryForWallet -- if this exact wallet is
    // already the one behind that entry, treat it as a success (idempotent
    // re-click of the CHECK button) instead of an error.
    const candidateAddresses = [wallet.noirAddress, wallet.defaultRefundAddress].filter(
      (a): a is string => !!a
    );
    if (existingByHandle.status === "APPROVED" && candidateAddresses.includes(existingByHandle.walletAddress)) {
      return toNftWhitelistEntryView(existingByHandle);
    }
    return { error: "this X account already has a whitelist application on file -- contact Brai" };
  }

  const preapproved = await prisma.nftWhitelistPreapproved.findUnique({ where: { twitterHandle: handle } });
  if (!preapproved) return { error: "this X account isn't on the whitelist" };

  const address = rawAddress.trim();
  if (!looksLikeZcashAddress(address)) return { error: "that doesn't look like a valid Zcash wallet address" };
  const takenByAnotherAddress = await prisma.nftWhitelistEntry.findUnique({ where: { walletAddress: address } });
  if (takenByAnotherAddress) return { error: "that wallet address is already registered to a different whitelist entry" };

  const created = await prisma.nftWhitelistEntry.create({
    data: {
      walletAddress: address,
      twitterHandle: handle,
      status: "APPROVED",
      reviewedAt: new Date(),
      reviewNote: "auto-approved: X-verified handle matched the preapproved list",
    },
  });
  // Same bookkeeping connectOrCreateNoirWallet/setDefaultRefundAddress do
  // elsewhere -- keeps this wallet's OWN address record in sync too, so
  // findApprovedNftWhitelistEntryForWallet keeps matching even if this
  // specific NftWhitelistEntry row is ever touched independently later.
  if (!wallet.noirAddress && !wallet.defaultRefundAddress) {
    await prisma.internalWallet.update({ where: { id: walletId }, data: { defaultRefundAddress: address } });
  }
  return toNftWhitelistEntryView(created);
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

export type NftWhitelistDisplayStatus = "APPROVED" | "UNDER_REVIEW" | "REJECTED";

export interface NftWhitelistUnifiedRow {
  twitterHandle: string;
  displayStatus: NftWhitelistDisplayStatus;
  // Brai, 2026-09-19: "si te doy una lista... aunque no hayan hecho el
  // whitelist" -- a handle can be APPROVED via the standing preapproval
  // list (NftWhitelistPreapproved) before it ever has a real
  // NftWhitelistEntry row (that only gets created once they run the wizard
  // and supply a wallet address -- see submitNftWhitelistEntry). hasApplied
  // tells the two apart: false means "on the list, hasn't gone through the
  // wizard yet", so walletAddress/createdAt/claimedAt below are null.
  hasApplied: boolean;
  walletAddress: string | null;
  reviewNote: string | null;
  createdAt: string | null;
  reviewedAt: string | null;
  claimedAt: string | null;
  claimedCount: number;
}

/** Brai, 2026-09-19: "arregla eso, solo que haya una lista, APROBADO, si
 * esta, automaticamente APROBADO sino UNDER REVIEW" -- the admin list used
 * to only show NftWhitelistEntry rows, so a preapproved handle that hadn't
 * gone through the wizard yet (see NftWhitelistPreapproved's comment on
 * preapproveNftWhitelistHandles) looked completely missing, not APPROVED,
 * even though it really is approved the moment it's on that standing list.
 * This merges both sources into one list: every preapproved handle reads
 * APPROVED whether or not it has an entry yet, everything else reads its
 * real status with PENDING relabeled to the friendlier UNDER_REVIEW (kept
 * as its own value rather than folded into REJECTED, since Brai still
 * wants those visibly distinct -- he only ever described two buckets for
 * "not yet decided" vs "approved", not for a deliberate rejection).
 * Optional status filter narrows to just one bucket, e.g. ?status=APPROVED
 * to get the same clean "who's actually approved" list without also
 * pulling every one of the thousands of still-pending applicants. */
export async function listNftWhitelistUnified(statusFilter?: NftWhitelistDisplayStatus): Promise<NftWhitelistUnifiedRow[]> {
  const [preapproved, entries] = await Promise.all([
    prisma.nftWhitelistPreapproved.findMany(),
    prisma.nftWhitelistEntry.findMany(),
  ]);
  const preapprovedByHandle = new Map(preapproved.map((p) => [p.twitterHandle, p]));
  const entryByHandle = new Map(entries.map((e) => [e.twitterHandle, e]));

  const rows: NftWhitelistUnifiedRow[] = [];

  for (const p of preapproved) {
    const entry = entryByHandle.get(p.twitterHandle);
    rows.push({
      twitterHandle: p.twitterHandle,
      displayStatus: "APPROVED",
      hasApplied: !!entry,
      walletAddress: entry?.walletAddress ?? null,
      reviewNote: entry?.reviewNote ?? p.note ?? null,
      createdAt: entry ? entry.createdAt.toISOString() : null,
      reviewedAt: entry?.reviewedAt ? entry.reviewedAt.toISOString() : null,
      claimedAt: entry?.claimedAt ? entry.claimedAt.toISOString() : null,
      claimedCount: entry?.claimedCount ?? 0,
    });
  }

  for (const e of entries) {
    if (preapprovedByHandle.has(e.twitterHandle)) continue; // already covered above, always APPROVED
    const displayStatus: NftWhitelistDisplayStatus = e.status === "APPROVED" ? "APPROVED" : e.status === "REJECTED" ? "REJECTED" : "UNDER_REVIEW";
    rows.push({
      twitterHandle: e.twitterHandle,
      displayStatus,
      hasApplied: true,
      walletAddress: e.walletAddress,
      reviewNote: e.reviewNote,
      createdAt: e.createdAt.toISOString(),
      reviewedAt: e.reviewedAt ? e.reviewedAt.toISOString() : null,
      claimedAt: e.claimedAt ? e.claimedAt.toISOString() : null,
      claimedCount: e.claimedCount,
    });
  }

  const filtered = statusFilter ? rows.filter((r) => r.displayStatus === statusFilter) : rows;
  const STATUS_ORDER: Record<NftWhitelistDisplayStatus, number> = { APPROVED: 0, UNDER_REVIEW: 1, REJECTED: 2 };
  filtered.sort((a, b) => STATUS_ORDER[a.displayStatus] - STATUS_ORDER[b.displayStatus] || a.twitterHandle.localeCompare(b.twitterHandle));
  return filtered;
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
/** Shared by claimFreeNftWhitelistMint and the presale phase gate in
 * server.ts -- see claimFreeNftWhitelistMint's big comment above for why
 * this checks both noirAddress and defaultRefundAddress. */
async function findApprovedNftWhitelistEntryForWallet(walletId: string) {
  const wallet = await prisma.internalWallet.findUnique({ where: { id: walletId } });
  if (!wallet) return null;
  const candidateAddresses = [wallet.noirAddress, wallet.defaultRefundAddress].filter(
    (a): a is string => !!a
  );
  if (candidateAddresses.length === 0) return null;
  return prisma.nftWhitelistEntry.findFirst({
    where: { walletAddress: { in: candidateAddresses }, status: "APPROVED" },
  });
}

/** Brai, 2026-09-19: "la whitelist [se] le activa en cierto horario" --
 * during the whitelist-only presale window, only a wallet with an
 * APPROVED entry may mint at all (whether their free claim or paying
 * full price for more). Used by /api/nft/mint's phase gate. */
export async function isWalletNftWhitelisted(walletId: string): Promise<boolean> {
  return (await findApprovedNftWhitelistEntryForWallet(walletId)) !== null;
}

/** Same lookup as isWalletNftWhitelisted, but returns the full entry (so
 * the mint page can show "X of 5 free mints used") instead of a plain
 * boolean. Used by GET /api/nft/whitelist/status-by-wallet/:walletId --
 * this is the one true source of "is this connected wallet whitelisted"
 * the frontend can trust, since it's the exact same matching logic
 * /api/nft/mint itself gates on (see the big comment above). */
export async function getNftWhitelistStatusForWallet(walletId: string): Promise<NftWhitelistEntryView | null> {
  const entry = await findApprovedNftWhitelistEntryForWallet(walletId);
  return entry ? toNftWhitelistEntryView(entry) : null;
}

/** Brai, 2026-09-19: "inclusive los que hacen free mint tienen que hacer
 * una tx con su wallet y cobrarle muy poco ... que cubran la transaccion y
 * un poquito mas" -- a whitelist free claim is no longer instant (that was
 * claimFreeNftWhitelistMint below, now unused by /api/nft/mint): it goes
 * through the exact same address/QR/poll payment flow as a paid mint, just
 * for NFT_FREE_MINT_FEE_ZEC instead of the real price, so every piece has
 * a real on-chain tx behind it (Brai: "sino no tiene sentido solo son nfts
 * en mi base de datos"). This is the READ-ONLY eligibility check
 * /api/nft/mint does BEFORE creating that pending payment, so a wallet
 * that isn't approved (or has no free claims left) is never asked to pay a
 * fee for a claim it doesn't actually have. Nothing is written here --
 * claimedCount/claimedAt/claimedByWalletId only update once the fee
 * payment actually confirms, inside completePendingNftMint's
 * freeClaimWhitelistEntryId handling (see PendingNftMint's comment in
 * schema.prisma). Same quantity-clamping as the old instant claim: asking
 * for more than what's left of the 5-per-wallet allowance just returns the
 * most it can give, never an error. */
export async function getWhitelistFreeClaimEligibility(
  walletId: string,
  quantity: number
): Promise<{ ok: true; entryId: string; quantity: number } | { ok: false; error: "not_approved" | "already_claimed" }> {
  const entry = await findApprovedNftWhitelistEntryForWallet(walletId);
  if (!entry) return { ok: false, error: "not_approved" };
  const remaining = freeMintLimitForTier(entry.tier as NftWhitelistTier) - entry.claimedCount;
  if (remaining <= 0) return { ok: false, error: "already_claimed" };
  return { ok: true, entryId: entry.id, quantity: Math.min(Math.max(1, quantity), remaining) };
}

/** Brai, 2026-09-19: superseded by getWhitelistFreeClaimEligibility +
 * completePendingNftMint's freeClaimWhitelistEntryId handling -- a free
 * whitelist claim is no longer instant (see that comment). Left in place,
 * unused by /api/nft/mint, in case it's ever useful again (e.g. an admin
 * "just give them the piece" override) -- not deleted since it's still a
 * correct, working implementation of "instant free claim", just not the
 * one the live route calls anymore. */
export async function claimFreeNftWhitelistMint(
  collectionSlug: string,
  walletId: string,
  quantity: number = 1
): Promise<
  | { ok: true; collectionSlug: string; itemId: string; editionNumber: number; itemIds: string[]; editionNumbers: number[]; tiers: ("PAPIRO" | "FRAGMENTO" | "RELIQUIA")[] }
  | { ok: false; error: "not_approved" | "already_claimed" | "collection_not_found" | "sold_out" }
> {
  const entry = await findApprovedNftWhitelistEntryForWallet(walletId);
  if (!entry) return { ok: false, error: "not_approved" };
  // Brai, 2026-09-19: "las wallets de los handle que estan aprobados
  // mintean gratis solo 5 nfts" -- up to NFT_WHITELIST_FREE_MINT_LIMIT free
  // claims per entry (was a one-time-ever gate via claimedAt before). A
  // quantity request is clamped down to whatever's left of that allowance
  // -- it never errors out just because someone asked for more than they
  // have left; it just gives them the most it can.
  const remaining = freeMintLimitForTier(entry.tier as NftWhitelistTier) - entry.claimedCount;
  if (remaining <= 0) return { ok: false, error: "already_claimed" };
  const wantQty = Math.min(Math.max(1, quantity), remaining);

  const collection = await prisma.nftCollection.findUnique({ where: { slug: collectionSlug } });
  if (!collection) return { ok: false, error: "collection_not_found" };

  const txid = `whitelist-free-${walletId}-${Date.now()}`;
  const itemIds = await claimRandomUnmintedNftItems(collection.id, walletId, txid, wantQty);
  if (itemIds.length === 0) return { ok: false, error: "sold_out" };

  const items = await prisma.nftItem.findMany({ where: { id: { in: itemIds } } });
  await prisma.nftCollection.update({ where: { id: collection.id }, data: { mintedCount: { increment: itemIds.length } } });
  await prisma.nftWhitelistEntry.update({
    where: { id: entry.id },
    data: { claimedAt: entry.claimedAt ?? new Date(), claimedByWalletId: walletId, claimedCount: { increment: itemIds.length } },
  });
  const editionNumbers = itemIds.map((itemId) => items.find((it) => it.id === itemId)!.editionNumber);
  // Brai, 2026-09-19: editionNumber is scoped per tier now -- the mint
  // page needs each piece's tier to build its item-detail link (see
  // api.ts's nftItemPath) without an extra fetch per piece.
  const tiers = itemIds.map((itemId) => items.find((it) => it.id === itemId)!.tier as "PAPIRO" | "FRAGMENTO" | "RELIQUIA");
  return { ok: true, collectionSlug, itemId: itemIds[0], editionNumber: editionNumbers[0], itemIds, editionNumbers, tiers };
}

/** Brai, 2026-09-19: "ese es el id de wallet mio, del desarrollador, mintea
 * a precio 0" -- when an owner wallet's price (nftMintPriceZecFor in
 * fees.ts) is actually 0, there's no real payment to wait for, so this
 * skips the address/QR/poll dance entirely, the same way
 * claimFreeNftWhitelistMint does for a free whitelist claim. Unlike that
 * one, this has no per-entry cap of its own -- server.ts already enforces
 * NFT_MAX_MINTS_PER_WALLET before calling this, and that's the only limit
 * an owner wallet is subject to. */
export async function claimFreeOwnerNftMint(
  collectionSlug: string,
  walletId: string,
  quantity: number = 1
): Promise<
  | { ok: true; collectionSlug: string; itemId: string; editionNumber: number; itemIds: string[]; editionNumbers: number[]; tiers: ("PAPIRO" | "FRAGMENTO" | "RELIQUIA")[] }
  | { ok: false; error: "collection_not_found" | "sold_out" }
> {
  const collection = await prisma.nftCollection.findUnique({ where: { slug: collectionSlug } });
  if (!collection) return { ok: false, error: "collection_not_found" };

  const txid = `owner-free-${walletId}-${Date.now()}`;
  const itemIds = await claimRandomUnmintedNftItems(collection.id, walletId, txid, Math.max(1, quantity));
  if (itemIds.length === 0) return { ok: false, error: "sold_out" };

  const items = await prisma.nftItem.findMany({ where: { id: { in: itemIds } } });
  await prisma.nftCollection.update({ where: { id: collection.id }, data: { mintedCount: { increment: itemIds.length } } });
  const editionNumbers = itemIds.map((itemId) => items.find((it) => it.id === itemId)!.editionNumber);
  const tiers = itemIds.map((itemId) => items.find((it) => it.id === itemId)!.tier as "PAPIRO" | "FRAGMENTO" | "RELIQUIA");
  return { ok: true, collectionSlug, itemId: itemIds[0], editionNumber: editionNumbers[0], itemIds, editionNumbers, tiers };
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

/** Brai, 2026-09-24: "una vez que se selecciona un nft, tiene que haber un
 * aviso para el resto de los usuarios que esos nfts estan tomados y no
 * pueden comprarse, hasta que no se cae la transaccion" -- opening a
 * purchase order also claims the reservation lock on the item (see
 * NftItem.reservedUntil's comment in schema.prisma), atomically: the
 * conditional UPDATE only succeeds while the piece is still listed AND not
 * already reserved by a still-live reservation, same "WHERE ... AND
 * -condition-" race-safety idiom as forgeCraft/fillNftPurchase elsewhere in
 * this file. Returns { error: "item_reserved" } instead of throwing so
 * server.ts can turn it into a clean 409, same convention as
 * forgeCraft/getWhitelistFreeClaimEligibility's tagged-error returns. */
export async function createNftPurchaseOrder(input: {
  itemId: string;
  buyerInternalWalletId: string;
  sellerInternalWalletId: string;
  currency?: Currency;
  payoutAddress: string;
  expectedZecAmount: number;
}): Promise<NftPurchaseOrderView | { error: "item_reserved" }> {
  return prisma.$transaction(async (tx) => {
    const o = await tx.nftPurchaseOrder.create({
      data: {
        itemId: input.itemId,
        buyerInternalWalletId: input.buyerInternalWalletId,
        sellerInternalWalletId: input.sellerInternalWalletId,
        currency: input.currency ?? "ZEC",
        payoutAddress: input.payoutAddress,
        expectedZecAmount: input.expectedZecAmount,
      },
    });
    const now = new Date();
    const reservedUntil = new Date(now.getTime() + NFT_RESERVATION_MINUTES * 60_000);
    const claimed = await tx.nftItem.updateMany({
      where: {
        id: input.itemId,
        listedPriceZec: { not: null },
        OR: [{ reservedUntil: null }, { reservedUntil: { lt: now } }],
      },
      data: { reservedUntil, reservedByOrderId: o.id },
    });
    if (claimed.count === 0) {
      // Someone else's reservation is still live (or the piece got
      // delisted the instant before this ran) -- roll back the order row
      // we just created, this attempt never happened.
      await tx.nftPurchaseOrder.delete({ where: { id: o.id } });
      return { error: "item_reserved" } as const;
    }
    return toNftPurchaseOrderView(o);
  });
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
  // Brai, 2026-09-24: release the reservation lock right away instead of
  // making the next buyer wait out the full NFT_RESERVATION_MINUTES --
  // "only if still mine" (via reservedByOrderId) so this never clobbers a
  // newer reservation some other order picked up after this one lapsed.
  await prisma.nftItem.updateMany({
    where: { id: o.itemId, reservedByOrderId: o.id },
    data: { reservedUntil: null, reservedByOrderId: null },
  });
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
  txid: string,
  // Brai, 2026-09-19: the platform's 1% cut of this sale (see splitNftFee
  // in fees.ts), recorded on the order right when it fills so
  // getPlatformFeeStatus can sum it -- never touched again after this.
  platformFeeZec: number
): Promise<NftItemView | null> {
  const result = await prisma.nftItem.updateMany({
    where: { id: itemId, ownerInternalWalletId: sellerWalletId, listedPriceZec: { not: null } },
    data: {
      ownerInternalWalletId: buyerWalletId,
      listedPriceZec: null,
      listedAt: null,
      listedPayoutAddress: null,
      // Brai, 2026-09-24: sale went through -- release the reservation lock
      // along with everything else the listing set (it's moot now that the
      // piece isn't even listed anymore, but keeps the row clean).
      reservedUntil: null,
      reservedByOrderId: null,
    },
  });
  if (result.count === 0) return null;
  await prisma.nftPurchaseOrder.update({ where: { id: purchaseId }, data: { status: "FILLED", executionTxid: txid, filledAt: new Date(), platformFeeZec } });
  return getNftItemById(itemId);
}

// ---------- Zcash address pool (see PregeneratedZcashAddress in schema.prisma) ----------
// ZODD (2026-09-20): lets zcashReal.ts's generateOrderAddress hand out a
// BUY/SELL address instantly instead of paying the ~15-20s zingo-cli cost
// on every single click -- see the big comment on the model itself for why.

/** Atomically claims one never-yet-used address from the pool, same
 * FOR UPDATE SKIP LOCKED-inside-a-CTE pattern as claimRandomUnmintedNftItem
 * above: two orders claiming in the same instant always land on two
 * different rows, never race for the same one. Oldest-first (not random --
 * unlike NftItem there's no reason to shuffle these) so the pool behaves
 * like a plain queue. Returns null if the pool is empty; the caller falls
 * back to generating one on demand in that case. */
export async function claimPregeneratedZcashAddress(orderId: string): Promise<{
  address: string;
  saplingDiversifierHex: string | null;
  orchardDiversifierHex: string | null;
} | null> {
  const rows = await prisma.$queryRaw<
    Array<{ address: string; saplingDiversifierHex: string | null; orchardDiversifierHex: string | null }>
  >`
    WITH picked AS (
      SELECT id FROM "PregeneratedZcashAddress"
      WHERE "claimedAt" IS NULL
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "PregeneratedZcashAddress" AS p
    SET "claimedAt" = now(), "claimedByOrderId" = ${orderId}
    FROM picked
    WHERE p.id = picked.id
    RETURNING p.address, p."saplingDiversifierHex", p."orchardDiversifierHex"
  `;
  return rows[0] ?? null;
}

/** Adds one freshly-generated (still fully valid, just not yet claimed by
 * an order) address to the pool. Called only by maybeTopUpAddressPool's
 * background refill loop in zcashReal.ts -- never on the interactive
 * buy/sell path, which only ever reads via claimPregeneratedZcashAddress
 * above. */
export async function addPregeneratedZcashAddress(
  address: string,
  saplingDiversifierHex: string | null,
  orchardDiversifierHex: string | null
): Promise<void> {
  await prisma.pregeneratedZcashAddress.create({ data: { address, saplingDiversifierHex, orchardDiversifierHex } });
}

/** How many unclaimed addresses are currently sitting in the pool -- what
 * the background top-up loop checks against its target stock level. */
export async function countUnclaimedPregeneratedZcashAddresses(): Promise<number> {
  return prisma.pregeneratedZcashAddress.count({ where: { claimedAt: null } });
}
