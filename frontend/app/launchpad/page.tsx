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

export default function MarketPage() {
  const { t } = useLanguage();
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
          {t("market.heading")}
        </h2>
        <Link href="/launchpad/create" className="btn btn-gold">
          {t("market.createToken")}
        </Link>
      </div>

      {error && (
        <p style={{ color: "var(--red)" }}>{t("market.backendError", { error })}</p>
      )}

      {tokens && tokens.length === 0 && <p className="muted">{t("market.noTokens")}</p>}

      {tokens && tokens.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>{t("market.col.token")}</th>
              <th>{t("market.col.price")}</th>
              <th>{t("market.col.marketCap")}</th>
              <th>{t("market.col.reserve")}</th>
              <th>{t("market.col.graduation")}</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t2) => (
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
                <td className="mono">{fmt(t2.realZecReserves)} ZEC</td>
                <td className={t2.graduated ? "pill up" : "muted"}>{t2.graduated ? t("market.graduated") : t("market.bonding")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
