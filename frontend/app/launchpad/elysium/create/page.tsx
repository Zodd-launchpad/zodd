"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { parseEther } from "ethers";
import { fileToSquareDataUrl } from "@/lib/imageResize";
import { buildLaunch, friendlyError, predictLaunchToken, sendElysium, type Stage } from "@/lib/elysium";
import { BridgeBox, ConnectBox, STAGE_TEXT, TxTracker, fmtHype, useEvmAccount, useHypeBalance } from "../shared";

type Launched = { hash: string; parentHash: string; token: string | null; symbol: string };

export default function ElysiumCreatePage() {
  const { account, connect, error: connectError } = useEvmAccount();
  const [refresh, setRefresh] = useState(0);
  const hype = useHypeBalance(account, refresh);

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [website, setWebsite] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [firstBuy, setFirstBuy] = useState("");
  const [tax, setTax] = useState(1);
  const [antiSnipe, setAntiSnipe] = useState(true);

  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [launched, setLaunched] = useState<Launched | null>(null);

  const firstBuyWei = useMemo(() => {
    try {
      return firstBuy.trim() ? parseEther(firstBuy.trim()) : 0n;
    } catch {
      return null;
    }
  }, [firstBuy]);

  async function onImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      // Chica a proposito: va guardada on-chain en la metadata del lanzamiento.
      setImage(await fileToSquareDataUrl(f, 96));
      setImageUrl("");
    } catch {
      setErr("Could not read the image.");
    }
  }

  async function launch() {
    if (!account) return;
    setErr(null);
    if (firstBuyWei == null) return setErr("First buy must be a number, e.g. 0.1");
    if (hype != null && firstBuyWei > hype) return setErr("Not enough HYPE on Elysium for that first buy.");
    setBusy(true);
    try {
      const { params, tx } = buildLaunch({
        name,
        symbol,
        description,
        image: imageUrl.trim() || image,
        website,
        twitter,
        telegram,
        firstBuyWei,
        taxPct: tax,
        antiSnipe,
      });
      const predicted = await predictLaunchToken(account, params).catch(() => null);
      const r = await sendElysium(account, tx, setStage);
      setLaunched({ ...r, token: predicted, symbol: params.symbol });
    } catch (e: any) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
      setStage(null);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 640 }}>
      <Link href="/launchpad/elysium" className="muted" style={{ fontSize: 13 }}>
        ← Elysium
      </Link>
      <h2 style={{ marginTop: 10 }}>Launch a token on Elysium</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Created with the BOXA v4 launcher: 1B supply, a HYPE pool from the first block and locked liquidity. The buy/sell tax goes
        to your wallet (creator).
      </p>

      {!account ? (
        <ConnectBox onConnect={connect} error={connectError} />
      ) : launched ? (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{launched.symbol} submitted!</h3>
          <p className="muted" style={{ fontSize: 13 }}>
            The launch is queued. Once Elysium confirms it, the token is tradable.
          </p>
          {launched.token && (
            <Link href={`/launchpad/elysium/token/${launched.token}`} className="btn btn-gold">
              Go to {launched.symbol}
            </Link>
          )}
          <TxTracker hash={launched.hash} parentHash={launched.parentHash} label={`Launch ${launched.symbol}`} onDone={() => setRefresh((r) => r + 1)} />
        </div>
      ) : (
        <div className="card">
          <div className="field">
            <label>Ticker</label>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="ZODD" maxLength={10} />
          </div>
          <div className="field">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Zodd on Elysium" maxLength={32} />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea className="ely-textarea" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </div>
          <div className="field">
            <label>Image</label>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {(imageUrl || image) && <img src={imageUrl || image} alt="" width={48} height={48} style={{ borderRadius: 8, objectFit: "cover" }} />}
              <label className="btn btn-outline" style={{ margin: 0, textTransform: "none", letterSpacing: 0, fontSize: 12, color: "var(--text)" }}>
                Upload image
                <input type="file" accept="image/*" onChange={onImage} style={{ display: "none" }} />
              </label>
              <input className="ely-input" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="or paste a link https://…" style={{ flex: 1 }} />
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>With a link, the image also shows on BOXA.</div>
          </div>
          <div className="field">
            <label>Website</label>
            <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
          </div>
          <div className="field">
            <label>X / Twitter</label>
            <input value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="https://x.com/…" />
          </div>
          <div className="field">
            <label>Telegram</label>
            <input value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="https://t.me/…" />
          </div>
          <div className="field">
            <label>First buy (HYPE, optional)</label>
            <input value={firstBuy} onChange={(e) => setFirstBuy(e.target.value)} placeholder="0" inputMode="decimal" />
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Elysium balance: {fmtHype(hype)} HYPE</div>
          </div>
          <div className="field">
            <label>Buy/sell tax (goes to the creator): {tax}%</label>
            <input type="range" min={1} max={10} step={1} value={tax} onChange={(e) => setTax(Number(e.target.value))} style={{ padding: 0 }} />
          </div>
          <label className="muted" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 14 }}>
            <input type="checkbox" checked={antiSnipe} onChange={(e) => setAntiSnipe(e.target.checked)} />
            Anti-sniper (protection for the first 60 seconds)
          </label>

          <button className="btn btn-gold" style={{ width: "100%" }} disabled={busy || !name.trim() || !symbol.trim()} onClick={launch}>
            {busy ? "Launching…" : "Launch token"}
          </button>
          {stage && <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>{STAGE_TEXT[stage]}</p>}
          {err && <p style={{ color: "var(--red)", fontSize: 12, marginBottom: 0 }}>{err}</p>}
          <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
            Launching is free (gas only). Asks for 2 signatures: the order on Elysium and the submission on HyperEVM.
          </p>
        </div>
      )}

      {account && !launched && (
        <div style={{ marginTop: 14 }}>
          <BridgeBox account={account} onDeposited={() => setRefresh((r) => r + 1)} />
        </div>
      )}
    </div>
  );
}
