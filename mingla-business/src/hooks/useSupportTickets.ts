/**
 * useSupportTickets — the signed-in person's OWN support requests (#4382
 * Wave 4, built on META-ORCH-1104).
 *
 * Server state lives in React Query (Const #5). Keys come from the factory;
 * creating a request invalidates the list. The list is filtered to
 * requester = me or a brand-team ticket of one of my brands, so a host who is also Mingla staff sees only their own
 * requests here, never the staff queue.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  createSupportTicket,
  listOwnSupportTickets,
  type SupportTicket,
} from "../services/supportService";
import type { HostCreateTicketInput } from "../components/support/supportRequestModel";

import {
  SUPPORT_TICKETS_DISABLED_KEY as DISABLED_KEY,
  SUPPORT_TICKETS_STALE_TIME_MS as STALE_TIME_MS,
  supportTicketKeys,
} from "./supportTicketKeys";

// #4420 — the factory moved to supportTicketKeys.ts (no service import) so the
// Help & Support shell can share the same cache entry; re-exported here.
export { supportTicketKeys };

export interface UseSupportTicketsResult {
  data: SupportTicket[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}

export const useSupportTickets = (): UseSupportTicketsResult => {
  const { isAuthReady, user } = useAuth();
  const userId = user?.id ?? null;
  const enabled = isAuthReady && userId !== null;

  const { data, isLoading, isError, refetch } = useQuery<SupportTicket[]>({
    queryKey: enabled && userId !== null ? supportTicketKeys.byUser(userId) : DISABLED_KEY,
    enabled,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<SupportTicket[]> => {
      if (!enabled || userId === null) return [];
      return listOwnSupportTickets(userId);
    },
  });

  return { data: data ?? [], isLoading, isError, refetch };
};

export interface UseCreateSupportTicketResult {
  /** Resolves to the new ticket id; throws (surfaced by the form) on failure. */
  mutateAsync: (input: HostCreateTicketInput) => Promise<string>;
  isPending: boolean;
}

export const useCreateSupportTicket = (): UseCreateSupportTicketResult => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const mutation = useMutation<string, Error, HostCreateTicketInput>({
    mutationFn: async (input): Promise<string> => {
      if (user === null) throw new Error("Not signed in");
      // #3720: the create function enqueues staff delivery itself. Do not
      // call notify-support from the client.
      return createSupportTicket(input);
    },
    onSuccess: (): void => {
      if (user !== null) {
        void queryClient.invalidateQueries({
          queryKey: supportTicketKeys.byUser(user.id),
        });
      }
    },
  });

  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending };
};
