"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, GlobalTrade } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

const POLL_MS = 4000;
const MAX_ROWS = 18;

// Brai, 2026-09-08: "necsito movimiento en la pagina sino parece que nadie
// esta comprando y vendiendo... hazme un panel a la izquierda que aprezca
// las compras y ventas... como '0.01 zec to ZOOKCAT'. Compras en verdes
// ventas en rojo" -- a small always-on feed of real fills across every
// token (backed by GET /api/trades, store.getRecentTradesGlobal), fixed to
// the left edge on wide screens. Shows actual FILLED orders only, same
// source of truth as the per-token TradesList -- never synthetic data.
function rowKey(tr: GlobalTrade, i: number) {
  return `${tr.createdAt}-${tr.symbol}-${tr.side}-${tr.zecAmount}-${i}`;
}

function timeAgo(iso: string, t: ReturnType<typeof useLanguage>["t"]): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(diffMs / 1000));
  if (s < 60) return t("trades.ago.seconds", { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t("trades.ago.minutes", { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("trades.ago.hours", { n: h });
  return t("trades.ago.days", { n: Math.floor(h / 24) });
}

export default function ActivityFeed() {
  const { t } = useLanguage();
  const [trades, setTrades] = useState<GlobalTrade[] | null>(null);
  // Forces the timestamps ("12s ago") to re-render on their own, independent
  // of the 4s data poll -- otherwise "12s ago" would freeze until the next
  // fetch actually returns new data.
  const [, setTick] = useState(0);
  const stopRef = useRef(false);

  useEffect(() => {
    stopRef.current = false;
    async function load() {
      try {
        const data = await api.getRecentTradesGlobal();
        if (!stopRef.current) setTrades(data.slice(0, MAX_ROWS));
      } catch {
        /* silent -- same posture as TickerBar: a feed that can't fetch just keeps showing what it had */
      }
    }
    load();
    const id = setInterval(load, POLL_MS);
    const tickId = setInterval(() => setTick((n) => n + 1), 1000);
    return () => {
      stopRef.current = true;
      clearInterval(id);
      clearInterval(tickId);
    };
  }, []);

  if (trades !== null && trades.length === 0) return null;

  return (
    <div className="activity-feed">
      <label className="muted activity-feed-heading">{t("activity.heading")}</label>
      <div className="activity-feed-list">
        {trades === null
          ? null
          : trades.map((tr, i) => (
              <Link
                key={rowKey(tr, i)}
                href={`/launchpad/token/${tr.symbol}`}
                className="activity-row"
              >
                <span className={tr.side === "BUY" ? "activity-row-amount up" : "activity-row-amount down"}>
                  {tr.zecAmount.toFixed(4)} ZEC <span className="activity-row-arrow">→</span> {tr.symbol}
                </span>
                <span className="muted activity-row-time">{timeAgo(tr.createdAt, t)}</span>
              </Link>
            ))}
      </div>
    </div>
  );
}
