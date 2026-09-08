import { useLanguage } from "@/lib/i18n";

// Brai, 2026-09-08: "haz una distincion para el token ZODD con el tilde
// azul que diga OFFICIAL tambien" -- referencing another Zcash launchpad
// site's blue verified-checkmark treatment for its own official token.
// Hardcoded to the platform's own mascot token specifically (not a
// creator-settable flag -- letting anyone self-mark "official" would make
// the badge meaningless, and defeat the point of it being a trust signal
// against copycat/fan-made tokens with similar names).
export function isOfficialToken(symbol: string): boolean {
  return symbol.toUpperCase() === "ZODD";
}

export function OfficialCheckmark({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-label="Official"
      style={{ flexShrink: 0 }}
    >
      <circle cx="12" cy="12" r="12" fill="#3b9eff" />
      <path d="M7 12.5l3.2 3.2L17 9" stroke="#0a0a0b" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export function OfficialPill() {
  const { t } = useLanguage();
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.3,
        color: "#3b9eff",
        border: "1px solid rgba(59,158,255,0.4)",
        borderRadius: 5,
        padding: "2px 7px",
      }}
    >
      <OfficialCheckmark size={11} />
      {t("official.badge")}
    </span>
  );
}
