/**
 * Issue #4261 — a chat's plans (spec 5.4): one React Query read of
 * `chat_plans_for_conversation`, the realtime channel that refreshes it, and
 * one mutation per plan RPC.
 *
 * Vote / RSVP / thumbs are optimistic (the cached payload is patched at once,
 * Constitution #1) and roll back with "Couldn't save that. Try again." on a
 * failure. Create / lock / cancel / add-time are not optimistic: their buttons
 * spin and disable while `isPending`. Every mutation refreshes the plan list
 * when it settles.
 */
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { chatListKeys, planKeys, groupLinkKeys } from './queryKeys';
import {
  addPlanOption,
  addPlanPlace,
  cancelPlan,
  ChatPlanError,
  createPlan,
  fetchChatPlans,
  listPlanComments,
  lockPlan,
  notifyDeckPlanLocked,
  notifyPlanMessage,
  requestLinkPreview,
  setPlanPlaceVote,
  setPlanReaction,
  setPlanRsvp,
  setPlanVote,
  updatePlan,
  type PlanCommentRow,
} from '../services/chatPlansService';
import { realtimeService } from '../services/realtimeService';
import { toastManager } from '../components/ui/Toast';
import {
  applyPlaceVotePatch,
  applyReactionPatch,
  applyRsvpPatch,
  applyVotePatch,
  lockPlaceOptionId,
  planErrorKey,
  type PlanAction,
} from '../components/chat/planModel';
import type {
  ChatPlan,
  ChatPlansPayload,
  PlanAddOptionResult,
  PlanAddPlaceInput,
  PlanAddPlaceResult,
  PlanCreateInput,
  PlanCreateResult,
  PlanLockResult,
  PlanReaction,
  PlanRsvp,
} from '../types/chatPlans';

const PLANS_STALE_MS = 15_000;

function errorCode(error: unknown): ChatPlanError['code'] {
  return error instanceof ChatPlanError ? error.code : 'unknown';
}

/** The toast for a failed plan action (spec 5.6). */
function usePlanErrorToast(): (error: unknown, action: PlanAction, plan?: Pick<ChatPlan, 'source' | 'createdByName'> | null) => void {
  const { t } = useTranslation(['chat']);
  return (error, action, plan) => {
    console.warn(`[useChatPlans] ${action} failed`, error);
    const key = planErrorKey(errorCode(error), action, plan?.source ?? 'chat');
    toastManager.error(
      t(`chat:${key}`, { name: plan?.createdByName?.trim() || t('chat:planSetBySomeone') }),
    );
  };
}

export function useChatPlans(conversationId: string | null | undefined, enabled: boolean) {
  return useQuery<ChatPlansPayload>({
    queryKey: planKeys.conversation(conversationId ?? ''),
    enabled: enabled && !!conversationId,
    staleTime: PLANS_STALE_MS,
    queryFn: () => fetchChatPlans(conversationId as string),
  });
}

/** A plan's comments (ordinary chat messages that carry its `plan_id`). */
export function usePlanComments(planId: string | null | undefined) {
  return useQuery<PlanCommentRow[]>({
    queryKey: planKeys.comments(planId ?? ''),
    enabled: !!planId,
    staleTime: PLANS_STALE_MS,
    queryFn: () => listPlanComments(planId as string),
  });
}

/**
 * The `chat-plans:<conversationId>` channel (spec 4.5). A plan row change
 * refreshes the plan list and that plan's comments (a new comment bumps the
 * plan's `updated_at`); a join request refreshes the group's requests.
 */
export function useChatPlansRealtime(conversationId: string | null | undefined, enabled: boolean): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled || !conversationId) return undefined;
    return realtimeService.subscribeToChatPlans(conversationId, {
      onPlanChange: (planId) => {
        void queryClient.invalidateQueries({ queryKey: planKeys.conversation(conversationId) });
        if (planId) void queryClient.invalidateQueries({ queryKey: planKeys.comments(planId) });
      },
      onJoinRequestChange: () => {
        void queryClient.invalidateQueries({ queryKey: groupLinkKeys.joinRequests(conversationId) });
      },
    });
  }, [conversationId, enabled, queryClient]);
}

interface OptimisticContext {
  previous: ChatPlansPayload | undefined;
}

async function patchCache(
  queryClient: QueryClient,
  conversationId: string,
  patch: (payload: ChatPlansPayload) => ChatPlansPayload,
): Promise<OptimisticContext> {
  const key = planKeys.conversation(conversationId);
  await queryClient.cancelQueries({ queryKey: key });
  const previous = queryClient.getQueryData<ChatPlansPayload>(key);
  if (previous) queryClient.setQueryData<ChatPlansPayload>(key, patch(previous));
  return { previous };
}

