"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatUsd, type PricePoint, type Trade } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { useZecUsdPrice } from "@/lib/zecPrice";

const INTERVALS = [
  { key: "5m", tkey: "chart.interval.5m" as const, ms: 5 * 60_000 },
  { key: "15m", tkey: "chart.interval.15m" as const, ms: 15 * 60_000 },
  { key: "1h", tkey: "chart.interval.1h" as const, ms: 60 * 60_000 },
  { key: "4h", tkey: "chart.interval.4h" as const, ms: 4 * 60 * 60_000 },
  { key: "all", tkey: "chart.interval.all" as const, ms: 0 },
] as const;

type IntervalKey = (typeof INTERVALS)[number]["key"];
type Mode = "MCAP" | "PRICE";

interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function bucketSizeMs(key: IntervalKey, points: PricePoint[]): number {
  if (key !== "all") return INTERVALS.find((i) => i.key === key)!.ms;
  if (points.length < 2) return 5 * 60_000;
  const span = new Date(points[points.length - 1].createdAt).getTime() - new Date(points[0].createdAt).getTime();
  return Math.max(5 * 60_000, Math.ceil(span / 60));
}

function buildCandles(points: PricePoint[], trades: Trade[], mode: Mode, bucketMs: number): Candle[] {
  if (points.length === 0) return [];
  const field = mode === "MCAP" ? "mcapZec" : "priceZec";
  const start = Math.floor(new Date(points[0].createdAt).getTime() / bucketMs) * bucketMs;
  const end = new Date(points[points.length - 1].createdAt).getTime();

  const buckets = new Map<number, number[]>();
  for (const p of points) {
    const t = new Date(p.createdAt).getTime();
    const key = Math.floor(t / bucketMs) * bucketMs;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(p[field]);
  }
  const volBuckets = new Map<number, number>();
  for (const tr of trades) {
    const t = new Date(tr.createdAt).getTime();
    const key = Math.floor(t / bucketMs) * bucketMs;
    volBuckets.set(key, (volBuckets.get(key) ?? 0) + tr.zecAmount);
  }

  const candles: Candle[] = [];
  let prevClose = points[0][field];
  for (let t = start; t <= end; t += bucketMs) {
    const vals = buckets.get(t);
    const open = prevClose;
    const high = vals ? Math.max(open, ...vals) : open;
    const low = vals ? Math.min(open, ...vals) : open;
    const close = vals ? vals[vals.length - 1] : open;
    candles.push({ time: Math.floor(t / 1000), open, high, low, close, volume: volBuckets.get(t) ?? 0 });
    prevClose = close;
  }
  return candles;
}

function fmtNum(n: number) {
  if (n === 0) return "0";
  if (Math.abs(n) < 0.0001) return n.toExponential(4);
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

export default function Chart({ history, trades }: { history: PricePoint[]; trades: Trade[] }) {
  const { t } = useLanguage();
  const usdRate = useZecUsdPrice();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const candleSeriesRef = useRef<any>(null);
  const volSeriesRef = useRef<any>(null);
  const [interval, setInterval_] = useState<IntervalKey>("1h");
  const [mode, setMode] = useState<Mode>("MCAP");

  const candles = useMemo(() => {
    const ms = bucketSizeMs(interval, history);
    return buildCandles(history, trades, mode, ms);
  }, [history, trades, interval, mode]);

  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;

    import("lightweight-charts").then(({ createChart, CandlestickSeries, HistogramSeries }) => {
      if (disposed || !containerRef.current) return;
      const chart = createChart(containerRef.current, {
        layout: { background: { color: "transparent" }, textColor: "#8a8a92", fontSize: 11 },
        grid: { vertLines: { color: "#1c1c1f" }, horzLines: { color: "#1c1c1f" } },
        rightPriceScale: { borderColor: "#2a2a2e" },
        timeScale: { borderColor: "#2a2a2e", timeVisible: true },
        crosshair: { mode: 0 },
        height: 360,
      });
      chartRef.current = chart;

      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: "#16c784",
        downColor: "#ea3943",
        borderVisible: false,
        wickUpColor: "#16c784",
        wickDownColor: "#ea3943",
      });
      candleSeriesRef.current = candleSeries;

      const volSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "vol",
      });
      volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      volSeriesRef.current = volSeries;

      ro = new ResizeObserver(() => {
        if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
      });
      ro.observe(containerRef.current);
    });

    return () => {
      disposed = true;
      ro?.disconnect();
      chartRef.current?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!candleSeriesRef.current || !volSeriesRef.current) return;
    candleSeriesRef.current.setData(candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    volSeriesRef.current.setData(
      candles.map((c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? "rgba(22,199,132,0.5)" : "rgba(234,57,67,0.5)" }))
    );
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  const last = candles[candles.length - 1];

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--border)", flexWrap: "wrap", gap: 8 }}>
        <div className="mono" style={{ fontSize: 12, color: "var(--text-dim)", display: "flex", gap: 14, flexWrap: "wrap" }}>
          <span style={{ color: "var(--text)", fontWeight: 700 }}>{mode === "MCAP" ? t("chart.mode.mcap") : t("chart.mode.price")}</span>
          {last && (
            <>
              <span>{t("chart.o")} <span style={{ color: "var(--text)" }}>{fmtNum(last.open)}</span></span>
              <span>{t("chart.h")} <span style={{ color: "var(--text)" }}>{fmtNum(last.high)}</span></span>
              <span>{t("chart.l")} <span style={{ color: "var(--text)" }}>{fmtNum(last.low)}</span></span>
              <span>
                {t("chart.c")} <span style={{ color: "var(--text)" }}>{fmtNum(last.close)}</span> ZEC
                {formatUsd(last.close, usdRate) && <span> ({formatUsd(last.close, usdRate)})</span>}
              </span>
              <span>
                {t("chart.vol")} <span style={{ color: "var(--text)" }}>{fmtNum(last.volume)}</span> ZEC
                {formatUsd(last.volume, usdRate) && <span> ({formatUsd(last.volume, usdRate)})</span>}
              </span>
            </>
          )}
        </div>
      </div>

      <div ref={containerRef} style={{ width: "100%" }} />

      <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 16px", borderTop: "1px solid var(--border)" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {INTERVALS.map((i) => (
            <button
              key={i.key}
              onClick={() => setInterval_(i.key)}
              className="btn btn-outline"
              style={{
                padding: "4px 10px",
                fontSize: 11,
                borderColor: interval === i.key ? "var(--accent-dim)" : "var(--border)",
                color: interval === i.key ? "var(--accent)" : "var(--text-dim)",
              }}
            >
              {t(i.tkey)}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {(["MCAP", "PRICE"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="btn btn-outline"
              style={{
                padding: "4px 10px",
                fontSize: 11,
                borderColor: mode === m ? "var(--accent-dim)" : "var(--border)",
                color: mode === m ? "var(--accent)" : "var(--text-dim)",
              }}
            >
              {m === "MCAP" ? t("chart.mode.mcap") : t("chart.mode.price")}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
