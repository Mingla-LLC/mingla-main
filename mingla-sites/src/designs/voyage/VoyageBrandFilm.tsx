"use client";
/* eslint-disable @next/next/no-img-element -- the poster is the site's own first-party, immutable media. */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/*
 * #2829 W7 — voyage's brand film (video_feature `brand-film`).
 *
 * Never autoplays and costs nothing to scroll past (`preload="none"`). The
 * <video controls poster> is a complete player with no JavaScript; the
 * designed cover (poster, flat scrim, accent play disc) is laid over it only
 * inside `html.js` once mounted. Pressing the disc takes the cover down first,
 * moves focus onto the player and starts it inline. While the cover is
 * painted the player behind it is out of the tab order. With no playable
 * film (a stream host not allowed) only the still is drawn.
 */
export function VoyageBrandFilm({ src, poster, posterSrcSet, label }: { src: string | null; poster: string; posterSrcSet?: string; label: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (playing) videoRef.current?.focus();
  }, [playing]);
  if (!src) {
    return <div className="brandfilm on-dark"><img className="brandfilm__poster" src={poster} srcSet={posterSrcSet} sizes="100vw" alt={label} loading="lazy" decoding="async" /></div>;
  }
  const covered = mounted && !playing;
  const start = () => {
    setPlaying(true);
    const video = videoRef.current;
    if (!video) return;
    video.play().catch((error: unknown) => {
      // The visitor already has the native controls; this is diagnostic.
      console.error("[brand film] playback did not start", error);
    });
  };
  return (
    <div className="brandfilm on-dark" data-playing={playing ? "true" : "false"}>
      <video
        ref={videoRef}
        className="brandfilm__video"
        src={src}
        poster={poster}
        controls
        preload="none"
        playsInline
        aria-label={label}
        {...(covered ? { tabIndex: -1, "aria-hidden": true } : {})}
      />
      {playing ? null : (
        <div className="brandfilm__cover">
          <img className="brandfilm__poster" src={poster} srcSet={posterSrcSet} sizes="100vw" alt="" loading="lazy" decoding="async" />
          <span aria-hidden="true" className="brandfilm__scrim" />
          <button type="button" className="brandfilm__play" aria-label={label} onClick={start}>
            <span className="brandfilm__disc" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.2a1 1 0 0 1 1.52-.85l9 6.8a1 1 0 0 1 0 1.7l-9 6.8A1 1 0 0 1 8 18.8V5.2Z" /></svg>
            </span>
            <span className="sr-only">{label}</span>
          </button>
        </div>
      )}
    </div>
  );
}
