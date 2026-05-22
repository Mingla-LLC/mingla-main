/**
 * /trip/[id]/money — ORCH-0914 dedicated Money route redesign.
 *
 * Shows organiser-visible traveller payment-plan progress as a responsive
 * table/card surface with manual charge + reminder actions.
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
import { ConfirmDialog } from "../../../../src/components/ui/ConfirmDialog";
import { RefundPreviewSheet } from "../../../../src/components/trip/RefundPreviewSheet";
import {
  InstallmentScheduleDisplay,
  type InstallmentScheduleDisplaySchedule,
} from "../../../../src/components/trip/InstallmentScheduleDisplay";
import {
  useInstallmentsForBrandTrips,
  useRetryInstallment,
} from "../../../../src/hooks/useOrderInstallments";
import {
  useChargeInstallmentNow,
  useRecentReminderForOrder,
  useSendInstallmentReminder,
} from "../../../../src/hooks/useManualInstallmentActions";
import { useResponsiveLayout } from "../../../../src/hooks/useResponsiveLayout";
import { useTripOrders } from "../../../../src/hooks/useTripOrders";
import { useTrip } from "../../../../src/hooks/useTrips";
import type {
  OrderInstallmentForBrand,
  OrderInstallmentStatus,
} from "../../../../src/services/orderInstallmentsService";
import { projectInstallmentSchedule } from "../../../../src/utils/installmentScheduleProjection";

type MoneyFilter = "all" | "atRisk";
type LastChargeStatus = OrderInstallmentStatus | "at_risk";

interface TravelerMoneyRow {
  orderId: string;
  buyerName: string | null;
  buyerEmail: string | null;
  orderTotalCents: number;
  currency: string;
  orderAtRisk: boolean;
  installments: OrderInstallmentForBrand[];
  isPaidInFull: boolean;
  paidToDateCents: number;
  outstandingCents: number;
  nextInstallment: OrderInstallmentForBrand | null;
  lastChargeStatus: LastChargeStatus;
  planSchedule: InstallmentScheduleDisplaySchedule | null;
}

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

function buyerLabel(row: {
  buyerName: string | null;
  buyerEmail: string | null;
}): string {
  return row.buyerName ?? row.buyerEmail ?? "Anonymous";
}

function statusPillStyle(status: LastChargeStatus): {
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
    case "at_risk":
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

function statusLabel(status: LastChargeStatus): string {
  switch (status) {
    case "at_risk":
      return "At risk";
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

function mostRecentAttempted(
  rows: OrderInstallmentForBrand[],
): OrderInstallmentForBrand | null {
  const attempted = rows
    .filter((row) => row.collectedAt !== null || row.failedAt !== null)
    .sort((a, b) => {
      const aTime = new Date(a.collectedAt ?? a.failedAt ?? 0).getTime();
      const bTime = new Date(b.collectedAt ?? b.failedAt ?? 0).getTime();
      return bTime - aTime;
    });
  return attempted[0] ?? null;
}

function deriveInstallmentRow(rows: OrderInstallmentForBrand[]): TravelerMoneyRow {
  const sortedRows = [...rows].sort((a, b) => a.ordinal - b.ordinal);
  const head = sortedRows[0];
  const paidToDateCents = sortedRows
    .filter((row) => row.status === "collected")
    .reduce((sum, row) => sum + row.amountCents, 0);
  const outstandingCents = Math.max(0, head.orderTotalCents - paidToDateCents);
  const nextInstallment = sortedRows
    .filter((row) => row.status === "scheduled" || row.status === "failed")
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0] ?? null;
  const attempted = mostRecentAttempted(sortedRows);
  const totalInstallmentCents = sortedRows.reduce(
    (sum, row) => sum + row.amountCents,
    0,
  );
  const depositCents = Math.max(0, head.orderTotalCents - totalInstallmentCents);
  return {
    orderId: head.orderId,
    buyerName: head.buyerName,
    buyerEmail: head.buyerEmail,
    orderTotalCents: head.orderTotalCents,
    currency: head.currency,
    orderAtRisk: head.orderAtRisk,
    installments: sortedRows,
    isPaidInFull: false,
    paidToDateCents,
    outstandingCents,
    nextInstallment,
    lastChargeStatus: head.orderAtRisk ? "at_risk" : attempted?.status ?? "scheduled",
    planSchedule: {
      fullPriceCents: head.orderTotalCents,
      depositCents,
      currency: head.currency,
      installments: sortedRows.map((row) => ({
        ordinal: row.ordinal,
        pct: 0,
        amountCents: row.amountCents,
        dueAt: row.dueAt,
      })),
    },
  };
}

export default function TripMoneyRoute(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;
  const tripQuery = useTrip(typeof eventId === "string" ? eventId : null);
  const ordersQuery = useTripOrders(typeof eventId === "string" ? eventId : null);
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
  const toastMessage = useCallback((input: {
    kind: "success" | "warning" | "error";
    message: string;
  }) => {
    setToast({
      visible: true,
      kind: input.kind === "warning" ? "warn" : input.kind,
      message: input.message,
    });
  }, []);
  const retryMutation = useRetryInstallment({ onMessage: toastMessage });
  const chargeNowMutation = useChargeInstallmentNow({ onMessage: toastMessage });
  const sendReminderMutation = useSendInstallmentReminder({ onMessage: toastMessage });

  const toggleExpanded = useCallback((orderId: string): void => {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }, []);

  const moneyData = useMemo(() => {
    if (installmentsQuery.data === undefined || ordersQuery.data === undefined) {
      return null;
    }
    const rowsByOrder = new Map<string, OrderInstallmentForBrand[]>();
    for (const row of installmentsQuery.data) {
      const arr = rowsByOrder.get(row.orderId) ?? [];
      arr.push(row);
      rowsByOrder.set(row.orderId, arr);
    }
    const installmentRows = [...rowsByOrder.values()].map(deriveInstallmentRow);
    const paidInFullRows = ordersQuery.data
      .filter((order) => !rowsByOrder.has(order.id))
      .filter((order) => order.paymentStatus === "paid")
      .map<TravelerMoneyRow>((order) => ({
        orderId: order.id,
        buyerName: order.buyerName,
        buyerEmail: order.buyerEmail,
        orderTotalCents: order.totalCents,
        currency: order.currency,
        orderAtRisk: false,
        installments: [],
        isPaidInFull: true,
        paidToDateCents: order.totalCents,
        outstandingCents: 0,
        nextInstallment: null,
        lastChargeStatus: "collected",
        planSchedule: null,
      }));
    const rows = [...installmentRows, ...paidInFullRows]
      .filter((row) => moneyFilter === "all" || row.orderAtRisk)
      .sort((a, b) => {
        if (a.orderAtRisk !== b.orderAtRisk) return a.orderAtRisk ? -1 : 1;
        const nextA = a.nextInstallment?.dueAt ?? "9999";
        const nextB = b.nextInstallment?.dueAt ?? "9999";
        return nextA.localeCompare(nextB);
      });
    const atRiskOrderCount = installmentRows.filter((row) => row.orderAtRisk).length;
    return { rows, atRiskOrderCount };
  }, [installmentsQuery.data, moneyFilter, ordersQuery.data]);

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
        onBack={() => {
          if (router.canGoBack()) router.back();
          else router.replace(`/trip/${eventId}` as never);
        }}
        rightSlot={null}
      />
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
      >
        <MoneyRouteBody
          installmentsQuery={installmentsQuery}
          ordersQuery={ordersQuery}
          moneyData={moneyData}
          moneyFilter={moneyFilter}
          setMoneyFilter={setMoneyFilter}
          expandedOrders={expandedOrders}
          toggleExpanded={toggleExpanded}
          retryMutation={retryMutation}
          chargeNowMutation={chargeNowMutation}
          sendReminderMutation={sendReminderMutation}
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
  ordersQuery: ReturnType<typeof useTripOrders>;
  moneyData: {
    rows: TravelerMoneyRow[];
    atRiskOrderCount: number;
  } | null;
  moneyFilter: MoneyFilter;
  setMoneyFilter: (next: MoneyFilter) => void;
  expandedOrders: Set<string>;
  toggleExpanded: (orderId: string) => void;
  retryMutation: ReturnType<typeof useRetryInstallment>;
  chargeNowMutation: ReturnType<typeof useChargeInstallmentNow>;
  sendReminderMutation: ReturnType<typeof useSendInstallmentReminder>;
  onEditTripPricing: () => void;
  plannerScheduleHeader: InstallmentScheduleDisplaySchedule | null;
}

const MoneyRouteBody: React.FC<MoneyRouteBodyProps> = ({
  installmentsQuery,
  ordersQuery,
  moneyData,
  moneyFilter,
  setMoneyFilter,
  expandedOrders,
  toggleExpanded,
  retryMutation,
  chargeNowMutation,
  sendReminderMutation,
  onEditTripPricing,
  plannerScheduleHeader,
}) => {
  const { width } = useResponsiveLayout();
  const isPhoneLayout = width > 0 && width <= 480;
  const [cancelSheetOrderId, setCancelSheetOrderId] = useState<string | null>(null);
  const [pendingAtRiskCharge, setPendingAtRiskCharge] =
    useState<TravelerMoneyRow | null>(null);

  if (installmentsQuery.isLoading || ordersQuery.isLoading || moneyData === null) {
    return (
      <View style={{ paddingVertical: spacing.xl, alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (installmentsQuery.isError || ordersQuery.isError) {
    return (
      <View style={styles.emptyState}>
        <Icon name="bell" size={32} color={semantic.error} />
        <Text style={styles.emptyText}>Couldn&apos;t load bookings.</Text>
        <Pressable
          onPress={() => {
            void installmentsQuery.refetch();
            void ordersQuery.refetch();
          }}
          accessibilityRole="button"
          accessibilityLabel="Retry loading money table"
          style={styles.moneyRetryBtn}
        >
          <Text style={styles.moneyRetryBtnText}>Retry</Text>
        </Pressable>
      </View>
    );
  }
  if (moneyData.rows.length === 0) {
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
          <Text style={styles.emptyText}>No bookings to show yet.</Text>
          <Text style={styles.emptyText}>
            Payment-plan and paid-in-full travellers will appear here.
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

  const confirmAtRiskCharge = (): void => {
    if (pendingAtRiskCharge?.nextInstallment === null || pendingAtRiskCharge === null) {
      setPendingAtRiskCharge(null);
      return;
    }
    chargeNowMutation.mutate({
      installmentId: pendingAtRiskCharge.nextInstallment.id,
      atRiskOverride: true,
    });
    setPendingAtRiskCharge(null);
  };

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
          accessibilityLabel={`All bookings, ${moneyData.rows.length}`}
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
            All bookings · {moneyData.rows.length}
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

      {isPhoneLayout ? (
        <View style={styles.phoneList}>
          {moneyData.rows.map((row) => (
            <TravelerMoneyRowCard
              key={row.orderId}
              row={row}
              expanded={expandedOrders.has(row.orderId)}
              onToggle={() => toggleExpanded(row.orderId)}
              retryMutation={retryMutation}
              chargeNowMutation={chargeNowMutation}
              sendReminderMutation={sendReminderMutation}
              onAtRiskCharge={() => setPendingAtRiskCharge(row)}
              onCancel={() => setCancelSheetOrderId(row.orderId)}
            />
          ))}
        </View>
      ) : (
        <View style={styles.moneyTable}>
          <View style={[styles.moneyTableRow, styles.moneyTableHeader]}>
            {["Buyer", "Plan", "Paid-to-date", "Outstanding", "Next installment", "Last status", "Actions"].map((label) => (
              <Text key={label} style={styles.moneyTableHeaderText}>{label}</Text>
            ))}
          </View>
          {moneyData.rows.map((row) => (
            <TravelerMoneyTableRow
              key={row.orderId}
              row={row}
              expanded={expandedOrders.has(row.orderId)}
              onToggle={() => toggleExpanded(row.orderId)}
              retryMutation={retryMutation}
              chargeNowMutation={chargeNowMutation}
              sendReminderMutation={sendReminderMutation}
              onAtRiskCharge={() => setPendingAtRiskCharge(row)}
              onCancel={() => setCancelSheetOrderId(row.orderId)}
            />
          ))}
        </View>
      )}

      <ConfirmDialog
        visible={pendingAtRiskCharge !== null}
        onClose={() => setPendingAtRiskCharge(null)}
        onConfirm={confirmAtRiskCharge}
        title="Buyer is at-risk"
        description="Proceeding will create a new Stripe charge attempt anyway. Are you sure?"
        confirmLabel="Charge anyway"
        cancelLabel="Cancel"
        destructive={true}
        confirmLoading={chargeNowMutation.isPending}
      />

      <RefundPreviewSheet
        visible={cancelSheetOrderId !== null}
        orderId={cancelSheetOrderId}
        onClose={() => setCancelSheetOrderId(null)}
        onCancelled={() => {
          void installmentsQuery.refetch();
          void ordersQuery.refetch();
        }}
      />
    </>
  );
};

interface TravelerRowProps {
  row: TravelerMoneyRow;
  expanded: boolean;
  onToggle: () => void;
  retryMutation: ReturnType<typeof useRetryInstallment>;
  chargeNowMutation: ReturnType<typeof useChargeInstallmentNow>;
  sendReminderMutation: ReturnType<typeof useSendInstallmentReminder>;
  onAtRiskCharge: () => void;
  onCancel: () => void;
}

const TravelerMoneyRowCard: React.FC<TravelerRowProps> = (props) => {
  const { row, expanded, onToggle } = props;
  return (
    <View style={styles.moneyBookingRow}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${buyerLabel(row)}, paid ${formatCurrency(row.paidToDateCents, row.currency)} of ${formatCurrency(row.orderTotalCents, row.currency)}, ${statusLabel(row.lastChargeStatus)}`}
        accessibilityHint="Tap to see installment ledger"
      >
        <View style={styles.moneyBookingHeader}>
          <Text style={styles.moneyBookingName}>{buyerLabel(row)}</Text>
          <Icon name={expanded ? "chevU" : "chevD"} size={18} color={textTokens.secondary} />
        </View>
        <View style={styles.phoneMetricGrid}>
          <MoneyMetric label="Plan" value={<PlanCell row={row} />} />
          <MoneyMetric
            label="Paid-to-date"
            value={`${formatCurrency(row.paidToDateCents, row.currency)} / ${formatCurrency(row.orderTotalCents, row.currency)}`}
          />
          <MoneyMetric
            label="Outstanding"
            value={`${formatCurrency(row.outstandingCents, row.currency)} left`}
          />
          <MoneyMetric label="Next inst" value={formatNextInstallment(row)} />
        </View>
        <StatusPill status={row.lastChargeStatus} />
      </Pressable>
      <RowActions {...props} />
      <ExpandedLedger {...props} />
    </View>
  );
};

const TravelerMoneyTableRow: React.FC<TravelerRowProps> = (props) => {
  const { row, expanded, onToggle } = props;
  return (
    <View style={styles.moneyTableRowWrap}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        style={styles.moneyTableRow}
      >
        <View style={styles.tableCell}>
          <Text style={styles.moneyBookingName}>{buyerLabel(row)}</Text>
          <Text style={styles.moneyBookingMeta}>{row.buyerEmail ?? ""}</Text>
        </View>
        <View style={styles.tableCell}><PlanCell row={row} /></View>
        <Text style={styles.tableCellText}>
          {formatCurrency(row.paidToDateCents, row.currency)} / {formatCurrency(row.orderTotalCents, row.currency)}
        </Text>
        <Text style={styles.tableCellText}>
          {formatCurrency(row.outstandingCents, row.currency)} left
        </Text>
        <Text style={styles.tableCellText}>{formatNextInstallment(row)}</Text>
        <View style={styles.tableCell}><StatusPill status={row.lastChargeStatus} /></View>
        <View style={styles.tableCell}>
          <RowActions {...props} compact={true} />
        </View>
      </Pressable>
      <ExpandedLedger {...props} />
    </View>
  );
};

const PlanCell: React.FC<{ row: TravelerMoneyRow }> = ({ row }) => {
  if (row.isPaidInFull) {
    return <Text style={styles.tableCellText}>Paid in full</Text>;
  }
  return (
    <InstallmentScheduleDisplay
      schedule={row.planSchedule}
      variant="cell"
      isProjection={false}
    />
  );
};

const MoneyMetric: React.FC<{
  label: string;
  value: string | React.ReactElement;
}> = ({ label, value }) => (
  <View style={styles.phoneMetric}>
    <Text style={styles.phoneMetricLabel}>{label}</Text>
    {typeof value === "string" ? (
      <Text style={styles.phoneMetricValue}>{value}</Text>
    ) : value}
  </View>
);

const StatusPill: React.FC<{ status: LastChargeStatus }> = ({ status }) => {
  const pillStyle = statusPillStyle(status);
  return (
    <View style={[styles.moneyStatusPill, pillStyle.pill]}>
      <Text style={[styles.moneyStatusPillText, pillStyle.text]}>
        {statusLabel(status)}
      </Text>
    </View>
  );
};

function formatNextInstallment(row: TravelerMoneyRow): string {
  if (row.nextInstallment === null) return "—";
  return `${formatMoneyDate(row.nextInstallment.dueAt)} · ${formatCurrency(row.nextInstallment.amountCents, row.nextInstallment.currency)}`;
}

const RowActions: React.FC<TravelerRowProps & { compact?: boolean }> = ({
  row,
  chargeNowMutation,
  sendReminderMutation,
  onAtRiskCharge,
  compact = false,
}) => {
  const recentReminder = useRecentReminderForOrder(row.orderId);
  const canCharge = row.nextInstallment !== null && !row.isPaidInFull;
  const reminderDisabled = row.isPaidInFull ||
    recentReminder.data !== null ||
    recentReminder.isLoading ||
    sendReminderMutation.isPending;
  const reminderCopy = row.isPaidInFull
    ? "No reminder needed — paid in full"
    : recentReminder.data !== null
      ? "Already reminded in the past 24h"
      : "Send reminder";
  return (
    <View style={[styles.actionRow, compact && styles.actionRowCompact]}>
      <Pressable
        onPress={() => {
          if (row.nextInstallment === null) return;
          if (row.orderAtRisk) {
            onAtRiskCharge();
            return;
          }
          chargeNowMutation.mutate({
            installmentId: row.nextInstallment.id,
            atRiskOverride: false,
          });
        }}
        disabled={!canCharge || chargeNowMutation.isPending}
        accessibilityRole="button"
        accessibilityLabel={`Charge now for ${buyerLabel(row)}`}
        accessibilityState={{ disabled: !canCharge || chargeNowMutation.isPending }}
        style={[
          styles.moneyActionBtn,
          (!canCharge || chargeNowMutation.isPending) && styles.moneyRetryBtnDisabled,
        ]}
      >
        <Text style={styles.moneyRetryBtnText}>Charge now</Text>
      </Pressable>
      <Pressable
        onPress={() => sendReminderMutation.mutate({ orderId: row.orderId })}
        disabled={reminderDisabled}
        accessibilityRole="button"
        accessibilityLabel={reminderCopy}
        accessibilityState={{ disabled: reminderDisabled }}
        style={[
          styles.moneyActionBtnSecondary,
          reminderDisabled && styles.moneyRetryBtnDisabled,
        ]}
      >
        <Text style={styles.moneyActionBtnSecondaryText}>{reminderCopy}</Text>
      </Pressable>
    </View>
  );
};

const ExpandedLedger: React.FC<TravelerRowProps> = ({
  row,
  expanded,
  retryMutation,
  onCancel,
}) => {
  if (!expanded) return null;
  return (
    <>
      <View style={styles.moneyDivider} />
      {row.installments.length > 0 ? row.installments.map((inst) => {
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
                Installment {inst.ordinal} · {formatMoneyDate(inst.dueAt)}
              </Text>
              <Text style={styles.moneyInstallmentAmount}>
                {formatCurrency(inst.amountCents, inst.currency)}
              </Text>
              <View style={[styles.moneyStatusPill, pillStyle.pill]}>
                <Text style={[styles.moneyStatusPillText, pillStyle.text]}>
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
                  accessibilityLabel={`Retry installment ${inst.ordinal} for ${buyerLabel(row)}`}
                  accessibilityHint="Queues a charge attempt on the next cron run"
                  accessibilityState={{ disabled: retryMutation.isPending }}
                  style={[
                    styles.moneyRetryBtn,
                    retryMutation.isPending && styles.moneyRetryBtnDisabled,
                  ]}
                >
                  <Text style={styles.moneyRetryBtnText}>
                    {retryMutation.isPending ? "Retrying..." : "Retry now"}
                  </Text>
                </Pressable>
              </>
            ) : null}
          </View>
        );
      }) : (
        <Text style={styles.moneyBookingMeta}>
          Paid in full at booking. No installment ledger for this traveller.
        </Text>
      )}
      <View style={styles.moneyDivider} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Cancel and refund ${buyerLabel(row)}'s booking`}
        accessibilityHint="Opens cancellation preview with refund amount and reason field"
        style={styles.moneyRefundBtn}
        onPress={onCancel}
      >
        <Text style={styles.moneyRefundBtnText}>Cancel &amp; refund</Text>
      </Pressable>
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
  phoneList: {
    gap: spacing.md,
  },
  moneyBookingRow: {
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    gap: spacing.sm,
  },
  moneyBookingHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
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
  phoneMetricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  phoneMetric: {
    width: "48%",
    minHeight: 64,
    padding: spacing.sm,
    borderRadius: radiusTokens.sm,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    gap: 2,
  },
  phoneMetricLabel: {
    color: textTokens.tertiary,
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
  },
  phoneMetricValue: {
    color: textTokens.primary,
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
  },
  moneyTable: {
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: radiusTokens.md,
    overflow: "hidden",
  },
  moneyTableRowWrap: {
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.08)",
  },
  moneyTableRow: {
    flexDirection: "row",
    alignItems: "stretch",
    minHeight: 76,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
  },
  moneyTableHeader: {
    minHeight: 40,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  moneyTableHeaderText: {
    flex: 1,
    padding: spacing.sm,
    color: textTokens.secondary,
    fontSize: typography.caption.fontSize,
    fontWeight: "700",
  },
  tableCell: {
    flex: 1,
    padding: spacing.sm,
    justifyContent: "center",
    minWidth: 0,
  },
  tableCellText: {
    flex: 1,
    padding: spacing.sm,
    color: textTokens.primary,
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    alignSelf: "center",
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
    alignSelf: "flex-start",
    marginTop: spacing.xs,
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
  actionRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  actionRowCompact: {
    flexDirection: "column",
    marginTop: 0,
  },
  moneyActionBtn: {
    minHeight: 40,
    borderRadius: radiusTokens.md,
    backgroundColor: accent.warm,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    flex: 1,
  },
  moneyActionBtnSecondary: {
    minHeight: 40,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.14)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    flex: 1,
  },
  moneyActionBtnSecondaryText: {
    fontSize: typography.caption.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
    textAlign: "center",
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
    textAlign: "center",
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
