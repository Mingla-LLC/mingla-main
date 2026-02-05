export interface Friend {
  id: string;
  name: string;
  username: string;
  avatar?: string;
  status: 'online' | 'offline' | 'away';
  isOnline: boolean;
  lastSeen?: string;
  mutualFriends?: number;
  isMuted?: boolean;
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

export const mockFriends: Friend[] = [
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

export const mockFriendRequests = [
  {
    id: 'req-1',
    name: 'Alex Johnson',
    username: 'alexjohnson',
    avatar: null,
    mutualFriends: 7,
    requestedAt: '2 hours ago'
  },
  {
    id: 'req-2', 
    name: 'Emily Chen',
    username: 'emilychen',
    avatar: null,
    mutualFriends: 3,
    requestedAt: '1 day ago'
  },
  {
    id: 'req-3',
    name: 'Michael Brown',
    username: 'mikebrown', 
    avatar: null,
    mutualFriends: 5,
    requestedAt: '3 days ago'
  }
];

export const createMockConversations = (friends: Friend[]): Conversation[] => {
  if (friends.length === 0) return [];
  
  return [
    {
      id: '1',
      name: friends[0]?.name || 'Arifat Ola-dauda',
      type: 'direct',
      participants: [friends[0]],
      lastMessage: {
        id: '1',
        senderId: '1',
        content: 'Hey! Are you free this weekend for that museum visit?',
        timestamp: '2 min ago',
        type: 'text'
      },
      unreadCount: 2,
      isOnline: friends[0]?.isOnline || true
    },
    {
      id: '2',
      name: 'Weekend Squad',
      type: 'group',
      participants: friends.length >= 4 ? [friends[1], friends[2], friends[3]] : friends.slice(1),
      lastMessage: {
        id: '2',
        senderId: '2',
        content: 'Perfect! Let\'s meet at the coffee shop first',
        timestamp: '15 min ago',
        type: 'text'
      },
      unreadCount: 0
    },
    {
      id: '3',
      name: friends[2]?.name || 'Marcus Chen',
      type: 'direct',
      participants: [friends[2]],
      lastMessage: {
        id: '3',
        senderId: '3',
        content: 'Thanks for the recommendation! 🎨',
        timestamp: '1 hour ago',
        type: 'text'
      },
      unreadCount: 0,
      isOnline: friends[2]?.isOnline || true
    }
  ].filter(conv => conv.participants.every(p => p));
};

export const createMockMessages = (): {[friendId: string]: Message[]} => {
  const now = new Date();
  
  return {
    '1': [
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
        content: 'It was amazing! Went hiking at Blue Ridge Mountains. The views were incredible 🏔️',
        timestamp: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString(),
        type: 'text',
        isMe: true
      },
      {
        id: 'msg-1-3',
        senderId: '1',
        senderName: 'Arifat Ola-dauda',
        content: 'That sounds incredible! I\'ve been wanting to try that trail. Any tips?',
        timestamp: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000 + 45 * 60 * 1000).toISOString(),
        type: 'text',
        isMe: false
      },
      {
        id: 'msg-1-4',
        senderId: 'me',
        senderName: 'Me',
        content: 'Definitely start early! We left at 6 AM and it was perfect. Also bring layers - it gets chilly at the top.',
        timestamp: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
        type: 'text',
        isMe: true
      },
      {
        id: 'msg-1-5',
        senderId: '1',
        senderName: 'Arifat Ola-dauda',
        content: 'Perfect! Want to plan a trip together sometime? I saw on Mingla there\'s this cool art gallery opening downtown too.',
        timestamp: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
        type: 'text',
        isMe: false,
        unread: true
      },
      {
        id: 'msg-1-6',
        senderId: '1',
        senderName: 'Arifat Ola-dauda',
        content: 'Just shared a Mingla card with you! Check it out 🎨',
        timestamp: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
        type: 'text',
        isMe: false,
        unread: true
      }
    ],
    '2': [
      {
        id: 'msg-2-1',
        senderId: '2',
        senderName: 'Sethozia Testing',
        content: 'Jordan! Loved your hiking photos. We should plan something similar soon!',
        timestamp: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        type: 'text',
        isMe: false
      },
      {
        id: 'msg-2-2',
        senderId: 'me',
        senderName: 'Me',
        content: 'Yes! I\'m always down for outdoor adventures. What did you have in mind?',
        timestamp: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000 + 20 * 60 * 1000).toISOString(),
        type: 'text',
        isMe: true
      },
      {
        id: 'msg-2-3',
        senderId: '2',
        senderName: 'Sethozia Testing',
        content: 'There\'s this new rock climbing gym that opened up. Want to check it out this weekend?',
        timestamp: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString(),
        type: 'text',
        isMe: false
      },
      {
        id: 'msg-2-4',
        senderId: 'me',
        senderName: 'Me',
        content: 'That sounds awesome! I\'ve never tried indoor climbing before but I\'m excited to learn.',
        timestamp: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000 + 45 * 60 * 1000).toISOString(),
        type: 'text',
        isMe: true
      },
      {
        id: 'msg-2-5',
        senderId: '2',
        senderName: 'Sethozia Testing',
        content: 'Perfect! I\'ll book us a session for Saturday afternoon. The beginner classes look really good.',
        timestamp: new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString(),
        type: 'text',
        isMe: false,
        unread: true
      }
    ],
    '3': [
      {
        id: 'msg-3-1',
        senderId: '3',
        senderName: 'Marcus Chen',
        content: 'Hey! Just discovered this amazing coffee shop through Mingla. You have to try their lavender latte!',
        timestamp: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        type: 'text',
        isMe: false
      },
      {
        id: 'msg-3-2',
        senderId: 'me',
        senderName: 'Me',
        content: 'Ooh that sounds intriguing! Is it the place on 5th Street?',
        timestamp: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000 + 15 * 60 * 1000).toISOString(),
        type: 'text',
        isMe: true
      },
      {
        id: 'msg-3-3',
        senderId: '3',
        senderName: 'Marcus Chen',
        content: 'Yes exactly! Brew & Bloom. Their pastries are incredible too. Want to meet there tomorrow morning?',
        timestamp: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString(),
        type: 'text',
        isMe: false
      },
      {
        id: 'msg-3-4',
        senderId: 'me',
        senderName: 'Me',
        content: 'Absolutely! How about 9:30 AM? I have a meeting at 11 but that should give us plenty of time.',
        timestamp: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000 + 45 * 60 * 1000).toISOString(),
        type: 'text',
        isMe: true
      },
      {
        id: 'msg-3-5',
        senderId: '3',
        senderName: 'Marcus Chen',
        content: '9:30 is perfect! See you there ☕',
        timestamp: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000 + 50 * 60 * 1000).toISOString(),
        type: 'text',
        isMe: false
      },
      {
        id: 'msg-3-6',
        senderId: '3',
        senderName: 'Marcus Chen',
        content: 'Running about 10 minutes late! Order started without me 😅',
        timestamp: new Date(now.getTime() - 45 * 60 * 1000).toISOString(),
        type: 'text',
        isMe: false,
        unread: true
      }
    ],
    '5': [
      {
        id: 'msg-5-1',
        senderId: '5',
        senderName: 'David Rodriguez',
        content: 'Jordan! I just saw your calendar on Mingla - looks like you\'re planning some amazing adventures!',
        timestamp: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        type: 'text',
        isMe: false
      },
      {
        id: 'msg-5-2',
        senderId: 'me',
        senderName: 'Me',
        content: 'Thanks! I\'ve been trying to be more intentional about planning experiences rather than just staying home.',
        timestamp: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000 + 20 * 60 * 1000).toISOString(),
        type: 'text',
        isMe: true
      },
      {
        id: 'msg-5-3',
        senderId: '5',
        senderName: 'David Rodriguez',
        content: 'That\'s exactly what I need to do too. Mind if I join you for some of those activities? I saw you have a cooking class coming up.',
        timestamp: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000 + 45 * 60 * 1000).toISOString(),
        type: 'text',
        isMe: false
      },
      {
        id: 'msg-5-4',
        senderId: 'me',
        senderName: 'Me',
        content: 'Absolutely! The more the merrier. It\'s a pasta-making class at Nonna\'s Kitchen this Thursday at 7 PM.',
        timestamp: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
        type: 'text',
        isMe: true
      },
      {
        id: 'msg-5-5',
        senderId: '5',
        senderName: 'David Rodriguez',
        content: 'Perfect! I\'ll book a spot. Can\'t wait to learn how to make real pasta from scratch! 🍝',
        timestamp: new Date(now.getTime() - 20 * 60 * 1000).toISOString(),
        type: 'text',
        isMe: false,
        unread: true
      }
    ]
  };
};
