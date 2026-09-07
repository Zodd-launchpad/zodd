"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useWallet } from "@/lib/wallet";
import { useLanguage } from "@/lib/i18n";

type Step = "intro" | "words" | "confirm" | "creating" | "import";

export default function WalletOnboardModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>("intro");
  const [words, setWords] = useState<string[]>([]);
  const [checkboxOk, setCheckboxOk] = useState(false);
  const [checkInputs, setCheckInputs] = useState(["", "", ""]);
  const [importText, setImportText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { createWallet, importWallet } = useWallet();
  const { t } = useLanguage();

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
    if (!pending) return setError(t("onboard.error.generic"));
    const ok =
      checkInputs[0].trim().toLowerCase() === pending.words[4] &&
      checkInputs[1].trim().toLowerCase() === pending.words[5] &&
      checkInputs[2].trim().toLowerCase() === pending.words[6];
    if (!ok) {
      setError(t("onboard.error.wrongWords"));
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

  async function submitImport() {
    setError(null);
    const parsed = importText.trim().split(/\s+/).filter(Boolean);
    if (parsed.length !== 12) {
      setError(t("onboard.error.wordCount"));
      return;
    }
    try {
      await importWallet(parsed);
      onClose();
    } catch (e: any) {
      setError(e.message === "no wallet found for those words" ? t("onboard.error.notFound") : e.message);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        {step === "intro" && (
          <>
            <div className="badge">{t("onboard.badge.intro")}</div>
            <h2 style={{ marginTop: 0 }}>{t("onboard.title.intro")}</h2>
            <p className="muted">{t("onboard.body.intro")}</p>
            <button className="btn btn-gold" style={{ width: "100%" }} onClick={startWords}>
              {t("onboard.createButton")}
            </button>
            <div style={{ textAlign: "center", margin: "14px 0 8px", fontSize: 12 }} className="muted">
              {t("onboard.orImport")}
            </div>
            <button
              className="btn btn-outline"
              style={{ width: "100%" }}
              onClick={() => {
                setError(null);
                setStep("import");
              }}
            >
              {t("onboard.importButton")}
            </button>
          </>
        )}

        {step === "import" && (
          <>
            <div className="badge">{t("onboard.badge.import")}</div>
            <h2 style={{ marginTop: 0 }}>{t("onboard.title.import")}</h2>
            <p className="muted" style={{ fontSize: 13 }}>{t("onboard.import.hint")}</p>
            <div className="field">
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={t("onboard.import.placeholder")}
                rows={3}
                style={{
                  width: "100%",
                  background: "#0d0d0f",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  color: "var(--text)",
                  padding: 10,
                  fontSize: 13,
                  resize: "vertical",
                }}
              />
            </div>
            {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
            <button className="btn btn-gold" style={{ width: "100%" }} onClick={submitImport}>
              {t("onboard.importSubmit")}
            </button>
            <button
              className="btn"
              style={{ width: "100%", marginTop: 8, background: "transparent" }}
              onClick={() => {
                setError(null);
                setStep("intro");
              }}
            >
              {t("onboard.back")}
            </button>
          </>
        )}

        {step === "words" && (
          <>
            <div className="badge">{t("onboard.badge.words")}</div>
            <h2 style={{ marginTop: 0 }}>{t("onboard.title.words")}</h2>
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
              {t("onboard.checkbox")}
            </label>
            <button className="btn btn-gold" style={{ width: "100%" }} disabled={!checkboxOk} onClick={() => setStep("confirm")}>
              {t("onboard.wroteThemDown")}
            </button>
            <button
              className="btn"
              style={{ width: "100%", marginTop: 8, background: "transparent" }}
              onClick={() => setStep("intro")}
            >
              {t("onboard.back")}
            </button>
          </>
        )}

        {step === "confirm" && (
          <>
            <div className="badge">{t("onboard.badge.confirm")}</div>
            <h2 style={{ marginTop: 0 }}>{t("onboard.title.confirm")}</h2>
            <p className="muted">{t("onboard.confirmHint")}</p>
            {[4, 5, 6].map((idx, i) => (
              <div className="field" key={idx}>
                <label>{t("onboard.wordLabel", { n: idx + 1 })}</label>
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
              {t("onboard.confirmButton")}
            </button>
            <button
              className="btn"
              style={{ width: "100%", marginTop: 8, background: "transparent" }}
              onClick={() => {
                setError(null);
                setStep("words");
              }}
            >
              {t("onboard.back")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
