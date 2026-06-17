import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { supabase } from "../services/supabase";

/**
 * useMyReservations — META-ORCH-1148 sub-ORCH 2.2b (SPEC §4.D / §4.E.1).
 * ---------------------------------------------------------------------------
 * Reads the signed-in user's OWN reservations via the 2.2a consumer-own-read
 * SELECT RLS (`consumer_user_id = auth.uid()`). Powers the "Reservations" rows
 * folded into the existing Calendar tab's Active/Archive buckets. Joins the
 * brand name for the venue label (brands is authenticated-readable — same join
 * the venue-experiences read relies on).
 *
 * `enabled: !!userId`. NEVER fabricates rows — RLS scopes it to the caller.
 */

export interface MyReservationRow {
  id: string;
  brand_id: string;
  brand_name: string | null;
  brand_cover_url: string | null;
  brand_cover_type: string | null;
  brand_photo_url: string | null;
  brand_cover_hue: string | null;
  reserved_for: string;
  party_size: number;
  status: string;
  fee_cents: number | null;
  fee_currency: string | null;
  payment_status: string;
  occasion: string | null;
  guest_notes: string | null;
  created_at: string;
}

interface RawBrandJoin {
  name: string | null;
  cover_media_url: string | null;
  cover_media_type: string | null;
  profile_photo_url: string | null;
  cover_hue: string | null;
}

interface RawReservationRow {
  id: string;
  brand_id: string;
  reserved_for: string;
  party_size: number;
  status: string;
  fee_cents: number | null;
  fee_currency: string | null;
  payment_status: string;
  occasion: string | null;
  guest_notes: string | null;
  created_at: string;
  brands: RawBrandJoin | RawBrandJoin[] | null;
}

export const myReservationsKeys = {
  all: ["myReservations"] as const,
  byUser: (userId: string) => [...myReservationsKeys.all, userId] as const,
};

async function fetchMyReservations(
  userId: string,
): Promise<MyReservationRow[]> {
  const { data, error } = await supabase
    .from("reservations")
    .select(
      "id, brand_id, reserved_for, party_size, status, fee_cents, fee_currency, payment_status, occasion, guest_notes, created_at, brands(name, cover_media_url, cover_media_type, profile_photo_url, cover_hue)",
    )
    .eq("consumer_user_id", userId)
    .order("reserved_for", { ascending: false });
  if (error !== null) throw error;
  const rows = (data ?? []) as RawReservationRow[];
  return rows.map((r) => {
    const brand = Array.isArray(r.brands) ? r.brands[0] : r.brands;
    return {
      id: r.id,
      brand_id: r.brand_id,
      brand_name: brand?.name ?? null,
      brand_cover_url: brand?.cover_media_url ?? null,
      brand_cover_type: brand?.cover_media_type ?? null,
      brand_photo_url: brand?.profile_photo_url ?? null,
      brand_cover_hue: brand?.cover_hue ?? null,
      reserved_for: r.reserved_for,
      party_size: r.party_size,
      status: r.status,
      fee_cents: r.fee_cents,
      fee_currency: r.fee_currency,
      payment_status: r.payment_status,
      occasion: r.occasion,
      guest_notes: r.guest_notes,
      created_at: r.created_at,
    };
  });
}

export function useMyReservations(
  userId: string | null | undefined,
): UseQueryResult<MyReservationRow[]> {
  return useQuery({
    queryKey: myReservationsKeys.byUser(userId ?? "none"),
    queryFn: () => fetchMyReservations(userId as string),
    enabled: !!userId,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

/**
 * Cancel one of the caller's OWN reservations via pg_cancel_my_reservation
 * (2.2a, SECURITY DEFINER authenticated — asserts consumer_user_id = auth.uid(),
 * honors cancel_cutoff_hours, transitions to cancelled_by_guest). Returns
 * { refundEligible } so the UI can surface refund eligibility.
 *
 * [TRANSITIONAL] Refund EXECUTION is not wired here — the RPC only FLAGS
 * refund_eligible (paid + refundable + before cutoff). When a deposit was paid
 * and eligible, the actual refund (reuse refund-order) is the 2.2c/edge-cancel
 * seam. Exit: once the edge cancel endpoint executes the refund, this caller
 * routes through it instead of the bare RPC. Tracked in the 2.2b report.
 */
export async function cancelMyReservation(
  reservationId: string,
): Promise<{ refundEligible: boolean; status: string }> {
  const { data, error } = await supabase.rpc("pg_cancel_my_reservation", {
    p_reservation_id: reservationId,
  });
  if (error !== null) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as
    | { reservation?: { status?: string } | null; refund_eligible?: boolean }
    | null;
  return {
    refundEligible: row?.refund_eligible === true,
    status: row?.reservation?.status ?? "cancelled_by_guest",
  };
}
