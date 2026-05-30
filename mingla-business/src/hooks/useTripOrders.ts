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

import { useAuth } from "../context/AuthContext";
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
  /**
   * ORCH-0880 [Tr5 Traveler Intake Forms] — per-tier intake answers payload
   * persisted by ticket-checkout-create when the buyer completed the
   * intake step. Shape: array of `IntakeFormData` ({ ticket_type_id,
   * schema_version_id, answers: {[questionId]: value} }). Null when the
   * trip has no schemas OR the order predates Tr5.
   */
  intakeFormData: unknown | null;
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
  intake_form_data: unknown | null;
}

const tripOrdersKey = (eventId: string) =>
  ["trips", "orders", eventId] as const;

const DISABLED_KEY = ["trips", "orders", "__disabled__"] as const;

export const useTripOrders = (
  eventId: string | null,
): UseQueryResult<TripOrderRow[], Error> => {
  // ORCH-1004 — orders is RLS auth.uid()-scoped (organiser-only); gate on auth.
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && eventId !== null && eventId.length > 0;
  return useQuery<TripOrderRow[], Error>({
    queryKey: enabled ? tripOrdersKey(eventId) : DISABLED_KEY,
    enabled,
    staleTime: TRIP_ORDERS_STALE_MS,
    queryFn: async () => {
      if (!enabled) return [];
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, buyer_name, buyer_email, buyer_phone, payment_status, total_cents, currency, created_at, intake_form_data",
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
        intakeFormData: row.intake_form_data,
      }));
    },
  });
};
