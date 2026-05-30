/**
 * ORCH-0881 — React Query hook for venue experiences list.
 */

import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  getExperiencesByBrand,
  type VenueExperience,
} from "../services/experiencesService";

export const experienceKeys = {
  all: ["experiences"] as const,
  listByBrand: (brandId: string) => [...experienceKeys.all, "list", brandId] as const,
};

export function useExperiencesByBrand(brandId: string | null) {
  // ORCH-1004 — venue_experiences is RLS auth.uid()-scoped; gate on auth
  // readiness so a pre-auth fire can't cache an empty list as success.
  const { isAuthReady } = useAuth();
  return useQuery<VenueExperience[]>({
    queryKey: experienceKeys.listByBrand(brandId ?? ""),
    queryFn: () => getExperiencesByBrand(brandId!),
    enabled: isAuthReady && brandId !== null && brandId.length > 0,
    staleTime: 60_000,
  });
}
