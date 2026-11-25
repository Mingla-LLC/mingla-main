/**
 * META-ORCH-1148 sub-ORCH 2.1a — venue_tables data hook.
 *
 * List + upsert (add/edit) + deactivate the brand's tables. RLS enforces
 * manager-plus write server-side; the UI gates the controls on rank. Mirrors the
 * established React-Query brand-hook pattern (auth-gated query + upsert mutation
 * + invalidate) — same shape as useVenueReservationSettings.
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
import {
  assignTable,
  fetchReservationVersion,
  fetchVenueFloorPlan,
  manageVenueTable,
  saveVenueFloorPlan,
  suggestTables,
  toVenueFloorError,
  VenueFloorError,
  type FloorPlaceWrite,
  type TableFields,
  type TableSuggestions,
  type VenueFloorPlan,
  type VenueFloorTable,
} from "../services/venueFloorService";
import { venueFeatureKeys } from "./venueFeatureKeys";
import type {
  VenueTable,
  VenueTableUpsert,
} from "../types/venueReservation";

interface VenueTableRow {
  id: string;
  brand_id: string;
  venue_id: string;
  place_pool_id: string | null;
  name: string;
  capacity: number;
  min_party: number | null;
  max_party: number | null;
  zone: VenueTable["zone"];
  seating_type: VenueTable["seatingType"];
  combinable: boolean;
  accessible: boolean;
  is_active: boolean;
  reservation_policy: VenueTable["reservationPolicy"];
  sort_order: number;
  notes: string | null;
}

const TABLE_COLUMNS =
  "id, brand_id, venue_id, place_pool_id, name, capacity, min_party, max_party, zone, seating_type, combinable, accessible, is_active, reservation_policy, sort_order, notes";

const mapRow = (row: VenueTableRow): VenueTable => ({
  id: row.id,
  brandId: row.brand_id,
  venueId: row.venue_id,
  placePoolId: row.place_pool_id,
  name: row.name,
  capacity: row.capacity,
  minParty: row.min_party,
  maxParty: row.max_party,
  zone: row.zone,
  seatingType: row.seating_type,
  combinable: row.combinable,
  accessible: row.accessible,
  isActive: row.is_active,
  reservationPolicy: row.reservation_policy,
  sortOrder: row.sort_order,
  notes: row.notes,
});

export const venueTablesKeys = {
  // META-ORCH-1255 — venue-scoped, brandId-first (brand-prefix invalidation safe).
  list: (
    brandId: string,
    venueId: string,
  ): readonly ["venueTables", string, string] =>
    ["venueTables", brandId, venueId] as const,
};

export const fetchVenueTables = async (
  brandId: string,
  // META-ORCH-1255 — tables are one-per-venue rows; scope reads per venue.
  // Optional so the pinned ORCH-1148 soft-delete contract call (brand-only)
  // keeps compiling; live callers always pass the venueId.
  venueId?: string | null,
): Promise<VenueTable[]> => {
  let query = supabase
    .from("venue_tables")
    .select(TABLE_COLUMNS)
    .eq("brand_id", brandId);
  if (venueId != null && venueId.length > 0) {
    query = query.eq("venue_id", venueId);
  }
  const { data, error } = await query
    // Exclude soft-deleted tables (deleted_at set) — they must vanish from the
    // operator list AND stop producing availability (the engine excludes them
    // too). Mirrors the engine's `AND t.deleted_at IS NULL`.
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .returns<VenueTableRow[]>();
  if (error !== null) throw error;
  return (data ?? []).map(mapRow);
};

export function useVenueTables(
  brandId: string | null,
  venueId: string | null,
): UseQueryResult<VenueTable[]> {
  const { isAuthReady } = useAuth();
  const enabled =
    isAuthReady &&
    brandId !== null &&
    brandId.length > 0 &&
    venueId !== null &&
    venueId.length > 0;
  return useQuery<VenueTable[]>({
    queryKey: enabled
      ? venueTablesKeys.list(brandId, venueId)
      : (["venueTables", "disabled"] as const),
    enabled,
    staleTime: 30_000,
    queryFn: () =>
      enabled ? fetchVenueTables(brandId, venueId) : Promise.resolve([]),
  });
}

/** Add (no id) or edit (id present) a table. Upsert on the PK. */
export function useUpsertVenueTable(
  brandId: string | null,
  venueId: string | null,
): UseMutationResult<void, Error, VenueTableUpsert> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, VenueTableUpsert>({
    mutationFn: async (input: VenueTableUpsert): Promise<void> => {
      if (brandId === null) throw new Error("brand_required");
      if (venueId === null) throw new Error("venue_required");
      const row: Record<string, unknown> = {
        brand_id: brandId,
        venue_id: venueId,
        name: input.name.trim(),
        capacity: input.capacity,
        min_party: input.minParty,
        max_party: input.maxParty,
        zone: input.zone,
        seating_type: input.seatingType,
        combinable: input.combinable,
        accessible: input.accessible,
        reservation_policy: input.reservationPolicy,
        notes: input.notes,
        updated_at: new Date().toISOString(),
      };
      if (input.id !== undefined) row.id = input.id;
      const { error } = await supabase.from("venue_tables").upsert(row);
      if (error !== null) throw error as unknown as Error;
    },
    onSuccess: () => {
      if (brandId !== null && venueId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueTablesKeys.list(brandId, venueId),
        });
      }
    },
  });
}

