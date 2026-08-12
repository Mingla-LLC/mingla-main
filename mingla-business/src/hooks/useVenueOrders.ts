/**
 * Issue #1791 (#1767 Phase 3) — the Orders queue's data layer, and TWO of the
 * three legs of the mandatory notification triple (SPEC #1788 P-53).
 *
 * THE TRIPLE, and why all three or none:
 *   (a) REALTIME — a brand-scoped `postgres_changes` subscription on
 *       `venue_orders`. Sub-second when the channel is healthy.
 *   (b) A 30-SECOND POLL FLOOR — `refetchInterval: 30_000`. This is the leg the
 *       shipped Reservations module does NOT have, and its absence is a real
 *       bug: `useVenueReservations.ts:126-165` has `staleTime: 15_000`, a
 *       realtime channel, and no `subscribe()` status callback — so a silently
 *       dropped channel leaves the list frozen until somebody pulls to refresh.
 *       An order with money taken cannot inherit that. The precedent copied
 *       here is `useStayStaffReservations.ts:39-40`.
 *   (c) PUSH — server-side, `business.venue_order_placed` through
 *       `notifyBrandRoles` (supabase/functions/_shared/venueOrderNotify.ts).
 *       Business WEB gets (a) + (b) only: the web OneSignal shim is a no-op.
 *
 * Each leg covers the others' failure modes. A dead channel is caught by the
 * poll; a backgrounded app is caught by the push; a declined push permission is
 * caught by the channel and the poll.
 *
 * No server record is ever persisted into a Zustand store from here — these are
 * React-Query caches, which is the shipped rule (persist IDs, not records).
 */

import { useEffect } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import type {
  VenueOrder,
  VenueOrderAction,
  VenueOrderFulfillmentStatus,
  VenueOrderLine,
  VenueOrderPaymentStatus,
  VenueOrderSource,
} from "../components/venue/venueOrderViews";
import { VENUE_ORDER_ACTION_TARGET } from "../components/venue/venueOrderViews";

/**
 * THE POLL FLOOR. Exported, and the hook spreads the options factory below
 * rather than re-declaring them, so a revert that drops the interval drops it
 * from the factory too — and `useVenueOrders.issue1791.test.ts` goes red.
 */
export const VENUE_ORDERS_POLL_MS = 30_000;
export const VENUE_ORDERS_STALE_MS = 15_000;

/**
 * How far back the queue reads. Bounded on purpose: a busy venue's all-time
 * order history is not a service surface, and an unbounded list is how a queue
 * gets slow exactly when it matters. Live tickets are minutes old; "Done"
 * shows the shift, not the year.
 */
export const VENUE_ORDERS_WINDOW_HOURS = 24;
const VENUE_ORDERS_MAX_ROWS = 300;

interface ModifierRow {
  modifier_name_at_order: string;
}

interface ItemRow {
  id: string;
  line_no: number;
  item_name_at_order: string;
  quantity: number;
  notes: string | null;
  venue_order_item_modifiers: ModifierRow[] | null;
}

interface OrderRow {
  id: string;
  brand_id: string;
  venue_id: string;
  session_id: string;
  fulfillment_status: VenueOrderFulfillmentStatus;
  payment_status: VenueOrderPaymentStatus;
  source: VenueOrderSource;
  spot_label_at_order: string | null;
  pickup_code: string | null;
  zone_at_order: string | null;
  buyer_name: string | null;
  currency: string;
  total_cents: number;
  tip_cents: number;
  created_at: string;
  acknowledged_at: string | null;
  acknowledged_by_user_id: string | null;
  ready_at: string | null;
  delivered_at: string | null;
  refund_requested_at: string | null;
  refund_decision: "approved" | "declined" | null;
  escalation_level: number;
  venue_order_items: ItemRow[] | null;
}

