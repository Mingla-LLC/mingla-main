/**
 * #4490 P2 — venue offers, day limits and booking settings (React Query only;
 * constitution #5/#14). Every write invalidates the offers read, the day and
 * the features read (Entry being live changes the nav and the hub card).
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  fetchCapacityOverrides,
  fetchVenueOffers,
  manageCapacityPool,
  manageVenueOffer,
  saveBookingSettings,
  setCapacityOverride,
  type ManageOfferInput,
  type PoolInput,
} from "../services/venueOffersService";
import type {
  CapacityOverride,
  VenueBookingSettings,
  VenueCapacityPool,
  VenueOffer,
  VenueOffersState,
} from "../types/venueOffers";
import { venueFeatureKeys } from "./venueFeatureKeys";

function hasVenue(brandId: string | null, venueId: string | null): boolean {
  return brandId !== null && brandId.length > 0 && venueId !== null && venueId.length > 0;
}

export function useVenueOffers(
  brandId: string | null,
  venueId: string | null,
  options: { enabled?: boolean } = {},
): UseQueryResult<VenueOffersState> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && hasVenue(brandId, venueId) && options.enabled !== false;
  return useQuery<VenueOffersState>({
    queryKey: enabled
      ? venueFeatureKeys.offers(brandId as string, venueId as string)
      : (["venueOffers", "disabled"] as const),
    enabled,
    staleTime: 15_000,
    queryFn: () => fetchVenueOffers(venueId as string),
  });
}

function useInvalidateOffers(brandId: string | null, venueId: string | null): () => void {
  const queryClient = useQueryClient();
  return () => {
    if (brandId === null || venueId === null) return;
    void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.offers(brandId, venueId) });
    void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.dayAll(brandId, venueId) });
    void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.capacityOverrides(brandId, venueId) });
  };
}

export function useManageVenueOffer(
  brandId: string | null,
  venueId: string | null,
): UseMutationResult<VenueOffer, Error, Omit<ManageOfferInput, "venueId">> {
  const invalidate = useInvalidateOffers(brandId, venueId);
  return useMutation<VenueOffer, Error, Omit<ManageOfferInput, "venueId">>({
    mutationFn: (input) => {
      if (venueId === null) throw new Error("venue_required");
      return manageVenueOffer({ ...input, venueId });
    },
    onSettled: invalidate,
  });
}

export function useManageCapacityPool(
  brandId: string | null,
  venueId: string | null,
): UseMutationResult<VenueCapacityPool, Error, Omit<PoolInput, "venueId">> {
  const invalidate = useInvalidateOffers(brandId, venueId);
  return useMutation<VenueCapacityPool, Error, Omit<PoolInput, "venueId">>({
    mutationFn: (input) => {
      if (venueId === null) throw new Error("venue_required");
      return manageCapacityPool({ ...input, venueId });
    },
    onSettled: invalidate,
  });
}

export function useSaveBookingSettings(
  brandId: string | null,
  venueId: string | null,
): UseMutationResult<
  VenueBookingSettings | null,
  Error,
  {
    settings: Pick<
      VenueBookingSettings,
      "vatMode" | "instantPaymentHoldMinutes" | "bookingHorizonDays" | "bookingState"
    >;
    expectedVersion: number | null;
  }
> {
  const invalidate = useInvalidateOffers(brandId, venueId);
  return useMutation({
    mutationFn: (input) => {
      if (venueId === null) throw new Error("venue_required");
      return saveBookingSettings({ venueId, ...input });
    },
    onSettled: invalidate,
  });
}

export function useCapacityOverrides(
  brandId: string | null,
  venueId: string | null,
  fromDate: string,
): UseQueryResult<CapacityOverride[]> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && hasVenue(brandId, venueId);
  return useQuery<CapacityOverride[]>({
    queryKey: enabled
      ? [...venueFeatureKeys.capacityOverrides(brandId as string, venueId as string), fromDate]
      : (["venueCapacityOverrides", "disabled"] as const),
    enabled,
    staleTime: 30_000,
    queryFn: () => fetchCapacityOverrides(venueId as string, fromDate),
  });
}

export function useSetCapacityOverride(
  brandId: string | null,
  venueId: string | null,
): UseMutationResult<
  void,
  Error,
  {
    poolId: string;
    localDate: string;
    dailyLimit: number | null;
    keptForWalkIns: number | null;
    closed: boolean;
    clear: boolean;
  }
> {
  const invalidate = useInvalidateOffers(brandId, venueId);
  return useMutation({
    mutationFn: (input) => {
      if (venueId === null) throw new Error("venue_required");
      return setCapacityOverride({ venueId, ...input });
    },
    onSettled: invalidate,
  });
}
