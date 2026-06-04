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

import { ConfirmDialog } from "../../../src/components/ui/ConfirmDialog";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { ShareModal } from "../../../src/components/ui/ShareModal";
import { Toast } from "../../../src/components/ui/Toast";
import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import { DESKTOP_HUB_GRID_COLUMNS } from "../../../src/constants/desktopLayout";
import { useCurrentBrand } from "../../../src/hooks/useCurrentBrand";
import { useBrandOfferingCounts } from "../../../src/hooks/useBrandOfferingCounts";
import { useResponsiveLayout } from "../../../src/hooks/useResponsiveLayout";
import { useHubCreatorStore } from "../../../src/store/hubCreatorStore";
import {
  useDraftEventStore,
  useDraftsForBrand,
} from "../../../src/store/draftEventStore";
import type { DraftEvent } from "../../../src/store/draftEventStore";
import {
  useLiveEventStore,
  useLiveEventsForBrand,
} from "../../../src/store/liveEventStore";
import type { LiveEvent } from "../../../src/store/liveEventStore";

import {
  EventListCard,
  type EventCardStatus,
} from "../../../src/components/event/EventListCard";
import { EndSalesSheet } from "../../../src/components/event/EndSalesSheet";
import { EventManageMenu } from "../../../src/components/event/EventManageMenu";
import { useCurrentBrandRole } from "../../../src/hooks/useCurrentBrandRole";
import {
  useDiscardServerDraft,
  useServerDraftsForBrand,
} from "../../../src/hooks/useServerDraftEvents";
import {
  mergeServerAndLegacyLiveEvents,
  useCancelBusinessEvent,
  useBusinessEventsForBrand,
  useEndBusinessEventTicketSales,
} from "../../../src/hooks/useBusinessEvents";
import { eventPublicUrl } from "../../../src/constants/publicUrls";
import { canPerformAction } from "../../../src/utils/permissionGates";
// ORCH-0865 REWORK 5 — canonical routing helper, ban hardcoded /event/{id}
import { routeForEventRowDefensive } from "../../../src/utils/routeForEventRow";
// ORCH-0850 [End-not-start parity systemic]: route past/upcoming/live decision
// through the canonical helper via the sibling .ts wrapper. Pre-0850 local
// `deriveLiveStatus` used `new Date(event.date).getTime()` which parses
// YYYY-MM-DD as UTC midnight — any US-Eastern event flipped to "past" at
// 8pm EDT on its start day. The wrapper lives in `./eventCardStatus.ts` so
// the regression test can import it without pulling this screen's JSX.
import { deriveCardStatus } from "./eventCardStatus";

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

// ORCH-0850: local deriveLiveStatus deleted; deriveCardStatus imported from
// ./eventCardStatus (sibling .ts file — see import block above).

const isLocalOnlyDraft = (draft: DraftEvent): boolean =>
  draft.id.startsWith("d_") || draft.serverSlug === null;

