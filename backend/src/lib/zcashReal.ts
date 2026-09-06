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
const MIN_CONFIRMATIONS = 2;

export function onPaymentDetected(cb: PaymentCallback) {
  onPayment = cb;
  startPolling();
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
        continue;
      }
      try {
        const { messages } = await call(`/wallet/messages?address=${encodeURIComponent(pending.address)}`);
        if (messages?.length) {
          console.log(`[zcashReal] order ${pending.orderId}: ${messages.length} message(s) at ${pending.address}: ${JSON.stringify(messages)}`);
        }
        // zingolib's ValueTransfer JSON shape isn't pinned down on our side
        // yet (confirmed live 2026-09-06 that the wrapper key is
        // value_transfers, not messages) -- match generously across the
        // plausible field-name variants rather than assuming one, and rely
        // on the console.log above to tell us fast if this still misses.
        const match = (messages ?? []).find((m: any) => {
          const confirmed =
            Number(m.confirmations ?? 0) >= MIN_CONFIRMATIONS ||
            m.status === "confirmed" ||
            (typeof m.blockheight === "number" && m.blockheight > 0) ||
            (typeof m.block_height === "number" && m.block_height > 0);
          const amountZats = Number(m.amountZatoshis ?? m.amount ?? m.value ?? m.value_zatoshis ?? 0);
          const isIncoming = m.kind ? /receiv/i.test(String(m.kind)) : true;
          return confirmed && amountZats > 0 && isIncoming;
        });
        if (match) {
          watchers.delete(pending.orderId);
          const amountZats = Number(match.amountZatoshis ?? match.amount ?? match.value ?? match.value_zatoshis);
          const confirmedZecAmount = amountZats / ZATOSHIS_PER_ZEC;
          onPayment?.(pending.orderId, confirmedZecAmount, match.txid);
        }
      } catch (err) {
        console.error(`[zcashReal] poll failed for order ${pending.orderId}:`, err);
      }
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
