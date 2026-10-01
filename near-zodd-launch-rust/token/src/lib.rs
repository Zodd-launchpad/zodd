//! ZODD NEAR launch token — NEP-141 fungible token, written in Rust instead of
//! near-sdk-js specifically to keep the compiled wasm small enough to deploy
//! fresh (not as a Global Contract) for every single launch within Brai's
//! $8-per-launch budget (2026-09-30: "quiero que total no supere los 8
//! dolares para deployar un token").
//!
//! The core NEP-141 logic (ft_transfer / ft_transfer_call / ft_resolve_transfer
//! / storage management) is NOT hand-rolled here -- it delegates to
//! `near_contract_standards::fungible_token::FungibleToken`, the official
//! reference implementation. That choice is deliberate: the near-sdk-js
//! version of this contract (token.ts) had a real, live bug this session
//! where a failed ft_transfer_call silently lost the sender's funds with no
//! refund (fixed by hand, twice, after reproducing it with real balance
//! checks -- see the session notes). Re-implementing that logic by hand a
//! second time, in a second language, under time pressure, is exactly how
//! that class of bug comes back. The reference implementation is the
//! audited, ecosystem-standard one (used by wrap.near and effectively every
//! other NEP-141 on NEAR) and already gets the refund-on-failure path right.
//!
//! Full supply is minted once, at `new()`, to the creator. There is no mint
//! method afterward -- matches the original requirement ("mint full NEP-141
//! supply, seed a Ref/Rhea DCL pool, lock LP in a fee-only locker").
//!
//! 2026-09-30 addition: a 2% swap fee (1% platform, 1% founder), charged
//! only on ft_transfer_call (buy/sell) and never on plain ft_transfer --
//! see the PLATFORM_SWAP_FEE_BPS doc comment below for the exact wording
//! this was built from.
//!
//! NOTE: this sandbox cannot compile to wasm32-unknown-unknown -- the
//! network egress policy here blocks static.rust-lang.org, which is where
//! `rustup target add wasm32-unknown-unknown` downloads the std component
//! from (confirmed: 403 from the proxy, not a transient failure -- see
//! /root/.ccr/README.md, "do not retry or route around it"). The real build
//! + exact wasm byte size need to happen in an environment with normal
//! network access (e.g. the actual deploy pipeline), same situation this
//! project already had with `prisma generate` needing Railway's unrestricted
//! network instead of this sandbox's. Everything here is written to compile
//! cleanly against near-sdk 5.x / near-contract-standards 5.x; it has NOT
//! been verified with `cargo near build` in this session.

use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::resolver::FungibleTokenResolver;
use near_contract_standards::fungible_token::{FungibleToken, FungibleTokenCore};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::store::LazyOption;
use near_sdk::{near, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue};

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    FungibleToken,
    Metadata,
}

/// Swap-fee split, per Brai's explicit requirement (2026-09-30): a plain
/// wallet-to-wallet transfer (`ft_transfer`) stays fee-free, but a
/// buy/sell -- which on NEAR always goes through `ft_transfer_call`,
/// since that's the one NEP-141 method that also tells the receiving
/// contract (the DCL pool) what to do with the tokens via `msg` -- pays a
/// 2% fee, split 1% to the platform treasury and 1% to Brai's own
/// account. ("que cobre el fee cuando transfiere no, pero cuando compra y
/// vende si 2% y los fee como en zodd, 1% para la plataforma 1% para
/// mi.") This is separate from, and in addition to, whatever fee the
/// Ref/Rhea DCL pool itself charges on the swap -- that one is the
/// locker's concern (see ../locker), this one is the token's.
const PLATFORM_SWAP_FEE_BPS: u128 = 100; // 1% of the swapped amount
const FOUNDER_SWAP_FEE_BPS: u128 = 100; // 1% of the swapped amount
const BPS_DENOMINATOR: u128 = 10_000;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    token: FungibleToken,
    metadata: LazyOption<FungibleTokenMetadata>,
    platform_fee_account_id: AccountId,
    founder_fee_account_id: AccountId,
    /// 2026-09-30 addition, found while wiring the backend orchestration
    /// (nearLaunch.ts): owner_id doesn't just hold the initial supply, it's
    /// also the account that SEEDS the DCL pool's liquidity right after
    /// deploy -- and that seeding deposit is itself an ft_transfer_call
    /// (confirmed against a real, currently-live launchpad's actual
    /// transactions on dclv2.ref-labs.near: `ft_transfer_call(receiver_id:
    /// "dclv2.ref-labs.near", msg: "Deposit")`, immediately followed by
    /// `add_liquidity`). Without this exemption, the swap fee would also
    /// skim 2% off the platform's OWN liquidity-seeding transfer, meaning
    /// less of the intended liquidity budget actually reaches the pool --
    /// directly undermining "el resto se puede gastar en la liquidez".
    /// owner_id is stored so ft_transfer_call can tell "the platform
    /// setting up the pool" apart from "a trader buying/selling" and only
    /// charge the fee for the latter.
    owner_id: AccountId,
}

