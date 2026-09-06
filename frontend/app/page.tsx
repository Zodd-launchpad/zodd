import Link from "next/link";

export default function HomePage() {
  return (
    <>
      <div className="hero-banner">
        <img src="/zodd-hero.jpg" alt="ZODD, the unofficial Zodl mascot" />
        <div className="hero-banner-fade" />
      </div>

      <div className="home-hero">
        <h1>ZODD</h1>
        <div className="tagline">Unofficial Zodl mascot</div>
      </div>

      <div className="lore">
        <div className="badge">COMMUNITY MEME · NOT OFFICIAL</div>
        <p>
          ZODD is a fan-made mascot for the Zodl wallet — dreamed up and drawn by the community,
          not by the Zodl team. There's no wallet, company, or foundation behind it: it's just an
          image people in the community liked enough to keep drawing.
        </p>
        <p>
          This whole site grew out of that: a small, experimental corner of the internet to see
          what a ZODD-themed NFT marketplace, cross-chain bridge, and meme launchpad could look
          like. Nothing here is official, audited, or meant to be taken too seriously — it's a
          research project and a bit of fun, not a product.
        </p>
      </div>

      <div className="explore-grid">
        <Link href="/launchpad" className="explore-card">
          <div className="tag">Meme markets</div>
          <h3>Launchpad</h3>
          <p>Launch and trade shielded meme tokens on Zcash.</p>
        </Link>
        <Link href="/bridge" className="explore-card">
          <div className="tag">Cross-chain</div>
          <h3>Bridge</h3>
          <p>Move assets in and out privately.</p>
        </Link>
        <Link href="/nft" className="explore-card">
          <div className="tag">Marketplace</div>
          <h3>NFT</h3>
          <p>Buy, sell, and browse ZODD-themed NFTs.</p>
        </Link>
      </div>
    </>
  );
}
