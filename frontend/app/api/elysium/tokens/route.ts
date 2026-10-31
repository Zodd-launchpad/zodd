// Proxy a la lista de tokens de Elysium que indexa BOXA (boxa.club no
// permite pedirla directo desde el navegador por CORS). Devuelve un formato
// simplificado y marca cuales tienen pool BOXA v4 (operables desde zodd).
import { NextRequest, NextResponse } from "next/server";
import { AbiCoder, ZeroAddress, getAddress, keccak256 } from "ethers";

export const dynamic = "force-dynamic";

const BOXA_API = "https://boxa.club/api/chain/tokens";
const BOXA_V4_HOOK = "0xbcc1f22d137c1d98dfa5548e4d4261d7aee06acc";

function v4PoolId(token: string) {
  return keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint24", "int24", "address"],
      [ZeroAddress, getAddress(token), 0, 200, getAddress(BOXA_V4_HOOK)],
    ),
  ).toLowerCase();
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function simplify(t: any) {
  const meta = t?.metadata && typeof t.metadata === "object" ? t.metadata : {};
  let tradable = false;
  try {
    tradable = typeof t.pool === "string" && t.pool.toLowerCase() === v4PoolId(t.address);
  } catch {
    tradable = false;
  }
  return {
    address: getAddress(t.address),
    name: String(t.name ?? ""),
    symbol: String(t.symbol ?? ""),
    priceHype: num(t.priceHype),
    marketCapHype: num(t.marketCapHype) ?? num(t.marketCapEstimateHype) ?? num(t.fdvHype),
    volume24hHype: num(t.volume24hHype),
    priceChange24h: num(t.priceChange24h),
    holders: num(t.holders),
    createdAt: num(t.createdAt),
    image: str(meta.image) ?? str(t.marketImage),
    description: str(meta.description),
    website: str(meta.website),
    twitter: str(meta.twitter),
    telegram: str(meta.telegram),
    creator: str(t.creator),
    createdBlock: num(t.createdBlock),
    tradable,
    launchedFromZodd: meta.launchedFrom === "zodd.fun",
  };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const address = sp.get("address");
  const sortParam = sp.get("sort");
  const sort = sortParam === "newest" || sortParam === "volume" ? sortParam : "mcap";
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit")) || 60));
  const search = address ?? (sp.get("search") || "").slice(0, 64);

  const url = `${BOXA_API}?limit=${address ? 20 : limit}&mode=all&offset=0&search=${encodeURIComponent(search)}&sort=${sort}`;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
    if (!res.ok) return NextResponse.json({ error: `BOXA responded ${res.status}` }, { status: 502 });
    const body = await res.json();
    const raw: any[] = body?.tokens ?? body?.data?.tokens ?? [];
    let tokens = raw.filter((t) => t && typeof t.address === "string").map(simplify);
    if (address) tokens = tokens.filter((t) => t.address.toLowerCase() === address.toLowerCase());
    return NextResponse.json({ tokens }, { headers: { "cache-control": "public, max-age=10" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Could not reach BOXA" }, { status: 502 });
  }
}
