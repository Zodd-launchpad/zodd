"use client";
import { useLanguage } from "@/lib/i18n";

function Section({ heading, body }: { heading: string; body: string }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <h3 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--accent)", marginBottom: 6 }}>
        {heading}
      </h3>
      <p className="muted" style={{ fontSize: 13, lineHeight: 1.5, margin: 0 }}>
        {body}
      </p>
    </div>
  );
}

export default function HelpModal({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "85vh", overflowY: "auto" }}
      >
        <h2 style={{ marginTop: 0 }}>{t("help.title")}</h2>
        <Section heading={t("help.wallet.heading")} body={t("help.wallet.body")} />
        <Section heading={t("help.buy.heading")} body={t("help.buy.body")} />
        <Section heading={t("help.sell.heading")} body={t("help.sell.body")} />
        <Section heading={t("help.curve.heading")} body={t("help.curve.body")} />
        <Section heading={t("help.fees.heading")} body={t("help.fees.body")} />
        <button className="btn btn-gold" style={{ width: "100%" }} onClick={onClose}>
          {t("buy.close")}
        </button>
      </div>
    </div>
  );
}
