import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSessionManagement } from '../hooks/useSessionManagement';
import { useNavigation } from '../contexts/NavigationContext';
import { useAppStore } from '../store/appStore';
import { useFriends } from '../hooks/useFriends';
import { supabase } from '../services/supabase';
import { BoardInviteService } from '../services/boardInviteService';
import { realtimeService } from '../services/realtimeService';
import { BoardPreferencesForm, BoardPreferences } from './board/BoardPreferencesForm';
import { InviteMethodSelector, InviteMethod } from './board/InviteMethodSelector';
import { InviteLinkShare } from './board/InviteLinkShare';
import { QRCodeDisplay } from './board/QRCodeDisplay';
import { InviteCodeDisplay } from './board/InviteCodeDisplay';
import FriendSelectionModal from './FriendSelectionModal';

type SessionType = 'board' | 'collaboration';
type Step = 'type' | 'basic' | 'friends' | 'preferences' | 'invite' | 'review' | 'success';

interface SelectedFriend {
  id: string;
  name: string;
  username: string;
  avatar?: string;
  avatar_url?: string;
}

export const CreateSessionModal: React.FC = () => {
  // Step management
  const [currentStep, setCurrentStep] = useState<Step>('type');
  const [sessionType, setSessionType] = useState<SessionType | null>(null);
  
  // Basic info
  const [sessionName, setSessionName] = useState('');
  const [maxParticipants, setMaxParticipants] = useState<string>('');
  
  // Friends
  const [selectedFriends, setSelectedFriends] = useState<SelectedFriend[]>([]);
  const [showFriendModal, setShowFriendModal] = useState(false);
  const { friends, fetchFriends } = useFriends();
  
  // Preferences
  const [preferences, setPreferences] = useState<BoardPreferences | null>(null);
  
  // Invite method
  const [inviteMethod, setInviteMethod] = useState<InviteMethod>(null);
  
  // Creation state
  const [loading, setLoading] = useState(false);
  const [createdSessionId, setCreatedSessionId] = useState<string | null>(null);
  const [inviteLinkData, setInviteLinkData] = useState<{ inviteCode: string; inviteLink: string } | null>(null);
  
  const { createCollaborativeSession } = useSessionManagement();
  const { isCreateSessionModalOpen, closeCreateSessionModal } = useNavigation();
  const { user } = useAppStore();
  const insets = useSafeAreaInsets();

  // Load friends on mount
  useEffect(() => {
    if (isCreateSessionModalOpen && currentStep === 'friends') {
      fetchFriends();
    }
  }, [isCreateSessionModalOpen, currentStep, fetchFriends]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isCreateSessionModalOpen) {
      resetState();
    }
  }, [isCreateSessionModalOpen]);

  const resetState = () => {
    setCurrentStep('type');
    setSessionType(null);
    setSessionName('');
    setMaxParticipants('');
    setSelectedFriends([]);
    setPreferences(null);
    setInviteMethod(null);
    setCreatedSessionId(null);
    setInviteLinkData(null);
  };

  const handleSelectSessionType = (type: SessionType) => {
    setSessionType(type);
    setCurrentStep('basic');
  };

  const handleNext = () => {
    if (currentStep === 'basic') {
      if (!sessionName.trim()) {
        Alert.alert('Error', 'Please enter a session name');
        return;
      }

      setCurrentStep('friends');
    } else if (currentStep === 'friends') {
      if (sessionType === 'collaboration' && selectedFriends.length === 0) {
        Alert.alert(
          'Add a collaborator',
          'Please add at least one friend as a collaborator before continuing. This is for safety purposes.'
        );
        return;
      }

      if (sessionType === 'board') {
        setCurrentStep('preferences');
      } else {
        setCurrentStep('invite');
      }
    } else if (currentStep === 'preferences') {
      setCurrentStep('invite');
    } else if (currentStep === 'invite') {
      if (!inviteMethod) {
        Alert.alert('Error', 'Please select an invite method');
        return;
      }
      setCurrentStep('review');
    } else if (currentStep === 'review') {
      handleCreateSession();
    }
  };

  const handleBack = () => {
    if (currentStep === 'basic') {
      setCurrentStep('type');
    } else if (currentStep === 'friends') {
      setCurrentStep('basic');
    } else if (currentStep === 'preferences') {
      setCurrentStep('friends');
    } else if (currentStep === 'invite') {
      if (sessionType === 'board') {
        setCurrentStep('preferences');
      } else {
        setCurrentStep('friends');
      }
    } else if (currentStep === 'review') {
      setCurrentStep('invite');
    }
  };

  const handleCreateSession = async () => {
    if (!user) {
      Alert.alert('Error', 'You must be logged in');
      return;
    }

    if (sessionType === 'collaboration' && selectedFriends.length === 0) {
      Alert.alert(
        'Add a collaborator',
        'Please add at least one friend as a collaborator before creating this session. This is for safety purposes.'
      );
      return;
    }

    setLoading(true);
    try {
      let sessionId: string | null = null;

      if (sessionType === 'board') {
        // Create board session
        // Status starts as 'pending' until at least 2 members have accepted
        const { data: sessionData, error: sessionError } = await supabase
          .from('collaboration_sessions')
          .insert({
            name: sessionName.trim(),
            created_by: user.id,
            session_type: 'board',
            status: 'pending',
            is_active: true,
            max_participants: maxParticipants ? parseInt(maxParticipants) : null,
            last_activity_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (sessionError) throw sessionError;
        sessionId = sessionData.id;

        // Save preferences
        if (preferences) {
          await supabase
            .from('board_session_preferences')
            .insert({
              session_id: sessionId,
              categories: preferences.categories || [],
              budget_min: preferences.budgetMin,
              budget_max: preferences.budgetMax,
              // Note: group_size column doesn't exist in board_session_preferences table
              // Group size is determined by the number of participants in the session
              experience_types: preferences.experienceTypes || [],
            });
        }

        // Add creator as participant
        await supabase
          .from('session_participants')
          .insert({
            session_id: sessionId,
            user_id: user.id,
            has_accepted: true,
            joined_at: new Date().toISOString(),
          });

        // Send friend invites if selected
        if (selectedFriends.length > 0 && inviteMethod === 'friends_list') {
          const friendIds = selectedFriends.map(f => f.id);
          await BoardInviteService.sendFriendInvites(sessionId, friendIds, user.id);
        }

        // Get invite link data
        const linkData = await BoardInviteService.generateInviteLink(sessionId);
        if (linkData) {
          setInviteLinkData({
            inviteCode: linkData.inviteCode,
            inviteLink: linkData.inviteLink,
          });
        }

        // Update presence for the creator
        if (user) {
          await realtimeService.markOnline(sessionId, user.id);
        }
      } else {
        // Create regular collaboration session
        const participantUsernames = selectedFriends.map(f => f.username);
        sessionId = await createCollaborativeSession(participantUsernames, sessionName.trim());
      }

      if (sessionId) {
        setCreatedSessionId(sessionId);
        setCurrentStep('success');
      } else {
        throw new Error('Failed to create session');
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to create session');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectFriend = (friend: any) => {
    const isSelected = selectedFriends.some(f => f.id === friend.id);
    if (isSelected) {
      setSelectedFriends(selectedFriends.filter(f => f.id !== friend.id));
    } else {
      setSelectedFriends([
        ...selectedFriends,
        {
          id: friend.id,
          name: friend.name || friend.display_name || friend.username,
          username: friend.username,
          avatar: friend.avatar,
          avatar_url: friend.avatar_url || friend.avatar,
        },
      ]);
    }
    setShowFriendModal(false);
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 'type':
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepTitle}>Choose Session Type</Text>
            <Text style={styles.stepDescription}>
              Select the type of session you want to create
            </Text>
            
            <TouchableOpacity
              style={[styles.typeCard, sessionType === 'board' && styles.typeCardSelected]}
              onPress={() => handleSelectSessionType('board')}
            >
              <Ionicons name="grid" size={32} color={sessionType === 'board' ? '#007AFF' : '#666'} />
              <Text style={[styles.typeTitle, sessionType === 'board' && styles.typeTitleSelected]}>
                Board Session
              </Text>
              <Text style={styles.typeDescription}>
                Plan experiences together with real-time collaboration, voting, and discussion
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.typeCard, sessionType === 'collaboration' && styles.typeCardSelected]}
              onPress={() => handleSelectSessionType('collaboration')}
            >
              <Ionicons name="people" size={32} color={sessionType === 'collaboration' ? '#007AFF' : '#666'} />
              <Text style={[styles.typeTitle, sessionType === 'collaboration' && styles.typeTitleSelected]}>
                Collaboration Session
              </Text>
              <Text style={styles.typeDescription}>
                Simple collaboration session for planning together
              </Text>
            </TouchableOpacity>
          </View>
        );

      case 'basic':
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepTitle}>Session Details</Text>
            
            <View style={styles.section}>
              <Text style={styles.label}>Session Name</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter session name"
                value={sessionName}
                onChangeText={setSessionName}
                maxLength={50}
              />
            </View>

            {sessionType === 'board' && (
              <View style={styles.section}>
                <Text style={styles.label}>Max Participants (Optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Leave empty for unlimited"
                  value={maxParticipants}
                  onChangeText={setMaxParticipants}
                  keyboardType="numeric"
                />
              </View>
            )}
          </View>
        );

      case 'friends':
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepTitle}>Invite Friends</Text>
            <Text style={styles.stepDescription}>
              {sessionType === 'board'
                ? 'Select friends to invite to your board session'
                : 'Select at least one friend to add as a collaborator. This is required for safety.'}
            </Text>

            <TouchableOpacity
              style={styles.friendButton}
              onPress={() => setShowFriendModal(true)}
            >
              <Ionicons name="person-add" size={20} color="#007AFF" />
              <Text style={styles.friendButtonText}>Select Friends</Text>
            </TouchableOpacity>

            {selectedFriends.length > 0 && (
              <View style={styles.selectedFriendsContainer}>
                {selectedFriends.map((friend) => (
                  <View key={friend.id} style={styles.selectedFriendItem}>
                    <View style={styles.selectedFriendAvatar}>
                      {friend.avatar || friend.avatar_url ? (
                        <Image
                          source={{ uri: friend.avatar || friend.avatar_url }}
                          style={styles.selectedFriendAvatarImage}
                        />
                      ) : (
                        <View style={styles.selectedFriendAvatarPlaceholder}>
                          <Text style={styles.selectedFriendAvatarText}>
                            {friend.name.split(' ').map(n => n[0]).join('')}
                          </Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.selectedFriendInfo}>
                      <Text style={styles.selectedFriendText}>{friend.name}</Text>
                      <Text style={styles.selectedFriendUsername}>@{friend.username}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => setSelectedFriends(selectedFriends.filter(f => f.id !== friend.id))}
                      style={styles.selectedFriendRemove}
                    >
                      <Ionicons name="close-circle" size={20} color="#FF3B30" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>
        );

      case 'preferences':
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepTitle}>Board Preferences</Text>
            <Text style={styles.stepDescription}>
              Set preferences for the types of experiences you want to explore
            </Text>
            <BoardPreferencesForm
              initialPreferences={preferences || undefined}
              onPreferencesChange={setPreferences}
            />
          </View>
        );

      case 'invite':
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepTitle}>Invite Method</Text>
            <Text style={styles.stepDescription}>
              Choose how you want to invite people to join
            </Text>
            <InviteMethodSelector
              selectedMethod={inviteMethod}
              onMethodSelect={setInviteMethod}
              availableMethods={selectedFriends.length > 0 ? ['friends_list', 'link', 'qr_code', 'invite_code'] : ['link', 'qr_code', 'invite_code']}
            />
          </View>
        );

      case 'review':
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepTitle}>Review & Create</Text>
            
            <View style={styles.reviewCard}>
              <Text style={styles.reviewLabel}>Session Name</Text>
              <Text style={styles.reviewValue}>{sessionName}</Text>
            </View>

            {sessionType === 'board' && (
              <>
                {selectedFriends.length > 0 && (
                  <View style={styles.reviewCard}>
                    <Text style={styles.reviewLabel}>Friends Invited</Text>
                    <Text style={styles.reviewValue}>{selectedFriends.length} friend(s)</Text>
                  </View>
                )}
                
                {preferences && (
                  <View style={styles.reviewCard}>
                    <Text style={styles.reviewLabel}>Preferences</Text>
                    <Text style={styles.reviewValue}>
                      {preferences.categories?.length || 0} categories, Group size: {preferences.groupSize || 2}
                    </Text>
                  </View>
                )}
              </>
            )}

            <View style={styles.reviewCard}>
              <Text style={styles.reviewLabel}>Invite Method</Text>
              <Text style={styles.reviewValue}>
                {inviteMethod === 'friends_list' ? 'Friends List' :
                 inviteMethod === 'link' ? 'Share Link' :
                 inviteMethod === 'qr_code' ? 'QR Code' :
                 inviteMethod === 'invite_code' ? 'Invite Code' : 'None'}
              </Text>
            </View>
          </View>
        );

      case 'success':
        return (
          <View style={styles.stepContainer}>
            <View style={styles.successContainer}>
              <Ionicons name="checkmark-circle" size={64} color="#34C759" />
              <Text style={styles.successTitle}>Session Created!</Text>
              <Text style={styles.successDescription}>
                Your {sessionType === 'board' ? 'board' : 'collaboration'} session has been created successfully.
              </Text>
            </View>

            {inviteLinkData && (
              <View style={styles.inviteOptionsContainer}>
                <InviteLinkShare
                  inviteLink={inviteLinkData.inviteLink}
                  inviteCode={inviteLinkData.inviteCode}
                />
                
                <View style={styles.qrSection}>
                  <Text style={styles.sectionTitle}>QR Code</Text>
                  <QRCodeDisplay data={inviteLinkData.inviteLink} />
                </View>

                <View style={styles.codeSection}>
                  <InviteCodeDisplay inviteCode={inviteLinkData.inviteCode} />
                </View>
              </View>
            )}
          </View>
        );

      default:
        return null;
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 'type':
        return sessionType !== null;
      case 'basic':
        return sessionName.trim().length > 0;
      case 'friends':
        if (sessionType === 'collaboration') {
          return selectedFriends.length > 0;
        }
        return true; // Friends are optional for board sessions
      case 'preferences':
        return true; // Preferences are optional
      case 'invite':
        return inviteMethod !== null;
      case 'review':
        if (sessionType === 'collaboration') {
          return selectedFriends.length > 0;
        }
        return true;
      case 'success':
        return false;
      default:
        return false;
    }
  };

  const getStepTitle = () => {
    switch (currentStep) {
      case 'type': return 'Create Session';
      case 'basic': return 'Session Details';
      case 'friends': return 'Invite Friends';
      case 'preferences': return 'Preferences';
      case 'invite': return 'Invite Method';
      case 'review': return 'Review';
      case 'success': return 'Success';
      default: return 'Create Session';
    }
  };

  return (
    <Modal
      visible={isCreateSessionModalOpen}
      animationType="slide"
      transparent
      onRequestClose={closeCreateSessionModal}
      statusBarTranslucent
    >
      <View style={styles.sheetOverlay}>
        {/* Tap backdrop to close */}
        <TouchableOpacity
          style={styles.backdropTouch}
          activeOpacity={1}
          onPress={closeCreateSessionModal}
        />

        <View style={[styles.sheetContent, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          {/* Drag Handle */}
          <View style={styles.dragHandleContainer}>
            <View style={styles.dragHandle} />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerSide}>
              {currentStep !== 'type' && currentStep !== 'success' ? (
                <TouchableOpacity onPress={handleBack} style={styles.iconButton}>
                  <Ionicons name="arrow-back" size={22} color="#6B7280" />
                </TouchableOpacity>
              ) : (
                <View style={styles.iconButton} />
              )}
            </View>
            <Text style={styles.title}>{getStepTitle()}</Text>
            <View style={styles.headerSide} />
          </View>

          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            {renderStepContent()}
          </ScrollView>

          {currentStep !== 'success' && (
            <View style={styles.footer}>
              <TouchableOpacity
                style={[
                  styles.nextButton,
                  (!canProceed() || loading) && styles.nextButtonDisabled
                ]}
                onPress={handleNext}
                disabled={!canProceed() || loading}
              >
                {loading ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.nextButtonText}>
                    {currentStep === 'review' ? 'Create Session' : 'Next'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {currentStep === 'success' && (
            <View style={styles.footer}>
              <TouchableOpacity
                style={styles.doneButton}
                onPress={closeCreateSessionModal}
              >
                <Text style={styles.doneButtonText}>Done</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      <FriendSelectionModal
        isOpen={showFriendModal}
        onClose={() => setShowFriendModal(false)}
        onSelectFriend={handleSelectFriend}
        friends={friends.map(f => ({
          id: f.friend_user_id,
          name: f.display_name || f.username,
          username: f.username,
          avatar: f.avatar_url,
          isOnline: false,
        }))}
      />
    </Modal>
  );
};

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.88;

const styles = StyleSheet.create({
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    justifyContent: 'flex-end',
  },
  backdropTouch: {
    flex: 1,
  },
  sheetContent: {
    height: SHEET_HEIGHT,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -12 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 30,
  },
  dragHandleContainer: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 4,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  headerSide: {
    width: 36,
    alignItems: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e293b',
    flex: 1,
    textAlign: 'center',
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    backgroundColor: '#f8f9fa',
  },
  stepContainer: {
    paddingVertical: 24,
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  stepDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  input: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e1e5e9',
  },
  typeCard: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 24,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#e1e5e9',
    alignItems: 'center',
  },
  typeCardSelected: {
    borderColor: '#eb7825',
    backgroundColor: '#FFF7F0',
  },
  typeTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1a1a1a',
    marginTop: 12,
    marginBottom: 8,
  },
  typeTitleSelected: {
    color: '#eb7825',
  },
  typeDescription: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  friendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#eb7825',
    gap: 8,
    marginBottom: 16,
  },
  friendButtonText: {
    fontSize: 16,
    color: '#eb7825',
    fontWeight: '600',
  },
  selectedFriendsContainer: {
    gap: 8,
  },
  selectedFriendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  selectedFriendAvatar: {
    position: 'relative',
    flexShrink: 0,
  },
  selectedFriendAvatarImage: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
  selectedFriendAvatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#eb7825',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedFriendAvatarText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 13,
  },
  selectedFriendInfo: {
    flex: 1,
    minWidth: 0,
  },
  selectedFriendText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
  },
  selectedFriendUsername: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  selectedFriendRemove: {
    padding: 4,
    flexShrink: 0,
  },
  reviewCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e1e5e9',
  },
  reviewLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  reviewValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  successContainer: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1a1a1a',
    marginTop: 16,
    marginBottom: 8,
  },
  successDescription: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  inviteOptionsContainer: {
    marginTop: 32,
  },
  qrSection: {
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 16,
    textAlign: 'center',
  },
  codeSection: {
    marginTop: 24,
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    backgroundColor: '#FFFFFF',
  },
  nextButton: {
    backgroundColor: '#eb7825',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  nextButtonDisabled: {
    backgroundColor: '#D1D5DB',
  },
  nextButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  doneButton: {
    backgroundColor: '#eb7825',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  doneButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
