/**
 * /event/[id]/door/[saleId] — J-D4 Door Sale Detail (Cycle 12).
 *
 * Substantive surface: hero (sale ID + recorded date + status pill +
 * payment-method pill) → TICKETS section (per-seat from expandDoorTickets)
 * → PAYMENT section (method + total + refunded amount) → BUYER section
 * (if any details captured) → NOTES section → REFUND HISTORY → "Refund"
 * CTA (variant=ghost) which opens DoorRefundSheet.
 *
 * I-21: operator-side route. I-29: door sales live ONLY in useDoorSalesStore.
 *
 * **OBS-1 lock:** refund handler in DoorRefundSheet does NOT touch
 * useScanStore. Buyer remains CHECKED IN (auto-check-in fired at sale time).
 *
 * Per Cycle 12 SPEC §4.10 + §4.13 / §5/J-D4.
 */

import React, { useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
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
import {
  useDoorSalesStore,
  type DoorPaymentMethod,
  type DoorSaleRecord,
} from "../../../../src/store/doorSalesStore";
import { useLiveEventStore } from "../../../../src/store/liveEventStore";
import { formatGbp } from "../../../../src/utils/currency";
import { expandDoorTickets } from "../../../../src/utils/expandDoorTickets";

import { DoorRefundSheet } from "../../../../src/components/door/DoorRefundSheet";
import { Button } from "../../../../src/components/ui/Button";
import { EmptyState } from "../../../../src/components/ui/EmptyState";
import { GlassCard } from "../../../../src/components/ui/GlassCard";
import { IconChrome } from "../../../../src/components/ui/IconChrome";
import { Pill } from "../../../../src/components/ui/Pill";
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

const formatAbsoluteDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const PAYMENT_METHOD_LABELS: Record<DoorPaymentMethod, string> = {
  cash: "Cash",
  card_reader: "Card reader",
  nfc: "NFC tap",
  manual: "Manual",
};

interface PaymentPillSpec {
  variant: "info" | "warn" | "draft" | "accent";
  label: string;
}

const doorStatusPill = (
  status: DoorSaleRecord["status"],
): PaymentPillSpec => {
  if (status === "completed") return { variant: "info", label: "PAID" };
  if (status === "refunded_full")
    return { variant: "warn", label: "REFUNDED" };
  if (status === "refunded_partial")
    return { variant: "accent", label: "PARTIAL" };
  const _exhaust: never = status;
  return _exhaust;
};

// ---- Screen ---------------------------------------------------------

export default function DoorSaleDetailRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    id: string | string[];
    saleId: string | string[];
  }>();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;
  const rawSaleId = Array.isArray(params.saleId)
    ? params.saleId[0]
    : params.saleId;

  const event = useLiveEventStore((s) =>
    typeof eventId === "string"
      ? s.events.find((e) => e.id === eventId) ?? null
      : null,
  );

  // Single-existing-reference selector — safe to subscribe (per SPEC §4.5).
  const sale = useDoorSalesStore((s) =>
    typeof rawSaleId === "string" ? s.getSaleById(rawSaleId) : null,
  );

  // Per-seat expansion. Hooks BEFORE early return per ORCH-0710 lesson.
  const expandedTickets = useMemo(() => {
    if (sale === null) return [];
    return expandDoorTickets(sale.id, sale.lines);
  }, [sale]);

  const [refundOpen, setRefundOpen] = useState<boolean>(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });

  const showToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (typeof eventId === "string") {
      router.replace(`/event/${eventId}/door` as never);
    }
  }, [router, eventId]);

  const handleRefundOpen = useCallback((): void => {
    setRefundOpen(true);
  }, []);

  const handleRefundSuccess = useCallback(
    (updated: DoorSaleRecord): void => {
      setRefundOpen(false);
      const refundedAmount =
        updated.refunds[updated.refunds.length - 1]?.amountGbp ?? 0;
      showToast(
        `Refunded ${formatGbp(refundedAmount)}. Buyer stays checked in.`,
      );
    },
    [showToast],
  );

  // ---- Not-found shell ----
  if (
    typeof eventId !== "string" ||
    typeof rawSaleId !== "string" ||
    event === null ||
    sale === null
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
          <Text style={styles.chromeTitle}>Door sale</Text>
          <View style={styles.chromeRightSlot} />
        </View>
        <View style={styles.emptyHost}>
          <EmptyState
            illustration="ticket"
            title="Sale not found"
            description="It may have been deleted."
          />
        </View>
      </View>
    );
  }

  const buyerName =
    sale.buyerName.length > 0 ? sale.buyerName : "Walk-up";
  const statusPillSpec = doorStatusPill(sale.status);
  const paymentMethodLabel = PAYMENT_METHOD_LABELS[sale.paymentMethod];
  const refundButtonVisible = sale.status !== "refunded_full";
  const hasBuyerDetails =
    sale.buyerEmail.length > 0 ||
    sale.buyerPhone.length > 0 ||
    sale.buyerName.length > 0;
  const hasNotes = sale.notes.trim().length > 0;
  const hasRefunds = sale.refunds.length > 0;

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
        <Text style={styles.chromeTitle}>Door sale</Text>
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
          <Text style={styles.heroEyebrow}>{sale.id}</Text>
          <Text style={styles.heroName} numberOfLines={1}>
            {buyerName}
          </Text>
          <Text style={styles.heroDate}>
            Recorded {formatAbsoluteDate(sale.recordedAt)}
          </Text>
          <View style={styles.heroPills}>
            <Pill variant={statusPillSpec.variant}>{statusPillSpec.label}</Pill>
            <Pill variant="info">CHECKED IN</Pill>
          </View>
        </View>

        {/* TICKETS */}
        <Text style={styles.sectionLabel}>TICKETS</Text>
        <GlassCard variant="base" radius="md" padding={spacing.md}>
          <View style={styles.ticketsList}>
            {expandedTickets.map((t, idx) => {
              const lineRefunded =
                sale.lines.find((l) => l.ticketTypeId === t.ticketName)
                  ?.refundedQuantity ?? 0;
              return (
                <View key={t.ticketId} style={styles.ticketRow}>
                  <View style={styles.ticketCol}>
                    <Text style={styles.ticketName} numberOfLines={1}>
                      {t.ticketName}
                    </Text>
                    <Text style={styles.ticketSub}>
                      {t.isFreeAtSale
                        ? "Free"
                        : formatGbp(t.unitPriceGbpAtSale)}{" "}
                      · #{idx + 1}
                    </Text>
                  </View>
                  {/* Per-seat refund indicator stays simple — line-level refund
                      info shows in PAYMENT section below + REFUND HISTORY. */}
                  {lineRefunded > 0 ? (
                    <Pill variant="warn">REFUND APPLIED</Pill>
                  ) : null}
                </View>
              );
            })}
          </View>
        </GlassCard>

        {/* PAYMENT */}
        <Text style={styles.sectionLabel}>PAYMENT</Text>
        <GlassCard variant="base" radius="md" padding={spacing.md}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Payment method</Text>
            <Text style={styles.summaryValue}>{paymentMethodLabel}</Text>
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
          <View style={styles.divider} />
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabelStrong}>Net</Text>
            <Text style={styles.summaryValueStrong}>
              {formatGbp(sale.totalGbpAtSale - sale.refundedAmountGbp)}
            </Text>
          </View>
        </GlassCard>

        {/* BUYER */}
        {hasBuyerDetails ? (
          <>
            <Text style={styles.sectionLabel}>BUYER</Text>
            <GlassCard variant="base" radius="md" padding={spacing.md}>
              {sale.buyerName.length > 0 ? (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Name</Text>
                  <Text style={styles.summaryValue} numberOfLines={1}>
                    {sale.buyerName}
                  </Text>
                </View>
              ) : null}
              {sale.buyerEmail.length > 0 ? (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Email</Text>
                  <Text style={styles.summaryValue} numberOfLines={1}>
                    {sale.buyerEmail}
                  </Text>
                </View>
              ) : null}
              {sale.buyerPhone.length > 0 ? (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Phone</Text>
                  <Text style={styles.summaryValue} numberOfLines={1}>
                    {sale.buyerPhone}
                  </Text>
                </View>
              ) : null}
            </GlassCard>
          </>
        ) : null}

        {/* NOTES */}
        {hasNotes ? (
          <>
            <Text style={styles.sectionLabel}>NOTES</Text>
            <GlassCard variant="base" radius="md" padding={spacing.md}>
              <Text style={styles.notesText}>{sale.notes}</Text>
            </GlassCard>
          </>
        ) : null}

        {/* REFUND HISTORY */}
        {hasRefunds ? (
          <>
            <Text style={styles.sectionLabel}>REFUND HISTORY</Text>
            <GlassCard variant="base" radius="md" padding={spacing.md}>
              {sale.refunds.map((r) => (
                <View key={r.id} style={styles.refundRow}>
                  <View style={styles.refundCol}>
                    <Text style={styles.refundAmount}>
                      −{formatGbp(r.amountGbp)}
                    </Text>
                    <Text style={styles.refundTime}>
                      {formatRelativeTime(r.refundedAt)}
                    </Text>
                  </View>
                  <Text style={styles.refundReason} numberOfLines={3}>
                    {r.reason}
                  </Text>
                </View>
              ))}
            </GlassCard>
          </>
        ) : null}

        {/* Refund CTA */}
        {refundButtonVisible ? (
          <View style={styles.ctaWrap}>
            <Button
              label="Refund"
              variant="ghost"
              size="md"
              fullWidth
              onPress={handleRefundOpen}
              accessibilityLabel="Refund door sale"
            />
          </View>
        ) : null}
      </ScrollView>

      {/* Refund sheet */}
      <DoorRefundSheet
        visible={refundOpen}
        sale={sale}
        onClose={() => setRefundOpen(false)}
        onSuccess={handleRefundSuccess}
      />

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

  // Hero -------------------------------------------------------------
  hero: {
    alignItems: "center",
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  heroEyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: textTokens.quaternary,
    marginBottom: 6,
    fontVariant: ["tabular-nums"],
  },
  heroName: {
    fontSize: 22,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  heroDate: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginBottom: spacing.sm,
  },
  heroPills: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
    justifyContent: "center",
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: textTokens.tertiary,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },

  // Tickets ----------------------------------------------------------
  ticketsList: {
    gap: spacing.sm,
  },
  ticketRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingVertical: 4,
  },
  ticketCol: {
    flex: 1,
    minWidth: 0,
  },
  ticketName: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.primary,
  },
  ticketSub: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginTop: 2,
  },

  // Summary rows -----------------------------------------------------
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
  summaryLabelStrong: {
    fontSize: 14,
    fontWeight: "700",
    color: textTokens.primary,
  },
  summaryValue: {
    fontSize: 13,
    color: textTokens.primary,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
  },
  summaryValueWarn: {
    fontSize: 13,
    color: accent.warm,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
  },
  summaryValueStrong: {
    fontSize: 16,
    color: textTokens.primary,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  divider: {
    marginVertical: spacing.sm,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },

  // Notes ------------------------------------------------------------
  notesText: {
    fontSize: 13,
    lineHeight: 18,
    color: textTokens.primary,
  },

  // Refund history --------------------------------------------------
  refundRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  refundCol: {
    minWidth: 96,
  },
  refundAmount: {
    fontSize: 14,
    fontWeight: "700",
    color: accent.warm,
    fontVariant: ["tabular-nums"],
  },
  refundTime: {
    fontSize: 11,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  refundReason: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: textTokens.primary,
  },

  // CTA --------------------------------------------------------------
  ctaWrap: {
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },

  // Toast ------------------------------------------------------------
  toastWrap: {
    position: "absolute",
    top: 80,
    left: 0,
    right: 0,
    zIndex: 100,
    elevation: 12,
  },
});
