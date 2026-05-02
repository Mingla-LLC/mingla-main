/**
 * /event/[id]/orders — J-M1 Orders list (Cycle 9c).
 *
 * Founder ledger of every order for the event. Filter pills (All / Paid /
 * Refunded / Cancelled), search bar (buyer name + order ID substring),
 * EmptyState when zero, OrderListCard rows newest-first.
 *
 * Per Cycle 9c spec §3.4.1.
 */

import React, { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  canvas,
  glass,
  spacing,
  text as textTokens,
} from "../../../../src/constants/designSystem";
import {
  useOrderStore,
  type OrderRecord,
} from "../../../../src/store/orderStore";
import { useLiveEventStore } from "../../../../src/store/liveEventStore";

import { EmptyState } from "../../../../src/components/ui/EmptyState";
import { IconChrome } from "../../../../src/components/ui/IconChrome";
import { Input } from "../../../../src/components/ui/Input";
import { OrderListCard } from "../../../../src/components/orders/OrderListCard";

type FilterKey = "all" | "paid" | "refunded" | "cancelled";

const FILTERS: ReadonlyArray<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "paid", label: "Paid" },
  { key: "refunded", label: "Refunded" },
  { key: "cancelled", label: "Cancelled" },
];

const matchesFilter = (
  order: OrderRecord,
  filter: FilterKey,
): boolean => {
  if (filter === "all") return true;
  if (filter === "paid") return order.status === "paid";
  if (filter === "refunded") {
    return (
      order.status === "refunded_full" || order.status === "refunded_partial"
    );
  }
  if (filter === "cancelled") return order.status === "cancelled";
  return false;
};

const matchesSearch = (order: OrderRecord, query: string): boolean => {
  if (query.trim().length === 0) return true;
  const lower = query.trim().toLowerCase();
  return (
    order.buyer.name.toLowerCase().includes(lower) ||
    order.id.toLowerCase().includes(lower)
  );
};

const countForFilter = (
  orders: OrderRecord[],
  filter: FilterKey,
): number => {
  if (filter === "all") return orders.length;
  return orders.filter((o) => matchesFilter(o, filter)).length;
};

export default function EventOrdersListRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;

  const event = useLiveEventStore((s) =>
    typeof eventId === "string" ? s.events.find((e) => e.id === eventId) ?? null : null,
  );
  // Cycle 9c rework v2 — select raw entries + filter in useMemo so the
  // selector returns a stable reference. getOrdersForEvent returns a fresh
  // filtered array each call which breaks useSyncExternalStore Object.is
  // and infinite-loops the render. Same pattern as useLiveEventBySlug.
  const allOrderEntries = useOrderStore((s) => s.entries);
  const orders = useMemo<OrderRecord[]>(
    () =>
      typeof eventId === "string"
        ? allOrderEntries.filter((o) => o.eventId === eventId)
        : [],
    [allOrderEntries, eventId],
  );

  const [filter, setFilter] = useState<FilterKey>("all");
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [search, setSearch] = useState<string>("");

  const filtered = useMemo<OrderRecord[]>(() => {
    return orders
      .filter((o) => matchesFilter(o, filter))
      .filter((o) => matchesSearch(o, search))
      .sort((a, b) => {
        // Newest first by paidAt
        return new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime();
      });
  }, [orders, filter, search]);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (typeof eventId === "string") {
      router.replace(`/event/${eventId}` as never);
    }
  }, [router, eventId]);

  const handleOpenOrder = useCallback(
    (orderId: string): void => {
      if (typeof eventId !== "string") return;
      router.push(`/event/${eventId}/orders/${orderId}` as never);
    },
    [router, eventId],
  );

  const totalCount = orders.length;

  if (event === null || typeof eventId !== "string") {
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
          <Text style={styles.chromeTitle}>Orders</Text>
          <View style={styles.chromeRightSlot} />
        </View>
        <View style={styles.emptyHost}>
          <EmptyState
            illustration="ticket"
            title="Event not found"
            description="It may have been deleted."
          />
        </View>
      </View>
    );
  }

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
        <Text style={styles.chromeTitle}>Orders</Text>
        <View style={styles.chromeRight}>
          <IconChrome
            icon="search"
            size={36}
            onPress={() => setSearchOpen((v) => !v)}
            accessibilityLabel="Search orders"
          />
        </View>
      </View>

      {/* Search bar (collapsible) */}
      {searchOpen ? (
        <View style={styles.searchWrap}>
          <Input
            value={search}
            onChangeText={setSearch}
            placeholder="Buyer name or order ID"
            variant="text"
          />
        </View>
      ) : null}

      {/* Filter pills */}
      <ScrollView
        horizontal
        style={styles.filtersScroll}
        contentContainerStyle={styles.filtersContent}
        showsHorizontalScrollIndicator={false}
      >
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const count = countForFilter(orders, f.key);
          return (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${f.label} filter, ${count} orders`}
              style={[
                styles.filterPill,
                active ? styles.filterPillActive : styles.filterPillInactive,
              ]}
            >
              <Text
                style={[
                  styles.filterPillLabel,
                  active && styles.filterPillLabelActive,
                ]}
              >
                {f.label}
                {count > 0 ? ` · ${count}` : ""}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Orders list */}
      <ScrollView
        style={styles.listScroll}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + 120 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {totalCount === 0 ? (
          <View style={styles.emptyHost}>
            <EmptyState
              illustration="ticket"
              title="No orders yet"
              description="Once buyers start checking out, their orders appear here."
              cta={{
                label: "Share event link",
                onPress: () => {
                  router.push(
                    `/e/${event.brandSlug}/${event.eventSlug}` as never,
                  );
                },
                variant: "primary",
              }}
            />
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.emptyHost}>
            <EmptyState
              illustration="search"
              title="No matches"
              description={
                search.trim().length > 0
                  ? `No orders match "${search.trim()}".`
                  : `No ${filter} orders for this event.`
              }
            />
          </View>
        ) : (
          <View style={styles.list}>
            {filtered.map((order) => (
              <OrderListCard
                key={order.id}
                order={order}
                onPress={() => handleOpenOrder(order.id)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

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
  chromeRight: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  chromeRightSlot: {
    width: 36,
  },
  searchWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  filtersScroll: {
    flexGrow: 0,
  },
  filtersContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs + 2,
  },
  filterPill: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  filterPillActive: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  filterPillInactive: {
    backgroundColor: glass.tint.profileBase,
    borderColor: glass.border.profileBase,
  },
  filterPillLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: textTokens.primary,
  },
  filterPillLabelActive: {
    fontWeight: "600",
  },
  listScroll: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  list: {
    gap: spacing.sm,
  },
  emptyHost: {
    paddingTop: spacing.xl,
  },
});

