import React, { useState, useEffect } from 'react';
import { Text, View, TextInput, StyleSheet, Modal, ActivityIndicator, ScrollView } from 'react-native';
import { TrackedTouchableOpacity } from './TrackedTouchableOpacity';
import { Ionicons } from '@expo/vector-icons';
import { useFriends } from '../hooks/useFriends';

interface User {
  id: string;
  name: string;
  avatar?: string;
  isOnline?: boolean;
  lastSeen?: string;
}

interface UserInviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionName: string;
  onSendInvites: (users: User[]) => void;
  friends?: User[]; // Optional: pass friends from parent, otherwise use useFriends hook
  existingMemberIds?: string[]; // IDs of users already in the session to exclude from results
}

export default function UserInviteModal({ isOpen, onClose, sessionName, onSendInvites, friends: propFriends, existingMemberIds = [] }: UserInviteModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const { friends: dbFriends, fetchFriends, loading, error } = useFriends();

  // Fetch friends when modal opens
  useEffect(() => {
    if (isOpen && !propFriends) {
      fetchFriends();
    }
  }, [isOpen, propFriends, fetchFriends]);

  // Transform database friends to match User interface
  const transformedFriends: User[] = React.useMemo(() => {
    if (propFriends && propFriends.length > 0) {
      return propFriends;
    }
    return dbFriends.map((friend) => ({
      id: friend.friend_user_id || friend.id,
      name:
        friend.display_name ||
        `${friend.first_name || ""} ${friend.last_name || ""}`.trim() ||
        friend.username ||
        "Unknown",
      avatar: friend.avatar_url,
      isOnline: false, // Default to offline, can be enhanced with presence later
      lastSeen: undefined,
    }));
  }, [dbFriends, propFriends]);

  const filteredUsers = transformedFriends.filter(user => {
    // Filter by search query
    const matchesSearch = user.name.toLowerCase().includes(searchQuery.toLowerCase());
    // Exclude users who are already members of the session
    const isNotExistingMember = !existingMemberIds.includes(user.id);
    return matchesSearch && isNotExistingMember;
  });

  const toggleUser = (user: User) => {
    setSelectedUsers(prev => 
      prev.find(u => u.id === user.id)
        ? prev.filter(u => u.id !== user.id)
        : [...prev, user]
    );
  };

  const handleInvite = () => {
    if (selectedUsers.length > 0) {
      onSendInvites(selectedUsers);
      setSelectedUsers([]);
      setSearchQuery('');
      onClose();
    }
  };

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedUsers([]);
      setSearchQuery('');
    }
  }, [isOpen]);

  return (
    <Modal
      visible={isOpen}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TrackedTouchableOpacity logComponent="UserInviteModal"
          style={styles.backdropTouch}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerSidePlaceholder} />
            <View style={styles.headerContent}>
              <Text style={styles.title}>Invite to Session</Text>
              <Text style={styles.sessionName}>"{sessionName}"</Text>
            </View>
            <TrackedTouchableOpacity logComponent="UserInviteModal" 
              onPress={onClose}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={20} color="#6b7280" />
            </TrackedTouchableOpacity>
          </View>

          {/* Search */}
          <View style={styles.searchContainer}>
            <View style={styles.searchWrapper}>
              <Ionicons name="search" size={16} color="#9ca3af" style={styles.searchIcon} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search friends..."
                style={styles.searchInput}
              />
            </View>
          </View>

          {/* Selected Users */}
          {selectedUsers.length > 0 && (
            <View style={styles.selectedContainer}>
              <Text style={styles.selectedTitle}>
                Selected ({selectedUsers.length})
              </Text>
              <View style={styles.selectedUsers}>
                {selectedUsers.map(user => (
                  <View key={user.id} style={styles.selectedUser}>
                    <View style={styles.selectedUserAvatar}>
                      <Text style={styles.selectedUserInitial}>{user.name[0]}</Text>
                    </View>
                    <Text style={styles.selectedUserName}>{user.name}</Text>
                    <TrackedTouchableOpacity logComponent="UserInviteModal" 
                      onPress={() => toggleUser(user)}
                      style={styles.removeUserButton}
                    >
                      <Ionicons name="close" size={12} color="#9ca3af" />
                    </TrackedTouchableOpacity>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* User List */}
          <ScrollView style={styles.userList} contentContainerStyle={styles.userListContent} keyboardShouldPersistTaps="handled">
            {loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#eb7825" />
                <Text style={styles.loadingText}>Loading friends...</Text>
              </View>
            ) : error ? (
              <View style={styles.errorContainer}>
                <View style={styles.errorIconContainer}>
                  <Ionicons name="cloud-offline-outline" size={48} color="#ef4444" />
                </View>
                <Text style={styles.errorTitle}>Connection Error</Text>
                <Text style={styles.errorSubtitle}>{error}</Text>
                <TrackedTouchableOpacity logComponent="UserInviteModal" 
                  style={styles.retryButton}
                  onPress={() => fetchFriends()}
                >
                  <Ionicons name="refresh" size={16} color="white" />
                  <Text style={styles.retryButtonText}>Try Again</Text>
                </TrackedTouchableOpacity>
              </View>
            ) : transformedFriends.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Ionicons name="people-outline" size={48} color="#d1d5db" />
                <Text style={styles.emptyTitle}>No Friends Yet</Text>
                <Text style={styles.emptySubtitle}>
                  Add friends to invite them to your sessions
                </Text>
              </View>
            ) : filteredUsers.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Ionicons name="search-outline" size={48} color="#d1d5db" />
                <Text style={styles.emptyTitle}>No Results</Text>
                <Text style={styles.emptySubtitle}>
                  No friends match "{searchQuery}"
                </Text>
              </View>
            ) : (
              filteredUsers.map(user => {
                const isSelected = selectedUsers.find(u => u.id === user.id);
                return (
                  <TrackedTouchableOpacity logComponent="UserInviteModal"
                    key={user.id}
                    onPress={() => toggleUser(user)}
                    style={[
                      styles.userItem,
                      isSelected ? styles.userItemSelected : styles.userItemUnselected
                    ]}
                  >
                    <View style={styles.userAvatarContainer}>
                      <View style={styles.userAvatar}>
                        <Text style={styles.userAvatarText}>{user.name[0]}</Text>
                      </View>
                      {user.isOnline && (
                        <View style={styles.onlineIndicator} />
                      )}
                    </View>
                    
                    <View style={styles.userInfo}>
                      <Text style={styles.userName}>{user.name}</Text>
                      {user.lastSeen && (
                        <Text style={styles.userStatus}>
                          {user.isOnline ? 'Online' : `Last seen ${user.lastSeen}`}
                        </Text>
                      )}
                    </View>

                    {isSelected && (
                      <Ionicons name="checkmark" size={20} color="#eb7825" />
                    )}
                  </TrackedTouchableOpacity>
                );
              })
            )}
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <TrackedTouchableOpacity logComponent="UserInviteModal"
              onPress={handleInvite}
              disabled={selectedUsers.length === 0}
              style={[
                styles.inviteButton,
                selectedUsers.length === 0 ? styles.inviteButtonDisabled : styles.inviteButtonEnabled
              ]}
            >
              <Ionicons name="send" size={16} color="white" />
              <Text style={styles.inviteButtonText}>
                Send Invite{selectedUsers.length > 1 ? 's' : ''} ({selectedUsers.length})
              </Text>
            </TrackedTouchableOpacity>
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
  modal: {
    backgroundColor: 'white',
    borderRadius: 16,
    width: '100%',
    maxWidth: 400,
    maxHeight: '90%',
    minHeight: '70%',
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
  headerContent: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e293b',
    textAlign: 'center',
  },
  sessionName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginTop: 2,
    textAlign: 'center',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSidePlaceholder: {
    width: 36,
    height: 36,
  },
  searchContainer: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  searchWrapper: {
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
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    backgroundColor: '#f9fafb',
    fontSize: 16,
  },
  selectedContainer: {
    padding: 16,
    backgroundColor: '#fef3e2',
    borderBottomWidth: 1,
    borderBottomColor: '#fed7aa',
  },
  selectedTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#92400e',
    marginBottom: 8,
  },
  selectedUsers: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  selectedUser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'white',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  selectedUserAvatar: {
    width: 24,
    height: 24,
    backgroundColor: '#eb7825',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectedUserInitial: {
    color: 'white',
    fontSize: 12,
    fontWeight: '500',
  },
  selectedUserName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827',
  },
  removeUserButton: {
    padding: 2,
  },
  userList: {
    flex: 1,
    padding: 16,
  },
  userListContent: {
    flexGrow: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 48,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#6b7280',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  errorIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#fef2f2',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  errorSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#eb7825',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyTitle: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  emptySubtitle: {
    marginTop: 4,
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
  },
  userItem: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 2,
  },
  userItemSelected: {
    backgroundColor: '#fef3e2',
    borderColor: '#eb7825',
  },
  userItemUnselected: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  userAvatarContainer: {
    position: 'relative',
  },
  userAvatar: {
    width: 40,
    height: 40,
    backgroundColor: '#eb7825',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  userAvatarText: {
    color: 'white',
    fontWeight: '500',
    fontSize: 16,
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 12,
    height: 12,
    backgroundColor: '#10b981',
    borderWidth: 2,
    borderColor: 'white',
    borderRadius: 6,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontWeight: '500',
    color: '#111827',
    fontSize: 16,
  },
  userStatus: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 2,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  inviteButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  inviteButtonEnabled: {
    backgroundColor: '#eb7825',
  },
  inviteButtonDisabled: {
    backgroundColor: '#d1d5db',
  },
  inviteButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
  },
});