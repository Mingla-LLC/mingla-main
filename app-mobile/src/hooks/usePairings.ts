import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchPairingPills,
  fetchIncomingPairRequests,
  sendPairRequest,
  cancelPairRequest,
  cancelPairInvite,
  unpair,
  acceptPairRequest,
  declinePairRequest,
} from "../services/pairingService";
import type {
  PairingPill,
  PairRequest,
  SendPairRequestResponse,
} from "../services/pairingService";
import { customHolidayKeys } from "./useCustomHolidays";
import { logAppsFlyerEvent } from "../services/appsFlyerService";
import { useAppStore } from "../store/appStore";
import { trackedInvoke } from "../services/supabase";

// ── Query Keys ──────────────────────────────────────────────────────────────

export const pairingKeys = {
  prefix: ["pairings"] as const,
  all: (userId: string) => ["pairings", userId] as const,
  pills: (userId: string) => ["pairings", "pills", userId] as const,
  incomingRequests: (userId: string) =>
    ["pairings", "incoming", userId] as const,
};

// ── Queries ─────────────────────────────────────────────────────────────────

export function usePairingPills(userId: string | undefined) {
  return useQuery<PairingPill[]>({
    queryKey: pairingKeys.pills(userId ?? ""),
    queryFn: () => fetchPairingPills(userId!),
    enabled: !!userId,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

export function useIncomingPairRequests(userId: string | undefined) {
  return useQuery<PairRequest[]>({
    queryKey: pairingKeys.incomingRequests(userId ?? ""),
    queryFn: () => fetchIncomingPairRequests(userId!),
    enabled: !!userId,
    staleTime: 60 * 1000, // 1 minute
  });
}

// ── Mutations ───────────────────────────────────────────────────────────────

export function useSendPairRequest() {
  const queryClient = useQueryClient();
  return useMutation<
    SendPairRequestResponse,
    Error,
    { friendUserId?: string; phoneE164?: string }
  >({
    mutationFn: sendPairRequest,
    onSuccess: () => {
      logAppsFlyerEvent('pair_request_sent', {});
      // Invalidate pills — the new request will appear there
      queryClient.invalidateQueries({ queryKey: ["pairings", "pills"] });
    },
  });
}

export function useCancelPairRequest() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: cancelPairRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pairings", "pills"] });
    },
  });
}

export function useCancelPairInvite() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: cancelPairInvite,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pairings", "pills"] });
    },
  });
}

export function useUnpair() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: unpair,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pairings", "pills"] });
      queryClient.invalidateQueries({ queryKey: customHolidayKeys.all });
    },
  });
}

export function useAcceptPairRequest() {
  const queryClient = useQueryClient();
  const userId = useAppStore((s) => s.user?.id);
  return useMutation<
    { pairingId: string; pairedWithUserId: string },
    Error,
    string
  >({
    mutationKey: ["pairings", "accept"],
    mutationFn: acceptPairRequest,
    onMutate: async (requestId) => {
      // Cancel in-flight fetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: pairingKeys.prefix });

      // Snapshot previous values for rollback
      const prevIncoming = queryClient.getQueriesData<PairRequest[]>({
        queryKey: ["pairings", "incoming"],
      });
      const prevPills = queryClient.getQueriesData<PairingPill[]>({
        queryKey: ["pairings", "pills"],
      });

      // Optimistically remove the accepted request from ALL incoming caches
      queryClient.setQueriesData<PairRequest[]>(
        { queryKey: ["pairings", "incoming"] },
        (old) => old?.filter((r) => r.id !== requestId) ?? [],
      );

      return { prevIncoming, prevPills };
    },
    onError: (_err, _requestId, context) => {
      // Rollback on failure — restore exact previous cache state
      if (context?.prevIncoming) {
        for (const [key, data] of context.prevIncoming) {
          if (data !== undefined) queryClient.setQueryData(key, data);
        }
      }
      if (context?.prevPills) {
        for (const [key, data] of context.prevPills) {
          if (data !== undefined) queryClient.setQueryData(key, data);
        }
      }
    },
    onSuccess: async (data, requestId) => {
      logAppsFlyerEvent('pair_request_accepted', {});
      // Fire-and-forget notification to the sender
      if (userId && data?.pairedWithUserId) {
        try {
          await trackedInvoke('send-pair-accepted-notification', {
            body: {
              accepterId: userId,
              senderId: data.pairedWithUserId,
              requestId,
            },
          });
        } catch (err) {
          console.warn('[usePairings] pair accepted notification failed:', err);
        }
      }
    },
    onSettled: () => {
      // Always refetch to ensure server truth, regardless of success/failure
      queryClient.invalidateQueries({ queryKey: pairingKeys.prefix });
    },
  });
}

export function useDeclinePairRequest() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationKey: ["pairings", "decline"],
    mutationFn: declinePairRequest,
    onMutate: async (requestId) => {
      await queryClient.cancelQueries({ queryKey: pairingKeys.prefix });

      const prevIncoming = queryClient.getQueriesData<PairRequest[]>({
        queryKey: ["pairings", "incoming"],
      });

      queryClient.setQueriesData<PairRequest[]>(
        { queryKey: ["pairings", "incoming"] },
        (old) => old?.filter((r) => r.id !== requestId) ?? [],
      );

      return { prevIncoming };
    },
    onError: (_err, _requestId, context) => {
      if (context?.prevIncoming) {
        for (const [key, data] of context.prevIncoming) {
          if (data !== undefined) queryClient.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: pairingKeys.prefix });
    },
  });
}

// Re-export raw service functions for callback-based usage (e.g. HomePage handlers)
export { acceptPairRequest, declinePairRequest } from "../services/pairingService";
