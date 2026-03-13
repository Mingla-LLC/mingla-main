import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Alert,
  ActivityIndicator,
  Image,
  Dimensions,
  Share,
} from 'react-native';
import { KeyboardAwareScrollView } from './ui/KeyboardAwareScrollView';
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
import { PhoneInput } from './onboarding/PhoneInput';
import { usePhoneLookup, useDebouncedValue } from '../hooks/usePhoneLookup';
import { createPendingInvite, createPendingSessionInvite } from '../services/phoneLookupService';
import { getCountryByCode, getDefaultCountryCode } from '../constants/countries';
import { colors } from '../constants/designSystem';

type SessionType = 'board' | 'collaboration';
type Step = 'type' | 'basic' | 'friends' | 'preferences' | 'invite' | 'review' | 'success';

interface SelectedFriend {
  id: string;
  name: string;
  username: string;
  avatar?: string;
  avatar_url?: string;
}

// Props for the embeddable CreateSessionContent component
export interface CreateSessionContentProps {
  preSelectedFriend?: {
    id: string;
    name: string;
    username?: string;
    avatar?: string;
  } | null;
  onCreateSession?: (sessionData: {
    id: string;
    name: string;
    status: string;
    createdBy: string;
    createdAt: string;
  }) => void;
  onNavigateToInvites?: () => void;
  isEmbedded?: boolean;
}

/**
 * CreateSessionContent — the core session creation UI.
 *
 * When isEmbedded=true (used inside CollaborationModule's Create tab):
 *   - No Modal/backdrop/drag handle wrapper
 *   - No KeyboardAwareScrollView (parent provides ScrollView)
 *   - Auto-selects "collaboration" session type
 *   - Skips type/preferences/invite steps → flow: basic → friends → review → success
 *   - Accepts preSelectedFriend, onCreateSession, onNavigateToInvites props
 *
 * When isEmbedded=false (standalone modal, preserved for future use):
 *   - Full Modal with backdrop, drag handle, KeyboardAwareScrollView
 *   - All steps available: type → basic → friends → preferences → invite → review → success
 *   - Controlled by NavigationContext (isCreateSessionModalOpen)
 */
