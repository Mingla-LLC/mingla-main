// Connections Page Types

export interface Friend {
  id: string;
  name: string;
  username: string;
  avatar?: string;
  status: 'online' | 'offline' | 'away';
  isOnline: boolean;
  lastSeen?: string;
  mutualFriends?: number;
}

export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: string;
  type: 'text' | 'image' | 'video' | 'file';
  fileUrl?: string;
  fileName?: string;
  fileSize?: string;
  isMe: boolean;
  unread?: boolean;
}

export interface Conversation {
  id: string;
  name: string;
  type: 'direct' | 'group';
  participants: Friend[];
  lastMessage: Message;
  unreadCount: number;
  avatar?: string;
  isOnline?: boolean;
}

export interface FriendRequest {
  id: string;
  name: string;
  username: string;
  avatar?: string;
  mutualFriends: number;
  requestedAt: string;
}

export interface ConnectionsPageProps {
  currentUser?: any;
  accountPreferences?: any;
  boardsSessions?: any[];
  currentMode?: string;
  onModeChange?: (mode: string) => void;
  onUpdateBoardSession?: (sessionId: string, updates: any) => void;
  onCreateSession?: (sessionData: any) => void;
  onNavigateToBoard?: (boardId: string) => void;
  friendsList?: Friend[];
  initialTab?: TabType;
}

export type TabType = 'friends' | 'messages';