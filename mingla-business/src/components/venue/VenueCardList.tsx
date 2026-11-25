/**
 * VenueCardList (META-ORCH-1255, DESIGN §4) — the Hub ▸ Venue tab root: the
 * brand's venue listings as a card list (phone/native single column; desktop
 * ≥1024 the 4-column `DESKTOP_HUB_GRID_COLUMNS` grid — desktop contract #7).
 *
 * States (every one designed): loading (skeleton cards, dimensions equal the
 * real card's), error (honest retry card — never auto-retry-forever), empty
 * (mounted-while-last-venue-removed race + deep links; the tab itself is
 * gated on ≥1 venue), populated (header row "Your venues · N" + "+ Add venue"
 * pill + cards).
 *
 * Card tap pushes `/venue/{id}` — the per-venue management page (DESIGN §5.1;
 * back returns here with scroll retained via the native stack).
 */

import React, { useCallback, useMemo } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DESKTOP_HUB_GRID_COLUMNS } from "../../constants/desktopLayout";
import {
  radius as radiusTokens,
  color,
  space,
  type,
} from "../../constants/designSystem";
import { useBrandPipelineStates } from "../../hooks/useBrandPlacePipelineState";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { useBrandMenus } from "../../hooks/useMenus";
import { useVenueClaimOpenCountsByVenue } from "../../hooks/useVenueClaimFeedback";
import { useVenueListings } from "../../hooks/useVenueListings";
import { useBrandReservationSettingsList } from "../../hooks/useBrandReservationSettingsList";
import { useBrand } from "../../hooks/useBrands";
import { venuePublicPath, venuePublicUrl } from "../../constants/publicUrls";
import { openExternal } from "../../services/guestFunnelLink";
import { listingStatusView } from "../../utils/listingStatus";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Skeleton } from "../ui/Skeleton";
import { VenueListCard } from "./VenueListCard";

export interface VenueCardListProps {
  brandId: string | null;
  testID?: string;
}

