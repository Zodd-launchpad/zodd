"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, TokenSummary, PricePoint, Trade, formatUsd } from "@/lib/api";
import { useWallet } from "@/lib/wallet";
import { useLanguage } from "@/lib/i18n";
import { useZecUsdPrice } from "@/lib/zecPrice";
import BuyModal from "./BuyModal";
import SellModal from "./SellModal";
import Chart from "./Chart";
import TradesList from "./TradesList";
import Hourglass from "./Hourglass";
import { isOfficialToken, OfficialCheckmark, OfficialPill } from "@/app/OfficialBadge";

// Same subscript-leading-zeros trick as fmtPrice in the Launchpad list page
// (see its comment there): a tiny ZEC amount like a 1% creator fee on a
// 0.00003 ZEC test buy used to render as "3.00e-7 ZEC" via toExponential,
// which reads as "3 ZEC" at a glance if you're not used to exponential
// notation -- Brai flagged exactly this ("no puede haber 3 zec de
// ganancia... no compré ni 0.01 zec") on a value that was actually
// 0.0000003 ZEC, correctly tiny. This renders it as "0.0₆300" instead --
// same real magnitude, nothing rounded away, but unambiguous at a glance.
function fmt(n: number, digits = 6) {
  if (n === 0) return "0";
  if (Math.abs(n) >= 0.0001) return n.toLocaleString("en-US", { maximumFractionDigits: digits });
  const exp = Math.floor(Math.log10(Math.abs(n)));
  const leadingZeros = -exp - 1;
  const mantissa = n / Math.pow(10, exp);
  const mantissaDigits = mantissa.toFixed(2).replace(".", "").replace("-", "");
  return (
    <>
      0.0<sub>{leadingZeros}</sub>
      {mantissaDigits}
    </>
  );
}

function shortHash(h: string) {
  return `${h.slice(0, 8)}…${h.slice(-6)}`;
}

