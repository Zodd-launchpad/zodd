"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/lib/wallet";
import { api, formatUsd, nftItemPath, nftItemLabel, type NftItem } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { useZecUsdPrice } from "@/lib/zecPrice";

export default function PortfolioPage() {
  const { wallet, loading } = useWallet();
  const { t } = useLanguage();
  const usdRate = useZecUsdPrice();
  const [holdings, setHoldings] = useState<any[] | null>(null);
  // Brai, 2026-09-18 (NFT marketplace launch): "en portfolio tambien tienen
  // que aparecer los NFTs que tenes" -- same wallet, its owned pieces
  // straight from GET /api/wallets/:id/nfts (store.getWalletNfts).
  const [nfts, setNfts] = useState<NftItem[] | null>(null);

  useEffect(() => {
    if (!wallet) return;
    api.portfolio(wallet.walletId).then((d) => setHoldings(d.holdings));
    api.getWalletNfts(wallet.walletId).then(setNfts).catch(() => setNfts([]));
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
              <th>{t("portfolio.col.value")}</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => {
              const valueZec = h.amount * h.priceZec;
              return (
                <tr key={h.symbol} onClick={() => (location.href = `/launchpad/token/${h.symbol}`)}>
                  <td>{h.symbol} <span className="muted" style={{ fontSize: 10 }}>{h.currency}</span></td>
                  <td>{h.amount.toFixed(0)}</td>
                  <td>
                    {h.priceZec.toExponential(3)} {h.currency}
                    {h.currency === "ZEC" && formatUsd(h.priceZec, usdRate) && <div className="muted" style={{ fontSize: 11 }}>{formatUsd(h.priceZec, usdRate)}</div>}
                  </td>
                  <td>
                    {valueZec.toFixed(6)} {h.currency}
                    {h.currency === "ZEC" && formatUsd(valueZec, usdRate) && <div className="muted" style={{ fontSize: 11 }}>{formatUsd(valueZec, usdRate)}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {nfts && nfts.length > 0 && (
        <>
          <h2 style={{ fontSize: 15, marginTop: 28 }}>{t("portfolio.nfts.title")}</h2>
          <div className="nft-grid">
            {nfts.map((it) => (
              <Link key={it.id} href={nftItemPath(it.editionNumber, it.tier)} className="nft-card">
                <div className="nft-card-img-wrap">
                  {it.imageDataUrl ? (
                    <img src={it.imageDataUrl} alt={it.name ?? nftItemLabel(it.tier, it.editionNumber)} className="nft-card-img" />
                  ) : (
                    <div className="nft-card-img-placeholder">?</div>
                  )}
                </div>
                <div className="nft-card-body">
                  <span className="nft-card-name">{it.name ?? nftItemLabel(it.tier, it.editionNumber)}</span>
                  <span className="nft-card-price">{it.listedPriceZec != null ? t("portfolio.nfts.listed") : t("portfolio.nfts.unlisted")}</span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
