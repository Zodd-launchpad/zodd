import { execFile } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const BIN = "/usr/local/bin/zingo-cli";
const DATA_DIR = process.env.WALLET_DATA_DIR ?? "/data";
const SERVER = process.env.ZCASH_LIGHTWALLETD_SERVER ?? "https://zec.rocks:443";
const WALLET_FILE = `${DATA_DIR}/zingo-wallet.dat`;

// Longest we'll let a single zingo-cli invocation run before giving up --
// a stuck sync should surface as an error, not hang the API forever.
const CLI_TIMEOUT_MS = 120_000;

// Every API route (balance, height, addresses, messages, send) spawns its
// own zingo-cli process against the SAME wallet.dat file. Two of those
// landing at once -- e.g. the admin status route, which used to fire
// balance/height/addresses concurrently via Promise.all -- were racing on
// that file. This is exactly the "Known remaining risk" flagged in
// docs/REAL_MODE_SETUP.md, and it turned out to already be happening: the
// status route was consistently reading back a stale, long-stuck height
// (and a 0 balance) even on builds that, run alone, correctly reported a
// current, advancing height at boot. Fix: force every zingo-cli invocation
// through this single in-process queue so only one ever touches the wallet
// file at a time, no matter how many HTTP requests land concurrently.
let cliQueue = Promise.resolve();

function runCli(args, opts = {}) {
  const run = () => runCliExclusive(args, opts);
  const result = cliQueue.then(run, run);
  // Keep the chain alive even if this call failed -- one failed command
  // must not permanently jam every call after it.
  cliQueue = result.then(
    () => {},
    () => {}
  );
  return result;
}

