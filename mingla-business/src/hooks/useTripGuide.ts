/**
 * Issue #2829 W4 — the trip guide (highlights, what to prepare, good to know,
 * FAQs, group minimum, activity level), stored on the trip in Mingla.
 *
 *  (The public read lives in usePublicTripGuide.ts.)
 *  - useTripGuideForEditor / useSaveTripGuide: the team's read and write
 *    (`biz_get_trip_guide` / `biz_upsert_trip_guide`, event manager or above;
 *    Mingla re-checks the rank). Saving refreshes both reads.
 *
 * Keys come from the trip key factory (tripKeys.guide / tripKeys.publicGuide).
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  tripGuidePayload,
  type TripGuideDraft,
} from "@mingla/offering-rendering/tripGuide";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import { tripKeys } from "./useTrips";

const GUIDE_STALE_MS = 60 * 1000;

/** Plain-English message for a refused save (Mingla's own error codes). */
export function tripGuideSaveErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("insufficient_event_permission")) {
    return "Only event managers, admins and owners can edit the trip guide.";
  }
  if (message.includes("trip_guide_invalid")) {
    return "Some of the guide could not be saved. Check the highlighted limits and try again.";
  }
  if (message.includes("trip_not_editable_status")) {
    return "This trip has ended or been cancelled, so its guide can no longer be changed.";
  }
  return "The trip guide could not be saved. Check your connection and try again.";
}

export const useTripGuideForEditor = (
  eventId: string | null,
): UseQueryResult<unknown, Error> => {
  // ORCH-1004 — biz_get_trip_guide reads auth.uid(): wait for the session.
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && eventId !== null && eventId.length > 0;
  return useQuery<unknown, Error>({
    queryKey: eventId !== null ? tripKeys.guide(eventId) : tripKeys.details(),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("biz_get_trip_guide", {
        p_event_id: eventId as string,
      });
      if (error !== null) throw error;
      return data ?? null;
    },
    enabled,
    staleTime: GUIDE_STALE_MS,
  });
};

export interface SaveTripGuideInput {
  eventId: string;
  draft: TripGuideDraft;
}

export const useSaveTripGuide = (): UseMutationResult<
  unknown,
  Error,
  SaveTripGuideInput
> => {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, SaveTripGuideInput>({
    mutationFn: async ({ eventId, draft }) => {
      const { data, error } = await supabase.rpc("biz_upsert_trip_guide", {
        p_event_id: eventId,
        p_guide: tripGuidePayload(draft),
      });
      if (error !== null) throw error;
      return data ?? null;
    },
    onSuccess: (saved, { eventId }) => {
      queryClient.setQueryData(tripKeys.guide(eventId), saved);
      void queryClient.invalidateQueries({ queryKey: tripKeys.publicGuide(eventId) });
    },
    onError: (error, { eventId }) => {
      console.error("[useSaveTripGuide] failed", { message: error.message, eventId });
    },
  });
};
