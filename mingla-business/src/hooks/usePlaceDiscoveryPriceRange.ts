import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";

export interface PlaceDiscoveryPriceRangeRow {
  place_pool_id: string;
  brand_id: string | null;
  venue_id: string | null;
  status: "active" | "legacy_unresolved" | "reconciliation_required";
  source_min_minor: number | null;
  source_max_minor: number | null;
  source_currency_code: string | null;
  source_type:
    | "business_authored"
    | "provider"
    | "reconciled_conversion"
    | "legacy_unresolved";
  version: number;
  updated_at: string;
}

export const placeDiscoveryPriceRangeKeys = {
  all: ["place-discovery-price-range"] as const,
  detail: (placePoolId: string) =>
    [...placeDiscoveryPriceRangeKeys.all, placePoolId] as const,
  reconciliation: (brandId: string) =>
    [...placeDiscoveryPriceRangeKeys.all, "reconciliation", brandId] as const,
};

export function usePlaceDiscoveryPriceRange(
  placePoolId: string | null,
): UseQueryResult<PlaceDiscoveryPriceRangeRow | null, Error> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && placePoolId !== null;
  return useQuery({
    queryKey: placeDiscoveryPriceRangeKeys.detail(placePoolId ?? ""),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("place_discovery_price_ranges")
        .select(
          "place_pool_id, brand_id, venue_id, status, source_min_minor, source_max_minor, source_currency_code, source_type, version, updated_at",
        )
        .eq("place_pool_id", placePoolId ?? "")
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as PlaceDiscoveryPriceRangeRow | null;
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useBrandReconciliationPriceRanges(
  brandId: string | null,
): UseQueryResult<PlaceDiscoveryPriceRangeRow[], Error> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null;
  return useQuery({
    queryKey: placeDiscoveryPriceRangeKeys.reconciliation(brandId ?? ""),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("place_discovery_price_ranges")
        .select(
          "place_pool_id, brand_id, venue_id, status, source_min_minor, source_max_minor, source_currency_code, source_type, version, updated_at",
        )
        .eq("brand_id", brandId ?? "")
        .eq("status", "reconciliation_required")
        .order("place_pool_id", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PlaceDiscoveryPriceRangeRow[];
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
