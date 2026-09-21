/**
 * Issue #3386 — the host's venue details read + the four writes behind the
 * Venue details editor in venue Settings.
 *
 * Query keys come from `venueDetailsEditKeys` only. Every successful write
 * invalidates this venue's details AND the venue-listing keys the rest of the
 * venue page reads (name in the header, the Hub card), so nothing on screen
 * keeps the old name after a direct edit or an approval refetch.
 *
 * The read folds `isAuthReady` into `enabled` (ORCH-1004): `venue_listings` is
 * brand-member RLS, and a pre-auth fire would cache an empty 200.
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
  fetchVenueDetailsForHost,
  submitVenueDetailsChangeRequest,
  updateVenueContact,
  updateVenueIdentityInReview,
  withdrawVenueDetailsChangeRequest,
  type VenueContactInput,
  type VenueDetailsForHost,
  type VenueIdentityPatch,
} from "../services/venueDetailsEditService";
import { venueListingKeys } from "./useVenueListings";

export const venueDetailsEditKeys = {
  all: ["venueDetailsEdit"] as const,
  detail: (venueId: string): readonly ["venueDetailsEdit", "detail", string] =>
    [...venueDetailsEditKeys.all, "detail", venueId] as const,
};

const DISABLED_KEY = ["venueDetailsEdit", "detail", "disabled"] as const;

export function useVenueDetailsForHost(
  venueId: string | null,
): UseQueryResult<VenueDetailsForHost | null> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && venueId !== null && venueId.length > 0;
  return useQuery<VenueDetailsForHost | null>({
    queryKey: enabled ? venueDetailsEditKeys.detail(venueId) : DISABLED_KEY,
    enabled,
    staleTime: 15_000,
    queryFn: () =>
      enabled ? fetchVenueDetailsForHost(venueId) : Promise.resolve(null),
  });
}

function useInvalidateVenueDetails(
  venueId: string | null,
  brandId: string | null,
): () => void {
  const queryClient = useQueryClient();
  return () => {
    if (venueId !== null) {
      void queryClient.invalidateQueries({
        queryKey: venueDetailsEditKeys.detail(venueId),
      });
      void queryClient.invalidateQueries({
        queryKey: venueListingKeys.detail(venueId),
      });
    }
    if (brandId !== null) {
      void queryClient.invalidateQueries({
        queryKey: venueListingKeys.byBrand(brandId),
      });
    }
  };
}

export function useUpdateVenueContact(
  venueId: string | null,
  brandId: string | null,
): UseMutationResult<void, Error, Omit<VenueContactInput, "venueId">> {
  const invalidate = useInvalidateVenueDetails(venueId, brandId);
  return useMutation<void, Error, Omit<VenueContactInput, "venueId">>({
    mutationFn: (input) => {
      if (venueId === null) return Promise.reject(new Error("venue_not_found"));
      return updateVenueContact({ ...input, venueId });
    },
    onSuccess: invalidate,
  });
}

export function useUpdateVenueIdentityInReview(
  venueId: string | null,
  brandId: string | null,
): UseMutationResult<{ changed: boolean }, Error, VenueIdentityPatch> {
  const invalidate = useInvalidateVenueDetails(venueId, brandId);
  return useMutation<{ changed: boolean }, Error, VenueIdentityPatch>({
    mutationFn: (patch) => {
      if (venueId === null) return Promise.reject(new Error("venue_not_found"));
      return updateVenueIdentityInReview(venueId, patch);
    },
    onSuccess: invalidate,
  });
}

export function useSubmitVenueDetailsChangeRequest(
  venueId: string | null,
  brandId: string | null,
): UseMutationResult<
  { requestId: string; replaced: boolean },
  Error,
  VenueIdentityPatch
> {
  const invalidate = useInvalidateVenueDetails(venueId, brandId);
  return useMutation<
    { requestId: string; replaced: boolean },
    Error,
    VenueIdentityPatch
  >({
    mutationFn: (patch) => {
      if (venueId === null) return Promise.reject(new Error("venue_not_found"));
      return submitVenueDetailsChangeRequest(venueId, patch);
    },
    onSuccess: invalidate,
  });
}

export function useWithdrawVenueDetailsChangeRequest(
  venueId: string | null,
  brandId: string | null,
): UseMutationResult<void, Error, string | null> {
  const invalidate = useInvalidateVenueDetails(venueId, brandId);
  return useMutation<void, Error, string | null>({
    mutationFn: (requestId) => {
      if (venueId === null) return Promise.reject(new Error("venue_not_found"));
      return withdrawVenueDetailsChangeRequest(venueId, requestId);
    },
    onSuccess: invalidate,
  });
}
