"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/lib/wallet";
import { useLanguage } from "@/lib/i18n";
import WalletOnboardModal from "./WalletOnboardModal";
import WalletDetailModal from "./WalletDetailModal";

const NAV = [
  { href: "/launchpad", key: "nav.launchpad" as const },
  { href: "/bridge", key: "nav.bridge" as const },
  { href: "/nft", key: "nav.nft" as const },
];

export default function HeaderBar() {
  const { wallet, loading } = useWallet();
  const pathname = usePathname();
  const { lang, setLang, t } = useLanguage();
  const [showOnboard, setShowOnboard] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div className="header">
      <Link href="/" className="logo">
        <img src="/zodd-logo.png" alt="ZODD" width={30} height={30} style={{ borderRadius: 6, display: "block" }} />
        ZODD<span className="accent">.FUN</span>
      </Link>
      <div className="nav">
        {NAV.map((item) => {
          const active = pathname?.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={active ? "nav-item active" : "nav-item"}>
              {t(item.key)}
            </Link>
          );
        })}
      </div>

      <div
        className="mono"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          fontSize: 12,
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: 2,
          marginRight: 4,
        }}
      >
        <button
          onClick={() => setLang("en")}
          className="btn btn-outline"
          style={{
            padding: "4px 8px",
            fontSize: 11,
            border: "none",
            background: lang === "en" ? "var(--border)" : "transparent",
            color: lang === "en" ? "var(--text)" : "var(--text-dim)",
          }}
        >
          EN
        </button>
        <button
          onClick={() => setLang("zh")}
          className="btn btn-outline"
          style={{
            padding: "4px 8px",
            fontSize: 11,
            border: "none",
            background: lang === "zh" ? "var(--border)" : "transparent",
            color: lang === "zh" ? "var(--text)" : "var(--text-dim)",
          }}
        >
          中文
        </button>
      </div>

      {!loading && wallet && (
        <div className="wallet-chip mono" onClick={() => setShowDetail(true)}>
          {wallet.walletTag}
        </div>
      )}
      {!loading && !wallet && (
        <div className="wallet-chip glow" onClick={() => setShowOnboard(true)}>
          {t("nav.connect")}
        </div>
      )}
      {showOnboard && <WalletOnboardModal onClose={() => setShowOnboard(false)} />}
      {showDetail && <WalletDetailModal onClose={() => setShowDetail(false)} />}
    </div>
  );
}
