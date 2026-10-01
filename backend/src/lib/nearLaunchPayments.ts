/**
 * Multi-chain payment collection for the NEAR-launch $8 fee (nearFees.ts)
 * -- Brai, 2026-09-30: "tiene que ser multiwallet, soportar evm como
 * pago, con eth y usdc de base y robinhood y tambien usdc de solana y zec
 * de la wallet de zec". This is the one place that ties together:
 *   - nearFees.ts (how much is owed, in USD)
 *   - zecPrice.ts / evmPrice.ts (USD -> asset conversion)
 *   - zcashReal.ts (the existing ZEC deposit-address-and-poll flow, reused as-is)
 *   - evmPayments.ts / solanaPayments.ts (submitted-tx-hash verification)
 *   - store.ts (persistence)
 *
 * Two very different flows live here on purpose, matching how each chain
 * is actually used in this codebase:
 *   - ZEC: quoteNearLaunchPayment reserves a one-time diversified address
 *     (same as every other real-ZEC flow) and the payment is detected
 *     later by zcashReal.ts's poll loop -- server.ts's
 *     handlePaymentDetected dispatcher calls store.markNearLaunchPaid
 *     directly once it lands, same as it does for orders/token-creations.
 *     verifyAndMarkNearLaunchPaid below is NOT used for ZEC.
 *   - BASE_ETH/BASE_USDC/ROBINHOOD_ETH/ROBINHOOD_USDG/SOLANA_USDC: the
 *     creator's own connected wallet sends the payment directly to a
 *     fixed treasury address for that chain, and the frontend calls
 *     verifyAndMarkNearLaunchPaid with the resulting tx hash/signature.
 *     Note ROBINHOOD_USDG, not ROBINHOOD_USDC -- Brai corrected this
 *     2026-09-30 ("USDG dsde robinhood perdon, me equivoque"): Robinhood
 *     Chain's stablecoin is USDG (Robinhood's own primary settlement
 *     asset there), not USDC -- see evmPayments.ts's module header.
 */
import * as zcashReal from "./zcashReal.js";
import { getZecUsdPrice } from "./zecPrice.js";
import { getEthUsdPrice } from "./evmPrice.js";
import { verifyEvmPayment, EVM_CHAINS, type EvmChainKey } from "./evmPayments.js";
import { verifySolanaUsdcPayment, SOLANA_USDC_MINT, SOLANA_USDC_DECIMALS } from "./solanaPayments.js";
import * as store from "./store.js";
import { NEAR_LAUNCH_MAX_TOTAL_USD } from "./nearFees.js";

/** Everything the frontend needs to construct the actual on-chain send for
 * an EVM/Solana payment method (chain id for wallet_switchEthereumChain,
 * stablecoin contract + decimals for building an ERC-20 transfer, the
 * Solana USDC mint) WITHOUT hardcoding any of those constants a second
 * time client-side -- this is the single source of truth
 * (evmPayments.ts/solanaPayments.ts), just re-exposed read-only. None of
 * this is secret; it's the same public chain data a block explorer shows.
 */
export function getPaymentChainConfig() {
  return {
    evm: Object.fromEntries(
      (Object.keys(EVM_CHAINS) as EvmChainKey[]).map((key) => {
        const cfg = EVM_CHAINS[key];
        return [
          key,
          {
            chainId: cfg.chainId,
            chainIdHex: `0x${cfg.chainId.toString(16)}`,
            chainName: cfg.chainName,
            rpcUrl: cfg.rpcUrl,
            explorerBaseUrl: cfg.explorerBaseUrl,
            stablecoinSymbol: cfg.stablecoinSymbol,
            stablecoinAddress: cfg.stablecoinAddress,
            stablecoinDecimals: cfg.stablecoinDecimals,
          },
        ];
      })
    ),
    solana: { usdcMint: SOLANA_USDC_MINT, usdcDecimals: SOLANA_USDC_DECIMALS },
  };
}

