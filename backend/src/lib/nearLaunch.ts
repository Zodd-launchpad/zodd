/**
 * NEAR launch orchestration -- the backend-signed replacement for an
 * on-chain launcher contract. Brai, 2026-09-30: "ok avanzamos" (approving
 * this architecture after Global Contracts proved mathematically
 * incompatible with the $10 total-platform-deploy ceiling -- see the
 * session notes). Same spirit as zcashReal.ts's payment poll loop: a
 * setInterval tick that finds whatever rows need work and advances them
 * one step, so a backend restart mid-launch just resumes from
 * PendingNearLaunch.currentStep instead of losing or duplicating work.
 *
 * The two token+locker contracts this drives are the Rust ports written
 * this session -- ../../../near-zodd-launch-rust/{token,locker} -- NOT
 * the earlier near-sdk-js contracts. See those projects' own lib.rs
 * header comments for why (near-sdk-js's ~400-450KB interpreter floor
 * didn't fit the $8-per-launch budget; Rust does).
 *
 * STATUS: all 6 steps are implemented against REAL, CONFIRMED argument
 * shapes now. Steps 4-6 (create_pool / add_liquidity / lock the position)
 * were initially left as deliberate throw-stubs because their exact
 * dclv2.ref-labs.near argument shapes hadn't been re-verified this
 * session the way every cost figure in nearFees.ts had -- rather than
 * guess and risk running wrong calls with real creator money. They were
 * then filled in using two independent real, currently-live launchpads'
 * ACTUAL mainnet transactions on dclv2.ref-labs.near (keypadlaunch.near
 * and launchpad.justhoot.near, found via the NearBlocks indexer API and
 * cross-checked against the raw RPC receipt/event logs, not just
 * NearBlocks' own parsing) -- same evidence-over-guessing standard the
 * cost figures were already held to. What that real evidence also
 * revealed, and is worth restating here because it changes the shape of
 * "liquidity" in nearFees.ts: neither real launchpad deposits any
 * wrap.near into the pool at launch time -- they seed a ONE-SIDED DCL
 * position (amount_y: "0") with the token's own supply across a wide
 * point range, and the NEAR side fills in naturally as the first buyers
 * swap in. This code follows that same real, working pattern by default
 * (see stepSeedLiquidity) -- still not this session's confirmed dry run,
 * so an actual dry run against the already-funded 8 NEAR diagnostic
 * account remains the honest next verification step before this runs
 * against a real creator's money.
 */
import { readFile } from "node:fs/promises";
import { Account } from "@near-js/accounts";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { KeyPair, KeyPairString, PublicKey } from "@near-js/crypto";
import { actionCreators } from "@near-js/transactions";
import type { FinalExecutionOutcome } from "@near-js/types";
import * as store from "./store.js";
import { estimateNearInfraCostNear, CREATE_POOL_DEPOSIT_NEAR } from "./nearFees.js";

function dclv2ContractId(): string {
  return process.env.NEAR_DCLV2_CONTRACT_ID ?? "dclv2.ref-labs.near";
}
function wrapNearContractId(): string {
  return process.env.NEAR_WRAP_NEAR_CONTRACT_ID ?? "wrap.near";
}
/** Basis-points-style fee tier dclv2 expects on create_pool -- confirmed
 * real value (10000) used identically by two independent real launchpads
 * this session (keypadlaunch.near, launchpad.justhoot.near). */
const DCL_POOL_FEE_TIER = Number(process.env.NEAR_DCL_POOL_FEE_TIER ?? 10000);
/** The DCL point (tick) range the initial one-sided liquidity position
 * spans -- confirmed real values, used identically by both real
 * launchpads across multiple launches. Wide enough that the position
 * never needs rebalancing; see stepSeedLiquidity for what "one-sided"
 * means here. */
const DCL_LEFT_POINT = Number(process.env.NEAR_DCL_LEFT_POINT ?? 200);
const DCL_RIGHT_POINT = Number(process.env.NEAR_DCL_RIGHT_POINT ?? 500_000);

