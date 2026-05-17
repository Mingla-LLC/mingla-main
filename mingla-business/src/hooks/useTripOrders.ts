/**
 * useTripOrders — operator-side fetch of orders for a single trip event.
 * Used by the trip dashboard Travelers tab. Tr2 (ORCH-0859).
 *
 * Thin wrapper around the existing event-orders query — orders are
 * event_type-agnostic at the DB level (orders.event_id FKs to events.id
 * regardless of event_type). So this hook can reuse the same RLS-gated
 * query as event orders.
 *
 * Spec: Mingla_Artifacts/specs/SPEC_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP.md §4.7
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { supabase } from "../services/supabase";

const TRIP_ORDERS_STALE_MS = 30 * 1000; // 30s — relatively fresh for operator dashboard

export interface TripOrderRow {
  id: string;
  buyerName: string | null;
  buyerEmail: string | null;
  buyerPhone: string | null;
  paymentStatus: string;
  totalCents: number;
  currency: string;
  createdAt: string;
}

interface OrderRow {
  id: string;
  buyer_name: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;
  payment_status: string;
  total_cents: number;
  currency: string;
  created_at: string;
}

const tripOrdersKey = (eventId: string) =>
  ["trips", "orders", eventId] as const;

const DISABLED_KEY = ["trips", "orders", "__disabled__"] as const;

export const useTripOrders = (
  eventId: string | null,
): UseQueryResult<TripOrderRow[], Error> => {
  const enabled = eventId !== null && eventId.length > 0;
  return useQuery<TripOrderRow[], Error>({
    queryKey: enabled ? tripOrdersKey(eventId) : DISABLED_KEY,
    enabled,
    staleTime: TRIP_ORDERS_STALE_MS,
    queryFn: async () => {
      if (!enabled) return [];
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, buyer_name, buyer_email, buyer_phone, payment_status, total_cents, currency, created_at",
        )
        .eq("event_id", eventId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as OrderRow[]).map((row) => ({
        id: row.id,
        buyerName: row.buyer_name,
        buyerEmail: row.buyer_email,
        buyerPhone: row.buyer_phone,
        paymentStatus: row.payment_status,
        totalCents: row.total_cents,
        currency: row.currency,
        createdAt: row.created_at,
      }));
    },
  });
};