/**
 * Soft-DELETE a table via the guarded RPC (`biz_venue_table_soft_delete`).
 * Preserves reservation history (the row + FK stay; deleted_at is stamped). The
 * RPC is SECURITY DEFINER + manager+ gated server-side. Idempotent on the server
 * (already-deleted → no-op). On success the list (which filters deleted_at) and
 * the availability engine both stop seeing the table.
 */
export function useDeleteVenueTable(
  brandId: string | null,
  venueId: string | null = null,
): UseMutationResult<void, Error, { id: string }> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }): Promise<void> => {
      if (brandId === null) throw new Error("brand_required");
      const { error } = await supabase.rpc("biz_venue_table_soft_delete", {
        p_table_id: id,
      });
      if (error !== null) throw error as unknown as Error;
    },
    onSuccess: () => {
      if (brandId !== null && venueId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueTablesKeys.list(brandId, venueId),
        });
      }
    },
  });
}

/** Toggle a table active/inactive (deactivate = soft-remove). */
export function useSetVenueTableActive(
  brandId: string | null,
  venueId: string | null,
): UseMutationResult<void, Error, { id: string; isActive: boolean }> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { id: string; isActive: boolean }>({
    mutationFn: async ({ id, isActive }): Promise<void> => {
      if (brandId === null) throw new Error("brand_required");
      const { error } = await supabase
        .from("venue_tables")
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("brand_id", brandId);
      if (error !== null) throw error as unknown as Error;
    },
    onSuccess: () => {
      if (brandId !== null && venueId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueTablesKeys.list(brandId, venueId),
        });
      }
    },
  });
}

// ---------------------------------------------------------------------------
// #4490 P5-2 — tables in spaces and the floor plan (server RPCs).
// Kept in this registered auth-scoped hook file (orch-1004).
// ---------------------------------------------------------------------------

/** Everything a table or floor write can change. */
function invalidateFloorReaders(
  queryClient: ReturnType<typeof useQueryClient>,
  brandId: string,
  venueId: string,
): void {
  void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.floorAll(brandId, venueId) });
  void queryClient.invalidateQueries({ queryKey: venueTablesKeys.list(brandId, venueId) });
  void queryClient.invalidateQueries({ queryKey: ["venueReservations", brandId, venueId] });
}