// A single string literal — supabase-js infers the row shape from the LITERAL
// type of the select string, and a `+` concatenation erases it.
const ORDER_COLUMNS =
  "id, brand_id, venue_id, session_id, fulfillment_status, payment_status, source, spot_label_at_order, pickup_code, zone_at_order, buyer_name, currency, total_cents, tip_cents, created_at, acknowledged_at, acknowledged_by_user_id, ready_at, delivered_at, refund_requested_at, refund_decision, escalation_level, venue_order_items(id, line_no, item_name_at_order, quantity, notes, venue_order_item_modifiers(modifier_name_at_order))";

const mapLine = (row: ItemRow): VenueOrderLine => ({
  id: row.id,
  lineNo: row.line_no,
  itemName: row.item_name_at_order,
  quantity: row.quantity,
  notes: row.notes,
  modifiers: (row.venue_order_item_modifiers ?? []).map(
    (m) => m.modifier_name_at_order,
  ),
});

const mapRow = (row: OrderRow): VenueOrder => {
  const lines = (row.venue_order_items ?? [])
    .map(mapLine)
    .sort((a, b) => a.lineNo - b.lineNo);
  return {
    id: row.id,
    brandId: row.brand_id,
    venueId: row.venue_id,
    sessionId: row.session_id,
    fulfillmentStatus: row.fulfillment_status,
    paymentStatus: row.payment_status,
    source: row.source,
    spotLabel: row.spot_label_at_order,
    pickupCode: row.pickup_code,
    zone: row.zone_at_order,
    buyerName: row.buyer_name,
    currency: row.currency,
    totalCents: row.total_cents,
    tipCents: row.tip_cents,
    itemCount: lines.reduce((sum, l) => sum + l.quantity, 0),
    lines,
    placedAt: row.created_at,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedByUserId: row.acknowledged_by_user_id,
    readyAt: row.ready_at,
    deliveredAt: row.delivered_at,
    refundRequestedAt: row.refund_requested_at,
    refundDecision: row.refund_decision,
    escalationLevel: Number(row.escalation_level ?? 0),
  };
};

export const venueOrdersKeys = {
  /** Prefix retained so one invalidation refreshes every venue-local queue. */
  list: (brandId: string): readonly ["venueOrders", string] =>
    ["venueOrders", brandId] as const,
  venue: (
    brandId: string,
    venueId: string,
  ): readonly ["venueOrders", string, string] =>
    ["venueOrders", brandId, venueId] as const,
};

export const fetchVenueOrders = async (
  brandId: string,
  venueId: string | null = null,
): Promise<VenueOrder[]> => {
  const since = new Date(
    Date.now() - VENUE_ORDERS_WINDOW_HOURS * 60 * 60 * 1000,
  ).toISOString();
  let query = supabase
    .from("venue_orders")
    .select(ORDER_COLUMNS)
    .eq("brand_id", brandId)
    .gte("created_at", since);
  if (venueId !== null) query = query.eq("venue_id", venueId);
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(VENUE_ORDERS_MAX_ROWS)
    .returns<OrderRow[]>();
  if (error !== null) throw error;
  return (data ?? []).map(mapRow);
};

/**
 * The query options, as data, so the poll floor is provable without a React
 * tree. The hook spreads this — it does not restate it — which is what makes
 * "assert refetchInterval is 30s" a real regression guard rather than a
 * comment that agrees with itself.
 */
export function venueOrdersQueryOptions(
  brandId: string,
  venueId: string | null = null,
): {
  queryKey: readonly unknown[];
  staleTime: number;
  refetchInterval: number;
  queryFn: () => Promise<VenueOrder[]>;
} {
  return {
    queryKey: venueId === null
      ? venueOrdersKeys.list(brandId)
      : venueOrdersKeys.venue(brandId, venueId),
    staleTime: VENUE_ORDERS_STALE_MS,
    // LEG (b) OF THE TRIPLE. Do not remove: without it a silently dropped
    // realtime channel freezes the queue with money already taken, which is
    // exactly the shipped Reservations bug this phase must not repeat.
    refetchInterval: VENUE_ORDERS_POLL_MS,
    queryFn: () => fetchVenueOrders(brandId, venueId),
  };
}

