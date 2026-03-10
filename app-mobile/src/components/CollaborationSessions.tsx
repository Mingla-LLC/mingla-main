import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  TextInput,
  Alert,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Dimensions,
  ActivityIndicator,
  Image,
  Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { mixpanelService } from '../services/mixpanelService';
import SessionViewModal from './SessionViewModal';
import { supabase } from '../services/supabase';
import { COUNTRIES, getDefaultCountryCode, getCountryByCode } from '../constants/countries';
import { CountryData } from '../types/onboarding';
import { usePhoneLookup, useDebouncedValue } from '../hooks/usePhoneLookup';
import { createPendingInvite } from '../services/phoneLookupService';
import { useSendFriendLink } from '../hooks/useFriendLinks';
import { useAppStore } from '../store/appStore';
const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const SHEET_HEIGHT = screenHeight * 0.88;

// Types
export type SessionType = 'active' | 'sent-invite' | 'received-invite';

export interface Friend {
  id: string;
  name: string;
  username?: string;
  avatar?: string;
  status?: 'online' | 'offline';
}

export interface CollaborationSession {
  id: string;
  name: string;
  initials: string;
  type: SessionType;
  participants?: number;
  createdAt?: Date;
  invitedBy?: {
    id: string;
    name: string;
    username?: string;
    avatar?: string;
  };
}

interface CollaborationSessionsProps {
  sessions: CollaborationSession[];
  currentMode: 'solo' | string;
  selectedSessionId: string | null;
  onSessionSelect: (sessionId: string | null) => void;
  onSoloSelect: () => void;
  onCreateSession: (sessionName: string, selectedFriends: Friend[], phoneInvitees?: { phoneE164: string }[]) => void;
  onAcceptInvite: (sessionId: string) => void;
  onDeclineInvite: (sessionId: string) => void;
  onCancelInvite: (sessionId: string) => void;
  onSessionStateChanged?: () => void;
  availableFriends?: Friend[];
  isCreatingSession?: boolean;
  inviteModalTrigger?: {
    sessionId: string;
    nonce: number;
  } | null;
}

// Helper function to generate initials from a name
export const getInitials = (name: string): string => {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
};

