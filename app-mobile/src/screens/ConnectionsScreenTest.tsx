import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

// Simple demo data
const demoConversations = [
  {
    id: '1',
    name: 'Sarah Johnson',
    lastMessage: 'Hey! Are you still up for the hiking trip this weekend?',
    time: '2h ago',
    unread: 1,
    isOnline: true,
  },
  {
    id: '2',
    name: 'Mike Chen',
    lastMessage: 'Thanks for the restaurant recommendation! It was amazing.',
    time: '1d ago',
    unread: 0,
    isOnline: false,
  },
  {
    id: '3',
    name: 'Emma Wilson',
    lastMessage: 'The concert was incredible! Thanks for inviting me.',
    time: '3d ago',
    unread: 0,
    isOnline: true,
  },
];

const demoFriends = [
  {
    id: '1',
    username: 'sarah_j',
    displayName: 'Sarah Johnson',
    email: 'sarah.johnson@email.com',
    isOnline: true,
    lastSeen: '2 minutes ago',
  },
  {
    id: '2',
    username: 'mike_c',
    displayName: 'Mike Chen',
    email: 'mike.chen@email.com',
    isOnline: false,
    lastSeen: '1 hour ago',
  },
  {
    id: '3',
    username: 'emma_w',
    displayName: 'Emma Wilson',
    email: 'emma.wilson@email.com',
    isOnline: true,
    lastSeen: 'Online',
  },
  {
    id: '4',
    username: 'alex_r',
    displayName: 'Alex Rodriguez',
    email: 'alex.rodriguez@email.com',
    isOnline: false,
    lastSeen: '3 hours ago',
  },
  {
    id: '5',
    username: 'lisa_k',
    displayName: 'Lisa Kim',
    email: 'lisa.kim@email.com',
    isOnline: true,
    lastSeen: 'Online',
  },
];

