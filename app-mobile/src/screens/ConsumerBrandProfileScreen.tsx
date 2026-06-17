import React, { useCallback } from "react";
import { ActivityIndicator, Share, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import {
  PublicBrandPage,
  type PublicBrandEvent,
  type PublicBrandExperience,
  type PublicBrandTrip,
  type PublicBrandUpcoming,
} from "@mingla/brand-rendering";

import { useBrandBySlug } from "../hooks/useBrandBySlug";

export default function ConsumerBrandProfileScreen(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ slug: string | string[] }>();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const query = useBrandBySlug(typeof slug === "string" ? slug : null);

  const handleShare = useCallback((): void => {
    if (typeof slug !== "string") return;
    void Share.share({ url: `https://business.usemingla.com/b/${slug}` });
  }, [slug]);

  if (query.isLoading || query.isFetching) {
    return (
      <View style={styles.stateWrap}>
        <ActivityIndicator />
        <Text style={styles.stateText}>Loading brand...</Text>
      </View>
    );
  }

  if (query.isError) {
    return (
      <View style={styles.stateWrap}>
        <Text style={styles.stateTitle}>Brand could not load</Text>
        <Text style={styles.stateText}>Try the link again in a moment.</Text>
      </View>
    );
  }

  if (query.data === null || query.data === undefined) {
    return (
      <View style={styles.stateWrap}>
        <Text style={styles.stateTitle}>Brand not found</Text>
        <Text style={styles.stateText}>This Mingla brand is not public.</Text>
      </View>
    );
  }

  return (
    <PublicBrandPage
      brand={query.data.brand}
      events={query.data.events}
      trips={query.data.trips}
      experiences={query.data.experiences}
      upcoming={query.data.upcoming}
      upcomingHasMore={query.data.upcomingHasMore}
      theme={query.data.resolvedTheme}
      // ORCH-1155 Known-Issue #1: feed the device safe-area top inset into the
      // shared shell's fixed chrome so the X / Share buttons clear the notch /
      // status bar on native (the shell adds its own +12 gap, giving an
      // effective insets.top + 12 — identical to ConsumerTripDetailScreen /
      // ConsumerExperienceDetailScreen native chrome). Web/business unchanged:
      // the business adapter passes its own offset; web safe-area top is 0.
      chromeTopOffset={insets.top}
      callbacks={{
        onClose: () => router.back(),
        onShare: handleShare,
        onOpenEvent: (event: PublicBrandEvent) => {
          void WebBrowser.openBrowserAsync(
            `https://business.usemingla.com/e/${event.brandSlug}/${event.eventSlug}`,
          );
        },
        onOpenTrip: (trip: PublicBrandTrip) => {
          // ORCH-1016 — open the in-app trip detail (deep-link re-export route),
          // NOT WebBrowser (the web-eject this ORCH kills).
          router.push(`/t/${trip.brandSlug}/${trip.slug}`);
        },
        onOpenExperience: (experience: PublicBrandExperience) => {
          void WebBrowser.openBrowserAsync(
            `https://business.usemingla.com/exp/${experience.brandSlug}/${experience.experienceSlug}`,
          );
        },
        onOpenUpcoming: (item: PublicBrandUpcoming) => {
          const path =
            item.offeringType === "trip"
              ? `/t/${item.brandSlug}/${item.offeringSlug}`
              : item.offeringType === "experience"
                ? `/exp/${item.brandSlug}/${item.offeringSlug}`
                : `/e/${item.brandSlug}/${item.offeringSlug}`;
          void WebBrowser.openBrowserAsync(
            `https://business.usemingla.com${path}`,
          );
        },
      }}
    />
  );
}

const styles = StyleSheet.create({
  stateWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#0c0e12",
  },
  stateTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
  },
  stateText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 14,
    textAlign: "center",
  },
});
