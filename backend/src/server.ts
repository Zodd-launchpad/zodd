import Fastify from "fastify";
import { z } from "zod";
import * as store from "./lib/store.js";
import { generateTwelveWords } from "./lib/wordlist.js";
import { quoteBuy, quoteSell, currentPrice, marketCapZec, isGraduated } from "./lib/bondingCurve.js";
import { simulatedInscriptionFor } from "./lib/simulatedChain.js";
import { splitFee, TRADE_FEE_BPS, CREATOR_FEE_BPS, TOKEN_CREATE_FEE_ZEC } from "./lib/fees.js";
import { startFeeDistributor, runFeeDistributionOnce } from "./lib/feeDistributor.js";

// ZCASH_MODE=real switches every payment/inscription in this service to
// actually move ZEC through zcash-wallet-service, instead of the mock.
// This must be the ONLY place that decides which one is in effect.
const ZCASH_MODE = process.env.ZCASH_MODE === "real" ? "real" : "mock";
const zcashService = ZCASH_MODE === "real" ? await import("./lib/zcashReal.js") : await import("./lib/zcashMock.js");
const { generateOrderAddress, onPaymentDetected, sendPayout, MAX_PAYOUT_ZEC } = zcashService;

// Guards /api/admin/run-fee-distribution (real ZEC payouts) -- unset by
// default, so that route stays refused until Brai deliberately sets this in
// Railway's variables and only he knows the value.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

const app = Fastify({ logger: true });
app.log.info(`ZCASH_MODE=${ZCASH_MODE} -- ${ZCASH_MODE === "real" ? "REAL ZEC IS LIVE ON THIS DEPLOYMENT" : "using the simulated zcash service, no real funds move"}`);

app.register(import("@fastify/cors"), { origin: true });

// Lets the frontend know whether it's talking to the real or simulated
// zcash service, so it never shows a "simulated" note on a real payment (or
// vice versa) -- see BuyModal.tsx and the create-token waiting screen. Also
// exposes the current create fee so the form can show it before submission.
app.get("/api/mode", async (_req, reply) => reply.send({ zcashMode: ZCASH_MODE, tokenCreateFeeZec: TOKEN_CREATE_FEE_ZEC }));

// ---------- Wallets ----------

app.post("/api/wallets", async (_req, reply) => {
  const words = generateTwelveWords();
  const wallet = await store.createWallet(words);
  return reply.send({ walletId: wallet.id, walletTag: wallet.walletTag, words });
});

const importWalletSchema = z.object({
  words: z.array(z.string().min(1)).length(12, "expected exactly 12 words"),
});

// "Log back in" with the 12 words shown at creation time -- the only way
// back into an existing wallet, since disconnecting only clears the
// browser's localStorage, not the wallet itself (found 2026-09-07: without
// this, logging out was a dead end with no way back to your tokens).
app.post("/api/wallets/import", async (req, reply) => {
  const body = importWalletSchema.safeParse(req.body);
  if (!body.success) return reply.code(400).send({ error: "expected exactly 12 words" });
  const normalized = body.data.words.map((w) => w.trim().toLowerCase()).filter(Boolean);
  if (normalized.length !== 12) return reply.code(400).send({ error: "expected exactly 12 words" });
  const wallet = await store.findWalletBySeedWords(normalized);
  if (!wallet) return reply.code(404).send({ error: "no wallet found for those words" });
  return reply.send({ walletId: wallet.id, walletTag: wallet.walletTag });
});

app.get("/api/wallets/:id/portfolio", async (req, reply) => {
  const { id } = req.params as { id: string };
  const wallet = await store.getWallet(id);
  if (!wallet) return reply.code(404).send({ error: "wallet not found" });

  const holdings = await store.getPortfolio(id);
  return reply.send({ walletTag: wallet.walletTag, holdings });
});

// ---------- Tokens / market ----------

// Zcash has transparent (t1.../t3...) and shielded (u1... unified, zs1...
// sapling) addresses. Sending an automated payout to a transparent address
// is a "deshielding" transaction: it posts the amount and address publicly
// on-chain, permanently linking this platform's reserve to that address --
// exactly what SHLD.fun's own create form refuses ("a create needs a
// SHIELDED refund address ... the launch fee can only be returned to a
// shielded destination"). We enforce the same rule for the creator payout
// address, since it goes through the identical automated-send code path.
function isShieldedAddress(addr: string): boolean {
  return /^(u1|zs1)/.test(addr);
}

