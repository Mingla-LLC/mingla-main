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
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
} from "../../../src/constants/designSystem";
import { useLiveEventStore } from "../../../src/store/liveEventStore";
import type { LiveEvent } from "../../../src/store/liveEventStore";
import { useDraftById } from "../../../src/store/draftEventStore";
import type { TicketStub } from "../../../src/store/draftEventStore";
import { useBrandList } from "../../../src/store/currentBrandStore";
import { useOrderStore } from "../../../src/store/orderStore";
import { useDoorSalesStore } from "../../../src/store/doorSalesStore";
import { useScanStore } from "../../../src/store/scanStore";
import {
  useEventEditLogStore,
  type EditSeverity,
} from "../../../src/store/eventEditLogStore";
import { formatDraftDateLine } from "../../../src/utils/eventDateDisplay";
import { formatGbp } from "../../../src/utils/currency";

// ----- Activity feed types (Cycle 9c rework v3 + Cycle 9c-2 ext) ---

type ActivityEvent =
  | {
      kind: "purchase";
      orderId: string;
      buyerName: string;
      summary: string;
      amountGbp: number;
      at: string;
    }
  | {
      kind: "refund";
      orderId: string;
      buyerName: string;
      summary: string;
      amountGbp: number;
      at: string;
    }
  | {
      kind: "cancel";
      orderId: string;
      buyerName: string;
      summary: string;
      at: string;
    }
  | {
      kind: "event_edit";
      editId: string;
      severity: EditSeverity;
      summary: string;
      reason: string;
      at: string;
    }
  | {
      kind: "event_sales_ended";
      eventId: string;
      summary: string;
      at: string;
    }
  | {
      kind: "event_cancelled";
      eventId: string;
      summary: string;
      at: string;
    }
  // Cycle 11 — event_scan kind. Buyer is the SUBJECT (not actor), so
  // ActivityRow renders summary as primary line per §4.8.
  | {
      kind: "event_scan";
      scanId: string;
      ticketId: string;
      orderId: string;
      buyerName: string;
      ticketName: string;
      summary: string; // e.g., "Tunde checked in"
      at: string;
    }
  // Cycle 12 — door refund stream. Mirrors order `refund` shape but keyed
  // differently so the feed can distinguish door (cash/manual money returned
  // at the door) from online (Stripe-mediated). Door refunds never touch
  // useScanStore (OBS-1 lock — refund is money-only, not attendance) so they
  // need their own stream sourced directly from useDoorSalesStore.
  | {
      kind: "event_door_refund";
      saleId: string;       // ds_xxx parent door sale
      refundId: string;     // dr_xxx refund record
      buyerName: string;    // sale.buyerName or "Walk-up"
      summary: string;      // "{buyer} — refunded £X (door)"
      amountGbp: number;
      at: string;           // refund.refundedAt ISO
    };

const ACTIVITY_RELATIVE_TIME_MS = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

const formatActivityRelativeTime = (iso: string): string => {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const delta = now - then;
  if (delta < ACTIVITY_RELATIVE_TIME_MS.minute) return "just now";
  if (delta < ACTIVITY_RELATIVE_TIME_MS.hour) {
    return `${Math.floor(delta / ACTIVITY_RELATIVE_TIME_MS.minute)}m ago`;
  }
  if (delta < ACTIVITY_RELATIVE_TIME_MS.day) {
    return `${Math.floor(delta / ACTIVITY_RELATIVE_TIME_MS.hour)}h ago`;
  }
  return `${Math.floor(delta / ACTIVITY_RELATIVE_TIME_MS.day)}d ago`;
};

// React keys differ per kind: order-level uses orderId, event-level uses
// editId or eventId (no orderId field on the new kinds).
const activityRowKey = (a: ActivityEvent): string => {
  if (a.kind === "purchase" || a.kind === "refund" || a.kind === "cancel") {
    return `${a.kind}-${a.orderId}-${a.at}`;
  }
  if (a.kind === "event_edit") {
    return `${a.kind}-${a.editId}`;
  }
  if (a.kind === "event_scan") {
    return `${a.kind}-${a.scanId}`;
  }
  if (a.kind === "event_door_refund") {
    return `${a.kind}-${a.refundId}`;
  }
  return `${a.kind}-${a.eventId}-${a.at}`;
};

