import React, { useState, useRef, useEffect } from 'react';
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  TextInput,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Dimensions,
  ActivityIndicator,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SessionViewModal from './SessionViewModal';

const { width: screenWidth } = Dimensions.get('window');

// Types
export type SessionType = 'active' | 'sent-invite' | 'received-invite';

export interface Friend {
  id: string;
  name: string;f
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
  availableFriends?: Friend[];
  isCreatingSession?: boolean;
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
  availableFriends = [],
  isCreatingSession = false,
}: CollaborationSessionsProps) {
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
  const [friendSearchQuery, setFriendSearchQuery] = useState('');
  const [contentWidth, setContentWidth] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);

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
    }
  };

  const handleCreateSession = () => {
    if (newSessionName.trim()) {
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

  const scrollLeft = () => {
    scrollViewRef.current?.scrollTo({ x: 0, animated: true });
  };

  const scrollRight = () => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  };

  const renderPill = (session: CollaborationSession) => {
    const isSelected = selectedSessionId === session.id && !isSoloMode;
    const isInvite = session.type === 'sent-invite' || session.type === 'received-invite';

    return (
      <TouchableOpacity
        key={session.id}
        style={[
          styles.pill,
          isInvite && styles.pillInvite,
          isSelected && styles.pillSelected,
        ]}
        onPress={() => handlePillClick(session)}
        activeOpacity={0.7}
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
          <View style={styles.inviteBadge}>
            <Ionicons
              name={session.type === 'received-invite' ? 'mail' : 'paper-plane'}
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
          onPress={onSoloSelect}
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
        animationType="fade"
        onRequestClose={handleCloseCreateModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentLarge}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create New Session</Text>
              <TouchableOpacity
                onPress={handleCloseCreateModal}
                style={styles.modalCloseButton}
              >
                <Ionicons name="close" size={20} color="#6B7280" />
              </TouchableOpacity>
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
                  </View>
                ) : (
                  <View style={styles.friendsList}>
                    {filteredFriends.map((friend) => {
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
                style={styles.modalCancelButton}
                onPress={handleCloseCreateModal}
              >
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalCreateButton,
                  (!newSessionName.trim() || isCreatingSession) && styles.modalCreateButtonDisabled,
                ]}
                onPress={handleCreateSession}
                disabled={!newSessionName.trim() || isCreatingSession}
              >
                {isCreatingSession ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalCreateButtonText}>
                    {selectedFriends.length > 0
                      ? `Create & Invite (${selectedFriends.length})`
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
        animationType="fade"
        onRequestClose={() => setShowInviteModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
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
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.modalDeclineButton}
                  onPress={() => {
                    if (inviteModalSession) {
                      onDeclineInvite(inviteModalSession.id);
                    }
                    setShowInviteModal(false);
                  }}
                >
                  <Ionicons name="person-remove" size={16} color="#DC2626" style={{ marginRight: 6 }} />
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
                  <Ionicons name="checkmark-circle" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                  <Text style={styles.modalAcceptButtonText}>Accept Invite</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.modalActions}>
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
            // The parent will handle refreshing sessions
          }}
          onSessionExited={() => {
            setShowSessionViewModal(false);
            setSessionToView(null);
            // The parent will handle refreshing sessions
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
    backgroundColor: '#FFFFFF',
    paddingVertical: 0,
    paddingHorizontal: 4,
    marginVertical: 10,
    marginHorizontal: 17,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 12,
    },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 12,
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
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  scrollArrowRight: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  pill: {
    minWidth: 32,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
    borderColor: '#e5e7eb',
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.95,
    shadowRadius: 20,
    elevation: 12,
  },
  soloPill: {
    paddingHorizontal: 14,
    backgroundColor: '#eb7825',
    shadowColor: '#eb7825',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.95,
    shadowRadius: 20,
    elevation: 12,
  },
  createPill: {
    backgroundColor: '#eb7825',
    minWidth: 32,
    paddingHorizontal: 0,
    width: 32,
    shadowColor: '#eb7825',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.95,
    shadowRadius: 20,
    elevation: 12,
  },
  pillSelected: {
    backgroundColor: '#eb7825',
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.95,
    shadowRadius: 20,
    elevation: 12,
  },
  pillInvite: {
    backgroundColor: '#F3F4F6',
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
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: screenWidth - 48,
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  modalCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
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
  modalActions: {
    flexDirection: 'row',
    gap: 12,
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
    marginBottom: 24,
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
    fontSize: 22,
    fontWeight: '700',
    color: '#374151',
  },
  inviteAvatarImage: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  inviteSessionName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  inviteFromText: {
    fontSize: 14,
    color: '#6B7280',
  },
  modalDeclineButton: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalDeclineButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#DC2626',
  },
  modalAcceptButton: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#eb7825',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalAcceptButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  modalCancelInviteButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
  },
  modalCancelInviteButtonText: {
    fontSize: 15,
    fontWeight: '600',
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
    paddingHorizontal: 24,
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
  },
  selectedFriendAvatarText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  selectedFriendAvatarImage: {
    width: 24,
    height: 24,
    borderRadius: 12,
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
  },
  friendAvatarText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  friendAvatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
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
