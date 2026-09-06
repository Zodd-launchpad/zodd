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
shape for `new_address`, `messages`, and `quicksend` wasn't verified against
a live instance while building this — this sandbox can't compile Rust or
reach a lightwalletd server. Expect one debugging pass once step 1 above
runs for real, using whatever `/health` and the service's logs show.
