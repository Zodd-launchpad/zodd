"use client";
import { useEffect, useState } from "react";
import { getNoirWallet, isNoirWalletInstalled } from "@noir-wallet/sdk";
import { api, type NftWhitelistEntry } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

// Brai, 2026-09-18: "necesito que me hagas la parte de la whitelist de los
// nft ... la gente ingrese su handle de twitter y que le haga retwitear un
// twit ... likear y seguir nuestro twitter, esto lo deje en revision, una
// revision manual". This page does NOT check Twitter/X itself -- it just
// collects the address + handle and shows instructions; Brai reviews by
// hand in /admin/nft-whitelist and the status here just reflects whatever
// he decided. "llamar a los KOL... les vamos a dar whitelist, o sea minteo
// gratis" -- an APPROVED status means that wallet's next mint is free,
// handled entirely server-side by claimFreeNftWhitelistMint.
//
// Brai, 2026-09-18 (v2): "no se necesita conectar la wallet para agregar,
// solo hay que poner la wallet y el handle" -- no wallet session required,
// address is typed/pasted in by hand (or autofilled from Noir, purely as a
// convenience -- see autofillFromNoir below).
//
// Brai, 2026-09-18 (v3): sent screenshots of another project's allowlist
// page (a 4-step wizard: handle, wallet, tasks, a locked-in review) and
// asked for that STRUCTURE -- terminal log lines, a step counter, a
// segmented progress bar, a locked review before submit.
//
// Brai, 2026-09-18 (v4): "tenes que usar los colores y letras de ZODD.fun
// ... no te copies todo tal cual porque se va a notar que es una copia" --
// that first pass reused the reference's own orange/cream/monospace look
// wholesale. Rebuilt on the SITE'S actual design system instead (see
// globals.css: --bg/--panel/--border/--accent chrome, --green, --red,
// system sans-serif body font) -- .card/.btn/.field/.badge/.mono-break are
// the real sitewide classes, not a one-off palette. Monospace is kept only
// where the rest of the site already uses it (the .mono-break wallet
// address, the terminal log flavor lines) -- everything else (headings,
// buttons, labels) is the site's normal chrome/sans-serif look, and the
// reference's bracket-button "[ LIKE THIS ]" styling is gone in favor of
// the site's real .btn-gold/.btn-outline pill buttons.
//
// Brai, 2026-09-18 (v5 bugfix): "pongo gordo_cripto y no me deja tocar
// continue de handle" -- step 1 used to require pressing Enter to "lock"
// the handle before Continue would enable, with no visible button for
// that lock -- an invisible requirement, not a real step. Continue is now
// gated on the typed handle being valid, full stop; the separate
// locked/unlocked confirmation UI is gone.
const ADDRESS_STORAGE_KEY = "zodd-nft-whitelist-address";
const TOTAL_STEPS = 4;

type Tasks = { follow: boolean; likeRepost: boolean; quote: boolean };

