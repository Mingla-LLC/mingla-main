import React, { useState, useRef, useEffect } from 'react';
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
  Image
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mixpanelService } from '../services/mixpanelService';
import SessionViewModal from './SessionViewModal';
import AddFriendModal from './AddFriendModal';
import { supabase } from '../services/supabase';

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
  onCreateSession: (sessionName: string, selectedFriends: Friend[]) => void;
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
  const [showAddFriendModal, setShowAddFriendModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showSessionViewModal, setShowSessionViewModal] = useState(false);
  const [sessionToView, setSessionToView] = useState<CollaborationSession | null>(null);
  const [inviteModalSession, setInviteModalSession] = useState<CollaborationSession | null>(null);
  const [newSessionName, setNewSessionName] = useState('');
  const [selectedFriends, setSelectedFriends] = useState<Friend[]>([]);
  const [friendSearchQuery, setFriendSearchQuery] = useState('');
  const [isSendingFriendRequest, setIsSendingFriendRequest] = useState(false);
  const [contentWidth, setContentWidth] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const lastHandledInviteTriggerNonce = useRef<number | null>(null);

  const isSoloMode = currentMode === 'solo';

  // Filter friends based on search query
  const filteredFriends = availableFriends.filter(friend =>
    friend.name.toLowerCase().includes(friendSearchQuery.toLowerCase()) ||
    (friend.username && friend.username.toLowerCase().includes(friendSearchQuery.toLowerCase()))
  );

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
      onCreateSession(newSessionName.trim(), selectedFriends);
      setNewSessionName('');
      setSelectedFriends([]);
      setFriendSearchQuery('');
      setShowCreateModal(false);
    }
  };

  const handleCloseCreateModal = () => {
    setNewSessionName('');
    setSelectedFriends([]);
    setFriendSearchQuery('');
    setShowCreateModal(false);
  };

  const handleAddTypedUserAsFriend = async () => {
    const typedUsername = friendSearchQuery.trim().replace(/^@+/, '');

    if (!typedUsername) {
      Alert.alert('Enter a username', 'Type a username first to send a friend request.');
      return;
    }

    setIsSendingFriendRequest(true);

    try {
      const { data: authData } = await supabase.auth.getUser();
      const currentUser = authData.user;

      if (!currentUser) {
        Alert.alert('Sign in required', 'Please sign in and try again.');
        return;
      }

      const { data: targetProfile, error: targetError } = await supabase
        .from('profiles')
        .select('id, username')
        .ilike('username', typedUsername)
        .maybeSingle();

      if (targetError) {
        throw targetError;
      }

      if (!targetProfile) {
        Alert.alert('User not found', 'No user was found with that username.');
        return;
      }

      if (targetProfile.id === currentUser.id) {
        Alert.alert('Invalid user', 'You cannot add yourself as a friend.');
        return;
      }

      const { data: existingFriend, error: existingFriendError } = await supabase
        .from('friends')
        .select('id')
        .eq('user_id', currentUser.id)
        .eq('friend_user_id', targetProfile.id)
        .eq('status', 'accepted')
        .maybeSingle();

      if (existingFriendError) {
        throw existingFriendError;
      }

      if (existingFriend) {
        Alert.alert('Already friends', `@${targetProfile.username} is already in your friends list.`);
        return;
      }

      const { data: existingRequest, error: existingRequestError } = await supabase
        .from('friend_requests')
        .select('id, status, sender_id, receiver_id')
        .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${targetProfile.id}),and(sender_id.eq.${targetProfile.id},receiver_id.eq.${currentUser.id})`)
        .in('status', ['pending', 'accepted'])
        .maybeSingle();

      if (existingRequestError) {
        throw existingRequestError;
      }

      if (existingRequest?.status === 'pending') {
        const alreadySentByYou = existingRequest.sender_id === currentUser.id;
        Alert.alert(
          'Request already pending',
          alreadySentByYou
            ? `A friend request to @${targetProfile.username} is already pending.`
            : `@${targetProfile.username} already sent you a friend request. Please accept it first.`
        );
        return;
      }

      const { error: insertError } = await supabase
        .from('friend_requests')
        .insert({
          sender_id: currentUser.id,
          receiver_id: targetProfile.id,
          status: 'pending',
        });

      if (insertError) {
        throw insertError;
      }

      Alert.alert(
        'Friend request sent',
        `@${targetProfile.username} is not your friend yet. For safety, please come back and add them after they accept your request.`
      );
    } catch (error: any) {
      Alert.alert('Unable to send request', error?.message || 'Please try again.');
    } finally {
      setIsSendingFriendRequest(false);
    }
  };

  const canCreateSession = newSessionName.trim().length > 0 && selectedFriends.length > 0 && !isCreatingSession;

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

      {/* Scrollable pills */}
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
        {/* Solo pill */}
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

        {/* Create new session pill */}
        <TouchableOpacity
          style={[styles.pill, styles.createPill]}
          onPress={() => setShowCreateModal(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="add" size={16} color="#FFFFFF" />
        </TouchableOpacity>

        {/* Session pills */}
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
          <View style={[styles.createSheetContent, { paddingBottom: insets.bottom }]}>
            {/* Drag Handle */}
            <View style={styles.createDragHandleContainer}>
              <View style={styles.createDragHandle} />
            </View>

            <View style={styles.createSheetHeader}>
              <View style={styles.modalCloseButtonPlaceholder} />
              <Text style={styles.modalTitle}>Create New Session</Text>
              <View style={styles.modalCloseButtonPlaceholder} />
            </View>

            <ScrollView style={styles.modalScrollContent} showsVerticalScrollIndicator={false}>
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

              {/* Friend Selection Section */}
              <View style={styles.friendSelectionSection}>
                <Text style={styles.modalLabel}>Invite Collaborators</Text>

                <TouchableOpacity
                  style={styles.addFriendInlineButton}
                  onPress={() => setShowAddFriendModal(true)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="person-add" size={16} color="#eb7825" />
                  <Text style={styles.addFriendInlineButtonText}>Add Friend</Text>
                </TouchableOpacity>
                
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

                {/* Friend Search */}
                <View style={styles.friendSearchContainer}>
                  <Ionicons name="search" size={16} color="#9CA3AF" style={styles.friendSearchIcon} />
                  <TextInput
                    style={styles.friendSearchInput}
                    placeholder="Search friends..."
                    value={friendSearchQuery}
                    onChangeText={setFriendSearchQuery}
                    placeholderTextColor="#9CA3AF"
                  />
                </View>

                {/* Friends List */}
                {availableFriends.length === 0 ? (
                  <View style={styles.noFriendsContainer}>
                    <Ionicons name="people-outline" size={32} color="#D1D5DB" />
                    <Text style={styles.noFriendsText}>No friends available</Text>
                    <Text style={styles.noFriendsSubtext}>
                      Add friends to invite them to sessions
                    </Text>
                  </View>
                ) : filteredFriends.length === 0 ? (
                  <View style={styles.noFriendsContainer}>
                    <Ionicons name="search-outline" size={32} color="#D1D5DB" />
                    <Text style={styles.noFriendsText}>No matches found</Text>

                    {friendSearchQuery.trim().length > 0 && (
                      <View style={styles.notFriendNoticeCard}>
                        <Text style={styles.notFriendNoticeTitle}>
                          This person is not your friend
                        </Text>
                        <Text style={styles.notFriendNoticeText}>
                          Add them as a friend first, then come back and add them as a collaborator after they accept. This is for safety purposes.
                        </Text>
                        <TouchableOpacity
                          style={[
                            styles.addFriendNoticeButton,
                            isSendingFriendRequest && styles.addFriendNoticeButtonDisabled,
                          ]}
                          onPress={handleAddTypedUserAsFriend}
                          disabled={isSendingFriendRequest}
                        >
                          {isSendingFriendRequest ? (
                            <ActivityIndicator size="small" color="#FFFFFF" />
                          ) : (
                            <Text style={styles.addFriendNoticeButtonText}>
                              Add @{friendSearchQuery.trim().replace(/^@+/, '')} as Friend
                            </Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                ) : (
                  <View style={styles.friendsList}>
                    {filteredFriends.map((friend) => {
                      const isSelected = selectedFriends.some(f => f.id === friend.id);
                      const initials = friend.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
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
                            {friend.username && (
                              <Text style={styles.friendUsername}>@{friend.username}</Text>
                            )}
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
          <View style={[styles.inviteSheetContent, { paddingBottom: insets.bottom }]}>
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

      <AddFriendModal
        isOpen={showAddFriendModal}
        onClose={() => setShowAddFriendModal(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundColor: 'transparent',
    paddingVertical: 0,
    paddingHorizontal: 8,
    marginVertical: 6,
    marginHorizontal: 12,
  },
  scrollViewWrapper: {
    flex: 1,
    overflow: 'hidden',
  },
  scrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
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
    backgroundColor: '#F3F4F6',
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
  addFriendInlineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#FDDCAB',
    backgroundColor: '#FEF3E7',
    borderRadius: 10,
    paddingVertical: 10,
    marginBottom: 12,
  },
  addFriendInlineButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#eb7825',
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
  friendSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  friendSearchIcon: {
    marginRight: 8,
  },
  friendSearchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
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
  notFriendNoticeCard: {
    marginTop: 12,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FDDCAB',
    borderRadius: 12,
    padding: 12,
    width: '100%',
  },
  notFriendNoticeTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9A3412',
    marginBottom: 4,
  },
  notFriendNoticeText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#7C2D12',
    marginBottom: 10,
  },
  addFriendNoticeButton: {
    backgroundColor: '#eb7825',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addFriendNoticeButtonDisabled: {
    opacity: 0.6,
  },
  addFriendNoticeButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
