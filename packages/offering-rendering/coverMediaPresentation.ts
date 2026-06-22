// Shared cover-media presentation resolver.
//
// Moved here from mingla-business `eventCoverMediaRules.ts` so the same logic
// drives EventCoverMedia across mingla-business, app-mobile, AND the shared
// brand page. mingla-business re-exports this to preserve its public API.
// Per I-MOR-0827-PACKAGE-ISOLATION this file imports nothing from any app src/.

import type { EventCoverMediaType } from "./types";

export const resolveEventCoverMediaPresentation = ({
  mediaUrl,
  mediaType,
  hasMediaError,
  reduceMotion,
}: {
  mediaUrl?: string | null;
  mediaType?: EventCoverMediaType | null;
  hasMediaError?: boolean;
  reduceMotion?: boolean;
}): "fallback" | "image" | "gif" | "video" | "video_still" => {
  if (hasMediaError === true || mediaUrl === null || mediaUrl === undefined) {
    return "fallback";
  }
  if (mediaType === "video") {
    return reduceMotion === true ? "video_still" : "video";
  }
  if (mediaType === "gif") return "gif";
  if (mediaType === "image") return "image";
  return "fallback";
};

// ORCH-0992 [event-cover video paused on web].
// A muted, autoplaying, looping cover video is ambient motion — the same class
// as an animated GIF cover, which is NEVER frozen for reduce-motion. Freezing
// only the video cover left it stuck on frame 0 ("shows up but seems paused")
// for reduce-motion viewers on every cover surface (event hero + brand-list
// cards), while GIF covers beside it kept animating. This helper decides whether
// a cover should still honor reduce-motion (freeze to a still): YES for any
// non-ambient cover (sound-on, or non-autoplay/tap-to-play contexts), NO for the
// default muted-autoplay-loop ambient cover. EventCoverMedia feeds the result
// into `reduceMotion` of resolveEventCoverMediaPresentation above.
export const shouldFreezeCoverForReduceMotion = ({
  reduceMotion,
  autoplay,
  muted,
  loop,
}: {
  reduceMotion?: boolean;
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
}): boolean => {
  const isAmbientMutedLoop =
    autoplay === true && muted === true && loop === true;
  return reduceMotion === true && !isAmbientMutedLoop;
};

// ORCH-1208 — derive a poster still for a cover VIDEO with ZERO new dependency.
// Cloudinary video URLs (.../video/upload/<rest>.mp4) yield a first-frame JPEG
// via the `so_0` (start-offset 0s) transform + .jpg extension. Non-Cloudinary
// or non-video URLs return null → the hue-band EventCover placeholder shows
// (still no eager video download — the only thing that matters for bots).
export const deriveCoverPosterUrl = (
  videoUrl?: string | null,
): string | null => {
  if (typeof videoUrl !== "string" || videoUrl.length === 0) return null;
  const marker = "/video/upload/";
  const i = videoUrl.indexOf(marker);
  if (i < 0) return null;
  const head = videoUrl.slice(0, i + marker.length);
  let tail = videoUrl.slice(i + marker.length);
  // Drop any query string from the derived still.
  const q = tail.indexOf("?");
  if (q >= 0) tail = tail.slice(0, q);
  // Swap the video extension for .jpg (Cloudinary renders the frame as JPEG).
  tail = tail.replace(/\.(mp4|mov|webm|m4v)$/i, ".jpg");
  if (!/\.jpg$/i.test(tail)) tail = `${tail}.jpg`;
  return `${head}so_0/${tail}`;
};
