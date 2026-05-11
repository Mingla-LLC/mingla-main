import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

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
import {
  issueOrderRefund,
  type RefundOrderInput,
  type RefundOrderResult,
} from "../services/orderRefundService";
import {
  cancelFreeOrder,
  type CancelOrderInput,
  type CancelOrderResult,
} from "../services/orderCancelService";
import type { TicketStub } from "../store/draftEventStore";
import type { OrderRecord } from "../store/orderStore";
import {
  buildEventSalesSummary,
  type EventSalesSummary,
} from "../utils/eventSalesSummary";

export const eventOrdersKeys = {
  all: ["event-orders"] as const,
  detail: (eventId: string): readonly ["event-orders", string] =>
    [...eventOrdersKeys.all, eventId] as const,
  order: (eventId: string, orderId: string): readonly ["event-orders", string, "order", string] =>
    [...eventOrdersKeys.all, eventId, "order", orderId] as const,
  soldCounts: (eventIds: string[]): readonly ["event-orders", "sold-counts", string] =>
    [...eventOrdersKeys.all, "sold-counts", eventIds.slice().sort().join("|")] as const,
  salesSummary: (
    eventId: string,
    currency: string,
    ticketSignature: string,
  ): readonly ["event-orders", string, "sales-summary", string, string] =>
    [...eventOrdersKeys.all, eventId, "sales-summary", currency, ticketSignature] as const,
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

export interface EventSalesSummarySource {
  id: string;
  tickets: TicketStub[];
  currency?: string | null;
}

const ticketCapacitySignature = (tickets: TicketStub[]): string =>
  tickets
    .map((ticket) =>
      [
        ticket.id,
        ticket.isUnlimited ? "unlimited" : "finite",
        ticket.capacity ?? "null",
      ].join(":"),
    )
    .sort()
    .join("|");

export const useEventSalesSummaries = (
  events: EventSalesSummarySource[],
  brandDefaultCurrency?: string | null,
): Record<string, EventSalesSummary> => {
  const { loading, session } = useAuth();
  const queries = useQueries({
    queries: events.map((event) => ({
      queryKey: eventOrdersKeys.salesSummary(
        event.id,
        event.currency ?? brandDefaultCurrency ?? "GBP",
        ticketCapacitySignature(event.tickets),
      ),
      enabled: !loading && session !== null,
      staleTime: 15 * 1000,
      queryFn: () => fetchEventOrders(event.id),
    })),
  });

  return events.reduce<Record<string, EventSalesSummary>>((acc, event, index) => {
    const query = queries[index];
    acc[event.id] = buildEventSalesSummary({
      eventId: event.id,
      tickets: event.tickets,
      eventCurrency: event.currency,
      brandDefaultCurrency,
      orders: query?.data ?? [],
      hasError: query?.isError ?? false,
    });
    return acc;
  }, {});
};

export const useEventHasWebPurchases = (eventId: string | null): boolean => {
  const ordersQuery = useEventOrders(eventId);
  return getEventHasWebPurchases(ordersQuery.data ?? []);
};

// ============================================================
// ORCH-0787: Refund + Cancel mutations
// ============================================================

/**
 * useRefundOrder — issues an organiser-initiated refund via the refund-order edge function.
 *
 * Invalidates all `event-orders` queries scoped to the order's event so the list, detail,
 * sold-count rollups, and sales summaries all refresh after a successful refund.
 *
 * Errors surface as typed RefundOrderError objects with `.code` and `.detail`. The caller
 * (RefundSheet) is responsible for showing a user-facing toast via the message map.
 */
export const useRefundOrder = (
  eventId: string | null,
): UseMutationResult<RefundOrderResult, Error, RefundOrderInput> => {
  const queryClient = useQueryClient();
  return useMutation<RefundOrderResult, Error, RefundOrderInput>({
    mutationFn: (input) => issueOrderRefund(input),
    onSuccess: () => {
      if (eventId !== null) {
        // Invalidate every event-orders query scoped to this event (detail, order,
        // sold-counts, sales-summary). Predicate match covers all factory variants.
        queryClient.invalidateQueries({
          predicate: (query) =>
            query.queryKey[0] === "event-orders" &&
            query.queryKey[1] === eventId,
        });
      } else {
        queryClient.invalidateQueries({ queryKey: eventOrdersKeys.all });
      }
    },
  });
};

/**
 * useCancelOrder — cancels a FREE order via the cancel-order edge function.
 *
 * Q-1 (operator-locked): paid orders cannot be cancelled — they must be refunded. The
 * underlying RPC rejects paid orders with `paid_orders_must_be_refunded_not_cancelled`.
 */
export const useCancelOrder = (
  eventId: string | null,
): UseMutationResult<CancelOrderResult, Error, CancelOrderInput> => {
  const queryClient = useQueryClient();
  return useMutation<CancelOrderResult, Error, CancelOrderInput>({
    mutationFn: (input) => cancelFreeOrder(input),
    onSuccess: () => {
      if (eventId !== null) {
        queryClient.invalidateQueries({
          predicate: (query) =>
            query.queryKey[0] === "event-orders" &&
            query.queryKey[1] === eventId,
        });
      } else {
        queryClient.invalidateQueries({ queryKey: eventOrdersKeys.all });
      }
    },
  });
};

export { getEventOrderRevenue, getEventSoldCounts, getEventHasWebPurchases };
