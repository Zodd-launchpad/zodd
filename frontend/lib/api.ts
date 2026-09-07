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

export interface TokenSummary {
  symbol: string;
  name: string;
  totalSupply: number;
  priceZec: number;
  /** % change vs. ~24h ago; null when the token isn't old enough yet to have one. */
  priceChange24hPct: number | null;
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
  tokenAmount: number;
  zecAmount: number;
  createdAt: string;
}

let modePromise: Promise<{ zcashMode: "real" | "mock"; tokenCreateFeeZec: number }> | null = null;

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

export const api = {
  createWallet: () => req("/api/wallets", { method: "POST" }),
  importWallet: (words: string[]): Promise<{ walletId: string; walletTag: string }> =>
    req("/api/wallets/import", { method: "POST", body: JSON.stringify({ words }) }),
  // Cached for the life of the page load: this never changes mid-session,
  // and every "is this simulated?" note (and the create-fee display) needs it.
  getMode: (): Promise<{ zcashMode: "real" | "mock"; tokenCreateFeeZec: number }> => {
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
    holdings: { symbol: string; name: string; amount: number; priceZec: number }[];
    // Last ZEC address this wallet used for a sell payout, if any -- lets
    // the Sell modal pre-fill it instead of asking to paste it in again.
    defaultRefundAddress: string | null;
  }> => req(`/api/wallets/${walletId}/portfolio`),
  listTokens: (): Promise<TokenSummary[]> => req("/api/tokens"),
  getToken: (symbol: string): Promise<TokenSummary> => req(`/api/tokens/${symbol}`),
  getHistory: (symbol: string): Promise<PricePoint[]> => req(`/api/tokens/${symbol}/history`),
  getTrades: (symbol: string): Promise<Trade[]> => req(`/api/tokens/${symbol}/trades`),
  // Reserves the symbol/name/profile and returns a one-time address for the
  // creator to pay the create fee from their own wallet -- the token itself
  // only actually exists once that payment is detected (poll getTokenCreation).
  createToken: (data: {
    symbol: string;
    name: string;
    totalSupply?: number;
    creatorWalletId: string;
    creatorPayoutAddress?: string;
    logoDataUrl?: string;
    description?: string;
    twitterUrl?: string;
    websiteUrl?: string;
  }): Promise<{ creationId: string; zecAddress: string; zecAmount: number; memo: string; status: "PENDING" }> =>
    req("/api/tokens", { method: "POST", body: JSON.stringify(data) }),
  getTokenCreation: (
    id: string
  ): Promise<{ status: "PENDING" | "CREATED" | "EXPIRED" | "FAILED"; resultSymbol?: string; zecAddress: string | null; expectedZecAmount: number }> =>
    req(`/api/token-creations/${id}`),
  buy: (data: { walletId: string; symbol: string; zecAmount: number; refundAddress: string }) =>
    req("/api/orders/buy", { method: "POST", body: JSON.stringify(data) }),
  sell: (data: { walletId: string; symbol: string; tokenAmount: number; refundAddress: string }) =>
    req("/api/orders/sell", { method: "POST", body: JSON.stringify(data) }),
  getOrder: (id: string) => req(`/api/orders/${id}`),
};
