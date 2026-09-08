import Fastify from "fastify";
import { z } from "zod";
import * as store from "./lib/store.js";
import { generateTwelveWords } from "./lib/wordlist.js";
import { quoteBuy, quoteSell, currentPrice, marketCapZec, isGraduated } from "./lib/bondingCurve.js";
import { simulatedInscriptionFor } from "./lib/simulatedChain.js";
import { splitFee, TRADE_FEE_BPS, CREATOR_FEE_BPS, TOKEN_CREATE_FEE_ZEC, computeSellerPayout, NETWORK_FEE_ZEC } from "./lib/fees.js";
import { startFeeDistributor, runFeeDistributionOnce } from "./lib/feeDistributor.js";
import { startZecPricePolling, getZecUsdPrice } from "./lib/zecPrice.js";
import { withTokenLock } from "./lib/mutex.js";
import { checkOrderRateLimit } from "./lib/rateLimit.js";

// ZCASH_MODE=real switches every payment/inscription in this service to
// actually move ZEC through zcash-wallet-service, instead of the mock.
// This must be the ONLY place that decides which one is in effect.
const ZCASH_MODE = process.env.ZCASH_MODE === "real" ? "real" : "mock";
const zcashService = ZCASH_MODE === "real" ? await import("./lib/zcashReal.js") : await import("./lib/zcashMock.js");
const { generateOrderAddress, onPaymentDetected, sendPayout, MAX_PAYOUT_ZEC, buildPaymentMemoBase64 } = zcashService;

// Guards /api/admin/run-fee-distribution (real ZEC payouts) -- unset by
// default, so that route stays refused until Brai deliberately sets this in
// Railway's variables and only he knows the value.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
// Temporary, self-contained diagnostic token -- separate from ADMIN_TOKEN
// on purpose, so checking this doesn't touch/depend on that one. See the
// route below and the comment on rawNotesDebug in zcash-wallet-service's
// cli.js. Remove both once answered.
const DEBUG_NOTES_TOKEN = process.env.DEBUG_NOTES_TOKEN;

const app = Fastify({ logger: true });
app.log.info(`ZCASH_MODE=${ZCASH_MODE} -- ${ZCASH_MODE === "real" ? "REAL ZEC IS LIVE ON THIS DEPLOYMENT" : "using the simulated zcash service, no real funds move"}`);

app.register(import("@fastify/cors"), { origin: true });

// Lets the frontend know whether it's talking to the real or simulated
// zcash service, so it never shows a "simulated" note on a real payment (or
// vice versa) -- see BuyModal.tsx and the create-token waiting screen. Also
// exposes the current create fee so the form can show it before submission.
app.get("/api/mode", async (_req, reply) => reply.send({ zcashMode: ZCASH_MODE, tokenCreateFeeZec: TOKEN_CREATE_FEE_ZEC }));