const POLL_INTERVAL_MS = 15_000;
/** Below this many attempts, a failed step is just retried next tick (a
 * dropped RPC connection, a momentary nonce race, ...). At this count the
 * whole launch is marked FAILED instead -- see advanceOneLaunch. */
const MAX_STEP_ATTEMPTS = 5;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function rpcUrl(): string {
  return process.env.NEAR_RPC_URL ?? "https://rpc.mainnet.near.org";
}

function provider(): JsonRpcProvider {
  return new JsonRpcProvider({ url: rpcUrl() });
}

/** The one account this whole flow operates as: holds the NEAR that funds
 * every new launch, is the parent of every token sub-account
 * (`<slug>.<this account>`), owns the initial minted token supply post-
 * deploy, and is the admin_id the shared locker contract only accepts
 * lock_position calls from. One account covers all of those roles on
 * purpose -- splitting them would just be more keys to keep safe for no
 * real separation of powers (nothing here is adversarial to the platform
 * itself). */
function adminAccountId(): string {
  return requireEnv("NEAR_ADMIN_ACCOUNT_ID");
}

function adminAccount(): Account {
  const secretKey = requireEnv("NEAR_ADMIN_SECRET_KEY") as KeyPairString;
  return new Account(adminAccountId(), provider(), KeyPairSigner.fromSecretKey(secretKey));
}

function accountWithKey(accountId: string, secretKey: string): Account {
  return new Account(accountId, provider(), KeyPairSigner.fromSecretKey(secretKey as KeyPairString));
}

function outcomeTxHash(outcome: FinalExecutionOutcome): string {
  return outcome.transaction_outcome.id;
}

/** Decodes a function call's return value. Confirmed real shape: a
 * dclv2.ref-labs.near add_liquidity call's FinalExecutionOutcome.status
 * .SuccessValue, base64-decoded, is the JSON-encoded lpt_id string
 * itself -- e.g. `"hoot-1.keypadlaunch.near|wrap.near|10000#17325"` --
 * verified directly against a real mainnet receipt's raw RPC response
 * this session, not assumed from a type definition. */
function decodeSuccessValue<T>(outcome: FinalExecutionOutcome): T {
  const status = outcome.status;
  if (typeof status !== "object" || status === null || !("SuccessValue" in status) || typeof status.SuccessValue !== "string") {
    throw new Error("expected a SuccessValue in the transaction outcome, got: " + JSON.stringify(status));
  }
  return JSON.parse(Buffer.from(status.SuccessValue, "base64").toString("utf-8")) as T;
}

/** Converts a NEAR amount to yoctoNEAR without the float-precision loss
 * `BigInt(Math.round(near * 1e24))` would risk at that scale (1e24 is well
 * past a double's ~15-17 safe significant digits). Every NEAR amount this
 * file deals with (see nearFees.ts) has at most a handful of decimal
 * digits, so scaling by 1e6 first -- safely inside integer-precise float
 * range -- then making up the rest of the 24 decimals as a BigInt
 * multiplication is exact for every value actually used here. */
function nearToYocto(near: number): bigint {
  return BigInt(Math.round(near * 1_000_000)) * 10n ** 18n;
}

/** NEAR account ids only allow lowercase letters, digits, `-`, `_`, `.`
 * (as a separator) -- and PendingNearLaunch.id is a cuid, which already
 * satisfies that (lowercase alphanumeric), so this is mostly a safety net
 * plus a length guard: the full sub-account id (`<slug>.<parent>`) has a
 * hard 64-character NEAR protocol ceiling. */
function tokenAccountSlugFor(launch: store.PendingNearLaunchView): string {
  const slug = launch.id.toLowerCase().replace(/[^a-z0-9]/g, "");
  return slug.slice(0, 32);
}

