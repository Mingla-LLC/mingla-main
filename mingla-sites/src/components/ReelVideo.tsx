"use client";

import { useRef, useState } from "react";

/**
 * #2830 — a reel: the poster until someone asks for the film.
 *
 * Unlike the hero, this one does NOT autoplay. A page carrying several of these
 * that all started at once would be several megabytes and a wall of motion, and
 * gogi's own site does the same thing — a still with a play control over it.
 *
 * That also makes it correct under prefers-reduced-motion by construction:
 * nothing moves until a person asks it to, so there is no autoplay to suppress.
 * Sound is on, because a reel someone chose to play is not background noise —
 * but it starts muted so the choice to hear it is theirs too.
 */
export function ReelVideo(
  { src, poster, label }: { src: string; poster: string; label: string },
) {
  const [playing, setPlaying] = useState(false);
  const ref = useRef<HTMLVideoElement | null>(null);

  if (!playing) {
    return (
      <button
        type="button"
        className="reel-poster"
        onClick={() => setPlaying(true)}
        style={{ backgroundImage: `url(${JSON.stringify(poster).slice(1, -1)})` }}
      >
        <span className="reel-play" aria-hidden="true">▶</span>
        <span className="sr-only">{`Play: ${label}`}</span>
      </button>
    );
  }
  return (
    <video
      ref={ref}
      className="reel-video"
      src={src}
      poster={poster}
      controls
      autoPlay
      muted
      playsInline
      preload="metadata"
      aria-label={label}
    />
  );
}
