"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, TokenSummary, formatCompactUsd } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { useZecUsdPrice } from "@/lib/zecPrice";
import { isOfficialToken, OfficialCheckmark } from "../OfficialBadge";

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

// Tiny inline icons for the twitter/website links under a token's name in
// the market table (Brai, 2026-09-07: "un mini link (un icono)"). Kept as
// inline SVG paths -- no icon library in this project -- and each link
// stops the click from bubbling to the row's onClick (which navigates to
// the token page), since these should just open the external link.
function TwitterIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
function WebsiteIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 3.8 5.6 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.6-3.8-9s1.3-6.5 3.8-9z" />
    </svg>
  );
}
function TokenLinks({ twitterUrl, websiteUrl }: { twitterUrl: string | null; websiteUrl: string | null }) {
  if (!twitterUrl && !websiteUrl) return null;
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
      {twitterUrl && (
        <a
          href={twitterUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="muted"
          style={{ display: "inline-flex", color: "inherit" }}
          title="Twitter / X"
        >
          <TwitterIcon />
        </a>
      )}
      {websiteUrl && (
        <a
          href={websiteUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="muted"
          style={{ display: "inline-flex", color: "inherit" }}
          title="Website"
        >
          <WebsiteIcon />
        </a>
      )}
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
  const usdRate = useZecUsdPrice();
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
              // Brai, 2026-09-08: "el panel de 24 horas ahi no funciona" /
              // "si durante 24 horas no hubo actividad deja la actividad
              // de las ultimas 24 horas" -- priceChange24hPct is null for
              // any token under 24h old (which, as of 2026-09-08, is every
              // token here -- the platform launched yesterday), so this
              // column was permanently "—". Same fallback as the top
              // ticker: use the real 24h figure once a token has one,
              // otherwise fall back to its since-launch change instead of
              // sitting blank.
              const change = t2.priceChange24hPct ?? t2.priceChangeSinceLaunchPct;
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
                        <strong style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                          {t2.symbol}
                          {isOfficialToken(t2.symbol) && <OfficialCheckmark />}
                        </strong>
                        <div className="muted">{t2.name}</div>
                        <TokenLinks twitterUrl={t2.twitterUrl} websiteUrl={t2.websiteUrl} />
                      </div>
                    </div>
                  </td>
                  <td className="mono">
                    {fmtPrice(t2.priceZec)} ZEC
                  </td>
                  <td className="mono">
                    {fmt(t2.marketCapZec)} ZEC
                    {formatCompactUsd(t2.marketCapZec, usdRate) && (
                      <div className="muted" style={{ fontSize: 11 }}>{formatCompactUsd(t2.marketCapZec, usdRate)}</div>
                    )}
                  </td>
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