// ---------- Step 1: NOT_STARTED -> TOKEN_ACCOUNT_CREATED ----------
async function stepCreateTokenAccount(launch: store.PendingNearLaunchView): Promise<void> {
  const parent = adminAccountId();
  const tokenAccountId = `${tokenAccountSlugFor(launch)}.${parent}`;

  const keyPair = KeyPair.fromRandom("ed25519");
  const publicKey = keyPair.getPublicKey();
  const secretKey = keyPair.toString();

  // Fund only what THIS sub-account itself needs to exist and hold the
  // deployed contract's code -- the pool-side deposits (create_pool,
  // storage registration) are paid directly from the admin account at
  // those later steps, not pre-funded here.
  const infra = estimateNearInfraCostNear();
  const fundingNear = infra.accountCreation + infra.tokenContractStorage + infra.gas;

  const admin = adminAccount();
  await admin.createSubAccount(tokenAccountId, publicKey, nearToYocto(fundingNear));

  await store.advanceNearLaunchStep(launch.id, "TOKEN_ACCOUNT_CREATED", {
    tokenAccountId,
    deploySecretKey: secretKey,
  });
}

// ---------- Step 2: TOKEN_ACCOUNT_CREATED -> TOKEN_CONTRACT_DEPLOYED ----------
async function stepDeployAndInitToken(launch: store.PendingNearLaunchView): Promise<void> {
  if (!launch.tokenAccountId || !launch.deploySecretKey) {
    throw new Error("stepDeployAndInitToken: missing tokenAccountId/deploySecretKey from the previous step");
  }

  // Real deploy environment only -- this sandbox cannot produce this
  // wasm (blocked wasm32 rustup target, see the token contract's own
  // lib.rs header). Points at the actual compiled output once the real
  // build runs; NOT bundled or assumed to exist here.
  const wasmPath = requireEnv("NEAR_TOKEN_CONTRACT_WASM_PATH");
  const code = await readFile(wasmPath);

  const tokenAccount = accountWithKey(launch.tokenAccountId, launch.deploySecretKey);
  await tokenAccount.deployContract(new Uint8Array(code));

  // Args match zodd-near-token's new() exactly -- see
  // ../../../near-zodd-launch-rust/token/src/lib.rs. owner_id is the
  // admin account (not the token account itself): it's what then drives
  // create_pool / seed liquidity / hand the position to the locker in
  // the steps below, using the admin's own key rather than needing this
  // throwaway deploy key to survive past the next step.
  const outcome = await tokenAccount.signAndSendTransaction({
    receiverId: launch.tokenAccountId,
    actions: [
      actionCreators.functionCall(
        "new",
        {
          owner_id: adminAccountId(),
          total_supply: launch.totalSupply,
          name: launch.name,
          symbol: launch.symbol,
          icon: launch.icon ?? null,
          decimals: launch.decimals,
          reference: null,
          reference_hash: null,
          platform_fee_account_id: requireEnv("NEAR_PLATFORM_FEE_ACCOUNT_ID"),
          founder_fee_account_id: requireEnv("NEAR_FOUNDER_FEE_ACCOUNT_ID"),
        },
        30_000_000_000_000n, // 30 Tgas -- plenty for a single init call
        0n
      ),
    ],
  });

  await store.advanceNearLaunchStep(launch.id, "TOKEN_CONTRACT_DEPLOYED", {
    tokenDeployTxHash: outcomeTxHash(outcome),
  });
}

// ---------- Step 3: TOKEN_CONTRACT_DEPLOYED -> TOKEN_DEPLOY_KEY_REVOKED ----------
async function stepRevokeDeployKey(launch: store.PendingNearLaunchView): Promise<void> {
  if (!launch.tokenAccountId || !launch.deploySecretKey) {
    throw new Error("stepRevokeDeployKey: missing tokenAccountId/deploySecretKey from the previous step");
  }
  const tokenAccount = accountWithKey(launch.tokenAccountId, launch.deploySecretKey);
  const keyPair = KeyPair.fromString(launch.deploySecretKey as KeyPairString);

  // The contract is now permanently immutable: after this lands, there is
  // no key left anywhere, held by us or anyone else, that can deploy new
  // code over this account. Same "no rug" philosophy as the locker's
  // hardcoded remove_liquidity amount:"0" -- here it's "nobody can change
  // the token contract" instead of "nobody can touch the LP principal".
  await tokenAccount.deleteKey(keyPair.getPublicKey());

  await store.advanceNearLaunchStep(launch.id, "TOKEN_DEPLOY_KEY_REVOKED", {
    deploySecretKey: null, // no longer valid on-chain -- nothing left to protect by keeping it
  });
}

