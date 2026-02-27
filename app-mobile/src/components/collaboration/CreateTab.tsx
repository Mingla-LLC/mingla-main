import React, { useState } from 'react';
import { Text, View, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { useAppStore } from '../../store/appStore';

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
  onNavigateToInvites?: () => void;
  onSessionCreated?: () => void; // Callback to reload sessions after creation
}

const CreateTab = ({ preSelectedFriend, availableFriends = [], onCreateSession, onNavigateToInvites, onSessionCreated }: CreateTabProps) => {
  const { user } = useAppStore();
  const [createStep, setCreateStep] = useState<'details' | 'friends' | 'confirm'>('details');
  const [newSessionName, setNewSessionName] = useState('');
  const [selectedFriends, setSelectedFriends] = useState<Friend[]>(
    preSelectedFriend ? [preSelectedFriend] : []
  );
  const [isCreating, setIsCreating] = useState(false);

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
      borderColor: '#eb7825',
      borderRadius: 12,
      fontSize: 16,
      backgroundColor: 'white',
    },
    helperText: {
      fontSize: 14,
      color: '#6B7280',
      marginTop: 8,
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
      paddingVertical: 14,
      paddingHorizontal: 24,
      borderRadius: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    continueButtonDisabled: {
      backgroundColor: '#eb7825',
      opacity: 0.5,
    },
    continueButtonText: {
      color: '#FFFFFF',
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
      overflow: 'hidden',
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
      overflow: 'hidden',
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
      overflow: 'hidden',
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
    emptyStateContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 48,
      paddingHorizontal: 24,
    },
    emptyStateTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: '#111827',
      marginTop: 16,
      marginBottom: 8,
    },
    emptyStateText: {
      fontSize: 14,
      color: '#6B7280',
      textAlign: 'center',
      marginBottom: 24,
    },
    emptyStateButton: {
      backgroundColor: '#eb7825',
      paddingVertical: 12,
      paddingHorizontal: 24,
      borderRadius: 12,
    },
    emptyStateButtonText: {
      color: '#FFFFFF',
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

  const handleCreateSession = async () => {
    if (!newSessionName.trim() || selectedFriends.length === 0) return;
    if (!user) {
      Alert.alert('Error', 'You must be logged in to create a session');
      return;
    }

    setIsCreating(true);
    try {
      // Check for real duplicate: any session where user is an accepted participant with this name
      const { data: participations } = await supabase
        .from('session_participants')
        .select('session_id, collaboration_sessions!inner(id, name)')
        .eq('user_id', user.id)
        .eq('has_accepted', true);

      const hasDuplicate = (participations || []).some((p: any) => {
        const s = Array.isArray(p.collaboration_sessions) ? p.collaboration_sessions[0] : p.collaboration_sessions;
        return s?.name?.toLowerCase() === newSessionName.trim().toLowerCase();
      });

      if (hasDuplicate) {
        Alert.alert('Session Already Exists', 'A collaboration session already exists with that name.');
        setIsCreating(false);
        return;
      }

      // Clean up any ghost sessions with this name (created by user but no participant record)
      const { data: ghostSessions } = await supabase
        .from('collaboration_sessions')
        .select('id')
        .eq('created_by', user.id)
        .ilike('name', newSessionName.trim());

      if (ghostSessions && ghostSessions.length > 0) {
        await supabase
          .from('collaboration_sessions')
          .delete()
          .in('id', ghostSessions.map((s: any) => s.id));
      }

      // Create the session in the database
      // Status starts as 'pending' until at least 2 members have accepted
      const { data: sessionData, error: sessionError } = await supabase
        .from('collaboration_sessions')
        .insert({
          name: newSessionName.trim(),
          created_by: user.id,
          status: 'pending',
        })
        .select()
        .single();

      if (sessionError) {
        console.error('Error creating session:', sessionError);
        Alert.alert('Error', `Failed to create session: ${sessionError.message}`);
        return;
      }

      // Add creator as participant (auto-accepted)
      const { error: creatorError } = await supabase
        .from('session_participants')
        .insert({
          session_id: sessionData.id,
          user_id: user.id,
          has_accepted: true,
          joined_at: new Date().toISOString(),
        });

      if (creatorError) {
        console.error('Error adding creator as participant:', creatorError);
        // Roll back the ghost session
        await supabase.from('collaboration_sessions').delete().eq('id', sessionData.id);
        Alert.alert('Error', 'Failed to add you as a participant');
        return;
      }

      // Add selected friends as participants (not accepted yet - they need to accept invites)
      for (const friend of selectedFriends) {
        // Get friend's user ID from their profile
        const friendUserId = friend.id; // This should be the friend's user ID

        // Get friend's email from their profile
        const { data: friendProfile } = await supabase
          .from('profiles')
          .select('email')
          .eq('id', friendUserId)
          .single();

        const friendEmail = friendProfile?.email;

        if (!friendEmail) {
          console.error(`No email found for friend ${friend.name} (${friendUserId})`);
          continue;
        }

        // Add as participant (not accepted yet)
        const { error: participantError } = await supabase
          .from('session_participants')
          .insert({
            session_id: sessionData.id,
            user_id: friendUserId,
            has_accepted: false,
          });

        if (participantError) {
          console.error(`Error adding friend ${friend.name} as participant:`, participantError);
          continue;
        }

        // Create invite for the friend
        const { data: inviteData, error: inviteError } = await supabase
          .from('collaboration_invites')
          .insert({
            session_id: sessionData.id,
            invited_by: user.id,
            invited_user_id: friendUserId,
            status: 'pending',
          })
          .select('id')
          .single();

        if (inviteError) {
          console.error(`Error creating invite for ${friend.name}:`, inviteError);
          continue;
        }

        // Send email and push notification via Edge Function
        try {
          const { data: emailData, error: emailError } =
            await supabase.functions.invoke('bright-responder', {
              body: {
                inviterId: user.id,
                invitedUserId: friendUserId,
                invitedUserEmail: friendEmail,
                sessionId: sessionData.id,
                sessionName: newSessionName.trim(),
                inviteId: inviteData.id,
              },
            });

          if (emailError) {
            console.error(`Error sending invite email to ${friend.name}:`, emailError);
          } else {
            console.log(`Invite email sent successfully to ${friend.name}:`, emailData);
          }
        } catch (emailErr: any) {
          console.error(`Failed to send invite email to ${friend.name}:`, emailErr);
          // Don't fail the whole process if email fails
        }
      }

      // Call the onCreateSession callback with the created session
      if (onCreateSession) {
        onCreateSession({
          id: sessionData.id,
          name: sessionData.name,
          status: sessionData.status,
          createdBy: sessionData.created_by,
          createdAt: sessionData.created_at,
        });
      }

      // Trigger session reload
      if (onSessionCreated) {
        onSessionCreated();
      }

      // Reset form
      setNewSessionName('');
      setSelectedFriends(preSelectedFriend ? [preSelectedFriend] : []);
      setCreateStep('details');
      
      Alert.alert('Success', 'Session created successfully!');
    } catch (error: any) {
      console.error('Error creating session:', error);
      Alert.alert('Error', error.message || 'Failed to create session');
    } finally {
      setIsCreating(false);
    }
  };

  const renderDetailsStep = () => (
    <View style={styles.stepContainer}>
      <View>
        <Text style={styles.title}>Create New Session</Text>
        <Text style={styles.subtitle}>
          Name your collaboration session
        </Text>
        
        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Session Name</Text>
          <TextInput
            value={newSessionName}
            onChangeText={setNewSessionName}
            placeholder="e.g., Weekend Plans, Date Night Ideas..."
            style={styles.textInput}
            placeholderTextColor="#9CA3AF"
          />
          <Text style={styles.helperText}>This will be visible to all participants</Text>
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
        <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
      </TouchableOpacity>
    </View>
  );

  const renderFriendsStep = () => {
    // Use real friends from database, only fallback to mock if absolutely no friends available
    const baseFriends = availableFriends.length > 0 ? availableFriends : [];
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
                    {friend.avatar ? (
                      <Image
                        source={{ uri: friend.avatar }}
                        style={{ width: 24, height: 24, borderRadius: 12 }}
                      />
                    ) : (
                      <Text style={styles.selectedFriendAvatarText}>
                        {friend.name[0]}
                      </Text>
                    )}
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

        {allFriends.length === 0 ? (
          <View style={styles.emptyStateContainer}>
            <Ionicons name="people-outline" size={48} color="#D1D5DB" />
            <Text style={styles.emptyStateTitle}>You have no friends</Text>
            <Text style={styles.emptyStateText}>
              Add friends to start collaborating on sessions together
            </Text>
            {onNavigateToInvites && (
              <TouchableOpacity
                onPress={onNavigateToInvites}
                style={styles.emptyStateButton}
              >
                <Text style={styles.emptyStateButtonText}>Go to Invites</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
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
                      {friend.avatar ? (
                        <Image
                          source={{ uri: friend.avatar }}
                          style={{ width: 40, height: 40, borderRadius: 20 }}
                        />
                      ) : (
                        <Text style={styles.friendAvatarText}>
                          {friend.name[0]}
                        </Text>
                      )}
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
        )}

        {allFriends.length > 0 && (
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
        )}
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
                  {friend.avatar ? (
                    <Image
                      source={{ uri: friend.avatar }}
                      style={{ width: 32, height: 32, borderRadius: 16 }}
                    />
                  ) : (
                    <Text style={styles.confirmFriendAvatarText}>
                      {friend.name[0]}
                    </Text>
                  )}
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
        style={[styles.sendInvitesButton, isCreating && styles.sendInvitesButtonDisabled]}
        disabled={isCreating}
      >
        {isCreating ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Text style={styles.sendInvitesButtonText}>Send Invites</Text>
        )}
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
