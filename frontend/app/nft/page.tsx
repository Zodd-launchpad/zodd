"use client";
import { useLanguage } from "@/lib/i18n";

export default function NFTPage() {
  const { t } = useLanguage();
  return (
    <div className="coming-soon">
      <div className="badge">{t("comingSoon.badge")}</div>
      <h1>{t("nft.title")}</h1>
      <p>{t("nft.body")}</p>
    </div>
  );
}
