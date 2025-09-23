import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFriends, Friend, FriendRequest } from '../hooks/useFriends';
import { useMessages, Conversation, Message } from '../hooks/useMessages';
import { useAppStore } from '../store/appStore';
import { useFocusEffect } from '@react-navigation/native';

export default function ConnectionsScreen() {
  const [activeTab, setActiveTab] = useState<'friends' | 'messages'>('friends');
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);

  const { user } = useAppStore();
  
  const {
    friends,
    friendRequests,
    loading: friendsLoading,
    fetchFriends,
    loadFriendRequests,
    addFriend,
    acceptFriendRequest,
    declineFriendRequest,
    removeFriend,
  } = useFriends();

  const {
    conversations,
    currentConversation,
    loading: messagesLoading,
    fetchMessages,
    sendMessage,
    setCurrentConversation,
  } = useMessages();

  // Load data when screen is focused
  useFocusEffect(
    useCallback(() => {
      if (user?.id) {
        fetchFriends();
        loadFriendRequests();
        fetchMessages();
      }
    }, [user?.id, fetchFriends, loadFriendRequests, fetchMessages])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        fetchFriends(),
        loadFriendRequests(),
        fetchMessages(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const handleSendFriendRequest = async (friendId: string) => {
    try {
      await addFriend(friendId);
      Alert.alert('Success', 'Friend request sent!');
    } catch (error) {
      Alert.alert('Error', 'Failed to send friend request');
    }
  };

  const handleAcceptFriendRequest = async (requestId: string) => {
    try {
      await acceptFriendRequest(requestId);
      Alert.alert('Success', 'Friend request accepted!');
    } catch (error) {
      Alert.alert('Error', 'Failed to accept friend request');
    }
  };

  const handleDeclineFriendRequest = async (requestId: string) => {
    try {
      await declineFriendRequest(requestId);
      Alert.alert('Success', 'Friend request declined');
    } catch (error) {
      Alert.alert('Error', 'Failed to decline friend request');
    }
  };

  const handleRemoveFriend = async (friendId: string) => {
    Alert.alert(
      'Remove Friend',
      'Are you sure you want to remove this friend?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeFriend(friendId);
              Alert.alert('Success', 'Friend removed');
            } catch (error) {
              Alert.alert('Error', 'Failed to remove friend');
            }
          },
        },
      ]
    );
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedConversation) return;

    setSending(true);
    try {
      await sendMessage(selectedConversation.id, newMessage.trim(), 'text');
      setNewMessage('');
    } catch (error) {
      Alert.alert('Error', 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

    if (diffInHours < 1) {
      return 'Just now';
    } else if (diffInHours < 24) {
      return `${Math.floor(diffInHours)}h ago`;
    } else {
      return `${Math.floor(diffInHours / 24)}d ago`;
    }
  };

  const getDisplayName = (friend: Friend) => {
    if (friend.first_name && friend.last_name) {
      return `${friend.first_name} ${friend.last_name}`;
    }
    return friend.display_name || friend.username;
  };

  const getConversationName = (conversation: Conversation) => {
    const otherParticipant = conversation.participants.find(p => p.id !== user?.id);
    if (otherParticipant) {
      if (otherParticipant.first_name && otherParticipant.last_name) {
        return `${otherParticipant.first_name} ${otherParticipant.last_name}`;
      }
      return otherParticipant.display_name || otherParticipant.username;
    }
    return 'Unknown';
  };

  const filteredFriends = friends.filter(friend =>
    getDisplayName(friend).toLowerCase().includes(searchQuery.toLowerCase()) ||
    friend.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredConversations = conversations.filter(conversation =>
    getConversationName(conversation).toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredFriendRequests = friendRequests.filter(request =>
    request.sender.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (request.sender.first_name && request.sender.last_name &&
      `${request.sender.first_name} ${request.sender.last_name}`.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  if (selectedConversation) {
    return (
      <SafeAreaView style={styles.container}>
        {/* Chat Header */}
        <View style={styles.chatHeader}>
          <TouchableOpacity
            onPress={() => setSelectedConversation(null)}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <View style={styles.chatHeaderInfo}>
            <Text style={styles.chatHeaderName}>
              {getConversationName(selectedConversation)}
            </Text>
            <Text style={styles.chatHeaderStatus}>Online</Text>
          </View>
        </View>

        {/* Messages */}
        <ScrollView style={styles.messagesContainer}>
          {selectedConversation.messages.map((message) => (
            <View
              key={message.id}
              style={[
                styles.messageBubble,
                message.sender_id === user?.id ? styles.myMessage : styles.theirMessage,
              ]}
            >
              <Text style={[
                styles.messageText,
                message.sender_id === user?.id ? styles.myMessageText : styles.theirMessageText,
              ]}>
                {message.content}
              </Text>
              <Text style={styles.messageTime}>
                {formatTime(message.created_at)}
              </Text>
            </View>
          ))}
        </ScrollView>

        {/* Message Input */}
        <View style={styles.messageInputContainer}>
          <TextInput
            style={styles.messageInput}
            placeholder="Type a message..."
            value={newMessage}
            onChangeText={setNewMessage}
            multiline
          />
          <TouchableOpacity
            onPress={handleSendMessage}
            disabled={!newMessage.trim() || sending}
            style={[styles.sendButton, (!newMessage.trim() || sending) && styles.sendButtonDisabled]}
          >
            <Ionicons name="send" size={20} color="white" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Connections</Text>
        <Text style={styles.subtitle}>Manage your friends and messages</Text>
      </View>

      {/* Tab Selector */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'friends' && styles.activeTab]}
          onPress={() => setActiveTab('friends')}
        >
          <Text style={[styles.tabText, activeTab === 'friends' && styles.activeTabText]}>
            Friends
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'messages' && styles.activeTab]}
          onPress={() => setActiveTab('messages')}
        >
          <Text style={[styles.tabText, activeTab === 'messages' && styles.activeTabText]}>
            Messages
          </Text>
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color="#999" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder={`Search ${activeTab}...`}
            placeholderTextColor="#999"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
      </View>

      {/* Content */}
      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        {activeTab === 'friends' ? (
          <>
            {/* Friend Requests */}
            {filteredFriendRequests.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Friend Requests</Text>
                {filteredFriendRequests.map((request) => (
                  <View key={request.id} style={styles.friendRequestCard}>
                    <View style={styles.friendRequestInfo}>
                      {request.sender.avatar_url ? (
                        <Image
                          source={{ uri: request.sender.avatar_url }}
                          style={styles.avatar}
                        />
                      ) : (
                        <View style={styles.avatarFallback}>
                          <Text style={styles.avatarFallbackText}>
                            {request.sender.first_name && request.sender.last_name
                              ? `${request.sender.first_name[0]}${request.sender.last_name[0]}`.toUpperCase()
                              : request.sender.username[0].toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <View style={styles.friendRequestDetails}>
                        <Text style={styles.friendRequestName}>
                          {request.sender.first_name && request.sender.last_name
                            ? `${request.sender.first_name} ${request.sender.last_name}`
                            : request.sender.display_name || request.sender.username}
                        </Text>
                        <Text style={styles.friendRequestUsername}>
                          @{request.sender.username}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.friendRequestActions}>
                      <TouchableOpacity
                        style={styles.acceptButton}
                        onPress={() => handleAcceptFriendRequest(request.id)}
                      >
                        <Ionicons name="checkmark" size={16} color="white" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.declineButton}
                        onPress={() => handleDeclineFriendRequest(request.id)}
                      >
                        <Ionicons name="close" size={16} color="white" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Friends List */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Friends</Text>
              {filteredFriends.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="people-outline" size={48} color="#ccc" />
                  <Text style={styles.emptyStateText}>
                    {searchQuery ? 'No friends found' : 'No friends yet'}
                  </Text>
                  <Text style={styles.emptyStateSubtext}>
                    {searchQuery ? 'Try a different search term' : 'Add friends to start connecting'}
                  </Text>
                </View>
              ) : (
                filteredFriends.map((friend) => (
                  <View key={friend.id} style={styles.friendCard}>
                    <View style={styles.friendInfo}>
                      {friend.avatar_url ? (
                        <Image
                          source={{ uri: friend.avatar_url }}
                          style={styles.avatar}
                        />
                      ) : (
                        <View style={styles.avatarFallback}>
                          <Text style={styles.avatarFallbackText}>
                            {friend.first_name && friend.last_name
                              ? `${friend.first_name[0]}${friend.last_name[0]}`.toUpperCase()
                              : friend.username[0].toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <View style={styles.friendDetails}>
                        <Text style={styles.friendName}>{getDisplayName(friend)}</Text>
                        <Text style={styles.friendUsername}>@{friend.username}</Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      style={styles.messageButton}
                      onPress={() => {
                        // Find or create conversation with this friend
                        const conversation = conversations.find(conv =>
                          conv.participants.some(p => p.id === friend.friend_user_id)
                        );
                        if (conversation) {
                          setSelectedConversation(conversation);
                        } else {
                          Alert.alert('Info', 'Start a conversation from the Messages tab');
                        }
                      }}
                    >
                      <Ionicons name="chatbubble-outline" size={20} color="#007AFF" />
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </View>
          </>
        ) : (
          /* Messages Tab */
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Messages</Text>
            {filteredConversations.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="chatbubbles-outline" size={48} color="#ccc" />
                <Text style={styles.emptyStateText}>
                  {searchQuery ? 'No conversations found' : 'No messages yet'}
                </Text>
                <Text style={styles.emptyStateSubtext}>
                  {searchQuery ? 'Try a different search term' : 'Start a conversation with a friend'}
                </Text>
              </View>
            ) : (
              filteredConversations.map((conversation) => (
                <TouchableOpacity
                  key={conversation.id}
                  style={styles.conversationCard}
                  onPress={() => setSelectedConversation(conversation)}
                >
                  <View style={styles.conversationInfo}>
                    {conversation.participants.find(p => p.id !== user?.id)?.avatar_url ? (
                      <Image
                        source={{ uri: conversation.participants.find(p => p.id !== user?.id)?.avatar_url }}
                        style={styles.avatar}
                      />
                    ) : (
                      <View style={styles.avatarFallback}>
                        <Text style={styles.avatarFallbackText}>
                          {(() => {
                            const otherParticipant = conversation.participants.find(p => p.id !== user?.id);
                            if (otherParticipant?.first_name && otherParticipant?.last_name) {
                              return `${otherParticipant.first_name[0]}${otherParticipant.last_name[0]}`.toUpperCase();
                            }
                            return otherParticipant?.username?.[0].toUpperCase() || 'U';
                          })()}
                        </Text>
                      </View>
                    )}
                    <View style={styles.conversationDetails}>
                      <Text style={styles.conversationName}>
                        {getConversationName(conversation)}
                      </Text>
                      <Text style={styles.conversationLastMessage} numberOfLines={1}>
                        {conversation.last_message?.content || 'No messages yet'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.conversationMeta}>
                    <Text style={styles.conversationTime}>
                      {conversation.last_message ? formatTime(conversation.last_message.created_at) : ''}
                    </Text>
                    {conversation.unread_count > 0 && (
                      <View style={styles.unreadBadge}>
                        <Text style={styles.unreadCount}>
                          {conversation.unread_count > 9 ? '9+' : conversation.unread_count}
                        </Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: 24,
    marginBottom: 16,
    backgroundColor: '#e9ecef',
    borderRadius: 8,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
    alignItems: 'center',
  },
  activeTab: {
    backgroundColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#666',
  },
  activeTabText: {
    color: '#1a1a1a',
    fontWeight: '600',
  },
  searchContainer: {
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#1a1a1a',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 16,
  },
  friendRequestCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  friendRequestInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  friendRequestDetails: {
    marginLeft: 12,
    flex: 1,
  },
  friendRequestName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  friendRequestUsername: {
    fontSize: 14,
    color: '#666',
  },
  friendRequestActions: {
    flexDirection: 'row',
    gap: 8,
  },
  acceptButton: {
    backgroundColor: '#28a745',
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  declineButton: {
    backgroundColor: '#dc3545',
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  friendCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  friendInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  friendDetails: {
    marginLeft: 12,
    flex: 1,
  },
  friendName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  friendUsername: {
    fontSize: 14,
    color: '#666',
  },
  messageButton: {
    padding: 8,
  },
  conversationCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  conversationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  conversationDetails: {
    marginLeft: 12,
    flex: 1,
  },
  conversationName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  conversationLastMessage: {
    fontSize: 14,
    color: '#666',
  },
  conversationMeta: {
    alignItems: 'flex-end',
  },
  conversationTime: {
    fontSize: 12,
    color: '#999',
    marginBottom: 4,
  },
  unreadBadge: {
    backgroundColor: '#007AFF',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  unreadCount: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  avatarFallback: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FF6B35',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarFallbackText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
  // Chat styles
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
  },
  backButton: {
    marginRight: 12,
  },
  chatHeaderInfo: {
    flex: 1,
  },
  chatHeaderName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  chatHeaderStatus: {
    fontSize: 14,
    color: '#28a745',
  },
  messagesContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  messageBubble: {
    maxWidth: '80%',
    marginVertical: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
  },
  myMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#007AFF',
  },
  theirMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#e9ecef',
  },
  messageText: {
    fontSize: 16,
    marginBottom: 4,
  },
  myMessageText: {
    color: 'white',
  },
  theirMessageText: {
    color: '#1a1a1a',
  },
  messageTime: {
    fontSize: 12,
    opacity: 0.7,
  },
  messageInputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'white',
    borderTopWidth: 1,
    borderTopColor: '#e9ecef',
  },
  messageInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e9ecef',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginRight: 12,
    maxHeight: 100,
    fontSize: 16,
  },
  sendButton: {
    backgroundColor: '#007AFF',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#ccc',
  },
});