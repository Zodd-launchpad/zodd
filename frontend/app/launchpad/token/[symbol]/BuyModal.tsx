"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api, formatUsd } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { useZecUsdPrice } from "@/lib/zecPrice";

type Phase = "amount" | "waiting" | "filled" | "failed";

// Mirrors the backend's isShieldedAddress check (server.ts) so the error
// shows up immediately instead of after a round trip.
function isShieldedAddress(addr: string): boolean {
  return /^(u1|zs1)/.test(addr);
}

export default function BuyModal({ symbol, walletId, onClose }: { symbol: string; walletId: string; onClose: () => void }) {
  const { t } = useLanguage();
  const usdRate = useZecUsdPrice();
  const [zecAmount, setZecAmount] = useState("0.01");
  const [refundAddress, setRefundAddress] = useState("");
  // The exact amount the backend is actually watching for -- can be a hair
  // above what was typed (see pickUniqueAmount in zcashReal.ts, which
  // nudges the amount by a few thousand zatoshis when needed so two orders
  // never watch for the identical amount at once). Sending the typed
  // amount instead of this would never be detected, so once the order
  // exists this -- not the input -- is what's shown/encoded in the QR.
  const [exactZecAmount, setExactZecAmount] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("amount");
  const [address, setAddress] = useState<string | null>(null);
  // Brai, 2026-09-07: "haz ese parche" -- the full ZIP-321 payment link
  // (address + amount + memo), not just the bare address. Copying/pasting
  // this into a wallet that understands it carries the same collision-proof
  // memo protection as scanning the QR; copying the bare address alone
  // never did (the memo lives only in this URI, see submitBuy below).
  const [paymentUri, setPaymentUri] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [tokensOut, setTokensOut] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRealMode, setIsRealMode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedTwoLine, setCopiedTwoLine] = useState(false);

  // Brai, 2026-09-07: "esa wallet que te aparece ahi para pagar cualquier
  // compra tiene que ser un boton que si lo clickeas se auto copia" -- the
  // deposit address box itself is now the copy button, not just text next
  // to one. Copies paymentUri (see above), displays the plain address.
  async function copyAddress() {
    if (!paymentUri) return;
    try {
      await navigator.clipboard.writeText(paymentUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard not available -- the address is still selectable/visible
    }
  }

  // Brai, 2026-09-07: "cuando vas a copiar el ID del memo se te cerro la
  // noir y no podes pegar el memo" -- a SEPARATE memo-only copy button
  // meant switching to Noir twice (once to paste the address, once more to
  // paste the memo), and the second app-switch was closing/resetting
  // Noir's send screen before the memo could be pasted. Fix: one clipboard
  // copy with the address AND memo together (address, newline, memo) --
  // Noir splits a pasted "address\nmemo" itself, so this is ONE copy, ONE
  // switch to Noir, ONE paste, both fields filled. orderId is already the
  // plain, un-base64'd memo text.
  async function copyAddressAndMemo() {
    if (!address || !orderId) return;
    try {
      await navigator.clipboard.writeText(`${address}\n${orderId}`);
      setCopiedTwoLine(true);
      setTimeout(() => setCopiedTwoLine(false), 1500);
    } catch {
      // clipboard not available -- address/memo are still visible above
    }
  }

  useEffect(() => {
    api.getMode().then((m) => setIsRealMode(m.zcashMode === "real")).catch(() => {});
  }, []);

  useEffect(() => {
    // Brai, 2026-09-07: "que la gente cuando vaya a comprar te deje la
    // wallet" -- pre-fill with the address this wallet already has on file
    // (from a previous buy, sell, or token creation), same mechanism as
    // SellModal/create's defaultRefundAddress. Still fully editable.
    api
      .portfolio(walletId)
      .then((p) => {
        if (p.defaultRefundAddress) setRefundAddress((prev) => prev || p.defaultRefundAddress!);
      })
      .catch(() => {});
  }, [walletId]);

  async function submitBuy() {
    setError(null);
    try {
      const amount = parseFloat(zecAmount);
      if (!(amount > 0)) throw new Error(t("buy.error.invalidAmount"));
      if (refundAddress.length < 10 || !isShieldedAddress(refundAddress)) throw new Error(t("buy.error.invalidAddress"));
      const order = await api.buy({ walletId, symbol, zecAmount: amount, refundAddress });
      setAddress(order.zecAddress);
      setOrderId(order.orderId);
      setExactZecAmount(order.zecAmount);
      // Brai, 2026-09-07: "esto tiene que ir por frase semilla" -- the memo
      // param (ZIP-321) is what lets the backend match this exact order by
      // id instead of guessing by amount, so it can't collide with anyone
      // else's purchase no matter how many are open at once. A wallet that
      // scans this QR fills the memo in on its own; see the big comment on
      // buildPaymentMemoBase64 in zcashReal.ts for the full reasoning and
      // its one caveat (a manually-pasted address skips the memo).
      const uri = `zcash:${order.zecAddress}?amount=${order.zecAmount}${order.memo ? `&memo=${order.memo}` : ""}`;
      setPaymentUri(uri);
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
              {formatUsd(parseFloat(zecAmount) || 0, usdRate) && (
                <span className="muted" style={{ fontSize: 11, marginTop: 4, display: "block" }}>
                  ≈ {formatUsd(parseFloat(zecAmount) || 0, usdRate)}
                </span>
              )}
            </div>
            <div className="field">
              <label>{t("buy.refundAddressLabel")}</label>
              <input value={refundAddress} onChange={(e) => setRefundAddress(e.target.value)} placeholder="u1... / zs1..." />
              <span className="muted" style={{ fontSize: 11, marginTop: 4, display: "block" }}>{t("buy.refundAddressHint")}</span>
            </div>
            {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
            <button className="btn btn-gold" style={{ width: "100%" }} onClick={submitBuy}>
              {t("buy.button")}
            </button>
          </>
        )}

        {phase === "waiting" && (
          <>
            <h2 style={{ marginTop: 0, textAlign: "center" }}>
              {exactZecAmount ?? zecAmount} ZEC
              {formatUsd(exactZecAmount ?? (parseFloat(zecAmount) || 0), usdRate) && (
                <span className="muted" style={{ fontSize: 14, fontWeight: 400, marginLeft: 6 }}>
                  (≈ {formatUsd(exactZecAmount ?? (parseFloat(zecAmount) || 0), usdRate)})
                </span>
              )}
            </h2>
            <p className="muted" style={{ textAlign: "center" }}>{t("buy.sendAtLeast", { amount: exactZecAmount ?? zecAmount })}</p>
            {qr && (
              <div style={{ background: "#fff", padding: 12, borderRadius: 6, display: "flex", justifyContent: "center", margin: "12px 0" }}>
                <img src={qr} alt="qr" />
              </div>
            )}
            <button
              type="button"
              onClick={copyAddress}
              className="mono-break"
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                fontSize: 11,
                color: copied ? "var(--green)" : "var(--accent)",
                background: "transparent",
                border: `1px solid ${copied ? "var(--green)" : "var(--border)"}`,
                padding: 8,
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              {copied ? `✓ ${t("buy.addressCopied")}` : address}
            </button>
            {isRealMode && (
              <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>{t("payment.copyHint")}</p>
            )}
            {/* Brai, 2026-09-07: "un cartel grande que diga SI TENES NOIR
                USA MEMO..." then found switching to Noir twice (once per
                copy button) closes Noir before the second paste. Fixed:
                still big and unmissable, but now ONE button that copies
                address+memo together -- one switch to Noir, one paste. */}
            {isRealMode && orderId && address && (
              <div
                style={{
                  marginTop: 12,
                  padding: "12px 14px",
                  borderRadius: 8,
                  border: "2px solid var(--bronze, #c9a24b)",
                  background: "rgba(201,162,75,0.1)",
                  textAlign: "center",
                }}
              >
                <p style={{ margin: "0 0 6px", fontWeight: 800, fontSize: 14, letterSpacing: 0.3, color: "var(--bronze, #c9a24b)" }}>
                  {t("payment.noirBanner.title")}
                </p>
                <p className="muted" style={{ margin: "0 0 8px", fontSize: 12 }}>{t("payment.noirBanner.body")}</p>
                <button
                  type="button"
                  onClick={copyAddressAndMemo}
                  className="mono"
                  style={{
                    display: "block",
                    width: "100%",
                    fontSize: 22,
                    fontWeight: 800,
                    padding: "12px 8px",
                    borderRadius: 6,
                    border: `1px solid ${copiedTwoLine ? "var(--green)" : "var(--border)"}`,
                    background: "transparent",
                    color: copiedTwoLine ? "var(--green)" : "var(--text)",
                    cursor: "pointer",
                    wordBreak: "break-all",
                  }}
                >
                  {copiedTwoLine ? `✓ ${t("buy.addressCopied")}` : orderId}
                </button>
              </div>
            )}
            <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>{isRealMode ? t("buy.realNote") : t("buy.simulatedNote")}</p>
            {isRealMode && (
              <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>{t("payment.recommendedWallets")}</p>
            )}
            {isRealMode && (
              <button
                className="btn btn-outline"
                style={{ width: "100%", marginTop: 10, fontSize: 12, lineHeight: 1.4 }}
                onClick={onClose}
              >
                {t("buy.alreadyPaidAck")}
              </button>
            )}
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