export type NearLaunchPaymentMethod = "ZEC" | "BASE_ETH" | "BASE_USDC" | "ROBINHOOD_ETH" | "ROBINHOOD_USDG" | "SOLANA_USDC";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set -- required to accept NEAR-launch payments on this method`);
  return v;
}

/** Our fixed, platform-controlled receiving address for each non-ZEC
 * method. One address per CHAIN (not per method) for the EVM methods --
 * the same Base address receives both BASE_ETH and BASE_USDC, and the
 * same Robinhood Chain address receives both ROBINHOOD_ETH and
 * ROBINHOOD_USDG -- since both assets on a chain are just different
 * transfers to the same account. Read lazily (not at module load) so a
 * missing env var only breaks the one payment method that needs it,
 * never import of this module itself. */
function evmTreasuryAddress(chainKey: EvmChainKey): string {
  return requireEnv(chainKey === "BASE" ? "NEAR_LAUNCH_BASE_PAYMENT_ADDRESS" : "NEAR_LAUNCH_ROBINHOOD_PAYMENT_ADDRESS");
}
function solanaTreasuryAddress(): string {
  return requireEnv("NEAR_LAUNCH_SOLANA_PAYMENT_ADDRESS");
}

export interface NearLaunchPaymentQuote {
  method: NearLaunchPaymentMethod;
  /** Where the creator sends the payment. A one-time ZEC address for
   * ZEC, our fixed treasury address for every other method. */
  address: string;
  /** Human-readable amount (not base units) -- e.g. "0.0019" ETH, "8.00"
   * USDC, "0.312" ZEC. What the frontend SHOWS the creator. */
  amountDisplay: string;
  /** The exact amount in the asset's own base units (wei / 6-decimal
   * stablecoin units / plain ZEC decimal string) -- what the frontend
   * must actually SEND. Not the same string as amountDisplay: that one
   * is rounded for display, this one is the precise value
   * verifyAndMarkNearLaunchPaid checks the payment against, so sending
   * amountDisplay's rounded figure instead of this could under-pay by a
   * dust amount and fail verification. Irrelevant for ZEC (the wallet
   * flow there is scan-a-QR / send-this-exact-amount, same as everywhere
   * else in this codebase, not a raw base-units send) -- present for
   * every method regardless, for a uniform frontend contract.
   */
  amountBaseUnits: string;
  usdLocked: number;
}

/**
 * Quotes and locks in a payment method for a launch that hasn't paid yet
 * -- persists the quote via store.setNearLaunchPaymentQuote so a later
 * verify call (or the ZEC poll loop) knows exactly what was promised.
 * Always quotes the full NEAR_LAUNCH_MAX_TOTAL_USD ($8): this project
 * doesn't have a variable-amount UI, every launch costs the same flat
 * total (nearFees.ts's computeNearLaunchBudget then splits that into fee
 * vs. liquidity). Throws if the launch is missing or already past
 * PENDING.
 */
export async function quoteNearLaunchPayment(launchId: string, method: NearLaunchPaymentMethod): Promise<NearLaunchPaymentQuote> {
  const launch = await store.getPendingNearLaunch(launchId);
  if (!launch) throw new Error(`no such NEAR launch: ${launchId}`);
  if (launch.status !== "PENDING") throw new Error(`launch ${launchId} is already ${launch.status}, not accepting a new payment quote`);

  const usd = NEAR_LAUNCH_MAX_TOTAL_USD;

  if (method === "ZEC") {
    const { usd: zecUsd } = getZecUsdPrice();
    if (!zecUsd) throw new Error("ZEC/USD price is not available right now -- try again shortly");
    const zecAmount = usd / zecUsd;
    const reserved = await zcashReal.generateOrderAddress(launchId, zecAmount);
    await store.setNearLaunchPaymentQuote(launchId, {
      method,
      amountExpectedBaseUnits: String(reserved.expectedZecAmount),
      usdLocked: usd,
      zecAddress: reserved.address,
      zecSaplingDiversifierHex: reserved.saplingDiversifierHex ?? undefined,
      zecOrchardDiversifierHex: reserved.orchardDiversifierHex ?? undefined,
    });
    return {
      method,
      address: reserved.address,
      amountDisplay: reserved.expectedZecAmount.toFixed(8),
      amountBaseUnits: String(reserved.expectedZecAmount),
      usdLocked: usd,
    };
  }

  if (method === "BASE_ETH" || method === "ROBINHOOD_ETH") {
    const chainKey: EvmChainKey = method === "BASE_ETH" ? "BASE" : "ROBINHOOD";
    const { usd: ethUsd } = getEthUsdPrice();
    if (!ethUsd) throw new Error("ETH/USD price is not available right now -- try again shortly");
    const ethAmount = usd / ethUsd;
    const weiAmount = BigInt(Math.ceil(ethAmount * 1e18));
    const address = evmTreasuryAddress(chainKey);
    await store.setNearLaunchPaymentQuote(launchId, { method, amountExpectedBaseUnits: weiAmount.toString(), usdLocked: usd });
    return { method, address, amountDisplay: ethAmount.toFixed(8), amountBaseUnits: weiAmount.toString(), usdLocked: usd };
  }

  if (method === "BASE_USDC" || method === "ROBINHOOD_USDG") {
    const chainKey: EvmChainKey = method === "BASE_USDC" ? "BASE" : "ROBINHOOD";
    const cfg = EVM_CHAINS[chainKey];
    const stableBaseUnits = BigInt(Math.ceil(usd * 10 ** cfg.stablecoinDecimals));
    const address = evmTreasuryAddress(chainKey);
    await store.setNearLaunchPaymentQuote(launchId, { method, amountExpectedBaseUnits: stableBaseUnits.toString(), usdLocked: usd });
    return { method, address, amountDisplay: usd.toFixed(2), amountBaseUnits: stableBaseUnits.toString(), usdLocked: usd };
  }

  // SOLANA_USDC
  const usdcBaseUnits = BigInt(Math.ceil(usd * 10 ** SOLANA_USDC_DECIMALS));
  const address = solanaTreasuryAddress();
  await store.setNearLaunchPaymentQuote(launchId, { method, amountExpectedBaseUnits: usdcBaseUnits.toString(), usdLocked: usd });
  return { method, address, amountDisplay: usd.toFixed(2), amountBaseUnits: usdcBaseUnits.toString(), usdLocked: usd };
}

/**
 * Verifies a submitted tx hash/signature against the quote already
 * locked in by quoteNearLaunchPayment, and marks the launch PAID if it
 * checks out. ONLY for the submitted-tx methods (everything except ZEC
 * -- see this module's header); called from whatever HTTP route the
 * frontend posts the tx ref to once the creator's wallet confirms the
 * send. Idempotent: re-submitting the same already-verified txRef for
 * the same launch just returns the already-PAID view rather than erroring.
 */
export async function verifyAndMarkNearLaunchPaid(launchId: string, txRef: string): Promise<store.PendingNearLaunchView> {
  const launch = await store.getPendingNearLaunch(launchId);
  if (!launch) throw new Error(`no such NEAR launch: ${launchId}`);
  if (launch.paymentMethod === "ZEC") throw new Error("ZEC payments are detected automatically, not submitted -- nothing to verify here");
  if (!launch.paymentMethod || !launch.paymentAmountExpected) throw new Error(`launch ${launchId} has no payment quote yet -- call quoteNearLaunchPayment first`);

  if (launch.status !== "PENDING") {
    if (launch.status !== "PAID" || launch.paymentTxRef !== txRef) {
      throw new Error(`launch ${launchId} is already ${launch.status}`);
    }
    return launch; // idempotent re-submit of the same tx that already paid this launch
  }

  const existing = await store.getNearLaunchByPaymentTxRef(txRef);
  if (existing && existing.id !== launchId) {
    throw new Error(`this transaction was already used to pay for a different launch (${existing.id})`);
  }

  const minAmount = BigInt(launch.paymentAmountExpected);

  switch (launch.paymentMethod) {
    case "BASE_ETH":
    case "ROBINHOOD_ETH": {
      const chainKey: EvmChainKey = launch.paymentMethod === "BASE_ETH" ? "BASE" : "ROBINHOOD";
      const result = await verifyEvmPayment({
        chainKey,
        asset: "NATIVE",
        txHash: txRef,
        expectedRecipient: evmTreasuryAddress(chainKey),
        minAmountBaseUnits: minAmount,
      });
      if (!result.ok) throw new Error(`payment verification failed: ${result.reason}`);
      break;
    }
    case "BASE_USDC":
    case "ROBINHOOD_USDG": {
      const chainKey: EvmChainKey = launch.paymentMethod === "BASE_USDC" ? "BASE" : "ROBINHOOD";
      const result = await verifyEvmPayment({
        chainKey,
        asset: "STABLE",
        txHash: txRef,
        expectedRecipient: evmTreasuryAddress(chainKey),
        minAmountBaseUnits: minAmount,
      });
      if (!result.ok) throw new Error(`payment verification failed: ${result.reason}`);
      break;
    }
    case "SOLANA_USDC": {
      const result = await verifySolanaUsdcPayment({
        signature: txRef,
        expectedRecipientOwner: solanaTreasuryAddress(),
        minAmountBaseUnits: minAmount,
      });
      if (!result.ok) throw new Error(`payment verification failed: ${result.reason}`);
      break;
    }
    default:
      throw new Error(`unexpected payment method ${launch.paymentMethod}`);
  }

  return store.markNearLaunchPaid(launchId, txRef);
}
