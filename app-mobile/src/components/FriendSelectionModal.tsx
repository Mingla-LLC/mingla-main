import React, { useState } from 'react';
import { Text, View, TouchableOpacity, TextInput, StyleSheet, Modal, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ImageWithFallback } from './figma/ImageWithFallback';

interface Friend {
  id: string;
  name: string;
  username: string;
  avatar?: string;
  isOnline: boolean;
  lastSeen?: string;
}

interface FriendSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectFriend: (friend: Friend) => void;
  friends: Friend[];
}

export default function FriendSelectionModal({
  isOpen,
  onClose,
  onSelectFriend,
  friends
}: FriendSelectionModalProps) {
  const [searchQuery, setSearchQuery] = useState('');

  if (!isOpen) return null;

  const filteredFriends = friends.filter(friend =>
    friend.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    friend.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Modal
      visible={isOpen}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdropTouch}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerSidePlaceholder} />
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle}>Start New Conversation</Text>
              <Text style={styles.headerSubtitle}>Choose a friend to message</Text>
            </View>
            <View style={styles.headerSidePlaceholder} />
          </View>

        {/* Search */}
        <View style={styles.searchContainer}>
          <View style={styles.searchInputContainer}>
            <Ionicons name="search" size={16} color="#9ca3af" style={styles.searchIcon} />
            <TextInput
              placeholder="Search friends..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              style={styles.searchInput}
            />
          </View>
        </View>

        {/* Friends List */}
        <ScrollView style={styles.friendsList}>
          {filteredFriends.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="people" size={48} color="#d1d5db" />
              <Text style={styles.emptyStateText}>
                {searchQuery ? 'No friends found' : 'No friends available'}
              </Text>
              <Text style={styles.emptyStateSubtext}>
                {searchQuery ? 'Try a different search term' : 'Add friends to start messaging'}
              </Text>
            </View>
          ) : (
            <View style={styles.friendsContainer}>
              {filteredFriends.map((friend) => (
                <TouchableOpacity
                  key={friend.id}
                  onPress={() => onSelectFriend(friend)}
                  style={styles.friendItem}
                >
                  <View style={styles.avatarContainer}>
                    {friend.avatar || friend.avatar_url ? (
                      <ImageWithFallback
                        source={{ uri: friend.avatar || friend.avatar_url }}
                        style={styles.avatar}
                      />
                    ) : (
                      <View style={styles.avatarPlaceholder}>
                        <Text style={styles.avatarText}>
                          {friend.name.split(' ').map(n => n[0]).join('')}
                        </Text>
                      </View>
                    )}
                    {friend.isOnline && (
                      <View style={styles.onlineIndicator} />
                    )}
                  </View>
                  
                  <View style={styles.friendInfo}>
                    <Text style={styles.friendName}>
                      {friend.name}
                    </Text>
                  </View>

                  <View style={styles.messageButton}>
                    <Ionicons name="chatbubble" size={16} color="#eb7825" />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Only direct one-on-one conversations are supported
          </Text>
        </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  backdropTouch: {
    ...StyleSheet.absoluteFillObject,
  },
  modalContainer: {
    backgroundColor: 'white',
    borderRadius: 16,
    width: '100%',
    maxWidth: 400,
    height: '85%',
    maxHeight: '85%',
    flexDirection: 'column',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e293b',
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginTop: 2,
    textAlign: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonPlaceholder: {
    width: 32,
    height: 32,
  },
  headerSidePlaceholder: {
    width: 32,
    height: 32,
  },
  searchContainer: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  searchInputContainer: {
    position: 'relative',
  },
  searchIcon: {
    position: 'absolute',
    left: 12,
    top: 12,
    zIndex: 1,
  },
  searchInput: {
    width: '100%',
    paddingLeft: 40,
    paddingRight: 16,
    paddingVertical: 12,
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    fontSize: 16,
    color: '#111827',
  },
  friendsList: {
    flex: 1,
    padding: 16,
    minHeight: 0, // Important for ScrollView to work properly
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyStateText: {
    fontSize: 16,
    color: '#6b7280',
    marginTop: 12,
    textAlign: 'center',
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 4,
    textAlign: 'center',
  },
  friendsContainer: {
    gap: 8,
  },
  friendItem: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  avatarContainer: {
    position: 'relative',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarPlaceholder: {
    width: 40,
    height: 40,
    backgroundColor: '#eb7825',
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: 'white',
    fontWeight: '500',
    fontSize: 14,
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 12,
    height: 12,
    backgroundColor: '#10b981',
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'white',
  },
  friendInfo: {
    flex: 1,
  },
  friendName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#111827',
  },
  friendUsername: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 2,
  },
  messageButton: {
    width: 32,
    height: 32,
    backgroundColor: 'rgba(235, 120, 37, 0.1)',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    backgroundColor: '#f9fafb',
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  footerText: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'center',
  },
});