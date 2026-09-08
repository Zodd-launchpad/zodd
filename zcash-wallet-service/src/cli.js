import { execFile } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
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

// ZODD (2026-09-08): now returns the new address's OWN diversifier
// alongside it -- the real per-order match key. This is only present on a
// zingo-cli built from zingolib-patches/0001-per-address-payment-diversifier.patch
// (see that patch and the Dockerfile); an unpatched build simply omits
// these two fields, which callers must treat as optional (see
// generateOrderAddress in backend/src/lib/zcashReal.ts -- it falls back to
// memo/amount matching for any order that doesn't have them).
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
  const obj = Array.isArray(json) ? null : json;
  return {
    address,
    saplingDiversifierHex: typeof obj?.sapling_diversifier_hex === "string" ? obj.sapling_diversifier_hex : null,
    orchardDiversifierHex: typeof obj?.orchard_diversifier_hex === "string" ? obj.orchard_diversifier_hex : null,
  };
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

/** History of how payment detection got here (2026-09-07), kept because the
 * next person touching this will hit the same dead ends otherwise:
 *   1. `messages <address>` always returned an empty value_transfers list,
 *      even once the wallet's balance had genuinely gone up by the expected
 *      amount -- per-diversified-address filtering on that subcommand
 *      doesn't work.
 *   2. Dropping the address and calling bare `messages` "to get everything"
 *      ALSO came back empty (`{"value_transfers": []}`) even though
 *      spendable_balance was confirmed nonzero and included two real
 *      incoming payments. Confirmed live: `messages`/value_transfers only
 *      tracks transfers this wallet itself initiated via send/quicksend --
 *      not arbitrary deposits received from outside, which is exactly what
 *      every buy order and token-creation-fee payment is.
 *   3. `notes` DOES list incoming deposits (confirmed live: it showed the
 *      wallet's baseline note plus both real 0.0001 ZEC test payments, exact
 *      zatoshi amounts, matching the balance). But its note_summaries carry
 *      no receiving-address field at all -- only value, status ("confirmed
 *      at block height N"), spend_status, memo, time, txid, output_index,
 *      account_id (always 0 so far), scope. So per-order matching can't be
 *      done by address here either; it has to be done by AMOUNT, in the
 *      backend, against its own set of pending orders (see zcashReal.ts). */
// Brai, 2026-09-07: "TIENE QUE SER SI O SI UN SISTEMA QUE NO SE PUEDAN
// CRUZAR NUNCA" -- before building anything else, confirm for real whether
// zingo-cli's `notes` output has ANY field that identifies which
// (diversified) address a note was sent to, which unspentNotes() below
// does NOT currently surface (it only pulls value/txid/time/status/memo).
// If that field exists, per-order unique addresses become a genuine,
// unambiguous match with no memo and no amount trickery needed at all --
// the real fix. If it doesn't, that confirms the dead end already
// documented on unspentNotes() below and rules that path out for good
// instead of guessing. Temporary diagnostic only, safe (read-only, no
// wallet.dat mutation) -- remove once answered.
export async function rawNotesDebug() {
  const out = await runCli(["notes"], { timeout: 3 * 60_000, waitsync: true });
  const { json, raw } = parseMaybeJson(out);
  return json ?? raw;
}

// Brai, 2026-09-07: "la direccion ES la orden" -- SHLD.fun (the platform
// this one is modeled on) demonstrably CAN tell which one-time shielded
// address a payment landed on, which means this is NOT an inherent
// Zcash/shielded limitation -- it's specific to what zingo-cli's `notes`
// command surfaces (confirmed empty of any address field via
// rawNotesDebug above). Before concluding we need to replace zingo-cli
// entirely, check what it can ACTUALLY do: `notes`' own account_id field
// (always 0 so far, on every note we've ever seen) implies multi-account
// support exists in the underlying wallet -- if zingo-cli can create a
// separate account per order and reports notes scoped to the account they
// landed in, that's a real per-order signal with zero new tooling. This
// pulls the CLI's own help text so we can see the full command surface
// (new_address's account-related flags, any account/list_accounts/
// create_account command, etc.) instead of guessing.
export async function rawHelpDebug() {
  const out = await runCli(["help"], { timeout: 30_000 });
  return out;
}

// Brai, 2026-09-07: the real find -- zingo-cli's own help lists
// `value_transfers` ("List all value transfers for this wallet") and
// `value_to_address` ("Show by address value transfers for this seed"),
// neither of which cli.js has ever called before now. If either of these
// actually includes the destination address per transfer (unlike `notes`,
// confirmed address-less via rawNotesDebug), that's the real fix: no
// memo, no amount bump, no tool swap, no per-user wallet -- just ask
// "what landed on THIS address" directly, the same way SHLD.fun's "la
// direccion ES la orden" implies they do. Testing both raw before wiring
// anything up. Temporary diagnostics, remove once answered.
export async function rawValueTransfersDebug() {
  const out = await runCli(["value_transfers"], { timeout: 3 * 60_000, waitsync: true });
  const { json, raw } = parseMaybeJson(out);
  return json ?? raw;
}

export async function rawValueToAddressDebug(address) {
  const out = await runCli(["value_to_address", address], { timeout: 3 * 60_000, waitsync: true });
  const { json, raw } = parseMaybeJson(out);
  return json ?? raw;
}

