"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

type Phase = "amount" | "waiting" | "filled" | "failed";

export default function BuyModal({ symbol, walletId, onClose }: { symbol: string; walletId: string; onClose: () => void }) {
  const { t } = useLanguage();
  const [zecAmount, setZecAmount] = useState("0.01");
  const [phase, setPhase] = useState<Phase>("amount");
  const [address, setAddress] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [tokensOut, setTokensOut] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submitBuy() {
    setError(null);
    try {
      const amount = parseFloat(zecAmount);
      if (!(amount > 0)) throw new Error(t("buy.error.invalidAmount"));
      const order = await api.buy({ walletId, symbol, zecAmount: amount });
      setAddress(order.zecAddress);
      setOrderId(order.orderId);
      const uri = `zcash:${order.zecAddress}?amount=${amount}`; // simplified ZIP-321 format
      setQr(await QRCode.toDataURL(uri, { margin: 1, width: 220 }));
      setPhase("waiting");
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    if (phase !== "waiting" || !orderId) return;
    const id = setInterval(async () => {
      const order = await api.getOrder(orderId);
      if (order.status === "FILLED") {
        setTokensOut(order.tokenAmount);
        setPhase("filled");
        clearInterval(id);
      } else if (order.status === "FAILED") {
        setPhase("failed");
        clearInterval(id);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [phase, orderId]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        {phase === "amount" && (
          <>
            <h2 style={{ marginTop: 0 }}>{t("buy.title", { symbol })}</h2>
            <div className="field">
              <label>{t("buy.youPay")}</label>
              <input value={zecAmount} onChange={(e) => setZecAmount(e.target.value)} />
            </div>
            {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
            <button className="btn btn-gold" style={{ width: "100%" }} onClick={submitBuy}>
              {t("buy.button")}
            </button>
          </>
        )}

        {phase === "waiting" && (
          <>
            <h2 style={{ marginTop: 0, textAlign: "center" }}>{zecAmount} ZEC</h2>
            <p className="muted" style={{ textAlign: "center" }}>{t("buy.sendAtLeast", { amount: zecAmount })}</p>
            {qr && (
              <div style={{ background: "#fff", padding: 12, borderRadius: 6, display: "flex", justifyContent: "center", margin: "12px 0" }}>
                <img src={qr} alt="qr" />
              </div>
            )}
            <div className="mono-break" style={{ fontSize: 11, color: "var(--accent)", border: "1px solid var(--border)", padding: 8, borderRadius: 4 }}>
              {address}
            </div>
            <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>{t("buy.simulatedNote")}</p>
          </>
        )}

        {phase === "filled" && (
          <>
            <h2 style={{ marginTop: 0, color: "var(--green)" }}>{t("buy.filled.title")}</h2>
            <p>{t("buy.filled.body", { amount: tokensOut?.toFixed(0) ?? "0", symbol })}</p>
            <button className="btn btn-gold" style={{ width: "100%" }} onClick={onClose}>
              {t("buy.close")}
            </button>
          </>
        )}

        {phase === "failed" && (
          <>
            <h2 style={{ marginTop: 0, color: "var(--red)" }}>{t("buy.failed.title")}</h2>
            <p className="muted">{t("buy.failed.body")}</p>
            <button className="btn btn-outline" style={{ width: "100%" }} onClick={onClose}>
              {t("buy.close")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
