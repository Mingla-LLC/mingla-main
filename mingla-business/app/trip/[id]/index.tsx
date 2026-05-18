/**
 * /trip/[id] — operator trip dashboard. Tr2 (ORCH-0859).
 *
 * Two tabs: Overview (revenue + traveler count + days-until-departure) +
 * Travelers (per-order rows). Mirrors event dashboard pattern.
 *
 * Per SPEC §4.9 + §4.10 file 13. Tr5+ adds Intake Forms tab, Tr6 adds
 * Discussion tab — Tr2 ships these two tabs only.
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
} from "../../../src/constants/designSystem";
import { Icon } from "../../../src/components/ui/Icon";
import { SafeScreen } from "../../../src/components/ui/SafeScreen";
import { Toast } from "../../../src/components/ui/Toast";
import { useTrip } from "../../../src/hooks/useTrips";
import { useTripOrders } from "../../../src/hooks/useTripOrders";
// ORCH-0873 [Tr3 Stage 2 UI] — Money tab data.
import {
  useInstallmentsForBrandTrips,
  useRetryInstallment,
} from "../../../src/hooks/useOrderInstallments";
import type {
  OrderInstallmentForBrand,
  OrderInstallmentStatus,
} from "../../../src/services/orderInstallmentsService";

type TabKey = "overview" | "travelers" | "money";
type MoneyFilter = "all" | "atRisk";

function daysBetween(now: Date, future: string | null): number | null {
  if (future === null) return null;
  try {
    const f = new Date(future);
    const diffMs = f.getTime() - now.getTime();
    return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  } catch {
    return null;
  }
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

export default function TripDashboardRoute(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [tab, setTab] = useState<TabKey>("overview");

  const tripQuery = useTrip(typeof eventId === "string" ? eventId : null);
  const ordersQuery = useTripOrders(typeof eventId === "string" ? eventId : null);
  // ORCH-0873 [Tr3 Stage 2 UI] — Money tab installment ledger.
  const brandId = tripQuery.data?.brandId ?? null;
  const [moneyFilter, setMoneyFilter] = useState<MoneyFilter>("all");
  const installmentsQuery = useInstallmentsForBrandTrips(brandId, {
    tripEventId: typeof eventId === "string" ? eventId : undefined,
    atRiskOnly: moneyFilter === "atRisk",
  });
  // Toast for retry mutation feedback (Constitution #3 — no silent failures).
  // Map hook's semantic kinds (success/warning/error) onto Toast's
  // ToastKind union (success/warn/error/info).
  const [toast, setToast] = useState<{
    visible: boolean;
    kind: "success" | "warn" | "error" | "info";
    message: string;
  }>({ visible: false, kind: "info", message: "" });
  const retryMutation = useRetryInstallment({
    onMessage: ({ kind, message }) => {
      const toastKind: "success" | "warn" | "error" | "info" =
        kind === "warning" ? "warn" : kind;
      setToast({ visible: true, kind: toastKind, message });
    },
  });
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
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
    // Sort orders: at-risk first, then by next-due-at ascending.
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

  // Revenue aggregation (excludes failed/cancelled/refunded orders).
  const revenueByCurrency = useMemo(() => {
    if (ordersQuery.data === undefined) return new Map<string, number>();
    const map = new Map<string, number>();
    for (const o of ordersQuery.data) {
      if (
        o.paymentStatus === "failed" ||
        o.paymentStatus === "cancelled" ||
        o.paymentStatus === "refunded"
      ) {
        continue;
      }
      map.set(o.currency, (map.get(o.currency) ?? 0) + o.totalCents);
    }
    return map;
  }, [ordersQuery.data]);

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
        <Text style={styles.title}>Couldn&rsquo;t load trip</Text>
        <Text style={styles.body}>
          {tripQuery.error instanceof Error
            ? tripQuery.error.message
            : "Try again."}
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

  const startDate = trip.businessTrip.startAt;
  const daysUntil = daysBetween(new Date(), startDate);
  const travelersCount = (ordersQuery.data ?? []).filter(
    (o) => o.paymentStatus !== "failed" && o.paymentStatus !== "cancelled",
  ).length;
  const primaryCurrency =
    [...revenueByCurrency.entries()][0]?.[0] ??
    trip.pricingTiers[0]?.currency ??
    "USD";
  const totalRevenue = revenueByCurrency.get(primaryCurrency) ?? 0;

  return (
    <SafeScreen style={styles.host}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.backBtn}
          hitSlop={8}
        >
          <Icon name="chevL" size={20} color={textTokens.primary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {trip.title}
        </Text>
        {/* ORCH-0859 REWORK 4 (operator smoke item #2): Edit button on
            operator dashboard so both draft AND published trips have an
            edit path. Routes to wizard host; wizard loads existing trip
            via useTrip and populates all 5 steps. For published trips
            re-tapping Publish updates all fields except slug (slug-
            immutability already enforced by biz_prevent_event_slug_change
            trigger from ORCH-0763 + dual-flag fix from REWORK 3). */}
        {/* ORCH-0859 REWORK 4 (operator smoke item #2): Edit button on
            operator dashboard so both draft AND published trips have an
            edit path. Routes to wizard host; wizard loads existing trip
            via useTrip and populates all 5 steps. For published trips
            re-tapping Publish updates all fields except slug (slug-
            immutability already enforced by biz_prevent_event_slug_change
            trigger from ORCH-0763 + dual-flag fix from REWORK 3). */}
        <Pressable
          onPress={() => router.push(`/trip/${trip.id}/edit` as never)}
          accessibilityRole="button"
          accessibilityLabel={
            trip.status === "draft"
              ? "Continue editing trip"
              : "Edit published trip"
          }
          style={styles.editBtn}
          hitSlop={8}
          testID="trip-dashboard-edit"
        >
          <Text style={styles.editBtnText}>Edit</Text>
        </Pressable>
      </View>

      {/* Status pill */}
      <View style={styles.pillRow}>
        <View
          style={[
            styles.statusPill,
            trip.status === "scheduled" || trip.status === "live"
              ? styles.statusPillLive
              : styles.statusPillDraft,
          ]}
        >
          <Text style={styles.statusPillText}>
            {trip.status === "draft" ? "Draft" : "Published"}
          </Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <Pressable
          onPress={() => setTab("overview")}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === "overview" }}
          accessibilityLabel="Overview tab"
          style={[styles.tab, tab === "overview" && styles.tabActive]}
        >
          <Text style={[styles.tabText, tab === "overview" && styles.tabTextActive]}>
            Overview
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setTab("travelers")}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === "travelers" }}
          accessibilityLabel={`Travelers tab, ${travelersCount} ${travelersCount === 1 ? "traveler" : "travelers"}`}
          style={[styles.tab, tab === "travelers" && styles.tabActive]}
        >
          <Text style={[styles.tabText, tab === "travelers" && styles.tabTextActive]}>
            Travelers ({travelersCount})
          </Text>
        </Pressable>
        {/* ORCH-0873 [Tr3 Stage 2 UI] — Money tab */}
        <Pressable
          onPress={() => setTab("money")}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === "money" }}
          accessibilityLabel={
            (moneyData?.atRiskOrderCount ?? 0) > 0
              ? `Money tab, ${moneyData?.atRiskOrderCount} at risk`
              : "Money tab"
          }
          style={[styles.tab, tab === "money" && styles.tabActive]}
        >
          <Text style={[styles.tabText, tab === "money" && styles.tabTextActive]}>
            {(moneyData?.atRiskOrderCount ?? 0) > 0 ? (
              <Text>
                Money{" "}
                <Text style={styles.tabBadgeAtRisk}>
                  ({moneyData?.atRiskOrderCount})
                </Text>
              </Text>
            ) : (
              "Money"
            )}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
      >
        {tab === "overview" ? (
          <>
            <View style={styles.kpiRow}>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Revenue</Text>
                <Text style={styles.kpiValue}>
                  {formatCurrency(totalRevenue, primaryCurrency)}
                </Text>
              </View>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Travelers</Text>
                <Text style={styles.kpiValue}>
                  {travelersCount}
                  {trip.businessTrip.capacity !== null ? (
                    <Text style={styles.kpiSubvalue}>
                      {" / " + trip.businessTrip.capacity}
                    </Text>
                  ) : null}
                </Text>
              </View>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Departure</Text>
              <Text style={styles.kpiValue}>
                {daysUntil === null
                  ? "Date TBD"
                  : daysUntil > 0
                    ? `In ${daysUntil} day${daysUntil === 1 ? "" : "s"}`
                    : daysUntil === 0
                      ? "Today"
                      : `${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? "" : "s"} ago`}
              </Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Destination</Text>
              <Text style={styles.kpiValue}>
                {trip.businessTrip.destinationLocationText ?? "Not set"}
              </Text>
            </View>
          </>
        ) : tab === "travelers" ? (
          <>
            {ordersQuery.isLoading ? (
              <ActivityIndicator />
            ) : (ordersQuery.data ?? []).length === 0 ? (
              <View style={styles.emptyState}>
                <Icon name="users" size={32} color={textTokens.tertiary} />
                <Text style={styles.emptyText}>
                  No travelers yet. Share the trip link to start taking bookings.
                </Text>
              </View>
            ) : (
              (ordersQuery.data ?? []).map((o) => (
                <View key={o.id} style={styles.travelerRow}>
                  <View style={styles.travelerTextCol}>
                    <Text style={styles.travelerName}>
                      {o.buyerName ?? o.buyerEmail ?? "Anonymous"}
                    </Text>
                    {o.buyerEmail !== null ? (
                      <Text style={styles.travelerEmail}>{o.buyerEmail}</Text>
                    ) : null}
                  </View>
                  <View style={styles.travelerMeta}>
                    <Text style={styles.travelerStatus}>{o.paymentStatus}</Text>
                    <Text style={styles.travelerAmount}>
                      {formatCurrency(o.totalCents, o.currency)}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </>
        ) : (
          // ORCH-0873 [Tr3 Stage 2 UI] — Money tab
          <MoneyTabBody
            installmentsQuery={installmentsQuery}
            moneyData={moneyData}
            moneyFilter={moneyFilter}
            setMoneyFilter={setMoneyFilter}
            expandedOrders={expandedOrders}
            toggleExpanded={toggleExpanded}
            retryMutation={retryMutation}
            onEditTripPricing={() => router.push(`/trip/${eventId}/edit` as never)}
          />
        )}
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radiusTokens.sm,
  },
  editBtn: {
    minWidth: 48,
    height: 36,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radiusTokens.sm,
  },
  editBtnText: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  pillRow: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  statusPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radiusTokens.sm,
  },
  statusPillLive: {
    backgroundColor: "rgba(34, 197, 94, 0.16)",
  },
  statusPillDraft: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  statusPillText: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  tabs: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
  },
  tab: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
    marginBottom: -1,
  },
  tabActive: {
    borderBottomColor: accent.warm,
  },
  tabText: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  tabTextActive: {
    color: textTokens.primary,
  },
  kpiRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  kpiCard: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    gap: spacing.xs,
  },
  kpiLabel: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  kpiValue: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
  },
  kpiSubvalue: {
    fontSize: typography.body.fontSize,
    fontWeight: "400",
    color: textTokens.tertiary,
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
  travelerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  travelerTextCol: {
    flex: 1,
  },
  travelerName: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  travelerEmail: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    marginTop: 2,
  },
  travelerMeta: {
    alignItems: "flex-end",
  },
  travelerStatus: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    textTransform: "capitalize",
  },
  travelerAmount: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
    marginTop: 2,
  },
  // ORCH-0873 [Tr3 Stage 2 UI] — Money tab styles
  tabBadgeAtRisk: {
    color: semantic.error,
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

// ============================================================================
// ORCH-0873 [Tr3 Stage 2 UI] — MoneyTabBody subcomponent
// ============================================================================

interface MoneyTabBodyProps {
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

const MoneyTabBody: React.FC<MoneyTabBodyProps> = ({
  installmentsQuery,
  moneyData,
  moneyFilter,
  setMoneyFilter,
  expandedOrders,
  toggleExpanded,
  retryMutation,
  onEditTripPricing,
}) => {
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
        <Text style={styles.emptyText}>Couldn&rsquo;t load installments.</Text>
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
    );
  }
  return (
    <>
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
                  <Text style={styles.moneyAtRiskPillText}>⚠ At risk</Text>
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
                                ? "Retrying…"
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
                  accessibilityState={{ disabled: true }}
                  accessibilityLabel="Refund coming in Tr4"
                  style={styles.moneyRefundBtn}
                  disabled
                >
                  <Text style={styles.moneyRefundBtnText}>
                    Refund · coming in Tr4
                  </Text>
                </Pressable>
              </>
            ) : null}
          </View>
        );
      })}
    </>
  );
};
