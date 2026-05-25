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

type OfferingType = "event" | "trip" | "experience";

const countOfferingType = async (
  brandId: string,
  eventType: OfferingType,
): Promise<number> => {
  const { count, error } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("brand_id", brandId)
    .eq("event_type", eventType)
    .is("deleted_at", null);

  if (error !== null) throw error;
  return count ?? 0;
};

export const fetchBrandOfferingCounts = async (
  brandId: string,
): Promise<BrandOfferingCounts> => {
  const [events, trips, experiences] = await Promise.all([
    countOfferingType(brandId, "event"),
    countOfferingType(brandId, "trip"),
    countOfferingType(brandId, "experience"),
  ]);
  return { events, trips, experiences };
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
