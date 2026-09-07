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
export async function runFeeDistributionOnce(sendPayout: SendPayout, maxPayoutZec: number, log: Logger) {
  let due: Awaited<ReturnType<typeof store.getTokensDueForFeePayout>>;
  try {
    due = await store.getTokensDueForFeePayout(PAYOUT_INTERVAL_MS);
  } catch (err) {
    log.error(err, "failed to query tokens due for creator fee payout");
    return { paid: [] as { symbol: string; amount: number; txid: string }[], skipped: [] as string[] };
  }

  const paid: { symbol: string; amount: number; txid: string }[] = [];
  const skipped: string[] = [];

  for (const token of due) {
    if (!token.creatorPayoutAddress || token.creatorFeeAccruedZec <= 0) continue;
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
