# zcash-wallet-service
#
# Compiles the real Zcash light-wallet client (zingo-cli, from the official
# zingolib project: https://github.com/zingolabs/zingolib) and wraps it with
# a tiny internal HTTP API that ONLY the backend service can reach over
# Railway's private network (this service gets no public domain).
#
# This is the ONLY place in the whole project that touches real ZEC. The
# wallet's 24-word seed lives exclusively in this service's environment
# variables (ZCASH_WALLET_SEED) -- it is never in source control, never in
# the other services, never in chat.

# ---------- Stage 1: compile zingo-cli from source ----------
FROM rust:1.90-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libsqlite3-dev \
    protobuf-compiler \
    pkg-config \
    libssl-dev \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Pin an exact tagged release so a rebuild never silently pulls in
# untested upstream changes to the code that moves real money.
#
# TEMPORARY DEVIATION (2026-09-06): zingolib_v5.0.0 (June 10 2026) predates
# the NU6.3 "Ironwood" mainnet upgrade (activated ~July 28 2026, block
# 3,428,143 -- see ZIP-258). Our real chain is now past that height, so
# zingo-cli built from v5.0.0 cannot parse the newer version-6 transactions
# it encounters while syncing and errors out with "server returned invalid
# transaction. Unknown transaction format" -- this is why the wallet's
# balance/height never reflected the real funded state even after the
# --waitsync fix. zingolib has not cut a new tagged release since v5.0.0
# (confirmed by checking github.com/zingolabs/zingolib/releases), but the
# zingo-mobile app *does* ship Ironwood/NU6.3 support, so that work exists
# upstream on the dev branch even though it hasn't been tagged yet.
# Building from `dev` is a deliberate, temporary exception to the
# pin-an-exact-tag rule above -- swap this back to a specific commit SHA
# (read it from the Railway build log once this succeeds) as soon as
# zingolib cuts a real tagged release with Ironwood support, so future
# rebuilds go back to being fully reproducible.
ARG ZINGOLIB_REF=dev
RUN git clone --depth 1 --branch ${ZINGOLIB_REF} https://github.com/zingolabs/zingolib.git .

# As of this dev snapshot, zingo-cli's default build makes the Nym mixnet
# transport mandatory for any online session (ADR 0024/0026) -- without a
# running Nym proxy pair (which nobody publicly operates alongside the
# public lightwalletd servers we use, like zec.rocks), it refuses to sync
# at all ("Mixnet Mode is required for a connected session"). We don't need
# the network-privacy properties Nym adds (hiding which IP talks to the
# lightwalletd server) -- we only need working, correct, direct connectivity,
# which is exactly what this service already had before this feature existed.
# `clearnet-test-mode` is the escape hatch zingolib's own code comments call
# "quarantined... for testing and never for use... never a default" -- that
# warning is about *them* not vouching for it as their supported path, not
# about fund safety: it only changes which network transport zingo-cli uses
# to talk to the public lightwalletd server. It does not touch key custody
# (the seed is signed locally and never leaves this service either way) or
# payout-address selection (decided entirely by our own backend code in
# zcashReal.ts / server.ts, unrelated to this transport choice). Discussed
# explicitly with Brai (2026-09-06): the actual things he was worried about
# -- theft of funds, or sending to the wrong address -- are unaffected by
# this flag, so proceeding without Nym is fine; we just don't get the extra
# IP-privacy layer, which nobody asked for.
RUN cargo build --release --package zingo-cli --no-default-features --features clearnet-test-mode

# ---------- Stage 2: slim runtime with Node (for the wrapper API) ----------
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libsqlite3-0 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/target/release/zingo-cli /usr/local/bin/zingo-cli
RUN chmod +x /usr/local/bin/zingo-cli

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src

# Wallet data (synced chain state + the encrypted-at-rest wallet file) lives
# on a Railway Volume mounted at /data (attached via the Railway dashboard/API,
# not a Dockerfile VOLUME directive -- Railway's build rejects those) so it
# survives redeploys instead of resyncing from scratch every time.
ENV WALLET_DATA_DIR=/data

EXPOSE 8080
CMD ["node", "src/server.js"]
