/**
 * REAL zcash-service. Talks to the zcash-wallet-service (see
 * /zcash-wallet-service in the repo root), which wraps zingo-cli connected
 * to Zcash mainnet. This is the only file that moves real ZEC on behalf of
 * users -- it exists so server.ts can stay identical whether it's pointed
 * at this or at zcashMock.ts (see the ZCASH_MODE switch in server.ts).
 *
 * Same external shape as zcashMock.ts on purpose: generateOrderAddress,
 * onPaymentDetected, sendPayout. Nothing else in the backend should know or
 * care whether payments are real.
 */

const WALLET_SERVICE_URL = process.env.ZCASH_WALLET_SERVICE_URL ?? "http://zcash-wallet.railway.internal:8080";
const INTERNAL_TOKEN = process.env.ZCASH_WALLET_SERVICE_TOKEN;

// Defense in depth against a bug turning into an unbounded loss: every
// single order, buy or sell, is capped here regardless of what the wallet
// service's own cap is set to. Raise this deliberately once the real flow
// has been proven out with small amounts.
const MAX_ZEC_PER_ORDER = Number(process.env.ZCASH_MAX_ZEC_PER_ORDER ?? 0.05);

// Exposed so callers that pay out variable/accumulated amounts (like the
// creator-fee distributor) can chunk a payout instead of just failing once
// it exceeds this same safety cap.
export const MAX_PAYOUT_ZEC = MAX_ZEC_PER_ORDER;

const ZATOSHIS_PER_ZEC = 100_000_000;

