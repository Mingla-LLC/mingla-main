/**
 * (tabs)/hub/listing — ORCH-1145 venue tab → META-ORCH-1255 venue CARD LIST.
 *
 * Phase 1 (ORCH-1145) relocated the venue-listing surface into a conditional
 * "Venue" Hub pill; META-ORCH-1148 mounted the venue suite (VenueSuiteShell)
 * here. META-ORCH-1255 makes venues FIRST-CLASS rows: this tab is now the
 * brand's venue CARD LIST (one card per `venue_listings` row), and the suite
 * (VenueSuiteShell + its modules) moved to the pushed per-venue page
 * `/venue/{venueId}` — card tap opens it scoped to THAT venue.
 *
 * `venueSuiteStore.activate()` moved to the per-venue page too (LOCKED
 * DECISION 5 consequence, DESIGN §5.4a): while the CARD LIST shows, the Hub
 * offering pills stay visible — the module pill row belongs to the suite, not
 * the list.
 *
 * The deep-link `?focus=feedback` arrives via the kept route alias
 * (`/brand/{id}/listing?focus=feedback`); the alias itself forwards venue-
 * scoped links straight to `/venue/{venueId}?focus=…` — anything landing HERE
 * is brand-scoped and gets the list.
 *
 * Visibility of the Venue pill is gated upstream in `deriveHubVisibleTabs` on
 * venueCount > 0 (META-ORCH-1255; replaced hasPhysicalLocation || placePool).
 */
import React from "react";

import { VenueCardList } from "../../../src/components/venue/VenueCardList";
import { useCurrentBrand } from "../../../src/hooks/useCurrentBrand";

export default function HubVenueListingTab(): React.ReactElement {
  const brand = useCurrentBrand();
  const brandId = brand?.id ?? null;

  return <VenueCardList brandId={brandId} />;
}
