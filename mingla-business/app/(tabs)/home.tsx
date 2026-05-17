/**
 * Home tab — Cycle 1 Account anchor.
 *
 * States:
 *   - Empty (brands.length === 0)              → "No brands yet" prompt + topbar chip CTA
 *   - Populated, no live event (currentBrand)  → 7-day aggregate hero + KPI grid + Upcoming list
 *   - Populated with live event                → Live KPI hero + KPI grid + Upcoming list
 *
 * Brand-chip on TopBar opens BrandSwitcherSheet (mode auto-derives from list state).
 * Sheet's onBrandCreated → Toast "{displayName} is ready" (per dispatch AC#2).
 *
 * Cycle 3 wires draft rows from draftEventStore.
 * ORCH-0784 wires non-draft sales summaries from server-backed order truth.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandDeleteSheet } from "../../src/components/brand/BrandDeleteSheet";
import { BrandSwitcherSheet } from "../../src/components/brand/BrandSwitcherSheet";
import { EventCoverMedia } from "../../src/components/ui/EventCoverMedia";
import { GlassCard } from "../../src/components/ui/GlassCard";
import { Icon } from "../../src/components/ui/Icon";
import { KpiTile } from "../../src/components/ui/KpiTile";
import { Pill } from "../../src/components/ui/Pill";
import { Toast } from "../../src/components/ui/Toast";
import { IconChrome } from "../../src/components/ui/IconChrome";
import { TopBar } from "../../src/components/ui/TopBar";
import { UniversalCreatorSheet } from "../../src/components/ui/UniversalCreatorSheet";
import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../src/constants/designSystem";
import { useAuth } from "../../src/context/AuthContext";
import {
  useCurrentBrandStore,
  type Brand,
} from "../../src/store/currentBrandStore";
import { useCurrentBrand } from "../../src/hooks/useCurrentBrand";
import { useCurrentBrandRecovery } from "../../src/hooks/useCurrentBrandRecovery";
import { brandKeys, useBrands } from "../../src/hooks/useBrands";
import { eventOrdersKeys } from "../../src/hooks/useEventOrders";
import { useServerDraftsForBrand } from "../../src/hooks/useServerDraftEvents";
import {
  mergeServerAndLegacyLiveEvents,
  useBusinessEventsForBrand,
} from "../../src/hooks/useBusinessEvents";
import {
  useDraftsForBrand,
  type DraftEvent,
} from "../../src/store/draftEventStore";
import {
  useLiveEventsForBrand,
  type LiveEvent,
} from "../../src/store/liveEventStore";
// ORCH-0865 REWORK 5 — canonical routing helper, ban hardcoded /event/{id}
import { routeForEventRowDefensive } from "../../src/utils/routeForEventRow";
import {
  buildBrandEventSummary,
  type BrandEventSummaryCounts,
  type BrandEventSummaryItem,
} from "../../src/utils/brandEventSummary";
import { useEventSalesSummaries } from "../../src/hooks/useEventOrders";

import { formatCurrencyRound } from "../../src/utils/currency";
import { formatDraftDateLine } from "../../src/utils/eventDateDisplay";
import { formatRelativeTime } from "../../src/utils/relativeTime";

interface ToastState {
  visible: boolean;
  message: string;
}

const greetingLabel = (): string => {
  const hour = new Date().getHours();
  if (hour < 5) return "Late night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
};

const getEventName = (name: string, fallback: string): string =>
  name.trim().length > 0 ? name : fallback;

const hasUnlimitedTickets = (event: LiveEvent): boolean =>
  event.tickets.some((ticket) => ticket.isUnlimited);

const finiteTicketCapacity = (event: LiveEvent): number | null => {
  const finiteTickets = event.tickets.filter((ticket) => !ticket.isUnlimited);
  if (finiteTickets.length === 0) return null;
  return finiteTickets.reduce((sum, ticket) => sum + (ticket.capacity ?? 0), 0);
};

const formatCapacityLabel = (event: LiveEvent): string => {
  const capacity = finiteTicketCapacity(event);
  if ((capacity === null || capacity === 0) && hasUnlimitedTickets(event)) {
    return "Unlimited";
  }
  return capacity === null ? "—" : capacity.toLocaleString("en-GB");
};

const formatActiveEventsSub = (counts: BrandEventSummaryCounts): string => {
  if (counts.active === 0) return "No active events";

  return [
    `${counts.live} live`,
    `${counts.upcoming} upcoming`,
    `${counts.draft} ${counts.draft === 1 ? "draft" : "drafts"}`,
  ].join(" · ");
};

const getLiveEventFromItem = (
  item: BrandEventSummaryItem | null,
): LiveEvent | null =>
  item?.kind === "live" ? (item.event as LiveEvent) : null;

export default function HomeTab(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const brandsQuery = useBrands(user?.id ?? null);
  const brands = brandsQuery.data ?? [];
  const currentBrand = useCurrentBrand();
  const currentBrandId = useCurrentBrandStore((s) => s.currentBrandId);
  const setCurrentBrand = useCurrentBrandStore((s) => s.setCurrentBrand);
  const brandRecovery = useCurrentBrandRecovery();
  useServerDraftsForBrand(currentBrand?.id ?? null);
  const businessEventsQuery = useBusinessEventsForBrand(currentBrand?.id ?? null);
  const drafts = useDraftsForBrand(currentBrand?.id ?? null);
  const legacyLiveEvents = useLiveEventsForBrand(currentBrand?.id ?? null);
  const liveEvents = useMemo(
    () =>
      mergeServerAndLegacyLiveEvents(
        businessEventsQuery.data ?? [],
        legacyLiveEvents,
      ),
    [businessEventsQuery.data, legacyLiveEvents],
  );
  const [sheetVisible, setSheetVisible] = useState<boolean>(false);
  // ORCH-0826 M0: universal creator sheet (Create event/experience/trip)
  const [isUniversalCreatorOpen, setIsUniversalCreatorOpen] = useState<boolean>(false);
  // Cycle 17e-A REWORK: BrandDeleteSheet state — opens from BrandSwitcherSheet
  // trash icon taps. Mirrors account.tsx pattern per ORCH-0734-RW SPEC §3.3.
  const [deleteSheetVisible, setDeleteSheetVisible] = useState<boolean>(false);
  const [brandPendingDelete, setBrandPendingDelete] = useState<Brand | null>(
    null,
  );
  const [toast, setToast] = useState<ToastState>({ visible: false, message: "" });
  // ORCH-0816 — pull-to-refresh as a manual freshness signal alongside the
  // Realtime subscription. Invalidates brand stats AND per-event order keys.
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const handleRefresh = useCallback(async (): Promise<void> => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: brandKeys.all }),
        queryClient.invalidateQueries({ queryKey: eventOrdersKeys.all }),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient]);

  const handleOpenSwitcher = useCallback((): void => {
    setSheetVisible(true);
  }, []);

  const handleCloseSheet = useCallback((): void => {
    setSheetVisible(false);
  }, []);

  const handleBrandCreated = useCallback((brand: Brand): void => {
    setToast({ visible: true, message: `${brand.displayName} is ready` });
  }, []);

  const handleDefaultBrandSaveError = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  // Cycle 17e-A REWORK: BrandSwitcherSheet trash tap → open BrandDeleteSheet
  const handleRequestDeleteBrand = useCallback((brand: Brand): void => {
    setBrandPendingDelete(brand);
    setDeleteSheetVisible(true);
  }, []);

  const handleCloseDeleteSheet = useCallback((): void => {
    setDeleteSheetVisible(false);
    // Don't clear brandPendingDelete immediately — exit animation reads it
  }, []);

  const handleBrandDeleted = useCallback(
    (deletedBrandId: string): void => {
      // Clear currentBrand if it matches deleted brand (server already cleared
      // default_brand_id per softDeleteBrand Step 3; this clears local UI state)
      const currentBrandId = useCurrentBrandStore.getState().currentBrandId;
      if (currentBrandId === deletedBrandId) {
        setCurrentBrand(null);
      }
      const deleted = brandPendingDelete;
      setBrandPendingDelete(null);
      setToast({
        visible: true,
        message: `${deleted?.displayName ?? "Brand"} deleted`,
      });
    },
    [setCurrentBrand, brandPendingDelete],
  );

  const handleDismissToast = useCallback((): void => {
    setToast((prev) => ({ ...prev, visible: false }));
  }, []);

  const handleBuildEvent = useCallback((): void => {
    if (currentBrand === null) {
      setToast({
        visible: true,
        message:
          brands.length > 0 ? "Select a brand first." : "Create a brand first.",
      });
      setSheetVisible(true);
      return;
    }
    router.push("/event/create" as never);
  }, [brands.length, currentBrand, router]);

  const handleSeeAllEvents = useCallback((): void => {
    router.push("/(tabs)/hub/events" as never);
  }, [router]);

  // ORCH-0865 REWORK 5: tap-handlers route THROUGH routeForEventRow so a
  // trip row that ever reaches this list (via stale cache, race, or future
  // regression) navigates to the trip surface, NOT the event surface.
  // Existing LiveEvent/DraftEvent types don't carry event_type yet —
  // routeForEventRowDefensive defaults to "event" when missing, which is
  // correct for legacy in-store rows (liveEventStore + draftEventStore
  // discipline guarantees stored items are events). Rows from
  // fetchBusinessEventsForBrand attach event_type at the service layer
  // (REWORK 5 mapper update) so trips route correctly.
  const handleOpenDraft = useCallback(
    (draft: DraftEvent): void => {
      router.push(
        routeForEventRowDefensive({
          id: draft.id,
          event_type:
            (draft as DraftEvent & { event_type?: string }).event_type ?? "event",
          status: "draft",
        }) as never,
      );
    },
    [router],
  );

  const handleOpenLiveEvent = useCallback(
    (event: LiveEvent): void => {
      router.push(
        routeForEventRowDefensive({
          id: event.id,
          event_type:
            (event as LiveEvent & { event_type?: string }).event_type ?? "event",
          status: event.status,
        }) as never,
      );
    },
    [router],
  );

  useEffect(() => {
    if (brandRecovery.errorMessage !== null) {
      setToast({ visible: true, message: brandRecovery.errorMessage });
    }
  }, [brandRecovery.errorMessage]);

  const hasNoBrands = brandsQuery.isFetched && brands.length === 0;
  const isBrandResolving =
    !brandsQuery.isFetched ||
    brandRecovery.isResolving ||
    (brands.length > 0 && currentBrandId !== null && currentBrand === null);
  const hasBrandsButNoSelection =
    brandsQuery.isFetched &&
    brands.length > 0 &&
    currentBrandId === null &&
    currentBrand === null &&
    !isBrandResolving;
  const eventSummary = useMemo(
    () => buildBrandEventSummary(liveEvents, drafts),
    [liveEvents, drafts],
  );
  const primaryLiveEvent = getLiveEventFromItem(eventSummary.primaryLiveItem);
  const summaryLiveEvents = useMemo(
    () =>
      eventSummary.activeItems.flatMap((item) =>
        item.kind === "live" ? [item.event as LiveEvent] : [],
      ),
    [eventSummary.activeItems],
  );
  const eventSalesSummaries = useEventSalesSummaries(
    summaryLiveEvents,
    currentBrand?.defaultCurrency,
  );

  const liveHeroMetrics = useMemo(() => {
    if (primaryLiveEvent === null) {
      return {
        revenueLabel: "—",
        soldValue: "0",
        capacity: null as number | null,
        progress: 0,
      };
    }

    const capacity = finiteTicketCapacity(primaryLiveEvent);
    const salesSummary = eventSalesSummaries[primaryLiveEvent.id];
    const soldCount = salesSummary?.soldCount ?? 0;
    return {
      revenueLabel:
        salesSummary?.revenueLabel ??
        formatCurrencyRound(
          0,
          primaryLiveEvent.currency ?? currentBrand?.defaultCurrency ?? "GBP",
        ),
      soldValue:
        salesSummary?.hasError === true
          ? "Unable"
          : soldCount.toLocaleString("en-GB"),
      capacity,
      progress:
        capacity !== null && capacity > 0
          ? Math.min(1, soldCount / capacity)
          : 0,
    };
  }, [primaryLiveEvent, currentBrand?.defaultCurrency, eventSalesSummaries]);

  return (
    <View style={[styles.host, { paddingTop: insets.top }]}>
      <View style={styles.barWrap}>
        <TopBar
          leftKind="brand"
          onBrandTap={handleOpenSwitcher}
          extraRightSlot={
            <IconChrome
              icon="plus"
              size={36}
              onPress={() => setIsUniversalCreatorOpen(true)}
              accessibilityLabel="Create event, experience, or trip"
              testID="home-universal-creator-button"
            />
          }
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
        }
      >
        {currentBrand === null ? (
          <View style={styles.emptyCol}>
            <GlassCard variant="elevated" padding={spacing.lg}>
              <Text style={styles.greetingTier}>{greetingLabel()}</Text>
              {hasNoBrands ? (
                <>
                  <Text style={styles.emptyTitle}>No brands yet</Text>
                  <Text style={styles.emptyBody}>
                    Tap{" "}
                    <Text style={styles.emptyChipName}>Create brand</Text>
                    {" "}in the top bar to set up your first brand. You can
                    edit it any time.
                  </Text>
                </>
              ) : hasBrandsButNoSelection ? (
                <>
                  <Text style={styles.emptyTitle}>Choose a brand</Text>
                  <Text style={styles.emptyBody}>
                    We found your brands. Pick one from the top bar to continue.
                  </Text>
                  <Pressable
                    onPress={handleOpenSwitcher}
                    accessibilityRole="button"
                    accessibilityLabel="Choose a brand"
                    style={styles.emptyBuildAction}
                  >
                    <Icon name="chevD" size={16} color={accent.warm} />
                    <Text style={styles.emptyBuildActionText}>
                      Choose brand
                    </Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={styles.emptyTitle}>Loading brands</Text>
                  <Text style={styles.emptyBody}>
                    Getting your brand workspace ready.
                  </Text>
                </>
              )}
            </GlassCard>
          </View>
        ) : (
          <>
            {/* ORCH-0855 (Tr1) — trip-planner-specific CTA gated by Stripe
                status. Renders ABOVE the existing 7-day stats / KPI / upcoming
                list (additive — does NOT replace populated state). For
                kind='popup' | 'physical' brands this block returns null and
                Home behaves byte-equivalent to pre-Tr1 (regression safety).
                Per SPEC §4.5.4 + investigation Finding I-2: trip planners
                require Stripe Connect to operate; CTA reflects readiness. */}
            {currentBrand.kind === "trip_planner" ? (
              <View style={styles.tripPlannerCtaWrap}>
                <GlassCard variant="elevated" padding={spacing.lg}>
                  {currentBrand.stripeStatus === "active" ? (
                    <>
                      <Text style={styles.tripPlannerCtaTitle}>Plan a trip</Text>
                      <Text style={styles.tripPlannerCtaBody}>
                        You&rsquo;re set up. Create your first trip to start selling.
                      </Text>
                      <Pressable
                        onPress={() => router.push("/trip/create" as never)}
                        accessibilityRole="button"
                        accessibilityLabel="Plan a trip"
                        style={styles.tripPlannerCtaAction}
                        testID="trip-planner-cta-plan-a-trip"
                      >
                        <Icon name="plus" size={16} color={accent.warm} />
                        <Text style={styles.tripPlannerCtaActionText}>
                          Plan a trip
                        </Text>
                      </Pressable>
                    </>
                  ) : (
                    <>
                      <Text style={styles.tripPlannerCtaTitle}>
                        Finish setting up Stripe
                      </Text>
                      <Text style={styles.tripPlannerCtaBody}>
                        Trip planners need Stripe Connect to collect deposits.
                        Finish setup to publish trips.
                      </Text>
                      <Pressable
                        onPress={() =>
                          router.push(
                            `/brand/${currentBrand.id}/payments` as never,
                          )
                        }
                        accessibilityRole="button"
                        accessibilityLabel="Finish Stripe setup"
                        style={styles.tripPlannerCtaAction}
                        testID="trip-planner-cta-finish-stripe"
                      >
                        <Icon name="chevR" size={16} color={accent.warm} />
                        <Text style={styles.tripPlannerCtaActionText}>
                          Finish Stripe setup
                        </Text>
                      </Pressable>
                    </>
                  )}
                </GlassCard>
              </View>
            ) : null}
            {primaryLiveEvent !== null ? (
              <GlassCard variant="elevated" padding={spacing.lg}>
                <View style={styles.heroLiveTagRow}>
                  <Pill variant="live" livePulse>
                    Live now
                  </Pill>
                </View>
                <Text style={styles.heroEventName}>
                  {getEventName(primaryLiveEvent.name, "Untitled event")}
                </Text>
                <Text style={styles.heroEventDate}>
                  {formatDraftDateLine(primaryLiveEvent)}
                </Text>
                <View style={styles.heroAmountRow}>
                  <Text style={styles.heroAmountSold}>
                    {liveHeroMetrics.revenueLabel}
                  </Text>
                  <Text style={styles.heroAmountGoal}> revenue</Text>
                </View>
                {liveHeroMetrics.capacity !== null ? (
                  <View style={styles.progressBarTrack}>
                    <View
                      style={[
                        styles.progressBarFill,
                        {
                          width: `${Math.round(
                            liveHeroMetrics.progress * 100,
                          )}%`,
                        },
                      ]}
                    />
                  </View>
                ) : null}
                <View style={styles.heroStatRow}>
                  <View style={styles.heroStatCell}>
                    <Text style={styles.heroStatValue}>
                      {liveHeroMetrics.soldValue}
                    </Text>
                    <Text style={styles.heroStatLabel}>Tickets sold</Text>
                  </View>
                  <View style={styles.heroStatCell}>
                    <Text style={styles.heroStatValue}>
                      {formatCapacityLabel(primaryLiveEvent)}
                    </Text>
                    <Text style={styles.heroStatLabel}>Capacity</Text>
                  </View>
                  <View style={styles.heroStatCell}>
                    <Text style={styles.heroStatValue}>—</Text>
                    <Text style={styles.heroStatLabel}>Scanned</Text>
                  </View>
                </View>
              </GlassCard>
            ) : (
              <KpiTile
                label="Last 7 days"
                value={
                  currentBrand.defaultCurrency !== undefined
                    ? formatCurrencyRound(
                        // ORCH-0816 — windowed 7-day GMV. Lifetime stays on
                        // BrandProfileView's "GMV / all time" tile.
                        currentBrand.stats.rev7d,
                        currentBrand.defaultCurrency,
                      )
                    : "—"
                }
              />
            )}

            <KpiTile
              label="Active events"
              value={eventSummary.counts.active}
              sub={formatActiveEventsSub(eventSummary.counts)}
            />

            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Upcoming</Text>
              <Pressable
                onPress={handleSeeAllEvents}
                accessibilityRole="link"
                accessibilityLabel="See all upcoming events"
              >
                <Text style={styles.sectionLink}>See all</Text>
              </Pressable>
            </View>

            <View style={styles.eventsCol}>
              {eventSummary.activeItems.length === 0 ? (
                <GlassCard variant="base" padding={spacing.lg}>
                  <Text style={styles.emptyTitle}>No upcoming events</Text>
                  <Text style={styles.emptyBody}>
                    Tap{" "}
                    <Text style={styles.emptyEmphasis}>+</Text>
                    {" "}in the top right to create your first event.
                  </Text>
                  {/* ORCH-0826 M0 Q5 override: empty-state "+ Build event"
                      button removed. The top-bar universal "+" is now the
                      sole creation entry point. */}
                </GlassCard>
              ) : (
                eventSummary.activeItems.map((item) => {
                  if (item.kind === "draft") {
                    const draft = item.event as DraftEvent;
                    return (
                      <Pressable
                        key={item.key}
                        onPress={() => handleOpenDraft(draft)}
                        accessibilityRole="button"
                        accessibilityLabel={`Resume draft: ${
                          draft.name || "Untitled"
                        }`}
                        style={styles.eventRow}
                      >
                        <View style={styles.eventCoverWrap}>
                          <EventCoverMedia
                            hue={draft.coverHue}
                            mediaUrl={draft.coverMediaUrl}
                            mediaType={draft.coverMediaType}
                            radius={12}
                            label=""
                            height={56}
                            width={56}
                          />
                        </View>
                        <View style={styles.eventTextCol}>
                          <View style={styles.eventPillRow}>
                            <Pill variant="draft">Draft</Pill>
                          </View>
                          <Text style={styles.eventTitle} numberOfLines={1}>
                            {getEventName(draft.name, "Untitled draft")}
                          </Text>
                          <Text style={styles.eventWhen} numberOfLines={1}>
                            {`Step ${draft.lastStepReached + 1} of 7 · ${formatRelativeTime(
                              draft.updatedAt,
                            )}`}
                          </Text>
                        </View>
                        <View style={styles.eventSoldCol}>
                          <Text style={styles.eventSoldValue}>—</Text>
                          <Text style={styles.eventSoldLabel}>resume</Text>
                        </View>
                      </Pressable>
                    );
                  }

                  const event = item.event as LiveEvent;
                  const salesSummary = eventSalesSummaries[event.id];
                  const soldLabel = salesSummary?.soldLabel ?? "0 sold";
                  const rowSoldLabel =
                    salesSummary?.finiteCapacity !== null && salesSummary !== undefined
                      ? `${soldLabel} sold`
                      : soldLabel;
                  const revenueLabel =
                    salesSummary?.revenueLabel ??
                    formatCurrencyRound(
                      0,
                      event.currency ?? currentBrand.defaultCurrency ?? "GBP",
                    );
                  const isLive = item.status === "live";

                  return (
                    <Pressable
                      key={item.key}
                      onPress={() => handleOpenLiveEvent(event)}
                      accessibilityRole="button"
                      accessibilityLabel={`Open event: ${
                        event.name || "Untitled"
                      }. ${rowSoldLabel}. ${revenueLabel}.`}
                      style={styles.eventRow}
                    >
                      <View style={styles.eventCoverWrap}>
                        <EventCoverMedia
                          hue={event.coverHue}
                          mediaUrl={event.coverMediaUrl}
                          mediaType={event.coverMediaType}
                          radius={12}
                          label=""
                          height={56}
                          width={56}
                        />
                      </View>
                      <View style={styles.eventTextCol}>
                        <View style={styles.eventPillRow}>
                          <Pill
                            variant={isLive ? "live" : "accent"}
                            livePulse={isLive}
                          >
                            {isLive ? "Live" : "Upcoming"}
                          </Pill>
                        </View>
                        <Text style={styles.eventTitle} numberOfLines={1}>
                          {getEventName(event.name, "Untitled event")}
                        </Text>
                        <Text style={styles.eventWhen} numberOfLines={1}>
                          {formatDraftDateLine(event)}
                        </Text>
                      </View>
                      <View style={styles.eventSoldCol}>
                        <Text style={styles.eventSoldValue}>
                          {rowSoldLabel}
                        </Text>
                        <Text style={styles.eventRevenueValue}>
                          {revenueLabel}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })
              )}
            </View>

          </>
        )}
      </ScrollView>

      <BrandSwitcherSheet
        visible={sheetVisible}
        onClose={handleCloseSheet}
        onBrandCreated={handleBrandCreated}
        onDefaultBrandSaveError={handleDefaultBrandSaveError}
        onRequestDeleteBrand={handleRequestDeleteBrand}
      />

      {/* ORCH-0826 M0: universal creator sheet (Create event/experience/trip) */}
      <UniversalCreatorSheet
        visible={isUniversalCreatorOpen}
        onClose={() => setIsUniversalCreatorOpen(false)}
      />

      <BrandDeleteSheet
        visible={deleteSheetVisible}
        brand={brandPendingDelete}
        accountId={user?.id ?? null}
        onClose={handleCloseDeleteSheet}
        onDeleted={handleBrandDeleted}
      />

      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={handleDismissToast}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  barWrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    paddingBottom: spacing.xl * 4,
    gap: spacing.md,
  },
  toastWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: spacing.xl,
    paddingHorizontal: spacing.md,
  },

  // Empty state ---------------------------------------------------------
  emptyCol: {
    gap: spacing.md,
  },
  emptyTitle: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    letterSpacing: typography.h2.letterSpacing,
    color: textTokens.primary,
    marginTop: spacing.xs,
  },
  emptyBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    marginTop: spacing.sm,
  },
  emptyChipName: {
    color: accent.warm,
    fontWeight: "600",
  },
  // ORCH-0826 M0: emphasis style for the empty-state copy pointing at
  // the top-bar "+" universal creator.
  emptyEmphasis: {
    fontWeight: "700",
    color: textTokens.primary,
  },

  // Greeting ------------------------------------------------------------
  greetingTier: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "700",
    letterSpacing: 0.4,
    color: textTokens.tertiary,
    textTransform: "uppercase",
  },

  // Hero — live event ---------------------------------------------------
  heroLiveTagRow: {
    flexDirection: "row",
    marginBottom: spacing.sm,
  },
  heroEventName: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    marginBottom: 2,
  },
  heroEventDate: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginBottom: 4,
  },
  heroAmountRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginBottom: spacing.md,
  },
  heroAmountSold: {
    fontSize: 32,
    lineHeight: 36,
    fontWeight: "700",
    letterSpacing: -0.4,
    color: textTokens.primary,
  },
  heroAmountGoal: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "500",
    color: textTokens.tertiary,
  },
  progressBarTrack: {
    height: 4,
    borderRadius: 999,
    backgroundColor: glass.tint.profileBase,
    overflow: "hidden",
    marginBottom: spacing.md,
  },
  progressBarFill: {
    height: "100%",
    backgroundColor: accent.warm,
    borderRadius: 999,
  },
  heroStatRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  heroStatCell: {
    flex: 1,
  },
  heroStatValue: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
  },
  heroStatLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: 2,
  },

  // Section header ------------------------------------------------------
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.sm,
  },
  sectionTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    letterSpacing: typography.h3.letterSpacing,
    color: textTokens.primary,
  },
  sectionLink: {
    fontSize: typography.bodySm.fontSize,
    color: accent.warm,
    fontWeight: "600",
  },

  // Event rows ----------------------------------------------------------
  eventsCol: {
    gap: spacing.sm,
  },
  eventRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radiusTokens.lg,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  eventCoverWrap: {
    width: 56,
    height: 56,
    flexShrink: 0,
  },
  eventTextCol: {
    flex: 1,
    minWidth: 0,
  },
  eventPillRow: {
    flexDirection: "row",
    marginBottom: 2,
  },
  eventTitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
    marginBottom: 2,
  },
  eventWhen: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
  },
  eventSoldCol: {
    alignItems: "flex-end",
    paddingRight: 2,
    minWidth: 74,
  },
  eventSoldValue: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  eventRevenueValue: {
    fontSize: 11,
    fontWeight: "700",
    color: textTokens.primary,
    fontVariant: ["tabular-nums"],
    marginTop: 2,
  },
  eventSoldLabel: {
    fontSize: 10,
    color: textTokens.tertiary,
  },

  // Empty action --------------------------------------------------------
  emptyBuildAction: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing.xs,
    minHeight: 40,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: accent.border,
    backgroundColor: accent.tint,
    marginTop: spacing.md,
  },
  emptyBuildActionText: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "600",
    color: accent.warm,
  },
  // ORCH-0855 (Tr1) — trip-planner Home CTA styles.
  tripPlannerCtaWrap: {
    marginBottom: spacing.md,
  },
  tripPlannerCtaTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  tripPlannerCtaBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    marginBottom: spacing.md,
  },
  tripPlannerCtaAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    alignSelf: "flex-start",
  },
  tripPlannerCtaActionText: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "600",
    color: accent.warm,
  },
});
