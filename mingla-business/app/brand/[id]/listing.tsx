/**
 * /brand/[id]/listing — ORCH-1145 thin redirect to the Hub "Venue" tab.
 *
 * The venue-listing management UI MOVED to a conditional "Venue" pill in the Hub
 * (`app/(tabs)/hub/listing.tsx`, rendering the shared `VenueListingContent`).
 * The brand-page entry ROW was removed (single doorway).
 *
 * This route is KEPT (NOT deleted) because four non-row navigators still target
 * `/brand/{id}/listing` and must resolve (ORCH-1145 investigation F-1):
 *   - to-do rows + home cards (`useBusinessTodos`)
 *   - push deep-links `new_review` / `claim_decision` (`businessNotificationRouting`)
 *   - global search (`lib/search/registry`)
 *
 * The Hub tab is active-brand-scoped (no id param), so this redirect FIRST sets
 * the active brand to the route's `id`, THEN redirects to `/(tabs)/hub/listing`,
 * forwarding `?focus=feedback` so the to-do `venueFeedbackRoute` still auto-opens
 * the feedback sheet inside the tab.
 *
 * Do NOT re-add a brand-page row here or in BrandProfileView — single doorway.
 */
import React, { useEffect } from "react";
import { Redirect, useLocalSearchParams } from "expo-router";

import { useCurrentBrandStore } from "../../../src/store/currentBrandStore";

export default function BrandListingRedirect(): React.ReactElement {
  const params = useLocalSearchParams<{
    id: string | string[];
    focus?: string | string[];
  }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const focusParam = Array.isArray(params.focus) ? params.focus[0] : params.focus;
  const brandId =
    typeof idParam === "string" && idParam.length > 0 ? idParam : null;

  const currentBrandId = useCurrentBrandStore((s) => s.currentBrandId);
  const setCurrentBrandId = useCurrentBrandStore((s) => s.setCurrentBrandId);

  // Point the active brand at the deep-linked id BEFORE the tab reads it via
  // useCurrentBrand(). Guard against a redirect/set loop: only set when it
  // actually differs. An invalid id is auto-cleared by useCurrentBrand's
  // recovery path (ORCH-1145 investigation F-4), so this is safe.
  useEffect(() => {
    if (brandId !== null && brandId !== currentBrandId) {
      setCurrentBrandId(brandId);
    }
  }, [brandId, currentBrandId, setCurrentBrandId]);

  return (
    <Redirect
      href={
        focusParam === "feedback"
          ? "/(tabs)/hub/listing?focus=feedback"
          : "/(tabs)/hub/listing"
      }
    />
  );
}
