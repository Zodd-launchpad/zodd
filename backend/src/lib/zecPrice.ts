/**
 * Brai, 2026-09-07: "no, tiene que tener precio en dolares, todo" -- every
 * ZEC price shown anywhere on the site also needs a USD figure. There was
 * no live exchange rate anywhere in the codebase (the one time a USD number
 * was used, for the $2 create fee, it was a manual one-off lookup). This
 * module is the single live source of truth for it: poll a public price
 * API in the background, keep the last good value in memory, and hand it
 * out instantly (no per-request network round trip) via getZecUsdPrice().
 *
 * If the fetch ever fails (rate limit, network blip, API down) we just keep
 * showing the last known-good price -- never crash a request over it, and
 * never show $0 or a stale-looking error. Nothing here touches funds or
 * order matching; it's read-only market data for display.
 */

const POLL_INTERVAL_MS = 60_000; // CoinGecko's free tier is fine with once/min
const SOURCE_URL = "https://api.coingecko.com/api/v3/simple/price?ids=zcash&vs_currencies=usd";

interface Logger {
  info: (msg: string) => void;
  error: (err: unknown, msg: string) => void;
}

let lastGoodUsd: number | null = null;
let lastUpdatedAt: string | null = null;
let lastError: string | null = null;

export function getZecUsdPrice(): { usd: number | null; updatedAt: string | null } {
  return { usd: lastGoodUsd, updatedAt: lastUpdatedAt };
}

async function pollOnce(log?: Logger) {
  try {
    const res = await fetch(SOURCE_URL, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`coingecko responded ${res.status}`);
    const body = (await res.json()) as { zcash?: { usd?: number } };
    const usd = body?.zcash?.usd;
    if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) {
      throw new Error(`unexpected coingecko response shape: ${JSON.stringify(body)}`);
    }
    lastGoodUsd = usd;
    lastUpdatedAt = new Date().toISOString();
    lastError = null;
  } catch (e: any) {
    // Keep serving the last good price; only log when the failure is new,
    // so a prolonged outage doesn't spam the logs once a minute.
    const msg = e?.message ?? String(e);
    if (msg !== lastError) {
      lastError = msg;
      log?.error(e, `zecPrice: failed to fetch ZEC/USD rate, keeping last known value (${lastGoodUsd ?? "none yet"})`);
    }
  }
}

/** Starts the background poll loop. Call once at server startup. */
export function startZecPricePolling(log?: Logger) {
  pollOnce(log);
  setInterval(() => pollOnce(log), POLL_INTERVAL_MS);
  log?.info(`zecPrice: polling ${SOURCE_URL} every ${POLL_INTERVAL_MS / 1000}s`);
}
