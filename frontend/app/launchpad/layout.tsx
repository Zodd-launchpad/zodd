import LaunchpadNav from "./LaunchpadNav";

export default function LaunchpadLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div className="section-header">
        <div className="container" style={{ paddingBottom: 0 }}>
          <h1 className="section-title">Launchpad</h1>
          <p className="muted" style={{ marginBottom: 16 }}>
            Shielded meme markets on Zcash. Launch a token, trade it on a bonding curve,
            pay privately — built for fun, not for finance.
          </p>
          <LaunchpadNav />
        </div>
      </div>
      {children}
    </div>
  );
}
