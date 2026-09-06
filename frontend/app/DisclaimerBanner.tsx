"use client";
import { useLanguage } from "@/lib/i18n";

export default function DisclaimerBanner() {
  const { t } = useLanguage();
  return (
    <div className="disclaimer-banner">
      <div className="title">{t("disclaimer.title")}</div>
      <p>{t("disclaimer.body")}</p>
    </div>
  );
}
