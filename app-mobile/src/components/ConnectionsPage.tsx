import React, { useState, useEffect, useMemo } from 'react';
import { Text, View, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Friend, Conversation, Message } from '../services/connectionsService';
import { ConnectionsService } from '../services/connectionsService';
import CollaborationFriendsTab from './collaboration/CollaborationFriendsTab';
import { useFriends } from '../hooks/useFriends';
import MessagesTab from './connections/MessagesTab';
import FriendSelectionModal from './FriendSelectionModal';
import AddFriendModal from './AddFriendModal';
import FriendRequestsModal from './FriendRequestsModal';
import AddToBoardModal from './AddToBoardModal';
import ReportUserModal from './ReportUserModal';
import { useAuthSimple } from '../hooks/useAuthSimple';

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
  friendsList?: any[];
}

export default function ConnectionsPageRefactored({ 
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
  const { user } = useAuthSimple();
  const [activeTab, setActiveTab] = useState<'friends' | 'messages'>('friends');
  const [showQRCode, setShowQRCode] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  
  // Use useFriends hook for friends data
  const { friends: dbFriends, fetchFriends, friendRequests, loadFriendRequests, removeFriend } = useFriends();
  
  // Real data state
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Transform database friends to match CollaborationFriendsTab interface
  const transformedFriends = useMemo(() => {
    return dbFriends.map(friend => ({
      id: friend.friend_user_id || friend.id,
      name: friend.display_name || `${friend.first_name || ''} ${friend.last_name || ''}`.trim() || friend.username || 'Unknown',
      username: friend.username,
      avatar: friend.avatar_url,
      status: 'offline' as const, // Default to offline, can be enhanced with presence later
      mutualFriends: 0, // Can be calculated later if needed
    }));
  }, [dbFriends]);

  // Fetch conversations and load friend requests
  useEffect(() => {
    const fetchData = async () => {
      if (!user?.id) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Fetch conversations and friend requests in parallel
        const [conversationsData] = await Promise.all([
          ConnectionsService.getConversations(user.id),
        ]);

        setConversations(conversationsData);
        await loadFriendRequests();
        await fetchFriends();
      } catch (err) {
        console.error('Error fetching connections data:', err);
        setError('Failed to load connections data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user?.id, loadFriendRequests, fetchFriends]);

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

  // Use transformed friends from useFriends hook
  const currentFriends = transformedFriends;
  const currentConversations = conversations;
  
  // Get friend requests count
  const friendRequestsCount = friendRequests.filter(req => req.type === 'incoming' && req.status === 'pending').length;

  const handleCopyInvite = () => {
    // In React Native, you would use Clipboard from @react-native-clipboard/clipboard
    // For now, we'll just show the copied state
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
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

    const newMessage = {
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
      const replyMessage = {
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

  const handleSendCollabInvite = (friend: Friend) => {
    onSendCollabInvite?.(friend);
  };

  const handleAddToBoard = (friend: Friend) => {
    setSelectedFriendForBoard(friend);
    setShowAddToBoardModal(true);
  };

  const handleAddToBoardConfirm = (sessionIds: string[], friend: Friend) => {
    onAddToBoard?.(sessionIds, friend);
    setShowAddToBoardModal(false);
    setSelectedFriendForBoard(null);
  };

  const handleShareSavedCard = (friend: Friend) => {
    onShareSavedCard?.(friend);
  };

  const handleRemoveFriend = async (friend: Friend) => {
    try {
      await removeFriend(friend.id);
      await fetchFriends(); // Reload friends after removal
      onRemoveFriend?.(friend);
    } catch (error) {
      console.error('Error removing friend:', error);
    }
  };

  const handleBlockUser = async (friend: Friend) => {
    try {
      // Block user using useFriends hook if available, otherwise use prop handler
      onBlockUser?.(friend);
      await fetchFriends(); // Reload friends after blocking
    } catch (error) {
      console.error('Error blocking user:', error);
    }
  };

  const handleReportUser = (friend: Friend) => {
    // First block the user
    onBlockUser?.(friend, true); // Pass true to suppress notification since we'll show report confirmation
    
    // Then open report modal
    setSelectedUserToReport(friend);
    setShowReportModal(true);
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

  // Loading state
  if (loading) {
    return (
      <View style={styles.fullscreenLoader}>
        <ActivityIndicator size="large" color="#eb7825" />
      </View>
    );
  }

  // Error state
  if (error) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Connections</Text>
        </View>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity 
            style={styles.retryButton}
            onPress={() => {
              setError(null);
              setLoading(true);
              // Retry logic would go here
            }}
          >
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <>
      <View style={styles.container}>
        <View style={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Connections</Text>
            
            {/* Tab Navigation */}
            <View style={styles.tabContainer}>
              <TouchableOpacity
                onPress={() => setActiveTab('friends')}
                style={[
                  styles.tab,
                  activeTab === 'friends' && styles.activeTab
                ]}
              >
                <View style={styles.tabContent}>
                  <Ionicons 
                    name="people" 
                    size={20} 
                    color={activeTab === 'friends' ? '#FFFFFF' : '#6B7280'} 
                  />
                  <Text style={[
                    styles.tabText,
                    activeTab === 'friends' && styles.activeTabText
                  ]}>
                    Friends
                  </Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setActiveTab('messages')}
                style={styles.tab}
              >
                <View style={styles.tabContent}>
                  <Ionicons 
                    name="chatbubble" 
                    size={20} 
                    color="#6B7280" 
                  />
                  <Text style={styles.tabText}>
                    Messages
                  </Text>
                </View>
                {conversations.some(conv => conv.unreadCount > 0) && (
                  <View style={styles.notificationBadge}>
                    <Text style={styles.notificationBadgeText}>
                      {conversations.reduce((sum, conv) => sum + conv.unreadCount, 0)}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* Tab Content */}
          <View style={styles.tabContentContainer}>
            {activeTab === 'friends' ? (
              <CollaborationFriendsTab
                friends={currentFriends}
                onSelectFriend={handleSelectFriend}
                onSendCollabInvite={handleSendCollabInvite}
                onAddToBoard={handleAddToBoard}
                onShareSavedCard={handleShareSavedCard}
                onRemoveFriend={handleRemoveFriend}
                onBlockUser={handleBlockUser}
                onReportUser={handleReportUser}
                onShowAddFriendModal={() => setShowAddFriendModal(true)}
                onShowFriendRequests={() => setShowFriendRequests(true)}
                onShowQRCode={() => setShowQRCode(!showQRCode)}
                onCopyInvite={handleCopyInvite}
                showQRCode={showQRCode}
                inviteCopied={inviteCopied}
                friendRequestsCount={friendRequestsCount}
              />
            ) : (
              <MessagesTab
                conversations={currentConversations}
                onSelectFriend={handleSelectFriend}
                onStartNewConversation={handleStartNewConversation}
                onBackFromMessage={handleBackFromMessage}
                onSendMessage={handleSendMessage}
                activeChat={activeChat}
                showMessageInterface={showMessageInterface}
                conversationsData={conversations}
                accountPreferences={accountPreferences}
                boardsSessions={boardsSessions}
                currentMode={currentMode}
                onModeChange={onModeChange}
                onUpdateBoardSession={onUpdateBoardSession}
                onCreateSession={onCreateSession}
                onNavigateToBoard={onNavigateToBoard}
                availableFriends={currentFriends}
              />
            )}
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
        onClose={() => {
          setShowAddFriendModal(false);
          fetchFriends(); // Reload friends after adding
        }}
      />

      <FriendRequestsModal
        isOpen={showFriendRequests}
        onClose={() => {
          setShowFriendRequests(false);
          fetchFriends(); // Reload friends after accepting/declining
          loadFriendRequests(); // Reload friend requests
        }}
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
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 16,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    borderRadius: 16,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    position: 'relative',
  },
  activeTab: {
    backgroundColor: '#eb7825',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    position: 'relative',
  },
  tabText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#6B7280',
  },
  activeTabText: {
    color: '#FFFFFF',
  },
  notificationBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#EF4444',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  notificationBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  tabContentContainer: {
    flex: 1,
  },
  fullscreenLoader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    color: '#ef4444',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#eb7825',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
  },
});
