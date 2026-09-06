import Fastify from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import * as store from "./lib/store.js";
import { generateTwelveWords } from "./lib/wordlist.js";
import { quoteBuy, quoteSell, currentPrice, marketCapZec, isGraduated } from "./lib/bondingCurve.js";
import { generateOrderAddress, onPaymentDetected, sendPayout } from "./lib/zcashMock.js";

const app = Fastify({ logger: true });

app.register(import("@fastify/cors"), { origin: true });

// ---------- Wallets ----------

app.post("/api/wallets", async (_req, reply) => {
  const words = generateTwelveWords();
  const wallet: store.InternalWallet = {
    id: randomUUID(),
    walletTag: store.newWalletTag(),
    words,
    createdAt: new Date().toISOString(),
  };
  store.wallets.set(wallet.id, wallet);
  return reply.send({ walletId: wallet.id, walletTag: wallet.walletTag, words });
});

app.get("/api/wallets/:id/portfolio", async (req, reply) => {
  const { id } = req.params as { id: string };
  const wallet = store.wallets.get(id);
  if (!wallet) return reply.code(404).send({ error: "wallet not found" });

  const holdings = [...store.tokens.values()].map((t) => ({
    symbol: t.symbol,
    name: t.name,
    amount: store.getBalance(id, t.symbol),
    priceZec: currentPrice(t.curve),
  })).filter((h) => h.amount > 0);

  return reply.send({ walletTag: wallet.walletTag, holdings });
});

// ---------- Tokens / market ----------

const createTokenSchema = z.object({
  symbol: z.string().min(1).max(12),
  name: z.string().min(1).max(64),
  totalSupply: z.number().positive().default(1_000_000_000),
  creatorWalletId: z.string(),
});

app.post("/api/tokens", async (req, reply) => {
  const body = createTokenSchema.parse(req.body);
  if (store.tokens.has(body.symbol.toUpperCase())) {
    return reply.code(409).send({ error: "symbol already exists" });
  }
  if (!store.wallets.has(body.creatorWalletId)) {
    return reply.code(400).send({ error: "invalid creatorWalletId" });
  }
  const token: store.Token = {
    id: randomUUID(),
    symbol: body.symbol.toUpperCase(),
    name: body.name,
    totalSupply: body.totalSupply,
    creatorWalletId: body.creatorWalletId,
    curve: store.freshCurveState(),
    createdAt: new Date().toISOString(),
  };
  store.tokens.set(token.symbol, token);
  return reply.send(serializeToken(token));
});

app.get("/api/tokens", async (_req, reply) => {
  return reply.send([...store.tokens.values()].map(serializeToken));
});

app.get("/api/tokens/:symbol", async (req, reply) => {
  const { symbol } = req.params as { symbol: string };
  const token = store.tokens.get(symbol.toUpperCase());
  if (!token) return reply.code(404).send({ error: "token not found" });
  return reply.send(serializeToken(token));
});

function serializeToken(t: store.Token) {
  return {
    symbol: t.symbol,
    name: t.name,
    totalSupply: t.totalSupply,
    priceZec: currentPrice(t.curve),
    marketCapZec: marketCapZec(t.curve, t.totalSupply),
    realZecReserves: t.curve.realZecReserves,
    tokensSold: t.curve.tokensSold,
    graduated: isGraduated(t.curve),
    createdAt: t.createdAt,
  };
}

// ---------- Orders: buy ----------

const buySchema = z.object({
  walletId: z.string(),
  symbol: z.string(),
  zecAmount: z.number().positive(),
});

app.post("/api/orders/buy", async (req, reply) => {
  const body = buySchema.parse(req.body);
  const wallet = store.wallets.get(body.walletId);
  const token = store.tokens.get(body.symbol.toUpperCase());
  if (!wallet) return reply.code(400).send({ error: "invalid wallet" });
  if (!token) return reply.code(404).send({ error: "token not found" });

  const order: store.Order = {
    id: randomUUID(),
    internalWalletId: wallet.id,
    tokenId: token.id,
    side: "BUY",
    status: "PENDING",
    zecAmount: body.zecAmount,
    createdAt: new Date().toISOString(),
  };
  // The address IS the order: any payment that lands there executes at
  // the price of the block it confirms in (see zcashMock.ts).
  order.zecAddress = generateOrderAddress(order.id, body.zecAmount);
  store.orders.set(order.id, order);

  return reply.send({
    orderId: order.id,
    zecAddress: order.zecAddress,
    zecAmount: order.zecAmount,
    status: order.status,
  });
});

app.get("/api/orders/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const order = store.orders.get(id);
  if (!order) return reply.code(404).send({ error: "order not found" });
  return reply.send(order);
});

// When the zcash-service (here, the mock) detects the payment, the order
// executes against the bonding curve at that moment's price.
onPaymentDetected((orderId, confirmedZecAmount, txid) => {
  const order = store.orders.get(orderId);
  if (!order || order.status !== "PENDING") return;
  const token = [...store.tokens.values()].find((t) => t.id === order.tokenId);
  if (!token) return;

  try {
    const { tokensOut, newState } = quoteBuy(token.curve, confirmedZecAmount);
    token.curve = newState;
    store.creditBalance(order.internalWalletId, token.symbol, tokensOut);

    order.status = "FILLED";
    order.tokenAmount = tokensOut;
    order.executionTxid = txid;
    order.filledAt = new Date().toISOString();
    app.log.info(`order ${orderId} filled: ${confirmedZecAmount} ZEC -> ${tokensOut.toFixed(0)} ${token.symbol}`);
  } catch (err) {
    order.status = "FAILED";
    app.log.error(err, `order ${orderId} failed to execute against the curve`);
  }
});

// ---------- Orders: sell ----------

const sellSchema = z.object({
  walletId: z.string(),
  symbol: z.string(),
  tokenAmount: z.number().positive(),
  refundAddress: z.string().min(10),
});

app.post("/api/orders/sell", async (req, reply) => {
  const body = sellSchema.parse(req.body);
  const wallet = store.wallets.get(body.walletId);
  const token = store.tokens.get(body.symbol.toUpperCase());
  if (!wallet) return reply.code(400).send({ error: "invalid wallet" });
  if (!token) return reply.code(404).send({ error: "token not found" });

  const balance = store.getBalance(wallet.id, token.symbol);
  if (balance < body.tokenAmount) {
    return reply.code(400).send({ error: "insufficient balance" });
  }

  const { zecOut, newState } = quoteSell(token.curve, body.tokenAmount);
  token.curve = newState;
  store.debitBalance(wallet.id, token.symbol, body.tokenAmount);
  const { txid } = sendPayout(body.refundAddress, zecOut);

  const order: store.Order = {
    id: randomUUID(),
    internalWalletId: wallet.id,
    tokenId: token.id,
    side: "SELL",
    status: "FILLED",
    refundAddress: body.refundAddress,
    zecAmount: zecOut,
    tokenAmount: body.tokenAmount,
    executionTxid: txid,
    createdAt: new Date().toISOString(),
    filledAt: new Date().toISOString(),
  };
  store.orders.set(order.id, order);

  return reply.send(order);
});

const port = Number(process.env.PORT ?? 8787);
app.listen({ port, host: "0.0.0.0" }).then(() => {
  app.log.info(`zcash-launchpad backend (demo, in-memory) listening on :${port}`);
});
