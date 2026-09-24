"use client";
import { useEffect, useState } from "react";
import { getNoirWallet, isNoirWalletInstalled } from "@noir-wallet/sdk";
import { api, type NftWhitelistEntry, type NftWhitelistPublicStatus } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

// Brai, 2026-09-20: "listo cerramos la whitelist, pon esa foto en el medio
// de la pantalla en grande y abajo que diga en ingles, ha terminado el
// tiempo para la whitelist. Abajo deja la caja para que puedan chequear si
// han sido aprobados o no... solo con poner el handle escribiendolo, sin
// conectar con el autenticador. Entonces escriben y les dice si estan
// aprobados o no. Pon que sera anunciado en twitter el dia y la fecha de
// minteo." -- the application wizard below (X OAuth, address, tasks) is
// done accepting new entries. Flip WHITELIST_CLOSED back to false to
// reopen it exactly as it was -- nothing else needs to change, same
// pattern as SHOW_NFT_IN_ACTIVITY/ADDRESS_ONLY_MODE elsewhere in this repo.
//
// The status-check box below intentionally reuses
// api.getNftWhitelistStatusByHandle -- the SAME unauthenticated,
// wallet-free by-handle lookup the wizard already used internally (v8/v9
// above) to recognize a returning applicant. It was already designed to
// be safe for "anyone can type anyone's handle" (see
// NftWhitelistPublicStatus's comment in lib/api.ts -- no wallet address is
// ever returned), which is exactly what "sin conectar con el autenticador"
// calls for here.
//
// Brai, 2026-09-20 (cont.): "lo de la whitelist lo preparas pero no lo
// hagas aun, no lo vamos a mandar hasta la noche dentro de 5 horas" -- code
// ready, flag left OFF until he said go.
//
// Brai, 2026-09-21: "activa fin de whitelist" -- flag flipped on.
const WHITELIST_CLOSED = true;

export default function NftWhitelistPage() {
  return WHITELIST_CLOSED ? <NftWhitelistClosedView /> : <NftWhitelistWizard />;
}

