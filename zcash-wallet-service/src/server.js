import Fastify from "fastify";
import * as cli from "./cli.js";

const app = Fastify({ logger: true });

let ready = false;
let readyError = null;

// Internal service only -- no public domain is generated for this one on
// Railway, and it should only ever be reachable from the backend service
// over the project's private network (http://zcash-wallet.railway.internal:PORT).
// As a second line of defense, require a shared secret header so a
// misconfigured network boundary can't turn into a way to move real ZEC.
const INTERNAL_TOKEN = process.env.INTERNAL_SERVICE_TOKEN;
if (!INTERNAL_TOKEN) {
  app.log.error("INTERNAL_SERVICE_TOKEN is not set -- refusing to start. This service moves real money and must not be reachable without a shared secret.");
  process.exit(1);
}

app.addHook("onRequest", async (req, reply) => {
  if (req.url === "/health") return; // health checks don't carry the secret
  if (req.headers["x-internal-token"] !== INTERNAL_TOKEN) {
    reply.code(401).send({ error: "unauthorized" });
  }
});

app.get("/health", async (_req, reply) => {
  return reply.send({ ok: true, walletReady: ready, error: readyError });
});

app.post("/wallet/address", async (_req, reply) => {
  if (!ready) return reply.code(503).send({ error: "wallet not ready yet", detail: readyError });
  try {
    const address = await cli.newAddress();
    return reply.send({ address });
  } catch (err) {
    app.log.error(err);
    return reply.code(500).send({ error: String(err.message ?? err) });
  }
});

app.get("/wallet/balance", async (_req, reply) => {
  if (!ready) return reply.code(503).send({ error: "wallet not ready yet", detail: readyError });
  try {
    const zatoshis = await cli.spendableBalanceZatoshis();
    return reply.send({ zatoshis });
  } catch (err) {
    app.log.error(err);
    return reply.code(500).send({ error: String(err.message ?? err) });
  }
});

app.get("/wallet/height", async (_req, reply) => {
  try {
    const info = await cli.heightInfo();
    return reply.send(info);
  } catch (err) {
    app.log.error(err);
    return reply.code(500).send({ error: String(err.message ?? err) });
  }
});

app.get("/wallet/messages", async (req, reply) => {
  if (!ready) return reply.code(503).send({ error: "wallet not ready yet", detail: readyError });
  const { address } = req.query;
  if (!address) return reply.code(400).send({ error: "address query param is required" });
  try {
    const messages = await cli.messagesFor(address);
    return reply.send({ messages });
  } catch (err) {
    app.log.error(err);
    return reply.code(500).send({ error: String(err.message ?? err) });
  }
});

app.post("/wallet/send", async (req, reply) => {
  if (!ready) return reply.code(503).send({ error: "wallet not ready yet", detail: readyError });
  const { address, zatoshis, memo } = req.body ?? {};
  if (!address || !Number.isInteger(zatoshis) || zatoshis <= 0) {
    return reply.code(400).send({ error: "address and a positive integer zatoshis are required" });
  }
  try {
    const result = await cli.send(address, zatoshis, memo ?? "");
    app.log.info(`sent ${zatoshis} zatoshis to ${address}, txid ${result.txid}`);
    return reply.send(result);
  } catch (err) {
    app.log.error(err);
    return reply.code(500).send({ error: String(err.message ?? err) });
  }
});

const port = Number(process.env.PORT ?? 8080);

app.listen({ port, host: "0.0.0.0" }).then(async () => {
  app.log.info(`zcash-wallet-service listening on :${port}`);
  try {
    await cli.ensureWalletReady();
    ready = true;
    app.log.info("wallet is ready");
  } catch (err) {
    readyError = String(err.message ?? err);
    app.log.error(`wallet failed to initialize: ${readyError}`);
    // Keep the HTTP server up (so /health reports the error clearly instead
    // of the whole service being unreachable/crash-looping) but every
    // wallet-touching route stays 503 until this is fixed and redeployed.
  }
});
