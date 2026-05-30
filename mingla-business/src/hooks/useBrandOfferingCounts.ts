import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import { brandKeys } from "./useBrands";

export interface BrandOfferingCounts {
  events: number;
  trips: number;
  experiences: number;
}

const EMPTY_COUNTS: BrandOfferingCounts = {
  events: 0,
  trips: 0,
  experiences: 0,
};

export const fetchBrandOfferingCounts = async (
  brandId: string,
): Promise<BrandOfferingCounts> => {
  const { data, error } = await supabase.rpc("pg_brand_offering_counts", {
    p_brand_id: brandId,
  });

  if (error !== null) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    events: Number(row?.events ?? 0),
    trips: Number(row?.trips ?? 0),
    experiences: Number(row?.experiences ?? 0),
  };
};

export function useBrandOfferingCounts(
  brandId: string | null,
): UseQueryResult<BrandOfferingCounts> {
  // ORCH-1004 — pg_brand_offering_counts is SECURITY DEFINER but scopes its
  // counts to the caller's brand access; pre-auth it returns zero counts that
  // would cache as success. Gate on auth readiness.
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null && brandId.length > 0;
  return useQuery<BrandOfferingCounts>({
    queryKey: enabled
      ? brandKeys.offeringCounts(brandId)
      : (["brand", "disabled", "offeringCounts"] as const),
    enabled,
    staleTime: 30_000,
    queryFn: () => (enabled ? fetchBrandOfferingCounts(brandId) : EMPTY_COUNTS),
  });
}
