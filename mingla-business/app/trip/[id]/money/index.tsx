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
  radius as radiusTokens,
  color,
  space,
  type,
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
  useTripEventBalances,
} from "../../../../src/hooks/useOrderInstallments";
import { featureFlags } from "../../../../src/config/featureFlags";
import {
  buildTripMoneyV2View,
  closedOrderState,
  TRIP_MONEY_V2_CHIP_LABEL,
  TRIP_MONEY_V2_BELOW_MINIMUM_COPY,
  TRIP_MONEY_V2_IN_FLIGHT_COPY,
  type TripMoneyV2Chip,
  type TripMoneyV2View,
} from "../../../../src/components/trip/tripMoneyV2Model";
import {
  useChargeInstallmentNow,
  useRecentReminderForOrder,
  useSendInstallmentReminder,
} from "../../../../src/hooks/useManualInstallmentActions";
import { useResponsiveLayout } from "../../../../src/hooks/useResponsiveLayout";
import { useTripOrders } from "../../../../src/hooks/useTripOrders";
import { useTrip } from "../../../../src/hooks/useTrips";
import type {
  HostTripBalance,
  OrderInstallmentForBrand,
  OrderInstallmentStatus,
} from "../../../../src/services/orderInstallmentsService";
import { formatCurrency as formatCurrencyAmount } from "../../../../src/utils/currency";
import { projectInstallmentSchedule } from "../../../../src/utils/installmentScheduleProjection";
// #3372 — naira shows "₦", not "NGN", on the host trip money screen (#3341 rule).
import { withCurrencyGlyph } from "@mingla/offering-rendering/currencyGlyph";

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
  /** issue #4522 S-2 — a plan-v2 order, read from the server balance; null otherwise. */
  v2: TripMoneyV2View | null;
  /**
   * issue #4522 X-7 — the order was refunded or cancelled: nothing is left to
   * collect or cancel, whatever its rows add up to. Null for a live order.
   */
  closed: "refunded" | "cancelled" | null;
}


function formatCurrency(cents: number, currency: string): string {
  return withCurrencyGlyph(
    formatCurrencyAmount(cents, currency, true),
    currency,
  );
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
    case "superseded":
      return "Rebalanced";
    default:
      return status;
  }
}

/**
 * #4420 B1 — the Charge now confirm (mockup `trip-money__charge-confirm`):
 * the amount, whose card, and that it is charged straight away.
 */
export function chargeConfirmCopy(row: {
  buyerName: string | null;
  buyerEmail: string | null;
  nextInstallment: Pick<OrderInstallmentForBrand, "amountChargedCents" | "currency" | "paymentCardLast4"> | null;
}): { title: string; description: string; confirmLabel: string } {
  const next = row.nextInstallment;
  const amount = next === null ? "" : formatCurrency(next.amountChargedCents, next.currency);
  const card = next?.paymentCardLast4
    ? `${buyerLabel(row)}'s card ending ${next.paymentCardLast4}`
    : `${buyerLabel(row)}'s card`;
  return {
    title: `Charge ${amount} now?`,
    description: `${card} is charged straight away.`,
    confirmLabel: `Charge ${amount}`,
  };
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
    .reduce((sum, row) => sum + row.amountChargedCents, 0);
  const outstandingCents = Math.max(0, head.orderTotalCents - paidToDateCents);
  const nextInstallment = sortedRows
    .filter((row) => row.status === "scheduled" || row.status === "failed")
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0] ?? null;
  const attempted = mostRecentAttempted(sortedRows);
  const totalInstallmentCents = sortedRows.reduce(
    (sum, row) => sum + row.amountChargedCents,
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
    closed: null,
    planSchedule: {
      fullPriceCents: head.orderTotalCents,
      depositCents,
      currency: head.currency,
      installments: sortedRows.map((row) => ({
        ordinal: row.ordinal,
        pct: 0,
        amountCents: row.amountChargedCents,
        dueAt: row.dueAt,
      })),
    },
    v2: null,
  };
}

/**
 * issue #4522 S-2 — a plan-v2 order: paid, owed and next come from the
 * server's balance (issue_4522_balance), never from summing rows here.
 */
