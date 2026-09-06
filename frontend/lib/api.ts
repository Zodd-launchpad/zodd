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
  marketCapZec: number;
  realZecReserves: number;
  tokensSold: number;
  graduated: boolean;
  graduationThresholdZec: number;
  createdAt: string;
  onChain: {
    simulated: true;
    issuedTxid: string;
    issuedBlock: number;
    finalizedTxid: string;
    finalizedBlock: number;
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

export const api = {
  createWallet: () => req("/api/wallets", { method: "POST" }),
  portfolio: (walletId: string) => req(`/api/wallets/${walletId}/portfolio`),
  listTokens: (): Promise<TokenSummary[]> => req("/api/tokens"),
  getToken: (symbol: string): Promise<TokenSummary> => req(`/api/tokens/${symbol}`),
  getHistory: (symbol: string): Promise<PricePoint[]> => req(`/api/tokens/${symbol}/history`),
  getTrades: (symbol: string): Promise<Trade[]> => req(`/api/tokens/${symbol}/trades`),
  createToken: (data: { symbol: string; name: string; totalSupply?: number; creatorWalletId: string }) =>
    req("/api/tokens", { method: "POST", body: JSON.stringify(data) }),
  buy: (data: { walletId: string; symbol: string; zecAmount: number }) =>
    req("/api/orders/buy", { method: "POST", body: JSON.stringify(data) }),
  sell: (data: { walletId: string; symbol: string; tokenAmount: number; refundAddress: string }) =>
    req("/api/orders/sell", { method: "POST", body: JSON.stringify(data) }),
  getOrder: (id: string) => req(`/api/orders/${id}`),
};
