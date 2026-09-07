"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/lib/wallet";
import { useLanguage } from "@/lib/i18n";
import WalletOnboardModal from "./WalletOnboardModal";
import WalletDetailModal from "./WalletDetailModal";
import HelpModal from "./HelpModal";

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
  const [showHelp, setShowHelp] = useState(false);

  return (
    <div className="header">
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <a
          href="https://x.com/zodd_zcash"
          target="_blank"
          rel="noreferrer"
          aria-label="ZODD on X"
          style={{ display: "flex", alignItems: "center", color: "var(--text-dim)" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </a>
        <a
          href="https://t.me/zodd_zcash"
          target="_blank"
          rel="noreferrer"
          aria-label="ZODD on Telegram"
          style={{ display: "flex", alignItems: "center", color: "var(--text-dim)" }}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor">
            <path d="M21.94 4.6 18.6 20.36c-.25 1.1-.9 1.38-1.83.86l-5.06-3.73-2.44 2.35c-.27.27-.5.5-1.02.5l.37-5.16 9.4-8.5c.41-.36-.09-.56-.63-.2L6.02 13.4l-5.02-1.57c-1.09-.34-1.11-1.09.23-1.61L20.6 3.36c.91-.34 1.71.2 1.34 1.24z" />
          </svg>
        </a>
        <Link href="/" className="logo">
          <img src="/zodd-logo.png" alt="ZODD" width={30} height={30} style={{ borderRadius: 6, display: "block" }} />
          ZODD<span className="accent">.FUN</span>
        </Link>
      </div>
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

      <Link
        href="/launchpad/create"
        className="btn btn-gold"
        style={{ fontSize: 13, padding: "8px 16px", marginRight: 8, fontWeight: 700 }}
      >
        {t("market.createToken")}
      </Link>

      <button
        className="btn btn-outline"
        style={{ fontSize: 12, padding: "6px 12px", marginRight: 4 }}
        onClick={() => setShowHelp(true)}
      >
        {t("nav.help")}
      </button>

      {!loading && wallet && (
        <Link href="/launchpad/portfolio" className="btn btn-outline" style={{ fontSize: 12, padding: "6px 12px", marginRight: 4 }}>
          {t("launchpad.nav.portfolio")}
        </Link>
      )}

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
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}
