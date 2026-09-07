"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

// Chops off float noise (e.g. balance/2 landing on 175199.50000000001) so
// the Max/Half buttons drop a clean value into the input instead of
// something that looks broken.
function roundedAmountStr(n: number) {
  return Number(n.toFixed(6)).toString();
}

function fmtBalance(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

export default function SellModal({ symbol, walletId, onClose }: { symbol: string; walletId: string; onClose: () => void }) {
  const { t } = useLanguage();
  const [tokenAmount, setTokenAmount] = useState("");
  const [refundAddress, setRefundAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ zecAmount: number } | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    let stop = false;
    api
      .portfolio(walletId)
      .then((p) => {
        if (stop) return;
        const held = p.holdings.find((h) => h.symbol === symbol);
        setBalance(held?.amount ?? 0);
      })
      .catch(() => {
        if (!stop) setBalance(0);
      });
    return () => {
      stop = true;
    };
  }, [walletId, symbol]);

  async function submit() {
    setError(null);
    try {
      const amount = parseFloat(tokenAmount);
      if (!(amount > 0)) throw new Error(t("sell.error.invalidAmount"));
      if (balance !== null && amount > balance) throw new Error(t("sell.error.exceedsBalance", { symbol }));
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
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  {balance !== null ? t("sell.balance", { amount: fmtBalance(balance), symbol }) : "…"}
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ padding: "2px 10px", fontSize: 12 }}
                    disabled={!balance}
                    onClick={() => setTokenAmount(roundedAmountStr((balance ?? 0) / 2))}
                  >
                    {t("sell.half")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ padding: "2px 10px", fontSize: 12 }}
                    disabled={!balance}
                    onClick={() => setTokenAmount(roundedAmountStr(balance ?? 0))}
                  >
                    {t("sell.max")}
                  </button>
                </div>
              </div>
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
