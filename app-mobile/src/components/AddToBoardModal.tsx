import React, { useState } from 'react';
import { Text, View, StyleSheet, Modal, ScrollView } from 'react-native';
import { TrackedTouchableOpacity } from './TrackedTouchableOpacity';
import { Icon } from './ui/Icon';
import { getDisplayName } from '../utils/getDisplayName';
import { useTranslation } from 'react-i18next';
import { useAddFriendToSessions } from '../hooks/useAddFriendToSessions';
import type { AddFriendsToSessionsReturn } from '../services/sessionMembershipService';

interface Friend {
  id: string;
  name: string;
  username: string;
  avatar?: string;
  avatar_url?: string;
  status?: string;
  isOnline: boolean;
  lastSeen?: string;
  mutualFriends?: number;
  isMuted?: boolean;
}

interface CollaborationSession {
  id: string;
  name: string;
  status: 'pending' | 'active' | 'archived';
  participants: Friend[];
  createdBy: string;
  createdAt: string;
  lastActivity: string;
  hasCollabPreferences?: boolean;
  pendingParticipants: number;
  totalParticipants: number;
  boardCards: number;
  /** ORCH-0666: caller-scoped invitee IDs with pending invites; used to filter
   *  the picker so users don't try to re-add already-pending friends. */
  pendingInviteeIds?: string[];
}

interface AddToBoardModalProps {
  isOpen: boolean;
  onClose: () => void;
  friend: Friend | null;
  boardsSessions?: any[];
  /** ORCH-0666: refresh trigger called after mutation settles. */
  onMutationSettled?: () => void;
  /** ORCH-0666: forwards the aggregate result for parent-owned toast emission. */
  onResult?: (result: AddFriendsToSessionsReturn) => void;
}

// Helper to format relative time
const formatRelativeTime = (dateString: string | undefined, t: (key: string) => string): string => {
  if (!dateString) return t('common:unknown');
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return t('common:time_just_now');
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
};

