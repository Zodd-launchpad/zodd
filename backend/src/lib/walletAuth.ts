/**
 * Signature verification for the two "connect your existing wallet and
 * we'll auto-create your InternalWallet" flows added alongside Noir
 * connect (@noir-wallet/sdk, see server.ts) -- Brai, 2026-09-30: "que si
 * conecta con metamask o rabby les cree la wallet automaticamente, como
 * pasa con la NOIR ahora ... tambien con las wallets nativas de near".
 *
 * Both follow the exact same shape as Noir connect: the backend hands out
 * a one-time nonce + exact message text (see createEvmChallenge /
 * createNearWalletChallenge in store.ts), the frontend has the wallet
 * extension sign THAT message, and this file checks the signature really
 * does come from the claimed address before store.ts creates or
 * recognizes an InternalWallet for it. Neither of these touches how
 * paying for anything works -- same as Noir, this is only ever an
 * alternative login (and, once Add Funds lands, the address that a
 * deposit gets credited to).
 */
import { ethers } from "ethers";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { createHash } from "node:crypto";

// ---------- EVM (Metamask / Rabby -- both inject the same window.ethereum,
// so one flow covers both) ----------
//
// Standard EIP-191 personal_sign: the frontend calls
// `window.ethereum.request({ method: "personal_sign", params: [message, address] })`,
// which every EVM wallet extension supports natively (nothing bespoke to
// Metamask or Rabby specifically). Verifying is just an ECDSA signature
// recovery -- ethers.verifyMessage() does the EIP-191 prefixing and
// recovery in one call and returns the address that actually signed.

export function verifyEvmSignature(message: string, signature: string, claimedAddress: string): boolean {
  let recovered: string;
  try {
    recovered = ethers.verifyMessage(message, signature);
  } catch {
    return false; // malformed signature -- not a verification failure worth a 500, just "no"
  }
  try {
    return ethers.getAddress(recovered) === ethers.getAddress(claimedAddress);
  } catch {
    return false; // claimedAddress wasn't even a valid EVM address
  }
}

// ---------- Native NEAR wallets (Nightly, MyNearWallet, etc. via
// @near-wallet-selector) ----------
//
// NEAR's wallet-selector standard for "sign this arbitrary message"
// (distinct from signing a transaction) is NEP-413. The wallet Borsh-
// serializes a fixed payload, SHA-256 hashes it, and ed25519-signs the
// hash with the account's key. We reconstruct that exact payload from
// what WE issued (never trust a message the client sends back) and
// verify the signature against the public key the wallet reports --
// then separately confirm that public key is really a full-access key of
// the claimed account, because a valid ed25519 signature only proves
// control of SOME keypair, not that it's actually attached to that NEAR
// account (anyone can generate a fresh ed25519 keypair and sign with it).
//
// NEP-413 payload (Borsh):
//   tag: u32 = 2147484061          (2**31 + 413, marks this as a NEP-413 payload, not a transaction)
//   message: string                (u32 LE length prefix + utf8 bytes)
//   nonce: [u8; 32]                (raw bytes, base64-encoded on the wire)
//   recipient: string
//   callbackUrl: Option<string>    (0x00 = None, else 0x01 + string)
const NEP413_TAG = 2147484061;

function borshString(s: string): Buffer {
  const utf8 = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(utf8.length, 0);
  return Buffer.concat([len, utf8]);
}

function buildNep413Payload(message: string, nonceBase64: string, recipient: string): Buffer {
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(NEP413_TAG, 0);
  const nonce = Buffer.from(nonceBase64, "base64");
  if (nonce.length !== 32) throw new Error(`NEP-413 nonce must decode to 32 bytes, got ${nonce.length}`);
  const callbackUrlNone = Buffer.from([0x00]);
  return Buffer.concat([tag, borshString(message), nonce, borshString(recipient), callbackUrlNone]);
}

const NEAR_RPC_URL = process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org";

/** Confirms `publicKey` (e.g. "ed25519:G5CF...") is actually a full-access
 * key on `accountId` right now, via NEAR's view_access_key_list RPC --
 * without this, the ed25519 check above alone would let anyone "log in"
 * as any NEAR account by just signing with a keypair they made up. */
async function isFullAccessKeyOfAccount(accountId: string, publicKey: string): Promise<boolean> {
  const res = await fetch(NEAR_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "wallet-auth",
      method: "query",
      params: { request_type: "view_access_key_list", finality: "final", account_id: accountId },
    }),
  });
  if (!res.ok) return false;
  const body: any = await res.json().catch(() => null);
  const keys: any[] = body?.result?.keys ?? [];
  return keys.some((k) => k.public_key === publicKey && k.access_key?.permission === "FullAccess");
}

export async function verifyNearWalletSignature(params: {
  message: string;
  nonceBase64: string;
  recipient: string;
  signatureBase64: string;
  publicKey: string; // "ed25519:<base58>"
  accountId: string;
}): Promise<boolean> {
  const { message, nonceBase64, recipient, signatureBase64, publicKey, accountId } = params;
  if (!publicKey.startsWith("ed25519:")) return false;

  let payload: Buffer;
  try {
    payload = buildNep413Payload(message, nonceBase64, recipient);
  } catch {
    return false;
  }
  const hash = createHash("sha256").update(payload).digest();

  const pubkeyBytes = bs58.decode(publicKey.slice("ed25519:".length));
  const signatureBytes = Buffer.from(signatureBase64, "base64");
  const sigValid = nacl.sign.detached.verify(hash, signatureBytes, pubkeyBytes);
  if (!sigValid) return false;

  return isFullAccessKeyOfAccount(accountId, publicKey);
}
