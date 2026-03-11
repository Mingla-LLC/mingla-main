import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../store/appStore';
import { realtimeService } from '../services/realtimeService';
import { supabase } from '../services/supabase';
import * as boardService from '../services/boardService';
import type { Board } from '../types';
import type { BoardWithDetails, CreateBoardParams } from '../services/boardService';

// Re-export types for consumers
export type { BoardWithDetails, CreateBoardParams } from '../services/boardService';

// ─── Migration Scope Note ────────────────────────────────────────
// This file defines the complete React Query API surface for boards.
// Currently used by consumers: useCreateBoard (EnhancedBoardModal),
// useAddExperienceToBoard + useRemoveExperienceFromBoard (BoardCollaboration),
// useBoardRealtimeSync (AppStateManager).
//
// The query hooks (useBoardsQuery, useBoardDetailQuery, etc.) and remaining
// mutation hooks are ready for adoption by future components that need
// board list/detail data via React Query instead of manual Supabase calls.
// ─────────────────────────────────────────────────────────────────

// ─── Query Keys ──────────────────────────────────────────────────

export const boardKeys = {
  all: ['boards'] as const,
  lists: () => [...boardKeys.all, 'list'] as const,
  list: (userId: string) => [...boardKeys.lists(), userId] as const,
  details: () => [...boardKeys.all, 'detail'] as const,
  detail: (boardId: string) => [...boardKeys.details(), boardId] as const,
  collaborators: (boardId: string) => [...boardKeys.all, 'collaborators', boardId] as const,
  experiences: (boardId: string) => [...boardKeys.all, 'experiences', boardId] as const,
};

// ─── Query Hooks ─────────────────────────────────────────────────

/** Fetch all boards for the current user. Replaces useBoards().boards and useEnhancedBoards().boards. */
export function useBoardsQuery() {
  const { user } = useAppStore();
  return useQuery({
    queryKey: boardKeys.list(user?.id ?? ''),
    queryFn: () => boardService.fetchUserBoards(user!.id),
    enabled: !!user?.id,
    staleTime: 2 * 60 * 1000, // 2 min — boards change during collaboration sessions
  });
}

/** Fetch a single board by ID. */
export function useBoardDetailQuery(boardId: string | undefined) {
  return useQuery({
    queryKey: boardKeys.detail(boardId ?? ''),
    queryFn: () => boardService.fetchBoard(boardId!),
    enabled: !!boardId,
    staleTime: 2 * 60 * 1000,
  });
}

/** Fetch collaborators for a board. */
export function useBoardCollaboratorsQuery(boardId: string | undefined) {
  return useQuery({
    queryKey: boardKeys.collaborators(boardId ?? ''),
    queryFn: () => boardService.fetchBoardCollaborators(boardId!),
    enabled: !!boardId,
    staleTime: 2 * 60 * 1000,
  });
}

/** Fetch experiences for a board. */
export function useBoardExperiencesQuery(boardId: string | undefined) {
  return useQuery({
    queryKey: boardKeys.experiences(boardId ?? ''),
    queryFn: () => boardService.fetchBoardExperiences(boardId!),
    enabled: !!boardId,
    staleTime: 2 * 60 * 1000,
  });
}

// ─── Mutation Hooks ──────────────────────────────────────────────

/** Create a board. */
export function useCreateBoard() {
  const queryClient = useQueryClient();
  const { user } = useAppStore();

  return useMutation({
    mutationKey: ['boards', 'create'],
    mutationFn: (params: CreateBoardParams) => {
      if (!user?.id) throw new Error('Not authenticated');
      return boardService.createBoard(user.id, params);
    },
    onSuccess: (newBoard) => {
      if (!user?.id) return;
      // Optimistic: prepend to cached list immediately
      queryClient.setQueryData<BoardWithDetails[]>(
        boardKeys.list(user.id),
        (old) => {
          const enriched: BoardWithDetails = {
            ...newBoard,
            collaborators: [],
            experiences: [],
            experience_count: 0,
            last_activity: newBoard.updated_at,
          };
          return old ? [enriched, ...old] : [enriched];
        },
      );
      // Then background-refresh to get server truth
      queryClient.invalidateQueries({ queryKey: boardKeys.lists() });
    },
    onError: (error) => {
      console.error('[useCreateBoard] Failed:', error.message);
    },
  });
}

