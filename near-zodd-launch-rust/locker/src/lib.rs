//! ZODD NEAR launchpad — fee-only liquidity locker, SHARED across every
//! launch (2026-09-30: Brai rejected a ~$500 one-time cost to make
//! per-launch contracts free via Global Contracts, and rejected a >$10
//! total platform-deploy cost too -- this is the fix for the locker half
//! of that: one locker contract, deployed once, instead of a fresh locker
//! account per launch. See lib.rs in ../token for the token half, which
//! still gets its own account per launch because Ref/Rhea requires that,
//! but is written in Rust instead of near-sdk-js specifically to make that
//! per-launch cost small).
//!
//! This is a straight port of the original per-launch locker.ts, made
//! multi-tenant: every launch gets an entry in one `LookupMap` instead of
//! its own contract account. The one safety property everything else here
//! exists to protect is unchanged and unweakened by that: once a position
//! is locked, `collect_fees` is the ONLY call this contract ever makes
//! against the pool, `amount` in that call is hard-coded to `"0"`, and
//! there is no other method anywhere that accepts a caller-supplied
//! amount. That is what makes "fee-only, forever" an enforced property of
//! the code rather than a promise -- ported verbatim from locker.ts's own
//! reasoning, which is worth keeping in full:
//!
//! Why this needs a *concentrated-liquidity* position (Ref/Rhea's DCL
//! pools, `dclv2.ref-labs.near` on mainnet) and not a classic
//! constant-product pool: in a classic XYK pool, LP shares and trading
//! fees are the SAME number -- fees compound into the shares' redemption
//! value, so "withdraw only the fees" isn't an operation that exists; you'd
//! have to redeem part of the LP shares themselves, which touches
//! principal. DCL pools track accrued fees separately from position
//! liquidity, which is what makes a fee-only lock actually enforceable in
//! code. `remove_liquidity` with `amount: "0"` pulls only the accrued fees
//! without touching principal -- verified against the real deployed
//! dclv2.ref-dev.testnet contract this session.
//!
//! `admin_id` replaces locker.ts's `launcherId`: there is no on-chain
//! launcher contract in this architecture (the backend orchestrates
//! launches directly with signed transactions, same pattern the Zcash side
//! already uses for order fulfillment -- see the session notes on why
//! Global Contracts didn't make sense here and this was simpler instead).
//! `admin_id` is whichever account the backend signs launch transactions
//! with, and is the only account allowed to call `lock_position` for a
//! given `launch_id`.
//!
//! NOTE: same as the token contract, this could not be compiled to wasm32
//! in this sandbox (network policy blocks the rustup download for that
//! target) -- verified with native `cargo test` instead; see the token
//! contract's lib.rs header for the full explanation.

use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise};

const GAS_FOR_POOL_CALL: Gas = Gas::from_tgas(40);
const GAS_FOR_CALLBACK: Gas = Gas::from_tgas(20);

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Locks,
}