// Brai, 2026-09-07: "tiene que tener precio en dolares, todo" -- live ZEC/USD
// rate for the frontend to convert every ZEC-denominated price it shows.
// Polled server-side (see zecPrice.ts) so every client isn't hammering a
// public price API directly; this route just serves whatever's cached.
// { usd: null, updatedAt: null } means the very first poll hasn't landed
// yet (only possible in the first ~seconds after a boot) -- the frontend
// just hides the USD figure until it has a real number.
app.get("/api/zec-usd-price", async (_req, reply) => reply.send(getZecUsdPrice()));
startZecPricePolling(app.log);

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
  return reply.send({ walletTag: wallet.walletTag, holdings, defaultRefundAddress: wallet.defaultRefundAddress });
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
// Brai, 2026-09-07: "estoy copiando mi wallet shielded recien copiada y no
// me deja comprar... me dice que invalid wallet" -- some wallets' "copy
// address" includes a trailing newline or leading/trailing spaces, which
// broke this prefix check even for a genuinely valid address. Trimmed
// here, and every zod schema below that accepts one of these addresses
// also has `.trim()` so the stored value itself is clean too, not just
// this check.
function isShieldedAddress(addr: string): boolean {
  return /^(u1|zs1)/.test(addr.trim());
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
    .trim()
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
  websiteUrl: z.string().max(200).optional(),
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

/** Same idea as normalizeTwitter: accepts "example.com" or a full URL and
 * always returns something starting with http(s):// so the frontend can
 * just render it as a link without guessing. */
function normalizeWebsite(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
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
    websiteUrl: normalizeWebsite(body.websiteUrl),
    expectedZecAmount: TOKEN_CREATE_FEE_ZEC,
  });

  let zecAddress: string;
  let zecAmount: number;
  let saplingDiversifierHex: string | null = null;
  let orchardDiversifierHex: string | null = null;
  try {
    const res = await generateOrderAddress(pending.id, TOKEN_CREATE_FEE_ZEC);
    zecAddress = res.address;
    zecAmount = res.expectedZecAmount;
    saplingDiversifierHex = (res as { saplingDiversifierHex?: string | null }).saplingDiversifierHex ?? null;
    orchardDiversifierHex = (res as { orchardDiversifierHex?: string | null }).orchardDiversifierHex ?? null;
  } catch (err) {
    app.log.error(err, `couldn't generate a create-fee address for pending token creation ${pending.id}`);
    await store.failPendingTokenCreation(pending.id).catch(() => {});
    return reply.code(502).send({ error: "couldn't generate a payment address, try again" });
  }
  // zecAmount may be a hair above TOKEN_CREATE_FEE_ZEC -- see
  // pickUniqueAmount in zcashReal.ts -- so persist and return the real
  // adjusted amount, not the base fee. Also persists zecAddress's own
  // diversifier (see the ZODD comment on PendingPayment in zcashReal.ts) so
  // a restart can still resume-watch this by address, not just memo/amount.
  await store.setPendingTokenCreationAddress(pending.id, zecAddress, zecAmount, saplingDiversifierHex, orchardDiversifierHex);

  return reply.send({
    creationId: pending.id,
    zecAddress,
    zecAmount,
    // Brai, 2026-09-07: "esto tiene que ir por frase semilla" -- base64
    // memo for the payment URI (see buildPaymentMemoBase64 in
    // zcashReal.ts). The frontend drops this into the zcash: URI/QR as
    // memo=..., so a memo-aware wallet matches this creation by its unique
    // id instead of by amount -- immune to the same-fee-amount collision
    // every OTHER token creation is otherwise exposed to.
    memo: buildPaymentMemoBase64(pending.id),
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

// Site-wide trade feed across every token, for the small always-on
// activity panel (Brai, 2026-09-08). Public/no-auth, same as the
// per-token version above -- it's just recent FILLED orders, no
// wallet-identifying info.
app.get("/api/trades", async (req, reply) => {
  return reply.send(await store.getRecentTradesGlobal(30));
});

async function serializeToken(t: store.TokenWithCurve) {
  const priceZec = currentPrice(t.curve);
  return {
    symbol: t.symbol,
    name: t.name,
    totalSupply: t.totalSupply,
    priceZec,
    priceChange24hPct: await store.getPriceChange24hPct(t.id, priceZec),
    priceChangeSinceLaunchPct: await store.getPriceChangeSinceLaunchPct(t.id, priceZec),
    marketCapZec: marketCapZec(t.curve, t.totalSupply),
    realZecReserves: t.curve.realZecReserves,
    tokensSold: t.curve.tokensSold,
    graduated: isGraduated(t.curve),
    graduationThresholdZec: store.DEFAULT_CURVE_CONFIG.graduationZecThreshold,
    createdAt: t.createdAt,
    logoDataUrl: t.logoDataUrl,
    description: t.description,
    twitterUrl: t.twitterUrl,
    websiteUrl: t.websiteUrl,
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

// Brai, 2026-09-07: "que la gente cuando vaya a comprar te deje la
// wallet... asi tenemos registrado el comprador y le enviamos el dinero en
// caso de problemas" -- a shielded refund address, same as the one Sell
// already requires, now also collected up front on a buy. Required (not
// optional) so it's actually there to use if this specific order ever
// needs manual recovery -- see the big comment on generateOrderAddress's
// amount-only matching in zcashReal.ts for why an automatic refund isn't
// safely buildable, and why a per-order address on file is the realistic
// improvement instead.
const buySchema = z.object({
  walletId: z.string(),
  symbol: z.string(),
  zecAmount: z.number().positive(),
  refundAddress: z
    .string()
    .trim()
    .min(10)
    .refine(isShieldedAddress, "refund address must be shielded (starts with u1 or zs1)"),
});

app.post("/api/orders/buy", async (req, reply) => {
  const body = buySchema.parse(req.body);
  // Brai, 2026-09-07: cap spam buy/sell requests per wallet -- see
  // rateLimit.ts. Checked before any DB writes or wallet-service calls.
  const rl = checkOrderRateLimit(body.walletId);
  if (!rl.allowed) return reply.code(429).send({ error: rl.message });
  const wallet = await store.getWallet(body.walletId);
  const token = await store.getToken(body.symbol.toUpperCase());
  if (!wallet) return reply.code(400).send({ error: "invalid wallet" });
  if (!token) return reply.code(404).send({ error: "token not found" });

  const order = await store.createBuyOrder({
    internalWalletId: wallet.id,
    tokenId: token.id,
    zecAmount: body.zecAmount,
    refundAddress: body.refundAddress,
  });
  // Best-effort, same as the sell/create-token flows: remember this address
  // so it pre-fills next time, in any of the three flows.
  await store.setDefaultRefundAddress(wallet.id, body.refundAddress).catch((err) => app.log.error(err, "failed to remember buy refund address"));

  // The address IS the order: any payment that lands there executes at
  // the price of the block it confirms in (see zcashMock.ts / zcashReal.ts).
  let zecAddress: string;
  let zecAmount: number;
  let saplingDiversifierHex: string | null = null;
  let orchardDiversifierHex: string | null = null;
  try {
    const res = await generateOrderAddress(order.id, body.zecAmount);
    zecAddress = res.address;
    zecAmount = res.expectedZecAmount;
    saplingDiversifierHex = (res as { saplingDiversifierHex?: string | null }).saplingDiversifierHex ?? null;
    orchardDiversifierHex = (res as { orchardDiversifierHex?: string | null }).orchardDiversifierHex ?? null;
  } catch (err) {
    app.log.error(err, `couldn't generate an order address for ${order.id}`);
    await store.failOrder(order.id).catch(() => {});
    return reply.code(502).send({ error: String((err as Error).message ?? err) });
  }
  // zecAmount may be a hair above what was requested -- see
  // pickUniqueAmount in zcashReal.ts -- so persist and return the real
  // amount the payer must actually send. Also persists zecAddress's own
  // diversifier -- see the ZODD comment on PendingPayment in zcashReal.ts.
  await store.setOrderAddress(order.id, zecAddress, zecAmount, saplingDiversifierHex, orchardDiversifierHex);

  return reply.send({
    orderId: order.id,
    zecAddress,
    zecAmount,
    // Brai, 2026-09-07: "esto tiene que ir por frase semilla" -- see the
    // matching comment on the token-creation route above and the big one on
    // buildPaymentMemoBase64 in zcashReal.ts for the full reasoning.
    memo: buildPaymentMemoBase64(order.id),
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
        // Brai, 2026-09-07: "tenemos que hacer un sistema que ponga la
        // wallet por si falla la transaccion" -- same remembered-address
        // mechanism as a sell's refund address (see setDefaultRefundAddress
        // below), now also fed by a successful token creation, so the
        // creator payout address they typed here pre-fills next time too
        // (a retry after a failed/expired creation, a second token, or the
        // Sell modal). Best-effort: never let this fail a creation that
        // already went through.
        if (token.creatorPayoutAddress) {
          await store
            .setDefaultRefundAddress(token.creatorWalletId, token.creatorPayoutAddress)
            .catch((err) => app.log.error(err, "failed to remember creator payout address"));
        }
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

    // Everything from reading the curve through writing it back is
    // serialized per-token (see mutex.ts's big comment: two buys for the
    // same token processed concurrently -- very possible now that a
    // deliberate repeat payment can land in the same poll tick as another
    // one -- used to silently lose one buy's contribution to the curve).
    await withTokenLock(order.tokenId, async () => {
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
    });
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
      if (o.zecAddress && o.zecAmount)
        resumable(o.id, o.zecAddress, o.zecAmount, new Date(o.createdAt).getTime(), o.zecSaplingDiversifierHex, o.zecOrchardDiversifierHex);
    }
    for (const c of creations) {
      if (c.zecAddress)
        resumable(c.id, c.zecAddress, c.expectedZecAmount, new Date(c.createdAt).getTime(), c.zecSaplingDiversifierHex, c.zecOrchardDiversifierHex);
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
    .trim()
    .min(10)
    .refine(isShieldedAddress, "refund address must be shielded (starts with u1 or zs1)"),
});

// Found 2026-09-07 (Brai, selling FLORKY): "Internal Server Error" from
// quoteSell's "cannot sell more than the curve has issued", even though
// his balance clearly had enough. Root cause was a lost-update race on the
// curve state -- see mutex.ts's big comment. Everything from reading the
// curve through writing it back is now serialized per-token via
// withTokenLock, and the curve is re-read INSIDE the lock (not reused from
// the `token` fetched above, which can already be stale by the time the
// lock is acquired if a buy/sell for the same token was queued ahead of
// this one).
app.post("/api/orders/sell", async (req, reply) => {
  const body = sellSchema.parse(req.body);
  // Same per-wallet cap as buy -- counts against the same 5-per-20s budget
  // (see rateLimit.ts), since a sell is the more expensive one to spam
  // (it sends a real payout on every success).
  const rl = checkOrderRateLimit(body.walletId);
  if (!rl.allowed) return reply.code(429).send({ error: rl.message });
  const wallet = await store.getWallet(body.walletId);
  const tokenCheck = await store.getToken(body.symbol.toUpperCase());
  if (!wallet) return reply.code(400).send({ error: "invalid wallet" });
  if (!tokenCheck) return reply.code(404).send({ error: "token not found" });

  try {
    const order = await withTokenLock(tokenCheck.id, async () => {
      const token = await store.getTokenById(tokenCheck.id);
      if (!token) throw new Error("token not found");

      const balance = await store.getBalance(wallet.id, token.id);
      if (balance < body.tokenAmount) {
        throw Object.assign(new Error("insufficient balance"), { httpStatus: 400 });
      }

      const { zecOut, newState } = quoteSell(token.curve, body.tokenAmount);
      // 2% trade fee (1% creator + 1% platform), taken off the gross curve
      // output -- unaffected by the network-fee deduction below, so the
      // creator and platform always get their full cut regardless of how
      // small the sell is.
      const { net: netPayout, creatorFee, platformFee } = splitFee(zecOut);

      // Brai, 2026-09-07: "el fee [de red] lo tiene que pagar el
      // vendedor... si no supera el fee, no se puede vender... es para q
      // la plataforma no pierda dinero" -- the real Zcash network fee
      // comes out of the SELLER's share (netPayout), not the platform's,
      // so the platform never nets negative on a sell. If that leaves
      // nothing to send, block the sell entirely before sendPayout ever
      // runs -- no real ZEC moves and the curve/balance are never touched.
      // See computeSellerPayout in fees.ts.
      const { sellerPayout, blocked } = computeSellerPayout(netPayout);
      if (blocked) {
        throw Object.assign(
          new Error(
            `sell amount too small -- after the ~${NETWORK_FEE_ZEC} ZEC network fee there'd be nothing left to send you (net payout would be ${netPayout.toFixed(8)} ZEC). Sell a larger amount.`
          ),
          { httpStatus: 400 }
        );
      }

      const { txid } = await sendPayout(body.refundAddress, sellerPayout);

      await store.updateTokenCurve(token.id, newState);
      await store.recordPricePoint(token.id, newState, token.totalSupply);
      await store.debitBalance(wallet.id, token.id, body.tokenAmount);
      await store.accrueFees(token.id, creatorFee, platformFee);
      // Remember this address so the Sell modal can pre-fill it next
      // time, for a different token, without asking the payer to paste it
      // in again (Brai, 2026-09-07). Best-effort: never let this fail a
      // sell whose actual payout already went through.
      await store.setDefaultRefundAddress(wallet.id, body.refundAddress).catch((err) => app.log.error(err, "failed to remember refund address"));

      return store.createSellOrder({
        internalWalletId: wallet.id,
        tokenId: token.id,
        tokenAmount: body.tokenAmount,
        refundAddress: body.refundAddress,
        zecAmount: zecOut,
        executionTxid: txid,
      });
    });

    return reply.send(order);
  } catch (err) {
    const httpStatus = (err as { httpStatus?: number }).httpStatus;
    if (httpStatus) return reply.code(httpStatus).send({ error: (err as Error).message });
    app.log.error(err, `sell failed for wallet ${wallet.id} / token ${tokenCheck.symbol}`);
    return reply.code(502).send({ error: String((err as Error).message ?? err) });
  }
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

// Data repair, not a fund transfer -- see recomputeCurveFromOrders's big
// comment in store.ts. Fixes a token's stored curve state (tokensSold /
// realZecReserves / graduated) to match the true replay of its FILLED
// orders, undoing any drift from the lost-update race that's now closed
// by withTokenLock. Never touches balances or moves ZEC. Gated behind
// ADMIN_TOKEN like the fee-distribution trigger, out of caution (it does
// mutate financial-state data), even though it's safe to call any number
// of times -- it always recomputes from the same source of truth.
app.post("/api/admin/recompute-curve", async (req, reply) => {
  if (!ADMIN_TOKEN) return reply.code(503).send({ error: "ADMIN_TOKEN is not configured" });
  if (req.headers["x-admin-token"] !== ADMIN_TOKEN) return reply.code(401).send({ error: "unauthorized" });
  const body = z.object({ symbol: z.string() }).safeParse(req.body);
  if (!body.success) return reply.code(400).send({ error: "expected { symbol }" });
  const token = await store.getToken(body.data.symbol.toUpperCase());
  if (!token) return reply.code(404).send({ error: "token not found" });
  const result = await withTokenLock(token.id, () => store.recomputeCurveFromOrders(token.id));
  app.log.info(`[admin] recomputed curve for ${token.symbol}: tokensSold ${result.before.tokensSold} -> ${result.after.tokensSold}, reserve ${result.before.realZecReserves} -> ${result.after.realZecReserves} (${result.ordersReplayed} orders replayed)`);
  return reply.send({ ok: true, symbol: token.symbol, ...result });
});

// Brai, 2026-09-07: no "edit token" UI exists yet, so this is the admin
// route for fixing a token's twitter/website link after creation (found
// via BAMAMA's website being saved as "https://www.zodd.fun" -- a typo'd
// "www." with no DNS record). Pure data edit, not a fund transfer, but
// gated behind ADMIN_TOKEN anyway since it's an admin-only write. Pass an
// empty string for a field to clear it; omit a field to leave it as-is.
app.post("/api/admin/set-token-links", async (req, reply) => {
  if (!ADMIN_TOKEN) return reply.code(503).send({ error: "ADMIN_TOKEN is not configured" });
  if (req.headers["x-admin-token"] !== ADMIN_TOKEN) return reply.code(401).send({ error: "unauthorized" });
  const body = z
    .object({ symbol: z.string(), twitterUrl: z.string().max(200).optional(), websiteUrl: z.string().max(200).optional() })
    .safeParse(req.body);
  if (!body.success) return reply.code(400).send({ error: "expected { symbol, twitterUrl?, websiteUrl? }" });
  const token = await store.getToken(body.data.symbol.toUpperCase());
  if (!token) return reply.code(404).send({ error: "token not found" });
  await store.setTokenLinks(token.id, {
    twitterUrl: body.data.twitterUrl !== undefined ? normalizeTwitter(body.data.twitterUrl) ?? "" : undefined,
    websiteUrl: body.data.websiteUrl !== undefined ? normalizeWebsite(body.data.websiteUrl) ?? "" : undefined,
  });
  app.log.info(`[admin] updated links for ${token.symbol}: ${JSON.stringify(body.data)}`);
  return reply.send({ ok: true, symbol: token.symbol });
});

// Brai, 2026-09-07: "los fee [de la plataforma], como claimeo" -- read-only
// check of how much of the platform's own 1% cut is claimable right now
// (see getPlatformFeeStatus's comment in store.ts for why this isn't just
// Token.platformFeeTotalZec). Gated behind ADMIN_TOKEN since it's
// financial info, even though it never moves funds.
app.get("/api/admin/platform-fee-status", async (req, reply) => {
  if (!ADMIN_TOKEN) return reply.code(503).send({ error: "ADMIN_TOKEN is not configured" });
  if (req.headers["x-admin-token"] !== ADMIN_TOKEN) return reply.code(401).send({ error: "unauthorized" });
  const status = await store.getPlatformFeeStatus();
  return reply.send({ ok: true, ...status });
});

// The actual withdrawal -- moves REAL ZEC out of the platform wallet to
// `toAddress`, same as run-fee-distribution does for creators. Same
// ADMIN_TOKEN gate, same shielded-address check, same MAX_PAYOUT_ZEC cap.
// `amountZec` is optional: omit it to withdraw everything currently
// claimable (capped at MAX_PAYOUT_ZEC per send, same as any other payout);
// pass it to withdraw a specific amount instead. Always capped at what's
// actually claimable so this can never eat into the bonding-curve reserve
// or unpaid creator fees sitting in the same wallet balance.
const withdrawPlatformFeeBody = z.object({
  toAddress: z.string().trim().refine(isShieldedAddress, "toAddress must be shielded (starts with u1 or zs1)"),
  amountZec: z.number().positive().optional(),
});
app.post("/api/admin/withdraw-platform-fee", async (req, reply) => {
  if (ZCASH_MODE !== "real") return reply.code(404).send({ error: "not in real mode" });
  if (!ADMIN_TOKEN) return reply.code(503).send({ error: "ADMIN_TOKEN is not configured" });
  if (req.headers["x-admin-token"] !== ADMIN_TOKEN) return reply.code(401).send({ error: "unauthorized" });
  const body = withdrawPlatformFeeBody.safeParse(req.body);
  if (!body.success) return reply.code(400).send({ error: "expected { toAddress, amountZec? }", details: body.error.flatten() });

  const status = await store.getPlatformFeeStatus();
  const requested = body.data.amountZec ?? status.claimableZec;
  const amountZec = Math.min(requested, status.claimableZec, MAX_PAYOUT_ZEC);
  if (amountZec <= 0) {
    return reply.code(400).send({ error: "nothing claimable right now", ...status });
  }
  if (body.data.amountZec && body.data.amountZec > status.claimableZec) {
    return reply.code(400).send({ error: `only ${status.claimableZec} ZEC is claimable, cannot withdraw ${body.data.amountZec}`, ...status });
  }

  const { txid } = await sendPayout(body.data.toAddress, amountZec);
  await store.recordPlatformWithdrawal(amountZec, body.data.toAddress, txid ?? null);
  app.log.info(`[admin] platform-fee withdrawal: ${amountZec} ZEC -> ${body.data.toAddress} (txid ${txid})`);
  const after = await store.getPlatformFeeStatus();
  return reply.send({ ok: true, amountZec, toAddress: body.data.toAddress, txid, claimableBefore: status.claimableZec, claimableAfter: after.claimableZec });
});

// Brai, 2026-09-07: after a real sell failed with "insufficient balance"
// even though the token's own reserve looked like it should cover it --
// "no me gusta, ahi tenes que tener un chequeo". Every token shares ONE
// real wallet, so this sums what every token's ledger says is owed
// (reserve + creator fee + claimable platform fee) and compares it
// against the wallet's actual real balance, so a shortfall shows up here
// instead of only being discovered when someone's sell fails. Read-only,
// never moves funds or touches stored numbers.
app.get("/api/admin/financial-audit", async (req, reply) => {
  if (!ADMIN_TOKEN) return reply.code(503).send({ error: "ADMIN_TOKEN is not configured" });
  if (req.headers["x-admin-token"] !== ADMIN_TOKEN) return reply.code(401).send({ error: "unauthorized" });
  const audit = await store.getFinancialAudit();
  let realWalletZec: number | null = null;
  let shortfallZec: number | null = null;
  if (ZCASH_MODE === "real") {
    try {
      const status = await (zcashService as typeof import("./lib/zcashReal.js")).getWalletStatus();
      realWalletZec = status.zec;
      shortfallZec = audit.totalOwed - status.zec;
    } catch {
      // leave realWalletZec/shortfallZec null rather than fail the whole audit
    }
  }
  return reply.send({ ok: true, ...audit, realWalletZec, shortfallZec });
});

// Brai, 2026-09-07: "blanquea todos los tokens... que no se vean todos
// esos tokens de prueba" -- pre-launch cleanup. Deliberately NOT a delete
// (see Token.hidden's comment in schema.prisma): toggles the `hidden`
// flag so test tokens drop out of every public listing while their real
// ZEC history stays intact for the audit. Pass hidden:false to un-hide.
app.post("/api/admin/hide-tokens", async (req, reply) => {
  if (!ADMIN_TOKEN) return reply.code(503).send({ error: "ADMIN_TOKEN is not configured" });
  if (req.headers["x-admin-token"] !== ADMIN_TOKEN) return reply.code(401).send({ error: "unauthorized" });
  const body = z.object({ symbols: z.array(z.string()).min(1), hidden: z.boolean().default(true) }).safeParse(req.body);
  if (!body.success) return reply.code(400).send({ error: "expected { symbols: string[], hidden? }" });
  const result = await store.setTokensHidden(body.data.symbols, body.data.hidden);
  app.log.info(`[admin] set hidden=${body.data.hidden} for tokens: ${result.updated.join(", ")}${result.notFound.length ? ` (not found: ${result.notFound.join(", ")})` : ""}`);
  return reply.send({ ok: true, ...result, hidden: body.data.hidden });
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

// Brai, 2026-09-07: "chequeame que no entro una compra de 0.2 en el token
// zodd" -- when a buy's payment doesn't confirm as a FILLED trade, this is
// how to check whether the ZEC actually landed in the wallet anyway (see
// the big comment on generateOrderAddress/matching in zcashReal.ts: a note
// whose value doesn't exactly match any currently-watched order's amount
// just sits here, unclaimed, until an admin looks). Read-only, never moves
// funds -- cross-checks the wallet's real notes against every txid this
// backend already knows about (any completed buy, sell payout, token
// creation, or fee payout), so what's left is genuinely unaccounted for.
// Temporary diagnostic -- see DEBUG_NOTES_TOKEN above. Read-only, calls the
// wallet-service's own temporary debug route. Remove once answered.
app.get("/api/admin/notes-raw-debug", async (req, reply) => {
  if (ZCASH_MODE !== "real") return reply.code(404).send({ error: "not in real mode" });
  if (!DEBUG_NOTES_TOKEN) return reply.code(503).send({ error: "DEBUG_NOTES_TOKEN is not configured" });
  // Accepts the token via header OR query string -- the header alone can't
  // be sent by a plain URL fetch, and this is a temporary, read-only,
  // no-fund-risk diagnostic (see the comment above), so the slightly
  // weaker query-string option is fine for the short time this route
  // exists.
  const suppliedToken = req.headers["x-debug-token"] ?? (req.query as any)?.token;
  if (suppliedToken !== DEBUG_NOTES_TOKEN) return reply.code(401).send({ error: "unauthorized" });
  try {
    const raw = await (zcashService as typeof import("./lib/zcashReal.js")).rawNotesDebug();
    return reply.send(raw);
  } catch (err) {
    return reply.code(502).send({ error: String((err as Error).message ?? err) });
  }
});

// Temporary diagnostic -- see DEBUG_NOTES_TOKEN above / rawHelpDebug in
// zcashReal.ts. Remove once answered.
app.get("/api/admin/help-raw-debug", async (req, reply) => {
  if (ZCASH_MODE !== "real") return reply.code(404).send({ error: "not in real mode" });
  if (!DEBUG_NOTES_TOKEN) return reply.code(503).send({ error: "DEBUG_NOTES_TOKEN is not configured" });
  const suppliedToken = req.headers["x-debug-token"] ?? (req.query as any)?.token;
  if (suppliedToken !== DEBUG_NOTES_TOKEN) return reply.code(401).send({ error: "unauthorized" });
  try {
    const raw = await (zcashService as typeof import("./lib/zcashReal.js")).rawHelpDebug();
    return reply.send(raw);
  } catch (err) {
    return reply.code(502).send({ error: String((err as Error).message ?? err) });
  }
});

// Temporary diagnostics -- see DEBUG_NOTES_TOKEN above. Remove once
// answered.
app.get("/api/admin/value-transfers-raw-debug", async (req, reply) => {
  if (ZCASH_MODE !== "real") return reply.code(404).send({ error: "not in real mode" });
  if (!DEBUG_NOTES_TOKEN) return reply.code(503).send({ error: "DEBUG_NOTES_TOKEN is not configured" });
  const suppliedToken = req.headers["x-debug-token"] ?? (req.query as any)?.token;
  if (suppliedToken !== DEBUG_NOTES_TOKEN) return reply.code(401).send({ error: "unauthorized" });
  try {
    const raw = await (zcashService as typeof import("./lib/zcashReal.js")).rawValueTransfersDebug();
    return reply.send(raw);
  } catch (err) {
    return reply.code(502).send({ error: String((err as Error).message ?? err) });
  }
});

app.get("/api/admin/value-to-address-help-raw-debug", async (req, reply) => {
  if (ZCASH_MODE !== "real") return reply.code(404).send({ error: "not in real mode" });
  if (!DEBUG_NOTES_TOKEN) return reply.code(503).send({ error: "DEBUG_NOTES_TOKEN is not configured" });
  const suppliedToken = req.headers["x-debug-token"] ?? (req.query as any)?.token;
  if (suppliedToken !== DEBUG_NOTES_TOKEN) return reply.code(401).send({ error: "unauthorized" });
  try {
    const raw = await (zcashService as typeof import("./lib/zcashReal.js")).rawValueToAddressHelpDebug();
    return reply.send(raw);
  } catch (err) {
    return reply.code(502).send({ error: String((err as Error).message ?? err) });
  }
});

app.get("/api/admin/addresses-raw-debug", async (req, reply) => {
  if (ZCASH_MODE !== "real") return reply.code(404).send({ error: "not in real mode" });
  if (!DEBUG_NOTES_TOKEN) return reply.code(503).send({ error: "DEBUG_NOTES_TOKEN is not configured" });
  const suppliedToken = req.headers["x-debug-token"] ?? (req.query as any)?.token;
  if (suppliedToken !== DEBUG_NOTES_TOKEN) return reply.code(401).send({ error: "unauthorized" });
  try {
    const raw = await (zcashService as typeof import("./lib/zcashReal.js")).rawAddressesDebug();
    return reply.send(raw);
  } catch (err) {
    return reply.code(502).send({ error: String((err as Error).message ?? err) });
  }
});

// ZODD (2026-09-08): the deployed zingo-cli's `addresses`/`notes` output is
// missing the new diversifier fields even though the Railway build log for
// that exact deploy shows the patch applying and cargo build finishing with
// no errors -- and a from-scratch local build of the identical pinned
// commit + identical patch + identical build flags DOES produce them. This
// reports the actual running binary's mtime/size (does it look freshly
// written by that build?) and its own --version output, to settle whether
// this is really the built binary or something is serving a stale one.
// Temporary, remove together with the rest of this diagnostic batch.
app.get("/api/admin/binary-info-debug", async (req, reply) => {
  if (ZCASH_MODE !== "real") return reply.code(404).send({ error: "not in real mode" });
  if (!DEBUG_NOTES_TOKEN) return reply.code(503).send({ error: "DEBUG_NOTES_TOKEN is not configured" });
  const suppliedToken = req.headers["x-debug-token"] ?? (req.query as any)?.token;
  if (suppliedToken !== DEBUG_NOTES_TOKEN) return reply.code(401).send({ error: "unauthorized" });
  try {
    const raw = await (zcashService as typeof import("./lib/zcashReal.js")).rawBinaryInfoDebug();
    return reply.send(raw);
  } catch (err) {
    return reply.code(502).send({ error: String((err as Error).message ?? err) });
  }
});

// ZODD (2026-09-08): binary-info-debug confirmed the running zingo-cli
// binary is genuinely fresh from the correctly-patched build (its mtime
// matches that build's own "Finished release profile" log line to the
// second) -- yet `addresses` on this real wallet still shows no
// diversifier fields, while the identical binary against a brand-new
// throwaway wallet (tested locally) does. This mints one real address on
// THIS wallet (same call a real order makes) to see whether it's
// specifically old/pre-existing addresses that lack the fields, or
// whether this real wallet's state is affected regardless of address age.
// Temporary, remove together with the rest of this diagnostic batch.
app.get("/api/admin/new-address-raw-debug", async (req, reply) => {
  if (ZCASH_MODE !== "real") return reply.code(404).send({ error: "not in real mode" });
  if (!DEBUG_NOTES_TOKEN) return reply.code(503).send({ error: "DEBUG_NOTES_TOKEN is not configured" });
  const suppliedToken = req.headers["x-debug-token"] ?? (req.query as any)?.token;
  if (suppliedToken !== DEBUG_NOTES_TOKEN) return reply.code(401).send({ error: "unauthorized" });
  try {
    const raw = await (zcashService as typeof import("./lib/zcashReal.js")).rawNewAddressDebug();
    return reply.send(raw);
  } catch (err) {
    return reply.code(502).send({ error: String((err as Error).message ?? err) });
  }
});

app.get("/api/admin/value-to-address-raw-debug", async (req, reply) => {
  if (ZCASH_MODE !== "real") return reply.code(404).send({ error: "not in real mode" });
  if (!DEBUG_NOTES_TOKEN) return reply.code(503).send({ error: "DEBUG_NOTES_TOKEN is not configured" });
  const suppliedToken = req.headers["x-debug-token"] ?? (req.query as any)?.token;
  if (suppliedToken !== DEBUG_NOTES_TOKEN) return reply.code(401).send({ error: "unauthorized" });
  const address = (req.query as any)?.address;
  if (!address) return reply.code(400).send({ error: "address query param required" });
  try {
    const raw = await (zcashService as typeof import("./lib/zcashReal.js")).rawValueToAddressDebug(address);
    return reply.send(raw);
  } catch (err) {
    return reply.code(502).send({ error: String((err as Error).message ?? err) });
  }
});

// Same as above but takes an address_index (from /api/admin/addresses-raw-debug)
// instead of the full address string -- added because the WebFetch tool's
// own proxy rejected the long raw-address version with a 403, and this
// avoids putting a ~180-char string in a query param. Temporary, remove
// together with the rest of this diagnostic batch.
app.get("/api/admin/value-to-address-by-index-debug", async (req, reply) => {
  if (ZCASH_MODE !== "real") return reply.code(404).send({ error: "not in real mode" });
  if (!DEBUG_NOTES_TOKEN) return reply.code(503).send({ error: "DEBUG_NOTES_TOKEN is not configured" });
  const suppliedToken = req.headers["x-debug-token"] ?? (req.query as any)?.token;
  if (suppliedToken !== DEBUG_NOTES_TOKEN) return reply.code(401).send({ error: "unauthorized" });
  const indexRaw = (req.query as any)?.index;
  if (indexRaw === undefined) return reply.code(400).send({ error: "index query param required" });
  const index = Number(indexRaw);
  try {
    const addrRaw = await (zcashService as typeof import("./lib/zcashReal.js")).rawAddressesDebug();
    const list = (addrRaw as any)?.addresses ?? addrRaw;
    const entry = Array.isArray(list) ? list[index] : undefined;
    if (!entry) return reply.code(404).send({ error: "no address at that index", indexTried: index, count: Array.isArray(list) ? list.length : null });
    const address = entry.encoded_address ?? entry.address ?? entry.unified_address ?? entry;
    const raw = await (zcashService as typeof import("./lib/zcashReal.js")).rawValueToAddressDebug(address);
    return reply.send({ addressUsed: address, index, raw });
  } catch (err) {
    return reply.code(502).send({ error: String((err as Error).message ?? err) });
  }
});

app.get("/api/admin/unclaimed-notes", async (req, reply) => {
  if (ZCASH_MODE !== "real") return reply.code(404).send({ error: "not in real mode" });
  if (!ADMIN_TOKEN) return reply.code(503).send({ error: "ADMIN_TOKEN is not configured" });
  if (req.headers["x-admin-token"] !== ADMIN_TOKEN) return reply.code(401).send({ error: "unauthorized" });
  try {
    const known = await store.getAllKnownPaymentTxids();
    const notes = await (zcashService as typeof import("./lib/zcashReal.js")).listUnclaimedNotes(known);
    return reply.send({ ok: true, count: notes.length, notes });
  } catch (err) {
    return reply.code(502).send({ error: String((err as Error).message ?? err) });
  }
});

// Brai (2026-09-07): "revisa A FONDO esto no puede pasar" -- forensics
// companion to /api/admin/unclaimed-notes: given a ZEC amount, finds the
// actual BUY order row(s) it was meant for (any status), so an unclaimed
// note's timing/amount can be compared against what the order actually
// expected and when it was created/expired. Read-only.
const orderLookupSchema = z.object({
  amount: z.coerce.number().positive(),
  tolerance: z.coerce.number().positive().optional(),
});
app.get("/api/admin/orders-by-amount", async (req, reply) => {
  if (!ADMIN_TOKEN) return reply.code(503).send({ error: "ADMIN_TOKEN is not configured" });
  if (req.headers["x-admin-token"] !== ADMIN_TOKEN) return reply.code(401).send({ error: "unauthorized" });
  try {
    const q = orderLookupSchema.parse(req.query);
    const [orders, tokenCreations] = await Promise.all([
      store.findOrdersNearAmount(q.amount, q.tolerance ?? 0.001),
      store.findTokenCreationsNearAmount(q.amount, q.tolerance ?? 0.001),
    ]);
    return reply.send({ ok: true, count: orders.length, orders, tokenCreationCount: tokenCreations.length, tokenCreations });
  } catch (err) {
    return reply.code(400).send({ error: String((err as Error).message ?? err) });
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
