import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import path from "node:path";

// Brai, 2026-09-18 (v11): "eso del share quedo horrible, tocas share y te
// baja una foto? ... corrige eso" -- the html2canvas-download-then-attach
// flow was dead on arrival (nobody downloads a PNG to manually attach it
// to a tweet). Replaced entirely: SHARE now just opens the normal Twitter
// text-intent URL pointing at /nft/whitelist/share/[handle] (see that
// page's generateMetadata), and THIS route renders that page's OG/Twitter
// card image server-side. Twitter fetches this URL itself and shows the
// image inline in the tweet -- no download, no manual attach, works on
// every platform because it's just a normal link preview.
//
// Brai, 2026-09-18 (v11 cont.): "la captura tiene que incluir esta foto
// del gato tambien, la idea es que sea publicidad" -- the ZODD mascot
// (mechanical Bastet cat, Eye of Horus) is baked into every card so a
// shared "APPROVED"/"UNDER REVIEW" tweet doubles as branded advertising,
// not just a status readout. Read from disk + inlined as a base64 data
// URI (not an <img src="https://...">) so rendering never depends on this
// same server successfully fetching its own asset mid-request.
const MASCOT_DATA_URI = (() => {
  try {
    const buf = readFileSync(path.join(process.cwd(), "public", "zodd-mascot-cat-share.jpg"));
    return `data:image/jpeg;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
})();

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

type Status = "PENDING" | "APPROVED" | "REJECTED" | null;

async function lookupStatus(handle: string): Promise<Status> {
  try {
    const res = await fetch(`${API}/api/nft/whitelist/by-handle/${encodeURIComponent(handle)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.entry?.status ?? null;
  } catch {
    return null;
  }
}

export async function GET(_req: Request, { params }: { params: { handle: string } }) {
  const handle = params.handle;
  const status = await lookupStatus(handle);

  const statusWord = status === "APPROVED" ? "APPROVED" : status === "REJECTED" ? "NOT APPROVED" : "UNDER REVIEW";
  const statusColor = status === "APPROVED" ? "#16c784" : status === "REJECTED" ? "#ea3943" : "#9a9aa0";
  const heading =
    status === "APPROVED"
      ? "Congratulations — you're whitelisted!"
      : status === "REJECTED"
      ? "ZODD NFT whitelist status"
      : "Application under review";

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          alignItems: "stretch",
          background: "#050505",
          fontFamily: "sans-serif",
        }}
      >
        {MASCOT_DATA_URI ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={MASCOT_DATA_URI}
            width={520}
            height={630}
            style={{ objectFit: "cover", display: "block" }}
          />
        ) : null}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "0 56px",
            borderLeft: "1px solid #2a2a2e",
          }}
        >
          <div style={{ display: "flex", fontSize: 20, letterSpacing: "3px", color: "#8a8a92", fontWeight: 700, marginBottom: 22 }}>
            ZODD.FUN · NFT WHITELIST
          </div>
          <div style={{ display: "flex", fontSize: 26, color: "#f2f2f3", fontWeight: 600, marginBottom: 30, maxWidth: 560 }}>
            {heading}
          </div>
          <div style={{ display: "flex", fontSize: 44, fontWeight: 800, color: "#e8e8ec", marginBottom: 10 }}>
            @{handle}
          </div>
          <div style={{ display: "flex", fontSize: 44, fontWeight: 800, color: statusColor, letterSpacing: "1px" }}>
            {statusWord}
          </div>
          <div style={{ display: "flex", fontSize: 20, color: "#8a8a92", marginTop: 36 }}>zodd.fun/nft/whitelist</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