async function call(path: string, opts: RequestInit = {}) {
  if (!INTERNAL_TOKEN) throw new Error("ZCASH_WALLET_SERVICE_TOKEN is not set");
  const res = await fetch(`${WALLET_SERVICE_URL}${path}`, {
    ...opts,
    headers: {
      "x-internal-token": INTERNAL_TOKEN,
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `zcash-wallet-service error ${res.status}`);
  return body;
}

export interface PendingPayment {
  orderId: string;
  address: string;
  expectedZecAmount: number;
  createdAt: number;
  /** True wall-clock creation time, never reset by a resume. See
   * HARD_MAX_LIFETIME_MS below -- this is what stops an abandoned order
   * from watching (and stealing same-amount payments from) forever. */
  originalCreatedAt: number;
}

type PaymentCallback = (orderId: string, confirmedZecAmount: number, txid: string) => void;

const watchers = new Map<string, PendingPayment>();
let onPayment: PaymentCallback | null = null;

const POLL_INTERVAL_MS = 20_000; // real chain state -- no need to hammer it every few seconds

// Found 2026-09-07 (Brai): 30min is too tight for a real chain -- if the
// Zcash network is congested, a genuine payment can take a lot longer than
// that to confirm, and an order that expires while the money is still
// in-flight loses a real customer's purchase. Orders now stay watched for
// at least 2 hours before giving up.
const ORDER_EXPIRY_MS = 2 * 60 * 60_000; // an order nobody paid within 2h stops being watched

// Found 2026-09-07: matching is amount-only (see the big comment below), so
// two PENDING records open at once for the same expected amount race for
// whichever note lands next -- and resumeWatching deliberately gives every
// resumed order a FRESH window (see its own comment) so a real payment
// survives a redeploy. Combined, an old order nobody ever paid can live
// forever: every redeploy re-resumes it with another fresh window, so it
// never truly expires, and it keeps first-in-line priority (it was
// registered before any later, actually-paid order of the same amount) to
// steal that later order's payment. A real ZEC 0.0001 fee meant for a
// token creation named FLORK got credited this way to an abandoned
// creation from 36 minutes earlier instead.
//
// That specific failure mode (two orders silently sharing one amount) is
// now closed a different way -- see pickAndReserveAmount below, which
// makes every order's amount a unique fingerprint the moment it's created,
// so there is no longer any ambiguity for a note to fall into even if two
// orders are open at once. This hard cap is what's left as a second,
// independent line of defense against the SAME underlying risk (an
// abandoned order that never truly goes away) for orders created before
// that fix, or by any future bug in it -- not the primary mechanism
// anymore, so it can afford to sit comfortably above the 2h soft window
// instead of well below it.
const HARD_MAX_LIFETIME_MS = 3 * 60 * 60_000;

export function onPaymentDetected(cb: PaymentCallback) {
  onPayment = cb;
  startPolling();
}

// Dead ends tried before this (2026-09-07, see cli.js in zcash-wallet-service
// for the full account): `messages <address>` never returns anything for a
// specific address; bare `messages` (no address) turned out to only track
// transfers THIS wallet itself sent, not deposits it received -- so no
// incoming payment, ever, shows up there. `notes` DOES show incoming
// deposits (confirmed live against the two real 0.0001 ZEC test payments),
// but its entries carry no receiving-address field at all -- zingo-cli
// gives no way to ask "what landed at address X". So matching happens here
// instead, by AMOUNT: every pending order/token-creation already has a
// known expected zatoshi amount, and every unspent note has a known
// zatoshi value, so a still-unconsumed note whose value equals a pending
// order's expected amount is treated as that order's payment. This trades
// away verifying the payment used the exact one-time address we handed out
// (zingo-cli gives us no way to check that) -- but the money still lands
// in this same platform wallet either way, so there's no fund-safety risk,
// only a small chance of crediting the wrong PENDING RECORD if two orders
// for the identical amount are open at once and get paid out of order.
// consumedTxids (seeded at boot from the DB via seedConsumedTxids, see
// server.ts) stops the same note from being matched to a second order
// later, including across a restart.
const consumedTxids = new Set<string>();

export function seedConsumedTxids(txids: string[]) {
  for (const t of txids) consumedTxids.add(t);
}

let pollingStarted = false;
function startPolling() {
  if (pollingStarted) return;
  pollingStarted = true;
  setInterval(async () => {
    for (const pending of [...watchers.values()]) {
      const hardExpired = Date.now() - pending.originalCreatedAt > HARD_MAX_LIFETIME_MS;
      if (Date.now() - pending.createdAt > ORDER_EXPIRY_MS || hardExpired) {
        watchers.delete(pending.orderId);
        console.warn(
          `[zcashReal] order ${pending.orderId} expired unpaid ${hardExpired ? `(hard cap: ${Math.round((Date.now() - pending.originalCreatedAt) / 60_000)}min since original creation)` : "after 30min"} (address ${pending.address})`
        );
      }
    }
    if (watchers.size === 0) return;
    try {
      const { notes } = await call(`/wallet/notes`);
      const available = (notes ?? []).filter(
        (n: any) => typeof n.status === "string" && n.status.toLowerCase().includes("confirmed") && !consumedTxids.has(n.txid)
      );
      for (const pending of [...watchers.values()]) {
        const expectedZats = Math.round(pending.expectedZecAmount * ZATOSHIS_PER_ZEC);
        const idx = available.findIndex((n: any) => Number(n.valueZatoshis) === expectedZats);
        if (idx === -1) continue;
        const note = available[idx];
        available.splice(idx, 1); // don't let a second pending order for the same amount claim it too, this tick
        consumedTxids.add(note.txid);
        watchers.delete(pending.orderId);
        console.log(`[zcashReal] order ${pending.orderId} matched: note worth ${pending.expectedZecAmount} ZEC (txid ${note.txid})`);
        onPayment?.(pending.orderId, pending.expectedZecAmount, note.txid);
      }
    } catch (err) {
      console.error(`[zcashReal] poll failed:`, err);
    }
  }, POLL_INTERVAL_MS);
}

// Found 2026-09-07, same incident as HARD_MAX_LIFETIME_MS above: matching
// is amount-only, so two orders open at once for the identical amount is a
// straight-up ambiguity the code cannot resolve correctly -- whichever was
// registered first always wins the next matching note, even when it's the
// wrong one (a stale abandoned creation stole a real FLORK payment this
// way). The hard-lifetime cap above narrows the window this can happen in,
// but doesn't remove it: two orders can still be legitimately open, unpaid,
// at the same moment. The actual fix is to never let that ambiguity exist
// in the first place -- every new order gets a tiny, effectively invisible
// (a few thousand zatoshis, a fraction of a cent) bump added on top of the
// requested amount until it no longer matches any currently-watched order,
// so the amount itself is always a unique fingerprint. The caller must
// display/charge this adjusted amount, not the original request.
//
// IMPORTANT (caught 2026-09-07, before shipping -- Brai: "si sumas un
// pelito en 20 a la vez... se te van a pisar los numeros, chequea que no
// este usado el numero"): picking the amount and reserving it are NOT the
// same moment. The obvious version of this -- check watchers, then `await`
// the wallet-service call for a fresh address, then finally add the picked
// amount to watchers -- has a real race: with 20 people buying 0.1 ZEC
// within the same ~second, every one of those 20 requests can run its
// "is 0.1 taken?" check BEFORE any of them has reached the watchers.set()
// at the end (they're all sitting mid-`await` on the address call at that
// point), so all 20 see "not taken" and all 20 collide on 0.1 anyway --
// exactly the bug this function exists to prevent, just moved one step
// later. The fix: reserve the picked amount in `watchers` SYNCHRONOUSLY,
// before the first `await` in generateOrderAddress. Node only switches
// between concurrent requests at an `await`, so nothing can see a
// half-picked amount as "free" -- reservation is atomic with the pick.
const DISAMBIGUATION_BUMP_ZATS = 1000; // 0.00001 ZEC per collision retry
function pickAndReserveAmount(orderId: string, expectedZecAmount: number): number {
  let candidate = expectedZecAmount;
  let bumps = 0;
  const isTaken = (zec: number) => {
    const zats = Math.round(zec * ZATOSHIS_PER_ZEC);
    return [...watchers.values()].some((w) => Math.round(w.expectedZecAmount * ZATOSHIS_PER_ZEC) === zats);
  };
  while (isTaken(candidate) && bumps < 200) {
    bumps += 1;
    candidate = expectedZecAmount + (bumps * DISAMBIGUATION_BUMP_ZATS) / ZATOSHIS_PER_ZEC;
  }
  // Reserve it right here, same tick, before any await -- the address is
  // filled in afterward once we have it. An empty address doesn't affect
  // matching (matching is amount-only, see the poll loop above).
  const now = Date.now();
  watchers.set(orderId, { orderId, address: "", expectedZecAmount: candidate, createdAt: now, originalCreatedAt: now });
  return candidate;
}

/** Generates a real one-time address for a buy order via the wallet
 * service. Returns the address AND the actual expectedZecAmount to charge
 * -- may be a hair above what was requested, see pickAndReserveAmount --
 * which the caller must persist and show to the payer instead of the
 * original request. */
export async function generateOrderAddress(orderId: string, expectedZecAmount: number): Promise<{ address: string; expectedZecAmount: number }> {
  if (expectedZecAmount > MAX_ZEC_PER_ORDER) {
    throw new Error(
      `order of ${expectedZecAmount} ZEC exceeds the current safety cap of ${MAX_ZEC_PER_ORDER} ZEC per order`
    );
  }
  // Reserved synchronously before the address call's `await` -- see the
  // comment on pickAndReserveAmount for why that ordering matters.
  const uniqueAmount = pickAndReserveAmount(orderId, expectedZecAmount);
  let address: string;
  try {
    ({ address } = await call("/wallet/address", { method: "POST" }));
  } catch (err) {
    watchers.delete(orderId); // don't leave a dangling reservation with no address
    throw err;
  }
  const pending = watchers.get(orderId);
  if (pending) pending.address = address; // fill in the address on the already-reserved watcher
  return { address, expectedZecAmount: uniqueAmount };
}

/** Re-registers a watcher for an address that was already generated in a
 * previous process lifetime (see server.ts's startup call to
 * store.getPendingOrdersAwaitingPayment / getPendingTokenCreationsAwaitingPayment).
 * The in-memory `watchers` map does not survive a restart, so without this
 * a real payment sent while the backend was mid-redeploy would confirm
 * on-chain with nothing left watching for it.
 *
 * IMPORTANT (found 2026-09-07): this used to pass the ORIGINAL createdAtMs
 * straight through "so the 30min expiry window still applies" -- but that
 * silently defeated the entire point of restart-recovery for exactly the
 * case it exists for. Two real token-creation payments sat un-detected
 * across several redeploys (fixing the messages()-parsing bugs) that
 * together took longer than 30 minutes; every resumed watcher was then
 * deleted by the very first poll tick's expiry check -- before it ever got
 * a chance to check for the payment -- because Date.now() - createdAtMs was
 * already past ORDER_EXPIRY_MS at the moment it was re-added. The DB is the
 * source of truth for whether an order is still worth watching (status
 * PENDING); an order this function is asked to resume is, by definition,
 * still PENDING, so it earns a fresh 30min window here rather than
 * inheriting a clock that may already be expired. `createdAtMs` is kept in
 * the signature (still useful to callers/logs) but no longer used for the
 * expiry clock. */
export function resumeWatching(orderId: string, address: string, expectedZecAmount: number, createdAtMs: number) {
  if (watchers.has(orderId)) return; // already registered this process lifetime
  const ageMs = Date.now() - createdAtMs;
  if (ageMs > HARD_MAX_LIFETIME_MS) {
    console.warn(`[zcashReal] NOT resuming ${orderId} -- originally created ${Math.round(ageMs / 60_000)}min ago, past the ${HARD_MAX_LIFETIME_MS / 60_000}min hard cap (address ${address})`);
    return;
  }
  watchers.set(orderId, { orderId, address, expectedZecAmount, createdAt: Date.now(), originalCreatedAt: createdAtMs });
  console.log(`[zcashReal] resumed watching ${orderId} (originally created ${Math.round(ageMs / 60_000)}min ago) with a fresh ${ORDER_EXPIRY_MS / 60_000}min window`);
  startPolling();
}

/** Sends a real payout (sell proceeds). */
export async function sendPayout(toAddress: string, zecAmount: number): Promise<{ txid: string }> {
  if (zecAmount > MAX_ZEC_PER_ORDER) {
    throw new Error(`payout of ${zecAmount} ZEC exceeds the current safety cap of ${MAX_ZEC_PER_ORDER} ZEC per order`);
  }
  const zatoshis = Math.round(zecAmount * ZATOSHIS_PER_ZEC);
  const { txid } = await call("/wallet/send", {
    method: "POST",
    body: JSON.stringify({ address: toAddress, zatoshis }),
  });
  return { txid };
}

/** Read-only status check: current spendable balance and chain height, as
 * seen by zcash-wallet-service. Used by the /api/admin/zcash-status route
 * so we can confirm the wallet actually has funds without ever touching
 * the seed or moving anything. */
export async function getWalletStatus(): Promise<{ zatoshis: number; zec: number; height: unknown; addresses: unknown }> {
  const [balance, height, addressesRes] = await Promise.all([
    call("/wallet/balance"),
    call("/wallet/height"),
    call("/wallet/addresses").catch((err) => ({ error: String(err.message ?? err) })),
  ]);
  const zatoshis = Number(balance.zatoshis ?? 0);
  return { zatoshis, zec: zatoshis / ZATOSHIS_PER_ZEC, height, addresses: (addressesRes as any).addresses ?? addressesRes };
}

/**
 * The real on-chain "inscription" for a new token: one real shielded
 * transaction (0.01 ZEC, same as shld.fun's real mechanism -- see chat) to
 * the platform's own wallet, carrying a memo that records the token's
 * name/symbol/creator. This is the only bit of ZODD that is genuinely
 * on-chain; everything else (balances, the curve) stays off-chain, because
 * Zcash has no native token/smart-contract layer to put it on.
 */
export async function inscribeTokenCreation(symbol: string, name: string): Promise<{ txid: string }> {
  const INSCRIPTION_FEE_ZEC = 0.01;
  const { address: selfAddress } = await call("/wallet/address", { method: "POST" });
  const memo = `ZODD:CREATE:${symbol}:${name}`.slice(0, 512);
  const zatoshis = Math.round(INSCRIPTION_FEE_ZEC * ZATOSHIS_PER_ZEC);
  const { txid } = await call("/wallet/send", {
    method: "POST",
    body: JSON.stringify({ address: selfAddress, zatoshis, memo }),
  });
  return { txid };
}
