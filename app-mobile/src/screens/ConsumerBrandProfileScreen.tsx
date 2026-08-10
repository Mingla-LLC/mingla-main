import React, { useCallback } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import {
  PublicBrandPage,
  type PublicBrandEvent,
  type PublicBrandExperience,
  type PublicBrandTrip,
  type PublicBrandUpcoming,
  type PublicBrandVenueSummary,
} from "@mingla/brand-rendering";

import { useBrandBySlug, usePublicBrandVenues } from "../hooks/useBrandBySlug";
import { useBrandFollow } from "../hooks/useBrandFollow";
import { useAppStore } from "../store/appStore";
import { postHogService } from "../services/postHogService";
import { shareContent } from "../services/contentShareAdapter";
import { toastManager } from "../components/ui/Toast";
import { ToastContainer } from "../components/ui/ToastContainer";
import { HapticFeedback } from "../utils/hapticFeedback";

export default function ConsumerBrandProfileScreen(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ slug: string | string[] }>();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const publicSlug = typeof slug === "string" ? slug : null;
  const query = useBrandBySlug(publicSlug);
  const venuesQuery = usePublicBrandVenues(publicSlug);
  // Issue #679 — Follow. Auth precedent: ConsumerTripDetailScreen.tsx.
  const user = useAppStore((s) => s.user);
  const brandFollow = useBrandFollow(
    user?.id ?? null,
    query.data?.brand?.id ?? null,
  );

  const handleShare = useCallback((): void => {
    if (typeof slug !== "string") return;
    void shareContent("brand", { brandSlug: slug });
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

  const detail = query.data;

  const handleToggleFollow = (): void => {
    if (!user?.id) {
      // Anon gate — mirrors AppHandlers.tsx "Sign in to save" (spec §4/§5).
      // No mutation, no analytics event.
      Alert.alert(
        "Sign in to follow",
        "Create an account or sign in to follow brands.",
      );
      return;
    }
    brandFollow
      .toggle()
      .then((nowFollowing) => {
        if (nowFollowing) {
          // Light haptic + the reachability toast on FOLLOW success only;
          // unfollow success is silent (the flipped button is the feedback).
          HapticFeedback.light();
          toastManager.show(
            `Following ${detail.brand.displayName} — they can reach you about what's coming up.`,
            "success",
          );
        }
        // Analytics on mutation SUCCESS only (server truth, never optimistic).
        postHogService.capture(
          nowFollowing ? "brand_followed" : "brand_unfollowed",
          {
            surface: "consumer_native",
            brand_id: detail.brand.id,
            brand_slug: detail.brand.slug,
            source: "brand_page",
          },
        );
      })
      .catch(() => {
        toastManager.show("Couldn't update. Try again.", "error");
      });
  };

  return (
    <View style={styles.screenWrap}>
      <PublicBrandPage
        brand={detail.brand}
        events={detail.events}
        trips={detail.trips}
        experiences={detail.experiences}
        upcoming={detail.upcoming}
        upcomingHasMore={detail.upcomingHasMore}
        menu={detail.menu}
        isFollowing={brandFollow.isFollowing}
        followPending={brandFollow.isPending}
        venues={venuesQuery.data ?? []}
        venuesLoadState={
          venuesQuery.isLoading || venuesQuery.isFetching
            ? "loading"
            : venuesQuery.isError
              ? "error"
              : "ready"
        }
        theme={detail.resolvedTheme}
        // ORCH-1155 Known-Issue #1: feed the device safe-area top inset into the
        // shared shell's fixed chrome so the X / Share buttons clear the notch /
        // status bar on native (the shell adds its own +12 gap, giving an
        // effective insets.top + 12 — identical to ConsumerTripDetailScreen /
        // ConsumerExperienceDetailScreen native chrome). Web/business unchanged:
        // the business adapter passes its own offset; web safe-area top is 0.
        chromeTopOffset={insets.top}
        contentBottomInset={insets.bottom + 24}
        callbacks={{
          onClose: () => router.back(),
          onShare: handleShare,
          onToggleFollow: handleToggleFollow,
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
          onReservationsTabViewed: () => {
            postHogService.capture("brand_reservations_tab_viewed", {
              surface: "consumer_native",
              brand_id: detail.brand.id,
              venue_count: venuesQuery.data?.length ?? 0,
            });
          },
          onRetryVenues: () => {
            venuesQuery.refetch();
          },
          onOpenVenue: (venue: PublicBrandVenueSummary) => {
            postHogService.capture("brand_venue_selected", {
              surface: "consumer_native",
              brand_id: detail.brand.id,
              venue_id: venue.id,
              reservable_state: venue.reservationState ?? "error",
              source_tab: "reservations",
            });
            router.push(
              `/b/${detail.brand.slug}/v/${venue.slug}${
                venue.reservationState === "available"
                  ? "?tab=reservations"
                  : ""
              }`,
            );
          },
        }}
      />
      {/* Issue #679 — self-mounted toast overlay. The app's only container is
          mounted in the Home route (app/index.tsx), which is NOT mounted on a
          cold /b/ deep link (investigation D-2). Warm-nav double-mount is
          benign: identical absolute-positioned overlay. */}
      <ToastContainer />
    </View>
  );
}

const styles = StyleSheet.create({
  screenWrap: {
    flex: 1,
  },
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