function rollback(queryClient: QueryClient, conversationId: string, context: OptimisticContext | undefined): void {
  if (context?.previous) queryClient.setQueryData(planKeys.conversation(conversationId), context.previous);
}

function settle(queryClient: QueryClient, conversationId: string): void {
  void queryClient.invalidateQueries({ queryKey: planKeys.conversation(conversationId) });
}

/**
 * The plan action posted a chat line (the plan card, "added a time", "locked
 * in", "cancelled"…), so the Chats list's preview is stale (#4265's
 * `useChatList` entry stays fresh for minutes). Factory key only.
 */
function refreshChatList(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: chatListKeys.all });
}

export function useCreatePlan(conversationId: string, senderId: string | null | undefined) {
  const queryClient = useQueryClient();
  const toastError = usePlanErrorToast();
  return useMutation<PlanCreateResult, unknown, { input: PlanCreateInput; previewTitle: string }>({
    mutationFn: ({ input }) => createPlan(input),
    onSuccess: (result, { input, previewTitle }) => {
      if (result.created) refreshChatList(queryClient);
      // Amendment 1 (5.9): the server reads the link's preview; never blocks posting.
      if (result.created && input.linkUrl) requestLinkPreview(result.planId);
      if (result.created && senderId) {
        notifyPlanMessage({
          senderId,
          conversationId,
          messageId: result.messageId,
          preview: `added a plan: ${previewTitle}`,
        });
      }
    },
    onError: (error) => toastError(error, 'create'),
    onSettled: () => settle(queryClient, conversationId),
  });
}

export function useAddPlanTime(conversationId: string) {
  const queryClient = useQueryClient();
  const toastError = usePlanErrorToast();
  const { t } = useTranslation(['chat']);
  return useMutation<PlanAddOptionResult, unknown, { plan: ChatPlan; startsAt: string }>({
    mutationFn: ({ plan, startsAt }) => addPlanOption(plan.id, startsAt),
    onSuccess: (result) => {
      if (result.existed) {
        toastManager.info(t('chat:plan_time_exists_toast'));
        return;
      }
      refreshChatList(queryClient);
    },
    onError: (error, { plan }) => toastError(error, 'addTime', plan),
    onSettled: () => settle(queryClient, conversationId),
  });
}

/** Amendment 1: suggest a place (not optimistic; the Add button spins). */
export function useAddPlanPlace(conversationId: string) {
  const queryClient = useQueryClient();
  const toastError = usePlanErrorToast();
  const { t } = useTranslation(['chat']);
  return useMutation<PlanAddPlaceResult, unknown, { plan: ChatPlan; input: PlanAddPlaceInput }>({
    mutationFn: ({ input }) => addPlanPlace(input),
    onSuccess: (result, { plan, input }) => {
      if (result.existed) {
        toastManager.info(t('chat:plan_place_exists_toast'));
        return;
      }
      refreshChatList(queryClient);
      if (input.linkUrl) requestLinkPreview(plan.id);
    },
    onError: (error, { plan }) => toastError(error, 'addPlace', plan),
    onSettled: () => settle(queryClient, conversationId),
  });
}

/** Amendment 1: a place vote, optimistic with rollback. */
export function useSetPlanPlaceVote(conversationId: string) {
  const queryClient = useQueryClient();
  const toastError = usePlanErrorToast();
  return useMutation<unknown, unknown, { optionId: string; on: boolean; viewerId: string }, OptimisticContext>({
    mutationFn: ({ optionId, on }) => setPlanPlaceVote(optionId, on),
    onMutate: ({ optionId, on, viewerId }) =>
      patchCache(queryClient, conversationId, (payload) => applyPlaceVotePatch(payload, optionId, viewerId, on)),
    onError: (error, _vars, context) => {
      rollback(queryClient, conversationId, context);
      toastError(error, 'placeVote');
    },
    onSettled: () => settle(queryClient, conversationId),
  });
}

export function useSetPlanVote(conversationId: string) {
  const queryClient = useQueryClient();
  const toastError = usePlanErrorToast();
  return useMutation<unknown, unknown, { optionId: string; on: boolean; viewerId: string }, OptimisticContext>({
    mutationFn: ({ optionId, on }) => setPlanVote(optionId, on),
    onMutate: ({ optionId, on, viewerId }) =>
      patchCache(queryClient, conversationId, (payload) => applyVotePatch(payload, optionId, viewerId, on)),
    onError: (error, _vars, context) => {
      rollback(queryClient, conversationId, context);
      toastError(error, 'vote');
    },
    onSettled: () => settle(queryClient, conversationId),
  });
}