function deriveV2InstallmentRow(
  rows: OrderInstallmentForBrand[],
  balance: HostTripBalance,
): TravelerMoneyRow {
  const head = rows[0];
  const v2 = buildTripMoneyV2View({
    rows,
    balance,
    money: (minor) => formatCurrency(minor, balance.currency),
  });
  const lastChargeStatus: LastChargeStatus = head.orderAtRisk
    ? "at_risk"
    : v2.settled
      ? "collected"
      : v2.nextOpenRow?.status === "failed"
        ? "failed"
        : "scheduled";
  return {
    orderId: head.orderId,
    buyerName: head.buyerName,
    buyerEmail: head.buyerEmail,
    orderTotalCents: balance.totalMinor,
    currency: balance.currency,
    orderAtRisk: head.orderAtRisk,
    installments: rows,
    isPaidInFull: false,
    paidToDateCents: balance.paidMinor,
    outstandingCents: balance.remainingMinor,
    nextInstallment: v2.nextOpenRow,
    lastChargeStatus,
    planSchedule: null,
    v2,
    closed: null,
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
    planV2: featureFlags.tripPlanV2,
  });
  // issue #4522 S-2 — plan-v2 balances (server truth); off with the switch.
  const balancesQuery = useTripEventBalances(
    typeof eventId === "string" ? eventId : null,
    featureFlags.tripPlanV2,
  );
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
    const balancesByOrder = new Map<string, HostTripBalance>();
    if (featureFlags.tripPlanV2) {
      if (balancesQuery.data === undefined) return null;
      for (const balance of balancesQuery.data) {
        balancesByOrder.set(balance.orderId, balance);
      }
    }
    const rowsByOrder = new Map<string, OrderInstallmentForBrand[]>();
    for (const row of installmentsQuery.data) {
      const arr = rowsByOrder.get(row.orderId) ?? [];
      arr.push(row);
      rowsByOrder.set(row.orderId, arr);
    }
    const statusByOrder = new Map(
      ordersQuery.data.map((order) => [order.id, order.paymentStatus]),
    );
    const installmentRows = [...rowsByOrder.values()].map((orderRows) => {
      const balance = balancesByOrder.get(orderRows[0].orderId);
      const derived = balance === undefined
        ? deriveInstallmentRow(orderRows)
        : deriveV2InstallmentRow(orderRows, balance);
      // issue #4522 X-7 — a refunded or cancelled order shows that, not
      // "Collected · paid in full", and offers no charge, reminder or cancel.
      const closed = closedOrderState(statusByOrder.get(derived.orderId));
      return closed === null
        ? derived
        : { ...derived, closed, lastChargeStatus: closed, nextInstallment: null };
    });
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
        v2: null,
        closed: null,
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
  }, [balancesQuery.data, installmentsQuery.data, moneyFilter, ordersQuery.data]);

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
        title="Payments"
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
          balancesQuery={balancesQuery}
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
  balancesQuery: ReturnType<typeof useTripEventBalances>;
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
  balancesQuery,
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
  // #4420 B1 — Charge now moves the buyer's money, so it asks once first
  // (decision on #4420, 11-14). The at-risk path keeps its own confirm above.
  const [pendingCharge, setPendingCharge] = useState<TravelerMoneyRow | null>(null);

  if (installmentsQuery.isError || ordersQuery.isError || balancesQuery.isError) {
    return (
      <View style={styles.emptyState}>
        <Icon name="bell" size={32} color={color.danger} />
        <Text style={styles.emptyText}>Couldn&apos;t load bookings.</Text>
        <Pressable
          onPress={() => {
            void installmentsQuery.refetch();
            void ordersQuery.refetch();
            void balancesQuery.refetch();
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
  if (installmentsQuery.isLoading || ordersQuery.isLoading || moneyData === null) {
    return (
      <View style={{ paddingVertical: space[7], alignItems: "center" }}>
        <ActivityIndicator />
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
          <Icon name="pound" size={32} color={color.text3} />
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

  const confirmCharge = (): void => {
    const installment = pendingCharge?.nextInstallment ?? null;
    setPendingCharge(null);
    if (installment === null) return;
    chargeNowMutation.mutate({
      installmentId: installment.id,
      atRiskOverride: false,
    });
  };
  const pendingChargeCopy = pendingCharge === null ? null : chargeConfirmCopy(pendingCharge);

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
              onCharge={() => setPendingCharge(row)}
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
              onCharge={() => setPendingCharge(row)}
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
        description="Proceeding will create a new charge attempt anyway. Are you sure?"
        confirmLabel="Charge anyway"
        cancelLabel="Cancel"
        destructive={true}
        confirmLoading={chargeNowMutation.isPending}
      />

      <ConfirmDialog
        visible={pendingCharge !== null}
        onClose={() => setPendingCharge(null)}
        onConfirm={confirmCharge}
        title={pendingChargeCopy?.title ?? ""}
        description={pendingChargeCopy?.description ?? ""}
        confirmLabel={pendingChargeCopy?.confirmLabel ?? "Charge"}
        cancelLabel="Cancel"
        confirmLoading={chargeNowMutation.isPending}
        confirmTestID="trip-money-charge-confirm"
        cancelTestID="trip-money-charge-cancel"
        testID="trip-money-charge-dialog"
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
  /** #4420 B1 — opens the Charge now confirm; the mutation runs only on confirm. */
  onCharge: () => void;
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
          <Icon name={expanded ? "chevU" : "chevD"} size={18} color={color.text2} />
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
        accessibilityLabel={`${buyerLabel(row)}, ${expanded ? "collapse" : "expand"} payment details`}
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
  if (row.v2 !== null) {
    return <Text style={styles.tableCellText}>{row.v2.termsLine}</Text>;
  }
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
  if (row.v2 !== null) {
    const next = row.v2.nextPayment;
    return next === null
      ? "—"
      : `${formatMoneyDate(next.dueAt)} · ${formatCurrency(next.amountMinor, row.currency)}`;
  }
  if (row.nextInstallment === null) return "—";
  return `${formatMoneyDate(row.nextInstallment.dueAt)} · ${formatCurrency(row.nextInstallment.amountChargedCents, row.nextInstallment.currency)}`;
}

function relativeActionTime(value: string | null): string {
  if (value === null) return "";
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const hours = Math.floor(elapsed / (60 * 60 * 1000));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function installmentMethodLine(inst: OrderInstallmentForBrand): string {
  if (inst.buyerAction === "approval_required") {
    return "Waiting for buyer to approve";
  }
  if (inst.collectionMethod === "auto_card") {
    return inst.paymentCardLast4
      ? `Automatic · card ending ${inst.paymentCardLast4}`
      : "Automatic card";
  }
  if (inst.buyerAction === "pay_link_sent") {
    const when = relativeActionTime(inst.buyerActionAt);
    return `Pay link sent${when ? ` ${when}` : ""}`;
  }
  return `Pay link will be sent ${formatMoneyDate(inst.dueAt)}`;
}

const RowActions: React.FC<TravelerRowProps & { compact?: boolean }> = ({
  row,
  chargeNowMutation,
  sendReminderMutation,
  onAtRiskCharge,
  onCharge,
  compact = false,
}) => {
  const recentReminder = useRecentReminderForOrder(row.orderId);
  // issue #4522 X-7 — nothing to charge or remind on a refunded / cancelled order.
  if (row.closed !== null) return null;
  // issue #4522 S-2 — a settled plan-v2 order is paid in full; while a
  // traveler payment processes, nothing else may charge; a balance below the
  // provider's minimum stays owed but cannot be charged (no Charge now).
  // (A settled v2 order has no next open row, so canCharge is already false.)
  const settled = row.isPaidInFull || row.v2?.settled === true;
  const inFlight = row.v2?.paymentInFlight === true;
  const belowMinimum = row.v2?.belowProviderMinimum === true;
  const canCharge = row.nextInstallment !== null && !row.isPaidInFull && !inFlight && !belowMinimum;
  const sendPayLink = row.nextInstallment?.collectionMethod === "pay_link" ||
    row.nextInstallment?.buyerAction === "approval_required";
  const reminderDisabled = row.isPaidInFull ||
    settled ||
    inFlight ||
    belowMinimum ||
    recentReminder.data !== null ||
    recentReminder.isLoading ||
    sendReminderMutation.isPending;
  const reminderCopy = settled
    ? "No reminder needed — paid in full"
    : recentReminder.data !== null
      ? "Already reminded in the past 24h"
      : sendPayLink
        ? "Send pay link"
        : "Send reminder";
  return (
    <View style={[styles.actionRow, compact && styles.actionRowCompact]}>
      {!sendPayLink ? <Pressable
        onPress={() => {
          if (row.nextInstallment === null) return;
          if (row.orderAtRisk) {
            onAtRiskCharge();
            return;
          }
          onCharge();
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
        <Text style={styles.moneyActionBtnText}>Charge now</Text>
      </Pressable> : null}
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
      {inFlight && !settled ? (
        <Text style={styles.moneyBookingMeta} testID="trip-money-in-flight">
          {TRIP_MONEY_V2_IN_FLIGHT_COPY}
        </Text>
      ) : null}
      {belowMinimum && !inFlight ? (
        <Text style={styles.moneyBookingMeta} testID="trip-money-below-minimum">
          {TRIP_MONEY_V2_BELOW_MINIMUM_COPY}
        </Text>
      ) : null}
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
  if (row.v2 !== null) {
    return (
      <>
        <View style={styles.moneyDivider} />
        <V2Ledger row={row} view={row.v2} retryMutation={retryMutation} />
        {row.closed === null ? (
          <>
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
        ) : null}
      </>
    );
  }
  return (
    <>
      <View style={styles.moneyDivider} />
      {row.installments.length > 0 ? row.installments.map((inst) => {
        const pillStyle = statusPillStyle(inst.status);
        return (
          <View
            key={inst.id}
            style={{ marginBottom: space[1] }}
            accessibilityRole="text"
            accessibilityLabel={`Installment ${inst.ordinal}, ${formatCurrency(inst.amountChargedCents, inst.currency)}, ${installmentMethodLine(inst)}, ${statusLabel(inst.status)}, due ${formatMoneyDate(inst.dueAt)}`}
          >
            <View style={styles.moneyInstallmentRow}>
              <Text style={styles.moneyInstallmentLabel}>
                Installment {inst.ordinal} · {formatMoneyDate(inst.dueAt)}
              </Text>
              <Text style={styles.moneyInstallmentAmount}>
                {formatCurrency(inst.amountChargedCents, inst.currency)}
              </Text>
              <View style={[styles.moneyStatusPill, pillStyle.pill]}>
                <Text style={[styles.moneyStatusPillText, pillStyle.text]}>
                  {statusLabel(inst.status)}
                </Text>
              </View>
            </View>
            <Text style={styles.moneyBookingMeta}>
              {installmentMethodLine(inst)}
            </Text>
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
      {row.closed === null ? (
        <>
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
      ) : null}
    </>
  );
};

function v2ChipStyle(chip: TripMoneyV2Chip): { pill: object; text: object } {
  switch (chip) {
    case "paid":
    case "paid_partial":
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
    case "rebalanced":
    case "refunded":
    case "cancelled":
      return { pill: styles.moneyStatusPillScheduled, text: {} };
    default: {
      const unreachable: never = chip;
      return unreachable;
    }
  }
}

/** issue #4522 S-2 (spec §9.11) — a plan-v2 order's rows, overpayment and History. */
const V2Ledger: React.FC<{
  row: TravelerMoneyRow;
  view: TripMoneyV2View;
  retryMutation: ReturnType<typeof useRetryInstallment>;
}> = ({ row, view, retryMutation }) => {
  const [historyOpen, setHistoryOpen] = useState(false);
  let paymentNumber = 0;
  return (
    <View testID={`trip-money-v2-ledger-${row.orderId}`}>
      <Text style={styles.moneyBookingMeta}>{view.termsLine}</Text>
      {view.ledger.map((entry) => {
        const chipLabel = TRIP_MONEY_V2_CHIP_LABEL[entry.chip];
        const chipStyle = v2ChipStyle(entry.chip);
        const inst = entry.installment;
        // Set rows are numbered; a traveler's own flexible payment is not one of them.
        const isFlex = inst?.kind === "flex";
        if (entry.kind === "payment" && !isFlex) paymentNumber += 1;
        const when = entry.dueAt === null ? "" : ` · ${formatMoneyDate(entry.dueAt)}`;
        const label = entry.kind === "deposit"
          ? "Deposit"
          : isFlex
            ? `Payment${when}`
            : `Payment ${paymentNumber}${when}`;
        const amount = formatCurrency(entry.amountMinor, row.currency);
        return (
          <View
            key={entry.key}
            style={{ marginBottom: space[1] }}
            accessibilityRole="text"
            accessibilityLabel={`${label}, ${amount}, ${chipLabel}`}
          >
            <View style={styles.moneyInstallmentRow}>
              <Text style={styles.moneyInstallmentLabel}>{label}</Text>
              <Text style={styles.moneyInstallmentAmount}>{amount}</Text>
              <View style={[styles.moneyStatusPill, chipStyle.pill]}>
                <Text style={[styles.moneyStatusPillText, chipStyle.text]}>{chipLabel}</Text>
              </View>
            </View>
            {inst !== null && entry.chip === "scheduled" ? (
              <Text style={styles.moneyBookingMeta}>{installmentMethodLine(inst)}</Text>
            ) : null}
            {inst !== null && entry.chip === "failed" ? (
              <>
                <Text style={styles.moneyFailureReason}>
                  {friendlyFailureCopy(inst.failureReason)}
                </Text>
                <Pressable
                  onPress={() => retryMutation.mutate(inst.id)}
                  disabled={retryMutation.isPending || view.paymentInFlight}
                  accessibilityRole="button"
                  accessibilityLabel={`Retry ${label} for ${buyerLabel(row)}`}
                  accessibilityHint="Queues a charge attempt on the next cron run"
                  accessibilityState={{ disabled: retryMutation.isPending || view.paymentInFlight }}
                  style={[
                    styles.moneyRetryBtn,
                    (retryMutation.isPending || view.paymentInFlight) && styles.moneyRetryBtnDisabled,
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
      })}
      {view.overpaymentLines.map((line) => (
        <Text key={line} style={styles.moneyBookingMeta}>{line}</Text>
      ))}
      {view.history.length > 0 ? (
        <>
          <Pressable
            onPress={() => setHistoryOpen((open) => !open)}
            accessibilityRole="button"
            accessibilityState={{ expanded: historyOpen }}
            accessibilityLabel="History"
            style={styles.moneyHistoryToggle}
          >
            <Text style={styles.moneyActionBtnText}>History</Text>
            <Icon name={historyOpen ? "chevU" : "chevD"} size={16} color={color.text2} />
          </Pressable>
          {historyOpen
            ? view.history.map((item) => (
              <Text key={item.key} style={styles.moneyBookingMeta}>
                {formatMoneyDate(item.at)} · {item.text}
              </Text>
            ))
            : null}
        </>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: color.canvas,
  },
  stateHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space[7],
    gap: space[4],
    backgroundColor: color.canvas,
  },
  title: {
    fontSize: type.h1.fontSize,
    color: color.text1,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: space[6],
    gap: space[4],
  },
  emptyState: {
    padding: space[7],
    alignItems: "center",
    gap: space[2],
  },
  emptyText: {
    fontSize: type.small.fontSize,
    color: color.text2,
    textAlign: "center",
  },
  plannerScheduleHeaderWrap: {
    width: "100%",
    marginBottom: space[4],
  },
  moneyFilterRow: {
    flexDirection: "row",
    gap: space[2],
    marginBottom: space[4],
  },
  moneyFilterChip: {
    paddingHorizontal: space[4],
    paddingVertical: space[1],
    borderRadius: radiusTokens.full,
    borderWidth: 1,
    borderColor: color.lineStrong,
    backgroundColor: color.fill.tableHead,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  // #4420 — a selected segment, not an orange fill (orange is not a button colour).
  moneyFilterChipActive: {
    borderColor: color.lineStrong,
    backgroundColor: color.fill.tabOn,
  },
  moneyFilterChipAtRisk: {
    borderColor: color.errorLine,
  },
  moneyFilterChipText: {
    fontSize: type.caption.fontSize,
    fontWeight: "600",
    color: color.text2,
  },
  moneyFilterChipTextActive: {
    color: color.textStrong,
  },
  moneyFilterChipTextAtRisk: {
    color: color.errorText,
  },
  phoneList: {
    gap: space[4],
  },
  moneyBookingRow: {
    padding: space[4],
    borderRadius: radiusTokens.xxl,
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.line,
    gap: space[2],
  },
  moneyBookingHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space[2],
  },
  moneyBookingName: {
    fontSize: type.body.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
  moneyBookingMeta: {
    fontSize: type.caption.fontSize,
    color: color.text2,
    marginTop: 2,
  },
  phoneMetricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
    marginTop: space[2],
  },
  phoneMetric: {
    width: "48%",
    minHeight: 64,
    padding: space[2],
    borderRadius: radiusTokens.sm,
    backgroundColor: color.fill.inset,
    gap: 2,
  },
  phoneMetricLabel: {
    color: color.text3,
    fontSize: type.caption.fontSize,
    fontWeight: "600",
  },
  phoneMetricValue: {
    color: color.text1,
    fontSize: type.small.fontSize,
    fontWeight: "600",
  },
  moneyTable: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radiusTokens.xl,
    overflow: "hidden",
  },
  moneyTableRowWrap: {
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  moneyTableRow: {
    flexDirection: "row",
    alignItems: "stretch",
    minHeight: 76,
    backgroundColor: color.fill.tableHead,
  },
  moneyTableHeader: {
    minHeight: 40,
    backgroundColor: color.fill.tile,
  },
  moneyTableHeaderText: {
    flex: 1,
    padding: space[2],
    color: color.text2,
    fontSize: type.caption.fontSize,
    fontWeight: "700",
  },
  tableCell: {
    flex: 1,
    padding: space[2],
    justifyContent: "center",
    minWidth: 0,
  },
  tableCellText: {
    flex: 1,
    padding: space[2],
    color: color.text1,
    fontSize: type.small.fontSize,
    fontWeight: "600",
    alignSelf: "center",
  },
  moneyInstallmentRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: space[1],
  },
  moneyInstallmentLabel: {
    flex: 1,
    fontSize: type.small.fontSize,
    color: color.text1,
  },
  moneyInstallmentAmount: {
    fontSize: type.small.fontSize,
    color: color.text1,
    marginRight: space[2],
  },
  moneyStatusPill: {
    paddingHorizontal: space[2],
    paddingVertical: 2,
    borderRadius: radiusTokens.sm,
    minWidth: 80,
    alignItems: "center",
    alignSelf: "flex-start",
    marginTop: space[1],
  },
  moneyStatusPillScheduled: {
    backgroundColor: color.fill.pressed,
  },
  moneyStatusPillCollected: {
    backgroundColor: color.successTint,
  },
  moneyStatusPillFailed: {
    backgroundColor: color.errorTint,
  },
  moneyStatusPillText: {
    fontSize: type.caption.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
  moneyStatusPillTextCollected: {
    color: color.success,
  },
  moneyStatusPillTextFailed: {
    color: color.danger,
  },
  actionRow: {
    flexDirection: "row",
    gap: space[2],
    marginTop: space[1],
  },
  actionRowCompact: {
    flexDirection: "column",
    marginTop: 0,
  },
  // #4420 — Charge now is a secondary control; the confirm carries the primary.
  moneyActionBtn: {
    minHeight: 40,
    borderRadius: radiusTokens.full,
    backgroundColor: color.fill.inset,
    borderWidth: 1,
    borderColor: color.lineStrong,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space[4],
    flex: 1,
  },
  moneyActionBtnSecondary: {
    minHeight: 40,
    borderRadius: radiusTokens.full,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space[4],
    flex: 1,
  },
  moneyActionBtnSecondaryText: {
    fontSize: type.caption.fontSize,
    fontWeight: "700",
    color: color.text1,
    textAlign: "center",
  },
  moneyRetryBtn: {
    marginTop: space[1],
    minHeight: 44,
    borderRadius: radiusTokens.full,
    backgroundColor: color.paper,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space[4],
  },
  moneyRetryBtnDisabled: {
    opacity: 0.5,
  },
  moneyRetryBtnText: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.ink,
    textAlign: "center",
  },
  moneyActionBtnText: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.text1,
    textAlign: "center",
  },
  moneyFailureReason: {
    fontSize: type.caption.fontSize,
    color: color.danger,
    marginTop: 2,
  },
  moneyHistoryToggle: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
  },
  moneyDivider: {
    height: 1,
    backgroundColor: color.fill.pressed,
    marginVertical: space[2],
  },
  moneyRefundBtn: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.4,
  },
  moneyRefundBtnText: {
    fontSize: type.caption.fontSize,
    color: color.text3,
  },
});
