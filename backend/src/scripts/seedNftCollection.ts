/**
 * Brai, 2026-09-18: "todavia no tengo la cantidad ni el numero y precio,
 * arranca y deja todo en X ... cuando lo tenga te digo" -- this is the "X"
 * side of the NFT marketplace: nothing about the collection (how many
 * pieces, the mint price, the art itself) is hardcoded anywhere in the
 * backend. This script is what actually creates the NftCollection + its
 * NftItem rows, reading everything from a manifest file + an images
 * folder that get dropped in once Brai has the real numbers and art. Until
 * this is run once, no NftCollection row exists at all, and /api/nft/*
 * reports "not configured" (see server.ts) -- there is nothing mintable
 * with invented numbers.
 *
 * Usage (from backend/):
 *   npm run seed:nft -- path/to/manifest.json
 *
 * Manifest shape (see NftManifest below): a JSON file alongside a folder of
 * image files. `items[].image` / `coverImage` are paths RELATIVE TO THE
 * MANIFEST FILE ITSELF, so the whole thing (manifest + images folder) can
 * live anywhere and just be pointed at.
 *
 *   {
 *     "slug": "zodd-genesis",
 *     "name": "ZODD Genesis",
 *     "description": "optional",
 *     "currency": "ZEC",              // or "YEC" -- optional, defaults ZEC
 *     "mintPriceZec": 0.05,            // REAL number, no placeholder once this runs
 *     "coverImage": "cover.png",       // optional
 *     "items": [
 *       { "editionNumber": 1, "name": "ZODD #1", "image": "art/1.png", "traits": { "Hat": "Nimbus" } },
 *       ...
 *     ]
 *   }
 *
 * totalSupply is deliberately NOT a field in the manifest -- it's always
 * items.length, so there's no way for the declared count and the actual
 * seeded rows to drift apart.
 *
 * Re-running against the SAME slug is safe and idempotent: the collection
 * row is upserted (name/description/price/etc. update in place), and each
 * item is upserted by (collectionId, editionNumber) -- but only while it's
 * still unminted (ownerInternalWalletId null). An item that's already been
 * minted is left completely untouched (its art/name/traits do not get
 * silently swapped out from under its new owner) -- this is meant for
 * fixing a typo or adding pieces before launch, not for editing pieces
 * people already own.
 */
import { readFileSync } from "node:fs";
import { extname, dirname, resolve } from "node:path";
import { prisma } from "../lib/store.js";

interface NftManifestItem {
  editionNumber: number;
  name?: string;
  image: string;
  traits?: Record<string, string>;
}

interface NftManifest {
  slug: string;
  name: string;
  description?: string;
  currency?: "ZEC" | "YEC";
  mintPriceZec: number;
  coverImage?: string;
  items: NftManifestItem[];
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function imageToDataUrl(baseDir: string, relativePath: string): string {
  const ext = extname(relativePath).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) throw new Error(`unsupported image extension "${ext}" for ${relativePath} (expected png/jpg/jpeg/webp/gif)`);
  const bytes = readFileSync(resolve(baseDir, relativePath));
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    console.error("usage: npm run seed:nft -- path/to/manifest.json");
    process.exit(1);
  }
  const baseDir = dirname(resolve(manifestPath));
  const manifest: NftManifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  if (!manifest.slug || !manifest.name || !manifest.items?.length) {
    throw new Error("manifest needs at least slug, name, and a non-empty items[]");
  }
  if (!(manifest.mintPriceZec > 0)) {
    throw new Error("manifest.mintPriceZec must be a positive number -- this is the real mint price, not a placeholder");
  }
  const editionNumbers = manifest.items.map((i) => i.editionNumber);
  if (new Set(editionNumbers).size !== editionNumbers.length) {
    throw new Error("duplicate editionNumber in manifest.items -- each piece needs a unique number");
  }

  const totalSupply = manifest.items.length;
  const currency = manifest.currency ?? "ZEC";
  const coverImageDataUrl = manifest.coverImage ? imageToDataUrl(baseDir, manifest.coverImage) : null;

  const collection = await prisma.nftCollection.upsert({
    where: { slug: manifest.slug },
    create: {
      slug: manifest.slug,
      name: manifest.name,
      description: manifest.description ?? null,
      currency,
      totalSupply,
      mintPriceZec: manifest.mintPriceZec,
      coverImageDataUrl,
      hidden: true, // Brai flips this (or just links /nft) when he's ready for real users
    },
    update: {
      name: manifest.name,
      description: manifest.description ?? null,
      currency,
      totalSupply,
      mintPriceZec: manifest.mintPriceZec,
      ...(coverImageDataUrl ? { coverImageDataUrl } : {}),
    },
  });
  console.log(`collection "${collection.slug}" ready (id ${collection.id}), totalSupply=${totalSupply}, mintPriceZec=${manifest.mintPriceZec} ${currency}`);

  let created = 0;
  let updated = 0;
  let skippedMinted = 0;
  for (const item of manifest.items) {
    const imageDataUrl = imageToDataUrl(baseDir, item.image);
    // Brai, 2026-09-19: same PAPIRO-default note as the manifest HTTP path
    // in store.ts -- this CLI script has no tier concept either.
    const existing = await prisma.nftItem.findUnique({
      where: { collectionId_tier_editionNumber: { collectionId: collection.id, tier: "PAPIRO", editionNumber: item.editionNumber } },
    });
    if (existing?.ownerInternalWalletId) {
      skippedMinted++;
      continue; // already minted -- never overwrite a piece someone owns
    }
    await prisma.nftItem.upsert({
      where: { collectionId_tier_editionNumber: { collectionId: collection.id, tier: "PAPIRO", editionNumber: item.editionNumber } },
      create: {
        collectionId: collection.id,
        editionNumber: item.editionNumber,
        name: item.name ?? null,
        imageDataUrl,
        traits: item.traits ?? undefined,
      },
      update: {
        name: item.name ?? null,
        imageDataUrl,
        traits: item.traits ?? undefined,
      },
    });
    if (existing) updated++;
    else created++;
  }

  console.log(`items: ${created} created, ${updated} updated, ${skippedMinted} already-minted (left untouched)`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