const draftDeleteErrorMessage = (error: unknown): string => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (message.includes("insufficient_event_permission")) {
    return "You do not have permission to delete this draft for this brand.";
  }
  return "Could not delete this draft. Try again.";
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
  const { isWideDesktop } = useResponsiveLayout();
  const currentBrand = useCurrentBrand();
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
  const serverBackedEventIds = useMemo(
    () => new Set((businessEventsQuery.data ?? []).map((event) => event.id)),
    [businessEventsQuery.data],
  );

  // Cycle 13a J-T6 G7: "Create event" CTA gated on CREATE_EVENT
  // (event_manager+). Hooks run on every render before any early-return shell.
  const { rank: currentRank } = useCurrentBrandRole(currentBrand?.id ?? null);
  const canCreateEvent = canPerformAction(currentRank, "CREATE_EVENT");

  // META-ORCH-1059 (bug #5): the Hub lands on /hub/events, so when a brand has
  // created NOTHING at all (no events, trips, OR experiences) the events-tab
  // empty state must be UNIVERSAL — "Nothing created yet" + "Create your first
  // offering" → the shared offering chooser — not event-biased. When the brand
  // HAS other offerings (just no events), keep the event-specific copy.
  const offeringCounts = useBrandOfferingCounts(currentBrand?.id ?? null);
  const hasNoOfferingsAtAll =
    offeringCounts.data !== undefined &&
    offeringCounts.data.events === 0 &&
    offeringCounts.data.trips === 0 &&
    offeringCounts.data.experiences === 0;
  const openOfferingChooser = useHubCreatorStore((s) => s.open);

  // ORCH-0826 M0-rework: brand-switcher / brand-delete / universal-creator
  // state lives in hub/_layout.tsx now. This screen only holds content state.
  const [toast, setToast] = useState<ToastState>({
    visible: false,
    message: "",
  });
  const [manageCtx, setManageCtx] = useState<ManageContext | null>(null);
  const [shareEvent, setShareEvent] = useState<LiveEvent | null>(null);
  // 9b-1 lifecycle action state — End sales + Cancel event + Delete draft
  const [endSalesEvent, setEndSalesEvent] = useState<LiveEvent | null>(null);
  const [cancelEvent, setCancelEvent] = useState<LiveEvent | null>(null);
  const [cancelSubmitting, setCancelSubmitting] = useState<boolean>(false);
  const [deleteDraftCtx, setDeleteDraftCtx] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [deleteDraftSubmitting, setDeleteDraftSubmitting] = useState<boolean>(false);
  const [deleteDraftError, setDeleteDraftError] = useState<string | null>(null);

  // Mutations for lifecycle actions (9b-1)
  const updateLifecycle = useLiveEventStore((s) => s.updateLifecycle);
  const deleteLocalDraft = useDraftEventStore((s) => s.deleteDraft);
  const discardServerDraft = useDiscardServerDraft();
  const cancelServerEvent = useCancelBusinessEvent();
  const endServerTicketSales = useEndBusinessEventTicketSales();

  // ----- Categorize events into status buckets -------------------
  const liveEventEntries = useMemo<
    { event: LiveEvent; status: EventCardStatus }[]
  >(() => {
    return liveEvents.map((e) => ({ event: e, status: deriveCardStatus(e) }));
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
    {
      key: string;
      event: LiveEvent | DraftEvent;
      kind: "live" | "draft";
      status: EventCardStatus;
    }[]
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
  // ORCH-0826 M0-rework: brand-switcher / brand-delete handlers live in
  // hub/_layout.tsx. This screen's only handlers below are content-bound.

  const handleDismissToast = useCallback((): void => {
    setToast((prev) => ({ ...prev, visible: false }));
  }, []);

  const handleBuildEvent = useCallback((): void => {
    if (currentBrand === null) {
      // Brand switcher is owned by hub/_layout.tsx now (ORCH-0826 M0-rework).
      // User can tap the brand chip in the layout's TopBar to open the switcher.
      setToast({ visible: true, message: "Tap your brand to create one first." });
      return;
    }
    router.push("/event/create" as never);
  }, [currentBrand, router]);

  const handleOpenItem = useCallback(
    (item: {
      event: LiveEvent | DraftEvent;
      kind: "live" | "draft";
    }): void => {
      // ORCH-0865 REWORK 5: route via canonical helper so trip rows (if
      // they leak past the event_type filter) navigate to /trip/{id}
      // instead of /event/{id}. Existing rows without event_type default
      // to "event" via the defensive variant — safe for legacy DraftEvent
      // / LiveEvent stored without the field.
      router.push(
        routeForEventRowDefensive({
          id: item.event.id,
          event_type:
            (item.event as { event_type?: string }).event_type ?? "event",
          status: item.kind === "draft" ? "draft" : (item.event as LiveEvent).status,
        }) as never,
      );
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
    // Cycle 9b-2: drafts route to wizard; non-drafts (live/upcoming/past)
    // route to the focused EditPublishedScreen via ?mode=edit-published.
    const suffix =
      manageCtx.kind === "draft" ? "" : "?mode=edit-published";
    // orch-strict-grep-allow route-by-event-type — manageCtx is event-only by construction (event manage menu); trips use a separate dashboard route with no manage-menu surface yet
    router.push(`/event/${manageCtx.event.id}/edit${suffix}` as never);
    setManageCtx(null);
  }, [manageCtx, router]);

  const handleManageViewPublic = useCallback((): void => {
    if (manageCtx === null || manageCtx.kind !== "live") return;
    const live = manageCtx.event as LiveEvent;
    // orch-strict-grep-allow route-by-event-type — buyer-facing public event page; LiveEvent fed to this handler is event-only (EventListCard defensive filter rejects non-event rows)
    router.push(`/e/${live.brandSlug}/${live.eventSlug}` as never);
    setManageCtx(null);
  }, [manageCtx, router]);

  const handleManageShare = useCallback((): void => {
    if (manageCtx === null || manageCtx.kind !== "live") return;
    setShareEvent(manageCtx.event as LiveEvent);
    setManageCtx(null);
  }, [manageCtx]);

  // 9b-1 lifecycle handlers ----------------------------------------
  const handleManageEndSales = useCallback((): void => {
    if (manageCtx === null || manageCtx.kind !== "live") return;
    setEndSalesEvent(manageCtx.event as LiveEvent);
    setManageCtx(null);
  }, [manageCtx]);

  const handleEndSalesConfirm = useCallback(async (): Promise<void> => {
    if (endSalesEvent === null) return;
    if (serverBackedEventIds.has(endSalesEvent.id)) {
      try {
        await endServerTicketSales.endTicketSales({
          eventId: endSalesEvent.id,
          brandId: endSalesEvent.brandId,
        });
        setEndSalesEvent(null);
        setToast({ visible: true, message: "Ticket sales ended." });
      } catch {
        setToast({
          visible: true,
          message: "Could not end ticket sales. Try again.",
        });
      }
      return;
    }
    updateLifecycle(endSalesEvent.id, {
      endedAt: new Date().toISOString(),
    });
    setEndSalesEvent(null);
    setToast({ visible: true, message: "Ticket sales ended." });
  }, [endSalesEvent, serverBackedEventIds, updateLifecycle, endServerTicketSales]);

  const handleManageCancelEvent = useCallback((): void => {
    if (manageCtx === null || manageCtx.kind !== "live") return;
    setCancelEvent(manageCtx.event as LiveEvent);
    setManageCtx(null);
  }, [manageCtx]);

  const handleCancelEventConfirm = useCallback(async (): Promise<void> => {
    if (cancelEvent === null) return;
    if (serverBackedEventIds.has(cancelEvent.id)) {
      setCancelSubmitting(true);
      try {
        await cancelServerEvent.cancelEvent({
          eventId: cancelEvent.id,
          brandId: cancelEvent.brandId,
        });
        setCancelEvent(null);
        setToast({
          visible: true,
          message: "Event cancelled.",
        });
      } catch {
        setToast({
          visible: true,
          message: "Could not cancel event. Try again.",
        });
      } finally {
        setCancelSubmitting(false);
      }
      return;
    }
    setCancelSubmitting(true);
    // 1.2s simulated processing per Q-9-3.
    await new Promise<void>((resolve) => setTimeout(resolve, 1200));
    updateLifecycle(cancelEvent.id, {
      status: "cancelled",
      cancelledAt: new Date().toISOString(),
    });
    setCancelSubmitting(false);
    setCancelEvent(null);
    // [TRANSITIONAL] Buyer email cascade is a no-op stub — B-cycle wires Resend.
    setToast({
      visible: true,
      message:
        "Event cancelled. Buyers will be refunded when emails wire up (B-cycle).",
    });
  }, [cancelEvent, serverBackedEventIds, updateLifecycle, cancelServerEvent]);

  const handleManageDeleteDraft = useCallback((): void => {
    if (manageCtx === null || manageCtx.kind !== "draft") return;
    const draft = manageCtx.event as DraftEvent;
    setDeleteDraftCtx({
      id: draft.id,
      name: draft.name.length > 0 ? draft.name : "Untitled draft",
    });
    setDeleteDraftError(null);
    setManageCtx(null);
  }, [manageCtx]);

  const handleCloseDeleteDraft = useCallback((): void => {
    if (deleteDraftSubmitting) return;
    setDeleteDraftCtx(null);
    setDeleteDraftError(null);
  }, [deleteDraftSubmitting]);

  const handleDeleteDraftConfirm = useCallback(async (): Promise<void> => {
    if (deleteDraftCtx === null) return;
    const draft = drafts.find((d) => d.id === deleteDraftCtx.id);
    if (draft === undefined) {
      setDeleteDraftCtx(null);
      setDeleteDraftError(null);
      return;
    }
    setDeleteDraftError(null);
    if (isLocalOnlyDraft(draft)) {
      deleteLocalDraft(draft.id);
      setDeleteDraftCtx(null);
      setToast({ visible: true, message: "Draft deleted." });
      return;
    }

    setDeleteDraftSubmitting(true);
    try {
      await discardServerDraft.discardDraft(draft);
      setDeleteDraftCtx(null);
      setToast({ visible: true, message: "Draft deleted." });
    } catch (error) {
      setDeleteDraftError(draftDeleteErrorMessage(error));
    } finally {
      setDeleteDraftSubmitting(false);
    }
  }, [deleteDraftCtx, deleteLocalDraft, discardServerDraft, drafts]);

  // ----- Render ---------------------------------------------------
  // ORCH-0826 M0-rework: TopBar and "Events" header title are owned by
  // hub/_layout.tsx (above the HubSubNav pill row). This sub-route is a
  // content-only screen — paddingTop and brand/universal-creator chrome
  // are layout-supplied.
  return (
    <View style={styles.host}>
      {/* Filter pills row — fixed at top, does NOT scroll with the event list.
          Sibling to the events ScrollView so it stays anchored below the
          HubSubNav pill row regardless of list scroll position. */}
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
              // ORCH-0857 [Hub pill 44pt hit target]: pill visual height stays at
              // 34pt for row compactness; hitSlop carries WCAG AA / I-38 compliance.
              // 5pt top + 5pt bottom = 44pt total touch area.
              hitSlop={{ top: 5, bottom: 5, left: 0, right: 0 }}
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

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          // Bottom nav clearance — BottomNav primitive is 64px tall +
          // ~16-32px floating margin + safe-area inset. Generous 120
          // ensures the last event card is fully visible above the nav
          // even on phones with home-indicator bottom inset.
          { paddingBottom: insets.bottom + 120 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* List */}
        {filteredItems.length === 0 ? (
          filter === "all" && hasNoOfferingsAtAll ? (
            // META-ORCH-1059 (bug #5) — UNIVERSAL empty state: the brand has
            // created nothing of ANY kind. No event bias; the CTA opens the
            // shared offering chooser (Event / Experience / Trip).
            <GlassCard variant="elevated" padding={spacing.lg}>
              <Text style={styles.emptyTitle}>Nothing created yet</Text>
              <Text style={styles.emptyBody}>
                Create your first offering — an event, an experience, or a trip — and
                it&apos;ll show up here.
              </Text>
              {canCreateEvent ? (
                <Pressable
                  onPress={openOfferingChooser}
                  accessibilityRole="button"
                  accessibilityLabel="Create your first offering"
                  style={styles.emptyCta}
                  testID="hub-empty-create-offering"
                >
                  <Text style={styles.emptyCtaLabel}>Create your first offering</Text>
                </Pressable>
              ) : null}
            </GlassCard>
          ) : (
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
              {(filter === "all" || filter === "draft") && canCreateEvent ? (
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
          )
        ) : currentBrand !== null ? (
          <View style={[styles.list, isWideDesktop && styles.desktopListGrid]}>
            {filteredItems.map((item) => (
              <View
                key={item.key}
                style={isWideDesktop ? styles.desktopListCell : undefined}
              >
                <EventListCard
                  event={item.event}
                  kind={item.kind}
                  brand={currentBrand}
                  status={item.status}
                  onOpen={() => handleOpenItem(item)}
                  onManageOpen={() => handleManageOpen(item)}
                />
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      {/* ORCH-0826 M0-rework: BrandSwitcherSheet, UniversalCreatorSheet,
          and BrandDeleteSheet are mounted in hub/_layout.tsx so that the
          three Hub sub-routes share the same chrome + sheet stack. This
          content-only screen mounts events-specific sheets below. */}

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
          onEndSales={handleManageEndSales}
          onCancelEvent={handleManageCancelEvent}
          onDeleteDraft={handleManageDeleteDraft}
          onOpenOrders={() => {
            handleManageClose();
            router.push(
              `/event/${manageCtx.event.id}/orders` as never,
            );
          }}
          onTransitionalToast={showTransitionalToast}
          canEditEvent={canPerformAction(currentRank, "EDIT_EVENT")}
          canUseLifecycleActions
        />
      ) : null}

      {/* End sales sheet — opened from manage menu's End ticket sales */}
      {endSalesEvent !== null ? (
        <EndSalesSheet
          visible
          onClose={() => setEndSalesEvent(null)}
          onConfirm={handleEndSalesConfirm}
          eventName={
            endSalesEvent.name.trim().length > 0
              ? endSalesEvent.name
              : "this event"
          }
        />
      ) : null}

      {/* Delete draft ConfirmDialog — opened from manage menu's Delete event (drafts only) */}
      <ConfirmDialog
        visible={deleteDraftCtx !== null}
        onClose={handleCloseDeleteDraft}
        onConfirm={handleDeleteDraftConfirm}
        title="Delete this draft?"
        description={
          deleteDraftCtx !== null
            ? `"${deleteDraftCtx.name}" will be permanently removed. This can't be undone.`
            : ""
        }
        variant="simple"
        confirmLabel="Delete draft"
        cancelLabel="Keep draft"
        confirmLoading={deleteDraftSubmitting}
        confirmDisabled={deleteDraftSubmitting}
        closeDisabled={deleteDraftSubmitting}
        errorMessage={deleteDraftError}
        testID="delete-draft-confirm"
        confirmTestID="delete-draft-confirm-button"
        cancelTestID="delete-draft-cancel-button"
        destructive
      />

      {/* Cancel event ConfirmDialog — typeToConfirm variant; opened from
          manage menu's Cancel event (live + upcoming). */}
      <ConfirmDialog
        visible={cancelEvent !== null}
        onClose={() => {
          if (cancelSubmitting) return;
          setCancelEvent(null);
        }}
        onConfirm={handleCancelEventConfirm}
        title="Cancel this event?"
        description="This is serious. Buyers will be notified by email and refunded automatically when those wire up (B-cycle). You can't undo this."
        variant="typeToConfirm"
        confirmText={
          cancelEvent !== null
            ? cancelEvent.name.trim().length > 0
              ? cancelEvent.name
              : cancelEvent.eventSlug
            : ""
        }
        confirmLabel="Cancel event"
        cancelLabel="Keep event live"
        destructive
      />

      {/* Share modal — opened from manage menu */}
      {shareEvent !== null ? (
        <ShareModal
          visible
          onClose={() => setShareEvent(null)}
          url={eventPublicUrl({
            brandSlug: shareEvent.brandSlug,
            eventSlug: shareEvent.eventSlug,
          })}
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
    paddingTop: spacing.lg,
    // paddingBottom is set inline on the ScrollView with insets.bottom + 120
    // to clear the floating BottomNav (64px nav + ~16-32px margin + safe-area).
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
    // ORCH-0826 M0-rework: pills are now a direct child of the host (sibling
    // to the events ScrollView) rather than nested inside it. Removed the
    // prior `marginHorizontal: -spacing.md` negative-margin hack (which was
    // cancelling the parent ScrollView's padding) and added vertical padding
    // for breathing room below the HubSubNav pill row.
    paddingVertical: spacing.sm,
    // ORCH-0857 [Hub events list flush-with-pills]: ROOT CAUSE FIX —
    // React Native's ScrollView defaults to `flexGrow: 1`, which means
    // BOTH this pills ScrollView and the sibling events ScrollView were
    // competing for the host's vertical space and splitting any leftover
    // area between them. The amount split depended on the events list's
    // intrinsic content size (filter-dependent: Live=2 → small events
    // intrinsic → pills got large share → 200pt of empty space below the
    // pills inside pillsScroll's stretched frame → events list pushed
    // ~200pt down). Pinning `flexGrow: 0` here forces pillsScroll to
    // take ONLY its intrinsic content height (~50pt = 34pt pill + 16pt
    // vertical padding) regardless of how much empty space is available,
    // so the events ScrollView sits flush against the pill row across
    // every filter (All, Live, Upcoming, Drafts, Past).
    flexGrow: 0,
    flexShrink: 0,
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
    // ORCH-0857 [Hub pill active-state visual parity]: idle border alpha
    // raised from 0.08 (glass.border.profileBase) to 0.55 to match
    // accent.border. Toggling pillActive now changes color only — never
    // perceived bounding rect. Local to this file by design (Option B);
    // do NOT extract into a shared token without auditing all other
    // glass.border.profileBase consumers first.
    borderColor: "rgba(255, 255, 255, 0.55)",
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
    // ORCH-0857 [Hub pill dot/label baseline]: explicit lineHeight gives
    // RN a deterministic cross-axis center for the pillLiveDot to align
    // against under flexDirection:"row" + alignItems:"center". Without
    // it, iOS uses font-default line-height (~16) but reports it
    // inconsistently against the 6×6 dot's geometric center, producing
    // a 1-2pt visual drift unique to the Live pill.
    lineHeight: 16,
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
