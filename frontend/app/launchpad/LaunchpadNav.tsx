"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLanguage } from "@/lib/i18n";

const TABS = [
  { href: "/launchpad", key: "launchpad.nav.market" as const },
  { href: "/launchpad/create", key: "launchpad.nav.create" as const },
  // Brai, 2026-09-19: "LA PIRAMIDE... tener la reliquia hace que tengas el
  // privilegio de entrar a esa pestaña" -- the tab itself is always visible
  // (so people know it exists and go craft a reliquia for it); the gate is
  // enforced on the page itself (see app/launchpad/pyramid/page.tsx).
  { href: "/launchpad/pyramid", key: "launchpad.nav.pyramid" as const },
  { href: "/launchpad/portfolio", key: "launchpad.nav.portfolio" as const },
];

export default function LaunchpadNav() {
  const pathname = usePathname();
  const { t } = useLanguage();
  // Brai, 2026-09-19: "no quiero que puedan acceder a la piramide desde
  // portfolio" -- the pyramid tab stays visible on the other launchpad
  // pages (see the comment on TABS above for why it's otherwise always
  // shown), but drops out of the nav bar specifically while on Portfolio.
  const tabs = pathname?.startsWith("/launchpad/portfolio") ? TABS.filter((tab) => tab.href !== "/launchpad/pyramid") : TABS;
  return (
    <div className="sub-nav">
      {tabs.map((tab) => {
        const active = tab.href === "/launchpad" ? pathname === "/launchpad" : pathname?.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} className={active ? "sub-nav-item active" : "sub-nav-item"}>
            {t(tab.key)}
          </Link>
        );
      })}
    </div>
  );
}
