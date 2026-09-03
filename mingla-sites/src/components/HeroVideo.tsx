"use client";

import { useEffect, useRef, useState } from "react";

/**
 * #2830 — the hero's background video.
 *
 * THE POSTER IS THE PAGE; the video is an enhancement laid over it. The still
 * is always rendered by the server as the hero's background, so the heading is
 * legible before any video byte arrives — on a slow Lagos connection that is
 * most of the visit — and remains legible if the video never arrives at all.
 *
 * IT DOES NOT PLAY FOR PEOPLE WHO ASKED IT NOT TO. `prefers-reduced-motion`
 * means no video element is mounted, not a paused one: autoplaying motion at
 * someone who has asked their operating system for less of it is an
 * accessibility failure, and a looping food video is exactly the kind that
 * triggers it.
 *
 * It is also SILENT and unmutable by design. A background loop nobody can turn
 * off must never make sound.
 */
export function HeroVideo({ src, poster }: { src: string; poster: string }) {
  const [allowed, setAllowed] = useState(false);
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query || query.matches) return;
    // Respect a Data Saver / metered connection where the browser reports one:
    // 4MB of decorative video is a real cost on a metered plan.
    const connection = (navigator as unknown as {
      connection?: { saveData?: boolean };
    }).connection;
    if (connection?.saveData === true) return;
    setAllowed(true);
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setAllowed(false);
    };
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);

  if (!allowed) return null;
  return (
    <video
      ref={ref}
      className="hero-video"
      src={src}
      poster={poster}
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}
