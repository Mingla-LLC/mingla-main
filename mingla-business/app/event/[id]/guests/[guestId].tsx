/**
 * /event/[id]/guests/[guestId] — J-G2 Guest detail (Cycle 10).
 *
 * `guestId` is composite: `{kind}-{innerId}` where kind ∈ {"order","door"}.
 *
 * Order kind: hero + status + one row per REAL ticket with its server check-in
 * state + Admit + order activity + purchase history (same brand).
 * issue #3827: a guest-list (comp) order shows GUEST LIST, the team note,
 * "Came with" / "BROUGHT", Resend ticket and Cancel guest-list ticket. The old
 * phone-only `comp-` kind is gone; such links render the not-found shell.
 *
 * Per Cycle 10 SPEC §5/J-G2.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
// ORCH-0892-B v2: ScrollView via SmartScrollView wrapper. Per SPEC §7.F.
import { ScrollView } from "../../../../src/wrappers/SmartScrollView";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  canvas,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../../../src/constants/designSystem";
import { useQueryClient } from "@tanstack/react-query";
import { useManagedEventRoute } from "../../../../src/hooks/useManagedEventRoute";
import type { OrderRecord } from "../../../../src/store/orderStore";
import {
  eventOrdersKeys,
  useEventGuestById,
  useEventGuestList,
} from "../../../../src/hooks/useEventOrders";
import { guestRosterKeys } from "../../../../src/hooks/useGuestRoster";
import { useCurrentBrandRole } from "../../../../src/hooks/useCurrentBrandRole";
import { canPerformAction } from "../../../../src/utils/permissionGates";
import { BRAND_ROLE_RANK } from "../../../../src/utils/brandRole";
import { isCompOrder } from "../../../../src/utils/compOrders";
import {
  GuestListError,
  admitTicket,
  cancelGuestListTicket,
  guestListErrorCopy,
  resendGuestListTicket,
} from "../../../../src/services/guestListService";
import {
  useDoorSalesStore,
  type DoorSaleRecord,
} from "../../../../src/store/doorSalesStore";
import { formatCurrency } from "../../../../src/utils/currency";
import { deferAfterDismiss } from "../../../../src/utils/deferAfterDismiss";
import { expandDoorTickets } from "../../../../src/utils/expandDoorTickets";
import { PAYMENT_METHOD_LABELS } from "../../../../src/utils/paymentMethodLabels";

import { DoorRefundSheet } from "../../../../src/components/door/DoorRefundSheet";
import { Button } from "../../../../src/components/ui/Button";
import { EmptyState } from "../../../../src/components/ui/EmptyState";
import { GlassCard } from "../../../../src/components/ui/GlassCard";
import { IconChrome } from "../../../../src/components/ui/IconChrome";
import { Pill } from "../../../../src/components/ui/Pill";
import { Sheet } from "../../../../src/components/ui/Sheet";
import { Toast } from "../../../../src/components/ui/Toast";

// ---- Helpers --------------------------------------------------------

const RELATIVE_TIME_MS = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

const formatRelativeTime = (iso: string): string => {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const delta = now - then;
  if (delta < RELATIVE_TIME_MS.minute) return "just now";
  if (delta < RELATIVE_TIME_MS.hour) {
    return `${Math.floor(delta / RELATIVE_TIME_MS.minute)}m ago`;
  }
  if (delta < RELATIVE_TIME_MS.day) {
    return `${Math.floor(delta / RELATIVE_TIME_MS.hour)}h ago`;
  }
  return `${Math.floor(delta / RELATIVE_TIME_MS.day)}d ago`;
};

const hashStringToHue = (s: string): number => {
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
};

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

const parseGuestId = (
  raw: string,
): { kind: "order" | "legacyComp" | "door"; innerId: string } | null => {
  if (raw.startsWith("order-")) {
    return { kind: "order", innerId: raw.slice("order-".length) };
  }
  // issue #3827 — the phone-only comp list is gone. Old links say so.
  if (raw.startsWith("comp-")) {
    return { kind: "legacyComp", innerId: raw.slice("comp-".length) };
  }
  // Cycle 12 — door sale rows from J-G1 use the "door-" prefix.
  if (raw.startsWith("door-")) {
    return { kind: "door", innerId: raw.slice("door-".length) };
  }
  return null;
};

interface DoorStatusPillSpec {
  variant: "info" | "warn" | "draft" | "accent";
  label: string;
}

const doorStatusPill = (
  status: DoorSaleRecord["status"],
): DoorStatusPillSpec => {
  if (status === "completed") return { variant: "info", label: "PAID" };
  if (status === "refunded_full") return { variant: "warn", label: "REFUNDED" };
  if (status === "refunded_partial") return { variant: "accent", label: "PARTIAL" };
  const _exhaust: never = status;
  return _exhaust;
};

interface OrderStatusPillSpec {
  variant: "info" | "warn" | "draft" | "accent";
  label: string;
}

const orderStatusPill = (order: OrderRecord): OrderStatusPillSpec => {
  const status = order.status;
  if (isCompOrder(order)) {
    return status === "cancelled"
      ? { variant: "draft", label: "CANCELLED" }
      : { variant: "accent", label: "GUEST LIST" };
  }
  switch (status) {
    case "paid":
      return { variant: "info", label: "PAID" };
    case "refunded_full":
      return { variant: "warn", label: "REFUNDED" };
    case "refunded_partial":
      return { variant: "accent", label: "PARTIAL" };
    case "cancelled":
      return { variant: "draft", label: "CANCELLED" };
    default: {
      const _exhaust: never = status;
      return _exhaust;
    }
  }
};

const newRequestId = (): string => {
  const cryptoLike = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoLike?.randomUUID) return cryptoLike.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
};

const formatClock = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
};

/** issue #3827 — one row per REAL ticket of the order, with its server state. */
export interface GuestTicketRow {
  ticketId: string;
  ticketName: string;
  isFree: boolean;
  unitPrice: number;
  state: "checked_in" | "not_checked_in" | "cancelled" | "refunded" | "transferred";
  usedAt: string | null;
}

