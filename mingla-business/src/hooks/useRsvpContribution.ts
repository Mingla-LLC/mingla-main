/**
 * useRsvpContribution — ORCH-1291 [rsvp-chip-in].
 *
 * React Query mutation wrapping the rsvp-contribution-create edge fn (via
 * submitRsvpContribution). The chip-in is a SECOND, voluntary action after a
 * free RSVP — this NEVER writes an RSVP row or an order.
 *
 * onError is MANDATORY (design §9.2): the caller passes a toast surface so a
 * failed contribution is never silent (Constitution #3). onSuccess invalidates
 * the event's contribution-summary key from the factory below — NO hardcoded
 * key strings (Constitution #4).
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  submitRsvpContribution,
  type SubmitRsvpContributionInput,
  type SubmitRsvpContributionResult,
} from "../services/rsvpEvents";

/** ORCH-1291 — one query key per entity (Constitution #4). */
export const rsvpContributionKeys = {
  all: ["rsvp-contributions"] as const,
  event: (eventId: string): readonly ["rsvp-contributions", string] =>
    [...rsvpContributionKeys.all, eventId] as const,
};

export interface UseRsvpContributionOptions {
  /** MANDATORY error surface — a failed gift is never silent (design §9.2). */
  onError: (message: string) => void;
}

export function useRsvpContribution(
  eventId: string | null,
  options: UseRsvpContributionOptions,
) {
  const queryClient = useQueryClient();
  return useMutation<
    SubmitRsvpContributionResult,
    Error,
    Omit<SubmitRsvpContributionInput, "eventId">
  >({
    mutationFn: (input) =>
      submitRsvpContribution({ ...input, eventId: eventId ?? "" }),
    onSuccess: () => {
      if (eventId !== null && eventId.length > 0) {
        void queryClient.invalidateQueries({
          queryKey: rsvpContributionKeys.event(eventId),
        });
      }
    },
    onError: (err) => {
      options.onError(err instanceof Error ? err.message : String(err));
    },
  });
}
