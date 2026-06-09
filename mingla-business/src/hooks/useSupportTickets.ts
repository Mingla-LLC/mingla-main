/**
 * useSupportTickets — META-ORCH-1104 Phase 1 (business requester).
 *
 * React Query hook for the signed-in user's OWN support tickets (server state in
 * React Query, NOT Zustand — Const #5). Key factory only; create invalidates the
 * list. Mirrors `useCreatorAccount` discipline (SPEC §5.1).
 *
 * Per SPEC §5.1.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  createSupportTicket,
  listOwnSupportTickets,
  notifyNewSupportTicket,
  type SupportTicket,
} from "../services/supportService";

const STALE_TIME_MS = 30 * 1000; // tickets change as staff reply — keep it fresh

export const supportTicketKeys = {
  all: ["support", "tickets"] as const,
  byUser: (userId: string): readonly [string, string, string] =>
    ["support", "tickets", userId] as const,
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
    queryKey: enabled ? supportTicketKeys.byUser(userId) : DISABLED_KEY,
    enabled,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<SupportTicket[]> => {
      if (!enabled) return [];
      return listOwnSupportTickets();
    },
  });

  return { data: data ?? [], isLoading, isError, refetch };
};

export interface UseCreateSupportTicketResult {
  /** Resolves to the new ticket id; throws (surfaced via onError) on failure. */
  mutateAsync: (input: {
    subject: string;
    brandId?: string | null;
  }) => Promise<string>;
  isPending: boolean;
}

export const useCreateSupportTicket = (): UseCreateSupportTicketResult => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const mutation = useMutation<string, Error, { subject: string; brandId?: string | null }>({
    mutationFn: async ({ subject, brandId }): Promise<string> => {
      if (user === null) throw new Error("Not signed in");
      const ticketId = await createSupportTicket(subject, brandId);
      // Best-effort push fan-out — no-ops until notify-support is deployed.
      void notifyNewSupportTicket(ticketId);
      return ticketId;
    },
    onSuccess: (): void => {
      if (user !== null) {
        queryClient.invalidateQueries({
          queryKey: supportTicketKeys.byUser(user.id),
        });
      }
    },
  });

  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending };
};
