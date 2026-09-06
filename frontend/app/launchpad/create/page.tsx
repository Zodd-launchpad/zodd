"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useWallet } from "@/lib/wallet";
import { api } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { fileToSquareDataUrl } from "@/lib/imageResize";

type Phase = "form" | "waiting" | "created" | "failed";

export default function CreatePage() {
  const { wallet } = useWallet();
  const { t } = useLanguage();
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [creatorPayoutAddress, setCreatorPayoutAddress] = useState("");
  const [description, setDescription] = useState("");
  const [twitterUrl, setTwitterUrl] = useState("");
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
      });
      setCreationId(res.creationId);
      setZecAddress(res.zecAddress);
      setZecAmount(res.zecAmount);
      const uri = `zcash:${res.zecAddress}?amount=${res.zecAmount}`; // simplified ZIP-321 format
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
    setQr(null);
    setError(null);
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

  if (phase === "waiting") {
    return (
      <div className="container" style={{ maxWidth: 480 }}>
        <div className="card">
          <p className="muted" style={{ textAlign: "center", marginBottom: 4, textTransform: "uppercase", letterSpacing: 1, fontSize: 11 }}>
            {t("create.waiting.title")}
          </p>
          <h2 style={{ marginTop: 0, textAlign: "center", fontSize: 40, lineHeight: 1.1 }}>{zecAmount} ZEC</h2>
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
          <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>
            {isRealMode ? t("create.waiting.realNote") : t("create.waiting.simulatedNote")}
          </p>
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
