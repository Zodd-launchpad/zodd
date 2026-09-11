/**
 * MOCK of a future real ycash-service (mirrors zcashMock.ts exactly, same
 * shape -- see the big comment there for the general pattern).
 *
 * Brai, 2026-09-11: "quiero que puedas trabajar con Ycash y Zcash" -- YEC
 * starts out mock-only, same as ZEC did before real Zcash support existed.
 * There is no ycashReal.ts yet: when Brai stands up real Ycash node/wallet
 * infra, that file gets written to match this same interface (and
 * zcashReal.ts's), and server.ts's per-currency wallet-service registry
 * switches YEC over to it -- nothing else in this codebase should need to
 * change, since bondingCurve.ts and fees.ts are pure percentage/ratio math
 * that never cared which currency it was fed.
 *
 * Ycash is itself a fork of Zcash's codebase (forked around Sapling
 * activation) and its Sapling shielded addresses use the "ys1" prefix
 * (confirmed against ycash.xyz's own docs) where Zcash uses "zs1"/"u1".
 * That's the only real difference reflected here -- everything else is a
 * straight copy of the ZEC mock.
 */

// No safety cap in the mock -- nothing real can move.
export const MAX_PAYOUT_ZEC = Infinity;

const FAKE_ADDR_CHARS = "023456789acdefghjklmnpqrstuvwxyz";

function fakeShieldedAddress(): string {
  let body = "";
  for (let i = 0; i < 78; i++) {
    body += FAKE_ADDR_CHARS[Math.floor(Math.random() * FAKE_ADDR_CHARS.length)];
  }
  return `ys1${body}`; // "ys1" prefix = Ycash sapling address, illustrative format
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
 * See zcashMock.ts's generateOrderAddress for the full reasoning -- this is
 * an exact mirror. */
export function generateOrderAddress(
  orderId: string,
  expectedZecAmount: number
): { address: string; expectedZecAmount: number; saplingDiversifierHex: string | null; orchardDiversifierHex: string | null } {
  const address = fakeShieldedAddress();
  watchers.set(orderId, { orderId, address, expectedZecAmount });

  // Simulates block confirmation time; shortened here so the demo stays usable.
  const delayMs = 3000 + Math.random() * 2000;
  setTimeout(() => {
    const pending = watchers.get(orderId);
    if (!pending) return; // cancelled/expired
    watchers.delete(orderId);
    const fakeTxid = [...Array(64)].map(() => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
    onPayment?.(orderId, pending.expectedZecAmount, fakeTxid);
  }, delayMs);

  return { address, expectedZecAmount, saplingDiversifierHex: null, orchardDiversifierHex: null };
}

/** No-op in mock mode -- see zcashMock.ts's resumeWatching. */
export function resumeWatching(
  _orderId: string,
  _address: string,
  _expectedZecAmount: number,
  _createdAtMs: number,
  _saplingDiversifierHex?: string | null,
  _orchardDiversifierHex?: string | null
) {}

/** No-op in mock mode -- see zcashMock.ts's seedConsumedTxids. */
export function seedConsumedTxids(_txids: string[]) {}

/** Mirrors zcashMock.ts's buildPaymentMemoBase64 -- meaningless in mock
 * mode, kept only so every wallet service has the same shape. */
export function buildPaymentMemoBase64(orderId: string): string {
  return Buffer.from(orderId, "utf8").toString("base64");
}

/** Simulates sending a real payout (sell / graduation). */
export function sendPayout(toAddress: string, zecAmount: number): { txid: string } {
  const fakeTxid = [...Array(64)].map(() => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
  console.log(`[ycashMock] simulated payout: ${zecAmount} YEC -> ${toAddress} (txid ${fakeTxid})`);
  return { txid: fakeTxid };
}
