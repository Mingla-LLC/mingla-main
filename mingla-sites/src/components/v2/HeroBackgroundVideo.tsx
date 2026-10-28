"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";

/**
 * #2829 W6 (AD-9) — a hero's background video.
 *
 * THE POSTER COMES FIRST. The hero section paints the poster (server-rendered
 * as its background) before any video byte arrives; the video is laid over it
 * full-bleed (`object-fit: cover`, centred) once the browser can play it.
 *
 * It is `muted loop playsinline autoplay` so iPhones play it inline instead of
 * refusing or going full screen, and SILENT: a loop nobody asked for never
 * makes sound.
 *
 * WCAG 2.2.2 (Pause, Stop, Hide): motion that starts on its own and lasts more
 * than five seconds needs a way to stop it, so a pause/play button is ALWAYS
 * visible while the video is mounted (44×44 minimum). A pause holds for the
 * rest of the visit (session storage), on every page.
 *
 * NO VIDEO AT ALL — not a paused one — when the visitor has asked for reduced
 * motion, or for less data (`Save-Data: on` / `navigator.connection.saveData`):
 * the poster is the hero, and nothing downloads.
 */

export const HERO_VIDEO_PAUSED_KEY = "mingla-site:hero-video-paused";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  query?.addEventListener?.("change", onChange);
  const connection = (navigator as unknown as { connection?: EventTarget }).connection;
  connection?.addEventListener?.("change", onChange);
  return () => {
    query?.removeEventListener?.("change", onChange);
    connection?.removeEventListener?.("change", onChange);
  };
}

/** True when the visitor's device allows a decorative video (motion and data). */
export function heroVideoAllowed(): boolean {
  const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  if (!query || query.matches) return false;
  const connection = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData !== true;
}

function readPaused(): boolean {
  try {
    return window.sessionStorage.getItem(HERO_VIDEO_PAUSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writePaused(paused: boolean): void {
  try {
    if (paused) window.sessionStorage.setItem(HERO_VIDEO_PAUSED_KEY, "1");
    else window.sessionStorage.removeItem(HERO_VIDEO_PAUSED_KEY);
  } catch {
    // Private mode or blocked storage: the choice still holds on this page.
  }
}

export function HeroBackgroundVideo(
  { src, poster, saveData = false }: { src: string; poster: string; saveData?: boolean },
) {
  const allowed = useSyncExternalStore(subscribe, heroVideoAllowed, () => false);
  const ref = useRef<HTMLVideoElement | null>(null);
  // The visitor's earlier choice this visit: a paused hero never starts.
  const [startPaused] = useState(() => typeof window !== "undefined" && readPaused());
  const [paused, setPaused] = useState(startPaused);
  // True once the visitor has pressed the control: nothing restarts the video after that.
  const chosen = useRef(startPaused);

  // Start the muted loop, unless the visitor chose otherwise. Called when the
  // element is attached and again when it can play: WebKit refuses a play()
  // made while the page is still hydrating, and allows the same call once the
  // video has data. A refusal leaves the button offering "Play".
  const start = useCallback((element: HTMLVideoElement) => {
    if (chosen.current || !element.paused) return;
    const started = element.play();
    if (started && typeof started.then === "function") {
      started.then(() => setPaused(false), () => setPaused(true));
    }
  }, []);

  const toggle = useCallback(() => {
    const video = ref.current;
    if (!video) return;
    chosen.current = true;
    if (video.paused) {
      writePaused(false);
      void video.play().then(() => setPaused(false), () => setPaused(true));
    } else {
      video.pause();
      writePaused(true);
      setPaused(true);
    }
  }, []);

  // Stable (not an inline arrow), so it runs once per element, never again
  // on a re-render — a re-run would restart a video the visitor paused.
  const attach = useCallback((element: HTMLVideoElement | null) => {
    ref.current = element;
    // React sets `muted` as a property only; iOS Safari decides inline
    // autoplay from the attribute, so it is set explicitly too.
    if (element) {
      element.muted = true;
      element.defaultMuted = true;
      element.setAttribute("muted", "");
      // The element was created (with autoplay) before it was muted, and
      // WebKit decides autoplay at that moment, so start it explicitly now
      // that it is muted.
      start(element);
    }
  }, [start]);

  if (!allowed || saveData) return null;
  return (
    <>
      <video
        ref={attach}
        className="hero-video"
        src={src}
        poster={poster}
        autoPlay={!startPaused}
        muted
        loop
        playsInline
        preload="metadata"
        aria-hidden="true"
        tabIndex={-1}
        // An autoplay the browser declined (Low Power Mode, a data policy)
        // leaves the button offering "Play", never a false "Pause".
        onPause={() => setPaused(true)}
        onPlay={() => setPaused(false)}
        onCanPlay={(event) => start(event.currentTarget)}
      />
      <button
        type="button"
        className="hero-video-toggle"
        onClick={toggle}
        aria-label={paused ? "Play background video" : "Pause background video"}
      >
        <span aria-hidden="true" className={paused ? "hero-video-icon play" : "hero-video-icon pause"} />
      </button>
    </>
  );
}
