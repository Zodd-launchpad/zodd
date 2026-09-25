import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import path from "node:path";

// Brai, 2026-09-25: "quiero que cuando minteas, aparezca el nft y un boton
// que diga SHARE y te deje compartir tu NFT en twitter" -- same server-
// rendered OG-card pattern as the whitelist share flow (see
// /api/og/whitelist/[handle]/route.tsx, whose comments explain WHY this
// has to be its own image route instead of just linking the item page
// directly: Twitter/X reads THIS url to build the tweet's image card).
// Forced short/revalidating cache for the same reason as that route: a
// piece can be forged/relisted/etc. after being minted, and every fresh
// SHARE click carries its own ?t= token (see the mint page's shareItem())
// so X never serves a stuck/stale card from an earlier crawl.
export const dynamic = "force-dynamic";

const MASCOT_DATA_URI = (() => {
  try {
    const buf = readFileSync(path.join(process.cwd(), "public", "zodd-mascot-cat-share.jpg"));
    return `data:image/jpeg;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
})();

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
const COLLECTION_SLUG = "zodd-genesis";

const VALID_TIER_SLUGS = new Set(["papiro", "fragmento", "reliquia"]);

// Brai, 2026-09-19 (elsewhere in the repo): "a cada nft le pondras TIER 1
// en verde, TIER 2 en amarillo y TIER 3 en ROJO" -- same 3 hex values as
// .nft-card-tier-papiro/fragmento/reliquia in globals.css, duplicated here
// because this route renders as a raw ImageResponse (no CSS classes).
const TIER_INFO: Record<string, { num: number; color: string }> = {
  papiro: { num: 1, color: "#16c784" },
  fragmento: { num: 2, color: "#f3ba2f" },
  reliquia: { num: 3, color: "#ea3943" },
};

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

export async function GET(
  _req: Request,
  { params }: { params: { tier: string; editionNumber: string } }
) {
  const tierSlug = VALID_TIER_SLUGS.has(params.tier) ? params.tier : "papiro";
  const editionNumber = Number(params.editionNumber);
  const tierInfo = TIER_INFO[tierSlug];
  const item = Number.isFinite(editionNumber) ? await lookupItem(tierSlug, editionNumber) : null;
  const label = item?.name || `TIER ${tierInfo.num} #${editionNumber}`;

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          alignItems: "stretch",
          background: "#050505",
          fontFamily: "sans-serif",
        }}
      >
        {MASCOT_DATA_URI ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={MASCOT_DATA_URI}
            width={520}
            height={630}
            style={{ objectFit: "cover", display: "block" }}
          />
        ) : null}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "0 56px",
            borderLeft: "1px solid #2a2a2e",
          }}
        >
          <div style={{ display: "flex", fontSize: 20, letterSpacing: "3px", color: "#8a8a92", fontWeight: 700, marginBottom: 22 }}>
            ZODD.FUN · NFT MINTED
          </div>
          <div style={{ display: "flex", fontSize: 26, color: "#f2f2f3", fontWeight: 600, marginBottom: 30, maxWidth: 560 }}>
            A new piece just joined the collection
          </div>
          <div style={{ display: "flex", fontSize: 44, fontWeight: 800, color: "#e8e8ec", marginBottom: 16, maxWidth: 560 }}>
            {label}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 22,
              fontWeight: 800,
              color: tierInfo.color,
              letterSpacing: "2px",
              padding: "6px 16px",
              border: `1px solid ${tierInfo.color}`,
              borderRadius: 6,
              width: "fit-content",
            }}
          >
            TIER {tierInfo.num}
          </div>
          <div style={{ display: "flex", fontSize: 20, color: "#8a8a92", marginTop: 36 }}>zodd.fun/nft</div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "Cache-Control": "public, max-age=300, must-revalidate",
      },
    }
  );
}
