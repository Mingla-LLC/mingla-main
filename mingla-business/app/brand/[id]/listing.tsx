/**
 * /brand/[id]/listing — ORCH-1145 thin redirect, META-ORCH-1255 venue-aware.
 *
 * KEPT (NOT deleted) because non-row navigators still target
 * `/brand/{id}/listing` and must resolve (ORCH-1145 investigation F-1):
 *   - to-do rows + home cards (`useBusinessTodos`)
 *   - push deep-links `new_review` / `claim_decision` (admin pushes now carry
 *     `?venue={venueId}` — Leg A §4.A.7)
 *   - global search (`lib/search/registry`)
 *
 * META-ORCH-1255 forwarding (DESIGN §5.6):
 *   - `?venue={venueId}` → straight to `/venue/{venueId}` (+`?focus=feedback`
 *     forwarded) — the per-venue management page.
 *   - no venue param + brand has EXACTLY ONE venue → forward to that venue's
 *     page (single-venue operators skip the one-card list).
 *   - otherwise → the Hub venue CARD LIST at "/(tabs)/hub/listing"
 *     (focus variant: "/(tabs)/hub/listing?focus=feedback").
 *
 * The redirect FIRST sets the active brand to the route's `id` (the Hub tab
 * is active-brand-scoped), THEN redirects. Do NOT re-add a brand-page row
 * here or in BrandProfileView — single doorway.
 */
// orch-strict-grep-allow safearea-on-fullscreen-routes — redirect-only route (<Redirect>/null), no visible surface
import React, { useEffect } from "react";
import { Redirect, useLocalSearchParams } from "expo-router";

import { useVenueListings } from "../../../src/hooks/useVenueListings";
import { useCurrentBrandStore } from "../../../src/store/currentBrandStore";

export default function BrandListingRedirect(): React.ReactElement | null {
  const params = useLocalSearchParams<{
    id: string | string[];
    focus?: string | string[];
    venue?: string | string[];
  }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const focusParam = Array.isArray(params.focus) ? params.focus[0] : params.focus;
  const venueParam = Array.isArray(params.venue) ? params.venue[0] : params.venue;
  const brandId =
    typeof idParam === "string" && idParam.length > 0 ? idParam : null;
  const venueId =
    typeof venueParam === "string" && venueParam.length > 0 ? venueParam : null;
  const focusSuffix = focusParam === "feedback" ? "?focus=feedback" : "";

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

  // Single-venue forwarding needs the brand's venue list (cached with the Hub
  // gate/card-list read). Only fetched when no explicit venue param arrived.
  const listingsQuery = useVenueListings(venueId === null ? brandId : null);

  if (venueId !== null) {
    return <Redirect href={`/venue/${venueId}${focusSuffix}` as never} />;
  }

  // Hold the redirect one beat while the venue list resolves so a
  // single-venue brand lands directly on its venue page (DESIGN §5.6).
  if (listingsQuery.isLoading) return null;
  const venues = listingsQuery.data ?? [];
  if (venues.length === 1) {
    return <Redirect href={`/venue/${venues[0].id}${focusSuffix}` as never} />;
  }

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
