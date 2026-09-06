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

/** Generates a one-time address for a buy order and simulates the payment. */
export function generateOrderAddress(orderId: string, expectedZecAmount: number): string {
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

  return address;
}

/** Simulates sending a real payout (sell / graduation). */
export function sendPayout(toAddress: string, zecAmount: number): { txid: string } {
  const fakeTxid = [...Array(64)].map(() => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
  console.log(`[zcashMock] simulated payout: ${zecAmount} ZEC -> ${toAddress} (txid ${fakeTxid})`);
  return { txid: fakeTxid };
}
