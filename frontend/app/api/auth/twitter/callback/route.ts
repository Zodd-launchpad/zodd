import { NextRequest, NextResponse } from "next/server";
import {
  getOAuthConfig,
  signToken,
  verifyToken,
  PENDING_COOKIE,
  VERIFIED_COOKIE,
  VERIFIED_TTL_SECONDS,
} from "@/lib/twitterOAuth";

// Brai, 2026-09-18 (v12, URGENT): second hop of "Sign in with X". X sends
// the browser back here with ?code=...&state=.... We check the state
// against the signed PENDING_COOKIE set in start/route.ts (proves this
// callback is answering OUR request, not a forged one), exchange the code
// for an access token using the PKCE verifier from that same cookie, then
// ask X who this token actually belongs to -- that's the ONE moment the
// verified handle is established, straight from X, never from anything the
// client typed or sent.
export const dynamic = "force-dynamic"; // reads cookies + query params per-request, must never be cached

// Brai, 2026-09-21: reads the caller back OUT of the signed pending cookie
// (see start/route.ts) instead of always landing on /nft/whitelist, so the
// mint page's "connect X" round-trip lands the visitor back on the mint
// page instead of bouncing them somewhere else. Falls back to the old
// default whenever there's no usable pending cookie (expired, tampered,
// or simply not present), which is also the previous behavior verbatim.
function redirectTo(returnTo: string, status: "verified" | "error", detail?: string) {
  const url = new URL(`https://zodd.fun${returnTo}`);
  if (status === "verified") url.searchParams.set("verified", "1");
  else url.searchParams.set("oauthError", detail ?? "unknown");
  return NextResponse.redirect(url.toString());
}

export async function GET(req: NextRequest) {
  const config = getOAuthConfig();
  const pendingCookie = req.cookies.get(PENDING_COOKIE)?.value;
  const pending = config
    ? verifyToken<{ state: string; verifier: string; returnTo?: string }>(pendingCookie, config.sessionSecret)
    : null;
  const returnTo = pending?.returnTo && pending.returnTo.startsWith("/") ? pending.returnTo : "/nft/whitelist";

  if (!config) return redirectTo(returnTo, "error", "not_configured");

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const oauthDenied = req.nextUrl.searchParams.get("error"); // X sets this if the user hit "Cancel"
  if (oauthDenied) return redirectTo(returnTo, "error", "denied");
  if (!code || !state) return redirectTo(returnTo, "error", "missing_code");

  if (!pending || pending.state !== state) {
    // Expired, tampered, or a state that doesn't match -- refuse rather
    // than proceed, this is exactly the CSRF check PKCE/state exists for.
    return redirectTo(returnTo, "error", "state_mismatch");
  }

  let handle: string;
  try {
    const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
    const tokenRes = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: config.redirectUri,
        code_verifier: pending.verifier,
      }),
    });
    if (!tokenRes.ok) {
      console.error("twitter oauth token exchange failed", tokenRes.status, await tokenRes.text());
      return redirectTo(returnTo, "error", "token_exchange_failed");
    }
    const tokenBody = (await tokenRes.json()) as { access_token: string };

    const meRes = await fetch("https://api.twitter.com/2/users/me", {
      headers: { authorization: `Bearer ${tokenBody.access_token}` },
    });
    if (!meRes.ok) {
      console.error("twitter /2/users/me failed", meRes.status, await meRes.text());
      return redirectTo(returnTo, "error", "profile_fetch_failed");
    }
    const meBody = (await meRes.json()) as { data?: { username?: string } };
    if (!meBody.data?.username) return redirectTo(returnTo, "error", "no_username");
    handle = meBody.data.username;
  } catch (e) {
    console.error("twitter oauth callback error", e);
    return redirectTo(returnTo, "error", "network");
  }

  const verified = signToken({ handle }, config.sessionSecret, VERIFIED_TTL_SECONDS);
  const res = redirectTo(returnTo, "verified");
  res.cookies.set(VERIFIED_COOKIE, verified, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: VERIFIED_TTL_SECONDS,
  });
  res.cookies.delete(PENDING_COOKIE);
  return res;
}