/** The floor at a moment (`at` ISO, or null = now). */
export function useVenueFloorPlan(
  brandId: string | null,
  venueId: string | null,
  at: string | null,
  options: { refetchMs?: number | false } = {},
): UseQueryResult<VenueFloorPlan> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null && brandId.length > 0 && venueId !== null && venueId.length > 0;
  return useQuery<VenueFloorPlan>({
    queryKey: enabled ? venueFeatureKeys.floor(brandId, venueId, at ?? "") : (["venueFloor", "disabled"] as const),
    enabled,
    staleTime: 15_000,
    refetchInterval: options.refetchMs ?? false,
    // Keep the floor on screen while another moment loads (no flash, no lost buttons).
    placeholderData: (previous) => previous,
    queryFn: () => (enabled ? fetchVenueFloorPlan(venueId, at) : Promise.reject(new Error("disabled"))),
  });
}

export function useManageVenueTable(
  brandId: string | null,
  venueId: string | null,
): UseMutationResult<
  VenueFloorTable | null,
  VenueFloorError,
  { action: "create" | "update" | "archive"; tableId?: string; fields?: TableFields }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input) => {
      if (venueId === null) throw new VenueFloorError("venue_required");
      try {
        return await manageVenueTable({ venueId, ...input });
      } catch (e) {
        throw toVenueFloorError(e);
      }
    },
    onSettled: () => {
      if (brandId !== null && venueId !== null) invalidateFloorReaders(queryClient, brandId, venueId);
    },
  });
}

export function useSaveVenueFloorPlan(
  brandId: string | null,
  venueId: string | null,
): UseMutationResult<
  VenueFloorPlan,
  VenueFloorError,
  { spaceId: string; tables: FloorPlaceWrite[]; planShape?: Record<string, unknown>; expectedVersion: number }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input) => {
      if (venueId === null) throw new VenueFloorError("venue_required");
      try {
        return await saveVenueFloorPlan({ venueId, ...input });
      } catch (e) {
        throw toVenueFloorError(e);
      }
    },
    onSettled: () => {
      if (brandId !== null && venueId !== null) {
        invalidateFloorReaders(queryClient, brandId, venueId);
        // The space's version and plan shape changed.
        void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.spaces(brandId, venueId) });
      }
    },
  });
}

export function useTableSuggestions(
  brandId: string | null,
  venueId: string | null,
  booking: { reservationId: string; reservedFor: string; partySize: number } | null,
): UseQueryResult<TableSuggestions> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null && venueId !== null && booking !== null;
  return useQuery<TableSuggestions>({
    queryKey: enabled
      ? venueFeatureKeys.tableSuggestions(brandId, venueId, `${booking.reservationId}:${booking.reservedFor}:${booking.partySize}`)
      : (["venueTableSuggestions", "disabled"] as const),
    enabled,
    staleTime: 10_000,
    queryFn: () =>
      enabled
        ? suggestTables({
            venueId,
            reservedFor: booking.reservedFor,
            partySize: booking.partySize,
            reservationId: booking.reservationId,
          })
        : Promise.reject(new Error("disabled")),
  });
}

/** Give a booking a table (or two joined), move it, or clear it (empty list). */
export function useAssignTable(
  brandId: string | null,
  venueId: string | null,
): UseMutationResult<{ version: number }, VenueFloorError, { reservationId: string; tableIds: string[]; expectedVersion: number | null }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input) => {
      try {
        const expectedVersion = input.expectedVersion ?? (await fetchReservationVersion(input.reservationId));
        return await assignTable({ reservationId: input.reservationId, tableIds: input.tableIds, expectedVersion });
      } catch (e) {
        throw toVenueFloorError(e);
      }
    },
    onSettled: () => {
      if (brandId !== null && venueId !== null) {
        invalidateFloorReaders(queryClient, brandId, venueId);
        void queryClient.invalidateQueries({ queryKey: ["venueTableSuggestions", brandId, venueId] });
      }
    },
  });
}
