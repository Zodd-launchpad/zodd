"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import QRCode from "qrcode";
import { api, formatUsd, formatZec, type NftItem } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/translations";
import { useZecUsdPrice } from "@/lib/zecPrice";
import { useWallet } from "@/lib/wallet";
import { getNoirWallet, isNoirWalletInstalled } from "@noir-wallet/sdk";

// Brai, 2026-09-18: item detail + the secondary-market half of "que la
// gente pueda LISTAR o no listar, comprar y vender" -- owner sees
// list/unlist, anyone else sees buy (same one-time-address + memo + poll
// payment mechanism as the mint page and BuyModal.tsx).
const COLLECTION_SLUG = "zodd-genesis";

// Brai, 2026-09-19: "a cada nft le pondras TIER 1 en verde, TIER 2 en
// amarillo y TIER 3 en ROJO" -- same tier badge as the Items grid
// (nft/test/page.tsx), shown on the detail page too.
const FORGE_TIER_LABEL_KEY: Record<"PAPIRO" | "FRAGMENTO" | "RELIQUIA", TranslationKey> = {
  PAPIRO: "nftMarket.forge.tier.papiro",
  FRAGMENTO: "nftMarket.forge.tier.fragmento",
  RELIQUIA: "nftMarket.forge.tier.reliquia",
};

function isShieldedAddress(addr: string): boolean {
  return /^(u1|zs1|ys1)/.test(addr.trim());
}

type BuyPhase = "idle" | "waiting" | "filled" | "failed";

