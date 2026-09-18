"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, formatUsd, formatZec, type NftCollection, type NftItem, type NftActivity } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { useZecUsdPrice } from "@/lib/zecPrice";

// Brai, 2026-09-18: "empeza a deployar el marketplace ... te envio una
// pagina que me gustaria copiar, sencilla: zecrocks.cash/market ... no me
// gusta que te diga los holders, esa parte sacala" -- same overall shape as
// that reference (a stats header, a grid of the collection's pieces, a
// recent-sales list) rebuilt on ZODD's own design system, and with NO
// holders/owner leaderboard anywhere -- only a Market tab and a Sales tab.
//
// Deliberately at /nft/test, not /nft (still the "coming soon" page) --
// Brai: "en una url escondida que sea como zodd.fun/NFT/TEST y luego lo
// mandamos a zodd.fun/nft" once he's happy with it.
const COLLECTION_SLUG = "zodd-genesis";

type Tab = "market" | "sales";

export default function NftMarketTestPage() {
  const { t } = useLanguage();
  const usdRate = useZecUsdPrice();
  const [collection, setCollection] = useState<NftCollection | null | undefined>(undefined); // undefined = loading, null = not configured yet
  const [items, setItems] = useState<NftItem[] | null>(null);
  const [tab, setTab] = useState<Tab>("market");
  const [sales, setSales] = useState<NftActivity[] | null>(null);

  useEffect(() => {
    api
      .getNftCollection(COLLECTION_SLUG)
      .then(setCollection)
      .catch(() => setCollection(null));
  }, []);

  useEffect(() => {
    if (!collection) return;
    api
      .getNftItems(COLLECTION_SLUG, { sort: "edition" })
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, [collection]);

  useEffect(() => {
    if (tab !== "sales" || !collection) return;
    api
      .getNftActivity()
      .then((rows) => setSales(rows.filter((r) => r.kind === "SALE" && r.collectionSlug === COLLECTION_SLUG)))
      .catch(() => setSales([]));
  }, [tab, collection]);

  if (collection === undefined) return null;

  if (collection === null) {
    return (
      <div className="container nft-market">
        <div className="badge">{t("nftMarket.badge")}</div>
        <h1>{t("nftMarket.notConfigured.title")}</h1>
        <p className="muted">{t("nftMarket.notConfigured.body")}</p>
      </div>
    );
  }

  return (
    <div className="container nft-market">
      <div className="badge">{t("nftMarket.badge")}</div>
      <div className="nft-market-header">
        <div>
          <h1 className="nft-market-title">{collection.name}</h1>
          {collection.description && <p className="muted nft-market-desc">{collection.description}</p>}
        </div>
        <Link href="/nft/test/mint" className="btn btn-gold nft-market-mint-btn">
          {collection.soldOut ? t("nftMarket.soldOut") : t("nftMarket.mintButton", { price: formatZec(collection.mintPriceZec), currency: collection.currency })}
        </Link>
      </div>

      <div className="nft-market-stats">
        <div className="nft-market-stat">
          <span className="nft-market-stat-label">{t("nftMarket.stat.minted")}</span>
          <span className="nft-market-stat-value">
            {collection.mintedCount} / {collection.totalSupply}
          </span>
        </div>
        <div className="nft-market-stat">
          <span className="nft-market-stat-label">{t("nftMarket.stat.floor")}</span>
          <span className="nft-market-stat-value">
            {collection.floorZec != null ? `${formatZec(collection.floorZec)} ${collection.currency}` : "—"}
          </span>
        </div>
        <div className="nft-market-stat">
          <span className="nft-market-stat-label">{t("nftMarket.stat.listed")}</span>
          <span className="nft-market-stat-value">{collection.listedCount}</span>
        </div>
        <div className="nft-market-stat">
          <span className="nft-market-stat-label">{t("nftMarket.stat.volume")}</span>
          <span className="nft-market-stat-value">
            {formatZec(collection.volumeZec)} {collection.currency}
            {collection.currency === "ZEC" && formatUsd(collection.volumeZec, usdRate) && (
              <span className="muted" style={{ fontSize: 11, display: "block" }}>{formatUsd(collection.volumeZec, usdRate)}</span>
            )}
          </span>
        </div>
        <div className="nft-market-stat">
          <span className="nft-market-stat-label">{t("nftMarket.stat.sales")}</span>
          <span className="nft-market-stat-value">{collection.salesCount}</span>
        </div>
      </div>

      <div className="nft-market-tabs">
        <button className={`nft-market-tab ${tab === "market" ? "active" : ""}`} onClick={() => setTab("market")}>
          {t("nftMarket.tab.market")}
        </button>
        <button className={`nft-market-tab ${tab === "sales" ? "active" : ""}`} onClick={() => setTab("sales")}>
          {t("nftMarket.tab.sales")}
        </button>
      </div>

      {tab === "market" && (
        <>
          {items === null && <p className="muted">{t("nftMarket.loading")}</p>}
          {items !== null && items.length === 0 && <p className="muted">{t("nftMarket.empty")}</p>}
          {items !== null && items.length > 0 && (
            <div className="nft-grid">
              {items.map((it) => (
                <Link key={it.id} href={`/nft/test/item/${it.editionNumber}`} className="nft-card">
                  <div className="nft-card-img-wrap">
                    {it.imageDataUrl ? (
                      <img src={it.imageDataUrl} alt={it.name ?? `#${it.editionNumber}`} className="nft-card-img" />
                    ) : (
                      <div className="nft-card-img-placeholder">?</div>
                    )}
                    {!it.mintedAt && <span className="nft-card-unminted-badge">{t("nftMarket.unminted")}</span>}
                  </div>
                  <div className="nft-card-body">
                    <span className="nft-card-name">{it.name ?? `#${it.editionNumber}`}</span>
                    <span className="nft-card-price">
                      {it.listedPriceZec != null ? `${formatZec(it.listedPriceZec)} ${collection.currency}` : t("nftMarket.notListed")}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "sales" && (
        <>
          {sales === null && <p className="muted">{t("nftMarket.loading")}</p>}
          {sales !== null && sales.length === 0 && <p className="muted">{t("nftMarket.noSales")}</p>}
          {sales !== null && sales.length > 0 && (
            <table className="nft-sales-table">
              <thead>
                <tr>
                  <th>{t("nftMarket.sales.col.item")}</th>
                  <th>{t("nftMarket.sales.col.price")}</th>
                  <th>{t("nftMarket.sales.col.when")}</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s, i) => (
                  <tr key={`${s.editionNumber}-${s.createdAt}-${i}`}>
                    <td>
                      <Link href={`/nft/test/item/${s.editionNumber}`}>{s.name ?? `#${s.editionNumber}`}</Link>
                    </td>
                    <td>
                      {formatZec(s.priceZec)} {s.currency}
                    </td>
                    <td className="muted">{new Date(s.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
