/**
 * Events tab — Cycle 9a full pipeline view.
 *
 * Founder's home for managing their event pipeline. Five filter pills
 * (All / Live / Upcoming / Drafts / Past) drive a unified list of
 * EventListCards. Manage menu Sheet exposes 11 context-aware actions.
 *
 * Lives INSIDE `(tabs)` group → tab bar visible, founder-context only
 * (per `feedback_anon_buyer_routes.md` — buyer routes live OUTSIDE tabs).
 *
 * Cycle 3 originally lit drafts only; Cycle 9a replaces with full
 * pipeline view per Const #8 (subtract before adding — old drafts-only
 * footer note removed cleanly).
 *
 * Per Cycle 9 spec §3.A.2.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandSwitcherSheet } from "../../src/components/brand/BrandSwitcherSheet";
import { GlassCard } from "../../src/components/ui/GlassCard";
import { IconChrome } from "../../src/components/ui/IconChrome";
import { ShareModal } from "../../src/components/ui/ShareModal";
import { Toast } from "../../src/components/ui/Toast";
import { TopBar } from "../../src/components/ui/TopBar";
import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../src/constants/designSystem";
import {
  useCurrentBrand,
  type Brand,
} from "../../src/store/currentBrandStore";
import { useDraftsForBrand } from "../../src/store/draftEventStore";
import type { DraftEvent } from "../../src/store/draftEventStore";
import {
  useLiveEventsForBrand,
} from "../../src/store/liveEventStore";
import type { LiveEvent } from "../../src/store/liveEventStore";

import {
  EventListCard,
  type EventCardStatus,
} from "../../src/components/event/EventListCard";
import { EventManageMenu } from "../../src/components/event/EventManageMenu";

type EventFilter = "all" | "live" | "upcoming" | "draft" | "past";

interface ToastState {
  visible: boolean;
  message: string;
}

interface ManageContext {
  event: LiveEvent | DraftEvent;
  kind: "live" | "draft";
  status: EventCardStatus;
}

const canonicalEventUrl = (event: LiveEvent): string =>
  `https://business.mingla.com/e/${event.brandSlug}/${event.eventSlug}`;

const deriveLiveStatus = (event: LiveEvent): EventCardStatus => {
  if (event.status === "cancelled") return "past";
  if (event.endedAt !== null) return "past";
  if (event.date === null) return "upcoming";
  const eventTime = new Date(event.date).getTime();
  if (!Number.isFinite(eventTime)) return "upcoming";
  const liveWindowStart = eventTime - 4 * 60 * 60 * 1000;
  const liveWindowEnd = eventTime + 24 * 60 * 60 * 1000;
  const now = Date.now();
  if (now >= liveWindowStart && now < liveWindowEnd) return "live";
  if (now < liveWindowStart) return "upcoming";
  return "past";
};

interface PillSpec {
  key: EventFilter;
  label: string;
  count: number;
  showLivePulse?: boolean;
}

export default function EventsTab(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const currentBrand = useCurrentBrand();
  const drafts = useDraftsForBrand(currentBrand?.id ?? null);
  const liveEvents = useLiveEventsForBrand(currentBrand?.id ?? null);

  const [sheetVisible, setSheetVisible] = useState<boolean>(false);
  const [toast, setToast] = useState<ToastState>({
    visible: false,
    message: "",
  });
  const [manageCtx, setManageCtx] = useState<ManageContext | null>(null);
  const [shareEvent, setShareEvent] = useState<LiveEvent | null>(null);

  // ----- Categorize events into status buckets -------------------
  const liveEventEntries = useMemo<
    Array<{ event: LiveEvent; status: EventCardStatus }>
  >(() => {
    return liveEvents.map((e) => ({ event: e, status: deriveLiveStatus(e) }));
  }, [liveEvents]);

  const counts = useMemo<Record<EventFilter, number>>(() => {
    const c: Record<EventFilter, number> = {
      all: liveEvents.length + drafts.length,
      live: liveEventEntries.filter((e) => e.status === "live").length,
      upcoming: liveEventEntries.filter((e) => e.status === "upcoming").length,
      draft: drafts.length,
      past: liveEventEntries.filter((e) => e.status === "past").length,
    };
    return c;
  }, [liveEvents.length, drafts.length, liveEventEntries]);

  // Default filter: Upcoming (Q-9-12); fallback chain.
  const defaultFilter = useMemo<EventFilter>((): EventFilter => {
    if (counts.upcoming > 0) return "upcoming";
    if (counts.live > 0) return "live";
    if (counts.draft > 0) return "draft";
    if (counts.past > 0) return "past";
    return "all";
  }, [counts]);

  const [filter, setFilter] = useState<EventFilter>(defaultFilter);

  // ----- Filtered list (in display order: live → upcoming → past, then drafts) -----
  const filteredItems = useMemo<
    Array<{
      key: string;
      event: LiveEvent | DraftEvent;
      kind: "live" | "draft";
      status: EventCardStatus;
    }>
  >(() => {
    const liveItems = liveEventEntries.map((e) => ({
      key: `live-${e.event.id}`,
      event: e.event,
      kind: "live" as const,
      status: e.status,
    }));
    const draftItems = drafts.map((d) => ({
      key: `draft-${d.id}`,
      event: d,
      kind: "draft" as const,
      status: "draft" as EventCardStatus,
    }));
    const all = [...liveItems, ...draftItems];

    const filtered = (() => {
      if (filter === "all") return all;
      if (filter === "draft") return draftItems;
      return liveItems.filter((i) => i.status === filter);
    })();

    // Sort: live first, then upcoming (date asc), then past (date desc), then drafts (updatedAt desc)
    return filtered.slice().sort((a, b) => {
      const orderRank: Record<EventCardStatus, number> = {
        live: 0,
        upcoming: 1,
        past: 2,
        draft: 3,
      };
      const aRank = orderRank[a.status];
      const bRank = orderRank[b.status];
      if (aRank !== bRank) return aRank - bRank;
      // same status — secondary sort
      if (a.status === "upcoming") {
        const ad = (a.event as LiveEvent).date ?? "";
        const bd = (b.event as LiveEvent).date ?? "";
        return ad.localeCompare(bd);
      }
      if (a.status === "past") {
        const ad = (a.event as LiveEvent).date ?? "";
        const bd = (b.event as LiveEvent).date ?? "";
        return bd.localeCompare(ad);
      }
      if (a.status === "draft") {
        const aU = (a.event as DraftEvent).updatedAt ?? "";
        const bU = (b.event as DraftEvent).updatedAt ?? "";
        return bU.localeCompare(aU);
      }
      return 0;
    });
  }, [filter, liveEventEntries, drafts]);

  // ----- Pill specs ----------------------------------------------
  const pillSpecs = useMemo<PillSpec[]>(
    () => [
      { key: "all", label: "All", count: counts.all },
      {
        key: "live",
        label: "Live",
        count: counts.live,
        showLivePulse: counts.live > 0,
      },
      { key: "upcoming", label: "Upcoming", count: counts.upcoming },
      { key: "draft", label: "Drafts", count: counts.draft },
      { key: "past", label: "Past", count: counts.past },
    ],
    [counts],
  );

  // ----- Handlers -------------------------------------------------
  const handleOpenSwitcher = useCallback((): void => {
    setSheetVisible(true);
  }, []);

  const handleCloseSheet = useCallback((): void => {
    setSheetVisible(false);
  }, []);

  const handleBrandCreated = useCallback((brand: Brand): void => {
    setToast({ visible: true, message: `${brand.displayName} is ready` });
  }, []);

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

  const handleOpenItem = useCallback(
    (item: {
      event: LiveEvent | DraftEvent;
      kind: "live" | "draft";
    }): void => {
      if (item.kind === "draft") {
        router.push(`/event/${item.event.id}/edit` as never);
      } else {
        router.push(`/event/${item.event.id}` as never);
      }
    },
    [router],
  );

  const handleManageOpen = useCallback(
    (item: {
      event: LiveEvent | DraftEvent;
      kind: "live" | "draft";
      status: EventCardStatus;
    }): void => {
      setManageCtx({
        event: item.event,
        kind: item.kind,
        status: item.status,
      });
    },
    [],
  );

  const handleManageClose = useCallback((): void => {
    setManageCtx(null);
  }, []);

  const showTransitionalToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  const handleManageEdit = useCallback((): void => {
    if (manageCtx === null) return;
    router.push(`/event/${manageCtx.event.id}/edit` as never);
    setManageCtx(null);
  }, [manageCtx, router]);

  const handleManageViewPublic = useCallback((): void => {
    if (manageCtx === null || manageCtx.kind !== "live") return;
    const live = manageCtx.event as LiveEvent;
    router.push(`/e/${live.brandSlug}/${live.eventSlug}` as never);
    setManageCtx(null);
  }, [manageCtx, router]);

  const handleManageShare = useCallback((): void => {
    if (manageCtx === null || manageCtx.kind !== "live") return;
    setShareEvent(manageCtx.event as LiveEvent);
    setManageCtx(null);
  }, [manageCtx]);

  // ----- Render ---------------------------------------------------
  return (
    <View style={[styles.host, { paddingTop: insets.top }]}>
      <View style={styles.barWrap}>
        <TopBar
          leftKind="brand"
          onBrandTap={handleOpenSwitcher}
          rightSlot={
            <IconChrome
              icon="plus"
              size={36}
              onPress={handleBuildEvent}
              accessibilityLabel="Build a new event"
            />
          }
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.headerTitle}>Events</Text>

        {/* Filter pills row */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pillsRow}
          style={styles.pillsScroll}
        >
          {pillSpecs.map((p) => {
            const active = filter === p.key;
            return (
              <Pressable
                key={p.key}
                onPress={() => setFilter(p.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${p.label}, ${p.count}`}
                style={({ pressed }) => [
                  styles.pill,
                  active && styles.pillActive,
                  pressed && styles.pillPressed,
                ]}
              >
                {p.showLivePulse ? (
                  <View style={styles.pillLiveDot} />
                ) : null}
                <Text style={[styles.pillLabel, active && styles.pillLabelActive]}>
                  {p.label}
                </Text>
                <Text
                  style={[styles.pillCount, active && styles.pillCountActive]}
                >
                  {p.count}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* List */}
        {filteredItems.length === 0 ? (
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.emptyTitle}>
              {filter === "all"
                ? "No events yet"
                : "No events here"}
            </Text>
            <Text style={styles.emptyBody}>
              {filter === "all"
                ? 'Tap the + button above to start your first event.'
                : filter === "draft"
                  ? "No drafts in progress. Tap + to build one."
                  : `Tap "All" to see everything.`}
            </Text>
            {filter === "all" || filter === "draft" ? (
              <Pressable
                onPress={handleBuildEvent}
                accessibilityRole="button"
                accessibilityLabel="Build a new event"
                style={styles.emptyCta}
              >
                <Text style={styles.emptyCtaLabel}>Build a new event</Text>
              </Pressable>
            ) : null}
          </GlassCard>
        ) : currentBrand !== null ? (
          <View style={styles.list}>
            {filteredItems.map((item) => (
              <EventListCard
                key={item.key}
                event={item.event}
                kind={item.kind}
                brand={currentBrand}
                status={item.status}
                onOpen={() => handleOpenItem(item)}
                onManageOpen={() => handleManageOpen(item)}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>

      <BrandSwitcherSheet
        visible={sheetVisible}
        onClose={handleCloseSheet}
        onBrandCreated={handleBrandCreated}
      />

      {/* Manage menu — Sheet primitive */}
      {manageCtx !== null && currentBrand !== null ? (
        <EventManageMenu
          visible
          onClose={handleManageClose}
          event={manageCtx.event}
          status={manageCtx.status}
          brand={currentBrand}
          onShare={handleManageShare}
          onEdit={handleManageEdit}
          onViewPublic={handleManageViewPublic}
          onTransitionalToast={showTransitionalToast}
        />
      ) : null}

      {/* Share modal — opened from manage menu */}
      {shareEvent !== null ? (
        <ShareModal
          visible
          onClose={() => setShareEvent(null)}
          url={canonicalEventUrl(shareEvent)}
          title={`${shareEvent.name} on Mingla`}
          description={shareEvent.description.slice(0, 200) || shareEvent.name}
        />
      ) : null}

      {/* Toast wrap — absolute-positioned per memory rule */}
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
    gap: spacing.md,
  },
  headerTitle: {
    fontSize: typography.h1.fontSize,
    lineHeight: typography.h1.lineHeight,
    fontWeight: typography.h1.fontWeight,
    letterSpacing: typography.h1.letterSpacing,
    color: textTokens.primary,
    marginBottom: spacing.sm,
  },
  pillsScroll: {
    marginHorizontal: -spacing.md,
  },
  pillsRow: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  pill: {
    height: 34,
    paddingHorizontal: spacing.md - 2,
    borderRadius: radiusTokens.full,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  pillActive: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  pillPressed: {
    opacity: 0.7,
  },
  pillLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: textTokens.primary,
  },
  pillLabelActive: {
    color: textTokens.primary,
  },
  pillCount: {
    fontSize: 11,
    fontWeight: "600",
    color: textTokens.tertiary,
    fontVariant: ["tabular-nums"],
  },
  pillCountActive: {
    color: accent.warm,
  },
  pillLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: semantic.success,
  },
  list: {
    gap: spacing.sm,
  },
  emptyTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    letterSpacing: typography.h3.letterSpacing,
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  emptyBody: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    marginBottom: spacing.md,
  },
  emptyCta: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
    alignSelf: "flex-start",
  },
  emptyCtaLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
  toastWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: spacing.xl,
    paddingHorizontal: spacing.md,
    zIndex: 100,
    elevation: 12,
  },
});
