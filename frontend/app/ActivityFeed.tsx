"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, GlobalTrade, NftActivity, nftItemPath, nftItemLabel } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

// ZODD (2026-09-20, Brai: gasto de egress en Railway se disparaba sin
// parar -- este polling a /api/trades cada 4s en TODAS las paginas, todo
// el tiempo que alguien tenga la pestana abierta, era el principal
// responsable (306GB / $15 de los $21.85 del proyecto en 14 dias). 20s
// sigue viendose "vivo" para un feed de actividad, a una fraccion del
// trafico.
const POLL_MS = 20000;
const MAX_ROWS = 18;

// Brai, 2026-09-18 (v2, URGENT): "sacame del live activity todo lo
// relacionado a NFT mientras probemos" -- NFT mint/list/sale events are
// pulled out of the merged feed below while the collection is still being
// tested (0.000001 ZEC test mint price etc). Token trades keep showing as
// before. Flip this back to true to bring NFT rows back into Live Activity
// once testing is done -- nothing else needs to change.
const SHOW_NFT_IN_ACTIVITY = false;

// Brai, 2026-09-08: "necsito movimiento en la pagina sino parece que nadie
// esta comprando y vendiendo... hazme un panel a la izquierda que aprezca
// las compras y ventas... como '0.01 zec to ZOOKCAT'. Compras en verdes
// ventas en rojo" -- a small always-on feed of real fills across every
// token (backed by GET /api/trades, store.getRecentTradesGlobal), fixed to
// the left edge on wide screens. Shows actual FILLED orders only, same
// source of truth as the per-token TradesList -- never synthetic data.
//
// Brai, 2026-09-18 (NFT marketplace launch): "quiero que la compra venta y
// listado de nfts aparezca en el LIVE ACTIVITY tambien" -- merged in with
// the token trades below (backed by GET /api/nft/activity,
// store.getRecentNftActivityGlobal), sorted back into one chronological
// feed instead of a second separate panel.
type Row = { ts: number; key: string } & (
  | { type: "trade"; trade: GlobalTrade }
  | { type: "nft"; nft: NftActivity }
);

export default function ActivityFeed() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<Row[] | null>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    stopRef.current = false;
    async function load() {
      try {
        const [trades, nftRows] = await Promise.all([
          api.getRecentTradesGlobal(),
          SHOW_NFT_IN_ACTIVITY ? api.getNftActivity().catch(() => [] as NftActivity[]) : Promise.resolve([] as NftActivity[]),
        ]);
        if (stopRef.current) return;
        const merged: Row[] = [
          ...trades.map((tr, i) => ({
            type: "trade" as const,
            trade: tr,
            ts: new Date(tr.createdAt).getTime(),
            key: `t-${tr.createdAt}-${tr.symbol}-${tr.side}-${tr.zecAmount}-${i}`,
          })),
          ...nftRows.map((n, i) => ({
            type: "nft" as const,
            nft: n,
            ts: new Date(n.createdAt).getTime(),
            key: `n-${n.createdAt}-${n.collectionSlug}-${n.editionNumber}-${n.kind}-${i}`,
          })),
        ];
        merged.sort((a, b) => b.ts - a.ts);
        setRows(merged.slice(0, MAX_ROWS));
      } catch {
        /* silent -- same posture as TickerBar: a feed that can't fetch just keeps showing what it had */
      }
    }
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      stopRef.current = true;
      clearInterval(id);
    };
  }, []);

  if (rows !== null && rows.length === 0) return null;

  return (
    <div className="activity-feed">
      <label className="muted activity-feed-heading">{t("activity.heading")}</label>
      <div className="activity-feed-list">
        {rows === null
          ? null
          : rows.map((row) =>
              row.type === "trade" ? (
                <Link key={row.key} href={`/launchpad/token/${row.trade.symbol}`} className="activity-row">
                  <span className={row.trade.side === "BUY" ? "activity-row-amount up" : "activity-row-amount down"}>
                    {row.trade.zecAmount.toFixed(4)} {row.trade.currency} <span className="activity-row-arrow">→</span> {row.trade.symbol}
                  </span>
                </Link>
              ) : (
                <Link key={row.key} href={nftItemPath(row.nft.editionNumber, row.nft.tier)} className="activity-row">
                  <span className={row.nft.kind === "LIST" ? "activity-row-amount" : "activity-row-amount up"}>
                    {t(`activity.nft.${row.nft.kind}`)} {row.nft.name ?? nftItemLabel(row.nft.tier, row.nft.editionNumber)}{" "}
                    <span className="activity-row-arrow">·</span> {row.nft.priceZec.toFixed(4)} {row.nft.currency}
                  </span>
                </Link>
              )
            )}
      </div>
    </div>
  );
}
