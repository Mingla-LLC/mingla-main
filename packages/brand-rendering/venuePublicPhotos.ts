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
 * #1561 [first-screen-rebuild], step 5 of #1550 — THE EARLY RETURN IS DELETED.
 *
 * What it did. `push(cover); push(profile); if (urls.length > 0) return urls;`
 * — so ANY venue with a cover returned a ONE-item list containing the cover and
 * nothing else, and `pool_photo_urls` (the operator's actual uploaded
 * photographs, already fetched by `venue_public_view`) was read only by venues
 * that had no cover at all. #1550 Leg C measured the consequence on live
 * production: a `PHOTOS` heading — plural — over a single 240x180 tile that was
 * a shrunken duplicate of the hero, at every width from 360 to 2560, with the
 * page ending underneath it.
 *
 * It was never a cascade in the sense the old comment claimed. A cascade picks
 * ONE source; this list is a GALLERY, and a gallery that stops at its first
 * item is not a fallback policy, it is a truncation. The cover is the FIRST
 * photograph, not the ONLY one — which is exactly how every sibling page
 * (`ExperiencePreview`, `TripPreview`, the two Foundation previews) already
 * feeds `ParallaxCoverShell.galleryImages`.
 *
 * Order is the contract, and it is the operator's: their chosen cover first,
 * then their profile photo, then the place-pool set in its stored order.
 * Duplicates collapse (`push` is set-like), so a cover that is also the first
 * pool photo appears once — the de-duplication that #1550's design names as
 * "the actual bug behind the bottom strip".
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
  // #1561 — NO early return here. The operator's pool photographs are part of
  // the same gallery, not a fallback for the cover's absence.
  for (const poolUrl of input.poolPhotoUrls ?? []) {
    push(poolUrl);
  }
  return urls;
};