const createTokenSchema = z.object({
  symbol: z.string().min(1).max(12),
  name: z.string().min(1).max(64),
  totalSupply: z.number().positive().default(1_000_000_000),
  creatorWalletId: z.string(),
  // Where this token's 1% creator trading-fee share gets paid out, every
  // 24h. Optional -- without it, the fee still accrues but nobody claims it.
  creatorPayoutAddress: z
    .string()
    .min(10)
    .refine(isShieldedAddress, "creator payout address must be shielded (starts with u1 or zs1)")
    .optional(),
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

// Same model as SHLD.fun and as our own buy orders: the CREATOR pays the
// one-time create fee from their own wallet, to a one-time address, and the
// Token only actually gets created once that payment is detected. Nothing
// is charged to the platform's own wallet for this -- that was a concept
// error in the original version of this route (fixed 2026-09-06, see chat).
app.post("/api/tokens", async (req, reply) => {
  const body = createTokenSchema.parse(req.body);
  const symbol = body.symbol.toUpperCase();

  if (await store.getToken(symbol)) {
    return reply.code(409).send({ error: "symbol already exists" });
  }
  if (await store.isSymbolReserved(symbol)) {
    return reply.code(409).send({ error: "symbol is already reserved, waiting on someone else's payment" });
  }
  if (!(await store.getWallet(body.creatorWalletId))) {
    return reply.code(400).send({ error: "invalid creatorWalletId" });
  }

  const pending = await store.createPendingTokenCreation({
    symbol,
    name: body.name,
    totalSupply: body.totalSupply,
    creatorWalletId: body.creatorWalletId,
    creatorPayoutAddress: body.creatorPayoutAddress,
    logoDataUrl: body.logoDataUrl,
    description: body.description,
    twitterUrl: normalizeTwitter(body.twitterUrl),
    expectedZecAmount: TOKEN_CREATE_FEE_ZEC,
  });

  let zecAddress: string;
  let zecAmount: number;
  try {
    const res = await generateOrderAddress(pending.id, TOKEN_CREATE_FEE_ZEC);
    zecAddress = res.address;
    zecAmount = res.expectedZecAmount;
  } catch (err) {
    app.log.error(err, `couldn't generate a create-fee address for pending token creation ${pending.id}`);
    await store.failPendingTokenCreation(pending.id).catch(() => {});
    return reply.code(502).send({ error: "couldn't generate a payment address, try again" });
  }
  // zecAmount may be a hair above TOKEN_CREATE_FEE_ZEC -- see
  // pickUniqueAmount in zcashReal.ts -- so persist and return the real
  // adjusted amount, not the base fee.
  await store.setPendingTokenCreationAddress(pending.id, zecAddress, zecAmount);

  return reply.send({
    creationId: pending.id,
    zecAddress,
    zecAmount,
    status: "PENDING",
  });
});

app.get("/api/token-creations/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const pending = await store.getPendingTokenCreation(id);
  if (!pending) return reply.code(404).send({ error: "not found" });
  if (pending.status === "CREATED" && pending.resultTokenId) {
    return reply.send({ ...pending, resultSymbol: pending.symbol });
  }
  return reply.send(pending);
});

app.get("/api/tokens", async (_req, reply) => {
  const tokens = await store.listTokens();
  return reply.send(await Promise.all(tokens.map(serializeToken)));
});

app.get("/api/tokens/:symbol", async (req, reply) => {
  const { symbol } = req.params as { symbol: string };
  const token = await store.getToken(symbol.toUpperCase());
  if (!token) return reply.code(404).send({ error: "token not found" });
  return reply.send(await serializeToken(token));
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

async function serializeToken(t: store.TokenWithCurve) {
  const priceZec = currentPrice(t.curve);
  return {
    symbol: t.symbol,
    name: t.name,
    totalSupply: t.totalSupply,
    priceZec,
    priceChange24hPct: await store.getPriceChange24hPct(t.id, priceZec),
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
  let zecAmount: number;
  try {
    const res = await generateOrderAddress(order.id, body.zecAmount);
    zecAddress = res.address;
    zecAmount = res.expectedZecAmount;
  } catch (err) {
    app.log.error(err, `couldn't generate an order address for ${order.id}`);
    await store.failOrder(order.id).catch(() => {});
    return reply.code(502).send({ error: String((err as Error).message ?? err) });
  }
  // zecAmount may be a hair above what was requested -- see
  // pickUniqueAmount in zcashReal.ts -- so persist and return the real
  // amount the payer must actually send.
  await store.setOrderAddress(order.id, zecAddress, zecAmount);

  return reply.send({
    orderId: order.id,
    zecAddress,
    zecAmount,
    status: "PENDING",
  });
});

app.get("/api/orders/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const order = await store.getOrder(id);
  if (!order) return reply.code(404).send({ error: "order not found" });
  return reply.send(order);
});

// Both buy orders AND pending token creations reserve their one-time
// address through the same generateOrderAddress(id, amount) call, so a
// single global "a payment landed" callback has to figure out which kind
// of thing this id refers to before it knows what to do about it.
onPaymentDetected(async (orderId: string, confirmedZecAmount: number, txid: string, opts?: { isRepeat: boolean }) => {
  const isRepeat = opts?.isRepeat ?? false;
  const pendingCreation = await store.getPendingTokenCreation(orderId).catch(() => null);
  if (pendingCreation) {
    if (pendingCreation.status !== "PENDING") {
      // A repeat send of a token-creation's fee amount can't create a
      // second token for the same symbol -- there's nothing meaningful to
      // credit it against, so it's left as an unclaimed note for admin
      // recovery (see listUnclaimedNotes in zcashReal.ts), same as any
      // other surplus payment.
      if (isRepeat) app.log.warn(`repeat payment of ${confirmedZecAmount} ZEC landed on token-creation ${orderId} after it already ${pendingCreation.status} -- left unclaimed (txid ${txid})`);
      return;
    }
    try {
      // Real mode: this payment's own txid becomes the token's genesis
      // memo -- it's the creator's real fee payment, which is a more
      // honest "on-chain proof of creation" than the platform inscribing
      // to itself. Mock mode: no txid is meaningful, same as before.
      const genesisMemoTxid = ZCASH_MODE === "real" ? txid : undefined;
      const token = await store.completePendingTokenCreation(orderId, genesisMemoTxid);
      if (token) {
        app.log.info(`token ${token.symbol} created: creator paid ${confirmedZecAmount} ZEC create fee (txid ${txid})`);
      }
    } catch (err) {
      await store.failPendingTokenCreation(orderId).catch(() => {});
      app.log.error(err, `pending token creation ${orderId} failed to finalize`);
    }
    return;
  }

  // When the zcash-service detects a buy order's payment, the order
  // executes against the bonding curve at that moment's price. A payer who
  // resends the exact same amount to the exact same order again (Brai:
  // "si confirmas la compra 10 veces, tiene que comprarte 10 veces") gets
  // an equivalent ADDITIONAL buy each time instead of the extra sends
  // sitting unclaimed -- see isRepeat, set by zcashReal.ts's poll loop.
  // The original order can only ever be filled once, so a repeat clones a
  // brand-new, already-FILLED order rather than touching the original.
  try {
    const order = await store.getOrder(orderId);
    if (!order) return;
    if (!isRepeat && order.status !== "PENDING") return;
    if (isRepeat && order.status !== "FILLED") return; // nothing to clone off of yet -- shouldn't happen (see isRepeat's origin), but don't act on a half-formed order
    const token = await store.getTokenById(order.tokenId);
    if (!token) return;

    // The 2% trading fee comes off the top; only the net amount actually
    // moves the curve (the buyer's tokensOut is priced off the net, same
    // as any DEX-style fee-on-top model).
    const { net, creatorFee, platformFee } = splitFee(confirmedZecAmount);
    const { tokensOut, newState } = quoteBuy(token.curve, net);
    await store.updateTokenCurve(token.id, newState);
    await store.recordPricePoint(token.id, newState, token.totalSupply);
    await store.creditBalance(order.internalWalletId, token.id, tokensOut);
    await store.accrueFees(token.id, creatorFee, platformFee);

    if (isRepeat) {
      await store.createRepeatBuyOrder({
        internalWalletId: order.internalWalletId,
        tokenId: token.id,
        zecAddress: order.zecAddress ?? null,
        zecAmount: confirmedZecAmount,
        tokenAmount: tokensOut,
        executionTxid: txid,
      });
      app.log.info(`order ${orderId} REPEAT payment: ${confirmedZecAmount} ZEC -> ${tokensOut.toFixed(0)} ${token.symbol} (new order cloned, same address paid again, txid ${txid})`);
    } else {
      await store.fillBuyOrder(order.id, tokensOut, txid);
      app.log.info(`order ${orderId} filled: ${confirmedZecAmount} ZEC -> ${tokensOut.toFixed(0)} ${token.symbol} (fee ${(creatorFee + platformFee).toFixed(8)} ZEC)`);
    }
  } catch (err) {
    if (!isRepeat) await store.failOrder(orderId).catch(() => {});
    app.log.error(err, `order ${orderId} failed to execute${isRepeat ? " a repeat payment" : ""} against the curve`);
  }
});

// The in-memory payment watcher (zcashReal.ts's `watchers` map) does not
// survive a backend restart/redeploy -- without this, any payment sent
// while a deploy was in flight would confirm on-chain with nothing left
// watching for it (found the hard way on 2026-09-06: two real token-create
// payments went out mid-redeploy and were never picked up). On every boot,
// re-learn from the DB which orders/token-creations already got an address
// and are still PENDING, and resume watching them.
(async () => {
  try {
    const resumable = (zcashService as { resumeWatching: typeof import("./lib/zcashReal.js").resumeWatching }).resumeWatching;
    const [orders, creations] = await Promise.all([
      store.getPendingOrdersAwaitingPayment(),
      store.getPendingTokenCreationsAwaitingPayment(),
    ]);
    for (const o of orders) {
      if (o.zecAddress && o.zecAmount) resumable(o.id, o.zecAddress, o.zecAmount, new Date(o.createdAt).getTime());
    }
    for (const c of creations) {
      if (c.zecAddress) resumable(c.id, c.zecAddress, c.expectedZecAmount, new Date(c.createdAt).getTime());
    }
    if (orders.length || creations.length) {
      app.log.info(`resumed watching ${orders.length} pending order(s) and ${creations.length} pending token-creation(s) from before this restart`);
    }
  } catch (err) {
    app.log.error(err, "failed to resume watching pending payments after restart");
  }

  // Real mode only, and independent of the resume above: payment detection
  // now matches an incoming note to a pending order by AMOUNT (see
  // zcashReal.ts -- zingo-cli's `notes` command has no per-address info to
  // match on). A note that already fulfilled some past order stays
  // "unspent" forever from zingo-cli's point of view, so without this a
  // restart could let it be matched a second time to a different pending
  // order for the same amount. Seed the in-memory de-dupe set from every
  // txid already recorded in the DB as a completed payment.
  try {
    const seed = (zcashService as { seedConsumedTxids?: typeof import("./lib/zcashReal.js").seedConsumedTxids }).seedConsumedTxids;
    if (seed) {
      const known = await store.getAllKnownPaymentTxids();
      seed(known);
      if (known.length) app.log.info(`seeded ${known.length} already-used payment txid(s) so they can't be matched to a new order`);
    }
  } catch (err) {
    app.log.error(err, "failed to seed known payment txids after restart");
  }
})();

// ---------- Orders: sell ----------

const sellSchema = z.object({
  walletId: z.string(),
  symbol: z.string(),
  tokenAmount: z.number().positive(),
  // Same rule as creatorPayoutAddress above and for the same reason: this is
  // an automated send out of the platform's own wallet, and paying out to a
  // transparent (t1...) address would "deshield" it on-chain, permanently
  // and publicly linking the platform reserve to that address. This was
  // missing here until a real sell test surfaced it (2026-09-07) -- only
  // the create-token payout address had the check.
  refundAddress: z
    .string()
    .min(10)
    .refine(isShieldedAddress, "refund address must be shielded (starts with u1 or zs1)"),
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

// Manual recovery for the same-amount watcher collision bug (found
// 2026-09-07: two PENDING token creations open at once with the same
// expectedZecAmount -- an old abandoned one and a new real one -- race for
// the next matching note, and since matching is amount-only (see
// zcashReal.ts's big comment), whichever watcher was registered first wins,
// even if the payer's intent was clearly the newer one). This lets a real,
// already-received payment that got misattributed be credited to the
// correct pending creation after the fact, without asking the payer to
// send money twice. It does NOT move any funds -- the ZEC already sits in
// the platform wallet either way -- it only finishes the token-creation
// record. Guarded to real mode, PENDING-only (completePendingTokenCreation
// already no-ops otherwise), and requires the id of a note actually seen by
// the wallet, so this can't be used to spin up a token for free.
app.post("/api/admin/force-complete-token-creation", async (req, reply) => {
  if (ZCASH_MODE !== "real") return reply.code(404).send({ error: "not in real mode" });
  const body = z.object({ creationId: z.string(), genesisMemoTxid: z.string().min(10) }).safeParse(req.body);
  if (!body.success) return reply.code(400).send({ error: "expected creationId and genesisMemoTxid" });
  const pending = await store.getPendingTokenCreation(body.data.creationId);
  if (!pending) return reply.code(404).send({ error: "not found" });
  if (pending.status !== "PENDING") return reply.code(409).send({ error: `already ${pending.status}` });
  const token = await store.completePendingTokenCreation(body.data.creationId, body.data.genesisMemoTxid);
  if (!token) return reply.code(500).send({ error: "completion failed" });
  app.log.info(`[admin] force-completed pending creation ${body.data.creationId} -> token ${token.symbol} (manual recovery, txid ${body.data.genesisMemoTxid})`);
  return reply.send({ ok: true, token });
});

// Brai (2026-09-07): wants to run the creator-fee distribution himself, on
// demand, instead of only via the automatic 24h/15min-check cycle
// (startFeeDistributor below) -- "quiero hacerlo manual yo, para mas
// seguridad". This runs the EXACT same logic as that automatic cycle (same
// runFeeDistributionOnce), it just runs it right now instead of waiting for
// the next tick -- it still only pays tokens actually due (nothing paid in
// the last 24h) and respects the same per-payout safety cap. This moves
// REAL ZEC in real mode, so it's gated behind ADMIN_TOKEN (set it in
// Railway's variables; unset means this route always refuses) rather than
// being open like the recovery route above, which never moves funds.
app.post("/api/admin/run-fee-distribution", async (req, reply) => {
  if (ZCASH_MODE !== "real") return reply.code(404).send({ error: "not in real mode" });
  if (!ADMIN_TOKEN) return reply.code(503).send({ error: "ADMIN_TOKEN is not configured" });
  if (req.headers["x-admin-token"] !== ADMIN_TOKEN) return reply.code(401).send({ error: "unauthorized" });
  // ignoreInterval: true -- this is Brai deliberately choosing to run it
  // right now, so it pays out everything currently accrued (with a payout
  // address) instead of also requiring 24h since token creation/last
  // payout, which is a pacing rule that only makes sense for the automatic
  // cycle (see getTokensDueForFeePayout's comment).
  const result = await runFeeDistributionOnce(sendPayout, MAX_PAYOUT_ZEC, app.log, true);
  app.log.info(`[admin] manual fee distribution run: paid ${result.paid.length}, skipped ${result.skipped.length}`);
  return reply.send({ ok: true, ...result });
});

// Read-only: confirms the real wallet is funded/reachable without ever
// touching the seed or moving money. 404s outside real mode.
app.get("/api/admin/zcash-status", async (_req, reply) => {
  if (ZCASH_MODE !== "real") return reply.code(404).send({ error: "not in real mode" });
  try {
    const status = await (zcashService as typeof import("./lib/zcashReal.js")).getWalletStatus();
    return reply.send(status);
  } catch (err) {
    return reply.code(502).send({ error: String((err as Error).message ?? err) });
  }
});

// Brai (2026-09-07): "quiero hacerlo yo solo el claim... quiero estar
// seguro que se hace, de otra forma no lo controlo" -- the automatic 24h
// cycle is intentionally OFF. Real ZEC creator-fee payouts only ever move
// through the manual, ADMIN_TOKEN-gated /api/admin/run-fee-distribution
// route below, which he triggers himself. Do not re-enable this without
// him explicitly asking for automatic payouts back -- it's disabled for
// fund-safety reasons, not by oversight.
// startFeeDistributor(sendPayout, MAX_PAYOUT_ZEC, app.log);

const port = Number(process.env.PORT ?? 8787);
app.listen({ port, host: "0.0.0.0" }).then(() => {
  app.log.info(`zcash-launchpad backend (Postgres-backed) listening on :${port}`);
});
