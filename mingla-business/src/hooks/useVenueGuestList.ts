/** #4490 07-I — host guest-list reads and writes. */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  fetchGuestListDay,
  manageGuestList,
  type ManageGuestListAction,
} from "../services/venueOffersService";
import type { VenueGuestListDay } from "../types/venueOffers";
import { venueFeatureKeys } from "./venueFeatureKeys";

export function useVenueGuestList(
  brandId: string | null,
  venueId: string | null,
  localDate: string | null,
): UseQueryResult<VenueGuestListDay> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null && venueId !== null;
  return useQuery({
    queryKey: enabled
      ? venueFeatureKeys.guestList(brandId as string, venueId as string, localDate ?? "today")
      : (["venueGuestLists", "disabled"] as const),
    enabled,
    staleTime: 10_000,
    refetchInterval: 30_000,
    queryFn: () => fetchGuestListDay(venueId as string, localDate),
  });
}

export interface GuestListMutation {
  action: ManageGuestListAction;
  payload: Record<string, unknown>;
  expectedVersion?: number | null;
}

export function useManageVenueGuestList(
  brandId: string | null,
  venueId: string | null,
): UseMutationResult<Record<string, unknown>, Error, GuestListMutation> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => {
      if (venueId === null) throw new Error("venue_required");
      return manageGuestList({ venueId, ...input });
    },
    onSettled: () => {
      if (brandId === null || venueId === null) return;
      void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.guestListsAll(brandId, venueId) });
      void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.checkInsAll(brandId, venueId) });
      void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.dayAll(brandId, venueId) });
    },
  });
}
