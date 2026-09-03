"use client";

import { useSyncExternalStore } from "react";

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
/*
 * Subscribed rather than set-in-effect. `useSyncExternalStore` is the shape
 * React wants for reading a live browser value: the earlier version called
 * setState synchronously inside an effect, which the lint rule bans because it
 * can cascade renders. It also gets the server case right for free — the
 * server snapshot is `false`, so no video is ever server-rendered.
 */
function subscribeToMotionPreference(onChange: () => void): () => void {
  const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  query?.addEventListener?.("change", onChange);
  return () => query?.removeEventListener?.("change", onChange);
}

function motionAllowed(): boolean {
  const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  if (!query || query.matches) return false;
  // Respect Data Saver where the browser reports it: 4MB of decorative video
  // is a real cost on a metered plan.
  const connection = (navigator as unknown as {
    connection?: { saveData?: boolean };
  }).connection;
  return connection?.saveData !== true;
}

export function HeroVideo({ src, poster }: { src: string; poster: string }) {
  const allowed = useSyncExternalStore(
    subscribeToMotionPreference,
    motionAllowed,
    () => false,
  );
  if (!allowed) return null;
  return (
    <video
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
