import { NextRequest, NextResponse } from "next/server";
import { getOAuthConfig, verifyToken, VERIFIED_COOKIE } from "@/lib/twitterOAuth";

// Brai, 2026-09-18 (v12, URGENT): the whitelist page calls this on load (and
// right after the OAuth redirect back) to find out whether the visitor has
// a currently-verified X handle. Reads and verifies the signed cookie --
// never trusts anything else -- so the page can show "@handle connected"
// instead of a free-text field.
export const dynamic = "force-dynamic"; // reads a per-visitor cookie, must never be cached across visitors

export async function GET(req: NextRequest) {
  const config = getOAuthConfig();
  if (!config) return NextResponse.json({ handle: null, configured: false });

  const cookie = req.cookies.get(VERIFIED_COOKIE)?.value;
  const verified = verifyToken<{ handle: string }>(cookie, config.sessionSecret);
  return NextResponse.json({ handle: verified?.handle ?? null, configured: true });
}
