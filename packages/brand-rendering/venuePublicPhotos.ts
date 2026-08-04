/**
 * The public venue photo cascade — ONE owner, both apps.
 *
 * #1560 [consumer-adopts-shared], step 4 of #1550. Moved here VERBATIM from
 * `mingla-business/src/utils/venuePublicPhotos.ts` (which is now a thin
 * re-export, so every existing business import and its unit test are unchanged).
 *
 * WHY IT MOVED. `PublicVenueScreen` renders `venue.galleryPhotoUrls` and each
 * host adapts its own read model into that field. Business ran this cascade;
 * the consumer app took `pool_photo_urls ?? []` raw and then `.slice(0, 4)`d it.
 * Two surfaces, two answers to "which photographs is this venue publishing?".
 * Leaving the builder inside `mingla-business/src` would have forced the
 * consumer to either re-implement it (the 14th accidental divergence, in the
 * step whose whole purpose is deleting divergence) or import across the app
 * boundary, which I-MOR-0827-PACKAGE-ISOLATION forbids. It is pure, has no
 * React and no platform surface, so the package is where it belongs.
 *
 * Behaviour is UNCHANGED, deliberately: operator cover + profile first, and
 * ONLY when neither exists does the place-pool set stand in. The early return
 * at `if (urls.length > 0)` is the documented Ve4 cascade, not a bug — see
 * #1550 SPEC Step 2 for the separate question of whether a venue with a cover
 * should ALSO publish its pool photographs. That is not this step's call to
 * make: changing it here would silently change the buyer-web page too.
 */

export interface VenueGalleryPhotoInput {
  coverMediaUrl?: string | null;
  profilePhotoUrl?: string | null;
  poolPhotoUrls?: string[] | null;
}

const isUsableUrl = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

/** Deduped gallery URLs in display priority order. */
export const buildVenueGalleryPhotoUrls = (
  input: VenueGalleryPhotoInput,
): string[] => {
  const urls: string[] = [];
  const push = (value: string | null | undefined): void => {
    if (!isUsableUrl(value)) return;
    const trimmed = value.trim();
    if (!urls.includes(trimmed)) urls.push(trimmed);
  };

  push(input.coverMediaUrl);
  push(input.profilePhotoUrl);
  if (urls.length > 0) return urls;

  for (const poolUrl of input.poolPhotoUrls ?? []) {
    push(poolUrl);
  }
  return urls;
};
