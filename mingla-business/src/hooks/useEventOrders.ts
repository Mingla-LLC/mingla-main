import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  fetchEventOrders,
  getEventGuestById,
  getEventGuestList,
  getEventHasWebPurchases,
  getEventOrderById,
  getEventOrderRevenue,
  getEventSoldCounts,
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
  type EventOrdersReadStatus,
} from "../utils/eventSalesSummary";
import { currencyCodeOrNull } from "../utils/currency";

export const eventOrdersKeys = {
  all: ["event-orders"] as const,
  detail: (eventId: string): readonly ["event-orders", string] =>
    [...eventOrdersKeys.all, eventId] as const,
  order: (eventId: string, orderId: string): readonly ["event-orders", string, "order", string] =>
    [...eventOrdersKeys.all, eventId, "order", orderId] as const,
  soldCounts: (eventIds: string[]): readonly ["event-orders", "sold-counts", string] =>
    [...eventOrdersKeys.all, "sold-counts", eventIds.slice().sort().join("|")] as const,
  salesSummary: (
    // #962 G17 — currency is a nullable cache-key SEGMENT (not a display).
    // `null` is stable + serializable and keeps a null-currency brand's cache
    // distinct from a GBP brand's; never a fabricated "GBP".
    eventId: string,
    currency: string | null,
    ticketSignature: string,
  ): readonly ["event-orders", string, "sales-summary", string | null, string] =>
    [...eventOrdersKeys.all, eventId, "sales-summary", currency, ticketSignature] as const,
};

const DISABLED_KEY = ["event-orders-disabled"] as const;

export type EventOrdersRefetch = () => Promise<unknown>;

export type EventOrdersRead<T> =
  | {
      status: "disabled" | "loading" | "error";
      data: null;
      error: Error | null;
      isRefreshing: false;
      refetch: EventOrdersRefetch;
    }
  | {
      status: "ready";
      data: T;
      error: null;
      isRefreshing: boolean;
      refetch: EventOrdersRefetch;
    }
  | {
      status: "stale-error";
      data: T;
      error: Error;
      isRefreshing: false;
      refetch: EventOrdersRefetch;
    };

interface EventOrdersQuerySnapshot<T> {
  enabled: boolean;
  data: T | undefined;
  error: Error | null;
  isError: boolean;
  isPending: boolean;
  isFetching: boolean;
  refetch: EventOrdersRefetch;
}

export const projectEventOrdersRead = <T,>(
  query: EventOrdersQuerySnapshot<T>,
): EventOrdersRead<T> => {
  if (!query.enabled) {
    return {
      status: "disabled",
      data: null,
      error: null,
      isRefreshing: false,
      refetch: query.refetch,
    };
  }
  if (query.isError && query.data !== undefined) {
    return {
      status: "stale-error",
      data: query.data,
      error: query.error ?? new Error("event_orders_refresh_failed"),
      isRefreshing: false,
      refetch: query.refetch,
    };
  }
  if (query.isError) {
    return {
      status: "error",
      data: null,
      error: query.error ?? new Error("event_orders_load_failed"),
      isRefreshing: false,
      refetch: query.refetch,
    };
  }
  if (query.isPending || query.data === undefined) {
    return {
      status: "loading",
      data: null,
      error: null,
      isRefreshing: false,
      refetch: query.refetch,
    };
  }
  return {
    status: "ready",
    data: query.data,
    error: null,
    isRefreshing: query.isFetching,
    refetch: query.refetch,
  };
};

export const useEventOrders = (
  eventId: string | null,
): EventOrdersRead<OrderRecord[]> => {
  const { loading, session } = useAuth();
  const enabled = !loading && session !== null && eventId !== null;
  const query = useQuery<OrderRecord[]>({
    queryKey: enabled && eventId !== null ? eventOrdersKeys.detail(eventId) : DISABLED_KEY,
    enabled,
    staleTime: 15 * 1000,
    queryFn: async () => {
      if (eventId === null) throw new Error("eventId missing");
      return fetchEventOrders(eventId);
    },
  });
  return projectEventOrdersRead({
    enabled,
    data: query.data,
    error: query.error,
    isError: query.isError,
    isPending: query.isPending,
    isFetching: query.isFetching,
    refetch: query.refetch,
  });
};

export const useEventOrderById = (
  eventId: string | null,
  orderId: string | null,
): EventOrdersRead<OrderRecord | null> => {
  const { loading, session } = useAuth();
  const enabled = !loading && session !== null && eventId !== null && orderId !== null;
  const query = useQuery<OrderRecord | null>({
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
  return projectEventOrdersRead({
    enabled,
    data: query.data,
    error: query.error,
    isError: query.isError,
    isPending: query.isPending,
    isFetching: query.isFetching,
    refetch: query.refetch,
  });
};

export const useEventGuestList = (
  eventId: string | null,
): EventOrdersRead<OrderRecord[]> => {
  const ordersQuery = useEventOrders(eventId);
  if (ordersQuery.data === null) return ordersQuery;
  return { ...ordersQuery, data: getEventGuestList(ordersQuery.data) };
};

export const useEventGuestById = (
  eventId: string | null,
  guestId: string | null,
): EventOrdersRead<OrderRecord | null> => {
  const ordersQuery = useEventOrders(guestId === null ? null : eventId);
  if (ordersQuery.data === null) return ordersQuery;
  return {
    ...ordersQuery,
    data: guestId === null ? null : getEventGuestById(ordersQuery.data, guestId),
  };
};

export const useEventReconciliation = (
  eventId: string | null,
): EventOrdersRead<OrderRecord[]> => useEventOrders(eventId);

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
        // #962 G17 — null (not "GBP") for a null-currency brand; segment only.
        currencyCodeOrNull(event.currency ?? brandDefaultCurrency),
        ticketCapacitySignature(event.tickets),
      ),
      enabled: !loading && session !== null,
      staleTime: 15 * 1000,
      queryFn: () => fetchEventOrders(event.id),
    })),
  });

  return events.reduce<Record<string, EventSalesSummary>>((acc, event, index) => {
    const query = queries[index];
    const enabled = !loading && session !== null;
    const read = projectEventOrdersRead<OrderRecord[]>({
      enabled,
      data: query?.data,
      error: query?.error ?? null,
      isError: query?.isError ?? false,
      isPending: query?.isPending ?? true,
      isFetching: query?.isFetching ?? false,
      refetch: query?.refetch ?? (async () => undefined),
    });
    acc[event.id] = buildEventSalesSummary({
      eventId: event.id,
      tickets: event.tickets,
      eventCurrency: event.currency,
      brandDefaultCurrency,
      orders: read.data,
      readStatus: read.status,
      isRefreshing: read.isRefreshing,
    });
    return acc;
  }, {});
};

export const useEventHasWebPurchases = (
  eventId: string | null,
): EventOrdersRead<boolean> => {
  const ordersQuery = useEventOrders(eventId);
  if (ordersQuery.data === null) return ordersQuery;
  return { ...ordersQuery, data: getEventHasWebPurchases(ordersQuery.data) };
};

export type { EventOrdersReadStatus };

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
