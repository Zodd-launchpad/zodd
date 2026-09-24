"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import {
  api,
  formatUsd,
  formatZec,
  nftItemPath,
  nftItemLabel,
  type NftCollection,
  type NftItem,
  type NftActivity,
  type NftForgeInventory,
  type Currency,
} from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/translations";
import { useZecUsdPrice } from "@/lib/zecPrice";
import { useWallet } from "@/lib/wallet";
import { NftMedia } from "@/lib/nftMedia";

// Brai, 2026-09-18: "empeza a deployar el marketplace ... te envio una
// pagina que me gustaria copiar, sencilla: zecrocks.cash/market" -- original
// v1 of this page (stats header + a Market/Sales tab pair).
//
// Brai, 2026-09-19 (v14): "en la pagina zodd.fun/nft/test no aparecen los
// listados, solo dice listed 1 ... la idea es que aparezca en varias
// solapas, una que diga listed ... excepto offers, copia todo de esa pagina
// https://zecbit.net/collection/zecbit-genesis" -- the grid was actually
// rendering fine (confirmed live); what was missing was any way to see just
// the LISTED pieces, and the richer multi-tab layout zecbit uses. Rebuilt
// around that reference's shape: Items (with a status filter -- All /
// Listed / Not listed / Owned by you), Forge, Activity, Analytics, About
// (see the 2026-09-19 tab-order comment on the Tab type below -- Traits was
// dropped and the rest reordered). Deliberately no Offers tab -- ZODD has
// no offer system, Brai explicitly said to skip it.
//
// Deliberately still at /nft/test, not /nft (still the "coming soon" page)
// -- Brai: "en una url escondida ... y luego lo mandamos a zodd.fun/nft"
// once he's happy with it.
const COLLECTION_SLUG = "zodd-genesis";
const PAGE_SIZE = 48;

// Brai, 2026-09-19: "primero tiene que estar items, borra traits, segundo
// forge, tercero activity cuarto analytics y quinto about" -- tab order
// (and this union's order) now matches that exactly; Traits is gone.
type Tab = "items" | "forge" | "activity" | "analytics" | "about";
type StatusFilter = "all" | "listed" | "not_listed" | "owned";
type SortKey = "edition" | "price_asc" | "price_desc";
// Brai, 2026-09-19: "5 papiros podes crear 1 fragmento, si tenes 3
// fragmentos podes crear una reliquia" -- the two craftable directions on
// the Forge tab (RELIQUIA has nothing further to craft into).
type ForgeFromTier = "PAPIRO" | "FRAGMENTO";

// t()'s key type is a strict union generated from translations.ts, so a
// template-literal lookup like `nftMarket.tab.${tab}` doesn't type-check --
// these small maps keep the dynamic lookups typed instead of casting to any.
const TAB_LABEL_KEY: Record<Tab, TranslationKey> = {
  items: "nftMarket.tab.items",
  forge: "nftMarket.tab.forge",
  activity: "nftMarket.tab.activity",
  analytics: "nftMarket.tab.analytics",
  about: "nftMarket.tab.about",
};
const FORGE_TIER_LABEL_KEY: Record<"PAPIRO" | "FRAGMENTO" | "RELIQUIA", TranslationKey> = {
  PAPIRO: "nftMarket.forge.tier.papiro",
  FRAGMENTO: "nftMarket.forge.tier.fragmento",
  RELIQUIA: "nftMarket.forge.tier.reliquia",
};
const STATUS_LABEL_KEY: Record<StatusFilter, TranslationKey> = {
  all: "nftMarket.status.all",
  listed: "nftMarket.status.listed",
  not_listed: "nftMarket.status.notListed",
  owned: "nftMarket.status.owned",
};
const ACTIVITY_KIND_KEY: Record<NftActivity["kind"], TranslationKey> = {
  MINT: "nftMarket.activity.kind.mint",
  LIST: "nftMarket.activity.kind.list",
  SALE: "nftMarket.activity.kind.sale",
};

