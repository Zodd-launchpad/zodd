"use client";
import { useWallet } from "@/lib/wallet";
import Link from "next/link";

export default function WalletDetailModal({ onClose }: { onClose: () => void }) {
  const { wallet, logout } = useWallet();
  if (!wallet) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <div className="badge">ZODD WALLET</div>
        <h2 style={{ marginTop: 0, color: "var(--accent)" }}>{wallet.walletTag}</h2>
        <label className="muted" style={{ fontSize: 11 }}>WALLET ID</label>
        <div className="mono-break" style={{ fontSize: 12, marginBottom: 14, color: "var(--text-dim)" }}>
          {wallet.walletId}
        </div>
        <p className="muted">
          Your ID on this site: your purchases are grouped under it. It can't spend anything — it's not a Zcash address.
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <Link href="/launchpad/portfolio" className="btn btn-outline" style={{ flex: 1, textAlign: "center" }} onClick={onClose}>
            Portfolio
          </Link>
          <button
            className="btn btn-outline"
            style={{ flex: 1 }}
            onClick={() => {
              logout();
              onClose();
            }}
          >
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
