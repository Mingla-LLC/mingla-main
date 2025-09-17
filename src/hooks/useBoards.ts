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

  // Demo boards for showcasing features
  const demoBoards: Board[] = [
    {
      id: 'demo-1',
      name: 'NYC Weekend Adventures',
      description: 'Exploring the best spots in Manhattan with friends',
      created_by: 'demo-user-1',
      is_public: false,
      created_at: '2025-09-10T14:30:00Z',
      updated_at: '2025-09-16T16:45:00Z',
      collaborators: [
        {
          id: 'demo-collab-1',
          board_id: 'demo-1',
          user_id: 'demo-user-1',
          role: 'owner',
          created_at: '2025-09-10T14:30:00Z',
          profile: {
            username: 'sarah_explorer',
            first_name: 'Sarah',
            last_name: 'Johnson',
            avatar_url: 'https://images.unsplash.com/photo-1494790108755-2616b612b547?w=100'
          }
        },
        {
          id: 'demo-collab-2',
          board_id: 'demo-1',
          user_id: 'demo-user-2',
          role: 'collaborator',
          created_at: '2025-09-10T14:35:00Z',
          profile: {
            username: 'mike_adventures',
            first_name: 'Mike',
            last_name: 'Chen',
            avatar_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100'
          }
        }
      ]
    },
    {
      id: 'demo-2',
      name: 'Brooklyn Food Tour',
      description: 'Discovering amazing eats across Brooklyn boroughs',
      created_by: 'demo-user-2',
      is_public: false,
      created_at: '2025-09-12T10:15:00Z',
      updated_at: '2025-09-17T09:20:00Z',
      collaborators: [
        {
          id: 'demo-collab-3',
          board_id: 'demo-2',
          user_id: 'demo-user-2',
          role: 'owner',
          created_at: '2025-09-12T10:15:00Z',
          profile: {
            username: 'mike_adventures',
            first_name: 'Mike',
            last_name: 'Chen',
            avatar_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100'
          }
        },
        {
          id: 'demo-collab-4',
          board_id: 'demo-2',
          user_id: 'demo-user-3',
          role: 'collaborator',
          created_at: '2025-09-12T10:20:00Z',
          profile: {
            username: 'emma_foodie',
            first_name: 'Emma',
            last_name: 'Davis',
            avatar_url: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100'
          }
        },
        {
          id: 'demo-collab-5',
          board_id: 'demo-2',
          user_id: 'demo-user-4',
          role: 'collaborator',
          created_at: '2025-09-12T10:25:00Z',
          profile: {
            username: 'lisa_nature',
            first_name: 'Lisa',
            last_name: 'Wilson',
            avatar_url: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100'
          }
        }
      ]
    },
    {
      id: 'demo-3',
      name: 'Art & Culture Crawl',
      description: 'Museums, galleries and creative spaces in the city',
      created_by: 'demo-user-3',
      is_public: true,
      created_at: '2025-09-08T11:00:00Z',
      updated_at: '2025-09-15T13:30:00Z',
      collaborators: [
        {
          id: 'demo-collab-6',
          board_id: 'demo-3',
          user_id: 'demo-user-3',
          role: 'owner',
          created_at: '2025-09-08T11:00:00Z',
          profile: {
            username: 'emma_foodie',
            first_name: 'Emma',
            last_name: 'Davis',
            avatar_url: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100'
          }
        },
        {
          id: 'demo-collab-7',
          board_id: 'demo-3',
          user_id: 'demo-user-1',
          role: 'collaborator',
          created_at: '2025-09-08T11:05:00Z',
          profile: {
            username: 'sarah_explorer',
            first_name: 'Sarah',
            last_name: 'Johnson',
            avatar_url: 'https://images.unsplash.com/photo-1494790108755-2616b612b547?w=100'
          }
        }
      ]
    },
    {
      id: 'demo-4',
      name: 'Central Park & Chill',
      description: 'Relaxed outdoor activities and cafe hopping',
      created_by: 'demo-user-4',
      is_public: false,
      created_at: '2025-09-14T16:20:00Z',
      updated_at: '2025-09-17T08:15:00Z',
      collaborators: [
        {
          id: 'demo-collab-8',
          board_id: 'demo-4',
          user_id: 'demo-user-4',
          role: 'owner',
          created_at: '2025-09-14T16:20:00Z',
          profile: {
            username: 'alex_culture',
            first_name: 'Alex',
            last_name: 'Rodriguez',
            avatar_url: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100'
          }
        },
        {
          id: 'demo-collab-9',
          board_id: 'demo-4',
          user_id: 'demo-user-5',
          role: 'collaborator',
          created_at: '2025-09-14T16:25:00Z',
          profile: {
            username: 'lisa_nature',
            first_name: 'Lisa',
            last_name: 'Wilson',
            avatar_url: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100'
          }
        }
      ]
    }
  ];

  // Load user's boards
  const loadBoards = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log('No user found, showing demo data');
        setBoards(demoBoards);
        setLoading(false);
        return;
      }

      // Try to get user's boards, but fallback to demo data
      const { data: userBoards, error } = await supabase
        .from('boards')
        .select(`
          id, name, description, created_by, session_id, is_public, created_at, updated_at
        `)
        .eq('created_by', user.id);

      if (error || !userBoards || userBoards.length === 0) {
        console.log('No user boards found or error, showing demo data');
        setBoards(demoBoards);
        setLoading(false);
        return;
      }

      // If we have real boards, process them
      const formattedBoards: Board[] = userBoards.map(board => ({
        ...board,
        collaborators: []
      }));
      
      setBoards(formattedBoards);
    } catch (error) {
      console.error('Error loading boards:', error);
      // Show demo boards when there's an error
      setBoards(demoBoards);
    } finally {
      setLoading(false);
    }
  }, [demoBoards]);

  // Create a new board with optional collaboration session
  const createBoard = useCallback(async (name: string, description?: string, sessionId?: string, collaboratorUserIds?: string[]) => {
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

      // Add additional collaborators if provided
      if (collaboratorUserIds && collaboratorUserIds.length > 0) {
        const collaboratorInserts = collaboratorUserIds.map(userId => ({
          board_id: boardData.id,
          user_id: userId,
          role: 'collaborator' as const
        }));
        
        await supabase
          .from('board_collaborators')
          .insert(collaboratorInserts);
      }

      await loadBoards();
      
      const collaboratorCount = collaboratorUserIds?.length || 0;
      toast({
        title: "Board created!",
        description: collaboratorCount > 0 
          ? `"${name}" has been created with ${collaboratorCount} collaborator(s).`
          : `"${name}" has been created successfully.`,
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