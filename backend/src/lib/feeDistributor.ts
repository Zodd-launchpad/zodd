/**
 * Every CHECK_INTERVAL_MS, looks for tokens whose creator fee hasn't been
 * paid out in the last 24h (or ever) and has something to pay, then sends
 * it to the creator's registered Zcash address. Works identically in mock
 * and real mode -- it just calls whatever `sendPayout` the active
 * zcashMock/zcashReal module exports.
 */
import * as store from "./store.js";

const PAYOUT_INTERVAL_MS = 24 * 60 * 60_000; // distribute at most once per 24h per token
const CHECK_INTERVAL_MS = 15 * 60_000; // how often we look for tokens that are due

// Found 2026-09-07 (Brai, after ZODDTY's 0.0000003 ZEC payout landed): the
// Zcash network/miner fee on a real send (paid by the platform wallet, see
// zcashReal.ts's `call("/wallet/send", ...)` -> zingo-cli `quicksend`, which
// deducts its own fee from the wallet's balance separately from the amount
// sent) is on the order of 0.0001 ZEC -- multiple times bigger than a dust
// payout like that one. Below this line, a payout would just be burning
// more in network fees than the creator actually receives, so nothing gets
// paid until a token's accrued creator fee reaches this amount; it simply
// keeps accumulating across cycles (creatorFeeAccruedZec is never reset)
// until it crosses the line.
export const MIN_CREATOR_PAYOUT_ZEC = 0.001;

type SendPayout = (toAddress: string, zecAmount: number) => Promise<{ txid: string }> | { txid: string };

interface Logger {
  info: (msg: string) => void;
  error: (err: unknown, msg: string) => void;
}

/** One pass: pay out every token whose creator fee is due (see
 * PAYOUT_INTERVAL_MS) and has a registered payout address and something
 * accrued. Exported on its own -- separate from the setInterval loop below
 * -- so an admin route can trigger a single run on demand (Brai, 2026-09-07:
 * wants to run it manually himself instead of waiting for the 24h clock,
 * "para mas seguridad"), without duplicating this logic. */
export async function runFeeDistributionOnce(
  sendPayout: SendPayout,
  maxPayoutZec: number,
  log: Logger,
  // false (default) for the automatic setInterval cycle below, which should
  // keep respecting the 24h-per-token pacing. true for a deliberate manual
  // run (see the admin route in server.ts) -- see the big comment on
  // getTokensDueForFeePayout for why a manual trigger shouldn't be gated by
  // that same clock.
  ignoreInterval = false
) {
  let due: Awaited<ReturnType<typeof store.getTokensDueForFeePayout>>;
  try {
    due = await store.getTokensDueForFeePayout(PAYOUT_INTERVAL_MS, ignoreInterval, MIN_CREATOR_PAYOUT_ZEC);
  } catch (err) {
    log.error(err, "failed to query tokens due for creator fee payout");
    return { paid: [] as { symbol: string; amount: number; txid: string }[], skipped: [] as string[] };
  }
  // Surfaced in the admin route's response too -- diagnostic visibility
  // into exactly what the query considered "due" this run, since "paid:
  // []" alone doesn't say whether nothing was due or something failed
  // silently before ever reaching sendPayout.
  log.info(`fee distribution: ${due.length} token(s) matched as due (ignoreInterval=${ignoreInterval}): ${due.map((t) => `${t.symbol}(accrued=${t.creatorFeeAccruedZec},addr=${t.creatorPayoutAddress ? "yes" : "no"})`).join(", ") || "none"}`);

  const paid: { symbol: string; amount: number; txid: string }[] = [];
  const skipped: string[] = [];

  for (const token of due) {
    // Belt-and-suspenders: the query above already filters by
    // MIN_CREATOR_PAYOUT_ZEC, but this stays as a second guard against any
    // future direct call to getTokensDueForFeePayout that forgets to pass
    // the minimum.
    if (!token.creatorPayoutAddress || token.creatorFeeAccruedZec < MIN_CREATOR_PAYOUT_ZEC) continue;
    // Pay out in one chunk if it fits under the per-payout safety cap;
    // otherwise pay what fits now and leave the rest accrued for the
    // next cycle rather than failing the whole payout outright.
    const amount = Math.min(token.creatorFeeAccruedZec, maxPayoutZec);
    try {
      const { txid } = await sendPayout(token.creatorPayoutAddress, amount);
      await store.recordFeePayout(token.id, amount, token.creatorPayoutAddress, txid);
      log.info(`creator fee payout: ${amount.toFixed(8)} ZEC -> ${token.symbol} creator (${token.creatorPayoutAddress}), txid ${txid}`);
      paid.push({ symbol: token.symbol, amount, txid });
    } catch (err) {
      log.error(err, `creator fee payout failed for ${token.symbol}`);
      skipped.push(token.symbol);
    }
  }

  return { paid, skipped };
}

export function startFeeDistributor(sendPayout: SendPayout, maxPayoutZec: number, log: Logger) {
  setInterval(() => {
    runFeeDistributionOnce(sendPayout, maxPayoutZec, log).catch((err) => log.error(err, "fee distribution tick failed"));
  }, CHECK_INTERVAL_MS);
}
