import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

export interface Board {
  id: string;
  name: string;
  description?: string;
  created_by: string;
  session_id?: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  collaborators?: BoardCollaborator[];
  creator_profile?: {
    username: string;
    first_name?: string;
    last_name?: string;
  };
}

export interface BoardCollaborator {
  id: string;
  board_id: string;
  user_id: string;
  role: 'owner' | 'collaborator';
  created_at: string;
  profile?: {
    username: string;
    first_name?: string;
    last_name?: string;
    avatar_url?: string;
  };
}

export const useBoards = () => {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(false);

  // Load user's boards
  const loadBoards = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setBoards([]);
        return;
      }

      // Get boards created by user or where user is a collaborator  
      const { data: boardsData, error } = await supabase
        .from('boards')
        .select(`
          id, name, description, created_by, session_id, is_public, created_at, updated_at
        `)
        .or(`created_by.eq.${user.id},id.in.(select board_id from board_collaborators where user_id = '${user.id}')`);

      if (error) {
        // If there's an error but it's just because no boards exist, that's fine
        console.log('Boards query result:', error);
        setBoards([]);
        return;
      }

      // Get collaborators separately to avoid relation issues
      let formattedBoards: Board[] = [];
      
      if (boardsData && boardsData.length > 0) {
        const boardIds = boardsData.map(b => b.id);
        
        // Get creator profiles
        const creatorIds = [...new Set(boardsData.map(b => b.created_by))];
        const { data: creatorProfiles } = await supabase
          .from('profiles')
          .select('id, username, first_name, last_name')
          .in('id', creatorIds);
        
        // Get all collaborators for these boards
        const { data: collaboratorsData } = await supabase
          .from('board_collaborators')
          .select('id, board_id, user_id, role, created_at')
          .in('board_id', boardIds);

        // Get profiles for collaborators
        let collaboratorProfiles: any[] = [];
        if (collaboratorsData && collaboratorsData.length > 0) {
          const collaboratorUserIds = [...new Set(collaboratorsData.map(c => c.user_id))];
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, username, first_name, last_name, avatar_url')
            .in('id', collaboratorUserIds);
          collaboratorProfiles = profiles || [];
        }

        formattedBoards = boardsData.map(board => {
          const creatorProfile = creatorProfiles?.find(p => p.id === board.created_by);
          const boardCollaborators = (collaboratorsData || [])
            .filter(c => c.board_id === board.id)
            .map(c => {
              const profile = collaboratorProfiles.find(p => p.id === c.user_id);
              return {
                id: c.id,
                board_id: c.board_id,
                user_id: c.user_id,
                role: c.role as 'owner' | 'collaborator',
                created_at: c.created_at,
                profile
              } as BoardCollaborator;
            });

          return {
            ...board,
            creator_profile: creatorProfile,
            collaborators: boardCollaborators
          } as Board;
        });
      }

      setBoards(formattedBoards);
    } catch (error) {
      console.error('Error loading boards:', error);
      // Don't show error toast for empty state - just set empty boards
      setBoards([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Create a new board
  const createBoard = useCallback(async (name: string, description?: string, sessionId?: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: boardData, error } = await supabase
        .from('boards')
        .insert({
          name,
          description,
          created_by: user.id,
          session_id: sessionId,
          is_public: false
        })
        .select()
        .single();

      if (error) throw error;

      // Add creator as owner in collaborators
      await supabase
        .from('board_collaborators')
        .insert({
          board_id: boardData.id,
          user_id: user.id,
          role: 'owner'
        });

      await loadBoards();
      
      toast({
        title: "Board created!",
        description: `"${name}" has been created successfully.`,
      });

      return boardData;
    } catch (error) {
      console.error('Error creating board:', error);
      toast({
        title: "Error",
        description: "Failed to create board",
        variant: "destructive"
      });
      return null;
    }
  }, [loadBoards]);

  // Add collaborator to board
  const addCollaborator = useCallback(async (boardId: string, userId: string, role: 'collaborator' | 'owner' = 'collaborator') => {
    try {
      const { error } = await supabase
        .from('board_collaborators')
        .insert({
          board_id: boardId,
          user_id: userId,
          role
        });

      if (error) throw error;

      await loadBoards();
      
      toast({
        title: "Collaborator added!",
        description: "The user has been added to the board.",
      });
    } catch (error) {
      console.error('Error adding collaborator:', error);
      toast({
        title: "Error",
        description: "Failed to add collaborator",
        variant: "destructive"
      });
    }
  }, [loadBoards]);

  // Remove collaborator from board
  const removeCollaborator = useCallback(async (boardId: string, userId: string) => {
    try {
      const { error } = await supabase
        .from('board_collaborators')
        .delete()
        .eq('board_id', boardId)
        .eq('user_id', userId);

      if (error) throw error;

      await loadBoards();
      
      toast({
        title: "Collaborator removed",
        description: "The user has been removed from the board.",
      });
    } catch (error) {
      console.error('Error removing collaborator:', error);
      toast({
        title: "Error",
        description: "Failed to remove collaborator",
        variant: "destructive"
      });
    }
  }, [loadBoards]);

  // Update board
  const updateBoard = useCallback(async (boardId: string, updates: Partial<Pick<Board, 'name' | 'description' | 'is_public'>>) => {
    try {
      const { error } = await supabase
        .from('boards')
        .update(updates)
        .eq('id', boardId);

      if (error) throw error;

      await loadBoards();
      
      toast({
        title: "Board updated!",
        description: "The board has been updated successfully.",
      });
    } catch (error) {
      console.error('Error updating board:', error);
      toast({
        title: "Error",
        description: "Failed to update board",
        variant: "destructive"
      });
    }
  }, [loadBoards]);

  // Delete board
  const deleteBoard = useCallback(async (boardId: string) => {
    try {
      const { error } = await supabase
        .from('boards')
        .delete()
        .eq('id', boardId);

      if (error) throw error;

      await loadBoards();
      
      toast({
        title: "Board deleted",
        description: "The board has been deleted successfully.",
      });
    } catch (error) {
      console.error('Error deleting board:', error);
      toast({
        title: "Error",
        description: "Failed to delete board",
        variant: "destructive"
      });
    }
  }, [loadBoards]);

  // Load boards on mount
  useEffect(() => {
    loadBoards();
  }, [loadBoards]);

  return {
    boards,
    loading,
    loadBoards,
    createBoard,
    updateBoard,
    deleteBoard,
    addCollaborator,
    removeCollaborator
  };
};