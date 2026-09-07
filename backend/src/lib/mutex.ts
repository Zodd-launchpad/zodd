/**
 * Found 2026-09-07 (Brai, selling FLORKY): "Internal Server Error" ->
 * quoteSell threw "cannot sell more than the curve has issued" even though
 * his wallet balance clearly had that many tokens. Root cause: every buy
 * (and sell) does a read-modify-write on a token's bonding-curve state --
 * read the current curve, compute the new one, then OVERWRITE it
 * (updateTokenCurve does an absolute set, not an atomic increment; see its
 * comment in store.ts). Balances are credited with a real atomic DB
 * increment, so they're always correct -- but two buys for the SAME token
 * landing close enough together (both real, e.g. two of Brai's repeat
 * test-buys matched in the same 20s poll tick -- see isRepeat in
 * zcashReal.ts) can both read the curve BEFORE either writes it back, so
 * the second write clobbers the first's progress. The balance ledger ends
 * up ahead of what the curve thinks it ever sold, and a sell for the full
 * (correct) balance then looks like it exceeds the (silently
 * undercounted) curve -- hence the crash.
 *
 * The actual fix is to never let two buy/sell executions for the same
 * token overlap their read-modify-write section in the first place. This
 * is a simple in-memory per-tokenId mutex (a promise chain) -- sufficient
 * because there's a single backend process and the race is between
 * concurrent async callbacks within it, not across processes.
 */

const chains = new Map<string, Promise<unknown>>();

/** Runs `fn` only after every previously-queued call for the same
 * `tokenId` has finished (successfully or not), so curve read-modify-write
 * sections for one token never interleave. Different tokens don't block
 * each other at all. */
export function withTokenLock<T>(tokenId: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(tokenId) ?? Promise.resolve();
  // Wait for the previous link regardless of whether it threw, so one
  // failed buy/sell doesn't jam the queue for every buy/sell after it.
  const run = prev.catch(() => {}).then(() => fn());
  // What's stored for the NEXT caller to wait on must also never reject,
  // for the same reason -- but `run` itself (returned here) still carries
  // the real result/rejection for THIS caller's own error handling.
  chains.set(tokenId, run.catch(() => {}));
  return run;
}
