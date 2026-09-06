import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const BIN = "/usr/local/bin/zingo-cli";
const DATA_DIR = process.env.WALLET_DATA_DIR ?? "/data";
const SERVER = process.env.ZCASH_LIGHTWALLETD_SERVER ?? "https://zec.rocks:443";
const WALLET_FILE = `${DATA_DIR}/zingo-wallet.dat`;

// Longest we'll let a single zingo-cli invocation run before giving up --
// a stuck sync should surface as an error, not hang the API forever.
const CLI_TIMEOUT_MS = 120_000;

async function runCli(args, { timeout = CLI_TIMEOUT_MS } = {}) {
  const fullArgs = ["--data-dir", DATA_DIR, "--server", SERVER, ...args];
  try {
    const { stdout, stderr } = await execFileP(BIN, fullArgs, { timeout, maxBuffer: 16 * 1024 * 1024 });
    if (stderr?.trim()) console.error(`[zingo-cli stderr] ${stderr.trim()}`);
    return stdout.trim();
  } catch (err) {
    // Surface stdout/stderr even on non-zero exit -- zingo-cli sometimes
    // prints the useful error message there rather than throwing cleanly.
    const detail = [err.stdout, err.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`zingo-cli ${args[0]} failed: ${detail || err.message}`);
  }
}

/** Best-effort parse: zingo-cli's own docs say some commands print JSON and
 * others print human text. Never assume -- try JSON, fall back to raw. */
function parseMaybeJson(text) {
  try {
    return { json: JSON.parse(text), raw: text };
  } catch {
    return { json: null, raw: text };
  }
}

/** Runs once at boot. If no wallet file exists yet in the mounted volume,
 * this is a brand-new deploy of this service and it must be restored from
 * the seed the operator put in ZCASH_WALLET_SEED. If the wallet file is
 * already there (persisted volume from a previous deploy), we never touch
 * the seed env var again -- the CLI just loads the existing wallet.dat. */
export async function ensureWalletReady() {
  if (existsSync(WALLET_FILE)) {
    console.log("[zcash-wallet-service] existing wallet found, loading it");
    const out = await runCli(["height"], { timeout: 180_000 });
    console.log(`[zcash-wallet-service] wallet loaded, chain height: ${out}`);
    return;
  }

  const seed = process.env.ZCASH_WALLET_SEED;
  if (!seed) {
    throw new Error(
      "No wallet file in the data volume and ZCASH_WALLET_SEED is not set. " +
        "Set ZCASH_WALLET_SEED (the 24-word seed from the Zingo! wallet made for this platform) " +
        "as an environment variable on THIS service, then redeploy."
    );
  }
  const birthday = process.env.ZCASH_WALLET_BIRTHDAY; // optional: block height at wallet creation, speeds up first sync
  console.log("[zcash-wallet-service] no wallet file found -- restoring from ZCASH_WALLET_SEED (first boot only)");
  const args = ["--seed", seed];
  if (birthday) args.push("--birthday", birthday);
  args.push("height");
  await runCli(args, { timeout: 20 * 60_000 }); // first sync from a birthday can take a while
  console.log("[zcash-wallet-service] wallet restored and synced for the first time");
}

export async function newAddress() {
  const out = await runCli(["new_address", "oz"], { timeout: 30_000 });
  const { json, raw } = parseMaybeJson(out);
  // Docs show new_address returning the created address, possibly as a
  // JSON array/object -- handle both shapes defensively.
  const address = Array.isArray(json) ? json[0] : json?.address ?? raw.replace(/["[\]]/g, "").trim();
  if (!address || !address.startsWith("u1")) {
    throw new Error(`unexpected new_address output, needs a look: ${raw}`);
  }
  return address;
}

export async function spendableBalanceZatoshis() {
  const out = await runCli(["spendable_balance"], { timeout: 60_000 });
  const { json, raw } = parseMaybeJson(out);
  const value = json?.spendable_balance ?? json;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`unexpected spendable_balance output, needs a look: ${raw}`);
  return n;
}

export async function heightInfo() {
  const out = await runCli(["height"], { timeout: 30_000 });
  return parseMaybeJson(out);
}

/** Filters messages/value transfers received at a specific address -- this
 * is how we detect a buy order's payment landing, since every order gets
 * its own one-time address (see docs/ARCHITECTURE.md). */
export async function messagesFor(address) {
  const out = await runCli(["messages", address], { timeout: 60_000 });
  const { json, raw } = parseMaybeJson(out);
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.messages)) return json.messages;
  // Unknown shape -- return nothing rather than guessing, but log so this
  // gets fixed the first time it's exercised against the real server.
  console.error(`[zcash-wallet-service] unrecognized messages() output, needs a look: ${raw}`);
  return [];
}

const MAX_MEMO_BYTES = 512; // Zcash shielded memo field hard limit

/** Sends real ZEC. `memo` is optional (used for the token-creation
 * inscription; omitted for ordinary sell payouts). Enforces a hard cap
 * from ZCASH_MAX_ZATOSHIS_PER_SEND as defense in depth even though the
 * backend is expected to enforce its own per-order limit too. */
export async function send(address, zatoshis, memo = "") {
  if (Buffer.byteLength(memo, "utf8") > MAX_MEMO_BYTES) {
    throw new Error(`memo too long (${Buffer.byteLength(memo, "utf8")} bytes, max ${MAX_MEMO_BYTES})`);
  }
  const cap = Number(process.env.ZCASH_MAX_ZATOSHIS_PER_SEND ?? Infinity);
  if (zatoshis > cap) {
    throw new Error(`refusing to send ${zatoshis} zatoshis: exceeds this service's safety cap of ${cap}`);
  }
  const out = await runCli(["quicksend", address, String(zatoshis), memo], { timeout: 120_000 });
  const { json, raw } = parseMaybeJson(out);
  const txid = json?.txid ?? (Array.isArray(json) ? json[0]?.txid : null) ?? extractTxidFromText(raw);
  if (!txid) throw new Error(`quicksend succeeded but couldn't find a txid in output, needs a look: ${raw}`);
  return { txid };
}

function extractTxidFromText(text) {
  const m = text.match(/[0-9a-f]{64}/i);
  return m?.[0] ?? null;
}