function NftWhitelistClosedView() {
  const { t } = useLanguage();
  const [handleInput, setHandleInput] = useState("");
  const [result, setResult] = useState<NftWhitelistPublicStatus | null | undefined>(undefined); // undefined = not checked yet, null = not found
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Brai, 2026-09-24: "cuando dice aprobbed que haya un boton para hacer
  // el SHARE con el handle ... e ingresa un cartel que diga, una ultima
  // tarea te pedimos, comparte!" -- reuses the exact same per-handle share
  // page + fresh-token cache-busting the wizard's own shareStatus() uses
  // (see that function's comment further down in this file) so the tweet
  // card still picks up the mascot image instead of a stale/blank one.
  function shareStatus(handle: string) {
    const caption = t("nftWhitelist.share.approved");
    const freshToken = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const shareUrl = `https://zodd.fun/nft/whitelist/share/${encodeURIComponent(handle)}?t=${freshToken}`;
    const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(caption)}&url=${encodeURIComponent(shareUrl)}`;
    window.open(intentUrl, "_blank", "noopener,noreferrer");
  }

  async function checkStatus() {
    const handle = handleInput.trim().replace(/^@/, "");
    if (!handle) {
      setError(t("nftWhitelist.closed.enterHandle"));
      return;
    }
    setError(null);
    setChecking(true);
    setResult(undefined);
    try {
      const { entry } = await api.getNftWhitelistStatusByHandle(handle);
      setResult(entry ?? null);
    } catch (e: any) {
      setError(e?.message ?? "error");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="zw-page">
      <div className="zw-closed-layout">
        <img src="/zodd-whitelist-closed-scroll.jpg" alt="" className="zw-closed-img" />

        <div className="zw-closed-card card">
          <div className="badge">{t("nftWhitelist.badge")}</div>
          <h1 className="zw-closed-title">{t("nftWhitelist.closed.title")}</h1>
          <p className="muted">{t("nftWhitelist.closed.body")}</p>
          <p className="zw-closed-announce">{t("nftWhitelist.closed.announce")}</p>

          <div className="zw-rule" />

          <div className="zw-step-label">{t("nftWhitelist.closed.checkTitle")}</div>
          <p className="muted" style={{ marginBottom: 12 }}>{t("nftWhitelist.closed.checkBody")}</p>

          <div className="zw-closed-check-row">
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              <input
                value={handleInput}
                onChange={(e) => {
                  setHandleInput(e.target.value);
                  setResult(undefined);
                  setError(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && checkStatus()}
                placeholder={t("nftWhitelist.closed.handlePlaceholder")}
                className="mono"
              />
            </div>
            <button className="btn btn-gold" disabled={checking} onClick={checkStatus}>
              {checking ? t("nftWhitelist.closed.checking") : t("nftWhitelist.closed.checkButton")}
            </button>
          </div>

          {error && <p style={{ color: "var(--red)", fontSize: 13, marginTop: 10 }}>{error}</p>}

          {result !== undefined && (
            <div className="zw-share-card" style={{ marginTop: 16 }}>
              {result === null ? (
                <p className="muted" style={{ margin: 0 }}>{t("nftWhitelist.closed.notFound")}</p>
              ) : (
                <>
                  <div className={`zw-status-big zw-status-${result.status.toLowerCase()}`}>
                    <span className="zw-status-handle">@{result.twitterHandle}</span>
                    <span className="zw-status-word">{t(`nftWhitelist.status.${result.status}`)}</span>
                  </div>
                  {result.status === "APPROVED" && (
                    <div style={{ marginTop: 14, textAlign: "center" }}>
                      <p style={{ fontWeight: 700, marginBottom: 8 }}>{t("nftWhitelist.closed.shareBanner")}</p>
                      <button className="btn btn-outline" onClick={() => shareStatus(result.twitterHandle)}>
                        {t("nftWhitelist.closed.shareButton")}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .zw-page {
          background: var(--bg);
          min-height: calc(100vh - 60px);
          padding: 48px 16px;
          display: flex;
          justify-content: center;
          align-items: flex-start;
        }
        .zw-closed-layout {
          width: 100%;
          max-width: 680px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 24px;
        }
        .zw-closed-img {
          width: 100%;
          max-width: 560px;
          height: auto;
          border-radius: 14px;
          border: 1px solid var(--border);
          box-shadow: 0 0 30px var(--glow-soft);
        }
        .zw-closed-card {
          width: 100%;
          text-align: center;
          box-shadow: 0 0 30px var(--glow-soft);
        }
        .zw-closed-title {
          margin: 10px 0 12px;
          font-size: 24px;
          font-weight: 700;
          letter-spacing: 0.02em;
          color: var(--accent);
          text-shadow: 0 0 20px var(--glow);
        }
        .zw-closed-announce {
          margin: 10px 0 0;
          font-size: 13px;
          font-weight: 600;
          color: var(--text);
        }
        .zw-rule {
          border-top: 1px solid var(--border);
          margin: 20px 0 16px;
        }
        .zw-step-label {
          font-size: 11px;
          color: var(--text-dim);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-bottom: 4px;
        }
        .zw-closed-check-row {
          display: flex;
          gap: 10px;
          align-items: flex-start;
        }
        @media (max-width: 480px) {
          .zw-closed-check-row {
            flex-direction: column;
          }
          .zw-closed-check-row .btn {
            width: 100%;
          }
        }
        .zw-share-card {
          padding: 20px;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: var(--panel);
          text-align: left;
        }
        .zw-status-big {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 10px;
          font-size: 22px;
          font-weight: 800;
          letter-spacing: 0.01em;
          line-height: 1.15;
        }
        .zw-status-handle {
          color: var(--accent);
          text-shadow: 0 0 20px var(--glow);
        }
        .zw-status-word { text-transform: uppercase; }
        .zw-status-pending .zw-status-word { color: var(--text-dim); }
        .zw-status-approved .zw-status-word { color: var(--green); text-shadow: 0 0 16px var(--green-glow); }
        .zw-status-rejected .zw-status-word { color: var(--red); text-shadow: 0 0 16px var(--red-glow); }
      `}</style>
    </div>
  );
}

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
//
// Brai, 2026-09-18 (v10, REVERTED): "cuando figuras como aprobado y tocas
// SHARE, eso tiene que sacar una captura de el cuadrado que dice NAXWEB3
// APPROVED y enviarlo para twitear directamente" -- first attempt made
// SHARE screenshot the status card (html2canvas) and, on desktop, download
// the PNG next to a pre-filled tweet compose window for the user to
// manually attach. Brai's call: "eso del share quedo horrible... nadie va
// a cargar esa foto en twitter, nadie va a ni descargarla" -- correct, a
// download-then-manually-attach step is a dead flow, nobody completes it.
//
// Brai, 2026-09-18 (v11): fixed properly. SHARE now just opens the normal
// Twitter text-intent, but pointed at /nft/whitelist/share/[handle]
// instead of the generic whitelist page. THAT page's generateMetadata
// sets Open Graph / Twitter Card image tags pointing at
// /api/og/whitelist/[handle], which server-renders the status card (via
// next/og) on the fly -- Twitter's own crawler fetches it and shows it
// inline in the tweet compose/preview automatically. No screenshot, no
// download, no manual attach step, works identically on mobile and
// desktop because it's just a normal link-preview card, the same
// mechanism every "share your result" page on the web uses.
//
// Brai, 2026-09-18 (v11 cont.): "la captura tiene que incluir esta foto
// del gato tambien, la idea es que sea publicidad" -- the ZODD mascot
// image is baked into that server-rendered card (see route.tsx) so every
// share doubles as branded advertising.
//
// Brai, 2026-09-18 (v12, URGENT): "ahora me están conectando cualquier
// handle y se están haciendo pasar por otra persona y ponen su wallet ...
// necesito que cuando haces clic te revise que seas ese handle con
// Twitter, que se conecte a Twitter" -- step 1's free-text handle field is
// GONE. It's replaced by real "Sign in with X" (OAuth 2.0 + PKCE, see
// app/api/auth/twitter/*): clicking CONNECT WITH X sends the browser to
// X's own login/consent screen, and the handle used for the rest of the
// wizard comes back from X itself in a signed, httpOnly cookie -- nothing
// about "who you are" is ever taken from something the client typed or
// could edit. submit() below now calls /api/nft/whitelist/submit (a
// same-origin proxy) instead of hitting the backend directly, since only
// that proxy can read the verified-handle cookie; the backend's own
// POST /api/nft/whitelist is locked down separately (WHITELIST_INTERNAL_TOKEN)
// so it can no longer be called directly with a made-up handle either.
//
// Brai, 2026-09-20: closed to new applications -- see WHITELIST_CLOSED
// above. This wizard is left fully intact so reopening it is a one-line
// flip, not a rebuild.
const ADDRESS_STORAGE_KEY = "zodd-nft-whitelist-address";
const TOTAL_STEPS = 4;