// ---------- Step 4: TOKEN_DEPLOY_KEY_REVOKED -> POOL_CREATED ----------
async function stepCreatePool(launch: store.PendingNearLaunchView): Promise<void> {
  if (!launch.tokenAccountId) throw new Error("stepCreatePool: missing tokenAccountId");
  const admin = adminAccount();

  // Real confirmed args shape (NearBlocks + raw RPC receipt args, two
  // independent real launchpads, identical shape both times):
  //   {"fee": 10000, "token_a": "<token>", "token_b": "wrap.near", "init_point": 0}
  // init_point: 0 is the real value both launchpads used for their own
  // brand-new token paired against wrap.near -- the DCL "tick" the pool
  // starts at. Not yet dry-run against OUR OWN token/decimals combo, see
  // the STATUS comment at the top of this file.
  const outcome = await admin.signAndSendTransaction({
    receiverId: dclv2ContractId(),
    actions: [
      actionCreators.functionCall(
        "create_pool",
        { fee: DCL_POOL_FEE_TIER, token_a: launch.tokenAccountId, token_b: wrapNearContractId(), init_point: 0 },
        50_000_000_000_000n, // 50 Tgas
        nearToYocto(CREATE_POOL_DEPOSIT_NEAR)
      ),
    ],
  });

  // pool_id format confirmed real: "<token_a>|<token_b>|<fee>".
  const poolId = `${launch.tokenAccountId}|${wrapNearContractId()}|${DCL_POOL_FEE_TIER}`;
  await store.advanceNearLaunchStep(launch.id, "POOL_CREATED", { poolId, poolCreateTxHash: outcomeTxHash(outcome) });
}

// ---------- Step 5: POOL_CREATED -> LIQUIDITY_SEEDED ----------
async function stepSeedLiquidity(launch: store.PendingNearLaunchView): Promise<void> {
  if (!launch.tokenAccountId || !launch.poolId) throw new Error("stepSeedLiquidity: missing tokenAccountId/poolId");
  const admin = adminAccount();
  const dclv2 = dclv2ContractId();
  const lockerContractId = requireEnv("NEAR_LOCKER_CONTRACT_ID");

  // Real confirmed sequence, 3 calls:
  //
  // (a) Register dclv2 and the locker as holders of the NEW token, on
  //     the token's OWN contract -- confirmed real shape
  //     (storage_deposit({account_id, registration_only: true}), ~0.00125
  //     NEAR each). Without this, the deposit/lock calls below would
  //     fail with "account not registered".
  for (const accountId of [dclv2, lockerContractId]) {
    await admin.signAndSendTransaction({
      receiverId: launch.tokenAccountId,
      actions: [
        actionCreators.functionCall(
          "storage_deposit",
          { account_id: accountId, registration_only: true },
          30_000_000_000_000n,
          nearToYocto(0.00125)
        ),
      ],
    });
  }

  // (b) Deposit the ENTIRE minted supply into dclv2's internal ledger --
  // confirmed real shape: ft_transfer_call on the token contract,
  // receiver dclv2, msg the literal JSON string "Deposit". The whole
  // supply, not a partial amount: matches this project's original spec
  // ("mint full NEP-141 supply, seed a Ref/Rhea DCL pool") -- unlike the
  // two real launchpads studied for this shape, ZODD doesn't carve out a
  // separate creator/platform token reserve (Brai's monetization here is
  // the flat $3 fee + the 2% swap fee, not a token-supply skim), and
  // owner_id's ft_transfer_call is fee-exempt for exactly this reason --
  // see the Rust token contract's owner_id field doc comment.
  await admin.signAndSendTransaction({
    receiverId: launch.tokenAccountId,
    actions: [
      actionCreators.functionCall(
        "ft_transfer_call",
        { receiver_id: dclv2, amount: launch.totalSupply, msg: JSON.stringify("Deposit") },
        50_000_000_000_000n,
        1n // NEP-141 requires exactly 1 yoctoNEAR attached
      ),
    ],
  });

  // (c) add_liquidity -- confirmed real args shape AND confirmed real
  // return value (base64-decodes directly to the lpt_id string, verified
  // against a real transaction's raw RPC receipt this session, not
  // assumed). amount_y: "0" + this exact point range is the real,
  // currently-working "one-sided" pattern both studied launchpads use:
  // no wrap.near is deposited at launch, the NEAR side of the pool fills
  // in naturally as the first buyers swap in -- see the module header.
  const outcome = await admin.signAndSendTransaction({
    receiverId: dclv2,
    actions: [
      actionCreators.functionCall(
        "add_liquidity",
        {
          pool_id: launch.poolId,
          amount_x: launch.totalSupply,
          amount_y: "0",
          left_point: DCL_LEFT_POINT,
          right_point: DCL_RIGHT_POINT,
          min_amount_x: "0",
          min_amount_y: "0",
        },
        80_000_000_000_000n, // 80 Tgas -- add_liquidity burned ~9.6 Tgas in the real tx this was confirmed against; generous margin
        0n
      ),
    ],
  });

  const positionId = decodeSuccessValue<string>(outcome);
  await store.advanceNearLaunchStep(launch.id, "LIQUIDITY_SEEDED", { positionId });
}

