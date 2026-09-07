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
 * Brai, 2026-09-07: "si el minimo a enviar no supera el fee no te deje
 * vender, que haga el calculo" -- a real ZEC send (sendPayout, see
 * zcashReal.ts) costs the platform a Zcash network/miner fee of roughly
 * 0.0001 ZEC, paid separately out of the platform wallet's own balance (the
 * seller always receives the full quoted payout -- see the big comment on
 * MIN_CREATOR_PAYOUT_ZEC in feeDistributor.ts for the same reasoning
 * applied to creator-fee payouts). If someone sells for a net payout at or
 * below that, the platform is spending more on the network fee than the
 * transfer is even worth -- pointless and, at scale, a way to slowly drain
 * the platform wallet via a flood of dust sells. Same 0.001 ZEC floor used
 * for creator payouts (10x the ~0.0001 ZEC fee, comfortable margin without
 * blocking any real trade -- typical sells on this curve are 0.01-0.05
 * ZEC). Checked against the NET payout (after the 2% trade fee), in
 * server.ts's /api/orders/sell, before ever calling sendPayout.
 */
export const MIN_SELL_PAYOUT_ZEC = 0.001;
