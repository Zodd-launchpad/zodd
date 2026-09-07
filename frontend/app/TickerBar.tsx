"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, TokenSummary, formatUsd } from "@/lib/api";
import { useZecUsdPrice } from "@/lib/zecPrice";

// Brai, 2026-09-07: "ARMAME UNA BARRA QUE VAYA CIRCULANDO ARRIBA CON LOS
// TOKENS... HACELO FARAONICO, COMO DE PIEDRA" -- a scrolling price ticker,
// styled as a heavy engraved stone slab (warm basalt tones, a bronze/gold
// inlay for the dividers and glow, carved-looking type) rather than the
// generic flat ticker bar every other site/tool reuses. Deliberately its
// own visual register (warm stone + bronze) instead of the site's usual
// cool chrome/silver, so it reads as a distinct "monument", not just
// another header row -- see .ticker-bar in globals.css for the styling.
export default function TickerBar() {
  const [tokens, setTokens] = useState<TokenSummary[] | null>(null);
  const usdRate = useZecUsdPrice();

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const data = await api.listTokens();
        if (!stop) setTokens(data);
      } catch {
        /* silent -- a ticker that briefly can't fetch just keeps showing what it had */
      }
    }
    load();
    const id = setInterval(load, 5000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  if (!tokens || tokens.length === 0) return null;

  // Duplicated once so the CSS animation (translateX 0 -> -50%) loops
  // seamlessly -- the second copy is purely visual filler, hidden from
  // assistive tech.
  const row = (dupKey: string) => (
    <div className="ticker-row" aria-hidden={dupKey === "dup" || undefined}>
      {tokens.map((tok) => {
        const pct = tok.priceChange24hPct;
        const isNew = pct === null;
        const isUp = !isNew && pct >= 0;
        return (
          <Link
            key={`${dupKey}-${tok.symbol}`}
            href={`/launchpad/token/${tok.symbol}`}
            className={`ticker-item ${isNew ? "ticker-neutral" : isUp ? "ticker-up" : "ticker-down"}`}
          >
            <span className="ticker-symbol">{tok.symbol}</span>
            <span className="ticker-price mono">
              {formatUsd(tok.priceZec, usdRate) ?? `${tok.priceZec.toFixed(8)} ZEC`}
            </span>
            <span className="ticker-pct mono">
              {isNew ? "NEW" : `${isUp ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}%`}
            </span>
            <span className="ticker-divider">◆</span>
          </Link>
        );
      })}
    </div>
  );

  return (
    <div className="ticker-bar">
      <div className="ticker-track">
        {row("a")}
        {row("dup")}
      </div>
    </div>
  );
}
