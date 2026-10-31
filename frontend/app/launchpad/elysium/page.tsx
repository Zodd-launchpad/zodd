"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { listTokens, type ElysiumToken } from "@/lib/elysium";
import { BridgeBox, ConnectBox, fmtHype, fmtNum, fmtPrice, useEvmAccount, useHypeBalance } from "./shared";

type SortKey = "mcap" | "newest" | "volume";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "mcap", label: "Market cap" },
  { key: "newest", label: "New" },
  { key: "volume", label: "24h volume" },
];

export default function ElysiumMarketPage() {
  const { account, connect, error: connectError } = useEvmAccount();
  const [refresh, setRefresh] = useState(0);
  const balance = useHypeBalance(account, refresh);
  const [sort, setSort] = useState<SortKey>("mcap");
  const [search, setSearch] = useState("");
  const [onlyTradable, setOnlyTradable] = useState(true);
  const [tokens, setTokens] = useState<ElysiumToken[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const load = () =>
      listTokens({ sort, search, limit: 100 })
        .then((t) => {
          if (!stop) {
            setTokens(t);
            setError(null);
          }
        })
        .catch((e) => !stop && setError(e.message));
    const delay = setTimeout(load, search ? 350 : 0);
    const id = setInterval(load, 30000);
    return () => {
      stop = true;
      clearTimeout(delay);
      clearInterval(id);
    };
  }, [sort, search]);

  const visible = tokens?.filter((t) => !onlyTradable || t.tradable) ?? null;

  return (
    <div className="container">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Elysium · HYPE
          </h2>
          <div className="muted" style={{ fontSize: 12 }}>
            Elysium tokens (chain 99901), traded with native HYPE through the BOXA RPC.
          </div>
        </div>
        <Link href="/launchpad/elysium/create" className="btn btn-gold">
          Launch on Elysium
        </Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginBottom: 18 }}>
        {account ? (
          <>
            <div className="card" style={{ padding: 14 }}>
              <div className="muted" style={{ fontSize: 12 }}>Your wallet</div>
              <div className="mono" style={{ fontSize: 13 }}>
                {account.slice(0, 6)}…{account.slice(-4)}
              </div>
              <div style={{ marginTop: 8, fontSize: 18, fontWeight: 600 }}>{fmtHype(balance)} HYPE</div>
              <div className="muted" style={{ fontSize: 11 }}>balance on Elysium</div>
            </div>
            <BridgeBox account={account} onDeposited={() => setRefresh((r) => r + 1)} />
          </>
        ) : (
          <ConnectBox onConnect={connect} error={connectError} />
        )}
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        {SORTS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSort(s.key)}
            className="btn btn-outline"
            style={{
              fontSize: 12,
              padding: "6px 14px",
              borderColor: sort === s.key ? "var(--accent-dim)" : "var(--border)",
              background: sort === s.key ? "var(--border)" : "transparent",
              color: sort === s.key ? "var(--text)" : "var(--text-dim)",
            }}
          >
            {s.label}
          </button>
        ))}
        <label className="muted" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 6 }}>
          <input type="checkbox" checked={onlyTradable} onChange={(e) => setOnlyTradable(e.target.checked)} />
          Only tradable on ZODD
        </label>
        <input
          className="ely-input"
          placeholder="Search name, ticker or address"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 300, marginLeft: "auto", padding: "7px 10px" }}
        />
      </div>

      {error && <p style={{ color: "var(--red)" }}>{error}</p>}
      {!tokens && !error && <p className="muted">Loading tokens…</p>}
      {visible && visible.length === 0 && <p className="muted">No tokens to show.</p>}

      {visible && visible.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Token</th>
              <th>Price</th>
              <th>Market cap</th>
              <th>24h volume</th>
              <th>24h</th>
              <th>Holders</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t) => (
              <tr key={t.address} onClick={() => (location.href = `/launchpad/elysium/token/${t.address}`)}>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {t.image ? (
                      <img src={t.image} alt="" width={28} height={28} style={{ borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 28, height: 28, borderRadius: 6, background: "var(--border)", flexShrink: 0 }} />
                    )}
                    <div>
                      <strong style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        {t.symbol}
                        <span className="ely-badge">HYPE</span>
                        {t.launchedFromZodd && <span className="ely-badge">ZODD</span>}
                      </strong>
                      <div className="muted">{t.name}</div>
                    </div>
                  </div>
                </td>
                <td className="mono">{fmtPrice(t.priceHype)} HYPE</td>
                <td className="mono">{fmtNum(t.marketCapHype)} HYPE</td>
                <td className="mono">{fmtNum(t.volume24hHype)} HYPE</td>
                <td
                  className="mono"
                  style={{ color: t.priceChange24h == null ? undefined : t.priceChange24h > 0 ? "var(--green)" : t.priceChange24h < 0 ? "var(--red)" : undefined }}
                >
                  {t.priceChange24h == null ? "—" : `${t.priceChange24h > 0 ? "+" : ""}${t.priceChange24h.toFixed(2)}%`}
                </td>
                <td className="mono">{t.holders ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
