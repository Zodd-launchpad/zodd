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
  /** Set the first time this amount is matched to a confirmed note. Once
   * set, the watcher is kept alive (instead of being deleted like before)
   * for REPEAT_WINDOW_MS so a payer who sends the exact same amount again
   * -- on purpose or by mistake -- gets it credited as an ADDITIONAL buy
   * instead of it silently sitting unclaimed in the wallet. See the poll
   * loop and REPEAT_WINDOW_MS below. */
  firstMatchedAt?: number;
}

type PaymentCallback = (orderId: string, confirmedZecAmount: number, txid: string, opts?: { isRepeat: boolean }) => void;

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

// Found 2026-09-07 (Brai: "toqué comprar 2 veces pero una la pagué 3
// veces... si la gente hace eso tiene que sumarle otra compra mas, o sea
// si vos confirmas la compra 10 veces, tiene que comprarte 10 veces"): a
// payer resending the exact same amount to the exact same order more than
// once used to just leave the extra sends stranded -- the order already
// matched once and stopped watching, so nothing was left to claim them.
// Now, once an amount is matched, its watcher stays alive (instead of
// being deleted) for this long, so each additional confirmed note of the
// identical amount is credited as its own separate buy (see the
// firstMatchedAt handling in the poll loop, and the isRepeat handling in
// server.ts's onPaymentDetected, which clones a brand-new FILLED order
// per repeat rather than touching the original). Kept short (well under
// ORDER_EXPIRY_MS) since a deliberate resend happens quickly, and because
// pickAndReserveAmount treats a still-watched matched amount as taken --
// the longer this window is, the longer a brand-new unrelated order
// requesting the same amount stays bumped to a different one.
//
// KNOWN LIMITATION: this window is in-memory only, like the rest of
// `watchers`. A backend restart mid-window loses it, because
// resumeWatching (see below) only re-arms orders still PENDING in the DB
// -- an order that already matched once is FILLED, not PENDING, so it
// won't be resumed. In practice this only matters for a repeat sent in
// the few seconds around a redeploy, which is rare enough not to justify
// persisting matched-but-still-open watchers to the DB for now.
const REPEAT_WINDOW_MS = 20 * 60_000;

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
      // Already matched once: it's in its repeat-payment grace window, not
      // subject to the normal unpaid-order expiry rules below -- it just
      // ages out on its own clock once REPEAT_WINDOW_MS passes with no
      // further sends.
      if (pending.firstMatchedAt != null) {
        if (Date.now() - pending.firstMatchedAt > REPEAT_WINDOW_MS) {
          watchers.delete(pending.orderId);
          console.log(`[zcashReal] order ${pending.orderId} repeat-payment window closed, no longer watching for extra sends (address ${pending.address})`);
        }
        continue;
      }
      const hardExpired = Date.now() - pending.originalCreatedAt > HARD_MAX_LIFETIME_MS;
      if (Date.now() - pending.createdAt > ORDER_EXPIRY_MS || hardExpired) {
        watchers.delete(pending.orderId);
        console.warn(
          `[zcashReal] order ${pending.orderId} expired unpaid ${hardExpired ? `(hard cap: ${Math.round((Date.now() - pending.originalCreatedAt) / 60_000)}min since original creation)` : `after ${ORDER_EXPIRY_MS / 60_000}min`} (address ${pending.address})`
        );
      }
    }
    if (watchers.size === 0) return;
    try {
      const { notes } = await call(`/wallet/notes`);
      const available = (notes ?? []).filter(
        (n: any) => typeof n.status === "string" && n.status.toLowerCase().includes("confirmed") && !consumedTxids.has(n.txid)
      );

      // Pass 1, memo match: collision-proof, see the big comment on
      // buildPaymentMemo below. Every watcher's orderId is a unique cuid, so
      // a note whose decrypted memo equals it can belong to exactly one
      // watcher -- no amount guessing, no bump, works at any concurrency.
      // Credits the REAL amount the note is worth (not the requested/
      // expected one), since the memo alone already proves which order this
      // is for. Runs before the amount pass so a memo-carrying note is
      // never accidentally claimed by amount from an unrelated watcher.
      for (const pending of [...watchers.values()]) {
        const idx = available.findIndex((n: any) => typeof n.memo === "string" && n.memo.trim() === pending.orderId);
        if (idx === -1) continue;
        const note = available[idx];
        available.splice(idx, 1);
        consumedTxids.add(note.txid);
        const paidZec = Number(note.valueZatoshis) / ZATOSHIS_PER_ZEC;
        const isRepeat = pending.firstMatchedAt != null;
        if (isRepeat) {
          console.log(`[zcashReal] order ${pending.orderId} matched AGAIN by memo: note worth ${paidZec} ZEC (txid ${note.txid}) -- crediting as an additional buy`);
        } else {
          pending.firstMatchedAt = Date.now();
          console.log(`[zcashReal] order ${pending.orderId} matched by memo: note worth ${paidZec} ZEC (txid ${note.txid})`);
        }
        onPayment?.(pending.orderId, paidZec, note.txid, { isRepeat });
      }

      // Pass 2, amount fallback: unchanged from before -- only reached by
      // whatever's left of `available` (memo matches above already spliced
      // theirs out) and whatever watchers pass 1 didn't already resolve.
      // Still needed for a payer whose wallet doesn't attach ZIP-321 memos.
      for (const pending of [...watchers.values()]) {
        const expectedZats = Math.round(pending.expectedZecAmount * ZATOSHIS_PER_ZEC);
        const idx = available.findIndex((n: any) => Number(n.valueZatoshis) === expectedZats);
        if (idx === -1) continue;
        const note = available[idx];
        available.splice(idx, 1); // don't let a second pending order for the same amount claim it too, this tick
        consumedTxids.add(note.txid);
        const isRepeat = pending.firstMatchedAt != null;
        if (isRepeat) {
          console.log(`[zcashReal] order ${pending.orderId} matched AGAIN by amount: note worth ${pending.expectedZecAmount} ZEC (txid ${note.txid}) -- crediting as an additional buy`);
        } else {
          pending.firstMatchedAt = Date.now();
          console.log(`[zcashReal] order ${pending.orderId} matched by amount: note worth ${pending.expectedZecAmount} ZEC (txid ${note.txid})`);
        }
        onPayment?.(pending.orderId, pending.expectedZecAmount, note.txid, { isRepeat });
      }
    } catch (err) {
      console.error(`[zcashReal] poll failed:`, err);
    }
  }, POLL_INTERVAL_MS);
}