#[near]
impl Contract {
    /// Mints the entire `total_supply` to `owner_id` in one shot, at
    /// deploy time, and never again -- there is no other mint entrypoint.
    /// `owner_id` is the ZODD launch flow's own account (the backend, or
    /// whichever account is driving this specific launch -- see the
    /// resumable-flow notes), which is what then does the DCL deposit /
    /// create_pool / lock-in-the-locker sequence with this balance.
    ///
    /// `platform_fee_account_id` and `founder_fee_account_id` are the two
    /// recipients of the 2% swap fee described above. Both are registered
    /// here, at init, so a fee payout can never fail with "account not
    /// registered" later -- the same way `owner_id` itself is registered
    /// before the initial mint.
    #[init]
    pub fn new(
        owner_id: AccountId,
        total_supply: U128,
        name: String,
        symbol: String,
        icon: Option<String>,
        decimals: u8,
        reference: Option<String>,
        reference_hash: Option<near_sdk::json_types::Base64VecU8>,
        platform_fee_account_id: AccountId,
        founder_fee_account_id: AccountId,
    ) -> Self {
        require_valid_metadata(&name, &symbol, decimals);

        let mut token = FungibleToken::new(StorageKey::FungibleToken);
        token.internal_register_account(&owner_id);
        token.internal_deposit(&owner_id, total_supply.0);

        // Fee recipients can coincide with each other and/or with
        // owner_id (e.g. during testing, or if Brai ever wants the
        // platform and founder cuts landing in the same wallet) --
        // internal_register_account panics on a double-registration, so
        // only register accounts that aren't already registered.
        for account_id in [&platform_fee_account_id, &founder_fee_account_id] {
            if !token.accounts.contains_key(account_id) {
                token.internal_register_account(account_id);
            }
        }

        near_contract_standards::fungible_token::events::FtMint {
            owner_id: owner_id.as_ref(),
            amount: total_supply,
            memo: Some("zodd-launch: full supply minted at deploy"),
        }
        .emit();

        let metadata = FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name,
            symbol,
            icon,
            reference,
            reference_hash,
            decimals,
        };
        metadata.assert_valid();

        Self {
            token,
            metadata: LazyOption::new(StorageKey::Metadata, Some(metadata)),
            platform_fee_account_id,
            founder_fee_account_id,
            owner_id,
        }
    }
}

fn require_valid_metadata(name: &str, symbol: &str, decimals: u8) {
    require!(!name.trim().is_empty(), "name cannot be empty");
    require!(!symbol.trim().is_empty(), "symbol cannot be empty");
    require!(decimals <= 24, "decimals unreasonably high");
}

use near_sdk::require;

// ---------- NEP-141 core: delegates entirely to the audited reference
// implementation. This is the manual expansion of what
// `near_contract_standards::impl_fungible_token_core!` used to generate
// (that macro is deprecated in near-contract-standards 5.x in favor of
// implementing the traits directly, which is what this is).
#[near]
impl FungibleTokenCore for Contract {
    /// Plain wallet-to-wallet transfer. Deliberately fee-free -- see the
    /// module-level note on PLATFORM_SWAP_FEE_BPS for why the swap fee
    /// only applies to ft_transfer_call.
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    /// Every DEX swap on NEAR is an ft_transfer_call (the `msg` is how
    /// the pool contract is told what to do), so this is where the 2%
    /// swap fee is skimmed: 1% to the platform account, 1% to the
    /// founder account, both taken as a synchronous internal transfer
    /// from the sender BEFORE the remaining 98% is forwarded on to
    /// receiver_id via the normal ft_transfer_call flow. This keeps the
    /// one safety property that matters -- a failed/partial receiver
    /// call still only ever refunds what was actually forwarded (98%),
    /// via the untouched, audited internal_ft_resolve_transfer path --
    /// the fee itself is never "at risk" because it's already settled
    /// before any cross-contract call happens.
    ///
    /// Exception: owner_id is exempt -- see the doc comment on the
    /// `owner_id` field for why (it's the platform seeding the pool's
    /// OWN liquidity via ft_transfer_call right after deploy, not a
    /// trader buying/selling, and charging it here would just shrink the
    /// liquidity budget Brai already decided goes into the pool in full).
    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let sender_id = near_sdk::env::predecessor_account_id();
        let total: u128 = amount.0;

