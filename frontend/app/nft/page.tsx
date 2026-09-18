"use client";
import Link from "next/link";
import { useLanguage } from "@/lib/i18n";

export default function NFTPage() {
  const { t } = useLanguage();
  return (
    <div className="coming-soon">
      <Link href="/nft/whitelist" className="nft-whitelist-banner">
        <span className="nft-whitelist-banner-label">{t("nft.whitelistBanner.label")}</span>
        <span className="nft-whitelist-banner-cta">{t("nft.whitelistBanner.cta")}</span>
      </Link>

      <div className="badge">{t("comingSoon.badge")}</div>
      <h1>{t("nft.title")}</h1>
      <p>{t("nft.body")}</p>
    </div>
  );
}