export default function AddToBoardModal({
  isOpen,
  onClose,
  friend,
  boardsSessions = [],
  onMutationSettled,
  onResult,
}: AddToBoardModalProps) {
  const { t } = useTranslation(['modals', 'common']);
  const [selectedSessions, setSelectedSessions] = useState<string[]>([]);
  const [lastResult, setLastResult] = useState<AddFriendsToSessionsReturn | null>(null);

  const mutation = useAddFriendToSessions({
    onMutationSettled: () => {
      onMutationSettled?.();
    },
  });

  // Reset selections when modal opens/closes
  React.useEffect(() => {
    if (!isOpen) {
      setSelectedSessions([]);
      setLastResult(null);
    }
  }, [isOpen]);

  if (!isOpen || !friend) return null;

  // Transform boardsSessions to CollaborationSession format
  const sessions: CollaborationSession[] = (boardsSessions || []).map((board: any) => ({
    id: board.session_id || board.id,
    name: board.name || 'Unnamed Board',
    status: board.status || 'active',
    participants: (board.participants || []).map((p: any) => ({
      id: p.id || p.user_id,
      name: p.name || getDisplayName(p, t('common:unknown')),
      username: p.username || 'user',
      status: 'offline' as const,
      isOnline: false,
    })),
    createdBy: board.creatorId || board.created_by || 'unknown',
    createdAt: formatRelativeTime(board.createdAt || board.created_at, t),
    lastActivity: formatRelativeTime(board.lastActivity || board.last_activity || board.updated_at, t),
    hasCollabPreferences: board.hasCollabPreferences || false,
    pendingParticipants: board.pendingParticipants || 0,
    totalParticipants: board.participants?.length || 0,
    boardCards: board.cardsCount || board.cards_count || 0,
    pendingInviteeIds: board.pendingInviteeIds || [],
  }));

  // ORCH-0666: filter excludes friends who are already participants AND
  // friends with pending invites in the current user's outgoing invitations
  // (CF-2 close). Sessions must be in `pending` or `active` state — `archived`
  // and `ended` are excluded at UX layer (RPC also enforces server-side).
  const availableSessions = sessions.filter((session) => {
    const friendIsParticipant = session.participants.some((p) => p.id === friend.id);
    const friendHasPendingInvite = (session.pendingInviteeIds ?? []).includes(friend.id);
    const sessionIsValidStatus = session.status === 'active' || session.status === 'pending';
    return !friendIsParticipant && !friendHasPendingInvite && sessionIsValidStatus;
  });

  const handleAddToBoard = async (): Promise<void> => {
    if (selectedSessions.length === 0 || !friend) return;
    // Build sessionNames map for telemetry payload
    const sessionNames: Record<string, string> = {};
    for (const id of selectedSessions) {
      const s = sessions.find((ss) => ss.id === id);
      if (s) sessionNames[id] = s.name;
    }
    try {
      const result = await mutation.mutateAsync({
        sessionIds: selectedSessions,
        friendUserId: friend.id,
        sessionNames,
      });
      setLastResult(result);
      // Forward result to parent for toast emission (Constitution #2 single-owner).
      onResult?.(result);
      setSelectedSessions([]);
      // Close on full success or all-already-state. On any error, keep modal
      // open and render inline error UI.
      if (result.errors.length === 0) {
        onClose();
      }
    } catch (err: unknown) {
      // mutateAsync only throws if the mutationFn throws (rare — the service
      // catches loop errors internally). Treat as a full failure.
      console.error('[AddToBoardModal] mutation threw:', err);
      setLastResult({
        results: [],
        errors: selectedSessions.map((sid) => ({
          sessionId: sid,
          message: err instanceof Error ? err.message : 'Unknown error',
          errorCode: 'mutation_threw',
        })),
      });
    }
  };

  const handleSessionToggle = (sessionId: string): void => {
    setSelectedSessions((prev) =>
      prev.includes(sessionId) ? prev.filter((id) => id !== sessionId) : [...prev, sessionId]
    );
  };

  const handleSelectAll = (): void => {
    if (selectedSessions.length === availableSessions.length) {
      setSelectedSessions([]);
    } else {
      setSelectedSessions(availableSessions.map((session) => session.id));
    }
  };

  const getStatusStyle = (status: CollaborationSession['status']): object => {
    switch (status) {
      case 'active':
        return styles.statusBadgeActive;
      case 'pending':
        return styles.statusBadgePending;
      case 'archived':
        return styles.statusBadgeArchived;
      default:
        return styles.statusBadgeArchived;
    }
  };

  const getStatusTextStyle = (status: CollaborationSession['status']): object => {
    switch (status) {
      case 'active':
        return styles.statusTextActive;
      case 'pending':
        return styles.statusTextPending;
      case 'archived':
        return styles.statusTextArchived;
      default:
        return styles.statusTextArchived;
    }
  };

  const getStatusIcon = (status: CollaborationSession['status']): React.ReactElement => {
    switch (status) {
      case 'active':
        return <Icon name="people" size={12} color="#059669" />;
      case 'pending':
        return <Icon name="time" size={12} color="#d97706" />;
      case 'archived':
        return <Icon name="calendar" size={12} color="#6b7280" />;
      default:
        return <Icon name="alert-circle" size={12} color="#6b7280" />;
    }
  };

  const isAdding = mutation.isPending;
  const errorEntries = lastResult?.errors ?? [];

  return (
    <Modal
      visible={isOpen}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <TrackedTouchableOpacity
          logComponent="AddToBoardModal"
          style={styles.backdropTouch}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerContent}>
              <View style={styles.headerSidePlaceholder} />
              <View style={styles.headerCenter}>
                <Text style={styles.headerTitle}>{t('modals:add_to_board.title')}</Text>
                <Text style={styles.headerSubtitle}>
                  {t('modals:add_to_board.subtitle', { friendName: friend.name })}
                </Text>
              </View>
              <TrackedTouchableOpacity
                logComponent="AddToBoardModal"
                onPress={onClose}
                style={styles.closeButton}
              >
                <Icon name="close" size={20} color="#6b7280" />
              </TrackedTouchableOpacity>
            </View>
          </View>

          {/* Content */}
          <ScrollView style={styles.content}>
            {availableSessions.length === 0 ? (
              <View style={styles.emptyState}>
                <Icon name="people" size={48} color="#d1d5db" />
                <Text style={styles.emptyStateTitle}>{t('modals:add_to_board.no_boards_title')}</Text>
                <Text style={styles.emptyStateText}>
                  {t('modals:add_to_board.no_boards_text', { friendName: friend.name })}
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.selectionHeader}>
                  <Text style={styles.selectionText}>
                    {t('modals:add_to_board.select_boards', { friendName: friend.name })}
                  </Text>
                  <View style={styles.selectionControls}>
                    {selectedSessions.length > 0 && (
                      <View style={styles.selectionBadge}>
                        <Icon name="checkmark" size={12} color="#ea580c" />
                        <Text style={styles.selectionCount}>{selectedSessions.length}</Text>
                      </View>
                    )}
                    {availableSessions.length > 1 && (
                      <TrackedTouchableOpacity
                        logComponent="AddToBoardModal"
                        onPress={handleSelectAll}
                        style={styles.selectAllButton}
                      >
                        {selectedSessions.length === availableSessions.length ? (
                          <Icon name="close" size={12} color="#eb7825" />
                        ) : (
                          <Icon name="checkmark" size={12} color="#eb7825" />
                        )}
                        <Text style={styles.selectAllText}>{t('modals:add_to_board.all')}</Text>
                      </TrackedTouchableOpacity>
                    )}
                  </View>
                </View>

                {/* Inline error UI when the mutation surfaced any failures */}
                {errorEntries.length > 0 && (
                  <View style={styles.errorBanner}>
                    <Icon name="alert-circle" size={16} color="#dc2626" />
                    <Text style={styles.errorBannerText}>
                      {t('common:toast_invite_error')}
                    </Text>
                  </View>
                )}

                <View style={styles.sessionsList}>
                  {availableSessions.map((session) => (
                    <TrackedTouchableOpacity
                      logComponent="AddToBoardModal"
                      key={session.id}
                      style={[
                        styles.sessionCard,
                        selectedSessions.includes(session.id) && styles.sessionCardSelected,
                      ]}
                      onPress={() => handleSessionToggle(session.id)}
                    >
                      <View style={styles.sessionCardHeader}>
                        <View style={styles.sessionCardContent}>
                          <View style={styles.sessionCardTitleRow}>
                            <Text style={styles.sessionCardName}>{session.name}</Text>
                            <View style={[styles.statusBadge, getStatusStyle(session.status)]}>
                              {getStatusIcon(session.status)}
                              <Text style={[styles.statusText, getStatusTextStyle(session.status)]}>
                                {session.status}
                              </Text>
                            </View>
                          </View>

                          <View style={styles.sessionCardMeta}>
                            <View style={styles.metaItem}>
                              <Icon name="people" size={12} color="#6b7280" />
                              <Text style={styles.metaText}>
                                {t('modals:add_to_board.members_count', { count: session.totalParticipants })}
                              </Text>
                            </View>
                            <View style={styles.metaItem}>
                              <Icon name="calendar" size={12} color="#6b7280" />
                              <Text style={styles.metaText}>
                                {t('modals:add_to_board.cards_count', { count: session.boardCards })}
                              </Text>
                            </View>
                            <View style={styles.metaItem}>
                              <Icon name="time" size={12} color="#6b7280" />
                              <Text style={styles.metaText}>{session.lastActivity}</Text>
                            </View>
                          </View>
                        </View>

                        <View style={styles.sessionCardCheckbox}>
                          <View
                            style={[
                              styles.checkbox,
                              selectedSessions.includes(session.id) && styles.checkboxSelected,
                            ]}
                          >
                            {selectedSessions.includes(session.id) && (
                              <Icon name="checkmark" size={16} color="white" />
                            )}
                          </View>
                        </View>
                      </View>

                      {/* Participants Preview */}
                      <View style={styles.participantsPreview}>
                        <View style={styles.participantsAvatars}>
                          {session.participants.slice(0, 3).map((participant, index) => (
                            <View
                              key={participant.id}
                              style={[styles.participantAvatar, { marginLeft: index > 0 ? -8 : 0 }]}
                            >
                              <Text style={styles.participantAvatarText}>
                                {participant.name.split(' ').map((n) => n[0]).join('')}
                              </Text>
                            </View>
                          ))}
                          {session.participants.length > 3 && (
                            <View style={[styles.participantAvatar, styles.participantAvatarMore, { marginLeft: -8 }]}>
                              <Text style={styles.participantAvatarMoreText}>
                                +{session.participants.length - 3}
                              </Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.participantsLabel}>
                          {t('modals:add_to_board.current_members')}
                        </Text>
                      </View>
                    </TrackedTouchableOpacity>
                  ))}
                </View>
              </>
            )}
          </ScrollView>

          {/* Footer */}
          {availableSessions.length > 0 && (
            <View style={styles.footer}>
              <TrackedTouchableOpacity
                logComponent="AddToBoardModal"
                onPress={onClose}
                style={styles.cancelButton}
                disabled={isAdding}
              >
                <Text style={styles.cancelButtonText}>{t('modals:add_to_board.cancel')}</Text>
              </TrackedTouchableOpacity>
              <TrackedTouchableOpacity
                logComponent="AddToBoardModal"
                onPress={handleAddToBoard}
                disabled={selectedSessions.length === 0 || isAdding}
                style={[
                  styles.addButton,
                  (selectedSessions.length === 0 || isAdding) && styles.addButtonDisabled,
                ]}
              >
                {isAdding ? (
                  <>
                    <View style={styles.loadingSpinner} />
                    <Text style={styles.addButtonText}>{t('modals:add_to_board.adding')}</Text>
                  </>
                ) : (
                  <Text style={styles.addButtonText}>
                    {selectedSessions.length === 0
                      ? t('modals:add_to_board.select_boards_button')
                      : selectedSessions.length === 1
                      ? t('modals:add_to_board.add_to_board_button')
                      : t('modals:add_to_board.add_to_boards_button', { count: selectedSessions.length })}
                  </Text>
                )}
              </TrackedTouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  backdropTouch: {
    ...StyleSheet.absoluteFillObject,
  },
  modalContainer: {
    backgroundColor: 'white',
    borderRadius: 24,
    width: '100%',
    maxWidth: 400,
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 16,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e293b',
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginTop: 2,
    textAlign: 'center',
  },
  friendName: {
    fontWeight: '500',
    color: '#eb7825',
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
  content: {
    padding: 24,
    maxHeight: 384,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#111827',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
  },
  selectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  selectionText: {
    fontSize: 14,
    color: '#6b7280',
    flex: 1,
  },
  selectionControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fed7aa',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  selectionCount: {
    fontSize: 12,
    fontWeight: '500',
    color: '#ea580c',
    minWidth: 16,
    textAlign: 'center',
  },
  selectAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  selectAllText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#eb7825',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: '#dc2626',
  },
  sessionsList: {
    gap: 12,
  },
  sessionCard: {
    padding: 16,
    borderWidth: 2,
    borderRadius: 16,
    borderColor: '#e5e7eb',
    backgroundColor: 'white',
  },
  sessionCardSelected: {
    borderColor: '#eb7825',
    backgroundColor: '#fef3e2',
  },
  sessionCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sessionCardContent: {
    flex: 1,
  },
  sessionCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  sessionCardName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusBadgeActive: {
    backgroundColor: '#dcfce7',
  },
  statusBadgePending: {
    backgroundColor: '#fef3c7',
  },
  statusBadgeArchived: {
    backgroundColor: '#f3f4f6',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  statusTextActive: {
    color: '#059669',
  },
  statusTextPending: {
    color: '#d97706',
  },
  statusTextArchived: {
    color: '#6b7280',
  },
  sessionCardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    color: '#6b7280',
  },
  sessionCardCheckbox: {
    marginLeft: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#d1d5db',
    backgroundColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: '#eb7825',
    borderColor: '#eb7825',
  },
  participantsPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  participantsAvatars: {
    flexDirection: 'row',
  },
  participantAvatar: {
    width: 24,
    height: 24,
    backgroundColor: '#eb7825',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
  },
  participantAvatarMore: {
    backgroundColor: '#d1d5db',
  },
  participantAvatarText: {
    fontSize: 10,
    color: 'white',
    fontWeight: '500',
  },
  participantAvatarMoreText: {
    fontSize: 10,
    color: '#6b7280',
    fontWeight: '500',
  },
  participantsLabel: {
    fontSize: 12,
    color: '#6b7280',
  },
  footer: {
    padding: 24,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#374151',
  },
  addButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#eb7825',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  addButtonDisabled: {
    opacity: 0.5,
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: 'white',
  },
  loadingSpinner: {
    width: 16,
    height: 16,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    borderTopColor: 'white',
    borderRadius: 8,
  },
});
