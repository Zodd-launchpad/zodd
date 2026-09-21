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
 * Brai, 2026-09-11: "quiero que puedas trabajar con Ycash y Zcash" -- YEC
 * gets its own flat create fee (no wallet-gated discount yet -- that was
 * asked for specifically as a ZEC-only perk, see createFeeZecFor above).
 * Same 0.01 default as ZEC purely for simplicity; override independently
 * via env var if Brai ever wants the two to diverge.
 */
export const TOKEN_CREATE_FEE_YEC = Number(process.env.YCASH_TOKEN_CREATE_FEE_YEC ?? 0.01);

/**
 * Brai, 2026-09-19: "yo sigo minteando casi gratis a 0.000001 por cada
 * nft... las wallet del publico mintean a 0.0025. Las wallets de los
 * handle que estan aprobados mintean gratis solo 5 nfts." -- three-tier
 * NFT mint pricing, same shape as the create-fee discount above:
 *   - an "owner" wallet (Brai's own, wallet-id gated) always pays
 *     OWNER_NFT_MINT_PRICE_ZEC regardless of the collection's normal price
 *   - an APPROVED whitelist wallet mints free, up to
 *     NFT_WHITELIST_FREE_MINT_LIMIT pieces (see claimFreeNftWhitelistMint
 *     in store.ts) -- anything beyond that falls through to the normal
 *     paid price like anyone else
 *   - everyone else pays NftCollection.mintPriceZec as-is (that field is
 *     the "public" price now -- set it to 0.0025 via the collection admin
 *     routes)
 * DISCOUNTED_NFT_MINT_WALLET_IDS defaults to whatever's already in
 * DISCOUNTED_CREATE_FEE_WALLET_IDS (Brai's "mi wallet en especial" from
 * the create-fee discount above) so this works immediately without a new
 * Railway variable -- set DISCOUNTED_NFT_MINT_WALLET_IDS explicitly later
 * if the NFT owner list should ever differ from the token-create one.
 */
const DISCOUNTED_NFT_MINT_WALLET_IDS = new Set(
  (process.env.DISCOUNTED_NFT_MINT_WALLET_IDS ?? process.env.DISCOUNTED_CREATE_FEE_WALLET_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);
export const OWNER_NFT_MINT_PRICE_ZEC = Number(process.env.OWNER_NFT_MINT_PRICE_ZEC ?? 0.000001);

export function isOwnerNftWallet(walletId: string): boolean {
  return DISCOUNTED_NFT_MINT_WALLET_IDS.has(walletId);
}

/** The price a given wallet should pay to mint from `collection`, in ZEC.
 * Does NOT account for the free whitelist allowance -- that's handled
 * separately by claimFreeNftWhitelistMint, which is tried first and only
 * falls through to this price when the free allowance is exhausted or the
 * wallet was never whitelisted. */
export function nftMintPriceZecFor(walletId: string, collectionMintPriceZec: number): number {
  return isOwnerNftWallet(walletId) ? OWNER_NFT_MINT_PRICE_ZEC : collectionMintPriceZec;
}

/** Brai, 2026-09-19: "pone un mensaje limite por cada wallet 10" -- a flat
 * cap on how many pieces of ONE collection a single wallet can ever mint
 * (free + paid combined), independent of price tier. Owner wallets are
 * NOT exempt -- Brai didn't ask for that, and it's an easy constant to
 * raise later if he does. */
export const NFT_MAX_MINTS_PER_WALLET = Number(process.env.NFT_MAX_MINTS_PER_WALLET ?? 10);

/** How many pieces an APPROVED whitelist wallet can mint for free before
 * paying the normal price like anyone else. */
export const NFT_WHITELIST_FREE_MINT_LIMIT = Number(process.env.NFT_WHITELIST_FREE_MINT_LIMIT ?? 5);

/** Brai, 2026-09-19: "todos sigan un numero tipo TIER 1 #1321... si puede
 * empezar en 1300 la cuenta mejor asi no parece que recien empezamos" --
 * each tier's edition-number counter (PAPIRO/FRAGMENTO/RELIQUIA, each
 * independent -- see the NftItem.editionNumber comment) starts here
 * instead of at 1, so the collection doesn't read as brand new. */
export const NFT_TIER_NUMBERING_START = Number(process.env.NFT_TIER_NUMBERING_START ?? 1300);

/** Brai, 2026-09-19: "cada NFT tiene que generar una transaccion... los que
 * hacen free mint tienen que hacer una tx con su wallet y cobrarle muy
 * poco" -- a whitelist free claim is no longer $0: it still goes through
 * the normal pay-to-a-generated-address flow (see /api/nft/mint), just at
 * this token price instead of the collection's full mintPriceZec, so a
 * real on-chain tx backs every mint. Fixed ZEC amount (Brai chose this over
 * a live USD conversion) -- small enough to just cover network fees.
 *
 * Brai, 2026-09-21: "toco 5 free mint y me quiere cobrar 0.005... deberia
 * cobrarme solo el fee" -- this is now charged ONCE per free-mint
 * transaction, not once per piece. A wallet claiming 1 free NFT or all 5
 * at once pays the exact same NFT_FREE_MINT_FEE_ZEC either way -- see
 * /api/nft/mint in server.ts, which no longer multiplies this by quantity. */
export const NFT_FREE_MINT_FEE_ZEC = Number(process.env.NFT_FREE_MINT_FEE_ZEC ?? 0.001);

/** Currency-aware version of createFeeZecFor -- dispatches to the right
 * constant/discount logic for whichever currency the creator picked. */
export function createFeeFor(currency: "ZEC" | "YEC", walletId: string): number {
  return currency === "YEC" ? TOKEN_CREATE_FEE_YEC : createFeeZecFor(walletId);
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

/**
 * Brai, 2026-09-19: "el 1% de toda compra y venta de nft es para la
 * plataforma" -- unlike a token trade (TRADE_FEE_BPS above), an NFT
 * collection has no separate creator to split a fee with: it's the
 * platform's own collection, so the whole 1% goes to the platform. Same
 * "the seller's side absorbs it, buyer always pays exactly the listed
 * price" philosophy as splitFee/computeSellerPayout: this comes off the
 * gross sale amount FIRST, then computeSellerPayout takes the real network
 * fee off what's left for the seller (see handleNftPurchasePayment in
 * server.ts) -- so the platform's 1% is never affected by how small the
 * network fee makes the seller's remainder, same as creatorFee/platformFee
 * for token sells.
 */
export const NFT_PLATFORM_FEE_BPS = 100; // 1%

export interface NftFeeSplit {
  /** What's left for the seller after the platform's 1% cut, before the
   * network-fee deduction in computeSellerPayout. */
  net: number;
  /** The platform's 1% share of the sale. */
  platformFee: number;
}

export function splitNftFee(grossZec: number): NftFeeSplit {
  const platformFee = (grossZec * NFT_PLATFORM_FEE_BPS) / 10_000;
  return { net: grossZec - platformFee, platformFee };
}
