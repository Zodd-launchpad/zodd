// Brai, 2026-09-24: "agrega esos dos NFT a tier 3" -- one-time local script
// to push the two new Tier 3 (RELIQUIA) video variants (the cobra idol and
// the ring) into the live collection through the new, non-destructive
// /api/admin/nft-add-tier-variants endpoint. This does NOT wipe or
// re-seed anything -- it only appends these two variants to the RELIQUIA
// pool, so every already-minted piece is untouched. Runs from your machine
// (not from Claude's sandbox) because the payload is a few MB of video and
// your own internet connection just handles that fine.
//
// Usage (PowerShell, from the repo root):
//   $env:ADMIN_TOKEN="<your ADMIN_TOKEN>"; node scripts/add-reliquia-variants.mjs
//
// Usage (cmd.exe):
//   set ADMIN_TOKEN=<your ADMIN_TOKEN>
//   node scripts/add-reliquia-variants.mjs
//
// Needs Node 18+ (global fetch). Run it AFTER you've deployed the backend
// change that adds this endpoint -- otherwise you'll get a 404.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BACKEND_URL = process.env.ZODD_BACKEND_URL || "https://backend-production-e195.up.railway.app";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

if (!ADMIN_TOKEN) {
  console.error("Missing ADMIN_TOKEN env var. Set it first, e.g.:");
  console.error('  $env:ADMIN_TOKEN="..."; node scripts/add-reliquia-variants.mjs');
  process.exit(1);
}

const variants = [
  { file: join(__dirname, "nft-assets/reliquia-serpent-oracle.mp4"), name: "Relic of the Serpent Oracle" },
  { file: join(__dirname, "nft-assets/reliquia-pharaohs-signet.mp4"), name: "Relic of the Pharaoh's Signet" },
];

function toDataUrl(path) {
  const buf = readFileSync(path);
  return `data:video/mp4;base64,${buf.toString("base64")}`;
}

const payload = {
  slug: "zodd-genesis",
  tier: "RELIQUIA",
  variants: variants.map((v) => {
    const videoDataUrl = toDataUrl(v.file);
    const expectedMd5 = createHash("md5").update(videoDataUrl).digest("hex");
    return { name: v.name, videoDataUrl, expectedMd5 };
  }),
};

const bodyStr = JSON.stringify(payload);
console.log(`Uploading ${payload.variants.length} new RELIQUIA variants (${(bodyStr.length / 1024 / 1024).toFixed(1)} MB payload)...`);

const res = await fetch(`${BACKEND_URL}/api/admin/nft-add-tier-variants`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-admin-token": ADMIN_TOKEN },
  body: bodyStr,
});

const responseBody = await res.json().catch(() => null);
console.log(res.status, responseBody);

if (!res.ok) {
  process.exit(1);
}
console.log("Done. The two new relics are now in the Tier 3 pool for future forges.");
