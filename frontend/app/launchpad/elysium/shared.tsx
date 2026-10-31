"use client";
import { useCallback, useEffect, useState } from "react";
import { formatEther, parseEther } from "ethers";
import { useWallet } from "@/lib/wallet";
import { connectWallet, depositToElysium, friendlyError, hypeBalance, queueStatus, type Stage, HYPEREVM } from "@/lib/elysium";

// Cuenta EVM para operar en Elysium. Si el usuario entro a zodd con
// MetaMask/Rabby ya tenemos la direccion; si no, se conecta aca.
export function useEvmAccount() {
  const { wallet } = useWallet();
  const [account, setAccount] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (wallet?.evmAddress) setAccount(wallet.evmAddress);
  }, [wallet?.evmAddress]);

  useEffect(() => {
    const e = (window as any).ethereum;
    if (!e?.on) return;
    const onAccounts = (accs: string[]) => setAccount(accs?.[0] ?? null);
    e.on("accountsChanged", onAccounts);
    e.request?.({ method: "eth_accounts" }).then((accs: string[]) => {
      if (accs?.[0]) setAccount((prev) => prev ?? accs[0]);
    }).catch(() => {});
    return () => e.removeListener?.("accountsChanged", onAccounts);
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    try {
      setAccount(await connectWallet());
    } catch (e: any) {
      setError(friendlyError(e));
    }
  }, []);

  return { account, connect, error };
}

export function useHypeBalance(account: string | null, refreshKey = 0) {
  const [bal, setBal] = useState<bigint | null>(null);
  useEffect(() => {
    if (!account) return setBal(null);
    let stop = false;
    const load = () => hypeBalance(account).then((b) => !stop && setBal(b)).catch(() => {});
    load();
    const id = setInterval(load, 15000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [account, refreshKey]);
  return bal;
}

export function fmtHype(wei: bigint | null | undefined, digits = 4) {
  if (wei == null) return "—";
  const n = Number(formatEther(wei));
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function fmtNum(n: number | null | undefined, digits = 2) {
  if (n == null) return "—";
  if (n === 0) return "0";
  if (Math.abs(n) < 0.0001) return n.toExponential(2);
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function fmtPrice(n: number | null | undefined) {
  if (n == null) return "—";
  if (n === 0) return "0";
  if (Math.abs(n) >= 0.0001) return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
  const exp = Math.floor(Math.log10(Math.abs(n)));
  const leadingZeros = -exp - 1;
  const digits = (n / Math.pow(10, exp)).toFixed(2).replace(".", "");
  return (
    <>
      0.0<sub>{leadingZeros}</sub>
      {digits}
    </>
  );
}

export const STAGE_TEXT: Record<Stage, string> = {
  "sign-l2": "Sign the order in your wallet (Elysium network)…",
  "fetch-queue": "Saving the order on the BOXA RPC…",
  "sign-parent": "Sign the submission on HyperEVM (pays gas in HYPE)…",
  queued: "Submitted. Waiting for Elysium to include it…",
  confirmed: "Confirmed on Elysium.",
};

export function ConnectBox({ onConnect, error }: { onConnect: () => void; error: string | null }) {
  return (
    <div className="card" style={{ textAlign: "center" }}>
      <p className="muted" style={{ marginTop: 0 }}>Connect MetaMask or Rabby to trade on Elysium.</p>
      <button className="btn btn-gold" onClick={onConnect}>
        Connect wallet
      </button>
      {error && <p style={{ color: "var(--red)", marginBottom: 0 }}>{error}</p>}
    </div>
  );
}

// Sigue una tx en cola hasta que Elysium la confirma.
export function TxTracker({ hash, parentHash, label, onDone }: { hash: string; parentHash?: string; label: string; onDone?: (ok: boolean) => void }) {
  const [state, setState] = useState<"queued" | "confirmed" | "failed">("queued");
  useEffect(() => {
    let stop = false;
    async function poll() {
      const s = await queueStatus(hash).catch(() => null);
      if (stop || !s) return;
      if (s.confirmed) {
        setState("confirmed");
        onDone?.(true);
        return true;
      }
      if (s.failed) {
        setState("failed");
        onDone?.(false);
        return true;
      }
      return false;
    }
    poll();
    const id = setInterval(async () => {
      if (await poll()) clearInterval(id);
    }, 8000);
    return () => {
      stop = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash]);
  const color = state === "confirmed" ? "var(--green)" : state === "failed" ? "var(--red)" : "var(--text-dim)";
  return (
    <div className="card" style={{ fontSize: 13, padding: 12, marginTop: 10 }}>
      <div style={{ color, fontWeight: 600 }}>
        {label}: {state === "confirmed" ? "confirmed ✓" : state === "failed" ? "failed" : "queued (Elysium executes in batches, this can take a while)"}
      </div>
      <div className="muted mono-break" style={{ fontSize: 11, marginTop: 4 }}>
        Elysium: {hash}
      </div>
      {parentHash && (
        <div className="muted mono-break" style={{ fontSize: 11 }}>
          HyperEVM:{" "}
          <a href={`${HYPEREVM.explorer}/tx/${parentHash}`} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
            {parentHash}
          </a>
        </div>
      )}
    </div>
  );
}

// Puente: pasar HYPE de HyperEVM a Elysium.
export function BridgeBox({ account, onDeposited }: { account: string; onDeposited?: () => void }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function deposit() {
    setMsg(null);
    let wei: bigint;
    try {
      wei = parseEther(amount.trim());
      if (wei <= 0n) throw new Error();
    } catch {
      return setMsg({ ok: false, text: "Enter a HYPE amount, e.g. 0.5" });
    }
    setBusy(true);
    try {
      const h = await depositToElysium(account, wei);
      setMsg({ ok: true, text: `Deposit sent (${h.slice(0, 10)}…). HYPE shows up on Elysium in a few minutes.` });
      setAmount("");
      onDeposited?.();
    } catch (e: any) {
      setMsg({ ok: false, text: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Bridge HYPE from HyperEVM to Elysium</div>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="ely-input" placeholder="0.5" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" style={{ flex: 1 }} />
        <button className="btn btn-outline" onClick={deposit} disabled={busy}>
          {busy ? "Sending…" : "Deposit"}
        </button>
      </div>
      <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
        You need HYPE on HyperEVM. Keep a little there: every Elysium action pays a small gas fee on HyperEVM.
      </p>
      {msg && <p style={{ color: msg.ok ? "var(--green)" : "var(--red)", fontSize: 12, marginBottom: 0 }}>{msg.text}</p>}
    </div>
  );
}
