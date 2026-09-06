"use client";
import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { api } from "@/lib/api";

export default function PortfolioPage() {
  const { wallet, loading } = useWallet();
  const [holdings, setHoldings] = useState<any[] | null>(null);

  useEffect(() => {
    if (!wallet) return;
    api.portfolio(wallet.walletId).then((d) => setHoldings(d.holdings));
  }, [wallet]);

  if (loading) return null;
  if (!wallet) return <div className="container muted">Connect your wallet above to see your portfolio.</div>;

  return (
    <div className="container">
      <h1 style={{ fontSize: 18 }}>Portfolio — {wallet.walletTag}</h1>
      {holdings && holdings.length === 0 && <p className="muted">No holdings yet.</p>}
      {holdings && holdings.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Token</th>
              <th>Amount</th>
              <th>Price</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => (
              <tr key={h.symbol} onClick={() => (location.href = `/launchpad/token/${h.symbol}`)}>
                <td>{h.symbol}</td>
                <td>{h.amount.toFixed(0)}</td>
                <td>{h.priceZec.toExponential(3)} ZEC</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
