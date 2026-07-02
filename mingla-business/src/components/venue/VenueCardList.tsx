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
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DESKTOP_HUB_GRID_COLUMNS } from "../../constants/desktopLayout";
import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useBrandPipelineStates } from "../../hooks/useBrandPlacePipelineState";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { useBrandMenus } from "../../hooks/useMenus";
import { useVenueClaimOpenCountsByVenue } from "../../hooks/useVenueClaimFeedback";
import { useVenueListings } from "../../hooks/useVenueListings";
import { useBrandReservationSettingsList } from "../../hooks/useVenueReservationSettings";
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

  // [TRANSITIONAL-3] menus are brand-level; the count is shared across venues.
  const menuItemCount = useMemo(
    () =>
      (menusQuery.data ?? []).reduce((sum, menu) => sum + menu.items.length, 0),
    [menusQuery.data],
  );

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

  const scrollBottomPad = insets.bottom + 120;

  // ----- loading (skeleton — dimensions equal the real card's) -----
  if (listingsQuery.isLoading) {
    const count = isWideDesktop ? 4 : 3;
    return (
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: scrollBottomPad }]}
        showsVerticalScrollIndicator={false}
        testID={testID ?? "venue-card-list"}
      >
        <View style={isWideDesktop ? styles.desktopListGrid : styles.list}>
          {Array.from({ length: count }, (_, i) => (
            <View key={i} style={isWideDesktop ? styles.desktopListCell : undefined}>
              <View style={styles.skeletonCard}>
                <Skeleton width={76} height={92} radius="md" />
                <View style={styles.skeletonBody}>
                  <Skeleton width={96} height={24} radius="full" />
                  <Skeleton width="70%" height={16} />
                  <Skeleton width="50%" height={12} />
                </View>
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
        contentContainerStyle={[styles.scroll, { paddingBottom: scrollBottomPad }]}
        showsVerticalScrollIndicator={false}
        testID={testID ?? "venue-card-list"}
      >
        <GlassCard variant="base" padding={spacing.lg}>
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
        contentContainerStyle={[styles.scroll, { paddingBottom: scrollBottomPad }]}
        showsVerticalScrollIndicator={false}
        testID={testID ?? "venue-card-list"}
      >
        <GlassCard variant="elevated" padding={spacing.lg}>
          <Text style={styles.emptyTitle}>No venues yet</Text>
          <Text style={styles.emptyBody}>
            List your place so Mingla can recommend it to people planning to go
            out — and take bookings when you&apos;re ready.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="List your venue"
            onPress={handleAddVenue}
            style={({ pressed }) => [styles.emptyCta, pressed ? styles.pillPressed : null]}
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
      contentContainerStyle={[styles.scroll, { paddingBottom: scrollBottomPad }]}
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
          style={({ pressed }) => [styles.addPill, pressed ? styles.pillPressed : null]}
          testID="venue-card-list-add"
        >
          <Icon name="plus" size={14} color={accent.warm} />
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
                menuItemCount={menuItemCount}
                reservationsEnabled={reservationsByVenue[venue.id] === true}
                onOpen={() => handleOpenVenue(venue.id)}
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
        style={({ pressed }) => [styles.trailingAdd, pressed ? styles.pillPressed : null]}
        testID="venue-card-list-add-trailing"
      >
        <Icon name="plus" size={14} color={textTokens.secondary} />
        <Text style={styles.trailingAddLabel}>Add another venue</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing.md,
  },
  list: {
    gap: spacing.sm,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  headerCount: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: "400",
    color: textTokens.tertiary,
  },
  addPill: {
    height: 34,
    paddingHorizontal: spacing.md - 2,
    borderRadius: radiusTokens.full,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  addPillLabel: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "600",
    color: accent.warm,
  },
  pillPressed: {
    opacity: 0.7,
  },
  skeletonCard: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.sm,
    alignItems: "stretch",
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    overflow: "hidden",
    marginBottom: spacing.sm,
  },
  skeletonBody: {
    flex: 1,
    gap: spacing.sm,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  errorBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: 20,
    color: textTokens.secondary,
  },
  errorCtaRow: {
    marginTop: spacing.md,
    alignItems: "flex-start",
  },
  emptyTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
    marginBottom: 4,
  },
  emptyBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: 20,
    color: textTokens.secondary,
    marginBottom: spacing.md,
  },
  emptyCta: {
    alignSelf: "flex-start",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  emptyCtaLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
  trailingAdd: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radiusTokens.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  trailingAddLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  desktopListGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 0,
    marginHorizontal: -spacing.xs,
  },
  desktopListCell: {
    width: `${100 / DESKTOP_HUB_GRID_COLUMNS}%`,
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.sm,
  },
});

export default VenueCardList;
