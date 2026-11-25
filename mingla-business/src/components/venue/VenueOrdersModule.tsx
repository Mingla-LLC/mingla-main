/**
 * Issue #1791 (#1767 Phase 3) — the ORDERS module. The venue hub's live
 * service surface, and the gate Phase 4 cannot open without.
 *
 * THE SHAPE, and why (DESIGN D-3b, D-7; SPEC #1788 P-53, P-55, P-16):
 *
 *  * ONE QUEUE PER VENUE, optionally filterable by local zone. A room-service
 *    destination may belong to another property when this venue is its serving
 *    kitchen, but the order owner and every queue action stay route-venue local.
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
 *
 * Issue #1792 (#1767 Phase 3b) adds WAITER MODE to this same module rather than
 * a module of its own, and that is a product decision, not a shortcut. A waiter
 * taking an order and a waiter watching the queue are the same person at the
 * same moment of the same service; a second tab to switch to is a second thing
 * to miss. So: "New order" sits in this header, open tabs sit above the queue,
 * and the ticket a waiter sends lands in the list right beneath — on the same
 * card, in the same view, indistinguishable from a scanned one (D-11).
 *
 * Opening a tab and closing one are event_manager+ — a tab is the venue
 * extending credit. Taking an order is not, so `New order` is open to any brand
 * member, exactly like the ack.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ClipboardList } from "lucide-react-native";
import { router } from "expo-router";

import {
  radius,
  color,
  space,
  type,
} from "../../constants/designSystem";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import { useQrSpotVenues, useQrSpots } from "../../hooks/useQrSpots";
import {
  useDecideVenueOrderRefund,
  useTransitionVenueOrder,
  useVenueOrders,
} from "../../hooks/useVenueOrders";
import { useVenueListing } from "../../hooks/useVenueListings";
import { useVenueTabs } from "../../hooks/useVenueOrderTabs";
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
import { VenueOrderPadSheet } from "./orderPad/VenueOrderPadSheet";
import { VenueTabsCard } from "./orderPad/VenueTabsCard";
import {
  orderingSwitchErrorCopy,
  orderingSwitchState,
} from "./venueOrderingSwitch";
import type { OrderPadTab } from "./orderPad/venueOrderPad";
import { tillHref } from "./till/tillRoute";
import { stationHref } from "./station/stationRoute";
import { STATION_COPY } from "./station/stationCopy";
import { useStationsEntry } from "../../hooks/useStationsEntry";
import type { VenueOrderEntry } from "./venueModules";
import {
  VENUE_ORDER_VIEWS,
  availableZones,
  filterVenueOrdersForVenue,
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
  /** The venue this module was opened from — its immutable operational scope. */
  venueId?: string | null;
  /**
   * #4490 spec 08 O1 — the shells' one switch (`venueOrderEntry`): "pad"
   * (default; the Till is not running here) keeps the order pad and tabs card
   * exactly as before; "till" sends New order and open tabs to the Till;
   * "none" (the Till runs here, this person may not sell) offers neither.
   */
  orderEntry?: VenueOrderEntry;
  testID?: string;
}

