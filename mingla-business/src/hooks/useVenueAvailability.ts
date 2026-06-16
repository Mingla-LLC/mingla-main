/**
 * META-ORCH-1148 sub-ORCH 2.1a — availability config + blackouts + the engine.
 *
 * Read/upsert the single venue_availability_config row (one per brand) + CRUD
 * over venue_blackouts, PLUS `useAvailableSlots` which calls the engine RPC
 * `pg_venue_available_slots`. The SAME hook is the single slot source for BOTH
 * the operator manual-create picker (2.1b) AND the 2.2 consumer picker —
 * I-PROPOSED-1148-AVAILABILITY-ENGINE-SOLE-SLOT-SOURCE. No client-side slot
 * generation lives anywhere in the venue components.
 */

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
  AvailableSlot,
  ServicePeriod,
  VenueAvailabilityConfig,
  VenueAvailabilityConfigPatch,
  VenueBlackout,
  VenueBlackoutUpsert,
} from "../types/venueReservation";

/* ----------------------------- config ----------------------------------- */

interface VenueAvailabilityConfigRow {
  brand_id: string;
  service_periods: ServicePeriod[] | null;
  turn_times: Record<string, number> | null;
  buffer_minutes: number;
  max_reservations_per_slot: number | null;
  slot_granularity_minutes: number;
  advance_window_days: number;
  min_notice_minutes: number;
}

const CONFIG_COLUMNS =
  "brand_id, service_periods, turn_times, buffer_minutes, max_reservations_per_slot, slot_granularity_minutes, advance_window_days, min_notice_minutes";

const mapConfigRow = (
  row: VenueAvailabilityConfigRow,
): VenueAvailabilityConfig => ({
  brandId: row.brand_id,
  servicePeriods: row.service_periods ?? [],
  turnTimes: row.turn_times ?? {},
  bufferMinutes: row.buffer_minutes,
  maxReservationsPerSlot: row.max_reservations_per_slot,
  slotGranularityMinutes: row.slot_granularity_minutes,
  advanceWindowDays: row.advance_window_days,
  minNoticeMinutes: row.min_notice_minutes,
});

export const venueAvailabilityKeys = {
  config: (brandId: string): readonly ["venueAvailabilityConfig", string] =>
    ["venueAvailabilityConfig", brandId] as const,
  blackouts: (brandId: string): readonly ["venueBlackouts", string] =>
    ["venueBlackouts", brandId] as const,
  slots: (
    brandId: string,
    date: string,
    partySize: number,
  ): readonly ["venueAvailableSlots", string, string, number] =>
    ["venueAvailableSlots", brandId, date, partySize] as const,
};

export const fetchVenueAvailabilityConfig = async (
  brandId: string,
): Promise<VenueAvailabilityConfig | null> => {
  const { data, error } = await supabase
    .from("venue_availability_config")
    .select(CONFIG_COLUMNS)
    .eq("brand_id", brandId)
    .maybeSingle<VenueAvailabilityConfigRow>();
  if (error !== null) throw error;
  return data === null ? null : mapConfigRow(data);
};

export function useVenueAvailabilityConfig(
  brandId: string | null,
): UseQueryResult<VenueAvailabilityConfig | null> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null && brandId.length > 0;
  return useQuery<VenueAvailabilityConfig | null>({
    queryKey: enabled
      ? venueAvailabilityKeys.config(brandId)
      : (["venueAvailabilityConfig", "disabled"] as const),
    enabled,
    staleTime: 30_000,
    queryFn: () =>
      enabled
        ? fetchVenueAvailabilityConfig(brandId)
        : Promise.resolve(null),
  });
}

export function useUpsertVenueAvailabilityConfig(
  brandId: string | null,
): UseMutationResult<void, Error, VenueAvailabilityConfigPatch> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, VenueAvailabilityConfigPatch>({
    mutationFn: async (patch: VenueAvailabilityConfigPatch): Promise<void> => {
      if (brandId === null) throw new Error("brand_required");
      const row: Record<string, unknown> = {
        brand_id: brandId,
        updated_at: new Date().toISOString(),
      };
      if (patch.servicePeriods !== undefined) {
        row.service_periods = patch.servicePeriods;
      }
      if (patch.turnTimes !== undefined) row.turn_times = patch.turnTimes;
      if (patch.bufferMinutes !== undefined) {
        row.buffer_minutes = patch.bufferMinutes;
      }
      if (patch.maxReservationsPerSlot !== undefined) {
        row.max_reservations_per_slot = patch.maxReservationsPerSlot;
      }
      if (patch.slotGranularityMinutes !== undefined) {
        row.slot_granularity_minutes = patch.slotGranularityMinutes;
      }
      if (patch.advanceWindowDays !== undefined) {
        row.advance_window_days = patch.advanceWindowDays;
      }
      if (patch.minNoticeMinutes !== undefined) {
        row.min_notice_minutes = patch.minNoticeMinutes;
      }
      const { error } = await supabase
        .from("venue_availability_config")
        .upsert(row, { onConflict: "brand_id" });
      if (error !== null) throw error as unknown as Error;
    },
    onSuccess: () => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueAvailabilityKeys.config(brandId),
        });
      }
    },
  });
}

