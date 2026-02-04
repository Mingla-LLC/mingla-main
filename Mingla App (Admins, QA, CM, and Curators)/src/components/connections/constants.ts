// Connections Page Constants & Mock Data

import { Friend, FriendRequest, Message } from './types';

export const MOCK_FRIENDS: Friend[] = [
  {
    id: '1',
    name: 'Arifat Ola-dauda',
    username: 'Ari99',
    status: 'online',
    isOnline: true,
    mutualFriends: 12
  },
  {
    id: '2',
    name: 'Sethozia Testing',
    username: 'Sethozia',
    status: 'away',
    isOnline: false,
    lastSeen: '2 hours ago',
    mutualFriends: 8
  },
  {
    id: '3',
    name: 'Marcus Chen',
    username: 'MarcusC',
    status: 'online',
    isOnline: true,
    mutualFriends: 15
  },
  {
    id: '4',
    name: 'Sarah Williams',
    username: 'SarahW',
    status: 'offline',
    isOnline: false,
    lastSeen: '1 day ago',
    mutualFriends: 6
  },
  {
    id: '5',
    name: 'David Rodriguez',
    username: 'DavidR',
    status: 'online',
    isOnline: true,
    mutualFriends: 9
  }
];

export const MOCK_FRIEND_REQUESTS: FriendRequest[] = [
  {
    id: 'req-1',
    name: 'Alex Johnson',
    username: 'AlexJ',
    mutualFriends: 5,
    requestedAt: '2 days ago'
  },
  {
    id: 'req-2',
    name: 'Emily Davis',
    username: 'EmilyD',
    mutualFriends: 3,
    requestedAt: '1 week ago'
  },
  {
    id: 'req-3',
    name: 'James Wilson',
    username: 'JamesW',
    mutualFriends: 7,
    requestedAt: '3 days ago'
  }
];

// Random reply messages for simulating responses
export const AUTO_REPLY_MESSAGES = [
  "That sounds great! 👍",
  "Thanks for sharing that!",
  "Interesting! Tell me more.",
  "Absolutely! When works for you?",
  "I love that idea!",
  "Can't wait to see it!",
  "Perfect timing!",
  "That's awesome! 😄"
];

// Generate initial conversation history
export function generateInitialConversations(): { [friendId: string]: Message[] } {
  const now = new Date();
  
  return {
    '1': [ // Arifat Ola-dauda
      {
        id: 'msg-1-1',
        senderId: '1',
        senderName: 'Arifat Ola-dauda',
        content: 'Hey! How was your weekend?',
        timestamp: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        type: 'text',
        isMe: false
      },
      {
        id: 'msg-1-2',
        senderId: 'me',
        senderName: 'Me',
        content: 'It was great! Went to that new art gallery downtown.',
        timestamp: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000 + 15 * 60 * 1000).toISOString(),
        type: 'text',
        isMe: true
      },
      {
        id: 'msg-1-3',
        senderId: '1',
        senderName: 'Arifat Ola-dauda',
        content: 'Hey! Are you free this weekend for that museum visit?',
        timestamp: new Date(now.getTime() - 2 * 60 * 1000).toISOString(),
        type: 'text',
        isMe: false,
        unread: true
      }
    ],
    '2': [ // Sethozia Testing
      {
        id: 'msg-2-1',
        senderId: '2',
        senderName: 'Sethozia Testing',
        content: 'Want to grab coffee this week?',
        timestamp: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        type: 'text',
        isMe: false
      },
      {
        id: 'msg-2-2',
        senderId: 'me',
        senderName: 'Me',
        content: 'Sure! How about Wednesday afternoon?',
        timestamp: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString(),
        type: 'text',
        isMe: true
      },
      {
        id: 'msg-2-3',
        senderId: '2',
        senderName: 'Sethozia Testing',
        content: 'Perfect! Let\'s meet at the coffee shop first',
        timestamp: new Date(now.getTime() - 15 * 60 * 1000).toISOString(),
        type: 'text',
        isMe: false,
        unread: true
      }
    ],
    '3': [ // Marcus Chen
      {
        id: 'msg-3-1',
        senderId: 'me',
        senderName: 'Me',
        content: 'Check out this cool exhibition!',
        timestamp: new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString(),
        type: 'text',
        isMe: true
      },
      {
        id: 'msg-3-2',
        senderId: '3',
        senderName: 'Marcus Chen',
        content: 'Thanks for the recommendation! 🎨',
        timestamp: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
        type: 'text',
        isMe: false
      }
    ]
  };
}
