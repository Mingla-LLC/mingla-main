/**
 * Home tab — Cycle 1 Account anchor.
 *
 * States:
 *   - Empty (brands.length === 0)              → "No brands yet" prompt + topbar chip CTA
 *   - Populated, no live event (currentBrand)  → 7-day aggregate hero + KPI grid + Build CTA
 *   - Populated with live event                → Live KPI hero + KPI grid + Upcoming list + Build CTA
 *
 * Brand-chip on TopBar opens BrandSwitcherSheet (mode auto-derives from list state).
 * Sheet's onBrandCreated → Toast "{displayName} is ready" (per dispatch AC#2).
 *
 * Cycle 3 wires draft rows from draftEventStore.
 * ORCH-0754 wires live rows from liveEventStore + orderStore metrics, so the
 * first-screen event story is derived from current-brand local event truth.
 */

import React, { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandDeleteSheet } from "../../src/components/brand/BrandDeleteSheet";
import { BrandSwitcherSheet } from "../../src/components/brand/BrandSwitcherSheet";
import { EventCover } from "../../src/components/ui/EventCover";
import { GlassCard } from "../../src/components/ui/GlassCard";
import { Icon } from "../../src/components/ui/Icon";
import { KpiTile } from "../../src/components/ui/KpiTile";
import { Pill } from "../../src/components/ui/Pill";
import { Toast } from "../../src/components/ui/Toast";
import { TopBar } from "../../src/components/ui/TopBar";
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
  useBrandList,
  useCurrentBrandStore,
  type Brand,
} from "../../src/store/currentBrandStore";
import { useCurrentBrand } from "../../src/hooks/useCurrentBrand";
import {
  useDraftsForBrand,
  type DraftEvent,
} from "../../src/store/draftEventStore";
import {
  useLiveEventsForBrand,
  type LiveEvent,
} from "../../src/store/liveEventStore";
import { useOrderStore } from "../../src/store/orderStore";
import {
  buildBrandEventSummary,
  type BrandEventSummaryCounts,
  type BrandEventSummaryItem,
} from "../../src/utils/brandEventSummary";
import { formatGbpRound } from "../../src/utils/currency";
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

