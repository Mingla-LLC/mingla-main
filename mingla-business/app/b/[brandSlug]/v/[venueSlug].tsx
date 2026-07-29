/**
 * /b/{brandSlug}/v/{venueSlug} — META-ORCH-1255(C) per-venue PUBLIC page (D-2).
 *
 * House nested-slug pattern of app/e/[brandSlug]/[eventSlug].tsx and
 * app/b/[brandSlug]/index.tsx: params → query → loading / error / not-found /
 * page. Renders PublicVenuePage (DESIGN §6).
 *
 * ANON ROUTE — lives under the `/b/` PUBLIC_BUYER_ROUTE_PREFIXES allowlist
 * (segment-safe prefix match covers /b/{slug}/v/{slug}), so the root-layout
 * unauthenticated redirect never fires here. NEVER call useAuth from this
 * chain (I-anon-buyer-routes). Data flows ONLY through venue_public_view
 * (definer, verified-only): a pending/suspended/unknown venue is one
 * indistinguishable not-found state (no state leak).
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — anon public route; PublicVenuePage/PublicVenueNotFound apply insets.top; state views center-anchored
import React, { useEffect, useRef } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import {
  spacing,
  text as textTokens,
} from "../../../../src/constants/designSystem";
// META-ORCH-1187 LEG 2 — buyer-web public-offering view capture (web-only).
import { captureWeb } from "../../../../src/analytics/webAnalytics";
import {
  usePublicBrandBySlug,
  usePublicVenueBySlug,
  usePublicVenueReservable,
} from "../../../../src/hooks/usePublicEvents";
import { usePublicMenus } from "../../../../src/hooks/useMenus";
import { PublicVenuePage } from "../../../../src/components/venue/PublicVenuePage";
import { PublicVenueNotFound } from "../../../../src/components/venue/PublicVenueNotFound";

export default function PublicVenueRoute(): React.ReactElement {
  const params = useLocalSearchParams<{
    brandSlug: string | string[];
    venueSlug: string | string[];
    tab?: string | string[];
  }>();
  const brandSlug = Array.isArray(params.brandSlug)
    ? params.brandSlug[0]
    : params.brandSlug;
  const venueSlug = Array.isArray(params.venueSlug)
    ? params.venueSlug[0]
    : params.venueSlug;
  const requestedTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;

  const venueQuery = usePublicVenueBySlug(
    typeof brandSlug === "string" ? brandSlug : null,
    typeof venueSlug === "string" ? venueSlug : null,
  );
  const venue = venueQuery.data ?? null;

  // Exact venue-owned menu — fetched only once the venue resolves (a
  // not-found page needs no menu round-trip).
  const menusQuery = usePublicMenus(
    venue !== null && typeof brandSlug === "string" ? brandSlug : null,
    venue !== null && typeof venueSlug === "string" ? venueSlug : null,
  );

  // §6.7 reserve display gate — place-keyed, anon-safe. Disabled without a
  // linked place; error → not reservable (fail closed, no dead CTA).
  const reservableQuery = usePublicVenueReservable(venue?.placePoolId ?? null);

  // §6.8 — the secondary "See {brand} →" link renders only when the PARENT
  // brand resolves publicly. Fetched ONLY on the not-found path.
  const venueMissing =
    !venueQuery.isLoading && !venueQuery.isError && venue === null;
  const brandProbeQuery = usePublicBrandBySlug(
    venueMissing && typeof brandSlug === "string" ? brandSlug : null,
  );

  // META-ORCH-1187 LEG 2 — fire `web_public_offering_viewed` once on mount.
  // Web-only (no-op on native).
  const viewFiredRef = useRef<boolean>(false);
  useEffect(() => {
    if (viewFiredRef.current) return;
    viewFiredRef.current = true;
    captureWeb("web_public_offering_viewed", {
      offering_type: "venue",
      brand_slug: typeof brandSlug === "string" ? brandSlug : null,
      venue_slug: typeof venueSlug === "string" ? venueSlug : null,
      slug: typeof venueSlug === "string" ? venueSlug : null,
    });
  }, [brandSlug, venueSlug]);

  if (venueQuery.isLoading || venueQuery.isFetching) {
    return (
      <View style={styles.stateWrap}>
        <ActivityIndicator />
        <Text style={styles.stateText}>Loading venue...</Text>
      </View>
    );
  }

  if (venueQuery.isError) {
    return (
      <View style={styles.stateWrap}>
        <Text style={styles.stateTitle}>This venue could not load</Text>
        <Text style={styles.stateText}>
          Refresh this page or try the link again.
        </Text>
      </View>
    );
  }

  if (venue === null) {
    return (
      <PublicVenueNotFound
        brandSlug={typeof brandSlug === "string" ? brandSlug : null}
        brandDisplayName={brandProbeQuery.data?.brand.displayName ?? null}
      />
    );
  }

  return (
    <PublicVenuePage
      venue={venue}
      menu={menusQuery.data ?? []}
      reservable={reservableQuery.data ?? null}
      reservabilityState={
        reservableQuery.isError
          ? "error"
          : reservableQuery.isLoading
            ? "loading"
            : "ready"
      }
      initialTab={requestedTab === "reservations" ? "reservations" : "overview"}
      onRetryReservability={() => {
        void reservableQuery.refetch();
      }}
    />
  );
}

const styles = StyleSheet.create({
  stateWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    backgroundColor: "#0c0e12",
  },
  stateTitle: {
    color: textTokens.primary,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: spacing.xs,
  },
  stateText: {
    color: textTokens.secondary,
    fontSize: 14,
    textAlign: "center",
  },
});
