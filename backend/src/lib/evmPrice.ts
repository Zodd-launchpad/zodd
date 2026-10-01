/**
 * ETH/USD live price feed -- needed to quote the NEAR-launch $8 fee
 * (nearFees.ts) when the creator pays in native ETH on Base or Robinhood
 * Chain (Brai, 2026-09-30: "eth y usdc de base y robinhood"). USDC
 * payments don't need this (1 USDC unit == $1, no feed required); this
 * file exists purely for the two *_ETH payment methods.
 *
 * Exact same shape as zecPrice.ts on purpose: poll a public price API in
 * the background, keep the last good value in memory, hand it out
 * instantly, never crash or show $0 on a transient failure -- just keep
 * serving the last known-good price. Read-only market data, same as
 * zecPrice.ts; nothing here touches funds or payment verification itself.
 */

const POLL_INTERVAL_MS = 60_000;
const SOURCE_URL = "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd";

interface Logger {
  info: (msg: string) => void;
  error: (err: unknown, msg: string) => void;
}

let lastGoodUsd: number | null = null;
let lastUpdatedAt: string | null = null;
let lastError: string | null = null;

export function getEthUsdPrice(): { usd: number | null; updatedAt: string | null } {
  return { usd: lastGoodUsd, updatedAt: lastUpdatedAt };
}

async function pollOnce(log?: Logger) {
  try {
    const res = await fetch(SOURCE_URL, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`coingecko responded ${res.status}`);
    const body = (await res.json()) as { ethereum?: { usd?: number } };
    const usd = body?.ethereum?.usd;
    if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) {
      throw new Error(`unexpected coingecko response shape: ${JSON.stringify(body)}`);
    }
    lastGoodUsd = usd;
    lastUpdatedAt = new Date().toISOString();
    lastError = null;
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (msg !== lastError) {
      lastError = msg;
      log?.error(e, `evmPrice: failed to fetch ETH/USD rate, keeping last known value (${lastGoodUsd ?? "none yet"})`);
    }
  }
}

/** Starts the background poll loop. Call once at server startup. */
export function startEthPricePolling(log?: Logger) {
  pollOnce(log);
  setInterval(() => pollOnce(log), POLL_INTERVAL_MS);
  log?.info(`evmPrice: polling ${SOURCE_URL} every ${POLL_INTERVAL_MS / 1000}s`);
}
