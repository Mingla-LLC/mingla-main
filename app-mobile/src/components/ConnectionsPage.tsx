import React, { useState } from 'react';
import { Text, View, TouchableOpacity, TextInput, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ImageWithFallback } from './figma/ImageWithFallback';
import FriendSelectionModal from './FriendSelectionModal';
import MessageInterface from './MessageInterface';
import AddFriendModal from './AddFriendModal';
import FriendRequestsModal from './FriendRequestsModal';
import AddToBoardModal from './AddToBoardModal';
import ReportUserModal from './ReportUserModal';

interface Friend {
  id: string;
  name: string;
  username: string;
  avatar?: string;
  status: 'online' | 'offline' | 'away';
  isOnline: boolean;
  lastSeen?: string;
  mutualFriends?: number;
}

interface Message {
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
  unread?: boolean; // For realistic unread indicators
}

interface Conversation {
  id: string;
  name: string;
  type: 'direct' | 'group';
  participants: Friend[];
  lastMessage: Message;
  unreadCount: number;
  avatar?: string;
  isOnline?: boolean;
}

const mockFriends: Friend[] = [
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

const mockFriendRequests = [
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

interface ConnectionsPageProps {
  onSendCollabInvite?: (friend: any) => void;
  onAddToBoard?: (sessionIds: string[], friend: any, suppressNotification?: boolean) => void;
  onShareSavedCard?: (friend: any, suppressNotification?: boolean) => void;
  onRemoveFriend?: (friend: any, suppressNotification?: boolean) => void;
  onBlockUser?: (friend: any, suppressNotification?: boolean) => void;
  onReportUser?: (friend: any, suppressNotification?: boolean) => void;
  accountPreferences?: any;
  boardsSessions?: any[];
  currentMode?: 'solo' | string;
  onModeChange?: (mode: 'solo' | string) => void;
  onUpdateBoardSession?: (updatedBoard: any) => void;
  onCreateSession?: (newSession: any) => void;
  onNavigateToBoard?: (board: any, discussionTab?: string) => void;
  friendsList?: Friend[];
}

export default function ConnectionsPage({ 
  onSendCollabInvite, 
  onAddToBoard, 
  onShareSavedCard,
  onRemoveFriend,
  onBlockUser,
  onReportUser,
  accountPreferences,
  boardsSessions = [],
  currentMode = 'solo',
  onModeChange,
  onUpdateBoardSession,
  onCreateSession,
  onNavigateToBoard,
  friendsList = []
}: ConnectionsPageProps) {
  const [activeTab, setActiveTab] = useState<'friends' | 'messages'>('friends');
  const [searchQuery, setSearchQuery] = useState('');
  const [messageSearchQuery, setMessageSearchQuery] = useState('');
  const [showQRCode, setShowQRCode] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [friendsListExpanded, setFriendsListExpanded] = useState(true);
  
  // Messaging state
  const [showFriendSelection, setShowFriendSelection] = useState(false);
  const [activeChat, setActiveChat] = useState<Friend | null>(null);
  const [showMessageInterface, setShowMessageInterface] = useState(false);
  
  // Add friend modal state
  const [showAddFriendModal, setShowAddFriendModal] = useState(false);
  const [showFriendRequests, setShowFriendRequests] = useState(false);
  const [showAddToBoardModal, setShowAddToBoardModal] = useState(false);
  const [selectedFriendForBoard, setSelectedFriendForBoard] = useState<Friend | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [selectedUserToReport, setSelectedUserToReport] = useState<Friend | null>(null);

  // Use friendsList from props, fallback to mockFriends for backwards compatibility
  const currentFriends = friendsList.length > 0 ? friendsList : mockFriends;

  // Create conversations based on current friends
  const mockConversations: Conversation[] = currentFriends.length > 0 ? [
    {
      id: '1',
      name: currentFriends[0]?.name || 'Arifat Ola-dauda',
      type: 'direct',
      participants: [currentFriends[0]],
      lastMessage: {
        id: '1',
        senderId: '1',
        content: 'Hey! Are you free this weekend for that museum visit?',
        timestamp: '2 min ago',
        type: 'text'
      },
      unreadCount: 2,
      isOnline: currentFriends[0]?.isOnline || true
    },
    {
      id: '2',
      name: 'Weekend Squad',
      type: 'group',
      participants: currentFriends.length >= 4 ? [currentFriends[1], currentFriends[2], currentFriends[3]] : currentFriends.slice(1),
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
      name: currentFriends[2]?.name || 'Marcus Chen',
      type: 'direct',
      participants: [currentFriends[2]],
      lastMessage: {
        id: '3',
        senderId: '3',
        content: 'Thanks for the recommendation! 🎨',
        timestamp: '1 hour ago',
        type: 'text'
      },
      unreadCount: 0,
      isOnline: currentFriends[2]?.isOnline || true
    }
  ].filter(conv => conv.participants.every(p => p)) : [];

  // Friend dropdown menu state
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  
  // Mock conversations with realistic chat history
  const [conversations, setConversations] = useState<{[friendId: string]: Message[]}>(() => {
    const now = new Date();
    
    return {
      '1': [ // Arifat Ola-dauda
        {
          id: 'msg-1-1',
          senderId: '1',
          senderName: 'Arifat Ola-dauda',
          content: 'Hey! How was your weekend?',
          timestamp: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
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
          timestamp: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
          type: 'text',
          isMe: false,
          unread: true
        },
        {
          id: 'msg-1-6',
          senderId: '1',
          senderName: 'Arifat Ola-dauda',
          content: 'Just shared a Mingla card with you! Check it out 🎨',
          timestamp: new Date(now.getTime() - 30 * 60 * 1000).toISOString(), // 30 min ago
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
          content: 'Jordan! Loved your hiking photos. We should plan something similar soon!',
          timestamp: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
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
          timestamp: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString(), // 4 days ago
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
          timestamp: new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString(), // 6 hours ago
          type: 'text',
          isMe: false,
          unread: true
        }
      ],
      '3': [ // Marcus Chen
        {
          id: 'msg-3-1',
          senderId: '3',
          senderName: 'Marcus Chen',
          content: 'Hey! Just discovered this amazing coffee shop through Mingla. You have to try their lavender latte!',
          timestamp: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
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
          timestamp: new Date(now.getTime() - 45 * 60 * 1000).toISOString(), // 45 min ago
          type: 'text',
          isMe: false,
          unread: true
        }
      ],
      '5': [ // David Rodriguez
        {
          id: 'msg-5-1',
          senderId: '5',
          senderName: 'David Rodriguez',
          content: 'Jordan! I just saw your calendar on Mingla - looks like you\'re planning some amazing adventures!',
          timestamp: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
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
          timestamp: new Date(now.getTime() - 20 * 60 * 1000).toISOString(), // 20 min ago
          type: 'text',
          isMe: false,
          unread: true
        }
      ]
    };
  });

  // Filter friends based on search query
  const filteredFriends = currentFriends.filter(friend =>
    friend.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    friend.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Filter conversations based on message search query
  const filteredConversations = mockConversations.filter(conversation => {
    if (!messageSearchQuery.trim()) return true;
    
    const searchTerm = messageSearchQuery.toLowerCase();
    
    // Search by conversation name
    if (conversation.name.toLowerCase().includes(searchTerm)) {
      return true;
    }
    
    // Search by last message content
    if (conversation.lastMessage.content.toLowerCase().includes(searchTerm)) {
      return true;
    }
    
    // Search by participant names (for group chats)
    return conversation.participants.some(participant => 
      participant.name.toLowerCase().includes(searchTerm) ||
      participant.username?.toLowerCase().includes(searchTerm)
    );
  });

  // Show only first 3 friends when collapsed, all when expanded
  const displayedFriends = friendsListExpanded ? filteredFriends : filteredFriends.slice(0, 3);

  const handleCopyInvite = () => {
    navigator.clipboard.writeText('https://mingla.app/invite/user123');
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  };

  const getStatusColor = (status: Friend['status']) => {
    switch (status) {
      case 'online': return 'bg-green-500';
      case 'away': return 'bg-yellow-500';
      case 'offline': return 'bg-gray-400';
    }
  };

  // Messaging handlers
  const handleStartNewConversation = () => {
    setShowFriendSelection(true);
  };

  const handleSelectFriend = (friend: Friend) => {
    setActiveChat(friend);
    setShowFriendSelection(false);
    setShowMessageInterface(true);
    setActiveTab('messages');
    
    // Mark all messages from this friend as read
    setConversations(prev => ({
      ...prev,
      [friend.id]: (prev[friend.id] || []).map(msg => ({
        ...msg,
        unread: msg.isMe ? msg.unread : false // Only mark friend's messages as read
      }))
    }));
  };

  const handleBackFromMessage = () => {
    setShowMessageInterface(false);
    setActiveChat(null);
  };

  const handleSendMessage = (content: string, type: 'text' | 'image' | 'video' | 'file', file?: File) => {
    if (!activeChat) return;

    const newMessage: Message = {
      id: `msg-${Date.now()}`,
      senderId: 'me',
      senderName: 'Me',
      content,
      timestamp: new Date().toISOString(),
      type,
      isMe: true
    };

    // Handle file messages
    if (file && type !== 'text') {
      newMessage.fileName = file.name;
      newMessage.fileSize = formatFileSize(file.size);
      newMessage.fileUrl = URL.createObjectURL(file);
    }

    // Add message to conversation
    setConversations(prev => ({
      ...prev,
      [activeChat.id]: [...(prev[activeChat.id] || []), newMessage]
    }));

    // Simulate friend reply after 2-3 seconds
    setTimeout(() => {
      const replyMessage: Message = {
        id: `msg-${Date.now()}-reply`,
        senderId: activeChat.id,
        senderName: activeChat.name,
        content: getRandomReply(),
        timestamp: new Date().toISOString(),
        type: 'text',
        isMe: false,
        unread: true // New messages from friends should be unread
      };

      setConversations(prev => ({
        ...prev,
        [activeChat.id]: [...(prev[activeChat.id] || []), replyMessage]
      }));
    }, 2000 + Math.random() * 1000);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getRandomReply = () => {
    const replies = [
      "That sounds great! 👍",
      "Thanks for sharing that!",
      "Interesting! Tell me more.",
      "Absolutely! When works for you?",
      "I love that idea!",
      "Can't wait to see it!",
      "Perfect timing!",
      "That's awesome! 😄"
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  };

  // Dropdown menu handlers
  const handleToggleDropdown = (friendId: string) => {
    setOpenDropdownId(openDropdownId === friendId ? null : friendId);
  };

  const handleCloseDropdown = () => {
    setOpenDropdownId(null);
  };

  const handleSendCollabInvite = (friend: Friend) => {
    onSendCollabInvite?.(friend);
    handleCloseDropdown();
  };

  const handleAddToBoard = (friend: Friend) => {
    setSelectedFriendForBoard(friend);
    setShowAddToBoardModal(true);
    handleCloseDropdown();
  };

  const handleAddToBoardConfirm = (sessionIds: string[], friend: Friend) => {
    onAddToBoard?.(sessionIds, friend);
    setShowAddToBoardModal(false);
    setSelectedFriendForBoard(null);
    console.log('Added friend to boards:', friend.name, 'Sessions:', sessionIds);
  };

  const handleShareSavedCard = (friend: Friend) => {
    onShareSavedCard?.(friend);
    handleCloseDropdown();
  };

  const handleRemoveFriend = (friend: Friend) => {
    onRemoveFriend?.(friend);
    handleCloseDropdown();
  };

  const handleBlockUser = (friend: Friend) => {
    onBlockUser?.(friend);
    handleCloseDropdown();
  };

  const handleReportUser = (friend: Friend) => {
    // First block the user
    onBlockUser?.(friend, true); // Pass true to suppress notification since we'll show report confirmation
    
    // Then open report modal
    setSelectedUserToReport(friend);
    setShowReportModal(true);
    handleCloseDropdown();
  };

  const handleReportSubmit = (userId: string, reason: string, details?: string) => {
    // Call the report function with reason and details
    onReportUser?.(selectedUserToReport, true, reason, details); // Pass suppression and additional data
    
    // Close modal and reset state
    setShowReportModal(false);
    setSelectedUserToReport(null);
  };

  const handleReportModalClose = () => {
    setShowReportModal(false);
    setSelectedUserToReport(null);
  };

  // Close dropdown when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (openDropdownId) {
        handleCloseDropdown();
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [openDropdownId]);

  const renderFriendsTab = () => (
    <View style={styles.content}>
      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={20} color="#9ca3af" style={styles.searchIcon} />
        <TextInput
          placeholder='Search friends...'
          value={searchQuery}
          onChangeText={setSearchQuery}
          style={styles.searchInput}
        />
      </View>

      {/* Action Buttons */}
      <View style={styles.actionButtons}>
        <TouchableOpacity 
          onPress={() => setShowAddFriendModal(true)}
          style={styles.actionButton}
          title="Add Friend"
        >
          <View style={styles.actionButtonIcon}>
            <Ionicons name="person-add" size={20} color="#eb7825" />
          </View>
        </TouchableOpacity>

        <TouchableOpacity 
          onPress={() => setShowFriendRequests(true)}
          style={styles.actionButton}
          title="Friend Requests"
        >
          <View style={styles.actionButtonIcon}>
            <Ionicons name="people" size={20} color="#eb7825" />
          </View>
          {mockFriendRequests.length > 0 && (
            <View className="absolute -top-1 -right-1 w-6 h-6 bg-gradient-to-br from-red-500 to-red-600 rounded-full flex items-center justify-center shadow-lg border-2 border-white">
              <Text className="text-xs text-white font-medium">{mockFriendRequests.length}</Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity 
          onPress={() => setShowQRCode(!showQRCode)}
          className={`relative w-14 h-14 border rounded-2xl transition-all duration-300 group overflow-hidden ${
            showQRCode 
              ? 'bg-gradient-to-br from-[#eb7825] to-[#d6691f] border-[#eb7825] shadow-lg shadow-[#eb7825]/20'
              : 'bg-white border-gray-200 hover:border-[#eb7825] hover:shadow-lg hover:shadow-[#eb7825]/20'
          }`}
          title="QR Code"
        >
          {!showQRCode && (
            <View className="absolute inset-0 bg-gradient-to-br from-[#eb7825] to-[#d6691f] opacity-0 group-hover:opacity-100 transition-opacity duration-300"></View>
          )}
          <View className="relative w-full h-full flex items-center justify-center">
            <Ionicons name="qr-code" size={20} color={showQRCode ? 'white' : '#eb7825'} />
          </View>
        </TouchableOpacity>

        <TouchableOpacity 
          onPress={handleCopyInvite}
          className="relative w-14 h-14 bg-white border border-gray-200 rounded-2xl hover:border-[#eb7825] hover:shadow-lg hover:shadow-[#eb7825]/20 transition-all duration-300 group overflow-hidden"
          title={inviteCopied ? 'Copied!' : 'Share Invite'}
        >
          <View className="absolute inset-0 bg-gradient-to-br from-[#eb7825] to-[#d6691f] opacity-0 group-hover:opacity-100 transition-opacity duration-300"></View>
          <View className="relative w-full h-full flex items-center justify-center">
            {inviteCopied ? 
              <Ionicons name="checkmark" size={20} color="white" /> : 
              <Ionicons name="link" size={20} color="white" />
            }
          </View>
        </TouchableOpacity>
      </View>

      {/* QR Code Display */}
      {showQRCode && (
        <View className="bg-white border border-gray-200 rounded-2xl p-6 text-center space-y-4 shadow-lg">
          <View className="w-48 h-48 bg-gray-100 rounded-2xl mx-auto flex items-center justify-center">
            <View className="grid grid-cols-8 gap-1">
              {Array.from({ length: 64 }).map((_, i) => (
                <View
                  key={`qr-dot-${i}`}
                  className={`w-2 h-2 rounded-sm ${
                    Math.random() > 0.5 ? 'bg-gray-900' : 'bg-white'
                  }`}
                />
              ))}
            </View>
          </View>
          <View className="space-y-2">
            <Text className="font-semibold text-gray-900">Scan to Add Me</Text>
            <Text className="text-sm text-gray-600">Have friends scan this code to instantly connect</Text>
          </View>
        </View>
      )}

      {/* Friends List */}
      <View className="space-y-4">
        <View className="flex items-center justify-between">
          <Text className="font-semibold text-gray-900">Friends ({filteredFriends.length})</Text>
          <TouchableOpacity 
            onPress={() => setFriendsListExpanded(!friendsListExpanded)}
            className="text-gray-500 hover:text-gray-700 transition-colors"
          >
            {friendsListExpanded ? <Ionicons name="chevron-up" size={20} color="#6b7280" /> : <Ionicons name="chevron-down" size={20} color="#6b7280" />}
          </TouchableOpacity>
        </View>

        {/* Enhanced online friends showcase */}
        <View className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-100 rounded-2xl p-4">
          <View className="flex items-center gap-3 mb-3">
            <View className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></View>
            <Text className="text-sm font-medium text-green-800">
              {filteredFriends.filter(f => f.isOnline).length} friends online
            </Text>
          </View>
          <View className="flex -space-x-2 overflow-hidden">
            {filteredFriends.filter(f => f.isOnline).slice(0, 5).map((friend, index) => (
              <View key={`online-showcase-${friend.id}-${index}`} className="relative">
                <View className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center text-white font-medium shadow-lg border-2 border-white">
                  {friend.name.split(' ').map(n => n[0]).join('')}
                </View>
                <View className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-white"></View>
              </View>
            ))}
            {filteredFriends.filter(f => f.isOnline).length > 5 && (
              <View className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center shadow-lg border-2 border-white">
                <Text className="text-gray-600 font-semibold text-xs">
                  +{filteredFriends.filter(f => f.isOnline).length - 5}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Friends List */}
        <View className={`space-y-3 transition-all duration-300 ${
          friendsListExpanded 
            ? 'max-h-none opacity-100' 
            : 'max-h-0 opacity-0'
        }`}>
          {displayedFriends.map((friend, index) => (
            <View key={`friends-list-${friend.id}-${index}`} className="bg-white border border-gray-200 rounded-2xl p-4 hover:shadow-md transition-all duration-200">
              <View className="flex items-start gap-4">
                <View className="relative">
                  <View className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center text-white font-medium">
                    {friend.name.split(' ').map(n => n[0]).join('')}
                  </View>
                  <View className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white ${getStatusColor(friend.status)}`}></View>
                </View>
                
                <View className="flex-1 min-w-0">
                  <View className="flex items-start justify-between">
                    <View>
                      <Text className="font-semibold text-gray-900 truncate">{friend.name}</Text>
                      <Text className="text-sm text-gray-500">@{friend.username}</Text>
                      {friend.mutualFriends && (
                        <Text className="text-xs text-gray-400 mt-1">{friend.mutualFriends} mutual friends</Text>
                      )}
                    </View>
                    
                    <View className="flex items-center gap-2">
                      <Text className={`text-xs px-2 py-1 rounded-full ${
                        friend.isOnline 
                          ? 'bg-green-100 text-green-700' 
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {friend.isOnline ? 'Online' : friend.lastSeen || 'Offline'}
                      </Text>
                      
                      {/* Message button */}
                      <TouchableOpacity
                        onPress={() => handleSelectFriend(friend)}
                        className="p-2 bg-[#eb7825] text-white rounded-lg hover:bg-[#d6691f] transition-colors"
                        title="Start conversation"
                      >
                        <Ionicons name="chatbubble" size={16} color="#6b7280" />
                      </TouchableOpacity>
                      
                      {/* Friend dropdown menu */}
                      <View className="relative">
                        <TouchableOpacity
                          onPress={(e) => {
                            e.stopPropagation();
                            handleToggleDropdown(friend.id);
                          }}
                          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                          <Ionicons name="ellipsis-horizontal" size={16} color="#9ca3af" />
                        </TouchableOpacity>
                        
                        {openDropdownId === friend.id && (
                          <View className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                            <View className="py-1">
                              <TouchableOpacity
                                onPress={() => handleSendCollabInvite(friend)}
                                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-3"
                              >
                                <Ionicons name="add" size={16} color="#eb7825" />
                                Send Collaboration Invite
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() => handleAddToBoard(friend)}
                                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-3"
                              >
                                <Ionicons name="people" size={16} color="#2563eb" />
                                Add to Board
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() => handleShareSavedCard(friend)}
                                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-3"
                              >
                                <Ionicons name="bookmark" size={16} color="#9333ea" />
                                Share Saved Card
                              </TouchableOpacity>
                              <View className="border-t border-gray-100 my-1"></View>
                              <TouchableOpacity
                                onPress={() => handleBlockUser(friend)}
                                className="w-full px-4 py-2 text-left text-sm hover:bg-red-50 text-red-600 flex items-center gap-3"
                              >
                                <Ionicons name="shield" size={16} color="#ef4444" />
                                Block User
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() => handleReportUser(friend)}
                                className="w-full px-4 py-2 text-left text-sm hover:bg-red-50 text-red-600 flex items-center gap-3"
                              >
                                <Ionicons name="flag" size={16} color="#ef4444" />
                                Report User
                              </TouchableOpacity>
                            </View>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>
                </View>
              </View>
            </View>
          ))}
          
          {!friendsListExpanded && filteredFriends.length > 3 && (
            <TouchableOpacity
              onPress={() => setFriendsListExpanded(true)}
              className="w-full py-3 text-center text-sm text-gray-500 hover:text-gray-700 border border-dashed border-gray-300 rounded-2xl hover:border-gray-400 transition-colors"
            >
              Show {filteredFriends.length - 3} more friends
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );

  const renderMessagesTab = () => (
    <View className="h-full flex flex-col">
      {showMessageInterface && activeChat ? (
        <MessageInterface
          friend={activeChat}
          messages={conversations[activeChat.id] || []}
          onBack={handleBackFromMessage}
          onSendMessage={handleSendMessage}
          availableFriends={currentFriends}
          accountPreferences={accountPreferences}
          boardsSessions={boardsSessions}
          currentMode={currentMode}
          onModeChange={onModeChange}
          onUpdateBoardSession={onUpdateBoardSession}
          onCreateSession={onCreateSession}
          onNavigateToBoard={onNavigateToBoard}
        />
      ) : (
        <View className="flex-1 space-y-4">
          {/* Header */}
          <View className="space-y-4">
            <Text className="text-xl font-semibold text-gray-900">Messages</Text>
            
            {/* Search Bar */}
            <View className="relative">
              <Ionicons name="search" size={20} color="#9ca3af" style={{ position: 'absolute', left: 16, top: '50%', transform: [{ translateY: -10 }] }} />
              <TextInput
                placeholder="Search conversations..."
                value={messageSearchQuery}
                onChangeText={setMessageSearchQuery}
                style={{
                  width: '100%',
                  paddingLeft: 48,
                  paddingRight: 16,
                  paddingVertical: 12,
                  backgroundColor: '#f9fafb',
                  borderWidth: 1,
                  borderColor: '#e5e7eb',
                  borderRadius: 16,
                  fontSize: 16
                }}
              />
            </View>
            
            {/* Start New Conversation Button */}
            <TouchableOpacity
              onPress={handleStartNewConversation}
              className="w-full p-3 bg-[#eb7825] text-white rounded-lg hover:bg-[#d6691f] transition-colors flex items-center justify-center gap-2"
            >
              <Ionicons name="add" size={20} color="#6b7280" />
              <Text>Start New Conversation</Text>
            </TouchableOpacity>
          </View>

          {/* Conversations List */}
          <View className="space-y-3">
            {filteredConversations.length === 0 && messageSearchQuery.trim() ? (
              <View className="text-center py-8 text-gray-500">
                <Ionicons name="search" size={48} color="#d1d5db" style={{ alignSelf: 'center', marginBottom: 12 }} />
                <Text>No conversations found</Text>
                <Text className="text-sm">Try searching with different keywords</Text>
              </View>
            ) : (
              filteredConversations.map((conversation, index) => (
              <TouchableOpacity
                key={`conversation-${conversation.id}-${index}`}
                onPress={() => {
                  const friend = conversation.participants[0];
                  if (friend) handleSelectFriend(friend);
                }}
                className="w-full p-4 bg-white border border-gray-200 rounded-2xl hover:shadow-md transition-all duration-200 text-left"
              >
                <View className="flex items-start gap-3">
                  <View className="relative">
                    <View className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center text-white font-medium">
                      {conversation.name.split(' ').map(n => n[0]).join('')}
                    </View>
                    {conversation.isOnline && (
                      <View className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-white"></View>
                    )}
                  </View>
                  
                  <View className="flex-1 min-w-0">
                    <View className="flex items-start justify-between">
                      <View>
                        <Text className="font-semibold text-gray-900 truncate">{conversation.name}</Text>
                        <Text className="text-sm text-gray-500 truncate mt-1 max-w-[200px]">{conversation.lastMessage.content.length > 60 ? conversation.lastMessage.content.substring(0, 60) + '...' : conversation.lastMessage.content}</Text>
                      </View>
                      <View className="flex flex-col items-end gap-1">
                        <Text className="text-xs text-gray-400">{conversation.lastMessage.timestamp}</Text>
                        {conversation.unreadCount > 0 && (
                          <View className="w-5 h-5 bg-[#eb7825] rounded-full flex items-center justify-center">
                            <Text className="text-xs text-white font-medium">{conversation.unreadCount}</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>
                </View>
              </TouchableOpacity>
              ))
            )}
          </View>
        </View>
      )}
    </View>
  );

  return (
    <>
      <View className="h-full bg-gray-50 overflow-hidden">
        <View className="h-full flex flex-col px-4 pt-4">
          {/* Header */}
          <View className="mb-6">
            <Text className="text-2xl font-bold text-gray-900 mb-4">Connections</Text>
            
            {/* Tab Navigation */}
            <View className="flex bg-gray-100 rounded-2xl p-1">
              <TouchableOpacity
                onPress={() => setActiveTab('friends')}
                className={`flex-1 py-3 px-4 rounded-xl font-medium transition-all duration-200 ${
                  activeTab === 'friends'
                    ? 'bg-white text-[#eb7825] shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <View className="flex items-center justify-center gap-2">
                  <Ionicons name="people" size={20} color="#6b7280" />
                  Friends
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setActiveTab('messages')}
                className={`flex-1 py-3 px-4 rounded-xl font-medium transition-all duration-200 ${
                  activeTab === 'messages'
                    ? 'bg-white text-[#eb7825] shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <View className="flex items-center justify-center gap-2">
                  <Ionicons name="chatbubble" size={20} color="#6b7280" />
                  Messages
                </View>
              </TouchableOpacity>
            </View>
          </View>

          {/* Tab Content */}
          <View className="flex-1 overflow-y-auto">
            {activeTab === 'friends' ? renderFriendsTab() : renderMessagesTab()}
          </View>
        </View>
      </View>

      {/* Modals */}
      <FriendSelectionModal
        isOpen={showFriendSelection}
        onClose={() => setShowFriendSelection(false)}
        onSelectFriend={handleSelectFriend}
        friends={currentFriends}
      />

      <AddFriendModal
        isOpen={showAddFriendModal}
        onClose={() => setShowAddFriendModal(false)}
      />

      <FriendRequestsModal
        isOpen={showFriendRequests}
        onClose={() => setShowFriendRequests(false)}
        requests={mockFriendRequests}
      />

      <AddToBoardModal
        isOpen={showAddToBoardModal}
        onClose={() => {
          setShowAddToBoardModal(false);
          setSelectedFriendForBoard(null);
        }}
        friend={selectedFriendForBoard}
        boardsSessions={boardsSessions}
        onConfirm={handleAddToBoardConfirm}
      />

      <ReportUserModal
        isOpen={showReportModal}
        onClose={handleReportModalClose}
        user={selectedUserToReport ? {
          id: selectedUserToReport.id,
          name: selectedUserToReport.name,
          username: selectedUserToReport.username
        } : { id: '', name: '', username: '' }}
        onReport={handleReportSubmit}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  content: {
    padding: 16,
    gap: 24,
  },
  searchContainer: {
    position: 'relative',
  },
  searchInput: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111827',
  },
  searchIcon: {
    position: 'absolute',
    left: 16,
    top: '50%',
    transform: [{ translateY: -10 }],
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
    marginTop: 16,
  },
  actionButton: {
    width: 56,
    height: 56,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonActive: {
    borderColor: '#eb7825',
    shadowColor: '#eb7825',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  actionButtonIcon: {
    color: '#eb7825',
  },
  actionButtonIconActive: {
    color: 'white',
  },
  section: {
    backgroundColor: 'white',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 20,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 16,
  },
  friendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  friendAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 12,
  },
  friendInfo: {
    flex: 1,
  },
  friendName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#111827',
  },
  friendStatus: {
    fontSize: 14,
    color: '#6b7280',
  },
  friendActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionIcon: {
    padding: 8,
    borderRadius: 6,
  },
  dropdown: {
    position: 'absolute',
    right: 0,
    top: '100%',
    marginTop: 4,
    width: 192,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    zIndex: 50,
  },
  dropdownItem: {
    width: '100%',
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dropdownItemText: {
    fontSize: 14,
    color: '#111827',
  },
  dropdownItemTextDanger: {
    color: '#ef4444',
  },
  divider: {
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    marginVertical: 4,
  },
});