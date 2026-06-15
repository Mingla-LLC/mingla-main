/**
 * (tabs)/hub/listing — ORCH-1145 venue-listing Hub tab (content-only).
 *
 * The venue-listing management surface, relocated from a row on the founder
 * Brand profile page into a conditionally-visible "Venue" pill inside the Hub
 * (peer alongside Events / Experiences / Trips). Visibility is gated upstream in
 * `deriveHubVisibleTabs` on `hasPhysicalLocation || placePoolId` (see
 * `useHubTabs.ts` + `_layout.tsx`); this file only renders when the pill shows.
 *
 * Chrome (TopBar + To-Do toggle + HubSubNav) is owned by `hub/_layout.tsx`, so
 * this is a content-only screen with NO header/back of its own — it delegates
 * to the shared `VenueListingContent chromeMode="tab"`.
 *
 * The active brand is resolved via `useCurrentBrand()` — NO route param — so
 * switching brands and re-opening the tab shows the new brand's listing.
 */
import React from "react";
import { useLocalSearchParams } from "expo-router";

import { VenueListingContent } from "../../../src/components/venue/VenueListingContent";
import { useCurrentBrand } from "../../../src/hooks/useCurrentBrand";

export default function HubVenueListingTab(): React.ReactElement {
  const brand = useCurrentBrand();
  const brandId = brand?.id ?? null;

  // The deep-link `?focus=feedback` arrives here when the kept route alias
  // (`/brand/{id}/listing?focus=feedback`) redirects in, forwarding the param.
  // Direct pill taps carry no query param.
  const params = useLocalSearchParams<{ focus?: string | string[] }>();
  const focusParam = Array.isArray(params.focus) ? params.focus[0] : params.focus;
  const focus = focusParam === "feedback" ? "feedback" : undefined;

  return (
    <VenueListingContent brandId={brandId} focus={focus} chromeMode="tab" />
  );
}
