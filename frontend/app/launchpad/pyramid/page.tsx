"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { useWallet } from "@/lib/wallet";
import { api, formatUsd, formatZec, type Currency } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { useZecUsdPrice } from "@/lib/zecPrice";
import { fileToSquareDataUrl } from "@/lib/imageResize";
import { getNoirWallet, isNoirWalletInstalled } from "@noir-wallet/sdk";

// Brai, 2026-09-19: "LA PIRAMIDE, que es de donde salen unos tokens
// especiales, estos tokens, tienen una curva que a los 3 ZEC bondean, luego
// pasan al general y ahi pueden todos comprar ese token. Tener la reliquia
// hace que tengas el privilegio de entrar a esa pestaña" -- this is a
// near-duplicate of /launchpad/create/page.tsx's form (same payment/poll
// mechanics -- one-time address + memo, same as every other real-ZEC flow
// in this app), gated behind owning a reliquia (checked live via
// api.checkPyramidAccess, and enforced again server-side in POST /api/tokens
// regardless of what this page shows) and passing isPyramidToken: true so
// the resulting token gets the lower (3 ZEC) graduation threshold instead
// of the normal one -- see graduationThresholdFor in the backend.
type Phase = "form" | "waiting" | "created" | "failed";
type AccessState = "checking" | "locked" | "unlocked";

