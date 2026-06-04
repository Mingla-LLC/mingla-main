/**
 * ORCH-1069 — app-side mirror of the discover-cards `isVideoUrl` predicate.
 *
 * 🔒 INVARIANT I-1069-VIDEO-DETECTION-MATCHES-EDGE: this regex pair MUST stay
 * byte-identical (in behavior) to the edge function's `isVideoUrl` in
 * `supabase/functions/discover-cards/index.ts:708-709`:
 *
 *     const VIDEO_EXT = /\.(mp4|mov|webm|m4v)(\?|$)/i;
 *     const isVideoUrl = (u: string): boolean =>
 *       VIDEO_EXT.test(u) || /\/video\/upload\//.test(u);
 *
 * The edge fn computes the still hero (`image`) by picking the first NON-video
 * URL; this file computes the cover video (and the gallery branch) by detecting
 * the same video URLs. If the two predicates drift, a venue's hero and its
 * detected cover-video would disagree. Unit test `videoUrl.test.ts` (T-07)
 * asserts parity. If you change one, change the other in the same ORCH.
 */

// Mirror of discover-cards/index.ts:708 — do NOT diverge (see invariant above).
const VIDEO_EXT = /\.(mp4|mov|webm|m4v)(\?|$)/i;

/** True when the URL is a video (Cloudinary `.mp4` cover, etc.). */
export function isVideoUrl(u: string | null | undefined): boolean {
  if (typeof u !== "string" || u.length === 0) return false;
  return VIDEO_EXT.test(u) || /\/video\/upload\//.test(u);
}

/** First video URL in an ordered media list, or null if none. */
export function firstVideoUrl(
  images: readonly string[] | null | undefined,
): string | null {
  if (!Array.isArray(images)) return null;
  return images.find((u) => isVideoUrl(u)) ?? null;
}
