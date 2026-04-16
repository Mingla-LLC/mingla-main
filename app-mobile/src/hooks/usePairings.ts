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
import { mixpanelService } from "../services/mixpanelService";
import { useAppStore } from "../store/appStore";
import { trackedInvoke } from "../services/supabase";
import { dismissNotificationByEntity } from "./useNotifications";

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
    staleTime: 30 * 1000, // 30 seconds — keep fresh for instant UI updates
    refetchInterval: 30 * 1000, // ORCH-0435: Aggressive polling as Realtime safety net.
    // Realtime (useSocialRealtime) handles most updates. This catches cases where
    // Realtime misses events (e.g. missing REPLICA IDENTITY FULL on pairing tables).
  });
}

export function useIncomingPairRequests(userId: string | undefined) {
  return useQuery<PairRequest[]>({
    queryKey: pairingKeys.incomingRequests(userId ?? ""),
    queryFn: () => fetchIncomingPairRequests(userId!),
    enabled: !!userId,
    staleTime: 60 * 1000, // 1 minute
    refetchInterval: 5 * 60 * 1000, // ORCH-0404: Polling fallback — same safety net as pills.
  });
}

// ── Mutations ───────────────────────────────────────────────────────────────

export function useSendPairRequest() {
  const queryClient = useQueryClient();
  return useMutation<
    SendPairRequestResponse,
    Error,
    { friendUserId?: string; phoneE164?: string; displayName?: string; avatarUrl?: string | null },
    { prevPills: [readonly unknown[], PairingPill[] | undefined][] }
  >({
    mutationFn: async (args) => sendPairRequest(args),
    onMutate: async (args) => {
      // ORCH-0435: Optimistically add pending pill so star turns grey instantly
      if (!args.friendUserId) return { prevPills: [] };
      await queryClient.cancelQueries({ queryKey: ["pairings", "pills"] });
      const prevPills = queryClient.getQueriesData<PairingPill[]>({
        queryKey: ["pairings", "pills"],
      });
      const initials = (args.displayName ?? 'F')
        .split(' ')
        .map((n) => n[0] ?? '')
        .join('')
        .toUpperCase()
        .slice(0, 2) || '?';
      queryClient.setQueriesData<PairingPill[]>(
        { queryKey: ["pairings", "pills"] },
        (old) => {
          const optimisticPill: PairingPill = {
            id: `optimistic-send-${args.friendUserId}`,
            type: 'pending_request',
            displayName: args.displayName ?? 'Friend',
            firstName: (args.displayName ?? 'Friend').split(' ')[0] ?? null,
            avatarUrl: args.avatarUrl ?? null,
            initials,
            pillState: 'pending_active',
            statusMessage: null,
            pairedUserId: args.friendUserId!,
            birthday: null,
            gender: null,
            pairingId: null,
            pairRequestId: null,
            pendingInviteId: null,
            createdAt: new Date().toISOString(),
          };
          return [...(old ?? []), optimisticPill];
        },
      );
      return { prevPills };
    },
    onSuccess: () => {
      logAppsFlyerEvent('pair_request_sent', {});
      mixpanelService.trackPairRequestSent({});
      // Invalidate pills — server truth replaces the optimistic pill
      queryClient.invalidateQueries({ queryKey: ["pairings", "pills"] });
    },
    onError: (error, _args, context) => {
      // pairing_limit_reached is expected for free users — not a real error
      if (error?.message === 'pairing_limit_reached') return;
      console.error('[usePairings] Send request failed:', error);
      // Rollback optimistic pill
      if (context?.prevPills) {
        for (const [key, data] of context.prevPills) {
          if (data !== undefined) queryClient.setQueryData(key, data);
        }
      }
    },
  });
}

export function useCancelPairRequest() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => cancelPairRequest(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pairings", "pills"] });
    },
    onError: (error) => {
      console.error('[usePairings] Cancel request failed:', error);
    },
  });
}

export function useCancelPairInvite() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => cancelPairInvite(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pairings", "pills"] });
    },
    onError: (error) => {
      console.error('[usePairings] Cancel invite failed:', error);
    },
  });
}

export function useUnpair() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => unpair(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pairings", "pills"] });
      queryClient.invalidateQueries({ queryKey: customHolidayKeys.all });
      mixpanelService.registerSuperProperties({ is_paired: false });
      mixpanelService.setUserProperties({ is_paired: false });
    },
    onError: (error) => {
      console.error('[usePairings] Unpair failed:', error);
    },
  });
}

export function useAcceptPairRequest() {
  const queryClient = useQueryClient();
  const userId = useAppStore((s) => s.user?.id);
  return useMutation<
    { pairingId: string; pairedWithUserId: string },
    Error,
    string,
    {
      prevIncoming: [readonly unknown[], PairRequest[] | undefined][];
      prevPills: [readonly unknown[], PairingPill[] | undefined][];
    }
  >({
    mutationKey: ["pairings", "accept"],
    mutationFn: async (id) => acceptPairRequest(id),
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

      // ORCH-0435: Optimistically add the newly paired person to pills cache
      let acceptedRequest: PairRequest | undefined;
      for (const [, data] of prevIncoming) {
        acceptedRequest = data?.find((r) => r.id === requestId);
        if (acceptedRequest) break;
      }
      if (acceptedRequest) {
        const senderInitials = acceptedRequest.senderName
          .split(' ')
          .map((n) => n[0] ?? '')
          .join('')
          .toUpperCase()
          .slice(0, 2) || '?';
        queryClient.setQueriesData<PairingPill[]>(
          { queryKey: ["pairings", "pills"] },
          (old) => {
            const optimisticPill: PairingPill = {
              id: `optimistic-accept-${requestId}`,
              type: 'active',
              displayName: acceptedRequest!.senderName,
              firstName: acceptedRequest!.senderName.split(' ')[0] ?? null,
              avatarUrl: acceptedRequest!.senderAvatar ?? null,
              initials: senderInitials,
              pillState: 'active',
              statusMessage: null,
              pairedUserId: acceptedRequest!.senderId,
              birthday: null,
              gender: null,
              pairingId: null, // Server refetch will populate
              pairRequestId: requestId,
              pendingInviteId: null,
              createdAt: new Date().toISOString(),
            };
            return [...(old ?? []), optimisticPill];
          },
        );
      }

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
      mixpanelService.trackPairRequestAccepted({});
      mixpanelService.registerSuperProperties({ is_paired: true });
      mixpanelService.setUserProperties({ is_paired: true });
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
      // Clear the corresponding notification (fire-and-forget — DB trigger also handles this)
      if (userId) {
        dismissNotificationByEntity(userId, queryClient, {
          relatedId: requestId,
          type: 'pair_request_received',
        }).catch(() => {});
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
  const userId = useAppStore((s) => s.user?.id);
  return useMutation<
    void,
    Error,
    string,
    {
      prevIncoming: [readonly unknown[], PairRequest[] | undefined][];
    }
  >({
    mutationKey: ["pairings", "decline"],
    mutationFn: async (id) => declinePairRequest(id),
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
    onSuccess: (_data, requestId) => {
      mixpanelService.trackPairRequestDeclined({});
      // Clear the corresponding notification (fire-and-forget — DB trigger also handles this)
      if (userId) {
        dismissNotificationByEntity(userId, queryClient, {
          relatedId: requestId,
          type: 'pair_request_received',
        }).catch(() => {});
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: pairingKeys.prefix });
    },
  });
}

// Re-export raw service functions for callback-based usage (e.g. HomePage handlers)
export { acceptPairRequest, declinePairRequest } from "../services/pairingService";