export function VenueCardList({
  brandId,
  testID,
}: VenueCardListProps): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isWideDesktop } = useResponsiveLayout();

  const listingsQuery = useVenueListings(brandId);
  const pipelinesQuery = useBrandPipelineStates(brandId);
  const settingsList = useBrandReservationSettingsList(brandId);
  const menusQuery = useBrandMenus(brandId);

  const venues = listingsQuery.data ?? [];

  const hasAnyFollowUp = venues.some((v) => v.claimFollowUpAt !== null);
  const openCountsByVenue = useVenueClaimOpenCountsByVenue(
    brandId,
    hasAnyFollowUp,
  );

  const pipelineByVenue = useMemo(() => {
    const map: Record<string, string> = {};
    for (const row of pipelinesQuery.data ?? []) {
      map[row.venue_id] = row.status;
    }
    return map;
  }, [pipelinesQuery.data]);

  const reservationsByVenue = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const row of settingsList.data ?? []) {
      map[row.venueId] = row.reservationsEnabled;
    }
    return map;
  }, [settingsList.data]);

  const menuItemCountByVenue = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const menu of menusQuery.data ?? []) {
      if (typeof menu.venueId !== "string") continue;
      counts[menu.venueId] = (counts[menu.venueId] ?? 0) + menu.items.length;
    }
    return counts;
  }, [menusQuery.data]);

  const handleAddVenue = useCallback((): void => {
    // Intent already known — push straight to the wizard, never re-open the
    // creator sheet (DESIGN §4.1).
    router.push("/venue/create" as never);
  }, [router]);

  const handleOpenVenue = useCallback(
    (venueId: string): void => {
      router.push(`/venue/${venueId}` as never);
    },
    [router],
  );

  // #4490 P2 (hub) — Check-in opens the camera on a phone app and the
  // Check-in module on web; Public page follows the venue page's rule
  // (verified venues only, new tab on web, in-app on native).
  const brandSlug = useBrand(brandId).data?.slug ?? null;
  const handleCheckIn = useCallback(
    (venueId: string): void => {
      router.push(
        (Platform.OS === "web" ? `/venue/${venueId}?module=checkin` : `/venue/${venueId}/check-in/scan`) as never,
      );
    },
    [router],
  );
  const handleReservations = useCallback(
    (venueId: string): void => {
      router.push(`/venue/${venueId}?module=reservations` as never);
    },
    [router],
  );
  const handleRequests = useCallback(
    (venueId: string): void => {
      router.push(`/venue/${venueId}?module=requests` as never);
    },
    [router],
  );
  const handleWaitlist = useCallback(
    (venueId: string): void => {
      router.push(`/venue/${venueId}?module=waitlist` as never);
    },
    [router],
  );
  const publicPageFor = useCallback(
    (venue: { claimStatus?: string | null; slug: string }): (() => void) | undefined => {
      if (venue.claimStatus !== "verified" || brandSlug === null || brandSlug.length === 0 || venue.slug.length === 0) {
        return undefined;
      }
      return () => {
        if (Platform.OS === "web") openExternal(venuePublicUrl({ brandSlug, venueSlug: venue.slug }));
        else router.push(venuePublicPath({ brandSlug, venueSlug: venue.slug }) as never);
      };
    },
    [brandSlug, router],
  );

  const scrollBottomPad = insets.bottom + 120;

  // ----- loading (skeleton — dimensions equal the real card's) -----
  if (listingsQuery.isLoading) {
    const count = isWideDesktop ? 4 : 3;
    return (
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: scrollBottomPad },
        ]}
        showsVerticalScrollIndicator={false}
        testID={testID ?? "venue-card-list"}
      >
        <View style={isWideDesktop ? styles.desktopListGrid : styles.list}>
          {Array.from({ length: count }, (_, i) => (
            <View
              key={i}
              style={isWideDesktop ? styles.desktopListCell : undefined}
            >
              <View style={styles.skeletonVenue}>
                <View style={styles.skeletonCard}>
                  <Skeleton width={76} height={92} radius="md" />
                  <View style={styles.skeletonBody}>
                    <Skeleton width={96} height={24} radius="full" />
                    <Skeleton width="70%" height={16} />
                    <Skeleton width="50%" height={12} />
                  </View>
                </View>
                <Skeleton height={92} radius="md" />
                <Skeleton height={36} radius="full" />
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    );
  }

  // ----- error (honest retry — never a blank pane) -----
  if (listingsQuery.isError) {
    return (
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: scrollBottomPad },
        ]}
        showsVerticalScrollIndicator={false}
        testID={testID ?? "venue-card-list"}
      >
        <GlassCard variant="base" padding={space[6]}>
          <Text style={styles.errorTitle}>Couldn&apos;t load your venues</Text>
          <Text style={styles.errorBody}>Give it a second and try again.</Text>
          <View style={styles.errorCtaRow}>
            <Button
              label="Try again"
              variant="secondary"
              size="md"
              onPress={() => void listingsQuery.refetch()}
              testID="venue-card-list-retry"
            />
          </View>
        </GlassCard>
      </ScrollView>
    );
  }

  // ----- empty (race/deep-link only — the tab is gated on ≥1 venue) -----
  if (venues.length === 0) {
    return (
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: scrollBottomPad },
        ]}
        showsVerticalScrollIndicator={false}
        testID={testID ?? "venue-card-list"}
      >
        <GlassCard variant="elevated" padding={space[6]}>
          <Text style={styles.emptyTitle}>No venues yet</Text>
          <Text style={styles.emptyBody}>
            List your place so Mingla can recommend it to people planning to go
            out — and take bookings when you&apos;re ready.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="List your venue"
            onPress={handleAddVenue}
            style={({ pressed }) => [
              styles.emptyCta,
              pressed ? styles.pillPressed : null,
            ]}
            testID="venue-card-list-empty-cta"
          >
            <Text style={styles.emptyCtaLabel}>List your venue</Text>
          </Pressable>
        </GlassCard>
      </ScrollView>
    );
  }

  // ----- populated -----
  return (
    <ScrollView
      contentContainerStyle={[
        styles.scroll,
        { paddingBottom: scrollBottomPad },
      ]}
      showsVerticalScrollIndicator={false}
      testID={testID ?? "venue-card-list"}
    >
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Your venues
          <Text style={styles.headerCount}>{` · ${venues.length}`}</Text>
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a venue listing"
          onPress={handleAddVenue}
          hitSlop={{ top: 5, bottom: 5 }}
          style={({ pressed }) => [
            styles.addPill,
            pressed ? styles.pillPressed : null,
          ]}
          testID="venue-card-list-add"
        >
          <Icon name="plus" size={14} color={color.accent} />
          <Text style={styles.addPillLabel}>Add venue</Text>
        </Pressable>
      </View>
      <View style={isWideDesktop ? styles.desktopListGrid : styles.list}>
        {venues.map((venue) => {
          const status = listingStatusView({
            hasVenue: true,
            status:
              (pipelineByVenue[venue.id] as
                | "draft"
                | "processing"
                | "needs_fix"
                | "deck_eligible"
                | "failed"
                | undefined) ?? null,
            claimStatus: venue.claimStatus,
          });
          return (
            <View
              key={venue.id}
              style={isWideDesktop ? styles.desktopListCell : undefined}
            >
              <VenueListCard
                venue={venue}
                status={status}
                openFixCount={openCountsByVenue[venue.id] ?? 0}
                menuItemCount={
                  menusQuery.data === undefined
                    ? null
                    : (menuItemCountByVenue[venue.id] ?? 0)
                }
                reservationsEnabled={reservationsByVenue[venue.id] === true}
                onOpen={() => handleOpenVenue(venue.id)}
                onCheckIn={() => handleCheckIn(venue.id)}
                onReservations={() => handleReservations(venue.id)}
                onWaitlist={() => handleWaitlist(venue.id)}
                onRequests={() => handleRequests(venue.id)}
                onPublicPage={publicPageFor(venue)}
                testID={`venue-card-${venue.id}`}
              />
            </View>
          );
        })}
      </View>
      {/* Trailing quiet add row (SPEC #10) — the header pill stays the primary. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add another venue"
        onPress={handleAddVenue}
        style={({ pressed }) => [
          styles.trailingAdd,
          pressed ? styles.pillPressed : null,
        ]}
        testID="venue-card-list-add-trailing"
      >
        <Icon name="plus" size={14} color={color.text2} />
        <Text style={styles.trailingAddLabel}>Add another venue</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: space[4],
  },
  list: {
    gap: space[2],
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: space[2],
    paddingBottom: space[2],
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    color: color.text1,
  },
  headerCount: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: "400",
    color: color.text3,
  },
  addPill: {
    height: 34,
    paddingHorizontal: space[4] - 2,
    borderRadius: radiusTokens.full,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: color.accentLine,
    borderWidth: 1,
    borderColor: color.accentLine,
  },
  addPillLabel: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "600",
    color: color.accent,
  },
  pillPressed: {
    opacity: 0.7,
  },
  skeletonCard: {
    flexDirection: "row",
    gap: space[2],
    padding: space[2],
    alignItems: "stretch",
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
    overflow: "hidden",
  },
  skeletonVenue: { gap: space[2] },
  skeletonBody: {
    flex: 1,
    gap: space[2],
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: color.text1,
    marginBottom: space[1],
  },
  errorBody: {
    fontSize: type.small.fontSize,
    lineHeight: 20,
    color: color.text2,
  },
  errorCtaRow: {
    marginTop: space[4],
    alignItems: "flex-start",
  },
  emptyTitle: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    color: color.text1,
    marginBottom: 4,
  },
  emptyBody: {
    fontSize: type.small.fontSize,
    lineHeight: 20,
    color: color.text2,
    marginBottom: space[4],
  },
  emptyCta: {
    alignSelf: "flex-start",
    paddingVertical: space[2],
    paddingHorizontal: space[4],
    borderRadius: radiusTokens.md,
    backgroundColor: color.accentLine,
    borderWidth: 1,
    borderColor: color.accentLine,
  },
  emptyCtaLabel: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.accent,
  },
  trailingAdd: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: space[4],
    marginTop: space[2],
    borderRadius: radiusTokens.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  trailingAddLabel: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.text2,
  },
  desktopListGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 0,
    marginHorizontal: -space[1],
  },
  desktopListCell: {
    width: `${100 / DESKTOP_HUB_GRID_COLUMNS}%`,
    paddingHorizontal: space[1],
    marginBottom: space[2],
    alignSelf: "stretch",
  },
});

export default VenueCardList;
