import { useQuery, type UseQueryResult } from "@tanstack/react-query";

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
  const enabled = brandId !== null && brandId.length > 0;
  return useQuery<BrandOfferingCounts>({
    queryKey: enabled
      ? brandKeys.offeringCounts(brandId)
      : (["brand", "disabled", "offeringCounts"] as const),
    enabled,
    staleTime: 30_000,
    queryFn: () => (enabled ? fetchBrandOfferingCounts(brandId) : EMPTY_COUNTS),
  });
}
