/**
 * META-ORCH-1161 Sub-A (slice "a") — consumer notification-preferences matrix hook.
 *
 * React Query owns the server state (categories + the user's channel prefs).
 * Key from the factory (notificationPrefsKeys.matrix) — never hardcoded.
 * The toggle is an OPTIMISTIC mutation: flip the chip immediately, roll back +
 * surface the error on failure (no silent failure — the consumer shows a toast
 * and reverts).
 */
import { useMemo, useCallback } from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import {
  fetchNotificationMatrix,
  upsertChannelPref,
  setMarketingSuppression,
  type NotificationMatrixData,
} from '../services/notificationPrefsService';
import {
  buildNotificationMatrix,
  resolveToggleAction,
  type MatrixSection,
  type ChannelPrefRow,
  type MarketingSuppressionRow,
  type NotificationChannel,
} from '../components/profile/notificationPrefsMatrix';
import { notificationPrefsKeys } from './queryKeys';

export interface ToggleChannelArgs {
  categoryKey: string;
  channel: NotificationChannel;
  /** True when the category is transactional (drives the prefs-vs-suppression route). */
  isTransactional: boolean;
  nextEnabled: boolean;
  locked: boolean;
}

export interface UseNotificationPrefsResult {
  sections: MatrixSection[];
  isLoading: boolean;
  isError: boolean;
  toggleChannel: (args: ToggleChannelArgs) => void;
  /** True while at least one toggle write is in flight. */
  isSaving: boolean;
  refetch: () => void;
}

interface ToggleContext {
  previous?: NotificationMatrixData;
}

export function useNotificationPrefs(
  userId: string | undefined,
  options?: { enabled?: boolean; onError?: (message: string) => void },
): UseNotificationPrefsResult {
  const queryClient = useQueryClient();
  const enabled = (options?.enabled ?? true) && !!userId;
  const key = notificationPrefsKeys.matrix(userId ?? 'anon');

  const query = useQuery<NotificationMatrixData>({
    queryKey: key,
    queryFn: () => fetchNotificationMatrix(userId as string),
    enabled,
    staleTime: 30_000,
  });

  const mutation = useMutation<void, Error, ToggleChannelArgs, ToggleContext>({
    mutationFn: async (args) => {
      const action = resolveToggleAction({
        userId: userId as string,
        categoryKey: args.categoryKey,
        channel: args.channel,
        isTransactional: args.isTransactional,
        nextEnabled: args.nextEnabled,
        locked: args.locked,
      });
      switch (action.kind) {
        case 'noop':
          // Locked chips never write — guard belongs to the core; defence-in-depth.
          return;
        case 'marketing_suppression':
          // Marketing email/sms opt-out is carried by channel_suppressions (the
          // single source of truth honored by can_send AND marketingAudience).
          await setMarketingSuppression({
            channel: action.channel,
            suppress: action.suppress,
          });
          return;
        case 'channel_pref_upsert':
          await upsertChannelPref(action.upsert);
          return;
        default: {
          const _exhaustive: never = action;
          throw new Error(`unhandled toggle action: ${String(_exhaustive)}`);
        }
      }
    },
    // Optimistic: flip the cached slice immediately so the chip moves with the tap.
    // Marketing email/sms flips the suppressions slice; everything else the prefs.
    onMutate: async (args) => {
      if (args.locked) return {};
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<NotificationMatrixData>(key);
      if (previous) {
        const action = resolveToggleAction({
          userId: userId as string,
          categoryKey: args.categoryKey,
          channel: args.channel,
          isTransactional: args.isTransactional,
          nextEnabled: args.nextEnabled,
          locked: args.locked,
        });
        if (action.kind === 'marketing_suppression') {
          const others = previous.suppressions.filter(
            (s) => s.channel !== action.channel,
          );
          const nextSuppressions: MarketingSuppressionRow[] = action.suppress
            ? [...others, { channel: action.channel }] // opt-out → add suppression
            : others; // opt-in → remove suppression
          queryClient.setQueryData<NotificationMatrixData>(key, {
            ...previous,
            suppressions: nextSuppressions,
          });
        } else if (action.kind === 'channel_pref_upsert') {
          const others = previous.prefs.filter(
            (p) =>
              !(p.category_key === args.categoryKey && p.channel === args.channel),
          );
          const nextPrefs: ChannelPrefRow[] = [
            ...others,
            {
              category_key: args.categoryKey,
              channel: args.channel,
              enabled: args.nextEnabled,
            },
          ];
          queryClient.setQueryData<NotificationMatrixData>(key, {
            ...previous,
            prefs: nextPrefs,
          });
        }
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      return { previous };
    },
    onError: (err, _args, context) => {
      // Roll back to the snapshot taken in onMutate (no silent failure).
      if (context?.previous) {
        queryClient.setQueryData(key, context.previous);
      }
      options?.onError?.(
        err?.message ?? "Couldn't save that — tap to retry.",
      );
    },
    // Reconcile with the server after settle (success OR rollback).
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const sections = useMemo<MatrixSection[]>(() => {
    if (!query.data) return [];
    return buildNotificationMatrix(
      query.data.categories,
      query.data.prefs,
      query.data.suppressions,
    );
  }, [query.data]);

  const toggleChannel = useCallback(
    (args: ToggleChannelArgs) => {
      if (!userId || args.locked) return;
      mutation.mutate(args);
    },
    [userId, mutation],
  );

  const refetch = useCallback(() => {
    query.refetch();
  }, [query]);

  return {
    sections,
    isLoading: query.isLoading,
    isError: query.isError,
    toggleChannel,
    isSaving: mutation.isPending,
    refetch,
  };
}