/// One of these exists per launch, forever, once `lock_position` is
/// called for it -- there's no removal method, same as the original
/// per-launch contract had no unlock path.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct LockRecord {
    pub pool_contract_id: AccountId,
    pub position_id: String,
    pub token_creator_id: AccountId,
    pub platform_fee_bps: u32,
    pub platform_fee_recipient: AccountId,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    admin_id: AccountId,
    locks: LookupMap<AccountId, LockRecord>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(admin_id: AccountId) -> Self {
        Self { admin_id, locks: LookupMap::new(StorageKey::Locks) }
    }

    /// Called once per launch, right after the backend seeds that
    /// launch's pool and the DCL position ends up owned by this locker
    /// contract. After this call succeeds for a given `launch_id`, the
    /// position is locked forever -- there is no method anywhere in this
    /// contract, for any `launch_id`, that lets its principal move again.
    #[payable]
    pub fn lock_position(
        &mut self,
        launch_id: AccountId,
        pool_contract_id: AccountId,
        position_id: String,
        token_creator_id: AccountId,
        platform_fee_bps: u32,
        platform_fee_recipient: AccountId,
    ) {
        require!(env::predecessor_account_id() == self.admin_id, "only the admin account can lock a position");
        require!(self.locks.get(&launch_id).is_none(), "this launch already has a locked position -- one position per launch, forever");
        require!(platform_fee_bps <= 10_000, "platform_fee_bps can't exceed 100%");

        self.locks.insert(
            launch_id.clone(),
            LockRecord { pool_contract_id, position_id, token_creator_id, platform_fee_bps, platform_fee_recipient },
        );
        env::log_str(&format!("locker: {launch_id} now permanently locked"));
    }

    /// The ONLY outbound call this contract ever makes against a pool, for
    /// any launch. `amount` is hard-coded to "0" -- see the module-level
    /// doc comment for why that single hard-coded value is the actual
    /// safety property this whole contract exists to provide. Callable by
    /// anyone (the creator, the platform, or a keeper script) -- there's
    /// nothing sensitive about triggering a fee harvest, only about who
    /// could move principal, which nothing here allows regardless of caller.
    pub fn collect_fees(&mut self, launch_id: AccountId) -> Promise {
        let record = self.locks.get(&launch_id).expect("no position locked for this launch_id").clone();

        Promise::new(record.pool_contract_id.clone())
            .function_call(
                "remove_liquidity".to_string(),
                near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({
                    "lpt_id": record.position_id,
                    "amount": "0",
                    "min_amount_x": "0",
                    "min_amount_y": "0",
                }))
                .unwrap(),
                NearToken::from_yoctonear(0),
                GAS_FOR_POOL_CALL,
            )
            .then(
                Promise::new(env::current_account_id()).function_call(
                    "on_fees_collected".to_string(),
                    near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({ "launch_id": launch_id })).unwrap(),
                    NearToken::from_yoctonear(0),
                    GAS_FOR_CALLBACK,
                ),
            )
    }

    #[private]
    pub fn on_fees_collected(&mut self, launch_id: AccountId) {
        // Same stub as the original locker.ts: the actual creator/platform
        // payout split (per platform_fee_bps) depends on the exact shape
        // remove_liquidity's promise result returns, which locker.ts
        // flagged as still unconfirmed against a real funded call. Fees
        // land in this locker's own registered balance on the pool's
        // quote token in the meantime -- nothing is lost, only the
        // split/forward step isn't wired yet.
        env::log_str(&format!(
            "locker: fees collected for {launch_id}; payout split not yet wired — see on_fees_collected TODO"
        ));
    }

    pub fn get_status(&self, launch_id: AccountId) -> Option<LockRecord> {
        self.locks.get(&launch_id).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn ctx(predecessor: AccountId) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(predecessor);
        b
    }

    fn new_contract() -> Contract {
        testing_env!(ctx(accounts(0)).build());
        Contract::new(accounts(0)) // accounts(0) is the admin (the backend's account)
    }

    #[test]
    fn only_admin_can_lock_a_position() {
        let mut contract = new_contract();
        testing_env!(ctx(accounts(1)).build()); // NOT the admin
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.lock_position(accounts(2), accounts(3), "lpt-1".to_string(), accounts(4), 100, accounts(5));
        }));
        assert!(result.is_err(), "a non-admin account must not be able to lock a position");
    }

    #[test]
    fn cannot_lock_the_same_launch_twice() {
        let mut contract = new_contract();
        testing_env!(ctx(accounts(0)).build());
        contract.lock_position(accounts(2), accounts(3), "lpt-1".to_string(), accounts(4), 100, accounts(5));

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.lock_position(accounts(2), accounts(3), "lpt-2".to_string(), accounts(4), 100, accounts(5));
        }));
        assert!(result.is_err(), "a launch_id that's already locked must not be lockable again -- that's the whole point");
    }

    #[test]
    fn multiple_launches_are_independent() {
        // near_sdk's `accounts()` test helper only has 6 predefined accounts
        // (indices 0-5), so a third distinct "launch_id" here is a literal
        // parsed AccountId rather than accounts(6)/accounts(7).
        let launch_b: AccountId = "launch-b.near".parse().unwrap();
        let launch_c: AccountId = "launch-c.near".parse().unwrap();

        let mut contract = new_contract();
        testing_env!(ctx(accounts(0)).build());
        contract.lock_position(accounts(2), accounts(3), "lpt-token-a".to_string(), accounts(4), 100, accounts(5));
        contract.lock_position(launch_b.clone(), accounts(3), "lpt-token-b".to_string(), accounts(4), 250, accounts(5));

        let a = contract.get_status(accounts(2)).unwrap();
        let b = contract.get_status(launch_b).unwrap();
        assert_eq!(a.position_id, "lpt-token-a");
        assert_eq!(b.position_id, "lpt-token-b");
        assert_eq!(b.platform_fee_bps, 250);
        assert!(contract.get_status(launch_c).is_none());
    }

    #[test]
    fn rejects_platform_fee_over_100_percent() {
        let mut contract = new_contract();
        testing_env!(ctx(accounts(0)).build());
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.lock_position(accounts(2), accounts(3), "lpt-1".to_string(), accounts(4), 10_001, accounts(5));
        }));
        assert!(result.is_err());
    }
}
