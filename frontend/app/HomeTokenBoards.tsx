"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, TokenSummary } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

const BOARD_SIZE = 10;

function fmtMcap(n: number) {
  if (n === 0) return "0";
  if (Math.abs(n) < 0.0001) return n.toExponential(2);
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

// Same tiny icon pattern as the market list (frontend/app/launchpad/page.tsx)
// -- kept as its own local copy here rather than shared, matching how that
// file does it. Brai, 2026-09-07: "aca quiero que me aparezca tambien si
// tiene twitter y website abajo en chiquito" (home board cards too).
function TwitterIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
function WebsiteIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 3.8 5.6 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.6-3.8-9s1.3-6.5 3.8-9z" />
    </svg>
  );
}

function TokenCard({ token, graduatedTag }: { token: TokenSummary; graduatedTag?: boolean }) {
  return (
    <Link href={`/launchpad/token/${token.symbol}`} className="board-card">
      {graduatedTag && <div className="board-card-pill">GRAD</div>}
      {token.logoDataUrl ? (
        <img src={token.logoDataUrl} alt="" />
      ) : (
        <div className="board-card-fallback" />
      )}
      <div className="sym">{token.symbol}</div>
      <div className="name">{token.name}</div>
      <div className="mc">{fmtMcap(token.marketCapZec)} ZEC</div>
      {(token.twitterUrl || token.websiteUrl) && (
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          {token.twitterUrl && (
            <a
              href={token.twitterUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="muted"
              style={{ display: "inline-flex", color: "inherit" }}
              title="Twitter / X"
            >
              <TwitterIcon />
            </a>
          )}
          {token.websiteUrl && (
            <a
              href={token.websiteUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="muted"
              style={{ display: "inline-flex", color: "inherit" }}
              title="Website"
            >
              <WebsiteIcon />
            </a>
          )}
        </div>
      )}
    </Link>
  );
}

export default function HomeTokenBoards() {
  const { t } = useLanguage();
  const [tokens, setTokens] = useState<TokenSummary[] | null>(null);

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const data = await api.listTokens();
        if (!stop) setTokens(data);
      } catch {
        /* silent -- the home page shouldn't hard-fail if the market list is briefly down */
      }
    }
    load();
    const id = setInterval(load, 5000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  const graduated = (tokens ?? [])
    .filter((t) => t.graduated)
    .sort((a, b) => b.marketCapZec - a.marketCapZec);
  const exploring = (tokens ?? [])
    .filter((t) => !t.graduated)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div style={{ padding: "0 24px 12px" }}>
      <div className="board-frame">
        <div className="board-header">
          <h2>
            {t("home.board.graduated.title")}
            <span className="board-count">{graduated.length}</span>
          </h2>
        </div>
        <p className="board-sub">{t("home.board.graduated.sub")}</p>
        {tokens === null ? null : graduated.length === 0 ? (
          <p className="board-empty">{t("home.board.empty.graduated")}</p>
        ) : (
          <div className="board-grid">
            {graduated.slice(0, BOARD_SIZE).map((tk) => (
              <TokenCard key={tk.symbol} token={tk} graduatedTag />
            ))}
          </div>
        )}
      </div>

      <div className="board-frame">
        <div className="board-header">
          <h2>
            {t("home.board.explore.title")}
            <span className="board-count">{exploring.length}</span>
          </h2>
        </div>
        <p className="board-sub">{t("home.board.explore.sub")}</p>
        {tokens === null ? null : exploring.length === 0 ? (
          <p className="board-empty">{t("home.board.empty.explore")}</p>
        ) : (
          <div className="board-grid">
            {exploring.slice(0, BOARD_SIZE).map((tk) => (
              <TokenCard key={tk.symbol} token={tk} />
            ))}
          </div>
        )}
        <Link href="/launchpad" className="board-viewall">
          {t("home.board.viewAll")}
        </Link>
      </div>
    </div>
  );
}
