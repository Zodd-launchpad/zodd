import { NextRequest, NextResponse } from "next/server";
import { getOAuthConfig, verifyToken, VERIFIED_COOKIE } from "@/lib/twitterOAuth";

// Brai, 2026-09-21: "programar algo para el mint... conectar autentificador
// de twitter y si el handle esta en la lista, pasa directamente a free
// mint" -- same shape as ../submit/route.ts: the client sends a walletId
// and a Zcash address, never a handle -- this route supplies the handle
// itself, read from the signed VERIFIED_COOKIE that only
// /api/auth/twitter/callback can set. Relays to the backend's
// POST /api/nft/whitelist/claim-by-x with WHITELIST_INTERNAL_TOKEN, so
// that route can't be hit directly with a made-up handle either. Called
// from frontend/app/nft/test/mint/page.tsx.
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

  let walletId: string;
  let address: string;
  try {
    const body = await req.json();
    walletId = String(body?.walletId ?? "").trim();
    address = String(body?.address ?? "").trim();
  } catch {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }
  if (!walletId) return NextResponse.json({ error: "walletId is required" }, { status: 400 });
  if (!address) return NextResponse.json({ error: "wallet address is required" }, { status: 400 });

  const backendRes = await fetch(`${BACKEND}/api/nft/whitelist/claim-by-x`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(WHITELIST_INTERNAL_TOKEN ? { "x-internal-token": WHITELIST_INTERNAL_TOKEN } : {}),
    },
    body: JSON.stringify({ walletId, twitterHandle: verified.handle, address }),
  });
  const backendBody = await backendRes.json();
  return NextResponse.json(backendBody, { status: backendRes.status });
}
