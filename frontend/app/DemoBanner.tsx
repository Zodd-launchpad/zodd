"use client";
import { useLanguage } from "@/lib/i18n";

export default function DemoBanner() {
  const { t } = useLanguage();
  return (
    <div className="demo-banner">
      <span className="demo-banner-dot" />
      {t("demo.banner")}
    </div>
  );
}
