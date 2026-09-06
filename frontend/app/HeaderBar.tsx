"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/lib/wallet";
import WalletOnboardModal from "./WalletOnboardModal";
import WalletDetailModal from "./WalletDetailModal";
import ZMark from "./ZMark";

const NAV = [
  { href: "/nft", label: "NFT" },
  { href: "/bridge", label: "Bridge" },
  { href: "/launchpad", label: "Launchpad" },
];

export default function HeaderBar() {
  const { wallet, loading } = useWallet();
  const pathname = usePathname();
  const [showOnboard, setShowOnboard] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div className="header">
      <Link href="/" className="logo">
        <ZMark />
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
