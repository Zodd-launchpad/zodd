"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, TokenSummary } from "./api";

// Brai, 2026-09-21: "no puede estar consumiendo tanto la pagina" -- Railway
// showed ~$28 and hundreds of GB of egress piling up fast. Same root cause
// as the ActivityFeed incident documented in ActivityFeed.tsx (306GB / $15
// in 14 days from a 4s poll), except worse here: TickerBar (site-wide,
// every page) AND HomeTokenBoards (home page) were EACH independently
// polling GET /api/tokens every 5 SECONDS, and that response embeds every
// token's full logoDataUrl inline -- ~307KB for just 16 tokens today, most
// of it images that essentially never change. On the home page both
// components were polling at once, so it was being fetched TWICE every 5s.
//
// Fix, same shape as ZecPriceProvider below (one shared poll instead of
// each component fetching on its own): a single site-wide interval, slower
// (20s -- same cadence ActivityFeed settled on: "sigue viendose vivo, a
// una fraccion del trafico"), shared by every consumer via context.
// TickerBar and HomeTokenBoards both switch to useTokenList() instead of
// polling api.listTokens() themselves.
const POLL_INTERVAL_MS = 20_000;

const Ctx = createContext<TokenSummary[] | null>(null);

export function TokenListProvider({ children }: { children: ReactNode }) {
  const [tokens, setTokens] = useState<TokenSummary[] | null>(null);

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const data = await api.listTokens();
        if (!stop) setTokens(data);
      } catch {
        /* silent -- keep showing the last known list */
      }
    }
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  return <Ctx.Provider value={tokens}>{children}</Ctx.Provider>;
}

/** The live token list (site-wide, one shared poll), or null until the
 * first successful fetch lands. */
export function useTokenList(): TokenSummary[] | null {
  return useContext(Ctx);
}
