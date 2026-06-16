/**
 * META-ORCH-1148 sub-ORCH 2.1b — reservations list + realtime + lifecycle.
 *
 * Reads the brand's reservations (server state in React Query — Const #5), keeps
 * the list live via a brand-scoped postgres_changes subscription (locked Q4;
 * filters by brand_id, NOT a PK, so no ORCH-0931 silent-drop), and exposes the
 * guarded create + transition mutations (both call the SECURITY DEFINER RPCs —
 * legal transitions enforced server-side). Manual bookings are FREE.
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
  Reservation,
  ReservationCreateInput,
} from "../types/venueReservation";

interface ReservationRow {
  id: string;
  brand_id: string;
  place_pool_id: string | null;
  table_id: string | null;
  reserved_for: string;
  party_size: number;
  status: Reservation["status"];
  source: Reservation["source"];
  created_via: Reservation["createdVia"];
  guest_name: string | null;
  guest_phone_e164: string | null;
  guest_email: string | null;
  consumer_user_id: string | null;
  occasion: string | null;
  guest_notes: string | null;
  tags: string[] | null;
  fee_cents: number | null;
  fee_currency: string | null;
  payment_status: Reservation["paymentStatus"];
  created_at: string;
}

const RESERVATION_COLUMNS =
  "id, brand_id, place_pool_id, table_id, reserved_for, party_size, status, source, created_via, guest_name, guest_phone_e164, guest_email, consumer_user_id, occasion, guest_notes, tags, fee_cents, fee_currency, payment_status, created_at";

const mapRow = (row: ReservationRow): Reservation => ({
  id: row.id,
  brandId: row.brand_id,
  placePoolId: row.place_pool_id,
  tableId: row.table_id,
  reservedFor: row.reserved_for,
  partySize: row.party_size,
  status: row.status,
  source: row.source,
  createdVia: row.created_via,
  guestName: row.guest_name,
  guestPhoneE164: row.guest_phone_e164,
  guestEmail: row.guest_email,
  consumerUserId: row.consumer_user_id,
  occasion: row.occasion,
  guestNotes: row.guest_notes,
  tags: row.tags ?? [],
  feeCents: row.fee_cents,
  feeCurrency: row.fee_currency,
  paymentStatus: row.payment_status,
  createdAt: row.created_at,
});

export const venueReservationsKeys = {
  list: (brandId: string): readonly ["venueReservations", string] =>
    ["venueReservations", brandId] as const,
};

export const fetchVenueReservations = async (
  brandId: string,
): Promise<Reservation[]> => {
  const { data, error } = await supabase
    .from("reservations")
    .select(RESERVATION_COLUMNS)
    .eq("brand_id", brandId)
    .order("reserved_for", { ascending: true })
    .returns<ReservationRow[]>();
  if (error !== null) throw error;
  return (data ?? []).map(mapRow);
};

export function useVenueReservations(
  brandId: string | null,
): UseQueryResult<Reservation[]> {
  const { isAuthReady } = useAuth();
  const queryClient = useQueryClient();
  const enabled = isAuthReady && brandId !== null && brandId.length > 0;

  const query = useQuery<Reservation[]>({
    queryKey: enabled
      ? venueReservationsKeys.list(brandId)
      : (["venueReservations", "disabled"] as const),
    enabled,
    staleTime: 15_000,
    queryFn: () =>
      enabled ? fetchVenueReservations(brandId) : Promise.resolve([]),
  });

  // Realtime (locked Q4): a brand-scoped postgres_changes subscription so an
  // inbound source='mingla' booking (2.2) and any operator change land live.
  // Filter on brand_id (NOT a PK) — avoids the ORCH-0931 PK-filter silent-drop;
  // event:'*' catches insert/update/delete. Cleanup on unmount.
  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel(`venue:reservations:${brandId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "reservations",
          filter: `brand_id=eq.${brandId}`,
        },
        () => {
          void queryClient.invalidateQueries({
            queryKey: venueReservationsKeys.list(brandId),
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, brandId, queryClient]);

  return query;
}

/** Manual create via the guarded RPC (FREE; created_via='operator'). */
export function useCreateReservation(
  brandId: string | null,
): UseMutationResult<void, Error, ReservationCreateInput> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, ReservationCreateInput>({
    mutationFn: async (input: ReservationCreateInput): Promise<void> => {
      if (brandId === null) throw new Error("brand_required");
      const { error } = await supabase.rpc("biz_reservation_create", {
        p_brand_id: brandId,
        p_reserved_for: input.reservedFor,
        p_party_size: input.partySize,
        p_source: input.source,
        p_guest_name: input.guestName,
        p_guest_phone_e164: input.guestPhoneE164,
        p_guest_email: input.guestEmail,
        p_table_id: input.tableId,
        p_occasion: input.occasion,
        p_guest_notes: input.guestNotes,
        p_tags: input.tags,
        p_status: "confirmed",
      });
      if (error !== null) throw error as unknown as Error;
    },
    onSuccess: () => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueReservationsKeys.list(brandId),
        });
      }
    },
  });
}

export interface ReservationTransitionVars {
  reservationId: string;
  toStatus: Reservation["status"];
  tableId?: string | null;
  reason?: string | null;
}

/** Lifecycle transition via the guarded RPC (legal transitions enforced server-side). */
export function useTransitionReservation(
  brandId: string | null,
): UseMutationResult<void, Error, ReservationTransitionVars> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, ReservationTransitionVars>({
    mutationFn: async (vars: ReservationTransitionVars): Promise<void> => {
      const { error } = await supabase.rpc("biz_reservation_transition", {
        p_reservation_id: vars.reservationId,
        p_to_status: vars.toStatus,
        p_table_id: vars.tableId ?? null,
        p_reason: vars.reason ?? null,
      });
      if (error !== null) throw error as unknown as Error;
    },
    onSuccess: () => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueReservationsKeys.list(brandId),
        });
      }
    },
  });
}
