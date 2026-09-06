"use client";
import { useState } from "react";
import { useWallet } from "@/lib/wallet";
import { api } from "@/lib/api";

export default function CreatePage() {
  const { wallet } = useWallet();
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    setError(null);
    if (!wallet) return setError("Connect or create your wallet first (top right).");
    try {
      await api.createToken({ symbol, name, creatorWalletId: wallet.walletId });
      setDone(true);
      setTimeout(() => (location.href = `/launchpad/token/${symbol.toUpperCase()}`), 600);
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 480 }}>
      <h1 style={{ fontSize: 18 }}>Create a token</h1>
      <p className="muted" style={{ marginBottom: 20 }}>
        Creation fee: 0.01 ZEC (not charged yet in this demo — applies once real payments are wired up).
      </p>
      <div className="card">
        <div className="field">
          <label>Symbol</label>
          <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="ZODD" maxLength={12} />
        </div>
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Zodl's Mascot" maxLength={64} />
        </div>
        {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
        {done && <p style={{ color: "var(--green)", fontSize: 13 }}>Created, redirecting…</p>}
        <button className="btn btn-gold" style={{ width: "100%" }} onClick={submit} disabled={!symbol || !name}>
          Create
        </button>
      </div>
    </div>
  );
}
