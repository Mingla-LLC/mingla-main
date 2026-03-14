import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchPairingPills,
  fetchIncomingPairRequests,
  sendPairRequest,
  acceptPairRequest,
  declinePairRequest,
  cancelPairRequest,
  cancelPairInvite,
  unpair,
} from "../services/pairingService";
import type {
  PairingPill,
  PairRequest,
  SendPairRequestResponse,
} from "../services/pairingService";
import { customHolidayKeys } from "./useCustomHolidays";

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
      // Invalidate pills — the new request will appear there
      queryClient.invalidateQueries({ queryKey: ["pairings", "pills"] });
    },
  });
}

export function useAcceptPairRequest() {
  const queryClient = useQueryClient();
  return useMutation<
    { pairingId: string; pairedWithUserId: string },
    Error,
    string
  >({
    mutationFn: acceptPairRequest,
    onSuccess: () => {
      // Invalidate all pairing queries (pills + incoming)
      queryClient.invalidateQueries({ queryKey: ["pairings"] });
      // Also invalidate friends in case friendship was created
      queryClient.invalidateQueries({ queryKey: ["friends"] });
    },
  });
}

export function useDeclinePairRequest() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: declinePairRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pairings", "incoming"] });
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
