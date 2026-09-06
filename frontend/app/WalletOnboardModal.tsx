"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useWallet } from "@/lib/wallet";

type Step = "intro" | "words" | "confirm" | "creating";

export default function WalletOnboardModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>("intro");
  const [words, setWords] = useState<string[]>([]);
  const [checkboxOk, setCheckboxOk] = useState(false);
  const [checkInputs, setCheckInputs] = useState(["", "", ""]);
  const [error, setError] = useState<string | null>(null);
  const { createWallet } = useWallet();

  // For the demo we show the words before they're persisted anywhere: the
  // real API already generated them, we just need something for the visual
  // confirmation step. The wallet only "exists" (in localStorage) once the
  // user confirms, same flow as SHLD.fun.
  async function startWords() {
    setError(null);
    try {
      // Create the wallet now (so walletId/word list come from the real backend)
      // but don't persist it to localStorage until the checklist is confirmed.
      const data = await api.createWallet();
      setWords(data.words);
      (window as any).__pendingWallet = data;
      setStep("words");
    } catch (e: any) {
      setError(e.message);
    }
  }

  function confirmWords() {
    const pending = (window as any).__pendingWallet;
    if (!pending) return setError("something went wrong, close this and try again");
    const ok =
      checkInputs[0].trim().toLowerCase() === pending.words[4] &&
      checkInputs[1].trim().toLowerCase() === pending.words[5] &&
      checkInputs[2].trim().toLowerCase() === pending.words[6];
    if (!ok) {
      setError("those aren't words 5, 6 and 7. Check the copy you made.");
      return;
    }
    try {
      localStorage.setItem("zodd-wallet", JSON.stringify(pending));
    } catch {
      /* ignore */
    }
    onClose();
    location.reload(); // simple: refresh wallet context
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        {step === "intro" && (
          <>
            <div className="badge">BEFORE YOUR FIRST TRADE</div>
            <h2 style={{ marginTop: 0 }}>Two wallets, both yours</h2>
            <p className="muted">
              The token wallet is created by this platform and holds what you buy.
              Your real Zcash wallet (Zashi, Ywallet, Zingo, Zodl) is the one that pays
              for every trade — we never touch it.
            </p>
            <button className="btn btn-gold" style={{ width: "100%" }} onClick={startWords}>
              Create a new wallet
            </button>
          </>
        )}

        {step === "words" && (
          <>
            <div className="badge">WRITE THESE DOWN NOW</div>
            <h2 style={{ marginTop: 0 }}>Your twelve words</h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 8,
                background: "#0d0d0f",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: 14,
                marginBottom: 14,
              }}
            >
              {words.map((w, i) => (
                <div key={i} style={{ fontSize: 13 }}>
                  <span className="muted">{i + 1} </span>
                  <span style={{ color: "var(--accent)" }}>{w}</span>
                </div>
              ))}
            </div>
            <label style={{ display: "flex", gap: 8, fontSize: 13, marginBottom: 14 }}>
              <input type="checkbox" checked={checkboxOk} onChange={(e) => setCheckboxOk(e.target.checked)} />
              I have written all twelve down, in order.
            </label>
            <button className="btn btn-gold" style={{ width: "100%" }} disabled={!checkboxOk} onClick={() => setStep("confirm")}>
              I wrote them down
            </button>
          </>
        )}

        {step === "confirm" && (
          <>
            <div className="badge">ONE CHECK</div>
            <h2 style={{ marginTop: 0 }}>Type three of them back</h2>
            <p className="muted">From the copy you made, not from memory.</p>
            {[4, 5, 6].map((idx, i) => (
              <div className="field" key={idx}>
                <label>WORD {idx + 1}</label>
                <input
                  value={checkInputs[i]}
                  onChange={(e) => {
                    const next = [...checkInputs];
                    next[i] = e.target.value;
                    setCheckInputs(next);
                  }}
                />
              </div>
            ))}
            {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
            <button className="btn btn-gold" style={{ width: "100%" }} onClick={confirmWords}>
              Confirm
            </button>
          </>
        )}
      </div>
    </div>
  );
}
