"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { useRouter } from "next/navigation";
import { api, formatUsd, formatZec, type NftCollection, type NftItem } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { useZecUsdPrice } from "@/lib/zecPrice";
import { useWallet } from "@/lib/wallet";
import { getNoirWallet, isNoirWalletInstalled } from "@noir-wallet/sdk";

// Brai, 2026-09-18: "generar una pagina para el mint, donde clickeas, te da
// una pagina para pagar, pagas y te asigne un NFT aleatorio entre los que
// te voy a mandar" -- exact same one-time-address + memo + poll mechanism
// as BuyModal.tsx/create-page.tsx (see api.mintNft/api.getNftMint in
// api.ts), just as its own page instead of a modal, ending in a reveal of
// whichever piece got randomly assigned server-side.
const COLLECTION_SLUG = "zodd-genesis";

// Brai, 2026-09-19: "activa el minteo para seguir en esa pagina escondida" --
// the old hard MINT_OPEN kill switch is gone; gating is now the real
// whitelist/public presale schedule the backend computes
// (collection.mintPhase, see mintPhaseAt in store.ts) plus the per-wallet
// mint cap (collection.maxMintsPerWallet). The page itself still only
// exists at this unlinked URL, not in any nav.

type Phase = "loading" | "confirm" | "waiting" | "revealed" | "failed" | "soldOut" | "notConfigured";

function formatLocalTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export default function NftMintPage() {
  const { t } = useLanguage();
  const { wallet, loading: walletLoading } = useWallet();
  const usdRate = useZecUsdPrice();
  const router = useRouter();

  const [collection, setCollection] = useState<NftCollection | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [isRealMode, setIsRealMode] = useState(false);

  const [mintId, setMintId] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [exactZecAmount, setExactZecAmount] = useState<number | null>(null);
  const [memo, setMemo] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [resultItem, setResultItem] = useState<NftItem | null>(null);
  const [noirSending, setNoirSending] = useState(false);
  const [noirTxid, setNoirTxid] = useState<string | null>(null);
  const [noirError, setNoirError] = useState<string | null>(null);
  // Brai, 2026-09-19: "cuando vas a mintear y tocas PAGAR, el QR tarda como
  // 5 segundos en aparecer... quiero que haya un cartel que diga WAIT" --
  // startMint below awaits the mint order + QR generation before flipping
  // phase to "waiting".
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    api.getMode().then((m) => setIsRealMode(m.currencies.ZEC.mode === "real")).catch(() => {});
  }, []);

  useEffect(() => {
    api
      .getNftCollection(COLLECTION_SLUG)
      .then((c) => {
        setCollection(c);
        setPhase(c.soldOut ? "soldOut" : "confirm");
      })
      .catch(() => setPhase("notConfigured"));
  }, []);

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard not available -- address is still selectable */
    }
  }

  async function startMint() {
    if (!wallet) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await api.mintNft({ walletId: wallet.walletId, collectionSlug: COLLECTION_SLUG });
      if (!("mintId" in result)) {
        // free whitelist mint -- assigned immediately, nothing to pay
        const { item } = await api.getNftItem(COLLECTION_SLUG, result.editionNumber);
        setResultItem(item);
        setPhase("revealed");
        return;
      }
      setMintId(result.mintId);
      setAddress(result.zecAddress);
      setExactZecAmount(result.zecAmount);
      setMemo(result.memo ?? null);
      const uri = `zcash:${result.zecAddress}?amount=${result.zecAmount}${result.memo ? `&memo=${result.memo}` : ""}`;
      setQr(await QRCode.toDataURL(uri, { margin: 1, width: 220 }));
      setPhase("waiting");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function payWithNoir() {
    setNoirError(null);
    if (!address || exactZecAmount == null) return;
    if (!isNoirWalletInstalled()) {
      setNoirError(t("payment.noir.notInstalled"));
      return;
    }
    const noirWallet = getNoirWallet();
    if (!noirWallet) {
      setNoirError(t("payment.noir.notInstalled"));
      return;
    }
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
    if (phase !== "waiting" || !mintId) return;
    const id = setInterval(async () => {
      const mint = await api.getNftMint(mintId);
      if (mint.status === "CREATED" && mint.resultItem) {
        setResultItem(mint.resultItem);
        setPhase("revealed");
        clearInterval(id);
      } else if (mint.status === "EXPIRED" || mint.status === "FAILED") {
        setPhase("failed");
        clearInterval(id);
      }
    }, 1500);
    return () => clearInterval(id);
  }, [phase, mintId]);

  if (walletLoading || phase === "loading") return null;

  if (phase === "notConfigured") {
    return (
      <div className="container nft-market">
        <p className="muted">{t("nftMarket.notConfigured.body")}</p>
      </div>
    );
  }

  return (
    <div className="container nft-market nft-mint-page">
      <Link href="/nft/test" className="nft-back-link" style={{ display: "inline-block", marginBottom: 16 }}>
        {t("nftMint.back")}
      </Link>

      {phase === "soldOut" && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{t("nftMarket.soldOut")}</h2>
        </div>
      )}

      {phase === "confirm" && collection && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{t("nftMint.title", { name: collection.name })}</h2>
          <p className="muted">{t("nftMint.body", { remaining: collection.remaining, total: collection.totalSupply })}</p>
          <p className="nft-mint-price">
            {formatZec(collection.mintPriceZec)} {collection.currency}
            {collection.currency === "ZEC" && formatUsd(collection.mintPriceZec, usdRate) && (
              <span className="muted" style={{ fontSize: 13, fontWeight: 400, marginLeft: 8 }}>
                (≈ {formatUsd(collection.mintPriceZec, usdRate)})
              </span>
            )}
          </p>
          <p className="muted" style={{ fontSize: 12 }}>
            {t("nftMint.limitNote", { max: collection.maxMintsPerWallet })}
          </p>
          {collection.mintPhase === "locked" && (
            <p style={{ color: "var(--accent)", fontSize: 13 }}>
              {collection.whitelistStartsAt
                ? t("nftMint.phase.lockedWithTime", { time: formatLocalTime(collection.whitelistStartsAt) })
                : t("nftMint.phase.locked")}
            </p>
          )}
          {collection.mintPhase === "whitelist" && (
            <p style={{ color: "var(--accent)", fontSize: 13 }}>
              {collection.publicStartsAt
                ? t("nftMint.phase.whitelist", { time: formatLocalTime(collection.publicStartsAt) })
                : t("nftMint.phase.whitelistNoTime")}
            </p>
          )}
          {!wallet ? (
            <p className="muted">{t("portfolio.connectFirst")}</p>
          ) : (
            <>
              {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
              <button className="btn btn-gold" style={{ width: "100%" }} onClick={startMint} disabled={isSubmitting}>
                {isSubmitting ? t("common.wait") : t("nftMint.confirmButton")}
              </button>
            </>
          )}
        </div>
      )}

      {phase === "waiting" && (
        <div className="card">
          <h2 style={{ marginTop: 0, textAlign: "center" }}>
            {exactZecAmount != null ? formatZec(exactZecAmount) : ""} {collection?.currency}
          </h2>
          <p className="muted" style={{ textAlign: "center" }}>{t("nftMint.waitingBody")}</p>
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

      {phase === "revealed" && resultItem && (
        <div className="card nft-reveal-card">
          <div className="nft-reveal-badge">{t("nftMint.revealed.badge")}</div>
          {resultItem.imageDataUrl && <img src={resultItem.imageDataUrl} alt={resultItem.name ?? ""} className="nft-reveal-img" />}
          <h2 style={{ margin: "12px 0 4px" }}>{resultItem.name ?? `#${resultItem.editionNumber}`}</h2>
          <div className="nft-mint-footer">
            <Link href={`/nft/test/item/${resultItem.editionNumber}`} className="btn btn-outline">
              {t("nftMint.revealed.viewItem")}
            </Link>
            <button className="btn btn-gold" onClick={() => router.push("/nft/test")}>
              {t("nftMint.revealed.backToMarket")}
            </button>
          </div>
        </div>
      )}

      {phase === "failed" && (
        <div className="card">
          <h2 style={{ marginTop: 0, color: "var(--red)" }}>{t("buy.failed.title")}</h2>
          <p className="muted">{t("buy.failed.body")}</p>
        </div>
      )}
    </div>
  );
}