export function useSetPlanRsvp(conversationId: string) {
  const queryClient = useQueryClient();
  const toastError = usePlanErrorToast();
  return useMutation<unknown, unknown, { planId: string; status: PlanRsvp | null; viewerId: string }, OptimisticContext>({
    mutationFn: ({ planId, status }) => setPlanRsvp(planId, status),
    onMutate: ({ planId, status, viewerId }) =>
      patchCache(queryClient, conversationId, (payload) => applyRsvpPatch(payload, planId, viewerId, status)),
    onError: (error, _vars, context) => {
      rollback(queryClient, conversationId, context);
      toastError(error, 'rsvp');
    },
    onSettled: () => settle(queryClient, conversationId),
  });
}

export function useSetPlanReaction(conversationId: string) {
  const queryClient = useQueryClient();
  const toastError = usePlanErrorToast();
  return useMutation<unknown, unknown, { planId: string; kind: PlanReaction | null; viewerId: string }, OptimisticContext>({
    mutationFn: ({ planId, kind }) => setPlanReaction(planId, kind),
    onMutate: ({ planId, kind, viewerId }) =>
      patchCache(queryClient, conversationId, (payload) => applyReactionPatch(payload, planId, viewerId, kind)),
    onError: (error, _vars, context) => {
      rollback(queryClient, conversationId, context);
      toastError(error, 'reaction');
    },
    onSettled: () => settle(queryClient, conversationId),
  });
}

export function useLockPlan(conversationId: string, viewerId: string | null | undefined) {
  const queryClient = useQueryClient();
  const toastError = usePlanErrorToast();
  return useMutation<PlanLockResult, unknown, { plan: ChatPlan; optionId?: string; scheduledAt?: string }>({
    mutationFn: ({ plan, optionId, scheduledAt }) =>
      lockPlan({
        planId: plan.id,
        optionId: optionId ?? null,
        scheduledAt: scheduledAt ?? null,
        // Amendment 1 (5.5): the leading place the card shows wins with the time.
        placeOptionId: lockPlaceOptionId(plan),
      }),
    onSuccess: (result, { plan }) => {
      refreshChatList(queryClient);
      if (viewerId) void queryClient.invalidateQueries({ queryKey: ['calendarEntries', viewerId] });
      if (plan.sessionId) {
        void queryClient.invalidateQueries({ queryKey: ['scheduledCards', plan.sessionId] });
        void queryClient.invalidateQueries({ queryKey: ['savedCards', plan.sessionId] });
      }
      if (plan.source === 'chat' && viewerId) {
        notifyPlanMessage({ senderId: viewerId, conversationId, preview: `locked in ${plan.title}` });
      } else if (plan.source === 'deck' && plan.sessionId && plan.savedCardId) {
        // The deck path posts its own "Locked in" card; its push goes out as today.
        notifyDeckPlanLocked({ sessionId: plan.sessionId, savedCardId: plan.savedCardId, scheduledAt: result.scheduledAt });
      }
    },
    onError: (error, { plan }) => toastError(error, 'lock', plan),
    onSettled: () => settle(queryClient, conversationId),
  });
}

export function useUpdatePlan(conversationId: string) {
  const queryClient = useQueryClient();
  const toastError = usePlanErrorToast();
  return useMutation<unknown, unknown, { plan: ChatPlan; title: string; note: string | null }>({
    mutationFn: ({ plan, title, note }) => updatePlan(plan.id, title, note),
    onSuccess: () => refreshChatList(queryClient),
    onError: (error, { plan }) => toastError(error, 'update', plan),
    onSettled: () => settle(queryClient, conversationId),
  });
}

export function useCancelPlan(conversationId: string, viewerId: string | null | undefined) {
  const queryClient = useQueryClient();
  const toastError = usePlanErrorToast();
  return useMutation<unknown, unknown, { plan: ChatPlan }>({
    mutationFn: ({ plan }) => cancelPlan(plan.id),
    onSuccess: () => {
      refreshChatList(queryClient);
      if (viewerId) void queryClient.invalidateQueries({ queryKey: ['calendarEntries', viewerId] });
    },
    onError: (error, { plan }) => toastError(error, 'cancel', plan),
    onSettled: () => settle(queryClient, conversationId),
  });
}
