import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  getStayInventory,
  publishStay,
  saveStaySettings,
} from "../services/stayInventoryService";
import type {
  StayInventorySnapshot,
  StaySettingsInput,
} from "../types/stayInventory";

export const stayInventoryKeys = {
  all: ["stay-inventory"] as const,
  detail: (venueId: string) => [...stayInventoryKeys.all, venueId] as const,
};

export function useStayInventory(
  venueId: string | null,
): UseQueryResult<StayInventorySnapshot, Error> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && venueId !== null && venueId.length > 0;
  return useQuery({
    queryKey: enabled
      ? stayInventoryKeys.detail(venueId)
      : (["stay-inventory", "disabled"] as const),
    enabled,
    staleTime: 10_000,
    queryFn: () =>
      enabled
        ? getStayInventory(venueId)
        : Promise.reject(new Error("Stay venue is unavailable.")),
  });
}

export function useSaveStaySettings(
  venueId: string | null,
): UseMutationResult<
  { inventory: StayInventorySnapshot },
  Error,
  { settings: StaySettingsInput; expectedVersion: number | null }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ settings, expectedVersion }) => {
      if (venueId === null) throw new Error("Stay venue is unavailable.");
      return saveStaySettings({ venueId, settings, expectedVersion });
    },
    onSuccess: ({ inventory }) => {
      if (venueId !== null) {
        queryClient.setQueryData(stayInventoryKeys.detail(venueId), inventory);
      }
    },
  });
}

export function usePublishStay(
  venueId: string | null,
): UseMutationResult<
  { inventory: StayInventorySnapshot },
  Error,
  { expectedVersion: number }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ expectedVersion }) => {
      if (venueId === null) throw new Error("Stay venue is unavailable.");
      return publishStay({ venueId, expectedVersion });
    },
    onSuccess: ({ inventory }) => {
      if (venueId !== null) {
        queryClient.setQueryData(stayInventoryKeys.detail(venueId), inventory);
      }
    },
  });
}
