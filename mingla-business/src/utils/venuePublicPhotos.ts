/**
 * Ve4 — photo cascade for public verified venue pages.
 * Operator cover + profile first; fall back to place_pool URLs when absent.
 *
 * #1560 [consumer-adopts-shared] — the implementation MOVED to
 * `packages/brand-rendering/venuePublicPhotos.ts` so the consumer app resolves
 * the same gallery this app does (a package may be imported by both; this
 * app's `src/` may not). This file is now a thin re-export: every existing
 * import path and `__tests__/venuePublicPhotos.test.ts` are untouched.
 */
export {
  buildVenueGalleryPhotoUrls,
  type VenueGalleryPhotoInput,
} from "@mingla/brand-rendering/venuePublicPhotos";