export default function CollaborationSessions({
  sessions,
  currentMode,
  selectedSessionId,
  onSessionSelect,
  onSoloSelect,
  onCreateSession,
  onAcceptInvite,
  onDeclineInvite,
  onCancelInvite,
  onSessionStateChanged,
  availableFriends = [],
  isCreatingSession = false,
  inviteModalTrigger = null,
}: CollaborationSessionsProps) {
  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollView>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showSessionViewModal, setShowSessionViewModal] = useState(false);
  const [sessionToView, setSessionToView] = useState<CollaborationSession | null>(null);
  const [inviteModalSession, setInviteModalSession] = useState<CollaborationSession | null>(null);
  const [newSessionName, setNewSessionName] = useState('');
  const [selectedFriends, setSelectedFriends] = useState<Friend[]>([]);
  const [contentWidth, setContentWidth] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const lastHandledInviteTriggerNonce = useRef<number | null>(null);

  // Phone input state
  const [phoneNumber, setPhoneNumber] = useState('');
  const [selectedCountry, setSelectedCountry] = useState<CountryData>(
    () => getCountryByCode(getDefaultCountryCode()) ?? COUNTRIES[0]
  );
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const [phoneActionStatus, setPhoneActionStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [phoneActionError, setPhoneActionError] = useState('');
  const [phoneInvitees, setPhoneInvitees] = useState<{ phoneE164: string }[]>([]);

  const sendLinkMutation = useSendFriendLink();
  const { user } = useAppStore();

  // Build E.164 phone
  const phoneRawDigits = phoneNumber.replace(/\D/g, '');
  const phoneE164 = useMemo(() => {
    if (!phoneRawDigits) return '';
    return `${selectedCountry.dialCode}${phoneRawDigits}`;
  }, [phoneRawDigits, selectedCountry]);

  const debouncedPhoneE164 = useDebouncedValue(phoneE164, 500);
  const debouncedDigitCount = useDebouncedValue(phoneRawDigits.length, 500);

  const {
    data: phoneLookupResult,
    isLoading: phoneLookupLoading,
  } = usePhoneLookup(debouncedPhoneE164, debouncedDigitCount >= 7);

  const isPhoneValid = useMemo(() => {
    return phoneRawDigits.length >= 7 && phoneRawDigits.length <= 15;
  }, [phoneRawDigits]);

  const filteredCountries = useMemo(() => {
    if (!countrySearch.trim()) return COUNTRIES;
    const q = countrySearch.toLowerCase();
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dialCode.includes(q) ||
        c.code.toLowerCase().includes(q)
    );
  }, [countrySearch]);

  const isSoloMode = currentMode === 'solo';

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

  // Sort sessions: active first, invites last
  const sortedSessions = [...sessions].sort((a, b) => {
    const inviteTypes: SessionType[] = ['sent-invite', 'received-invite'];
    const aIsInvite = inviteTypes.includes(a.type);
    const bIsInvite = inviteTypes.includes(b.type);
    if (!aIsInvite && bIsInvite) return -1;
    if (aIsInvite && !bIsInvite) return 1;
    return 0;
  });

  // Update scroll indicators
  useEffect(() => {
    const hasOverflow = contentWidth > containerWidth;
    setShowRightArrow(hasOverflow);
  }, [contentWidth, containerWidth]);

  useEffect(() => {
    if (!inviteModalTrigger) return;
    if (lastHandledInviteTriggerNonce.current === inviteModalTrigger.nonce) return;

    const sessionToOpen = sessions.find(
      (session) =>
        session.id === inviteModalTrigger.sessionId &&
        session.type === 'received-invite'
    );

    if (!sessionToOpen) return;

    setInviteModalSession(sessionToOpen);
    setShowInviteModal(true);
    lastHandledInviteTriggerNonce.current = inviteModalTrigger.nonce;
  }, [inviteModalTrigger, sessions]);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const scrollX = contentOffset.x;
    const maxScrollX = contentSize.width - layoutMeasurement.width;

    setShowLeftArrow(scrollX > 10);
    setShowRightArrow(scrollX < maxScrollX - 10);
  };

  const handlePillClick = (session: CollaborationSession) => {
    if (session.type === 'sent-invite' || session.type === 'received-invite') {
      setInviteModalSession(session);
      setShowInviteModal(true);
    } else {
      // Active session - open the session view modal and select it
      setSessionToView(session);
      setShowSessionViewModal(true);
      onSessionSelect(session.id);
      mixpanelService.trackSessionSwitched({ mode: 'session', sessionName: session.name });
    }
  };

  const handleCreateSession = () => {
    if (!newSessionName.trim()) {
      Alert.alert('Session name required', 'Please enter a session name before creating a session.');
      return;
    }

    if (selectedFriends.length === 0) {
      Alert.alert(
        'Add at least one collaborator',
        'For safety, you can only create a collaboration session after adding at least one friend as a collaborator.'
      );
      return;
    }

    if (newSessionName.trim()) {
      mixpanelService.trackCollaborationSessionCreated({
        sessionName: newSessionName.trim(),
        invitedFriendsCount: selectedFriends.length,
      });
      onCreateSession(newSessionName.trim(), selectedFriends, phoneInvitees.length > 0 ? phoneInvitees : undefined);
      setNewSessionName('');
      setSelectedFriends([]);
      setPhoneNumber('');
      setPhoneActionStatus('idle');
      setPhoneInvitees([]);
      setShowCreateModal(false);
    }
  };

  const handleCloseCreateModal = () => {
    setNewSessionName('');
    setSelectedFriends([]);
    setPhoneNumber('');
    setPhoneActionStatus('idle');
    setPhoneActionError('');
    setPhoneInvitees([]);
    setShowCreateModal(false);
  };

  // Handle phone action — context-aware for session creation
  const handlePhoneAction = useCallback(async () => {
    if (!isPhoneValid || !debouncedPhoneE164) return;

    setPhoneActionStatus('sending');
    setPhoneActionError('');

    try {
      if (phoneLookupResult?.found && phoneLookupResult.user) {
        const lookupUser = phoneLookupResult.user;

        // Guard: can't add yourself
        if (user && lookupUser.id === user.id) {
          Alert.alert('That\'s you', 'You can\'t add yourself as a collaborator.');
          setPhoneActionStatus('idle');
          return;
        }

        if (phoneLookupResult.friendship_status === 'friends') {
          // Already friends — auto-add to selectedFriends as collaborator
          const alreadySelected = selectedFriends.some(f => f.id === lookupUser.id);
          if (alreadySelected) {
            Alert.alert('Already selected', 'This friend is already added as a collaborator.');
          } else {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            const friendData: Friend = {
              id: lookupUser.id,
              name: lookupUser.display_name || lookupUser.username || 'User',
              username: lookupUser.username,
              avatar: lookupUser.avatar_url || undefined,
            };
            setSelectedFriends(prev => [...prev, friendData]);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
          setPhoneActionStatus('sent');
          setTimeout(() => {
            setPhoneNumber('');
            setPhoneActionStatus('idle');
          }, 1500);
        } else if (phoneLookupResult.friendship_status === 'none') {
          // Not friends yet — send friend request
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          await sendLinkMutation.mutateAsync({
            targetUserId: lookupUser.id,
          });
          setPhoneActionStatus('sent');
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert(
            'Friend request sent',
            `${lookupUser.display_name || lookupUser.username} will appear in your collaborators list once they accept.`
          );
          setTimeout(() => {
            setPhoneNumber('');
            setPhoneActionStatus('idle');
          }, 2000);
        } else {
          // pending_sent or pending_received
          Alert.alert('Request Pending', 'A friend request is already pending with this person.');
          setPhoneActionStatus('idle');
        }
      } else {
        // Not on Mingla — save pending invite + track for session + native share
        if (user) {
          await createPendingInvite(user.id, debouncedPhoneE164);
        }

        // Track this phone invitee for session creation (dedup)
        const alreadyInvited = phoneInvitees.some(i => i.phoneE164 === debouncedPhoneE164);
        if (!alreadyInvited) {
          setPhoneInvitees(prev => [...prev, { phoneE164: debouncedPhoneE164 }]);
        }

        await Share.share({
          message: `Hey! Join me on Mingla and let's find amazing experiences together. https://usemingla.com`,
        });
        setPhoneActionStatus('sent');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setTimeout(() => {
          setPhoneNumber('');
          setPhoneActionStatus('idle');
        }, 2000);
      }
    } catch (err) {
      console.error('[CollaborationSessions] Phone action error:', err);
      setPhoneActionError(err instanceof Error ? err.message : 'Something went wrong');
      setPhoneActionStatus('error');
    }
  }, [isPhoneValid, debouncedPhoneE164, phoneLookupResult, sendLinkMutation, user, selectedFriends, phoneInvitees]);

  const getPhoneActionLabel = (): string => {
    if (phoneLookupLoading) return 'Looking up...';
    if (!isPhoneValid) return 'Enter phone number';
    if (phoneLookupResult?.found) {
      if (phoneLookupResult.friendship_status === 'friends') {
        // Check if already selected
        const alreadySelected = selectedFriends.some(f => f.id === phoneLookupResult.user?.id);
        return alreadySelected ? 'Already added' : 'Add as collaborator';
      }
      if (phoneLookupResult.friendship_status === 'none') return 'Send friend request';
      return 'Request pending';
    }
    return 'Invite to Mingla';
  };

  const isPhoneActionDisabled =
    !isPhoneValid ||
    phoneLookupLoading ||
    phoneActionStatus === 'sending' ||
    phoneActionStatus === 'sent' ||
    (phoneLookupResult?.found &&
      phoneLookupResult.friendship_status !== 'none' &&
      phoneLookupResult.friendship_status !== 'friends') ||
    (phoneLookupResult?.found &&
      phoneLookupResult.friendship_status === 'friends' &&
      selectedFriends.some(f => f.id === phoneLookupResult.user?.id));

  const canCreateSession = newSessionName.trim().length > 0 && (selectedFriends.length > 0 || phoneInvitees.length > 0) && !isCreatingSession;

  const scrollLeft = () => {
    scrollViewRef.current?.scrollTo({ x: 0, animated: true });
  };

  const scrollRight = () => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  };

  const renderPill = (session: CollaborationSession) => {
    const isSelected = selectedSessionId === session.id && !isSoloMode;
    const isSentInvite = session.type === 'sent-invite';
    const isReceivedInvite = session.type === 'received-invite';
    const isInvite = isSentInvite || isReceivedInvite;

    return (
      <TouchableOpacity
        key={session.id}
        style={[
          styles.pill,
          isInvite && styles.pillInvite,
          isSentInvite && styles.pillSentInvite,
          isSelected && styles.pillSelected,
        ]}
        onPress={() => handlePillClick(session)}
        activeOpacity={isSentInvite ? 0.5 : 0.7}
      >
        <Text
          style={[
            styles.pillText,
            isInvite && styles.pillTextInvite,
            isSelected && styles.pillTextSelected,
          ]}
        >
          {session.initials}
        </Text>
        {isInvite && (
          <View style={[styles.inviteBadge, isSentInvite && styles.inviteBadgePending]}>
            <Ionicons
              name={isReceivedInvite ? 'mail' : 'time-outline'}
              size={7}
              color="#fff"
            />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Left scroll indicator */}
      {showLeftArrow && (
        <TouchableOpacity style={styles.scrollArrowLeft} onPress={scrollLeft}>
          <Ionicons name="chevron-back" size={16} color="#6B7280" />
        </TouchableOpacity>
      )}

      {/* Fixed pills */}
      <View collapsable={false}>
        <TouchableOpacity
          style={[styles.pill, isSoloMode && styles.soloPill]}
          onPress={() => {
            onSoloSelect();
            mixpanelService.trackSessionSwitched({ mode: 'solo' });
          }}
          activeOpacity={0.7}
        >
          <Text style={[styles.pillText, isSoloMode && styles.soloPillText]}>
            Solo
          </Text>
        </TouchableOpacity>
      </View>

      <View collapsable={false}>
        <TouchableOpacity
          style={[styles.pill, styles.createPill]}
          onPress={() => setShowCreateModal(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="add" size={16} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* Scrollable session pills */}
      <View style={styles.scrollViewWrapper}>
        <ScrollView
          ref={scrollViewRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          onContentSizeChange={(w) => setContentWidth(w)}
          onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
        >
        {sortedSessions.map(renderPill)}
        </ScrollView>
      </View>

      {/* Right scroll indicator */}
      {showRightArrow && (
        <TouchableOpacity style={styles.scrollArrowRight} onPress={scrollRight}>
          <Ionicons name="chevron-forward" size={16} color="#6B7280" />
        </TouchableOpacity>
      )}

      {/* Create Session Modal */}
      <Modal
        visible={showCreateModal}
        transparent
        animationType="slide"
        onRequestClose={handleCloseCreateModal}
        statusBarTranslucent
      >
        <View style={styles.createSheetOverlay}>
          <TouchableOpacity
            style={styles.createSheetBackdrop}
            activeOpacity={1}
            onPress={handleCloseCreateModal}
          />
          <View style={[styles.createSheetContent, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            {/* Drag Handle */}
            <View style={styles.createDragHandleContainer}>
              <View style={styles.createDragHandle} />
            </View>

            <View style={styles.createSheetHeader}>
              <View style={styles.modalCloseButtonPlaceholder} />
              <Text style={styles.modalTitle}>Create New Session</Text>
              <View style={styles.modalCloseButtonPlaceholder} />
            </View>

            <ScrollView style={styles.modalScrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Session Name Input */}
              <Text style={styles.modalLabel}>Session Name</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g., Weekend Plans, Date Night..."
                value={newSessionName}
                onChangeText={setNewSessionName}
                autoFocus
                maxLength={30}
              />

              {/* Invite by phone */}
              <View style={styles.friendSelectionSection}>
                <Text style={styles.modalLabel}>Add by phone number</Text>

                <View style={styles.csPhoneRow}>
                  <TouchableOpacity
                    style={styles.csCountryPicker}
                    onPress={() => setShowCountryPicker(true)}
                    activeOpacity={0.6}
                  >
                    <Text style={styles.csCountryFlag}>{selectedCountry.flag}</Text>
                    <Text style={styles.csCountryDial}>{selectedCountry.dialCode}</Text>
                    <Ionicons name="chevron-down" size={14} color="#9ca3af" />
                  </TouchableOpacity>

                  <View style={styles.csPhoneDivider} />

                  <TextInput
                    style={styles.csPhoneInput}
                    value={phoneNumber}
                    onChangeText={(text) => {
                      setPhoneNumber(text);
                      if (phoneActionStatus !== 'idle' && phoneActionStatus !== 'sending') {
                        setPhoneActionStatus('idle');
                        setPhoneActionError('');
                      }
                    }}
                    placeholder="Phone number"
                    placeholderTextColor="#9ca3af"
                    keyboardType="phone-pad"
                    autoCorrect={false}
                    maxLength={15}
                  />

                  {phoneLookupLoading && (
                    <ActivityIndicator size="small" color="#eb7825" style={{ marginRight: 10 }} />
                  )}
                </View>

                {/* Lookup result */}
                {isPhoneValid && !phoneLookupLoading && phoneLookupResult && (
                  <View style={styles.csLookupResult}>
                    {phoneLookupResult.found ? (
                      <View style={styles.csLookupRow}>
                        <Ionicons name="checkmark-circle" size={14} color="#22c55e" />
                        <Text style={styles.csLookupTextGreen}>
                          {phoneLookupResult.user?.display_name || phoneLookupResult.user?.username || 'User'} is on Mingla
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.csLookupRow}>
                        <Ionicons name="person-add-outline" size={14} color="#6b7280" />
                        <Text style={styles.csLookupTextMuted}>Not on Mingla yet</Text>
                      </View>
                    )}
                  </View>
                )}

                {/* Status */}
                {phoneActionStatus === 'sent' && (
                  <View style={styles.csStatusRow}>
                    <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
                    <Text style={styles.csStatusSuccess}>
                      {phoneLookupResult?.found
                        ? phoneLookupResult.friendship_status === 'friends'
                          ? 'Added as collaborator!'
                          : 'Friend request sent!'
                        : 'Invite shared!'}
                    </Text>
                  </View>
                )}
                {phoneActionStatus === 'error' && (
                  <View style={styles.csStatusRow}>
                    <Ionicons name="alert-circle" size={16} color="#ef4444" />
                    <Text style={styles.csStatusError}>{phoneActionError}</Text>
                  </View>
                )}

                {/* Action button */}
                <TouchableOpacity
                  style={[styles.csActionButton, isPhoneActionDisabled && styles.csActionButtonDisabled]}
                  onPress={handlePhoneAction}
                  activeOpacity={0.7}
                  disabled={!!isPhoneActionDisabled}
                >
                  {phoneActionStatus === 'sending' ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <>
                      <Ionicons
                        name={phoneLookupResult?.found ? 'person-add' : 'paper-plane-outline'}
                        size={14}
                        color="#ffffff"
                        style={{ marginRight: 5 }}
                      />
                      <Text style={styles.csActionButtonText}>{getPhoneActionLabel()}</Text>
                    </>
                  )}
                </TouchableOpacity>

                {/* Phone invitees (not on Mingla) */}
                {phoneInvitees.length > 0 && (
                  <View style={styles.csPhoneInviteesContainer}>
                    <Text style={styles.csPhoneInviteesLabel}>Pending invites</Text>
                    <View style={styles.csPhoneInviteesList}>
                      {phoneInvitees.map((invitee) => (
                        <View key={invitee.phoneE164} style={styles.csPhoneInviteePill}>
                          <Text style={styles.csPhoneInviteePillText}>{invitee.phoneE164}</Text>
                          <TouchableOpacity
                            onPress={() => setPhoneInvitees(prev => prev.filter(i => i.phoneE164 !== invitee.phoneE164))}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                          >
                            <Ionicons name="close-circle" size={16} color="#9CA3AF" />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
              </View>

              {/* Select existing friends as collaborators */}
              <View style={styles.friendSelectionSection}>
                <Text style={styles.modalLabel}>Select Collaborators</Text>

                {/* Selected Friends */}
                {selectedFriends.length > 0 && (
                  <View style={styles.selectedFriendsContainer}>
                    {selectedFriends.map((friend) => (
                      <View key={friend.id} style={styles.selectedFriendTag}>
                        <View style={styles.selectedFriendAvatar}>
                          {friend.avatar ? (
                            <Image
                              source={{ uri: friend.avatar }}
                              style={styles.selectedFriendAvatarImage}
                            />
                          ) : (
                            <Text style={styles.selectedFriendAvatarText}>
                              {friend.name[0]}
                            </Text>
                          )}
                        </View>
                        <Text style={styles.selectedFriendName} numberOfLines={1}>
                          {friend.name}
                        </Text>
                        <TouchableOpacity
                          onPress={() => toggleFriendSelection(friend)}
                          style={styles.removeFriendButton}
                        >
                          <Ionicons name="close" size={12} color="#6B7280" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}

                {/* Friends List */}
                {availableFriends.length === 0 ? (
                  <View style={styles.noFriendsContainer}>
                    <Ionicons name="people-outline" size={32} color="#D1D5DB" />
                    <Text style={styles.noFriendsText}>No friends yet</Text>
                    <Text style={styles.noFriendsSubtext}>
                      Invite someone by phone number above
                    </Text>
                  </View>
                ) : (
                  <View style={styles.friendsList}>
                    {availableFriends.map((friend) => {
                      const isSelected = selectedFriends.some(f => f.id === friend.id);
                      return (
                        <TouchableOpacity
                          key={friend.id}
                          style={[
                            styles.friendItem,
                            isSelected && styles.friendItemSelected,
                          ]}
                          onPress={() => toggleFriendSelection(friend)}
                          activeOpacity={0.7}
                        >
                          <View style={styles.friendAvatar}>
                            {friend.avatar ? (
                              <Image
                                source={{ uri: friend.avatar }}
                                style={styles.friendAvatarImage}
                              />
                            ) : (
                              <Text style={styles.friendAvatarText}>
                                {friend.name[0]}
                              </Text>
                            )}
                          </View>
                          <View style={styles.friendInfo}>
                            <Text style={styles.friendName}>{friend.name}</Text>
                          </View>
                          {isSelected && (
                            <View style={styles.friendCheckmark}>
                              <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            </ScrollView>

            {/* Actions */}
            <View style={styles.modalActionsFixed}>
              <TouchableOpacity
                style={[
                  styles.modalCreateButton,
                  !canCreateSession && styles.modalCreateButtonDisabled,
                ]}
                onPress={handleCreateSession}
                disabled={!canCreateSession}
              >
                {isCreatingSession ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalCreateButtonText}>
                    {selectedFriends.length > 0
                      ? `Invite (${selectedFriends.length})`
                      : 'Create'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Country Picker Modal */}
        <Modal
          visible={showCountryPicker}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setShowCountryPicker(false)}
        >
          <View style={styles.csPickerOverlay}>
            <TouchableOpacity
              style={StyleSheet.absoluteFillObject}
              activeOpacity={1}
              onPress={() => setShowCountryPicker(false)}
            />
            <View style={styles.csPickerSheet}>
              <View style={styles.csPickerHeader}>
                <Text style={styles.csPickerTitle}>Select Country</Text>
                <TouchableOpacity onPress={() => setShowCountryPicker(false)}>
                  <Ionicons name="close" size={22} color="#374151" />
                </TouchableOpacity>
              </View>
              <View style={styles.csPickerSearchRow}>
                <Ionicons name="search-outline" size={18} color="#9ca3af" style={{ marginRight: 8 }} />
                <TextInput
                  style={styles.csPickerSearchInput}
                  value={countrySearch}
                  onChangeText={setCountrySearch}
                  placeholder="Search countries"
                  placeholderTextColor="#9ca3af"
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <ScrollView keyboardShouldPersistTaps="handled">
                {filteredCountries.map((item) => (
                  <TouchableOpacity
                    key={item.code}
                    style={[
                      styles.csCountryRow,
                      item.code === selectedCountry.code && styles.csCountryRowSelected,
                    ]}
                    onPress={() => {
                      setSelectedCountry(item);
                      setShowCountryPicker(false);
                      setCountrySearch('');
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.csCountryRowFlag}>{item.flag}</Text>
                    <Text style={styles.csCountryRowName}>{item.name}</Text>
                    <Text style={styles.csCountryRowDial}>{item.dialCode}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </Modal>

      {/* Invite Action Modal */}

      <Modal
        visible={showInviteModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowInviteModal(false)}
        statusBarTranslucent
      >
        <View style={styles.inviteSheetOverlay}>
          <TouchableOpacity
            style={styles.inviteSheetBackdrop}
            activeOpacity={1}
            onPress={() => setShowInviteModal(false)}
          />
          <View style={[styles.inviteSheetContent, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.inviteDragHandleContainer}>
              <View style={styles.inviteDragHandle} />
            </View>

            <View style={styles.inviteSheetHeader}>
              <View style={styles.modalCloseButtonPlaceholder} />
              <Text style={styles.inviteSheetTitle}>
                {inviteModalSession?.type === 'received-invite'
                  ? 'Received Invite'
                  : 'Pending Invite'}
              </Text>
              <TouchableOpacity
                onPress={() => setShowInviteModal(false)}
                style={styles.modalCloseButton}
              >
                <Ionicons name="close" size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <View style={styles.inviteDetails}>
              <View style={styles.inviteAvatarLarge}>
                {inviteModalSession?.invitedBy?.avatar ? (
                  <Image
                    source={{ uri: inviteModalSession.invitedBy.avatar }}
                    style={styles.inviteAvatarImage}
                  />
                ) : (
                  <Text style={styles.inviteAvatarText}>
                    {inviteModalSession?.initials}
                  </Text>
                )}
              </View>
              <Text style={styles.inviteSessionName}>
                {inviteModalSession?.name}
              </Text>
              {inviteModalSession?.type === 'received-invite' && (
                <Text style={styles.inviteFromText}>
                  {inviteModalSession?.invitedBy?.name || 'Someone'} invited you to collaborate
                </Text>
              )}
              {inviteModalSession?.type === 'sent-invite' && (
                <Text style={styles.inviteFromText}>
                  Waiting for response...
                </Text>
              )}
            </View>

            {inviteModalSession?.type === 'received-invite' ? (
              <View style={styles.inviteActions}>
                <TouchableOpacity
                  style={styles.modalDeclineButton}
                  onPress={() => {
                    if (inviteModalSession) {
                      onDeclineInvite(inviteModalSession.id);
                    }
                    setShowInviteModal(false);
                  }}
                >
                  <Ionicons name="person-remove" size={14} color="#DC2626" style={{ marginRight: 5 }} />
                  <Text style={styles.modalDeclineButtonText}>Decline Invite</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalAcceptButton}
                  onPress={() => {
                    if (inviteModalSession) {
                      onAcceptInvite(inviteModalSession.id);
                    }
                    setShowInviteModal(false);
                  }}
                >
                  <Ionicons name="checkmark-circle" size={14} color="#FFFFFF" style={{ marginRight: 5 }} />
                  <Text style={styles.modalAcceptButtonText}>Accept Invite</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.inviteActions}>
                <TouchableOpacity
                  style={styles.modalCancelInviteButton}
                  onPress={() => {
                    if (inviteModalSession) {
                      onCancelInvite(inviteModalSession.id);
                    }
                    setShowInviteModal(false);
                  }}
                >
                  <Text style={styles.modalCancelInviteButtonText}>Cancel Invite</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Session View Modal */}
      {sessionToView && (
        <SessionViewModal
          visible={showSessionViewModal}
          sessionId={sessionToView.id}
          sessionName={sessionToView.name}
          sessionInitials={sessionToView.initials}
          onClose={() => {
            setShowSessionViewModal(false);
            setSessionToView(null);
          }}
          onSessionDeleted={() => {
            setShowSessionViewModal(false);
            setSessionToView(null);
            onSoloSelect();
            onSessionStateChanged?.();
          }}
          onSessionExited={() => {
            setShowSessionViewModal(false);
            setSessionToView(null);
            onSoloSelect();
            onSessionStateChanged?.();
          }}
        />
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundColor: 'transparent',
    paddingVertical: 10,
    paddingHorizontal: 8,
    marginHorizontal: 12,
    gap: 6,
  },
  scrollViewWrapper: {
    flex: 1,
    overflow: 'hidden',
  },
  scrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  scrollArrowLeft: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  scrollArrowRight: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  pill: {
    minWidth: 36,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: '#FEF3E7',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
  },
  soloPill: {
    paddingHorizontal: 16,
    backgroundColor: '#eb7825',
    shadowColor: '#eb7825',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  createPill: {
    backgroundColor: '#eb7825',
    minWidth: 36,
    paddingHorizontal: 0,
    width: 36,
    shadowColor: '#eb7825',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  pillSelected: {
    backgroundColor: '#eb7825',
    shadowColor: '#eb7825',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  pillInvite: {
    backgroundColor: '#F3F4F6',
    borderColor: '#D1D5DB',
  },
  pillSentInvite: {
    opacity: 0.6,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
  },
  soloPillText: {
    fontWeight: '600',
    color: '#FFFFFF',
  },
  pillTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  pillTextInvite: {
    color: '#9CA3AF',
  },
  inviteBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#6B7280',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  inviteBadgePending: {
    backgroundColor: '#9CA3AF',
  },
  // Create session bottom sheet styles
  createSheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    justifyContent: 'flex-end',
  },
  createSheetBackdrop: {
    flex: 1,
  },
  createSheetContent: {
    height: SHEET_HEIGHT,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 6,
  },
  createDragHandleContainer: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 4,
  },
  createDragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
  },
  createSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  inviteSheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    justifyContent: 'flex-end',
  },
  inviteSheetBackdrop: {
    flex: 1,
  },
  inviteSheetContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 6,
  },
  inviteDragHandleContainer: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 8,
  },
  inviteDragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
  },
  inviteSheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    paddingBottom: 12,
    marginBottom: 12,
  },
  inviteSheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
    color: '#1e293b',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e293b',
    flex: 1,
    textAlign: 'center',
  },
  modalCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseButtonPlaceholder: {
    width: 36,
    height: 36,
  },
  modalLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#F9FAFB',
  },
  modalHint: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 12,
    marginBottom: 20,
  },
  modalCancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
  },
  modalCancelButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6B7280',
  },
  modalCreateButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#eb7825',
    alignItems: 'center',
  },
  modalCreateButtonDisabled: {
    backgroundColor: '#FDDCAB',
  },
  modalCreateButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  // Invite modal styles
  inviteDetails: {
    alignItems: 'center',
    paddingHorizontal: 12,
    marginBottom: 18,
  },
  inviteAvatarLarge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  inviteAvatarText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#374151',
  },
  inviteAvatarImage: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  inviteSessionName: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.15,
    color: '#111827',
    marginBottom: 4,
  },
  inviteFromText: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 2,
    lineHeight: 18,
  },
  inviteActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    marginBottom: 14,
  },
  modalDeclineButton: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalDeclineButtonText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.15,
    color: '#DC2626',
  },
  modalAcceptButton: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#eb7825',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalAcceptButtonText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.15,
    color: '#FFFFFF',
  },
  modalCancelInviteButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelInviteButtonText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.15,
    color: '#DC2626',
  },
  // Extended modal for create session with friends
  modalContentLarge: {
    width: screenWidth - 32,
    maxWidth: 400,
    maxHeight: '80%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    overflow: 'hidden',
  },
  modalScrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  modalActionsFixed: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  // Friend selection styles
  friendSelectionSection: {
    marginTop: 20,
  },
  // Inline phone input styles
  csPhoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    height: 46,
    overflow: 'hidden',
  },
  csCountryPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 10,
    paddingRight: 6,
    height: '100%',
  },
  csCountryFlag: {
    fontSize: 16,
    marginRight: 3,
  },
  csCountryDial: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginRight: 3,
  },
  csPhoneDivider: {
    width: 1,
    height: 22,
    backgroundColor: '#d1d5db',
  },
  csPhoneInput: {
    flex: 1,
    paddingHorizontal: 10,
    fontSize: 15,
    color: '#111827',
    height: '100%',
  },
  csLookupResult: {
    marginTop: 6,
  },
  csLookupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  csLookupTextGreen: {
    fontSize: 12,
    color: '#16a34a',
    fontWeight: '500',
  },
  csLookupTextMuted: {
    fontSize: 12,
    color: '#6b7280',
  },
  csStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  csStatusSuccess: {
    fontSize: 13,
    color: '#16a34a',
    fontWeight: '500',
  },
  csStatusError: {
    fontSize: 13,
    color: '#dc2626',
  },
  csActionButton: {
    flexDirection: 'row',
    backgroundColor: '#eb7825',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  csActionButtonDisabled: {
    opacity: 0.45,
  },
  csActionButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  csPhoneInviteesContainer: {
    marginTop: 10,
  },
  csPhoneInviteesLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: '#9CA3AF',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  csPhoneInviteesList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  csPhoneInviteePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    gap: 4,
  },
  csPhoneInviteePillText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#374151',
  },
  // Country picker modal
  csPickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  csPickerSheet: {
    backgroundColor: 'white',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
    maxHeight: '75%',
  },
  csPickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  csPickerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e293b',
  },
  csPickerSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  csPickerSearchInput: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    padding: 0,
  },
  csCountryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  csCountryRowSelected: {
    backgroundColor: '#fff7ed',
  },
  csCountryRowFlag: {
    fontSize: 18,
    marginRight: 10,
  },
  csCountryRowName: {
    flex: 1,
    fontSize: 14,
    color: '#111827',
  },
  csCountryRowDial: {
    fontSize: 13,
    color: '#6b7280',
  },
  selectedFriendsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  selectedFriendTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3E7',
    borderWidth: 1,
    borderColor: '#FDDCAB',
    borderRadius: 16,
    paddingLeft: 4,
    paddingRight: 8,
    paddingVertical: 4,
    gap: 6,
  },
  selectedFriendAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#eb7825',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  selectedFriendAvatarImage: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  selectedFriendAvatarText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  selectedFriendName: {
    fontSize: 13,
    fontWeight: '500',
    color: '#374151',
    maxWidth: 80,
  },
  removeFriendButton: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noFriendsContainer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  noFriendsText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6B7280',
    marginTop: 8,
  },
  noFriendsSubtext: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 4,
    textAlign: 'center',
  },
  friendsList: {
    gap: 8,
  },
  friendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  friendItemSelected: {
    borderColor: '#eb7825',
    backgroundColor: '#FEF3E7',
  },
  friendAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    overflow: 'hidden',
  },
  friendAvatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  friendAvatarText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  friendInfo: {
    flex: 1,
  },
  friendName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827',
  },
  friendUsername: {
    fontSize: 12,
    color: '#6B7280',
  },
  friendCheckmark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#eb7825',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
