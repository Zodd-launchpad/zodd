/**
 * Brai, 2026-09-07: "haz una proteccion para que no se puedan enviar miles
 * de ventas o compras como loco por parte de una persona porque pueden
 * explotar el servidor asi, pon un limite de 5 compras o ventas cada 20
 * segundos" -- caps how often a single wallet (this app's stand-in for "one
 * person") can hit the buy/sell endpoints. A buy and a sell count against
 * the SAME limit (5 total actions per 20s, not 5 of each), since either one
 * hammered fast enough is the same DoS: buy spins up a fresh order + a real
 * call to the zcash-wallet-service for every hit, and sell is worse -- it
 * sends a REAL payout (see server.ts's /api/orders/sell) every time it
 * succeeds.
 *
 * Simple in-memory sliding window, same reasoning as mutex.ts's per-token
 * lock: good enough because there's a single backend process. Not meant to
 * stop a determined attacker spinning up many wallets (that would need
 * IP-based limiting too) -- this is specifically the "one wallet mashing
 * buy/sell" case Brai described.
 */

const WINDOW_MS = 20_000;
const MAX_ACTIONS = 5;

const recentActions = new Map<string, number[]>();

export type RateLimitResult = { allowed: true } | { allowed: false; message: string };

/** Call this first, before doing any real work, for every buy or sell
 * request. Returns { allowed: false, message } if `walletId` has already
 * made MAX_ACTIONS buy/sell requests in the last WINDOW_MS -- the caller
 * should reply 429 with that message and stop. Otherwise records this
 * attempt and returns { allowed: true }. */
export function checkOrderRateLimit(walletId: string): RateLimitResult {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const recent = (recentActions.get(walletId) ?? []).filter((t) => t > cutoff);
  if (recent.length >= MAX_ACTIONS) {
    return {
      allowed: false,
      message: `too many buy/sell requests -- max ${MAX_ACTIONS} per ${WINDOW_MS / 1000}s, wait a moment and try again`,
    };
  }
  recent.push(now);
  recentActions.set(walletId, recent);
  return { allowed: true };
}

// Periodic sweep so recentActions doesn't grow forever across a
// long-running process -- drops any wallet with nothing in the last
// window. unref() so this timer alone never keeps the process alive.
const sweepTimer = setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [walletId, times] of recentActions) {
    const fresh = times.filter((t) => t > cutoff);
    if (fresh.length === 0) recentActions.delete(walletId);
    else recentActions.set(walletId, fresh);
  }
}, 60_000);
sweepTimer.unref?.();