/** Update a board. */
export function useUpdateBoard() {
  const queryClient = useQueryClient();
  const { user } = useAppStore();

  return useMutation({
    mutationKey: ['boards', 'update'],
    mutationFn: ({ boardId, updates }: { boardId: string; updates: Partial<Board> }) =>
      boardService.updateBoard(boardId, updates),
    onMutate: async ({ boardId, updates }) => {
      // Cancel in-flight queries so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: boardKeys.list(user?.id ?? '') });

      const previousBoards = queryClient.getQueryData<BoardWithDetails[]>(
        boardKeys.list(user?.id ?? ''),
      );

      // Optimistic update
      queryClient.setQueryData<BoardWithDetails[]>(
        boardKeys.list(user?.id ?? ''),
        (old) =>
          old?.map(b =>
            b.id === boardId
              ? { ...b, ...updates, last_activity: new Date().toISOString() }
              : b,
          ) ?? [],
      );

      return { previousBoards };
    },
    onError: (_error, _vars, context) => {
      // Rollback on error
      if (context?.previousBoards) {
        queryClient.setQueryData(
          boardKeys.list(user?.id ?? ''),
          context.previousBoards,
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: boardKeys.lists() });
    },
  });
}

/** Delete a board. */
export function useDeleteBoard() {
  const queryClient = useQueryClient();
  const { user } = useAppStore();

  return useMutation({
    mutationKey: ['boards', 'delete'],
    mutationFn: (boardId: string) => boardService.deleteBoard(boardId),
    onMutate: async (boardId) => {
      await queryClient.cancelQueries({ queryKey: boardKeys.list(user?.id ?? '') });

      const previousBoards = queryClient.getQueryData<BoardWithDetails[]>(
        boardKeys.list(user?.id ?? ''),
      );

      // Optimistic removal
      queryClient.setQueryData<BoardWithDetails[]>(
        boardKeys.list(user?.id ?? ''),
        (old) => old?.filter(b => b.id !== boardId) ?? [],
      );

      return { previousBoards };
    },
    onError: (_error, _boardId, context) => {
      if (context?.previousBoards) {
        queryClient.setQueryData(
          boardKeys.list(user?.id ?? ''),
          context.previousBoards,
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: boardKeys.lists() });
    },
  });
}

/** Add a collaborator by email (looks up user ID). */
export function useAddCollaboratorByEmail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['boards', 'addCollaboratorByEmail'],
    mutationFn: ({ boardId, email, role }: { boardId: string; email: string; role?: string }) =>
      boardService.addCollaboratorByEmail(boardId, email, role),
    onSuccess: (_data, { boardId }) => {
      queryClient.invalidateQueries({ queryKey: boardKeys.collaborators(boardId) });
      queryClient.invalidateQueries({ queryKey: boardKeys.lists() });
    },
    onError: (error) => {
      console.error('[useAddCollaboratorByEmail] Failed:', error.message);
    },
  });
}

/** Add a collaborator by user ID. */
export function useAddCollaboratorById() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['boards', 'addCollaboratorById'],
    mutationFn: ({ boardId, userId, role }: { boardId: string; userId: string; role?: 'owner' | 'collaborator' }) =>
      boardService.addCollaboratorById(boardId, userId, role),
    onSuccess: (_data, { boardId }) => {
      queryClient.invalidateQueries({ queryKey: boardKeys.collaborators(boardId) });
      queryClient.invalidateQueries({ queryKey: boardKeys.lists() });
    },
    onError: (error) => {
      console.error('[useAddCollaboratorById] Failed:', error.message);
    },
  });
}

