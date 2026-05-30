/**
 * Expo Router deep-link re-export for /t/{brandSlug}/{tripSlug} (ORCH-1016).
 *
 * Mirrors app/b/[slug].tsx. Cold-open path: no seed → ConsumerTripDetailScreen's
 * useConsumerTripDetail fetches the trip by slug (via the anon RPC + anon-direct
 * trip_* reads). onBack routes back.
 */

import React from "react";
import { useLocalSearchParams, useRouter } from "expo-router";

import ConsumerTripDetailScreen from "../../../src/screens/Trip/ConsumerTripDetailScreen";

export default function TripDeepLinkScreen(): React.ReactElement | null {
  const router = useRouter();
  const params = useLocalSearchParams<{
    brandSlug: string | string[];
    tripSlug: string | string[];
  }>();
  const brandSlug = Array.isArray(params.brandSlug) ? params.brandSlug[0] : params.brandSlug;
  const tripSlug = Array.isArray(params.tripSlug) ? params.tripSlug[0] : params.tripSlug;

  if (typeof brandSlug !== "string" || typeof tripSlug !== "string") {
    return null;
  }

  return (
    <ConsumerTripDetailScreen
      brandSlug={brandSlug}
      tripSlug={tripSlug}
      seed={null}
      onBack={() => {
        if (router.canGoBack()) router.back();
        else router.replace("/");
      }}
    />
  );
}
