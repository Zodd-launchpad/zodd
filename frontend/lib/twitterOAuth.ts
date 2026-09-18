// Brai, 2026-09-18 (v12, URGENT): "me están conectando cualquier handle y
// se están haciendo pasar por otra persona ... necesito que cuando haces
// clic te revise que seas ese handle con Twitter" -- replaces the old
// free-text handle field with real "Sign in with X" (OAuth 2.0 + PKCE).
// This file holds the shared crypto plumbing used by the three
// app/api/auth/twitter/* routes: signing/verifying short-lived, tamper-proof
// cookies (so nothing about "which handle is verified" ever has to be
// trusted from client input) and generating the PKCE verifier/challenge
// pair X's authorize flow requires.
//
// Design note: no server-side session store (no DB table, no in-memory
// Map) -- every piece of state (the pending OAuth attempt, the verified
// handle afterward) is carried entirely in signed, httpOnly cookies. A
// cookie is worthless to forge without TWITTER_OAUTH_SESSION_SECRET, which
// never leaves this server, so this survives restarts and multiple
// instances for free.
import { createHash, createHmac, randomBytes } from "node:crypto";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlJson(obj: unknown): string {
  return base64url(Buffer.from(JSON.stringify(obj), "utf8"));
}

function fromBase64url(s: string): Buffer {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Buffer.from(padded, "base64");
}

function hmac(payload: string, secret: string): string {
  return base64url(createHmac("sha256", secret).update(payload).digest());
}

/** Signs `payload` (plus an expiry) into a compact "<data>.<sig>" token that
 * cannot be modified or extended without the secret. Used for both cookies
 * this flow sets. */
export function signToken(payload: Record<string, unknown>, secret: string, ttlSeconds: number): string {
  const data = base64urlJson({ ...payload, exp: Date.now() + ttlSeconds * 1000 });
  return `${data}.${hmac(data, secret)}`;
}

/** Verifies signature + expiry. Returns the payload (with `exp` still on
 * it) or null if the token is missing, tampered with, or expired -- callers
 * should treat null exactly like "not verified", never partially trust it. */
export function verifyToken<T extends Record<string, unknown>>(token: string | undefined, secret: string): (T & { exp: number }) | null {
  if (!token) return null;
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;
  if (hmac(data, secret) !== sig) return null; // tampered or wrong secret
  try {
    const payload = JSON.parse(fromBase64url(data).toString("utf8")) as T & { exp: number };
    if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null; // expired
    return payload;
  } catch {
    return null;
  }
}

/** PKCE (RFC 7636) verifier/challenge pair for the OAuth 2.0 authorization
 * code flow -- required by X's OAuth implementation even for confidential
 * (client-secret-holding) apps like this one. code_challenge is plain
 * BASE64URL(SHA256(code_verifier)) -- a hash, not an HMAC, since there's no
 * secret key involved at this step. */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48)); // 64 chars, within the 43-128 spec range
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function randomState(): string {
  return base64url(randomBytes(24));
}

export const PENDING_COOKIE = "zodd_oauth_pending";
export const VERIFIED_COOKIE = "zodd_verified_x";
export const PENDING_TTL_SECONDS = 10 * 60; // 10 min to complete the X login/consent screen
export const VERIFIED_TTL_SECONDS = 30 * 60; // 30 min to finish steps 2-4 of the wizard afterward

/** Throws with a clear message naming exactly which env var is missing,
 * instead of the OAuth routes failing cryptically mid-flow. Until Brai sets
 * these (TWITTER_CLIENT_ID/SECRET from the X Developer Portal,
 * TWITTER_OAUTH_SESSION_SECRET generated once and set alongside them),
 * /api/auth/twitter/start reports "not configured yet" rather than 500ing. */
export function getOAuthConfig() {
  const clientId = process.env.TWITTER_CLIENT_ID;
  const clientSecret = process.env.TWITTER_CLIENT_SECRET;
  const sessionSecret = process.env.TWITTER_OAUTH_SESSION_SECRET;
  const redirectUri = process.env.TWITTER_REDIRECT_URI ?? "https://zodd.fun/api/auth/twitter/callback";
  if (!clientId || !clientSecret || !sessionSecret) return null;
  return { clientId, clientSecret, sessionSecret, redirectUri };
}
