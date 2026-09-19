"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api, formatUsd, formatZec, type Currency } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { useZecUsdPrice } from "@/lib/zecPrice";
import { getNoirWallet, isNoirWalletInstalled } from "@noir-wallet/sdk";

type Phase = "amount" | "waiting" | "filled" | "failed";

// Mirrors the backend's isShieldedAddress check (server.ts) so the error
// shows up immediately instead of after a round trip.
//
// Brai, 2026-09-07: "estoy copiando mi wallet shielded recien copiada y no
// me deja comprar... me dice que invalid wallet" -- some wallets' "copy
// address" includes a trailing newline or leading/trailing spaces, which
// broke the ^(u1|zs1) prefix check even though the address itself was
// fine. Trimmed here (and wherever this value is actually sent, see
// submitBuy below) so pasted whitespace doesn't fail validation.
//
// Brai, 2026-09-11: also accepts "ys1" now (Ycash's shielded prefix) --
// this stays currency-agnostic like the backend's own isShieldedAddress,
// since the actual per-currency prefix check happens server-side.
function isShieldedAddress(addr: string): boolean {
  return /^(u1|zs1|ys1)/.test(addr.trim());
}

export default function BuyModal({
  symbol,
  walletId,
  currency,
  onClose,
}: {
  symbol: string;
  walletId: string;
  // Brai, 2026-09-11: the token's own currency (ZEC or YEC) -- this modal no
  // longer assumes ZEC anywhere, it just labels/encodes whatever the token
  // trades in.
  currency: Currency;
  onClose: () => void;
}) {
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
  // Brai, 2026-09-18: "el metodo de pago de tokens lo dejamos igual, o
  // envias por noir o por QR" -- same order, same deposit address, same
  // polling below; this just lets the extension originate the payment
  // directly instead of the payer scanning/pasting it by hand. Needs the
  // bare memo (not baked into paymentUri) since sendTransaction() takes it
  // as its own field.
  const [memo, setMemo] = useState<string | null>(null);
  const [noirSending, setNoirSending] = useState(false);
  const [noirTxid, setNoirTxid] = useState<string | null>(null);
  const [noirError, setNoirError] = useState<string | null>(null);
  // Brai, 2026-09-19: "cuando tocas PAGAR, el QR tarda como 5 segundos en
  // aparecer... quiero que haya un cartel que diga WAIT cuando haces click"
  // -- submitBuy below awaits the order creation + QR generation before
  // flipping phase to "waiting", so without this the button just sits there
  // looking unresponsive for those ~5s. Same treatment in SellModal and the
  // NFT mint page.
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Brai, 2026-09-07: "esa wallet que te aparece ahi para pagar cualquier
  // compra tiene que ser un boton que si lo clickeas se auto copia" -- the
  // deposit address box itself is now the copy button, not just text next
  // to one.
  //
  // Brai, 2026-09-07 (later): this used to copy the full paymentUri
  // (zcash:<addr>?amount=..&memo=..) instead of the plain address -- looked
  // to Brai like clicking "copy address" copied "a completely different
  // address" ("copia otra direccion totalmente diferente"), and in practice
  // most wallets (Noir included) fail to parse that whole string when
  // pasted manually, only the bare address. Switched to copying just
  // `address` so what's copied matches what's shown in the box. The QR
  // still encodes the full URI (with amount+memo) for wallets that scan it
  // -- and the backend nudges each order's amount to be unique anyway (see
  // buildPaymentMemoBase64 in zcashReal.ts), so a pasted bare address still
  // can't collide with someone else's order even without the memo.
  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard not available -- the address is still selectable/visible
    }
  }

  useEffect(() => {
    api.getMode().then((m) => setIsRealMode(m.currencies[currency].mode === "real")).catch(() => {});
  }, [currency]);

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
    setIsSubmitting(true);
    try {
      const amount = parseFloat(zecAmount);
      if (!(amount > 0)) throw new Error(t("buy.error.invalidAmount"));
      const trimmedRefund = refundAddress.trim();
      if (trimmedRefund.length < 10 || !isShieldedAddress(trimmedRefund)) throw new Error(t("buy.error.invalidAddress"));
      const order = await api.buy({ walletId, symbol, zecAmount: amount, refundAddress: trimmedRefund });
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
      const scheme = order.currency === "YEC" ? "ycash" : "zcash";
      const uri = `${scheme}:${order.zecAddress}?amount=${order.zecAmount}${order.memo ? `&memo=${order.memo}` : ""}`;
      setPaymentUri(uri);
      setMemo(order.memo ?? null);
      setQr(await QRCode.toDataURL(uri, { margin: 1, width: 220 }));
      setPhase("waiting");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  // Brai, 2026-09-18: "o envias por noir o por QR" -- alternative to
  // scanning/pasting: ask the connected (or freshly connected) Noir
  // extension to send this exact order's amount+memo straight to the
  // deposit address. Same address, same memo as the QR above, so the
  // existing 1s poll below picks it up exactly the same way regardless of
  // how the ZEC actually got sent.
  async function payWithNoir() {
    setNoirError(null);
    if (!address || exactZecAmount == null) return;
    if (!isNoirWalletInstalled()) {
      setNoirError(t("payment.noir.notInstalled"));
      return;
    }
    const noirWallet = getNoirWallet();
    if (!noirWallet) {
      setNoirError(t("payment.noir.notInstalled"));
      return;
    }
    setNoirSending(true);
    try {
      const zcash = noirWallet.zcash;
      const existing = await zcash.getAccounts();
      if (!existing) await zcash.connect();
      const txid = await zcash.sendTransaction({
        to: address,
        amount: String(exactZecAmount),
        memo: memo ?? undefined,
        fundingSource: "shielded",
      });
      setNoirTxid(txid);
    } catch (e: any) {
      setNoirError(e?.code === 4001 ? t("payment.noir.rejected") : e?.message ?? t("payment.noir.failed"));
    } finally {
      setNoirSending(false);
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
              <label>{t("buy.youPay", { currency })}</label>
              <input value={zecAmount} onChange={(e) => setZecAmount(e.target.value)} />
              {currency === "ZEC" && formatUsd(parseFloat(zecAmount) || 0, usdRate) && (
                <span className="muted" style={{ fontSize: 11, marginTop: 4, display: "block" }}>
                  ≈ {formatUsd(parseFloat(zecAmount) || 0, usdRate)}
                </span>
              )}
            </div>
            <div className="field">
              <label>{t("buy.refundAddressLabel")}</label>
              <input value={refundAddress} onChange={(e) => setRefundAddress(e.target.value)} placeholder={currency === "YEC" ? "u1... / ys1..." : "u1... / zs1..."} />
              <span className="muted" style={{ fontSize: 11, marginTop: 4, display: "block" }}>{t(currency === "YEC" ? "buy.refundAddressHintYec" : "buy.refundAddressHint")}</span>
            </div>
            {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
            <button className="btn btn-gold" style={{ width: "100%" }} onClick={submitBuy} disabled={isSubmitting}>
              {isSubmitting ? t("common.wait") : t("buy.button")}
            </button>
          </>
        )}

        {phase === "waiting" && (
          <>
            <h2 style={{ marginTop: 0, textAlign: "center" }}>
              {exactZecAmount != null ? formatZec(exactZecAmount) : zecAmount} {currency}
              {currency === "ZEC" && formatUsd(exactZecAmount ?? (parseFloat(zecAmount) || 0), usdRate) && (
                <span className="muted" style={{ fontSize: 14, fontWeight: 400, marginLeft: 6 }}>
                  (≈ {formatUsd(exactZecAmount ?? (parseFloat(zecAmount) || 0), usdRate)})
                </span>
              )}
            </h2>
            <p className="muted" style={{ textAlign: "center" }}>
              {t("buy.sendAtLeast", { amount: exactZecAmount != null ? formatZec(exactZecAmount) : zecAmount, currency })}
            </p>
            {currency === "ZEC" && isRealMode && (
              <div style={{ margin: "12px 0" }}>
                {noirTxid ? (
                  <p style={{ color: "var(--green)", fontSize: 12, textAlign: "center" }}>{t("payment.noir.sent")}</p>
                ) : (
                  <button className="btn btn-outline" style={{ width: "100%" }} disabled={noirSending} onClick={payWithNoir}>
                    {noirSending ? t("payment.noir.sending") : t("payment.noir.payButton")}
                  </button>
                )}
                {noirError && <p style={{ color: "var(--red)", fontSize: 12, textAlign: "center", marginTop: 6 }}>{noirError}</p>}
                <p className="muted" style={{ fontSize: 11, textAlign: "center", margin: "8px 0" }}>{t("payment.noir.orScan")}</p>
              </div>
            )}
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
