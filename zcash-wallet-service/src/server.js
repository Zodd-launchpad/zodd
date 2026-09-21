import Fastify from "fastify";
import * as cli from "./cli.js";

const app = Fastify({ logger: true });

let ready = false;
let readyError = null;

// Brai, 2026-09-21: "q habia pasado? soluciona q no vuelva a pasar" -- a
// user's sell failed because this wallet's local sync cache (the
// "shard tree" zingo-cli keeps in wallet.dat) got corrupted mid-run, most
// likely from a lightwalletd reorg/inconsistency during a routine sync --
// not a bug in our own code and not a loss of funds, but EVERY request
// kept failing the exact same way for 18+ minutes until I happened to go
// looking at the logs by hand. There was no way for the service itself to
// notice and recover on its own. This is the fix: any route that hits
// this exact error signature (cli.isShardTreeCorruption) now triggers an
// automatic wipe-and-resync from ZCASH_WALLET_SEED in the background --
// same recovery I did by hand via ZCASH_FORCE_REWALLET, just no longer
// requiring a human to notice first. A cooldown stops it from wiping in a
// tight loop if something keeps re-corrupting the cache; a periodic
// background probe (see the setInterval below) also catches this during a
// quiet stretch with no real traffic, instead of waiting for a paying
// user's request to be the one that fails.
let healing = false;
let lastHealAt = 0;
const HEAL_COOLDOWN_MS = 5 * 60_000;

function maybeAutoHeal(err) {
  if (!cli.isShardTreeCorruption(err)) return;
  if (healing) return; // a heal is already running -- don't start a second one
  const sinceLastHeal = Date.now() - lastHealAt;
  if (lastHealAt && sinceLastHeal < HEAL_COOLDOWN_MS) {
    app.log.error(
      `[auto-heal] shard-tree corruption seen again ${Math.round(sinceLastHeal / 1000)}s after the last heal (cooldown is ${HEAL_COOLDOWN_MS / 1000}s) -- not re-wiping yet, this needs a human look if it keeps happening`
    );
    return;
  }
  healing = true;
  lastHealAt = Date.now();
  ready = false;
  readyError = "wallet cache corrupted (shard tree error) -- auto-healing: wiping and resyncing from seed";
  app.log.error(`[auto-heal] detected known shard-tree corruption -- wiping wallet cache and resyncing from seed. Trigger: ${err.message ?? err}`);
  (async () => {
    try {
      cli.wipeWalletData();
      await cli.ensureWalletReady();
      ready = true;
      readyError = null;
      app.log.info("[auto-heal] wallet resynced successfully, service back online");
    } catch (err2) {
      readyError = String(err2.message ?? err2);
      app.log.error(`[auto-heal] resync attempt itself failed: ${readyError} -- staying down, needs a manual look`);
    } finally {
      healing = false;
    }
  })();
}

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

// ZODD (2026-09-20): a deploy of this same image can be run as a
// parallel "address-only" worker -- restored from the SAME
// ZCASH_WALLET_SEED but with its own data volume, used only to multiply
// how fast the backend can mint fresh receiving addresses during a burst
// (an NFT mint drop). Set on those deploys only. Generating an address
// needs no balance and touches no funds, so ADDRESS_ONLY_MODE is a hard,
// physical guarantee -- not just a convention -- that this particular
// process can never move money: /wallet/send refuses unconditionally
// below, regardless of what calls it or why. The main zcash-wallet-service
// deploy (the one with real balance/send/payment-detection) must NEVER
// have this set.
const ADDRESS_ONLY_MODE = process.env.ADDRESS_ONLY_MODE === "true";
if (ADDRESS_ONLY_MODE) {
  app.log.warn("ADDRESS_ONLY_MODE=true -- this worker will refuse every /wallet/send request, by design");
}

app.get("/health", async (_req, reply) => {
  return reply.send({ ok: true, walletReady: ready, error: readyError });
});

app.post("/wallet/address", async (_req, reply) => {
  if (!ready) return reply.code(503).send({ error: "wallet not ready yet", detail: readyError });
  try {
    const { address, saplingDiversifierHex, orchardDiversifierHex } = await cli.newAddress();
    return reply.send({ address, saplingDiversifierHex, orchardDiversifierHex });
  } catch (err) {
    app.log.error(err);
    maybeAutoHeal(err);
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
    maybeAutoHeal(err);
    return reply.code(500).send({ error: String(err.message ?? err) });
  }
});

