/**
 * #4490 P2 — the venue door: the day's list, scan, admit, undo and sell at the
 * gate (edge function `venue-check-in`, staff JWT). Every door action
 * refreshes the list and the day (stock and the In-the-venue count move).
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
  admitPass,
  fetchCheckInList,
  scanPass,
  sellAtGate,
  undoCheckIn,
} from "../services/venueOffersService";
import type {
  CheckInList,
  GateMethod,
  GateSaleLine,
  GateSaleResult,
  ScanOutcome,
} from "../types/venueOffers";
import { venueFeatureKeys } from "./venueFeatureKeys";

export function useVenueCheckIns(
  brandId: string | null,
  venueId: string | null,
  localDate: string | null = null,
): UseQueryResult<CheckInList> {
  const { isAuthReady } = useAuth();
  const enabled =
    isAuthReady && brandId !== null && brandId.length > 0 && venueId !== null && venueId.length > 0;
  return useQuery<CheckInList>({
    queryKey: enabled
      ? venueFeatureKeys.checkIns(brandId as string, venueId as string, localDate ?? "today")
      : (["venueCheckIns", "disabled"] as const),
    enabled,
    staleTime: 10_000,
    refetchInterval: 30_000,
    queryFn: () => fetchCheckInList(venueId as string, localDate),
  });
}

function useInvalidateDoor(brandId: string | null, venueId: string | null): () => void {
  const queryClient = useQueryClient();
  return () => {
    if (brandId === null || venueId === null) return;
    void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.checkInsAll(brandId, venueId) });
    void queryClient.invalidateQueries({ queryKey: venueFeatureKeys.dayAll(brandId, venueId) });
  };
}

export type DoorAction =
  | { kind: "scan"; qrPayload: string; idChecked?: boolean }
  | { kind: "admit"; passId: string; count?: number; idChecked?: boolean }
  | { kind: "undo"; logId: string };

export function useDoorAction(
  brandId: string | null,
  venueId: string | null,
): UseMutationResult<ScanOutcome, Error, DoorAction> {
  const invalidate = useInvalidateDoor(brandId, venueId);
  return useMutation<ScanOutcome, Error, DoorAction>({
    mutationFn: (action) => {
      if (venueId === null) throw new Error("venue_required");
      if (action.kind === "scan") {
        return scanPass({ venueId, qrPayload: action.qrPayload, idChecked: action.idChecked });
      }
      if (action.kind === "admit") {
        return admitPass({ venueId, passId: action.passId, count: action.count, idChecked: action.idChecked });
      }
      return undoCheckIn({ venueId, logId: action.logId });
    },
    onSettled: invalidate,
  });
}

export function useSellAtGate(
  brandId: string | null,
  venueId: string | null,
): UseMutationResult<
  GateSaleResult,
  Error,
  {
    offeringId: string;
    lines: GateSaleLine[];
    method: GateMethod;
    buyer?: { name?: string; email?: string; phone?: string };
    idempotencyKey: string;
  }
> {
  const invalidate = useInvalidateDoor(brandId, venueId);
  return useMutation({
    mutationFn: (input) => {
      if (venueId === null) throw new Error("venue_required");
      return sellAtGate({ venueId, ...input });
    },
    onSettled: invalidate,
  });
}
