/**
 * useSupportTickets — the signed-in person's OWN support requests (#4382
 * Wave 4, built on META-ORCH-1104).
 *
 * Server state lives in React Query (Const #5). Keys come from the factory;
 * creating a request invalidates the list. The list is filtered to
 * requester = me, so a host who is also Mingla staff sees only their own
 * requests here, never the staff queue.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  createHostSupportTicket,
  listOwnSupportTickets,
  type SupportTicket,
} from "../services/supportService";
import type { HostCreateTicketInput } from "../components/support/supportRequestModel";

const STALE_TIME_MS = 30 * 1000; // tickets change as staff reply — keep it fresh

export const supportTicketKeys = {
  all: ["support", "tickets"] as const,
  byUser: (userId: string): readonly [string, string, string] =>
    ["support", "tickets", userId] as const,
  thread: (ticketId: string): readonly [string, string, string] =>
    ["support", "thread", ticketId] as const,
};

const DISABLED_KEY = ["support", "tickets", "disabled"] as const;

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
      return createHostSupportTicket(input);
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
