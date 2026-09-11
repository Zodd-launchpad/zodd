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
};