/* ----------------------------- blackouts -------------------------------- */

interface VenueBlackoutRow {
  id: string;
  brand_id: string;
  date_start: string;
  date_end: string;
  reason: string | null;
  applies_to: VenueBlackout["appliesTo"];
  zone: VenueBlackout["zone"];
  table_id: string | null;
}

const BLACKOUT_COLUMNS =
  "id, brand_id, date_start, date_end, reason, applies_to, zone, table_id";

const mapBlackoutRow = (row: VenueBlackoutRow): VenueBlackout => ({
  id: row.id,
  brandId: row.brand_id,
  dateStart: row.date_start,
  dateEnd: row.date_end,
  reason: row.reason,
  appliesTo: row.applies_to,
  zone: row.zone,
  tableId: row.table_id,
});

export const fetchVenueBlackouts = async (
  brandId: string,
): Promise<VenueBlackout[]> => {
  const { data, error } = await supabase
    .from("venue_blackouts")
    .select(BLACKOUT_COLUMNS)
    .eq("brand_id", brandId)
    .order("date_start", { ascending: true })
    .returns<VenueBlackoutRow[]>();
  if (error !== null) throw error;
  return (data ?? []).map(mapBlackoutRow);
};

export function useVenueBlackouts(
  brandId: string | null,
): UseQueryResult<VenueBlackout[]> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null && brandId.length > 0;
  return useQuery<VenueBlackout[]>({
    queryKey: enabled
      ? venueAvailabilityKeys.blackouts(brandId)
      : (["venueBlackouts", "disabled"] as const),
    enabled,
    staleTime: 30_000,
    queryFn: () =>
      enabled ? fetchVenueBlackouts(brandId) : Promise.resolve([]),
  });
}

export function useUpsertVenueBlackout(
  brandId: string | null,
): UseMutationResult<void, Error, VenueBlackoutUpsert> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, VenueBlackoutUpsert>({
    mutationFn: async (input: VenueBlackoutUpsert): Promise<void> => {
      if (brandId === null) throw new Error("brand_required");
      const row: Record<string, unknown> = {
        brand_id: brandId,
        date_start: input.dateStart,
        date_end: input.dateEnd,
        reason: input.reason,
        applies_to: input.appliesTo,
        zone: input.appliesTo === "zone" ? input.zone : null,
        table_id: input.appliesTo === "table" ? input.tableId : null,
        updated_at: new Date().toISOString(),
      };
      if (input.id !== undefined) row.id = input.id;
      const { error } = await supabase.from("venue_blackouts").upsert(row);
      if (error !== null) throw error as unknown as Error;
    },
    onSuccess: () => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueAvailabilityKeys.blackouts(brandId),
        });
      }
    },
  });
}

export function useDeleteVenueBlackout(
  brandId: string | null,
): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id: string): Promise<void> => {
      if (brandId === null) throw new Error("brand_required");
      const { error } = await supabase
        .from("venue_blackouts")
        .delete()
        .eq("id", id)
        .eq("brand_id", brandId);
      if (error !== null) throw error as unknown as Error;
    },
    onSuccess: () => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueAvailabilityKeys.blackouts(brandId),
        });
      }
    },
  });
}

/* --------------------------- the engine RPC ------------------------------ */

interface AvailableSlotRow {
  slot_start_utc: string;
  slot_local_label: string;
  remaining: number;
  is_full: boolean;
}

/**
 * Call the engine RPC. The SOLE slot source — no component hand-rolls a slot
 * list (I-PROPOSED-1148-AVAILABILITY-ENGINE-SOLE-SLOT-SOURCE).
 */
export const fetchAvailableSlots = async (
  brandId: string,
  date: string,
  partySize: number,
): Promise<AvailableSlot[]> => {
  const { data, error } = await supabase.rpc("pg_venue_available_slots", {
    p_brand_id: brandId,
    p_date: date,
    p_party_size: partySize,
  });
  if (error !== null) throw error;
  const rows = (data ?? []) as AvailableSlotRow[];
  return rows.map((r) => ({
    slotStartUtc: r.slot_start_utc,
    slotLocalLabel: r.slot_local_label,
    remaining: r.remaining,
    isFull: r.is_full,
  }));
};

export function useAvailableSlots(
  brandId: string | null,
  date: string | null,
  partySize: number | null,
): UseQueryResult<AvailableSlot[]> {
  const { isAuthReady } = useAuth();
  const enabled =
    isAuthReady &&
    brandId !== null &&
    brandId.length > 0 &&
    date !== null &&
    partySize !== null &&
    partySize >= 1;
  return useQuery<AvailableSlot[]>({
    queryKey: enabled
      ? venueAvailabilityKeys.slots(brandId, date, partySize)
      : (["venueAvailableSlots", "disabled"] as const),
    enabled,
    staleTime: 15_000,
    queryFn: () =>
      enabled
        ? fetchAvailableSlots(brandId, date, partySize)
        : Promise.resolve([]),
  });
}
