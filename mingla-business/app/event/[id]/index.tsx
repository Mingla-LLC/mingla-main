/**
 * J-E13 — Event Detail screen.
 *
 * Route: /event/{id} (id = LiveEvent.id `le_<ts36>` or DraftEvent.id `de_<ts36>`)
 *
 * Founder-side screen showing event KPIs, ticket types, and recent
 * activity. Drafts redirect to /event/{id}/edit (drafts have no detail).
 *
 * Hero (cover band + status pill + name + date+venue) → action grid (5
 * tiles: Scan, Orders, Guests, Public page, Brand page) → revenue card
 * → ticket types section → recent activity section.
 *
 * 9a renders zero KPIs / empty activity feed (orderStore lands in 9c).
 *
 * Per Cycle 9 spec §3.A.2.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../../src/constants/designSystem";
import {
  useLiveEventStore,
  type LiveEvent,
} from "../../../src/store/liveEventStore";
import { useDraftById } from "../../../src/store/draftEventStore";
import { useDoorSalesStore } from "../../../src/store/doorSalesStore";
import { useGuestStore } from "../../../src/store/guestStore";
import { useScanStore } from "../../../src/store/scanStore";
import { useEventEditLogStore } from "../../../src/store/eventEditLogStore";
import { formatDraftDateLine } from "../../../src/utils/eventDateDisplay";
import { deriveLiveStatus } from "../../../src/utils/eventLifecycle";
import { computeMasterStartAtUtc } from "../../../src/utils/eventDateMath";
import { formatCurrency, currencyCodeOrNull } from "../../../src/utils/currency";
import { summarizeEventMoney } from "../../../src/utils/moneySummary";
import { eventPublicUrl } from "../../../src/constants/publicUrls";

// Cycle 17d Stage 2 §F.4 — ActivityEvent type + activityRowKey + helpers
// extracted to ../../../src/components/event/EventDetailActivityRow.tsx.

import { Button } from "../../../src/components/ui/Button";
import { ConfirmDialog } from "../../../src/components/ui/ConfirmDialog";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { EventCoverMedia } from "../../../src/components/ui/EventCoverMedia";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { IconChrome } from "../../../src/components/ui/IconChrome";
import { ShareModal, offeringShareability } from "../../../src/components/ui/ShareModal";
import type { ShareEntityKind } from "@mingla/sharing";
import { Toast } from "../../../src/components/ui/Toast";
import { TopBar } from "../../../src/components/ui/TopBar";

import { ActionTile } from "../../../src/components/event/ActionTile";
import { EndSalesSheet } from "../../../src/components/event/EndSalesSheet";
import {
  EventDetailActivityRow,
  activityRowKey,
  type ActivityEvent,
} from "../../../src/components/event/EventDetailActivityRow";
import { EventDetailHeroStatusPill } from "../../../src/components/event/EventDetailHeroStatusPill";
import { EventDetailKpiCard } from "../../../src/components/event/EventDetailKpiCard";
import { EventDetailTicketTypeRow } from "../../../src/components/event/EventDetailTicketTypeRow";
import { EventManageMenu } from "../../../src/components/event/EventManageMenu";
import { ReconciliationCtaTile } from "../../../src/components/event/ReconciliationCtaTile";
import { useCurrentBrandRole } from "../../../src/hooks/useCurrentBrandRole";
import { useSuccessfulBusinessRecentOpen } from "../../../src/hooks/useBusinessRecent";
import { useManagedEventRoute } from "../../../src/hooks/useManagedEventRoute";
import {
  useCancelBusinessEvent,
  useEndBusinessEventTicketSales,
} from "../../../src/hooks/useBusinessEvents";
import { useEventOrders } from "../../../src/hooks/useEventOrders";
import { canPerformAction } from "../../../src/utils/permissionGates";
import { isScannerOnlyRank } from "../../../src/utils/navTabGate";
import {
  duplicateBusinessEventAsDraft,
  unpublishBusinessEventToDraft,
} from "../../../src/services/businessEvents";

const CANCEL_PROCESSING_MS = 1200;
const cancelSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ----- Status derivation (mirrors EventListCard) -------------------
//
// Cycle 13: deriveLiveStatus extracted to src/utils/eventLifecycle.ts so the
// new reconciliation route can share the same predicate (Const #2 — one owner
// per truth). The util returns 4 states (live/upcoming/past/cancelled); this
// screen collapses cancelled→past for the HeroStatusPill's existing 3-state
// ENDED treatment (no UX change).

type EventStatus = "live" | "upcoming" | "past";

const deriveScreenStatus = (event: LiveEvent): EventStatus => {
  // ORCH-0828: pass timezone-aware UTC instant (not date-only string).
  const lifecycle = deriveLiveStatus(event, computeMasterStartAtUtc(event));
  return lifecycle === "cancelled" ? "past" : lifecycle;
};

export default function EventDetailScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : null;

  // ----- Resolve event -------------------------------------------
  const routeEvent = useManagedEventRoute(id);
  const resolvedLiveEvent = routeEvent.event;
  const draftEvent = useDraftById(id);
  const brand = routeEvent.brand;
  const isServerBackedEvent = routeEvent.isServerBacked;

  // Cycle 13a J-T6 G1: gate Edit / End sales / Cancel / Delete on EDIT_EVENT.
  // Hook ordering: ALL hooks run on every render before any early-return shell.
  const currentBrandRole = useCurrentBrandRole(brand?.id ?? null);
  const canEditEvent = canPerformAction(currentBrandRole.rank, "EDIT_EVENT");
  const canShowListingInsights =
    !currentBrandRole.isLoading &&
    !currentBrandRole.isError &&
    currentBrandRole.role !== null &&
    !isScannerOnlyRank(currentBrandRole.rank);

  // ----- Defensive: draft → redirect to edit ---------------------
  useEffect(() => {
    if (id === null) return;
    if (routeEvent.replacementEventId !== null) {
      router.replace(`/event/${routeEvent.replacementEventId}` as never);
      return;
    }
    if (resolvedLiveEvent === null && draftEvent !== null) {
      router.replace(`/event/${id}/edit` as never);
    }
  }, [id, routeEvent.replacementEventId, resolvedLiveEvent, draftEvent, router]);

  // ----- State ---------------------------------------------------
  const [shareModalVisible, setShareModalVisible] = useState<boolean>(false);
  const [manageMenuVisible, setManageMenuVisible] = useState<boolean>(false);
  const [endSalesVisible, setEndSalesVisible] = useState<boolean>(false);
  const [cancelDialogVisible, setCancelDialogVisible] = useState<boolean>(false);
  const [cancelSubmitting, setCancelSubmitting] = useState<boolean>(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });

  // ----- Mutations ----------------------------------------------
  const updateLifecycle = useLiveEventStore((s) => s.updateLifecycle);
  const cancelServerEvent = useCancelBusinessEvent();
  const endServerTicketSales = useEndBusinessEventTicketSales();
  const event = resolvedLiveEvent;
  useSuccessfulBusinessRecentOpen({
    brandId: brand?.id ?? event?.brandId ?? null,
    entityType: "event", entityId: event?.serverEventId ?? id,
    ready: event !== null && draftEvent === null && routeEvent.replacementEventId === null,
    title: event?.name, coverUrl: event?.coverMediaUrl,
    coverPosterUrl: event?.coverMediaPosterUrl, coverType: event?.coverMediaType,
    status: event?.status,
  });

  // ----- Handlers -------------------------------------------------
  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/hub/events" as never);
    }
  }, [router]);

  // #2589 — Share is offered only for an offering the public can actually
  // resolve. Creating a share for a private or unpublished one 404s, and that
  // 404 reached the sheet as a generic failure with a Retry that could never
  // work. Refuse the tap and say what to do instead.
  const shareability = useMemo(
    () => offeringShareability({
      visibility: resolvedLiveEvent?.visibility ?? null,
      publishedAt: resolvedLiveEvent?.publishedAt ?? null,
      status: resolvedLiveEvent?.status ?? null,
    }),
    [resolvedLiveEvent?.visibility, resolvedLiveEvent?.publishedAt, resolvedLiveEvent?.status],
  );
  // #2589 — the sheet's kind was hardcoded to "event". An RSVP offering shared
  // under that kind makes the share edge query `event_type = 'event'`, find
  // nothing, and return the SAME 404 as an unpublished offering. Derive it.
  const shareContentKind: ShareEntityKind = resolvedLiveEvent?.event_type === "rsvp"
    ? "rsvp_event"
    : resolvedLiveEvent?.event_type === "trip"
      ? "trip"
      : resolvedLiveEvent?.event_type === "experience"
        ? "experience"
        : "event";

  const handleShareOpen = useCallback((): void => {
    if (!shareability.shareable) {
      setToast({ visible: true, message: shareability.reason });
      return;
    }
    setShareModalVisible(true);
  }, [shareability]);

  const handleManageOpen = useCallback((): void => {
    // ORCH-1136 F-2: never a silent dead tap (Const #1). EventManageMenu
    // requires a non-null brand and the line-841 mount gates on
    // `brand !== null` (ORCH-0862 unmount-on-close — preserved). When the
    // brand hasn't resolved yet, give explicit feedback instead of entering a
    // no-op state that mounts nothing.
    if (brand === null) {
      setToast({ visible: true, message: "Loading brand… tap again in a moment." });
      return;
    }
    setManageMenuVisible(true);
  }, [brand]);

  const handleManageClose = useCallback((): void => {
    setManageMenuVisible(false);
  }, []);

  const handleEdit = useCallback((): void => {
    if (id !== null) {
      // Cycle 9b-2: EventDetail is live-only (drafts redirect before
      // reaching here). Always route with ?mode=edit-published so
      // edit.tsx renders the focused EditPublishedScreen instead of
      // the create wizard (which would bounce to home for non-drafts).
      router.push(`/event/${id}/edit?mode=edit-published` as never);
    }
  }, [id, router]);

  const handleViewPublic = useCallback((): void => {
    if (resolvedLiveEvent !== null) {
      router.push(
        `/e/${resolvedLiveEvent.brandSlug}/${resolvedLiveEvent.eventSlug}` as never,
      );
    }
  }, [resolvedLiveEvent, router]);

  const showToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  // ----- Action grid handlers -----------------------------------
  // Cycle 11 — SUBTRACT toast (Const #8) and route to scanner camera.
  const handleScanTickets = useCallback((): void => {
    if (id !== null) {
      router.push(`/event/${id}/scanner` as never);
    }
  }, [router, id]);

  const handleScanners = useCallback((): void => {
    if (id !== null) {
      router.push(`/event/${id}/scanners` as never);
    }
  }, [router, id]);

  const handleOrders = useCallback((): void => {
    if (id !== null) {
      router.push(`/event/${id}/orders` as never);
    }
  }, [router, id]);

  const handleGuests = useCallback((): void => {
    if (id !== null) {
      router.push(`/event/${id}/guests` as never);
    }
  }, [router, id]);

  // ORCH-0815-A2-ui (DEC-149): event-context entry point for the dual-
  // surface Marketing Hub. Lists this event's ticket buyers and surfaces
  // "Blast these N buyers →" CTA pre-filling the marketing composer.
  // Renamed "Buyers" → "Blasts" + route `/buyers` → `/blasts` 2026-05-12
  // for consistency with the bottom-nav "Blast" tab.
  const handleBlasts = useCallback((): void => {
    if (id !== null) {
      router.push(`/event/${id}/blasts` as never);
    }
  }, [router, id]);

  const handleBrandPage = useCallback((): void => {
    if (brand !== null) {
      router.push(`/brand/${brand.id}` as never);
    }
  }, [brand, router]);

  // Cycle 12 — J-D1 Door Sales action tile handler.
  const handleDoorSales = useCallback((): void => {
    if (id !== null) {
      router.push(`/event/${id}/door` as never);
    }
  }, [router, id]);

  // Cycle 13 — J-R1 Reconciliation action tile handler (DEC-095 D-13-1).
  const handleReconciliation = useCallback((): void => {
    if (id !== null) {
      router.push(`/event/${id}/reconciliation` as never);
    }
  }, [router, id]);

  // ----- Lifecycle handlers (9b-1) -------------------------------
  const handleEndSalesOpen = useCallback((): void => {
    setEndSalesVisible(true);
  }, []);

  const handleEndSalesConfirm = useCallback(async (): Promise<void> => {
    if (isServerBackedEvent) {
      if (event === null) return;
      try {
        await endServerTicketSales.endTicketSales({
          eventId: event.id,
          brandId: event.brandId,
        });
        setEndSalesVisible(false);
        showToast("Ticket sales ended.");
      } catch {
        showToast("Could not end ticket sales. Try again.");
      }
      return;
    }
    if (id !== null) {
      updateLifecycle(id, { endedAt: new Date().toISOString() });
    }
    setEndSalesVisible(false);
    showToast("Ticket sales ended.");
  }, [id, isServerBackedEvent, event, endServerTicketSales, updateLifecycle, showToast]);

  const handleCancelDialogOpen = useCallback((): void => {
    setCancelDialogVisible(true);
  }, []);

  const handleCancelConfirm = useCallback(async (): Promise<void> => {
    if (id === null) return;
    if (isServerBackedEvent) {
      if (event === null) return;
      setCancelSubmitting(true);
      try {
        await cancelServerEvent.cancelEvent({
          eventId: event.id,
          brandId: event.brandId,
        });
        setCancelDialogVisible(false);
        showToast("Event cancelled.");
        // ORCH-0862: do NOT navigate post-cancel. Re-rendering in place via
        // the cache-invalidate refetch avoids the iOS UIKit dismiss-race
        // freeze (the prior post-cancel route swap raced the 200ms Modal
        // exit + iOS UIViewController dismissal). Mirrors the hub-list flow
        // that ships today and is proven to dismiss cleanly. Status pill
        // flips to ENDED.
      } catch {
        showToast("Could not cancel event. Try again.");
      } finally {
        setCancelSubmitting(false);
      }
      return;
    }
    // 1.2s simulated processing per spec §3.0.1 Q-9-3.
    await cancelSleep(CANCEL_PROCESSING_MS);
    updateLifecycle(id, {
      status: "cancelled",
      cancelledAt: new Date().toISOString(),
    });
    setCancelDialogVisible(false);
    // [TRANSITIONAL] Buyer email cascade is a no-op stub — B-cycle
    // wires Resend + auto-refund triggers.
    showToast(
      "Event cancelled. Buyers will be refunded when emails wire up (B-cycle).",
    );
    // ORCH-0862: see comment above — no navigation; screen re-renders in place.
  }, [id, isServerBackedEvent, event, cancelServerEvent, updateLifecycle, showToast]);

  const handleDeleteDraftStub = useCallback((): void => {
    // Cycle 9b-1 EventDetail is for LIVE events only — draft delete is
    // wired in events.tsx parent. EventDetail's manage menu wiring sees
    // status !== "draft" so this won't be invoked, but the prop is
    // required by the menu's interface.
    showToast(
      "Draft delete not available from Event Detail. Use Events tab.",
    );
  }, [showToast]);

  const handleDuplicate = useCallback(async (): Promise<void> => {
    if (event === null || !isServerBackedEvent) {
      showToast("Save this event to Mingla before duplicating it.");
      return;
    }
    try {
      const result = await duplicateBusinessEventAsDraft(event.serverEventId ?? event.id);
      showToast("Draft copy created.");
      router.push(`/event/${result.event.id}/edit` as never);
    } catch {
      showToast("Could not duplicate this event. Try again.");
    }
  }, [event, isServerBackedEvent, router, showToast]);

  const handleUnpublish = useCallback(async (): Promise<void> => {
    if (event === null || !isServerBackedEvent) return;
    try {
      const result = await unpublishBusinessEventToDraft(event.serverEventId ?? event.id);
      showToast("Event moved back to drafts.");
      router.replace(`/event/${result.event.id}/edit` as never);
    } catch (error) {
      const code = error instanceof Error ? error.message : "unpublish_failed";
      showToast(code.includes("event_unpublish_has_commitments")
        ? "This event has buyer activity and cannot be unpublished. Cancel it instead."
        : "Could not unpublish this event. Try again.");
    }
  }, [event, isServerBackedEvent, router, showToast]);

  const eventOrdersQuery = useEventOrders(event?.id ?? null);
  const allOrderEntries = eventOrdersQuery.data ?? [];
  const ordersReady =
    eventOrdersQuery.status === "ready" ||
    eventOrdersQuery.status === "stale-error";
  const totalSoldCount = useMemo<number>(
    () =>
      allOrderEntries.reduce(
        (sum, order) => {
          if (order.status !== "paid" && order.status !== "refunded_partial") return sum;
          return (
            sum +
            order.lines.reduce(
              (lineSum, line) => lineSum + Math.max(0, line.quantity - line.refundedQuantity),
              0,
            )
          );
        },
        0,
      ),
    [allOrderEntries],
  );
  // Cycle 12 — door sale KPIs (gated on event.inPersonPaymentsEnabled below
  // when rendering the J-D1 ActionTile). Per SPEC §4.5 selector pattern rule
  // (and dispatch §2.7 grep ban): NEVER subscribe to fresh-computation
  // selectors directly. Use raw entries + useMemo (mirrors soldCountByTier
  // pattern just above for orderStore).
  const allDoorEntries = useDoorSalesStore((s) => s.entries);
  const doorSoldCount = useMemo<number>(() => {
    if (event === null) return 0;
    let count = 0;
    for (const sale of allDoorEntries) {
      if (sale.eventId !== event.id) continue;
      for (const line of sale.lines) {
        count += Math.max(0, line.quantity - line.refundedQuantity);
      }
    }
    return count;
  }, [allDoorEntries, event]);
  const allCompEntries = useGuestStore((s) => s.entries);
  const compGuestCount = useMemo<number>(() => {
    if (event === null) return 0;
    return allCompEntries.filter((c) => c.eventId === event.id).length;
  }, [allCompEntries, event]);
  const totalGuestCount = totalSoldCount + doorSoldCount + compGuestCount;
  const moneySummary = useMemo(
    () =>
      summarizeEventMoney({
        expectedCurrency: event?.currency ?? brand?.defaultCurrency,
        orders:
          event === null
            ? []
            : allOrderEntries.filter((order) => order.eventId === event.id),
        doorSales:
          event === null
            ? []
            : allDoorEntries.filter((sale) => sale.eventId === event.id),
      }),
    [allDoorEntries, allOrderEntries, event],
  );
  const revenueGbp = moneySummary.onlineRevenue;
  // ORCH-0796 — online-only net to organiser, derived from real Stripe app-fee + refund
  // columns. Null when no online activity exists; KPI card renders that as 0 via its
  // existing hasData guard.
  const payoutGbp = moneySummary.onlineNetMajor;
  // ORCH-1006 Surface 5 — total the brand covered (absorbed VAT + fees) on
  // completed online orders, from orders.pricing_breakdown.absorbed. Legacy
  // orders (NULL breakdown) contribute nothing; the line omits when 0.
  const coveredGbp = useMemo<number>(() => {
    if (event === null) return 0;
    const cents = allOrderEntries
      .filter(
        (o) =>
          o.eventId === event.id &&
          (o.status === "paid" || o.status === "refunded_partial"),
      )
      .reduce((sum, o) => {
        const a = o.absorbedCostsCents;
        return a === undefined
          ? sum
          : sum + a.taxCents + a.miglaFeeCents + a.serviceFeeCents;
      }, 0);
    return cents / 100;
  }, [allOrderEntries, event]);
  const doorRevenue = moneySummary.doorRevenue;
  // #962 N1 — DISPLAY currency, severed from moneySummary.expectedCurrency
  // (which normalizes to a fabricated "GBP" for a pre-bank brand). The money
  // COMPUTATION at :386 is untouched; this only governs what the KpiCard + door
  // sub-label render, hiding the price ("—") when the brand has no currency.
  const displayCurrency = currencyCodeOrNull(event?.currency ?? brand?.defaultCurrency);
  // Per-tier sold count map — stable ref via raw entries + useMemo (same
  // pattern as Cycle 9c rework v2 fix; avoids infinite-loop on
  // getSoldCountByTier returning a fresh object each call).
  const soldCountByTier = useMemo<Record<string, number>>(() => {
    if (event === null) return {};
    const eventOrders = allOrderEntries.filter(
      (o) =>
        o.eventId === event.id &&
        (o.status === "paid" || o.status === "refunded_partial"),
    );
    const map: Record<string, number> = {};
    for (const order of eventOrders) {
      for (const line of order.lines) {
        const live = Math.max(0, line.quantity - line.refundedQuantity);
        if (live === 0) continue;
        map[line.ticketTypeId] = (map[line.ticketTypeId] ?? 0) + live;
      }
    }
    return map;
  }, [allOrderEntries, event]);

  // Cycle 9c-2 — event edit log entries (raw subscription, mirrors orderStore pattern).
  const allEditEntries = useEventEditLogStore((s) => s.entries);
  // Cycle 11 — scan entries (raw subscription).
  const allScanEntries = useScanStore((s) => s.entries);

  // Cycle 9c rework v3 + Cycle 9c-2 + Cycle 11 — activity feed merges 7 streams:
  // order-level (purchase / refund / cancel) + event-level (edit / sales-ended / cancelled / scan).
  const recentActivity = useMemo<ActivityEvent[]>(() => {
    if (event === null) return [];
    const events: ActivityEvent[] = [];

    // ---- Order-level streams (Cycle 9c v3) -----------------------
    const eventOrders = allOrderEntries.filter((o) => o.eventId === event.id);
    for (const o of eventOrders) {
      const buyerName =
        o.buyer.name.trim().length > 0 ? o.buyer.name : "Anonymous";
      const totalQty = o.lines.reduce((s, l) => s + l.quantity, 0);
      const purchaseSummary =
        o.lines.length === 1
          ? `bought ${o.lines[0].quantity}× ${o.lines[0].ticketNameAtPurchase}`
          : `bought ${totalQty}× tickets`;
      events.push({
        kind: "purchase",
        orderId: o.id,
        buyerName,
        summary: purchaseSummary,
        amountGbp: o.totalGbpAtPurchase,
        currency: o.currency,
        at: o.paidAt,
      });
      for (const r of o.refunds) {
        const refundedQty = r.lines.reduce((s, l) => s + l.quantity, 0);
        events.push({
          kind: "refund",
          orderId: o.id,
          buyerName,
          summary: `refunded ${refundedQty}× tickets`,
          amountGbp: r.amountGbp,
          currency: o.currency,
          at: r.refundedAt,
        });
      }
      if (o.status === "cancelled" && o.cancelledAt !== null) {
        events.push({
          kind: "cancel",
          orderId: o.id,
          buyerName,
          summary: "cancelled their order",
          at: o.cancelledAt,
        });
      }
    }

    // ---- Event-edit stream (Cycle 9c-2) --------------------------
    // Filter to entries with NO orderId — order-level entries (refund /
    // cancel reasons recorded via recordEdit) already render via the
    // order streams above, so including them here would double-count.
    const eventEdits = allEditEntries.filter(
      (e) => e.eventId === event.id && e.orderId === undefined,
    );
    for (const e of eventEdits) {
      // Multi-field edits collapse to first diff line for brevity in the
      // 5-row capped feed. Full diff lives on the buyer-side material-change
      // banner via getEditsForEventSince.
      const summary =
        e.diffSummary.length > 0 ? e.diffSummary[0] : "edited the event";
      events.push({
        kind: "event_edit",
        editId: e.id,
        severity: e.severity,
        summary,
        reason: e.reason,
        at: e.editedAt,
      });
    }

    // ---- Lifecycle streams (Cycle 9c-2) --------------------------
    if (event.endedAt !== null) {
      events.push({
        kind: "event_sales_ended",
        eventId: event.id,
        summary: "Ticket sales ended",
        at: event.endedAt,
      });
    }
    if (event.status === "cancelled" && event.cancelledAt !== null) {
      events.push({
        kind: "event_cancelled",
        eventId: event.id,
        summary: "Event cancelled",
        at: event.cancelledAt,
      });
    }

    // ---- Scan stream (Cycle 11) ---------------------------------
    // Successful scans only — failed scans don't surface to feed.
    const eventScans = allScanEntries.filter(
      (s) => s.eventId === event.id && s.scanResult === "success",
    );
    for (const scan of eventScans) {
      const buyerName =
        scan.buyerNameAtScan.trim().length > 0
          ? scan.buyerNameAtScan
          : "Guest";
      events.push({
        kind: "event_scan",
        scanId: scan.id,
        ticketId: scan.ticketId,
        orderId: scan.orderId,
        buyerName,
        ticketName: scan.ticketNameAtScan,
        summary: `${buyerName} checked in`,
        at: scan.scannedAt,
      });
    }

    // ---- Cycle 12 — door refund stream (OBS-1 — money-only, no scan) ---
    // Door refunds never touch useScanStore (financial event ≠ attendance
    // event). Walk doorSalesStore directly so the financial event surfaces
    // in the feed alongside online refunds. summary uses "(door)" suffix
    // for clarity vs Stripe-mediated online refunds.
    const eventDoorSales = allDoorEntries.filter((s) => s.eventId === event.id);
    for (const sale of eventDoorSales) {
      const buyerName =
        sale.buyerName.trim().length > 0 ? sale.buyerName : "Walk-up";
      for (const r of sale.refunds) {
        // #962 N3 — never render a fabricated £: formatCurrency coerces a blank
        // sale.currency to GBP via normalizeCurrency. sale.currency is real in
        // practice (paid door sales are gated behind a set currency), guarded
        // here for the gate + seam defense.
        const doorRefundCode = currencyCodeOrNull(sale.currency);
        events.push({
          kind: "event_door_refund",
          saleId: sale.id,
          refundId: r.id,
          buyerName,
          summary: `${buyerName} — refunded ${
            doorRefundCode
              ? formatCurrency(r.amountGbp, sale.currency)
              : String(r.amountGbp)
          } (door)`,
          amountGbp: r.amountGbp,
          currency: sale.currency,
          at: r.refundedAt,
        });
      }
    }

    // Newest first across all 8 streams; cap at 5.
    events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return events.slice(0, 5);
  }, [allOrderEntries, allEditEntries, allScanEntries, allDoorEntries, event]);

  // ----- Render not-found shell -----------------------------------
  if (
    id === null ||
    (event === null && draftEvent === null && !routeEvent.isLoading)
  ) {
    return (
      <View style={styles.host}>
        <View
          style={[
            styles.headerWrap,
            {
              paddingTop:
                insets.top + (Platform.OS === "web" ? spacing.sm : 0),
            },
          ]}
        >
          <TopBar leftKind="back" onBack={handleBack} title="Event" />
        </View>
        <View style={styles.emptyWrap}>
          <EmptyState
            illustration="ticket"
            title="Event not found"
            description="This event may have been deleted or moved."
            cta={{ label: "Back to events", onPress: handleBack }}
          />
        </View>
      </View>
    );
  }

  // Drafts → redirected via useEffect; render empty shell briefly
  if (event === null) {
    return <View style={styles.host} />;
  }

  const status = deriveScreenStatus(event);
  const dateLine = formatDraftDateLine(event);

  return (
    <View style={styles.host}>
      {/* Header */}
      <View
        style={[
          styles.headerWrap,
          {
            paddingTop:
              insets.top + (Platform.OS === "web" ? spacing.sm : 0),
          },
        ]}
      >
        <TopBar
          leftKind="back"
          onBack={handleBack}
          title="Event"
          rightSlot={
            <View style={styles.headerRightRow}>
              <IconChrome
                icon="share"
                size={36}
                onPress={handleShareOpen}
                accessibilityLabel="Share event"
              />
              <IconChrome
                icon="moreH"
                size={36}
                onPress={handleManageOpen}
                accessibilityLabel="Manage event"
              />
            </View>
          }
        />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero — cover band + status pill + name + date+venue */}
        <View style={styles.hero}>
          <View style={styles.heroCoverWrap}>
            <EventCoverMedia
              hue={event.coverHue}
              mediaUrl={event.coverMediaUrl}
              mediaType={event.coverMediaType}
              radius={24}
              label=""
              height={200}
            />
          </View>
          <View style={styles.heroOverlay} pointerEvents="none">
            <View style={styles.heroPillRow}>
              <EventDetailHeroStatusPill status={status} />
            </View>
            <Text style={styles.heroTitle} numberOfLines={2}>
              {event.name.trim().length > 0 ? event.name : "Untitled event"}
            </Text>
            <Text style={styles.heroSubline} numberOfLines={1}>
              {dateLine}
              {event.venueName !== null && event.venueName.length > 0
                ? ` · ${event.venueName}`
                : ""}
            </Text>
          </View>
        </View>

        {/* Action grid */}
        <View style={styles.actionGrid}>
          <ActionTile
            icon="qr"
            label="Scan tickets"
            primary
            onPress={handleScanTickets}
          />
          <ActionTile
            icon="users"
            label="Scanners"
            onPress={handleScanners}
          />
          <ActionTile
            icon="ticket"
            label="Orders"
            sub={ordersReady ? `${totalSoldCount} sold` : eventOrdersQuery.status === "error" ? "Unable to load" : "Loading…"}
            onPress={handleOrders}
          />
          <ActionTile
            icon="user"
            label="Guests"
            sub={ordersReady ? `${totalGuestCount} ${totalGuestCount === 1 ? "guest" : "guests"}` : eventOrdersQuery.status === "error" ? "Unable to load" : "Loading…"}
            onPress={handleGuests}
          />
          {canShowListingInsights ? (
            <ActionTile
              icon="chart"
              label="Insights"
              sub="Customers Mingla drove"
              accessibilityLabel={`Open Insights for ${event.name}`}
              onPress={() =>
                router.push(`/insights/${event.id}?entry=detail_action` as never)
              }
            />
          ) : null}
          {/* ORCH-0815-A2-ui (DEC-149) — event-context Marketing entry.
              Renamed "Buyers" → "Blasts" + icon `users` → `send` for
              consistency with the bottom-nav Blast tab. */}
          <ActionTile
            icon="send"
            label="Blasts"
            sub="Message ticket buyers"
            onPress={handleBlasts}
          />
          <ActionTile
            icon="chat"
            label="Group chat"
            sub="Read + reply + moderate"
            onPress={() => router.push(`/event/${event.id}/group-chat` as never)}
          />
          <ActionTile
            icon="eye"
            label="Public page"
            onPress={handleViewPublic}
          />
          {brand !== null ? (
            <ActionTile
              icon="user"
              label="Brand page"
              onPress={handleBrandPage}
            />
          ) : null}
          {/* Cycle 12 — J-D1 Door Sales tile, gated on per-event toggle. */}
          {event.inPersonPaymentsEnabled ? (
            <ActionTile
              icon="ticket"
              label="Door Sales"
              sub={`${doorSoldCount} sold${
                displayCurrency !== null
                  ? ` · ${formatCurrency(doorRevenue, displayCurrency)}`
                  : ""
              }`}
              onPress={handleDoorSales}
            />
          ) : null}
          {/* Cycle 13 — J-R1 Reconciliation tile, permission-gated (finance_manager+). */}
          <ReconciliationCtaTile
            brandId={brand?.id ?? null}
            onPress={handleReconciliation}
          />
        </View>

        {/* Revenue card */}
        <EventDetailKpiCard
          revenueGbp={revenueGbp}
          payoutGbp={payoutGbp}
          coveredGbp={coveredGbp}
          currency={displayCurrency}
          readStatus={eventOrdersQuery.status}
          onRetry={() => { void eventOrdersQuery.refetch(); }}
        />

        {moneySummary.mismatches.length > 0 ? (
          <GlassCard variant="base" radius="md" padding={spacing.md}>
            <Text style={styles.currencyWarningTitle}>Currency review needed</Text>
            <Text style={styles.currencyWarningBody}>
              {`${moneySummary.mismatches.length} stale row(s) in ${moneySummary.currenciesPresent.join(", ")} were excluded from ${moneySummary.expectedCurrency} totals.`}
            </Text>
          </GlassCard>
        ) : null}

        {/* Ticket types section */}
        <Text style={styles.sectionLabel}>TICKET TYPES</Text>
        {event.tickets.length === 0 ? (
          <GlassCard variant="base" radius="md" padding={spacing.md}>
            <Text style={styles.emptySectionText}>No ticket types yet.</Text>
          </GlassCard>
        ) : (
          <View style={styles.ticketTypesList}>
            {event.tickets
              .filter((t) => t.visibility !== "hidden")
              .sort((a, b) => a.displayOrder - b.displayOrder)
              .map((ticket) => (
                <EventDetailTicketTypeRow
                  key={ticket.id}
                  ticket={ticket}
                  soldCount={ordersReady ? soldCountByTier[ticket.id] ?? 0 : null}
                />
              ))}
          </View>
        )}

        {/* Recent activity section — Cycle 9c rework v3 live wire */}
        <Text style={styles.sectionLabelSpacer}>RECENT ACTIVITY</Text>
        <GlassCard variant="base" radius="md" padding={spacing.md}>
          {!ordersReady ? (
            <Text style={styles.emptySectionText}>
              {eventOrdersQuery.status === "error" ? "Unable to load activity." : "Loading activity…"}
            </Text>
          ) : recentActivity.length === 0 ? (
            <Text style={styles.emptySectionText}>No activity yet.</Text>
          ) : (
            <View style={styles.activityList}>
              {recentActivity.map((a) => (
                <EventDetailActivityRow
                  key={activityRowKey(a)}
                  event={a}
                />
              ))}
            </View>
          )}
        </GlassCard>

        {/* Cancel event CTA — opens ConfirmDialog with typeToConfirm.
            Cycle 13a J-T6 G1: gated on EDIT_EVENT; hidden for sub-rank users. */}
        {(status === "live" || status === "upcoming") &&
        canEditEvent ? (
          <View style={styles.cancelCtaWrap}>
            <Button
              label="Cancel event"
              variant="ghost"
              size="md"
              fullWidth
              onPress={handleCancelDialogOpen}
              accessibilityLabel="Cancel event"
            />
          </View>
        ) : null}
      </ScrollView>

      {/* Share modal — Cycle 7 reuse.
          #2589: mounted only when the offering is publicly resolvable, and with
          a derived contentKind. Both halves of the same defect — an unshareable
          offering, or the right offering under the wrong kind, produced one
          indistinguishable 404 at the sheet. */}
      {shareability.shareable ? (
        <ShareModal
          preloadContent
          visible={shareModalVisible}
          onClose={() => setShareModalVisible(false)}
          url={eventPublicUrl({
            brandSlug: event.brandSlug,
            eventSlug: event.eventSlug,
          })}
          contentKind={shareContentKind}
          title={`${event.name} on Mingla`}
          description={event.description.slice(0, 200) || event.name}
        />
      ) : null}

      {/* Manage menu — Sheet primitive.
          ORCH-0862 / F-6 (Symptom A real root cause): gate mount on
          BOTH `brand !== null` AND `manageMenuVisible` so the component
          fully UNMOUNTS when closed (matching the hub-list flow's
          `{manageCtx !== null ? ... : null}` pattern at hub/events.tsx).
          Pre-fix: this was `{brand !== null ? <EventManageMenu visible={manageMenuVisible}/> : null}`
          which left EventManageMenu mounted with visible=false → its
          native RN Modal lingered mid-dismiss → when ConfirmDialog tried
          to present in the same React commit, iOS UIKit rejected with
          "Attempt to present <RCTFabricModalHostViewController> on <X>
          which is already presenting <Y>" → presentation queue stalled
          → JS bridge waited forever → app frozen. Captured live in sim
          syslog 2026-05-17 15:03:25.920411 (com.apple.UIKit:Presentation).
          Mounting conditionally on manageMenuVisible drops the Sheet's
          Modal from the native tree when closed, letting ConfirmDialog
          present cleanly. */}
      {brand !== null && manageMenuVisible ? (
        <EventManageMenu
          visible={manageMenuVisible}
          onClose={handleManageClose}
          event={event}
          status={status}
          brand={brand}
          onShare={() => {
            setManageMenuVisible(false);
            handleShareOpen();
          }}
          onEdit={() => {
            setManageMenuVisible(false);
            handleEdit();
          }}
          onViewPublic={() => {
            setManageMenuVisible(false);
            handleViewPublic();
          }}
          onEndSales={() => {
            setManageMenuVisible(false);
            handleEndSalesOpen();
          }}
          onCancelEvent={() => {
            setManageMenuVisible(false);
            handleCancelDialogOpen();
          }}
          onDeleteDraft={() => {
            setManageMenuVisible(false);
            handleDeleteDraftStub();
          }}
          onDuplicate={handleDuplicate}
          onUnpublish={handleUnpublish}
          onOpenOrders={() => {
            setManageMenuVisible(false);
            router.push(`/event/${event.id}/orders` as never);
          }}
          onTransitionalToast={showToast}
          canEditEvent={canEditEvent}
          canUseLifecycleActions
        />
      ) : null}

      {/* End sales sheet — opens from manage menu's "End ticket sales" */}
      <EndSalesSheet
        visible={endSalesVisible}
        onClose={() => setEndSalesVisible(false)}
        onConfirm={handleEndSalesConfirm}
        eventName={event.name.trim().length > 0 ? event.name : "this event"}
      />

      {/* Cancel event ConfirmDialog — typeToConfirm variant */}
      <ConfirmDialog
        visible={cancelDialogVisible}
        onClose={() => {
          if (cancelSubmitting) return;
          setCancelDialogVisible(false);
        }}
        onConfirm={handleCancelConfirm}
        title="Cancel this event?"
        description="This is serious. Buyers will be notified by email and refunded automatically when those wire up (B-cycle). You can't undo this."
        variant="typeToConfirm"
        confirmText={event.name.trim().length > 0 ? event.name : event.eventSlug}
        confirmLabel="Cancel event"
        cancelLabel="Keep event live"
        destructive
      />


      {/* TRANSITIONAL toast wrap — top-anchored per memory rule */}
      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={() => setToast({ visible: false, message: "" })}
        />
      </View>
    </View>
  );
}

