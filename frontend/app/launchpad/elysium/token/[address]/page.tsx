"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AbiCoder, formatUnits, getAddress, isAddress, parseEther, parseUnits } from "ethers";
import {
  BOXA_V4,
  ZODD_FEE_BPS,
  ZODD_FEE_RECIPIENT,
  buildApprove,
  buildBuy,
  buildSell,
  fetchLaunchMetadata,
  friendlyError,
  getToken,
  poolId,
  quote,
  rpc,
  sendElysium,
  tokenAllowance,
  tokenBalance,
  type ElysiumToken,
  type Stage,
} from "@/lib/elysium";
import { ConnectBox, STAGE_TEXT, TxTracker, fmtHype, fmtNum, fmtPrice, useEvmAccount, useHypeBalance } from "../../shared";

type Side = "buy" | "sell";
type Sent = { hash: string; parentHash: string; label: string };

const SLIPPAGES = [5, 10, 20];

async function readNameSymbol(address: string) {
  const call = (data: string) => rpc<string>("eth_call", [{ to: address, data }, "latest"]);
  const dec = (hex: string) => {
    try {
      return AbiCoder.defaultAbiCoder().decode(["string"], hex)[0] as string;
    } catch {
      return "";
    }
  };
  const [n, s] = await Promise.all([call("0x06fdde03"), call("0x95d89b41")]);
  return { name: dec(n), symbol: dec(s) };
}

