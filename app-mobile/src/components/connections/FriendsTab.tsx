import React, { useState } from 'react';
import { Text, View, TextInput, StyleSheet, ScrollView } from 'react-native';
import { TrackedTouchableOpacity } from '../TrackedTouchableOpacity';
import { Ionicons } from '@expo/vector-icons';
import { Friend } from '../../data/mockConnections';
import FriendCard from './FriendCard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboard } from '../../hooks/useKeyboard';

interface FriendsTabProps {
  friends: Friend[];
  onSelectFriend: (friend: Friend) => void;
  onSendCollabInvite: (friend: Friend) => void;
  onAddToBoard: (friend: Friend) => void;
  onShareSavedCard: (friend: Friend) => void;
  onRemoveFriend: (friend: Friend) => void;
  onBlockUser: (friend: Friend) => void;
  onReportUser: (friend: Friend) => void;
  onMuteUser: (friend: Friend) => void;
  onShowAddFriendModal: () => void;
  onShowFriendRequests: () => void;
  onShowQRCode: () => void;
  onCopyInvite: () => void;
  showQRCode: boolean;
  inviteCopied: boolean;
  friendRequestsCount: number;
  muteLoadingFriendId?: string | null;
}

export default function FriendsTab({
  friends,
  onSelectFriend,
  onSendCollabInvite,
  onAddToBoard,
  onShareSavedCard,
  onRemoveFriend,
  onBlockUser,
  onReportUser,
  onMuteUser,
  onShowAddFriendModal,
  onShowFriendRequests,
  onShowQRCode,
  onCopyInvite,
  showQRCode,
  inviteCopied,
  friendRequestsCount,
  muteLoadingFriendId,
}: FriendsTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [friendsListExpanded, setFriendsListExpanded] = useState(true);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const { keyboardHeight } = useKeyboard({ disableLayoutAnimation: true });

  // Filter friends based on search query
  const filteredFriends = friends.filter(friend =>
    friend.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    friend.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Show only first 3 friends when collapsed, all when expanded
  const displayedFriends = friendsListExpanded ? filteredFriends : filteredFriends.slice(0, 3);

  const handleToggleDropdown = (friendId: string) => {
    setOpenDropdownId(openDropdownId === friendId ? null : friendId);
  };

  const handleCloseDropdown = () => {
    setOpenDropdownId(null);
  };

  const getStatusColor = (status: Friend['status']) => {
    switch (status) {
      case 'online': return '#10b981';
      case 'away': return '#f59e0b';
      case 'offline': return '#9ca3af';
    }
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={20} color="#9ca3af" style={styles.searchIcon} />
        <TextInput
          placeholder="Search friends..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          style={styles.searchInput}
        />
      </View>

      {/* Action Buttons */}
      <View style={styles.actionButtons}>
        <TrackedTouchableOpacity logComponent="FriendsTab" 
          onPress={onShowAddFriendModal}
          style={styles.actionButton}
        >
          <Ionicons name="person-add" size={20} color="#eb7825" />
        </TrackedTouchableOpacity>

        <TrackedTouchableOpacity logComponent="FriendsTab" 
          onPress={onShowFriendRequests}
          style={styles.actionButton}
        >
          <Ionicons name="people" size={20} color="#eb7825" />
          {friendRequestsCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{friendRequestsCount}</Text>
            </View>
          )}
        </TrackedTouchableOpacity>

        <TrackedTouchableOpacity logComponent="FriendsTab" 
          onPress={onShowQRCode}
          style={[
            styles.actionButton,
            showQRCode && styles.actionButtonActive
          ]}
        >
          <Ionicons 
            name="qr-code" 
            size={20} 
            color={showQRCode ? 'white' : '#eb7825'} 
          />
        </TrackedTouchableOpacity>

        <TrackedTouchableOpacity logComponent="FriendsTab" 
          onPress={onCopyInvite}
          style={styles.actionButton}
        >
          {inviteCopied ? 
            <Ionicons name="checkmark" size={20} color="white" /> : 
            <Ionicons name="link" size={20} color="#eb7825" />
          }
        </TrackedTouchableOpacity>
      </View>

      {/* QR Code Display */}
      {showQRCode && (
        <View style={styles.qrCodeContainer}>
          <View style={styles.qrCode}>
            <View style={styles.qrGrid}>
              {Array.from({ length: 64 }).map((_, i) => (
                <View
                  key={`qr-dot-${i}`}
                  style={[
                    styles.qrDot,
                    { backgroundColor: Math.random() > 0.5 ? '#111827' : 'white' }
                  ]}
                />
              ))}
            </View>
          </View>
          <View style={styles.qrTextContainer}>
            <Text style={styles.qrTitle}>Scan to Add Me</Text>
            <Text style={styles.qrSubtitle}>Have friends scan this code to instantly connect</Text>
          </View>
        </View>
      )}

      {/* Friends List Header */}
      <View style={styles.friendsHeader}>
        <Text style={styles.friendsTitle}>Friends ({filteredFriends.length})</Text>
        <TrackedTouchableOpacity logComponent="FriendsTab" 
          onPress={() => setFriendsListExpanded(!friendsListExpanded)}
          style={styles.expandButton}
        >
          <Ionicons 
            name={friendsListExpanded ? "chevron-up" : "chevron-down"} 
            size={20} 
            color="#6b7280" 
          />
        </TrackedTouchableOpacity>
      </View>

      {/* Enhanced online friends showcase */}
      <View style={styles.onlineShowcase}>
        <View style={styles.onlineHeader}>
          <View style={styles.onlineIndicator} />
          <Text style={styles.onlineText}>
            {filteredFriends.filter(f => f.isOnline).length} friends online
          </Text>
        </View>
        <View style={styles.onlineAvatars}>
          {filteredFriends.filter(f => f.isOnline).slice(0, 5).map((friend, index) => (
            <View key={`online-showcase-${friend.id}-${index}`} style={styles.onlineAvatarContainer}>
              <View style={styles.onlineAvatar}>
                <Text style={styles.onlineAvatarText}>
                  {friend.name.split(' ').map(n => n[0]).join('')}
                </Text>
              </View>
              <View style={styles.onlineStatusDot} />
            </View>
          ))}
          {filteredFriends.filter(f => f.isOnline).length > 5 && (
            <View style={styles.moreAvatars}>
              <Text style={styles.moreAvatarsText}>
                +{filteredFriends.filter(f => f.isOnline).length - 5}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Friends List */}
      <View style={[
        styles.friendsList,
        !friendsListExpanded && styles.friendsListCollapsed
      ]}>
        {displayedFriends.map((friend, index) => (
          <FriendCard
            key={`friends-list-${friend.id}-${index}`}
            friend={friend}
            onSelectFriend={onSelectFriend}
            onSendCollabInvite={onSendCollabInvite}
            onAddToBoard={onAddToBoard}
            onShareSavedCard={onShareSavedCard}
            onRemoveFriend={onRemoveFriend}
            onBlockUser={onBlockUser}
            onReportUser={onReportUser}
            onMuteUser={onMuteUser}
            openDropdownId={openDropdownId}
            onToggleDropdown={handleToggleDropdown}
            onCloseDropdown={handleCloseDropdown}
            isMuteLoading={muteLoadingFriendId === friend.id}
          />
        ))}
        
        {!friendsListExpanded && filteredFriends.length > 3 && (
          <TrackedTouchableOpacity logComponent="FriendsTab"
            onPress={() => setFriendsListExpanded(true)}
            style={styles.showMoreButton}
          >
            <Text style={styles.showMoreText}>
              Show {filteredFriends.length - 3} more friends
            </Text>
          </TrackedTouchableOpacity>
        )}
      </View>
        <View style={{ height: keyboardHeight > 0 ? keyboardHeight : insets.bottom }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
    paddingLeft: 48,
  },
  searchIcon: {
    position: 'absolute',
    left: 16,
    top: '50%',
    transform: [{ translateY: -10 }],
    zIndex: 1,
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
    position: 'relative',
  },
  actionButtonActive: {
    backgroundColor: '#eb7825',
    borderColor: '#eb7825',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 24,
    height: 24,
    backgroundColor: '#ef4444',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'white',
  },
  badgeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  qrCodeContainer: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 16,
  },
  qrCode: {
    width: 192,
    height: 192,
    backgroundColor: '#f3f4f6',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 160,
    height: 160,
    gap: 2,
  },
  qrDot: {
    width: 8,
    height: 8,
    borderRadius: 2,
  },
  qrTextContainer: {
    alignItems: 'center',
    gap: 8,
  },
  qrTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  qrSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
  },
  friendsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  friendsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  expandButton: {
    padding: 4,
  },
  onlineShowcase: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 16,
    padding: 16,
  },
  onlineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  onlineIndicator: {
    width: 12,
    height: 12,
    backgroundColor: '#10b981',
    borderRadius: 6,
  },
  onlineText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#166534',
  },
  onlineAvatars: {
    flexDirection: 'row',
    gap: 8,
    marginLeft: -8,
  },
  onlineAvatarContainer: {
    position: 'relative',
  },
  onlineAvatar: {
    width: 48,
    height: 48,
    backgroundColor: '#3b82f6',
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'white',
  },
  onlineAvatarText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  onlineStatusDot: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    backgroundColor: '#10b981',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'white',
  },
  moreAvatars: {
    width: 48,
    height: 48,
    backgroundColor: '#e5e7eb',
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'white',
  },
  moreAvatarsText: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '600',
  },
  friendsList: {
    gap: 12,
  },
  friendsListCollapsed: {
    maxHeight: 0,
    opacity: 0,
  },
  showMoreButton: {
    width: '100%',
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderStyle: 'dashed',
    borderRadius: 16,
    marginTop: 8,
  },
  showMoreText: {
    fontSize: 14,
    color: '#6b7280',
  },
});
