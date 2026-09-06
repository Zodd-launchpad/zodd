"use client";
import { useLanguage } from "@/lib/i18n";

export default function BridgePage() {
  const { t } = useLanguage();
  return (
    <div className="coming-soon">
      <div className="badge">{t("comingSoon.badge")}</div>
      <h1>{t("bridge.title")}</h1>
      <p>{t("bridge.body")}</p>
    </div>
  );
}
