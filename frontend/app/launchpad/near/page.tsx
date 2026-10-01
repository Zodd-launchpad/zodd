"use client";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useWallet } from "@/lib/wallet";
import { fileToSquareDataUrl } from "@/lib/imageResize";
import { payEvmNative, payEvmStablecoin, paySolanaUsdc } from "@/lib/nearPayments";
import {
  api,
  type NearLaunchView,
  type NearLaunchPaymentMethod,
  type NearLaunchPaymentQuote,
  type NearLaunchPaymentChainConfig,
  type NearLaunchStep,
} from "@/lib/api";

// Brai, 2026-09-30: "avanzamos" (backend orchestration for real on-chain
// NEAR token launches, minted via near-zodd-launch-rust + a Ref/Rhea DCL
// pool) then "tiene que ser multiwallet, soportar evm como pago, con eth
// y usdc de base y robinhood y tambien usdc de solana y zec de la wallet
// de zec" (multi-chain $8 fee). Deliberately NOT linked from
// LaunchpadNav.tsx yet -- same "build it quietly before wiring it into
// the nav" approach already used for /nft while it was new (see that
// page's own note) -- Brai can wire it in once he's seen it.

const SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

const PAYMENT_METHODS: { method: NearLaunchPaymentMethod; label: string; assetSymbol: string }[] = [
  { method: "ZEC", label: "Zcash (ZEC)", assetSymbol: "ZEC" },
  { method: "BASE_ETH", label: "ETH on Base", assetSymbol: "ETH" },
  { method: "BASE_USDC", label: "USDC on Base", assetSymbol: "USDC" },
  { method: "ROBINHOOD_ETH", label: "ETH on Robinhood Chain", assetSymbol: "ETH" },
  { method: "ROBINHOOD_USDG", label: "USDG on Robinhood Chain", assetSymbol: "USDG" },
  { method: "SOLANA_USDC", label: "USDC on Solana", assetSymbol: "USDC" },
];

const STEP_LABELS: Record<NearLaunchStep, string> = {
  NOT_STARTED: "Queued",
  TOKEN_ACCOUNT_CREATED: "Token account created",
  TOKEN_CONTRACT_DEPLOYED: "Token contract deployed",
  TOKEN_DEPLOY_KEY_REVOKED: "Contract locked (immutable)",
  POOL_CREATED: "Liquidity pool created",
  LIQUIDITY_SEEDED: "Liquidity seeded",
  POSITION_LOCKED: "LP position locked forever",
};
const STEP_ORDER: NearLaunchStep[] = [
  "NOT_STARTED",
  "TOKEN_ACCOUNT_CREATED",
  "TOKEN_CONTRACT_DEPLOYED",
  "TOKEN_DEPLOY_KEY_REVOKED",
  "POOL_CREATED",
  "LIQUIDITY_SEEDED",
  "POSITION_LOCKED",
];

type Phase = "form" | "pickMethod" | "pay" | "confirming" | "orchestrating" | "live" | "failed";

