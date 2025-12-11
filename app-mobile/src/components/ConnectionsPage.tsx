import React, { useState, useEffect, useMemo, useRef } from 'react';
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
import { messagingService, DirectMessage } from '../services/messagingService';
import { supabase } from '../services/supabase';

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
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const conversationChannelRef = useRef<any>(null);
  
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

        // Fetch conversations using real-time messaging service
        const { conversations: conversationsData, error: convError } = await messagingService.getConversations(user.id);
        
        if (convError) throw new Error(convError);

        // Transform to match Conversation interface
        const transformedConversations: Conversation[] = await Promise.all(
          (conversationsData || []).map(async (conv) => {
            // Get profile information for participants
            const participantIds = conv.participants.map(p => p.user_id);
            const { data: profiles } = await supabase
              .from('profiles')
              .select('id, display_name, username, first_name, last_name, avatar_url')
              .in('id', participantIds);

            // Find the other participant (not the current user)
            const otherParticipant = conv.participants.find(p => p.user_id !== user.id);
            const otherParticipantProfile = profiles?.find(p => p.id === otherParticipant?.user_id);
            
            // Get participant info
            const participantProfiles = conv.participants.map(p => {
              const profile = profiles?.find(prof => prof.id === p.user_id);
              return {
                id: p.user_id,
                name: profile?.display_name || 
                      (profile?.first_name && profile?.last_name ? `${profile.first_name} ${profile.last_name}` : profile?.username) ||
                      'Unknown',
                username: profile?.username || 'unknown',
                avatar: profile?.avatar_url,
                status: 'offline' as const,
                isOnline: false,
              };
            });

            // Get conversation name (other participant's name for direct messages)
            const conversationName = otherParticipantProfile 
              ? (otherParticipantProfile.display_name || 
                 (otherParticipantProfile.first_name && otherParticipantProfile.last_name 
                   ? `${otherParticipantProfile.first_name} ${otherParticipantProfile.last_name}` 
                   : otherParticipantProfile.username) ||
                 'Unknown')
              : 'Unknown';

            // Format timestamp
            const formatTimestamp = (timestamp: string) => {
              if (!timestamp) return '';
              const date = new Date(timestamp);
              const now = new Date();
              const diff = now.getTime() - date.getTime();
              const minutes = Math.floor(diff / 60000);
              const hours = Math.floor(diff / 3600000);
              const days = Math.floor(diff / 86400000);

              if (minutes < 1) return 'Just now';
              if (minutes < 60) return `${minutes}m`;
              if (hours < 24) return `${hours}h`;
              if (days < 7) return `${days}d`;
              return date.toLocaleDateString();
            };

            return {
              id: conv.id,
              name: conversationName,
              type: conv.type,
              participants: participantProfiles,
              avatar: otherParticipantProfile?.avatar_url,
              isOnline: false,
              lastMessage: conv.last_message ? {
                id: conv.last_message.id,
                senderId: conv.last_message.sender_id,
                senderName: conv.last_message.sender_name || 'Unknown',
                content: conv.last_message.content,
                timestamp: formatTimestamp(conv.last_message.created_at),
                type: conv.last_message.message_type,
                fileUrl: conv.last_message.file_url,
                fileName: conv.last_message.file_name,
                fileSize: conv.last_message.file_size?.toString(),
                isMe: conv.last_message.sender_id === user.id,
                unread: !conv.last_message.is_read && conv.last_message.sender_id !== user.id,
              } : {
                id: '',
                senderId: '',
                senderName: '',
                content: '',
                timestamp: '',
                type: 'text',
                isMe: false,
              },
              unreadCount: conv.unread_count || 0,
            };
          })
        );

        setConversations(transformedConversations);
        
        // Pre-load messages for all conversations in the background
        const messagesCacheMap: Record<string, Message[]> = {};
        await Promise.all(
          transformedConversations.map(async (conv) => {
            try {
              const { messages: conversationMessages, error: messagesError } = await messagingService.getMessages(conv.id, user.id);
              
              if (!messagesError && conversationMessages) {
                const transformedMessages: Message[] = conversationMessages.map(msg => ({
                  id: msg.id,
                  senderId: msg.sender_id,
                  senderName: msg.sender_name || 'Unknown',
                  content: msg.content,
                  timestamp: msg.created_at,
                  type: msg.message_type,
                  fileUrl: msg.file_url,
                  fileName: msg.file_name,
                  fileSize: msg.file_size?.toString(),
                  isMe: msg.sender_id === user.id,
                  unread: !msg.is_read && msg.sender_id !== user.id,
                }));
                
                messagesCacheMap[conv.id] = transformedMessages;
              }
            } catch (err) {
              console.error(`Error pre-loading messages for conversation ${conv.id}:`, err);
            }
          })
        );
        
        setMessagesCache(messagesCacheMap);
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
  const [messagesCache, setMessagesCache] = useState<Record<string, Message[]>>({});
  
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

  const handleSelectFriend = async (friend: Friend) => {
    if (!user?.id) return;

    // Show UI immediately - optimistic update
    setActiveChat(friend);
    setShowFriendSelection(false);
    setActiveTab('messages');
    
    // Check if we already have conversation data cached
    const existingConversation = conversations.find(conv => 
      conv.participants?.some(p => p.id === friend.id)
    );
    
    // If we have cached conversation, use its ID immediately
    let conversationId = existingConversation?.id;
    
    if (!conversationId) {
      // Need to create/fetch conversation first
      const { conversation, error: convError } = await messagingService.getOrCreateDirectConversation(user.id, friend.id);
      
      if (convError || !conversation) {
        console.error('Error getting conversation:', convError);
        return;
      }

      conversationId = conversation.id;
    }
    
    setCurrentConversationId(conversationId!);
    
    // Check if we have cached messages for this conversation
    const cachedMessages = conversationId ? messagesCache[conversationId] : null;
    
    if (cachedMessages && cachedMessages.length > 0) {
      // Show all cached messages immediately
      setMessages(cachedMessages);
      // Show UI immediately with cached messages
      setShowMessageInterface(true);
      
      // Refresh messages in background to ensure we have the latest
      (async () => {
        try {
          const { messages: conversationMessages, error: messagesError } = await messagingService.getMessages(conversationId!, user.id);
          
          if (!messagesError && conversationMessages) {
            const transformedMessages: Message[] = conversationMessages.map(msg => ({
              id: msg.id,
              senderId: msg.sender_id,
              senderName: msg.sender_name || 'Unknown',
              content: msg.content,
              timestamp: msg.created_at,
              type: msg.message_type,
              fileUrl: msg.file_url,
              fileName: msg.file_name,
              fileSize: msg.file_size?.toString(),
              isMe: msg.sender_id === user.id,
              unread: !msg.is_read && msg.sender_id !== user.id,
            }));

            setMessages(transformedMessages);
            setMessagesCache(prev => ({
              ...prev,
              [conversationId!]: transformedMessages,
            }));
          }
        } catch (err) {
          console.error('Error refreshing messages:', err);
        }
      })();
    } else {
      // No cached messages - load them synchronously before showing UI
      try {
        const { messages: conversationMessages, error: messagesError } = await messagingService.getMessages(conversationId!, user.id);
        
        if (messagesError) {
          console.error('Error loading messages:', messagesError);
          setMessages([]);
        } else {
          const transformedMessages: Message[] = (conversationMessages || []).map(msg => ({
            id: msg.id,
            senderId: msg.sender_id,
            senderName: msg.sender_name || 'Unknown',
            content: msg.content,
            timestamp: msg.created_at,
            type: msg.message_type,
            fileUrl: msg.file_url,
            fileName: msg.file_name,
            fileSize: msg.file_size?.toString(),
            isMe: msg.sender_id === user.id,
            unread: !msg.is_read && msg.sender_id !== user.id,
          }));

          setMessages(transformedMessages);
          setMessagesCache(prev => ({
            ...prev,
            [conversationId!]: transformedMessages,
          }));
        }
      } catch (err) {
        console.error('Error loading messages:', err);
        setMessages([]);
      }
      
      // Show UI after messages are loaded
      setShowMessageInterface(true);
    }

    // Set up real-time subscription and mark as read in background
    (async () => {
      try {
        // Mark messages as read (non-blocking)
        const currentMessages = messagesCache[conversationId!] || [];
        const unreadMessageIds = currentMessages
          .filter(msg => !msg.isMe && msg.unread)
          .map(msg => msg.id);
        
        if (unreadMessageIds.length > 0) {
          messagingService.markAsRead(unreadMessageIds, user.id).catch(err => 
            console.error('Error marking as read:', err)
          );
        }

        // Subscribe to real-time updates
        if (conversationChannelRef.current) {
          messagingService.unsubscribeFromConversation(conversationId);
        }

        conversationChannelRef.current = messagingService.subscribeToConversation(
          conversationId,
          user.id,
          {
            onMessage: (newMessage: DirectMessage) => {
              const transformedMsg: Message = {
                id: newMessage.id,
                senderId: newMessage.sender_id,
                senderName: newMessage.sender_name || 'Unknown',
                content: newMessage.content,
                timestamp: newMessage.created_at,
                type: newMessage.message_type,
                fileUrl: newMessage.file_url,
                fileName: newMessage.file_name,
                fileSize: newMessage.file_size?.toString(),
                isMe: newMessage.sender_id === user.id,
                unread: !newMessage.is_read && newMessage.sender_id !== user.id,
              };
              // Only add if message doesn't already exist (to avoid duplicates from optimistic updates)
              setMessages(prev => {
                const exists = prev.some(msg => msg.id === transformedMsg.id);
                if (exists) return prev;
                return [...prev, transformedMsg];
              });
              
              // Update cache (avoid duplicates)
              setMessagesCache(prev => {
                const existing = prev[conversationId!] || [];
                const exists = existing.some(msg => msg.id === transformedMsg.id);
                if (exists) return prev;
                return {
                  ...prev,
                  [conversationId!]: [...existing, transformedMsg],
                };
              });

              // Format timestamp helper
              const formatTimestampForConv = (timestamp: string) => {
                if (!timestamp) return '';
                const date = new Date(timestamp);
                const now = new Date();
                const diff = now.getTime() - date.getTime();
                const minutes = Math.floor(diff / 60000);
                const hours = Math.floor(diff / 3600000);
                const days = Math.floor(diff / 86400000);

                if (minutes < 1) return 'Just now';
                if (minutes < 60) return `${minutes}m`;
                if (hours < 24) return `${hours}h`;
                if (days < 7) return `${days}d`;
                return date.toLocaleDateString();
              };
              
              // Update conversation list with new message
              setConversations(prev => prev.map(conv => {
                if (conv.id === conversationId!) {
                  return {
                    ...conv,
                    lastMessage: {
                      id: newMessage.id,
                      senderId: newMessage.sender_id,
                      senderName: newMessage.sender_name || 'Unknown',
                      content: newMessage.content,
                      timestamp: formatTimestampForConv(newMessage.created_at),
                      type: newMessage.message_type,
                      fileUrl: newMessage.file_url,
                      fileName: newMessage.file_name,
                      fileSize: newMessage.file_size?.toString(),
                      isMe: newMessage.sender_id === user.id,
                      unread: !newMessage.is_read && newMessage.sender_id !== user.id,
                    },
                    unreadCount: newMessage.sender_id !== user.id 
                      ? (conv.unreadCount || 0) + 1 
                      : conv.unreadCount,
                  };
                }
                return conv;
              }));
              
              // Mark as read if it's from the current user viewing
              if (newMessage.sender_id !== user.id) {
                messagingService.markAsRead([newMessage.id], user.id).catch(err =>
                  console.error('Error marking new message as read:', err)
                );
              }
            },
          }
        );
      } catch (error) {
        console.error('Error selecting friend:', error);
      }
    })();
  };

  const handleBackFromMessage = () => {
    // Unsubscribe from conversation
    if (currentConversationId && conversationChannelRef.current) {
      messagingService.unsubscribeFromConversation(currentConversationId);
      conversationChannelRef.current = null;
    }
    
    setShowMessageInterface(false);
    setActiveChat(null);
    setCurrentConversationId(null);
    setMessages([]);
  };

  const handleSendMessage = async (content: string, type: 'text' | 'image' | 'video' | 'file', file?: File) => {
    if (!activeChat || !user?.id || !currentConversationId) return;

    // Generate temporary ID for optimistic update
    const tempId = `temp-${Date.now()}-${Math.random()}`;
    const now = new Date().toISOString();

    // Upload file if needed (for now, just send text)
    let fileUrl: string | undefined;
    let fileName: string | undefined;
    let fileSize: number | undefined;

    if (file && type !== 'text') {
      // TODO: Implement file upload to Supabase Storage
      fileName = file.name;
      fileSize = file.size;
    }

    // Create optimistic message
    const optimisticMsg: Message = {
      id: tempId,
      senderId: user.id,
      senderName: 'Me',
      content: content,
      timestamp: now,
      type: type,
      fileUrl: fileUrl,
      fileName: fileName,
      fileSize: fileSize?.toString(),
      isMe: true,
      unread: false,
    };

    // Format timestamp helper
    const formatTimestamp = (timestamp: string) => {
      if (!timestamp) return '';
      const date = new Date(timestamp);
      const now = new Date();
      const diff = now.getTime() - date.getTime();
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);

      if (minutes < 1) return 'Just now';
      if (minutes < 60) return `${minutes}m`;
      if (hours < 24) return `${hours}h`;
      if (days < 7) return `${days}d`;
      return date.toLocaleDateString();
    };

    // Add message optimistically to UI immediately
    setMessages(prev => [...prev, optimisticMsg]);
    
    // Update cache optimistically
    setMessagesCache(prev => {
      const existing = prev[currentConversationId] || [];
      return {
        ...prev,
        [currentConversationId]: [...existing, optimisticMsg],
      };
    });

    // Update conversation list optimistically
    setConversations(prev => prev.map(conv => {
      if (conv.id === currentConversationId) {
        return {
          ...conv,
          lastMessage: {
            id: tempId,
            senderId: user.id,
            senderName: 'Me',
            content: content,
            timestamp: formatTimestamp(now),
            type: type,
            fileUrl: fileUrl,
            fileName: fileName,
            fileSize: fileSize?.toString(),
            isMe: true,
            unread: false,
          },
        };
      }
      return conv;
    }));

    try {
      // Send message via real-time service
      const { message: sentMessage, error: sendError } = await messagingService.sendMessage(
        currentConversationId,
        user.id,
        content,
        type,
        fileUrl,
        fileName,
        fileSize
      );

      if (sendError || !sentMessage) {
        console.error('Error sending message:', sendError);
        
        // Remove optimistic message on error
        setMessages(prev => prev.filter(msg => msg.id !== tempId));
        setMessagesCache(prev => {
          const existing = prev[currentConversationId] || [];
          return {
            ...prev,
            [currentConversationId]: existing.filter(msg => msg.id !== tempId),
          };
        });
        
        // Revert conversation list update on error
        setConversations(prev => prev.map(conv => {
          if (conv.id === currentConversationId) {
            // Restore previous last message or empty
            const cachedMessages = messagesCache[currentConversationId] || [];
            const previousLastMsg = cachedMessages.length > 0 
              ? cachedMessages[cachedMessages.length - 1]
              : null;
            
            return {
              ...conv,
              lastMessage: previousLastMsg ? {
                id: previousLastMsg.id,
                senderId: previousLastMsg.senderId,
                senderName: previousLastMsg.senderName,
                content: previousLastMsg.content,
                timestamp: formatTimestamp(previousLastMsg.timestamp),
                type: previousLastMsg.type,
                fileUrl: previousLastMsg.fileUrl,
                fileName: previousLastMsg.fileName,
                fileSize: previousLastMsg.fileSize,
                isMe: previousLastMsg.isMe,
                unread: false,
              } : conv.lastMessage,
            };
          }
          return conv;
        }));
        return;
      }

      // Replace optimistic message with real message from server
      const realMsg: Message = {
        id: sentMessage.id,
        senderId: sentMessage.sender_id,
        senderName: sentMessage.sender_name || 'Me',
        content: sentMessage.content,
        timestamp: sentMessage.created_at,
        type: sentMessage.message_type,
        fileUrl: sentMessage.file_url,
        fileName: sentMessage.file_name,
        fileSize: sentMessage.file_size?.toString(),
        isMe: true,
        unread: false,
      };

      // Replace temporary message with real one
      setMessages(prev => prev.map(msg => msg.id === tempId ? realMsg : msg));
      
      // Update cache with real message
      setMessagesCache(prev => {
        const existing = prev[currentConversationId] || [];
        return {
          ...prev,
          [currentConversationId]: existing.map(msg => msg.id === tempId ? realMsg : msg),
        };
      });

      // Update conversation list with real message
      setConversations(prev => prev.map(conv => {
        if (conv.id === currentConversationId) {
          return {
            ...conv,
            lastMessage: {
              id: sentMessage.id,
              senderId: sentMessage.sender_id,
              senderName: sentMessage.sender_name || 'Me',
              content: sentMessage.content,
              timestamp: formatTimestamp(sentMessage.created_at),
              type: sentMessage.message_type,
              fileUrl: sentMessage.file_url,
              fileName: sentMessage.file_name,
              fileSize: sentMessage.file_size?.toString(),
              isMe: true,
              unread: false,
            },
          };
        }
        return conv;
      }));
    } catch (error) {
      console.error('Error sending message:', error);
      
      // Remove optimistic message on error
      setMessages(prev => prev.filter(msg => msg.id !== tempId));
      setMessagesCache(prev => {
        const existing = prev[currentConversationId] || [];
        return {
          ...prev,
          [currentConversationId]: existing.filter(msg => msg.id !== tempId),
        };
      });
    }
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
          {/* Header - Only show when not in message interface */}
          {!showMessageInterface && (
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
                  style={[
                    styles.tab,
                    activeTab === 'messages' && styles.activeTab
                  ]}
                >
                  <View style={styles.tabContent}>
                    <Ionicons 
                      name="chatbubble" 
                      size={20} 
                      color={activeTab === 'messages' ? '#FFFFFF' : '#6B7280'} 
                    />
                    <Text style={[
                      styles.tabText,
                      activeTab === 'messages' && styles.activeTabText
                    ]}>
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
          )}

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
                messages={messages}
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
