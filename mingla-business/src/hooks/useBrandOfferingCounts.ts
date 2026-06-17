import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import { brandKeys } from "./useBrands";

export interface BrandOfferingCounts {
  events: number;
  trips: number;
  experiences: number;
  // ORCH-1154 A.5.1 — draft (published_at IS NULL) counts, ADDED alongside the
  // published-only counts above. The Hub tab gate ORs published+draft per type
  // (useHubTabs) so a draft-only brand's offering tab becomes visible. The
  // published columns above are UNCHANGED — public/published-only consumers
  // (public brand page, events-screen empty-state copy) are unaffected.
  events_draft: number;
  trips_draft: number;
  experiences_draft: number;
}

const EMPTY_COUNTS: BrandOfferingCounts = {
  events: 0,
  trips: 0,
  experiences: 0,
  events_draft: 0,
  trips_draft: 0,
  experiences_draft: 0,
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
    // ORCH-1154 — defensive `?? 0` so a pre-migration RPC response during
    // rollout (no *_draft columns yet) degrades to today's behavior (tab stays
    // hidden) instead of NaN/crash. Backend-first ordering avoids this path.
    events_draft: Number(row?.events_draft ?? 0),
    trips_draft: Number(row?.trips_draft ?? 0),
    experiences_draft: Number(row?.experiences_draft ?? 0),
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