const formatSoldOutOfCapacity = (event: LiveEvent, sold: number): string => {
  const capacity = finiteTicketCapacity(event);
  const soldLabel = sold.toLocaleString("en-GB");
  if (capacity === null) return soldLabel;
  return `${soldLabel} / ${capacity.toLocaleString("en-GB")}`;
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
  const brands = useBrandList();
  const currentBrand = useCurrentBrand();
  const setCurrentBrand = useCurrentBrandStore((s) => s.setCurrentBrand);
  const drafts = useDraftsForBrand(currentBrand?.id ?? null);
  const liveEvents = useLiveEventsForBrand(currentBrand?.id ?? null);
  const orderEntries = useOrderStore((s) => s.entries);
  const getSoldCountForEvent = useOrderStore((s) => s.getSoldCountForEvent);
  const getRevenueForEvent = useOrderStore((s) => s.getRevenueForEvent);
  const [sheetVisible, setSheetVisible] = useState<boolean>(false);
  // Cycle 17e-A REWORK: BrandDeleteSheet state — opens from BrandSwitcherSheet
  // trash icon taps. Mirrors account.tsx pattern per ORCH-0734-RW SPEC §3.3.
  const [deleteSheetVisible, setDeleteSheetVisible] = useState<boolean>(false);
  const [brandPendingDelete, setBrandPendingDelete] = useState<Brand | null>(
    null,
  );
  const [toast, setToast] = useState<ToastState>({ visible: false, message: "" });

  const handleOpenSwitcher = useCallback((): void => {
    setSheetVisible(true);
  }, []);

  const handleCloseSheet = useCallback((): void => {
    setSheetVisible(false);
  }, []);

  const handleBrandCreated = useCallback((brand: Brand): void => {
    setToast({ visible: true, message: `${brand.displayName} is ready` });
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
      setToast({ visible: true, message: "Create a brand first." });
      setSheetVisible(true);
      return;
    }
    router.push("/event/create" as never);
  }, [currentBrand, router]);

  const handleSeeAllEvents = useCallback((): void => {
    router.push("/(tabs)/events" as never);
  }, [router]);

  const handleOpenDraft = useCallback(
    (draftId: string): void => {
      router.push(`/event/${draftId}/edit` as never);
    },
    [router],
  );

  const handleOpenLiveEvent = useCallback(
    (eventId: string): void => {
      router.push(`/event/${eventId}` as never);
    },
    [router],
  );

  const isEmpty = brands.length === 0 || currentBrand === null;
  const eventSummary = useMemo(
    () => buildBrandEventSummary(liveEvents, drafts),
    [liveEvents, drafts],
  );
  const primaryLiveEvent = getLiveEventFromItem(eventSummary.primaryLiveItem);

  const liveHeroMetrics = useMemo(() => {
    void orderEntries;

    if (primaryLiveEvent === null) {
      return {
        revenueGbp: 0,
        soldCount: 0,
        capacity: null as number | null,
        progress: 0,
      };
    }

    const capacity = finiteTicketCapacity(primaryLiveEvent);
    const soldCount = getSoldCountForEvent(primaryLiveEvent.id);
    return {
      revenueGbp: getRevenueForEvent(primaryLiveEvent.id),
      soldCount,
      capacity,
      progress:
        capacity !== null && capacity > 0
          ? Math.min(1, soldCount / capacity)
          : 0,
    };
  }, [
    primaryLiveEvent,
    orderEntries,
    getSoldCountForEvent,
    getRevenueForEvent,
  ]);

  return (
    <View style={[styles.host, { paddingTop: insets.top }]}>
      <View style={styles.barWrap}>
        <TopBar leftKind="brand" onBrandTap={handleOpenSwitcher} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {isEmpty ? (
          <View style={styles.emptyCol}>
            <GlassCard variant="elevated" padding={spacing.lg}>
              <Text style={styles.greetingTier}>{greetingLabel()}</Text>
              <Text style={styles.emptyTitle}>No brands yet</Text>
              <Text style={styles.emptyBody}>
                Tap{" "}
                <Text style={styles.emptyChipName}>Create brand</Text>
                {" "}in the top bar to set up your first brand. You can edit it
                any time.
              </Text>
            </GlassCard>
          </View>
        ) : (
          <>
            <View style={styles.greetingCol}>
              <Text style={styles.greetingTier}>{greetingLabel()}</Text>
              <Text style={styles.greetingHey}>Hey, {currentBrand.displayName}</Text>
            </View>

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
                    {formatGbpRound(liveHeroMetrics.revenueGbp)}
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
                      {liveHeroMetrics.soldCount.toLocaleString("en-GB")}
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
                value={formatGbpRound(currentBrand.stats.rev)}
                delta="+18%"
                deltaUp
              />
            )}

            <View style={styles.kpiGrid}>
              <KpiTile
                label="Active events"
                value={eventSummary.counts.active}
                sub={formatActiveEventsSub(eventSummary.counts)}
                style={styles.kpiCell}
              />
              <KpiTile
                label="Followers"
                value={currentBrand.stats.followers.toLocaleString("en-GB")}
                sub="audience"
                style={styles.kpiCell}
              />
            </View>

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
                    Build an event to see it here.
                  </Text>
                </GlassCard>
              ) : (
                eventSummary.activeItems.map((item) => {
                  if (item.kind === "draft") {
                    const draft = item.event as DraftEvent;
                    return (
                      <Pressable
                        key={item.key}
                        onPress={() => handleOpenDraft(draft.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`Resume draft: ${
                          draft.name || "Untitled"
                        }`}
                        style={styles.eventRow}
                      >
                        <View style={styles.eventCoverWrap}>
                          <EventCover
                            hue={draft.coverHue}
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
                  const soldCount = getSoldCountForEvent(event.id);
                  const isLive = item.status === "live";

                  return (
                    <Pressable
                      key={item.key}
                      onPress={() => handleOpenLiveEvent(event.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Open event: ${
                        event.name || "Untitled"
                      }`}
                      style={styles.eventRow}
                    >
                      <View style={styles.eventCoverWrap}>
                        <EventCover
                          hue={event.coverHue}
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
                          {formatSoldOutOfCapacity(event, soldCount)}
                        </Text>
                        <Text style={styles.eventSoldLabel}>sold</Text>
                      </View>
                    </Pressable>
                  );
                })
              )}
            </View>

            <Pressable
              onPress={handleBuildEvent}
              accessibilityRole="button"
              accessibilityLabel="Build a new event"
              style={styles.buildCta}
            >
              <View style={styles.buildCtaIconWrap}>
                <Icon name="plus" size={20} color={accent.warm} />
              </View>
              <View style={styles.buildCtaTextCol}>
                <Text style={styles.buildCtaTitle}>Build a new event</Text>
                <Text style={styles.buildCtaSub}>About 4 minutes</Text>
              </View>
            </Pressable>
          </>
        )}
      </ScrollView>

      <BrandSwitcherSheet
        visible={sheetVisible}
        onClose={handleCloseSheet}
        onBrandCreated={handleBrandCreated}
        onRequestDeleteBrand={handleRequestDeleteBrand}
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

  // Greeting ------------------------------------------------------------
  greetingCol: {
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.xs,
  },
  greetingTier: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "700",
    letterSpacing: 0.4,
    color: textTokens.tertiary,
    textTransform: "uppercase",
  },
  greetingHey: {
    fontSize: typography.h1.fontSize,
    lineHeight: typography.h1.lineHeight,
    fontWeight: typography.h1.fontWeight,
    letterSpacing: typography.h1.letterSpacing,
    color: textTokens.primary,
    marginTop: 4,
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

  // KPI grid ------------------------------------------------------------
  kpiGrid: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  kpiCell: {
    flex: 1,
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
  },
  eventSoldValue: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  eventSoldLabel: {
    fontSize: 10,
    color: textTokens.tertiary,
  },

  // Build CTA -----------------------------------------------------------
  buildCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderColor: accent.border,
    backgroundColor: accent.tint,
    borderStyle: "dashed",
    marginTop: spacing.sm,
  },
  buildCtaIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
    alignItems: "center",
    justifyContent: "center",
  },
  buildCtaTextCol: {
    flex: 1,
  },
  buildCtaTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  buildCtaSub: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    marginTop: 2,
  },
});
