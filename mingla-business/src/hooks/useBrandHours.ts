/**
 * ORCH-1186-A — read/write the brand's opening hours (`brand_hours`) for the
 * venue Settings tab. `brand_hours` is the SINGLE OWNER of opening hours
 * (DEC-B); the upsert RPC re-derives `venue_availability_config.service_periods`
 * server-side (the live bridge), so on save we MUST invalidate BOTH the hours
 * cache AND the Availability config cache — the seeded reservation periods are
 * now stale (SC-3).
 *
 * Server state stays in React Query (constitution #5/#14) — hours are NEVER
 * parked in Zustand.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { fetchBrandHours, upsertBrandHours } from "../services/brandsService";
import type { BrandHourEntry } from "../types/brand";
import { venueAvailabilityKeys } from "./useVenueAvailability";

export const brandHoursKeys = {
  // META-ORCH-1255 — venue-scoped, brandId-first: the pinned brand-prefix
  // invalidation `brandHoursKeys.byBrand(brandId)` keeps matching every venue.
  byBrand: (
    brandId: string,
    venueId?: string,
  ): readonly string[] =>
    venueId === undefined
      ? (["brandHours", brandId] as const)
      : (["brandHours", brandId, venueId] as const),
};

export function useBrandHours(
  brandId: string | null,
  venueId: string | null,
): UseQueryResult<BrandHourEntry[]> {
  const { isAuthReady } = useAuth();
  const enabled =
    isAuthReady &&
    brandId !== null &&
    brandId.length > 0 &&
    venueId !== null &&
    venueId.length > 0;
  return useQuery<BrandHourEntry[]>({
    queryKey:
      enabled
        ? brandHoursKeys.byBrand(brandId, venueId)
        : (["brandHours", "disabled"] as const),
    enabled,
    staleTime: 30_000,
    queryFn: () =>
      enabled ? fetchBrandHours(brandId, venueId) : Promise.resolve([]),
  });
}

export function useUpsertBrandHours(
  brandId: string | null,
  venueId: string | null,
): UseMutationResult<void, Error, BrandHourEntry[]> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, BrandHourEntry[]>({
    mutationFn: async (hours: BrandHourEntry[]): Promise<void> => {
      if (brandId === null) throw new Error("brand_required");
      // META-ORCH-1255 — the upsert RPC is venue-keyed (one week per venue).
      if (venueId === null) throw new Error("venue_required");
      await upsertBrandHours(venueId, hours);
    },
    onSuccess: () => {
      if (brandId === null) return;
      // The hours changed. Brand-prefix invalidation reaches every venue's
      // hours key: brandHoursKeys.byBrand(brandId)
      void queryClient.invalidateQueries({
        queryKey: brandHoursKeys.byBrand(brandId),
      });
      // The live bridge (biz_upsert_brand_hours → derive helper) re-wrote
      // venue_availability_config.service_periods, so the Availability module's
      // cached config is now stale — REQUIRED cross-invalidation (SC-3).
      // Brand-prefix match: venueAvailabilityKeys.config(brandId)
      void queryClient.invalidateQueries({
        queryKey: venueAvailabilityKeys.config(brandId),
      });
    },
  });
}