type Tasks = { follow: boolean; likeRepost: boolean; quote: boolean };

function NftWhitelistWizard() {
  const { t } = useLanguage();
  const [config, setConfig] = useState<{ tweetUrl: string | null; twitterHandle: string | null; quoteCaption: string } | null>(null);
  // Brai, 2026-09-18 (v9, URGENT PRIVACY FIX): entry can come from the
  // user's OWN wallet lookup/submit (full NftWhitelistEntry, wallet
  // included -- fine, it's their own address) or from a plain HANDLE
  // lookup (NftWhitelistPublicStatus, wallet-free -- anyone can type
  // anyone's handle, so it must never carry a wallet address). Never
  // render entry.walletAddress from this shared state for that reason.
  const [entry, setEntry] = useState<NftWhitelistEntry | NftWhitelistPublicStatus | null | undefined>(undefined); // undefined = still loading
  const [step, setStep] = useState(1);
  // Brai, 2026-09-18 (v12, URGENT): replaces handleInput. undefined = still
  // checking with the server whether this browser already has a verified X
  // session; null = not connected yet (show the CONNECT WITH X button);
  // a string = the real handle X confirmed, straight from the signed
  // VERIFIED_COOKIE -- never editable, never typed.
  const [verifiedHandle, setVerifiedHandle] = useState<string | null | undefined>(undefined);
  const [xConfigured, setXConfigured] = useState(true);
  const [oauthError, setOauthError] = useState(false);
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
        if (r.entry) setAddressInput(saved);
      })
      .catch(() => setEntry(null));
  }, []);

  // Brai, 2026-09-18 (v12, URGENT): checks whether this browser already has
  // a verified X session (either from a previous visit, or right after the
  // OAuth redirect lands back here with ?verified=1). Runs once on mount.
  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("oauthError")) {
      setOauthError(true);
    }
    fetch("/api/auth/twitter/session")
      .then((r) => r.json())
      .then((body: { handle: string | null; configured: boolean }) => {
        setXConfigured(body.configured);
        setVerifiedHandle(body.handle);
      })
      .catch(() => setVerifiedHandle(null));
  }, []);

  // Brai, 2026-09-18 (v8, carried into v12): "si pones tu HANDLE y ya
  // suscribiste te vaya a la 4ta directamente" -- once X verification comes
  // back with a real handle (and the address-based check above has already
  // come up empty), look that handle up the same way as before; an
  // existing entry jumps straight to the status screen, otherwise the
  // wizard advances to step 2. Guarded on entry === null so this never
  // races with the address-based lookup above.
  useEffect(() => {
    if (entry !== null || !verifiedHandle) return;
    let cancelled = false;
    api
      .getNftWhitelistStatusByHandle(verifiedHandle)
      .then((r) => {
        if (cancelled) return;
        if (r.entry) setEntry(r.entry);
        else setStep(2);
      })
      .catch(() => {
        if (!cancelled) setStep(2);
      });
    return () => {
      cancelled = true;
    };
  }, [entry, verifiedHandle]);

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

  function shareStatus() {
    if (!entry) return;
    const caption =
      entry.status === "APPROVED" ? t("nftWhitelist.share.approved") : t("nftWhitelist.share.pending");
    // Points at the per-handle share page, not the generic whitelist page --
    // ITS Open Graph/Twitter Card tags are what put the status image (with
    // the ZODD mascot) into the tweet, via Twitter's own link-preview crawl.
    //
    // Brai, 2026-09-18 (v13): "sigue sin llegar la foto del gato" -- X caches
    // a link's card (title/image) per exact URL, sometimes for a long time,
    // and can get stuck on whatever it first saw for that URL (e.g. while
    // this feature was still being built). A random token on every SHARE
    // click makes each tweet's URL one X has genuinely never crawled before,
    // so there's no stale cache to get stuck on -- combined with the
    // image-caching fix in /api/og/whitelist/[handle]/route.tsx.
    const freshToken = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const shareUrl = `https://zodd.fun/nft/whitelist/share/${encodeURIComponent(entry.twitterHandle)}?t=${freshToken}`;
    const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(caption)}&url=${encodeURIComponent(shareUrl)}`;
    window.open(intentUrl, "_blank", "noopener,noreferrer");
  }

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

  // Brai, 2026-09-18 (v12, URGENT): posts to the frontend's own
  // /api/nft/whitelist/submit proxy instead of the backend directly -- no
  // twitterHandle in this request at all, the proxy supplies it itself
  // from the signed VERIFIED_COOKIE (see that route). If the X session
  // expired mid-wizard, the proxy 401s and the message below tells them to
  // reconnect rather than silently failing.
  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/nft/whitelist/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ walletAddress: addressInput.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `error ${res.status}`);
      setEntry(body);
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
            {/* Brai, 2026-09-18 (v8): "te diga tu estado en GRANDE, por ej
                gordo_cripto UNDER REVIEW" -- handle + status as one big,
                color-coded line instead of a small heading. Kept as its
                own bordered block purely for visual polish now -- the
                actual shareable image is server-rendered separately (see
                /api/og/whitelist/[handle]/route.tsx), this on-page card
                isn't screenshotted anymore (v11). */}
            <div className="zw-share-card">
              <div className="zw-share-brand mono">ZODD.FUN &middot; NFT WHITELIST</div>
              <div className={`zw-status-big zw-status-${entry.status.toLowerCase()}`}>
                <span className="zw-status-handle">@{entry.twitterHandle}</span>
                <span className="zw-status-word">{t(`nftWhitelist.status.${entry.status}`)}</span>
              </div>
              <div className="zw-share-foot mono">zodd.fun/nft/whitelist</div>
            </div>
            {/* Brai, 2026-09-18 (v9, URGENT PRIVACY FIX): "cuando ppones el
                handle te dice que wallet es, no tiene que aparecer que
                wallet es se supone que es anonimo" -- the wallet address
                review row that used to be here is gone for good. This
                status view is reachable by typing ANY handle, so showing
                the linked wallet would deanonymize whoever owns it. */}
            <p className="muted" style={{ marginTop: 16 }}>
              {entry.status === "PENDING" && t("nftWhitelist.pendingNote")}
              {entry.status === "APPROVED" && t("nftWhitelist.approvedNote")}
              {entry.status === "REJECTED" && t("nftWhitelist.rejectedNote")}
            </p>
            <div className="zw-footer">
              <span />
              <span />
              {entry.status === "REJECTED" ? (
                <button className="btn btn-gold" onClick={applyAgain}>
                  {t("nftWhitelist.wizard.resubmit")}
                </button>
              ) : (
                <button className="btn btn-outline" onClick={shareStatus}>
                  {t("nftWhitelist.wizard.share")}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            {step === 1 && (
              <>
                <div className="zw-step-label">01 &middot; {t("nftWhitelist.wizard.step1Label")}</div>
                <h2 className="zw-heading">{t("nftWhitelist.wizard.step1Heading")}</h2>
                <p className="muted">{t("nftWhitelist.wizard.step1Body")}</p>
                {verifiedHandle === undefined ? (
                  <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>{t("nftWhitelist.wizard.checkingX")}</p>
                ) : verifiedHandle ? (
                  <p className="zw-connected mono">&gt; {t("nftWhitelist.wizard.xConnected", { handle: verifiedHandle })}</p>
                ) : (
                  <>
                    {oauthError && (
                      <p style={{ color: "var(--red)", fontSize: 13, marginTop: 8 }}>{t("nftWhitelist.wizard.xError")}</p>
                    )}
                    {!xConfigured && (
                      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>{t("nftWhitelist.wizard.xNotConfigured")}</p>
                    )}
                    <a
                      className="btn btn-gold"
                      href="/api/auth/twitter/start"
                      style={{
                        display: "inline-block",
                        marginTop: 12,
                        pointerEvents: xConfigured ? "auto" : "none",
                        opacity: xConfigured ? 1 : 0.5,
                      }}
                    >
                      {t("nftWhitelist.wizard.connectX")}
                    </a>
                  </>
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
                  <span className="zw-review-val">@{verifiedHandle}</span>
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
              {/* Brai, 2026-09-18 (v12, URGENT): step 1 no longer has a
                  Continue button here -- CONNECT WITH X is the only action,
                  and the wizard advances itself once X verification comes
                  back (see the useEffect keyed on verifiedHandle above). */}
              {step > 1 && step < TOTAL_STEPS && (
                <button
                  className="btn btn-gold"
                  disabled={(step === 2 && !addressValid) || (step === 3 && !tasksAllDone)}
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
          align-items: flex-start;
        }
        .zw-layout {
          width: 100%;
          max-width: 900px;
          display: flex;
          align-items: stretch;
          justify-content: center;
          gap: 24px;
        }
        .zw-card {
          position: relative;
          width: 100%;
          max-width: 620px;
          box-shadow: 0 0 30px var(--glow-soft);
        }
        .zw-video-col {
          display: flex;
          flex-direction: column;
          gap: 12px;
          flex-shrink: 0;
        }
        .zw-video-wrap {
          width: 190px;
          flex: 1;
          min-height: 0;
          flex-shrink: 0;
          border-radius: 10px;
          overflow: hidden;
          border: 1px solid var(--border);
          box-shadow: 0 0 30px var(--glow-soft);
        }
        .zw-video {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        @media (max-width: 860px) {
          .zw-layout {
            flex-direction: column;
            align-items: center;
          }
          .zw-video-col {
            flex-direction: row;
            width: 100%;
            max-width: 620px;
            justify-content: center;
          }
          .zw-video-wrap {
            width: calc(33.333% - 8px);
            flex: none;
            aspect-ratio: 1 / 1;
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
        .zw-share-card {
          padding: 22px 20px;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: var(--panel);
          margin: 4px 0 18px;
        }
        .zw-share-brand {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: var(--text-dim);
          margin-bottom: 12px;
        }
        .zw-share-foot {
          margin-top: 14px;
          font-size: 12px;
          color: var(--text-dim);
        }
        .zw-status-big {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 10px;
          margin: 4px 0 18px;
          font-size: 28px;
          font-weight: 800;
          letter-spacing: 0.01em;
          line-height: 1.15;
        }
        .zw-status-handle {
          color: var(--accent);
          text-shadow: 0 0 20px var(--glow);
        }
        .zw-status-word { text-transform: uppercase; }
        .zw-status-pending .zw-status-word { color: var(--text-dim); }
        .zw-status-approved .zw-status-word { color: var(--green); text-shadow: 0 0 16px var(--green-glow); }
        .zw-status-rejected .zw-status-word { color: var(--red); text-shadow: 0 0 16px var(--red-glow); }
        @media (max-width: 480px) {
          .zw-status-big { font-size: 22px; }
        }
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