export const CreateSessionContent: React.FC<CreateSessionContentProps> = ({
  preSelectedFriend,
  onCreateSession,
  onNavigateToInvites,
  isEmbedded = false,
}) => {
  // Step management — embedded mode starts at 'basic' with collaboration auto-selected
  const [currentStep, setCurrentStep] = useState<Step>(isEmbedded ? 'basic' : 'type');
  const [sessionType, setSessionType] = useState<SessionType | null>(isEmbedded ? 'collaboration' : null);

  // Basic info
  const [sessionName, setSessionName] = useState('');
  const [maxParticipants, setMaxParticipants] = useState<string>('');

  // Friends — pre-populate with preSelectedFriend if provided
  const [selectedFriends, setSelectedFriends] = useState<SelectedFriend[]>(
    preSelectedFriend
      ? [{
          id: preSelectedFriend.id,
          name: preSelectedFriend.name,
          username: preSelectedFriend.username || '',
          avatar_url: preSelectedFriend.avatar,
        }]
      : []
  );

  // H5 FIX: Sync selectedFriends when preSelectedFriend prop changes.
  // useState initializer only runs once — if the parent re-renders with a different
  // friend, this effect updates the selection to match.
  useEffect(() => {
    if (preSelectedFriend) {
      setSelectedFriends(prev => {
        const alreadySelected = prev.some(f => f.id === preSelectedFriend.id);
        if (alreadySelected) return prev;
        return [{
          id: preSelectedFriend.id,
          name: preSelectedFriend.name,
          username: preSelectedFriend.username || '',
          avatar_url: preSelectedFriend.avatar,
        }];
      });
    }
  }, [preSelectedFriend?.id]);

  const [showFriendModal, setShowFriendModal] = useState(false);
  const { friends, fetchFriends, addFriend } = useFriends();

  // Preferences (board sessions only — not used in embedded/collaboration mode)
  const [preferences, setPreferences] = useState<BoardPreferences | null>(null);

  // Invite method — embedded mode auto-selects friends_list
  const [inviteMethod, setInviteMethod] = useState<InviteMethod>(isEmbedded ? 'friends_list' : null);

  // Creation state
  const [loading, setLoading] = useState(false);
  const [inviteLinkData, setInviteLinkData] = useState<{ inviteCode: string; inviteLink: string } | null>(null);

  // Phone lookup state
  const [phoneDigits, setPhoneDigits] = useState('');
  const [phoneCountry, setPhoneCountry] = useState(getDefaultCountryCode());
  const [phoneInvitees, setPhoneInvitees] = useState<Array<{ type: 'phone'; phoneE164: string; displayName: string }>>([]);
  const [phoneInviteLoading, setPhoneInviteLoading] = useState(false);

  // Referral code for share links
  const [referralCode, setReferralCode] = useState<string | null>(null);

  // Build E.164 phone
  const phoneCountryData = getCountryByCode(phoneCountry);
  const phoneRawDigits = phoneDigits.replace(/\D/g, '');
  const phoneE164 = phoneCountryData ? phoneCountryData.dialCode + phoneRawDigits : '+1' + phoneRawDigits;
  const debouncedPhoneE164 = useDebouncedValue(phoneE164, 500);
  const debouncedPhoneDigitCount = useDebouncedValue(phoneRawDigits.length, 500);

  // Phone lookup — enabled uses debounced digit count to stay in sync with debounced phone
  const {
    data: phoneLookupResult,
    isLoading: phoneLookupLoading,
    error: phoneLookupError,
  } = usePhoneLookup(debouncedPhoneE164, debouncedPhoneDigitCount >= 7);

  const { createCollaborativeSession } = useSessionManagement();
  const { user } = useAppStore();

  // Load friends when reaching friends step
  useEffect(() => {
    if (currentStep === 'friends') {
      fetchFriends();
    }
  }, [currentStep, fetchFriends]);

  // Fetch referral code for share links
  useEffect(() => {
    if (user) {
      supabase
        .from('profiles')
        .select('referral_code')
        .eq('id', user.id)
        .single()
        .then(({ data }) => {
          if (data?.referral_code) setReferralCode(data.referral_code);
        });
    }
  }, [user]);

  const resetState = () => {
    setCurrentStep(isEmbedded ? 'basic' : 'type');
    setSessionType(isEmbedded ? 'collaboration' : null);
    setSessionName('');
    setMaxParticipants('');
    setSelectedFriends(
      preSelectedFriend
        ? [{
            id: preSelectedFriend.id,
            name: preSelectedFriend.name,
            username: preSelectedFriend.username || '',
            avatar_url: preSelectedFriend.avatar,
          }]
        : []
    );
    setPreferences(null);
    setInviteMethod(isEmbedded ? 'friends_list' : null);
    setInviteLinkData(null);
    setPhoneDigits('');
    setPhoneInvitees([]);
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
      if (sessionType === 'collaboration' && selectedFriends.length === 0 && phoneInvitees.length === 0) {
        Alert.alert(
          'Add a collaborator',
          'Please add at least one friend or phone invite as a collaborator before continuing. This is for safety purposes.'
        );
        return;
      }

      if (isEmbedded) {
        // Embedded collaboration: skip preferences and invite steps
        setCurrentStep('review');
      } else if (sessionType === 'board') {
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
      if (!isEmbedded) {
        setCurrentStep('type');
      }
      // In embedded mode, basic is the first step — no going back
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
      if (isEmbedded) {
        // Embedded: review goes back to friends (no invite step)
        setCurrentStep('friends');
      } else {
        setCurrentStep('invite');
      }
    }
  };

  const handleCreateSession = async () => {
    if (!user) {
      Alert.alert('Error', 'You must be logged in');
      return;
    }

    if (sessionType === 'collaboration' && selectedFriends.length === 0 && phoneInvitees.length === 0) {
      Alert.alert(
        'Add a collaborator',
        'Please add at least one friend or phone invite as a collaborator before creating this session. This is for safety purposes.'
      );
      return;
    }

    setLoading(true);
    try {
      let sessionId: string | null = null;

      if (sessionType === 'board') {
        // Create board session (standalone modal flow only)
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
        const boardSessionId = sessionData.id;
        sessionId = boardSessionId;

        // Save preferences
        if (preferences) {
          await supabase
            .from('board_session_preferences')
            .insert({
              session_id: boardSessionId,
              categories: preferences.categories || [],
              budget_min: preferences.budgetMin,
              budget_max: preferences.budgetMax,
              experience_types: preferences.experienceTypes || [],
            });
        }

        // Add creator as participant
        await supabase
          .from('session_participants')
          .insert({
            session_id: boardSessionId,
            user_id: user.id,
            has_accepted: true,
            joined_at: new Date().toISOString(),
          });

        // Send friend invites if selected
        if (selectedFriends.length > 0 && inviteMethod === 'friends_list') {
          const friendIds = selectedFriends.map(f => f.id);
          await BoardInviteService.sendFriendInvites(boardSessionId, friendIds, user.id);
        }

        // Get invite link data
        const linkData = await BoardInviteService.generateInviteLink(boardSessionId);
        if (linkData) {
          setInviteLinkData({
            inviteCode: linkData.inviteCode,
            inviteLink: linkData.inviteLink,
          });
        }

        // Update presence for the creator
        await realtimeService.markOnline(boardSessionId, user.id);
      } else {
        // Split friends: those with valid usernames go through the hook,
        // those without (e.g., preSelectedFriend with optional username) get a direct ID-based fallback.
        const friendsWithUsername = selectedFriends.filter(f => f.username && f.username.trim() !== '');
        const friendsWithoutUsername = selectedFriends.filter(f => !f.username || f.username.trim() === '');

        // Create collaboration session via hook (handles duplicate check, ghost cleanup, prefs seeding)
        const participantUsernames = friendsWithUsername.map(f => f.username);
        sessionId = await createCollaborativeSession(participantUsernames, sessionName.trim());

        // Fallback: add friends without usernames directly by user ID
        if (sessionId && friendsWithoutUsername.length > 0) {
          for (const friend of friendsWithoutUsername) {
            try {
              // Add as participant (not accepted yet)
              await supabase
                .from('session_participants')
                .insert({
                  session_id: sessionId,
                  user_id: friend.id,
                  has_accepted: false,
                });

              // Get friend's email for the push notification
              const { data: friendProfile } = await supabase
                .from('profiles')
                .select('email')
                .eq('id', friend.id)
                .single();

              // Create invite
              const { data: inviteData } = await supabase
                .from('collaboration_invites')
                .insert({
                  session_id: sessionId,
                  invited_by: user.id,
                  invited_user_id: friend.id,
                  status: 'pending',
                })
                .select('id')
                .single();

              // Send push notification
              if (inviteData) {
                await supabase.functions.invoke('send-collaboration-invite', {
                  body: {
                    inviterId: user.id,
                    invitedUserId: friend.id,
                    invitedUserEmail: friendProfile?.email,
                    sessionId: sessionId,
                    sessionName: sessionName.trim(),
                    inviteId: inviteData.id,
                  },
                });
              }
            } catch (fallbackErr) {
              console.error(`Error adding friend ${friend.name} by ID fallback:`, fallbackErr);
            }
          }
        }

        // Handle phone invitees for collaboration sessions
        if (sessionId && phoneInvitees.length > 0) {
          for (const invitee of phoneInvitees) {
            try {
              await createPendingInvite(user.id, invitee.phoneE164);
              await createPendingSessionInvite(sessionId, user.id, invitee.phoneE164);
            } catch (inviteErr) {
              console.error('Error creating phone session invite:', inviteErr);
            }
          }
        }
      }

      if (sessionId) {
        // H4 FIX: Show success screen BEFORE calling parent callback.
        // In embedded mode, onCreateSession causes CollaborationModule to switch tabs,
        // which unmounts this component. Setting state after unmount is a no-op,
        // so the success screen never shows. By setting it first, React processes
        // the state update synchronously before the parent callback runs.
        setCurrentStep('success');

        if (onCreateSession) {
          onCreateSession({
            id: sessionId,
            name: sessionName.trim(),
            status: 'pending',
            createdBy: user.id,
            createdAt: new Date().toISOString(),
          });
        }
      } else {
        throw new Error('Failed to create session');
      }
    } catch (error: unknown) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to create session');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectFriend = (friend: { id: string; name?: string; display_name?: string; username: string; avatar?: string; avatar_url?: string }) => {
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
                placeholder="e.g., Weekend Plans, Date Night Ideas..."
                placeholderTextColor="#9CA3AF"
                value={sessionName}
                onChangeText={setSessionName}
                maxLength={50}
              />
              <Text style={styles.helperText}>This will be visible to all participants</Text>
            </View>

            {/* Pre-selected friend indicator */}
            {preSelectedFriend && isEmbedded && (
              <View style={styles.preSelectedCard}>
                <Text style={styles.preSelectedTitle}>Pre-selected Friend</Text>
                <View style={styles.preSelectedContent}>
                  <View style={styles.preSelectedAvatar}>
                    {preSelectedFriend.avatar ? (
                      <Image
                        source={{ uri: preSelectedFriend.avatar }}
                        style={styles.preSelectedAvatarImage}
                      />
                    ) : (
                      <Text style={styles.preSelectedAvatarText}>
                        {preSelectedFriend.name[0]}
                      </Text>
                    )}
                  </View>
                  <Text style={styles.preSelectedName}>{preSelectedFriend.name}</Text>
                </View>
                <Text style={styles.preSelectedNote}>
                  You can modify your selection in the next step
                </Text>
              </View>
            )}

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

            {/* Phone input for adding by number */}
            <View style={styles.phoneInputSection}>
              <Text style={styles.phoneInputLabel}>Add by phone number</Text>
              <View style={styles.phoneInputRow}>
                <View style={styles.phoneInputWrapper}>
                  <PhoneInput
                    value={phoneDigits}
                    countryCode={phoneCountry}
                    onChangePhone={setPhoneDigits}
                    onChangeCountry={setPhoneCountry}
                    error={null}
                    disabled={false}
                  />
                </View>
                {phoneRawDigits.length >= 7 && (
                  <TouchableOpacity
                    style={styles.phoneActionButton}
                    disabled={phoneLookupLoading || phoneInviteLoading}
                    onPress={async () => {
                      const isAlreadyInvited = phoneInvitees.some(i => i.phoneE164 === debouncedPhoneE164);
                      if (isAlreadyInvited) return;

                      if (phoneLookupResult?.found && phoneLookupResult.user) {
                        // User found on app but not a friend — prompt to send friend request
                        if (phoneLookupResult.friendship_status === 'none') {
                          Alert.alert(
                            'Send friend request first?',
                            `${phoneLookupResult.user.display_name || phoneLookupResult.user.username} is on Mingla but not your friend yet.`,
                            [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Send Request',
                                onPress: async () => {
                                  const lookupUser = phoneLookupResult.user!;
                                  try {
                                    // Actually send the friend request
                                    await addFriend(
                                      lookupUser.id,
                                      '', // email not available from phone lookup
                                      lookupUser.username,
                                    );
                                    // Add as selected friend from lookup
                                    const friendData: SelectedFriend = {
                                      id: lookupUser.id,
                                      name: lookupUser.display_name || lookupUser.username,
                                      username: lookupUser.username,
                                      avatar_url: lookupUser.avatar_url || undefined,
                                    };
                                    if (!selectedFriends.some(f => f.id === friendData.id)) {
                                      setSelectedFriends(prev => [...prev, friendData]);
                                    }
                                    setPhoneDigits('');
                                  } catch (err: unknown) {
                                    Alert.alert('Error', err instanceof Error ? err.message : 'Failed to send friend request');
                                  }
                                },
                              },
                            ]
                          );
                        } else {
                          // Already friends — add directly
                          const friendData: SelectedFriend = {
                            id: phoneLookupResult.user.id,
                            name: phoneLookupResult.user.display_name || phoneLookupResult.user.username,
                            username: phoneLookupResult.user.username,
                            avatar_url: phoneLookupResult.user.avatar_url || undefined,
                          };
                          if (!selectedFriends.some(f => f.id === friendData.id)) {
                            setSelectedFriends(prev => [...prev, friendData]);
                          }
                          setPhoneDigits('');
                        }
                      } else {
                        // Not on app — invite via share
                        setPhoneInviteLoading(true);
                        try {
                          if (user) {
                            await createPendingInvite(user.id, debouncedPhoneE164);
                          }
                          const inviteLink = referralCode
                            ? `https://usemingla.com/invite/${referralCode}`
                            : 'https://usemingla.com';
                          await Share.share({
                            message: `Hey! Join me on Mingla and let's find amazing experiences together. ${inviteLink}`,
                          });
                          setPhoneInvitees(prev => [
                            ...prev,
                            { type: 'phone', phoneE164: debouncedPhoneE164, displayName: debouncedPhoneE164 },
                          ]);
                          setPhoneDigits('');
                        } catch (err) {
                          console.error('Error inviting by phone:', err);
                        } finally {
                          setPhoneInviteLoading(false);
                        }
                      }
                    }}
                  >
                    {phoneLookupLoading || phoneInviteLoading ? (
                      <ActivityIndicator size="small" color={colors.primary[500]} />
                    ) : (
                      <Text style={styles.phoneActionButtonText}>
                        {phoneLookupResult?.found ? 'Add' : 'Invite'}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>

              {/* Phone lookup error feedback */}
              {phoneLookupError && phoneRawDigits.length >= 7 && (
                <Text style={styles.phoneLookupError}>
                  {phoneLookupError instanceof Error
                    ? phoneLookupError.message
                    : 'Phone lookup failed. Please try again.'}
                </Text>
              )}

              {/* Phone invitees pills */}
              {phoneInvitees.length > 0 && (
                <View style={styles.phoneInviteesContainer}>
                  {phoneInvitees.map((invitee) => (
                    <View key={invitee.phoneE164} style={styles.phoneInviteePill}>
                      <Text style={styles.phoneInviteePillText}>{invitee.phoneE164}</Text>
                      <TouchableOpacity
                        onPress={() => setPhoneInvitees(prev => prev.filter(i => i.phoneE164 !== invitee.phoneE164))}
                      >
                        <Ionicons name="close-circle" size={16} color={colors.orange[600]} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <TouchableOpacity
              style={styles.friendButton}
              onPress={() => setShowFriendModal(true)}
            >
              <Ionicons name="person-add" size={20} color="#eb7825" />
              <Text style={styles.friendButtonText}>Select Friends</Text>
            </TouchableOpacity>

            {selectedFriends.length > 0 && (
              <View style={styles.selectedFriendsContainer}>
                {selectedFriends.map((friend) => {
                  const isPreSelected = preSelectedFriend?.id === friend.id;
                  return (
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
                        <View style={styles.selectedFriendNameRow}>
                          <Text style={styles.selectedFriendText}>{friend.name}</Text>
                          {isPreSelected && (
                            <Text style={styles.preSelectedBadge}>Pre-selected</Text>
                          )}
                        </View>
                      </View>
                      <TouchableOpacity
                        onPress={() => setSelectedFriends(selectedFriends.filter(f => f.id !== friend.id))}
                        style={styles.selectedFriendRemove}
                      >
                        <Ionicons name="close-circle" size={20} color="#FF3B30" />
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            )}

            {/* Empty state — no friends and no phone invitees */}
            {friends.length === 0 && selectedFriends.length === 0 && phoneInvitees.length === 0 && onNavigateToInvites && (
              <View style={styles.emptyStateContainer}>
                <Ionicons name="people-outline" size={48} color="#D1D5DB" />
                <Text style={styles.emptyStateTitle}>No friends yet</Text>
                <Text style={styles.emptyStateText}>
                  Add friends to start collaborating, or invite someone by phone number above
                </Text>
                <TouchableOpacity
                  onPress={onNavigateToInvites}
                  style={styles.emptyStateButton}
                >
                  <Text style={styles.emptyStateButtonText}>Go to Invites</Text>
                </TouchableOpacity>
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

            {selectedFriends.length > 0 && (
              <View style={styles.reviewCard}>
                <Text style={styles.reviewLabel}>Friends Invited</Text>
                <Text style={styles.reviewValue}>
                  {selectedFriends.map(f => f.name).join(', ')}
                </Text>
              </View>
            )}

            {phoneInvitees.length > 0 && (
              <View style={styles.reviewCard}>
                <Text style={styles.reviewLabel}>Phone Invites</Text>
                <Text style={styles.reviewValue}>
                  {phoneInvitees.map(i => i.phoneE164).join(', ')}
                </Text>
              </View>
            )}

            {/* Only show invite method in standalone (non-embedded) mode */}
            {!isEmbedded && (
              <View style={styles.reviewCard}>
                <Text style={styles.reviewLabel}>Invite Method</Text>
                <Text style={styles.reviewValue}>
                  {inviteMethod === 'friends_list' ? 'Friends List' :
                   inviteMethod === 'link' ? 'Share Link' :
                   inviteMethod === 'qr_code' ? 'QR Code' :
                   inviteMethod === 'invite_code' ? 'Invite Code' : 'None'}
                </Text>
              </View>
            )}

            {sessionType === 'board' && preferences && (
              <View style={styles.reviewCard}>
                <Text style={styles.reviewLabel}>Preferences</Text>
                <Text style={styles.reviewValue}>
                  {preferences.categories?.length || 0} categories, Group size: {preferences.groupSize || 2}
                </Text>
              </View>
            )}

            {/* Info card about next steps */}
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
          return selectedFriends.length > 0 || phoneInvitees.length > 0;
        }
        return true; // Friends are optional for board sessions
      case 'preferences':
        return true; // Preferences are optional
      case 'invite':
        return inviteMethod !== null;
      case 'review':
        if (sessionType === 'collaboration') {
          return selectedFriends.length > 0 || phoneInvitees.length > 0;
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

  // Determine if back button should show
  const showBackButton = isEmbedded
    ? currentStep !== 'basic' && currentStep !== 'success'
    : currentStep !== 'type' && currentStep !== 'success';

  // --- EMBEDDED RENDERING (inside CollaborationModule's ScrollView) ---
  if (isEmbedded) {
    return (
      <View style={styles.embeddedContainer}>
        {/* Header with back button and step title */}
        <View style={styles.embeddedHeader}>
          {showBackButton ? (
            <TouchableOpacity onPress={handleBack} style={styles.embeddedBackButton}>
              <Ionicons name="chevron-back" size={20} color="#6b7280" />
            </TouchableOpacity>
          ) : (
            <View style={styles.embeddedBackButtonPlaceholder} />
          )}
          <Text style={styles.embeddedHeaderTitle}>{getStepTitle()}</Text>
          <View style={styles.embeddedBackButtonPlaceholder} />
        </View>

        {/* Step content */}
        {renderStepContent()}

        {/* Footer button */}
        {currentStep !== 'success' && (
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
        )}

        {currentStep === 'success' && (
          <TouchableOpacity
            style={styles.doneButton}
            onPress={resetState}
          >
            <Text style={styles.doneButtonText}>Create Another</Text>
          </TouchableOpacity>
        )}

        {/* FriendSelectionModal — renders as a separate Modal overlay */}
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
      </View>
    );
  }

  // --- STANDALONE MODAL RENDERING ---
  // C1 FIX: Standalone mode renders the same content without the embedded wrapper.
  // Previously this returned null, making the standalone modal completely blank.
  return (
    <View style={styles.standaloneContainer}>
      {renderStepContent()}
      {currentStep !== 'success' && (
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
      )}
      {currentStep === 'success' && (
        <TouchableOpacity
          style={styles.doneButton}
          onPress={resetState}
        >
          <Text style={styles.doneButtonText}>Create Another</Text>
        </TouchableOpacity>
      )}
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
    </View>
  );
};

/**
 * CreateSessionModal — thin Modal wrapper around CreateSessionContent.
 * Preserved for future use as a standalone modal. Currently not rendered by anything.
 */
export const CreateSessionModal: React.FC = () => {
  const { isCreateSessionModalOpen, closeCreateSessionModal } = useNavigation();
  const insets = useSafeAreaInsets();

  // Reset is handled internally by CreateSessionContent when it unmounts/remounts

  if (!isCreateSessionModalOpen) return null;

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

          <KeyboardAwareScrollView style={styles.content} showsVerticalScrollIndicator={false} bottomOffset={76}>
            <CreateSessionContent isEmbedded={false} />
          </KeyboardAwareScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.doneButton}
              onPress={closeCreateSessionModal}
            >
              <Text style={styles.doneButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.88;

const styles = StyleSheet.create({
  // === Standalone mode styles (C1 fix) ===
  standaloneContainer: {
    flex: 1,
    gap: 16,
    padding: 16,
  },
  // === Embedded mode styles ===
  embeddedContainer: {
    gap: 16,
  },
  embeddedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  embeddedBackButton: {
    padding: 8,
    backgroundColor: '#f3f4f6',
    borderRadius: 20,
  },
  embeddedBackButtonPlaceholder: {
    width: 36,
    height: 36,
  },
  embeddedHeaderTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    flex: 1,
  },

  // === Standalone modal styles ===
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
  helperText: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 8,
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

  // === Pre-selected friend (basic step) ===
  preSelectedCard: {
    backgroundColor: '#dbeafe',
    borderWidth: 1,
    borderColor: '#93c5fd',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  preSelectedTitle: {
    fontWeight: '500',
    color: '#1e40af',
    marginBottom: 8,
  },
  preSelectedContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  preSelectedAvatar: {
    width: 32,
    height: 32,
    backgroundColor: '#3b82f6',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  preSelectedAvatarImage: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  preSelectedAvatarText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  preSelectedName: {
    color: '#1e40af',
    fontWeight: '500',
    flex: 1,
  },
  preSelectedNote: {
    fontSize: 12,
    color: '#1e40af',
    marginTop: 8,
  },

  // === Friends step ===
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
  selectedFriendNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectedFriendText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
  },
  preSelectedBadge: {
    fontSize: 11,
    backgroundColor: '#dbeafe',
    color: '#1e40af',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    overflow: 'hidden',
  },
  selectedFriendRemove: {
    padding: 4,
    flexShrink: 0,
  },

  // === Empty state ===
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

  // === Review step ===
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

  // === Info card (review step) ===
  infoCard: {
    backgroundColor: '#dbeafe',
    borderWidth: 1,
    borderColor: '#93c5fd',
    borderRadius: 12,
    padding: 16,
    marginTop: 4,
  },
  infoCardContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
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

  // === Success step ===
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

  // === Footer buttons ===
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
    marginTop: 8,
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
    marginTop: 8,
  },
  doneButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },

  // === Phone input ===
  phoneInputSection: {
    marginBottom: 16,
  },
  phoneInputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  phoneInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  phoneInputWrapper: {
    flex: 1,
  },
  phoneActionButton: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.orange[50],
    borderWidth: 1,
    borderColor: colors.primary[500],
  },
  phoneActionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary[500],
  },
  phoneInviteesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  phoneInviteePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warning[50],
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    gap: 4,
  },
  phoneInviteePillText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.orange[600],
  },
  phoneLookupError: {
    fontSize: 13,
    color: '#EF4444',
    marginTop: 6,
  },
});