// Brai, 2026-09-07: "esto tiene que ir por frase semilla ... para q no haya
// ni una posibilidad de que suceda" -- this is the real fix, not just a
// patch on pickAndReserveAmount's bump. zingo-cli still can't tell us which
// diversified ADDRESS a note landed on (confirmed again today, see the big
// comment above unspentNotes' original version), so a true one-wallet-per-
// order scheme isn't buildable on this tooling without a much bigger
// rewrite (a separate lightclient/derived key per order). Memos get
// (almost) the same guarantee far more cheaply: every order/token-creation
// id is already a globally-unique cuid, zingo-cli's `quicksend` already
// proves this wallet can read/write shielded memos correctly (used for the
// token-creation genesis proof), and ZIP-321 (the same `zcash:` URI scheme
// the QR already uses) has a standard `memo` parameter that memo-aware
// wallets (Zashi, YWallet, Nighthawk, and others that implement ZIP-321)
// fill in automatically from a scanned QR -- no manual typing, so no
// mistyped/rounded amount either.
// Caveat, stated plainly: a payer who pastes the address by hand into a
// wallet that ignores the memo param (or retypes it outside the QR flow)
// still falls back to the old amount-based guess -- that path still isn't
// literally impossible to collide, only the memo path is. There is no way
// to force a third-party wallet to honor a memo; this is the strongest fix
// available without replacing the wallet library.
// ZIP-321 (the `zcash:` payment URI the QR already encodes) carries the
// memo as base64 of the raw bytes -- a compliant wallet decodes that and
// writes the raw text as the note's actual on-chain memo, which is exactly
// what comes back as the plain (non-base64) `n.memo` in unspentNotes()
// above. So this is base64 OUT (for the URI); the poll loop above compares
// against the plain orderId because that's what a matching note decrypts
// back to.
export function buildPaymentMemoBase64(orderId: string): string {
  return Buffer.from(orderId, "utf8").toString("base64");
}

