/**
 * /trip/[id] — operator trip dashboard. Tr2 (ORCH-0859).
 *
 * Two tabs: Overview (revenue + traveler count + days-until-departure) +
 * Travelers (per-order rows). Mirrors event dashboard pattern.
 *
 * Per SPEC §4.9 + §4.10 file 13. Tr5+ adds Intake Forms tab, Tr6 adds
 * Discussion tab — Tr2 ships these two tabs only.
 */

import React, { useMemo, useState } from "react";
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
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import { Icon } from "../../../src/components/ui/Icon";
import { SafeScreen } from "../../../src/components/ui/SafeScreen";
import { useTrip } from "../../../src/hooks/useTrips";
import { useTripOrders } from "../../../src/hooks/useTripOrders";

type TabKey = "overview" | "travelers";

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
        ) : (
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
        )}
      </ScrollView>
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
});
