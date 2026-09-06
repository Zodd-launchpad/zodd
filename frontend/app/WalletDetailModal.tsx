"use client";
import { useWallet } from "@/lib/wallet";
import { useLanguage } from "@/lib/i18n";
import Link from "next/link";

export default function WalletDetailModal({ onClose }: { onClose: () => void }) {
  const { wallet, logout } = useWallet();
  const { t } = useLanguage();
  if (!wallet) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <div className="badge">{t("detail.badge")}</div>
        <h2 style={{ marginTop: 0, color: "var(--accent)" }}>{wallet.walletTag}</h2>
        <label className="muted" style={{ fontSize: 11 }}>{t("detail.walletIdLabel")}</label>
        <div className="mono-break" style={{ fontSize: 12, marginBottom: 14, color: "var(--text-dim)" }}>
          {wallet.walletId}
        </div>
        <p className="muted">{t("detail.body")}</p>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <Link href="/launchpad/portfolio" className="btn btn-outline" style={{ flex: 1, textAlign: "center" }} onClick={onClose}>
            {t("detail.portfolioLink")}
          </Link>
          <button
            className="btn btn-outline"
            style={{ flex: 1 }}
            onClick={() => {
              logout();
              onClose();
            }}
          >
            {t("detail.logout")}
          </button>
        </div>
      </div>
    </div>
  );
}
