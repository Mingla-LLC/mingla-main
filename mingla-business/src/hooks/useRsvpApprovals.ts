/**
 * ORCH-1150 — host RSVP approve/deny/remove + bulk-approve React Query hooks (A2).
 *
 * useRsvpGuestList(eventId) — host-scoped guest list (RLS host-read).
 * useSetRsvpStatus()        — approve/deny/remove mutation; invalidates the
 *                             guest list + going-count keys on success.
 * useBulkApproveRsvps()     — bulk approve all pending up to capacity.
 *
 * ORCH-1150: do NOT merge back into the event/ticket path. See SPEC §5.4.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { checkInRsvpGuestByHand, type RsvpScanResponse } from "../services/scanRsvpService";
import {
  bulkApproveRsvps,
  listRsvpGuests,
  setRsvpStatus,
  type BulkApproveResult,
  type RsvpGuest,
  type SetRsvpStatusResult,
} from "../services/rsvpApprovals";

export const rsvpGuestKeys = {
  all: ["rsvp-guests"] as const,
  list: (eventId: string) => [...rsvpGuestKeys.all, eventId] as const,
};

export function useRsvpGuestList(eventId: string | null, enabled = true) {
  const { isAuthReady } = useAuth();
  return useQuery<RsvpGuest[]>({
    queryKey: rsvpGuestKeys.list(eventId ?? ""),
    queryFn: () => listRsvpGuests(eventId!),
    enabled: isAuthReady && enabled && eventId !== null && eventId.length > 0,
    staleTime: 10_000,
  });
}

export function useSetRsvpStatus(eventId: string | null) {
  const queryClient = useQueryClient();
  return useMutation<
    SetRsvpStatusResult,
    Error,
    { rsvpId: string; status: "approved" | "denied" }
  >({
    mutationFn: ({ rsvpId, status }) => setRsvpStatus(eventId!, rsvpId, status),
    onSuccess: () => {
      if (eventId !== null && eventId.length > 0) {
        void queryClient.invalidateQueries({ queryKey: rsvpGuestKeys.list(eventId) });
      }
    },
  });
}

export function useBulkApproveRsvps(eventId: string | null) {
  const queryClient = useQueryClient();
  return useMutation<BulkApproveResult, Error, void>({
    mutationFn: () => bulkApproveRsvps(eventId!),
    onSuccess: () => {
      if (eventId !== null && eventId.length > 0) {
        void queryClient.invalidateQueries({ queryKey: rsvpGuestKeys.list(eventId) });
      }
    },
  });
}

/**
 * #4508 - admit one plus-one by hand. Refreshes the same things a door scan
 * does: the host guest list and the check-in summary on the scanner screen.
 */
export function useCheckInRsvpGuest(eventId: string | null) {
  const queryClient = useQueryClient();
  return useMutation<RsvpScanResponse, Error, { guestId: string }>({
    mutationFn: ({ guestId }) => checkInRsvpGuestByHand(guestId),
    onSuccess: () => {
      if (eventId !== null && eventId.length > 0) {
        void queryClient.invalidateQueries({ queryKey: rsvpGuestKeys.list(eventId) });
        void queryClient.invalidateQueries({ queryKey: ["rsvpCheckinSummary", eventId] });
      }
    },
  });
}
