import type { Metadata } from "next";
import Link from "next/link";

// Brai, 2026-09-18 (v11): the actual SHARE target. This page has no client
// logic on purpose -- its only job is (a) generateMetadata below, which is
// what Twitter/X reads to build the tweet's image card (pointing at
// /api/og/whitelist/[handle]), and (b) a plain, real landing page for
// anyone who clicks the tweet, so they can apply themselves. "para que la
// gente festeje o pida ser aprobado" -- this is the festejar-or-pedir-ser-
// aprobado page.
const SITE_URL = "https://zodd.fun";

type Status = "PENDING" | "APPROVED" | "REJECTED" | null;

async function lookupStatus(handle: string): Promise<Status> {
  const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
  try {
    const res = await fetch(`${API}/api/nft/whitelist/by-handle/${encodeURIComponent(handle)}`, { cache: "no-store" });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.entry?.status ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: { handle: string } }): Promise<Metadata> {
  const handle = params.handle;
  const status = await lookupStatus(handle);
  const title =
    status === "APPROVED"
      ? `@${handle} is whitelisted for the ZODD NFT drop 🎉`
      : status === "REJECTED"
      ? `@${handle} — ZODD NFT whitelist`
      : `@${handle} applied for the ZODD NFT whitelist 🐸`;
  const description = "Free mint whitelist for the ZODD NFT drop on Zcash. Apply in under a minute.";
  const imageUrl = `${SITE_URL}/api/og/whitelist/${encodeURIComponent(handle)}`;
  const pageUrl = `${SITE_URL}/nft/whitelist/share/${encodeURIComponent(handle)}`;

  return {
    title,
    description,
    openGraph: { title, description, url: pageUrl, images: [{ url: imageUrl, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: [imageUrl] },
  };
}

export default async function NftWhitelistShareHandlePage({ params }: { params: { handle: string } }) {
  const handle = params.handle;
  const status = await lookupStatus(handle);
  const note =
    status === "APPROVED"
      ? "Approved — this wallet's next mint is free."
      : status === "REJECTED"
      ? "This application wasn't approved this round."
      : "Application submitted — under manual review.";

  return (
    <div className="coming-soon">
      <div className="badge">NFT WHITELIST</div>
      <h1>@{handle}</h1>
      <p>{note}</p>
      <p style={{ marginTop: 24 }}>
        <Link href="/nft/whitelist" className="btn btn-gold">
          Apply for the ZODD NFT Whitelist
        </Link>
      </p>
    </div>
  );
}
