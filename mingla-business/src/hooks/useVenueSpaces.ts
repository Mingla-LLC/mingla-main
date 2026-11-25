/**
 * #4490 — venue spaces and combinations (read + every write through
 * `issue_4490_manage_space` / `issue_4490_manage_space_combination`).
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
  archiveVenueSpace,
  createVenueSpace,
  fetchVenueSpaceCombinations,
  fetchVenueSpaces,
  manageSpaceCombination,
  updateVenueSpace,
  type SpaceDraft,
  type VenueSpace,
  type VenueSpaceCombination,
} from "../services/venueFeaturesService";
import { venueFeatureKeys } from "./venueFeatureKeys";

function hasVenue(brandId: string | null, venueId: string | null): boolean {
  return brandId !== null && brandId.length > 0 && venueId !== null && venueId.length > 0;
}

export function useVenueSpaces(
  brandId: string | null,
  venueId: string | null,
): UseQueryResult<VenueSpace[]> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && hasVenue(brandId, venueId);
  return useQuery<VenueSpace[]>({
    queryKey: enabled
      ? venueFeatureKeys.spaces(brandId as string, venueId as string)
      : (["venueSpaces", "disabled"] as const),
    enabled,
    staleTime: 30_000,
    queryFn: () => fetchVenueSpaces(venueId as string),
  });
}

export function useVenueSpaceCombinations(
  brandId: string | null,
  venueId: string | null,
): UseQueryResult<VenueSpaceCombination[]> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && hasVenue(brandId, venueId);
  return useQuery<VenueSpaceCombination[]>({
    queryKey: enabled
      ? venueFeatureKeys.spaceCombinations(brandId as string, venueId as string)
      : (["venueSpaceCombinations", "disabled"] as const),
    enabled,
    staleTime: 30_000,
    queryFn: () => fetchVenueSpaceCombinations(venueId as string),
  });
}

function useInvalidateSpaces(brandId: string | null, venueId: string | null): () => void {
  const queryClient = useQueryClient();
  return () => {
    if (brandId === null || venueId === null) return;
    void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.spaces(brandId, venueId) });
    void queryClient.invalidateQueries({
      queryKey: venueFeatureKeys.spaceCombinations(brandId, venueId),
    });
    // active_space_count lives on the features read (nav and blocked_by).
    void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.features(brandId, venueId) });
  };
}

export type SpaceMutationInput =
  | { action: "create"; draft: SpaceDraft }
  | { action: "update"; spaceId: string; patch: Record<string, unknown>; expectedVersion: number | null }
  | { action: "archive"; spaceId: string; expectedVersion: number | null };

export function useManageVenueSpace(
  brandId: string | null,
  venueId: string | null,
): UseMutationResult<VenueSpace | null, Error, SpaceMutationInput> {
  const invalidate = useInvalidateSpaces(brandId, venueId);
  return useMutation<VenueSpace | null, Error, SpaceMutationInput>({
    mutationFn: async (input) => {
      if (venueId === null) throw new Error("venue_required");
      if (input.action === "create") return createVenueSpace(venueId, input.draft);
      if (input.action === "update") {
        return updateVenueSpace(venueId, input.spaceId, input.patch, input.expectedVersion);
      }
      await archiveVenueSpace(venueId, input.spaceId, input.expectedVersion);
      return null;
    },
    onSettled: invalidate,
  });
}

export type CombinationMutationInput =
  | { action: "create"; name: string; spaceIds: string[] }
  | { action: "update"; id: string; name: string; spaceIds: string[]; expectedVersion: number | null }
  | { action: "archive"; id: string; expectedVersion: number | null };

export function useManageSpaceCombination(
  brandId: string | null,
  venueId: string | null,
): UseMutationResult<void, Error, CombinationMutationInput> {
  const invalidate = useInvalidateSpaces(brandId, venueId);
  return useMutation<void, Error, CombinationMutationInput>({
    mutationFn: async (input) => {
      if (venueId === null) throw new Error("venue_required");
      if (input.action === "create") {
        await manageSpaceCombination("create", venueId, { name: input.name, spaceIds: input.spaceIds }, null);
      } else if (input.action === "update") {
        await manageSpaceCombination(
          "update",
          venueId,
          { id: input.id, name: input.name, spaceIds: input.spaceIds },
          input.expectedVersion,
        );
      } else {
        await manageSpaceCombination("archive", venueId, { id: input.id }, input.expectedVersion);
      }
    },
    onSettled: invalidate,
  });
}
