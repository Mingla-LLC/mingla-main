// #4137 wave 2 — the ONE place the marketing site derives a stored place photo.
//
// Seth, 27 Oct 2026 (issue #4137): city place cards show each place's photo
// from Mingla's stored place pool, with no credit or attribution label, no live
// Google fetch and no Google key. Spend-cap hold #1643: only the pre-generated
// `<placeId>/<n>_thumb.jpg` objects, served by the non-metered public object
// endpoint, never the billed image-transformation endpoint and never the
// full-size originals.
//
// The naming mirrors supabase/functions/backfill-place-photo-thumbs and
// app-mobile/src/utils/placePhotoThumb.ts: the thumb of `<dir>/<stem>.<ext>` is
// `<dir>/<stem>_thumb.jpg`. Every listed city place had `0_thumb.jpg` on
// 27 Oct 2026 (500/500 HTTP 200), but coverage is not guaranteed forever, so
// the card keeps a category tile as the fallback when the image fails.

const PLACE_PHOTOS = 'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/'
const GOOGLE_PLACE_ID = /^[A-Za-z0-9_-]{8,256}$/

/** The stored 384px thumbnail of a place's first photo, or null for an unusable id. */
export function storedPlaceThumbSrc(googlePlaceId: string): string | null {
  if (!GOOGLE_PLACE_ID.test(googlePlaceId)) return null
  return `${PLACE_PHOTOS}${googlePlaceId}/0_thumb.jpg`
}

/** The `_thumb.jpg` sibling of a stored place-photo URL; null for anything else. */
export function storedThumbFromPhotoUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || !url.startsWith(PLACE_PHOTOS)) return null
  const objectPath = url.slice(PLACE_PHOTOS.length).split(/[?#]/)[0]
  const slash = objectPath.lastIndexOf('/')
  if (slash <= 0) return null
  const basename = objectPath.slice(slash + 1)
  if (!basename || basename.endsWith('_thumb.jpg')) return null
  const dot = basename.lastIndexOf('.')
  const stem = dot > 0 ? basename.slice(0, dot) : basename
  return `${PLACE_PHOTOS}${objectPath.slice(0, slash + 1)}${stem}_thumb.jpg`
}
