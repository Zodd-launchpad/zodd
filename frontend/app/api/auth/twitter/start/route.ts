import { NextRequest, NextResponse } from "next/server";
import { generatePkce, getOAuthConfig, randomState, signToken, PENDING_COOKIE, PENDING_TTL_SECONDS } from "@/lib/twitterOAuth";

// Brai, 2026-09-18 (v12, URGENT): first hop of "Sign in with X". Generates
// the PKCE pair + anti-CSRF state, stashes them in a short-lived signed
// cookie (nothing server-side to look up later -- see twitterOAuth.ts), and
// sends the browser to X's own consent screen. X redirects back to
// /api/auth/twitter/callback with a code we exchange there.
export const dynamic = "force-dynamic"; // must never be statically cached -- every visit needs a fresh state/PKCE pair

// Brai, 2026-09-21: "programar algo para el mint... conectar autentificador
// de twitter" -- this flow used to always bounce back to /nft/whitelist.
// The mint page (frontend/app/nft/test/mint/page.tsx) needs the SAME X
// verification to link a wallet to a preapproved handle at mint time, so
// this now accepts an optional ?returnTo=/some/path and carries it inside
// the signed pending cookie (never trusted from the query string again
// after this point -- see callback/route.ts reading it back OUT of that
// same cookie, not off the URL). Only a same-site relative path is
// accepted; anything else falls back to the old default.
function safeReturnTo(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/nft/whitelist";
}

export async function GET(req: NextRequest) {
  const config = getOAuthConfig();
  const returnTo = safeReturnTo(req.nextUrl.searchParams.get("returnTo"));
  if (!config) {
    // TWITTER_CLIENT_ID/SECRET/OAUTH_SESSION_SECRET not set yet -- send them
    // back where they came from with a flag instead of a raw 500.
    return NextResponse.redirect(`https://zodd.fun${returnTo}?oauthError=not_configured`);
  }

  const { verifier, challenge } = generatePkce();
  const state = randomState();
  const pending = signToken({ state, verifier, returnTo }, config.sessionSecret, PENDING_TTL_SECONDS);

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
