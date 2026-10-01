/**
 * Solana USDC payment verification for the NEAR-launch $8 fee
 * (nearFees.ts) -- Brai, 2026-09-30: "tambien usdc de solana". Only USDC
 * was asked for here (no native SOL payment method), so this file is
 * narrower than evmPayments.ts on purpose.
 *
 * Same "creator's own connected wallet sends it, hands us the tx
 * signature, we verify that specific transaction on-chain" pattern as
 * evmPayments.ts, for the same reason (no one-time custodial keys to
 * generate and sweep). Solana has ZERO prior integration anywhere in
 * this codebase -- new dependency (@solana/web3.js), new module,
 * nothing to mirror here the way ZEC mirrors zcashReal.ts.
 *
 * USDC mint address, confirmed 2026-09-30 directly against Circle's own
 * official contract-address documentation (developers.circle.com/
 * stablecoins/usdc-contract-addresses), not a third-party source:
 * EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v. This is Circle's
 * long-established, years-old native Solana USDC mint -- high
 * confidence, unlike the Robinhood Chain USDC address in evmPayments.ts.
 */
import { Connection, PublicKey } from "@solana/web3.js";

export const SOLANA_USDC_MINT = process.env.SOLANA_USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOLANA_USDC_DECIMALS = 6;

const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

/** Minimum confirmed slots' worth of finality before trusting a payment.
 * "finalized" commitment already implies Solana's supermajority-rooted
 * finality (effectively irreversible), so this is really just about
 * which commitment level to query at -- see verifySolanaUsdcPayment. */
const MIN_CONFIRMATIONS = Number(process.env.SOLANA_PAYMENT_MIN_CONFIRMATIONS ?? 1);
void MIN_CONFIRMATIONS; // kept for parity/env-discoverability with evmPayments.ts; finalized commitment already covers this

const MAX_PAYMENT_AGE_MS = Number(process.env.SOLANA_PAYMENT_MAX_AGE_MS ?? 24 * 60 * 60 * 1000);

let cachedConnection: Connection | null = null;
function connection(): Connection {
  if (!cachedConnection) cachedConnection = new Connection(RPC_URL, "finalized");
  return cachedConnection;
}

export interface SolanaPaymentVerification {
  ok: boolean;
  reason?: string;
  /** Actual USDC received by the expected recipient, in 6-decimal base units, as a decimal string. */
  amountReceived?: string;
}

/**
 * Verifies that `signature` is a real, finalized, successful Solana
 * transaction that transferred at least `minAmountBaseUnits` of USDC to
 * the token account(s) owned by `expectedRecipientOwner` (a wallet
 * address, NOT necessarily an associated-token-account address --
 * resolved via pre/postTokenBalances' `owner` field, which works
 * regardless of which ATA or however many hops the transfer used).
 * Mirrors evmPayments.ts's verifyEvmPayment: never throws on a bad/
 * unconfirmed tx, returns { ok: false, reason } instead.
 */
export async function verifySolanaUsdcPayment(params: {
  signature: string;
  expectedRecipientOwner: string;
  minAmountBaseUnits: bigint;
}): Promise<SolanaPaymentVerification> {
  const { signature, expectedRecipientOwner, minAmountBaseUnits } = params;

  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) return { ok: false, reason: "malformed transaction signature" };
  let expectedOwner: PublicKey;
  try {
    expectedOwner = new PublicKey(expectedRecipientOwner);
  } catch {
    return { ok: false, reason: "malformed expected recipient address" };
  }

  const conn = connection();
  let tx;
  try {
    tx = await conn.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "finalized" });
  } catch (e: any) {
    return { ok: false, reason: `RPC error looking up transaction: ${e?.message ?? String(e)}` };
  }
  if (!tx) return { ok: false, reason: "transaction not found (not finalized yet, or wrong network)" };
  if (tx.meta?.err) return { ok: false, reason: `transaction failed on-chain: ${JSON.stringify(tx.meta.err)}` };

  if (tx.blockTime) {
    const ageMs = Date.now() - tx.blockTime * 1000;
    if (ageMs > MAX_PAYMENT_AGE_MS) {
      return { ok: false, reason: `transaction is too old (${Math.round(ageMs / 3_600_000)}h) to be accepted as a fresh payment` };
    }
  }

  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];
  const expectedOwnerStr = expectedOwner.toBase58();

  // Sum the net increase in USDC balance across every token account owned
  // by the expected recipient, rather than assuming exactly one -- a
  // wallet can have more than one USDC associated token account touched
  // in a single tx in unusual cases, and this is robust either way.
  let netIncrease = 0n;
  for (const p of post) {
    if (p.mint !== SOLANA_USDC_MINT) continue;
    if (p.owner !== expectedOwnerStr) continue;
    const preBal = pre.find((b) => b.accountIndex === p.accountIndex && b.mint === SOLANA_USDC_MINT);
    const postAmount = BigInt(p.uiTokenAmount.amount);
    const preAmount = preBal ? BigInt(preBal.uiTokenAmount.amount) : 0n;
    if (postAmount > preAmount) netIncrease += postAmount - preAmount;
  }

  if (netIncrease === 0n) return { ok: false, reason: "no USDC transfer to the expected payment address found in this transaction" };
  if (netIncrease < minAmountBaseUnits) {
    return { ok: false, reason: `received ${netIncrease.toString()} USDC base units, need at least ${minAmountBaseUnits.toString()}` };
  }
  return { ok: true, amountReceived: netIncrease.toString() };
}
