// Collaboration Module Type Definitions

export interface Friend {
  id: string;
  name: string;
  username?: string;
  avatar?: string;
  status: 'online' | 'offline';
  lastActive?: string;
}

export interface CollaborationInvite {
  id: string;
  sessionName: string;
  fromUser: Friend;
  toUser: Friend;
  status: 'pending' | 'accepted' | 'declined' | 'canceled';
  createdAt: string;
  expiresAt?: string;
}

export interface CollaborationSession {
  id: string;
  name: string;
  status: 'pending' | 'active' | 'archived';
  participants: Friend[];
  createdBy: string;
  createdAt: string;
  lastActivity: string;
  hasCollabPreferences?: boolean;
  pendingParticipants: number;
  totalParticipants: number;
  boardCards: number;
}

export interface CollaborationModuleProps {
  isOpen: boolean;
  onClose: () => void;
  currentMode: 'solo' | string;
  onModeChange: (mode: 'solo' | string) => void;
  preSelectedFriend?: Friend | null;
  boardsSessions?: any[];
  onUpdateBoardSession?: (updatedBoard: any) => void;
  onCreateSession?: (newSession: any) => void;
  onNavigateToBoard?: (board: any, discussionTab?: string) => void;
  availableFriends?: Friend[];
}

export interface SessionsTabProps {
  currentMode: string;
  sessions: CollaborationSession[];
  boardsSessions: any[];
  onModeChange: (mode: 'solo' | string) => void;
  onNavigateToBoard?: (board: any, discussionTab?: string) => void;
}

export interface InvitesTabProps {
  sentInvites: CollaborationInvite[];
  receivedInvites: CollaborationInvite[];
  showInviteType: 'sent' | 'received';
  onShowInviteTypeChange: (type: 'sent' | 'received') => void;
  onAcceptInvite: (inviteId: string) => void;
  onDeclineInvite: (inviteId: string) => void;
  onCancelInvite: (inviteId: string) => void;
}

export interface CreateTabProps {
  createStep: 'details' | 'friends' | 'confirm';
  newSessionName: string;
  selectedFriends: Friend[];
  availableFriends: Friend[];
  preSelectedFriend?: Friend | null;
  onCreateStepChange: (step: 'details' | 'friends' | 'confirm') => void;
  onSessionNameChange: (name: string) => void;
  onToggleFriend: (friend: Friend) => void;
  onCreateSession: () => void;
  onGoBack: () => void;
}

export type CreateStep = 'details' | 'friends' | 'confirm';
export type ActiveTab = 'sessions' | 'invites' | 'create';
export type InviteType = 'sent' | 'received';