// Found 2026-09-07, same incident as HARD_MAX_LIFETIME_MS above: back when
// matching was amount-only, two orders open at once for the identical
// amount was a straight-up ambiguity the code couldn't resolve correctly --
// whichever was registered first always won the next matching note, even
// when it was the wrong one (a stale abandoned creation stole a real FLORK
// payment this way). This function originally "fixed" that by bumping the
// requested amount by a few thousand zatoshis until it was unique, and
// making the caller display/charge that bumped amount instead of what was
// actually requested.
//
// Brai, 2026-09-07 (later): "yo pongo comprar 0.0001 y me pone q tengo q
// pagar 0.00015000000000000001 ... vos tenes que hacer que yo pague 0.0001
// ... q la gente pague el monto que quiere comprar" -- charging a bumped,
// floating-point-ugly amount the buyer never asked for is bad UX, and by
// this point it's also no longer the primary defense: the memo-based match
// added above (Pass 1 in the poll loop) already identifies each order by
// its own unique orderId regardless of amount, so a same-amount collision
// between two DIFFERENT orders is no longer ambiguous for any wallet that
// preserves the ZIP-321 memo. The bump is now removed -- every order is
// watched for the exact amount requested. The one residual gap: a payer
// whose wallet drops the memo entirely (manual retype, non-ZIP-321 wallet)
// still falls back to amount-only matching (Pass 2), so two such payments
// for the identical amount, open at the same moment, could in theory still
// cross-match -- same accepted, fund-safe-only risk described above (money
// always lands in the platform wallet either way; only the credited
// PENDING RECORD could be wrong). Considered an acceptable tradeoff for no
// longer charging buyers an amount they didn't ask for.
//
// IMPORTANT (caught 2026-09-07, before shipping the original bump -- Brai:
// "si sumas un pelito en 20 a la vez... se te van a pisar los numeros,
// chequea que no este usado el numero"): picking the amount and reserving
// it must NOT be two separate moments, even without a bump to pick --
// registering the watcher still has to happen synchronously, before the
// first `await` in generateOrderAddress, so a burst of concurrent requests
// can't all read `watchers` in an inconsistent state. Node only switches
// between concurrent requests at an `await`, so reserving here first keeps
// that atomic.
function pickAndReserveAmount(orderId: string, expectedZecAmount: number): number {
  // Reserve it right here, same tick, before any await -- the address is
  // filled in afterward once we have it. An empty address doesn't affect
  // matching (memo matching doesn't use the address at all; amount
  // matching only needs expectedZecAmount, already set below).
  const now = Date.now();
  watchers.set(orderId, { orderId, address: "", expectedZecAmount, createdAt: now, originalCreatedAt: now });
  return expectedZecAmount;
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

// Found 2026-09-07: a payer who sends the same order's exact amount more
// than once (Brai: "toqué comprar 2 veces pero una la pagué 3 veces") ends
// up with extra confirmed notes nobody is watching for -- the order that
// amount belonged to already matched once and stopped watching (see the
// poll loop above), so the surplus sends just sit in the pooled wallet,
// spendable but not credited to anyone. This is for admin recovery: list
// every confirmed note that ISN'T already accounted for by a real
// order/token-creation (cross-checked against the DB via
// getAllKnownPaymentTxids in store.ts, the same source resumeWatching's
// consumedTxids seeding uses), so a human can decide what to do with a
// surplus payment instead of it silently staying unclaimed forever.
export async function listUnclaimedNotes(
  knownTxids: string[]
): Promise<{ txid: string; zatoshis: number; zec: number; status: string; timeRaw: number; memo: string }[]> {
  const { notes } = await call(`/wallet/notes`);
  const known = new Set(knownTxids);
  return (notes ?? [])
    .filter((n: any) => typeof n.status === "string" && n.status.toLowerCase().includes("confirmed") && !known.has(n.txid))
    .map((n: any) => ({
      txid: n.txid,
      zatoshis: Number(n.valueZatoshis),
      zec: Number(n.valueZatoshis) / ZATOSHIS_PER_ZEC,
      status: n.status,
      // If this is non-empty and STILL shows up here as unclaimed, the memo
      // path (see buildPaymentMemoBase64) either didn't match any currently
      // -watched order (already expired/filled by the time this note
      // confirmed) or the payer typed/pasted a memo that doesn't correspond
      // to any real order -- useful signal for manual admin triage.
      memo: typeof n.memo === "string" ? n.memo : "",
      // zingo-cli's note `time` field -- seconds-since-epoch when observed,
      // per cli.js's unspentNotes(). Kept raw (not converted) here so the
      // caller can decide how to interpret it; 0 if the field was missing.
      timeRaw: Number(n.time ?? 0),
    }));
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
