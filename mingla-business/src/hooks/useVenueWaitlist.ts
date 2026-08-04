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
  venue_id: string;
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
  "id, brand_id, venue_id, guest_name, guest_phone_e164, guest_email, party_size, preferred_zone, quoted_wait_minutes, status, notify_via, notified_at, expires_at, converted_reservation_id, consumer_user_id, created_at";

const mapRow = (row: WaitlistRow): WaitlistEntry => ({
  id: row.id,
  brandId: row.brand_id,
  venueId: row.venue_id,
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
  // META-ORCH-1255 — venue-scoped, brandId-first (brand-prefix invalidation safe).
  list: (
    brandId: string,
    venueId: string,
  ): readonly ["venueWaitlist", string, string] =>
    ["venueWaitlist", brandId, venueId] as const,
};

export const fetchVenueWaitlist = async (
  brandId: string,
  venueId: string,
): Promise<WaitlistEntry[]> => {
  const { data, error } = await supabase
    .from("venue_waitlist")
    .select(WAITLIST_COLUMNS)
    .eq("brand_id", brandId)
    .eq("venue_id", venueId)
    .order("created_at", { ascending: true })
    .returns<WaitlistRow[]>();
  if (error !== null) throw error;
  return (data ?? []).map(mapRow);
};

export function useVenueWaitlist(
  brandId: string | null,
  venueId: string | null,
): UseQueryResult<WaitlistEntry[]> {
  const { isAuthReady } = useAuth();
  const queryClient = useQueryClient();
  const enabled =
    isAuthReady &&
    brandId !== null &&
    brandId.length > 0 &&
    venueId !== null &&
    venueId.length > 0;

  const query = useQuery<WaitlistEntry[]>({
    queryKey: enabled
      ? venueWaitlistKeys.list(brandId, venueId)
      : (["venueWaitlist", "disabled"] as const),
    enabled,
    staleTime: 15_000,
    queryFn: () =>
      enabled ? fetchVenueWaitlist(brandId, venueId) : Promise.resolve([]),
  });

  useEffect(() => {
    if (!enabled) return;
    // META-ORCH-1255 — venue-scoped realtime (non-PK filter — no ORCH-0931 drop).
    const channel = supabase
      .channel(`venue:waitlist:${venueId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "venue_waitlist",
          filter: `venue_id=eq.${venueId}`,
        },
        () => {
          void queryClient.invalidateQueries({
            queryKey: venueWaitlistKeys.list(brandId, venueId),
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

/** Add a guest to the waitlist (direct RLS-gated insert — manager+ enforced server-side). */
export function useAddToWaitlist(
  brandId: string | null,
  venueId: string | null,
): UseMutationResult<void, Error, WaitlistAddInput> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, WaitlistAddInput>({
    mutationFn: async (input: WaitlistAddInput): Promise<void> => {
      if (brandId === null) throw new Error("brand_required");
      if (venueId === null) throw new Error("venue_required");
      const { error } = await supabase.from("venue_waitlist").insert({
        brand_id: brandId,
        venue_id: venueId,
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
      if (brandId !== null && venueId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueWaitlistKeys.list(brandId, venueId),
        });
      }
    },
  });
}

/** Mark a waitlist entry lost (guest left) — direct RLS-gated update. */
export function useMarkWaitlistLost(
  brandId: string | null,
  venueId: string | null,
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
      if (brandId !== null && venueId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueWaitlistKeys.list(brandId, venueId),
        });
      }
    },
  });
}

/**
 * #1541 — the operator-facing copy for a market kill-switch skip.
 *
 * A dark market is NOT a failure to be retried and NOT a bad phone number. It
 * is a capability that is switched off, and the only useful thing an operator
 * can do about it is walk over and tell the guest. The edge fn answers 503
 * `sms_market_unavailable` for exactly this case, distinct from 409 (opted out),
 * 422 (bad phone) and 502 (the provider failed).
 *
 * Exported so the surface that renders it and the test that asserts it read the
 * SAME string — a copy contract duplicated by hand is a copy contract that
 * drifts.
 */
export const SMS_MARKET_UNAVAILABLE_MESSAGE =
  "Text not sent — SMS is switched off for this region. Let your guest know in person.";

/** The machine-readable discriminator the edge fn returns with its 503. */
export const SMS_MARKET_UNAVAILABLE_CODE = "sms_market_unavailable";

/**
 * #1541 — a typed error so the surface can distinguish a dark market from a
 * genuine send failure WITHOUT string-matching a message.
 */
export class SmsMarketUnavailableError extends Error {
  readonly code = SMS_MARKET_UNAVAILABLE_CODE;
  constructor() {
    super(SMS_MARKET_UNAVAILABLE_MESSAGE);
    this.name = "SmsMarketUnavailableError";
  }
}

/**
 * `supabase.functions.invoke` collapses every non-2xx into a FunctionsHttpError
 * and hangs the raw Response off `.context`. Reading the body is the ONLY way to
 * tell a 503 dark-market skip from a 502 provider failure — the error object
 * itself carries neither the status nor the payload.
 */
async function readInvokeErrorCode(error: unknown): Promise<string | null> {
  const context = (error as { context?: unknown } | null)?.context;
  if (context === null || context === undefined) return null;
  const res = context as { status?: number; json?: () => Promise<unknown> };
  if (typeof res.json !== "function") return null;
  try {
    const body = (await res.json()) as { error?: unknown } | null;
    const code = body?.error;
    return typeof code === "string" ? code : null;
  } catch {
    // A non-JSON error body tells us nothing; fall through to the generic path
    // rather than guessing. Never treat "unparseable" as "dark market".
    return null;
  }
}

/**
 * Notify a waitlist guest their table is ready — invokes the send-venue-sms edge
 * fn (#1541: the text now leaves through smsAdapter, so it inherits the market
 * kill switches, country routing and the delivery ledger; the fn still owns the
 * opt-out gate and the mark-notified RPC). E.164 validation + consent stay
 * server-side.
 *
 * #1541 — a 503 `sms_market_unavailable` is surfaced as a DISTINCT error, not
 * the generic "check the phone number" failure. The waitlist row is deliberately
 * left un-notified by the edge fn so the operator can retry once the market goes
 * live.
 */
export function useNotifyWaitlist(
  brandId: string | null,
  venueId: string | null,
): UseMutationResult<{ ok: boolean }, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<{ ok: boolean }, Error, string>({
    mutationFn: async (waitlistId: string): Promise<{ ok: boolean }> => {
      const { data, error } = await supabase.functions.invoke("send-venue-sms", {
        body: { waitlistId },
      });
      if (error !== null) {
        const code = await readInvokeErrorCode(error);
        if (code === SMS_MARKET_UNAVAILABLE_CODE) {
          throw new SmsMarketUnavailableError();
        }
        throw error as unknown as Error;
      }
      return { ok: (data as { ok?: boolean } | null)?.ok ?? false };
    },
    onSuccess: () => {
      if (brandId !== null && venueId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueWaitlistKeys.list(brandId, venueId),
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
  venueId: string | null,
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
      if (brandId !== null && venueId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueWaitlistKeys.list(brandId, venueId),
        });
        void queryClient.invalidateQueries({
          queryKey: venueReservationsKeys.list(brandId, venueId),
        });
      }
    },
  });
}