import { Button } from "../../../src/components/ui/Button";
import { ConfirmDialog } from "../../../src/components/ui/ConfirmDialog";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { EventCover } from "../../../src/components/ui/EventCover";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { Icon } from "../../../src/components/ui/Icon";
import type { IconName } from "../../../src/components/ui/Icon";
import { IconChrome } from "../../../src/components/ui/IconChrome";
import { Pill } from "../../../src/components/ui/Pill";
import { ShareModal } from "../../../src/components/ui/ShareModal";
import { Toast } from "../../../src/components/ui/Toast";
import { TopBar } from "../../../src/components/ui/TopBar";

import { EndSalesSheet } from "../../../src/components/event/EndSalesSheet";
import { EventDetailKpiCard } from "../../../src/components/event/EventDetailKpiCard";
import { EventManageMenu } from "../../../src/components/event/EventManageMenu";

const CANCEL_PROCESSING_MS = 1200;
const cancelSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ----- Status derivation (mirrors EventListCard) -------------------

type EventStatus = "live" | "upcoming" | "past";

const deriveLiveStatus = (event: LiveEvent): EventStatus => {
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

const canonicalUrl = (event: LiveEvent): string =>
  `https://business.mingla.com/e/${event.brandSlug}/${event.eventSlug}`;

export default function EventDetailScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : null;

  // ----- Resolve event -------------------------------------------
  const liveEvent = useLiveEventStore((s) =>
    id === null ? null : s.events.find((e) => e.id === id) ?? null,
  );
  const draftEvent = useDraftById(id);
  const brands = useBrandList();
  const brand = useMemo(() => {
    if (liveEvent !== null) {
      return brands.find((b) => b.id === liveEvent.brandId) ?? null;
    }
    if (draftEvent !== null) {
      return brands.find((b) => b.id === draftEvent.brandId) ?? null;
    }
    return null;
  }, [liveEvent, draftEvent, brands]);

  // ----- Defensive: draft → redirect to edit ---------------------
  useEffect(() => {
    if (id === null) return;
    if (liveEvent === null && draftEvent !== null) {
      router.replace(`/event/${id}/edit` as never);
    }
  }, [id, liveEvent, draftEvent, router]);

  // ----- State ---------------------------------------------------
  const [shareModalVisible, setShareModalVisible] = useState<boolean>(false);
  const [manageMenuVisible, setManageMenuVisible] = useState<boolean>(false);
  const [endSalesVisible, setEndSalesVisible] = useState<boolean>(false);
  const [cancelDialogVisible, setCancelDialogVisible] = useState<boolean>(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });

  // ----- Mutations ----------------------------------------------
  const updateLifecycle = useLiveEventStore((s) => s.updateLifecycle);

  // ----- Handlers -------------------------------------------------
  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/events" as never);
    }
  }, [router]);

  const handleShareOpen = useCallback((): void => {
    setShareModalVisible(true);
  }, []);

  const handleManageOpen = useCallback((): void => {
    setManageMenuVisible(true);
  }, []);

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
    if (liveEvent !== null) {
      router.push(
        `/e/${liveEvent.brandSlug}/${liveEvent.eventSlug}` as never,
      );
    }
  }, [liveEvent, router]);

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

  // ----- Lifecycle handlers (9b-1) -------------------------------
  const handleEndSalesOpen = useCallback((): void => {
    setEndSalesVisible(true);
  }, []);

  const handleEndSalesConfirm = useCallback((): void => {
    if (id !== null) {
      updateLifecycle(id, { endedAt: new Date().toISOString() });
    }
    setEndSalesVisible(false);
    showToast("Ticket sales ended.");
  }, [id, updateLifecycle, showToast]);

  const handleCancelDialogOpen = useCallback((): void => {
    setCancelDialogVisible(true);
  }, []);

  const handleCancelConfirm = useCallback(async (): Promise<void> => {
    if (id === null) return;
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
    router.replace("/(tabs)/events" as never);
  }, [id, updateLifecycle, router, showToast]);

  const handleDeleteDraftStub = useCallback((): void => {
    // Cycle 9b-1 EventDetail is for LIVE events only — draft delete is
    // wired in events.tsx parent. EventDetail's manage menu wiring sees
    // status !== "draft" so this won't be invoked, but the prop is
    // required by the menu's interface.
    showToast(
      "Draft delete not available from Event Detail. Use Events tab.",
    );
  }, [showToast]);

  // ----- Render not-found shell -----------------------------------
  if (id === null || (liveEvent === null && draftEvent === null)) {
    return (
      <View style={styles.host}>
        <View style={[styles.headerWrap, { paddingTop: insets.top }]}>
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
  if (liveEvent === null) {
    return <View style={styles.host} />;
  }

  const event = liveEvent;
  const status = deriveLiveStatus(event);
  const dateLine = formatDraftDateLine(event);

  // Cycle 9c — populated from useOrderStore (subscribes to live updates).
  const revenueGbp = useOrderStore((s) =>
    event !== null ? s.getRevenueForEvent(event.id) : 0,
  );
  // [TRANSITIONAL] payout = revenue × 0.96 (4% stub Stripe fee retention).
  // EXIT: B-cycle wires real Stripe payouts; payout comes from Stripe API.
  const payoutGbp = Math.round(revenueGbp * 96) / 100;
  // Total tickets sold across all tiers — drives "X sold" subtext on Orders ActionTile.
  const totalSoldCount = useOrderStore((s) =>
    event !== null ? s.getSoldCountForEvent(event.id) : 0,
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
  const doorRevenue = useMemo<number>(() => {
    if (event === null) return 0;
    let revenue = 0;
    for (const sale of allDoorEntries) {
      if (sale.eventId !== event.id) continue;
      revenue += sale.totalGbpAtSale - sale.refundedAmountGbp;
    }
    return revenue;
  }, [allDoorEntries, event]);
  // Per-tier sold count map — stable ref via raw entries + useMemo (same
  // pattern as Cycle 9c rework v2 fix; avoids infinite-loop on
  // getSoldCountByTier returning a fresh object each call).
  const allOrderEntries = useOrderStore((s) => s.entries);
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
        events.push({
          kind: "event_door_refund",
          saleId: sale.id,
          refundId: r.id,
          buyerName,
          summary: `${buyerName} — refunded ${formatGbp(r.amountGbp)} (door)`,
          amountGbp: r.amountGbp,
          at: r.refundedAt,
        });
      }
    }

    // Newest first across all 8 streams; cap at 5.
    events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return events.slice(0, 5);
  }, [allOrderEntries, allEditEntries, allScanEntries, allDoorEntries, event]);

  return (
    <View style={styles.host}>
      {/* Header */}
      <View style={[styles.headerWrap, { paddingTop: insets.top }]}>
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
            <EventCover hue={event.coverHue} radius={24} label="" height={200} />
          </View>
          <View style={styles.heroOverlay} pointerEvents="none">
            <View style={styles.heroPillRow}>
              <HeroStatusPill status={status} />
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
            sub={`${totalSoldCount} sold`}
            onPress={handleOrders}
          />
          <ActionTile
            icon="user"
            label="Guests"
            sub="0 pending"
            onPress={handleGuests}
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
              sub={`@${brand.slug}`}
              onPress={handleBrandPage}
            />
          ) : null}
          {/* Cycle 12 — J-D1 Door Sales tile, gated on per-event toggle. */}
          {event.inPersonPaymentsEnabled ? (
            <ActionTile
              icon="ticket"
              label="Door Sales"
              sub={`${doorSoldCount} sold · ${formatGbp(doorRevenue)}`}
              onPress={handleDoorSales}
            />
          ) : null}
        </View>

        {/* Revenue card */}
        <EventDetailKpiCard revenueGbp={revenueGbp} payoutGbp={payoutGbp} />

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
                <TicketTypeRow
                  key={ticket.id}
                  ticket={ticket}
                  soldCount={soldCountByTier[ticket.id] ?? 0}
                />
              ))}
          </View>
        )}

        {/* Recent activity section — Cycle 9c rework v3 live wire */}
        <Text style={styles.sectionLabelSpacer}>RECENT ACTIVITY</Text>
        <GlassCard variant="base" radius="md" padding={spacing.md}>
          {recentActivity.length === 0 ? (
            <Text style={styles.emptySectionText}>No activity yet.</Text>
          ) : (
            <View style={styles.activityList}>
              {recentActivity.map((a) => (
                <ActivityRow
                  key={activityRowKey(a)}
                  event={a}
                />
              ))}
            </View>
          )}
        </GlassCard>

        {/* Cancel event CTA — opens ConfirmDialog with typeToConfirm
            (case-sensitive match on event.name; ConfirmDialog primitive
            default per DEC-079 — no kit extension for case folding). */}
        {status === "live" || status === "upcoming" ? (
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

      {/* Share modal — Cycle 7 reuse */}
      <ShareModal
        visible={shareModalVisible}
        onClose={() => setShareModalVisible(false)}
        url={canonicalUrl(event)}
        title={`${event.name} on Mingla`}
        description={event.description.slice(0, 200) || event.name}
      />

      {/* Manage menu — Sheet primitive */}
      {brand !== null ? (
        <EventManageMenu
          visible={manageMenuVisible}
          onClose={handleManageClose}
          event={event}
          status={status}
          brand={brand}
          onShare={() => {
            setManageMenuVisible(false);
            setShareModalVisible(true);
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
          onOpenOrders={() => {
            setManageMenuVisible(false);
            router.push(`/event/${event.id}/orders` as never);
          }}
          onTransitionalToast={showToast}
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
        onClose={() => setCancelDialogVisible(false)}
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

// ---- Action tile (composed inline — NOT a kit primitive) ----------

interface ActionTileProps {
  icon: IconName;
  label: string;
  sub?: string;
  primary?: boolean;
  onPress: () => void;
}

const ActionTile: React.FC<ActionTileProps> = ({
  icon,
  label,
  sub,
  primary = false,
  onPress,
}) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={label}
    style={({ pressed }) => [
      tileStyles.host,
      primary && tileStyles.hostPrimary,
      pressed && tileStyles.hostPressed,
    ]}
  >
    <Icon
      name={icon}
      size={20}
      color={primary ? accent.warm : textTokens.primary}
    />
    <Text style={tileStyles.label} numberOfLines={1}>
      {label}
    </Text>
    {sub !== undefined ? (
      <Text style={tileStyles.sub} numberOfLines={1}>
        {sub}
      </Text>
    ) : null}
  </Pressable>
);

const tileStyles = StyleSheet.create({
  host: {
    flexBasis: "48%",
    flexGrow: 0,
    minHeight: 76,
    padding: spacing.md - 2,
    backgroundColor: glass.tint.profileBase,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    alignItems: "flex-start",
    justifyContent: "center",
    gap: 4,
  },
  hostPrimary: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  hostPressed: {
    opacity: 0.7,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: textTokens.primary,
  },
  sub: {
    fontSize: 11,
    color: textTokens.tertiary,
  },
});

// ---- Hero status pill (composed inline — handles "live"/"upcoming"/"past") ----

interface HeroStatusPillProps {
  status: EventStatus;
}

const HeroStatusPill: React.FC<HeroStatusPillProps> = ({ status }) => {
  if (status === "live") {
    return (
      <Pill variant="live" livePulse>
        <Text style={pillStyles.text}>LIVE</Text>
      </Pill>
    );
  }
  if (status === "upcoming") {
    return (
      <Pill variant="accent">
        <Text style={pillStyles.text}>UPCOMING</Text>
      </Pill>
    );
  }
  return (
    <View style={pillStyles.pastPill}>
      <Text style={pillStyles.pastText}>ENDED</Text>
    </View>
  );
};

const pillStyles = StyleSheet.create({
  text: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: textTokens.primary,
  },
  pastPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: radiusTokens.full,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  pastText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: textTokens.tertiary,
  },
});

// ---- TicketTypeRow (composed inline) -------------------------------

interface TicketTypeRowProps {
  ticket: TicketStub;
  /** Cycle 9c — derived in parent from useOrderStore (per-tier live count). */
  soldCount: number;
}

const TicketTypeRow: React.FC<TicketTypeRowProps> = ({ ticket, soldCount }) => {
  const sold = soldCount;
  const cap = ticket.isUnlimited
    ? Number.POSITIVE_INFINITY
    : (ticket.capacity ?? 0);
  const isSoldOut = !ticket.isUnlimited && cap > 0 && sold >= cap;
  const priceText = ticket.isFree ? "Free" : formatGbp(ticket.priceGbp ?? 0);
  const capText = ticket.isUnlimited
    ? `${sold} sold`
    : `${sold} / ${cap}`;

  return (
    <View style={ticketRowStyles.host}>
      <View style={ticketRowStyles.col}>
        <Text style={ticketRowStyles.name} numberOfLines={1}>
          {ticket.name}
        </Text>
        <Text style={ticketRowStyles.price}>{priceText}</Text>
      </View>
      <View style={ticketRowStyles.right}>
        {isSoldOut ? (
          <View style={ticketRowStyles.soldBadge}>
            <Text style={ticketRowStyles.soldText}>SOLD OUT</Text>
          </View>
        ) : (
          <Text style={ticketRowStyles.cap}>{capText}</Text>
        )}
      </View>
    </View>
  );
};

const ticketRowStyles = StyleSheet.create({
  host: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.md,
    backgroundColor: glass.tint.profileBase,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    gap: spacing.sm,
  },
  col: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.primary,
    marginBottom: 2,
  },
  price: {
    fontSize: 12,
    color: textTokens.secondary,
  },
  right: {
    alignItems: "flex-end",
  },
  cap: {
    fontSize: 12,
    fontWeight: "600",
    color: textTokens.tertiary,
    fontVariant: ["tabular-nums"],
  },
  soldBadge: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: radiusTokens.sm,
    backgroundColor: "rgba(239, 68, 68, 0.16)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.32)",
  },
  soldText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.0,
    color: semantic.error,
  },
});