// Cycle 13: ActionTile extracted to src/components/event/ActionTile.tsx
// (Step 6 implementation order). Imported above with EventManageMenu et al.
//
// Cycle 17d Stage 2 §F.4: HeroStatusPill / TicketTypeRow / ActivityRow
// extracted to ../../../src/components/event/EventDetail*.tsx siblings.

// ---- Page styles ---------------------------------------------------

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: "#0c0e12",
  },
  headerWrap: {
    paddingHorizontal: spacing.md,
  },
  headerRightRow: {
    flexDirection: "row",
    gap: spacing.xs,
    alignItems: "center",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  hero: {
    position: "relative",
    height: 200,
    borderRadius: radiusTokens.xl,
    overflow: "hidden",
  },
  heroCoverWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  heroOverlay: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
  },
  heroPillRow: {
    flexDirection: "row",
    marginBottom: spacing.sm,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.2,
    color: "#ffffff",
    // ORCH-0743 / CF-2 — RN-only textShadow* triple → Platform.select. Web
    // gets the CSS textShadow shorthand (react-native-web 0.21+ supports it);
    // iOS/Android keep the RN-native triple for fidelity. Eliminates the
    // `"shadow*" style props are deprecated` Metro warning on web export
    // and restores the visible hero shadow on web target.
    ...(Platform.OS === "web"
      ? { textShadow: "0 2px 12px rgba(0, 0, 0, 0.4)" }
      : {
          textShadowColor: "rgba(0, 0, 0, 0.4)",
          textShadowOffset: { width: 0, height: 2 },
          textShadowRadius: 12,
        }),
    marginBottom: 4,
  },
  heroSubline: {
    fontSize: 13,
    color: "rgba(255, 255, 255, 0.85)",
  },
  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: textTokens.tertiary,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  sectionLabelSpacer: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: textTokens.tertiary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  ticketTypesList: {
    gap: spacing.xs,
  },
  activityList: {
    gap: spacing.xs,
  },
  emptySectionText: {
    fontSize: 13,
    color: textTokens.tertiary,
    textAlign: "center",
    paddingVertical: spacing.sm,
  },
  currencyWarningTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: textTokens.primary,
  },
  currencyWarningBody: {
    fontSize: 12,
    lineHeight: 17,
    color: textTokens.secondary,
    marginTop: 4,
  },
  cancelCtaWrap: {
    marginTop: spacing.xl,
  },
  toastWrap: {
    position: "absolute",
    top: 80,
    left: 0,
    right: 0,
    zIndex: 100,
    elevation: 12,
  },
});
