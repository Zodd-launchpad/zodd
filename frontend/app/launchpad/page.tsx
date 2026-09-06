"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, TokenSummary } from "@/lib/api";

function fmt(n: number, digits = 4) {
  if (n === 0) return "0";
  if (Math.abs(n) < 0.0001) return n.toExponential(2);
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export default function MarketPage() {
  const [tokens, setTokens] = useState<TokenSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const data = await api.listTokens();
        if (!stop) setTokens(data);
      } catch (e: any) {
        if (!stop) setError(e.message);
      }
    }
    load();
    const id = setInterval(load, 2000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="container">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          Market
        </h2>
        <Link href="/launchpad/create" className="btn btn-gold">
          + Create token
        </Link>
      </div>

      {error && (
        <p style={{ color: "var(--red)" }}>
          Could not reach the backend ({error}). Is <code>npm run dev</code> running in /backend?
        </p>
      )}

      {tokens && tokens.length === 0 && <p className="muted">No tokens created yet. Head to Create.</p>}

      {tokens && tokens.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Token</th>
              <th>Price (ZEC)</th>
              <th>Market cap</th>
              <th>Reserve</th>
              <th>Graduation</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.symbol} onClick={() => (location.href = `/launchpad/token/${t.symbol}`)}>
                <td>
                  <strong>{t.symbol}</strong>
                  <div className="muted">{t.name}</div>
                </td>
                <td className="mono">{fmt(t.priceZec, 12)}</td>
                <td className="mono">{fmt(t.marketCapZec)} ZEC</td>
                <td className="mono">{fmt(t.realZecReserves)} ZEC</td>
                <td className={t.graduated ? "pill up" : "muted"}>{t.graduated ? "graduated" : "bonding"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