export default function NftMarketTestPage() {
  const { t } = useLanguage();
  const usdRate = useZecUsdPrice();
  const { wallet } = useWallet();

  const [collection, setCollection] = useState<NftCollection | null | undefined>(undefined); // undefined = loading, null = not configured yet
  const [tab, setTab] = useState<Tab>("items");

  // ---- Items tab ----
  // Brai, 2026-09-19: "el marketplace debe comenzar en LISTED y precios de
  // mas bajo a mas alto" -- these are just the initial defaults; the chips
  // and sort dropdown are still fully interactive after that.
  const [status, setStatus] = useState<StatusFilter>("listed");
  const [sort, setSort] = useState<SortKey>("price_asc");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<NftItem[] | null>(null);
  const [itemsTotal, setItemsTotal] = useState(0);

  // Brai, 2026-09-24: "seleccionar varios nfts y comprarlos todos juntos
  // ... aviso ... que esos nfts estan tomados" -- multi-select + the
  // MultiBuyModal below. Selection is cleared on any refetch (page/filter
  // change) so it never points at items no longer on screen.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [multiBuyOpen, setMultiBuyOpen] = useState(false);
  // Bumped after a multi-buy completes to force the items list to refetch
  // (page/status/sort/wallet are all unchanged at that point, so nothing
  // else would trigger it) -- see the items useEffect's dependency array.
  const [refreshKey, setRefreshKey] = useState(0);

  // ---- Activity tab (lazy-loaded once) ----
  const [activity, setActivity] = useState<NftActivity[] | null>(null);

  // ---- Forge tab ----
  const [forgeInventory, setForgeInventory] = useState<NftForgeInventory | null>(null);
  const [forgeCraftingTier, setForgeCraftingTier] = useState<ForgeFromTier | null>(null);
  const [forgeMessage, setForgeMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    api
      .getNftCollection(COLLECTION_SLUG)
      .then(setCollection)
      .catch(() => setCollection(null));
  }, []);

  // "Owned by you" needs a connected wallet -- fall back to "all" if it
  // disconnects mid-filter rather than silently querying ownerWalletId=undefined.
  useEffect(() => {
    if (status === "owned" && !wallet) setStatus("all");
  }, [status, wallet]);

  useEffect(() => {
    if (!collection || tab !== "items") return;
    setItems(null);
    const opts: Parameters<typeof api.getNftItems>[1] = { sort, page };
    if (status === "owned" && wallet) opts.ownerWalletId = wallet.walletId;
    else if (status === "listed") opts.status = "listed";
    else if (status === "not_listed") opts.status = "not_listed";
    else opts.status = "all";
    setSelectedIds(new Set());
    api
      .getNftItems(COLLECTION_SLUG, opts)
      .then((r) => {
        setItems(r.items);
        setItemsTotal(r.total);
      })
      .catch(() => {
        setItems([]);
        setItemsTotal(0);
      });
  }, [collection, tab, status, sort, page, wallet, refreshKey]);

  function isReservedByOther(it: NftItem): boolean {
    return !!it.reservedUntil && new Date(it.reservedUntil) > new Date();
  }

  function canSelect(it: NftItem): boolean {
    return (
      !!wallet &&
      it.listedPriceZec != null &&
      it.ownerInternalWalletId !== wallet.walletId &&
      !isReservedByOther(it)
    );
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedItems = useMemo(
    () => (items ?? []).filter((it) => selectedIds.has(it.id)),
    [items, selectedIds]
  );
  const selectedTotalZec = useMemo(
    () => selectedItems.reduce((sum, it) => sum + (it.listedPriceZec ?? 0), 0),
    [selectedItems]
  );

  useEffect(() => {
    if (!collection || (tab !== "activity" && tab !== "analytics") || activity !== null) return;
    api
      .getNftActivity()
      .then((rows) => setActivity(rows.filter((r) => r.collectionSlug === COLLECTION_SLUG)))
      .catch(() => setActivity([]));
  }, [collection, tab, activity]);

  // Brai, 2026-09-19: the Forge tab needs a connected wallet (it's your own
  // inventory) -- refetched whenever the tab is open and the wallet changes,
  // same "always current, never stale after a craft" spirit as portfolio.
  useEffect(() => {
    if (!collection || tab !== "forge" || !wallet) {
      if (!wallet) setForgeInventory(null);
      return;
    }
    api
      .getNftForgeInventory(COLLECTION_SLUG, wallet.walletId)
      .then((r) => setForgeInventory(r.inventory))
      .catch(() => setForgeInventory(null));
  }, [collection, tab, wallet]);

  async function craftForgeTier(fromTier: ForgeFromTier) {
    if (!wallet) return;
    setForgeCraftingTier(fromTier);
    setForgeMessage(null);
    try {
      const result = await api.craftNft(COLLECTION_SLUG, { walletId: wallet.walletId, fromTier });
      setForgeMessage({ kind: "ok", text: t("nftMarket.forge.crafted", { name: result.name ?? nftItemLabel(result.tier, result.editionNumber) }) });
      const r = await api.getNftForgeInventory(COLLECTION_SLUG, wallet.walletId);
      setForgeInventory(r.inventory);
    } catch (err) {
      setForgeMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setForgeCraftingTier(null);
    }
  }

  const recentSales = useMemo(() => (activity ?? []).filter((a) => a.kind === "SALE"), [activity]);

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

  const totalPages = Math.max(1, Math.ceil(itemsTotal / PAGE_SIZE));

  return (
    <div className="container nft-market">
      <div className="badge">{t("nftMarket.badge")}</div>
      <div className="nft-market-header">
        <div>
          <h1 className="nft-market-title">{collection.name}</h1>
          {collection.description && <p className="muted nft-market-desc">{collection.description}</p>}
        </div>
        <Link href="/nft/test/mint" className="btn btn-gold nft-market-mint-btn">
          {collection.soldOut ? t("nftMarket.soldOut") : t("nftMarket.mintButton")}
        </Link>
      </div>

      <div className="nft-market-stats">
        <div className="nft-market-stat">
          <span className="nft-market-stat-label">{t("nftMarket.stat.minted")}</span>
          <span className="nft-market-stat-value">
            {collection.mintedCount} / {collection.supplyTotal}
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
        {(["items", "forge", "activity", "analytics", "about"] as Tab[]).map((k) => (
          <button key={k} className={`nft-market-tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>
            {t(TAB_LABEL_KEY[k])}
          </button>
        ))}
      </div>

      {tab === "items" && (
        <div className="nft-items-layout">
          <div className="nft-items-sidebar">
            <div className="nft-items-sidebar-label">{t("nftMarket.status.label")}</div>
            <div className="nft-status-filters">
              {(["all", "listed", "not_listed", "owned"] as StatusFilter[]).map((s) => (
                <button
                  key={s}
                  className={`nft-status-chip ${status === s ? "active" : ""}`}
                  disabled={s === "owned" && !wallet}
                  onClick={() => {
                    setStatus(s);
                    setPage(1);
                  }}
                  title={s === "owned" && !wallet ? t("portfolio.connectFirst") : undefined}
                >
                  {t(STATUS_LABEL_KEY[s])}
                </button>
              ))}
            </div>
          </div>

          <div className="nft-items-main">
            <div className="nft-items-toolbar">
              <span className="muted" style={{ fontSize: 13 }}>
                {items !== null && t("nftMarket.showingCount", { shown: String(items.length), total: String(itemsTotal) })}
              </span>
              <select
                className="nft-sort-select"
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value as SortKey);
                  setPage(1);
                }}
              >
                <option value="edition">{t("nftMarket.sort.edition")}</option>
                <option value="price_asc">{t("nftMarket.sort.priceAsc")}</option>
                <option value="price_desc">{t("nftMarket.sort.priceDesc")}</option>
              </select>
            </div>

            {items === null && <p className="muted">{t("nftMarket.loading")}</p>}
            {items !== null && items.length === 0 && <p className="muted">{t("nftMarket.empty")}</p>}
            {items !== null && items.length > 0 && (
              <div className="nft-grid">
                {items.map((it) => {
                  const selectable = canSelect(it);
                  const reserved = isReservedByOther(it);
                  const selected = selectedIds.has(it.id);
                  return (
                    <Link
                      key={it.id}
                      href={nftItemPath(it.editionNumber, it.tier)}
                      className={`nft-card ${selected ? "nft-card-selected" : ""}`}
                    >
                      <div className="nft-card-img-wrap">
                        {it.imageDataUrl ? (
                          <NftMedia src={it.imageDataUrl} alt={it.name ?? nftItemLabel(it.tier, it.editionNumber)} className="nft-card-img" />
                        ) : (
                          <div className="nft-card-img-placeholder">?</div>
                        )}
                        {!it.mintedAt && <span className="nft-card-unminted-badge">{t("nftMarket.unminted")}</span>}
                        {it.mintedAt && reserved && <span className="nft-card-reserved-badge">{t("nftMarket.select.reserved")}</span>}
                        {it.mintedAt && !reserved && selectable && (
                          <div
                            className="nft-card-select-wrap"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleSelect(it.id);
                            }}
                          >
                            <input type="checkbox" className="nft-card-select-checkbox" checked={selected} readOnly />
                          </div>
                        )}
                        <span className={`nft-card-tier-badge nft-card-tier-${it.tier.toLowerCase()}`}>{t(FORGE_TIER_LABEL_KEY[it.tier])}</span>
                      </div>
                      <div className="nft-card-body">
                        <span className="nft-card-name">{it.name ?? nftItemLabel(it.tier, it.editionNumber)}</span>
                        <span className="nft-card-price">
                          {it.listedPriceZec != null ? `${formatZec(it.listedPriceZec)} ${collection.currency}` : t("nftMarket.notListed")}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}

            {itemsTotal > PAGE_SIZE && (
              <div className="nft-pagination">
                <button className="btn btn-outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  {t("nftMarket.prevPage")}
                </button>
                <span className="muted" style={{ fontSize: 13 }}>{t("nftMarket.page", { page: String(page), pages: String(totalPages) })}</span>
                <button className="btn btn-outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  {t("nftMarket.nextPage")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {selectedItems.length > 0 && (
        <div className="nft-multibuy-bar">
          <span>{t("nftMarket.select.selectedCount", { count: String(selectedItems.length) })}</span>
          <span className="muted">
            {t("nftMarket.select.total")}: {formatZec(selectedTotalZec)} {collection.currency}
          </span>
          <button className="btn btn-outline" onClick={() => setSelectedIds(new Set())}>
            {t("nftMarket.select.clear")}
          </button>
          <button className="btn btn-gold" onClick={() => setMultiBuyOpen(true)}>
            {t("nftMarket.select.buySelected")}
          </button>
        </div>
      )}

      {multiBuyOpen && wallet && (
        <MultiBuyModal
          items={selectedItems}
          currency={collection.currency}
          walletId={wallet.walletId}
          onClose={() => setMultiBuyOpen(false)}
          onDone={() => {
            setSelectedIds(new Set());
            setMultiBuyOpen(false);
            // Re-fetch so the grid drops the now-sold pieces and
            // reservation badges clear immediately instead of waiting on
            // the next poll.
            setRefreshKey((k) => k + 1);
            api
              .getNftCollection(COLLECTION_SLUG)
              .then(setCollection)
              .catch(() => {});
          }}
        />
      )}

      {tab === "analytics" && (
        <div className="nft-analytics-tab">
          <div className="nft-market-stats" style={{ marginBottom: 20 }}>
            <div className="nft-market-stat">
              <span className="nft-market-stat-label">{t("nftMarket.analytics.mintProgress")}</span>
              <span className="nft-market-stat-value">
                {collection.totalSupply > 0 ? `${Math.round((collection.mintedCount / collection.totalSupply) * 100)}%` : "—"}
              </span>
            </div>
            <div className="nft-market-stat">
              <span className="nft-market-stat-label">{t("nftMarket.analytics.avgSale")}</span>
              <span className="nft-market-stat-value">
                {recentSales.length > 0
                  ? `${formatZec(recentSales.reduce((sum, s) => sum + s.priceZec, 0) / recentSales.length)} ${collection.currency}`
                  : "—"}
              </span>
            </div>
          </div>

          <div className="nft-progress-bar">
            <div
              className="nft-progress-bar-fill"
              style={{ width: `${collection.totalSupply > 0 ? Math.min(100, (collection.mintedCount / collection.totalSupply) * 100) : 0}%` }}
            />
          </div>

          <h3 style={{ marginTop: 28, fontSize: 14 }}>{t("nftMarket.analytics.recentSalePrices")}</h3>
          {activity === null && <p className="muted">{t("nftMarket.loading")}</p>}
          {activity !== null && recentSales.length === 0 && <p className="muted">{t("nftMarket.analytics.noSales")}</p>}
          {recentSales.length > 0 && (
            <div className="nft-sparkline">
              {recentSales
                .slice()
                .reverse()
                .map((s, i) => {
                  const max = Math.max(...recentSales.map((r) => r.priceZec), 0.0001);
                  const h = Math.max(4, (s.priceZec / max) * 100);
                  return <div key={i} className="nft-sparkline-bar" style={{ height: `${h}%` }} title={`${formatZec(s.priceZec)} ${s.currency}`} />;
                })}
            </div>
          )}
        </div>
      )}

      {tab === "activity" && (
        <div className="nft-activity-tab">
          {activity === null && <p className="muted">{t("nftMarket.loading")}</p>}
          {activity !== null && activity.length === 0 && <p className="muted">{t("nftMarket.activity.empty")}</p>}
          {activity !== null && activity.length > 0 && (
            <table className="nft-sales-table">
              <thead>
                <tr>
                  <th>{t("nftMarket.activity.col.event")}</th>
                  <th>{t("nftMarket.activity.col.item")}</th>
                  <th>{t("nftMarket.activity.col.price")}</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((a, i) => (
                  <tr key={`${a.editionNumber}-${a.createdAt}-${i}`}>
                    <td>
                      <span className={`nft-activity-kind nft-activity-kind-${a.kind.toLowerCase()}`}>
                        {t(ACTIVITY_KIND_KEY[a.kind])}
                      </span>
                    </td>
                    <td>
                      <Link href={nftItemPath(a.editionNumber, a.tier)}>{a.name ?? nftItemLabel(a.tier, a.editionNumber)}</Link>
                    </td>
                    <td>
                      {formatZec(a.priceZec)} {a.currency}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "forge" && (
        <div className="nft-forge-tab">
          {!wallet && <p className="muted">{t("portfolio.connectFirst")}</p>}
          {wallet && forgeInventory === null && <p className="muted">{t("nftMarket.loading")}</p>}
          {wallet && forgeInventory !== null && (
            <>
              <p className="muted nft-forge-intro">{t("nftMarket.forge.intro")}</p>
              {forgeMessage && (
                <div className={`nft-forge-message ${forgeMessage.kind === "error" ? "nft-forge-message-error" : "nft-forge-message-ok"}`}>
                  {forgeMessage.text}
                </div>
              )}
              <div className="nft-forge-recipes">
                <div className="card nft-forge-recipe">
                  <div className="nft-forge-recipe-you-have">
                    <span className="nft-forge-count">{forgeInventory.papiro}</span>
                    <span className="muted">{t(FORGE_TIER_LABEL_KEY.PAPIRO)}</span>
                  </div>
                  <div className="nft-forge-arrow">→</div>
                  <div className="nft-forge-recipe-result">
                    <span className="nft-forge-count">1</span>
                    <span className="muted">{t(FORGE_TIER_LABEL_KEY.FRAGMENTO)}</span>
                  </div>
                  <button
                    className="btn btn-gold"
                    disabled={forgeInventory.papiro < 5 || forgeCraftingTier !== null}
                    onClick={() => craftForgeTier("PAPIRO")}
                  >
                    {forgeCraftingTier === "PAPIRO" ? t("nftMarket.forge.crafting") : t("nftMarket.forge.craftButton", { count: "5" })}
                  </button>
                </div>
                <div className="card nft-forge-recipe">
                  <div className="nft-forge-recipe-you-have">
                    <span className="nft-forge-count">{forgeInventory.fragmento}</span>
                    <span className="muted">{t(FORGE_TIER_LABEL_KEY.FRAGMENTO)}</span>
                  </div>
                  <div className="nft-forge-arrow">→</div>
                  <div className="nft-forge-recipe-result">
                    <span className="nft-forge-count">1</span>
                    <span className="muted">{t(FORGE_TIER_LABEL_KEY.RELIQUIA)}</span>
                  </div>
                  <button
                    className="btn btn-gold"
                    disabled={forgeInventory.fragmento < 3 || forgeCraftingTier !== null}
                    onClick={() => craftForgeTier("FRAGMENTO")}
                  >
                    {forgeCraftingTier === "FRAGMENTO" ? t("nftMarket.forge.crafting") : t("nftMarket.forge.craftButton", { count: "3" })}
                  </button>
                </div>
              </div>
              {forgeInventory.reliquia > 0 && (
                <div className="nft-forge-reliquia-note">
                  {t("nftMarket.forge.reliquiaOwned", { count: String(forgeInventory.reliquia) })}{" "}
                  <Link href="/launchpad">{t("nftMarket.forge.goToPyramid")}</Link>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === "about" && (
        <div className="card nft-about-tab">
          <h3 style={{ marginTop: 0 }}>{t("nftMarket.about.details")}</h3>
          <p className="muted">{collection.description || t("nftMarket.about.noDescription")}</p>
          <div className="nft-about-grid">
            <div>
              <span className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("nftMarket.about.currency")}</span>
              <div>{collection.currency}</div>
            </div>
            <div>
              <span className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("nftMarket.about.totalSupply")}</span>
              <div>{collection.totalSupply}</div>
            </div>
            <div>
              <span className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("nftMarket.about.mintPrice")}</span>
              <div>{formatZec(collection.mintPriceZec)} {collection.currency}</div>
            </div>
            <div>
              <span className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("nftMarket.about.created")}</span>
              <div>{new Date(collection.createdAt).toLocaleDateString()}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Brai, 2026-09-24: "seleccionar varios nfts y comprarlos todos juntos" --
// deliberately NOT a single combined payment. zcashReal.ts's payment
// matcher only ever resolves a memo (exact) or an unambiguous amount
// match, on purpose (see its own comments -- Brai rejected "bump the
// amount" style hacks before), so there's no safe way to collapse N
// different-priced pieces into one on-chain payment without weakening
// that matching. Instead this reuses the exact same proven single-item
// flow (createNftPurchaseOrder + its 30-minute reservation lock) once per
// selected piece, in parallel, and shows every resulting address/QR
// together so the buyer can pay them one after another without leaving
// this screen -- "comprarlos todos juntos" as one batch UX, N on-chain
// payments underneath.
type MultiBuyPhase = "creating" | "waiting" | "filled" | "failed";
interface MultiBuyRow {
  phase: MultiBuyPhase;
  purchaseId?: string;
  address?: string;
  zecAmount?: number;
  memo?: string | null;
  qr?: string;
  error?: string;
}

function MultiBuyModal({
  items,
  currency,
  walletId,
  onClose,
  onDone,
}: {
  items: NftItem[];
  currency: Currency;
  walletId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useLanguage();
  const [rows, setRows] = useState<Record<string, MultiBuyRow>>(() =>
    Object.fromEntries(items.map((it) => [it.id, { phase: "creating" as const }]))
  );

  // Kick off one independent purchase order per selected item as soon as
  // the modal opens -- each is its own reservation, so one failing (e.g.
  // someone else grabbed it a second before we did) doesn't block the rest.
  useEffect(() => {
    let cancelled = false;
    items.forEach((it) => {
      (async () => {
        try {
          const result = await api.buyNftItem(it.id, walletId);
          if (cancelled) return;
          const uri = `${currency === "YEC" ? "ycash" : "zcash"}:${result.zecAddress}?amount=${result.zecAmount}${result.memo ? `&memo=${result.memo}` : ""}`;
          const qr = await QRCode.toDataURL(uri, { margin: 1, width: 160 });
          if (cancelled) return;
          setRows((prev) => ({
            ...prev,
            [it.id]: {
              phase: "waiting",
              purchaseId: result.purchaseId,
              address: result.zecAddress,
              zecAmount: result.zecAmount,
              memo: result.memo ?? null,
              qr,
            },
          }));
        } catch (e: any) {
          if (cancelled) return;
          setRows((prev) => ({ ...prev, [it.id]: { phase: "failed", error: e?.message ?? String(e) } }));
        }
      })();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll every purchase order that's currently waiting on payment, same
  // 1.5s cadence as the single-item buy flow on the item detail page.
  useEffect(() => {
    const waitingIds = Object.entries(rows)
      .filter(([, r]) => r.phase === "waiting" && r.purchaseId)
      .map(([itemId, r]) => [itemId, r.purchaseId!] as const);
    if (waitingIds.length === 0) return;
    const id = setInterval(async () => {
      for (const [itemId, purchaseId] of waitingIds) {
        try {
          const p = await api.getNftPurchase(purchaseId);
          if (p.status === "FILLED") {
            setRows((prev) => ({ ...prev, [itemId]: { ...prev[itemId], phase: "filled" } }));
          } else if (p.status === "EXPIRED" || p.status === "FAILED") {
            setRows((prev) => ({ ...prev, [itemId]: { ...prev[itemId], phase: "failed" } }));
          }
        } catch {
          /* transient -- next tick retries */
        }
      }
    }, 1500);
    return () => clearInterval(id);
  }, [rows]);

  const filledCount = Object.values(rows).filter((r) => r.phase === "filled").length;
  const allSettled = Object.values(rows).every((r) => r.phase === "filled" || r.phase === "failed");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal nft-multibuy-modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0, fontSize: 17 }}>{t("nftMultiBuy.title", { count: String(items.length) })}</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: -6 }}>{t("nftMultiBuy.notice")}</p>

        {items.map((it) => {
          const row = rows[it.id];
          return (
            <div key={it.id} className="nft-multibuy-row">
              {it.imageDataUrl ? (
                <NftMedia src={it.imageDataUrl} alt="" className="nft-multibuy-thumb" />
              ) : (
                <div className="nft-multibuy-thumb" />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{it.name ?? nftItemLabel(it.tier, it.editionNumber)}</div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                  {it.listedPriceZec != null ? `${formatZec(it.listedPriceZec)} ${currency}` : ""}
                </div>
                {row?.phase === "creating" && <div className="muted" style={{ fontSize: 12 }}>{t("nftMultiBuy.preparing")}</div>}
                {row?.phase === "failed" && (
                  <div style={{ color: "var(--red)", fontSize: 12 }}>{row.error ?? t("nftMultiBuy.failed")}</div>
                )}
                {row?.phase === "filled" && <div style={{ color: "var(--green)", fontSize: 12 }}>{t("nftMultiBuy.paid")}</div>}
                {row?.phase === "waiting" && row.address && (
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    {row.qr && <img src={row.qr} alt="qr" className="nft-multibuy-qr" />}
                    <button
                      type="button"
                      className="mono-break"
                      onClick={() => navigator.clipboard?.writeText(row.address!).catch(() => {})}
                      style={{
                        fontSize: 10,
                        color: "var(--accent)",
                        background: "transparent",
                        border: "1px solid var(--border)",
                        padding: 6,
                        borderRadius: 4,
                        cursor: "pointer",
                        maxWidth: 220,
                        textAlign: "left",
                      }}
                    >
                      {row.address}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {allSettled && filledCount === items.length && (
          <p style={{ color: "var(--green)", fontSize: 13, marginTop: 10 }}>{t("nftMultiBuy.doneAll")}</p>
        )}

        <button className="btn btn-outline" style={{ width: "100%", marginTop: 14 }} onClick={onDone}>
          {t("nftMultiBuy.close")}
        </button>
      </div>
    </div>
  );
}
