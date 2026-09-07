"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, TokenSummary } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

function fmt(n: number, digits = 4) {
  if (n === 0) return "0";
  if (Math.abs(n) < 0.0001) return n.toExponential(2);
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

// Meme-token prices land absurdly small (e-9, e-10...) once a token has a
// billion-token supply, and "2.80e-9" reads as a bug to anyone who isn't
// used to scientific notation. Same trick DexScreener/Binance use: show the
// count of leading zeros after the decimal point as a small subscript, then
// the first few significant digits -- "0.0₈280" instead of "2.80e-9". Keeps
// the real magnitude visible (nothing is actually rounded away) while
// reading as a clean, non-scary number.
function fmtPrice(n: number) {
  if (n === 0) return "0";
  if (Math.abs(n) >= 0.0001) return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
  const exp = Math.floor(Math.log10(Math.abs(n)));
  const leadingZeros = -exp - 1;
  const mantissa = n / Math.pow(10, exp);
  const digits = mantissa.toFixed(2).replace(".", "").replace("-", "");
  return (
    <>
      0.0<sub>{leadingZeros}</sub>
      {digits}
    </>
  );
}

// Small horizontal bar for the Graduation column -- fills left-to-right
// with the same 0-100 progress the Hourglass on the token page shows,
// so "how close to graduating" is visible at a glance in the list too.
function GraduationBar({ pct, graduated }: { pct: number; graduated: boolean }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 90 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
        <div
          style={{
            width: `${clamped}%`,
            height: "100%",
            background: graduated ? "var(--green)" : "var(--accent)",
            borderRadius: 3,
          }}
        />
      </div>
      <span className="muted" style={{ fontSize: 11, minWidth: 30, textAlign: "right" }}>
        {clamped.toFixed(0)}%
      </span>
    </div>
  );
}

type FilterKey = "new" | "marketCap" | "graduated";

const FILTERS: { key: FilterKey; labelKey: "market.filter.new" | "market.filter.marketCap" | "market.filter.graduated" }[] = [
  { key: "new", labelKey: "market.filter.new" },
  { key: "marketCap", labelKey: "market.filter.marketCap" },
  { key: "graduated", labelKey: "market.filter.graduated" },
];

export default function MarketPage() {
  const { t } = useLanguage();
  const [tokens, setTokens] = useState<TokenSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("new");

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

  const visibleTokens = (() => {
    if (!tokens) return null;
    if (filter === "graduated") {
      return tokens.filter((t2) => t2.graduated).sort((a, b) => b.marketCapZec - a.marketCapZec);
    }
    if (filter === "marketCap") {
      return [...tokens].sort((a, b) => b.marketCapZec - a.marketCapZec);
    }
    // "new": newest first
    return [...tokens].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  })();

  return (
    <div className="container">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          {t("market.heading")}
        </h2>
        <Link href="/launchpad/create" className="btn btn-gold">
          {t("market.createToken")}
        </Link>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className="btn btn-outline"
            style={{
              fontSize: 12,
              padding: "6px 14px",
              borderColor: filter === f.key ? "var(--accent-dim)" : "var(--border)",
              background: filter === f.key ? "var(--border)" : "transparent",
              color: filter === f.key ? "var(--text)" : "var(--text-dim)",
            }}
          >
            {t(f.labelKey)}
          </button>
        ))}
      </div>

      {error && (
        <p style={{ color: "var(--red)" }}>{t("market.backendError", { error })}</p>
      )}

      {tokens && tokens.length === 0 && <p className="muted">{t("market.noTokens")}</p>}

      {visibleTokens && visibleTokens.length === 0 && tokens && tokens.length > 0 && (
        <p className="muted">{t("market.noTokens")}</p>
      )}

      {visibleTokens && visibleTokens.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>{t("market.col.token")}</th>
              <th>{t("market.col.price")}</th>
              <th>{t("market.col.marketCap")}</th>
              <th>{t("market.col.change24h")}</th>
              <th>{t("market.col.graduation")}</th>
            </tr>
          </thead>
          <tbody>
            {visibleTokens.map((t2) => {
              const gradPct = Math.min(100, (t2.realZecReserves / t2.graduationThresholdZec) * 100);
              const change = t2.priceChange24hPct;
              return (
                <tr key={t2.symbol} onClick={() => (location.href = `/launchpad/token/${t2.symbol}`)}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {t2.logoDataUrl ? (
                        <img src={t2.logoDataUrl} alt="" width={28} height={28} style={{ borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
                      ) : (
                        <div style={{ width: 28, height: 28, borderRadius: 6, background: "var(--border)", flexShrink: 0 }} />
                      )}
                      <div>
                        <strong>{t2.symbol}</strong>
                        <div className="muted">{t2.name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="mono">{fmtPrice(t2.priceZec)} ZEC</td>
                  <td className="mono">{fmt(t2.marketCapZec)} ZEC</td>
                  <td className="mono" style={{ color: change == null ? undefined : change > 0 ? "var(--green)" : change < 0 ? "var(--red)" : undefined }}>
                    {change == null ? "—" : `${change > 0 ? "+" : ""}${change.toFixed(2)}%`}
                  </td>
                  <td>
                    <GraduationBar pct={gradPct} graduated={t2.graduated} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
