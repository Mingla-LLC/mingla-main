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
  type NotificationMatrixData,
} from '../services/notificationPrefsService';
import {
  buildNotificationMatrix,
  buildChannelPrefUpsert,
  type MatrixSection,
  type ChannelPrefRow,
  type NotificationChannel,
} from '../components/profile/notificationPrefsMatrix';
import { notificationPrefsKeys } from './queryKeys';

export interface ToggleChannelArgs {
  categoryKey: string;
  channel: NotificationChannel;
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
      const payload = buildChannelPrefUpsert({
        userId: userId as string,
        categoryKey: args.categoryKey,
        channel: args.channel,
        nextEnabled: args.nextEnabled,
        locked: args.locked,
      });
      // Locked chips never write — guard belongs to the core; this is defence-in-depth.
      if (!payload) return;
      await upsertChannelPref(payload);
    },
    // Optimistic: flip the cached pref row immediately so the chip moves with the tap.
    onMutate: async (args) => {
      if (args.locked) return {};
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<NotificationMatrixData>(key);
      if (previous) {
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
    return buildNotificationMatrix(query.data.categories, query.data.prefs);
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
