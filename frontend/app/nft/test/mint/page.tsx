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
  // Brai, 2026-09-25: "0.0025 ZEC + 0.001 ZEC platform FEE = TOTAL: 0.0035
  // ZEC" -- the flat platform fee now shows as its own line item for paid
  // mints too, not just free claims. Comes from the mint response.
  const [platformFeeZec, setPlatformFeeZec] = useState<number | null>(null);
  // Brai, 2026-09-25: "la I del platform fee no aparece la indicacion" --
  // the (i) only ever used the native `title` attribute, which never
  // triggers on a tap (no hover) on mobile, only a mouse hover on desktop.
  // Tapping the icon now also toggles this, showing the same tooltip text
  // inline right below the row -- works on both.
  const [feeTooltipOpen, setFeeTooltipOpen] = useState(false);
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

  // Brai, 2026-09-25: "quiero que cuando minteas, aparezca el nft y un
  // boton que diga SHARE y te deje compartir tu NFT en twitter" -- exact
  // same Twitter-intent + fresh-token pattern as shareStatus() in
  // nft/whitelist/page.tsx, pointed at the newly-minted piece's own share
  // page (/nft/test/share/[tier]/[editionNumber]) so the tweet's card
  // shows THIS piece, not a generic one. When more than one piece was
  // minted in the same batch, the card still shows the first piece, but
  // the caption says how many were minted.
  function shareMinted() {
    if (resultItems.length === 0) return;
    const first = resultItems[0];
    const tierSlug = nftTierSlug(first.tier);
    const label = first.name ?? nftItemLabel(first.tier, first.editionNumber);
    const caption =
      mintedQuantity > 1
        ? t("nftMint.share.caption.multi", { count: mintedQuantity })
        : t("nftMint.share.caption.single", { label });
    const freshToken = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const shareUrl = `https://zodd.fun/nft/test/share/${tierSlug}/${first.editionNumber}?t=${freshToken}`;
    const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(caption)}&url=${encodeURIComponent(shareUrl)}`;
    window.open(intentUrl, "_blank", "noopener,noreferrer");
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
      setPlatformFeeZec(result.platformFeeZec ?? null);
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

  // Brai, 2026-09-25: "quiero que a partir del proximo mint, en LIVE
  // ACTIVITY figure los mint y tambien los FORGE que hagan" -- a forge
  // craft is now its own distinct activity kind (see getRecentNftActivityGlobal's
  // comment in store.ts) instead of silently counting as a MINT, but this
  // compact "live mints" column is meant to show BOTH -- something new
  // joined a wallet's collection either way.
  const liveMints = useMemo(() => (activity ?? []).filter((a) => a.kind === "MINT" || a.kind === "FORGE").slice(0, 8), [activity]);
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
                  {t("nftMint.phase.locked")}
                </p>
              )}
              {collection.mintPhase === "whitelist" && (
                <p style={{ color: "var(--accent)", fontSize: 13 }}>
                  {t("nftMint.phase.whitelistNoTime")}
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

                  {/* Brai, 2026-09-24: "agrega un cartel que diga MAXIMO 10 POR
                      WALLET ... pero no quiero ninguna limitacion por wallet
                      mas que los 5 free mint y 1 mint free ... el mensaje
                      quiero que sea solo un mensaje de texto que no tenga
                      ninguna implicancia en la programacion ni cambie nada"
                      -- purely cosmetic, hardcoded text. Deliberately NOT
                      wired to remainingWalletAllowance/quantityCap/any real
                      limit -- public mint quantity stays unbounded below.
                      Do not tie this string to enforcement logic. */}
                  <p className="muted" style={{ fontSize: 11, letterSpacing: "0.04em", marginBottom: 8 }}>
                    {t("nftMint.publicMaxNote")}
                  </p>

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
                  {/* Brai, 2026-09-25: "quiero que desaparezca ese cartel que
                      dice 50 left for your wallet ... que desaparezca para
                      todas las wallets la cantidad que puede mintear real" --
                      this used to render remainingWalletAllowance right
                      below the stepper, which leaked the real per-wallet cap
                      and clashed with the deliberately-fake "MAXIMO 10 POR
                      WALLET" cartel above. Removed entirely; quantityCap
                      still silently caps the stepper's +/- and typed value,
                      just never displayed as a number anywhere. */}
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

            {/* Brai, 2026-09-25: "abajo en informacion en la pagina del
                mint debe figurar: 555 whitelist y 5000 public y 10 por
                persona ... esto tiene que ser informacion que este en la
                pagina, no cambia nuestro codigo porque habra mas de 555 de
                whitelist ... y tambien la gente podra mintear mas de 10"
                -- purely informational, hardcoded display numbers, same
                "text only, zero enforcement" spirit as the MAXIMUM 10 PER
                WALLET note above. Deliberately NOT wired to
                quantityCap/maxMintsPerWallet/whitelistEntry counts. */}
            <div className="nft-mintpage-schedule">
              <p className="nft-mintpage-schedule-title">{t("nftMint.info.title")}</p>
              <div className="nft-mintpage-schedule-row">
                <span className="nft-mintpage-schedule-name">{t("nftMint.info.whitelist")}</span>
                <span className="muted">555</span>
              </div>
              <div className="nft-mintpage-schedule-row">
                <span className="nft-mintpage-schedule-name">{t("nftMint.info.public")}</span>
                <span className="muted">5000</span>
              </div>
              <div className="nft-mintpage-schedule-row">
                <span className="nft-mintpage-schedule-name">{t("nftMint.info.perWallet")}</span>
                <span className="muted">10</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {phase === "waiting" && (
        <div className="card">
          {freeClaim && <div className="badge" style={{ display: "block", textAlign: "center", marginBottom: 10 }}>{t("nftMint.freeClaim.badge")}</div>}
          {/* Brai, 2026-09-25: "que te explique porque te cobra 0.001 ZEC,
              que es por los servidores y plataforma fee etc ... si estas
              comprando de manera publica nft que te cobra 0.0025 este qr
              tiene que decir 0.0025 ZEC + 0.001 ZEC platform FEE = TOTAL:
              0.0035 ZEC" -- and later, for free mints specifically: "quiero
              que cuando vayan a pagar diga 1 FREE MINT + 0.001 ZEC PLATFORM
              FEE = 0.001 ZEC (...APROBBED) y 5 FREE MINT + 0.001 ZEC
              PLATFORM FEE = 0.001 ZEC (...COLAB)" -- one shared
              price/fee=total row for both cases now: a paid mint shows its
              ZEC price as the first term, a free claim shows "{quantity}
              FREE MINT" instead (mintedQuantity already holds 1 or 5
              depending on tier, set from the free-claim response). Either
              way exactZecAmount is the real on-chain total being requested
              and platformFeeZec is never hardcoded here, always the mint
              response's own value. */}
          {platformFeeZec != null && exactZecAmount != null ? (
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  fontSize: 19,
                  fontWeight: 700,
                }}
              >
                {freeClaim ? (
                  <span>{mintedQuantity} {t("nftMint.freeMint.label")}</span>
                ) : (
                  <span>{formatZec(Math.max(0, exactZecAmount - platformFeeZec))} {collection?.currency}</span>
                )}
                <span className="muted" style={{ fontWeight: 400 }}>+</span>
                <span>{formatZec(platformFeeZec)} {collection?.currency}</span>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px" }}>{t("nftMint.platformFee.label")}</span>
                <span
                  title={t("nftMint.platformFee.tooltip")}
                  onClick={() => setFeeTooltipOpen((v) => !v)}
                  role="button"
                  tabIndex={0}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 15,
                    height: 15,
                    borderRadius: "50%",
                    border: "1px solid var(--border)",
                    fontSize: 10,
                    fontStyle: "italic",
                    fontWeight: 700,
                    letterSpacing: 0,
                    cursor: "help",
                    color: "var(--accent)",
                    flexShrink: 0,
                  }}
                >
                  i
                </span>
                <span className="muted" style={{ fontWeight: 400 }}>=</span>
                <span>{t("nftMint.total.label")}: {formatZec(exactZecAmount)} {collection?.currency}</span>
              </div>
              {/* Tap-friendly fallback for the (i) above -- a native `title`
                  attribute only ever shows on a desktop mouse hover, never on
                  a mobile tap (no hover event at all), which is why Brai saw
                  no explanation show up. */}
              {feeTooltipOpen && (
                <p className="muted" style={{ fontSize: 12, margin: "6px auto 0", maxWidth: 320 }}>
                  {t("nftMint.platformFee.tooltip")}
                </p>
              )}
              {!freeClaim && (formatUsd(exactZecAmount, usdRate) || mintedQuantity > 1) && collection?.currency === "ZEC" && (
                <p className="muted" style={{ fontSize: 13, margin: "4px 0 0" }}>
                  {formatUsd(exactZecAmount, usdRate) && <>≈ {formatUsd(exactZecAmount, usdRate)}</>}
                  {mintedQuantity > 1 && <> ({t("nftMint.quantity.label")}: {mintedQuantity})</>}
                </p>
              )}
            </div>
          ) : (
            <h2 style={{ marginTop: 0, textAlign: "center" }}>
              {exactZecAmount != null ? formatZec(exactZecAmount) : ""} {collection?.currency}
              {exactZecAmount != null && collection?.currency === "ZEC" && formatUsd(exactZecAmount, usdRate) && (
                <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}> (≈ {formatUsd(exactZecAmount, usdRate)})</span>
              )}
              {mintedQuantity > 1 && <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}> ({t("nftMint.quantity.label")}: {mintedQuantity})</span>}
            </h2>
          )}
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
            <button className="btn btn-outline" onClick={shareMinted}>
              {t("nftMint.revealed.share")}
            </button>
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
