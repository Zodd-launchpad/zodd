"use client";
import { useLanguage } from "@/lib/i18n";
import LaunchpadNav from "./LaunchpadNav";

export default function LaunchpadLayout({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  return (
    <div>
      <div className="section-header">
        <div className="container" style={{ paddingBottom: 0 }}>
          <h1 className="section-title">{t("launchpad.title")}</h1>
          <p className="muted" style={{ marginBottom: 16 }}>
            {t("launchpad.subtitle")}
          </p>
          <LaunchpadNav />
        </div>
      </div>
      {children}
    </div>
  );
}
