// #4111 — anon-tolerant reads behind the brand page's Message card (and the
// cancel page's brand). The signed-in plans read lives in useMyBrandPlans. The service (and Supabase) load only when
// a query runs, so a page that imports these hooks stays light.
import { useQuery } from "@tanstack/react-query";

import { publicEnquiryKeys } from "./publicEnquiryKeys";

export function usePublicBrandEnquiryProfile(brandId: string | null) {
  return useQuery({
    queryKey: publicEnquiryKeys.profile(brandId ?? ""),
    queryFn: async () =>
      (await import("../services/publicEnquiryService")).fetchBrandEnquiryProfile(brandId as string),
    enabled: !!brandId,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

/** #4111 — the cancel page's brand (it only knows the slug). */
export function usePublicBrandIdentity(slug: string | null) {
  return useQuery({
    queryKey: publicEnquiryKeys.brandIdentity(slug ?? ""),
    queryFn: async () =>
      (await import("../services/publicEnquiryService")).fetchPublicBrandIdentity(slug as string),
    enabled: !!slug,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}