export default function NearLaunchPage() {
  const { wallet } = useWallet();

  // ---- create form ----
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [totalSupplyInput, setTotalSupplyInput] = useState("1000000000");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [launch, setLaunch] = useState<NearLaunchView | null>(null);
  const [phase, setPhase] = useState<Phase>("form");

  // ---- payment ----
  const [chainConfig, setChainConfig] = useState<NearLaunchPaymentChainConfig | null>(null);
  const [quote, setQuote] = useState<NearLaunchPaymentQuote | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [copied, setCopied] = useState(false);
  const submitRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api.getNearLaunchPaymentConfig().then(setChainConfig).catch(() => {});
  }, []);

  async function onIconChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIcon(await fileToSquareDataUrl(file));
    } catch {
      setFormError("Could not read that image.");
    }
  }

  async function createLaunch() {
    setFormError(null);
    if (!wallet) return setFormError("Connect a wallet first.");
    const totalSupply = Number(totalSupplyInput);
    if (!Number.isFinite(totalSupply) || totalSupply <= 0) return setFormError("Total supply must be a positive number.");
    setSubmitting(true);
    try {
      const created = await api.createNearLaunch({
        creatorWalletId: wallet.walletId,
        name,
        symbol,
        totalSupply,
        icon: icon ?? undefined,
        description: description.trim() || undefined,
      });
      setLaunch(created);
      setPhase("pickMethod");
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function pickMethod(method: NearLaunchPaymentMethod) {
    if (!launch) return;
    setPayError(null);
    setQuote(null);
    setQr(null);
    try {
      const q = await api.quoteNearLaunchPayment(launch.id, method);
      setQuote(q);
      if (method === "ZEC") {
        const uri = `zcash:${q.address}?amount=${q.amountBaseUnits}`;
        setQr(await QRCode.toDataURL(uri, { margin: 1, width: 220 }));
      }
      setPhase("pay");
    } catch (e: any) {
      setPayError(e.message);
    }
  }

  // ZEC is detected automatically by the backend's poll loop (same as
  // every other real-ZEC payment in this codebase) -- once the launch's
  // own status moves off PENDING we know it landed, so ZEC just polls
  // launch status instead of ever calling submitNearLaunchPaymentProof.
  useEffect(() => {
    if (phase !== "pay" || !launch || quote?.method !== "ZEC") return;
    const id = setInterval(async () => {
      try {
        const l = await api.getNearLaunch(launch.id);
        setLaunch(l);
        if (l.status !== "PENDING") {
          clearInterval(id);
          setPhase(l.status === "FAILED" || l.status === "EXPIRED" ? "failed" : "orchestrating");
        }
      } catch {
        // transient -- keep polling
      }
    }, 4000);
    return () => clearInterval(id);
  }, [phase, launch, quote]);

  async function payWithWallet() {
    if (!launch || !quote || !chainConfig) return;
    setPayError(null);
    setPaying(true);
    try {
      let txRef: string;
      if (quote.method === "BASE_ETH") txRef = await payEvmNative(chainConfig.evm.BASE, quote.address, quote.amountBaseUnits);
      else if (quote.method === "BASE_USDC") txRef = await payEvmStablecoin(chainConfig.evm.BASE, quote.address, quote.amountBaseUnits);
      else if (quote.method === "ROBINHOOD_ETH") txRef = await payEvmNative(chainConfig.evm.ROBINHOOD, quote.address, quote.amountBaseUnits);
      else if (quote.method === "ROBINHOOD_USDG") txRef = await payEvmStablecoin(chainConfig.evm.ROBINHOOD, quote.address, quote.amountBaseUnits);
      else if (quote.method === "SOLANA_USDC")
        txRef = await paySolanaUsdc(chainConfig.solana.usdcMint, quote.address, quote.amountBaseUnits, SOLANA_RPC_URL);
      else return;
      setPhase("confirming");
      submitProofWithRetry(txRef);
    } catch (e: any) {
      if (e?.message === "evm-not-installed") setPayError("No EVM wallet (Metamask/Rabby) found in this browser.");
      else if (e?.message === "solana-not-installed") setPayError("No Solana wallet (Phantom) found in this browser.");
      else if (e?.code === 4001) setPayError("Rejected in the wallet.");
      else setPayError(e?.message ?? String(e));
    } finally {
      setPaying(false);
    }
  }

  // The backend requires a few confirmations before it'll verify a
  // submitted tx (see evmPayments.ts's MIN_CONFIRMATIONS) -- a plain
  // "not confirmed enough yet" response isn't a real failure, just not
  // ready, so this retries for a few minutes instead of surfacing it as
  // an error the creator has to manually retry.
  function submitProofWithRetry(txRef: string, attempt = 0) {
    if (!launch) return;
    api
      .submitNearLaunchPaymentProof(launch.id, txRef)
      .then((l) => {
        setLaunch(l);
        setPhase(l.status === "FAILED" ? "failed" : "orchestrating");
      })
      .catch((e: any) => {
        const msg = e?.message ?? String(e);
        if (attempt < 40 && /confirmation/i.test(msg)) {
          submitRetryRef.current = setTimeout(() => submitProofWithRetry(txRef, attempt + 1), 5000);
        } else {
          setPayError(msg);
          setPhase("pay");
        }
      });
  }
  useEffect(() => () => {
    if (submitRetryRef.current) clearTimeout(submitRetryRef.current);
  }, []);

  useEffect(() => {
    if (phase !== "orchestrating" || !launch) return;
    const id = setInterval(async () => {
      try {
        const l = await api.getNearLaunch(launch.id);
        setLaunch(l);
        if (l.status === "LIVE") {
          clearInterval(id);
          setPhase("live");
        } else if (l.status === "FAILED") {
          clearInterval(id);
          setPhase("failed");
        }
      } catch {
        // transient -- keep polling
      }
    }, 4000);
    return () => clearInterval(id);
  }, [phase, launch]);

  async function copyAddress() {
    if (!quote) return;
    try {
      await navigator.clipboard.writeText(quote.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* address is still visible/selectable */
    }
  }

  if (phase === "live" && launch) {
    return (
      <div className="container" style={{ maxWidth: 480 }}>
        <div className="card" style={{ textAlign: "center" }}>
          <h2 style={{ marginTop: 0, color: "var(--green)", fontSize: 28, letterSpacing: 1 }}>Live on NEAR</h2>
          <p className="muted">
            {launch.symbol} is deployed at <span className="mono-break">{launch.tokenAccountId}</span> and trading on Ref/Rhea.
          </p>
          {launch.tokenAccountId && (
            <a
              href={`https://nearblocks.io/address/${launch.tokenAccountId}`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-gold"
              style={{ width: "100%", display: "block", marginTop: 12 }}
            >
              View on NearBlocks
            </a>
          )}
        </div>
      </div>
    );
  }

  if (phase === "failed" && launch) {
    return (
      <div className="container" style={{ maxWidth: 480 }}>
        <div className="card">
          <h2 style={{ marginTop: 0, color: "var(--red)" }}>Launch failed</h2>
          <p className="muted">{launch.lastError ?? "Something went wrong during deployment."}</p>
        </div>
      </div>
    );
  }

  if (phase === "orchestrating" && launch) {
    const currentIdx = STEP_ORDER.indexOf(launch.currentStep);
    return (
      <div className="container" style={{ maxWidth: 480 }}>
        <div className="card">
          <h2 style={{ marginTop: 0, fontSize: 20 }}>Deploying {launch.symbol}…</h2>
          <p className="muted" style={{ marginBottom: 16 }}>Payment confirmed. This runs automatically -- no further action needed.</p>
          {STEP_ORDER.slice(1).map((step, i) => {
            const stepIdx = i + 1;
            const done = currentIdx >= stepIdx || launch.status === "LIVE";
            const active = currentIdx === stepIdx - 1 && launch.status === "DEPLOYING";
            return (
              <div key={step} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", opacity: done ? 1 : 0.5 }}>
                <span style={{ width: 16 }}>{done ? "✓" : active ? "…" : "○"}</span>
                <span style={{ fontSize: 13 }}>{STEP_LABELS[step]}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if ((phase === "pay" || phase === "confirming") && launch && quote) {
    const methodInfo = PAYMENT_METHODS.find((m) => m.method === quote.method)!;
    return (
      <div className="container" style={{ maxWidth: 480 }}>
        <div className="card">
          <p className="muted" style={{ textAlign: "center", marginBottom: 4, textTransform: "uppercase", letterSpacing: 1, fontSize: 11 }}>
            Pay to launch {launch.symbol}
          </p>
          <h2 style={{ marginTop: 0, textAlign: "center", fontSize: 32 }}>
            {quote.amountDisplay} {methodInfo.assetSymbol}
          </h2>
          <p className="muted" style={{ textAlign: "center" }}>≈ ${quote.usdLocked.toFixed(2)}</p>

          {quote.method === "ZEC" ? (
            <>
              {qr && (
                <div style={{ background: "#fff", padding: 12, borderRadius: 6, display: "flex", justifyContent: "center", margin: "12px 0" }}>
                  <img src={qr} alt="qr" />
                </div>
              )}
              <div className="mono-break" style={{ fontSize: 11, color: "var(--accent)", border: "1px solid var(--border)", padding: 8, borderRadius: 4 }}>
                {quote.address}
              </div>
              <button className="btn btn-outline" style={{ width: "100%", marginTop: 8 }} onClick={copyAddress}>
                {copied ? "✓" : "Copy address"}
              </button>
              <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>Waiting for the payment to confirm on-chain…</p>
            </>
          ) : (
            <>
              <div className="mono-break" style={{ fontSize: 11, color: "var(--accent)", border: "1px solid var(--border)", padding: 8, borderRadius: 4, margin: "12px 0" }}>
                {quote.address}
              </div>
              <button className="btn btn-gold" style={{ width: "100%" }} disabled={paying || phase === "confirming"} onClick={payWithWallet}>
                {phase === "confirming" ? "Confirming on-chain…" : paying ? "Sending…" : `Pay with wallet`}
              </button>
              {payError && <p style={{ color: "var(--red)", fontSize: 13, marginTop: 8 }}>{payError}</p>}
            </>
          )}
        </div>
      </div>
    );
  }

  if (phase === "pickMethod" && launch) {
    return (
      <div className="container" style={{ maxWidth: 480 }}>
        <h1 style={{ fontSize: 18 }}>Pay to launch {launch.symbol}</h1>
        <p className="muted" style={{ marginBottom: 16 }}>Pick how you want to pay the $8 launch fee.</p>
        <div className="card">
          {PAYMENT_METHODS.map((m) => (
            <button key={m.method} className="btn btn-outline" style={{ width: "100%", marginBottom: 8, textAlign: "left" }} onClick={() => pickMethod(m.method)}>
              {m.label}
            </button>
          ))}
          {payError && <p style={{ color: "var(--red)", fontSize: 13 }}>{payError}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: 480 }}>
      <h1 style={{ fontSize: 18 }}>Launch a token on NEAR</h1>
      <p className="muted" style={{ marginBottom: 20 }}>
        $8 total, paid in ZEC, ETH/USDC on Base, ETH/USDG on Robinhood Chain, or USDC on Solana. Deployed as a real NEP-141 token with a
        locked-forever liquidity pool on Ref/Rhea.
      </p>
      <div className="card">
        <div className="field">
          <label>Icon</label>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {icon && <img src={icon} alt="" width={48} height={48} style={{ borderRadius: 8, objectFit: "cover" }} />}
            <label className="btn btn-outline" style={{ cursor: "pointer", fontSize: 12 }}>
              Choose image
              <input type="file" accept="image/*" onChange={onIconChange} style={{ display: "none" }} />
            </label>
          </div>
        </div>
        <div className="field">
          <label>Symbol</label>
          <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="ZODD" maxLength={12} />
        </div>
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Token name" maxLength={64} />
        </div>
        <div className="field">
          <label>Total supply</label>
          <input type="number" min={1} value={totalSupplyInput} onChange={(e) => setTotalSupplyInput(e.target.value)} />
        </div>
        <div className="field">
          <label>Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            rows={3}
            style={{ width: "100%", background: "var(--bg, #0d0d0f)", border: "1px solid var(--border)", borderRadius: 6, color: "inherit", padding: "8px 10px", fontFamily: "inherit", fontSize: 13, resize: "vertical" }}
          />
        </div>
        {formError && <p style={{ color: "var(--red)", fontSize: 13 }}>{formError}</p>}
        <button className="btn btn-gold" style={{ width: "100%" }} onClick={createLaunch} disabled={!symbol || !name || submitting}>
          {submitting ? "…" : "Continue to payment"}
        </button>
      </div>
    </div>
  );
}
