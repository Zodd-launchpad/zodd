"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useWallet } from "@/lib/wallet";
import { api, formatUsd } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { useZecUsdPrice } from "@/lib/zecPrice";
import { fileToSquareDataUrl } from "@/lib/imageResize";

type Phase = "form" | "waiting" | "created" | "failed";

export default function CreatePage() {
  const { wallet } = useWallet();
  const { t } = useLanguage();
  const usdRate = useZecUsdPrice();
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [creatorPayoutAddress, setCreatorPayoutAddress] = useState("");
  const [description, setDescription] = useState("");
  const [twitterUrl, setTwitterUrl] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>("form");
  const [creationId, setCreationId] = useState<string | null>(null);
  const [zecAddress, setZecAddress] = useState<string | null>(null);
  const [zecAmount, setZecAmount] = useState<number | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [isRealMode, setIsRealMode] = useState(false);
  const [createFeeZec, setCreateFeeZec] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedTwoLine, setCopiedTwoLine] = useState(false);
  // Brai, 2026-09-07: "haz ese parche" -- same reasoning as BuyModal.tsx:
  // copy/paste needs the full payment link (with memo) to get the same
  // collision protection scanning the QR already gets.
  const [paymentUri, setPaymentUri] = useState<string | null>(null);
  const [createdSymbol, setCreatedSymbol] = useState<string | null>(null);

  useEffect(() => {
    api
      .getMode()
      .then((m) => {
        setIsRealMode(m.zcashMode === "real");
        setCreateFeeZec(m.tokenCreateFeeZec);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!wallet) return;
    // Brai, 2026-09-07: "tenemos que hacer un sistema que ponga la wallet
    // por si falla la transaccion" -- same pre-fill SellModal already does
    // with defaultRefundAddress (Brai, earlier: "cuando toco SELL ya me
    // queda asociada"). If this creator already has a real Zcash address
    // on file from a previous sell or token creation, fill it in here too,
    // so a failed/expired creation (or just a second token) doesn't force
    // re-typing/re-pasting it from scratch. Still fully editable -- this
    // only sets the initial value, so it never fights with what's typed.
    api
      .portfolio(wallet.walletId)
      .then((p) => {
        if (p.defaultRefundAddress) setCreatorPayoutAddress((prev) => prev || p.defaultRefundAddress!);
      })
      .catch(() => {});
  }, [wallet]);

  async function onLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setLogoDataUrl(await fileToSquareDataUrl(file));
    } catch {
      setError(t("create.logoError"));
    }
  }

  async function submit() {
    setError(null);
    if (!wallet) return setError(t("create.connectFirst"));
    try {
      const res = await api.createToken({
        symbol,
        name,
        creatorWalletId: wallet.walletId,
        creatorPayoutAddress: creatorPayoutAddress.trim() || undefined,
        logoDataUrl: logoDataUrl ?? undefined,
        description: description.trim() || undefined,
        twitterUrl: twitterUrl.trim() || undefined,
        websiteUrl: websiteUrl.trim() || undefined,
      });
      setCreationId(res.creationId);
      setZecAddress(res.zecAddress);
      setZecAmount(res.zecAmount);
      // Brai, 2026-09-07: "esto tiene que ir por frase semilla" -- every
      // token creation pays the exact same fixed fee, so amount collisions
      // here are actually the MOST likely of all (see the matching comment
      // in BuyModal.tsx / buildPaymentMemoBase64 in zcashReal.ts). The memo
      // makes this creation's payment identifiable by its own unique id
      // regardless of how many other creators are paying the same fee at
      // the same time.
      const uri = `zcash:${res.zecAddress}?amount=${res.zecAmount}${res.memo ? `&memo=${res.memo}` : ""}`;
      setPaymentUri(uri);
      setQr(await QRCode.toDataURL(uri, { margin: 1, width: 220 }));
      setPhase("waiting");
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    if (phase !== "waiting" || !creationId) return;
    const id = setInterval(async () => {
      try {
        const c = await api.getTokenCreation(creationId);
        if (c.status === "CREATED") {
          clearInterval(id);
          setCreatedSymbol((c.resultSymbol ?? symbol).toUpperCase());
          setPhase("created");
        } else if (c.status === "FAILED" || c.status === "EXPIRED") {
          clearInterval(id);
          setPhase("failed");
        }
      } catch {
        // transient — keep polling
      }
    }, 1000);
    return () => clearInterval(id);
  }, [phase, creationId, symbol]);

  function retry() {
    setPhase("form");
    setCreationId(null);
    setZecAddress(null);
    setZecAmount(null);
    setPaymentUri(null);
    setQr(null);
    setError(null);
  }

  async function copyAddress() {
    if (!paymentUri) return;
    try {
      await navigator.clipboard.writeText(paymentUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard not available — the address is still selectable/visible
    }
  }

  // Brai, 2026-09-07 (round 2): "cuando vas a copiar el ID del memo se te
  // cerro la noir y no podes pegar el memo" -- same fix as BuyModal.tsx: a
  // separate memo-only copy meant switching to Noir twice, and the second
  // switch was closing Noir before the memo could be pasted. One tap now
  // copies address+memo together -- one switch to Noir, one paste, Noir
  // splits it on its own. creationId is already the plain, un-base64'd
  // memo text.
  async function copyAddressAndMemo() {
    if (!zecAddress || !creationId) return;
    try {
      await navigator.clipboard.writeText(`${zecAddress}\n${creationId}`);
      setCopiedTwoLine(true);
      setTimeout(() => setCopiedTwoLine(false), 1500);
    } catch {
      // clipboard not available — address/memo are still visible above
    }
  }

  if (phase === "waiting") {
    return (
      <div className="container" style={{ maxWidth: 480 }}>
        <div className="card">
          <p className="muted" style={{ textAlign: "center", marginBottom: 4, textTransform: "uppercase", letterSpacing: 1, fontSize: 11 }}>
            {t("create.waiting.title")}
          </p>
          <h2 style={{ marginTop: 0, textAlign: "center", fontSize: 40, lineHeight: 1.1 }}>{zecAmount} ZEC</h2>
          {formatUsd(zecAmount ?? 0, usdRate) && (
            <p className="muted" style={{ textAlign: "center", marginTop: -8 }}>≈ {formatUsd(zecAmount ?? 0, usdRate)}</p>
          )}
          <p className="muted" style={{ textAlign: "center" }}>
            {t("create.waiting.sendExactly", { amount: zecAmount ?? "", symbol })}
          </p>
          {qr && (
            <div style={{ background: "#fff", padding: 12, borderRadius: 6, display: "flex", justifyContent: "center", margin: "12px 0" }}>
              <img src={qr} alt="qr" />
            </div>
          )}
          <div className="mono-break" style={{ fontSize: 11, color: "var(--accent)", border: "1px solid var(--border)", padding: 8, borderRadius: 4 }}>
            {zecAddress}
          </div>
          <button className="btn btn-outline" style={{ width: "100%", marginTop: 8 }} onClick={copyAddress}>
            {copied ? "✓" : t("create.waiting.copyAddress")}
          </button>
          {isRealMode && (
            <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>{t("payment.copyHint")}</p>
          )}
          {/* Brai, 2026-09-07: "un cartel grande que diga SI TENES NOIR USA
              MEMO Y EL MEMO: ..." -- big, unmissable box; the button copies
              address+memo together in one tap (see copyAddressAndMemo). */}
          {isRealMode && creationId && zecAddress && (
            <div
              style={{
                marginTop: 12,
                padding: "12px 14px",
                borderRadius: 8,
                border: "2px solid var(--bronze, #c9a24b)",
                background: "rgba(201,162,75,0.1)",
                textAlign: "center",
              }}
            >
              <p style={{ margin: "0 0 6px", fontWeight: 800, fontSize: 14, letterSpacing: 0.3, color: "var(--bronze, #c9a24b)" }}>
                {t("payment.noirBanner.title")}
              </p>
              <p className="muted" style={{ margin: "0 0 8px", fontSize: 12 }}>{t("payment.noirBanner.body")}</p>
              <button
                type="button"
                onClick={copyAddressAndMemo}
                className="mono"
                style={{
                  display: "block",
                  width: "100%",
                  fontSize: 22,
                  fontWeight: 800,
                  padding: "12px 8px",
                  borderRadius: 6,
                  border: `1px solid ${copiedTwoLine ? "var(--green)" : "var(--border)"}`,
                  background: "transparent",
                  color: copiedTwoLine ? "var(--green)" : "var(--text)",
                  cursor: "pointer",
                  wordBreak: "break-all",
                }}
              >
                {copiedTwoLine ? "✓" : creationId}
              </button>
            </div>
          )}
          <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>
            {isRealMode ? t("create.waiting.realNote") : t("create.waiting.simulatedNote")}
          </p>
          {isRealMode && (
            <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>{t("payment.recommendedWallets")}</p>
          )}
          {isRealMode && (
            <button
              className="btn btn-outline"
              style={{ width: "100%", marginTop: 10, fontSize: 12, lineHeight: 1.4 }}
              onClick={() => (location.href = "/launchpad")}
            >
              {t("buy.alreadyPaidAck")}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (phase === "created") {
    return (
      <div className="container" style={{ maxWidth: 480 }}>
        <div className="card" style={{ textAlign: "center" }}>
          <h2 style={{ marginTop: 0, color: "var(--green)", fontSize: 28, letterSpacing: 1 }}>
            {t("create.created.title")}
          </h2>
          <p className="muted">{t("create.created.body", { symbol: createdSymbol ?? symbol })}</p>
          <a href={`/launchpad/token/${createdSymbol ?? symbol}`} className="btn btn-gold" style={{ width: "100%", display: "block", marginTop: 12 }}>
            {t("create.created.viewButton", { symbol: createdSymbol ?? symbol })}
          </a>
        </div>
      </div>
    );
  }

  if (phase === "failed") {
    return (
      <div className="container" style={{ maxWidth: 480 }}>
        <div className="card">
          <h2 style={{ marginTop: 0, color: "var(--red)" }}>{t("create.failed.title")}</h2>
          <p className="muted">{t("create.failed.body")}</p>
          <button className="btn btn-gold" style={{ width: "100%" }} onClick={retry}>
            {t("create.failed.retry")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: 480 }}>
      <h1 style={{ fontSize: 18 }}>{t("create.title")}</h1>
      <p className="muted" style={{ marginBottom: 8 }}>
        {t("create.feeNote", { amount: createFeeZec ?? "…" })}
        {createFeeZec != null && formatUsd(createFeeZec, usdRate) && ` (≈ ${formatUsd(createFeeZec, usdRate)})`}
      </p>
      <p className="muted" style={{ marginBottom: 20 }}>
        {t("create.tradingFeeNote")}
      </p>
      <div className="card">
        <div className="field">
          <label>{t("create.logoLabel")}</label>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {logoDataUrl && (
              <img src={logoDataUrl} alt="" width={48} height={48} style={{ borderRadius: 8, objectFit: "cover" }} />
            )}
            <label className="btn btn-outline" style={{ cursor: "pointer", fontSize: 12 }}>
              {t("create.logoChoose")}
              <input type="file" accept="image/*" onChange={onLogoChange} style={{ display: "none" }} />
            </label>
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            {t("create.logoHelp")}
          </p>
        </div>
        <div className="field">
          <label>{t("create.symbolLabel")}</label>
          <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="ZODD" maxLength={12} />
        </div>
        <div className="field">
          <label>{t("create.nameLabel")}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("create.namePlaceholder")} maxLength={64} />
        </div>
        <div className="field">
          <label>{t("create.descriptionLabel")}</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("create.descriptionPlaceholder")}
            maxLength={500}
            rows={3}
            style={{
              width: "100%",
              background: "var(--bg, #0d0d0f)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "inherit",
              padding: "8px 10px",
              fontFamily: "inherit",
              fontSize: 13,
              resize: "vertical",
            }}
          />
        </div>
        <div className="field">
          <label>{t("create.twitterLabel")}</label>
          <input value={twitterUrl} onChange={(e) => setTwitterUrl(e.target.value)} placeholder={t("create.twitterPlaceholder")} maxLength={200} />
        </div>
        <div className="field">
          <label>{t("create.websiteLabel")}</label>
          <input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder={t("create.websitePlaceholder")} maxLength={200} />
        </div>
        <div className="field">
          <label>{t("create.creatorPayoutLabel")}</label>
          <input
            value={creatorPayoutAddress}
            onChange={(e) => setCreatorPayoutAddress(e.target.value)}
            placeholder={t("create.creatorPayoutPlaceholder")}
          />
          <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            {t("create.creatorPayoutHelp")}
          </p>
        </div>
        {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
        <button className="btn btn-gold" style={{ width: "100%" }} onClick={submit} disabled={!symbol || !name}>
          {t("create.button")}
        </button>
      </div>
    </div>
  );
}
