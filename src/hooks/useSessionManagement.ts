import { useState, useEffect, useCallback } from 'react';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';

export interface CollaborationSession {
  id: string;
  name: string;
  participants: Array<{
    id: string;
    name: string;
    username: string;
    avatar: string;
    hasAccepted: boolean;
  }>;
  createdAt: string;
  isActive: boolean;
  boardId?: string;
  status: 'pending' | 'active' | 'dormant';
  invitedBy: string;
}

export interface SessionState {
  currentSession: CollaborationSession | null;
  availableSessions: CollaborationSession[];
  isInSolo: boolean;
}

export const useSessionManagement = () => {
  const [sessionState, setSessionState] = useState<SessionState>({
    currentSession: null,
    availableSessions: [],
    isInSolo: true
  });
  
  const { user } = useAppStore();

  // Mock data for available sessions
  const mockSessions: CollaborationSession[] = [
    {
      id: 'session-1',
      name: 'Weekend Plans with Emma',
      participants: [
        {
          id: '1',
          name: 'Emma Wilson',
          username: 'emmawilson',
          avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80',
          hasAccepted: true
        }
      ],
      createdAt: new Date().toISOString(),
      isActive: true,
      status: 'active',
      invitedBy: 'currentUser'
    },
    {
      id: 'session-2', 
      name: 'Art & Culture Trip',
      participants: [
        {
          id: '2',
          name: 'James Rodriguez',
          username: 'jamesrodriguez',
          avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e',
          hasAccepted: true
        },
        {
          id: '3',
          name: 'Priya Patel',
          username: 'priyapatel',
          avatar: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04',
          hasAccepted: false
        }
      ],
      createdAt: new Date().toISOString(),
      isActive: false,
      status: 'dormant',
      invitedBy: 'currentUser'
    }
  ];

  // Mock friends and recent collaborators
  const mockFriends = [
    {
      id: '4',
      name: 'Sarah Kim',
      username: 'sarahkim',
      avatar: 'https://images.unsplash.com/photo-1494790108755-2616b35a1db4'
    },
    {
      id: '5',
      name: 'Alex Thompson',
      username: 'alexthompson',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d'
    }
  ];

  const mockRecentCollaborators = [
    {
      id: '1',
      name: 'Emma Wilson',
      username: 'emmawilson',
      avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80'
    },
    {
      id: '2',
      name: 'James Rodriguez',
      username: 'jamesrodriguez',
      avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e'
    }
  ];

  // Load available sessions
  useEffect(() => {
    setSessionState(prev => ({
      ...prev,
      availableSessions: mockSessions
    }));
  }, []);

  // Switch to solo session
  const switchToSolo = useCallback(() => {
    if (sessionState.currentSession) {
      // Exit current collaborative session
      toast({
        title: "Left collaboration session",
        description: `You've left "${sessionState.currentSession.name}"`,
      });
    }
    
    setSessionState(prev => ({
      ...prev,
      currentSession: null,
      isInSolo: true
    }));
  }, [sessionState.currentSession]);

  // Switch to collaborative session
  const switchToCollaborative = useCallback(async (sessionId: string) => {
    const session = sessionState.availableSessions.find(s => s.id === sessionId);
    if (!session) return;

    // Simulate creating a board for this session if it doesn't exist
    if (!session.boardId) {
      session.boardId = `board-${sessionId}`;
      
      toast({
        title: "Collaboration started!",
        description: `A board has been automatically created for "${session.name}". Check it out in the Boards section.`,
        duration: 5000,
      });
    } else {
      toast({
        title: "Rejoined collaboration",
        description: `Welcome back to "${session.name}"`,
      });
    }

    setSessionState(prev => ({
      ...prev,
      currentSession: session,
      isInSolo: false
    }));
  }, [sessionState.availableSessions]);

  // Create new collaborative session with pending status
  const createCollaborativeSession = useCallback(async (participants: string[], sessionName?: string) => {
    if (!user) return;

    // Mock creating new session - starts as dormant until all accept
    const newSession: CollaborationSession = {
      id: `session-${Date.now()}`,
      name: sessionName || `Collaboration Session ${new Date().toLocaleDateString()}`,
      participants: participants.map(username => ({
        id: username, // In real app, would resolve to actual user ID
        name: username,
        username,
        avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e', // Default avatar
        hasAccepted: false // All start as not accepted
      })),
      createdAt: new Date().toISOString(),
      isActive: false,
      status: 'pending',
      invitedBy: user.id || 'currentUser',
      boardId: `board-${Date.now()}`
    };

    setSessionState(prev => ({
      ...prev,
      availableSessions: [...prev.availableSessions, newSession]
      // Don't switch to this session yet - it's dormant
    }));

    return newSession;
  }, [user]);

  // Accept invitation to collaborative session
  const acceptSessionInvitation = useCallback(async (sessionId: string) => {
    setSessionState(prev => {
      const updatedSessions = prev.availableSessions.map(session => {
        if (session.id === sessionId) {
          const updatedParticipants = session.participants.map(p => ({
            ...p,
            hasAccepted: p.username === user?.email ? true : p.hasAccepted
          }));
          
          const allAccepted = updatedParticipants.every(p => p.hasAccepted);
          
          return {
            ...session,
            participants: updatedParticipants,
            status: allAccepted ? 'active' as const : 'pending' as const,
            isActive: allAccepted
          };
        }
        return session;
      });

      return {
        ...prev,
        availableSessions: updatedSessions
      };
    });

    toast({
      title: "Invitation accepted!",
      description: "You've joined the collaboration session.",
    });
  }, [user]);

  // Get friends and recent collaborators
  const getFriendsAndCollaborators = useCallback(() => {
    return {
      friends: mockFriends,
      recentCollaborators: mockRecentCollaborators
    };
  }, []);

  // Get session context for swipe actions
  const getSwipeContext = useCallback(() => {
    if (sessionState.isInSolo) {
      return {
        type: 'solo' as const,
        sessionId: null,
        boardId: null
      };
    } else {
      return {
        type: 'collaborative' as const,
        sessionId: sessionState.currentSession?.id || null,
        boardId: sessionState.currentSession?.boardId || null
      };
    }
  }, [sessionState]);

  // Check if user can switch to solo (not allowed mid-collaborative session)
  const canSwitchToSolo = useCallback(() => {
    return sessionState.isInSolo || !sessionState.currentSession;
  }, [sessionState]);

  return {
    sessionState,
    switchToSolo,
    switchToCollaborative,
    createCollaborativeSession,
    acceptSessionInvitation,
    getFriendsAndCollaborators,
    getSwipeContext,
    canSwitchToSolo,
    isInSolo: sessionState.isInSolo,
    currentSession: sessionState.currentSession,
    availableSessions: sessionState.availableSessions
  };
};