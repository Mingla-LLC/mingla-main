import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { Board, BoardCollaborator } from '../types';

export const useBoards = () => {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBoards = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Fetch boards where user is owner
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
      setLoading(false);
    }
  }, []);

  const createBoard = useCallback(async (boardData: {
    name: string;
    description?: string;
    collaborators?: string[];
    sessionId?: string;
  }) => {
    setLoading(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Create the board
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

      // Add collaborators if provided
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

      // Reload boards
      await fetchBoards();

      return { data: board, error: null };
    } catch (err: any) {
      setError(err.message);
      return { data: null, error: err };
    } finally {
      setLoading(false);
    }
  }, [fetchBoards]);

  const updateBoard = useCallback(async (boardId: string, updates: Partial<Board>) => {
    setLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase
        .from('boards')
        .update(updates)
        .eq('id', boardId)
        .select()
        .single();

      if (error) throw error;

      // Reload boards
      await fetchBoards();

      return { data, error: null };
    } catch (err: any) {
      setError(err.message);
      return { data: null, error: err };
    } finally {
      setLoading(false);
    }
  }, [fetchBoards]);

  const deleteBoard = useCallback(async (boardId: string) => {
    setLoading(true);
    setError(null);

    try {
      const { error } = await supabase
        .from('boards')
        .delete()
        .eq('id', boardId);

      if (error) throw error;

      // Reload boards
      await fetchBoards();

      return { error: null };
    } catch (err: any) {
      setError(err.message);
      return { error: err };
    } finally {
      setLoading(false);
    }
  }, [fetchBoards]);

  const addCollaborator = useCallback(async (boardId: string, userId: string, role: 'owner' | 'collaborator' = 'collaborator') => {
    setLoading(true);
    setError(null);

    try {
      const { error } = await supabase
        .from('board_collaborators')
        .insert({
          board_id: boardId,
          user_id: userId,
          role,
        });

      if (error) throw error;

      // Reload boards
      await fetchBoards();

      return { error: null };
    } catch (err: any) {
      setError(err.message);
      return { error: err };
    } finally {
      setLoading(false);
    }
  }, [fetchBoards]);

  const removeCollaborator = useCallback(async (boardId: string, userId: string) => {
    setLoading(true);
    setError(null);

    try {
      const { error } = await supabase
        .from('board_collaborators')
        .delete()
        .eq('board_id', boardId)
        .eq('user_id', userId);

      if (error) throw error;

      // Reload boards
      await fetchBoards();

      return { error: null };
    } catch (err: any) {
      setError(err.message);
      return { error: err };
    } finally {
      setLoading(false);
    }
  }, [fetchBoards]);

  const getBoardCollaborators = useCallback(async (boardId: string) => {
    try {
      const { data, error } = await supabase
        .from('board_collaborators')
        .select(`
          *,
          profiles (*)
        `)
        .eq('board_id', boardId);

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (err: any) {
      return { data: [], error: err };
    }
  }, []);

  // Set up real-time subscriptions
  useEffect(() => {
    const boardChannel = supabase
      .channel('board_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'boards',
        },
        () => {
          fetchBoards();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'board_collaborators',
        },
        () => {
          fetchBoards();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(boardChannel);
    };
  }, [fetchBoards]);

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