app.get("/wallet/addresses", async (_req, reply) => {
  if (!ready) return reply.code(503).send({ error: "wallet not ready yet", detail: readyError });
  try {
    const addresses = await cli.listAddresses();
    return reply.send({ addresses });
  } catch (err) {
    app.log.error(err);
    maybeAutoHeal(err);
    return reply.code(500).send({ error: String(err.message ?? err) });
  }
});

app.get("/wallet/height", async (_req, reply) => {
  try {
    const info = await cli.heightInfo();
    return reply.send(info);
  } catch (err) {
    app.log.error(err);
    maybeAutoHeal(err);
    return reply.code(500).send({ error: String(err.message ?? err) });
  }
});

// Replaces the old address-scoped /wallet/messages: zingo-cli's `messages`
// command doesn't track incoming deposits at all (only transfers this
// wallet itself sent -- see the long comment on cli.unspentNotes), and its
// `notes` command -- which DOES show deposits -- carries no per-address
// info to filter by. So this returns every unspent note this wallet holds,
// unfiltered, and the backend matches them against its own pending orders
// by amount (see zcashReal.ts).
app.get("/wallet/notes", async (_req, reply) => {
  if (!ready) return reply.code(503).send({ error: "wallet not ready yet", detail: readyError });
  try {
    const notes = await cli.unspentNotes();
    return reply.send({ notes });
  } catch (err) {
    app.log.error(err);
    maybeAutoHeal(err);
    return reply.code(500).send({ error: String(err.message ?? err) });
  }
});

app.post("/wallet/send", async (req, reply) => {
  if (ADDRESS_ONLY_MODE) {
    return reply.code(403).send({ error: "this worker is ADDRESS_ONLY_MODE=true and is not allowed to send funds" });
  }
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
    maybeAutoHeal(err);
    return reply.code(500).send({ error: String(err.message ?? err) });
  }
});

const port = Number(process.env.PORT ?? 8080);

app.listen({ port, host: "0.0.0.0" }).then(async () => {
  app.log.info(`zcash-wallet-service listening on :${port}`);
  try {
    // Explicit, opt-in escape hatch: after several partial/failed syncs
    // across different zingo-cli builds today, the persisted wallet.dat may
    // have been left in a stale or inconsistent state (chain height reads
    // that inexplicably went backwards between calls). Setting this env var
    // wipes the data volume so this boot restores fresh from
    // ZCASH_WALLET_SEED instead of resuming from that questionable state.
    // Remove the env var again after one successful redeploy with it set --
    // it is NOT meant to stay on (every boot would re-sync from scratch).
    if (process.env.ZCASH_FORCE_REWALLET === "true") {
      app.log.warn("ZCASH_FORCE_REWALLET=true -- wiping wallet data volume before restoring from seed");
      cli.wipeWalletData();
    }
    await cli.ensureWalletReady();
    ready = true;
    app.log.info("wallet is ready");
  } catch (err) {
    readyError = String(err.message ?? err);
    app.log.error(`wallet failed to initialize: ${readyError}`);
    // Keep the HTTP server up (so /health reports the error clearly instead
    // of the whole service being unreachable/crash-looping) but every
    // wallet-touching route stays 503 until this is fixed and redeployed --
    // unless this is the known shard-tree corruption, in which case
    // maybeAutoHeal (see comment above it) wipes and retries on its own.
    maybeAutoHeal(err);
  }

  // Brai, 2026-09-21: the incident that prompted all of the above happened
  // mid-run, 13 days into this service's uptime, with no restart or real
  // request anywhere near when the corruption set in -- boot-time recovery
  // alone wouldn't have caught it, and nothing was polling this service to
  // notice early either. This periodic probe is what would have: a cheap
  // read every 5 minutes so a corrupted sync cache gets caught (and
  // auto-healed) during a quiet stretch, instead of waiting for the first
  // paying user's request to be the one that fails.
  setInterval(async () => {
    if (!ready || healing) return;
    try {
      await cli.heightInfo();
    } catch (err) {
      app.log.error(`[health-probe] periodic wallet check failed: ${String(err.message ?? err)}`);
      maybeAutoHeal(err);
    }
  }, 5 * 60_000).unref();
});
