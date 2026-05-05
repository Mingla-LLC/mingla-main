/**
 * /event/[id]/guests/[guestId] — J-G2 Guest detail (Cycle 10).
 *
 * `guestId` is composite: `{kind}-{innerId}` where kind ∈ {"order","comp"}.
 *
 * Order kind: shows hero + status + tickets + order activity + purchase history (same brand).
 * Comp kind: shows hero + status + ticket + ADDED BY + Remove guest CTA + ConfirmDialog.
 *
 * Per Cycle 10 SPEC §5/J-G2.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
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
import { useGuestStore } from "../../../../src/store/guestStore";
import { useEventEditLogStore } from "../../../../src/store/eventEditLogStore";
import { useLiveEventStore } from "../../../../src/store/liveEventStore";
import {
  useOrderStore,
  type OrderRecord,
} from "../../../../src/store/orderStore";
import { useScanStore } from "../../../../src/store/scanStore";
import {
  useDoorSalesStore,
  type DoorPaymentMethod,
  type DoorSaleRecord,
} from "../../../../src/store/doorSalesStore";
import { useCurrentBrandStore } from "../../../../src/store/currentBrandStore";
import { useAuth } from "../../../../src/context/AuthContext";
import { formatGbp } from "../../../../src/utils/currency";
import { expandTicketIds } from "../../../../src/utils/expandTicketIds";
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
): { kind: "order" | "comp" | "door"; innerId: string } | null => {
  if (raw.startsWith("order-")) {
    return { kind: "order", innerId: raw.slice("order-".length) };
  }
  if (raw.startsWith("comp-")) {
    return { kind: "comp", innerId: raw.slice("comp-".length) };
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

const orderStatusPill = (status: OrderRecord["status"]): OrderStatusPillSpec => {
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

  const event = useLiveEventStore((s) =>
    typeof eventId === "string"
      ? s.events.find((e) => e.id === eventId) ?? null
      : null,
  );
  const brand = useCurrentBrandStore((s) =>
    event !== null ? s.brands.find((b) => b.id === event.brandId) ?? null : null,
  );
  const { user } = useAuth();
  const operatorAccountId = user?.id ?? "anonymous";

  // Cycle 11 J-S5/S6 — derived check-in state from useScanStore.
  // Raw subscription + useMemo per selector pattern rule.
  const allScanEntries = useScanStore((s) => s.entries);
  const order = useOrderStore((s) =>
    parsed !== null && parsed.kind === "order"
      ? s.getOrderById(parsed.innerId)
      : null,
  );
  const comp = useGuestStore((s) =>
    parsed !== null && parsed.kind === "comp"
      ? s.getCompEntryById(parsed.innerId)
      : null,
  );
  // Cycle 12 — single-existing-reference selector; safe to subscribe.
  const sale = useDoorSalesStore((s) =>
    parsed !== null && parsed.kind === "door"
      ? s.getSaleById(parsed.innerId)
      : null,
  );

  // Cross-event purchase history for this buyer's email (same brand only).
  const allOrderEntries = useOrderStore((s) => s.entries);
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

  // Cycle 11 J-S5 — per-ticket check-in derivation. Hooks must run BEFORE
  // the early-return shell below (React Rules of Hooks). Each branch
  // internally short-circuits with empty result when guard data isn't ready
  // yet (e.g., cold-start render before persist hydration completes).
  // ORCH-0710 fix — see prompts/IMPLEMENTOR_BIZ_CYCLE_11_RETRY_ORCH-0710_ORCH-0711.md.
  const isOrderCandidate =
    parsed !== null && parsed.kind === "order" && order !== null;
  const isCompCandidate =
    parsed !== null && parsed.kind === "comp" && comp !== null;

  const expandedTickets = useMemo(() => {
    if (!isOrderCandidate || order === null) return [];
    return expandTicketIds(order.id, order.lines);
  }, [isOrderCandidate, order]);

  const orderCheckedTicketIds = useMemo(() => {
    if (!isOrderCandidate || order === null) return new Set<string>();
    const set = new Set<string>();
    for (const scan of allScanEntries) {
      if (scan.scanResult !== "success") continue;
      if (scan.orderId !== order.id) continue;
      set.add(scan.ticketId);
    }
    return set;
  }, [allScanEntries, isOrderCandidate, order]);

  const compCheckedIn = useMemo<boolean>(() => {
    if (!isCompCandidate || comp === null) return false;
    return allScanEntries.some(
      (s) =>
        s.scanResult === "success" &&
        s.via === "manual" &&
        s.ticketId === comp.id,
    );
  }, [allScanEntries, isCompCandidate, comp]);

  const totalLiveQty = useMemo<number>(() => {
    if (!isOrderCandidate || order === null) return 0;
    return order.lines.reduce(
      (sum, l) => sum + Math.max(0, l.quantity - l.refundedQuantity),
      0,
    );
  }, [isOrderCandidate, order]);

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

  const [removeOpen, setRemoveOpen] = useState<boolean>(false);
  const [removeReason, setRemoveReason] = useState<string>("");
  const [removing, setRemoving] = useState<boolean>(false);
  // Cycle 12 — door refund sheet state.
  const [refundOpen, setRefundOpen] = useState<boolean>(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });

  // Reset remove sheet state on visible flip → true
  useEffect(() => {
    if (removeOpen) {
      setRemoveReason("");
      setRemoving(false);
    }
  }, [removeOpen]);

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

  const trimmedRemoveReasonLen = removeReason.trim().length;
  const removeReasonValid =
    trimmedRemoveReasonLen >= 10 && trimmedRemoveReasonLen <= 200;

  // Cycle 11 J-S5 — manual check-in handler. Records via=manual scan;
  // activity feed picks up via event_scan kind. orderId === "" indicates
  // comp manual check-in (synthetic ticketId = comp.id).
  const handleManualCheckIn = useCallback(
    (args: {
      ticketId: string;
      orderId: string;
      buyerName: string;
      ticketName: string;
    }): void => {
      if (event === null) return;
      useScanStore.getState().recordScan({
        ticketId: args.ticketId,
        orderId: args.orderId,
        eventId: event.id,
        brandId: event.brandId,
        scannerUserId: operatorAccountId,
        scanResult: "success",
        via: "manual",
        offlineQueued: true,
        buyerNameAtScan: args.buyerName,
        ticketNameAtScan: args.ticketName,
      });
      showToast(`${args.buyerName} checked in`);
    },
    [event, operatorAccountId, showToast],
  );

  const handleRemoveConfirm = useCallback((): void => {
    if (comp === null || event === null) return;
    if (!removeReasonValid) return;
    setRemoving(true);
    const removed = useGuestStore.getState().removeCompEntry(comp.id);
    if (removed === null) {
      setRemoving(false);
      showToast("Couldn't remove guest. Tap to try again.");
      return;
    }
    // Audit log entry — caller-side per Cycle 9c v2 lesson.
    // orderId NOT set — surfaces in Cycle 9c-2 activity feed filter.
    useEventEditLogStore.getState().recordEdit({
      eventId: event.id,
      brandId: event.brandId,
      reason: removeReason.trim(),
      severity: "material",
      changedFieldKeys: ["compEntries"],
      diffSummary: [`removed comp guest: ${removed.name}`],
      affectedOrderIds: [],
    });
    setRemoving(false);
    setRemoveOpen(false);
    showToast("Comp guest removed.");
    handleBack();
  }, [comp, event, removeReason, removeReasonValid, showToast, handleBack]);

  // ---- Not-found shell ---------------------------------------------
  if (
    typeof eventId !== "string" ||
    parsed === null ||
    event === null ||
    (parsed.kind === "order" && order === null) ||
    (parsed.kind === "comp" && comp === null) ||
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
            description="They may have been removed."
          />
        </View>
      </View>
    );
  }

  const isOrder = parsed.kind === "order" && order !== null;
  const isComp = parsed.kind === "comp" && comp !== null;
  // Cycle 12 — door narrowing. After the not-found shell guards above,
  // when parsed.kind === "door" then sale is non-null.
  const isDoor = parsed.kind === "door" && sale !== null;

  // ORCH-0710 fix — derived check-in counts, sourced from useMemos above
  // the early-return shell so hook count is stable across renders.
  const orderCheckedCount = orderCheckedTicketIds.size;

  const name = isOrder
    ? order.buyer.name.trim().length > 0
      ? order.buyer.name
      : "Anonymous"
    : isComp
      ? comp.name
      : isDoor
        ? sale.buyerName.trim().length > 0
          ? sale.buyerName
          : "Walk-up"
        : "Guest";
  const email = isOrder
    ? order.buyer.email
    : isComp
      ? comp.email
      : isDoor
        ? sale.buyerEmail
        : "";
  const phone = isOrder
    ? order.buyer.phone
    : isComp
      ? comp.phone
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
    showToast(
      `Refunded ${formatGbp(refundedAmount)}. ${name} stays checked in.`,
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
              <Pill variant={orderStatusPill(order.status).variant}>
                {orderStatusPill(order.status).label}
              </Pill>
            ) : isComp ? (
              <Pill variant="accent">COMP</Pill>
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
            ) : isComp ? (
              compCheckedIn ? (
                <Pill variant="info">CHECKED IN</Pill>
              ) : (
                <View style={styles.checkInPill}>
                  <Text style={styles.checkInPillText}>NOT CHECKED IN</Text>
                </View>
              )
            ) : isDoor ? (
              <Pill variant="info">CHECKED IN</Pill>
            ) : null}
          </View>
        </View>

        {/* Tickets section — Cycle 11 J-S5: per-ticket rows with check-in
            state pill + "Mark checked in" CTA per row. */}
        <Text style={styles.sectionLabel}>TICKETS</Text>
        <GlassCard variant="base" radius="md" padding={spacing.md}>
          {isOrder ? (
            <View style={styles.ticketRowsList}>
              {expandedTickets.map((t, idx) => {
                const checked = orderCheckedTicketIds.has(t.ticketId);
                const buyerName =
                  order.buyer.name.trim().length > 0
                    ? order.buyer.name
                    : "Anonymous";
                return (
                  <View key={t.ticketId} style={styles.perTicketRow}>
                    <View style={styles.perTicketHeader}>
                      <View style={styles.perTicketCol}>
                        <Text style={styles.perTicketName} numberOfLines={1}>
                          {t.ticketName}
                        </Text>
                        <Text style={styles.perTicketSubline}>
                          {t.isFreeAtPurchase
                            ? "Free"
                            : formatGbp(t.unitPriceGbpAtPurchase)}{" "}
                          · #{idx + 1}
                        </Text>
                      </View>
                      {checked ? (
                        <Pill variant="info">CHECKED IN</Pill>
                      ) : (
                        <View style={styles.perTicketPillNone}>
                          <Text style={styles.perTicketPillNoneText}>
                            NOT CHECKED IN
                          </Text>
                        </View>
                      )}
                    </View>
                    {!checked ? (
                      <View style={styles.perTicketCtaWrap}>
                        <Button
                          label="Mark checked in"
                          variant="primary"
                          size="sm"
                          onPress={() =>
                            handleManualCheckIn({
                              ticketId: t.ticketId,
                              orderId: order.id,
                              buyerName,
                              ticketName: t.ticketName,
                            })
                          }
                          accessibilityLabel={`Mark ticket ${idx + 1} checked in`}
                        />
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : isComp ? (
            <View style={styles.lineRow}>
              <View style={styles.lineCol}>
                <Text style={styles.lineName}>
                  {comp.ticketNameAtCreation ?? "General comp"}
                </Text>
                <Text style={styles.lineSubline}>1× Comp</Text>
              </View>
              {compCheckedIn ? (
                <Pill variant="info">CHECKED IN</Pill>
              ) : (
                <Button
                  label="Mark checked in"
                  variant="primary"
                  size="sm"
                  onPress={() =>
                    handleManualCheckIn({
                      ticketId: comp.id,
                      orderId: "",
                      buyerName: comp.name,
                      ticketName: comp.ticketNameAtCreation ?? "Comp",
                    })
                  }
                  accessibilityLabel="Mark comp guest checked in"
                />
              )}
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
                            : formatGbp(t.unitPriceGbpAtSale)}{" "}
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

        {/* Order activity (orders only) */}
        {isOrder ? (
          <>
            <Text style={styles.sectionLabel}>ORDER ACTIVITY</Text>
            <GlassCard variant="base" radius="md" padding={spacing.md}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Paid</Text>
                <Text style={styles.summaryValue}>
                  {formatGbp(order.totalGbpAtPurchase)}
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
                        −{formatGbp(r.amountGbp)}
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
                  {formatGbp(sale.totalGbpAtSale)}
                </Text>
              </View>
              {sale.refundedAmountGbp > 0 ? (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Refunded</Text>
                  <Text style={styles.summaryValueWarn}>
                    −{formatGbp(sale.refundedAmountGbp)}
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
                        −{formatGbp(r.amountGbp)}
                      </Text>
                    </View>
                  ))}
                </>
              ) : null}
            </GlassCard>
          </>
        ) : null}

        {/* Comp metadata (comps only) */}
        {isComp ? (
          <>
            <Text style={styles.sectionLabel}>ADDED BY</Text>
            <GlassCard variant="base" radius="md" padding={spacing.md}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Operator</Text>
                <Text style={styles.summaryValue} numberOfLines={1}>
                  {comp.addedBy.length > 0 ? comp.addedBy : "Unknown"}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Added</Text>
                <Text style={styles.summaryValue}>
                  {formatRelativeTime(comp.addedAt)}
                </Text>
              </View>
              {comp.notes.trim().length > 0 ? (
                <>
                  <View style={styles.divider} />
                  <Text style={styles.notesLabel}>Notes</Text>
                  <Text style={styles.notesText}>{comp.notes}</Text>
                </>
              ) : null}
            </GlassCard>
          </>
        ) : null}

        {/* Other orders (orders only) */}
        {isOrder && otherOrders.length > 0 && brand !== null ? (
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
                        {orderStatusPill(other.status).label}
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

        {/* Remove CTA (comps only) */}
        {isComp ? (
          <View style={styles.removeCtaWrap}>
            <Button
              label="Remove guest"
              variant="ghost"
              size="md"
              fullWidth
              onPress={() => setRemoveOpen(true)}
              accessibilityLabel="Remove comp guest"
            />
          </View>
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

      {/* Remove confirm sheet (inline — ConfirmDialog has no reasoned variant) */}
      {isComp ? (
        <Sheet
          visible={removeOpen}
          onClose={() => (removing ? undefined : setRemoveOpen(false))}
          snapPoint="half"
        >
          <View style={styles.removeSheet}>
            <Text style={styles.removeTitle}>Remove this comp guest?</Text>
            <Text style={styles.removeSubhead}>
              They'll be deleted from your guest list. This action records to the audit log.
            </Text>
            <Text style={styles.removeReasonLabel}>
              Why are you removing them? <Text style={styles.removeReasonRequired}>*</Text>
            </Text>
            <View
              style={[
                styles.removeReasonInputWrap,
                trimmedRemoveReasonLen > 0 &&
                  !removeReasonValid &&
                  styles.removeReasonInputError,
              ]}
            >
              <TextInput
                value={removeReason}
                onChangeText={setRemoveReason}
                placeholder="e.g. Mistake — added the wrong person"
                placeholderTextColor={textTokens.quaternary}
                multiline
                numberOfLines={3}
                maxLength={200}
                style={styles.removeReasonInput}
                editable={!removing}
                accessibilityLabel="Remove reason"
              />
            </View>
            <View style={styles.removeReasonMetaRow}>
              <Text
                style={[
                  styles.removeReasonHelper,
                  trimmedRemoveReasonLen >= 10 && styles.removeReasonHelperOk,
                ]}
              >
                {trimmedRemoveReasonLen < 10
                  ? "Tell us why (10–200 chars)."
                  : "Looks good"}
              </Text>
              <Text style={styles.removeReasonCount}>
                {trimmedRemoveReasonLen} / 200
              </Text>
            </View>
            <View style={styles.removeActions}>
              <Button
                label="Remove guest"
                variant="destructive"
                size="lg"
                fullWidth
                loading={removing}
                disabled={!removeReasonValid || removing}
                onPress={handleRemoveConfirm}
                accessibilityLabel="Confirm remove comp guest"
              />
              <View style={styles.removeActionSpacer} />
              <Button
                label="Keep guest"
                variant="ghost"
                size="md"
                fullWidth
                disabled={removing}
                onPress={() => setRemoveOpen(false)}
                accessibilityLabel="Cancel remove"
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
