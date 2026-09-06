"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLanguage } from "@/lib/i18n";

const TABS = [
  { href: "/launchpad", key: "launchpad.nav.market" as const },
  { href: "/launchpad/create", key: "launchpad.nav.create" as const },
  { href: "/launchpad/portfolio", key: "launchpad.nav.portfolio" as const },
];

export default function LaunchpadNav() {
  const pathname = usePathname();
  const { t } = useLanguage();
  return (
    <div className="sub-nav">
      {TABS.map((tab) => {
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