// ---- ActivityRow (composed inline — Cycle 9c rework v3) ------------

interface ActivityRowProps {
  event: ActivityEvent;
}

interface ActivityKindSpec {
  iconName: IconName;
  iconColor: string;
  badgeBg: string;
  amountColor: string | null;
  amountSign: "+" | "-" | null;
}

const activityKindSpec = (event: ActivityEvent): ActivityKindSpec => {
  if (event.kind === "purchase") {
    return {
      iconName: "ticket",
      iconColor: "#34c759",
      badgeBg: "rgba(34, 197, 94, 0.18)",
      amountColor: "#34c759",
      amountSign: "+",
    };
  }
  if (event.kind === "refund") {
    return {
      iconName: "refund",
      iconColor: accent.warm,
      badgeBg: "rgba(235, 120, 37, 0.18)",
      amountColor: accent.warm,
      amountSign: "-",
    };
  }
  if (event.kind === "cancel") {
    return {
      iconName: "close",
      iconColor: textTokens.tertiary,
      badgeBg: "rgba(120, 120, 120, 0.18)",
      amountColor: null,
      amountSign: null,
    };
  }
  if (event.kind === "event_edit") {
    // Severity drives color: additive = info-blue (quiet), material = accent.warm (louder).
    // "destructive" not reachable here — those are order-level (refund/cancel) and
    // already rendered via the order streams + filtered out at recentActivity build.
    if (event.severity === "material") {
      return {
        iconName: "edit",
        iconColor: accent.warm,
        badgeBg: "rgba(235, 120, 37, 0.18)",
        amountColor: null,
        amountSign: null,
      };
    }
    return {
      iconName: "edit",
      iconColor: "#3b82f6",
      badgeBg: "rgba(59, 130, 246, 0.18)",
      amountColor: null,
      amountSign: null,
    };
  }
  if (event.kind === "event_sales_ended") {
    return {
      iconName: "clock",
      iconColor: "#3b82f6",
      badgeBg: "rgba(59, 130, 246, 0.18)",
      amountColor: null,
      amountSign: null,
    };
  }
  if (event.kind === "event_scan") {
    // Cycle 11 — same success-green as purchase but with check icon to
    // emphasise check-in vs new sale.
    return {
      iconName: "check",
      iconColor: "#34c759",
      badgeBg: "rgba(52, 199, 89, 0.18)",
      amountColor: null,
      amountSign: null,
    };
  }
  if (event.kind === "event_door_refund") {
    // Cycle 12 — same warm-orange treatment as order `refund` so refunds
    // feel consistent across online + door streams. summary already carries
    // "(door)" suffix for the buyer to disambiguate.
    return {
      iconName: "refund",
      iconColor: accent.warm,
      badgeBg: "rgba(235, 120, 37, 0.18)",
      amountColor: accent.warm,
      amountSign: "-",
    };
  }
  // event_cancelled — same close icon as order-cancel but red severity to
  // signal "everyone affected" vs grey "one buyer affected".
  return {
    iconName: "close",
    iconColor: semantic.error,
    badgeBg: "rgba(239, 68, 68, 0.18)",
    amountColor: null,
    amountSign: null,
  };
};

