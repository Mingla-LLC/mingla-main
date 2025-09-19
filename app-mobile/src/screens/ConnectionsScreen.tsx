import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAppStore } from '../store/appStore';
import { useFriends } from '../hooks/useFriends';
import { useMessages, Conversation } from '../hooks/useMessages';

export default function ConnectionsScreen() {
  const [activeTab, setActiveTab] = useState<'friends' | 'inbox'>('friends');
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredConversations, setFilteredConversations] = useState<Conversation[]>([]);
  
  const { user } = useAppStore();
  const { friends, loading: friendsLoading, fetchFriends, addFriend, removeFriend } = useFriends();
  const { conversations, loading: messagesLoading, fetchMessages, sendMessage } = useMessages();

  // Demo conversations data - memoized to prevent infinite re-renders
  const demoConversations: Conversation[] = useMemo(() => [
    {
      id: '1',
      created_by: 'user1',
      created_at: new Date().toISOString(),
      participants: [
        {
          id: 'user1',
          username: 'sarah_j',
          display_name: 'Sarah Johnson',
          first_name: 'Sarah',
          last_name: 'Johnson',
          avatar_url: undefined,
          is_online: true,
        },
        {
          id: user?.id || 'current_user',
          username: user?.username || 'you',
          display_name: user?.display_name || 'You',
          first_name: user?.first_name,
          last_name: user?.last_name,
          avatar_url: user?.avatar_url,
          is_online: true,
        },
      ],
      last_message: {
        id: 'msg1',
        conversation_id: '1',
        sender_id: 'user1',
        content: 'Hey! Are you still up for the hiking trip this weekend?',
        message_type: 'text',
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
        sender_name: 'Sarah Johnson',
        is_read: false,
      },
      unread_count: 1,
      messages: [],
    },
    {
      id: '2',
      created_by: 'user2',
      created_at: new Date().toISOString(),
      participants: [
        {
          id: 'user2',
          username: 'mike_c',
          display_name: 'Mike Chen',
          first_name: 'Mike',
          last_name: 'Chen',
          avatar_url: undefined,
          is_online: false,
        },
        {
          id: user?.id || 'current_user',
          username: user?.username || 'you',
          display_name: user?.display_name || 'You',
          first_name: user?.first_name,
          last_name: user?.last_name,
          avatar_url: user?.avatar_url,
          is_online: true,
        },
      ],
      last_message: {
        id: 'msg2',
        conversation_id: '2',
        sender_id: user?.id || 'current_user',
        content: 'Thanks for the restaurant recommendation! It was amazing.',
        message_type: 'text',
        created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
        sender_name: user?.display_name || 'You',
        is_read: true,
      },
      unread_count: 0,
      messages: [],
    },
    {
      id: '3',
      created_by: 'user3',
      created_at: new Date().toISOString(),
      participants: [
        {
          id: 'user3',
          username: 'emma_w',
          display_name: 'Emma Wilson',
          first_name: 'Emma',
          last_name: 'Wilson',
          avatar_url: undefined,
          is_online: true,
        },
        {
          id: user?.id || 'current_user',
          username: user?.username || 'you',
          display_name: user?.display_name || 'You',
          first_name: user?.first_name,
          last_name: user?.last_name,
          avatar_url: user?.avatar_url,
          is_online: true,
        },
      ],
      last_message: {
        id: 'msg3',
        conversation_id: '3',
        sender_id: 'user3',
        content: 'The concert was incredible! Thanks for inviting me.',
        message_type: 'text',
        created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
        sender_name: 'Emma Wilson',
        is_read: true,
      },
      unread_count: 0,
      messages: [],
    },
  ], [user?.id, user?.username, user?.display_name, user?.first_name, user?.last_name, user?.avatar_url]);

  const loadData = useCallback(async () => {
    try {
      await Promise.all([
        fetchFriends(),
        fetchMessages(),
      ]);
    } catch (error) {
      console.error('Error loading connections data:', error);
    }
  }, [fetchFriends, fetchMessages]);

  // Filter conversations based on search query
  useEffect(() => {
    const conversationsToFilter = conversations.length > 0 ? conversations : demoConversations;
    
    if (searchQuery.trim() === '') {
      setFilteredConversations(conversationsToFilter);
    } else {
      const filtered = conversationsToFilter.filter(conv => {
        const participantNames = conv.participants
          .filter(p => p.id !== user?.id)
          .map(p => p.display_name || p.username || '')
          .join(' ')
          .toLowerCase();
        
        const lastMessageContent = conv.last_message?.content?.toLowerCase() || '';
        
        return participantNames.includes(searchQuery.toLowerCase()) ||
               lastMessageContent.includes(searchQuery.toLowerCase());
      });
      setFilteredConversations(filtered);
    }
  }, [searchQuery, conversations, demoConversations, user?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleAddFriend = async (friendId: string) => {
    try {
      await addFriend(friendId);
      Alert.alert('Success', 'Friend request sent!');
    } catch (error) {
      Alert.alert('Error', 'Failed to send friend request');
    }
  };

  const handleRemoveFriend = async (friendId: string) => {
    try {
      await removeFriend(friendId);
      Alert.alert('Success', 'Friend removed');
    } catch (error) {
      Alert.alert('Error', 'Failed to remove friend');
    }
  };

  const renderFriendsTab = () => (
    <View style={styles.tabContent}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Friends</Text>
        {friendsLoading ? (
          <View style={styles.loadingState}>
            <Text style={styles.loadingText}>Loading friends...</Text>
          </View>
        ) : friends.length > 0 ? (
          friends.map((friend) => (
            <View key={friend.id} style={styles.friendCard}>
              <View style={styles.friendInfo}>
                <View style={styles.friendAvatar}>
                  <Text style={styles.friendAvatarText}>
                    {friend.display_name?.charAt(0) || friend.username?.charAt(0) || '?'}
                  </Text>
                </View>
                <View style={styles.friendDetails}>
                  <Text style={styles.friendName}>
                    {friend.display_name || friend.username || 'Unknown User'}
                  </Text>
                  <Text style={styles.friendStatus}>
                    {friend.status || 'Active'}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.removeButton}
                onPress={() => handleRemoveFriend(friend.id)}
              >
                <Ionicons name="close" size={20} color="#FF3B30" />
              </TouchableOpacity>
            </View>
          ))
        ) : (
          <View style={styles.emptyState}>
            <Ionicons name="people-outline" size={48} color="#ccc" />
            <Text style={styles.emptyStateTitle}>No friends yet</Text>
            <Text style={styles.emptyStateText}>
              Add friends to start collaborating on experiences
            </Text>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Add Friends</Text>
        <TouchableOpacity style={styles.addFriendCard}>
          <Ionicons name="person-add" size={24} color="#007AFF" />
          <Text style={styles.addFriendText}>Search for friends</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

    if (diffInHours < 1) {
      return 'Just now';
    } else if (diffInHours < 24) {
      return `${Math.floor(diffInHours)}h ago`;
    } else if (diffInHours < 168) { // 7 days
      return `${Math.floor(diffInHours / 24)}d ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  const renderInboxTab = () => (
    <View style={styles.tabContent}>
      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color="#999" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search conversations..."
            placeholderTextColor="#999"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
      </View>

      {/* Messages Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Messages</Text>
        {messagesLoading ? (
          <View style={styles.loadingState}>
            <Text style={styles.loadingText}>Loading messages...</Text>
          </View>
        ) : filteredConversations.length > 0 ? (
          filteredConversations.map((conversation) => {
            const otherParticipant = conversation.participants.find(p => p.id !== user?.id);
            const isUnread = conversation.unread_count > 0;
            
            return (
              <TouchableOpacity
                key={conversation.id}
                style={[styles.conversationCard, isUnread && styles.unreadConversation]}
                activeOpacity={0.7}
              >
                <View style={styles.conversationHeader}>
                  <View style={styles.conversationAvatar}>
                    <Text style={styles.conversationAvatarText}>
                      {otherParticipant?.display_name?.charAt(0) || otherParticipant?.username?.charAt(0) || '?'}
                    </Text>
                    {otherParticipant?.is_online && (
                      <View style={styles.onlineIndicator} />
                    )}
                  </View>
                  <View style={styles.conversationInfo}>
                    <View style={styles.conversationNameRow}>
                      <Text style={[styles.conversationName, isUnread && styles.unreadText]}>
                        {otherParticipant?.display_name || otherParticipant?.username || 'Unknown User'}
                      </Text>
                      <Text style={styles.conversationTime}>
                        {conversation.last_message ? formatTime(conversation.last_message.created_at) : ''}
                      </Text>
                    </View>
                    <View style={styles.conversationMessageRow}>
                      <Text 
                        style={[styles.conversationMessage, isUnread && styles.unreadText]} 
                        numberOfLines={1}
                      >
                        {conversation.last_message?.content || 'No messages yet'}
                      </Text>
                      {isUnread && (
                        <View style={styles.unreadBadge}>
                          <Text style={styles.unreadBadgeText}>{conversation.unread_count}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })
        ) : (
          <View style={styles.emptyState}>
            <Ionicons name="chatbubbles-outline" size={48} color="#ccc" />
            <Text style={styles.emptyStateTitle}>
              {searchQuery ? 'No conversations found' : 'No messages yet'}
            </Text>
            <Text style={styles.emptyStateText}>
              {searchQuery 
                ? 'Try adjusting your search terms'
                : 'Start a conversation with your friends'
              }
            </Text>
          </View>
        )}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Connections</Text>
          <Text style={styles.subtitle}>Manage your friends and messages</Text>
        </View>

        {/* Tab Navigation */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'friends' && styles.activeTab]}
            onPress={() => setActiveTab('friends')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'friends' && styles.activeTabText,
              ]}
            >
              Friends
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'inbox' && styles.activeTab]}
            onPress={() => setActiveTab('inbox')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'inbox' && styles.activeTabText,
              ]}
            >
              Inbox
            </Text>
          </TouchableOpacity>
        </View>

        {/* Content */}
        {activeTab === 'friends' ? renderFriendsTab() : renderInboxTab()}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  header: {
    paddingVertical: 20,
    paddingHorizontal: 4,
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
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  activeTab: {
    backgroundColor: '#007AFF',
  },
  tabText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
  },
  activeTabText: {
    color: '#fff',
  },
  tabContent: {
    flex: 1,
  },
  searchContainer: {
    marginBottom: 20,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#1a1a1a',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 16,
  },
  loadingState: {
    padding: 20,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic',
  },
  friendCard: {
    backgroundColor: '#fff',
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
  friendAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  friendAvatarText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  friendDetails: {
    flex: 1,
  },
  friendName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  friendStatus: {
    fontSize: 14,
    color: '#666',
  },
  removeButton: {
    padding: 8,
  },
  addFriendCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  addFriendText: {
    fontSize: 16,
    color: '#007AFF',
    marginLeft: 12,
    fontWeight: '500',
  },
  conversationCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  unreadConversation: {
    backgroundColor: '#f8f9ff',
    borderLeftWidth: 3,
    borderLeftColor: '#007AFF',
  },
  conversationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  conversationAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    position: 'relative',
  },
  conversationAvatarText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#34C759',
    borderWidth: 2,
    borderColor: '#fff',
  },
  conversationInfo: {
    flex: 1,
  },
  conversationNameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  conversationName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    flex: 1,
  },
  conversationTime: {
    fontSize: 12,
    color: '#666',
    marginLeft: 8,
  },
  conversationMessageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  conversationMessage: {
    fontSize: 14,
    color: '#666',
    flex: 1,
  },
  unreadText: {
    fontWeight: '600',
    color: '#1a1a1a',
  },
  unreadBadge: {
    backgroundColor: '#007AFF',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  unreadBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 20,
  },
});