        if sender_id == self.owner_id {
            return self.token.ft_transfer_call(receiver_id, amount, memo, msg);
        }

        let platform_fee = total * PLATFORM_SWAP_FEE_BPS / BPS_DENOMINATOR;
        let founder_fee = total * FOUNDER_SWAP_FEE_BPS / BPS_DENOMINATOR;
        let net_amount = total - platform_fee - founder_fee;
        require!(net_amount > 0, "amount too small to cover the swap fee");

        if platform_fee > 0 {
            self.token.internal_transfer(
                &sender_id,
                &self.platform_fee_account_id,
                platform_fee,
                Some("zodd-launch: 1% platform swap fee".to_string()),
            );
        }
        if founder_fee > 0 {
            self.token.internal_transfer(
                &sender_id,
                &self.founder_fee_account_id,
                founder_fee,
                Some("zodd-launch: 1% founder swap fee".to_string()),
            );
        }

        self.token.ft_transfer_call(receiver_id, U128(net_amount), memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used_amount, _burned_amount) =
            self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        // No burn-on-failure hook: unlike some templates (justhoot's has a
        // burn/holders/owner split baked into transfers), ZODD's launch
        // token does not burn tokens that fail to be accepted by a
        // receiver -- internal_ft_resolve_transfer already refunds the
        // unused amount back to sender_id, which is exactly the safe
        // behavior the hand-written near-sdk-js version had to be fixed
        // into. Nothing extra needed here.
        used_amount.into()
    }
}

// ---------- Storage management (NEP-145): also delegates entirely.
#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().clone().unwrap()
    }
}

