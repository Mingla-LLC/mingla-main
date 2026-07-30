import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { supabase } from "../services/supabase";
import type { ReservationRefundSummary } from "../components/activity/ReservationRefundStatus";

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
  brand_address: string | null;
  brand_city: string | null;
  brand_lat: number | null;
  brand_lng: number | null;
  reserved_for: string;
  party_size: number;
  status: string;
  fee_cents: number | null;
  fee_currency: string | null;
  payment_status: string;
  occasion: string | null;
  guest_notes: string | null;
  created_at: string;
  refund?: ReservationRefundSummary | null;
}

interface RawBrandJoin {
  name: string | null;
  cover_media_url: string | null;
  cover_media_type: string | null;
  profile_photo_url: string | null;
  cover_hue: string | null;
  address: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
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
      "id, brand_id, reserved_for, party_size, status, fee_cents, fee_currency, payment_status, occasion, guest_notes, created_at, brands(name, cover_media_url, cover_media_type, profile_photo_url, cover_hue, address, city, lat, lng)",
    )
    .eq("consumer_user_id", userId)
    .order("reserved_for", { ascending: false });
  if (error !== null) throw error;
  const rows = (data ?? []) as RawReservationRow[];
  const { data: refundRows, error: refundError } = rows.length > 0
    ? await supabase.rpc("pg_my_source_refund_summaries", {
      p_source_type: "venue_reservation",
      p_subject_ids: rows.map((row) => row.id),
    })
    : { data: [], error: null };
  if (refundError !== null) throw refundError;
  const refundByReservation = new Map(
    ((refundRows ?? []) as ReservationRefundSummary[]).map((refund) => [
      refund.subject_id,
      refund,
    ]),
  );
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
      brand_address: brand?.address ?? null,
      brand_city: brand?.city ?? null,
      brand_lat: typeof brand?.lat === "number" ? brand.lat : null,
      brand_lng: typeof brand?.lng === "number" ? brand.lng : null,
      reserved_for: r.reserved_for,
      party_size: r.party_size,
      status: r.status,
      fee_cents: r.fee_cents,
      fee_currency: r.fee_currency,
      payment_status: r.payment_status,
      occasion: r.occasion,
      guest_notes: r.guest_notes,
      created_at: r.created_at,
      refund: refundByReservation.get(r.id) ?? null,
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
 * Cancel one of the caller's OWN reservations via the venue-reservation-cancel
 * edge function (META-ORCH-1148 2.2g). The fn calls the SECURITY DEFINER
 * typed cancellation/refund boundary. Cancellation is durable even when the
 * provider leg is nonterminal; callers receive the canonical refund summary
 * and must never infer success from an HTTP 2xx.
 */
export async function cancelMyReservation(
  reservationId: string,
): Promise<{
  refundEligible: boolean;
  status: string;
  refund: ReservationRefundSummary | null;
}> {
  const { data, error } = await supabase.functions.invoke(
    "venue-reservation-cancel",
    { body: { reservationId } },
  );
  if (error !== null) throw error;
  const res = (data ?? {}) as {
    status?: string;
    refundEligible?: boolean;
    refund?: ReservationRefundSummary | null;
  };
  return {
    refundEligible: res.refundEligible === true,
    status: res.status ?? "cancelled",
    refund: res.refund ?? null,
  };
}
