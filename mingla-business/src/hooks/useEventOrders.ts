import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  fetchEventOrders,
  getEventGuestById,
  getEventGuestList,
  getEventHasWebPurchases,
  getEventOrderActivity,
  getEventOrderById,
  getEventOrderRevenue,
  getEventSoldCounts,
  type EventOrderActivity,
  type EventOrderRevenue,
} from "../services/eventOrdersService";
import type { OrderRecord } from "../store/orderStore";

export const eventOrdersKeys = {
  all: ["event-orders"] as const,
  detail: (eventId: string): readonly ["event-orders", string] =>
    [...eventOrdersKeys.all, eventId] as const,
  order: (eventId: string, orderId: string): readonly ["event-orders", string, "order", string] =>
    [...eventOrdersKeys.all, eventId, "order", orderId] as const,
  soldCounts: (eventIds: string[]): readonly ["event-orders", "sold-counts", string] =>
    [...eventOrdersKeys.all, "sold-counts", eventIds.slice().sort().join("|")] as const,
};

const DISABLED_KEY = ["event-orders-disabled"] as const;

export const useEventOrders = (
  eventId: string | null,
): UseQueryResult<OrderRecord[]> => {
  const { loading, session } = useAuth();
  const enabled = !loading && session !== null && eventId !== null;
  return useQuery<OrderRecord[]>({
    queryKey: enabled && eventId !== null ? eventOrdersKeys.detail(eventId) : DISABLED_KEY,
    enabled,
    staleTime: 15 * 1000,
    queryFn: async () => {
      if (eventId === null) throw new Error("eventId missing");
      return fetchEventOrders(eventId);
    },
  });
};

export const useEventOrderById = (
  eventId: string | null,
  orderId: string | null,
): UseQueryResult<OrderRecord | null> => {
  const { loading, session } = useAuth();
  const enabled = !loading && session !== null && eventId !== null && orderId !== null;
  return useQuery<OrderRecord | null>({
    queryKey:
      enabled && eventId !== null && orderId !== null
        ? eventOrdersKeys.order(eventId, orderId)
        : [...DISABLED_KEY, "order"],
    enabled,
    staleTime: 15 * 1000,
    queryFn: async () => {
      if (eventId === null || orderId === null) throw new Error("order route missing");
      return getEventOrderById(await fetchEventOrders(eventId), orderId);
    },
  });
};

export const useEventOrderRevenue = (
  eventId: string | null,
  currency = "GBP",
): EventOrderRevenue => {
  const ordersQuery = useEventOrders(eventId);
  return getEventOrderRevenue(ordersQuery.data ?? [], currency);
};

export const useEventOrderActivity = (
  eventId: string | null,
  sinceTs?: number,
): EventOrderActivity[] => {
  const ordersQuery = useEventOrders(eventId);
  return getEventOrderActivity(ordersQuery.data ?? [], sinceTs);
};

export const useEventGuestList = (eventId: string | null): OrderRecord[] => {
  const ordersQuery = useEventOrders(eventId);
  return getEventGuestList(ordersQuery.data ?? []);
};

export const useEventGuestById = (
  eventId: string | null,
  guestId: string | null,
): OrderRecord | null => {
  const ordersQuery = useEventOrders(eventId);
  if (guestId === null) return null;
  return getEventGuestById(ordersQuery.data ?? [], guestId);
};

export const useEventReconciliation = (eventId: string | null): OrderRecord[] => {
  const ordersQuery = useEventOrders(eventId);
  return ordersQuery.data ?? [];
};

export const useEventSoldCounts = (
  eventIds: string[],
): Record<string, { soldCount: number; revenue: number }> => {
  const { loading, session } = useAuth();
  const queries = useQueries({
    queries: eventIds.map((eventId) => ({
      queryKey: eventOrdersKeys.detail(eventId),
      enabled: !loading && session !== null,
      staleTime: 15 * 1000,
      queryFn: () => fetchEventOrders(eventId),
    })),
  });
  return queries.reduce<Record<string, { soldCount: number; revenue: number }>>(
    (acc, query, index) => {
      const orders = query.data ?? [];
      const revenue = getEventOrderRevenue(orders);
      acc[eventIds[index]] = {
        soldCount: revenue.soldCount,
        revenue: revenue.revenue,
      };
      return acc;
    },
    {},
  );
};

export const useEventHasWebPurchases = (eventId: string | null): boolean => {
  const ordersQuery = useEventOrders(eventId);
  return getEventHasWebPurchases(ordersQuery.data ?? []);
};

export { getEventOrderRevenue, getEventSoldCounts, getEventHasWebPurchases };