export function useVenueOrders(
  brandId: string | null,
  venueId: string | null = null,
): UseQueryResult<VenueOrder[]> {
  const { isAuthReady } = useAuth();
  const queryClient = useQueryClient();
  const enabled = isAuthReady && brandId !== null && brandId.length > 0;

  const query = useQuery<VenueOrder[]>({
    ...(enabled
      ? venueOrdersQueryOptions(brandId, venueId)
      : {
        queryKey: ["venueOrders", "disabled"] as const,
        staleTime: VENUE_ORDERS_STALE_MS,
        refetchInterval: VENUE_ORDERS_POLL_MS,
        queryFn: () => Promise.resolve([] as VenueOrder[]),
      }),
    enabled,
  });

  // LEG (a) OF THE TRIPLE. `venue_orders` is in the `supabase_realtime`
  // publication (20270311001790) and `BASELINE_PUBLICATION_TABLES` carries it,
  // so the ORCH-0854 paired gate is satisfied — a subscription on an
  // unpublished table is a silent no-op, and that has shipped twice before.
  //
  // Issue #1943: the Venue -> Orders route supplies venueId, so realtime and
  // polling share the exact same immutable owner predicate. Legacy callers that
  // omit it retain the brand prefix for their own non-route use.
  useEffect(() => {
    if (!enabled) return;
    const realtimeFilter = venueId === null
      ? `brand_id=eq.${brandId}`
      : `venue_id=eq.${venueId}`;
    const channel = supabase
      .channel(`venue-orders:${brandId}:${venueId ?? "brand"}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "venue_orders",
          filter: realtimeFilter,
        },
        () => {
          void queryClient.invalidateQueries({
            queryKey: venueId === null
              ? venueOrdersKeys.list(brandId)
              : venueOrdersKeys.venue(brandId, venueId),
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, brandId, venueId, queryClient]);

  return query;
}

// ---------------------------------------------------------------------------
// Mutations. Every one goes through `venue-order-staff`, which runs them as the
// CALLING USER so the database sees a real `auth.uid()` and applies its own
// rank floor. Nothing here writes an order row directly — RLS grants the client
// SELECT only, on purpose.
// ---------------------------------------------------------------------------

async function invokeStaff(
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("venue-order-staff", {
    body,
  });
  if (error !== null) throw error as unknown as Error;
  return (data ?? {}) as Record<string, unknown>;
}

export interface VenueOrderTransitionVars {
  orderId: string;
  action: VenueOrderAction;
  reason?: string | null;
}

/**
 * THE ACK. `action: "acknowledge"` is the only thing in the entire product that
 * produces an `acknowledged_at`, and the user id written beside it comes from
 * the JWT inside the RPC — never from this payload. Rendering a row does not,
 * and can not, acknowledge it.
 * (I-PROPOSED-1767-ACK-IS-A-HUMAN-TAP)
 */
export function useTransitionVenueOrder(
  brandId: string | null,
): UseMutationResult<void, Error, VenueOrderTransitionVars> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, VenueOrderTransitionVars>({
    mutationFn: async (vars: VenueOrderTransitionVars): Promise<void> => {
      await invokeStaff({
        action: "transition",
        orderId: vars.orderId,
        to: VENUE_ORDER_ACTION_TARGET[vars.action],
        reason: vars.reason ?? null,
      });
    },
    onSuccess: () => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueOrdersKeys.list(brandId),
        });
      }
    },
  });
}

export interface VenueOrderRefundDecisionVars {
  orderId: string;
  decision: "approved" | "declined";
  note?: string | null;
}

/** Approve-or-explain. A decline without a reason is refused server-side. */
export function useDecideVenueOrderRefund(
  brandId: string | null,
): UseMutationResult<void, Error, VenueOrderRefundDecisionVars> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, VenueOrderRefundDecisionVars>({
    mutationFn: async (vars: VenueOrderRefundDecisionVars): Promise<void> => {
      await invokeStaff({
        action: "refund_decision",
        orderId: vars.orderId,
        decision: vars.decision,
        note: vars.note ?? null,
      });
    },
    onSuccess: () => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueOrdersKeys.list(brandId),
        });
      }
    },
  });
}
