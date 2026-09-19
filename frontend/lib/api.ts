const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

async function req(path: string, opts?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: opts?.body ? { "Content-Type": "application/json", ...(opts?.headers ?? {}) } : opts?.headers,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `error ${res.status}`);
  return body;
}

/** Brai, 2026-09-11: "quiero que puedas trabajar con Ycash y Zcash" -- every
 * token/order/pending-creation now carries which chain it trades on. */
export type Currency = "ZEC" | "YEC";

export interface TokenSummary {
  symbol: string;
  name: string;
  totalSupply: number;
  currency: Currency;
  priceZec: number;
  /** % change vs. ~24h ago; null when the token isn't old enough yet to have one. */
  priceChange24hPct: number | null;
  priceChangeSinceLaunchPct: number | null;
  marketCapZec: number;
  realZecReserves: number;
  tokensSold: number;
  graduated: boolean;
  graduationThresholdZec: number;
  // Brai, 2026-09-19: "LA PIRAMIDE" -- true only for a token created
  // through the reliquia-gated flow; it graduates at graduationThresholdZec
  // (3 ZEC) instead of the normal default.
  isPyramidToken: boolean;
  createdAt: string;
  logoDataUrl: string | null;
  description: string | null;
  twitterUrl: string | null;
  websiteUrl: string | null;
  fee: {
    tradeFeeBps: number;
    creatorFeeBps: number;
    creatorPayoutAddress: string | null;
    creatorFeeAccruedZec: number;
    creatorFeeTotalPaidZec: number;
    lastFeePayoutAt: string | null;
  };
  onChain:
    | {
        simulated: true;
        issuedTxid: string;
        issuedBlock: number;
        finalizedTxid: string;
        finalizedBlock: number;
      }
    | {
        simulated: false;
        txid: string;
        explorerUrl: string;
      };
}

export interface PricePoint {
  priceZec: number;
  mcapZec: number;
  createdAt: string;
}

export interface Trade {
  side: "BUY" | "SELL";
  currency: Currency;
  tokenAmount: number;
  zecAmount: number;
  createdAt: string;
}

export interface GlobalTrade extends Trade {
  symbol: string;
}

interface ModeResponse {
  zcashMode: "real" | "mock";
  tokenCreateFeeZec: number;
  /** Brai, 2026-09-11: per-currency mode/fee/first-buy-cap, so the
   * create-token currency picker can show accurate numbers for whichever
   * one is selected -- see /api/mode in server.ts. */
  currencies: Record<Currency, { mode: "real" | "mock"; createFeeZec: number; maxFirstBuyZec: number }>;
}
let modePromise: Promise<ModeResponse> | null = null;

/** Formats a ZEC amount as a USD string, e.g. "$1,234.56" or "<$0.01" for
 * dust amounts that would otherwise round to "$0.00". `usdRate` is the
 * live ZEC/USD price from useZecUsdPrice()/api.getZecUsdPrice(); returns
 * null when there's no rate yet so callers can hide the figure entirely
 * instead of showing a wrong "$0.00". */
export function formatUsd(zecAmount: number, usdRate: number | null): string | null {
  if (usdRate === null || !Number.isFinite(zecAmount)) return null;
  const usd = zecAmount * usdRate;
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return usd.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: usd < 1 ? 4 : 2 });
}

/** Same input as formatUsd, but abbreviated ($3.2K, $1.4M, $2.1B) instead of
 * spelling out every digit -- Brai, 2026-09-08: "quiero que sea algo asi
 * como 1,3 1,5 5 10... pero no asi 0.000000000000049292 porque esta
 * complejo de entender". A per-token price is unavoidably a tiny fraction
 * once a token has a billion-token supply (that's just what the number
 * is), so this is used for the numbers that ARE meant to read as normal
 * human-scale figures -- market cap, volume -- rather than for the raw
 * per-token price itself. Below $1000 this reads identically to formatUsd
 * (still "<$0.01" for genuine dust, so nothing here hides that a token is
 * this early). */
