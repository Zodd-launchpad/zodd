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

# Pin an exact commit so a rebuild never silently pulls in untested
# upstream changes to the code that moves real money.
#
# HISTORY: zingolib_v5.0.0 (June 10 2026) predates the NU6.3 "Ironwood"
# mainnet upgrade (activated ~July 28 2026, block 3,428,143 -- see
# ZIP-258); zingo-cli built from that tag can't parse the newer version-6
# transactions our real chain now produces. zingolib has not cut a new
# tagged release since v5.0.0 (confirmed by checking
# github.com/zingolabs/zingolib/releases), but Ironwood/NU6.3 support
# exists on the dev branch. This used to float ZINGOLIB_REF=dev directly
# to pick that up -- fully reproducible builds require pinning a specific
# commit instead of a moving branch name, so as of 2026-09-08 this is
# pinned to the exact dev commit the diversifier patch below (see
# zingolib-patches/) was built and tested against. Update deliberately:
# clone at the new commit, `git apply --check` the patch, re-run its
# validation (see zingolib-patches/README.md), THEN move this pin forward.
ARG ZINGOLIB_REF=81dc431c512df5e627ad7a11e3f8398930da2142
# No --depth here (unlike the old floating-branch clone): a shallow clone
# can't check out an arbitrary older commit once the branch tip moves past
# it, and GitHub doesn't reliably allow fetching an arbitrary SHA directly.
RUN git clone https://github.com/zingolabs/zingolib.git . && git checkout ${ZINGOLIB_REF}

# ZODD (2026-09-08): zingo-cli has never exposed which of a wallet's many
# diversified addresses a given incoming note landed on, only account/scope
# -- so real payment matching (backend/src/lib/zcashReal.ts) has had to
# fall back to a decrypted memo / matching by amount instead of the address
# itself, even though the address IS the order. This patch surfaces that
# diversifier (ZIP 32 `d`), which is already present in the note's own
# decrypted plaintext by protocol construction -- no wallet.dat format
# change, no new dependency. Full explanation, validation results, and how
# to move ZINGOLIB_REF forward safely: zingolib-patches/README.md.
COPY zingolib-patches/0001-per-address-payment-diversifier.patch /tmp/
RUN git apply /tmp/0001-per-address-payment-diversifier.patch

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
