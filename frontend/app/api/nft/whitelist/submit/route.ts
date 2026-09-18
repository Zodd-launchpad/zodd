import { NextRequest, NextResponse } from "next/server";
import { getOAuthConfig, verifyToken, VERIFIED_COOKIE } from "@/lib/twitterOAuth";

// Brai, 2026-09-18 (v12, URGENT): the ONLY path that may create a
// NftWhitelistEntry now. The client sends just a wallet address -- never a
// handle, there's no field for it anymore (see page.tsx step 1) -- and this
// route supplies the twitterHandle itself, read from the signed
// VERIFIED_COOKIE that only /api/auth/twitter/callback can set (i.e. only
// after a real X login). It then relays to the backend's
// POST /api/nft/whitelist with WHITELIST_INTERNAL_TOKEN, a secret shared
// only between these two services, so that backend route can no longer be
// hit directly with a made-up handle either -- closing the actual exploit
// Brai reported, not just hiding the old text field.
const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
const WHITELIST_INTERNAL_TOKEN = process.env.WHITELIST_INTERNAL_TOKEN;

export const dynamic = "force-dynamic"; // reads a per-visitor cookie, must never be cached across visitors

export async function POST(req: NextRequest) {
  const config = getOAuthConfig();
  if (!config) return NextResponse.json({ error: "X verification is not configured yet" }, { status: 503 });

  const cookie = req.cookies.get(VERIFIED_COOKIE)?.value;
  const verified = verifyToken<{ handle: string }>(cookie, config.sessionSecret);
  if (!verified?.handle) {
    return NextResponse.json({ error: "connect your X account first" }, { status: 401 });
  }

  let walletAddress: string;
  try {
    const body = await req.json();
    walletAddress = String(body?.walletAddress ?? "").trim();
  } catch {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }
  if (!walletAddress) return NextResponse.json({ error: "wallet address is required" }, { status: 400 });

  const backendRes = await fetch(`${BACKEND}/api/nft/whitelist`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(WHITELIST_INTERNAL_TOKEN ? { "x-internal-token": WHITELIST_INTERNAL_TOKEN } : {}),
    },
    body: JSON.stringify({ walletAddress, twitterHandle: verified.handle }),
  });
  const backendBody = await backendRes.json();
  return NextResponse.json(backendBody, { status: backendRes.status });
}
