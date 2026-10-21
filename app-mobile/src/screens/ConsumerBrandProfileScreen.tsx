import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  PublicBrandPage,
  type PublicBrandEvent,
  type PublicBrandExperience,
  type PublicBrandTrip,
  type PublicBrandUpcoming,
  type PublicBrandVenueSummary,
} from "@mingla/brand-rendering";

import {
  useBrandBySlug,
  usePublicBrandVenues,
} from "../hooks/useBrandBySlug";
import { brandFollowKeys, useBrandFollow } from "../hooks/useBrandFollow";
import { useQueryClient } from "@tanstack/react-query";
import {
  useBrandHappeningNow,
  useBrandPast,
} from "../hooks/useBrandOfferingSections";
import { useAppStore } from "../store/appStore";
import { postHogService } from "../services/postHogService";
import { shareContent } from "../services/contentShareAdapter";
import { toastManager } from "../components/ui/Toast";
import { ToastContainer } from "../components/ui/ToastContainer";
import { HapticFeedback } from "../utils/hapticFeedback";
import { BrandFollowOverflowSheet } from "../components/profile/BrandFollowOverflowSheet";
import { BrandsYouFollowManageSheet } from "../components/profile/BrandsYouFollowManageSheet";
import type { BrandFollowRow } from "../services/brandFollowsService";
import { resolveExplorerPublicPath } from "../services/publicParityNativeAdapter";

