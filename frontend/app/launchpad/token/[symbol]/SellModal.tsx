"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

export default function SellModal({ symbol, walletId, onClose }: { symbol: string; walletId: string; onClose: () => void }) {
  const { t } = useLanguage();
  const [tokenAmount, setTokenAmount] = useState("");
  const [refundAddress, setRefundAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ zecAmount: number } | null>(null);

  async function submit() {
    setError(null);
    try {
      const amount = parseFloat(tokenAmount);
      if (!(amount > 0)) throw new Error(t("sell.error.invalidAmount"));
      if (refundAddress.length < 10) throw new Error(t("sell.error.invalidAddress"));
      const order = await api.sell({ walletId, symbol, tokenAmount: amount, refundAddress });
      setResult({ zecAmount: order.zecAmount });
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        {!result ? (
          <>
            <h2 style={{ marginTop: 0 }}>{t("sell.title", { symbol })}</h2>
            <div className="field">
              <label>{t("sell.amountLabel", { symbol })}</label>
              <input value={tokenAmount} onChange={(e) => setTokenAmount(e.target.value)} />
            </div>
            <div className="field">
              <label>{t("sell.addressLabel")}</label>
              <input value={refundAddress} onChange={(e) => setRefundAddress(e.target.value)} placeholder="u1..." />
            </div>
            {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
            <button className="btn btn-red" style={{ width: "100%" }} onClick={submit}>
              {t("sell.button")}
            </button>
          </>
        ) : (
          <>
            <h2 style={{ marginTop: 0, color: "var(--green)" }}>{t("sell.payoutSent")}</h2>
            <p>{t("sell.payoutBody", { amount: result.zecAmount.toFixed(8) })}</p>
            <button className="btn btn-gold" style={{ width: "100%" }} onClick={onClose}>
              {t("buy.close")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
