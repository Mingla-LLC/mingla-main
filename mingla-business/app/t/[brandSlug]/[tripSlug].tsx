/**
 * /t/[brandSlug]/[tripSlug] — public buyer-anon trip detail route.
 * Tr2 (ORCH-0859). ORCH-0874 [Trip surfaces visual parity with Events]
 * adds the X-close + share IconChrome overlays mirroring the public event
 * page hero pattern. Per SPEC §4.5 + SPEC_ORCH-0874 §3.3.7.
 *
 * Anon-tolerant per feedback_anon_buyer_routes.md: no useAuth, no
 * sign-in redirect. Anyone with the share link sees this page.
 *
 * Renders TripPreview (full trip detail) + TripCheckoutFlow (Reserve CTA +
 * tier picker that routes to the existing /checkout/{tripEventId} chain).
 *
 * Lives OUTSIDE app/(tabs)/ — same as /e/, /b/, /checkout/.
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — design-intent full-bleed cover on the public trip share-link page (mirrors /e/{brandSlug}/{eventSlug}); the buyer-facing banner aesthetic is intentional. TripPreview renders the cover full-bleed to the screen edge by design; status-bar overlap is the chosen look. Per ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 5b operator design ruling 2026-05-17 (QA report §1, pattern parity with screenshot 17-PUBLIC-EVENT-PAGE.png). ORCH-0874 preserves this; X-close + share overlays absolute-position over the cover but do not introduce SafeScreen wrapping.

import React, { useCallback } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import { IconChrome } from "../../../src/components/ui/IconChrome";
import { usePublicTripBySlug } from "../../../src/hooks/usePublicTripBySlug";
import { TripPreview } from "../../../src/components/trip/TripPreview";
import { TripCheckoutFlow } from "../../../src/components/trip/TripCheckoutFlow";

export default function PublicTripRoute(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    brandSlug: string | string[];
    tripSlug: string | string[];
  }>();
  const brandSlug = Array.isArray(params.brandSlug)
    ? params.brandSlug[0]
    : params.brandSlug;
  const tripSlug = Array.isArray(params.tripSlug)
    ? params.tripSlug[0]
    : params.tripSlug;

  const query = usePublicTripBySlug(
    typeof brandSlug === "string" ? brandSlug : null,
    typeof tripSlug === "string" ? tripSlug : null,
  );

  // ORCH-0874: X-close → router.back() if possible, otherwise navigate to
  // the brand page as a fallback (mirror public event page UX).
  const handleClose = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (typeof brandSlug === "string" && brandSlug.length > 0) {
      router.replace(`/b/${brandSlug}` as never);
    } else {
      router.replace("/" as never);
    }
  }, [router, brandSlug]);

  // ORCH-0874: share → native share sheet with the public trip URL.
  const handleShare = useCallback(async (): Promise<void> => {
    if (typeof brandSlug !== "string" || typeof tripSlug !== "string") return;
    const url = `https://business.usemingla.com/t/${brandSlug}/${tripSlug}`;
    const title = query.data?.trip.title ?? "Mingla trip";
    try {
      await Share.share(
        Platform.OS === "ios"
          ? { url, message: title }
          : { message: `${title} ${url}`, title },
      );
    } catch {
      // Native Share rejection (user cancels) is non-actionable;
      // do not surface a toast. Constitution #3 exempts user-cancelled flows.
    }
  }, [brandSlug, tripSlug, query.data?.trip.title]);

  if (query.isLoading || query.isFetching) {
    return (
      <View style={styles.stateHost}>
        <ActivityIndicator />
        <Text style={styles.stateText}>Loading trip…</Text>
      </View>
    );
  }

  if (query.isError) {
    return (
      <View style={styles.stateHost}>
        <Text style={styles.stateTitle}>Couldn&rsquo;t load trip</Text>
        <Text style={styles.stateText}>
          {query.error instanceof Error
            ? query.error.message
            : "Check your connection and try again."}
        </Text>
      </View>
    );
  }

  const payload = query.data;
  if (payload === null || payload === undefined) {
    return (
      <View style={styles.stateHost}>
        <Text style={styles.stateTitle}>Trip not found</Text>
        <Text style={styles.stateText}>
          This trip may not be live yet, or the link is wrong.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.host}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <TripPreview
          trip={payload.trip}
          brand={payload.brand}
          showCta={false}
        />
        <TripCheckoutFlow trip={payload.trip} brand={payload.brand} />
      </ScrollView>

      {/* ORCH-0874: X-close + share IconChrome overlays on the cover hero.
          Absolute-positioned siblings of the ScrollView so they sit on top
          of the cover. Top inset + spacing.sm clears the status bar but
          sits on the gradient overlay region of the cover. */}
      <View
        style={[styles.closeOverlay, { top: insets.top + spacing.sm }]}
        pointerEvents="box-none"
      >
        <IconChrome
          icon="close"
          size={36}
          onPress={handleClose}
          accessibilityLabel="Close"
        />
      </View>
      <View
        style={[styles.shareOverlay, { top: insets.top + spacing.sm }]}
        pointerEvents="box-none"
      >
        <IconChrome
          icon="share"
          size={36}
          onPress={() => {
            void handleShare();
          }}
          accessibilityLabel="Share"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: "#0c0e12",
    position: "relative",
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  closeOverlay: {
    position: "absolute",
    left: spacing.sm,
    zIndex: 50,
  },
  shareOverlay: {
    position: "absolute",
    right: spacing.sm,
    zIndex: 50,
  },
  stateHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
    backgroundColor: "#0c0e12",
  },
  stateTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
    textAlign: "center",
  },
  stateText: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
    textAlign: "center",
  },
});
