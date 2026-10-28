"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/**
 * #2829 W6 (AD-9) — a `video_feature` film (the brand-film layout).
 *
 * - It never autoplays and costs nothing to scroll past: `preload="none"`
 *   fetches the still only, until someone presses play.
 * - It works without JavaScript: the <video> carries `controls` and a poster
 *   and is a complete player on its own. The designed cover (still + play
 *   button) is an enhancement laid over it once this component has mounted.
 * - The play control is a real, labelled button; pressing it takes the cover
 *   down first (whatever play() does), starts the film inline and moves focus
 *   onto the player, so a keyboard user can pause what they started.
 * - While the cover is painted, the player behind it is inert (not tabbable).
 *
 * With no playable film (a stream video whose host is not allowed) only the
 * still is shown: never a button that does nothing.
 */
export function BrandFilm(
  { src, poster, label, className = "brand-film" }: { src: string | null; poster: string; label: string; className?: string },
) {
  const ref = useRef<HTMLVideoElement | null>(null);
  // True once hydrated (false in the server render): the cover is an enhancement.
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  const [playing, setPlaying] = useState(false);
  // Focus moves onto the player once the cover is down (it is inert until then).
  useEffect(() => {
    if (playing) ref.current?.focus();
  }, [playing]);
  const still = { backgroundImage: `url(${JSON.stringify(poster).slice(1, -1)})` };
  if (!src) return <div className={`${className}-cover`} style={still} role="img" aria-label={label} />;
  const covered = mounted && !playing;
  const start = () => {
    setPlaying(true);
    const video = ref.current;
    if (!video) return;
    // play() inside the click itself, so the browser counts the gesture.
    video.play().catch((error: unknown) => {
      // The visitor already has the native controls; this is diagnostic.
      console.error("[brand film] playback did not start", error);
    });
  };
  return (
    <div className={className}>
      <video
        ref={ref}
        className={`${className}-video`}
        src={src}
        poster={poster}
        controls
        playsInline
        preload="none"
        aria-label={label}
        tabIndex={0}
        inert={covered || undefined}
      />
      {covered ? (
        <button type="button" className={`${className}-cover`} style={still} onClick={start}>
          <span className={`${className}-play`} aria-hidden="true" />
          <span className="sr-only">{`Play: ${label}`}</span>
        </button>
      ) : null}
    </div>
  );
}
