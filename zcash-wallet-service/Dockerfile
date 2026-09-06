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
ARG ZINGOLIB_REF=zingolib_v5.0.0
RUN git clone --depth 1 --branch ${ZINGOLIB_REF} https://github.com/zingolabs/zingolib.git .

RUN cargo build --release --package zingo-cli

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
