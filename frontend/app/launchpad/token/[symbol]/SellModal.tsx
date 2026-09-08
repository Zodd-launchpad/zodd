"use client";
import { useEffect, useState } from "react";
import { api, formatUsd, formatZec } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { useZecUsdPrice } from "@/lib/zecPrice";

// Chops off float noise (e.g. balance/2 landing on 175199.50000000001) so
// the Max/Half buttons drop a clean value into the input instead of
// something that looks broken.
function roundedAmountStr(n: number) {
  return Number(n.toFixed(6)).toString();
}

function fmtBalance(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

// Mirrors the backend's isShieldedAddress check (server.ts) so the error
// shows up immediately instead of after a round trip. Trimmed -- see the
// matching comment in BuyModal.tsx -- so a pasted trailing newline/spaces
// (some wallets' "copy address" includes them) doesn't fail validation.
function isShieldedAddress(addr: string): boolean {
  return /^(u1|zs1)/.test(addr.trim());
}

export default function SellModal({ symbol, walletId, onClose }: { symbol: string; walletId: string; onClose: () => void }) {
  const { t } = useLanguage();
  const usdRate = useZecUsdPrice();
  const [tokenAmount, setTokenAmount] = useState("");
  const [refundAddress, setRefundAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ zecAmount: number } | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [isRealMode, setIsRealMode] = useState(false);
  // Brai, 2026-09-08: "no olvides hacer que aparezca aqui los zec que te
  // tiene que dar" -- spot-price estimate (amount * current priceZec), same
  // approximation BuyModal already uses for its own ZEC/USD preview. Real
  // proceeds can differ slightly once the order actually executes against
  // the live bonding curve; that's why this is always shown with "≈".
  const [priceZec, setPriceZec] = useState<number | null>(null);

  useEffect(() => {
    api.getMode().then((m) => setIsRealMode(m.zcashMode === "real")).catch(() => {});
  }, []);

  useEffect(() => {
    let stop = false;
    api
      .getToken(symbol)
      .then((tok) => {
        if (!stop) setPriceZec(tok.priceZec);
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [symbol]);

  useEffect(() => {
    let stop = false;
    api
      .portfolio(walletId)
      .then((p) => {
        if (stop) return;
        const held = p.holdings.find((h) => h.symbol === symbol);
        setBalance(held?.amount ?? 0);
        // Pre-fill with the address this wallet used last time it sold
        // something -- one less thing to paste in for every token (Brai,
        // 2026-09-07). Still fully editable; this only sets the initial
        // value, so it never fights with what's typed.
        if (p.defaultRefundAddress) setRefundAddress((prev) => prev || p.defaultRefundAddress!);
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
      const trimmedRefund = refundAddress.trim();
      if (trimmedRefund.length < 10 || !isShieldedAddress(trimmedRefund)) throw new Error(t("sell.error.invalidAddress"));
      const order = await api.sell({ walletId, symbol, tokenAmount: amount, refundAddress: trimmedRefund });
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
              {priceZec != null &&
                (() => {
                  const amt = parseFloat(tokenAmount) || 0;
                  if (amt <= 0) return null;
                  const estZec = amt * priceZec;
                  const usd = formatUsd(estZec, usdRate);
                  return (
                    <span className="muted" style={{ fontSize: 11, marginTop: 4, display: "block" }}>
                      ≈ {formatZec(estZec)} ZEC{usd && ` (≈ ${usd})`}
                    </span>
                  );
                })()}
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
              <input value={refundAddress} onChange={(e) => setRefundAddress(e.target.value)} placeholder="u1... / zs1..." />
              <span className="muted" style={{ fontSize: 11, marginTop: 4, display: "block" }}>{t("sell.addressHint")}</span>
            </div>
            {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
            <button className="btn btn-red" style={{ width: "100%" }} onClick={submit}>
              {t("sell.button")}
            </button>
          </>
        ) : (
          <>
            <h2 style={{ marginTop: 0, color: "var(--green)" }}>{t("sell.payoutSent")}</h2>
            <p>{t(isRealMode ? "sell.payoutBody.real" : "sell.payoutBody.simulated", { amount: result.zecAmount.toFixed(8) })}</p>
            <button className="btn btn-gold" style={{ width: "100%" }} onClick={onClose}>
              {t("buy.close")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
