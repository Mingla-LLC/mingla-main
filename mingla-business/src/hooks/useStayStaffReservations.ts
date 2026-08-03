import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { stayGuestKeys } from "@mingla/brand-rendering/stayGuestKeys";

import { useAuth } from "../context/AuthContext";
import { stayReservationService } from "../services/stayReservationService";
import type {
  StayCancelPreview,
  StayStaffReservationGroup,
  StayStaffReservationList,
} from "../types/stayReservation";

export const stayStaffReservationKeys = {
  all: ["stayStaffReservations"] as const,
  venue: (venueId: string) =>
    [...stayStaffReservationKeys.all, "venue", venueId] as const,
  group: (groupId: string) =>
    [...stayStaffReservationKeys.all, "group", groupId] as const,
};

const DISABLED = ["stayStaffReservations", "disabled"] as const;

export function useStayStaffReservationList(
  venueId: string | null,
): UseQueryResult<StayStaffReservationList> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && venueId !== null;
  return useQuery({
    queryKey:
      enabled && venueId !== null
        ? stayStaffReservationKeys.venue(venueId)
        : DISABLED,
    enabled,
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: () => {
      if (venueId === null) throw new Error("stay_venue_id_required");
      return stayReservationService.listStaffGroups(venueId);
    },
  });
}

export function useStayStaffReservationGroup(
  groupId: string | null,
): UseQueryResult<StayStaffReservationGroup> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && groupId !== null;
  return useQuery({
    queryKey:
      enabled && groupId !== null
        ? stayStaffReservationKeys.group(groupId)
        : DISABLED,
    enabled,
    queryFn: () => {
      if (groupId === null) throw new Error("stay_group_id_required");
      return stayReservationService.getStaffGroup(groupId);
    },
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === "finalizing" || state === "reconciliation_required"
        ? 3_000
        : false;
    },
  });
}

type RespondInput = {
  venueId: string;
  groupId: string;
  expectedVersion: number;
  decision: "approve" | "decline";
};

export function useRespondToStayRequest(): UseMutationResult<
  StayStaffReservationGroup,
  Error,
  RespondInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input) => {
      const group =
        input.decision === "approve"
          ? await stayReservationService.approveRequest({
              groupId: input.groupId,
              expectedVersion: input.expectedVersion,
              idempotencyKey: `stay:staff:approve:${input.groupId}:${input.expectedVersion}`,
            })
          : await stayReservationService.declineRequest({
              groupId: input.groupId,
              expectedVersion: input.expectedVersion,
              idempotencyKey: `stay:staff:decline:${input.groupId}:${input.expectedVersion}`,
            });
      return stayReservationService.getStaffGroup(group.groupId);
    },
    onSuccess: (group, input) => {
      queryClient.setQueryData(
        stayStaffReservationKeys.group(group.groupId),
        group,
      );
      void queryClient.invalidateQueries({
        queryKey: stayStaffReservationKeys.venue(input.venueId),
      });
      void queryClient.invalidateQueries({ queryKey: stayGuestKeys.all });
    },
  });
}

type PreviewInput = {
  groupId: string;
  selectedLineIds: string[];
  expectedVersion: number;
};

export function usePreviewStayCancellation(): UseMutationResult<
  StayCancelPreview,
  Error,
  PreviewInput
> {
  return useMutation({
    mutationFn: (input) => stayReservationService.cancelPreview(input),
  });
}

type CancelInput = {
  venueId: string;
  preview: StayCancelPreview;
  reason: string;
};

export function useCancelStayReservation(): UseMutationResult<
  StayStaffReservationGroup,
  Error,
  CancelInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input) => {
      const result = await stayReservationService.cancel({
        previewId: input.preview.previewId,
        previewHash: input.preview.previewHash,
        reason: input.reason,
        idempotencyKey: `stay:staff:cancel:${input.preview.previewId}`,
      });
      return stayReservationService.getStaffGroup(result.groupId);
    },
    onSuccess: (group, input) => {
      queryClient.setQueryData(
        stayStaffReservationKeys.group(group.groupId),
        group,
      );
      void queryClient.invalidateQueries({
        queryKey: stayStaffReservationKeys.venue(input.venueId),
      });
      void queryClient.invalidateQueries({ queryKey: stayGuestKeys.all });
    },
  });
}
