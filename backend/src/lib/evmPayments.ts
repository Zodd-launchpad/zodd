/**
 * EVM payment verification for the NEAR-launch $8 fee (nearFees.ts),
 * covering ETH and a stablecoin on Base AND Robinhood Chain (Brai,
 * 2026-09-30: "con eth y usdc de base y robinhood", corrected same day:
 * "USDG dsde robinhood perdon, me equivoque" -- the stablecoin leg is
 * USDC on Base but USDG on Robinhood Chain, not USDC on both). One
 * module, parameterized by chain, instead of near-duplicate files --
 * Base and Robinhood Chain are both plain EVM chains (Robinhood Chain is
 * an Arbitrum Orbit L2, confirmed below), so the verification logic is
 * identical; only the per-chain constants (including WHICH stablecoin)
 * differ.
 *
 * Unlike the ZEC flow (a one-time address we generate and then poll for
 * an incoming payment, see zcashReal.ts), the creator already has a
 * connected EVM wallet (Metamask/Rabby -- see walletAuth.ts's
 * verifyEvmSignature, shipped alongside EVM login). So this flow is:
 * the frontend has the wallet send the payment directly, gets back a tx
 * hash immediately, and hands that hash to us -- we then verify THAT
 * SPECIFIC transaction on-chain ourselves before ever marking a launch
 * PAID. This avoids generating and later sweeping one-time custodial EVM
 * keys per launch, which would be a meaningfully bigger custody-risk
 * surface for very little benefit here.
 *
 * ---- Real chain facts, verified 2026-09-30 (not guessed -- see the
 * standing "no hagas estupideces de gastarme dinero a lo tonto" rule) ----
 *
 * Base: chain id 8453, public RPC https://mainnet.base.org (both
 * long-established, widely-used facts). USDC contract
 * 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913, 6 decimals -- Circle's own
 * official native USDC on Base, cross-confirmed against Circle's
 * multi-chain USDC contract-address page and BaseScan's own "Circle:
 * USDC Token" label. High confidence.
 *
 * Robinhood Chain: chain id 4663 (0x1237), native currency ETH (gas paid
 * in ETH, no separate gas token), public RPC
 * https://rpc.mainnet.chain.robinhood.com, Blockscout explorer at
 * robinhoodchain.blockscout.com -- all cross-confirmed across Robinhood's
 * own support article, Robinhood's own developer docs, and chainlist.org.
 * It's an Arbitrum Orbit L2 (Nitro stack) that settles to Ethereum,
 * mainnet-live since 2026-07-01. Its stablecoin is USDG (Global Dollar,
 * issued by Paxos -- the network Robinhood/Kraken/Paxos launched
 * together), contract 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 6
 * decimals -- taken directly from Robinhood's OWN published contract
 * list (docs.robinhood.com/chain/contracts, which lists exactly two
 * tokens: WETH and USDG) and cross-confirmed on Robinhood Chain's own
 * Etherscan-family explorer (robin.etherscan.io), which independently
 * reports "Global Dollar / USDG / 6 decimals" for that same address.
 * High confidence -- unlike the USDC-on-Robinhood-Chain address this
 * file used earlier this session (a third-party "canonical Arbitrum
 * bridge" address, NOT on Robinhood's own list at all, since USDC isn't
 * actually a first-class asset there -- removed once Brai corrected the
 * requirement to USDG).
 *
 * Also worth keeping in mind (flagged, not a blocker): Robinhood Chain
 * only launched 2026-07-01 (2 months old at time of writing) and already
 * has a well-documented $15.5M rug-pull incident on a launchpad built on
 * it (Pons, via tax-exemption abuse + wallet bundling).
 */
import { ethers } from "ethers";

export type EvmChainKey = "BASE" | "ROBINHOOD";