export default function ConsumerBrandProfileScreen(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ slug: string | string[] }>();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const publicSlug = typeof slug === "string" ? slug : null;
  const query = useBrandBySlug(publicSlug);
  const venuesQuery = usePublicBrandVenues(publicSlug);
  // #3426 — the date-decided Happening now block and Past tab (parity with Host
  // web: the same RPC, the same shapes).
  const happeningNowQuery = useBrandHappeningNow(publicSlug);
  const pastFeed = useBrandPast(publicSlug);
  // Issue #679 — Follow. Auth precedent: ConsumerTripDetailScreen.tsx.
  const user = useAppStore((s) => s.user);
  const brandFollow = useBrandFollow(
    user?.id ?? null,
    query.data?.brand?.id ?? null,
  );
  const queryClient = useQueryClient();
  const [followingMenuOpen, setFollowingMenuOpen] = useState(false);
  const [manageChannelsOpen, setManageChannelsOpen] = useState(false);
  const invalidateFollow = useCallback(() => {
    const uid = user?.id;
    const bid = query.data?.brand?.id;
    if (uid && bid) {
      void queryClient.invalidateQueries({
        queryKey: brandFollowKeys.status(bid, uid),
      });
      void queryClient.invalidateQueries({
        queryKey: brandFollowKeys.list(uid),
      });
    }
  }, [query.data?.brand?.id, queryClient, user?.id]);

  const handleShare = useCallback((): void => {
    if (typeof slug !== "string") return;
    void shareContent("brand", { brandSlug: slug });
  }, [slug]);

  // #3682 — a brand link can open the app straight onto this page, leaving
  // nothing to go back to; the X then lands on the Explorer home instead of
  // doing nothing. Same idiom as the /e, /t and /exp link routes.
  const handleClose = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, [router]);

  const stateCloseButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Close"
      onPress={handleClose}
      hitSlop={12}
      style={[styles.stateClose, { top: insets.top + 12 }]}
    >
      <Text style={styles.stateCloseGlyph}>✕</Text>
    </Pressable>
  );

  // Background refresh keeps the last usable page mounted; only a cold read
  // owns the blocking state. This preserves tab/sheet/focus state on refresh.
  if (
    query.isLoading &&
    (query.data === null || query.data === undefined)
  ) {
    return (
      <View style={styles.stateWrap}>
        {stateCloseButton}
        <ActivityIndicator />
        <Text style={styles.stateText}>Loading brand...</Text>
      </View>
    );
  }

  if (
    query.isError &&
    (query.data === null || query.data === undefined)
  ) {
    return (
      <View style={styles.stateWrap}>
        {stateCloseButton}
        <Text style={styles.stateTitle}>Brand could not load</Text>
        <Text style={styles.stateText}>Try the link again in a moment.</Text>
      </View>
    );
  }

  if (query.data === null || query.data === undefined) {
    return (
      <View style={styles.stateWrap}>
        {stateCloseButton}
        <Text style={styles.stateTitle}>Brand not found</Text>
        <Text style={styles.stateText}>This Mingla brand is not public.</Text>
      </View>
    );
  }

  const detail = query.data;
  const publicPath = (
    target: Parameters<typeof resolveExplorerPublicPath>[0],
  ): string | null =>
    resolveExplorerPublicPath(target, {
      platform: Platform.OS,
      authState: user?.id ? "signed-in" : "anonymous",
    });
  const openPublicPath = (
    target: Parameters<typeof resolveExplorerPublicPath>[0],
  ): void => {
    const path = publicPath(target);
    if (path !== null) router.push(path as never);
  };

  const handleToggleFollow = (): void => {
    if (!user?.id) {
      // Anon gate — mirrors AppHandlers.tsx "Sign in to save" (spec §4/§5).
      // Contract e: Sign in to follow {Brand}.
      Alert.alert(
        `Sign in to follow ${detail.brand.displayName}`,
        "Hear about new dates first.",
      );
      return;
    }
    // #3859 — a privileged write cannot trust a stale public-page snapshot.
    // Re-read first when the page is stale, refreshing, or carrying a retained
    // refresh error, then require the same canonical brand before following.
    const followCurrentBrand = async (): Promise<void> => {
      if (query.isStale || query.isFetching || query.isError) {
        const refreshed = await query.refetch();
        if (
          refreshed.isError || refreshed.data === null ||
          refreshed.data === undefined ||
          refreshed.data.brand.id !== detail.brand.id ||
          refreshed.data.brand.slug !== detail.brand.slug
        ) {
          throw new Error("brand_revalidation_failed");
        }
      }
      await brandFollow.follow();
    };
    // #3682 C7 — Follow tap only follows; Following opens onFollowingMenu.
    void followCurrentBrand()
      .then(() => {
        HapticFeedback.light();
        toastManager.show(
          `You're following ${detail.brand.displayName}.`,
          "success",
        );
        postHogService.capture("brand_followed", {
          surface: "consumer_native",
          brand_id: detail.brand.id,
          brand_slug: detail.brand.slug,
          source: "brand_page",
        });
      })
      .catch(() => {
        toastManager.show(
          `Couldn't follow ${detail.brand.displayName}. Try again.`,
          "error",
        );
      });
  };

  // Cross-platform Following menu (Android Alert caps at 3 buttons).
  const followingMenuRow: BrandFollowRow | null = brandFollow.isFollowing
    ? {
        brandId: detail.brand.id,
        brandName: detail.brand.displayName,
        brandSlug: detail.brand.slug ?? null,
        logoUrl: null,
        source: "brand_page",
        createdAt: new Date().toISOString(),
        mutedUntil: brandFollow.mutedUntil,
        channels: { push: true, email: true, sms: true },
      }
    : null;

  const handleFollowingMenu = (): void => {
    setFollowingMenuOpen(true);
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
        happeningNow={happeningNowQuery.data ?? []}
        past={pastFeed.rows ?? []}
        pastHasMore={pastFeed.hasMore}
        pastLoadState={pastFeed.loadState}
        menu={detail.menu}
        isFollowing={brandFollow.isFollowing}
        followPending={brandFollow.isPending}
        followState={
          brandFollow.isMuted
            ? "muted"
            : brandFollow.isFollowing
              ? "following"
              : "not_following"
        }
        venues={venuesQuery.data ?? []}
        venuesLoadState={
          (venuesQuery.isLoading || venuesQuery.isFetching) &&
              (venuesQuery.data?.length ?? 0) === 0
            ? "loading"
            : venuesQuery.isError && (venuesQuery.data?.length ?? 0) === 0
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
          onClose: handleClose,
          onShare: handleShare,
          onToggleFollow: handleToggleFollow,
          onFollowingMenu: handleFollowingMenu,
          onOpenEvent: (event: PublicBrandEvent) => {
            openPublicPath({
              kind: "event",
              entityKind: event.eventType,
              entityId: event.id,
              brandSlug: event.brandSlug,
              eventSlug: event.eventSlug,
            });
          },
          onOpenTrip: (trip: PublicBrandTrip) => {
            openPublicPath({
              kind: "trip",
              entityId: trip.id,
              brandSlug: trip.brandSlug,
              tripSlug: trip.slug,
            });
          },
          onOpenExperience: (experience: PublicBrandExperience) => {
            openPublicPath({
              kind: "experience",
              entityId: experience.experienceId,
              brandSlug: experience.brandSlug,
              experienceSlug: experience.experienceSlug,
            });
          },
          onOpenUpcoming: (item: PublicBrandUpcoming) => {
            if (item.offeringType === "trip") {
              openPublicPath({
                kind: "trip",
                entityId: item.offeringId,
                brandSlug: item.brandSlug,
                tripSlug: item.offeringSlug,
              });
              return;
            }
            if (item.offeringType === "experience") {
              openPublicPath({
                kind: "experience",
                entityId: item.offeringId,
                brandSlug: item.brandSlug,
                experienceSlug: item.offeringSlug,
              });
              return;
            }
            openPublicPath({
              kind: "event",
              entityKind: item.offeringType,
              entityId: item.offeringId,
              brandSlug: item.brandSlug,
              eventSlug: item.offeringSlug,
            });
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
          onLoadMorePast: pastFeed.loadMore,
          onOpenVenue: (venue: PublicBrandVenueSummary) => {
            postHogService.capture("brand_venue_selected", {
              surface: "consumer_native",
              brand_id: detail.brand.id,
              venue_id: venue.id,
              reservable_state: venue.reservationState ?? "error",
              source_tab: "reservations",
            });
            const path = publicPath({
              kind: "venue",
              entityId: venue.id,
              brandSlug: detail.brand.slug,
              venueSlug: venue.slug,
            });
            if (path !== null) {
              router.push(
                `${path}${
                  venue.reservationState === "available"
                    ? "?tab=reservations"
                    : ""
                }` as never,
              );
            }
          },
        }}
      />
      {/* Issue #679 — self-mounted toast overlay. The app's only container is
          mounted in the Home route (app/index.tsx), which is NOT mounted on a
          cold /b/ deep link (investigation D-2). Warm-nav double-mount is
          benign: identical absolute-positioned overlay. */}
      <ToastContainer />
      <BrandFollowOverflowSheet
        visible={followingMenuOpen && followingMenuRow !== null}
        row={followingMenuRow}
        userId={user?.id ?? null}
        onClose={() => setFollowingMenuOpen(false)}
        onMuted={() => {
          setFollowingMenuOpen(false);
          invalidateFollow();
        }}
        onUnfollowed={() => {
          setFollowingMenuOpen(false);
          invalidateFollow();
          postHogService.capture("brand_unfollowed", {
            surface: "consumer_native",
            brand_id: detail.brand.id,
            brand_slug: detail.brand.slug,
            source: "brand_page",
          });
        }}
        onOpenChannels={() => {
          setFollowingMenuOpen(false);
          setManageChannelsOpen(true);
        }}
      />
      <BrandsYouFollowManageSheet
        visible={manageChannelsOpen}
        onClose={() => setManageChannelsOpen(false)}
        userId={user?.id ?? null}
      />
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
  stateClose: {
    position: "absolute",
    left: 16,
    zIndex: 2,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  stateCloseGlyph: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 20,
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
