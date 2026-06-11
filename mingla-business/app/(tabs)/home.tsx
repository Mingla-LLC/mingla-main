/**
 * Home tab — brand-owner dashboard.
 *
 * ORCH-1038 [unified smart to-do toggle]:
 *   - A single collapsible <BusinessTodoToggle> sits flush under the top bar
 *     (shared with Hub). It derives an ordered, auto-vanishing to-do list from
 *     live state (create/select brand, add/finish venue, get venue live, create
 *     first offering, connect Stripe, finish draft) and replaces ALL the prior
 *     conditional cards (no-brand / choose-brand / loading / add-venue /
 *     deck-readiness / rule-ladder next-action / offering-chooser).
 *   - Analytics render ONLY when there is real data: the live hero, the 7-day
 *     revenue KPI (rev7d > 0), the Active-events KPI (total > 0), and the
 *     Upcoming list (items > 0). No zero/empty placeholder tiles.
 *   - The live hero's scan-QR action still routes to /event/{id}/scanner.
 *
 * ORCH-0965 [tri-kind upcoming]: the Upcoming list covers events, experiences,
 * trips + local drafts, sorted live-pinned then startAtUtc ascending.
 *
 * Brand-chip on TopBar opens BrandSwitcherSheet (mode auto-derives from list state).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandDeleteSheet } from "../../src/components/brand/BrandDeleteSheet";
import { BrandSwitcherSheet } from "../../src/components/brand/BrandSwitcherSheet";
import { BusinessTodoToggle } from "../../src/components/home/BusinessTodoToggle";
import { HomeTripRow } from "../../src/components/home/HomeTripRow";
import { UpcomingListItem } from "../../src/components/home/UpcomingListItem";
import { EventCoverMedia } from "../../src/components/ui/EventCoverMedia";
import { GlassCard } from "../../src/components/ui/GlassCard";
import { Icon } from "../../src/components/ui/Icon";
import { KpiTile } from "../../src/components/ui/KpiTile";
import { Pill } from "../../src/components/ui/Pill";
import { Toast } from "../../src/components/ui/Toast";
import { IconChrome } from "../../src/components/ui/IconChrome";
import { TopBar } from "../../src/components/ui/TopBar";
import { UniversalCreatorSheet } from "../../src/components/ui/UniversalCreatorSheet";
import { InvitePendingSheet } from "../../src/components/team/InvitePendingSheet";
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
import { useCurrentBrandRole } from "../../src/hooks/useCurrentBrandRole";
import { useCurrentBrandRecovery } from "../../src/hooks/useCurrentBrandRecovery";
import { useBusinessTodos } from "../../src/hooks/useBusinessTodos";
import { useResponsiveLayout } from "../../src/hooks/useResponsiveLayout";
import { brandKeys } from "../../src/hooks/useBrands";
import {
  eventOrdersKeys,
  useEventSalesSummaries,
} from "../../src/hooks/useEventOrders";
import {
  upcomingKeys,
  useUpcomingForBrand,
} from "../../src/hooks/useUpcomingForBrand";
import type { DraftEvent } from "../../src/store/draftEventStore";
import type { LiveEvent } from "../../src/store/liveEventStore";
import type { Trip } from "../../src/services/tripsService";
// ORCH-0865 REWORK 5 — canonical routing helper, ban hardcoded /event/{id}
import { routeForEventRowDefensive } from "../../src/utils/routeForEventRow";
import type { BusinessTodo } from "../../src/utils/businessTodos";

import { formatCurrencyRound } from "../../src/utils/currency";
import { formatDraftDateLine } from "../../src/utils/eventDateDisplay";
import { getActiveEventsKpiSub } from "../../src/utils/homeKpiPresentation";
import { formatRelativeTime } from "../../src/utils/relativeTime";
// ORCH-1055 (META-ORCH-1048 sub-F): rank-10 scanners see a stripped-down
// door-list surface instead of the brand-owner KPI dashboard. Importing
// the scanner shell + rank gate at the top so the early-branch reads
// cleanly. The full HomeTab body below is unchanged for rank>=20.
import { ScannerHome } from "../../src/components/scanners/ScannerHome";
import { isScannerOnlyRank } from "../../src/utils/navTabGate";

interface ToastState {
  visible: boolean;
  message: string;
}

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

export default function HomeTab(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isWideDesktop } = useResponsiveLayout();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const currentBrand = useCurrentBrand();
  const setCurrentBrand = useCurrentBrandStore((s) => s.setCurrentBrand);
  // ORCH-1055: rank-10 scanners render the stripped-down ScannerHome
  // instead of the brand-owner KPI dashboard. Hook MUST be called every
  // render (rules-of-hooks); the early-return branches on the resolved
  // value below, after all sibling hooks have run.
  const { rank: callerRank } = useCurrentBrandRole(currentBrand?.id ?? null);
  const brandRecovery = useCurrentBrandRecovery();
  const upcoming = useUpcomingForBrand(currentBrand?.id ?? null);
  const [sheetVisible, setSheetVisible] = useState<boolean>(false);
  // ORCH-0826 M0: universal creator sheet (Create event/experience/trip)
  const [isUniversalCreatorOpen, setIsUniversalCreatorOpen] = useState<boolean>(false);
  // ORCH-1108 — pending-invite Accept/Decline sheet, opened from the invite
  // To-Do row. Null when closed.
  const [pendingInvite, setPendingInvite] = useState<{
    invitationId: string;
    brandName: string;
  } | null>(null);
  // Cycle 17e-A REWORK: BrandDeleteSheet state — opens from BrandSwitcherSheet
  // trash icon taps. Mirrors account.tsx pattern per ORCH-0734-RW SPEC §3.3.
  const [deleteSheetVisible, setDeleteSheetVisible] = useState<boolean>(false);
  const [brandPendingDelete, setBrandPendingDelete] = useState<Brand | null>(
    null,
  );
  const [toast, setToast] = useState<ToastState>({ visible: false, message: "" });
  // ORCH-0816 — pull-to-refresh as a manual freshness signal alongside the
  // Realtime subscription. Invalidates brand stats AND per-event order keys.
  // ORCH-0965 — also invalidates the upcoming composite key.
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const handleRefresh = useCallback(async (): Promise<void> => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: brandKeys.all }),
        queryClient.invalidateQueries({ queryKey: eventOrdersKeys.all }),
        queryClient.invalidateQueries({ queryKey: upcomingKeys.all }),
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

  const handleSeeAllEvents = useCallback((): void => {
    router.push("/(tabs)/hub/events" as never);
  }, [router]);

  // ORCH-0865 REWORK 5: tap-handlers route THROUGH routeForEventRow so a
  // trip row that ever reaches this list (via stale cache, race, or future
  // regression) navigates to the trip surface, NOT the event surface.
  const handleOpenDraft = useCallback(
    (draft: DraftEvent): void => {
      router.push(
        routeForEventRowDefensive({
          id: draft.id,
          event_type:
            (draft as DraftEvent & { event_type?: "event" | "experience" | "trip" }).event_type ?? "event",
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
            (event as LiveEvent & { event_type?: "event" | "experience" | "trip" }).event_type ?? "event",
          status: event.status,
        }) as never,
      );
    },
    [router],
  );

  // ORCH-0965 — new: trip-row tap. routeForEventRowDefensive routes trips
  // to /trip/{id} for live/scheduled and /trip/{id}/edit for drafts.
  const handleOpenTrip = useCallback(
    (trip: Trip): void => {
      router.push(
        routeForEventRowDefensive({
          id: trip.id,
          event_type: "trip",
          status: trip.status,
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

  const primaryLiveItem = upcoming.primaryLiveItem;
  const primaryLiveEvent: LiveEvent | null =
    primaryLiveItem !== null &&
    (primaryLiveItem.kind === "event" || primaryLiveItem.kind === "experience")
      ? (primaryLiveItem.source as LiveEvent)
      : null;

  // Sales summary lookup for ALL event/experience items — both live AND upcoming.
  // Upcoming (scheduled, future-dated) events are still selling tickets, so their
  // sold count + revenue must be fetched too. Previously this filtered to
  // status === "live", so every upcoming row fell back to a false "0 sold" / "$0"
  // (its orders were never fetched). Trips are excluded — they carry their own
  // ticketsSoldCount on the Trip row; drafts have no orders.
  const summaryEvents = useMemo<LiveEvent[]>(
    () =>
      upcoming.items
        .filter((i) => i.kind === "event" || i.kind === "experience")
        .map((i) => i.source as LiveEvent),
    [upcoming.items],
  );
  const eventSalesSummaries = useEventSalesSummaries(
    summaryEvents,
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

  // ORCH-0965 — counts shape for the existing getActiveEventsKpiSub helper.
  // The helper consumes BrandEventSummaryCounts which has `all` + status
  // buckets; we map our UpcomingCounts (which mirrors the same shape minus
  // `all`) by aliasing `total` to `all` + the existing buckets and adding
  // a zero `past` slot (past items are filtered before reaching here).
  const kpiCountsForSub = useMemo(
    () => ({
      all: upcoming.counts.total,
      active: upcoming.counts.active,
      live: upcoming.counts.live,
      upcoming: upcoming.counts.upcoming,
      draft: upcoming.counts.draft,
      past: 0,
    }),
    [upcoming.counts],
  );

  // ORCH-1038: the no-brand / choose-brand / add-venue / deck-readiness /
  // rule-ladder / offering-chooser logic now lives in the shared useBusinessTodos
  // hook + handleTodoAction below.

  // ORCH-0965 — scan-QR action visible ONLY when the primary live hero is
  // an `event`-kind offering. Experiences route to a coming-soon stub
  // (Ve series not shipped) and trips have no scanner today.
  const showScanAction =
    primaryLiveItem !== null && primaryLiveItem.kind === "event";

  const handleScanPress = useCallback((): void => {
    if (primaryLiveItem === null || primaryLiveItem.kind !== "event") return;
    router.push(`/event/${primaryLiveItem.id}/scanner` as never);
  }, [primaryLiveItem, router]);

  // ORCH-1038 — analytics tiles render ONLY when there is real data to show
  // (no zero/empty placeholders); the to-do toggle carries guidance instead.
  const hasRevenueData =
    currentBrand?.defaultCurrency !== undefined &&
    (currentBrand?.stats.rev7d ?? 0) > 0;
  const showRevenueTile = primaryLiveEvent !== null || hasRevenueData;
  const hasActiveEvents = upcoming.counts.total > 0;
  const hasUpcomingItems = upcoming.items.length > 0;
  const showKpiGrid = showRevenueTile || hasActiveEvents;

  // ORCH-1038 — unified smart to-do list: derived from live state, ordered by
  // priority, auto-vanishing as conditions are met. Single source of truth shared
  // with Hub (useBusinessTodos).
  const todos = useBusinessTodos();
  const handleTodoAction = useCallback(
    (todo: BusinessTodo): void => {
      switch (todo.action.kind) {
        case "open_brand_switcher":
          setSheetVisible(true);
          return;
        case "open_universal_creator":
          setIsUniversalCreatorOpen(true);
          return;
        case "route":
          router.push(todo.action.route as never);
          return;
        case "open_pending_invite":
          // ORCH-1108 — open the Accept/Decline sheet for this invite.
          setPendingInvite({
            invitationId: todo.action.invitationId,
            brandName: todo.action.brandName,
          });
          return;
        default: {
          const _exhaustive: never = todo.action;
          return _exhaustive;
        }
      }
    },
    [router],
  );

  // ORCH-1055: rank-10 scanner — render the door-only surface. All hooks
  // above have run unconditionally; this is a render-time branch, safe
  // under rules-of-hooks. rank<scanner (i.e. rank 0 / no membership)
  // falls through to the regular Home so the empty-brand prompt can
  // still drive onboarding.
  if (isScannerOnlyRank(callerRank)) {
    return <ScannerHome />;
  }

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

      {/* ORCH-1038 — unified smart to-do toggle, flush under the top bar, full
          top-bar width, on Home + Hub. Hides entirely when there is nothing to do. */}
      <View style={styles.todoWrap}>
        <BusinessTodoToggle
          todos={todos}
          onAction={handleTodoAction}
          testID="business-todo-toggle"
        />
      </View>

      {isWideDesktop ? (
        <ScrollView
          style={styles.desktopOuterScroll}
          scrollEnabled={false}
          contentContainerStyle={[styles.scroll, styles.desktopScroll]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
          }
        >
          {currentBrand === null ? null : (
            <>
              {/* ORCH-1038 — analytics only when there's real data; the to-do
                  toggle above carries all guidance/empty-state actions. */}
              {showKpiGrid ? (
              <View style={styles.desktopKpiGrid}>
                {showRevenueTile ? (
                <View style={styles.desktopKpiCell}>
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
                      {/* ORCH-0965 — scan-QR action. Event-kind hero only. */}
                      {showScanAction ? (
                        <Pressable
                          onPress={handleScanPress}
                          accessibilityRole="button"
                          accessibilityLabel={`Scan tickets for ${getEventName(primaryLiveEvent.name, "Untitled event")}`}
                          style={styles.heroScanAction}
                          testID="home-live-hero-scan-button"
                        >
                          <Icon name="qr" size={16} color={accent.warm} />
                          <Text style={styles.heroScanActionText}>
                            Scan QR codes
                          </Text>
                        </Pressable>
                      ) : null}
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
                </View>
                ) : null}

                {hasActiveEvents ? (
                <View style={styles.desktopKpiCell}>
                  <KpiTile
                    label="Active events"
                    value={upcoming.counts.active}
                    sub={getActiveEventsKpiSub(kpiCountsForSub, isWideDesktop)}
                  />
                </View>
                ) : null}
              </View>
              ) : null}

              {hasUpcomingItems ? (
              <View style={styles.desktopUpcomingPane}>
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

                <ScrollView
                  style={styles.desktopUpcomingList}
                  scrollEnabled={isWideDesktop}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={[
                    styles.eventsCol,
                    styles.desktopEventsGrid,
                  ]}
                >
                {upcoming.items.map((item) => {
                    if (item.kind === "draft") {
                      const draft = item.source as DraftEvent;
                      return (
                        <View
                          key={item.key}
                          style={styles.desktopEventCell}
                        >
                        <Pressable
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
                        </View>
                      );
                    }

                    if (item.kind === "trip") {
                      const trip = item.source as Trip;
                      return (
                        <View
                          key={item.key}
                          style={styles.desktopEventCell}
                        >
                          <HomeTripRow
                            trip={trip}
                            status={item.status === "live" ? "live" : "upcoming"}
                            onPress={() => handleOpenTrip(trip)}
                          />
                        </View>
                      );
                    }

                    // 'event' or 'experience' — rendered through the LiveEvent row JSX.
                    const event = item.source as LiveEvent;
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
                      <View
                        key={item.key}
                        style={styles.desktopEventCell}
                      >
                      <Pressable
                        onPress={() => handleOpenLiveEvent(event)}
                        accessibilityRole="button"
                        accessibilityLabel={`Open ${item.kind}: ${
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
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
              ) : null}
            </>
          )}
        </ScrollView>
      ) : currentBrand === null ? null : (
        // orch-0974-lock-pane:begin-mobile-populated; ORCH-1038 — the to-do
        // toggle above carries no-brand / no-venue / deck-readiness / offering
        // guidance; this pane is now analytics-only (gated on real data).
        <View style={styles.mobileBody}>
          <View style={styles.lockedZone}>
            {showKpiGrid ? (
            <View style={styles.mobileKpiStack}>
              {showRevenueTile ? (
              primaryLiveEvent !== null ? (
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
                  {/* ORCH-0965 — scan-QR action. Event-kind hero only. */}
                  {showScanAction ? (
                    <Pressable
                      onPress={handleScanPress}
                      accessibilityRole="button"
                      accessibilityLabel={`Scan tickets for ${getEventName(primaryLiveEvent.name, "Untitled event")}`}
                      style={styles.heroScanAction}
                      testID="home-live-hero-scan-button"
                    >
                      <Icon name="qr" size={16} color={accent.warm} />
                      <Text style={styles.heroScanActionText}>
                        Scan QR codes
                      </Text>
                    </Pressable>
                  ) : null}
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
              )
              ) : null}

              {hasActiveEvents ? (
              <KpiTile
                label="Active events"
                value={upcoming.counts.active}
                sub={getActiveEventsKpiSub(kpiCountsForSub, isWideDesktop)}
              />
              ) : null}
            </View>
            ) : null}

            {hasUpcomingItems ? (
            <View style={styles.mobileSectionHeaderRow}>
              <Text style={styles.sectionTitle}>Upcoming</Text>
              <Pressable
                onPress={handleSeeAllEvents}
                accessibilityRole="link"
                accessibilityLabel="See all upcoming events"
              >
                <Text style={styles.sectionLink}>See all</Text>
              </Pressable>
            </View>
            ) : null}
          </View>

          <FlatList
            style={styles.mobileUpcomingList}
            data={upcoming.items}
            keyExtractor={(item) => item.key}
            renderItem={({ item }) => (
              <UpcomingListItem
                item={item}
                currentBrandCurrency={currentBrand.defaultCurrency}
                eventSalesSummaries={eventSalesSummaries}
                onOpenDraft={handleOpenDraft}
                onOpenTrip={handleOpenTrip}
                onOpenLiveEvent={handleOpenLiveEvent}
              />
            )}
            ItemSeparatorComponent={() => (
              <View style={styles.mobileUpcomingSep} />
            )}
            contentContainerStyle={styles.mobileUpcomingContent}
            refreshControl={
              <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
            }
            showsVerticalScrollIndicator={false}
          />
        </View>
        // orch-0974-lock-pane:end-mobile-populated
      )}

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

      {/* ORCH-1108 — pending-invite Accept/Decline sheet. */}
      {pendingInvite !== null ? (
        <InvitePendingSheet
          visible
          invitationId={pendingInvite.invitationId}
          brandName={pendingInvite.brandName}
          onClose={() => setPendingInvite(null)}
          onResolved={(kind, brandName) => {
            setToast({
              visible: true,
              message:
                kind === "accepted"
                  ? `You've joined ${brandName}`
                  : "Invitation declined",
            });
          }}
        />
      ) : null}

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
    paddingBottom: spacing.sm,
  },
  // ORCH-1038 — to-do toggle wrapper: matches the top bar's horizontal padding
  // so the toggle is flush + the same width as the bar above it.
  todoWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    paddingBottom: spacing.xl * 4,
    gap: spacing.md,
  },
  desktopOuterScroll: {
    flex: 1,
  },
  desktopScroll: {
    flex: 1,
    flexGrow: 1,
    minHeight: 0,
    paddingHorizontal: 0,
    paddingTop: spacing.sm,
    paddingBottom: 0,
  },
  desktopKpiGrid: {
    flexDirection: "row",
    gap: spacing.sm,
    flexShrink: 0,
  },
  desktopKpiCell: {
    flex: 1,
    minWidth: 0,
  },
  desktopUpcomingPane: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  },
  desktopUpcomingList: {
    flex: 1,
    minHeight: 0,
    marginTop: spacing.sm,
  },
  emptyScroll: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    paddingBottom: spacing.xl * 4,
  },
  mobileBody: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  mobileNoVenueBody: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  lockedZone: {
    flexShrink: 0,
  },
  mobileKpiStack: {
    gap: spacing.sm,
  },
  mobileSectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 0,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  mobileUpcomingList: {
    flex: 1,
    minHeight: 0,
  },
  mobileUpcomingContent: {
    paddingBottom: spacing.xl * 4,
  },
  mobileUpcomingSep: {
    height: spacing.sm,
  },
  smallPhoneLadderHost: {
    flexShrink: 0,
    paddingTop: spacing.sm,
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
  // ORCH-0965 — scan-QR action inside live hero (event-kind only).
  heroScanAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    alignSelf: "flex-start",
    marginTop: spacing.md,
  },
  heroScanActionText: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "600",
    color: accent.warm,
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
  nextActionChooser: {
    marginBottom: spacing.md,
  },

  // Event rows ----------------------------------------------------------
  eventsCol: {
    gap: spacing.sm,
  },
  desktopEventsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 0,
    marginHorizontal: -spacing.xs,
    paddingBottom: spacing.lg,
  },
  desktopEventCell: {
    width: "25%",
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.sm,
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
});