// ---------- Unit tests: run on the NATIVE target (near-sdk's
// "unit-testing" feature / VMContextBuilder mock), not wasm32 -- this is
// the part of the contract this sandbox CAN actually verify without the
// blocked wasm32 target. `cargo test --features near-sdk/unit-testing`
// exercises the real logic (mint-once, transfer, and specifically the
// refund-on-failed-receiver path) without needing to compile to wasm at
// all.
#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn ctx(predecessor: AccountId, deposit: u128) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.current_account_id(accounts(0))
            .signer_account_id(predecessor.clone())
            .predecessor_account_id(predecessor)
            .attached_deposit(near_sdk::NearToken::from_yoctonear(deposit));
        b
    }

    // accounts(1) = owner, accounts(2) = an ordinary transfer receiver
    // (stands in for a pool contract in the swap-fee tests), accounts(3)
    // = platform fee account, accounts(4) = founder (Brai) fee account,
    // accounts(5) = an ordinary trader (NOT owner_id) -- near-sdk's
    // accounts() helper only has 6 (0-5), so every test below stays
    // within that.
    fn new_contract(total_supply: u128) -> Contract {
        testing_env!(ctx(accounts(1), 0).build());
        Contract::new(
            accounts(1),
            U128(total_supply),
            "Test Token".to_string(),
            "TEST".to_string(),
            None,
            18,
            None,
            None,
            accounts(3),
            accounts(4),
        )
    }

    #[test]
    fn full_supply_minted_to_owner_at_init() {
        let contract = new_contract(1_000_000_000_000_000_000_000_000_000);
        assert_eq!(contract.ft_total_supply().0, 1_000_000_000_000_000_000_000_000_000);
        assert_eq!(contract.ft_balance_of(accounts(1)).0, 1_000_000_000_000_000_000_000_000_000);
        // No one else has a balance -- nothing was minted anywhere else.
        assert_eq!(contract.ft_balance_of(accounts(2)).0, 0);
    }

    const STORAGE_DEPOSIT: u128 = 1_250_000_000_000_000_000_000; // 0.00125 NEAR, the standard bound

    #[test]
    fn plain_transfer_moves_balance() {
        let mut contract = new_contract(1_000);
        testing_env!(ctx(accounts(1), STORAGE_DEPOSIT).build());
        contract.storage_deposit(Some(accounts(2)), None);
        testing_env!(ctx(accounts(1), 1).build()); // ft_transfer needs 1 yoctoNEAR attached
        contract.ft_transfer(accounts(2), U128(400), None);
        assert_eq!(contract.ft_balance_of(accounts(1)).0, 600);
        assert_eq!(contract.ft_balance_of(accounts(2)).0, 400);
    }

    // This is the specific bug class that had to be found and fixed twice
    // in the near-sdk-js version this session (see token.ts's history):
    // ft_resolve_transfer's job, when the receiver's ft_on_transfer fails
    // or the whole receiver call fails outright, is to refund whatever
    // wasn't actually used back to the sender -- not silently drop it.
    // We can't drive a full cross-contract failure in a unit test (no
    // receipts here), but we CAN call internal_ft_resolve_transfer
    // directly the way the real callback does, simulating "receiver used
    // none of it" (amount_used = 0, the failure case), and confirm the
    // sender gets the full balance back rather than losing it.
    #[test]
    fn resolve_transfer_refunds_sender_when_receiver_used_nothing() {
        let mut contract = new_contract(1_000);
        // Register the trader and the pool/receiver, then give the
        // trader a balance via a plain (fee-free, owner_id-sourced)
        // transfer -- models "owner already distributed supply, now an
        // ordinary trader buys/sells", which is the case this fee (and
        // this refund-safety property) actually needs to hold for.
        testing_env!(ctx(accounts(1), STORAGE_DEPOSIT).build());
        contract.storage_deposit(Some(accounts(5)), None);
        contract.storage_deposit(Some(accounts(2)), None);
        testing_env!(ctx(accounts(1), 1).build());
        contract.ft_transfer(accounts(5), U128(400), None);

        testing_env!(ctx(accounts(5), 1).build());
        let _ = contract.ft_transfer_call(accounts(2), U128(400), None, "irrelevant".to_string());
        // At this point internal_transfer already moved balance out of
        // accounts(5) synchronously (same real-world pre-condition that
        // caused the JS bug: the debit happens before the receiver's
        // response is known) -- but only 392 of the 400 requested went to
        // accounts(2): the 2% swap fee (4 to the platform, 4 to the
        // founder account) was already settled before the cross-contract
        // call, so it's never part of what's "at risk" in the resolve step.
        assert_eq!(contract.ft_balance_of(accounts(5)).0, 0);
        assert_eq!(contract.ft_balance_of(accounts(2)).0, 392);
        assert_eq!(contract.ft_balance_of(accounts(3)).0, 4, "platform fee account");
        assert_eq!(contract.ft_balance_of(accounts(4)).0, 4, "founder fee account");

        // Simulate the receiver call coming back having accepted none of
        // it (PromiseResult::Failed -- receiver's ft_on_transfer panicked
        // or the receipt itself failed) -- the real callback path
        // near-sdk-rs's FungibleTokenResolver takes, with a genuine
        // promise result in context instead of an empty one. The amount
        // here is 392, not the original 400: that's what the real
        // contract actually forwarded to ft_transfer_call underneath (the
        // 8 in fees never went through this call at all), so that's what
        // production's own resolve callback would be invoked with too.
        testing_env!(
            ctx(accounts(5), 0).build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            std::collections::HashMap::default(),
            vec![near_sdk::PromiseResult::Failed],
        );
        let (used, _burned) =
            contract.token.internal_ft_resolve_transfer(&accounts(5), accounts(2), U128(392));
        assert_eq!(used, 0, "receiver used none of it, so ft_resolve_transfer must report 0 used");
        assert_eq!(
            contract.ft_balance_of(accounts(5)).0,
            392, // 0 (post-debit) + 392 (refund) = 400 - 8 (fees, correctly not refunded)
            "sender must be refunded the full at-risk amount (392) -- this is the bug that shipped once already. \
             The 8 already paid in swap fees is correctly NOT refunded: it was settled before the cross-contract call, same as a completed purchase."
        );
        assert_eq!(contract.ft_balance_of(accounts(2)).0, 0);
    }

    #[test]
    fn plain_transfer_charges_no_swap_fee() {
        let mut contract = new_contract(1_000);
        testing_env!(ctx(accounts(1), STORAGE_DEPOSIT).build());
        contract.storage_deposit(Some(accounts(2)), None);
        testing_env!(ctx(accounts(1), 1).build());
        contract.ft_transfer(accounts(2), U128(400), None);
        assert_eq!(contract.ft_balance_of(accounts(1)).0, 600);
        assert_eq!(contract.ft_balance_of(accounts(2)).0, 400, "plain ft_transfer must not skim anything");
        assert_eq!(contract.ft_balance_of(accounts(3)).0, 0, "platform fee account must stay untouched by a plain transfer");
        assert_eq!(contract.ft_balance_of(accounts(4)).0, 0, "founder fee account must stay untouched by a plain transfer");
    }

    #[test]
    fn ft_transfer_call_charges_2_percent_swap_fee_split_evenly() {
        let mut contract = new_contract(1_000);
        testing_env!(ctx(accounts(1), STORAGE_DEPOSIT).build());
        contract.storage_deposit(Some(accounts(5)), None);
        contract.storage_deposit(Some(accounts(2)), None);
        testing_env!(ctx(accounts(1), 1).build());
        contract.ft_transfer(accounts(5), U128(400), None); // owner distributes to a trader, fee-free

        testing_env!(ctx(accounts(5), 1).build());
        let _ = contract.ft_transfer_call(accounts(2), U128(400), None, "irrelevant".to_string());

        // 400 * 1% = 4 to each of the platform and founder accounts;
        // the receiver only ever sees the remaining 392 (98%).
        assert_eq!(contract.ft_balance_of(accounts(3)).0, 4, "platform gets exactly 1%");
        assert_eq!(contract.ft_balance_of(accounts(4)).0, 4, "founder gets exactly 1%");
        assert_eq!(contract.ft_balance_of(accounts(2)).0, 392, "receiver gets the remaining 98%");
        assert_eq!(contract.ft_balance_of(accounts(5)).0, 0, "trader is debited the full 400 up front");

        // Total supply is conserved -- nothing minted or burned by the fee split.
        assert_eq!(
            contract.ft_balance_of(accounts(1)).0
                + contract.ft_balance_of(accounts(5)).0
                + contract.ft_balance_of(accounts(2)).0
                + contract.ft_balance_of(accounts(3)).0
                + contract.ft_balance_of(accounts(4)).0,
            1_000
        );
    }

    // 2026-09-30: confirmed against a real, currently-live launchpad's
    // actual mainnet transactions on dclv2.ref-labs.near that seeding a
    // freshly created pool's liquidity is itself an
    // ft_transfer_call(receiver_id: <pool>, msg: "Deposit") from the
    // account that holds the freshly minted supply -- i.e. owner_id in
    // this contract. Without this exemption the swap fee would also
    // skim the platform's OWN liquidity-seeding transfer, silently
    // shrinking the liquidity Brai already decided goes into the pool in
    // full ("el resto se puede gastar en la liquidez").
    #[test]
    fn owner_ft_transfer_call_is_fee_exempt() {
        let mut contract = new_contract(1_000);
        testing_env!(ctx(accounts(1), STORAGE_DEPOSIT).build());
        contract.storage_deposit(Some(accounts(2)), None); // accounts(2) stands in for the pool contract
        testing_env!(ctx(accounts(1), 1).build());
        let _ = contract.ft_transfer_call(accounts(2), U128(400), None, "\"Deposit\"".to_string());

        assert_eq!(
            contract.ft_balance_of(accounts(2)).0,
            400,
            "the pool must receive the FULL amount -- no fee on the platform's own liquidity seeding"
        );
        assert_eq!(contract.ft_balance_of(accounts(1)).0, 600);
        assert_eq!(contract.ft_balance_of(accounts(3)).0, 0, "platform fee account untouched");
        assert_eq!(contract.ft_balance_of(accounts(4)).0, 0, "founder fee account untouched");
    }
}
