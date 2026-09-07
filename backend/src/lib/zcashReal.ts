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
}

type PaymentCallback = (orderId: string, confirmedZecAmount: number, txid: string) => void;

const watchers = new Map<string, PendingPayment>();
let onPayment: PaymentCallback | null = null;

const POLL_INTERVAL_MS = 20_000; // real chain state -- no need to hammer it every few seconds
const ORDER_EXPIRY_MS = 30 * 60_000; // an order nobody paid within 30min stops being watched

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
      if (Date.now() - pending.createdAt > ORDER_EXPIRY_MS) {
        watchers.delete(pending.orderId);
        console.warn(`[zcashReal] order ${pending.orderId} expired unpaid after 30min (address ${pending.address})`);
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

/** Generates a real one-time address for a buy order via the wallet service. */
export async function generateOrderAddress(orderId: string, expectedZecAmount: number): Promise<string> {
  if (expectedZecAmount > MAX_ZEC_PER_ORDER) {
    throw new Error(
      `order of ${expectedZecAmount} ZEC exceeds the current safety cap of ${MAX_ZEC_PER_ORDER} ZEC per order`
    );
  }
  const { address } = await call("/wallet/address", { method: "POST" });
  watchers.set(orderId, { orderId, address, expectedZecAmount, createdAt: Date.now() });
  return address;
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
  watchers.set(orderId, { orderId, address, expectedZecAmount, createdAt: Date.now() });
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
