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

## Creator trading fee (3%: 1% creator / 2% platform)

Every buy and sell takes a 3% fee (see `backend/src/lib/fees.ts`). 1% of
that accrues per-token (`Token.creatorFeeAccruedZec`) and is paid out
automatically to the creator's `creatorPayoutAddress` every 24h by
`backend/src/lib/feeDistributor.ts` (checks every 15min for tokens due).
The other 2% just stays in the platform wallet — no separate transfer
needed, it's already there.

This uses the same `sendPayout` as sells, so in real mode it needs
`zcash-wallet-service` to be healthy. A payout is capped per-cycle at the
same `ZCASH_MAX_ZEC_PER_ORDER` used for orders; if accrued fees exceed it,
it pays what fits and leaves the rest for the next cycle instead of
failing outright. A token created without a `creatorPayoutAddress` still
accrues creator fees, they just never get claimed.
