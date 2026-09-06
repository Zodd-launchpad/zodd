"use client";
import { useState } from "react";
import { useWallet } from "@/lib/wallet";
import { api } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { fileToSquareDataUrl } from "@/lib/imageResize";

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
  const [done, setDone] = useState(false);

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
      await api.createToken({
        symbol,
        name,
        creatorWalletId: wallet.walletId,
        creatorPayoutAddress: creatorPayoutAddress.trim() || undefined,
        logoDataUrl: logoDataUrl ?? undefined,
        description: description.trim() || undefined,
        twitterUrl: twitterUrl.trim() || undefined,
      });
      setDone(true);
      setTimeout(() => (location.href = `/launchpad/token/${symbol.toUpperCase()}`), 600);
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 480 }}>
      <h1 style={{ fontSize: 18 }}>{t("create.title")}</h1>
      <p className="muted" style={{ marginBottom: 8 }}>
        {t("create.feeNote")}
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
        {done && <p style={{ color: "var(--green)", fontSize: 13 }}>{t("create.creating")}</p>}
        <button className="btn btn-gold" style={{ width: "100%" }} onClick={submit} disabled={!symbol || !name}>
          {t("create.button")}
        </button>
      </div>
    </div>
  );
}
