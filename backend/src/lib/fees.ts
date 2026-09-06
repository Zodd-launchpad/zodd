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
