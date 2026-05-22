/**
 * /trip/[id]/money — ORCH-0913 dedicated Money route.
 *
 * Lifted from the former trip-dashboard Money tab body. ORCH-0914 can now
 * redesign this content without changing the dashboard tile structure.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  accent,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../../src/constants/designSystem";
import { Icon } from "../../../../src/components/ui/Icon";
import { SafeScreen } from "../../../../src/components/ui/SafeScreen";
import { Toast } from "../../../../src/components/ui/Toast";
import { TopBar } from "../../../../src/components/ui/TopBar";
import { RefundPreviewSheet } from "../../../../src/components/trip/RefundPreviewSheet";
import {
  InstallmentScheduleDisplay,
  type InstallmentScheduleDisplaySchedule,
} from "../../../../src/components/trip/InstallmentScheduleDisplay";
import { useInstallmentsForBrandTrips, useRetryInstallment } from "../../../../src/hooks/useOrderInstallments";
import { useTrip } from "../../../../src/hooks/useTrips";
import type {
  OrderInstallmentForBrand,
  OrderInstallmentStatus,
} from "../../../../src/services/orderInstallmentsService";
import { projectInstallmentSchedule } from "../../../../src/utils/installmentScheduleProjection";

type MoneyFilter = "all" | "atRisk";

function formatCurrency(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

function formatMoneyDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function statusPillStyle(status: OrderInstallmentStatus): {
  pill: object;
  text: object;
} {
  switch (status) {
    case "collected":
      return {
        pill: styles.moneyStatusPillCollected,
        text: styles.moneyStatusPillTextCollected,
      };
    case "failed":
      return {
        pill: styles.moneyStatusPillFailed,
        text: styles.moneyStatusPillTextFailed,
      };
    case "scheduled":
    case "refunded":
    case "cancelled":
    default:
      return { pill: styles.moneyStatusPillScheduled, text: {} };
  }
}

function statusLabel(status: OrderInstallmentStatus): string {
  switch (status) {
    case "scheduled":
      return "Scheduled";
    case "collected":
      return "Collected";
    case "failed":
      return "Failed";
    case "refunded":
      return "Refunded";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

function friendlyFailureCopy(raw: string | null): string {
  if (raw === null) return "Payment failed.";
  const lower = raw.toLowerCase();
  if (lower.includes("card_declined")) return "Card declined.";
  if (lower.includes("insufficient_funds")) return "Insufficient funds.";
  if (lower.includes("expired_card")) return "Card expired.";
  if (lower.includes("authentication_required")) return "Requires 3D Secure.";
  return "Payment failed. Buyer may need to update their card.";
}

export default function TripMoneyRoute(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;
  const tripQuery = useTrip(typeof eventId === "string" ? eventId : null);
  const brandId = tripQuery.data?.brandId ?? null;
  const [moneyFilter, setMoneyFilter] = useState<MoneyFilter>("all");
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{
    visible: boolean;
    kind: "success" | "warn" | "error" | "info";
    message: string;
  }>({ visible: false, kind: "info", message: "" });

  const installmentsQuery = useInstallmentsForBrandTrips(brandId, {
    tripEventId: typeof eventId === "string" ? eventId : undefined,
    atRiskOnly: moneyFilter === "atRisk",
  });
  const retryMutation = useRetryInstallment({
    onMessage: ({ kind, message }) => {
      const toastKind: "success" | "warn" | "error" | "info" =
        kind === "warning" ? "warn" : kind;
      setToast({ visible: true, kind: toastKind, message });
    },
  });
  const toggleExpanded = useCallback((orderId: string): void => {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }, []);

  const moneyData = useMemo(() => {
    if (installmentsQuery.data === undefined) return null;
    const rowsByOrder = new Map<string, OrderInstallmentForBrand[]>();
    for (const row of installmentsQuery.data) {
      const arr = rowsByOrder.get(row.orderId) ?? [];
      arr.push(row);
      rowsByOrder.set(row.orderId, arr);
    }
    const orderIds = [...rowsByOrder.keys()].sort((a, b) => {
      const ra = rowsByOrder.get(a)![0];
      const rb = rowsByOrder.get(b)![0];
      if (ra.orderAtRisk !== rb.orderAtRisk) return ra.orderAtRisk ? -1 : 1;
      const nextA = rowsByOrder
        .get(a)!
        .filter((i) => i.status === "scheduled" || i.status === "failed")
        .map((i) => i.dueAt)
        .sort()[0] ?? "";
      const nextB = rowsByOrder
        .get(b)!
        .filter((i) => i.status === "scheduled" || i.status === "failed")
        .map((i) => i.dueAt)
        .sort()[0] ?? "";
      return nextA.localeCompare(nextB);
    });
    const atRiskOrderCount = new Set(
      installmentsQuery.data
        .filter((r) => r.orderAtRisk)
        .map((r) => r.orderId),
    ).size;
    return { rowsByOrder, orderIds, atRiskOrderCount };
  }, [installmentsQuery.data]);

  if (typeof eventId !== "string" || eventId.length === 0) {
    return (
      <SafeScreen style={styles.stateHost}>
        <Text style={styles.title}>Trip not found</Text>
      </SafeScreen>
    );
  }

  if (tripQuery.isLoading) {
    return (
      <SafeScreen style={styles.stateHost}>
        <ActivityIndicator />
      </SafeScreen>
    );
  }

  if (tripQuery.isError) {
    return (
      <SafeScreen style={styles.stateHost}>
        <Text style={styles.title}>Couldn&apos;t load trip</Text>
        <Text style={styles.emptyText}>
          {tripQuery.error instanceof Error ? tripQuery.error.message : "Try again."}
        </Text>
      </SafeScreen>
    );
  }

  const trip = tripQuery.data;
  if (trip === null || trip === undefined) {
    return (
      <SafeScreen style={styles.stateHost}>
        <Text style={styles.title}>Trip not found</Text>
      </SafeScreen>
    );
  }

  const firstTier = trip.pricingTiers[0];
  const plannerScheduleHeader =
    firstTier === undefined ? null : projectInstallmentSchedule(firstTier, new Date());

  return (
    <SafeScreen style={styles.host}>
      <TopBar
        leftKind="back"
        title="Money"
        onBack={() => router.push(`/trip/${eventId}` as never)}
        rightSlot={null}
      />
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
      >
        <MoneyRouteBody
          installmentsQuery={installmentsQuery}
          moneyData={moneyData}
          moneyFilter={moneyFilter}
          setMoneyFilter={setMoneyFilter}
          expandedOrders={expandedOrders}
          toggleExpanded={toggleExpanded}
          retryMutation={retryMutation}
          onEditTripPricing={() => router.push(`/trip/${eventId}/edit` as never)}
          plannerScheduleHeader={plannerScheduleHeader}
        />
      </ScrollView>
      <Toast
        visible={toast.visible}
        kind={toast.kind}
        message={toast.message}
        onDismiss={() => setToast((t) => ({ ...t, visible: false }))}
      />
    </SafeScreen>
  );
}

interface MoneyRouteBodyProps {
  installmentsQuery: ReturnType<typeof useInstallmentsForBrandTrips>;
  moneyData: {
    rowsByOrder: Map<string, OrderInstallmentForBrand[]>;
    orderIds: string[];
    atRiskOrderCount: number;
  } | null;
  moneyFilter: MoneyFilter;
  setMoneyFilter: (next: MoneyFilter) => void;
  expandedOrders: Set<string>;
  toggleExpanded: (orderId: string) => void;
  retryMutation: ReturnType<typeof useRetryInstallment>;
  onEditTripPricing: () => void;
  plannerScheduleHeader: InstallmentScheduleDisplaySchedule | null;
}

const MoneyRouteBody: React.FC<MoneyRouteBodyProps> = ({
  installmentsQuery,
  moneyData,
  moneyFilter,
  setMoneyFilter,
  expandedOrders,
  toggleExpanded,
  retryMutation,
  onEditTripPricing,
  plannerScheduleHeader,
}) => {
  const [cancelSheetOrderId, setCancelSheetOrderId] = useState<string | null>(
    null,
  );
  if (installmentsQuery.isLoading || moneyData === null) {
    return (
      <View style={{ paddingVertical: spacing.xl, alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (installmentsQuery.isError) {
    return (
      <View style={styles.emptyState}>
        <Icon name="bell" size={32} color={semantic.error} />
        <Text style={styles.emptyText}>Couldn&apos;t load installments.</Text>
        <Pressable
          onPress={() => installmentsQuery.refetch()}
          accessibilityRole="button"
          accessibilityLabel="Retry loading installments"
          style={styles.moneyRetryBtn}
        >
          <Text style={styles.moneyRetryBtnText}>Retry</Text>
        </Pressable>
      </View>
    );
  }
  if (moneyData.orderIds.length === 0) {
    return (
      <View>
        {plannerScheduleHeader !== null ? (
          <View style={styles.plannerScheduleHeaderWrap}>
            <InstallmentScheduleDisplay
              schedule={plannerScheduleHeader}
              variant="planner"
              isProjection={true}
            />
          </View>
        ) : null}
        <View style={styles.emptyState}>
          <Icon name="pound" size={32} color={textTokens.tertiary} />
          <Text style={styles.emptyText}>No bookings on payment plans yet.</Text>
          <Text style={styles.emptyText}>
            When buyers book this trip with a payment plan, their installment
            schedule shows up here.
          </Text>
          <Pressable
            onPress={onEditTripPricing}
            accessibilityRole="button"
            accessibilityLabel="Edit trip pricing"
            style={styles.moneyRetryBtn}
          >
            <Text style={styles.moneyRetryBtnText}>Edit trip pricing</Text>
          </Pressable>
        </View>
      </View>
    );
  }
  return (
    <>
      {plannerScheduleHeader !== null ? (
        <View style={styles.plannerScheduleHeaderWrap}>
          <InstallmentScheduleDisplay
            schedule={plannerScheduleHeader}
            variant="planner"
            isProjection={true}
          />
        </View>
      ) : null}
      <View style={styles.moneyFilterRow}>
        <Pressable
          onPress={() => setMoneyFilter("all")}
          accessibilityRole="button"
          accessibilityState={{ selected: moneyFilter === "all" }}
          accessibilityLabel={`All bookings, ${moneyData.orderIds.length}`}
          style={[
            styles.moneyFilterChip,
            moneyFilter === "all" && styles.moneyFilterChipActive,
          ]}
        >
          <Text
            style={[
              styles.moneyFilterChipText,
              moneyFilter === "all" && styles.moneyFilterChipTextActive,
            ]}
          >
            All bookings · {moneyData.orderIds.length}
          </Text>
        </Pressable>
        {moneyData.atRiskOrderCount > 0 ? (
          <Pressable
            onPress={() => setMoneyFilter("atRisk")}
            accessibilityRole="button"
            accessibilityState={{ selected: moneyFilter === "atRisk" }}
            accessibilityLabel={`Show ${moneyData.atRiskOrderCount} at-risk bookings`}
            style={[
              styles.moneyFilterChip,
              styles.moneyFilterChipAtRisk,
              moneyFilter === "atRisk" && styles.moneyFilterChipActive,
            ]}
          >
            <Text
              style={[
                styles.moneyFilterChipText,
                styles.moneyFilterChipTextAtRisk,
                moneyFilter === "atRisk" && styles.moneyFilterChipTextActive,
              ]}
            >
              At risk · {moneyData.atRiskOrderCount}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {moneyData.orderIds.map((orderId) => {
        const rows = moneyData.rowsByOrder.get(orderId) ?? [];
        if (rows.length === 0) return null;
        const head = rows[0];
        const paidCount = rows.filter((r) => r.status === "collected").length;
        const collectedCents = rows
          .filter((r) => r.status === "collected")
          .reduce((s, r) => s + r.amountCents, 0);
        const nextDue = rows
          .filter((r) => r.status === "scheduled" || r.status === "failed")
          .map((r) => r.dueAt)
          .sort()[0];
        const expanded = expandedOrders.has(orderId);
        return (
          <View key={orderId} style={styles.moneyBookingRow}>
            <Pressable
              onPress={() => toggleExpanded(orderId)}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              accessibilityLabel={`${head.buyerName ?? "Buyer"}, ${paidCount}/${rows.length} installments paid${head.orderAtRisk ? ", at risk" : ""}, next due ${nextDue !== undefined ? formatMoneyDate(nextDue) : "none"}`}
              accessibilityHint="Tap to see installment ledger"
            >
              <View style={styles.moneyBookingHeader}>
                <Text style={styles.moneyBookingName}>
                  {head.buyerName ?? head.buyerEmail ?? "Anonymous"}
                </Text>
                <Text style={styles.moneyInstallmentAmount}>
                  {paidCount} / {rows.length} paid ·{" "}
                  {formatCurrency(collectedCents, head.currency)}
                </Text>
              </View>
              <Text style={styles.moneyBookingMeta}>
                {nextDue !== undefined
                  ? `Next due ${formatMoneyDate(nextDue)}`
                  : "Fully paid"}
              </Text>
              {head.orderAtRisk ? (
                <View style={styles.moneyAtRiskPill}>
                  <Text style={styles.moneyAtRiskPillText}>At risk</Text>
                </View>
              ) : null}
            </Pressable>
            {expanded ? (
              <>
                <View style={styles.moneyDivider} />
                {rows.map((inst) => {
                  const pillStyle = statusPillStyle(inst.status);
                  return (
                    <View
                      key={inst.id}
                      style={{ marginBottom: spacing.xs }}
                      accessibilityRole="text"
                      accessibilityLabel={`Installment ${inst.ordinal}, ${formatCurrency(inst.amountCents, inst.currency)}, ${statusLabel(inst.status)}, due ${formatMoneyDate(inst.dueAt)}`}
                    >
                      <View style={styles.moneyInstallmentRow}>
                        <Text style={styles.moneyInstallmentLabel}>
                          Installment {inst.ordinal} ·{" "}
                          {formatMoneyDate(inst.dueAt)}
                        </Text>
                        <Text style={styles.moneyInstallmentAmount}>
                          {formatCurrency(inst.amountCents, inst.currency)}
                        </Text>
                        <View
                          style={[styles.moneyStatusPill, pillStyle.pill]}
                        >
                          <Text
                            style={[
                              styles.moneyStatusPillText,
                              pillStyle.text,
                            ]}
                          >
                            {statusLabel(inst.status)}
                          </Text>
                        </View>
                      </View>
                      {inst.status === "failed" ? (
                        <>
                          <Text style={styles.moneyFailureReason}>
                            {friendlyFailureCopy(inst.failureReason)}
                          </Text>
                          <Pressable
                            onPress={() => retryMutation.mutate(inst.id)}
                            disabled={retryMutation.isPending}
                            accessibilityRole="button"
                            accessibilityLabel={`Retry installment ${inst.ordinal} for ${head.buyerName ?? "buyer"}`}
                            accessibilityHint="Queues a charge attempt on the next cron run"
                            accessibilityState={{
                              disabled: retryMutation.isPending,
                            }}
                            style={[
                              styles.moneyRetryBtn,
                              retryMutation.isPending &&
                                styles.moneyRetryBtnDisabled,
                            ]}
                          >
                            <Text style={styles.moneyRetryBtnText}>
                              {retryMutation.isPending
                                ? "Retrying..."
                                : "Retry now"}
                            </Text>
                          </Pressable>
                        </>
                      ) : null}
                    </View>
                  );
                })}
                <View style={styles.moneyDivider} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Cancel and refund ${head.buyerName ?? "buyer"}'s booking`}
                  accessibilityHint="Opens cancellation preview with refund amount and reason field"
                  style={styles.moneyRefundBtn}
                  onPress={() => setCancelSheetOrderId(orderId)}
                >
                  <Text style={styles.moneyRefundBtnText}>
                    Cancel &amp; refund
                  </Text>
                </Pressable>
              </>
            ) : null}
          </View>
        );
      })}

      <RefundPreviewSheet
        visible={cancelSheetOrderId !== null}
        orderId={cancelSheetOrderId}
        onClose={() => setCancelSheetOrderId(null)}
        onCancelled={() => {
          void installmentsQuery.refetch();
        }}
      />
    </>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: "#0c0e12",
  },
  stateHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
    backgroundColor: "#0c0e12",
  },
  title: {
    fontSize: typography.h3.fontSize,
    color: textTokens.primary,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  emptyState: {
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
  },
  emptyText: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    textAlign: "center",
  },
  plannerScheduleHeaderWrap: {
    width: "100%",
    marginBottom: spacing.md,
  },
  moneyFilterRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  moneyFilterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radiusTokens.full,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  moneyFilterChipActive: {
    borderColor: accent.warm,
    backgroundColor: accent.warm,
  },
  moneyFilterChipAtRisk: {
    borderColor: semantic.error,
  },
  moneyFilterChipText: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  moneyFilterChipTextActive: {
    color: textTokens.inverse,
  },
  moneyFilterChipTextAtRisk: {
    color: semantic.error,
  },
  moneyBookingRow: {
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    gap: spacing.xs,
  },
  moneyBookingHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  moneyBookingName: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  moneyBookingMeta: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    marginTop: 2,
  },
  moneyAtRiskPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radiusTokens.sm,
    backgroundColor: "rgba(239, 68, 68, 0.18)",
    alignSelf: "flex-start",
    marginTop: spacing.xs,
  },
  moneyAtRiskPillText: {
    fontSize: typography.caption.fontSize,
    color: semantic.error,
    fontWeight: "600",
  },
  moneyInstallmentRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.xs,
  },
  moneyInstallmentLabel: {
    flex: 1,
    fontSize: typography.bodySm.fontSize,
    color: textTokens.primary,
  },
  moneyInstallmentAmount: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.primary,
    marginRight: spacing.sm,
  },
  moneyStatusPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radiusTokens.sm,
    minWidth: 80,
    alignItems: "center",
  },
  moneyStatusPillScheduled: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  moneyStatusPillCollected: {
    backgroundColor: "rgba(34, 197, 94, 0.18)",
  },
  moneyStatusPillFailed: {
    backgroundColor: "rgba(239, 68, 68, 0.18)",
  },
  moneyStatusPillText: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  moneyStatusPillTextCollected: {
    color: semantic.success,
  },
  moneyStatusPillTextFailed: {
    color: semantic.error,
  },
  moneyRetryBtn: {
    marginTop: spacing.xs,
    minHeight: 44,
    borderRadius: radiusTokens.md,
    backgroundColor: accent.warm,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  moneyRetryBtnDisabled: {
    opacity: 0.5,
  },
  moneyRetryBtnText: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.inverse,
  },
  moneyFailureReason: {
    fontSize: typography.caption.fontSize,
    color: semantic.error,
    marginTop: 2,
  },
  moneyDivider: {
    height: 1,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    marginVertical: spacing.sm,
  },
  moneyRefundBtn: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.4,
  },
  moneyRefundBtnText: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
});
