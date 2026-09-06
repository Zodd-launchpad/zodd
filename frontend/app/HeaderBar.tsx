"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/lib/wallet";
import WalletOnboardModal from "./WalletOnboardModal";
import WalletDetailModal from "./WalletDetailModal";

const NAV = [
  { href: "/launchpad", label: "Launchpad" },
  { href: "/bridge", label: "Bridge" },
  { href: "/nft", label: "NFT" },
];

export default function HeaderBar() {
  const { wallet, loading } = useWallet();
  const pathname = usePathname();
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
              {item.label}
            </Link>
          );
        })}
      </div>
      {!loading && wallet && (
        <div className="wallet-chip mono" onClick={() => setShowDetail(true)}>
          {wallet.walletTag}
        </div>
      )}
      {!loading && !wallet && (
        <div className="wallet-chip glow" onClick={() => setShowOnboard(true)}>
          Connect
        </div>
      )}
      {showOnboard && <WalletOnboardModal onClose={() => setShowOnboard(false)} />}
      {showDetail && <WalletDetailModal onClose={() => setShowDetail(false)} />}
    </div>
  );
}