// ---------- Step 6: LIQUIDITY_SEEDED -> POSITION_LOCKED ----------
async function stepLockPosition(launch: store.PendingNearLaunchView): Promise<void> {
  if (!launch.tokenAccountId || !launch.positionId) throw new Error("stepLockPosition: missing tokenAccountId/positionId");
  if (!launch.creatorNearAccountId) {
    // See PendingNearLaunchView.creatorNearAccountId's doc comment in
    // store.ts: this is null when the creator never connected a native
    // NEAR wallet, which this step has no way to work around on its own
    // -- a real product gap (same one nearFees.ts's payment-collection
    // TODO already flags), not a transient failure. Still goes through
    // advanceOneLaunch's normal retry/FAILED path below (retrying it
    // won't help, but nothing here is unsafe to retry either) -- a
    // sharper "don't bother retrying this kind of error" distinction is
    // a reasonable later improvement, not done yet.
    throw new Error(
      `stepLockPosition: launch ${launch.id}'s creator wallet (${launch.creatorWalletId}) has no linked NEAR account -- ` +
        `lock_position needs a real token_creator_id to eventually pay fees to. Needs a product decision, not a retry.`
    );
  }
  const admin = adminAccount();
  const lockerContractId = requireEnv("NEAR_LOCKER_CONTRACT_ID");

  // (a) The position add_liquidity minted is an NFT on dclv2 itself
  // (confirmed real: a real launchpad's own lock step is a plain
  // NEP-171 nft_transfer called ON dclv2.ref-labs.near, memo "lock").
  // Standard NEP-171 1-yoctoNEAR requirement applies.
  await admin.signAndSendTransaction({
    receiverId: dclv2ContractId(),
    actions: [
      actionCreators.functionCall(
        "nft_transfer",
        { receiver_id: lockerContractId, token_id: launch.positionId, memo: "lock" },
        30_000_000_000_000n,
        1n
      ),
    ],
  });

  // (b) Record the lock in the shared locker contract -- see
  // ../../../near-zodd-launch-rust/locker's lock_position. Not yet
  // confirmed against a real dry run (the locker itself isn't deployed
  // yet), unlike (a) above. platform_fee_bps/platform_fee_recipient here
  // are the locker's OWN concept (splitting the DCL pool's harvested
  // trading fees between creator and platform) -- separate from, and in
  // addition to, the token contract's 2% swap fee; see that contract's
  // PLATFORM_SWAP_FEE_BPS doc comment for why these are two different
  // fees. token_creator_id is the launch's own creator wallet -- NOT
  // adminAccountId() -- since the locker's payout split (once
  // on_fees_collected is wired, see that contract's own TODO) pays the
  // creator directly.
  const outcome = await admin.signAndSendTransaction({
    receiverId: lockerContractId,
    actions: [
      actionCreators.functionCall(
        "lock_position",
        {
          launch_id: launch.tokenAccountId,
          pool_contract_id: dclv2ContractId(),
          position_id: launch.positionId,
          token_creator_id: launch.creatorNearAccountId,
          platform_fee_bps: Number(process.env.NEAR_LOCKER_PLATFORM_FEE_BPS ?? 5000), // TODO: confirm the real creator/platform trading-fee split Brai wants here, separate from the already-confirmed 1%/1% swap fee
          platform_fee_recipient: requireEnv("NEAR_PLATFORM_FEE_ACCOUNT_ID"),
        },
        30_000_000_000_000n,
        0n
      ),
    ],
  });

  await store.advanceNearLaunchStep(launch.id, "POSITION_LOCKED", { lockTxHash: outcomeTxHash(outcome) });
}

