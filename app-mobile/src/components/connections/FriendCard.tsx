import React from 'react';
import { Text, View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Friend } from '../../data/mockConnections';

interface FriendCardProps {
  friend: Friend;
  onSelectFriend: (friend: Friend) => void;
  onSendCollabInvite: (friend: Friend) => void;
  onAddToBoard: (friend: Friend) => void;
  onShareSavedCard: (friend: Friend) => void;
  onRemoveFriend: (friend: Friend) => void;
  onBlockUser: (friend: Friend) => void;
  onReportUser: (friend: Friend) => void;
  openDropdownId: string | null;
  onToggleDropdown: (friendId: string) => void;
  onCloseDropdown: () => void;
}

export default function FriendCard({
  friend,
  onSelectFriend,
  onSendCollabInvite,
  onAddToBoard,
  onShareSavedCard,
  onRemoveFriend,
  onBlockUser,
  onReportUser,
  openDropdownId,
  onToggleDropdown,
  onCloseDropdown
}: FriendCardProps) {
  const getStatusColor = (status: Friend['status']) => {
    switch (status) {
      case 'online': return 'bg-green-500';
      case 'away': return 'bg-yellow-500';
      case 'offline': return 'bg-gray-400';
    }
  };

  return (
    <View style={styles.friendCard}>
      <View style={styles.friendContent}>
        <View style={styles.avatarContainer}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {friend.name.split(' ').map(n => n[0]).join('')}
            </Text>
          </View>
          <View style={[styles.statusDot, { backgroundColor: getStatusColor(friend.status) }]} />
        </View>
        
        <View style={styles.friendInfo}>
          <View style={styles.friendHeader}>
            <View>
              <Text style={styles.friendName}>{friend.name}</Text>
              <Text style={styles.friendUsername}>@{friend.username}</Text>
              {friend.mutualFriends && (
                <Text style={styles.mutualFriends}>{friend.mutualFriends} mutual friends</Text>
              )}
            </View>
            
            <View style={styles.friendActions}>
              <Text style={[
                styles.statusText,
                friend.isOnline ? styles.statusOnline : styles.statusOffline
              ]}>
                {friend.isOnline ? 'Online' : friend.lastSeen || 'Offline'}
              </Text>
              
              {/* Message button */}
              <TouchableOpacity
                onPress={() => onSelectFriend(friend)}
                style={styles.messageButton}
              >
                <View style={styles.iconContainer}>
                  <Ionicons name="chatbubble" size={16} color="#6b7280" />
                </View>
              </TouchableOpacity>
              
              {/* Friend dropdown menu */}
              <View style={styles.dropdownContainer}>
                <TouchableOpacity
                  onPress={(e) => {
                    e.stopPropagation();
                    onToggleDropdown(friend.id);
                  }}
                  style={styles.dropdownButton}
                >
                  <View style={styles.iconContainer}>
                    <Ionicons name="ellipsis-horizontal" size={16} color="#9ca3af" />
                  </View>
                </TouchableOpacity>
                
                {openDropdownId === friend.id && (
                  <View style={styles.dropdown}>
                    <View style={styles.dropdownContent}>
                      <TouchableOpacity
                        onPress={() => onSendCollabInvite(friend)}
                        style={styles.dropdownItem}
                      >
                        <View style={styles.dropdownItemContent}>
                          <Ionicons name="add" size={16} color="#eb7825" />
                          <Text style={styles.dropdownItemText}>Send Collaboration Invite</Text>
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => onAddToBoard(friend)}
                        style={styles.dropdownItem}
                      >
                        <View style={styles.dropdownItemContent}>
                          <Ionicons name="people" size={16} color="#2563eb" />
                          <Text style={styles.dropdownItemText}>Add to Board</Text>
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => onShareSavedCard(friend)}
                        style={styles.dropdownItem}
                      >
                        <View style={styles.dropdownItemContent}>
                          <Ionicons name="bookmark" size={16} color="#9333ea" />
                          <Text style={styles.dropdownItemText}>Share Saved Card</Text>
                        </View>
                      </TouchableOpacity>
                      <View style={styles.divider} />
                      <TouchableOpacity
                        onPress={() => onBlockUser(friend)}
                        style={styles.dropdownItem}
                      >
                        <View style={styles.dropdownItemContent}>
                          <Ionicons name="shield" size={16} color="#ef4444" />
                          <Text style={[styles.dropdownItemText, styles.dangerText]}>Block User</Text>
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => onReportUser(friend)}
                        style={styles.dropdownItem}
                      >
                        <View style={styles.dropdownItemContent}>
                          <Ionicons name="flag" size={16} color="#ef4444" />
                          <Text style={[styles.dropdownItemText, styles.dangerText]}>Report User</Text>
                        </View>
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
  );
}

const styles = StyleSheet.create({
  friendCard: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  friendContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  avatarContainer: {
    position: 'relative',
  },
  avatar: {
    width: 48,
    height: 48,
    backgroundColor: '#3b82f6',
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  statusDot: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'white',
  },
  friendInfo: {
    flex: 1,
    minWidth: 0,
  },
  friendHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  friendName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  friendUsername: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 2,
  },
  mutualFriends: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 4,
  },
  friendActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: {
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusOnline: {
    backgroundColor: '#dcfce7',
    color: '#166534',
  },
  statusOffline: {
    backgroundColor: '#f3f4f6',
    color: '#6b7280',
  },
  messageButton: {
    padding: 8,
    backgroundColor: '#eb7825',
    borderRadius: 8,
  },
  dropdownContainer: {
    position: 'relative',
  },
  dropdownButton: {
    padding: 8,
    borderRadius: 8,
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
  dropdownContent: {
    paddingVertical: 4,
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
  dangerText: {
    color: '#ef4444',
  },
  divider: {
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    marginVertical: 4,
  },
  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  dropdownItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
