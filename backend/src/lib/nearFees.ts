/**
 * NEAR launch cost/fee structure. Brai, 2026-09-30, in order:
 *   "$5 tienen q ser para mi y el resto se puede gastar en la liquidez"
 *   "fee de plataforma 3 dolares quiero"
 *   "ok fee de plataforma 3 dolares quiero y que total no supere los 8
 *    dolares para deployar un token"
 * Final requirement: platform fee = $3 FIXED (infra cost already included
 * within it -- the creator doesn't pay infra on top), hard ceiling of $8
 * total per launch. Whatever's left after infra cost + the $3 fee goes
 * into the DCL pool's initial liquidity.
 *
 * NOT YET DECIDED (flagged to Brai 2026-09-30, blocking the PENDING->PAID
 * step in nearLaunch.ts, NOT the PAID->LIVE orchestration, which doesn't
 * need this answered): what currency the creator actually pays the $8 in,
 * and where the USD conversion rate comes from. Candidates, given what
 * this repo already has: (a) NEAR itself, at a live NEAR/USD price feed;
 * (b) ZEC, same flow as the existing token-create fee (createFeeZecFor in
 * fees.ts), converted to NEAR by us before spending it; (c) USDC via the
 * creator's own EVM wallet (Metamask/Rabby, connect-evm just shipped),
 * bridged or swapped to NEAR by us. Each implies a different watch/confirm
 * mechanism (mirroring either the zecAddress poll in zcashReal.ts or an
 * EVM tx-hash confirmation), so building the PENDING->PAID trigger before
 * this is decided would very likely mean throwaway work -- exactly what
 * Brai has pushed back on all session ("no hagas estupideces de gastarme
 * dinero a lo tonto"). Do not guess this; ask.
 */

/** The fixed, all-in platform fee per launch, in USD. Infra cost (account
 * storage, contract storage, the DCL pool's registration + create_pool
 * deposit, gas) comes OUT OF this $3 -- the creator never pays infra on
 * top of it. See computeNearLaunchBudget below for the actual split. */
export const NEAR_LAUNCH_PLATFORM_FEE_USD = Number(process.env.NEAR_LAUNCH_PLATFORM_FEE_USD ?? 3);

/** Hard ceiling on what a creator pays in total for one launch. Brai:
 * "que total no supere los 8 dolares para deployar un token". */
export const NEAR_LAUNCH_MAX_TOTAL_USD = Number(process.env.NEAR_LAUNCH_MAX_TOTAL_USD ?? 8);

/**
 * Real mainnet infra-cost components, in NEAR, verified this session
 * against live production transactions via the NearBlocks indexer API
 * (api.nearblocks.io) rather than testnet guesses or storage-bound view
 * calls that turned out not to match real transaction costs, AND (2026-
 * 09-30, this update) against two independent real, currently-live
 * launchpads' actual launch transactions on dclv2.ref-labs.near
 * (keypadlaunch.near and launchpad.justhoot.near, found via the
 * NearBlocks indexer API), which settled several numbers below and
 * corrected one real misunderstanding: there is NO per-launch
 * dclv2.ref-labs.near storage registration. The 0.5 NEAR
 * storage_deposit this file used to budget per launch never appears in
 * either real launchpad's per-launch transaction sequence -- only
 * per-launch storage_deposit calls this file's real evidence actually
 * shows are on the TOKEN's OWN contract (registering dclv2 and the
 * locker as holders of the new token, ~0.00125 NEAR each, see
 * TOKEN_SIDE_REGISTRATIONS_NEAR below). Whatever one-time dclv2
 * registration a launchpad account needs happens once, before its first
 * launch ever -- see NEAR_ADMIN_ONE_TIME_SETUP below, NOT part of the
 * per-launch $8 budget.
 *
 *   - Account creation reserve: NEAR's protocol minimum, ~0.00182 NEAR
 *     (182 bytes of base account storage @ 10^19 yocto/byte).
 *   - Token contract storage: UNKNOWN until the Rust token contract
 *     (../../near-zodd-launch-rust/token) actually compiles to wasm32 --
 *     this sandbox cannot produce that binary (blocked rustup target
 *     download, see that project's lib.rs header). DO NOT spend real
 *     money against TOKEN_CONTRACT_STORAGE_NEAR_ESTIMATE below without
 *     first replacing it with the real `code.length * 10^19` yoctoNEAR
 *     once the real .wasm exists -- promised to Brai directly: "te doy
 *     el número real de bytes cuando esté compilado, antes de gastar
 *     nada." This estimate (100KB) is deliberately conservative (near-sdk-
 *     rs contracts this size are typically 80-150KB unoptimized, smaller
 *     with the `opt-level = "z"` + `strip = true` release profile already
 *     set in Cargo.toml) -- a placeholder to let the rest of this module's
 *     arithmetic be written and reviewed now, not a number to deploy
 *     against.
 *   - Token-side storage registrations: ~0.00125 NEAR each (the standard
 *     NEP-145 bound) for dclv2 and the locker contract to be able to
 *     hold the new token -- exactly 2 calls, confirmed real shape
 *     (`storage_deposit({account_id, registration_only: true})` called
 *     ON THE NEW TOKEN's own contract, once per holder).
 *   - create_pool deposit: real observed values ranged 0.05-0.1 NEAR
 *     across the two launchpads -- 0.1 NEAR kept here as a safe margin
 *     (NOT the 1 NEAR testnet-derived guess used earlier this session).
 *   - Liquidity seeding itself costs NO additional NEAR: both real
 *     launchpads seed a ONE-SIDED DCL position (confirmed real
 *     add_liquidity args: `amount_y: "0"`) using only the newly minted
 *     token supply across a wide point range (left_point: 200,
 *     right_point: 500000) -- no wrap.near is deposited at launch time,
 *     the NEAR side of the pool fills in naturally as the first buyers
 *     swap in. This means "el resto se puede gastar en la liquidez"
 *     works out cheaper than it sounded: the "liquidity spend" is more
 *     of the token's own supply, not real NEAR converted to wrap.near --
 *     flagged to Brai, not assumed silently.
 *   - Gas: negligible at NEAR's current gas_price (~0.03 NEAR even at a
 *     full 300 Tgas transaction) -- rounded up generously below anyway.
 */
