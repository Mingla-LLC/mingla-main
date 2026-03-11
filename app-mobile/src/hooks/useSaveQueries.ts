import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../store/appStore';
import { supabase } from '../services/supabase';
import * as savesService from '../services/savesService';

// Re-export types for consumers
export type { SavedExperience } from '../services/savesService';

// ─── Migration Scope Note ────────────────────────────────────────
// This file defines the complete React Query API surface for saves.
// Currently used: useSavesRealtimeSync (AppStateManager).
//
// The query/mutation hooks (useSavesQuery, useAddSave, useUpdateSave,
// useRemoveSave) are ready for adoption by components that need saved
// experience data via React Query instead of manual Supabase calls.
// ─────────────────────────────────────────────────────────────────

// ─── Query Keys ──────────────────────────────────────────────────

export const saveKeys = {
  all: ['saves'] as const,
  lists: () => [...saveKeys.all, 'list'] as const,
  list: (userId: string) => [...saveKeys.lists(), userId] as const,
};

// ─── Query Hooks ─────────────────────────────────────────────────

/** Fetch all saved experiences for the current user. Replaces useSaves().saves. */
export function useSavesQuery() {
  const { user } = useAppStore();
  return useQuery({
    queryKey: saveKeys.list(user?.id ?? ''),
    queryFn: () => savesService.fetchSaves(user!.id),
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000, // 5 min — saves change less frequently than boards
  });
}

// ─── Mutation Hooks ──────────────────────────────────────────────

/** Save an experience. */
export function useAddSave() {
  const queryClient = useQueryClient();
  const { user } = useAppStore();

  return useMutation({
    mutationKey: ['saves', 'add'],
    mutationFn: ({
      experienceId,
      status,
      scheduledAt,
    }: {
      experienceId: string;
      status?: string;
      scheduledAt?: string;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      return savesService.addSave(user.id, experienceId, status, scheduledAt);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: saveKeys.lists() });
    },
    onError: (error) => {
      console.error('[useAddSave] Failed:', error.message);
    },
  });
}

/** Update a saved experience. */
export function useUpdateSave() {
  const queryClient = useQueryClient();
  const { user } = useAppStore();

  return useMutation({
    mutationKey: ['saves', 'update'],
    mutationFn: ({
      cardId,
      updates,
    }: {
      cardId: string;
      updates: Partial<savesService.SavedExperience>;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      return savesService.updateSave(user.id, cardId, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: saveKeys.lists() });
    },
    onError: (error) => {
      console.error('[useUpdateSave] Failed:', error.message);
    },
  });
}

/** Remove a saved experience. */
export function useRemoveSave() {
  const queryClient = useQueryClient();
  const { user } = useAppStore();

  return useMutation({
    mutationKey: ['saves', 'remove'],
    mutationFn: (cardId: string) => {
      if (!user?.id) throw new Error('Not authenticated');
      return savesService.removeSave(user.id, cardId);
    },
    onMutate: async (cardId) => {
      await queryClient.cancelQueries({ queryKey: saveKeys.list(user?.id ?? '') });

      const previousSaves = queryClient.getQueryData<savesService.SavedExperience[]>(
        saveKeys.list(user?.id ?? ''),
      );

      // Optimistic removal
      queryClient.setQueryData<savesService.SavedExperience[]>(
        saveKeys.list(user?.id ?? ''),
        (old) => old?.filter(s => s.card_id !== cardId) ?? [],
      );

      return { previousSaves };
    },
    onError: (_error, _cardId, context) => {
      if (context?.previousSaves) {
        queryClient.setQueryData(
          saveKeys.list(user?.id ?? ''),
          context.previousSaves,
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: saveKeys.lists() });
    },
  });
}

// ─── Realtime Integration ────────────────────────────────────────

/**
 * Hook to set up Realtime subscriptions for saved experiences.
 * Call this ONCE at a high level (e.g., alongside useBoardRealtimeSync).
 */
export function useSavesRealtimeSync() {
  const queryClient = useQueryClient();
  const { user } = useAppStore();
  const userIdRef = useRef(user?.id);
  userIdRef.current = user?.id;

  useEffect(() => {
    const userId = userIdRef.current;
    if (!userId) return;

    const channel = supabase
      .channel(`saved_experiences_changes_rq_${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'saved_experiences', filter: `user_id=eq.${userId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: saveKeys.lists() });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, user?.id]);
}
