import Fastify from "fastify";
import { z } from "zod";
import * as store from "./lib/store.js";
import { generateTwelveWords } from "./lib/wordlist.js";
import { quoteBuy, quoteSell, currentPrice, marketCapZec, isGraduated } from "./lib/bondingCurve.js";
import { simulatedInscriptionFor } from "./lib/simulatedChain.js";
import { splitFee, TRADE_FEE_BPS, CREATOR_FEE_BPS } from "./lib/fees.js";
import { startFeeDistributor } from "./lib/feeDistributor.js";

// ZCASH_MODE=real switches every payment/inscription in this service to
// actually move ZEC through zcash-wallet-service, instead of the mock.
// This must be the ONLY place that decides which one is in effect.
const ZCASH_MODE = process.env.ZCASH_MODE === "real" ? "real" : "mock";
const zcashService = ZCASH_MODE === "real" ? await import("./lib/zcashReal.js") : await import("./lib/zcashMock.js");
const { generateOrderAddress, onPaymentDetected, sendPayout, MAX_PAYOUT_ZEC } = zcashService;

const app = Fastify({ logger: true });
app.log.info(`ZCASH_MODE=${ZCASH_MODE} -- ${ZCASH_MODE === "real" ? "REAL ZEC IS LIVE ON THIS DEPLOYMENT" : "using the simulated zcash service, no real funds move"}`);

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
  // Where this token's 1% creator trading-fee share gets paid out, every
  // 24h. Optional -- without it, the fee still accrues but nobody claims it.
  creatorPayoutAddress: z.string().min(10).optional(),
  // Token profile, all optional. The logo is resized/encoded to a small
  // square JPEG data URL client-side before it ever reaches here -- this
  // just caps it as a last line of defense against an oversized payload.
  logoDataUrl: z
    .string()
    .max(400_000)
    .regex(/^data:image\/(png|jpeg|jpg|webp|gif);base64,/, "logo must be a png/jpeg/webp/gif data URL")
    .optional(),
  description: z.string().max(500).optional(),
  twitterUrl: z.string().max(200).optional(),
});

/** Accepts "@handle", "handle", or a full URL and normalizes to a full
 * https://x.com/... link so the frontend can just render it as a link. */
function normalizeTwitter(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const handle = trimmed.replace(/^@/, "");
  return `https://x.com/${handle}`;
}

app.post("/api/tokens", async (req, reply) => {
  const body = createTokenSchema.parse(req.body);
  const symbol = body.symbol.toUpperCase();

  if (await store.getToken(symbol)) {
    return reply.code(409).send({ error: "symbol already exists" });
  }
  if (!(await store.getWallet(body.creatorWalletId))) {
    return reply.code(400).send({ error: "invalid creatorWalletId" });
  }

  let genesisMemoTxid: string | undefined;
  if (ZCASH_MODE === "real") {
    // Real mode: the 0.01 ZEC creation fee is charged and inscribed
    // on-chain BEFORE the token exists in our ledger at all -- if this
    // fails, nothing is created, same as if a card payment had failed.
    try {
      const inscription = await (zcashService as typeof import("./lib/zcashReal.js")).inscribeTokenCreation(
        symbol,
        body.name
      );
      genesisMemoTxid = inscription.txid;
    } catch (err) {
      app.log.error(err, "real on-chain inscription failed, token was not created");
      return reply.code(502).send({ error: "couldn't broadcast the on-chain creation transaction, try again" });
    }
  }

  const token = await store.createToken({
    symbol,
    name: body.name,
    totalSupply: body.totalSupply,
    creatorWalletId: body.creatorWalletId,
    genesisMemoTxid,
    creatorPayoutAddress: body.creatorPayoutAddress,
    logoDataUrl: body.logoDataUrl,
    description: body.description,
    twitterUrl: normalizeTwitter(body.twitterUrl),
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
    logoDataUrl: t.logoDataUrl,
    description: t.description,
    twitterUrl: t.twitterUrl,
    fee: {
      tradeFeeBps: TRADE_FEE_BPS,
      creatorFeeBps: CREATOR_FEE_BPS,
      creatorPayoutAddress: t.creatorPayoutAddress,
      creatorFeeAccruedZec: t.creatorFeeAccruedZec,
      creatorFeeTotalPaidZec: t.creatorFeeTotalPaidZec,
      lastFeePayoutAt: t.lastFeePayoutAt,
    },
    onChain:
      t.genesisMemoTxid != null
        ? {
            simulated: false as const,
            txid: t.genesisMemoTxid,
            explorerUrl: `https://mainnet.zcashexplorer.app/transactions/${t.genesisMemoTxid}`,
          }
        : simulatedInscriptionFor(t.id),
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
  // the price of the block it confirms in (see zcashMock.ts / zcashReal.ts).
  let zecAddress: string;
  try {
    zecAddress = await generateOrderAddress(order.id, body.zecAmount);
  } catch (err) {
    app.log.error(err, `couldn't generate an order address for ${order.id}`);
    await store.failOrder(order.id).catch(() => {});
    return reply.code(502).send({ error: String((err as Error).message ?? err) });
  }
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

    // The 3% trading fee comes off the top; only the net amount actually
    // moves the curve (the buyer's tokensOut is priced off the net, same
    // as any DEX-style fee-on-top model).
    const { net, creatorFee, platformFee } = splitFee(confirmedZecAmount);
    const { tokensOut, newState } = quoteBuy(token.curve, net);
    await store.updateTokenCurve(token.id, newState);
    await store.recordPricePoint(token.id, newState, token.totalSupply);
    await store.creditBalance(order.internalWalletId, token.id, tokensOut);
    await store.accrueFees(token.id, creatorFee, platformFee);
    await store.fillBuyOrder(order.id, tokensOut, txid);

    app.log.info(`order ${orderId} filled: ${confirmedZecAmount} ZEC -> ${tokensOut.toFixed(0)} ${token.symbol} (fee ${(creatorFee + platformFee).toFixed(8)} ZEC)`);
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
  // Same 3% fee, taken off the seller's proceeds this time: they receive
  // the net amount, the curve/reserve accounting still reflects the full
  // gross zecOut (kept internally consistent with how the buy side works).
  const { net: netPayout, creatorFee, platformFee } = splitFee(zecOut);

  let txid: string;
  try {
    ({ txid } = await sendPayout(body.refundAddress, netPayout));
  } catch (err) {
    app.log.error(err, `sell payout failed for wallet ${wallet.id} / token ${token.symbol}`);
    return reply.code(502).send({ error: String((err as Error).message ?? err) });
  }

  await store.updateTokenCurve(token.id, newState);
  await store.recordPricePoint(token.id, newState, token.totalSupply);
  await store.debitBalance(wallet.id, token.id, body.tokenAmount);
  await store.accrueFees(token.id, creatorFee, platformFee);

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

// Every 15min, pays out any token's accrued creator fee that hasn't been
// distributed in the last 24h. Same code path in mock and real mode.
startFeeDistributor(sendPayout, MAX_PAYOUT_ZEC, app.log);

const port = Number(process.env.PORT ?? 8787);
app.listen({ port, host: "0.0.0.0" }).then(() => {
  app.log.info(`zcash-launchpad backend (Postgres-backed) listening on :${port}`);
});