export default function PyramidCreatePage() {
  const { wallet } = useWallet();
  const { t } = useLanguage();
  const usdRate = useZecUsdPrice();

  const [access, setAccess] = useState<AccessState>("checking");

  useEffect(() => {
    if (!wallet) {
      setAccess("checking");
      return;
    }
    setAccess("checking");
    api
      .checkPyramidAccess(wallet.walletId)
      .then((r) => setAccess(r.hasAccess ? "unlocked" : "locked"))
      .catch(() => setAccess("locked"));
  }, [wallet]);

  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<Currency>("ZEC");
  const [creatorPayoutAddress, setCreatorPayoutAddress] = useState("");
  const [description, setDescription] = useState("");
  const [twitterUrl, setTwitterUrl] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [firstBuyZecInput, setFirstBuyZecInput] = useState("");
  const firstBuyZec = Number(firstBuyZecInput) || 0;

  const [phase, setPhase] = useState<Phase>("form");
  const [creationId, setCreationId] = useState<string | null>(null);
  const [zecAddress, setZecAddress] = useState<string | null>(null);
  const [zecAmount, setZecAmount] = useState<number | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [currencies, setCurrencies] = useState<{ ZEC: { mode: "real" | "mock"; createFeeZec: number; maxFirstBuyZec: number }; YEC: { mode: "real" | "mock"; createFeeZec: number; maxFirstBuyZec: number } } | null>(null);
  const isRealMode = currencies?.[currency]?.mode === "real";
  const createFeeZec = currencies?.[currency]?.createFeeZec ?? null;
  const maxFirstBuyZec = currencies?.[currency]?.maxFirstBuyZec ?? 0.1;
  const [paymentBreakdown, setPaymentBreakdown] = useState<{ createFeeZec: number; firstBuyZec: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [paymentUri, setPaymentUri] = useState<string | null>(null);
  const [createdSymbol, setCreatedSymbol] = useState<string | null>(null);
  const [memo, setMemo] = useState<string | null>(null);
  const [noirSending, setNoirSending] = useState(false);
  const [noirTxid, setNoirTxid] = useState<string | null>(null);
  const [noirError, setNoirError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getMode()
      .then((m) => setCurrencies(m.currencies))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!wallet) return;
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
        currency,
        creatorPayoutAddress: creatorPayoutAddress.trim() || undefined,
        logoDataUrl: logoDataUrl ?? undefined,
        description: description.trim() || undefined,
        twitterUrl: twitterUrl.trim() || undefined,
        websiteUrl: websiteUrl.trim() || undefined,
        firstBuyZec: firstBuyZec > 0 ? firstBuyZec : undefined,
        isPyramidToken: true,
      });
      setCreationId(res.creationId);
      setZecAddress(res.zecAddress);
      setZecAmount(res.zecAmount);
      setPaymentBreakdown({ createFeeZec: res.createFeeZec, firstBuyZec: res.firstBuyZec });
      const scheme = res.currency === "YEC" ? "ycash" : "zcash";
      const uri = `${scheme}:${res.zecAddress}?amount=${res.zecAmount}${res.memo ? `&memo=${res.memo}` : ""}`;
      setPaymentUri(uri);
      setMemo(res.memo ?? null);
      setQr(await QRCode.toDataURL(uri, { margin: 1, width: 220 }));
      setPhase("waiting");
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function payWithNoir() {
    setNoirError(null);
    if (!zecAddress || zecAmount == null) return;
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
      const txid = await zcash.sendTransaction({
        to: zecAddress,
        amount: String(zecAmount),
        memo: memo ?? undefined,
        fundingSource: "shielded",
      });
      setNoirTxid(txid);
    } catch (e: any) {
      setNoirError(e?.code === 4001 ? t("payment.noir.rejected") : e?.message ?? t("payment.noir.failed"));
    } finally {
      setNoirSending(false);
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
    setPaymentBreakdown(null);
  }

  async function copyAddress() {
    if (!zecAddress) return;
    try {
      await navigator.clipboard.writeText(zecAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard not available — the address is still selectable/visible
    }
  }

  // ---- Gate: no wallet / checking / locked ----
  if (!wallet || access === "checking") {
    return (
      <div className="container" style={{ maxWidth: 480 }}>
        <h1 style={{ fontSize: 18 }}>{t("pyramid.title")}</h1>
        <p className="muted" style={{ marginBottom: 20 }}>{t("pyramid.subtitle")}</p>
        <div className="card" style={{ textAlign: "center" }}>
          <p className="muted">{wallet ? t("pyramid.checkingAccess") : t("create.connectFirst")}</p>
        </div>
      </div>
    );
  }

  if (access === "locked") {
    return (
      <div className="container" style={{ maxWidth: 480 }}>
        <h1 style={{ fontSize: 18 }}>{t("pyramid.title")}</h1>
        <p className="muted" style={{ marginBottom: 20 }}>{t("pyramid.subtitle")}</p>
        <div className="card nft-forge-reliquia-note" style={{ textAlign: "center" }}>
          <h3 style={{ marginTop: 0 }}>{t("pyramid.locked.title")}</h3>
          <p className="muted">{t("pyramid.locked.body")}</p>
          <Link href="/nft/test" className="btn btn-gold" style={{ display: "block", marginTop: 12 }}>
            {t("pyramid.locked.goToForge")}
          </Link>
        </div>
      </div>
    );
  }

  if (phase === "waiting") {
    return (
      <div className="container" style={{ maxWidth: 480 }}>
        <div className="card">
          <p className="muted" style={{ textAlign: "center", marginBottom: 4, textTransform: "uppercase", letterSpacing: 1, fontSize: 11 }}>
            {t("create.waiting.title")}
          </p>
          <h2 style={{ marginTop: 0, textAlign: "center", fontSize: 40, lineHeight: 1.1 }}>{zecAmount != null ? formatZec(zecAmount) : zecAmount} {currency}</h2>
          {currency === "ZEC" && formatUsd(zecAmount ?? 0, usdRate) && (
            <p className="muted" style={{ textAlign: "center", marginTop: -8 }}>≈ {formatUsd(zecAmount ?? 0, usdRate)}</p>
          )}
          <p className="muted" style={{ textAlign: "center" }}>
            {t("create.waiting.sendExactly", { amount: zecAmount != null ? formatZec(zecAmount) : "", symbol, currency })}
          </p>
          {paymentBreakdown && paymentBreakdown.firstBuyZec > 0 && (
            <div style={{ fontSize: 12, border: "1px solid var(--border)", borderRadius: 4, padding: "8px 10px", margin: "8px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="muted">{t("create.breakdown.launchFee")}</span>
                <span>{formatZec(paymentBreakdown.createFeeZec)} {currency}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="muted">{t("create.breakdown.firstBuy")}</span>
                <span>{formatZec(paymentBreakdown.firstBuyZec)} {currency}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 4, fontWeight: 600 }}>
                <span>{t("create.breakdown.send")}</span>
                <span>{zecAmount != null ? formatZec(zecAmount) : ""} {currency}</span>
              </div>
            </div>
          )}
          {currency === "ZEC" && isRealMode && (
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
          <div className="mono-break" style={{ fontSize: 11, color: "var(--accent)", border: "1px solid var(--border)", padding: 8, borderRadius: 4 }}>
            {zecAddress}
          </div>
          <button className="btn btn-outline" style={{ width: "100%", marginTop: 8 }} onClick={copyAddress}>
            {copied ? "✓" : t("create.waiting.copyAddress")}
          </button>
          {isRealMode && (
            <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>{t("payment.copyHint")}</p>
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
      <h1 style={{ fontSize: 18 }}>{t("pyramid.title")}</h1>
      <p className="muted" style={{ marginBottom: 8 }}>
        {t("create.feeNote", { amount: createFeeZec ?? "…", currency })}
        {createFeeZec != null && currency === "ZEC" && formatUsd(createFeeZec, usdRate) && ` (≈ ${formatUsd(createFeeZec, usdRate)})`}
      </p>
      <p className="muted" style={{ marginBottom: 20 }}>
        {t("pyramid.graduationNote", { currency })}
      </p>
      <div className="card">
        <div className="field">
          <label>{t("create.currencyLabel")}</label>
          <div style={{ display: "flex", gap: 8 }}>
            {(["ZEC", "YEC"] as Currency[]).map((c) => (
              <button
                key={c}
                type="button"
                className={currency === c ? "btn btn-gold" : "btn btn-outline"}
                style={{ flex: 1 }}
                onClick={() => setCurrency(c)}
              >
                {c}
              </button>
            ))}
          </div>
          {currency === "YEC" && currencies && currencies.YEC.mode === "mock" && (
            <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              {t("create.currencyYecNote")}
            </p>
          )}
        </div>
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
          <label>{t("create.firstBuyLabel")}</label>
          <input
            type="number"
            min={0}
            max={maxFirstBuyZec}
            step="0.001"
            value={firstBuyZecInput}
            onChange={(e) => setFirstBuyZecInput(e.target.value)}
            placeholder="0.00"
          />
          <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            {t("create.firstBuyHelp", { amount: maxFirstBuyZec, currency })}
          </p>
        </div>
        {firstBuyZec > 0 && createFeeZec != null && (
          <div style={{ fontSize: 12, border: "1px solid var(--border)", borderRadius: 4, padding: "8px 10px", marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="muted">{t("create.breakdown.launchFee")}</span>
              <span>{formatZec(createFeeZec)} {currency}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="muted">{t("create.breakdown.firstBuy")}</span>
              <span>{formatZec(firstBuyZec)} {currency}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 4, fontWeight: 600 }}>
              <span>{t("create.breakdown.send")}</span>
              <span>{formatZec(createFeeZec + firstBuyZec)} {currency}</span>
            </div>
          </div>
        )}
        <div className="field">
          <label>{t("create.creatorPayoutLabel")}</label>
          <input
            value={creatorPayoutAddress}
            onChange={(e) => setCreatorPayoutAddress(e.target.value)}
            placeholder={currency === "YEC" ? t("create.creatorPayoutPlaceholderYec") : t("create.creatorPayoutPlaceholder")}
          />
          <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            {currency === "YEC" ? t("create.creatorPayoutHelpYec") : t("create.creatorPayoutHelp")}
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
