import { NextResponse } from "next/server";
import { generatePkce, getOAuthConfig, randomState, signToken, PENDING_COOKIE, PENDING_TTL_SECONDS } from "@/lib/twitterOAuth";

// Brai, 2026-09-18 (v12, URGENT): first hop of "Sign in with X". Generates
// the PKCE pair + anti-CSRF state, stashes them in a short-lived signed
// cookie (nothing server-side to look up later -- see twitterOAuth.ts), and
// sends the browser to X's own consent screen. X redirects back to
// /api/auth/twitter/callback with a code we exchange there.
export const dynamic = "force-dynamic"; // must never be statically cached -- every visit needs a fresh state/PKCE pair

export async function GET() {
  const config = getOAuthConfig();
  if (!config) {
    // TWITTER_CLIENT_ID/SECRET/OAUTH_SESSION_SECRET not set yet -- send them
    // back to the wizard with a flag instead of a raw 500.
    return NextResponse.redirect("https://zodd.fun/nft/whitelist?oauthError=not_configured");
  }

  const { verifier, challenge } = generatePkce();
  const state = randomState();
  const pending = signToken({ state, verifier }, config.sessionSecret, PENDING_TTL_SECONDS);

  const authorizeUrl = new URL("https://twitter.com/i/oauth2/authorize");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizeUrl.searchParams.set("scope", "tweet.read users.read");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  const res = NextResponse.redirect(authorizeUrl.toString());
  res.cookies.set(PENDING_COOKIE, pending, {
    httpOnly: true,
    secure: true,
    sameSite: "lax", // "lax" (not "strict") on purpose -- this cookie must survive the redirect back from x.com
    path: "/",
    maxAge: PENDING_TTL_SECONDS,
  });
  return res;
}