export default function NftItemPage() {
  const params = useParams();
  const editionNumber = Number(params.editionNumber);
  const { t } = useLanguage();
  const { wallet } = useWallet();
  const usdRate = useZecUsdPrice();

  const [item, setItem] = useState<NftItem | null | undefined>(undefined);
  const [currency, setCurrency] = useState<"ZEC" | "YEC">("ZEC");
  const [error, setError] = useState<string | null>(null);
  const [isRealMode, setIsRealMode] = useState(false);

  // Listing form (owner, unlisted piece)
  const [listPrice, setListPrice] = useState("0.05");
  const [payoutAddress, setPayoutAddress] = useState("");
  const [listing, setListing] = useState(false);

  // Buy flow (non-owner, listed piece)
  const [buyPhase, setBuyPhase] = useState<BuyPhase>("idle");
  const [purchaseId, setPurchaseId] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [exactZecAmount, setExactZecAmount] = useState<number | null>(null);
  const [memo, setMemo] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [noirSending, setNoirSending] = useState(false);
  const [noirTxid, setNoirTxid] = useState<string | null>(null);
  const [noirError, setNoirError] = useState<string | null>(null);

  async function reload() {
    try {
      const r = await api.getNftItem(COLLECTION_SLUG, editionNumber);
      setItem(r.item);
      setCurrency(r.collection.currency);
    } catch {
      setItem(null);
    }
  }

  useEffect(() => {
    if (!Number.isFinite(editionNumber)) return;
    reload();
    api.getMode().then((m) => setIsRealMode(m.currencies.ZEC.mode === "real")).catch(() => {});
  }, [editionNumber]);

  useEffect(() => {
    if (!wallet) return;
    api
      .portfolio(wallet.walletId)
      .then((p) => {
        if (p.defaultRefundAddress) setPayoutAddress((prev) => prev || p.defaultRefundAddress!);
      })
      .catch(() => {});
  }, [wallet]);

  const isOwner = !!wallet && !!item && item.ownerInternalWalletId === wallet.walletId;

  async function submitList() {
    if (!wallet || !item) return;
    setError(null);
    const price = parseFloat(listPrice);
    if (!(price > 0)) return setError(t("buy.error.invalidAmount"));
    const trimmed = payoutAddress.trim();
    if (trimmed.length < 10 || !isShieldedAddress(trimmed)) return setError(t("buy.error.invalidAddress"));
    setListing(true);
    try {
      await api.listNftItem(item.id, { walletId: wallet.walletId, priceZec: price, payoutAddress: trimmed });
      await reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setListing(false);
    }
  }

  async function submitUnlist() {
    if (!wallet || !item) return;
    setError(null);
    try {
      await api.unlistNftItem(item.id, wallet.walletId);
      await reload();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard not available */
    }
  }

  async function startBuy() {
    if (!wallet || !item) return;
    setError(null);
    try {
      const result = await api.buyNftItem(item.id, wallet.walletId);
      setPurchaseId(result.purchaseId);
      setAddress(result.zecAddress);
      setExactZecAmount(result.zecAmount);
      setMemo(result.memo ?? null);
      const uri = `${result.currency === "YEC" ? "ycash" : "zcash"}:${result.zecAddress}?amount=${result.zecAmount}${result.memo ? `&memo=${result.memo}` : ""}`;
      setQr(await QRCode.toDataURL(uri, { margin: 1, width: 220 }));
      setBuyPhase("waiting");
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function payWithNoir() {
    setNoirError(null);
    if (!address || exactZecAmount == null) return;
    if (!isNoirWalletInstalled()) return setNoirError(t("payment.noir.notInstalled"));
    const noirWallet = getNoirWallet();
    if (!noirWallet) return setNoirError(t("payment.noir.notInstalled"));
    setNoirSending(true);
    try {
      const zcash = noirWallet.zcash;
      const existing = await zcash.getAccounts();
      if (!existing) await zcash.connect();
      const txid = await zcash.sendTransaction({ to: address, amount: String(exactZecAmount), memo: memo ?? undefined, fundingSource: "shielded" });
      setNoirTxid(txid);
    } catch (e: any) {
      setNoirError(e?.code === 4001 ? t("payment.noir.rejected") : e?.message ?? t("payment.noir.failed"));
    } finally {
      setNoirSending(false);
    }
  }

  useEffect(() => {
    if (buyPhase !== "waiting" || !purchaseId) return;
    const id = setInterval(async () => {
      const p = await api.getNftPurchase(purchaseId);
      if (p.status === "FILLED") {
        setBuyPhase("filled");
        clearInterval(id);
        await reload();
      } else if (p.status === "EXPIRED" || p.status === "FAILED") {
        setBuyPhase("failed");
        clearInterval(id);
      }
    }, 1500);
    return () => clearInterval(id);
  }, [buyPhase, purchaseId]);

  if (item === undefined) return null;
  if (item === null) {
    return (
      <div className="container nft-market">
        <p className="muted">{t("nftItem.notFound")}</p>
      </div>
    );
  }

  return (
    <div className="container nft-market nft-item-page">
      <Link href="/nft/test" className="nft-back-link" style={{ display: "inline-block", marginBottom: 16 }}>
        {t("nftMint.back")}
      </Link>
      <div className="nft-item-layout">
        <div className="nft-item-img-wrap">
          {item.imageDataUrl ? <img src={item.imageDataUrl} alt={item.name ?? ""} className="nft-item-img" /> : <div className="nft-card-img-placeholder">?</div>}
        </div>
        <div className="card nft-item-panel">
          <h1 style={{ marginTop: 0 }}>
            {item.name ?? `#${item.editionNumber}`}{" "}
            <span className={`nft-card-tier-badge nft-card-tier-${item.tier.toLowerCase()}`} style={{ position: "static", verticalAlign: "middle" }}>
              {t(FORGE_TIER_LABEL_KEY[item.tier])}
            </span>
          </h1>
          {item.traits && Object.keys(item.traits).length > 0 && (
            <div className="nft-item-traits">
              {Object.entries(item.traits).map(([k, v]) => (
                <div key={k} className="nft-item-trait">
                  <span className="muted">{k}</span>
                  <span>{v}</span>
                </div>
              ))}
            </div>
          )}

          {!item.mintedAt && <p className="muted">{t("nftMarket.unminted")}</p>}

          {item.mintedAt && (
            <>
              <div className="nft-item-price-row">
                <span className="muted">{t("nftItem.price")}</span>
                <span className="nft-item-price">
                  {item.listedPriceZec != null ? `${formatZec(item.listedPriceZec)} ${currency}` : t("nftMarket.notListed")}
                  {item.listedPriceZec != null && currency === "ZEC" && formatUsd(item.listedPriceZec, usdRate) && (
                    <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>({formatUsd(item.listedPriceZec, usdRate)})</span>
                  )}
                </span>
              </div>

              {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}

              {isOwner && item.listedPriceZec == null && buyPhase === "idle" && (
                <div className="nft-item-list-form">
                  <div className="field">
                    <label>{t("nftItem.listPriceLabel", { currency })}</label>
                    <input value={listPrice} onChange={(e) => setListPrice(e.target.value)} />
                  </div>
                  <div className="field">
                    <label>{t("buy.refundAddressLabel")}</label>
                    <input value={payoutAddress} onChange={(e) => setPayoutAddress(e.target.value)} placeholder="u1... / zs1..." />
                  </div>
                  <button className="btn btn-gold" style={{ width: "100%" }} disabled={listing} onClick={submitList}>
                    {t("nftItem.listButton")}
                  </button>
                </div>
              )}

              {isOwner && item.listedPriceZec != null && (
                <button className="btn btn-outline" style={{ width: "100%" }} onClick={submitUnlist}>
                  {t("nftItem.unlistButton")}
                </button>
              )}

              {!isOwner && item.listedPriceZec != null && buyPhase === "idle" && (
                <>
                  {!wallet ? (
                    <p className="muted">{t("portfolio.connectFirst")}</p>
                  ) : (
                    <button className="btn btn-gold" style={{ width: "100%" }} onClick={startBuy}>
                      {t("nftItem.buyButton")}
                    </button>
                  )}
                </>
              )}

              {!isOwner && item.listedPriceZec == null && <p className="muted">{t("nftMarket.notListed")}</p>}

              {buyPhase === "waiting" && (
                <div style={{ marginTop: 12 }}>
                  <h2 style={{ textAlign: "center", fontSize: 18 }}>
                    {exactZecAmount != null ? formatZec(exactZecAmount) : ""} {currency}
                  </h2>
                  {isRealMode && (
                    <div style={{ margin: "12px 0" }}>
                      {noirTxid ? (
                        <p style={{ color: "var(--green)", fontSize: 12, textAlign: "center" }}>{t("payment.noir.sent")}</p>
                      ) : (
                        <button className="btn btn-outline" style={{ width: "100%" }} disabled={noirSending} onClick={payWithNoir}>
                          {noirSending ? t("payment.noir.sending") : t("payment.noir.payButton")}
                        </button>
                      )}
                      {noirError && <p style={{ color: "var(--red)", fontSize: 12, textAlign: "center", marginTop: 6 }}>{noirError}</p>}
                      <p className="muted" style={{ fontSize: 11, textAlign: "center", margin: "8px 0" }}>{t("payment.noir.orScan")}</p>
                    </div>
                  )}
                  {qr && (
                    <div style={{ background: "#fff", padding: 12, borderRadius: 6, display: "flex", justifyContent: "center", margin: "12px 0" }}>
                      <img src={qr} alt="qr" />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={copyAddress}
                    className="mono-break"
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      fontSize: 11,
                      color: copied ? "var(--green)" : "var(--accent)",
                      background: "transparent",
                      border: `1px solid ${copied ? "var(--green)" : "var(--border)"}`,
                      padding: 8,
                      borderRadius: 4,
                      cursor: "pointer",
                    }}
                  >
                    {copied ? `✓ ${t("buy.addressCopied")}` : address}
                  </button>
                  <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>{isRealMode ? t("buy.realNote") : t("buy.simulatedNote")}</p>
                </div>
              )}

              {buyPhase === "filled" && <p style={{ color: "var(--green)", marginTop: 12 }}>{t("nftItem.buyFilled")}</p>}
              {buyPhase === "failed" && <p style={{ color: "var(--red)", marginTop: 12 }}>{t("buy.failed.body")}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
