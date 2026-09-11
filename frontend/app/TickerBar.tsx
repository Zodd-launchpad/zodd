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
        // Brai, 2026-09-08: "esa barra tiene que decir cuanto subio o bajo
        // la moneda" -- priceChange24hPct is null for every token here
        // (none is 24h old yet, the platform only launched yesterday), so
        // the ticker fell back to showing "NEW" forever with no real
        // number. Use the true 24h figure once a token has one; until
        // then, fall back to the since-launch figure (a real, non-fabricated
        // number, just not a strict 24h window -- see
        // getPriceChangeSinceLaunchPct in store.ts).
        const pct = tok.priceChange24hPct ?? tok.priceChangeSinceLaunchPct;
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
              {(tok.currency === "ZEC" ? formatUsd(tok.priceZec, usdRate) : null) ?? `${tok.priceZec.toFixed(8)} ${tok.currency}`}
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
