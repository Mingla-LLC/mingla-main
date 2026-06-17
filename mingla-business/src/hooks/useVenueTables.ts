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
import type {
  VenueTable,
  VenueTableUpsert,
} from "../types/venueReservation";

interface VenueTableRow {
  id: string;
  brand_id: string;
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
  "id, brand_id, place_pool_id, name, capacity, min_party, max_party, zone, seating_type, combinable, accessible, is_active, reservation_policy, sort_order, notes";

const mapRow = (row: VenueTableRow): VenueTable => ({
  id: row.id,
  brandId: row.brand_id,
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
  list: (brandId: string): readonly ["venueTables", string] =>
    ["venueTables", brandId] as const,
};

export const fetchVenueTables = async (
  brandId: string,
): Promise<VenueTable[]> => {
  const { data, error } = await supabase
    .from("venue_tables")
    .select(TABLE_COLUMNS)
    .eq("brand_id", brandId)
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
): UseQueryResult<VenueTable[]> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null && brandId.length > 0;
  return useQuery<VenueTable[]>({
    queryKey: enabled
      ? venueTablesKeys.list(brandId)
      : (["venueTables", "disabled"] as const),
    enabled,
    staleTime: 30_000,
    queryFn: () => (enabled ? fetchVenueTables(brandId) : Promise.resolve([])),
  });
}

/** Add (no id) or edit (id present) a table. Upsert on the PK. */
export function useUpsertVenueTable(
  brandId: string | null,
): UseMutationResult<void, Error, VenueTableUpsert> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, VenueTableUpsert>({
    mutationFn: async (input: VenueTableUpsert): Promise<void> => {
      if (brandId === null) throw new Error("brand_required");
      const row: Record<string, unknown> = {
        brand_id: brandId,
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
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueTablesKeys.list(brandId),
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
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueTablesKeys.list(brandId),
        });
      }
    },
  });
}

/** Toggle a table active/inactive (deactivate = soft-remove). */
export function useSetVenueTableActive(
  brandId: string | null,
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
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueTablesKeys.list(brandId),
        });
      }
    },
  });
}
