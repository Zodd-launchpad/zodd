# Real-money mode (mainnet) — setup notes

This is internal reference for wiring up the "real" ZODD environment (real
ZEC, real trades) as a deployment separate from the zodd.fun demo. The demo
stays on `ZCASH_MODE=mock` (or unset) forever — nothing here changes it.

## New service: zcash-wallet-service

Lives in `/zcash-wallet-service`. Deployed as its own Railway service, built
from its `Dockerfile` (NOT the Node/npm auto-build the other services use —
this one needs Rust to compile `zingo-cli` from source). It should get **no
public domain** — only reachable from the backend over Railway's private
network.

Needs a persistent volume mounted at `/data` (same idea as the Postgres
volume) so the wallet's synced chain state survives redeploys instead of
re-syncing from zero every time.

Environment variables on **this service only**:

| Var | Required | Notes |
|---|---|---|
| `ZCASH_WALLET_SEED` | Only on first boot | The 24-word seed from the Zingo! wallet made for the platform. Set it directly in Railway's dashboard — never in chat, never in a file that gets committed. Once the wallet file exists in the volume, this can be removed; it's only read when `/data/zingo-wallet.dat` doesn't exist yet. |
| `ZCASH_WALLET_BIRTHDAY` | Optional | Block height when the wallet was created. Speeds up the first sync a lot. Zingo! shows this when you create the wallet. |
| `INTERNAL_SERVICE_TOKEN` | Yes | A random shared secret (e.g. `openssl rand -hex 32`). The backend must send the same value in every request. This is the only thing standing between "internal service" and "anyone who finds the URL" if the private network boundary is ever misconfigured — don't skip it. |
| `ZCASH_LIGHTWALLETD_SERVER` | Optional | Defaults to `https://zec.rocks:443` (public mainnet server). |
| `ZCASH_MAX_ZATOSHIS_PER_SEND` | Recommended | Hard cap in zatoshis (1 ZEC = 100,000,000 zatoshis) enforced inside the wallet service itself, on top of the backend's own cap. Belt and suspenders. |

## backend service (the "real" environment's copy of it)

Same code as the demo backend, different env vars:

| Var | Value |
|---|---|
| `ZCASH_MODE` | `real` |
| `ZCASH_WALLET_SERVICE_URL` | `http://<zcash-wallet-service-name>.railway.internal:8080` (Railway private DNS) |
| `ZCASH_WALLET_SERVICE_TOKEN` | Same value as `INTERNAL_SERVICE_TOKEN` above |
| `ZCASH_MAX_ZEC_PER_ORDER` | Start small, e.g. `0.05`. Raise deliberately once the real flow has been proven with tiny amounts. |

## Rollout order (don't skip steps)

1. Deploy zcash-wallet-service with a fresh wallet (no seed yet) pointed at
   testnet-equivalent config off, just to confirm the Docker build compiles
   and the container boots — check `/health`.
2. Brai creates the dedicated Zingo! wallet, funds it with a *small* amount
   first (not the full working capital).
3. Set `ZCASH_WALLET_SEED` + `ZCASH_WALLET_BIRTHDAY`, redeploy, confirm
   `/health` shows `walletReady: true` and `/wallet/balance` matches what
   Zingo! shows.
4. Point the real backend at it with a low `ZCASH_MAX_ZEC_PER_ORDER`, create
   one test token, do one tiny real buy and one tiny real sell, verify the
   money actually moves and the UI reflects it correctly.
5. Only after that: raise the cap, add more working capital.

## Known gap

`zcash-wallet-service/src/cli.js` parses zingo-cli's command output
defensively (tries JSON, falls back to raw text) because the exact output
shape for `new_address` and `quicksend` still hasn't been verified against
a live instance producing a real, spendable transaction — this sandbox
can't compile Rust or reach a lightwalletd server, so this is confirmed
only up to what `/api/admin/zcash-status` and `messages`/`height` have
shown against the real funded wallet so far.

**Found and fixed already:** zingo-cli does NOT sync before running a
one-shot command by default — you must pass `--waitsync`, or `balance`/
`height`/`messages` return stale data instead of the wallet's real
current state. This is why a confirmed 0.01 ZEC deposit first showed up
as a 0 balance. Every CLI call that needs current chain state now passes
`waitsync: true` (see `runCli`'s `waitsync` option) — `spendable_balance`,
`height`, `messages`, `quicksend`, and the initial restore/load in
`ensureWalletReady()`. `new_address` doesn't need it (it's not
sync-dependent).

