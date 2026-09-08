"use client";
import Link from "next/link";
import { useLanguage } from "@/lib/i18n";
import HomeTokenBoards from "./HomeTokenBoards";

export default function HomePage() {
  const { t } = useLanguage();
  return (
    <>
      <div className="hero-banner">
        <img src="/zodd-hero.jpg" alt="ZODD, the unofficial Zodl mascot" />
        <div className="hero-banner-fade" />
        <div className="home-hero">
          <h1>ZODD</h1>
          <div className="tagline">{t("home.tagline")}</div>
        </div>
      </div>

      {/* Pulled up to overlap the tail of the hero image (see
          .home-boards-overlap / the opaque .board-frame background below) so
          the token boards -- the actual point of the page -- are visible in
          the first viewport instead of requiring a scroll past the hero.
          Brai, 2026-09-07: "la idea es entrar y tener los tokens, puede la
          esfinge pasar por detras de la caja de los tokens". */}
      <div className="home-boards-overlap">
        <HomeTokenBoards />
      </div>

      <div className="explore-grid">
        <Link href="/launchpad" className="explore-card">
          <div className="tag">{t("home.launchpad.tag")}</div>
          <h3>{t("home.launchpad.title")}</h3>
          <p>{t("home.launchpad.desc")}</p>
        </Link>
        <Link href="/bridge" className="explore-card">
          <div className="tag">{t("home.bridge.tag")}</div>
          <h3>{t("home.bridge.title")}</h3>
          <p>{t("home.bridge.desc")}</p>
        </Link>
        <Link href="/nft" className="explore-card">
          <div className="tag">{t("home.nft.tag")}</div>
          <h3>{t("home.nft.title")}</h3>
          <p>{t("home.nft.desc")}</p>
        </Link>
      </div>
    </>
  );
}