export default function NftWhitelistPage() {
  const { t } = useLanguage();
  const [config, setConfig] = useState<{ tweetUrl: string | null; twitterHandle: string | null; quoteCaption: string } | null>(null);
  const [entry, setEntry] = useState<NftWhitelistEntry | null | undefined>(undefined); // undefined = still loading
  const [step, setStep] = useState(1);
  const [handleInput, setHandleInput] = useState("");
  const [addressInput, setAddressInput] = useState("");
  const [tasks, setTasks] = useState<Tasks>({ follow: false, likeRepost: false, quote: false });
  const [noirBusy, setNoirBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getNftWhitelistConfig()
      .then(setConfig)
      .catch(() => setConfig({ tweetUrl: null, twitterHandle: null, quoteCaption: "" }));
  }, []);

  useEffect(() => {
    let saved = "";
    try {
      saved = localStorage.getItem(ADDRESS_STORAGE_KEY) ?? "";
    } catch {
      /* ignore */
    }
    if (!saved) {
      setEntry(null);
      return;
    }
    api
      .getNftWhitelistStatus(saved)
      .then((r) => {
        setEntry(r.entry);
        if (r.entry) {
          setAddressInput(saved);
          setHandleInput(r.entry.twitterHandle);
        }
      })
      .catch(() => setEntry(null));
  }, []);

  const handleValid = /^[a-zA-Z0-9_]{1,15}$/.test(handleInput.trim());
  const addressValid = addressInput.trim().length >= 8;
  // Brai, 2026-09-18 (v6): "tenes que hacer que en el paso 3, hasta que no
  // esta tildado, follow, like y repost y quote it... no te deje poner
  // CONTINUAR" -- all three tasks must be ticked before Continue unlocks,
  // full stop, no auto-satisfy for tasks that aren't configured yet. If a
  // task's URL isn't set (e.g. NFT_WHITELIST_TWEET_URL not published yet),
  // its button stays disabled and Continue stays blocked -- that's
  // intentional now, not a bug.
  const tasksAllDone = tasks.follow && tasks.likeRepost && tasks.quote;
  const tasksLeftCount = [!tasks.follow, !tasks.likeRepost, !tasks.quote].filter(Boolean).length;

  function openTask(key: keyof Tasks, url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
    setTasks((tks) => ({ ...tks, [key]: true }));
  }

  async function autofillFromNoir() {
    setError(null);
    setNoirBusy(true);
    try {
      if (!isNoirWalletInstalled()) {
        setError(t("onboard.noir.notInstalled"));
        return;
      }
      const noirWallet = getNoirWallet();
      if (!noirWallet) {
        setError(t("onboard.noir.notInstalled"));
        return;
      }
      const connection = await noirWallet.zcash.connect();
      setAddressInput(connection.shielded);
    } catch (e: any) {
      setError(e?.code === 4001 || /reject/i.test(e?.message ?? "") ? t("onboard.noir.rejected") : e?.message ?? "connect failed");
    } finally {
      setNoirBusy(false);
    }
  }

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const result = await api.submitNftWhitelist({ walletAddress: addressInput.trim(), twitterHandle: handleInput.trim() });
      setEntry(result);
      try {
        localStorage.setItem(ADDRESS_STORAGE_KEY, addressInput.trim());
      } catch {
        /* ignore */
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  function applyAgain() {
    setEntry(null);
    setTasks({ follow: false, likeRepost: false, quote: false });
    setStep(1);
    setError(null);
  }

  if (entry === undefined) return null;

  const followUrl = config?.twitterHandle ? `https://x.com/${config.twitterHandle}` : null;
  const likeRepostUrl = config?.tweetUrl ?? null;
  const quoteUrl = config?.tweetUrl
    ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(config.quoteCaption)}&url=${encodeURIComponent(config.tweetUrl)}`
    : null;

  return (
    <div className="zw-page">
      <div className="zw-layout">
      <div className="zw-card card">
        <span className="zw-tick zw-tick-tl" />
        <span className="zw-tick zw-tick-tr" />
        <span className="zw-tick zw-tick-bl" />
        <span className="zw-tick zw-tick-br" />

        <div className="badge">{t("nftWhitelist.badge")}</div>
        <h1 className="zw-glory">{t("nftWhitelist.wizard.glory")}</h1>

        <div className="zw-head">
          <span className="zw-brand mono">ZODD // WHITELIST</span>
          {!entry && (
            <span className="zw-step-count mono">
              0{step}/0{TOTAL_STEPS}
            </span>
          )}
        </div>
        <div className="zw-log mono">
          <p>&gt; {t("nftWhitelist.wizard.log1")}</p>
          <p>&gt; {t("nftWhitelist.wizard.log2")}</p>
          <p>&gt; {t("nftWhitelist.wizard.log3")}</p>
        </div>
        <div className="zw-rule" />

        {entry ? (
          <>
            <div className="zw-step-label">{t("nftWhitelist.badge")}</div>
            <h2 className="zw-heading">{t(`nftWhitelist.status.${entry.status}`)}</h2>
            <div className="zw-review-row">
              <span className="zw-review-key">{t("nftWhitelist.wizard.reviewHandle")}</span>
              <span className="zw-review-val">@{entry.twitterHandle}</span>
            </div>
            <div className="zw-review-row">
              <span className="zw-review-key">{t("nftWhitelist.wizard.reviewAddress")}</span>
              <span className="zw-review-val mono-break">{entry.walletAddress}</span>
            </div>
            <p className="muted" style={{ marginTop: 16 }}>
              {entry.status === "PENDING" && t("nftWhitelist.pendingNote")}
              {entry.status === "APPROVED" && t("nftWhitelist.approvedNote")}
              {entry.status === "REJECTED" && t("nftWhitelist.rejectedNote")}
            </p>
            {entry.status === "REJECTED" && (
              <div className="zw-footer">
                <span />
                <span />
                <button className="btn btn-gold" onClick={applyAgain}>
                  {t("nftWhitelist.wizard.resubmit")}
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            {step === 1 && (
              <>
                <div className="zw-step-label">01 &middot; {t("nftWhitelist.wizard.step1Label")}</div>
                <h2 className="zw-heading">{t("nftWhitelist.wizard.step1Heading")}</h2>
                <p className="muted">{t("nftWhitelist.wizard.step1Body")}</p>
                <div className="field">
                  <label>{t("nftWhitelist.handleLabel")}</label>
                  <input
                    value={handleInput}
                    onChange={(e) => setHandleInput(e.target.value.replace(/^@/, ""))}
                    placeholder="yourhandle"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && handleValid) setStep(2);
                    }}
                  />
                </div>
                {handleValid && (
                  <p className="zw-connected mono">&gt; {t("nftWhitelist.wizard.step1Set", { handle: handleInput.trim() })}</p>
                )}
              </>
            )}

            {step === 2 && (
              <>
                <div className="zw-step-label">02 &middot; {t("nftWhitelist.wizard.step2Label")}</div>
                <h2 className="zw-heading">{t("nftWhitelist.wizard.step2Heading")}</h2>
                <p className="muted">{t("nftWhitelist.wizard.step2Body")}</p>
                <div className="field">
                  <label>{t("nftWhitelist.addressLabel")}</label>
                  <input value={addressInput} onChange={(e) => setAddressInput(e.target.value)} placeholder="u1… / zs1… / t1…" className="mono" />
                </div>
                <button className="btn btn-outline" disabled={noirBusy} onClick={autofillFromNoir}>
                  {noirBusy ? t("nftWhitelist.wizard.noirAutofilling") : t("nftWhitelist.wizard.noirAutofill")}
                </button>
              </>
            )}

            {step === 3 && (
              <>
                <div className="zw-step-label">03 &middot; {t("nftWhitelist.wizard.step3Label")}</div>
                <h2 className="zw-heading">{t("nftWhitelist.wizard.step3Heading")}</h2>
                <p className="muted">{t("nftWhitelist.wizard.step3Body")}</p>
                {(!followUrl || !likeRepostUrl) && <p className="muted" style={{ fontSize: 11 }}>{t("nftWhitelist.notConfiguredYet")}</p>}

                {[
                  { key: "follow" as const, title: t("nftWhitelist.wizard.taskFollow"), desc: t("nftWhitelist.wizard.taskFollowDesc"), url: followUrl },
                  {
                    key: "likeRepost" as const,
                    title: t("nftWhitelist.wizard.taskLikeRepost"),
                    desc: t("nftWhitelist.wizard.taskLikeRepostDesc"),
                    url: likeRepostUrl,
                  },
                  { key: "quote" as const, title: t("nftWhitelist.wizard.taskQuote"), desc: t("nftWhitelist.wizard.taskQuoteDesc"), url: quoteUrl },
                ].map((task) => (
                  <div className="zw-task" key={task.key}>
                    <div>
                      <div className="zw-task-title">{task.title}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{task.desc}</div>
                    </div>
                    <button
                      className={tasks[task.key] ? "btn btn-green" : "btn btn-outline"}
                      style={{ padding: "6px 14px", fontSize: 12, minWidth: 64 }}
                      disabled={!task.url}
                      onClick={() => task.url && openTask(task.key, task.url)}
                    >
                      {tasks[task.key] ? "✓" : t("nftWhitelist.wizard.open")}
                    </button>
                  </div>
                ))}
              </>
            )}

            {step === 4 && (
              <>
                <div className="zw-step-label">04 &middot; {t("nftWhitelist.wizard.step4Label")}</div>
                <h2 className="zw-heading">{t("nftWhitelist.wizard.step4Heading")}</h2>
                <p className="muted">{t("nftWhitelist.wizard.step4Body")}</p>
                <div className="zw-review-row">
                  <span className="zw-review-key">{t("nftWhitelist.wizard.reviewHandle")}</span>
                  <span className="zw-review-val">@{handleInput.trim()}</span>
                </div>
                <div className="zw-review-row">
                  <span className="zw-review-key">{t("nftWhitelist.wizard.reviewAddress")}</span>
                  <span className="zw-review-val mono-break">{addressInput.trim()}</span>
                </div>
                <div className="zw-review-row">
                  <span className="zw-review-key">{t("nftWhitelist.wizard.reviewTasks")}</span>
                  <span className="zw-review-val">{t("nftWhitelist.wizard.tasksDoneCount", { done: 3 - tasksLeftCount, total: 3 })}</span>
                </div>
                {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
              </>
            )}

            <div className="zw-rule zw-rule-footer" />
            <div className="zw-footer">
              {step > 1 ? (
                <button className="zw-link" onClick={() => setStep(step - 1)}>
                  {t("nftWhitelist.wizard.back")}
                </button>
              ) : (
                <span />
              )}
              <div className="zw-progress">
                {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
                  <span key={i} className={i < step ? "zw-dot zw-dot-filled" : "zw-dot"} />
                ))}
              </div>
              {step < TOTAL_STEPS && (
                <button
                  className="btn btn-gold"
                  disabled={(step === 1 && !handleValid) || (step === 2 && !addressValid) || (step === 3 && !tasksAllDone)}
                  onClick={() => setStep(step + 1)}
                >
                  {t("nftWhitelist.wizard.continue")}
                </button>
              )}
              {step === TOTAL_STEPS && (
                <button className="btn btn-gold" disabled={submitting} onClick={submit}>
                  {submitting ? t("nftWhitelist.submitting") : t("nftWhitelist.wizard.submit")}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Brai, 2026-09-18: "quiero poner un video a reproducir en el costado
          mientras haces la whitelist en los 4 pasos" -- looping branded
          mascot clip beside the card, only while the wizard is active (not
          on the post-submit PENDIENTE/APROBADO/RECHAZADO screen). "en loop"
          -- autoPlay + loop + muted + playsInline for reliable autoplay.
          Brai, 2026-09-18 (v7): sent 2 more mascot clips (Eye of Horus,
          scarab) -- "agrega esos dos videos, que queden balanceados los 3 al
          costado" -- 3 equal-size clips stacked in the side column instead
          of 1. */}
      {!entry && (
        <div className="zw-video-col">
          <div className="zw-video-wrap">
            <video className="zw-video" autoPlay muted loop playsInline>
              <source src="/zodd-mascot-loop.webm" type="video/webm" />
              <source src="/zodd-mascot-loop.mp4" type="video/mp4" />
            </video>
          </div>
          <div className="zw-video-wrap">
            <video className="zw-video" autoPlay muted loop playsInline>
              <source src="/zodd-mascot-eye.webm" type="video/webm" />
              <source src="/zodd-mascot-eye.mp4" type="video/mp4" />
            </video>
          </div>
          <div className="zw-video-wrap">
            <video className="zw-video" autoPlay muted loop playsInline>
              <source src="/zodd-mascot-scarab.webm" type="video/webm" />
              <source src="/zodd-mascot-scarab.mp4" type="video/mp4" />
            </video>
          </div>
        </div>
      )}
      </div>

      <style jsx>{`
        .zw-page {
          background: var(--bg);
          min-height: calc(100vh - 60px);
          padding: 48px 16px;
          display: flex;
          justify-content: center;
        }
        .zw-layout {
          width: 100%;
          max-width: 900px;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          gap: 24px;
        }
        .zw-card {
          position: relative;
          width: 100%;
          max-width: 620px;
          height: fit-content;
          box-shadow: 0 0 30px var(--glow-soft);
        }
        .zw-video-col {
          position: sticky;
          top: 48px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          flex-shrink: 0;
        }
        .zw-video-wrap {
          width: 190px;
          flex-shrink: 0;
          border-radius: 10px;
          overflow: hidden;
          border: 1px solid var(--border);
          box-shadow: 0 0 30px var(--glow-soft);
        }
        .zw-video {
          display: block;
          width: 100%;
          height: auto;
        }
        @media (max-width: 860px) {
          .zw-layout {
            flex-direction: column;
            align-items: center;
          }
          .zw-video-col {
            position: static;
            flex-direction: row;
            width: 100%;
            max-width: 620px;
            justify-content: center;
          }
          .zw-video-wrap {
            width: calc(33.333% - 8px);
          }
        }
        .zw-tick {
          position: absolute;
          width: 10px;
          height: 10px;
          border: 1px solid var(--accent-dim);
          opacity: 0.6;
        }
        .zw-tick-tl { top: -1px; left: -1px; border-right: none; border-bottom: none; }
        .zw-tick-tr { top: -1px; right: -1px; border-left: none; border-bottom: none; }
        .zw-tick-bl { bottom: -1px; left: -1px; border-right: none; border-top: none; }
        .zw-tick-br { bottom: -1px; right: -1px; border-left: none; border-top: none; }
        .zw-glory {
          margin: 2px 0 14px;
          font-size: 26px;
          font-weight: 700;
          letter-spacing: 0.04em;
          color: var(--accent);
          text-shadow: 0 0 20px var(--glow);
        }
        .zw-head { display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; }
        .zw-brand { color: var(--text-dim); letter-spacing: 0.04em; }
        .zw-step-count { color: var(--text-dim); }
        .zw-log { font-size: 12px; color: var(--text-dim); line-height: 1.6; margin: 8px 0 0; }
        .zw-log p { margin: 0; }
        .zw-rule { border-top: 1px solid var(--border); margin: 14px 0; }
        .zw-rule-footer { margin-top: 20px; }
        .zw-step-label { font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; }
        .zw-heading { font-size: 20px; margin: 0 0 8px; }
        .zw-connected { font-size: 13px; color: var(--green); }
        .zw-link {
          background: none;
          border: none;
          padding: 0;
          font-family: inherit;
          font-size: 12px;
          text-decoration: underline;
          color: var(--text-dim);
          cursor: pointer;
        }
        .zw-link:hover { color: var(--text); }
        .zw-task {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          padding: 10px 0;
          border-top: 1px solid var(--border);
        }
        .zw-task-title { font-size: 13px; font-weight: 700; }
        .zw-review-row {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          padding: 8px 0;
          border-top: 1px solid var(--border);
          font-size: 12px;
        }
        .zw-review-key { color: var(--text-dim); white-space: nowrap; }
        .zw-review-val { font-weight: 600; text-align: right; }
        .zw-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .zw-progress { display: flex; gap: 4px; }
        .zw-dot { width: 20px; height: 4px; border-radius: 2px; background: var(--border); }
        .zw-dot-filled { background: var(--green); box-shadow: 0 0 8px var(--green-glow); }
      `}</style>
    </div>
  );
}