// Temporary: "value_to_address <addr>" as two argv elements gets rejected
// with "unexpected argument ... found -- Usage: zingo-cli value_to_address"
// (no args shown in that usage line), which suggests this subcommand's argv
// parsing differs from quicksend's (which does take multiple bare argv
// elements successfully). Getting the subcommand's own --help to see its
// real expected form (a named flag? a single quoted string?) before
// guessing further. Remove once answered.
export async function rawValueToAddressHelpDebug() {
  const out = await runCli(["value_to_address", "--help"], { timeout: 30_000 });
  return out;
}

export async function rawAddressesDebug() {
  return listAddresses();
}

// ZODD (2026-09-08): binary-info-debug confirmed the running zingo-cli
// binary's mtime matches, to the second, this exact build's own "Finished
// release profile" log line -- so it genuinely IS the freshly compiled,
// correctly patched binary, not a stale one. Yet `addresses` on THIS
// wallet's real, already-populated wallet.dat still shows no diversifier
// fields, while the identical patched binary run against a brand-new
// throwaway offline wallet (tested locally) shows them correctly. This
// calls the exact same `new_address` codepath production uses to mint a
// real order address (same function as /wallet/address), against THIS
// real wallet.dat, to see whether it's old vs. new addresses that differ,
// or whether the real wallet's own loaded state differs regardless of
// address age. Mutates the wallet (adds one more address, exactly like a
// real order would) -- safe, that's normal operation. Temporary, remove
// together with the rest of this diagnostic batch.
export async function rawNewAddressDebug() {
  return newAddress();
}

// ZODD (2026-09-08): the deployed `addresses`/`notes` output was NOT
// showing the new diversifier fields even after a Railway build/deploy
// whose logs showed the patch step (git apply) and the cargo build both
// completing cleanly, from the patched source, with no errors -- and a
// from-scratch local build using the EXACT same pinned commit, the EXACT
// same patch file, and the EXACT same `--no-default-features --features
// clearnet-test-mode` flags DOES produce the new fields. So either this
// container's /usr/local/bin/zingo-cli genuinely isn't the binary this
// build log describes, or something else is happening under it. This
// route settles that unambiguously: the binary's own mtime/size (does it
// look freshly written by THIS deploy's build?) plus its own --version
// output, no interpretation needed. Temporary diagnostic only, remove
// together with the rest of this diagnostic batch once answered.
export async function rawBinaryInfoDebug() {
  const stat = statSync(BIN);
  let version = null;
  try {
    const { stdout, stderr } = await execFileP(BIN, ["--version"], { timeout: 10_000 });
    version = (stdout || stderr || "").trim();
  } catch (err) {
    version = `error running --version: ${String(err.message ?? err)}`;
  }
  return {
    path: BIN,
    sizeBytes: stat.size,
    mtimeMs: stat.mtimeMs,
    mtimeIso: new Date(stat.mtimeMs).toISOString(),
    version,
  };
}

export async function unspentNotes() {
  const out = await runCli(["notes"], { timeout: 3 * 60_000, waitsync: true });
  const { json, raw } = parseMaybeJson(out);
  if (!json || typeof json !== "object") {
    console.error(`[zcash-wallet-service] unrecognized notes() output, needs a look: ${raw}`);
    return [];
  }
  // Notes live in one of three pools depending on which shielded protocol
  // received them (ironwood/orchard/sapling) -- a payment could in principle
  // land in any of the three, so all get flattened together here. Each
  // note's own pool is kept on it (see `pool` below) because a diversifier
  // is only meaningful compared against an order's SAME pool -- ZODD
  // (2026-09-08): a patched zingo-cli now stamps every note's own
  // `diversifier` field (see zingolib-patches/), which is the real,
  // collision-proof per-order match key. See the ZODD comment on
  // pickAndReserveAmount / the poll loop in backend/src/lib/zcashReal.ts.
  const pools = [
    { pool: "ironwood", summaries: json.ironwood_notes },
    { pool: "orchard", summaries: json.orchard_notes },
    { pool: "sapling", summaries: json.sapling_notes },
  ];
  const notes = pools.flatMap(({ pool, summaries }) =>
    (Array.isArray(summaries?.note_summaries) ? summaries.note_summaries : []).map((n) => ({ ...n, pool }))
  );
  return notes
    .filter((n) => n.spend_status === "unspent")
    .map((n) => ({
      valueZatoshis: Number(n.value),
      txid: n.txid,
      time: Number(n.time ?? 0),
      status: n.status,
      pool: n.pool,
      // Present only from a patched zingo-cli (see the comment above) --
      // null on an unpatched build, which callers must treat as "no
      // diversifier-based match possible for this note" and fall back to
      // memo/amount matching instead.
      diversifier: typeof n.diversifier === "string" ? n.diversifier : null,
      // Brai, 2026-09-07: "esto tiene que ir por frase semilla" -- amount-only
      // matching can't scale (two buyers who both type a round number like
      // 0.05 or 0.2 ZEC collide, see the incident this same day). zingo-cli
      // still can't tell us which ADDRESS a note landed on, but it CAN
      // decrypt the memo field of a shielded note sent to this wallet's own
      // viewing key -- and every order/token-creation already has a
      // globally-unique id. The backend now asks payers to include that id
      // as the memo (via the same zcash: URI used for the QR, per ZIP-321),
      // and matches by memo first -- an exact, collision-proof key,
      // regardless of how many orders are open at once -- falling back to
      // the old amount-based guess only for notes with no usable memo (a
      // wallet that doesn't support ZIP-321 memos, or a manual paste).
      memo: typeof n.memo === "string" ? n.memo : "",
    }));
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
