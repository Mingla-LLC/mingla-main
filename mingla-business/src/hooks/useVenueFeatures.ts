/**
 * #4490 — venue features: read, switch (with cascade) and apply a preset.
 * Server state lives in React Query only (constitution #5/#14).
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
  applyFeaturePreset,
  fetchVenueFeatures,
  setVenueFeature,
  type ApplyPresetResult,
  type SetVenueFeatureInput,
  type SetVenueFeatureResult,
} from "../services/venueFeaturesService";
import type { VenueFeatureState, VenueTypeKey } from "../types/venueFeatures";
import { venueFeatureKeys } from "./venueFeatureKeys";
import { venueReservationSettingsKeys } from "./venueReservationSettingsKeys";

export function useVenueFeatures(
  brandId: string | null,
  venueId: string | null,
): UseQueryResult<VenueFeatureState> {
  const { isAuthReady } = useAuth();
  const enabled =
    isAuthReady && brandId !== null && brandId.length > 0 && venueId !== null && venueId.length > 0;
  return useQuery<VenueFeatureState>({
    queryKey: enabled
      ? venueFeatureKeys.features(brandId, venueId)
      : (["venueFeatures", "disabled"] as const),
    enabled,
    staleTime: 30_000,
    queryFn: () => fetchVenueFeatures(venueId as string),
  });
}

function invalidateVenueFeatureReaders(
  queryClient: ReturnType<typeof useQueryClient>,
  brandId: string,
  venueId: string,
): void {
  void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.features(brandId, venueId) });
  // The server mirrors table reservations / ordering into the legacy switches.
  void queryClient.invalidateQueries({
    queryKey: venueReservationSettingsKeys.detail(brandId, venueId),
  });
  void queryClient.invalidateQueries({ queryKey: ["venueOrderingSettings"] });
}

export function useSetVenueFeature(
  brandId: string | null,
  venueId: string | null,
): UseMutationResult<SetVenueFeatureResult, Error, Omit<SetVenueFeatureInput, "venueId">> {
  const queryClient = useQueryClient();
  return useMutation<SetVenueFeatureResult, Error, Omit<SetVenueFeatureInput, "venueId">>({
    mutationFn: (input) => {
      if (venueId === null) throw new Error("venue_required");
      return setVenueFeature({ ...input, venueId });
    },
    onSuccess: (result) => {
      if (brandId === null || venueId === null) return;
      queryClient.setQueryData(venueFeatureKeys.features(brandId, venueId), result.state);
      invalidateVenueFeatureReaders(queryClient, brandId, venueId);
    },
    onError: () => {
      if (brandId === null || venueId === null) return;
      // A stale write or a refusal: reload the truth so the switches match it.
      void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.features(brandId, venueId) });
    },
  });
}

export function useApplyFeaturePreset(
  brandId: string | null,
): UseMutationResult<ApplyPresetResult, Error, { venueId: string; category: VenueTypeKey }> {
  const queryClient = useQueryClient();
  return useMutation<ApplyPresetResult, Error, { venueId: string; category: VenueTypeKey }>({
    mutationFn: ({ venueId, category }) => applyFeaturePreset(venueId, category),
    onSuccess: (result, { venueId }) => {
      if (brandId === null) return;
      queryClient.setQueryData(venueFeatureKeys.features(brandId, venueId), result.state);
      invalidateVenueFeatureReaders(queryClient, brandId, venueId);
    },
  });
}
