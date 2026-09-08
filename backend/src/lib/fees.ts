/**
 * Trading fee: 2% on every buy and every sell, split evenly: 1% accrues to
 * the token's creator and is auto-paid out to their Zcash address every
 * 24h (see feeDistributor.ts); the other 1% stays with the platform (kept
 * simply by never paying it out -- the wallet already received/retained
 * it in full, no separate transfer needed).
 *
 * This is the "fairer platform" hook: unlike SHLD.fun (where the whole fee
 * goes to the platform), ZODD splits it so creators actually earn from
 * their token's trading volume.
 */

export const TRADE_FEE_BPS = 200; // 2% total
export const CREATOR_FEE_BPS = 100; // 1% of the trade goes to the creator
export const PLATFORM_FEE_BPS = TRADE_FEE_BPS - CREATOR_FEE_BPS; // 1% stays with the platform

export interface FeeSplit {
  /** Net amount left after taking the full 2% fee off `grossZec`. */
  net: number;
  /** Total fee taken (2% of gross). */
  totalFee: number;
  /** The creator's 1% share. */
  creatorFee: number;
  /** The platform's 1% share. */
  platformFee: number;
}

export function splitFee(grossZec: number): FeeSplit {
  const totalFee = (grossZec * TRADE_FEE_BPS) / 10_000;
  const creatorFee = (grossZec * CREATOR_FEE_BPS) / 10_000;
  const platformFee = totalFee - creatorFee;
  return { net: grossZec - totalFee, totalFee, creatorFee, platformFee };
}

/**
 * One-time token-creation fee, paid by the CREATOR (from their own wallet,
 * to a generated one-time address) before the token exists -- same model as
 * SHLD.fun ("pay the one-time 0.01 ZEC create fee from any Zcash wallet").
 * Overridable via env var so real-money testing doesn't have to spend a
 * full 0.01 ZEC every time; the intended production value is 0.01.
 */
export const TOKEN_CREATE_FEE_ZEC = Number(process.env.ZCASH_TOKEN_CREATE_FEE_ZEC ?? 0.01);

/**
 * Brai, 2026-09-08: "se puede hacer que mi wallet en especial no me pida
 * fee para crear tokens? ... que solo me cobre 0.0001 pero solo a mi
 * wallet? el resto no" -- an optional discount on the one-time create fee,
 * gated by the internal wallet id (InternalWallet.id, a cuid -- not the
 * short display tag). Off for everyone by default:
 * DISCOUNTED_CREATE_FEE_WALLET_IDS is empty unless set in Railway, so
 * every creator pays the normal TOKEN_CREATE_FEE_ZEC. Which wallet(s), if
 * any, get the discount is configured only via that env var
 * (comma-separated ids) -- never hardcoded here -- same reasoning as
 * ADMIN_TOKEN: it stays something only Brai controls from Railway, not
 * something visible in the repo.
 */
const DISCOUNTED_CREATE_FEE_WALLET_IDS = new Set(
  (process.env.DISCOUNTED_CREATE_FEE_WALLET_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);
export const DISCOUNTED_CREATE_FEE_ZEC = Number(process.env.DISCOUNTED_CREATE_FEE_ZEC ?? 0.0001);

/** The actual create fee a given wallet should be charged: the discounted
 * amount if their internal wallet id is in DISCOUNTED_CREATE_FEE_WALLET_IDS,
 * otherwise the normal TOKEN_CREATE_FEE_ZEC. */
export function createFeeZecFor(walletId: string): number {
  return DISCOUNTED_CREATE_FEE_WALLET_IDS.has(walletId) ? DISCOUNTED_CREATE_FEE_ZEC : TOKEN_CREATE_FEE_ZEC;
}

/**
 * Brai, 2026-09-08: "deja 0.1 de first buy maximo" -- product-level ceiling
 * on the optional bundled first buy at token creation (see PendingTokenCreation
 * in schema.prisma and the /api/tokens route in server.ts). Separate from
 * MAX_PAYOUT_ZEC (zcashReal.ts's per-payment safety cap): that one is a
 * "defense in depth" backstop against a bug, this one is the actual product
 * decision, so it gets its own clear error message rather than borrowing
 * the safety cap's.
 */
export const MAX_FIRST_BUY_ZEC = Number(process.env.ZODD_MAX_FIRST_BUY_ZEC ?? 0.1);

/**
 * Brai, 2026-09-07: "si el minimo a enviar no supera el fee no te deje
 * vender" -- then, clarifying: "yo no quiero perder, asi que el fee lo
 * tiene que pagar el vendedor... de ahi saco mi 1% y el otro 1% para el
 * creador y el resto le llega al vendedor... si no supera el fee, no se
 * puede vender... es para q la plataforma no pierda dinero".
 *
 * A real ZEC send (sendPayout, see zcashReal.ts) always costs the platform
 * wallet a real Zcash network/miner fee of roughly 0.0001 ZEC -- that's a
 * protocol fact, paid out of whichever wallet initiates the transaction, no
 * matter what amount we tell it to send. Previously the platform just
 * absorbed that as a cost; now, per the above, the SELLER's share absorbs
 * it instead, so the platform never nets negative on a sell: the creator's
 * 1% and the platform's 1% (splitFee below) are computed on the full gross
 * zecOut exactly as before and are untouched by this, and only what's LEFT
 * for the seller (netPayout) has the network fee taken off it before
 * sending. If that would leave nothing (or less than nothing) for the
 * seller, the sell is blocked outright -- see computeSellerPayout, used in
 * server.ts's /api/orders/sell before ever calling sendPayout.
 */
export const NETWORK_FEE_ZEC = 0.0001;

export interface SellPayoutResult {
  /** What actually gets sent to the seller: netPayout minus the network
   * fee. Only meaningful when `blocked` is false. */
  sellerPayout: number;
  /** True when sellerPayout wouldn't be positive -- the sell should be
   * rejected before ever calling sendPayout. */
  blocked: boolean;
}

export function computeSellerPayout(netPayout: number): SellPayoutResult {
  const sellerPayout = netPayout - NETWORK_FEE_ZEC;
  return { sellerPayout, blocked: sellerPayout <= 0 };
}