export default function ElysiumTokenPage({ params }: { params: { address: string } }) {
  const valid = isAddress(params.address);
  const address = valid ? getAddress(params.address) : "";
  const { account, connect, error: connectError } = useEvmAccount();
  const [refresh, setRefresh] = useState(0);
  const hype = useHypeBalance(account, refresh);

  const [token, setToken] = useState<ElysiumToken | null>(null);
  const [loading, setLoading] = useState(true);
  const [poolOk, setPoolOk] = useState<boolean | null>(null);
  const [tokBal, setTokBal] = useState<bigint | null>(null);

  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(10);
  const [out, setOut] = useState<bigint | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent[]>([]);

  // Datos del token (indexador de BOXA, con fallback on-chain si es nuevo).
  useEffect(() => {
    if (!valid) return;
    let stop = false;
    (async () => {
      let t = await getToken(address).catch(() => null);
      if (!t) {
        const ns = await readNameSymbol(address).catch(() => ({ name: "", symbol: "" }));
        t = {
          address,
          name: ns.name || "Token",
          symbol: ns.symbol || "?",
          priceHype: null,
          marketCapHype: null,
          volume24hHype: null,
          priceChange24h: null,
          holders: null,
          createdAt: null,
          image: null,
          description: null,
          website: null,
          twitter: null,
          telegram: null,
          creator: null,
          createdBlock: null,
          tradable: false,
          launchedFromZodd: false,
        };
      }
      if (!stop) {
        setToken(t);
        setLoading(false);
      }
      // Si el indexador no trae imagen/descripcion (p. ej. tokens lanzados
      // desde ZODD con imagen subida), la leemos del evento de lanzamiento.
      if (!t.image || !t.description) {
        const m = await fetchLaunchMetadata(address, t.createdBlock).catch(() => null);
        if (m && !stop) {
          setToken((prev) =>
            prev
              ? {
                  ...prev,
                  name: prev.name || m.name,
                  symbol: prev.symbol === "?" ? m.symbol : prev.symbol,
                  image: prev.image || m.image || null,
                  description: prev.description || m.description || null,
                  website: prev.website || m.website || null,
                  twitter: prev.twitter || m.twitter || null,
                  telegram: prev.telegram || m.telegram || null,
                  creator: prev.creator || m.creator,
                  launchedFromZodd: prev.launchedFromZodd || m.launchedFrom === "zodd.fun",
                }
              : prev,
          );
        }
      }
    })();
    // El pool BOXA v4 se confirma pidiendo una cotizacion minima.
    quote(address, "buy", parseEther("0.0001"))
      .then((o) => !stop && setPoolOk(o > 0n))
      .catch(() => !stop && setPoolOk(false));
    return () => {
      stop = true;
    };
  }, [address, valid]);

  useEffect(() => {
    if (!account || !valid) return setTokBal(null);
    tokenBalance(address, account).then(setTokBal).catch(() => {});
  }, [account, address, valid, refresh]);

  const amountWei = useMemo(() => {
    try {
      const v = amount.trim();
      if (!v) return null;
      const w = side === "buy" ? parseEther(v) : parseUnits(v, 18);
      return w > 0n ? w : null;
    } catch {
      return null;
    }
  }, [amount, side]);

  // Cotizacion en vivo.
  useEffect(() => {
    setOut(null);
    setQuoteErr(null);
    if (!amountWei || !poolOk) return;
    let stop = false;
    const id = setTimeout(() => {
      quote(address, side, amountWei)
        .then((o) => !stop && setOut(o))
        .catch(() => !stop && setQuoteErr("Not enough liquidity for that amount."));
    }, 300);
    return () => {
      stop = true;
      clearTimeout(id);
    };
  }, [amountWei, side, address, poolOk]);

  const minOut = out != null ? (out * BigInt(100 - slippage)) / 100n : null;

  async function submit() {
    if (!account || !amountWei || minOut == null) return;
    setErr(null);
    setBusy(true);
    try {
      if (side === "buy") {
        if (hype != null && amountWei > hype) throw new Error("Not enough HYPE on Elysium. Bridge some from HyperEVM on the Elysium page.");
        const r = await sendElysium(account, buildBuy(address, account, amountWei, minOut), setStage);
        setSent((s) => [{ ...r, label: `Buy ${token?.symbol}` }, ...s]);
      } else {
        if (tokBal != null && amountWei > tokBal) throw new Error(`Not enough ${token?.symbol}.`);
        const allowance = await tokenAllowance(address, account, BOXA_V4.router).catch(() => 0n);
        if (allowance < amountWei) {
          const a = await sendElysium(account, buildApprove(address), setStage);
          setSent((s) => [{ ...a, label: `Approve ${token?.symbol}` }, ...s]);
        }
        const r = await sendElysium(account, buildSell(address, account, amountWei, minOut), setStage);
        setSent((s) => [{ ...r, label: `Sell ${token?.symbol}` }, ...s]);
      }
      setAmount("");
    } catch (e: any) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
      setStage(null);
    }
  }

  if (!valid) {
    return (
      <div className="container">
        <p style={{ color: "var(--red)" }}>Invalid token address.</p>
        <Link href="/launchpad/elysium">← Back to Elysium</Link>
      </div>
    );
  }

  const feeOn = side === "buy" && !!ZODD_FEE_RECIPIENT && ZODD_FEE_BPS > 0n;

  return (
    <div className="container">
      <Link href="/launchpad/elysium" className="muted" style={{ fontSize: 13 }}>
        ← Elysium
      </Link>
      {loading && <p className="muted">Loading…</p>}
      {token && (
        <div className="ely-token-layout" style={{ marginTop: 12 }}>
          <div>
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              {token.image ? (
                <img src={token.image} alt="" width={64} height={64} style={{ borderRadius: 10, objectFit: "cover" }} />
              ) : (
                <div style={{ width: 64, height: 64, borderRadius: 10, background: "var(--border)" }} />
              )}
              <div>
                <h1 style={{ margin: 0, fontSize: 24, display: "flex", gap: 8, alignItems: "center" }}>
                  {token.symbol} <span className="ely-badge">Elysium · HYPE</span>
                  {token.launchedFromZodd && <span className="ely-badge">ZODD</span>}
                </h1>
                <div className="muted">{token.name}</div>
                <div className="muted mono-break" style={{ fontSize: 11 }}>
                  {address}
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginTop: 18 }}>
              {[
                ["Price", <>{fmtPrice(token.priceHype)} HYPE</>],
                ["Market cap", `${fmtNum(token.marketCapHype)} HYPE`],
                ["24h volume", `${fmtNum(token.volume24hHype)} HYPE`],
                ["24h", token.priceChange24h == null ? "—" : `${token.priceChange24h > 0 ? "+" : ""}${token.priceChange24h.toFixed(2)}%`],
                ["Holders", token.holders ?? "—"],
              ].map(([k, v], i) => (
                <div key={i} className="card" style={{ padding: 12 }}>
                  <div className="muted" style={{ fontSize: 11 }}>{k}</div>
                  <div className="mono" style={{ fontSize: 15, marginTop: 4 }}>{v}</div>
                </div>
              ))}
            </div>

            {token.description && <p style={{ marginTop: 18, whiteSpace: "pre-wrap" }}>{token.description}</p>}
            <div style={{ display: "flex", gap: 12, marginTop: 10, fontSize: 13 }}>
              {token.website && <a href={token.website} target="_blank" rel="noreferrer">Web</a>}
              {token.twitter && <a href={token.twitter.startsWith("http") ? token.twitter : `https://x.com/${token.twitter.replace(/^@/, "")}`} target="_blank" rel="noreferrer">X</a>}
              {token.telegram && <a href={token.telegram.startsWith("http") ? token.telegram : `https://t.me/${token.telegram.replace(/^@/, "")}`} target="_blank" rel="noreferrer">Telegram</a>}
              <a href={`https://boxa.club/asset?address=${address.toLowerCase()}`} target="_blank" rel="noreferrer" className="muted">
                View on BOXA
              </a>
            </div>
          </div>

          <div>
            {!account ? (
              <ConnectBox onConnect={connect} error={connectError} />
            ) : poolOk === false ? (
              <div className="card">
                <p style={{ marginTop: 0 }}>This token has no BOXA v4 HYPE pool, so it can't be traded on ZODD yet.</p>
                <p className="muted" style={{ marginBottom: 0, fontSize: 12 }}>
                  If you just launched it, wait for Elysium to confirm the launch and refresh. Expected pool id: <span className="mono-break">{poolId(address)}</span>
                </p>
              </div>
            ) : (
              <div className="card">
                <div className="ely-tabs">
                  <button className={side === "buy" ? "btn btn-green" : "btn btn-outline"} onClick={() => { setSide("buy"); setAmount(""); }}>
                    Buy
                  </button>
                  <button className={side === "sell" ? "btn btn-red" : "btn btn-outline"} onClick={() => { setSide("sell"); setAmount(""); }}>
                    Sell
                  </button>
                </div>

                <div className="muted" style={{ fontSize: 12, display: "flex", justifyContent: "space-between" }}>
                  <span>{side === "buy" ? "You pay (HYPE)" : `You sell (${token.symbol})`}</span>
                  <span>
                    Balance: {side === "buy" ? `${fmtHype(hype)} HYPE` : tokBal == null ? "—" : `${fmtNum(Number(formatUnits(tokBal, 18)))} ${token.symbol}`}
                  </span>
                </div>
                <input className="ely-input" style={{ marginTop: 6 }} placeholder="0.0" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  {(side === "buy" ? ["0.1", "0.5", "1"] : ["25", "50", "100"]).map((v) => (
                    <button
                      key={v}
                      className="btn btn-outline"
                      style={{ flex: 1, fontSize: 11, padding: "4px 0" }}
                      onClick={() => {
                        if (side === "buy") setAmount(v);
                        else if (tokBal != null) setAmount(formatUnits((tokBal * BigInt(v)) / 100n, 18));
                      }}
                    >
                      {side === "buy" ? `${v} HYPE` : `${v}%`}
                    </button>
                  ))}
                </div>

                <div style={{ marginTop: 12, fontSize: 13 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span className="muted">You receive (approx.)</span>
                    <span className="mono">
                      {out == null ? "—" : side === "buy" ? `${fmtNum(Number(formatUnits(out, 18)))} ${token.symbol}` : `${fmtHype(out, 6)} HYPE`}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                    <span className="muted">Max slippage</span>
                    <span style={{ display: "flex", gap: 4 }}>
                      {SLIPPAGES.map((s) => (
                        <button
                          key={s}
                          className="btn btn-outline"
                          onClick={() => setSlippage(s)}
                          style={{ fontSize: 11, padding: "2px 8px", background: slippage === s ? "var(--border)" : "transparent" }}
                        >
                          {s}%
                        </button>
                      ))}
                    </span>
                  </div>
                  {feeOn && <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Includes ZODD fee of {Number(ZODD_FEE_BPS) / 100}%.</div>}
                  {quoteErr && <div style={{ color: "var(--red)", fontSize: 12, marginTop: 6 }}>{quoteErr}</div>}
                </div>

                <button
                  className={side === "buy" ? "btn btn-green" : "btn btn-red"}
                  style={{ width: "100%", marginTop: 14 }}
                  disabled={busy || !amountWei || minOut == null}
                  onClick={submit}
                >
                  {busy ? "Processing…" : side === "buy" ? `Buy ${token.symbol}` : `Sell ${token.symbol}`}
                </button>
                {stage && <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>{STAGE_TEXT[stage]}</p>}
                {err && <p style={{ color: "var(--red)", fontSize: 12, marginBottom: 0 }}>{err}</p>}
                <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
                  Each trade asks for 2 signatures: the order on Elysium and the submission on HyperEVM (small HYPE gas).
                  {side === "sell" ? " The first sell of each token also needs an approval." : ""}
                </p>
              </div>
            )}
            {sent.map((s) => (
              <TxTracker key={s.hash} hash={s.hash} parentHash={s.parentHash} label={s.label} onDone={() => setRefresh((r) => r + 1)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