export const buildGuestTicketRows = (order: OrderRecord): GuestTicketRow[] =>
  (order.ticketDays ?? []).map((ticket) => {
    const line = order.lines.find((l) => l.ticketTypeId === ticket.ticketTypeId) ?? order.lines[0];
    const state: GuestTicketRow["state"] =
      ticket.status === "used" || ticket.usedAt !== null
        ? "checked_in"
        : ticket.status === "void"
          ? "cancelled"
          : ticket.status === "refunded"
            ? "refunded"
            : ticket.status === "transferred"
              ? "transferred"
              : "not_checked_in";
    return {
      ticketId: ticket.ticketId,
      ticketName: line?.ticketNameAtPurchase ?? "Ticket",
      isFree: line?.isFreeAtPurchase ?? true,
      unitPrice: line?.unitPriceGbpAtPurchase ?? 0,
      state,
      usedAt: ticket.usedAt,
    };
  });

// Scanner role, or event manager and above (auto-provisioned as door staff).
// The server's scan gate stays authoritative.
const canDoorScanFromRank = (rank: number): boolean =>
  rank === BRAND_ROLE_RANK.scanner || rank >= BRAND_ROLE_RANK.event_manager;

// ---- Screen ---------------------------------------------------------

export default function GuestDetailRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    id: string | string[];
    guestId: string | string[];
  }>();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;
  const rawGuestId = Array.isArray(params.guestId)
    ? params.guestId[0]
    : params.guestId;

  const parsed = typeof rawGuestId === "string" ? parseGuestId(rawGuestId) : null;

  const routeEvent = useManagedEventRoute(
    typeof eventId === "string" ? eventId : null,
  );
  const event = routeEvent.event;
  const brand = routeEvent.brand;
  const queryClient = useQueryClient();
  const { rank: currentRank } = useCurrentBrandRole(brand?.id ?? null);
  const canManageGuestList = canPerformAction(currentRank, "ADD_COMP_GUEST");
  const canDoorScan = canDoorScanFromRank(currentRank);

  const orderRead = useEventGuestById(
    typeof eventId === "string" ? eventId : null,
    parsed !== null && parsed.kind === "order" ? parsed.innerId : null,
  );
  const order = orderRead.data;
  // Cycle 12 — single-existing-reference selector; safe to subscribe.
  const sale = useDoorSalesStore((s) =>
    parsed !== null && parsed.kind === "door"
      ? s.getSaleById(parsed.innerId)
      : null,
  );

  // Cross-event purchase history for this buyer's email (same brand only).
  const allOrderEntriesRead = useEventGuestList(
    typeof eventId === "string" && parsed?.kind === "order" ? eventId : null,
  );
  const allOrderEntries = allOrderEntriesRead.data ?? [];
  const otherOrders = useMemo<OrderRecord[]>(() => {
    if (order === null) return [];
    const lower = order.buyer.email.toLowerCase();
    return allOrderEntries
      .filter(
        (o) =>
          o.brandId === order.brandId &&
          o.buyer.email.toLowerCase() === lower &&
          o.id !== order.id,
      )
      .sort(
        (a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime(),
      );
  }, [allOrderEntries, order]);

  // Hooks run BEFORE the early-return shell below (React Rules of Hooks).
  // ORCH-0710 fix — see prompts/IMPLEMENTOR_BIZ_CYCLE_11_RETRY_ORCH-0710_ORCH-0711.md.
  const isOrderCandidate =
    parsed !== null && parsed.kind === "order" && order !== null;

  // issue #3827 — one row per REAL ticket, with the SERVER's check-in state.
  const ticketRows = useMemo<GuestTicketRow[]>(() => {
    if (!isOrderCandidate || order === null) return [];
    return buildGuestTicketRows(order);
  }, [isOrderCandidate, order]);
  const liveTicketRows = ticketRows.filter(
    (t) => t.state === "checked_in" || t.state === "not_checked_in",
  );
  const totalLiveQty = liveTicketRows.length;
  const orderCheckedCount = liveTicketRows.filter((t) => t.state === "checked_in").length;

  // issue #3827 — "Came with" (a plus-one) and "BROUGHT" (their guest).
  const partyLead = useMemo<OrderRecord | null>(() => {
    if (order === null || order.partyLeadOrderId === null || order.partyLeadOrderId === undefined) return null;
    return allOrderEntries.find((o) => o.id === order.partyLeadOrderId) ?? null;
  }, [allOrderEntries, order]);
  const brought = useMemo<OrderRecord[]>(() => {
    if (order === null) return [];
    return allOrderEntries.filter((o) => o.partyLeadOrderId === order.id);
  }, [allOrderEntries, order]);

  // Cycle 12 — door candidate hooks. Per ORCH-0710 lesson: all useMemos
  // sit BEFORE the early-return shell. Each one short-circuits with empty
  // result if guard data isn't ready.
  const isDoorCandidate =
    parsed !== null && parsed.kind === "door" && sale !== null;

  const expandedDoorTickets = useMemo(() => {
    if (!isDoorCandidate || sale === null) return [];
    return expandDoorTickets(sale.id, sale.lines);
  }, [isDoorCandidate, sale]);

  const refundedQtyByTier = useMemo<Map<string, number>>(() => {
    if (!isDoorCandidate || sale === null) return new Map();
    const map = new Map<string, number>();
    for (const l of sale.lines) {
      map.set(l.ticketTypeId, l.refundedQuantity);
    }
    return map;
  }, [isDoorCandidate, sale]);

  const [cancelOpen, setCancelOpen] = useState<boolean>(false);
  const [cancelReason, setCancelReason] = useState<string>("");
  const [cancelling, setCancelling] = useState<boolean>(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const cancelRequestId = useRef<string>(newRequestId());
  const [resending, setResending] = useState<boolean>(false);
  const [admittingId, setAdmittingId] = useState<string | null>(null);
  // Cycle 12 — door refund sheet state.
  const [refundOpen, setRefundOpen] = useState<boolean>(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });

  // Fresh cancel sheet (and one request id per opening) on every open.
  useEffect(() => {
    if (cancelOpen) {
      setCancelReason("");
      setCancelling(false);
      setCancelError(null);
      cancelRequestId.current = newRequestId();
    }
  }, [cancelOpen]);

  const showToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (typeof eventId === "string") {
      router.replace(`/event/${eventId}/guests` as never);
    }
  }, [router, eventId]);

  const handleOpenOtherOrder = useCallback(
    (otherOrder: OrderRecord): void => {
      router.push(
        `/event/${otherOrder.eventId}/orders/${otherOrder.id}` as never,
      );
    },
    [router],
  );

  const cancelReasonTooLong = cancelReason.trim().length > 200;

  const refreshGuestTruth = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: eventOrdersKeys.all });
    if (typeof eventId === "string") {
      void queryClient.invalidateQueries({ queryKey: [...guestRosterKeys.all, eventId] });
    }
  }, [queryClient, eventId]);

  // issue #3827 — Admit goes through the SAME server check as a QR scan
  // (guest-list `admit` → biz_ticket_admit_by_id → biz_ticket_scan). It
  // replaces "Mark checked in", which only wrote this phone's scan log.
  const handleAdmit = useCallback(
    async (ticketId: string, guestName: string): Promise<void> => {
      if (typeof eventId !== "string" || admittingId !== null) return;
      setAdmittingId(ticketId);
      try {
        const res = await admitTicket({ eventId, ticketId });
        if (res.result === "success") showToast(`${guestName} checked in`);
        else if (res.result === "duplicate") showToast("Already checked in");
        else if (res.result === "void") showToast("Ticket not valid");
        else if (res.result === "not_yet_open") showToast("Doors aren't open yet");
        else if (res.result === "event_ended") showToast("This event has ended.");
        else showToast("Ticket not found");
        refreshGuestTruth();
      } catch (error) {
        showToast(error instanceof GuestListError ? error.message : guestListErrorCopy("network", "admit"));
      } finally {
        setAdmittingId(null);
      }
    },
    [eventId, admittingId, showToast, refreshGuestTruth],
  );

  const handleResend = useCallback(async (): Promise<void> => {
    if (order === null || resending) return;
    setResending(true);
    try {
      await resendGuestListTicket({ orderId: order.id, clientRequestId: newRequestId() });
      showToast(`Ticket resent to ${order.buyer.email}.`);
    } catch (error) {
      showToast(error instanceof GuestListError ? error.message : guestListErrorCopy("internal", "resend"));
    } finally {
      setResending(false);
    }
  }, [order, resending, showToast]);

  const handleCancelConfirm = useCallback(async (): Promise<void> => {
    if (order === null || cancelling || cancelReasonTooLong) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await cancelGuestListTicket({
        orderId: order.id,
        reason: cancelReason.trim() === "" ? null : cancelReason.trim(),
        clientRequestId: cancelRequestId.current,
      });
      setCancelling(false);
      setCancelOpen(false);
      refreshGuestTruth();
      deferAfterDismiss(() => showToast("Guest-list ticket cancelled."));
    } catch (error) {
      setCancelling(false);
      setCancelError(error instanceof GuestListError ? error.message : guestListErrorCopy("internal", "cancel"));
    }
  }, [order, cancelling, cancelReasonTooLong, cancelReason, refreshGuestTruth, showToast]);

  useEffect(() => {
    if (routeEvent.replacementEventId !== null && typeof rawGuestId === "string") {
      router.replace(
        `/event/${routeEvent.replacementEventId}/guests/${rawGuestId}` as never,
      );
    }
  }, [routeEvent.replacementEventId, router, rawGuestId]);

  if (event === null && routeEvent.isLoading && typeof eventId === "string") {
    return (
      <View
        style={[
          styles.host,
          { paddingTop: insets.top, backgroundColor: canvas.discover },
        ]}
      >
        <View style={styles.chromeRow}>
          <IconChrome
            icon="close"
            size={36}
            onPress={handleBack}
            accessibilityLabel="Back"
          />
          <Text style={styles.chromeTitle}>Guest</Text>
          <View style={styles.chromeRightSlot} />
        </View>
        <View style={styles.emptyHost}>
          <Text style={styles.emptyLoadingText}>Loading event...</Text>
        </View>
      </View>
    );
  }

  if (
    parsed?.kind === "order" &&
    (orderRead.status === "loading" || orderRead.status === "disabled")
  ) {
    return (
      <View style={[styles.host, { paddingTop: insets.top, backgroundColor: canvas.discover }]}>
        <View style={styles.chromeRow}>
          <IconChrome icon="close" size={36} onPress={handleBack} accessibilityLabel="Back" />
          <Text style={styles.chromeTitle}>Guest</Text>
          <View style={styles.chromeRightSlot} />
        </View>
        <View style={styles.emptyHost} accessibilityRole="progressbar">
          <Text style={styles.emptyLoadingText}>Loading guest…</Text>
        </View>
      </View>
    );
  }

  if (parsed?.kind === "order" && orderRead.status === "error") {
    return (
      <View style={[styles.host, { paddingTop: insets.top, backgroundColor: canvas.discover }]}>
        <View style={styles.chromeRow}>
          <IconChrome icon="close" size={36} onPress={handleBack} accessibilityLabel="Back" />
          <Text style={styles.chromeTitle}>Guest</Text>
          <View style={styles.chromeRightSlot} />
        </View>
        <View style={styles.emptyHost}>
          <EmptyState
            illustration="ticket"
            title="Couldn't load guest"
            description="No order-backed guest details are shown until orders load."
            cta={{ label: "Try again", onPress: () => { void orderRead.refetch(); }, variant: "primary" }}
          />
        </View>
      </View>
    );
  }

  // ---- Not-found shell ---------------------------------------------
  if (
    typeof eventId !== "string" ||
    parsed === null ||
    event === null ||
    parsed.kind === "legacyComp" ||
    (parsed.kind === "order" && order === null) ||
    (parsed.kind === "door" && sale === null)
  ) {
    return (
      <View
        style={[
          styles.host,
          { paddingTop: insets.top, backgroundColor: canvas.discover },
        ]}
      >
        <View style={styles.chromeRow}>
          <IconChrome
            icon="close"
            size={36}
            onPress={handleBack}
            accessibilityLabel="Back"
          />
          <Text style={styles.chromeTitle}>Guest</Text>
          <View style={styles.chromeRightSlot} />
        </View>
        <View style={styles.emptyHost}>
          <EmptyState
            illustration="ticket"
            title="Guest not found"
            description={
              parsed?.kind === "legacyComp"
                ? "This guest isn't on the server. Re-add them from Guests."
                : "They may have been removed."
            }
          />
        </View>
      </View>
    );
  }

  const isOrder = parsed.kind === "order" && order !== null;
  const isGuestList = isOrder && isCompOrder(order);
  const isCancelled = isOrder && order.status === "cancelled";
  const anyCheckedIn = orderCheckedCount > 0;
  // Cycle 12 — door narrowing. After the not-found shell guards above,
  // when parsed.kind === "door" then sale is non-null.
  const isDoor = parsed.kind === "door" && sale !== null;

  const name = isOrder
    ? order.buyer.name.trim().length > 0
      ? order.buyer.name
      : "Anonymous"
    : isDoor
      ? sale.buyerName.trim().length > 0
        ? sale.buyerName
        : "Walk-up"
      : "Guest";
  const email = isOrder
    ? order.buyer.email
    : isDoor
      ? sale.buyerEmail
      : "";
  const phone = isOrder
    ? order.buyer.phone
    : isDoor
      ? sale.buyerPhone
      : "";
  const hue = hashStringToHue(parsed.innerId);
  const initials = getInitials(name);

  // Cycle 12 — door refund handler. Per OBS-1, the buyer stays CHECKED IN
  // (DoorRefundSheet's handler does NOT touch useScanStore).
  const handleDoorRefundSuccess = (updated: DoorSaleRecord): void => {
    setRefundOpen(false);
    const refundedAmount =
      updated.refunds[updated.refunds.length - 1]?.amountGbp ?? 0;
    // #1360: defer the confirmation toast past the sheet's unmount window so
    // iOS doesn't drop it while the closing sheet's native modal still holds
    // the root VC (I-PROPOSED-1360-PAYMENT-CONFIRM-DEFERRED-PAST-DISMISSAL).
    deferAfterDismiss(() =>
      showToast(
        `Refunded ${formatCurrency(refundedAmount, updated.currency)}. ${name} stays checked in.`,
      ),
    );
  };

  return (
    <View
      style={[
        styles.host,
        { paddingTop: insets.top, backgroundColor: canvas.discover },
      ]}
    >
      {/* Chrome */}
      <View style={styles.chromeRow}>
        <IconChrome
          icon="close"
          size={36}
          onPress={handleBack}
          accessibilityLabel="Back"
        />
        <Text style={styles.chromeTitle}>Guest</Text>
        <View style={styles.chromeRightSlot} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 120 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View
            style={[styles.heroAvatar, { backgroundColor: `hsl(${hue}, 60%, 45%)` }]}
          >
            <Text style={styles.heroAvatarText}>{initials}</Text>
          </View>
          <Text style={styles.heroName} numberOfLines={1}>
            {name}
          </Text>
          {email.length > 0 ? (
            <Text style={styles.heroEmail} numberOfLines={1}>
              {email}
            </Text>
          ) : null}
          {phone.length > 0 ? (
            <Text style={styles.heroPhone} numberOfLines={1}>
              {phone}
            </Text>
          ) : null}
          <View style={styles.heroPills}>
            {isOrder ? (
              <Pill variant={orderStatusPill(order).variant}>
                {orderStatusPill(order).label}
              </Pill>
            ) : isDoor ? (
              <Pill variant={doorStatusPill(sale.status).variant}>
                {doorStatusPill(sale.status).label}
              </Pill>
            ) : null}
            {/* Cycle 11 + 12 — derived check-in pill.
                Door sales are auto-checked-in per Decision #5; OBS-1 means
                refund does NOT void check-in. Always show CHECKED IN. */}
            {isOrder ? (
              totalLiveQty === 0 ? null : orderCheckedCount === 0 ? (
                <View style={styles.checkInPill}>
                  <Text style={styles.checkInPillText}>NOT CHECKED IN</Text>
                </View>
              ) : orderCheckedCount < totalLiveQty ? (
                <Pill variant="accent">{`${orderCheckedCount} OF ${totalLiveQty} CHECKED IN`}</Pill>
              ) : (
                <Pill variant="info">ALL CHECKED IN</Pill>
              )
            ) : isDoor ? (
              <Pill variant="info">CHECKED IN</Pill>
            ) : null}
          </View>
          {isGuestList ? (
            <Text style={styles.heroAdded}>{`Added ${formatRelativeTime(order.paidAt)}`}</Text>
          ) : null}
        </View>

        {/* issue #3827 — a named plus-one's guest */}
        {isGuestList && order.partyLeadOrderId !== null && order.partyLeadOrderId !== undefined ? (
          <Pressable
            onPress={() => router.push(`/event/${eventId}/guests/order-${order.partyLeadOrderId}` as never)}
            disabled={partyLead === null}
            accessibilityRole="button"
            accessibilityLabel={`Open ${partyLead?.buyer.name ?? order.partyLeadName ?? "their guest"}'s guest page`}
            style={styles.cameWithRow}
          >
            <Text style={styles.cameWithText}>{`Came with ${partyLead?.buyer.name ?? order.partyLeadName ?? "their guest"}`}</Text>
            <Text style={styles.cameWithChevron} accessibilityElementsHidden>›</Text>
          </Pressable>
        ) : null}

        {/* Tickets section — Cycle 11 J-S5: per-ticket rows with check-in
            state pill + "Mark checked in" CTA per row. */}
        <Text style={styles.sectionLabel}>TICKETS</Text>
        <GlassCard variant="base" radius="md" padding={spacing.md}>
          {isOrder ? (
            <View style={styles.ticketRowsList}>
              {ticketRows.length === 0 ? (
                <Text style={styles.lineSubline}>No tickets on this order.</Text>
              ) : null}
              {ticketRows.map((t, idx) => (
                <View key={t.ticketId} style={styles.perTicketRow}>
                  <View style={styles.perTicketHeader}>
                    <View style={styles.perTicketCol}>
                      <Text style={styles.perTicketName} numberOfLines={1}>
                        {t.ticketName}
                      </Text>
                      <Text style={styles.perTicketSubline}>
                        {t.isFree
                          ? "Free"
                          : order.currency === null
                            ? "—"
                            : formatCurrency(t.unitPrice, order.currency)}{" "}
                        · #{idx + 1}
                      </Text>
                    </View>
                    {t.state === "checked_in" ? (
                      <Pill variant="info">
                        {t.usedAt !== null ? `CHECKED IN ${formatClock(t.usedAt)}` : "CHECKED IN"}
                      </Pill>
                    ) : t.state === "cancelled" ? (
                      <Pill variant="draft">CANCELLED</Pill>
                    ) : t.state === "refunded" ? (
                      <Pill variant="warn">REFUNDED</Pill>
                    ) : t.state === "transferred" ? (
                      <Pill variant="draft">TRANSFERRED</Pill>
                    ) : (
                      <View style={styles.perTicketPillNone}>
                        <Text style={styles.perTicketPillNoneText}>
                          NOT CHECKED IN
                        </Text>
                      </View>
                    )}
                  </View>
                  {t.state === "not_checked_in" && canDoorScan ? (
                    <View style={styles.perTicketCtaWrap}>
                      <Button
                        label={admittingId === t.ticketId ? "Admitting…" : "Admit"}
                        variant="primary"
                        size="sm"
                        loading={admittingId === t.ticketId}
                        disabled={admittingId !== null}
                        onPress={() => { void handleAdmit(t.ticketId, name); }}
                        accessibilityLabel={`Admit ${name}, ${t.ticketName}`}
                      />
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          ) : isDoor ? (
            <View style={styles.ticketRowsList}>
              {expandedDoorTickets.map((t, idx) => {
                const lineRefundedQty =
                  refundedQtyByTier.get(
                    sale.lines[t.lineIdx]?.ticketTypeId ?? "",
                  ) ?? 0;
                // A seat is "refund-applied" if its line index is < refundedQty
                // for that tier (oldest seats refund first by convention).
                const seatRefundApplied = t.seatIdx < lineRefundedQty;
                return (
                  <View key={t.ticketId} style={styles.perTicketRow}>
                    <View style={styles.perTicketHeader}>
                      <View style={styles.perTicketCol}>
                        <Text style={styles.perTicketName} numberOfLines={1}>
                          {t.ticketName}
                        </Text>
                        <Text style={styles.perTicketSubline}>
                          {t.isFreeAtSale
                            ? "Free"
                            : formatCurrency(t.unitPriceGbpAtSale, sale.currency)}{" "}
                          · #{idx + 1}
                        </Text>
                      </View>
                      {seatRefundApplied ? (
                        <Pill variant="warn">REFUNDED</Pill>
                      ) : (
                        <Pill variant="info">CHECKED IN</Pill>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}
        </GlassCard>

        {/* issue #3827 — the team note on a guest-list ticket */}
        {isGuestList && order.compReason !== null && order.compReason !== undefined && order.compReason.trim() !== "" ? (
          <>
            <Text style={styles.sectionLabel}>NOTE</Text>
            <GlassCard variant="base" radius="md" padding={spacing.md}>
              <Text style={styles.notesText}>{order.compReason}</Text>
            </GlassCard>
          </>
        ) : null}

        {/* issue #3827 — the named plus-ones who came with this guest */}
        {isGuestList && brought.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>{`BROUGHT (${brought.length})`}</Text>
            <GlassCard variant="base" radius="md" padding={spacing.md}>
              <View style={styles.linesList}>
                {brought.map((guest) => {
                  const rows = buildGuestTicketRows(guest);
                  const state = guest.status === "cancelled"
                    ? "Cancelled"
                    : rows.some((r) => r.state === "checked_in")
                      ? "Checked in"
                      : "Not checked in";
                  return (
                    <Pressable
                      key={guest.id}
                      onPress={() => router.push(`/event/${eventId}/guests/order-${guest.id}` as never)}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${guest.buyer.name}'s guest page, ${state}`}
                      style={styles.otherRow}
                    >
                      <Text style={styles.lineName} numberOfLines={1}>{`${guest.buyer.name} · ${state}`}</Text>
                      <Text style={styles.cameWithChevron} accessibilityElementsHidden>›</Text>
                    </Pressable>
                  );
                })}
              </View>
            </GlassCard>
          </>
        ) : null}

        {/* Order activity (sales only — a guest-list ticket has no payment) */}
        {isOrder && !isGuestList ? (
          <>
            <Text style={styles.sectionLabel}>ORDER ACTIVITY</Text>
            <GlassCard variant="base" radius="md" padding={spacing.md}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Paid</Text>
                <Text style={styles.summaryValue}>
                  {order.totalGbpAtPurchase === 0
                    ? "Free"
                    : order.currency === null
                      ? "—"
                      : formatCurrency(order.totalGbpAtPurchase, order.currency)}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Payment method</Text>
                <Text style={styles.summaryValue}>{order.paymentMethod}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Purchased</Text>
                <Text style={styles.summaryValue}>
                  {formatRelativeTime(order.paidAt)}
                </Text>
              </View>
              {order.refunds.length > 0 ? (
                <>
                  <View style={styles.divider} />
                  {order.refunds.map((r) => (
                    <View key={r.id} style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>
                        Refunded {formatRelativeTime(r.refundedAt)}
                      </Text>
                      <Text style={styles.summaryValueWarn}>
                        −{order.currency === null
                          ? "—"
                          : formatCurrency(r.amountGbp, order.currency)}
                      </Text>
                    </View>
                  ))}
                </>
              ) : null}
              {order.cancelledAt !== null ? (
                <>
                  <View style={styles.divider} />
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Cancelled</Text>
                    <Text style={styles.summaryValueWarn}>
                      {formatRelativeTime(order.cancelledAt)}
                    </Text>
                  </View>
                </>
              ) : null}
            </GlassCard>
          </>
        ) : null}

        {/* Cycle 12 — DOOR SALE PAYMENT section (door only) */}
        {isDoor ? (
          <>
            <Text style={styles.sectionLabel}>PAYMENT</Text>
            <GlassCard variant="base" radius="md" padding={spacing.md}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Payment method</Text>
                <Text style={styles.summaryValue}>
                  {PAYMENT_METHOD_LABELS[sale.paymentMethod]}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Total</Text>
                <Text style={styles.summaryValue}>
                  {formatCurrency(sale.totalGbpAtSale, sale.currency)}
                </Text>
              </View>
              {sale.refundedAmountGbp > 0 ? (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Refunded</Text>
                  <Text style={styles.summaryValueWarn}>
                    −{formatCurrency(sale.refundedAmountGbp, sale.currency)}
                  </Text>
                </View>
              ) : null}
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Recorded</Text>
                <Text style={styles.summaryValue}>
                  {formatRelativeTime(sale.recordedAt)}
                </Text>
              </View>
              {sale.notes.trim().length > 0 ? (
                <>
                  <View style={styles.divider} />
                  <Text style={styles.notesLabel}>Notes</Text>
                  <Text style={styles.notesText}>{sale.notes}</Text>
                </>
              ) : null}
              {sale.refunds.length > 0 ? (
                <>
                  <View style={styles.divider} />
                  {sale.refunds.map((r) => (
                    <View key={r.id} style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>
                        Refunded {formatRelativeTime(r.refundedAt)}
                      </Text>
                      <Text style={styles.summaryValueWarn}>
                        −{formatCurrency(r.amountGbp, sale.currency)}
                      </Text>
                    </View>
                  ))}
                </>
              ) : null}
            </GlassCard>
          </>
        ) : null}

        {/* Other orders (orders only) */}
        {isOrder && !isGuestList && otherOrders.length > 0 && brand !== null ? (
          <>
            <Text style={styles.sectionLabel}>
              OTHER ORDERS BY THIS BUYER
              {brand.displayName.length > 0 ? ` FOR ${brand.displayName}` : ""}
            </Text>
            <GlassCard variant="base" radius="md" padding={spacing.md}>
              <View style={styles.linesList}>
                {otherOrders.map((other) => (
                  <View key={other.id} style={styles.otherRow}>
                    <View style={styles.lineCol}>
                      <Text style={styles.lineName} numberOfLines={1}>
                        {other.lines[0]?.ticketNameAtPurchase ?? "Order"}
                      </Text>
                      <Text style={styles.lineSubline}>
                        {formatRelativeTime(other.paidAt)} ·{" "}
                        {orderStatusPill(other).label}
                      </Text>
                    </View>
                    <Button
                      label="View"
                      variant="ghost"
                      size="sm"
                      onPress={() => handleOpenOtherOrder(other)}
                      accessibilityLabel={`View order ${other.id}`}
                    />
                  </View>
                ))}
              </View>
            </GlassCard>
          </>
        ) : null}

        {/* issue #3827 — guest-list actions (event manager and above) */}
        {isGuestList && canManageGuestList && !isCancelled ? (
          <View style={styles.removeCtaWrap}>
            {order.buyer.email.trim().length > 0 ? (
              <Button
                label={resending ? "Resending…" : "Resend ticket"}
                variant="secondary"
                size="md"
                fullWidth
                loading={resending}
                disabled={resending}
                onPress={() => { void handleResend(); }}
                accessibilityLabel="Resend ticket"
              />
            ) : null}
            <View style={styles.removeActionSpacer} />
            <Button
              label="Cancel guest-list ticket"
              variant="destructive"
              size="md"
              fullWidth
              disabled={anyCheckedIn}
              onPress={() => setCancelOpen(true)}
              accessibilityLabel="Cancel guest-list ticket"
            />
            {anyCheckedIn ? (
              <Text style={styles.cancelCaption}>Already checked in</Text>
            ) : null}
          </View>
        ) : null}
        {isGuestList && isCancelled ? (
          <Text style={styles.cancelCaption}>
            Cancelled. The QR no longer works and the place was freed. No money was involved.
          </Text>
        ) : null}

        {/* Cycle 12 — Refund CTA (door sales only; hidden when fully refunded) */}
        {isDoor && sale.status !== "refunded_full" ? (
          <View style={styles.removeCtaWrap}>
            <Button
              label="Refund door sale"
              variant="ghost"
              size="md"
              fullWidth
              onPress={() => setRefundOpen(true)}
              accessibilityLabel="Refund door sale"
            />
          </View>
        ) : null}
      </ScrollView>

      {/* issue #3827 — cancel confirm (inline Sheet: ConfirmDialog has no reason field) */}
      {isGuestList ? (
        <Sheet
          visible={cancelOpen}
          onClose={() => (cancelling ? undefined : setCancelOpen(false))}
          snapPoint="half"
        >
          <View style={styles.removeSheet}>
            <Text style={styles.removeTitle}>{`Cancel ${name}'s guest-list ticket?`}</Text>
            <Text style={styles.removeSubhead}>
              {brought.length > 0
                ? "Their QR code stops working and the place is freed. No money is involved. Their guests keep their own tickets."
                : "Their QR code stops working and the place is freed. No money is involved."}
            </Text>
            <Text style={styles.removeReasonLabel}>Reason (optional)</Text>
            <View style={[styles.removeReasonInputWrap, cancelReasonTooLong && styles.removeReasonInputError]}>
              <TextInput
                value={cancelReason}
                onChangeText={setCancelReason}
                placeholder="Reason (optional)"
                placeholderTextColor={textTokens.quaternary}
                multiline
                numberOfLines={3}
                maxLength={200}
                style={styles.removeReasonInput}
                editable={!cancelling}
                accessibilityLabel="Reason (optional)"
              />
            </View>
            {cancelReasonTooLong ? (
              <Text style={styles.cancelError}>Keep the reason under 200 characters.</Text>
            ) : null}
            {cancelError !== null ? <Text style={styles.cancelError}>{cancelError}</Text> : null}
            <View style={styles.removeActions}>
              <Button
                label="Cancel ticket"
                variant="destructive"
                size="lg"
                fullWidth
                loading={cancelling}
                disabled={cancelling || cancelReasonTooLong}
                onPress={() => { void handleCancelConfirm(); }}
                accessibilityLabel="Cancel ticket"
              />
              <View style={styles.removeActionSpacer} />
              <Button
                label="Keep ticket"
                variant="ghost"
                size="md"
                fullWidth
                disabled={cancelling}
                onPress={() => setCancelOpen(false)}
                accessibilityLabel="Keep ticket"
              />
            </View>
          </View>
        </Sheet>
      ) : null}

      {/* Cycle 12 — door refund sheet (door only).
          OBS-1 lock is enforced inside DoorRefundSheet's handleConfirm:
          NO useScanStore touch. Buyer stays CHECKED IN. */}
      {isDoor ? (
        <DoorRefundSheet
          visible={refundOpen}
          sale={sale}
          onClose={() => setRefundOpen(false)}
          onSuccess={handleDoorRefundSuccess}
        />
      ) : null}

      {/* Toast */}
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

// ---- Styles --------------------------------------------------------

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  chromeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  chromeTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: textTokens.primary,
    letterSpacing: -0.2,
    textAlign: "center",
  },
  chromeRightSlot: {
    width: 36,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  emptyHost: {
    paddingTop: spacing.xl,
  },
  emptyLoadingText: {
    fontSize: 14,
    color: textTokens.secondary,
    textAlign: "center",
  },
  hero: {
    alignItems: "center",
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  heroAvatar: {
    width: 72,
    height: 72,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  heroAvatarText: {
    fontSize: 26,
    fontWeight: "700",
    color: textTokens.primary,
  },
  heroName: {
    fontSize: 22,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  heroEmail: {
    fontSize: 13,
    color: textTokens.secondary,
    marginBottom: 2,
  },
  heroPhone: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginBottom: 4,
  },
  heroAdded: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
  },
  cameWithRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  cameWithText: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.primary,
  },
  cameWithChevron: {
    fontSize: 18,
    color: textTokens.tertiary,
  },
  cancelCaption: {
    fontSize: 12,
    color: textTokens.tertiary,
    textAlign: "center",
    marginTop: spacing.xs,
  },
  cancelError: {
    fontSize: 12,
    color: accent.warm,
    marginTop: spacing.xs,
  },
  heroPills: {
    flexDirection: "row",
    gap: 6,
    marginTop: spacing.sm,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  checkInPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radiusTokens.sm,
    backgroundColor: "rgba(120, 120, 120, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(120, 120, 120, 0.32)",
  },
  checkInPillText: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.0,
    color: textTokens.tertiary,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: textTokens.tertiary,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  linesList: {
    gap: spacing.sm,
  },
  ticketRowsList: {
    gap: spacing.md - 2,
  },
  perTicketRow: {
    paddingVertical: spacing.xs,
    gap: 6,
  },
  perTicketHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  perTicketCol: {
    flex: 1,
    minWidth: 0,
  },
  perTicketName: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.primary,
  },
  perTicketSubline: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  perTicketPillNone: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radiusTokens.sm,
    backgroundColor: "rgba(120, 120, 120, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(120, 120, 120, 0.32)",
  },
  perTicketPillNoneText: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.0,
    color: textTokens.tertiary,
  },
  perTicketCtaWrap: {
    alignSelf: "flex-end",
  },
  lineRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  lineCol: {
    flex: 1,
    minWidth: 0,
  },
  lineName: {
    fontSize: 14,
    fontWeight: "500",
    color: textTokens.primary,
  },
  lineSubline: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  lineTotal: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.primary,
    fontVariant: ["tabular-nums"],
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingVertical: 4,
  },
  summaryLabel: {
    fontSize: 13,
    color: textTokens.secondary,
  },
  summaryValue: {
    fontSize: 13,
    color: textTokens.primary,
    fontWeight: "500",
  },
  summaryValueWarn: {
    fontSize: 13,
    color: accent.warm,
    fontWeight: "500",
  },
  divider: {
    marginVertical: spacing.sm,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  notesLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: textTokens.secondary,
    marginBottom: 4,
  },
  notesText: {
    fontSize: 13,
    color: textTokens.primary,
    lineHeight: 18,
  },
  otherRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  removeCtaWrap: {
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  removeSheet: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  removeTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.2,
    marginBottom: spacing.xs,
  },
  removeSubhead: {
    fontSize: 14,
    color: textTokens.secondary,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  removeReasonLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: textTokens.secondary,
    marginBottom: 6,
  },
  removeReasonRequired: {
    color: accent.warm,
  },
  removeReasonInputWrap: {
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radiusTokens.md,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
  },
  removeReasonInputError: {
    borderColor: "rgba(235, 120, 37, 0.5)",
  },
  removeReasonInput: {
    fontSize: 15,
    color: textTokens.primary,
    minHeight: 64,
    paddingVertical: 6,
    textAlignVertical: "top",
  },
  removeReasonMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 6,
    marginBottom: spacing.md,
  },
  removeReasonHelper: {
    fontSize: 12,
    color: textTokens.tertiary,
  },
  removeReasonHelperOk: {
    color: textTokens.secondary,
  },
  removeReasonCount: {
    fontSize: 11,
    color: textTokens.quaternary,
    fontVariant: ["tabular-nums"],
  },
  removeActions: {
    paddingTop: spacing.sm,
  },
  removeActionSpacer: {
    height: spacing.sm,
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