export interface EvmChainConfig {
  key: EvmChainKey;
  chainId: number;
  chainName: string;
  rpcUrl: string;
  /** Base explorer URL (no trailing slash) -- what wallet_addEthereumChain's
   * blockExplorerUrls wants, distinct from explorerTxUrl below (a specific
   * tx's page). */
  explorerBaseUrl: string;
  explorerTxUrl: (txHash: string) => string;
  /** The chain's stablecoin payment asset -- USDC on Base, USDG on
   * Robinhood Chain. Different symbol AND different contract per chain
   * on purpose (see the module header); callers pass asset: "STABLE" and
   * never need to know which one it actually is. */
  stablecoinSymbol: "USDC" | "USDG";
  stablecoinAddress: string;
  stablecoinDecimals: number;
}

export const EVM_CHAINS: Record<EvmChainKey, EvmChainConfig> = {
  BASE: {
    key: "BASE",
    chainId: 8453,
    chainName: "Base",
    rpcUrl: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
    explorerBaseUrl: "https://basescan.org",
    explorerTxUrl: (txHash) => `https://basescan.org/tx/${txHash}`,
    stablecoinSymbol: "USDC",
    stablecoinAddress: process.env.BASE_USDC_ADDRESS ?? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    stablecoinDecimals: 6,
  },
  ROBINHOOD: {
    key: "ROBINHOOD",
    chainId: 4663,
    chainName: "Robinhood Chain",
    rpcUrl: process.env.ROBINHOOD_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com",
    explorerBaseUrl: "https://robinhoodchain.blockscout.com",
    explorerTxUrl: (txHash) => `https://robinhoodchain.blockscout.com/tx/${txHash}`,
    stablecoinSymbol: "USDG",
    stablecoinAddress: process.env.ROBINHOOD_USDG_ADDRESS ?? "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    stablecoinDecimals: 6,
  },
};

const ERC20_TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

/** Minimum block confirmations before a payment is trusted -- guards
 * against a reorg un-confirming a payment we already acted on. Modest on
 * purpose: these are L2s (Base, and Robinhood Chain which settles to
 * Ethereum via Arbitrum's fraud-proof window), not something needing
 * Bitcoin-style depth, and a creator waiting to launch their token
 * shouldn't be stuck behind an overly conservative wait. */
const MIN_CONFIRMATIONS = Number(process.env.EVM_PAYMENT_MIN_CONFIRMATIONS ?? 3);

/** A submitted tx hash older than this is refused outright -- defense in
 * depth against someone handing us an old, unrelated tx hash that
 * happens to satisfy the recipient/amount check for some other reason.
 * Generous: real payments should confirm within minutes, but poll
 * delays/retries on the frontend shouldn't make a legitimate payment
 * fail this. */
const MAX_PAYMENT_AGE_MS = Number(process.env.EVM_PAYMENT_MAX_AGE_MS ?? 24 * 60 * 60 * 1000);

function providerFor(chainKey: EvmChainKey): ethers.JsonRpcProvider {
  const cfg = EVM_CHAINS[chainKey];
  return new ethers.JsonRpcProvider(cfg.rpcUrl, cfg.chainId);
}

export interface EvmPaymentVerification {
  ok: boolean;
  reason?: string;
  /** Actual amount received, in the asset's base units (wei for ETH,
   * the stablecoin's own decimals otherwise), as a decimal string. Only
   * set when ok. */
  amountReceived?: string;
}

/**
 * Verifies that `txHash` on `chainKey` is a real, confirmed, successful
 * transfer of at least `minAmountBaseUnits` of `asset` to
 * `expectedRecipient` -- everything nearLaunchPayments.ts needs before it
 * may call store.markNearLaunchPaid. Never throws on a bad/unconfirmed
 * tx; returns { ok: false, reason } instead, same "don't 500 the caller
 * over data that just doesn't check out yet" spirit as
 * verifyEvmSignature in walletAuth.ts.
 */