export default function TokenPage() {
  const { symbol } = useParams<{ symbol: string }>();
  const { wallet } = useWallet();
  const { t } = useLanguage();
  const usdRate = useZecUsdPrice();
  const [token, setToken] = useState<TokenSummary | null>(null);
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [showBuy, setShowBuy] = useState(false);
  const [showSell, setShowSell] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const [t, h, tr] = await Promise.all([api.getToken(symbol), api.getHistory(symbol), api.getTrades(symbol)]);
        if (!stop) {
          setToken(t);
          setHistory(h);
          setTrades(tr);
        }
      } catch (e: any) {
        if (!stop) setError(e.message);
      }
    }
    load();
    const id = setInterval(load, 3000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [symbol]);

  if (error) return <div className="container">{error}</div>;
  if (!token) return <div className="container muted">{t("token.loading")}</div>;

  const volume24h = trades
    .filter((t) => Date.now() - new Date(t.createdAt).getTime() < 24 * 60 * 60 * 1000)
    .reduce((sum, t) => sum + t.zecAmount, 0);

  const gradPct = Math.min(100, (token.realZecReserves / token.graduationThresholdZec) * 100);

  return (
    <div className="container" style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 24, alignItems: "start" }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {token.logoDataUrl && (
            <img src={token.logoDataUrl} alt="" width={48} height={48} style={{ borderRadius: 10, objectFit: "cover" }} />
          )}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h1 style={{ marginBottom: 0 }}>{token.symbol}</h1>
              {isOfficialToken(token.symbol) && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <OfficialCheckmark size={18} />
                  <OfficialPill />
                </span>
              )}
            </div>
            <p className="muted" style={{ margin: 0 }}>{token.name}</p>
          </div>
        </div>
        {(token.description || token.twitterUrl || token.websiteUrl) && (
          <div style={{ marginTop: 10 }}>
            {token.description && <p className="muted" style={{ fontSize: 13 }}>{token.description}</p>}
            <div style={{ display: "flex", gap: 8 }}>
              {token.twitterUrl && (
                <a href={token.twitterUrl} target="_blank" rel="noreferrer" className="btn btn-outline" style={{ fontSize: 12, display: "inline-block" }}>
                  {t("token.viewOnX")}
                </a>
              )}
              {token.websiteUrl && (
                <a href={token.websiteUrl} target="_blank" rel="noreferrer" className="btn btn-outline" style={{ fontSize: 12, display: "inline-block" }}>
                  {t("token.viewWebsite")}
                </a>
              )}
            </div>
          </div>
        )}

        <Chart history={history} trades={trades} />
        <TradesList trades={trades} />
      </div>

      <div>
        <div className="card">
          <p style={{ marginTop: 0 }}>
            {t("token.price")} <strong>{fmt(token.priceZec, 12)} ZEC</strong>
            {formatUsd(token.priceZec, usdRate) && (
              <span className="muted" style={{ marginLeft: 6 }}>({formatUsd(token.priceZec, usdRate)})</span>
            )}
          </p>
          <button className="btn btn-green" style={{ width: "100%", marginBottom: 8 }} onClick={() => setShowBuy(true)} disabled={!wallet}>
            {t("token.buy")}
          </button>
          <button className="btn btn-red" style={{ width: "100%" }} onClick={() => setShowSell(true)} disabled={!wallet}>
            {t("token.sell")}
          </button>
          {!wallet && <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>{t("token.connectToTrade")}</p>}
        </div>

        <div className="card" style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("token.stat.volume24h")}</div>
            <div style={{ fontWeight: 700 }}>{fmt(volume24h)} ZEC</div>
            {formatUsd(volume24h, usdRate) && <div className="muted" style={{ fontSize: 11 }}>{formatUsd(volume24h, usdRate)}</div>}
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("token.stat.marketCap")}</div>
            <div style={{ fontWeight: 700 }}>{fmt(token.marketCapZec)} ZEC</div>
            {formatUsd(token.marketCapZec, usdRate) && <div className="muted" style={{ fontSize: 11 }}>{formatUsd(token.marketCapZec, usdRate)}</div>}
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("token.stat.realReserve")}</div>
            <div style={{ fontWeight: 700 }}>{fmt(token.realZecReserves)} ZEC</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("token.stat.tokensSold")}</div>
            <div style={{ fontWeight: 700 }}>{fmt(token.tokensSold, 0)}</div>
          </div>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("token.graduation")}</div>
          <Hourglass pct={gradPct} />
          <p className={token.graduated ? "pill up" : "muted"} style={{ marginTop: 4, marginBottom: 0, fontSize: 12, textAlign: "center" }}>
            {token.graduated ? t("token.graduated") : t("token.pctDone", { pct: gradPct.toFixed(1) })}
          </p>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("token.supply")}</div>
          <div style={{ fontWeight: 700 }}>{t("token.supplyUnit", { n: token.totalSupply.toLocaleString("en-US", { maximumFractionDigits: 0 }) })}</div>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <label className="muted" style={{ fontSize: 11, letterSpacing: 0.5 }}>{t("token.fee.heading")}</label>
          <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>{t("token.fee.explain")}</p>
          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("token.fee.accrued")}</div>
              <div style={{ fontWeight: 700 }}>{fmt(token.fee.creatorFeeAccruedZec, 8)} ZEC</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("token.fee.paid")}</div>
              <div style={{ fontWeight: 700 }}>{fmt(token.fee.creatorFeeTotalPaidZec, 8)} ZEC</div>
            </div>
          </div>
          {token.fee.creatorPayoutAddress ? (
            <div style={{ marginTop: 10, fontSize: 12 }}>
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("token.fee.payoutTo")}</div>
              <div className="mono-break">{shortHash(token.fee.creatorPayoutAddress)}</div>
              <div className="muted" style={{ marginTop: 4 }}>
                {token.fee.lastFeePayoutAt ? t("token.fee.lastPayout", { when: new Date(token.fee.lastFeePayoutAt).toLocaleString() }) : t("token.fee.neverPaid")}
              </div>
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>{t("token.fee.noAddress")}</p>
          )}
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          {token.onChain.simulated ? (
            <>
              <label className="muted" style={{ fontSize: 11, letterSpacing: 0.5 }}>
                {t("token.onChain.simulatedLabel")} <span style={{ opacity: 0.6 }}>{t("token.onChain.simulatedTag")}</span>
              </label>
              <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                {t("token.onChain.simulatedBody")}
              </p>
              <div style={{ marginTop: 10, fontSize: 13 }}>
                <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("token.onChain.issued")}</div>
                <div className="mono-break">{shortHash(token.onChain.issuedTxid)} · block {token.onChain.issuedBlock}</div>
              </div>
              <div style={{ marginTop: 10, fontSize: 13 }}>
                <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("token.onChain.finalized")}</div>
                <div className="mono-break">{shortHash(token.onChain.finalizedTxid)} · block {token.onChain.finalizedBlock}</div>
              </div>
            </>
          ) : (
            <>
              <label className="muted" style={{ fontSize: 11, letterSpacing: 0.5 }}>
                {t("token.onChain.simulatedLabel")} <span className="pill up" style={{ marginLeft: 6, fontSize: 10 }}>{t("token.onChain.realTag")}</span>
              </label>
              <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                {t("token.onChain.realBody")}
              </p>
              <div style={{ marginTop: 10, fontSize: 13 }}>
                <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("token.onChain.creationTxid")}</div>
                <a
                  className="mono-break"
                  href={token.onChain.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "inherit", textDecoration: "underline" }}
                >
                  {shortHash(token.onChain.txid)}
                </a>
              </div>
            </>
          )}
        </div>
      </div>

      {showBuy && wallet && <BuyModal symbol={token.symbol} walletId={wallet.walletId} onClose={() => setShowBuy(false)} />}
      {showSell && wallet && <SellModal symbol={token.symbol} walletId={wallet.walletId} onClose={() => setShowSell(false)} />}
    </div>
  );
}
