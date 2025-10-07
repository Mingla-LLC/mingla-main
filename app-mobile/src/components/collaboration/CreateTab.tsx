import React, { useState } from 'react';
import { Text, View, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Friend {
  id: string;
  name: string;
  username?: string;
  avatar?: string;
  status: 'online' | 'offline';
  lastActive?: string;
}

interface CreateTabProps {
  preSelectedFriend?: Friend | null;
  availableFriends?: Friend[];
  onCreateSession: (sessionData: any) => void;
}

const CreateTab = ({ preSelectedFriend, availableFriends = [], onCreateSession }: CreateTabProps) => {
  const [createStep, setCreateStep] = useState<'details' | 'friends' | 'confirm'>('details');
  const [newSessionName, setNewSessionName] = useState('');
  const [selectedFriends, setSelectedFriends] = useState<Friend[]>(
    preSelectedFriend ? [preSelectedFriend] : []
  );

  const styles = StyleSheet.create({
    container: {
      gap: 24,
    },
    stepContainer: {
      gap: 16,
    },
    title: {
      fontSize: 18,
      fontWeight: 'bold',
      color: '#111827',
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 14,
      color: '#6b7280',
      marginBottom: 16,
    },
    inputContainer: {
      marginBottom: 16,
    },
    inputLabel: {
      color: '#374151',
      fontWeight: '500',
      fontSize: 14,
      marginBottom: 8,
    },
    textInput: {
      width: '100%',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderWidth: 1,
      borderColor: '#e5e7eb',
      borderRadius: 12,
      fontSize: 16,
      backgroundColor: 'white',
    },
    preSelectedFriendCard: {
      backgroundColor: '#dbeafe',
      borderWidth: 1,
      borderColor: '#93c5fd',
      borderRadius: 12,
      padding: 16,
    },
    preSelectedFriendTitle: {
      fontWeight: '500',
      color: '#1e40af',
      marginBottom: 8,
    },
    preSelectedFriendContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    preSelectedFriendAvatar: {
      width: 32,
      height: 32,
      backgroundColor: '#3b82f6',
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    preSelectedFriendAvatarText: {
      color: 'white',
      fontSize: 14,
      fontWeight: '600',
    },
    preSelectedFriendName: {
      color: '#1e40af',
      fontWeight: '500',
      flex: 1,
    },
    removeButton: {
      width: 24,
      height: 24,
      backgroundColor: '#f3f4f6',
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    preSelectedFriendNote: {
      fontSize: 12,
      color: '#1e40af',
      marginTop: 8,
    },
    continueButton: {
      width: '100%',
      backgroundColor: '#eb7825',
      paddingVertical: 12,
      paddingHorizontal: 24,
      borderRadius: 12,
      alignItems: 'center',
    },
    continueButtonDisabled: {
      backgroundColor: '#9ca3af',
    },
    continueButtonText: {
      color: 'white',
      fontSize: 16,
      fontWeight: '600',
    },
    backButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 16,
    },
    backButtonIcon: {
      padding: 8,
      backgroundColor: '#f3f4f6',
      borderRadius: 20,
    },
    backButtonText: {
      fontSize: 18,
      fontWeight: 'bold',
      color: '#111827',
    },
    backButtonSubtext: {
      fontSize: 14,
      color: '#6b7280',
    },
    selectedFriendsCard: {
      backgroundColor: '#fef3e2',
      borderWidth: 1,
      borderColor: '#fed7aa',
      borderRadius: 12,
      padding: 16,
    },
    selectedFriendsTitle: {
      fontWeight: '500',
      color: '#111827',
      marginBottom: 12,
    },
    selectedFriendsList: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    selectedFriendTag: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: 'white',
      borderWidth: 1,
      borderColor: '#fed7aa',
      borderRadius: 20,
      paddingHorizontal: 12,
      paddingVertical: 4,
    },
    selectedFriendAvatar: {
      width: 24,
      height: 24,
      backgroundColor: '#3b82f6',
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    selectedFriendAvatarText: {
      color: 'white',
      fontSize: 12,
      fontWeight: '600',
    },
    selectedFriendName: {
      fontSize: 14,
      fontWeight: '500',
      color: '#111827',
    },
    removeFriendButton: {
      width: 16,
      height: 16,
      backgroundColor: '#f3f4f6',
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    friendsListTitle: {
      fontWeight: '500',
      color: '#111827',
      marginBottom: 8,
    },
    friendsList: {
      gap: 8,
    },
    friendItem: {
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 12,
      borderRadius: 12,
      borderWidth: 2,
    },
    friendItemSelected: {
      borderColor: '#eb7825',
      backgroundColor: '#fef3e2',
    },
    friendItemUnselected: {
      borderColor: '#e5e7eb',
      backgroundColor: 'white',
    },
    friendAvatar: {
      width: 40,
      height: 40,
      backgroundColor: '#3b82f6',
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    friendAvatarText: {
      color: 'white',
      fontWeight: '600',
      fontSize: 16,
    },
    friendInfo: {
      flex: 1,
    },
    friendName: {
      fontWeight: '500',
      color: '#111827',
      marginBottom: 2,
    },
    friendUsername: {
      fontSize: 14,
      color: '#6b7280',
    },
    preSelectedBadge: {
      fontSize: 12,
      backgroundColor: '#dbeafe',
      color: '#1e40af',
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 12,
    },
    checkmark: {
      width: 20,
      height: 20,
      color: '#eb7825',
    },
    confirmCard: {
      backgroundColor: 'white',
      borderWidth: 1,
      borderColor: '#e5e7eb',
      borderRadius: 16,
      padding: 24,
      gap: 16,
    },
    confirmSection: {
      gap: 4,
    },
    confirmLabel: {
      fontWeight: '600',
      color: '#111827',
      marginBottom: 4,
    },
    confirmValue: {
      color: '#6b7280',
    },
    confirmFriendsList: {
      gap: 8,
    },
    confirmFriendItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    confirmFriendAvatar: {
      width: 32,
      height: 32,
      backgroundColor: '#3b82f6',
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    confirmFriendAvatarText: {
      color: 'white',
      fontSize: 14,
      fontWeight: '600',
    },
    confirmFriendName: {
      fontWeight: '500',
      color: '#6b7280',
      flex: 1,
    },
    statusIndicator: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    statusOnline: {
      backgroundColor: '#10b981',
    },
    statusOffline: {
      backgroundColor: '#9ca3af',
    },
    infoCard: {
      backgroundColor: '#dbeafe',
      borderWidth: 1,
      borderColor: '#93c5fd',
      borderRadius: 12,
      padding: 16,
    },
    infoCardContent: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
    },
    infoCardIcon: {
      width: 20,
      height: 20,
      color: '#1d4ed8',
      marginTop: 2,
    },
    infoCardText: {
      flex: 1,
    },
    infoCardTitle: {
      fontWeight: '500',
      marginBottom: 4,
      color: '#1e40af',
    },
    infoCardDescription: {
      fontSize: 14,
      color: '#1e40af',
    },
    sendInvitesButton: {
      width: '100%',
      backgroundColor: '#eb7825',
      paddingVertical: 12,
      paddingHorizontal: 24,
      borderRadius: 12,
      alignItems: 'center',
    },
    sendInvitesButtonText: {
      color: 'white',
      fontSize: 16,
      fontWeight: '600',
    },
  });

  const mockFriends = [
    { id: '1', name: 'Sarah Chen', status: 'online' },
    { id: '2', name: 'Marcus Johnson', status: 'online' },
    { id: '3', name: 'Alex Rivera', status: 'offline', lastActive: '2h ago' },
    { id: '4', name: 'Jamie Park', status: 'online' },
    { id: '5', name: 'Taylor Kim', status: 'offline', lastActive: '1d ago' },
    { id: '6', name: 'Jordan Lee', status: 'online' }
  ];

  const toggleFriendSelection = (friend: Friend) => {
    setSelectedFriends(prev => {
      const isSelected = prev.some(f => f.id === friend.id);
      if (isSelected) {
        return prev.filter(f => f.id !== friend.id);
      } else {
        return [...prev, friend];
      }
    });
  };

  const handleCreateSession = () => {
    if (!newSessionName.trim() || selectedFriends.length === 0) return;
    
    const newSession = {
      id: `board-${Date.now()}`,
      name: newSessionName,
      type: 'group-hangout',
      description: `Collaborative session with ${selectedFriends.map(f => f.name).join(', ')}`,
      participants: [
        { id: 'you', name: 'You', status: 'online' },
        ...selectedFriends.map(friend => ({
          id: friend.id,
          name: friend.name,
          status: friend.status || 'offline'
        }))
      ],
      status: 'active',
      cardsCount: 0,
      createdAt: 'Just now',
      unreadMessages: 0,
      lastActivity: 'Just now',
      icon: 'Users',
      gradient: 'from-blue-500 to-indigo-500',
      creatorId: 'you',
      admins: ['you'],
      currentUserId: 'you'
    };
    
    onCreateSession(newSession);
  };

  const renderDetailsStep = () => (
    <View style={styles.stepContainer}>
      <View>
        <Text style={styles.title}>Session Details</Text>
        <Text style={styles.subtitle}>
          Give your collaboration session a memorable name
        </Text>
        
        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Session Name</Text>
          <TextInput
            value={newSessionName}
            onChangeText={setNewSessionName}
            placeholder="e.g., Weekend Adventure Squad"
            style={styles.textInput}
          />
        </View>
      </View>

      {preSelectedFriend && (
        <View style={styles.preSelectedFriendCard}>
          <Text style={styles.preSelectedFriendTitle}>Pre-selected Friend</Text>
          <View style={styles.preSelectedFriendContent}>
            <View style={styles.preSelectedFriendAvatar}>
              <Text style={styles.preSelectedFriendAvatarText}>
                {preSelectedFriend.name[0]}
              </Text>
            </View>
            <Text style={styles.preSelectedFriendName}>{preSelectedFriend.name}</Text>
            <TouchableOpacity 
              onPress={() => {
                setSelectedFriends(prev => prev.filter(f => f.id !== preSelectedFriend.id));
              }}
              style={styles.removeButton}
            >
              <Ionicons name="close" size={16} color="#6b7280" />
            </TouchableOpacity>
          </View>
          <Text style={styles.preSelectedFriendNote}>
            You can remove this friend or add more friends in the next step
          </Text>
        </View>
      )}

      <TouchableOpacity
        onPress={() => setCreateStep('friends')}
        disabled={!newSessionName.trim()}
        style={[
          styles.continueButton,
          !newSessionName.trim() && styles.continueButtonDisabled
        ]}
      >
        <Text style={styles.continueButtonText}>Continue</Text>
      </TouchableOpacity>
    </View>
  );

  const renderFriendsStep = () => {
    const baseFriends = availableFriends.length > 0 ? availableFriends : mockFriends;
    const allFriends = [...baseFriends];
    
    if (preSelectedFriend && !baseFriends.some(f => f.id === preSelectedFriend.id)) {
      allFriends.unshift(preSelectedFriend);
    }

    return (
      <View style={styles.stepContainer}>
        <View style={styles.backButton}>
          <TouchableOpacity 
            onPress={() => setCreateStep('details')}
            style={styles.backButtonIcon}
          >
            <Ionicons name="chevron-back" size={20} color="#6b7280" />
          </TouchableOpacity>
          <View>
            <Text style={styles.backButtonText}>Select Friends</Text>
            <Text style={styles.backButtonSubtext}>
              Choose friends to invite to "{newSessionName}"
              {preSelectedFriend && " • You can modify your selection below"}
            </Text>
          </View>
        </View>

        {selectedFriends.length > 0 && (
          <View style={styles.selectedFriendsCard}>
            <Text style={styles.selectedFriendsTitle}>
              Selected Friends ({selectedFriends.length})
            </Text>
            <View style={styles.selectedFriendsList}>
              {selectedFriends.map((friend) => (
                <View key={friend.id} style={styles.selectedFriendTag}>
                  <View style={styles.selectedFriendAvatar}>
                    <Text style={styles.selectedFriendAvatarText}>
                      {friend.name[0]}
                    </Text>
                  </View>
                  <Text style={styles.selectedFriendName}>{friend.name}</Text>
                  <TouchableOpacity 
                    onPress={() => toggleFriendSelection(friend)}
                    style={styles.removeFriendButton}
                  >
                    <Ionicons name="close" size={12} color="#6b7280" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>
        )}

        <View>
          <Text style={styles.friendsListTitle}>Available Friends</Text>
          <View style={styles.friendsList}>
            {allFriends.map((friend) => {
              const isSelected = selectedFriends.some(f => f.id === friend.id);
              const isPreSelected = preSelectedFriend?.id === friend.id;
              return (
                <TouchableOpacity
                  key={friend.id}
                  onPress={() => toggleFriendSelection(friend)}
                  style={[
                    styles.friendItem,
                    isSelected ? styles.friendItemSelected : styles.friendItemUnselected
                  ]}
                >
                  <View style={styles.friendAvatar}>
                    <Text style={styles.friendAvatarText}>
                      {friend.name[0]}
                    </Text>
                  </View>
                  <View style={styles.friendInfo}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={styles.friendName}>{friend.name}</Text>
                      {isPreSelected && (
                        <Text style={styles.preSelectedBadge}>Pre-selected</Text>
                      )}
                    </View>
                    <Text style={styles.friendUsername}>
                      @{(friend.username || friend.name.toLowerCase().replace(' ', ''))}
                    </Text>
                  </View>
                  {isSelected && (
                    <Ionicons name="checkmark" size={20} color="#eb7825" />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <TouchableOpacity
          onPress={() => setCreateStep('confirm')}
          disabled={selectedFriends.length === 0}
          style={[
            styles.continueButton,
            selectedFriends.length === 0 && styles.continueButtonDisabled
          ]}
        >
          <Text style={styles.continueButtonText}>
            Continue ({selectedFriends.length} selected)
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderConfirmStep = () => (
    <View style={styles.stepContainer}>
      <View style={styles.backButton}>
        <TouchableOpacity 
          onPress={() => setCreateStep('friends')}
          style={styles.backButtonIcon}
        >
          <Ionicons name="chevron-back" size={20} color="#6b7280" />
        </TouchableOpacity>
        <View>
          <Text style={styles.backButtonText}>Confirm & Send</Text>
          <Text style={styles.backButtonSubtext}>
            Review your collaboration session details
          </Text>
        </View>
      </View>

      <View style={styles.confirmCard}>
        <View style={styles.confirmSection}>
          <Text style={styles.confirmLabel}>Session Name</Text>
          <Text style={styles.confirmValue}>{newSessionName}</Text>
        </View>

        <View style={styles.confirmSection}>
          <Text style={styles.confirmLabel}>
            Inviting {selectedFriends.length} friend{selectedFriends.length !== 1 ? 's' : ''}
          </Text>
          <View style={styles.confirmFriendsList}>
            {selectedFriends.map((friend) => (
              <View key={friend.id} style={styles.confirmFriendItem}>
                <View style={styles.confirmFriendAvatar}>
                  <Text style={styles.confirmFriendAvatarText}>
                    {friend.name[0]}
                  </Text>
                </View>
                <Text style={styles.confirmFriendName}>{friend.name}</Text>
                <View style={[
                  styles.statusIndicator,
                  friend.status === 'online' ? styles.statusOnline : styles.statusOffline
                ]} />
              </View>
            ))}
          </View>
        </View>
      </View>

      <View style={styles.infoCard}>
        <View style={styles.infoCardContent}>
          <Ionicons name="alert-circle" size={20} color="#1d4ed8" />
          <View style={styles.infoCardText}>
            <Text style={styles.infoCardTitle}>Next Steps</Text>
            <Text style={styles.infoCardDescription}>
              Once all friends accept, you'll need to set collaboration preferences together before you can start swiping.
            </Text>
          </View>
        </View>
      </View>

      <TouchableOpacity
        onPress={handleCreateSession}
        style={styles.sendInvitesButton}
      >
        <Text style={styles.sendInvitesButtonText}>Send Invites</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      {createStep === 'details' && renderDetailsStep()}
      {createStep === 'friends' && renderFriendsStep()}
      {createStep === 'confirm' && renderConfirmStep()}
    </View>
  );
};

export default CreateTab;
