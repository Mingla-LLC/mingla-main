/**
 * Expo Router deep-link re-export for /e/{brandSlug}/{eventSlug} (ORCH-1138 Leg 2).
 *
 * Mirrors app/t/[brandSlug]/[tripSlug].tsx. The consumer event detail opens from
 * the Discover deck with a BusinessEventCard seed (ExpandedCardModal repoint).
 *
 * ORCH-1342 (D6) — this route now COLD-RENDERS: the prior OQ-6/ORCH-1138 cap
 * ("open from the app" for every seedless open) is SUPERSEDED. The screen
 * resolves a seed by slug via publicEventSeedService (a bounded anon read of
 * the already-public business_public_events_view — COMMS-0009-compliant, no new
 * backend), so a cold /e/ link renders the full event page incl. the RSVP
 * branch; unknown/private slugs keep the graceful cap as the terminal state.
 *
 * ORCH-1342 — `?landing=guest-list` (the OneLink deferred-funnel landing,
 * composed ONLY by dispatchOneLinkDestination) is validated by EXACT match and
 * passed to the screen, which auto-opens the ORCH-1341 guest-list sheet after
 * the page settles (SPEC §4.8). Any other value → undefined (ignored).
 *
 * app-mobile is buyer-first / anon-tolerant: there is NO root auth gate blocking
 * /e/ (the PUBLIC_BUYER_ROUTE_PREFIXES allowlist is a mingla-business concern).
 */

import React from "react";
import { useLocalSearchParams, useRouter } from "expo-router";

import ConsumerEventDetailScreen from "../../../src/screens/Event/ConsumerEventDetailScreen";

export default function EventDeepLinkScreen(): React.ReactElement | null {
  const router = useRouter();
  const params = useLocalSearchParams<{
    brandSlug: string | string[];
    eventSlug: string | string[];
    landing?: string | string[];
  }>();
  const brandSlug = Array.isArray(params.brandSlug)
    ? params.brandSlug[0]
    : params.brandSlug;
  const eventSlug = Array.isArray(params.eventSlug)
    ? params.eventSlug[0]
    : params.eventSlug;
  // ORCH-1342 — normalize array→first, EXACT-match validate (SPEC §4.6).
  const landingRaw = Array.isArray(params.landing)
    ? params.landing[0]
    : params.landing;
  const landing = landingRaw === "guest-list" ? ("guest-list" as const) : undefined;

  if (typeof brandSlug !== "string" || typeof eventSlug !== "string") {
    return null;
  }

  return (
    <ConsumerEventDetailScreen
      brandSlug={brandSlug}
      eventSlug={eventSlug}
      seed={null}
      landing={landing}
      tabBarAware={false}
      onBack={() => {
        if (router.canGoBack()) router.back();
        else router.replace("/");
      }}
    />
  );
}