export function formatCompactUsd(zecAmount: number, usdRate: number | null): string | null {
  if (usdRate === null || !Number.isFinite(zecAmount)) return null;
  const usd = zecAmount * usdRate;
  if (usd > 0 && usd < 0.01) return "<$0.01";
  const abs = Math.abs(usd);
  if (abs >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(usd / 1_000).toFixed(2)}K`;
  return usd.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: usd < 1 ? 4 : 2 });
}

/** Brai, 2026-09-07: the backend's disambiguation bump (pickAndReserveAmount
 * in zcashReal.ts) nudges an order's zecAmount by 1 zatoshi at a time to
 * keep it unique -- invisible on its own, but raw JS float math (e.g.
 * 0.0001 + 0.00000001) routinely lands on values like
 * 0.000150000000000000001 when printed directly, which read as broken.
 * ZEC only has 8 decimal places, period (1 zatoshi = 1e-8 ZEC), so
 * rounding to 8 and trimming trailing zeros always recovers the true
 * value with zero precision loss -- this is display-only, never used for
 * the actual amount sent to the backend/QR/payment URI. */
export function formatZec(zecAmount: number): string {
  if (!Number.isFinite(zecAmount)) return String(zecAmount);
  return Number(zecAmount.toFixed(8)).toString();
}

export const api = {
  createWallet: () => req("/api/wallets", { method: "POST" }),
  importWallet: (words: string[]): Promise<{ walletId: string; walletTag: string }> =>
    req("/api/wallets/import", { method: "POST", body: JSON.stringify({ words }) }),
  // Brai, 2026-09-18: "conectas la extension de la wallet NOIR" -- 2-step
  // sign-in-with-wallet flow. getNoirChallenge() gets a one-time message
  // to have the extension sign; connectNoir() sends that signature back so
  // the backend can verify it and return/create the matching wallet. See
  // POST /api/wallets/noir-challenge and /connect-noir in server.ts.
  getNoirChallenge: (): Promise<{ nonce: string; message: string }> =>
    req("/api/wallets/noir-challenge", { method: "POST" }),
  connectNoir: (data: {
    nonce: string;
    signature: string;
    pubkey: string;
    transparentAddress: string;
    shieldedAddress: string;
  }): Promise<{ walletId: string; walletTag: string; noirAddress: string }> =>
    req("/api/wallets/connect-noir", { method: "POST", body: JSON.stringify(data) }),
  // Cached for the life of the page load: this never changes mid-session,
  // and every "is this simulated?" note (and the create-fee display) needs it.
  getMode: (): Promise<ModeResponse> => {
    if (!modePromise) modePromise = req("/api/mode");
    return modePromise;
  },
  // Live ZEC/USD rate, server-cached (see backend zecPrice.ts). Not memoized
  // like getMode -- this one actually changes, so useZecUsdPrice() (lib/zecPrice.tsx)
  // polls it periodically instead of fetching once.
  getZecUsdPrice: (): Promise<{ usd: number | null; updatedAt: string | null }> => req("/api/zec-usd-price"),
  portfolio: (
    walletId: string
  ): Promise<{
    walletTag: string;
    holdings: { symbol: string; name: string; amount: number; priceZec: number; currency: Currency }[];
    // Last ZEC address this wallet used for a sell payout, if any -- lets
    // the Sell modal pre-fill it instead of asking to paste it in again.
    defaultRefundAddress: string | null;
  }> => req(`/api/wallets/${walletId}/portfolio`),
  listTokens: (): Promise<TokenSummary[]> => req("/api/tokens"),
  getToken: (symbol: string): Promise<TokenSummary> => req(`/api/tokens/${symbol}`),
  getHistory: (symbol: string): Promise<PricePoint[]> => req(`/api/tokens/${symbol}/history`),
  getTrades: (symbol: string): Promise<Trade[]> => req(`/api/tokens/${symbol}/trades`),
  getRecentTradesGlobal: (): Promise<GlobalTrade[]> => req(`/api/trades`),
  // Reserves the symbol/name/profile and returns a one-time address for the
  // creator to pay the create fee from their own wallet -- the token itself
  // only actually exists once that payment is detected (poll getTokenCreation).
  createToken: (data: {
    symbol: string;
    name: string;
    totalSupply?: number;
    creatorWalletId: string;
    // Brai, 2026-09-11: "quiero que puedas trabajar con Ycash y Zcash" --
    // which currency this token trades in for its whole life. Omit for ZEC
    // (the backend defaults to it too).
    currency?: Currency;
    creatorPayoutAddress?: string;
    logoDataUrl?: string;
    description?: string;
    twitterUrl?: string;
    websiteUrl?: string;
    // Brai, 2026-09-08: "que puedas hacer una first buy" -- optional creator
    // buy bundled into the same payment as the create fee. See the cap
    // check in backend/src/server.ts's POST /api/tokens for why this can't
    // always be as large as requested.
    firstBuyZec?: number;
    // Brai, 2026-09-19: "LA PIRAMIDE" -- only honored by the backend when
    // this wallet currently owns a reliquia (see checkPyramidAccess below);
    // otherwise the request is rejected with a 403.
    isPyramidToken?: boolean;
  }): Promise<{
    creationId: string;
    currency: Currency;
    zecAddress: string;
    zecAmount: number;
    createFeeZec: number;
    firstBuyZec: number;
    memo: string;
    status: "PENDING";
  }> => req("/api/tokens", { method: "POST", body: JSON.stringify(data) }),
  getTokenCreation: (
    id: string
  ): Promise<{
    status: "PENDING" | "CREATED" | "EXPIRED" | "FAILED";
    resultSymbol?: string;
    currency: Currency;
    zecAddress: string | null;
    expectedZecAmount: number;
  }> => req(`/api/token-creations/${id}`),
  buy: (
    data: { walletId: string; symbol: string; zecAmount: number; refundAddress: string }
  ): Promise<{ orderId: string; currency: Currency; zecAddress: string; zecAmount: number; memo: string; status: "PENDING" }> =>
    req("/api/orders/buy", { method: "POST", body: JSON.stringify(data) }),
  sell: (
    data: { walletId: string; symbol: string; tokenAmount: number; refundAddress: string }
  ): Promise<{ id: string; currency: Currency; zecAmount: number; status: string }> =>
    req("/api/orders/sell", { method: "POST", body: JSON.stringify(data) }),
  getOrder: (id: string) => req(`/api/orders/${id}`),

  // ---------- NFT whitelist (Twitter, manually reviewed) ----------
  // Brai, 2026-09-18: "necesito que me hagas la parte de la whitelist de
  // los nft" -- see the matching routes in server.ts. Nothing here talks
  // to Twitter/X directly; it's a submit-and-wait-for-Brai queue.
  getNftWhitelistConfig: (): Promise<{ tweetUrl: string | null; twitterHandle: string | null; quoteCaption: string }> =>
    req("/api/nft/whitelist/config"),
  // Brai, 2026-09-18 (v12, URGENT, REMOVED): there used to be a
  // submitNftWhitelist(walletAddress, twitterHandle) here that hit the
  // backend directly with a client-supplied handle -- exactly the "type
  // any handle you want" hole Brai reported people abusing. The wizard now
  // posts to the frontend's own /api/nft/whitelist/submit route (see
  // app/nft/whitelist/page.tsx submit()), which supplies the handle itself
  // from a signed cookie set only by a real X OAuth login. Do not re-add a
  // client-facing helper that takes a raw twitterHandle string.
  // Brai, 2026-09-19: mint page -- eligibility check for the CONNECTED
  // wallet (by walletId, not a pasted address), same match the backend's
  // /api/nft/mint gates on.
  getNftWhitelistStatusByWallet: (walletId: string): Promise<{ entry: NftWhitelistEntry | null }> =>
    req(`/api/nft/whitelist/status-by-wallet/${encodeURIComponent(walletId)}`),
  getNftWhitelistStatus: (walletAddress: string): Promise<{ entry: NftWhitelistEntry | null }> =>
    req(`/api/nft/whitelist/status/${encodeURIComponent(walletAddress)}`),
  // Brai, 2026-09-18 (v8): "si pones tu HANDLE y ya suscribiste te vaya a
  // la 4ta directamente" -- recognizes a returning applicant by handle
  // alone (works even without the localStorage-remembered address).
  getNftWhitelistStatusByHandle: (handle: string): Promise<{ entry: NftWhitelistPublicStatus | null }> =>
    req(`/api/nft/whitelist/by-handle/${encodeURIComponent(handle)}`),
  // Admin-only (ADMIN_TOKEN, entered by Brai himself -- see
  // AdminNftWhitelistPage). Never called for a regular visitor.
  adminListNftWhitelist: (
    adminToken: string,
    status?: "PENDING" | "APPROVED" | "REJECTED"
  ): Promise<{ entries: NftWhitelistEntry[] }> =>
    req(`/api/admin/nft-whitelist${status ? `?status=${status}` : ""}`, { headers: { "x-admin-token": adminToken } }),
  adminReviewNftWhitelist: (
    adminToken: string,
    id: string,
    status: "APPROVED" | "REJECTED",
    note?: string
  ): Promise<NftWhitelistEntry> =>
    req(`/api/admin/nft-whitelist/${id}/review`, {
      method: "POST",
      headers: { "x-admin-token": adminToken },
      body: JSON.stringify({ status, note }),
    }),

  // ---------- NFT marketplace ----------
  // Brai, 2026-09-18: "empeza a deployar la pagina" -- mint (pay -> random
  // piece), secondary market (list/unlist/buy), and the wallet-free public
  // activity feed. Same real-ZEC payment mechanics as buy()/createToken()
  // above (one-time address + memo, poll for FILLED/CREATED).
  getNftCollection: (slug: string): Promise<NftCollection> => req(`/api/nft/collections/${slug}`),
  getNftItems: (
    slug: string,
    opts?: {
      status?: "listed" | "not_listed" | "all";
      ownerWalletId?: string;
      sort?: "price_asc" | "price_desc" | "edition";
      page?: number;
    }
  ): Promise<{ items: NftItem[]; total: number; page: number }> => {
    const params = new URLSearchParams();
    if (opts?.status) params.set("status", opts.status);
    if (opts?.ownerWalletId) params.set("ownerWalletId", opts.ownerWalletId);
    if (opts?.sort) params.set("sort", opts.sort);
    if (opts?.page) params.set("page", String(opts.page));
    const qs = params.toString();
    return req(`/api/nft/collections/${slug}/items${qs ? `?${qs}` : ""}`);
  },
  // Brai, 2026-09-19 (v14): Traits tab on /nft/test -- see the backend's
  // getNftTraitCounts for why this is its own aggregation endpoint.
  getNftTraits: (slug: string): Promise<{ traits: NftTraitCount[] }> => req(`/api/nft/collections/${slug}/traits`),
  getNftItem: (slug: string, editionNumber: number): Promise<{ collection: { slug: string; name: string; currency: Currency }; item: NftItem }> =>
    req(`/api/nft/collections/${slug}/items/${editionNumber}`),
  getWalletNfts: (walletId: string): Promise<NftItem[]> => req(`/api/wallets/${walletId}/nfts`),
  mintNft: (data: { walletId: string; collectionSlug: string; quantity?: number }): Promise<NftMintResult> =>
    req("/api/nft/mint", { method: "POST", body: JSON.stringify(data) }),
  getNftMint: (id: string): Promise<NftPendingMint> => req(`/api/nft/mints/${id}`),
  // Brai, 2026-09-19: mint page quantity stepper -- how many this wallet
  // has already minted, so the stepper can cap itself at what's left of
  // the 10-per-wallet limit.
  getNftWalletMintCount: (collectionSlug: string, walletId: string): Promise<{ count: number }> =>
    req(`/api/nft/mint-count/${collectionSlug}/${encodeURIComponent(walletId)}`),
  listNftItem: (itemId: string, data: { walletId: string; priceZec: number; payoutAddress: string }): Promise<NftItem> =>
    req(`/api/nft/items/${itemId}/list`, { method: "POST", body: JSON.stringify(data) }),
  unlistNftItem: (itemId: string, walletId: string): Promise<NftItem> =>
    req(`/api/nft/items/${itemId}/unlist`, { method: "POST", body: JSON.stringify({ walletId }) }),
  buyNftItem: (itemId: string, walletId: string): Promise<NftPurchaseInit> =>
    req(`/api/nft/items/${itemId}/buy`, { method: "POST", body: JSON.stringify({ walletId }) }),
  getNftPurchase: (id: string): Promise<NftPurchaseOrder> => req(`/api/nft/purchases/${id}`),
  getNftActivity: (): Promise<NftActivity[]> => req("/api/nft/activity"),

  // ---------- Forge: papiros -> fragmentos -> reliquias ----------
  getNftForgeInventory: (slug: string, walletId: string): Promise<{ inventory: NftForgeInventory; recipes: NftForgeRecipes }> =>
    req(`/api/nft/collections/${slug}/forge?walletId=${encodeURIComponent(walletId)}`),
  craftNft: (slug: string, data: { walletId: string; fromTier: "PAPIRO" | "FRAGMENTO" }): Promise<NftItem> =>
    req(`/api/nft/collections/${slug}/forge/craft`, { method: "POST", body: JSON.stringify(data) }),

  // ---------- LA PIRAMIDE ----------
  // Brai, 2026-09-19: "tener la reliquia hace que tengas el privilegio de
  // entrar a esa pestaña" -- used by the Launchpad's Pyramid section to
  // show/hide the create form; the real enforcement is server-side (see
  // createToken's isPyramidToken and the backend's POST /api/tokens).
  checkPyramidAccess: (walletId: string): Promise<{ hasAccess: boolean }> =>
    req(`/api/pyramid/access?walletId=${encodeURIComponent(walletId)}`),
};

export interface NftWhitelistEntry {
  id: string;
  walletAddress: string;
  twitterHandle: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  claimedAt: string | null;
  claimedCount: number;
}

// Brai, 2026-09-18 (v9, URGENT PRIVACY FIX): the by-handle lookup is
// unauthenticated (anyone can type anyone's handle), so the backend never
// sends walletAddress or reviewNote for it -- only status-relevant fields.
export interface NftWhitelistPublicStatus {
  id: string;
  twitterHandle: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
  reviewedAt: string | null;
  claimedAt: string | null;
}

// ---------- NFT marketplace ----------
export interface NftCollection {
  slug: string;
  name: string;
  description: string | null;
  currency: Currency;
  totalSupply: number;
  mintPriceZec: number;
  coverImageDataUrl: string | null;
  mintedCount: number;
  remaining: number;
  soldOut: boolean;
  createdAt: string;
  // Brai, 2026-09-19: presale schedule -- see mintPhaseAt in the backend's
  // store.ts. mintPhase is computed server-side (never trust the client
  // clock): "locked" | "whitelist" | "public".
  whitelistStartsAt: string | null;
  publicStartsAt: string | null;
  mintPhase: "locked" | "whitelist" | "public";
  maxMintsPerWallet: number;
  whitelistFreeMintLimit: number;
  floorZec: number | null;
  listedCount: number;
  salesCount: number;
  volumeZec: number;
}

export interface NftTraitCount {
  trait: string;
  value: string;
  count: number;
}

export interface NftItem {
  id: string;
  collectionId: string;
  editionNumber: number;
  name: string | null;
  imageDataUrl: string | null;
  traits: Record<string, string> | null;
  mintedAt: string | null;
  mintPaymentTxid: string | null;
  ownerInternalWalletId: string | null;
  // Only meaningful to the item's own owner looking at their own piece --
  // never rendered on the public grid (see the NFT market page's own note,
  // and the wallet-address privacy fix this session for why that matters).
  ownerWalletTag: string | null;
  listedPriceZec: number | null;
  listedAt: string | null;
  listedPayoutAddress: string | null;
  // Brai, 2026-09-19: "habra 3 tipos de nfts.. los papiros, los fragmentos
  // y las reliquias" -- see the Forge tab.
  tier: "PAPIRO" | "FRAGMENTO" | "RELIQUIA";
}

// Brai, 2026-09-19: the Forge tab's inventory + craft flow -- 5 PAPIRO ->
// 1 FRAGMENTO, 3 FRAGMENTO -> 1 RELIQUIA (see FORGE_RECIPES in the backend).
export interface NftForgeInventory {
  papiro: number;
  fragmento: number;
  reliquia: number;
}

export interface NftForgeRecipes {
  PAPIRO: { toTier: "FRAGMENTO"; count: number };
  FRAGMENTO: { toTier: "RELIQUIA"; count: number };
}

export type NftMintResult =
  | {
      free: true;
      status: "CREATED";
      collectionSlug: string;
      itemId: string;
      editionNumber: number;
      itemIds: string[];
      editionNumbers: number[];
      quantity: number;
    }
  | { mintId: string; currency: Currency; zecAddress: string; zecAmount: number; quantity: number; memo: string; status: "PENDING" };

export interface NftPendingMint {
  id: string;
  collectionId: string;
  internalWalletId: string;
  currency: Currency;
  zecAddress: string | null;
  expectedZecAmount: number;
  status: "PENDING" | "CREATED" | "EXPIRED" | "FAILED";
  resultItemId: string | null;
  // Brai, 2026-09-19: quantity minting -- how many pieces this payment
  // covers, and (once CREATED) every piece it actually claimed.
  quantity: number;
  resultItemIds: string[];
  createdAt: string;
  resultItem?: NftItem;
  resultItems?: NftItem[];
}

export interface NftPurchaseInit {
  purchaseId: string;
  currency: Currency;
  zecAddress: string;
  zecAmount: number;
  memo: string;
  status: "PENDING";
}

export interface NftPurchaseOrder {
  id: string;
  itemId: string;
  currency: Currency;
  zecAddress: string | null;
  payoutAddress: string;
  expectedZecAmount: number;
  status: "PENDING" | "FILLED" | "EXPIRED" | "FAILED";
  executionTxid: string | null;
  createdAt: string;
  filledAt: string | null;
}

export interface NftActivity {
  kind: "MINT" | "LIST" | "SALE";
  collectionSlug: string;
  editionNumber: number;
  name: string | null;
  priceZec: number;
  currency: Currency;
  createdAt: string;
}
