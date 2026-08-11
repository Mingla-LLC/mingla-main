/**
 * Issue #1791 (#1767 Phase 3) — the ORDERS module. The venue hub's live
 * service surface, and the gate Phase 4 cannot open without.
 *
 * THE SHAPE, and why (DESIGN D-3b, D-7; SPEC #1788 P-53, P-55, P-16):
 *
 *  * ONE QUEUE PER BRAND, filterable by venue and by zone. A hotel's
 *    room-service tickets and its restaurant's table tickets belong in one list
 *    because they are one kitchen. Every ticket therefore names its
 *    destination — table, room, zone, or `COLLECT · 42 · Amara`.
 *  * THE NOTIFICATION TRIPLE. Realtime + a 30-second poll floor (both in
 *    `useVenueOrders`) + push (server-side). The poll floor is the leg the
 *    shipped Reservations module does not have, and its absence there is the
 *    reason an inbound booking can sit unseen on a frozen channel. An order
 *    with money taken cannot inherit that.
 *  * THE VENUE'S OWN PAUSE SWITCH. Theirs, for when they are genuinely
 *    slammed. Mingla never touches it — no sweep, no cron, no escalation rung
 *    pauses a venue's ordering on their behalf (D-7b).
 *  * THE ORDERING MASTER SWITCH. `ordering_enabled` defaults OFF and this is
 *    the only surface in the product that can turn it on (ruling OQ-7): the
 *    switch ships with the queue that watches what it lets in.
 *
 * Ack floor is ANY brand member (ruling OQ-4) — a real floor waiter is often a
 * rank-10 scanner, and if the person holding the ticket cannot say they have
 * it, the acknowledgement means nothing. Money actions (cancel, refund
 * decision) and the two switches are event_manager+.
 */

import React, { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ClipboardList } from "lucide-react-native";

