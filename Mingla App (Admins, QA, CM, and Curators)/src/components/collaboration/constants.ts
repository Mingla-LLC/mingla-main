// Collaboration Module Constants

import { Friend, CollaborationInvite, CollaborationSession } from './types';

export const MOCK_FRIENDS: Friend[] = [
  { id: '1', name: 'Sarah Chen', status: 'online' },
  { id: '2', name: 'Marcus Johnson', status: 'online' },
  { id: '3', name: 'Alex Rivera', status: 'offline', lastActive: '2h ago' },
  { id: '4', name: 'Jamie Park', status: 'online' },
  { id: '5', name: 'Taylor Kim', status: 'offline', lastActive: '1d ago' },
  { id: '6', name: 'Jordan Lee', status: 'online' }
];

export const MOCK_SENT_INVITES: CollaborationInvite[] = [
  {
    id: 'sent-1',
    sessionName: 'Weekend Fun Squad',
    fromUser: { id: 'me', name: 'You', status: 'online' },
    toUser: MOCK_FRIENDS[0],
    status: 'pending',
    createdAt: '2h ago',
    expiresAt: '22h'
  },
  {
    id: 'sent-2',
    sessionName: 'Coffee Hunters',
    fromUser: { id: 'me', name: 'You', status: 'online' },
    toUser: MOCK_FRIENDS[2],
    status: 'pending',
    createdAt: '1d ago',
    expiresAt: '12h'
  }
];

export const MOCK_RECEIVED_INVITES: CollaborationInvite[] = [
  {
    id: 'recv-1',
    sessionName: 'Date Night Planning',
    fromUser: MOCK_FRIENDS[1],
    toUser: { id: 'me', name: 'You', status: 'online' },
    status: 'pending',
    createdAt: '30m ago'
  },
  {
    id: 'recv-2',
    sessionName: 'Adventure Squad',
    fromUser: MOCK_FRIENDS[3],
    toUser: { id: 'me', name: 'You', status: 'online' },
    status: 'pending',
    createdAt: '4h ago'
  }
];

export const MOCK_ACTIVE_SESSIONS: CollaborationSession[] = [
  {
    id: 'session-1',
    name: 'Weekend Squad',
    status: 'active',
    participants: [MOCK_FRIENDS[0], MOCK_FRIENDS[1]],
    createdBy: 'me',
    createdAt: '2 days ago',
    lastActivity: '1h ago',
    hasCollabPreferences: true,
    pendingParticipants: 0,
    totalParticipants: 3,
    boardCards: 4
  },
  {
    id: 'session-2',
    name: 'Dinner Club',
    status: 'pending',
    participants: [MOCK_FRIENDS[3]],
    createdBy: 'me',
    createdAt: '1 day ago',
    lastActivity: '5h ago',
    hasCollabPreferences: false,
    pendingParticipants: 1,
    totalParticipants: 2,
    boardCards: 0
  }
];
