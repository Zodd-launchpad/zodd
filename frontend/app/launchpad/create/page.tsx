"use client";
import { useState } from "react";
import { useWallet } from "@/lib/wallet";
import { api } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

export default function CreatePage() {
  const { wallet } = useWallet();
  const { t } = useLanguage();
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    setError(null);
    if (!wallet) return setError(t("create.connectFirst"));
    try {
      await api.createToken({ symbol, name, creatorWalletId: wallet.walletId });
      setDone(true);
      setTimeout(() => (location.href = `/launchpad/token/${symbol.toUpperCase()}`), 600);
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 480 }}>
      <h1 style={{ fontSize: 18 }}>{t("create.title")}</h1>
      <p className="muted" style={{ marginBottom: 20 }}>
        {t("create.feeNote")}
      </p>
      <div className="card">
        <div className="field">
          <label>{t("create.symbolLabel")}</label>
          <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="ZODD" maxLength={12} />
        </div>
        <div className="field">
          <label>{t("create.nameLabel")}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("create.namePlaceholder")} maxLength={64} />
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