const ActivityRow: React.FC<ActivityRowProps> = ({ event: a }) => {
  const spec = activityKindSpec(a);
  const relTime = formatActivityRelativeTime(a.at);

  // Amount label only applies to order-level kinds with money flow.
  // Purchase with totalGbpAtPurchase === 0 renders "Free" instead of "+£0.00".
  let amountLabel: string | null = null;
  if (a.kind === "purchase") {
    amountLabel =
      a.amountGbp === 0
        ? "Free"
        : `${spec.amountSign ?? ""}${formatGbp(a.amountGbp)}`;
  } else if (a.kind === "refund") {
    amountLabel = `${spec.amountSign ?? ""}${formatGbp(a.amountGbp)}`;
  } else if (a.kind === "event_door_refund") {
    // Cycle 12 — door refund renders amount the same as online refund
    // (warm color + minus sign) so the operator's eye sweep across the
    // feed sees "money out" consistently regardless of channel.
    amountLabel = `${spec.amountSign ?? ""}${formatGbp(a.amountGbp)}`;
  }

  // Row shape branches by stream:
  //  - order-level (purchase / refund / cancel / event_door_refund):
  //    {buyerName} \\ {summary} \\ relTime
  //  - event_edit: {summary} \\ {reason} \\ relTime  (no buyer)
  //  - event_sales_ended / event_cancelled: {summary} \\ relTime  (no buyer, no reason)
  //  - event_scan: same shape as event-level (no separate buyer line);
  //    summary already carries the buyer name ("Tunde checked in").
  const isOrderLevel =
    a.kind === "purchase" ||
    a.kind === "refund" ||
    a.kind === "cancel" ||
    a.kind === "event_door_refund";

  return (
    <View style={activityRowStyles.host}>
      <View
        style={[activityRowStyles.iconBadge, { backgroundColor: spec.badgeBg }]}
      >
        <Icon name={spec.iconName} size={16} color={spec.iconColor} />
      </View>
      <View style={activityRowStyles.col}>
        {isOrderLevel ? (
          <>
            <Text style={activityRowStyles.name} numberOfLines={1}>
              {a.buyerName}
            </Text>
            <Text style={activityRowStyles.summary} numberOfLines={1}>
              {a.summary}
            </Text>
          </>
        ) : (
          <>
            <Text style={activityRowStyles.name} numberOfLines={1}>
              {a.summary}
            </Text>
            {a.kind === "event_edit" && a.reason.trim().length > 0 ? (
              <Text style={activityRowStyles.summary} numberOfLines={1}>
                {a.reason}
              </Text>
            ) : null}
          </>
        )}
        <Text style={activityRowStyles.time} numberOfLines={1}>
          {relTime}
        </Text>
      </View>
      {amountLabel !== null && spec.amountColor !== null ? (
        <Text
          style={[activityRowStyles.amount, { color: spec.amountColor }]}
          numberOfLines={1}
        >
          {amountLabel}
        </Text>
      ) : null}
    </View>
  );
};

const activityRowStyles = StyleSheet.create({
  host: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  col: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 13,
    fontWeight: "600",
    color: textTokens.primary,
  },
  summary: {
    fontSize: 12,
    color: textTokens.secondary,
    marginTop: 1,
  },
  time: {
    fontSize: 11,
    color: textTokens.tertiary,
    marginTop: 1,
  },
  amount: {
    fontSize: 13,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    flexShrink: 0,
    marginLeft: spacing.sm,
  },
});

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
    textShadowColor: "rgba(0, 0, 0, 0.4)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 12,
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