export function VenueOrdersModule({
  brandId,
  venueId = null,
  orderEntry = "pad",
  testID,
}: VenueOrdersModuleProps): React.ReactElement {
  const usesPad = orderEntry === "pad";
  const { rank } = useCurrentBrandRole(brandId);
  // OQ-4: acknowledging is not a money act, so ANY active member may do it.
  const canWorkQueue = rank > 0;
  const canDecideMoney = rank >= MANAGER_PLUS_RANK;
  const scopedBrandId = venueId === null ? null : brandId;

  const ordersQuery = useVenueOrders(scopedBrandId, venueId);
  const venuesQuery = useQrSpotVenues(scopedBrandId);
  // Issue #1792 — the SAME `qr_spots` rows the printed codes come from. There is
  // no second table list for waiters, which is what makes a laminate and a pad
  // structurally unable to disagree about which one is table 12.
  const spotsQuery = useQrSpots(scopedBrandId, venueId);
  // [TRANSITIONAL] legacy tabs read only while the pad is in use; exits when every venue runs the Till.
  const tabsQuery = useVenueTabs(usesPad ? scopedBrandId : null, usesPad ? venueId : null);
  const settingsQuery = useVenueOrderingSettings(venueId);
  const transition = useTransitionVenueOrder(scopedBrandId);
  const refundDecision = useDecideVenueOrderRefund(scopedBrandId);
  const setPaused = useSetVenueOrderingPaused(venueId);
  const stationsEntry = useStationsEntry(scopedBrandId, venueId);
  const setEnabled = useSetVenueOrderingEnabled(venueId);
  // #3388 — ordering can only be switched on for a live (verified) venue.
  const venueQuery = useVenueListing(venueId);
  const [orderingError, setOrderingError] = useState<string | null>(null);

  const [view, setView] = useState<VenueOrderView>("new");
  const [zoneFilter, setZoneFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<VenueOrder | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  // Issue #1792 — the pad. `resumeTab` non-null means "another round on this
  // tab", which skips the spot step and reuses the sitting.
  const [padOpen, setPadOpen] = useState(false);
  const [resumeTab, setResumeTab] = useState<OrderPadTab | null>(null);
  // Billing a whole tab also opens the pad — the three contact fields belong
  // inside a keyboard-aware scroll, and this module renders inside the hub's
  // plain one.
  const [billTab, setBillTab] = useState<OrderPadTab | null>(null);

  const allOrders = useMemo(() => ordersQuery.data ?? [], [ordersQuery.data]);
  const scoped = useMemo(
    () => filterVenueOrdersForVenue(allOrders, venueId, zoneFilter),
    [allOrders, venueId, zoneFilter],
  );
  const zones = useMemo(
    () => availableZones(filterVenueOrdersForVenue(allOrders, venueId, null)),
    [allOrders, venueId],
  );
  const visible = useMemo(
    () => sortForQueue(filterVenueOrdersForView(scoped, view)),
    [scoped, view],
  );
  const live = liveOrderCount(scoped);

  useEffect(() => {
    if (zoneFilter !== null && !zones.includes(zoneFilter)) {
      setZoneFilter(null);
    }
  }, [zoneFilter, zones]);

  useEffect(() => {
    if (selected !== null && selected.venueId !== venueId) {
      setSelected(null);
    }
  }, [selected, venueId]);

  const handleAction = useCallback(
    (order: VenueOrder, action: VenueOrderAction): void => {
      if (venueId === null || order.venueId !== venueId) {
        setSelected(null);
        setScopeError("That order belongs to another venue, so nothing changed.");
        return;
      }
      setScopeError(null);
      transition.mutate(
        { orderId: order.id, action },
        { onSuccess: () => setSelected(null) },
      );
    },
    [transition, venueId],
  );

  const handleRefundDecision = useCallback(
    (
      order: VenueOrder,
      decision: "approved" | "declined",
      note: string | null,
    ): void => {
      if (venueId === null || order.venueId !== venueId) {
        setSelected(null);
        setScopeError("That order belongs to another venue, so nothing changed.");
        return;
      }
      setScopeError(null);
      refundDecision.mutate(
        { orderId: order.id, decision, note },
        { onSuccess: () => setSelected(null) },
      );
    },
    [refundDecision, venueId],
  );

  const settings = settingsQuery.data ?? null;
  const orderingEnabled = settings?.orderingEnabled === true;
  const paused = settings?.paused === true;
  const orderingSwitch = orderingSwitchState({
    claimStatus: venueQuery.data?.claimStatus,
    orderingEnabled,
    canDecideMoney,
    pending: setEnabled.isPending,
  });
  const handleOrderingSwitch = (next: boolean): void => {
    setOrderingError(null);
    setEnabled.mutate(next, {
      onError: (error) => {
        void orderingSwitchErrorCopy(error).then(setOrderingError);
      },
    });
  };

  return (
    <View style={styles.host} testID={testID ?? "venue-orders-module"}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Orders</Text>
          <Text style={styles.subtitle}>
            {live === 0
              ? "Every order at this venue, live."
              : `${live} order${live === 1 ? "" : "s"} on the go.`}
          </Text>
        </View>
        {/* D-11 — waiter mode. Taking an order is not a money act, so the floor
            here is the ack's floor: any active brand member. */}
        {canWorkQueue && venueId !== null && usesPad ? (
          <Button
            label="New order"
            onPress={() => {
              setResumeTab(null);
              setBillTab(null);
              setPadOpen(true);
            }}
            variant="primary"
            size="md"
            testID="venue-orders-new-order"
          />
        ) : null}
        {/* #4490 spec 08 O1 — with the Till running here, New order opens it. */}
        {venueId !== null && orderEntry === "till" ? (
          <Button
            label="New order"
            onPress={() => router.push(tillHref(venueId) as never)}
            variant="primary"
            size="md"
            leadingIcon="cash"
            testID="venue-orders-new-order-till"
          />
        ) : null}
      </View>

      {/* #4490 spec 08 O3 — the kitchen and bar screens for this venue. */}
      {venueId !== null && stationsEntry ? (
        <Button
          label={STATION_COPY.openStations}
          onPress={() => router.push(stationHref(venueId) as never)}
          variant="secondary"
          size="md"
          leadingIcon="list"
          testID="venue-orders-open-stations"
        />
      ) : null}

      {/* #4490 spec 08 O1 — open tabs live in the Till's Open checks. */}
      {venueId !== null && orderEntry === "till" ? (
        <Button
          label="Open checks"
          onPress={() => router.push(`${tillHref(venueId)}?checks=1` as never)}
          variant="secondary"
          size="md"
          testID="venue-orders-open-checks-till"
        />
      ) : null}

      {/* D-2 AMENDED — tabs a waiter opened and is still serving.
          [TRANSITIONAL] the legacy tabs card, pad venues only; exits when every venue runs the Till. */}
      {usesPad ? (
      <VenueTabsCard
        brandId={scopedBrandId}
        venueId={venueId}
        tabs={tabsQuery.data ?? []}
        canCloseTabs={canDecideMoney}
        onAddRound={(tab) => {
          if (tab.venueId !== venueId) {
            setScopeError("That tab belongs to another venue, so nothing changed.");
            return;
          }
          setScopeError(null);
          setBillTab(null);
          setResumeTab(tab);
          setPadOpen(true);
        }}
        onBillTab={(tab) => {
          if (tab.venueId !== venueId) {
            setScopeError("That tab belongs to another venue, so nothing changed.");
            return;
          }
          setScopeError(null);
          setResumeTab(null);
          setBillTab(tab);
          setPadOpen(true);
        }}
      />
      ) : null}

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
              onValueChange={handleOrderingSwitch}
              disabled={orderingSwitch.disabled}
              accessibilityLabel="Take orders through Mingla"
              testID="venue-orders-enable-switch"
            />
          </View>
          {orderingSwitch.note !== null ? (
            <Text
              style={styles.switchNote}
              testID="venue-orders-enable-not-live"
            >
              {orderingSwitch.note}
            </Text>
          ) : null}
          {orderingError !== null ? (
            <Text
              style={styles.switchError}
              accessibilityRole="alert"
              testID="venue-orders-enable-error"
            >
              {orderingError}
            </Text>
          ) : null}
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

      {/* Issue #1943 — the only optional filter is local area. */}
      {zones.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.segRow}
          accessibilityRole="tablist"
        >
          <Pressable
            onPress={() => setZoneFilter(null)}
            accessibilityRole="tab"
            accessibilityState={{ selected: zoneFilter === null }}
            accessibilityLabel="All areas"
            style={[styles.chip, zoneFilter === null ? styles.chipActive : null]}
            testID="venue-orders-filter-area-all"
          >
            <Text style={styles.chipLabel}>All areas</Text>
          </Pressable>
          {zones.map((zone) => (
            <Pressable
              key={zone}
              onPress={() => setZoneFilter(zoneFilter === zone ? null : zone)}
              accessibilityRole="tab"
              accessibilityState={{ selected: zoneFilter === zone }}
              accessibilityLabel={`${zone} area`}
              style={[styles.chip, zoneFilter === zone ? styles.chipActive : null]}
              testID={`venue-orders-filter-zone-${zone}`}
            >
              <Text style={styles.chipLabel}>{zone}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {ordersQuery.isLoading ? (
        <Text style={styles.helper}>Loading orders…</Text>
      ) : visible.length === 0 ? (
        <View style={styles.emptyWrap} testID="venue-orders-empty-wrap">
          <GlassCard variant="elevated" style={styles.emptyCard}>
            <ClipboardList size={26} color={color.text1} />
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
              venueName={null}
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

      {scopeError !== null ? (
        <Text style={styles.errorNote} testID="venue-orders-scope-error">
          {scopeError}
        </Text>
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
        venueName={null}
        onAction={handleAction}
        onRefundDecision={handleRefundDecision}
        acting={transition.isPending || refundDecision.isPending}
        canDecideMoney={canDecideMoney}
      />

      {/* Issue #1792 — the order pad. Keyed on the tab it is resuming so the
          sheet remounts clean between "new order" and "another round on 12"
          rather than carrying the previous cart across. */}
      {/* [TRANSITIONAL] the legacy order pad, pad venues only; exits when every venue runs the Till. */}
      {usesPad ? (
      <VenueOrderPadSheet
        key={`${resumeTab?.sessionId ?? "new"}:${billTab?.sessionId ?? ""}`}
        visible={padOpen && canWorkQueue}
        onClose={() => {
          setPadOpen(false);
          setResumeTab(null);
          setBillTab(null);
        }}
        brandId={scopedBrandId}
        venueId={venueId}
        spots={spotsQuery.data ?? []}
        venues={venuesQuery.data ?? []}
        resumeTab={resumeTab}
        billTab={billTab}
        canOpenTabs={canDecideMoney}
      />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    paddingHorizontal: space[4],
    paddingTop: space[4],
    gap: space[4],
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space[4],
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...type.h1,
    color: color.text1,
  },
  subtitle: {
    ...type.small,
    color: color.text2,
  },
  switchCard: {
    width: "100%",
    alignSelf: "stretch",
    gap: space[2],
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[4],
  },
  switchText: {
    flex: 1,
    gap: 2,
  },
  switchTitle: {
    ...type.body,
    color: color.text1,
    fontWeight: "700",
  },
  switchBody: {
    ...type.small,
    color: color.text2,
  },
  switchNote: {
    ...type.caption,
    color: color.text3,
  },
  // #3388 — a refused ordering switch says why.
  switchError: {
    ...type.caption,
    color: color.danger,
  },
  segRow: {
    flexDirection: "row",
    gap: space[1],
    paddingVertical: 2,
  },
  seg: {
    paddingHorizontal: space[4],
    paddingVertical: space[1],
    borderRadius: radius.full,
    backgroundColor: color.fill.inset,
  },
  segActive: {
    backgroundColor: color.accent,
  },
  segLabel: {
    ...type.small,
    color: color.text2,
    fontWeight: "600",
  },
  segLabelActive: {
    color: color.ink,
  },
  chip: {
    paddingHorizontal: space[2],
    paddingVertical: 2,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.lineStrong,
  },
  chipActive: {
    borderColor: color.accent,
    backgroundColor: color.accentTint,
  },
  chipLabel: {
    ...type.caption,
    color: color.text2,
    fontWeight: "600",
  },
  helper: {
    ...type.small,
    color: color.text2,
  },
  emptyWrap: {
    width: "100%",
    alignSelf: "stretch",
  },
  emptyCard: {
    width: "100%",
    alignSelf: "stretch",
    alignItems: "center",
    gap: space[2],
  },
  emptyTitle: {
    ...type.h1,
    color: color.text1,
    textAlign: "center",
  },
  emptyBody: {
    ...type.body,
    color: color.text2,
    textAlign: "center",
  },
  list: {
    gap: space[2],
  },
  errorCard: {
    width: "100%",
    alignSelf: "stretch",
    gap: space[1],
  },
  errorTitle: {
    ...type.body,
    color: color.danger,
    fontWeight: "700",
  },
  errorBody: {
    ...type.small,
    color: color.text2,
  },
  errorNote: {
    ...type.small,
    color: color.danger,
  },
});

export default VenueOrdersModule;
