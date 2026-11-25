/**
 * `PublicVenue` (this app's read model) → the shared screen's view model.
 *
 * ONE owner for the public venue page (`/b/{brand}/v/{venue}`) and the Host's
 * preview of it (`/venue/{id}/preview`), so the two can never disagree about
 * what a venue looks like. Pure; no data layer, no auth.
 */
import type { PublicVenueViewModel } from "@mingla/brand-rendering/PublicVenueScreen";

import type { PublicVenue } from "../../services/publicEventsService";

export const toVenueViewModel = (venue: PublicVenue): PublicVenueViewModel => ({
  id: venue.id,
  brandId: venue.brandId,
  brandSlug: venue.brandSlug,
  brandName: venue.brandName,
  slug: venue.slug,
  name: venue.name,
  address: venue.address,
  city: venue.city,
  lat: venue.lat,
  lng: venue.lng,
  venueCategory: venue.venueCategory,
  coverMediaUrl: venue.coverMediaUrl,
  coverMediaType: venue.coverMediaType,
  theme: venue.theme,
  hours: venue.hours,
  // issue #1562 — the venue's OWN clock, so "open now" is resolved where the
  // venue is rather than where the visitor happens to be standing.
  timezone: venue.timezone,
  galleryPhotoUrls: venue.galleryPhotoUrls,
  pitch: venue.pitch,
  // #4334 — the Google Maps link opens the named place.
  googlePlaceId: venue.googlePlaceId ?? null,
});
