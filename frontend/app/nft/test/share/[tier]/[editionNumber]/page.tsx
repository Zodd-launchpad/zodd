import type { Metadata } from "next";
import Link from "next/link";

// Brai, 2026-09-25: "quiero que cuando minteas, aparezca el nft y un boton
// que diga SHARE y te deje compartir tu NFT en twitter" -- exact same
// pattern as /nft/whitelist/share/[handle]/page.tsx: this is the actual
// SHARE target. No client logic on purpose -- its only job is (a)
// generateMetadata below, which is what Twitter/X reads to build the
// tweet's image card (pointing at /api/og/nft/[tier]/[editionNumber]), and
// (b) a plain landing page for anyone who clicks the tweet, so they land
// on a real page about the collection instead of a dead link.
//
// Lives under /nft/test/share for now, same as the rest of the mint flow
// -- "seguimos en zodd.fun/nft/test hasta que yo te diga que lo pases a
// zodd.fun/nft" -- moves together with everything else under /nft/test
// when that switch happens.
const SITE_URL = "https://zodd.fun";
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
const COLLECTION_SLUG = "zodd-genesis";

const TIER_NUM: Record<string, number> = { papiro: 1, fragmento: 2, reliquia: 3 };
const VALID_TIER_SLUGS = new Set(["papiro", "fragmento", "reliquia"]);

type ItemLookup = { name: string | null; mintedAt: string | null } | null;

async function lookupItem(tierSlug: string, editionNumber: number): Promise<ItemLookup> {
  try {
    const res = await fetch(
      `${API}/api/nft/collections/${COLLECTION_SLUG}/items/${tierSlug}/${editionNumber}`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    const body = await res.json();
    return body?.item ? { name: body.item.name ?? null, mintedAt: body.item.mintedAt ?? null } : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: { tier: string; editionNumber: string };
  searchParams: { [key: string]: string | string[] | undefined };
}): Promise<Metadata> {
  const tierSlug = VALID_TIER_SLUGS.has(params.tier) ? params.tier : "papiro";
  const editionNumber = Number(params.editionNumber);
  const tierNum = TIER_NUM[tierSlug];
  const item = Number.isFinite(editionNumber) ? await lookupItem(tierSlug, editionNumber) : null;
  const label = item?.name || `TIER ${tierNum} #${editionNumber}`;

  const title = `${label} — ZODD Genesis NFT`;
  const description = "A ZODD Genesis NFT, minted live on Zcash mainnet. Mint yours at zodd.fun/nft.";

  // Same freshness-token pattern as the whitelist share route -- every
  // SHARE click appends ?t=<token> (see shareItem() in ../../mint/page.tsx)
  // so X always crawls this URL fresh instead of reusing a stuck card.
  const token = typeof searchParams?.t === "string" ? searchParams.t : "";
  const tokenQuery = token ? `?t=${encodeURIComponent(token)}` : "";
  const imageUrl = `${SITE_URL}/api/og/nft/${tierSlug}/${editionNumber}${tokenQuery}`;
  const pageUrl = `${SITE_URL}/nft/test/share/${tierSlug}/${editionNumber}${tokenQuery}`;

  return {
    title,
    description,
    openGraph: { title, description, url: pageUrl, images: [{ url: imageUrl, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: [imageUrl] },
  };
}

export default async function NftShareItemPage({
  params,
}: {
  params: { tier: string; editionNumber: string };
}) {
  const tierSlug = VALID_TIER_SLUGS.has(params.tier) ? params.tier : "papiro";
  const editionNumber = Number(params.editionNumber);
  const tierNum = TIER_NUM[tierSlug];
  const item = Number.isFinite(editionNumber) ? await lookupItem(tierSlug, editionNumber) : null;
  const label = item?.name || `TIER ${tierNum} #${editionNumber}`;

  return (
    <div className="coming-soon">
      <div className="badge">ZODD GENESIS NFT</div>
      <h1>{label}</h1>
      <p>Minted live on Zcash mainnet.</p>
      <p style={{ marginTop: 24 }}>
        <Link href={`/nft/test/item/${tierSlug}/${editionNumber}`} className="btn btn-outline" style={{ marginRight: 12 }}>
          View this piece
        </Link>
        <Link href="/nft/test/mint" className="btn btn-gold">
          Mint your own
        </Link>
      </p>
    </div>
  );
}
