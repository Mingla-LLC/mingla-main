import React, { useState } from 'react';
import { Text, View, TouchableOpacity, StyleSheet, Modal, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Participant {
  id: string;
  name: string;
  status: string;
  lastActive?: string;
}

interface BoardMemberManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  board: {
    id: string;
    name: string;
    participants: Participant[];
    admins: string[];
    currentUserId: string;
    creatorId: string;
  };
  onPromoteToAdmin: (participantId: string) => void;
  onDemoteFromAdmin: (participantId: string) => void;
  onRemoveMember: (participantId: string) => void;
  onLeaveBoard: () => void;
}

export default function BoardMemberManagementModal({
  isOpen,
  onClose,
  board,
  onPromoteToAdmin,
  onDemoteFromAdmin,
  onRemoveMember,
  onLeaveBoard
}: BoardMemberManagementModalProps) {
  const [confirmAction, setConfirmAction] = useState<{
    type: 'remove' | 'leave' | 'demote';
    participantId?: string;
    participantName?: string;
  } | null>(null);

  if (!isOpen) return null;

  const isCurrentUserAdmin = board.admins.includes(board.currentUserId);
  const isCurrentUserCreator = board.creatorId === board.currentUserId;

  const handlePromoteToAdmin = (participantId: string) => {
    onPromoteToAdmin(participantId);
    setConfirmAction(null);
  };

  const handleDemoteFromAdmin = (participantId: string) => {
    if (confirmAction?.type === 'demote' && confirmAction.participantId === participantId) {
      onDemoteFromAdmin(participantId);
      setConfirmAction(null);
    } else {
      const participant = board.participants.find(p => p.id === participantId);
      setConfirmAction({
        type: 'demote',
        participantId,
        participantName: participant?.name
      });
    }
  };

  const handleRemoveMember = (participantId: string) => {
    if (confirmAction?.type === 'remove' && confirmAction.participantId === participantId) {
      onRemoveMember(participantId);
      setConfirmAction(null);
    } else {
      const participant = board.participants.find(p => p.id === participantId);
      setConfirmAction({
        type: 'remove',
        participantId,
        participantName: participant?.name
      });
    }
  };

  const handleLeaveBoard = () => {
    if (confirmAction?.type === 'leave') {
      onLeaveBoard();
      setConfirmAction(null);
      onClose();
    } else {
      setConfirmAction({ type: 'leave' });
    }
  };

  return (
    <Modal
      visible={isOpen}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerContent}>
            <View>
              <Text style={styles.headerTitle}>Manage Board</Text>
              <Text style={styles.headerSubtitle}>{board.name}</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={16} color="#6b7280" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Members List */}
        <ScrollView style={styles.membersList}>
          <View style={styles.membersContainer}>
            {board.participants.map((participant) => {
              const isAdmin = board.admins.includes(participant.id);
              const isCreator = board.creatorId === participant.id;
              const isCurrentUser = participant.id === board.currentUserId;
              
              return (
                <View key={participant.id} style={styles.memberItem}>
                  <View style={styles.memberInfo}>
                    <View style={styles.memberAvatar}>
                      <Text style={styles.memberAvatarText}>
                        {participant.name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.memberDetails}>
                      <View style={styles.memberNameRow}>
                        <Text style={styles.memberName}>
                          {participant.name}
                          {isCurrentUser && ' (You)'}
                        </Text>
                        {isCreator && (
                          <View style={styles.creatorBadge}>
                            <Ionicons name="star" size={12} color="white" />
                            <Text style={styles.badgeText}>Creator</Text>
                          </View>
                        )}
                        {isAdmin && !isCreator && (
                          <View style={styles.adminBadge}>
                            <Ionicons name="shield" size={12} color="white" />
                            <Text style={styles.badgeText}>Admin</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.memberStatus}>{participant.status}</Text>
                    </View>
                  </View>

                  {/* Action buttons - only show if current user is admin and it's not themselves */}
                  {isCurrentUserAdmin && !isCurrentUser && (
                    <View style={styles.actionButtons}>
                      {!isAdmin && (
                        <TouchableOpacity
                          onPress={() => handlePromoteToAdmin(participant.id)}
                          style={styles.promoteButton}
                        >
                          <Ionicons name="shield-checkmark" size={16} color="#eb7825" />
                        </TouchableOpacity>
                      )}
                      
                      {isAdmin && !isCreator && (
                        <TouchableOpacity
                          onPress={() => handleDemoteFromAdmin(participant.id)}
                          style={styles.demoteButton}
                        >
                          <Ionicons name="shield" size={16} color="#6b7280" />
                        </TouchableOpacity>
                      )}
                      
                      {!isCreator && (
                        <TouchableOpacity
                          onPress={() => handleRemoveMember(participant.id)}
                          style={styles.removeButton}
                        >
                          <Ionicons name="person-remove" size={16} color="#eb7825" />
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          {/* Board info */}
          <View style={styles.boardInfo}>
            <View style={styles.boardInfoHeader}>
              <Ionicons name="people" size={16} color="#eb7825" />
              <Text style={styles.boardInfoTitle}>Board Info</Text>
            </View>
            <View style={styles.boardInfoContent}>
              <Text style={styles.boardInfoText}>Total Members: {board.participants.length}</Text>
              <Text style={styles.boardInfoText}>Admins: {board.admins.length}</Text>
              {board.participants.length <= 2 && (
                <View style={styles.warningBox}>
                  <Ionicons name="warning" size={16} color="#d97706" />
                  <Text style={styles.warningText}>
                    Board will be deleted if any member leaves (minimum 2 members required)
                  </Text>
                </View>
              )}
            </View>
          </View>
        </ScrollView>

        {/* Actions */}
        <View style={styles.actions}>
          {confirmAction ? (
            <View style={styles.confirmContainer}>
              {confirmAction.type === 'remove' && (
                <View style={styles.removeConfirm}>
                  <Text style={styles.confirmText}>
                    Remove <Text style={styles.confirmBold}>{confirmAction.participantName}</Text> from this board?
                  </Text>
                  <View style={styles.confirmButtons}>
                    <TouchableOpacity
                      onPress={() => handleRemoveMember(confirmAction.participantId!)}
                      style={styles.confirmButton}
                    >
                      <Text style={styles.confirmButtonText}>Remove Member</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setConfirmAction(null)}
                      style={styles.cancelConfirmButton}
                    >
                      <Text style={styles.cancelConfirmButtonText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {confirmAction.type === 'demote' && (
                <View style={styles.demoteConfirm}>
                  <Text style={styles.demoteConfirmText}>
                    Remove admin privileges from <Text style={styles.confirmBold}>{confirmAction.participantName}</Text>?
                  </Text>
                  <View style={styles.confirmButtons}>
                    <TouchableOpacity
                      onPress={() => handleDemoteFromAdmin(confirmAction.participantId!)}
                      style={styles.demoteConfirmButton}
                    >
                      <Text style={styles.demoteButtonText}>Remove Admin</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setConfirmAction(null)}
                      style={styles.cancelConfirmButton}
                    >
                      <Text style={styles.cancelConfirmButtonText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {confirmAction.type === 'leave' && (
                <View style={styles.leaveConfirm}>
                  <Text style={styles.leaveConfirmTitle}>
                    <Text style={styles.confirmBold}>Leave this board?</Text>
                  </Text>
                  <View style={styles.leaveConfirmDetails}>
                    {isCurrentUserAdmin && board.admins.length === 1 && board.participants.length > 2 && (
                      <Text style={styles.leaveConfirmDetail}>• Another member will be randomly assigned as admin</Text>
                    )}
                    {board.participants.length <= 2 && (
                      <Text style={styles.leaveConfirmDetail}>• Board will be permanently deleted (less than 2 members remaining)</Text>
                    )}
                    <Text style={styles.leaveConfirmDetail}>• This action cannot be undone</Text>
                  </View>
                  <View style={styles.confirmButtons}>
                    <TouchableOpacity
                      onPress={handleLeaveBoard}
                      style={styles.leaveButton}
                    >
                      <Text style={styles.leaveButtonText}>Leave Board</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setConfirmAction(null)}
                      style={styles.cancelConfirmButton}
                    >
                      <Text style={styles.cancelConfirmButtonText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          ) : (
            <TouchableOpacity
              onPress={handleLeaveBoard}
              style={styles.leaveBoardButton}
            >
              <Ionicons name="person-remove" size={16} color="#dc2626" />
              <Text style={styles.leaveBoardButtonText}>Leave Board</Text>
            </TouchableOpacity>
          )}
        </View>
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
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
  closeButton: {
    width: 32,
    height: 32,
    backgroundColor: '#f3f4f6',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  membersList: {
    flex: 1,
    padding: 24,
  },
  membersContainer: {
    gap: 16,
  },
  memberItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    backgroundColor: '#f9fafb',
    borderRadius: 12,
  },
  memberInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    backgroundColor: '#eb7825',
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
  memberDetails: {
    flex: 1,
  },
  memberNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#111827',
  },
  creatorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#eb7825',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  adminBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#eb7825',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 12,
    color: 'white',
    fontWeight: '500',
  },
  memberStatus: {
    fontSize: 12,
    color: '#6b7280',
    textTransform: 'capitalize',
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  promoteButton: {
    width: 32,
    height: 32,
    backgroundColor: 'rgba(235, 120, 37, 0.1)',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  demoteButton: {
    width: 32,
    height: 32,
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeButton: {
    width: 32,
    height: 32,
    backgroundColor: 'rgba(235, 120, 37, 0.1)',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boardInfo: {
    marginTop: 24,
    padding: 16,
    backgroundColor: 'rgba(235, 120, 37, 0.1)',
    borderRadius: 12,
  },
  boardInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  boardInfoTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#d6691f',
  },
  boardInfoContent: {
    gap: 4,
  },
  boardInfoText: {
    fontSize: 14,
    color: '#eb7825',
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    padding: 8,
    backgroundColor: '#fef3c7',
    borderRadius: 8,
  },
  warningText: {
    fontSize: 12,
    color: '#d97706',
    flex: 1,
  },
  actions: {
    padding: 24,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  confirmContainer: {
    gap: 12,
  },
  removeConfirm: {
    padding: 12,
    backgroundColor: '#fef2f2',
    borderRadius: 12,
  },
  confirmText: {
    fontSize: 14,
    color: '#dc2626',
    marginBottom: 12,
  },
  confirmBold: {
    fontWeight: '600',
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  confirmButton: {
    flex: 1,
    backgroundColor: '#dc2626',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: 'white',
  },
  cancelConfirmButton: {
    flex: 1,
    backgroundColor: '#e5e7eb',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelConfirmButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
  },
  demoteConfirm: {
    padding: 12,
    backgroundColor: '#fef3c7',
    borderRadius: 12,
  },
  demoteConfirmText: {
    fontSize: 14,
    color: '#d97706',
    marginBottom: 12,
  },
  demoteConfirmButton: {
    flex: 1,
    backgroundColor: '#d97706',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  demoteButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: 'white',
  },
  leaveConfirm: {
    padding: 12,
    backgroundColor: '#fef2f2',
    borderRadius: 12,
  },
  leaveConfirmTitle: {
    fontSize: 14,
    color: '#dc2626',
    marginBottom: 8,
  },
  leaveConfirmDetails: {
    gap: 4,
    marginBottom: 12,
  },
  leaveConfirmDetail: {
    fontSize: 12,
    color: '#dc2626',
  },
  leaveButton: {
    flex: 1,
    backgroundColor: '#dc2626',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaveButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: 'white',
  },
  leaveBoardButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: '#fecaca',
    borderRadius: 12,
  },
  leaveBoardButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#dc2626',
  },
});