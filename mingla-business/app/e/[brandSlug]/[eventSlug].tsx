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
// ISSUE-865 WP-C — ad click-id capture + PageView/ViewContent pixels (web-only).
import {
  captureAdClickIds,
  captureWeb,
  fireAdPageView,
  fireAdViewContent,
} from "../../../src/analytics/webAnalytics";

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
    // ISSUE-865 WP-C — capture ad click-ids off the landing URL (first-party,
    // no PII) + fire the consent-gated PageView/ViewContent pixels (no-op until
    // consent). All web-only + fail-open; never blocks the page.
    captureAdClickIds({
      pageType: "event",
      brandSlug: typeof brandSlug === "string" ? brandSlug : null,
      entitySlug: typeof eventSlug === "string" ? eventSlug : null,
    });
    fireAdPageView();
    fireAdViewContent();
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
      terminalSource={publicEventQuery.data.terminalSource}
      // ══ issue #2209 ═══════════════════════════════════════════════════════
      // THE DAYS. `PublicEventDetail` has carried `occurrences` +
      // `multiDatePricingMode` since #2160 and this route — the ONLY production
      // mount of PublicEventPage — never passed them, so the props defaulted to
      // the empty list and "per_day" on every shared link. A guest opening a
      // two-day event saw "Date TBD / Multi-date (no dates yet)" and got no day
      // picker, because #2160 moved the occurrence read OUT of the component
      // (it used to fetch them itself, #2135) and into a prop nobody handed it.
      //
      // Threading them here is the whole client half of #2209: the eyebrow
      // renders the real days and MultiDateDayChooser mounts with something to
      // choose between. A single-date event's detail carries exactly one
      // occurrence and "per_day", which is what the props already defaulted to
      // in every way that reaches the render — that page is unchanged.
      occurrences={publicEventQuery.data.occurrences}
      multiDatePricingMode={publicEventQuery.data.multiDatePricingMode}
      onRetryOccurrences={async () => {
        const result = await publicEventQuery.refetch();
        return result.isSuccess;
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
