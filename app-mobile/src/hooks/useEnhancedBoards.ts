import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../services/supabase';
import { realtimeService } from '../services/realtimeService';
import { useAppStore } from '../store/appStore';
import { Board, Save } from '../types';

export interface BoardWithDetails extends Board {
  collaborators: any[];
  experiences: any[];
  experience_count: number;
  last_activity: string;
}

export interface CreateBoardData {
  name: string;
  description?: string;
  collaborators?: string[];
  sessionId?: string;
  isPublic?: boolean;
}

export const useEnhancedBoards = () => {
  const { user, currentSession } = useAppStore();
  const [boards, setBoards] = useState<BoardWithDetails[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeBoard, setActiveBoard] = useState<BoardWithDetails | null>(null);

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

  // Load user boards
  const loadUserBoards = useCallback(async () => {
    if (!user) return;

    startLoading();
    setError(null);

    try {
      // Load boards where user is owner
      const { data: boardsData, error: boardsError } = await supabase
        .from('boards')
        .select('*')
        .eq('created_by', user.id)
        .order('updated_at', { ascending: false });

      if (boardsError) throw boardsError;

      // Transform data to include computed fields
      const transformedBoards: BoardWithDetails[] = (boardsData || []).map(board => ({
        ...board,
        collaborators: [], // Will be loaded separately if needed
        experiences: [], // Will be loaded separately if needed
        experience_count: 0, // Will be calculated separately if needed
        last_activity: board.updated_at,
      }));

      setBoards(transformedBoards);
    } catch (err: any) {
      setError(err.message);
    } finally {
      stopLoading();
    }
  }, [user, startLoading, stopLoading]);

  // Create new board
  const createBoard = useCallback(async (boardData: CreateBoardData) => {
    if (!user) return { data: null, error: new Error('No user logged in') };

    startLoading();
    setError(null);

    try {
      // Create board
      const { data: board, error: boardError } = await supabase
        .from('boards')
        .insert({
          name: boardData.name,
          description: boardData.description,
          created_by: user.id,
          session_id: boardData.sessionId || currentSession?.id,
          is_public: boardData.isPublic || false,
        })
        .select()
        .single();

      if (boardError) throw boardError;

      // Add collaborators if provided
      if (boardData.collaborators && boardData.collaborators.length > 0) {
        const collaboratorInserts = boardData.collaborators.map(email => ({
          board_id: board.id,
          user_id: email, // This should be user ID, not email
          role: 'member',
        }));

        const { error: collaboratorsError } = await supabase
          .from('board_collaborators')
          .insert(collaboratorInserts);

        if (collaboratorsError) {
          console.warn('Error adding collaborators:', collaboratorsError);
        }
      }

      // Optimistic local update instead of full refetch
      const transformedBoard: BoardWithDetails = {
        ...board,
        collaborators: [],
        experiences: [],
        experience_count: 0,
        last_activity: board.updated_at,
      };
      setBoards(prev => [transformedBoard, ...prev]);

      return { data: board, error: null };
    } catch (err: any) {
      setError(err.message);
      return { data: null, error: err };
    } finally {
      stopLoading();
    }
  }, [user, currentSession, startLoading, stopLoading]);

  // Update board
  const updateBoard = useCallback(async (boardId: string, updates: Partial<Board>) => {
    startLoading();
    setError(null);

    try {
      const { data, error } = await supabase
        .from('boards')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', boardId)
        .select()
        .single();

      if (error) throw error;

      // Optimistic local update instead of full refetch
      setBoards(prev => prev.map(b => b.id === boardId ? { ...b, ...data, last_activity: data.updated_at } : b));

      return { data, error: null };
    } catch (err: any) {
      setError(err.message);
      return { data: null, error: err };
    } finally {
      stopLoading();
    }
  }, [startLoading, stopLoading]);

  // Delete board
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

      return { data: null, error: null };
    } catch (err: any) {
      setError(err.message);
      return { data: null, error: err };
    } finally {
      stopLoading();
    }
  }, [startLoading, stopLoading]);

  // Add experience to board
  const addExperienceToBoard = useCallback(async (boardId: string, experienceId: string) => {
    startLoading();
    setError(null);

    try {
      const { data, error } = await supabase
        .from('board_experiences')
        .insert({
          board_id: boardId,
          experience_id: experienceId,
          added_by: user?.id,
        })
        .select()
        .single();

      if (error) throw error;

      // Notify other collaborators
      realtimeService.sendBoardUpdate(boardId, 'experience_added', {
        experienceId,
        addedBy: user?.display_name || user?.email,
        experience: data,
      });

      // Optimistic local update instead of full refetch
      setBoards(prev => prev.map(b =>
        b.id === boardId
          ? { ...b, experiences: [...b.experiences, data], experience_count: b.experience_count + 1 }
          : b
      ));

      return { data, error: null };
    } catch (err: any) {
      setError(err.message);
      return { data: null, error: err };
    } finally {
      stopLoading();
    }
  }, [user, startLoading, stopLoading]);

  // Remove experience from board
  const removeExperienceFromBoard = useCallback(async (boardId: string, experienceId: string) => {
    startLoading();
    setError(null);

    try {
      const { error } = await supabase
        .from('board_experiences')
        .delete()
        .eq('board_id', boardId)
        .eq('experience_id', experienceId);

      if (error) throw error;

      // Notify other collaborators
      realtimeService.sendBoardUpdate(boardId, 'experience_removed', {
        experienceId,
        removedBy: user?.display_name || user?.email,
      });

      // Optimistic local update instead of full refetch
      setBoards(prev => prev.map(b =>
        b.id === boardId
          ? {
              ...b,
              experiences: b.experiences.filter(e => e.experience_id !== experienceId),
              experience_count: Math.max(0, b.experience_count - 1),
            }
          : b
      ));

      return { data: null, error: null };
    } catch (err: any) {
      setError(err.message);
      return { data: null, error: err };
    } finally {
      stopLoading();
    }
  }, [user, startLoading, stopLoading]);

  // Add collaborator to board
  const addCollaborator = useCallback(async (boardId: string, userEmail: string, role: string = 'member') => {
    startLoading();
    setError(null);

    try {
      // Find user by email
      const { data: invitedUser, error: userError } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', userEmail)
        .single();

      if (userError || !invitedUser) {
        throw new Error('User not found');
      }

      // Add as collaborator
      const { data, error } = await supabase
        .from('board_collaborators')
        .insert({
          board_id: boardId,
          user_id: invitedUser.id,
          role,
        })
        .select()
        .single();

      if (error) throw error;

      // Optimistic local update — add collaborator to the board's list
      setBoards(prev => prev.map(b =>
        b.id === boardId
          ? { ...b, collaborators: [...b.collaborators, data] }
          : b
      ));

      return { data, error: null };
    } catch (err: any) {
      setError(err.message);
      return { data: null, error: err };
    } finally {
      stopLoading();
    }
  }, [startLoading, stopLoading]);

  // Remove collaborator from board
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

      // Optimistic local update — remove collaborator from the board's list
      setBoards(prev => prev.map(b =>
        b.id === boardId
          ? { ...b, collaborators: b.collaborators.filter(c => c.user_id !== userId) }
          : b
      ));

      return { data: null, error: null };
    } catch (err: any) {
      setError(err.message);
      return { data: null, error: err };
    } finally {
      stopLoading();
    }
  }, [startLoading, stopLoading]);

  // Debounce ref for Realtime callbacks from subscribeToBoard
  const realtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedLoadUserBoards = useCallback(() => {
    if (realtimeDebounceRef.current) {
      clearTimeout(realtimeDebounceRef.current);
    }
    realtimeDebounceRef.current = setTimeout(() => {
      // Only refetch if no mutation is in flight
      if (inflightRef.current === 0) {
        loadUserBoards();
      }
    }, 300);
  }, [loadUserBoards]);

  // Set active board for real-time collaboration
  const setActiveBoardForCollaboration = useCallback((board: BoardWithDetails | null) => {
    if (activeBoard) {
      // Unsubscribe from previous board
      realtimeService.unsubscribe(`board:${activeBoard.id}`);
    }

    setActiveBoard(board);

    if (board) {
      // Subscribe to real-time updates with debounce protection
      realtimeService.subscribeToBoard(board.id, {
        onBoardUpdated: (updatedBoard) => {
          // Only apply if no mutation is in flight to prevent race conditions
          if (inflightRef.current === 0) {
            setBoards(prev => prev.map(b =>
              b.id === board.id ? { ...b, ...updatedBoard } : b
            ));
            setActiveBoard(prev => prev?.id === board.id ? { ...prev, ...updatedBoard } : prev);
          }
        },
        onExperienceAdded: (experience) => {
          setBoards(prev => prev.map(b =>
            b.id === board.id
              ? { ...b, experiences: [...b.experiences, experience], experience_count: b.experience_count + 1 }
              : b
          ));
          setActiveBoard(prev => prev?.id === board.id
            ? { ...prev, experiences: [...prev.experiences, experience], experience_count: prev.experience_count + 1 }
            : prev
          );
        },
        onExperienceRemoved: (experienceId) => {
          setBoards(prev => prev.map(b =>
            b.id === board.id
              ? {
                  ...b,
                  experiences: b.experiences.filter(e => e.experience_id !== experienceId),
                  experience_count: Math.max(0, b.experience_count - 1)
                }
              : b
          ));
          setActiveBoard(prev => prev?.id === board.id
            ? {
                ...prev,
                experiences: prev.experiences.filter(e => e.experience_id !== experienceId),
                experience_count: Math.max(0, prev.experience_count - 1)
              }
            : prev
          );
        },
        onCollaboratorJoined: (collaborator) => {
          setBoards(prev => prev.map(b =>
            b.id === board.id
              ? { ...b, collaborators: [...b.collaborators, collaborator] }
              : b
          ));
          setActiveBoard(prev => prev?.id === board.id
            ? { ...prev, collaborators: [...prev.collaborators, collaborator] }
            : prev
          );
        },
        onCollaboratorLeft: (collaborator) => {
          setBoards(prev => prev.map(b =>
            b.id === board.id
              ? { ...b, collaborators: b.collaborators.filter(c => c.id !== collaborator.id) }
              : b
          ));
          setActiveBoard(prev => prev?.id === board.id
            ? { ...prev, collaborators: prev.collaborators.filter(c => c.id !== collaborator.id) }
            : prev
          );
        },
      });
    }
  }, [activeBoard]);

  // Load initial data
  useEffect(() => {
    loadUserBoards();
  }, [loadUserBoards]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (activeBoard) {
        realtimeService.unsubscribe(`board:${activeBoard.id}`);
      }
      if (realtimeDebounceRef.current) {
        clearTimeout(realtimeDebounceRef.current);
      }
    };
  }, [activeBoard]);

  return {
    // State
    boards,
    activeBoard,
    loading,
    error,

    // Actions
    loadUserBoards,
    createBoard,
    updateBoard,
    deleteBoard,
    addExperienceToBoard,
    removeExperienceFromBoard,
    addCollaborator,
    removeCollaborator,
    setActiveBoardForCollaboration,
  };
};