/** Advances exactly one launch by exactly one step. Never throws --
 * failures are recorded on the row (retried next tick below
 * MAX_STEP_ATTEMPTS, or marked FAILED at it) so one bad launch can never
 * take the poll loop down, same reasoning as pollOnce's try/catch in
 * zcashReal.ts. */
export async function advanceOneLaunch(launch: store.PendingNearLaunchView): Promise<void> {
  try {
    switch (launch.currentStep) {
      case "NOT_STARTED":
        return await stepCreateTokenAccount(launch);
      case "TOKEN_ACCOUNT_CREATED":
        return await stepDeployAndInitToken(launch);
      case "TOKEN_CONTRACT_DEPLOYED":
        return await stepRevokeDeployKey(launch);
      case "TOKEN_DEPLOY_KEY_REVOKED":
        return await stepCreatePool(launch);
      case "POOL_CREATED":
        return await stepSeedLiquidity(launch);
      case "LIQUIDITY_SEEDED":
        return await stepLockPosition(launch);
      case "POSITION_LOCKED":
        return; // already done -- getNearLaunchesToAdvance shouldn't even return this, nothing to do
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[nearLaunch] launch ${launch.id} failed at step ${launch.currentStep} (attempt ${launch.stepAttempts + 1}):`, err);
    const updated = await store.recordNearLaunchStepFailure(launch.id, message);
    if (updated.stepAttempts >= MAX_STEP_ATTEMPTS) {
      await store.failNearLaunch(launch.id, `giving up after ${MAX_STEP_ATTEMPTS} attempts at step ${launch.currentStep}: ${message}`);
    }
  }
}

let pollingStarted = false;
let pollInFlight = false;

async function pollOnce(): Promise<void> {
  const launches = await store.getNearLaunchesToAdvance();
  // Sequential, not Promise.all: every step shares the admin account's
  // access key nonce, so two launches advancing concurrently would race
  // each other's nonce and fail both. Launches are independent otherwise
  // (see the locker's multiple_launches_are_independent test), just not
  // safe to parallelize through one signer.
  for (const launch of launches) {
    await advanceOneLaunch(launch);
  }
}

export function startNearLaunchPolling(): void {
  if (pollingStarted) return;
  pollingStarted = true;
  setInterval(async () => {
    if (pollInFlight) return;
    pollInFlight = true;
    try {
      await pollOnce();
    } catch (err) {
      // Same reasoning as zcashReal.ts's startPolling: an uncaught throw
      // inside an async setInterval callback crashes the whole backend
      // process (unhandled rejection) since Node 15 -- this is the
      // backstop in case something above advanceOneLaunch's own try/catch
      // (e.g. the store.getNearLaunchesToAdvance query itself) throws.
      console.error("[nearLaunch] a poll tick threw -- caught here so it can't crash the whole backend:", err);
    } finally {
      pollInFlight = false;
    }
  }, POLL_INTERVAL_MS);
}
