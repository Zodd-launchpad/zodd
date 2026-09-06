"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, TokenSummary } from "@/lib/api";
import { useWallet } from "@/lib/wallet";
import BuyModal from "./BuyModal";
import SellModal from "./SellModal";

function fmt(n: number, digits = 6) {
  if (n === 0) return "0";
  if (Math.abs(n) < 0.0001) return n.toExponential(2);
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export default function TokenPage() {
  const { symbol } = useParams<{ symbol: string }>();
  const { wallet } = useWallet();
  const [token, setToken] = useState<TokenSummary | null>(null);
  const [showBuy, setShowBuy] = useState(false);
  const [showSell, setShowSell] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const t = await api.getToken(symbol);
        if (!stop) setToken(t);
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
  }, [symbol]);

  if (error) return <div className="container">{error}</div>;
  if (!token) return <div className="container muted">Loading…</div>;

  return (
    <div className="container" style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 24 }}>
      <div>
        <h1 style={{ marginBottom: 0 }}>{token.symbol}</h1>
        <p className="muted">{token.name}</p>
        <div className="card">
          <p>
            Price: <strong>{fmt(token.priceZec, 12)} ZEC</strong>
          </p>
          <p className="muted">Market cap: {fmt(token.marketCapZec)} ZEC</p>
          <p className="muted">Real reserve: {fmt(token.realZecReserves)} ZEC</p>
          <p className="muted">Tokens sold by the curve: {fmt(token.tokensSold, 0)}</p>
          <p className={token.graduated ? "pill up" : "muted"}>{token.graduated ? "GRADUATED" : "bonding curve active"}</p>
        </div>
      </div>

      <div className="card" style={{ height: "fit-content" }}>
        <button className="btn btn-green" style={{ width: "100%", marginBottom: 8 }} onClick={() => setShowBuy(true)} disabled={!wallet}>
          BUY
        </button>
        <button className="btn btn-red" style={{ width: "100%" }} onClick={() => setShowSell(true)} disabled={!wallet}>
          SELL
        </button>
        {!wallet && <p className="muted" style={{ marginTop: 10 }}>Connect your wallet above to trade.</p>}
      </div>

      {showBuy && wallet && <BuyModal symbol={token.symbol} walletId={wallet.walletId} onClose={() => setShowBuy(false)} />}
      {showSell && wallet && <SellModal symbol={token.symbol} walletId={wallet.walletId} onClose={() => setShowSell(false)} />}
    </div>
  );
}
