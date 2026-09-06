import Fastify from "fastify";
import { z } from "zod";
import * as store from "./lib/store.js";
import { generateTwelveWords } from "./lib/wordlist.js";
import { quoteBuy, quoteSell, currentPrice, marketCapZec, isGraduated } from "./lib/bondingCurve.js";
import { generateOrderAddress, onPaymentDetected, sendPayout } from "./lib/zcashMock.js";
import { simulatedInscriptionFor } from "./lib/simulatedChain.js";

const app = Fastify({ logger: true });

app.register(import("@fastify/cors"), { origin: true });

// ---------- Wallets ----------

app.post("/api/wallets", async (_req, reply) => {
  const words = generateTwelveWords();
  const wallet = await store.createWallet(words);
  return reply.send({ walletId: wallet.id, walletTag: wallet.walletTag, words });
});

app.get("/api/wallets/:id/portfolio", async (req, reply) => {
  const { id } = req.params as { id: string };
  const wallet = await store.getWallet(id);
  if (!wallet) return reply.code(404).send({ error: "wallet not found" });

  const holdings = await store.getPortfolio(id);
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
  const symbol = body.symbol.toUpperCase();

  if (await store.getToken(symbol)) {
    return reply.code(409).send({ error: "symbol already exists" });
  }
  if (!(await store.getWallet(body.creatorWalletId))) {
    return reply.code(400).send({ error: "invalid creatorWalletId" });
  }

  const token = await store.createToken({
    symbol,
    name: body.name,
    totalSupply: body.totalSupply,
    creatorWalletId: body.creatorWalletId,
  });
  return reply.send(serializeToken(token));
});

app.get("/api/tokens", async (_req, reply) => {
  const tokens = await store.listTokens();
  return reply.send(tokens.map(serializeToken));
});

app.get("/api/tokens/:symbol", async (req, reply) => {
  const { symbol } = req.params as { symbol: string };
  const token = await store.getToken(symbol.toUpperCase());
  if (!token) return reply.code(404).send({ error: "token not found" });
  return reply.send(serializeToken(token));
});

app.get("/api/tokens/:symbol/history", async (req, reply) => {
  const { symbol } = req.params as { symbol: string };
  const token = await store.getToken(symbol.toUpperCase());
  if (!token) return reply.code(404).send({ error: "token not found" });
  return reply.send(await store.getPriceHistory(token.id));
});

app.get("/api/tokens/:symbol/trades", async (req, reply) => {
  const { symbol } = req.params as { symbol: string };
  const token = await store.getToken(symbol.toUpperCase());
  if (!token) return reply.code(404).send({ error: "token not found" });
  return reply.send(await store.getRecentTrades(token.id, 100));
});

function serializeToken(t: store.TokenWithCurve) {
  return {
    symbol: t.symbol,
    name: t.name,
    totalSupply: t.totalSupply,
    priceZec: currentPrice(t.curve),
    marketCapZec: marketCapZec(t.curve, t.totalSupply),
    realZecReserves: t.curve.realZecReserves,
    tokensSold: t.curve.tokensSold,
    graduated: isGraduated(t.curve),
    graduationThresholdZec: store.DEFAULT_CURVE_CONFIG.graduationZecThreshold,
    createdAt: t.createdAt,
    onChain: simulatedInscriptionFor(t.id),
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
  const wallet = await store.getWallet(body.walletId);
  const token = await store.getToken(body.symbol.toUpperCase());
  if (!wallet) return reply.code(400).send({ error: "invalid wallet" });
  if (!token) return reply.code(404).send({ error: "token not found" });

  const order = await store.createBuyOrder({
    internalWalletId: wallet.id,
    tokenId: token.id,
    zecAmount: body.zecAmount,
  });

  // The address IS the order: any payment that lands there executes at
  // the price of the block it confirms in (see zcashMock.ts).
  const zecAddress = generateOrderAddress(order.id, body.zecAmount);
  await store.setOrderAddress(order.id, zecAddress);

  return reply.send({
    orderId: order.id,
    zecAddress,
    zecAmount: body.zecAmount,
    status: "PENDING",
  });
});

app.get("/api/orders/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const order = await store.getOrder(id);
  if (!order) return reply.code(404).send({ error: "order not found" });
  return reply.send(order);
});

// When the zcash-service (here, the mock) detects the payment, the order
// executes against the bonding curve at that moment's price.
onPaymentDetected(async (orderId, confirmedZecAmount, txid) => {
  try {
    const order = await store.getOrder(orderId);
    if (!order || order.status !== "PENDING") return;
    const token = await store.getTokenById(order.tokenId);
    if (!token) return;

    const { tokensOut, newState } = quoteBuy(token.curve, confirmedZecAmount);
    await store.updateTokenCurve(token.id, newState);
    await store.recordPricePoint(token.id, newState, token.totalSupply);
    await store.creditBalance(order.internalWalletId, token.id, tokensOut);
    await store.fillBuyOrder(order.id, tokensOut, txid);

    app.log.info(`order ${orderId} filled: ${confirmedZecAmount} ZEC -> ${tokensOut.toFixed(0)} ${token.symbol}`);
  } catch (err) {
    await store.failOrder(orderId).catch(() => {});
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
  const wallet = await store.getWallet(body.walletId);
  const token = await store.getToken(body.symbol.toUpperCase());
  if (!wallet) return reply.code(400).send({ error: "invalid wallet" });
  if (!token) return reply.code(404).send({ error: "token not found" });

  const balance = await store.getBalance(wallet.id, token.id);
  if (balance < body.tokenAmount) {
    return reply.code(400).send({ error: "insufficient balance" });
  }

  const { zecOut, newState } = quoteSell(token.curve, body.tokenAmount);
  await store.updateTokenCurve(token.id, newState);
  await store.recordPricePoint(token.id, newState, token.totalSupply);
  await store.debitBalance(wallet.id, token.id, body.tokenAmount);
  const { txid } = sendPayout(body.refundAddress, zecOut);

  const order = await store.createSellOrder({
    internalWalletId: wallet.id,
    tokenId: token.id,
    tokenAmount: body.tokenAmount,
    refundAddress: body.refundAddress,
    zecAmount: zecOut,
    executionTxid: txid,
  });

  return reply.send(order);
});

const port = Number(process.env.PORT ?? 8787);
app.listen({ port, host: "0.0.0.0" }).then(() => {
  app.log.info(`zcash-launchpad backend (Postgres-backed) listening on :${port}`);
});
