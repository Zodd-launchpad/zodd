import type { Trade } from "@/lib/api";

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(diffMs / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtTokens(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export default function TradesList({ trades }: { trades: Trade[] }) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <label className="muted" style={{ fontSize: 11, letterSpacing: 0.5 }}>RECENT TRADES</label>
      {trades.length === 0 && (
        <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>No trades yet — be the first to buy.</p>
      )}
      <div style={{ marginTop: 8 }}>
        {trades.map((t, i) => (
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
            <span className={t.side === "BUY" ? "pill up" : "pill down"} style={{ fontWeight: 700, minWidth: 42 }}>
              {t.side}
            </span>
            <span className="mono" style={{ flex: 1, textAlign: "left", marginLeft: 12 }}>
              {fmtTokens(t.tokenAmount)} tokens
            </span>
            <span className="mono muted" style={{ minWidth: 110, textAlign: "right" }}>
              {t.zecAmount.toFixed(6)} ZEC
            </span>
            <span className="muted" style={{ minWidth: 70, textAlign: "right", fontSize: 12 }}>
              {timeAgo(t.createdAt)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
