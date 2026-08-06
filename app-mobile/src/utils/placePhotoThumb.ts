/**
 * Issue #1636 — "Likes takes a long time to load once you have a lot of liked
 * places."
 *
 * A 384x384 `_thumb.jpg` already exists beside every backfilled place photo in
 * the Supabase `place-photos` bucket — written by the
 * `backfill-place-photo-thumbs` edge function, ~40 000 places covered, same
 * bucket, same one-year cache headers, same Cloudflare edge cache. Nothing in
 * the app has ever requested one: cards render the 800x1066 original
 * (measured 220 114 B) into an 80pt box. The thumb is 46 741 B — 4.7x smaller
 * and already paid for.
 *
 * This module is the SINGLE place that derives a thumb URL from a stored photo
 * URL. Do not inline this string manipulation anywhere else.
 *
 * Hard constraints baked in here on purpose:
 *
 *   1. ONLY Supabase `place-photos` public-object URLs are rewritten. Unsplash,
 *      Google Places and every other host pass through UNTOUCHED — 11 of 458
 *      production saved cards point off-bucket, and a naive `.jpg` ->
 *      `_thumb.jpg` swap would render broken images for every one of them.
 *
 *   2. Coverage is NOT universal (~40 000 places have thumbs; `place_pool` has
 *      88 367 active rows). A thumb URL is therefore only ever an OPTIMISTIC
 *      first choice — callers MUST keep the original as a fallback. That is
 *      what `resolvePlacePhotoThumbSource` returns and what
 *      `ImageWithFallback`'s `fallbackUri` prop consumes. A silently broken
 *      image is a worse regression than a slow one.
 *
 *   3. This must NOT use Supabase's `/render/image/` transformation endpoint.
 *      That is a billed add-on whose included quota is 100 origin images per
 *      month on our plan, and the spend cap is armed. The `_thumb.jpg` objects
 *      cost nothing extra to serve.
 *
 * The naming mirrors `supabase/functions/backfill-place-photo-thumbs/index.ts`
 * (`extractPlacePhotoObjectPath` + `buildThumbPathFromObjectPath`) exactly: the
 * thumb of `<dir>/<stem>.<ext>` is `<dir>/<stem>_thumb.jpg`, always `.jpg`
 * regardless of the original extension. If that writer ever changes, this
 * reader must change with it.
 */

/** The only URL shape this module will ever rewrite. */
export const PLACE_PHOTOS_PUBLIC_PREFIX = "/storage/v1/object/public/place-photos/";

/** Suffix the backfill writer appends in place of the original extension. */
export const PLACE_PHOTO_THUMB_SUFFIX = "_thumb.jpg";

/**
 * Derive the `_thumb.jpg` sibling of a stored place-photo URL.
 *
 * Returns `null` — meaning "leave this URL alone" — for every input that is not
 * a Supabase `place-photos` public-object URL, for an URL that already points
 * at a thumb, and for any shape the backfill writer would itself have refused
 * (empty object path, no directory segment, empty basename).
 *
 * Query strings and fragments are preserved verbatim on the rewritten URL.
 */
export function getPlacePhotoThumbUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (trimmed.length === 0) return null;

  const prefixIndex = trimmed.indexOf(PLACE_PHOTOS_PUBLIC_PREFIX);
  if (prefixIndex < 0) return null;

  const head = trimmed.slice(0, prefixIndex + PLACE_PHOTOS_PUBLIC_PREFIX.length);
  const remainder = trimmed.slice(prefixIndex + PLACE_PHOTOS_PUBLIC_PREFIX.length);

  // Split off ?query / #fragment so they survive the rewrite untouched.
  const queryIndex = remainder.search(/[?#]/);
  const objectPath = queryIndex < 0 ? remainder : remainder.slice(0, queryIndex);
  const tail = queryIndex < 0 ? "" : remainder.slice(queryIndex);

  if (objectPath.length === 0) return null;
  // Already a thumb — rewriting again would produce `0_thumb_thumb.jpg`.
  if (objectPath.endsWith(PLACE_PHOTO_THUMB_SUFFIX)) return null;

  const lastSlash = objectPath.lastIndexOf("/");
  // Mirrors buildThumbPathFromObjectPath: a bare object at the bucket root has
  // no thumb sibling the writer would have produced.
  if (lastSlash < 0) return null;

  const dirPart = objectPath.slice(0, lastSlash + 1);
  const basename = objectPath.slice(lastSlash + 1);
  if (basename.length === 0) return null;

  const dotIndex = basename.lastIndexOf(".");
  const stem = dotIndex > 0 ? basename.slice(0, dotIndex) : basename;

  return `${head}${dirPart}${stem}${PLACE_PHOTO_THUMB_SUFFIX}${tail}`;
}

/**
 * What a small (thumbnail-sized) image should actually request.
 *
 * `uri` is what to try first; `fallbackUri` is what to retry with if `uri`
 * fails to load. `fallbackUri` is only present when `uri` is a derived thumb,
 * so a pass-through URL never pays for a second attempt.
 */
export interface PlacePhotoThumbSource {
  uri: string;
  fallbackUri?: string;
}

/**
 * Resolve a stored photo URL into the source a THUMBNAIL-SIZED image should
 * render. Never call this for full-screen or hero imagery — 384px is sized for
 * an 80pt box (~210px on a Samsung SM-A725F, 240px at 3x on iPhone), not for a
 * full-bleed cover.
 *
 * Returns `null` when there is no usable URL at all, so the caller can render
 * its own placeholder rather than an <Image> with an empty uri.
 */
export function resolvePlacePhotoThumbSource(
  url: string | null | undefined,
): PlacePhotoThumbSource | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (trimmed.length === 0) return null;

  const thumbUrl = getPlacePhotoThumbUrl(trimmed);
  if (thumbUrl === null) {
    // Non-Supabase host, or already a thumb: pass through untouched, and do NOT
    // arm a fallback (there is nothing to fall back to).
    return { uri: trimmed };
  }

  return { uri: thumbUrl, fallbackUri: trimmed };
}
