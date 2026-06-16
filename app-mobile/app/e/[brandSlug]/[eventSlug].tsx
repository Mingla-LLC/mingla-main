/**
 * Expo Router deep-link re-export for /e/{brandSlug}/{eventSlug} (ORCH-1138 Leg 2).
 *
 * Mirrors app/t/[brandSlug]/[tripSlug].tsx. The consumer event detail opens from
 * the Discover deck with a BusinessEventCard seed (ExpandedCardModal repoint); this
 * cold-open route has NO seed. Per OQ-6 (orchestrator-approved degradation), an
 * anon event-by-slug consumer fetch is outside the §11 allowlist, so the screen
 * renders a graceful "open from the app" state for the seedless cold path rather
 * than adding backend scope. onBack routes back.
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
  }>();
  const brandSlug = Array.isArray(params.brandSlug)
    ? params.brandSlug[0]
    : params.brandSlug;
  const eventSlug = Array.isArray(params.eventSlug)
    ? params.eventSlug[0]
    : params.eventSlug;

  if (typeof brandSlug !== "string" || typeof eventSlug !== "string") {
    return null;
  }

  return (
    <ConsumerEventDetailScreen
      brandSlug={brandSlug}
      eventSlug={eventSlug}
      seed={null}
      tabBarAware={false}
      onBack={() => {
        if (router.canGoBack()) router.back();
        else router.replace("/");
      }}
    />
  );
}