import {
  accent,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import { useQrSpotVenues } from "../../hooks/useQrSpots";
import {
  useDecideVenueOrderRefund,
  useTransitionVenueOrder,
  useVenueOrders,
} from "../../hooks/useVenueOrders";
import {
  useSetVenueOrderingEnabled,
  useSetVenueOrderingPaused,
  useVenueOrderingSettings,
} from "../../hooks/useVenueOrderingSettings";
import { BRAND_ROLE_RANK } from "../../utils/brandRole";
import { BrandSwitch } from "../ui/BrandSwitch";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { VenueOrderCard } from "./VenueOrderCard";
import { VenueOrderDetailSheet } from "./VenueOrderDetailSheet";
import {
  VENUE_ORDER_VIEWS,
  availableZones,
  filterVenueOrdersByScope,
  filterVenueOrdersForView,
  liveOrderCount,
  sortForQueue,
  type VenueOrder,
  type VenueOrderAction,
  type VenueOrderView,
} from "./venueOrderViews";

const MANAGER_PLUS_RANK = BRAND_ROLE_RANK.event_manager;

const VIEW_EMPTY: Record<VenueOrderView, string> = {
  new: "Nothing new right now.",
  in_progress: "Nothing cooking.",
  ready: "Nothing waiting to go out.",
  refunds: "No refund requests. Good sign.",
  done: "Nothing finished in the last 24 hours.",
};

export interface VenueOrdersModuleProps {
  brandId: string | null;
  /** The venue this module was opened from — the default filter, not a cage. */
  venueId?: string | null;
  testID?: string;
}

export function VenueOrdersModule({
  brandId,
  venueId = null,
  testID,
}: VenueOrdersModuleProps): React.ReactElement {
  const { rank } = useCurrentBrandRole(brandId);
  // OQ-4: acknowledging is not a money act, so ANY active member may do it.
  const canWorkQueue = rank > 0;
  const canDecideMoney = rank >= MANAGER_PLUS_RANK;

  const ordersQuery = useVenueOrders(brandId);
  const venuesQuery = useQrSpotVenues(brandId);
  const settingsQuery = useVenueOrderingSettings(venueId);
  const transition = useTransitionVenueOrder(brandId);
  const refundDecision = useDecideVenueOrderRefund(brandId);
  const setPaused = useSetVenueOrderingPaused(venueId);
  const setEnabled = useSetVenueOrderingEnabled(venueId);

  const [view, setView] = useState<VenueOrderView>("new");
  // Default to the venue the operator opened, because that is where they are.
  // "All venues" is one tap away — the queue is brand-wide by design (D-3b).
  const [venueFilter, setVenueFilter] = useState<string | null>(venueId);
  const [zoneFilter, setZoneFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<VenueOrder | null>(null);

  const allOrders = ordersQuery.data ?? [];
  const venueNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of venuesQuery.data ?? []) map.set(v.id, v.name);
    return map;
  }, [venuesQuery.data]);

  const scoped = useMemo(
    () => filterVenueOrdersByScope(allOrders, venueFilter, zoneFilter),
    [allOrders, venueFilter, zoneFilter],
  );
  const zones = useMemo(
    () => availableZones(filterVenueOrdersByScope(allOrders, venueFilter, null)),
    [allOrders, venueFilter],
  );
  const visible = useMemo(
    () => sortForQueue(filterVenueOrdersForView(scoped, view)),
    [scoped, view],
  );
  const live = liveOrderCount(scoped);

  const handleAction = useCallback(
    (order: VenueOrder, action: VenueOrderAction): void => {
      transition.mutate(
        { orderId: order.id, action },
        { onSuccess: () => setSelected(null) },
      );
    },
    [transition],
  );

  const handleRefundDecision = useCallback(
    (
      order: VenueOrder,
      decision: "approved" | "declined",
      note: string | null,
    ): void => {
      refundDecision.mutate(
        { orderId: order.id, decision, note },
        { onSuccess: () => setSelected(null) },
      );
    },
    [refundDecision],
  );

  const settings = settingsQuery.data ?? null;
  const orderingEnabled = settings?.orderingEnabled === true;
  const paused = settings?.paused === true;

  return (
    <View style={styles.host} testID={testID ?? "venue-orders-module"}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Orders</Text>
          <Text style={styles.subtitle}>
            {live === 0
              ? "Every order across your venues, live."
              : `${live} order${live === 1 ? "" : "s"} on the go.`}
          </Text>
        </View>
      </View>

      {/* ---- The venue's own switches. Ordering is OFF until they say so. ---- */}
      {venueId !== null ? (
        <GlassCard variant="elevated" style={styles.switchCard}>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.switchTitle}>Take orders through Mingla</Text>
              <Text style={styles.switchBody}>
                {orderingEnabled
                  ? "Guests can scan a code and order. You'll see every ticket here."
                  : "Off. Turn it on when you're ready to take orders at the table."}
              </Text>
            </View>
            <BrandSwitch
              value={orderingEnabled}
              onValueChange={(next) => setEnabled.mutate(next)}
              disabled={!canDecideMoney || setEnabled.isPending}
              accessibilityLabel="Take orders through Mingla"
              testID="venue-orders-enable-switch"
            />
          </View>
          {orderingEnabled ? (
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={styles.switchTitle}>Pause new orders</Text>
                <Text style={styles.switchBody}>
                  {paused
                    ? "Paused. Guests are told you're not taking orders right now."
                    : "Slammed? Pause it. Yours to switch back on — we never do it for you."}
                </Text>
              </View>
              <BrandSwitch
                value={paused}
                onValueChange={(next) => setPaused.mutate(next)}
                disabled={!canDecideMoney || setPaused.isPending}
                accessibilityLabel="Pause new orders"
                testID="venue-orders-pause-switch"
              />
            </View>
          ) : null}
          {!canDecideMoney ? (
            <Text style={styles.switchNote}>
              A manager or the owner controls these.
            </Text>
          ) : null}
        </GlassCard>
      ) : null}

      {/* ---- Segmented views (inside the module — not a 3rd nav level). ---- */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.segRow}
        accessibilityRole="tablist"
      >
        {VENUE_ORDER_VIEWS.map((v) => {
          const active = v.id === view;
          const count = filterVenueOrdersForView(scoped, v.id).length;
          return (
            <Pressable
              key={v.id}
              onPress={() => setView(v.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${v.label} orders, ${count}`}
              style={[styles.seg, active ? styles.segActive : null]}
              testID={`venue-orders-view-${v.id}`}
            >
              <Text
                style={[styles.segLabel, active ? styles.segLabelActive : null]}
              >
                {count > 0 ? `${v.label} · ${count}` : v.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* ---- D-3b: the brand queue's two filters. ---- */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.segRow}
        accessibilityRole="tablist"
      >
        <Pressable
          onPress={() => {
            setVenueFilter(null);
            setZoneFilter(null);
          }}
          accessibilityRole="tab"
          accessibilityState={{ selected: venueFilter === null }}
          accessibilityLabel="All venues"
          style={[styles.chip, venueFilter === null ? styles.chipActive : null]}
          testID="venue-orders-filter-venue-all"
        >
          <Text style={styles.chipLabel}>All venues</Text>
        </Pressable>
        {(venuesQuery.data ?? []).map((v) => (
          <Pressable
            key={v.id}
            onPress={() => {
              setVenueFilter(v.id);
              setZoneFilter(null);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: venueFilter === v.id }}
            accessibilityLabel={`${v.name} orders`}
            style={[styles.chip, venueFilter === v.id ? styles.chipActive : null]}
            testID={`venue-orders-filter-venue-${v.id}`}
          >
            <Text style={styles.chipLabel}>{v.name}</Text>
          </Pressable>
        ))}
        {zones.map((zone) => (
          <Pressable
            key={zone}
            onPress={() => setZoneFilter(zoneFilter === zone ? null : zone)}
            accessibilityRole="tab"
            accessibilityState={{ selected: zoneFilter === zone }}
            accessibilityLabel={`${zone} zone`}
            style={[styles.chip, zoneFilter === zone ? styles.chipActive : null]}
            testID={`venue-orders-filter-zone-${zone}`}
          >
            <Text style={styles.chipLabel}>{zone}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {ordersQuery.isLoading ? (
        <Text style={styles.helper}>Loading orders…</Text>
      ) : visible.length === 0 ? (
        <View style={styles.emptyWrap} testID="venue-orders-empty-wrap">
          <GlassCard variant="elevated" style={styles.emptyCard}>
            <ClipboardList size={26} color={textTokens.primary} />
            <Text style={styles.emptyTitle}>{VIEW_EMPTY[view]}</Text>
            {view === "new" && !orderingEnabled && venueId !== null ? (
              <Text style={styles.emptyBody}>
                Ordering is off for this venue. Switch it on above and your
                tickets land here the moment a guest pays.
              </Text>
            ) : null}
          </GlassCard>
        </View>
      ) : (
        <View style={styles.list}>
          {visible.map((order) => (
            <VenueOrderCard
              key={order.id}
              order={order}
              venueName={
                venueFilter === null
                  ? (venueNameById.get(order.venueId) ?? null)
                  : null
              }
              onPress={setSelected}
            />
          ))}
        </View>
      )}

      {ordersQuery.isError ? (
        // A busy-service error is LOUD, and it says what to do. The
        // Reservations module's one-line "Pull to refresh" is not an error
        // pattern for a surface holding somebody's money.
        <GlassCard variant="elevated" style={styles.errorCard}>
          <Text style={styles.errorTitle}>We can&apos;t reach your orders.</Text>
          <Text style={styles.errorBody}>
            New tickets may not be showing. Check your connection — we&apos;re
            retrying every 30 seconds.
          </Text>
          <Button
            label="Try now"
            onPress={() => void ordersQuery.refetch()}
            variant="secondary"
            size="md"
            testID="venue-orders-retry"
          />
        </GlassCard>
      ) : null}

      {transition.isError || refundDecision.isError ? (
        <Text style={styles.errorNote} testID="venue-orders-mutation-error">
          That didn&apos;t go through. Nothing changed — try it again.
        </Text>
      ) : null}

      <VenueOrderDetailSheet
        visible={selected !== null && canWorkQueue}
        onClose={() => setSelected(null)}
        order={selected}
        venueName={
          selected !== null
            ? (venueNameById.get(selected.venueId) ?? null)
            : null
        }
        onAction={handleAction}
        onRefundDecision={handleRefundDecision}
        acting={transition.isPending || refundDecision.isPending}
        canDecideMoney={canDecideMoney}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: spacing.xxs,
  },
  title: {
    ...typography.h3,
    color: textTokens.primary,
  },
  subtitle: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  switchCard: {
    width: "100%",
    alignSelf: "stretch",
    gap: spacing.sm,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  switchText: {
    flex: 1,
    gap: spacing.xxs,
  },
  switchTitle: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "700",
  },
  switchBody: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  switchNote: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  segRow: {
    flexDirection: "row",
    gap: spacing.xs,
    paddingVertical: spacing.xxs,
  },
  seg: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  segActive: {
    backgroundColor: accent.warm,
  },
  segLabel: {
    ...typography.bodySm,
    color: textTokens.secondary,
    fontWeight: "600",
  },
  segLabelActive: {
    color: "#0c0e12",
  },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  chipActive: {
    borderColor: accent.warm,
    backgroundColor: "rgba(235, 120, 37, 0.16)",
  },
  chipLabel: {
    ...typography.caption,
    color: textTokens.secondary,
    fontWeight: "600",
  },
  helper: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  emptyWrap: {
    width: "100%",
    alignSelf: "stretch",
  },
  emptyCard: {
    width: "100%",
    alignSelf: "stretch",
    alignItems: "center",
    gap: spacing.sm,
  },
  emptyTitle: {
    ...typography.h3,
    color: textTokens.primary,
    textAlign: "center",
  },
  emptyBody: {
    ...typography.body,
    color: textTokens.secondary,
    textAlign: "center",
  },
  list: {
    gap: spacing.sm,
  },
  errorCard: {
    width: "100%",
    alignSelf: "stretch",
    gap: spacing.xs,
  },
  errorTitle: {
    ...typography.body,
    color: semantic.error,
    fontWeight: "700",
  },
  errorBody: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  errorNote: {
    ...typography.bodySm,
    color: semantic.error,
  },
});

export default VenueOrdersModule;