const ACCOUNT_CREATION_RESERVE_NEAR = 0.00182;
export const TOKEN_CONTRACT_STORAGE_NEAR_ESTIMATE = Number(
  process.env.NEAR_TOKEN_CONTRACT_STORAGE_NEAR_ESTIMATE ?? 1.0 // 100KB placeholder @ 10 NEAR/100KB -- SEE COMMENT ABOVE, replace once real wasm exists
);
const TOKEN_SIDE_REGISTRATIONS_NEAR = 0.0025; // dclv2 + locker, ~0.00125 NEAR each
export const CREATE_POOL_DEPOSIT_NEAR = Number(process.env.NEAR_CREATE_POOL_DEPOSIT_NEAR ?? 0.1);
const GAS_BUDGET_NEAR = 0.05; // generous vs. the observed ~0.03 NEAR ceiling

/** One-time cost (NOT per launch) for the admin account to become able
 * to use dclv2.ref-labs.near at all -- the 0.5 NEAR storage_deposit this
 * file used to (wrongly) budget per launch. Spend this once, before the
 * very first real launch, the same way the shared locker contract itself
 * is only ever deployed once. Kept here, not folded into
 * estimateNearInfraCostNear, specifically so it can never accidentally
 * get charged to a creator per launch. */
export const NEAR_ADMIN_ONE_TIME_DCLV2_REGISTRATION_NEAR = 0.5;

export interface NearInfraCost {
  accountCreation: number;
  tokenContractStorage: number;
  tokenSideRegistrations: number;
  createPoolDeposit: number;
  gas: number;
  total: number;
}

export function estimateNearInfraCostNear(): NearInfraCost {
  const accountCreation = ACCOUNT_CREATION_RESERVE_NEAR;
  const tokenContractStorage = TOKEN_CONTRACT_STORAGE_NEAR_ESTIMATE;
  const tokenSideRegistrations = TOKEN_SIDE_REGISTRATIONS_NEAR;
  const createPoolDeposit = CREATE_POOL_DEPOSIT_NEAR;
  const gas = GAS_BUDGET_NEAR;
  return {
    accountCreation,
    tokenContractStorage,
    tokenSideRegistrations,
    createPoolDeposit,
    gas,
    total: accountCreation + tokenContractStorage + tokenSideRegistrations + createPoolDeposit + gas,
  };
}

export interface NearLaunchBudget {
  /** Total the creator pays, in USD. Always <= NEAR_LAUNCH_MAX_TOTAL_USD. */
  totalUsd: number;
  /** Real infra cost (converted to USD at nearUsdPrice), taken out of the
   * $3 platform fee FIRST -- the creator never pays this on top of the fee. */
  infraCostUsd: number;
  /** What's actually left for Brai after infra cost eats into the fixed
   * $3 fee. Brai, 2026-09-30: "pero no ves q hay plata que se estan
   * llevando q no esta en storage" -- the whole point of this function is
   * making sure this number is never silently smaller than expected
   * without it being visible in the launch record. */
  platformNetUsd: number;
  /** Whatever's left over after infra + the $3 fee, seeded into the DCL
   * pool as initial liquidity. */
  liquidityUsd: number;
}

/**
 * `totalPaidUsd` is whatever the creator actually paid (capped at
 * NEAR_LAUNCH_MAX_TOTAL_USD upstream, wherever the payment is collected --
 * see the not-yet-decided note at the top of this file). Throws if the
 * infra cost alone would exceed the $3 platform fee: that would mean
 * Brai's platform NETS NEGATIVE on this launch, which per his standing
 * "no hagas estupideces de gastarme dinero a lo tonto" instruction must
 * never happen silently -- nearLaunch.ts should catch this and refuse the
 * launch outright rather than eating the loss.
 */
export function computeNearLaunchBudget(totalPaidUsd: number, infraCostUsd: number): NearLaunchBudget {
  if (infraCostUsd > NEAR_LAUNCH_PLATFORM_FEE_USD) {
    throw new Error(
      `NEAR launch infra cost ($${infraCostUsd.toFixed(2)}) exceeds the $${NEAR_LAUNCH_PLATFORM_FEE_USD} platform fee -- ` +
        `this launch would net the platform negative, refusing rather than eating the loss.`
    );
  }
  const platformNetUsd = NEAR_LAUNCH_PLATFORM_FEE_USD - infraCostUsd;
  const liquidityUsd = totalPaidUsd - NEAR_LAUNCH_PLATFORM_FEE_USD;
  if (liquidityUsd < 0) {
    throw new Error(
      `NEAR launch payment ($${totalPaidUsd.toFixed(2)}) is less than the $${NEAR_LAUNCH_PLATFORM_FEE_USD} platform fee -- cannot proceed.`
    );
  }
  return { totalUsd: totalPaidUsd, infraCostUsd, platformNetUsd, liquidityUsd };
}
