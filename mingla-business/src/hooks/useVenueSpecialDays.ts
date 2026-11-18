/**
 * #4490 — special days (a closed day, or replacement windows for one date).
 * Weekly hours stay on `useBrandHours` (ruling 2: one home, `brand_hours`).
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
  clearVenueSpecialDay,
  fetchVenueSpecialDays,
  setVenueSpecialDay,
  type HoursWindow,
  type VenueSpecialDay,
} from "../services/venueFeaturesService";
import { venueFeatureKeys } from "./venueFeatureKeys";
import { venueAvailabilityKeys } from "./venueAvailabilityKeys";

/** Today in the device's calendar as YYYY-MM-DD (special days from today on). */
export function localIsoDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function useVenueSpecialDays(
  brandId: string | null,
  venueId: string | null,
): UseQueryResult<VenueSpecialDay[]> {
  const { isAuthReady } = useAuth();
  const enabled =
    isAuthReady && brandId !== null && brandId.length > 0 && venueId !== null && venueId.length > 0;
  return useQuery<VenueSpecialDay[]>({
    queryKey: enabled
      ? venueFeatureKeys.specialDays(brandId, venueId)
      : (["venueSpecialDays", "disabled"] as const),
    enabled,
    staleTime: 30_000,
    queryFn: () => fetchVenueSpecialDays(venueId as string, localIsoDate()),
  });
}

export type SpecialDayMutationInput =
  | { action: "set"; localDate: string; isClosed: boolean; windows: HoursWindow[]; label: string | null }
  | { action: "clear"; localDate: string };

export function useManageVenueSpecialDay(
  brandId: string | null,
  venueId: string | null,
): UseMutationResult<void, Error, SpecialDayMutationInput> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, SpecialDayMutationInput>({
    mutationFn: async (input) => {
      if (venueId === null) throw new Error("venue_required");
      if (input.action === "set") {
        await setVenueSpecialDay({
          venueId,
          localDate: input.localDate,
          isClosed: input.isClosed,
          windows: input.windows,
          label: input.label,
        });
      } else {
        await clearVenueSpecialDay(venueId, input.localDate);
      }
    },
    onSettled: () => {
      if (brandId === null || venueId === null) return;
      void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.specialDays(brandId, venueId) });
      // Table slots honour special days.
      void queryClient.invalidateQueries({ queryKey: venueAvailabilityKeys.config(brandId) });
    },
  });
}
