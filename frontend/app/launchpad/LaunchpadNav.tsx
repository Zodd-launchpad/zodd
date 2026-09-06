"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/launchpad", label: "Market" },
  { href: "/launchpad/create", label: "Create" },
  { href: "/launchpad/portfolio", label: "Portfolio" },
];

export default function LaunchpadNav() {
  const pathname = usePathname();
  return (
    <div className="sub-nav">
      {TABS.map((t) => {
        const active = t.href === "/launchpad" ? pathname === "/launchpad" : pathname?.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={active ? "sub-nav-item active" : "sub-nav-item"}>
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
