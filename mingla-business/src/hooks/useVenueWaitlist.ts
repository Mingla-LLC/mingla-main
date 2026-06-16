/**
 * META-ORCH-1148 sub-ORCH 2.1b — waitlist list + realtime + add/notify/convert.
 *
 * Reads the brand's live waitlist (server state in React Query), keeps it live
 * via a brand-scoped postgres_changes subscription (filter brand_id, not PK —
 * no ORCH-0931 silent-drop), and exposes add (direct RLS insert), mark-lost
 * (direct update), notify (the send-venue-sms edge fn → Twilio + mark notified),
 * and convert-to-reservation (the atomic guarded RPC).
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
import { venueReservationsKeys } from "./useVenueReservations";
import type {
  WaitlistAddInput,
  WaitlistEntry,
} from "../types/venueReservation";

interface WaitlistRow {
  id: string;
  brand_id: string;
  guest_name: string | null;
  guest_phone_e164: string | null;
  guest_email: string | null;
  party_size: number;
  preferred_zone: WaitlistEntry["preferredZone"];
  quoted_wait_minutes: number | null;
  status: WaitlistEntry["status"];
  notify_via: WaitlistEntry["notifyVia"];
  notified_at: string | null;
  expires_at: string | null;
  converted_reservation_id: string | null;
  consumer_user_id: string | null;
  created_at: string;
}

const WAITLIST_COLUMNS =
  "id, brand_id, guest_name, guest_phone_e164, guest_email, party_size, preferred_zone, quoted_wait_minutes, status, notify_via, notified_at, expires_at, converted_reservation_id, consumer_user_id, created_at";

const mapRow = (row: WaitlistRow): WaitlistEntry => ({
  id: row.id,
  brandId: row.brand_id,
  guestName: row.guest_name,
  guestPhoneE164: row.guest_phone_e164,
  guestEmail: row.guest_email,
  partySize: row.party_size,
  preferredZone: row.preferred_zone,
  quotedWaitMinutes: row.quoted_wait_minutes,
  status: row.status,
  notifyVia: row.notify_via,
  notifiedAt: row.notified_at,
  expiresAt: row.expires_at,
  convertedReservationId: row.converted_reservation_id,
  consumerUserId: row.consumer_user_id,
  createdAt: row.created_at,
});

export const venueWaitlistKeys = {
  list: (brandId: string): readonly ["venueWaitlist", string] =>
    ["venueWaitlist", brandId] as const,
};

export const fetchVenueWaitlist = async (
  brandId: string,
): Promise<WaitlistEntry[]> => {
  const { data, error } = await supabase
    .from("venue_waitlist")
    .select(WAITLIST_COLUMNS)
    .eq("brand_id", brandId)
    .order("created_at", { ascending: true })
    .returns<WaitlistRow[]>();
  if (error !== null) throw error;
  return (data ?? []).map(mapRow);
};

export function useVenueWaitlist(
  brandId: string | null,
): UseQueryResult<WaitlistEntry[]> {
  const { isAuthReady } = useAuth();
  const queryClient = useQueryClient();
  const enabled = isAuthReady && brandId !== null && brandId.length > 0;

  const query = useQuery<WaitlistEntry[]>({
    queryKey: enabled
      ? venueWaitlistKeys.list(brandId)
      : (["venueWaitlist", "disabled"] as const),
    enabled,
    staleTime: 15_000,
    queryFn: () =>
      enabled ? fetchVenueWaitlist(brandId) : Promise.resolve([]),
  });

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel(`venue:waitlist:${brandId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "venue_waitlist",
          filter: `brand_id=eq.${brandId}`,
        },
        () => {
          void queryClient.invalidateQueries({
            queryKey: venueWaitlistKeys.list(brandId),
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

/** Add a guest to the waitlist (direct RLS-gated insert — manager+ enforced server-side). */
export function useAddToWaitlist(
  brandId: string | null,
): UseMutationResult<void, Error, WaitlistAddInput> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, WaitlistAddInput>({
    mutationFn: async (input: WaitlistAddInput): Promise<void> => {
      if (brandId === null) throw new Error("brand_required");
      const { error } = await supabase.from("venue_waitlist").insert({
        brand_id: brandId,
        guest_name: input.guestName,
        guest_phone_e164: input.guestPhoneE164,
        guest_email: input.guestEmail,
        party_size: input.partySize,
        preferred_zone: input.preferredZone,
        quoted_wait_minutes: input.quotedWaitMinutes,
        status: "waiting",
      });
      if (error !== null) throw error as unknown as Error;
    },
    onSuccess: () => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueWaitlistKeys.list(brandId),
        });
      }
    },
  });
}

/** Mark a waitlist entry lost (guest left) — direct RLS-gated update. */
export function useMarkWaitlistLost(
  brandId: string | null,
): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id: string): Promise<void> => {
      if (brandId === null) throw new Error("brand_required");
      const { error } = await supabase
        .from("venue_waitlist")
        .update({ status: "lost", updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("brand_id", brandId);
      if (error !== null) throw error as unknown as Error;
    },
    onSuccess: () => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueWaitlistKeys.list(brandId),
        });
      }
    },
  });
}

/**
 * Notify a waitlist guest their table is ready — invokes the send-venue-sms edge
 * fn (Twilio "table's ready" via the approved toll-free + opt-out gate + the
 * mark-notified RPC). The fn handles E.164 validation + consent server-side.
 */
export function useNotifyWaitlist(
  brandId: string | null,
): UseMutationResult<{ ok: boolean }, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<{ ok: boolean }, Error, string>({
    mutationFn: async (waitlistId: string): Promise<{ ok: boolean }> => {
      const { data, error } = await supabase.functions.invoke("send-venue-sms", {
        body: { waitlistId },
      });
      if (error !== null) throw error as unknown as Error;
      return { ok: (data as { ok?: boolean } | null)?.ok ?? false };
    },
    onSuccess: () => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueWaitlistKeys.list(brandId),
        });
      }
    },
  });
}

export interface WaitlistConvertVars {
  waitlistId: string;
  reservedFor: string;
  tableId?: string | null;
}

/** Convert a waitlist entry → reservation atomically (the guarded RPC). */
export function useConvertWaitlist(
  brandId: string | null,
): UseMutationResult<void, Error, WaitlistConvertVars> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, WaitlistConvertVars>({
    mutationFn: async (vars: WaitlistConvertVars): Promise<void> => {
      const { error } = await supabase.rpc(
        "biz_waitlist_convert_to_reservation",
        {
          p_waitlist_id: vars.waitlistId,
          p_reserved_for: vars.reservedFor,
          p_table_id: vars.tableId ?? null,
        },
      );
      if (error !== null) throw error as unknown as Error;
    },
    onSuccess: () => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueWaitlistKeys.list(brandId),
        });
        void queryClient.invalidateQueries({
          queryKey: venueReservationsKeys.list(brandId),
        });
      }
    },
  });
}
