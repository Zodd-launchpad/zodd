"use client";
import { useEffect, useState } from "react";
import { api, type NftWhitelistEntry } from "@/lib/api";

// Brai, 2026-09-18: "yo solo necesito que me hagas la pagina que controle
// eso de twitter" -- his review queue. Deliberately NOT linked from any
// nav (same "hidden route" pattern as /nft itself while it's in
// progress) -- reachable only by typing the URL. Gated behind the same
// ADMIN_TOKEN every /api/admin/* route already uses (see server.ts):
// pasted once here, kept in localStorage purely as a browser convenience
// (never sent anywhere but the x-admin-token header on these calls).
// There is NO Twitter/X API call anywhere in this feature -- Brai looks at
// the handle himself (follow the profile link) and clicks Approve/Reject;
// this page is only the queue + the two buttons.
const TOKEN_STORAGE_KEY = "zodd-admin-token";
type StatusFilter = "PENDING" | "APPROVED" | "REJECTED";

export default function AdminNftWhitelistPage() {
  const [token, setToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("PENDING");
  const [entries, setEntries] = useState<NftWhitelistEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  // Brai, 2026-09-24: "Puedes llevar la contabilidad de la venta de nfts?
  // Para saber que monto se recaudo." -- see api.adminNftSalesSummary /
  // GET /api/admin/nft-sales-summary and store.getNftSalesAccounting.
  const [sales, setSales] = useState<{
    mintGrossZec: number;
    mintCount: number;
    secondaryGrossZec: number;
    secondarySalesCount: number;
    platformFeeZec: number;
  } | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TOKEN_STORAGE_KEY);
      if (saved) setToken(saved);
    } catch {
      /* ignore */
    }
  }, []);

  async function load(t: string, f: StatusFilter) {
    setError(null);
    try {
      const r = await api.adminListNftWhitelist(t, f);
      setEntries(r.entries);
    } catch (e: any) {
      setEntries(null);
      setError(e.message === "unauthorized" ? "Invalid admin token" : e.message);
    }
  }

  useEffect(() => {
    if (token) load(token, filter);
  }, [token, filter]);

  useEffect(() => {
    if (!token) return;
    api
      .adminNftSalesSummary(token)
      .then((r) => setSales(r))
      .catch(() => setSales(null));
  }, [token]);

  function saveToken() {
    const t = tokenInput.trim();
    if (!t) return;
    setToken(t);
    try {
      localStorage.setItem(TOKEN_STORAGE_KEY, t);
    } catch {
      /* ignore */
    }
  }

  async function review(id: string, status: "APPROVED" | "REJECTED") {
    setBusyId(id);
    setError(null);
    try {
      await api.adminReviewNftWhitelist(token, id, status, notes[id]?.trim() || undefined);
      await load(token, filter);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  if (!token) {
    return (
      <div className="container" style={{ maxWidth: 420 }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>NFT Whitelist Admin</h2>
          <div className="field">
            <label>ADMIN_TOKEN</label>
            <input type="password" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} />
          </div>
          <button className="btn btn-gold" style={{ width: "100%" }} onClick={saveToken}>
            Enter
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: 720 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>NFT Whitelist Admin</h2>
        <button
          className="btn"
          style={{ background: "transparent", fontSize: 12 }}
          onClick={() => {
            setToken("");
            try {
              localStorage.removeItem(TOKEN_STORAGE_KEY);
            } catch {
              /* ignore */
            }
          }}
        >
          Log out
        </button>
      </div>

      {sales && (
        <div className="card" style={{ padding: 14, marginBottom: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
          <div>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>Mint revenue</div>
            <div style={{ fontWeight: 700 }}>{sales.mintGrossZec.toFixed(4)} ZEC</div>
            <div className="muted" style={{ fontSize: 11 }}>{sales.mintCount} mints</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>Secondary volume</div>
            <div style={{ fontWeight: 700 }}>{sales.secondaryGrossZec.toFixed(4)} ZEC</div>
            <div className="muted" style={{ fontSize: 11 }}>{sales.secondarySalesCount} sales</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>Platform fees earned</div>
            <div style={{ fontWeight: 700, color: "var(--green)" }}>{sales.platformFeeZec.toFixed(4)} ZEC</div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {(["PENDING", "APPROVED", "REJECTED"] as StatusFilter[]).map((f) => (
          <button
            key={f}
            className={filter === f ? "btn btn-gold" : "btn btn-outline"}
            style={{ fontSize: 12, padding: "6px 14px" }}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}

      {entries && entries.length === 0 && <p className="muted">No entries.</p>}

      {entries && entries.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {entries.map((e) => (
            <div key={e.id} className="card" style={{ padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <a href={`https://x.com/${e.twitterHandle}`} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontWeight: 700 }}>
                    @{e.twitterHandle}
                  </a>
                  <p className="muted" style={{ fontSize: 11, margin: "2px 0 0", wordBreak: "break-all" }}>
                    {e.walletAddress} &middot; {new Date(e.createdAt).toLocaleString()}
                  </p>
                  {e.reviewNote && <p className="muted" style={{ fontSize: 11, margin: "4px 0 0" }}>note: {e.reviewNote}</p>}
                  {e.claimedAt && <p className="muted" style={{ fontSize: 11, margin: "4px 0 0", color: "var(--green)" }}>free mint claimed</p>}
                </div>
              </div>
              {filter === "PENDING" && (
                <div style={{ marginTop: 10 }}>
                  <input
                    placeholder="note (optional, only for you)"
                    value={notes[e.id] ?? ""}
                    onChange={(ev) => setNotes((n) => ({ ...n, [e.id]: ev.target.value }))}
                    style={{ width: "100%", marginBottom: 8, fontSize: 12 }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      className="btn btn-gold"
                      style={{ flex: 1, fontSize: 12 }}
                      disabled={busyId === e.id}
                      onClick={() => review(e.id, "APPROVED")}
                    >
                      Approve
                    </button>
                    <button
                      className="btn btn-outline"
                      style={{ flex: 1, fontSize: 12 }}
                      disabled={busyId === e.id}
                      onClick={() => review(e.id, "REJECTED")}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
