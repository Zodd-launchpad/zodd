"use client";
import { formatUsd, type Trade } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { useZecUsdPrice } from "@/lib/zecPrice";

function fmtTokens(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export default function TradesList({ trades }: { trades: Trade[] }) {
  const { t } = useLanguage();
  const usdRate = useZecUsdPrice();

  function timeAgo(iso: string): string {
    const diffMs = Date.now() - new Date(iso).getTime();
    const s = Math.max(0, Math.floor(diffMs / 1000));
    if (s < 60) return t("trades.ago.seconds", { n: s });
    const m = Math.floor(s / 60);
    if (m < 60) return t("trades.ago.minutes", { n: m });
    const h = Math.floor(m / 60);
    if (h < 24) return t("trades.ago.hours", { n: h });
    return t("trades.ago.days", { n: Math.floor(h / 24) });
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <label className="muted" style={{ fontSize: 11, letterSpacing: 0.5 }}>{t("trades.heading")}</label>
      {trades.length === 0 && (
        <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>{t("trades.none")}</p>
      )}
      <div style={{ marginTop: 8 }}>
        {trades.map((tr, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "9px 0",
              borderBottom: i === trades.length - 1 ? "none" : "1px solid var(--border)",
              fontSize: 13,
            }}
          >
            <span className={tr.side === "BUY" ? "pill up" : "pill down"} style={{ fontWeight: 700, minWidth: 42 }}>
              {tr.side === "BUY" ? t("trades.side.buy") : t("trades.side.sell")}
            </span>
            <span className="mono" style={{ flex: 1, textAlign: "left", marginLeft: 12 }}>
              {t("trades.tokens", { n: fmtTokens(tr.tokenAmount) })}
            </span>
            <span className="mono muted" style={{ minWidth: 110, textAlign: "right" }}>
              {tr.zecAmount.toFixed(6)} ZEC
              {formatUsd(tr.zecAmount, usdRate) && (
                <div style={{ fontSize: 11 }}>{formatUsd(tr.zecAmount, usdRate)}</div>
              )}
            </span>
            <span className="muted" style={{ minWidth: 70, textAlign: "right", fontSize: 12 }}>
              {timeAgo(tr.createdAt)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
