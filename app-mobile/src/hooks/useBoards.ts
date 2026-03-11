import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../services/supabase';
import { Board, BoardCollaborator } from '../types';

export const useBoards = () => {
  const [boards, setBoards] = useState<Board[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Track in-flight operations by count, not boolean.
  // loading = true when ANY operation is in flight.
  const inflightRef = useRef(0);
  const [loading, setLoading] = useState(false);

  const startLoading = useCallback(() => {
    inflightRef.current += 1;
    setLoading(true);
  }, []);

  const stopLoading = useCallback(() => {
    inflightRef.current = Math.max(0, inflightRef.current - 1);
    if (inflightRef.current === 0) {
      setLoading(false);
    }
  }, []);

  // Stable user ID ref to avoid re-subscribing on every render
  const userIdRef = useRef<string | null>(null);

  const fetchBoards = useCallback(async () => {
    startLoading();
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');
      userIdRef.current = user.id;

      const { data, error } = await supabase
        .from('boards')
        .select('*')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setBoards(data || []);
    } catch (err: any) {
      setError(err.message);
      console.error('Error fetching boards:', err);
    } finally {
      stopLoading();
    }
  }, [startLoading, stopLoading]);

  const createBoard = useCallback(async (boardData: {
    name: string;
    description?: string;
    collaborators?: string[];
    sessionId?: string;
  }) => {
    startLoading();
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data: board, error: boardError } = await supabase
        .from('boards')
        .insert({
          name: boardData.name,
          description: boardData.description,
          created_by: user.id,
          session_id: boardData.sessionId,
          is_public: false,
        })
        .select()
        .single();

      if (boardError) throw boardError;

      if (boardData.collaborators && boardData.collaborators.length > 0) {
        const collaboratorPromises = boardData.collaborators.map(async (collaboratorId) => {
          const { error: collaboratorError } = await supabase
            .from('board_collaborators')
            .insert({
              board_id: board.id,
              user_id: collaboratorId,
              role: 'collaborator',
            });
          if (collaboratorError) {
            console.error('Error adding collaborator:', collaboratorError);
          }
        });
        await Promise.all(collaboratorPromises);
      }

      // Don't call fetchBoards() here — the Realtime subscription will handle it.
      // This prevents the double-fetch race condition.
      // Instead, optimistically add the board to local state.
      setBoards(prev => [board, ...prev]);

      return { data: board, error: null };
    } catch (err: any) {
      setError(err.message);
      return { data: null, error: err };
    } finally {
      stopLoading();
    }
  }, [startLoading, stopLoading]);

  const updateBoard = useCallback(async (boardId: string, updates: Partial<Board>) => {
    startLoading();
    setError(null);

    try {
      const { data, error } = await supabase
        .from('boards')
        .update(updates)
        .eq('id', boardId)
        .select()
        .single();

      if (error) throw error;

      // Optimistic local update instead of full refetch
      setBoards(prev => prev.map(b => b.id === boardId ? { ...b, ...data } : b));

      return { data, error: null };
    } catch (err: any) {
      setError(err.message);
      return { data: null, error: err };
    } finally {
      stopLoading();
    }
  }, [startLoading, stopLoading]);

  const deleteBoard = useCallback(async (boardId: string) => {
    startLoading();
    setError(null);

    try {
      const { error } = await supabase
        .from('boards')
        .delete()
        .eq('id', boardId);

      if (error) throw error;

      // Optimistic local removal instead of full refetch
      setBoards(prev => prev.filter(b => b.id !== boardId));

      return { error: null };
    } catch (err: any) {
      setError(err.message);
      return { error: err };
    } finally {
      stopLoading();
    }
  }, [startLoading, stopLoading]);

  const addCollaborator = useCallback(async (boardId: string, userId: string, role: 'owner' | 'collaborator' = 'collaborator') => {
    startLoading();
    setError(null);

    try {
      const { error } = await supabase
        .from('board_collaborators')
        .insert({ board_id: boardId, user_id: userId, role });

      if (error) throw error;

      return { error: null };
    } catch (err: any) {
      setError(err.message);
      return { error: err };
    } finally {
      stopLoading();
    }
  }, [startLoading, stopLoading]);

  const removeCollaborator = useCallback(async (boardId: string, userId: string) => {
    startLoading();
    setError(null);

    try {
      const { error } = await supabase
        .from('board_collaborators')
        .delete()
        .eq('board_id', boardId)
        .eq('user_id', userId);

      if (error) throw error;

      return { error: null };
    } catch (err: any) {
      setError(err.message);
      return { error: err };
    } finally {
      stopLoading();
    }
  }, [startLoading, stopLoading]);

  const getBoardCollaborators = useCallback(async (boardId: string) => {
    try {
      const { data, error } = await supabase
        .from('board_collaborators')
        .select(`*, profiles (*)`)
        .eq('board_id', boardId);

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (err: any) {
      return { data: [], error: err };
    }
  }, []);

  // Debounced refetch for Realtime events.
  // Multiple rapid Realtime events (e.g., during account deletion) only trigger ONE refetch.
  const realtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedFetchBoards = useCallback(() => {
    if (realtimeDebounceRef.current) {
      clearTimeout(realtimeDebounceRef.current);
    }
    realtimeDebounceRef.current = setTimeout(() => {
      // Only refetch if no mutation is in flight.
      // This prevents the Realtime → fetchBoards race during mutations.
      if (inflightRef.current === 0) {
        fetchBoards();
      }
    }, 300);
  }, [fetchBoards]);

  // Set up Realtime subscriptions — filtered to current user
  useEffect(() => {
    const boardChannel = supabase
      .channel('board_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'boards' },
        () => { debouncedFetchBoards(); }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'board_collaborators' },
        () => { debouncedFetchBoards(); }
      )
      .subscribe();

    return () => {
      if (realtimeDebounceRef.current) {
        clearTimeout(realtimeDebounceRef.current);
      }
      supabase.removeChannel(boardChannel);
    };
  }, [debouncedFetchBoards]);

  // Load boards on mount
  useEffect(() => {
    fetchBoards();
  }, [fetchBoards]);

  return {
    boards,
    loading,
    error,
    fetchBoards,
    createBoard,
    updateBoard,
    deleteBoard,
    addCollaborator,
    removeCollaborator,
    getBoardCollaborators,
  };
};
