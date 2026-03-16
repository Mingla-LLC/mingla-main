import React from 'react';
import { Text, View, StyleSheet, ActivityIndicator, Image } from 'react-native';
import { TrackedTouchableOpacity } from '../TrackedTouchableOpacity';
import { Icon } from '../ui/Icon';
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
  onMuteUser: (friend: Friend) => void;
  openDropdownId: string | null;
  onToggleDropdown: (friendId: string) => void;
  onCloseDropdown: () => void;
  isMuteLoading?: boolean;
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
  onMuteUser,
  openDropdownId,
  onToggleDropdown,
  onCloseDropdown,
  isMuteLoading = false,
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
            {friend.avatar || friend.avatar_url ? (
              <Image 
                source={{ uri: friend.avatar || friend.avatar_url }}
                style={styles.avatarImage}
              />
            ) : (
              <Text style={styles.avatarText}>
                {friend.name.split(' ').map(n => n[0]).join('')}
              </Text>
            )}
          </View>
          <View style={[styles.statusDot, { backgroundColor: getStatusColor(friend.status) }]} />
        </View>
        
        <View style={styles.friendInfo}>
          <View style={styles.friendHeader}>
            <View>
              <View style={styles.nameContainer}>
                <Text style={styles.friendName}>{friend.name}</Text>
                {friend.isMuted && (
                  <View style={styles.mutedBadge}>
                    <Icon name="volume-mute" size={12} color="#6b7280" />
                  </View>
                )}
              </View>
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
              <TrackedTouchableOpacity logComponent="FriendCard"
                onPress={() => onSelectFriend(friend)}
                style={styles.messageButton}
              >
                <View style={styles.iconContainer}>
                  <Icon name="chatbubble" size={16} color="#6b7280" />
                </View>
              </TrackedTouchableOpacity>
              
              {/* Friend dropdown menu */}
              <View style={styles.dropdownContainer}>
                <TrackedTouchableOpacity logComponent="FriendCard"
                  onPress={(e) => {
                    e.stopPropagation();
                    onToggleDropdown(friend.id);
                  }}
                  style={styles.dropdownButton}
                >
                  <View style={styles.iconContainer}>
                    <Icon name="ellipsis-horizontal" size={16} color="#9ca3af" />
                  </View>
                </TrackedTouchableOpacity>
                
                {openDropdownId === friend.id && (
                  <View style={styles.dropdown}>
                    <View style={styles.dropdownContent}>
                      <TrackedTouchableOpacity logComponent="FriendCard"
                        onPress={() => onSendCollabInvite(friend)}
                        style={styles.dropdownItem}
                      >
                        <View style={styles.dropdownItemContent}>
                          <Icon name="add" size={16} color="#eb7825" />
                          <Text style={styles.dropdownItemText}>Send Collaboration Invite</Text>
                        </View>
                      </TrackedTouchableOpacity>
                      <TrackedTouchableOpacity logComponent="FriendCard"
                        onPress={() => onAddToBoard(friend)}
                        style={styles.dropdownItem}
                      >
                        <View style={styles.dropdownItemContent}>
                          <Icon name="people" size={16} color="#2563eb" />
                          <Text style={styles.dropdownItemText}>Add to Board</Text>
                        </View>
                      </TrackedTouchableOpacity>
                      <TrackedTouchableOpacity logComponent="FriendCard"
                        onPress={() => onShareSavedCard(friend)}
                        style={styles.dropdownItem}
                      >
                        <View style={styles.dropdownItemContent}>
                          <Icon name="bookmark" size={16} color="#9333ea" />
                          <Text style={styles.dropdownItemText}>Share Saved Card</Text>
                        </View>
                      </TrackedTouchableOpacity>
                      <View style={styles.divider} />
                      <TrackedTouchableOpacity logComponent="FriendCard"
                        onPress={() => !isMuteLoading && onMuteUser(friend)}
                        style={[styles.dropdownItem, isMuteLoading && styles.dropdownItemDisabled]}
                        disabled={isMuteLoading}
                      >
                        <View style={styles.dropdownItemContent}>
                          {isMuteLoading ? (
                            <ActivityIndicator size={16} color="#6b7280" />
                          ) : (
                            <Icon 
                              name={friend.isMuted ? "volume-high" : "volume-mute"} 
                              size={16} 
                              color="#6b7280" 
                            />
                          )}
                          <Text style={styles.dropdownItemText}>
                            {friend.isMuted ? 'Unmute' : 'Mute'}
                          </Text>
                          {friend.isMuted && (
                            <View style={styles.mutedIndicator}>
                              <Text style={styles.mutedIndicatorText}>Muted</Text>
                            </View>
                          )}
                        </View>
                      </TrackedTouchableOpacity>
                      <View style={styles.divider} />
                      <TrackedTouchableOpacity logComponent="FriendCard"
                        onPress={() => onBlockUser(friend)}
                        style={styles.dropdownItem}
                      >
                        <View style={styles.dropdownItemContent}>
                          <Icon name="shield" size={16} color="#ef4444" />
                          <Text style={[styles.dropdownItemText, styles.dangerText]}>Block User</Text>
                        </View>
                      </TrackedTouchableOpacity>
                      <TrackedTouchableOpacity logComponent="FriendCard"
                        onPress={() => onReportUser(friend)}
                        style={styles.dropdownItem}
                      >
                        <View style={styles.dropdownItemContent}>
                          <Icon name="flag" size={16} color="#ef4444" />
                          <Text style={[styles.dropdownItemText, styles.dangerText]}>Report User</Text>
                        </View>
                      </TrackedTouchableOpacity>
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
    borderColor: '#f0f0f0',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  friendContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
    overflow: 'hidden',
  },
  avatarImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  avatarText: {
    color: 'white',
    fontSize: 14,
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
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  nameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  friendName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    letterSpacing: 0.3,
  },
  mutedBadge: {
    backgroundColor: '#f3f4f6',
    padding: 3,
    borderRadius: 3,
  },
  friendUsername: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  mutualFriends: {
    fontSize: 11,
    color: '#d1d5db',
    marginTop: 3,
  },
  friendActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  statusText: {
    fontSize: 11,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
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
    padding: 6,
    backgroundColor: '#eb7825',
    borderRadius: 6,
  },
  dropdownContainer: {
    position: 'relative',
  },
  dropdownButton: {
    padding: 6,
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
  dropdownItemDisabled: {
    opacity: 0.6,
  },
  dropdownItemText: {
    fontSize: 13,
    color: '#111827',
  },
  dangerText: {
    color: '#ef4444',
  },
  mutedIndicator: {
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 'auto',
  },
  mutedIndicatorText: {
    fontSize: 9,
    color: '#6b7280',
    fontWeight: '500',
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