async function runCliExclusive(args, { timeout = CLI_TIMEOUT_MS, waitsync = false } = {}) {
  // IMPORTANT: zingo-cli does NOT sync before running a one-shot command by
  // default -- it fires the command against whatever state the wallet
  // already has and exits. Without --waitsync, balance/messages/height are
  // stale (this is exactly the bug that made a real, confirmed deposit
  // show up as a 0 balance). Any read that needs the current chain state,
  // or any spend, must pass waitsync: true.
  const fullArgs = ["--data-dir", DATA_DIR, "--server", SERVER, ...(waitsync ? ["--waitsync"] : []), ...args];
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

/** Deletes everything in the persistent data volume so the next boot treats
 * this as a brand-new deploy and restores fresh from ZCASH_WALLET_SEED,
 * instead of resuming from a possibly-stale/corrupted wallet.dat. Only ever
 * called when the operator explicitly opts in via ZCASH_FORCE_REWALLET=true
 * (see server.js) -- this does not touch the seed itself (that lives only
 * in the env var), it only clears locally-cached/synced chain state. */
export function wipeWalletData() {
  if (!existsSync(DATA_DIR)) return;
  const entries = readdirSync(DATA_DIR);
  for (const entry of entries) {
    rmSync(`${DATA_DIR}/${entry}`, { recursive: true, force: true });
  }
  console.log(`[zcash-wallet-service] wiped ${entries.length} entr${entries.length === 1 ? "y" : "ies"} from ${DATA_DIR}: ${entries.join(", ") || "(empty)"}`);
}

/** Runs once at boot. If no wallet file exists yet in the mounted volume,
 * this is a brand-new deploy of this service and it must be restored from
 * the seed the operator put in ZCASH_WALLET_SEED. If the wallet file is
 * already there (persisted volume from a previous deploy), we never touch
 * the seed env var again -- the CLI just loads the existing wallet.dat. */
export async function ensureWalletReady() {
  if (existsSync(WALLET_FILE)) {
    console.log("[zcash-wallet-service] existing wallet found, loading it");
    const out = await runCli(["height"], { timeout: 10 * 60_000, waitsync: true });
    console.log(`[zcash-wallet-service] wallet loaded and synced, chain height: ${out}`);
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
  await runCli(args, { timeout: 20 * 60_000, waitsync: true }); // first sync from a birthday can take a while
  console.log("[zcash-wallet-service] wallet restored and synced for the first time");
}

export async function newAddress() {
  const out = await runCli(["new_address", "oz"], { timeout: 30_000 });
  const { json, raw } = parseMaybeJson(out);
  // Confirmed live (2026-09-06) against this build: new_address returns a
  // JSON object shaped like { account, address_index, has_orchard,
  // has_sapling, has_transparent, encoded_address } -- the address itself
  // is under `encoded_address`, not `address` as we originally guessed
  // (that guess is what made every real token-creation attempt fail with
  // "unexpected new_address output"). Still handled defensively in case a
  // future build reverts to a bare array or a plain `address` key.
  const address = Array.isArray(json) ? json[0] : json?.encoded_address ?? json?.address ?? raw.replace(/["[\]]/g, "").trim();
  if (!address || !address.startsWith("u1")) {
    throw new Error(`unexpected new_address output, needs a look: ${raw}`);
  }
  return address;
}

export async function spendableBalanceZatoshis() {
  const out = await runCli(["spendable_balance"], { timeout: 3 * 60_000, waitsync: true });
  const { json, raw } = parseMaybeJson(out);
  const value = json?.spendable_balance ?? json;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`unexpected spendable_balance output, needs a look: ${raw}`);
  return n;
}

/** Lists this wallet's existing receiving addresses (the same ones Zingo!
 * shows) -- used only for a one-time sanity check ("did you send to the
 * right address"), never for generating a fresh order address. */
export async function listAddresses() {
  const out = await runCli(["addresses"], { timeout: 30_000 });
  const { json, raw } = parseMaybeJson(out);
  return json ?? raw;
}

export async function heightInfo() {
  const out = await runCli(["height"], { timeout: 3 * 60_000, waitsync: true });
  return parseMaybeJson(out);
}

/** Filters messages/value transfers received at a specific address -- this
 * is how we detect a buy order's payment landing, since every order gets
 * its own one-time address (see docs/ARCHITECTURE.md). Needs waitsync: true,
 * otherwise a payment that just confirmed on-chain won't show up here yet. */
export async function messagesFor(address) {
  const out = await runCli(["messages", address], { timeout: 3 * 60_000, waitsync: true });
  const { json, raw } = parseMaybeJson(out);
  // The real zingo-cli (confirmed live 2026-09-06) wraps entries as
  // { "value_transfers": [...] }, not a bare array or { messages: [...] }
  // like we originally guessed defensively -- same class of bug as the
  // encoded_address/address mismatch in newAddress().
  const list = Array.isArray(json)
    ? json
    : Array.isArray(json?.messages)
      ? json.messages
      : Array.isArray(json?.value_transfers)
        ? json.value_transfers
        : null;
  if (list === null) {
    console.error(`[zcash-wallet-service] unrecognized messages() output, needs a look: ${raw}`);
    return [];
  }
  if (list.length > 0) {
    // zingolib's exact field names per entry aren't pinned down on our side
    // yet -- log the raw shape once so a mismatch in the backend's own
    // matching logic (zcashReal.ts) can be caught and fixed fast.
    console.error(`[zcash-wallet-service] messagesFor(${address}) got ${list.length} entrie(s): ${JSON.stringify(list)}`);
  }
  return list;
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
  const out = await runCli(["quicksend", address, String(zatoshis), memo], { timeout: 3 * 60_000, waitsync: true });
  const { json, raw } = parseMaybeJson(out);
  const txid = json?.txid ?? (Array.isArray(json) ? json[0]?.txid : null) ?? extractTxidFromText(raw);
  if (!txid) throw new Error(`quicksend succeeded but couldn't find a txid in output, needs a look: ${raw}`);
  return { txid };
}

function extractTxidFromText(text) {
  const m = text.match(/[0-9a-f]{64}/i);
  return m?.[0] ?? null;
}
