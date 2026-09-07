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
