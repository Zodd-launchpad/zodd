"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { useRouter } from "next/navigation";
import { api, formatUsd, formatZec, nftItemPath, nftItemLabel, nftTierSlug, type NftActivity, type NftCollection, type NftItem, type NftWhitelistEntry } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/translations";
import { useZecUsdPrice } from "@/lib/zecPrice";
import { useWallet } from "@/lib/wallet";
import { getNoirWallet, isNoirWalletInstalled } from "@noir-wallet/sdk";
import { NftMedia } from "@/lib/nftMedia";

// Brai, 2026-09-18: "generar una pagina para el mint, donde clickeas, te da
// una pagina para pagar, pagas y te asigne un NFT aleatorio entre los que
// te voy a mandar" -- exact same one-time-address + memo + poll mechanism
// as BuyModal.tsx/create-page.tsx (see api.mintNft/api.getNftMint in
// api.ts), just as its own page instead of a modal, ending in a reveal of
// whichever piece(s) got randomly assigned server-side.
const COLLECTION_SLUG = "zodd-genesis";

// Brai, 2026-09-19: "este es el formato de la pagina de mint que quiero,
// exactamente ese" (a Facets-style mint page screenshot) -- rebuilt around
// that layout, but using ONLY ZODD's real data: the real 2-stage presale
// (Whitelist / Public, not the reference's fabricated 5-stage system), and
// from its stats row ONLY Floor Price ("floor price si lo quiero pero top
// offer 24 hs volume y total volume no lo quiero, listed tampoco nada solo
// el floor copia de lo de arriba y owners tampoco"). The NFT media is the
// uploaded cat/mascot loop video, not a static image.

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

  // ---- eligibility / limits for the connected wallet ----
  const [whitelistEntry, setWhitelistEntry] = useState<NftWhitelistEntry | null | undefined>(undefined); // undefined = still loading
  const [mintedSoFar, setMintedSoFar] = useState<number | null>(null);
  // Brai, 2026-09-21: "esa wallet ... puede mintear 500 si quiere, sacale
  // el limite" -- this wallet's OWN cap, from /api/nft/mint-count (usually
  // 10, higher for a wallet the backend raised via HIGH_LIMIT_NFT_WALLET_IDS).
  // null until we've asked, so the stepper doesn't flash a wrong cap first.
  const [walletMintLimit, setWalletMintLimit] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);

  // ---- live feed ----
  const [activity, setActivity] = useState<NftActivity[] | null>(null);

  const [mintId, setMintId] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [exactZecAmount, setExactZecAmount] = useState<number | null>(null);
  // Brai, 2026-09-19: "inclusive los que hacen free mint tienen que hacer
  // una tx ... cobrarle muy poco" -- a whitelist free claim now waits on a
  // tiny on-chain fee too (see api.mintNft's PENDING branch), so the
  // "waiting" screen needs to say that's what this is, not a real purchase.
  const [freeClaim, setFreeClaim] = useState(false);
  const [mintedQuantity, setMintedQuantity] = useState(1);
  const [memo, setMemo] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [resultItems, setResultItems] = useState<NftItem[]>([]);
  const [noirSending, setNoirSending] = useState(false);
  const [noirTxid, setNoirTxid] = useState<string | null>(null);
  const [noirError, setNoirError] = useState<string | null>(null);
  // Brai, 2026-09-19: "cuando vas a mintear y tocas PAGAR, el QR tarda como
  // 5 segundos en aparecer... quiero que haya un cartel que diga WAIT" --
  // startMint below awaits the mint order + QR generation before flipping
  // phase to "waiting".
  // Brai, 2026-09-19: "dice que soy elegible pero me dice que me va a
  // cobrar los mints ... hacer dos botones, uno FREE MINT (solo 5, gratis)
  // y otro BUY (compra normal)" -- tracks which of the two buttons is
  // in flight, since they're now separate actions instead of one.
  const [submitting, setSubmitting] = useState<"free" | "buy" | null>(null);

  // Brai, 2026-09-21: "programar algo para el mint... que se pueda conectar
  // autentificador de twitter y si el handle esta en la lista, pasa
  // directamente a free mint... hay algunos que no conectaron la wallet y
  // voy a autorizar ahora luego del fin de la whitelist y no tendre forma
  // de saber quienes son si no tengo autentificador de twitter" -- for a
  // wallet the site doesn't yet recognize as whitelisted (whitelistEntry
  // null), lets the visitor prove their X handle via OAuth and, if that
  // handle is on Brai's approved/preapproved list, self-link it to THIS
  // wallet right here (see claim-by-x proxy route + claimNftWhitelistByVerifiedHandle
  // in store.ts). undefined = still checking whether this browser already
  // has a verified X session; null = not connected yet.
  const [xHandle, setXHandle] = useState<string | null | undefined>(undefined);
  const [claimAddress, setClaimAddress] = useState("");
  const [claimNoirBusy, setClaimNoirBusy] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

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

  useEffect(() => {
    api
      .getNftActivity()
      .then((rows) => setActivity(rows.filter((r) => r.collectionSlug === COLLECTION_SLUG)))
      .catch(() => setActivity([]));
  }, []);

  // Brai, 2026-09-19: "que el boton se desbloquee al horario que
  // corresponde segun tu wallet (si el handled es aprobado o no)" -- once a
  // wallet connects, look up whether IT is whitelist-approved (and how many
  // of its 5 free claims are left) and how many of the 10-per-wallet cap it
  // has already used, so the stage list and the quantity stepper both
  // reflect this exact wallet.
  useEffect(() => {
    if (!wallet) {
      setWhitelistEntry(null);
      setMintedSoFar(null);
      setWalletMintLimit(null);
      return;
    }
    setWhitelistEntry(undefined);
    api
      .getNftWhitelistStatusByWallet(wallet.walletId)
      .then((r) => setWhitelistEntry(r.entry))
      .catch(() => setWhitelistEntry(null));
    api
      .getNftWalletMintCount(COLLECTION_SLUG, wallet.walletId)
      .then((r) => {
        setMintedSoFar(r.count);
        setWalletMintLimit(r.maxMintsPerWallet ?? null);
      })
      .catch(() => {
        setMintedSoFar(null);
        setWalletMintLimit(null);
      });
  }, [wallet]);

  // Brai, 2026-09-21: checks whether this browser already has a verified X
  // session (either from before, or right after the OAuth redirect lands
  // back here with ?verified=1 -- see /api/auth/twitter/start's returnTo).
  // Same session-check call the whitelist wizard makes; it's a plain
  // signed-cookie read, safe to call regardless of wallet state, but only
  // useful once a wallet is connected.
  useEffect(() => {
    if (!wallet) {
      setXHandle(undefined);
      return;
    }
    fetch("/api/auth/twitter/session")
      .then((r) => r.json())
      .then((body: { handle: string | null }) => setXHandle(body.handle))
      .catch(() => setXHandle(null));
  }, [wallet]);

  // A Noir-connected wallet already has a real address on file
  // (wallet.noirAddress) -- prefill it so most people never have to type
  // anything, same as the whitelist wizard's own Noir autofill button.
  useEffect(() => {
    if (wallet?.noirAddress) setClaimAddress(wallet.noirAddress);
  }, [wallet]);

  async function autofillClaimAddress() {
    setClaimError(null);
    setClaimNoirBusy(true);
    try {
      if (!isNoirWalletInstalled()) {
        setClaimError(t("onboard.noir.notInstalled"));
        return;
      }
      const noirWallet = getNoirWallet();
      if (!noirWallet) {
        setClaimError(t("onboard.noir.notInstalled"));
        return;
      }
      const connection = await noirWallet.zcash.connect();
      setClaimAddress(connection.shielded);
    } catch (e: any) {
      setClaimError(e?.code === 4001 || /reject/i.test(e?.message ?? "") ? t("onboard.noir.rejected") : e?.message ?? "connect failed");
    } finally {
      setClaimNoirBusy(false);
    }
  }

  async function claimByX() {
    if (!wallet || !claimAddress.trim()) return;
    setClaimError(null);
    setClaiming(true);
    try {
      const res = await fetch("/api/nft/whitelist/claim-by-x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ walletId: wallet.walletId, address: claimAddress.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `error ${res.status}`);
      // Same entry shape getNftWhitelistStatusByWallet returns -- this
      // instantly unlocks the FREE MINT button below, no page reload.
      setWhitelistEntry(body);
    } catch (e: any) {
      setClaimError(e.message);
    } finally {
      setClaiming(false);
    }
  }

  // Brai, 2026-09-21: prefer THIS wallet's own limit (walletMintLimit, from
  // /api/nft/mint-count -- raised for a wallet in HIGH_LIMIT_NFT_WALLET_IDS)
  // over the collection's generic one, so a raised wallet's stepper can
  // actually reach past 10 instead of being silently capped by the flat
  // default the collection endpoint always reports.
  const maxMintsPerWallet = walletMintLimit ?? collection?.maxMintsPerWallet ?? 10;
  const remainingWalletAllowance =
    mintedSoFar != null ? Math.max(0, maxMintsPerWallet - mintedSoFar) : maxMintsPerWallet;
  const remainingSupply = collection ? Math.max(0, collection.totalSupply - collection.mintedCount) : 0;
  const quantityCap = Math.max(1, Math.min(remainingWalletAllowance || 1, remainingSupply || 1));

  useEffect(() => {
    setQuantity((q) => Math.min(Math.max(1, q), quantityCap));
  }, [quantityCap]);

  const freeRemaining =
    whitelistEntry && collection ? Math.max(0, whitelistEntry.freeMintLimit - whitelistEntry.claimedCount) : null;
  // Brai, 2026-09-19: how many the FREE MINT button actually grabs -- capped
  // by whatever's left of the wallet's 5 free claims, the overall
  // per-wallet cap, and remaining supply. No stepper for this one on
  // purpose (Brai: "solo te deje mintear 5") -- it just claims all of it.
  const freeMintQuantity = Math.max(0, Math.min(freeRemaining ?? 0, remainingWalletAllowance, remainingSupply));

  const unitPriceZec = collection?.mintPriceZec ?? 0;
  const totalPriceZec = unitPriceZec * quantity;

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

  async function startMint(mintQuantity: number, which: "free" | "buy") {
    if (!wallet || mintQuantity < 1) return;
    setError(null);
    setSubmitting(which);
    try {
      const result = await api.mintNft({ walletId: wallet.walletId, collectionSlug: COLLECTION_SLUG, quantity: mintQuantity });
      if ("free" in result) {
        // free whitelist/owner mint -- assigned immediately, nothing to pay
        const items = await Promise.all(
          result.editionNumbers.map((en, i) =>
            api.getNftItem(COLLECTION_SLUG, nftTierSlug(result.tiers[i]), en).then((r) => r.item)
          )
        );
        setResultItems(items);
        setMintedQuantity(items.length);
        setPhase("revealed");
        return;
      }
      setMintId(result.mintId);
      setAddress(result.zecAddress);
      setExactZecAmount(result.zecAmount);
      setMintedQuantity(result.quantity);
      setMemo(result.memo ?? null);
      setFreeClaim(!!result.freeClaim);
      const uri = `zcash:${result.zecAddress}?amount=${result.zecAmount}${result.memo ? `&memo=${result.memo}` : ""}`;
      setQr(await QRCode.toDataURL(uri, { margin: 1, width: 220 }));
      setPhase("waiting");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(null);
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
      if (mint.status === "CREATED" && mint.resultItems && mint.resultItems.length > 0) {
        setResultItems(mint.resultItems);
        setMintedQuantity(mint.resultItems.length);
        setPhase("revealed");
        clearInterval(id);
      } else if (mint.status === "EXPIRED" || mint.status === "FAILED") {
        setPhase("failed");
        clearInterval(id);
      }
    }, 1500);
    return () => clearInterval(id);
  }, [phase, mintId]);

  const liveMints = useMemo(() => (activity ?? []).filter((a) => a.kind === "MINT").slice(0, 8), [activity]);
  const liveSales = useMemo(() => (activity ?? []).filter((a) => a.kind === "SALE").slice(0, 8), [activity]);

  if (walletLoading || phase === "loading") return null;

  if (phase === "notConfigured") {
    return (
      <div className="container nft-market">
        <p className="muted">{t("nftMarket.notConfigured.body")}</p>
      </div>
    );
  }

  const badgeKey: TranslationKey =
    phase === "soldOut" || collection?.soldOut
      ? "nftMint.badge.soldOut"
      : collection?.mintPhase === "public"
        ? "nftMint.badge.public"
        : collection?.mintPhase === "whitelist"
          ? "nftMint.badge.whitelist"
          : "nftMint.badge.locked";
  const badgeClass =
    collection?.soldOut
      ? "nft-mintpage-badge sold-out"
      : collection?.mintPhase === "public"
        ? "nft-mintpage-badge live"
        : collection?.mintPhase === "whitelist"
          ? "nft-mintpage-badge live"
          : "nft-mintpage-badge locked";

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
        <div className="nft-mintpage-grid">
          {/* ---- Left: media ---- */}
          <div className="nft-mintpage-media">
            <video className="nft-mintpage-video" src="/zodd-mascot-loop.mp4" autoPlay loop muted playsInline>
              <source src="/zodd-mascot-loop.webm" type="video/webm" />
              <source src="/zodd-mascot-loop.mp4" type="video/mp4" />
            </video>
          </div>

          {/* ---- Right: info / mint box ---- */}
          <div className="nft-mintpage-info">
            <div className="nft-mintpage-header">
              <div>
                <h1 className="nft-mintpage-title">{collection.name}</h1>
                <p className="muted nft-mintpage-supply">{t("nftMint.supply", { supply: collection.mintedCount, total: collection.supplyTotal })}</p>
              </div>
              <span className={badgeClass}>{t(badgeKey)}</span>
            </div>

            <div className="nft-mintpage-stats">
              <div className="nft-mintpage-stat">
                <span className="nft-mintpage-stat-label">{t("nftMint.stats.floorPrice")}</span>
                <span className="nft-mintpage-stat-value">
                  {collection.floorZec != null ? (
                    <>
                      {formatZec(collection.floorZec)} {collection.currency}
                    </>
                  ) : (
                    t("nftMint.stats.noFloor")
                  )}
                </span>
              </div>
            </div>

            <div className="nft-mintpage-stagebox">
              <div className="nft-mintpage-stage-row">
                <span className="nft-mintpage-stage-label">{t("nftMint.stage.currentLabel")}</span>
                <span className="nft-mintpage-stage-name">
                  {collection.mintPhase === "public"
                    ? t("nftMint.schedule.publicStage")
                    : collection.mintPhase === "whitelist"
                      ? t("nftMint.schedule.whitelistStage")
                      : t("nftMint.badge.locked")}
                </span>
              </div>

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
                <p className="muted">{t("nftMint.connectToMint")}</p>
              ) : remainingWalletAllowance <= 0 ? (
                <p style={{ color: "var(--red)", fontSize: 13 }}>{t("nftMint.limitReached")}</p>
              ) : (
                <>
                  {freeRemaining != null && (
                    <p className="muted" style={{ fontSize: 12 }}>
                      {freeRemaining > 0
                        ? t("nftMint.stage.freeRemaining", { count: freeRemaining })
                        : t("nftMint.stage.freeUsedUp")}
                    </p>
                  )}

                  {/* Brai, 2026-09-21: connected wallet has no whitelist
                      entry on file yet -- offer the X-verify self-link
                      instead of just saying NOT ELIGIBLE, for the people
                      Brai preapproved after the whitelist closed and who
                      never went through the old wallet+handle wizard. */}
                  {freeRemaining == null && (
                    <div
                      style={{
                        marginBottom: 14,
                        padding: 12,
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        background: "var(--panel)",
                      }}
                    >
                      <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
                        {t("nftMint.xClaim.intro")}
                      </p>
                      {xHandle === undefined ? null : xHandle ? (
                        <>
                          <p className="zw-connected" style={{ fontSize: 12, color: "var(--green)", margin: "0 0 8px" }}>
                            &gt; {t("nftWhitelist.wizard.xConnected", { handle: xHandle })}
                          </p>
                          <div className="field" style={{ marginBottom: 8 }}>
                            <input
                              value={claimAddress}
                              onChange={(e) => setClaimAddress(e.target.value)}
                              placeholder="u1… / zs1… / t1…"
                              className="mono"
                            />
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              className="btn btn-outline"
                              style={{ flex: 1, fontSize: 12, padding: "6px 10px" }}
                              disabled={claimNoirBusy}
                              onClick={autofillClaimAddress}
                            >
                              {claimNoirBusy ? t("nftWhitelist.wizard.noirAutofilling") : t("nftWhitelist.wizard.noirAutofill")}
                            </button>
                            <button
                              className="btn btn-gold"
                              style={{ flex: 1, fontSize: 12, padding: "6px 10px" }}
                              disabled={claiming || !claimAddress.trim()}
                              onClick={claimByX}
                            >
                              {claiming ? t("common.wait") : t("nftMint.xClaim.checkButton")}
                            </button>
                          </div>
                          {claimError && (
                            <p style={{ color: "var(--red)", fontSize: 12, marginTop: 8, marginBottom: 0 }}>{claimError}</p>
                          )}
                        </>
                      ) : (
                        <a
                          className="btn btn-gold"
                          href={`/api/auth/twitter/start?returnTo=${encodeURIComponent("/nft/test/mint")}`}
                          style={{ display: "inline-block" }}
                        >
                          {t("nftWhitelist.wizard.connectX")}
                        </a>
                      )}
                    </div>
                  )}

                  {freeMintQuantity > 0 && (
                    <>
                      <button
                        className="btn btn-gold"
                        style={{ width: "100%", marginBottom: 4 }}
                        onClick={() => startMint(freeMintQuantity, "free")}
                        disabled={submitting !== null}
                      >
                        {submitting === "free" ? t("common.wait") : t("nftMint.freeMintButton", { count: freeMintQuantity })}
                      </button>
                      <p className="muted" style={{ fontSize: 11, marginBottom: 12, marginTop: 0 }}>{t("nftMint.freeClaim.feeNote")}</p>
                    </>
                  )}

                  <div className="nft-mintpage-qty-row">
                    <span className="nft-mintpage-stage-label">{t("nftMint.quantity.label")}</span>
                    <div className="nft-mintpage-stepper">
                      <button
                        type="button"
                        className="nft-mintpage-stepper-btn"
                        onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                        disabled={quantity <= 1}
                      >
                        −
                      </button>
                      <input
                        type="number"
                        className="nft-mintpage-stepper-input"
                        min={1}
                        max={quantityCap}
                        value={quantity}
                        onChange={(e) => {
                          const n = parseInt(e.target.value, 10);
                          if (!Number.isNaN(n)) setQuantity(Math.min(Math.max(1, n), quantityCap));
                        }}
                      />
                      <button
                        type="button"
                        className="nft-mintpage-stepper-btn"
                        onClick={() => setQuantity((q) => Math.min(quantityCap, q + 1))}
                        disabled={quantity >= quantityCap}
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <p className="muted" style={{ fontSize: 12 }}>
                    {t("nftMint.quantity.remaining", { count: remainingWalletAllowance })}
                  </p>

                  <div className="nft-mintpage-total-row">
                    <span className="nft-mintpage-stage-label">{t("nftMint.total.label")}</span>
                    <span className="nft-mintpage-total-value">
                      {formatZec(totalPriceZec)} {collection.currency}
                      {collection.currency === "ZEC" && formatUsd(totalPriceZec, usdRate) && (
                        <span className="muted" style={{ fontSize: 12, fontWeight: 400, marginLeft: 6 }}>
                          (≈ {formatUsd(totalPriceZec, usdRate)})
                        </span>
                      )}
                    </span>
                  </div>

                  {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
                  <button
                    className="btn btn-gold"
                    style={{ width: "100%", marginTop: 10 }}
                    onClick={() => startMint(quantity, "buy")}
                    disabled={submitting !== null}
                  >
                    {submitting === "buy" ? t("common.wait") : t("nftMint.buyButton")}
                  </button>
                </>
              )}
            </div>

            {/* ---- Schedule ---- */}
            <div className="nft-mintpage-schedule">
              <h3 className="nft-mintpage-schedule-title">{t("nftMint.schedule.title")}</h3>
              <div className="nft-mintpage-schedule-row">
                <div>
                  <div className="nft-mintpage-schedule-name">{t("nftMint.schedule.whitelistStage")}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {collection.whitelistStartsAt ? formatLocalTime(collection.whitelistStartsAt) : t("nftMint.schedule.notScheduled")}
                    {" · "}
                    {t("nftMint.schedule.free", { max: collection.whitelistFreeMintLimit })}
                  </div>
                </div>
                {wallet && (
                  <span className={`nft-mintpage-eligibility ${whitelistEntry ? "eligible" : "not-eligible"}`}>
                    {whitelistEntry ? t("nftMint.schedule.eligible") : t("nftMint.schedule.notEligible")}
                  </span>
                )}
              </div>
              <div className="nft-mintpage-schedule-row">
                <div>
                  <div className="nft-mintpage-schedule-name">{t("nftMint.schedule.publicStage")}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {collection.publicStartsAt ? formatLocalTime(collection.publicStartsAt) : t("nftMint.schedule.notScheduled")}
                    {" · "}
                    {formatZec(collection.mintPriceZec)} {collection.currency}
                  </div>
                </div>
                {wallet && <span className="nft-mintpage-eligibility eligible">{t("nftMint.schedule.eligible")}</span>}
              </div>
            </div>

            {/* ---- Live feeds ---- */}
            <div className="nft-mintpage-live-grid">
              <div className="nft-mintpage-live-col">
                <h4 className="nft-mintpage-live-title">{t("nftMint.live.mints")}</h4>
                {liveMints.length === 0 ? (
                  <p className="muted" style={{ fontSize: 12 }}>{t("nftMint.live.empty")}</p>
                ) : (
                  liveMints.map((a, i) => (
                    <Link key={`${a.editionNumber}-${a.createdAt}-${i}`} href={nftItemPath(a.editionNumber, a.tier)} className="nft-mintpage-live-row">
                      <span>{a.name ?? nftItemLabel(a.tier, a.editionNumber)}</span>
                      <span className="muted">{new Date(a.createdAt).toLocaleTimeString()}</span>
                    </Link>
                  ))
                )}
              </div>
              <div className="nft-mintpage-live-col">
                <h4 className="nft-mintpage-live-title">{t("nftMint.live.sales")}</h4>
                {liveSales.length === 0 ? (
                  <p className="muted" style={{ fontSize: 12 }}>{t("nftMint.live.empty")}</p>
                ) : (
                  liveSales.map((a, i) => (
                    <Link key={`${a.editionNumber}-${a.createdAt}-${i}`} href={nftItemPath(a.editionNumber, a.tier)} className="nft-mintpage-live-row">
                      <span>{a.name ?? nftItemLabel(a.tier, a.editionNumber)}</span>
                      <span>
                        {formatZec(a.priceZec)} {a.currency}
                      </span>
                    </Link>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {phase === "waiting" && (
        <div className="card">
          {freeClaim && <div className="badge" style={{ display: "block", textAlign: "center", marginBottom: 10 }}>{t("nftMint.freeClaim.badge")}</div>}
          <h2 style={{ marginTop: 0, textAlign: "center" }}>
            {exactZecAmount != null ? formatZec(exactZecAmount) : ""} {collection?.currency}
            {mintedQuantity > 1 && <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}> ({t("nftMint.quantity.label")}: {mintedQuantity})</span>}
          </h2>
          <p className="muted" style={{ textAlign: "center" }}>{freeClaim ? t("nftMint.freeClaim.waitingBody") : t("nftMint.waitingBody")}</p>
          {isRealMode && (
            <div style={{ margin: "12px 0" }}>
              {noirTxid ? (
                <p style={{ color: "var(--green)", fontSize: 12, textAlign: "center" }}>{t("payment.noir.sent")}</p>
              ) : (
                <button className="btn btn-gold" style={{ width: "100%" }} disabled={noirSending} onClick={payWithNoir}>
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

      {phase === "revealed" && resultItems.length > 0 && (
        <div className="card nft-reveal-card">
          <div className="nft-reveal-badge">{t("nftMint.revealed.badge")}</div>
          {resultItems.length === 1 ? (
            <>
              {resultItems[0].imageDataUrl && <NftMedia src={resultItems[0].imageDataUrl} alt={resultItems[0].name ?? ""} className="nft-reveal-img" />}
              <h2 style={{ margin: "12px 0 4px" }}>{resultItems[0].name ?? nftItemLabel(resultItems[0].tier, resultItems[0].editionNumber)}</h2>
            </>
          ) : (
            <div className="nft-mintpage-reveal-grid">
              {resultItems.map((item) => (
                <div key={item.id} className="nft-mintpage-reveal-item">
                  {item.imageDataUrl && <NftMedia src={item.imageDataUrl} alt={item.name ?? ""} />}
                  <span>{item.name ?? nftItemLabel(item.tier, item.editionNumber)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="nft-mint-footer">
            {resultItems.length === 1 && (
              <Link href={nftItemPath(resultItems[0].editionNumber, resultItems[0].tier)} className="btn btn-outline">
                {t("nftMint.revealed.viewItem")}
              </Link>
            )}
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
