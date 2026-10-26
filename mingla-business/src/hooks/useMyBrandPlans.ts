// #4111 — the signed-in guest's own plans with a brand ("Your plans with
// {Brand}" in the message sheet). brand_enquiry_my_plans reads auth.uid(), so
// the query waits for isAuthReady (ORCH-1004) and is keyed by the user.
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { publicEnquiryKeys } from "./publicEnquiryKeys";

export function useMyBrandPlans(brandId: string | null, wanted: boolean) {
  const { user, isAuthReady } = useAuth();
  const userId = user?.id ?? null;
  return useQuery({
    queryKey: publicEnquiryKeys.myPlans(brandId ?? "", userId ?? ""),
    queryFn: async () =>
      (await import("../services/publicEnquiryService")).fetchMyBrandPlans(brandId as string),
    enabled: isAuthReady && wanted && !!brandId && !!userId,
    staleTime: 60_000,
    retry: 1,
  });
}
