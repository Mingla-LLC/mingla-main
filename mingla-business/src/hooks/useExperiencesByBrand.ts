/**
 * ORCH-0881 — React Query hook for venue experiences list.
 */

import { useQuery } from "@tanstack/react-query";

import {
  getExperiencesByBrand,
  type VenueExperience,
} from "../services/experiencesService";

export const experienceKeys = {
  all: ["experiences"] as const,
  listByBrand: (brandId: string) => [...experienceKeys.all, "list", brandId] as const,
};

export function useExperiencesByBrand(brandId: string | null) {
  return useQuery<VenueExperience[]>({
    queryKey: experienceKeys.listByBrand(brandId ?? ""),
    queryFn: () => getExperiencesByBrand(brandId!),
    enabled: brandId !== null && brandId.length > 0,
    staleTime: 60_000,
  });
}
