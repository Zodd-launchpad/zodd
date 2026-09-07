/**
 * MOCK of the real zcash-service (see docs/ARCHITECTURE.md).
 *
 * In production this is a wrapper around a light client (zingo-cli/zingolib)
 * pointed at lightwalletd, which:
 *   - derives a new diversified address per order from the reserve's
 *     Incoming Viewing Key,
 *   - trial-decrypts compact blocks (ZIP-307) to detect the payment,
 *   - signs and broadcasts the real payout when someone sells.
 *
 * Here, to demonstrate the end-to-end flow without a Zcash node or real ZEC,
 * we generate a validly-shaped address (not spendable, not a real address)
 * and simulate the payment confirming a few seconds later. ANY integration
 * with real ZEC has to replace this file, not just assume it "already works".
 */

// No safety cap in the mock -- nothing real can move.
export const MAX_PAYOUT_ZEC = Infinity;

const FAKE_ADDR_CHARS = "023456789acdefghjklmnpqrstuvwxyz";

function fakeShieldedAddress(): string {
  let body = "";
  for (let i = 0; i < 78; i++) {
    body += FAKE_ADDR_CHARS[Math.floor(Math.random() * FAKE_ADDR_CHARS.length)];
  }
  return `u1${body}`; // "u1" prefix = mainnet unified address, illustrative format
}

export interface PendingPayment {
  orderId: string;
  address: string;
  expectedZecAmount: number;
}

type PaymentCallback = (orderId: string, confirmedZecAmount: number, txid: string) => void;

const watchers = new Map<string, PendingPayment>();
let onPayment: PaymentCallback | null = null;

export function onPaymentDetected(cb: PaymentCallback) {
  onPayment = cb;
}

/** Generates a one-time address for a buy order and simulates the payment.
 * Returns the (unchanged, mock mode has no amount-collision risk -- each
 * order resolves on its own orderId-keyed timer) expectedZecAmount too, to
 * match zcashReal.ts's shape (see its pickUniqueAmount). */
export function generateOrderAddress(orderId: string, expectedZecAmount: number): { address: string; expectedZecAmount: number } {
  const address = fakeShieldedAddress();
  watchers.set(orderId, { orderId, address, expectedZecAmount });

  // Simulates Zcash block confirmation time (~75s in reality;
  // shortened here so the demo stays usable).
  const delayMs = 3000 + Math.random() * 2000;
  setTimeout(() => {
    const pending = watchers.get(orderId);
    if (!pending) return; // cancelled/expired
    watchers.delete(orderId);
    const fakeTxid = [...Array(64)].map(() => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
    onPayment?.(orderId, pending.expectedZecAmount, fakeTxid);
  }, delayMs);

  return { address, expectedZecAmount };
}

/** No-op in mock mode: a simulated payment always confirms within a few
 * seconds of generateOrderAddress, so nothing meaningful survives a
 * restart to resume. Exists only so server.ts can call this the same way
 * regardless of ZCASH_MODE (see zcashReal.ts's real implementation, which
 * this mirrors for restart recovery). */
export function resumeWatching(_orderId: string, _address: string, _expectedZecAmount: number, _createdAtMs: number) {}

/** No-op in mock mode: mirrors zcashReal.ts's seedConsumedTxids so
 * server.ts can call it generically regardless of ZCASH_MODE (the mock
 * always confirms via its own fake timer, never needs de-duping against
 * real notes). */
export function seedConsumedTxids(_txids: string[]) {}

/** Simulates sending a real payout (sell / graduation). */
export function sendPayout(toAddress: string, zecAmount: number): { txid: string } {
  const fakeTxid = [...Array(64)].map(() => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
  console.log(`[zcashMock] simulated payout: ${zecAmount} ZEC -> ${toAddress} (txid ${fakeTxid})`);
  return { txid: fakeTxid };
}