export async function verifyEvmPayment(params: {
  chainKey: EvmChainKey;
  asset: "NATIVE" | "STABLE";
  txHash: string;
  expectedRecipient: string;
  minAmountBaseUnits: bigint;
}): Promise<EvmPaymentVerification> {
  const { chainKey, asset, txHash, expectedRecipient, minAmountBaseUnits } = params;
  const cfg = EVM_CHAINS[chainKey];

  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return { ok: false, reason: "malformed tx hash" };
  let expected: string;
  try {
    expected = ethers.getAddress(expectedRecipient);
  } catch {
    return { ok: false, reason: "malformed expected recipient address" };
  }

  const provider = providerFor(chainKey);

  let tx: ethers.TransactionResponse | null;
  let receipt: ethers.TransactionReceipt | null;
  try {
    [tx, receipt] = await Promise.all([provider.getTransaction(txHash), provider.getTransactionReceipt(txHash)]);
  } catch (e: any) {
    return { ok: false, reason: `RPC error looking up tx: ${e?.message ?? String(e)}` };
  }
  if (!tx || !receipt) return { ok: false, reason: "transaction not found (not broadcast yet, or wrong chain)" };
  if (receipt.status !== 1) return { ok: false, reason: "transaction reverted/failed on-chain" };

  let currentBlock: number;
  try {
    currentBlock = await provider.getBlockNumber();
  } catch (e: any) {
    return { ok: false, reason: `RPC error reading current block: ${e?.message ?? String(e)}` };
  }
  const confirmations = currentBlock - receipt.blockNumber + 1;
  if (confirmations < MIN_CONFIRMATIONS) {
    return { ok: false, reason: `only ${confirmations} confirmation(s), need ${MIN_CONFIRMATIONS} -- try again shortly` };
  }

  try {
    const block = await provider.getBlock(receipt.blockNumber);
    if (block?.timestamp) {
      const ageMs = Date.now() - block.timestamp * 1000;
      if (ageMs > MAX_PAYMENT_AGE_MS) {
        return { ok: false, reason: `transaction is too old (${Math.round(ageMs / 3_600_000)}h) to be accepted as a fresh payment` };
      }
    }
  } catch {
    // Non-fatal: age check is defense-in-depth, not the primary guard (amount + uniqueness are).
  }

  if (asset === "NATIVE") {
    if (!tx.to || ethers.getAddress(tx.to) !== expected) return { ok: false, reason: "tx recipient does not match expected payment address" };
    if (tx.value < minAmountBaseUnits) return { ok: false, reason: `sent ${tx.value.toString()}, need at least ${minAmountBaseUnits.toString()}` };
    return { ok: true, amountReceived: tx.value.toString() };
  }

  // STABLE (USDC on Base, USDG on Robinhood Chain): read the ERC-20
  // Transfer event(s) from the receipt logs rather than trusting
  // tx.to/tx.value (a token send is a contract call, not a value
  // transfer -- tx.value is 0 and meaningless here).
  const stableAddr = ethers.getAddress(cfg.stablecoinAddress);
  let totalToExpected = 0n;
  for (const log of receipt.logs) {
    if (ethers.getAddress(log.address) !== stableAddr) continue;
    if (log.topics[0] !== ERC20_TRANSFER_TOPIC || log.topics.length < 3) continue;
    const to = ethers.getAddress("0x" + log.topics[2].slice(26));
    if (to !== expected) continue;
    const value = BigInt(log.data === "0x" ? "0x0" : log.data);
    totalToExpected += value;
  }
  if (totalToExpected === 0n) return { ok: false, reason: `no ${cfg.stablecoinSymbol} Transfer to the expected payment address found in this transaction` };
  if (totalToExpected < minAmountBaseUnits) {
    return { ok: false, reason: `received ${totalToExpected.toString()} ${cfg.stablecoinSymbol} base units, need at least ${minAmountBaseUnits.toString()}` };
  }
  return { ok: true, amountReceived: totalToExpected.toString() };
}
