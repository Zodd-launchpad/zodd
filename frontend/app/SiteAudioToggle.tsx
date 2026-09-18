"use client";
import { useEffect, useRef, useState } from "react";

// Brai, 2026-09-18: "agrega esta cancion de fondo, muy bajita en volumen,
// que no moleste, agrega un icono con un parlante que permite silenciar el
// sitio web a la derecha arriba" -- site-wide ambient background track,
// very low volume, with a speaker icon (top-right of the header) to mute
// it. Lives in HeaderBar (rendered once in RootLayout, outside {children}),
// so the <audio> element -- and playback -- survives client-side route
// changes instead of restarting on every page.
//
// Browsers block audible autoplay without a prior user gesture (this is
// true everywhere, regardless of volume) -- so on first load the track
// usually can't start itself, and the icon just sits in its "off" state
// until the visitor clicks it once. That's expected, not a bug. Their
// on/off choice is remembered (localStorage) so a visitor who muted it
// doesn't get it forced back on if the browser ever does allow autoplay.
const AUDIO_PREF_KEY = "zodd-audio-muted";
const VOLUME = 0.12;

export default function SiteAudioToggle() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = VOLUME;
    let userMuted = false;
    try {
      userMuted = localStorage.getItem(AUDIO_PREF_KEY) === "1";
    } catch {
      /* ignore */
    }
    if (!userMuted) {
      audio
        .play()
        .then(() => setPlaying(true))
        .catch(() => {
          /* autoplay blocked -- wait for a click on the icon */
        });
    }
  }, []);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      try {
        localStorage.setItem(AUDIO_PREF_KEY, "1");
      } catch {
        /* ignore */
      }
    } else {
      audio
        .play()
        .then(() => {
          setPlaying(true);
          try {
            localStorage.setItem(AUDIO_PREF_KEY, "0");
          } catch {
            /* ignore */
          }
        })
        .catch(() => {
          /* ignore */
        });
    }
  }

  return (
    <>
      <audio ref={audioRef} loop preload="auto">
        <source src="/zodd-ambient.ogg" type="audio/ogg" />
        <source src="/zodd-ambient.mp3" type="audio/mpeg" />
      </audio>
      <button
        onClick={toggle}
        aria-label={playing ? "Mute background music" : "Play background music"}
        title={playing ? "Mute background music" : "Play background music"}
        style={{
          display: "flex",
          alignItems: "center",
          color: "var(--text-dim)",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 4,
        }}
      >
        {playing ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 10v4h4l5 5V5L7 10H3z" />
            <path d="M16.5 12c0-1.77-.77-3.29-2-4.24v8.48c1.23-.95 2-2.47 2-4.24z" />
            <path d="M14.5 4.46v2.06c2.89 1.04 5 3.77 5 7.02s-2.11 5.98-5 7.02v2.06c4.01-1.09 7-4.72 7-9.08s-2.99-8-7-9.08z" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.19v2.06c1.38-.31 2.63-.95 3.69-1.8L19.73 21 21 19.73 4.27 3zM12 4l-1.88 1.88L12 7.76V4z" />
            <path d="M16.5 12c0-1.77-.77-3.29-2-4.24v2.53l1.88 1.88c.08-.38.12-.77.12-1.17zM19 12c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v1.99c2.98.65 5 3.26 5 6.78z" />
          </svg>
        )}
      </button>
    </>
  );
}
