"use client";
import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { api, type NftWhitelistEntry } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

// Brai, 2026-09-18: "necesito que me hagas la parte de la whitelist de los
// nft ... la idea es que la gente ingrese su handle de twitter y que le
// haga retwitear un twit ... likear y seguir nuestro twitter, esto lo deje
// en revision, una revision manual". This page does NOT check Twitter/X
// itself -- it just collects the handle and shows instructions; Brai
// reviews by hand in /admin/nft-whitelist and the status here just
// reflects whatever he decided. "llamar a los KOL... les vamos a dar
// whitelist, o sea minteo gratis" -- an APPROVED status here means their
// next mint (once the collection exists) is free, handled entirely
// server-side by claimFreeNftWhitelistMint.
export default function NftWhitelistPage() {
  const { wallet, loading } = useWallet();
  const { t } = useLanguage();
  const [config, setConfig] = useState<{ tweetUrl: string | null; twitterHandle: string | null } | null>(null);
  const [entry, setEntry] = useState<NftWhitelistEntry | null | undefined>(undefined); // undefined = still loading
  const [handleInput, setHandleInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getNftWhitelistConfig().then(setConfig).catch(() => setConfig({ tweetUrl: null, twitterHandle: null }));
  }, []);

  useEffect(() => {
    if (!wallet) {
      setEntry(null);
      return;
    }
    api
      .getNftWhitelistStatus(wallet.walletId)
      .then((r) => {
        setEntry(r.entry);
        if (r.entry) setHandleInput(r.entry.twitterHandle);
      })
      .catch(() => setEntry(null));
  }, [wallet]);

  async function submit() {
    if (!wallet) return;
    setError(null);
    const handle = handleInput.trim();
    if (!handle) {
      setError(t("nftWhitelist.error.empty"));
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.submitNftWhitelist({ walletId: wallet.walletId, twitterHandle: handle });
      setEntry(result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || entry === undefined) return null;
  if (!wallet) return <div className="container muted">{t("portfolio.connectFirst")}</div>;

  const statusBadge = (status: NftWhitelistEntry["status"]) => {
    const colors: Record<string, string> = { PENDING: "var(--border)", APPROVED: "var(--green)", REJECTED: "var(--red)" };
    return (
      <span
        className="badge"
        style={{ background: colors[status], color: status === "PENDING" ? "var(--text)" : "var(--bg)", fontSize: 11, padding: "3px 10px" }}
      >
        {t(`nftWhitelist.status.${status}`)}
      </span>
    );
  };

  return (
    <div className="container" style={{ maxWidth: 480 }}>
      <div className="card">
        <div className="badge">{t("nftWhitelist.badge")}</div>
        <h2 style={{ marginTop: 0 }}>{t("nftWhitelist.title")}</h2>
        <p className="muted" style={{ fontSize: 13 }}>{t("nftWhitelist.body")}</p>

        <ol style={{ fontSize: 13, paddingLeft: 18, marginBottom: 14 }}>
          <li style={{ marginBottom: 4 }}>
            {t("nftWhitelist.step.follow")}
            {config?.twitterHandle && (
              <>
                {" "}
                <a href={`https://x.com/${config.twitterHandle}`} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                  @{config.twitterHandle}
                </a>
              </>
            )}
          </li>
          <li style={{ marginBottom: 4 }}>
            {t("nftWhitelist.step.likeRetweet")}
            {config?.tweetUrl && (
              <>
                {" "}
                <a href={config.tweetUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                  {t("nftWhitelist.step.tweetLink")}
                </a>
              </>
            )}
          </li>
          <li>{t("nftWhitelist.step.submit")}</li>
        </ol>

        {!config?.tweetUrl && (
          <p className="muted" style={{ fontSize: 11, marginBottom: 14 }}>{t("nftWhitelist.notConfiguredYet")}</p>
        )}

        {entry && (
          <div style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 12, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: entry.status === "REJECTED" ? 8 : 0 }}>
              <span style={{ fontSize: 13 }}>@{entry.twitterHandle}</span>
              {statusBadge(entry.status)}
            </div>
            {entry.status === "PENDING" && <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>{t("nftWhitelist.pendingNote")}</p>}
            {entry.status === "APPROVED" && <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>{t("nftWhitelist.approvedNote")}</p>}
            {entry.status === "REJECTED" && <p className="muted" style={{ fontSize: 12, margin: 0 }}>{t("nftWhitelist.rejectedNote")}</p>}
          </div>
        )}

        {(!entry || entry.status === "REJECTED") && (
          <>
            <div className="field">
              <label>{t("nftWhitelist.handleLabel")}</label>
              <input
                value={handleInput}
                onChange={(e) => setHandleInput(e.target.value)}
                placeholder="@yourhandle"
              />
            </div>
            {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
            <button className="btn btn-gold" style={{ width: "100%" }} disabled={submitting} onClick={submit}>
              {submitting ? t("nftWhitelist.submitting") : entry ? t("nftWhitelist.resubmitButton") : t("nftWhitelist.submitButton")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