export default function ConnectionsScreenTest() {
  const [activeTab, setActiveTab] = useState<'friends' | 'inbox'>('friends');
  const [searchQuery, setSearchQuery] = useState('');
  const [addFriendQuery, setAddFriendQuery] = useState('');
  const [friendsSearchQuery, setFriendsSearchQuery] = useState('');

  const filteredConversations = demoConversations.filter(conv =>
    conv.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    conv.lastMessage.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredFriends = demoFriends.filter(friend =>
    friend.displayName.toLowerCase().includes(friendsSearchQuery.toLowerCase()) ||
    friend.username.toLowerCase().includes(friendsSearchQuery.toLowerCase()) ||
    friend.email.toLowerCase().includes(friendsSearchQuery.toLowerCase())
  );

  const handleAddFriend = () => {
    if (addFriendQuery.trim()) {
      // In a real app, this would send a friend request
      console.log('Adding friend:', addFriendQuery);
      setAddFriendQuery('');
    }
  };

  const renderFriendsTab = () => (
    <View style={styles.tabContent}>
      {/* Add Friend Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Add Friend</Text>
        <View style={styles.addFriendCard}>
          <TextInput
            style={styles.addFriendInput}
            placeholder="Enter username or email"
            placeholderTextColor="#999"
            value={addFriendQuery}
            onChangeText={setAddFriendQuery}
            onSubmitEditing={handleAddFriend}
            returnKeyType="search"
          />
          <Text style={styles.addFriendInstruction}>
            Search by username or email to find friends
          </Text>
        </View>
      </View>

      {/* Friends List Section */}
      <View style={styles.section}>
        <View style={styles.friendsHeader}>
          <Text style={styles.sectionTitle}>Friends ({filteredFriends.length})</Text>
          <View style={styles.friendsSearchContainer}>
            <View style={styles.friendsSearchBar}>
              <Ionicons name="search" size={16} color="#999" style={styles.friendsSearchIcon} />
              <TextInput
                style={styles.friendsSearchInput}
                placeholder="Search friends..."
                placeholderTextColor="#999"
                value={friendsSearchQuery}
                onChangeText={setFriendsSearchQuery}
              />
            </View>
          </View>
        </View>

        {filteredFriends.length > 0 ? (
          filteredFriends.map((friend) => (
            <TouchableOpacity
              key={friend.id}
              style={styles.friendCard}
              activeOpacity={0.7}
            >
              <View style={styles.friendHeader}>
                <View style={styles.friendAvatar}>
                  <Text style={styles.friendAvatarText}>
                    {friend.displayName.charAt(0)}
                  </Text>
                  {friend.isOnline && (
                    <View style={styles.onlineIndicator} />
                  )}
                </View>
                <View style={styles.friendInfo}>
                  <View style={styles.friendNameRow}>
                    <Text style={styles.friendName}>{friend.displayName}</Text>
                    <Text style={styles.friendUsername}>@{friend.username}</Text>
                  </View>
                  <Text style={styles.friendEmail}>{friend.email}</Text>
                  <Text style={[styles.friendStatus, friend.isOnline && styles.onlineStatus]}>
                    {friend.isOnline ? 'Online' : friend.lastSeen}
                  </Text>
                </View>
                <TouchableOpacity style={styles.removeFriendButton}>
                  <Ionicons name="close" size={20} color="#FF3B30" />
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          ))
        ) : (
          <View style={styles.emptyState}>
            <Ionicons name="people-outline" size={48} color="#ccc" />
            <Text style={styles.emptyStateTitle}>
              {friendsSearchQuery ? 'No friends found' : 'No friends yet'}
            </Text>
            <Text style={styles.emptyStateText}>
              {friendsSearchQuery 
                ? 'Try adjusting your search terms'
                : 'Add some friends!'
              }
            </Text>
          </View>
        )}
      </View>
    </View>
  );

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
        {filteredConversations.map((conversation) => (
          <TouchableOpacity
            key={conversation.id}
            style={[styles.conversationCard, conversation.unread > 0 && styles.unreadConversation]}
            activeOpacity={0.7}
          >
            <View style={styles.conversationHeader}>
              <View style={styles.conversationAvatar}>
                <Text style={styles.conversationAvatarText}>
                  {conversation.name.charAt(0)}
                </Text>
                {conversation.isOnline && (
                  <View style={styles.onlineIndicator} />
                )}
              </View>
              <View style={styles.conversationInfo}>
                <View style={styles.conversationNameRow}>
                  <Text style={[styles.conversationName, conversation.unread > 0 && styles.unreadText]}>
                    {conversation.name}
                  </Text>
                  <Text style={styles.conversationTime}>
                    {conversation.time}
                  </Text>
                </View>
                <View style={styles.conversationMessageRow}>
                  <Text 
                    style={[styles.conversationMessage, conversation.unread > 0 && styles.unreadText]} 
                    numberOfLines={1}
                  >
                    {conversation.lastMessage}
                  </Text>
                  {conversation.unread > 0 && (
                    <View style={styles.unreadBadge}>
                      <Text style={styles.unreadBadgeText}>{conversation.unread}</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.content}>
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
  addFriendCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  addFriendInput: {
    fontSize: 16,
    color: '#1a1a1a',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    marginBottom: 8,
  },
  addFriendInstruction: {
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic',
  },
  friendsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  friendsSearchContainer: {
    flex: 1,
    marginLeft: 16,
  },
  friendsSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  friendsSearchIcon: {
    marginRight: 8,
  },
  friendsSearchInput: {
    flex: 1,
    fontSize: 14,
    color: '#1a1a1a',
  },
  friendCard: {
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
  friendHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  friendAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    position: 'relative',
  },
  friendAvatarText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  friendInfo: {
    flex: 1,
  },
  friendNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  friendName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginRight: 8,
  },
  friendUsername: {
    fontSize: 14,
    color: '#666',
  },
  friendEmail: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  friendStatus: {
    fontSize: 12,
    color: '#666',
  },
  onlineStatus: {
    color: '#34C759',
    fontWeight: '500',
  },
  removeFriendButton: {
    padding: 8,
  },
});
