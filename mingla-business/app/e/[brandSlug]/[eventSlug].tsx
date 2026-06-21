/**
 * /e/{brandSlug}/{eventSlug} — public event page route.
 *
 * Resolves a LiveEvent by URL (brand-scoped slug). Renders PublicEventPage
 * with state-variant branched rendering.
 *
 * Per Cycle 6 spec §3.2.1.
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — design-intent full-bleed cover image on the public event share-link page; the X close + share buttons + clock overlap with the cover photo at the top is the intended banner-style buyer aesthetic (matches /b/ + /t/ + /checkout/* pattern). Per ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 5b operator design ruling 2026-05-17 (QA report §1) + pixel verification on iPhone 17 Pro Max sim (screenshot 17-PUBLIC-EVENT-PAGE.png).

import React, { useEffect, useRef } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

// META-ORCH-1187 LEG 2 — buyer-web public-offering view capture (web-only).
import { captureWeb } from "../../../src/analytics/webAnalytics";

import {
  spacing,
  text as textTokens,
} from "../../../src/constants/designSystem";
import { usePublicEventBySlug } from "../../../src/hooks/usePublicEvents";
import { PublicEventPage } from "../../../src/components/event/PublicEventPage";
import { PublicEventNotFound } from "../../../src/components/event/PublicEventNotFound";

export default function PublicEventRoute(): React.ReactElement {
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

  const publicEventQuery = usePublicEventBySlug(
    typeof brandSlug === "string" ? brandSlug : null,
    typeof eventSlug === "string" ? eventSlug : null,
  );

  // META-ORCH-1187 LEG 2 — fire `web_public_offering_viewed` once on mount
  // (top of the web acquisition funnel). Web-only (no-op on native).
  const viewFiredRef = useRef<boolean>(false);
  useEffect(() => {
    if (viewFiredRef.current) return;
    viewFiredRef.current = true;
    captureWeb("web_public_offering_viewed", {
      offering_type: "event",
      brand_slug: typeof brandSlug === "string" ? brandSlug : null,
      slug: typeof eventSlug === "string" ? eventSlug : null,
    });
  }, [brandSlug, eventSlug]);

  if (publicEventQuery.isLoading || publicEventQuery.isFetching) {
    return (
      <View style={styles.stateWrap}>
        <ActivityIndicator />
        <Text style={styles.stateText}>Loading event...</Text>
      </View>
    );
  }

  if (publicEventQuery.isError) {
    return (
      <View style={styles.stateWrap}>
        <Text style={styles.stateTitle}>Event could not load</Text>
        <Text style={styles.stateText}>Refresh this page or try the link again.</Text>
      </View>
    );
  }

  if (publicEventQuery.data === null || publicEventQuery.data === undefined) {
    return <PublicEventNotFound />;
  }

  return (
    <PublicEventPage
      event={publicEventQuery.data.event}
      brand={publicEventQuery.data.brand}
      bookable={publicEventQuery.data.bookable}
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