/** Remove a collaborator. */
export function useRemoveCollaborator() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['boards', 'removeCollaborator'],
    mutationFn: ({ boardId, userId }: { boardId: string; userId: string }) =>
      boardService.removeCollaborator(boardId, userId),
    onSuccess: (_data, { boardId }) => {
      queryClient.invalidateQueries({ queryKey: boardKeys.collaborators(boardId) });
      queryClient.invalidateQueries({ queryKey: boardKeys.lists() });
    },
    onError: (error) => {
      console.error('[useRemoveCollaborator] Failed:', error.message);
    },
  });
}

/** Add an experience to a board. Also sends Realtime broadcast. */
export function useAddExperienceToBoard() {
  const queryClient = useQueryClient();
  const { user } = useAppStore();

  return useMutation({
    mutationKey: ['boards', 'addExperience'],
    mutationFn: ({ boardId, experienceId }: { boardId: string; experienceId: string }) => {
      if (!user?.id) throw new Error('Not authenticated');
      return boardService.addExperienceToBoard(boardId, experienceId, user.id);
    },
    onSuccess: (data, { boardId }) => {
      // Notify other collaborators via Realtime broadcast
      realtimeService.sendBoardUpdate(boardId, 'experience_added', {
        experienceId: data.experience_id,
        addedBy: user?.display_name || user?.email,
        experience: data,
      });

      queryClient.invalidateQueries({ queryKey: boardKeys.experiences(boardId) });
      queryClient.invalidateQueries({ queryKey: boardKeys.lists() });
    },
    onError: (error) => {
      console.error('[useAddExperienceToBoard] Failed:', error.message);
    },
  });
}

/** Remove an experience from a board. Also sends Realtime broadcast. */
export function useRemoveExperienceFromBoard() {
  const queryClient = useQueryClient();
  const { user } = useAppStore();

  return useMutation({
    mutationKey: ['boards', 'removeExperience'],
    mutationFn: ({ boardId, experienceId }: { boardId: string; experienceId: string }) =>
      boardService.removeExperienceFromBoard(boardId, experienceId),
    onSuccess: (_data, { boardId, experienceId }) => {
      realtimeService.sendBoardUpdate(boardId, 'experience_removed', {
        experienceId,
        removedBy: user?.display_name || user?.email,
      });

      queryClient.invalidateQueries({ queryKey: boardKeys.experiences(boardId) });
      queryClient.invalidateQueries({ queryKey: boardKeys.lists() });
    },
    onError: (error) => {
      console.error('[useRemoveExperienceFromBoard] Failed:', error.message);
    },
  });
}

// ─── Realtime Integration ────────────────────────────────────────

/**
 * Hook to set up Realtime subscriptions for board changes.
 * Call this ONCE at a high level (e.g., in AppStateManager).
 *
 * Realtime events trigger queryClient.invalidateQueries() instead of manual refetches.
 * This eliminates the double-fetch race: mutation.onSuccess invalidates,
 * and Realtime also invalidates, but React Query deduplicates them.
 */
export function useBoardRealtimeSync() {
  const queryClient = useQueryClient();
  const { user } = useAppStore();
  const userIdRef = useRef(user?.id);
  userIdRef.current = user?.id;

  useEffect(() => {
    const userId = userIdRef.current;
    if (!userId) return;

    const channel = supabase
      .channel(`board_changes_rq_${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'boards', filter: `created_by=eq.${userId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: boardKeys.lists() });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'board_collaborators', filter: `user_id=eq.${userId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: boardKeys.lists() });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'board_experiences' },
        (payload: any) => {
          // Only invalidate the specific board affected, not all boards
          const boardId = payload.new?.board_id || payload.old?.board_id;
          if (boardId) {
            queryClient.invalidateQueries({ queryKey: boardKeys.experiences(boardId) });
          } else {
            // Fallback: if we can't determine board_id, invalidate all
            queryClient.invalidateQueries({ queryKey: boardKeys.all });
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, user?.id]);
}
