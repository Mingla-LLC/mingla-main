import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { supabase } from "../services/supabase";

/**
 * useVenueAvailability — META-ORCH-1148 sub-ORCH 2.2b (SPEC §4.D).
 * ---------------------------------------------------------------------------
 * Reads the truthful availability ENGINE `pg_venue_available_slots(brand,date,
 * party_size)` (anon+authenticated EXECUTE post-2.2a keystone grant). The engine
 * is the SOLE slot source — this hook NEVER fabricates slots: an empty array =
 * "fully booked", NOT a fallback (I-PROPOSED-1148-AVAILABILITY-ENGINE-SOLE-SLOT-
 * SOURCE). Short staleTime — slots go stale fast as other guests book.
 *
 * `date` is the venue-local calendar day (YYYY-MM-DD). The engine derives the
 * venue IANA tz internally and emits each slot's UTC instant + a local label.
 * `enabled` only when all three params are set (the picker is on the slot step).
 */

export interface VenueSlot {
  /** UTC instant of the slot start (ISO 8601) — what we reserve against. */
  slotStartUtc: string;
  /** Venue-local HH:MM label from the engine. */
  label: string;
  /** Remaining seats; null = unlimited. */
  remaining: number | null;
  isFull: boolean;
}

interface EngineSlotRow {
  slot_start_utc: string;
  slot_local_label: string;
  remaining: number | null;
  is_full: boolean;
}

export const venueAvailabilityKeys = {
  all: ["venueAvailability"] as const,
  query: (brandId: string, date: string, partySize: number) =>
    [...venueAvailabilityKeys.all, brandId, date, partySize] as const,
};

async function fetchVenueSlots(
  brandId: string,
  date: string,
  partySize: number,
): Promise<VenueSlot[]> {
  const { data, error } = await supabase.rpc("pg_venue_available_slots", {
    p_brand_id: brandId,
    p_date: date,
    p_party_size: partySize,
  });
  if (error !== null) throw error;
  const rows = (data ?? []) as EngineSlotRow[];
  return rows.map((r) => ({
    slotStartUtc: r.slot_start_utc,
    label: r.slot_local_label,
    remaining: r.remaining,
    isFull: r.is_full === true,
  }));
}

export function useVenueAvailability(
  brandId: string | null | undefined,
  date: string | null | undefined,
  partySize: number | null | undefined,
): UseQueryResult<VenueSlot[]> {
  const enabled =
    typeof brandId === "string" &&
    brandId.length > 0 &&
    typeof date === "string" &&
    date.length > 0 &&
    typeof partySize === "number" &&
    Number.isInteger(partySize) &&
    partySize >= 1;
  return useQuery({
    queryKey: venueAvailabilityKeys.query(
      brandId ?? "none",
      date ?? "none",
      partySize ?? 0,
    ),
    queryFn: () =>
      fetchVenueSlots(brandId as string, date as string, partySize as number),
    enabled,
    // Slots go stale fast — short window, refetch on focus.
    staleTime: 30 * 1000,
    gcTime: 60 * 1000,
  });
}
