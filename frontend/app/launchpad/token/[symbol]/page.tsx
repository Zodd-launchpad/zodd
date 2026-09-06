"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, TokenSummary, PricePoint, Trade } from "@/lib/api";
import { useWallet } from "@/lib/wallet";
import BuyModal from "./BuyModal";
import SellModal from "./SellModal";
import Chart from "./Chart";
import TradesList from "./TradesList";

function fmt(n: number, digits = 6) {
  if (n === 0) return "0";
  if (Math.abs(n) < 0.0001) return n.toExponential(2);
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function shortHash(h: string) {
  return `${h.slice(0, 8)}…${h.slice(-6)}`;
}

export default function TokenPage() {
  const { symbol } = useParams<{ symbol: string }>();
  const { wallet } = useWallet();
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
  if (!token) return <div className="container muted">Loading…</div>;

  const volume24h = trades
    .filter((t) => Date.now() - new Date(t.createdAt).getTime() < 24 * 60 * 60 * 1000)
    .reduce((sum, t) => sum + t.zecAmount, 0);

  const gradPct = Math.min(100, (token.realZecReserves / token.graduationThresholdZec) * 100);

  return (
    <div className="container" style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 24, alignItems: "start" }}>
      <div>
        <h1 style={{ marginBottom: 0 }}>{token.symbol}</h1>
        <p className="muted">{token.name}</p>

        <Chart history={history} trades={trades} />
        <TradesList trades={trades} />
      </div>

      <div>
        <div className="card">
          <p style={{ marginTop: 0 }}>
            Price: <strong>{fmt(token.priceZec, 12)} ZEC</strong>
          </p>
          <button className="btn btn-green" style={{ width: "100%", marginBottom: 8 }} onClick={() => setShowBuy(true)} disabled={!wallet}>
            BUY
          </button>
          <button className="btn btn-red" style={{ width: "100%" }} onClick={() => setShowSell(true)} disabled={!wallet}>
            SELL
          </button>
          {!wallet && <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>Connect your wallet above to trade.</p>}
        </div>

        <div className="card" style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>24h volume</div>
            <div style={{ fontWeight: 700 }}>{fmt(volume24h)} ZEC</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>Market cap</div>
            <div style={{ fontWeight: 700 }}>{fmt(token.marketCapZec)} ZEC</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>Real reserve</div>
            <div style={{ fontWeight: 700 }}>{fmt(token.realZecReserves)} ZEC</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>Tokens sold</div>
            <div style={{ fontWeight: 700 }}>{fmt(token.tokensSold, 0)}</div>
          </div>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>Graduation</div>
          <div className="grad-bar">
            <div className="grad-bar-fill" style={{ width: `${gradPct}%` }} />
          </div>
          <p className={token.graduated ? "pill up" : "muted"} style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
            {token.graduated ? "GRADUATED" : `${gradPct.toFixed(1)}% done`}
          </p>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>Token supply</div>
          <div style={{ fontWeight: 700 }}>{fmt(token.totalSupply, 0)} tokens</div>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          {token.onChain.simulated ? (
            <>
              <label className="muted" style={{ fontSize: 11, letterSpacing: 0.5 }}>
                ON CHAIN <span style={{ opacity: 0.6 }}>(simulated)</span>
              </label>
              <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                This demo doesn't broadcast to Zcash mainnet yet — these entries are placeholders for what a real
                shielded-memo inscription will look like.
              </p>
              <div style={{ marginTop: 10, fontSize: 13 }}>
                <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>issued</div>
                <div className="mono-break">{shortHash(token.onChain.issuedTxid)} · block {token.onChain.issuedBlock}</div>
              </div>
              <div style={{ marginTop: 10, fontSize: 13 }}>
                <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>finalized</div>
                <div className="mono-break">{shortHash(token.onChain.finalizedTxid)} · block {token.onChain.finalizedBlock}</div>
              </div>
            </>
          ) : (
            <>
              <label className="muted" style={{ fontSize: 11, letterSpacing: 0.5 }}>
                ON CHAIN <span className="pill up" style={{ marginLeft: 6, fontSize: 10 }}>real</span>
              </label>
              <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                A real 0.01 ZEC shielded transaction was broadcast on Zcash mainnet to inscribe this token's
                creation.
              </p>
              <div style={{ marginTop: 10, fontSize: 13 }}>
                <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>creation txid</div>
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
