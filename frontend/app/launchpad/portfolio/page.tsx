"use client";
import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { api } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

export default function PortfolioPage() {
  const { wallet, loading } = useWallet();
  const { t } = useLanguage();
  const [holdings, setHoldings] = useState<any[] | null>(null);

  useEffect(() => {
    if (!wallet) return;
    api.portfolio(wallet.walletId).then((d) => setHoldings(d.holdings));
  }, [wallet]);

  if (loading) return null;
  if (!wallet) return <div className="container muted">{t("portfolio.connectFirst")}</div>;

  return (
    <div className="container">
      <h1 style={{ fontSize: 18 }}>{t("portfolio.title", { tag: wallet.walletTag })}</h1>
      {holdings && holdings.length === 0 && <p className="muted">{t("portfolio.noHoldings")}</p>}
      {holdings && holdings.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>{t("portfolio.col.token")}</th>
              <th>{t("portfolio.col.amount")}</th>
              <th>{t("portfolio.col.price")}</th>
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