**Known remaining risk:** each API call spawns its own short-lived
`zingo-cli` process against the same wallet file. Two calls landing at
the same moment (e.g. two pending buy orders polled in the same tick)
could both try to touch `/data/zingo-wallet.dat` concurrently — this
hasn't come up yet at this scale, but if a call starts failing with a
lock/IO-looking error, that's the likely cause. Worth queuing CLI calls
through one at a time if real trading volume ever picks up.

**Found and fixed (2026-09-06), bigger than the waitsync bug above:**
even with `--waitsync`, the balance stayed at 0 against a wallet Brai had
personally confirmed (via his own Zingo app) held 0.01 ZEC. The real
cause: `zingolib_v5.0.0` (the tag pinned in this service's Dockerfile,
cut June 10 2026) predates the **NU6.3 "Ironwood" mainnet upgrade**
(activated ~July 28 2026 at block 3,428,143 — ZIP-258), which introduced
new version-6 transactions. Our chain is now well past that height, so
every sync hit a transaction it didn't understand and errored out early
with `Sync error. server error. server returned invalid transaction.
Unknown transaction format` — confirmed directly in this service's own
deploy logs. (There was also an earlier hard fork, NU6.2, on June 3 2026
at block 3,364,600, a security fix for an Orchard proof bug — v5.0.0 does
handle that one, it's specifically the later Ironwood upgrade it misses.)

Fix applied: the Dockerfile now builds `zingo-cli` from zingolib's `dev`
branch instead of the `zingolib_v5.0.0` tag, since zingolib hasn't cut a
new tagged release since v5.0.0 but zingo-mobile (a sibling Zingo project)
already ships Ironwood support, meaning that work exists upstream on
`dev` even though it isn't tagged yet. This is a deliberate, temporary
exception to the "always pin an exact tag" rule elsewhere in this doc —
**once this build succeeds, re-pin `ZINGOLIB_REF` in the Dockerfile to
the specific commit SHA Railway resolved `dev` to** (visible in the build
log), so future rebuilds stay reproducible instead of silently tracking a
moving branch. Re-verify `/api/admin/zcash-status` shows the real balance
and an advancing height after this redeploy before doing any real
buy/sell test.

**Also found (2026-09-06):** this `dev` snapshot makes the Nym mixnet
transport mandatory for any online session by default (ADR 0024/0026) --
without a Nym proxy pair running alongside the lightwalletd server (which
nobody publicly operates for public servers like zec.rocks), zingo-cli
refuses to sync at all: `Mixnet Mode is required for a connected
session`. The Nym integration itself is still early-stage upstream (their
own announcement calls it a "first milestone", and the demo repos are
already marked superseded) -- not something to depend on for production
right now. We don't need what it adds anyway (it only hides which IP
talks to the lightwalletd server; it doesn't affect fund custody, spend
authorization, or payout-address selection, all of which are unrelated
code paths). Fix: build with `--no-default-features --features
clearnet-test-mode` (see the Dockerfile comment) to compile zingo-cli
without the Nym requirement, restoring the same direct connectivity this
service always had before Nym existed. Note zingolib's own code comments
call this feature flag "quarantined... for testing and never for use" --
that's them not vouching for it as *their* supported path, not a fund-
safety warning; discussed explicitly with Brai and confirmed this is fine
given what it actually does and doesn't touch.

## Creator trading fee (2%: 1% creator / 1% platform)

Every buy and sell takes a 2% fee (see `backend/src/lib/fees.ts`). 1% of
that accrues per-token (`Token.creatorFeeAccruedZec`) and is paid out
automatically to the creator's `creatorPayoutAddress` every 24h by
`backend/src/lib/feeDistributor.ts` (checks every 15min for tokens due).
The other 1% just stays in the platform wallet — no separate transfer
needed, it's already there.

This uses the same `sendPayout` as sells, so in real mode it needs
`zcash-wallet-service` to be healthy. A payout is capped per-cycle at the
same `ZCASH_MAX_ZEC_PER_ORDER` used for orders; if accrued fees exceed it,
it pays what fits and leaves the rest for the next cycle instead of
failing outright. A token created without a `creatorPayoutAddress` still
accrues creator fees, they just never get claimed.
