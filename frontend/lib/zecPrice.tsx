"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api } from "./api";

// Brai, 2026-09-07: "no, tiene que tener precio en dolares, todo" -- one
// shared poll for the live ZEC/USD rate (backend-cached, see zecPrice.ts
// there) instead of every price-showing component fetching it on its own.
// null just means "no rate yet" (first few seconds after a fresh page
// load) -- every price display should hide the USD figure in that case,
// never show a wrong "$0.00".
const POLL_INTERVAL_MS = 30_000;

const Ctx = createContext<number | null>(null);

export function ZecPriceProvider({ children }: { children: ReactNode }) {
  const [usd, setUsd] = useState<number | null>(null);

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const data = await api.getZecUsdPrice();
        if (!stop && data.usd !== null) setUsd(data.usd);
      } catch {
        /* silent -- keep showing the last known rate (or nothing yet) */
      }
    }
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  return <Ctx.Provider value={usd}>{children}</Ctx.Provider>;
}

/** Live ZEC/USD rate, or null until the first successful poll lands. */
export function useZecUsdPrice(): number | null {
  return useContext(Ctx);
}
