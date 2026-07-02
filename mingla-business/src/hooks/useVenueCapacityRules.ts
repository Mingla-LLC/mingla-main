/**
 * META-ORCH-1148 sub-ORCH 2.1a — venue_capacity_rules data hook (MVP).
 *
 * List + upsert the brand's capacity rules. The form offers ONLY the 3 MVP
 * kinds (party_fit / deposit_threshold / blackout_scope — see capacityRules.ts);
 * this hook accepts only those kinds at the type level. RLS enforces
 * manager-plus write server-side.
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
  VenueCapacityRule,
  VenueCapacityRuleKind,
} from "../types/venueReservation";

interface VenueCapacityRuleRow {
  id: string;
  brand_id: string;
  venue_id: string;
  kind: VenueCapacityRuleKind;
  params: Record<string, unknown> | null;
  table_id: string | null;
  zone: VenueCapacityRule["zone"];
  is_active: boolean;
}

const RULE_COLUMNS = "id, brand_id, venue_id, kind, params, table_id, zone, is_active";

const mapRow = (row: VenueCapacityRuleRow): VenueCapacityRule => ({
  id: row.id,
  brandId: row.brand_id,
  venueId: row.venue_id,
  kind: row.kind,
  params: row.params ?? {},
  tableId: row.table_id,
  zone: row.zone,
  isActive: row.is_active,
});

export const venueCapacityRulesKeys = {
  // META-ORCH-1255 — venue-scoped, brandId-first (brand-prefix invalidation safe).
  list: (
    brandId: string,
    venueId: string,
  ): readonly ["venueCapacityRules", string, string] =>
    ["venueCapacityRules", brandId, venueId] as const,
};

export const fetchVenueCapacityRules = async (
  brandId: string,
  venueId: string,
): Promise<VenueCapacityRule[]> => {
  const { data, error } = await supabase
    .from("venue_capacity_rules")
    .select(RULE_COLUMNS)
    .eq("brand_id", brandId)
    .eq("venue_id", venueId)
    .returns<VenueCapacityRuleRow[]>();
  if (error !== null) throw error;
  return (data ?? []).map(mapRow);
};

export function useVenueCapacityRules(
  brandId: string | null,
  venueId: string | null,
): UseQueryResult<VenueCapacityRule[]> {
  const { isAuthReady } = useAuth();
  const enabled =
    isAuthReady &&
    brandId !== null &&
    brandId.length > 0 &&
    venueId !== null &&
    venueId.length > 0;
  return useQuery<VenueCapacityRule[]>({
    queryKey: enabled
      ? venueCapacityRulesKeys.list(brandId, venueId)
      : (["venueCapacityRules", "disabled"] as const),
    enabled,
    staleTime: 30_000,
    queryFn: () =>
      enabled
        ? fetchVenueCapacityRules(brandId, venueId)
        : Promise.resolve([]),
  });
}

export interface CapacityRuleUpsert {
  id?: string;
  /** MVP kinds only — the type prevents offering a deferred kind. */
  kind: VenueCapacityRuleKind;
  params: Record<string, unknown>;
  isActive: boolean;
}

export function useUpsertCapacityRule(
  brandId: string | null,
  venueId: string | null,
): UseMutationResult<void, Error, CapacityRuleUpsert> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, CapacityRuleUpsert>({
    mutationFn: async (input: CapacityRuleUpsert): Promise<void> => {
      if (brandId === null) throw new Error("brand_required");
      if (venueId === null) throw new Error("venue_required");
      const row: Record<string, unknown> = {
        brand_id: brandId,
        venue_id: venueId,
        kind: input.kind,
        params: input.params,
        is_active: input.isActive,
        updated_at: new Date().toISOString(),
      };
      if (input.id !== undefined) row.id = input.id;
      const { error } = await supabase
        .from("venue_capacity_rules")
        .upsert(row);
      if (error !== null) throw error as unknown as Error;
    },
    onSuccess: () => {
      if (brandId !== null && venueId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueCapacityRulesKeys.list(brandId, venueId),
        });
      }
    },
  });
}
