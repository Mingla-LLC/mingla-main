import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  Share,
  Clipboard,
} from 'react-native';
import { Icon } from './ui/Icon';
import { spacing, colors, typography, fontWeights, radius, shadows } from '../constants/designSystem';
import { useHapticFeedback } from '../utils/hapticFeedback';
import { useKeyboard } from '../hooks/useKeyboard';

interface SessionInvite {
  id: string;
  sessionId: string;
  inviterName: string;
  inviterAvatar?: string;
  sessionName: string;
  participantCount: number;
  maxParticipants: number;
  expiresAt: Date;
  isExpired: boolean;
}

interface SessionSharingProps {
  sessionId: string;
  sessionName: string;
  currentParticipants: number;
  maxParticipants: number;
  onInviteSent?: (inviteId: string) => void;
  onInviteAccepted?: (inviteId: string) => void;
}

export const SessionSharing: React.FC<SessionSharingProps> = ({
  sessionId,
  sessionName,
  currentParticipants,
  maxParticipants,
  onInviteSent,
  onInviteAccepted,
}) => {
  const haptic = useHapticFeedback();
  const { keyboardHeight } = useKeyboard({ disableLayoutAnimation: true });
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [inviteMessage, setInviteMessage] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const generateInviteLink = async (): Promise<string> => {
    // In a real app, this would call your backend API
    const baseUrl = 'https://mingla.app/invite';
    const inviteCode = Math.random().toString(36).substring(2, 15);
    return `${baseUrl}/${inviteCode}`;
  };

  const handleShareInvite = async () => {
    if (currentParticipants >= maxParticipants) {
      Alert.alert(
        'Session Full',
        'This session has reached the maximum number of participants.',
        [{ text: 'OK' }]
      );
      return;
    }

    setIsGenerating(true);
    haptic.share();

    try {
      const inviteLink = await generateInviteLink();
      const message = inviteMessage || `Join my Mingla session: ${sessionName}`;
      const shareContent = `${message}\n\n${inviteLink}`;

      const result = await Share.share({
        message: shareContent,
        title: `Invite to ${sessionName}`,
      });

      if (result.action === Share.sharedAction) {
        onInviteSent?.(inviteLink);
        setIsModalVisible(false);
        setInviteMessage('');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to share invite. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      const inviteLink = await generateInviteLink();
      await Clipboard.setString(inviteLink);
      haptic.success();
      Alert.alert('Copied!', 'Invite link copied to clipboard.');
    } catch (error) {
      Alert.alert('Error', 'Failed to copy link. Please try again.');
    }
  };

  return (
    <>
      <TouchableOpacity
        style={styles.shareButton}
        onPress={() => setIsModalVisible(true)}
        activeOpacity={0.8}
      >
        <Icon name="share-outline" size={20} color={colors.primary[500]} />
        <Text style={styles.shareButtonText}>Share Session</Text>
      </TouchableOpacity>

      <Modal
        visible={isModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setIsModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Share Session</Text>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setIsModalVisible(false)}
            >
              <Icon name="close" size={24} color={colors.text.primary} />
            </TouchableOpacity>
          </View>

          <View style={styles.modalContent}>
            <View style={styles.sessionInfo}>
              <Text style={styles.sessionName}>{sessionName}</Text>
              <Text style={styles.participantCount}>
                {currentParticipants} of {maxParticipants} participants
              </Text>
            </View>

            <View style={styles.inviteMessageContainer}>
              <Text style={styles.inviteMessageLabel}>Invite Message (Optional)</Text>
              <TextInput
                style={styles.inviteMessageInput}
                value={inviteMessage}
                onChangeText={setInviteMessage}
                placeholder="Add a personal message..."
                multiline
                maxLength={200}
                textAlignVertical="top"
              />
              <Text style={styles.characterCount}>
                {inviteMessage.length}/200
              </Text>
            </View>

            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={[styles.actionButton, styles.copyButton]}
                onPress={handleCopyLink}
                activeOpacity={0.8}
              >
                <Icon name="copy-outline" size={20} color={colors.primary[500]} />
                <Text style={styles.copyButtonText}>Copy Link</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.actionButton,
                  styles.shareActionButton,
                  isGenerating && styles.disabledButton,
                ]}
                onPress={handleShareInvite}
                disabled={isGenerating}
                activeOpacity={0.8}
              >
                {isGenerating ? (
                  <Text style={styles.shareButtonText}>Generating...</Text>
                ) : (
                  <>
                    <Icon name="share-outline" size={20} color={colors.background.primary} />
                    <Text style={styles.shareActionButtonText}>Share Invite</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
            {keyboardHeight > 0 && <View style={{ height: keyboardHeight }} />}
          </View>
        </View>
      </Modal>
    </>
  );
};

// Invite acceptance component
interface InviteAcceptanceProps {
  invite: SessionInvite;
  onAccept: (inviteId: string) => void;
  onDecline: (inviteId: string) => void;
}

export const InviteAcceptance: React.FC<InviteAcceptanceProps> = ({
  invite,
  onAccept,
  onDecline,
}) => {
  const haptic = useHapticFeedback();

  const handleAccept = () => {
    haptic.success();
    onAccept(invite.id);
  };

  const handleDecline = () => {
    haptic.selection();
    onDecline(invite.id);
  };

  if (invite.isExpired) {
    return (
      <View style={styles.expiredInvite}>
        <Icon name="time-outline" size={24} color={colors.error[500]} />
        <Text style={styles.expiredText}>This invite has expired</Text>
      </View>
    );
  }

  return (
    <View style={styles.inviteCard}>
      <View style={styles.inviteHeader}>
        <View style={styles.inviterInfo}>
          <View style={styles.avatarPlaceholder}>
            <Icon name="person" size={20} color={colors.text.secondary} />
          </View>
          <View>
            <Text style={styles.inviterName}>{invite.inviterName}</Text>
            <Text style={styles.inviteLabel}>invited you to join</Text>
          </View>
        </View>
      </View>

      <View style={styles.sessionDetails}>
        <Text style={styles.sessionName}>{invite.sessionName}</Text>
        <Text style={styles.participantInfo}>
          {invite.participantCount} of {invite.maxParticipants} participants
        </Text>
      </View>

      <View style={styles.inviteActions}>
        <TouchableOpacity
          style={[styles.inviteButton, styles.declineButton]}
          onPress={handleDecline}
          activeOpacity={0.8}
        >
          <Text style={styles.declineButtonText}>Decline</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.inviteButton, styles.acceptButton]}
          onPress={handleAccept}
          activeOpacity={0.8}
        >
          <Text style={styles.acceptButtonText}>Accept</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.primary[50],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary[200],
  },
  shareButtonText: {
    ...typography.sm,
    color: colors.primary[500],
    fontWeight: fontWeights.medium,
    marginLeft: spacing.xs,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[200],
  },
  modalTitle: {
    ...typography.lg,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  closeButton: {
    padding: spacing.xs,
  },
  modalContent: {
    flex: 1,
    padding: spacing.lg,
  },
  sessionInfo: {
    marginBottom: spacing.xl,
  },
  sessionName: {
    ...typography.lg,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  participantCount: {
    ...typography.sm,
    color: colors.text.secondary,
  },
  inviteMessageContainer: {
    marginBottom: spacing.xl,
  },
  inviteMessageLabel: {
    ...typography.sm,
    fontWeight: fontWeights.medium,
    color: colors.text.primary,
    marginBottom: spacing.sm,
  },
  inviteMessageInput: {
    borderWidth: 1,
    borderColor: colors.gray[300],
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 80,
    ...typography.sm,
    color: colors.text.primary,
  },
  characterCount: {
    ...typography.xs,
    color: colors.text.secondary,
    textAlign: 'right',
    marginTop: spacing.xs,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    gap: spacing.xs,
  },
  copyButton: {
    backgroundColor: colors.background.secondary,
    borderWidth: 1,
    borderColor: colors.primary[200],
  },
  copyButtonText: {
    ...typography.sm,
    color: colors.primary[500],
    fontWeight: fontWeights.medium,
  },
  shareActionButton: {
    backgroundColor: colors.primary[500],
  },
  shareActionButtonText: {
    ...typography.sm,
    color: colors.background.primary,
    fontWeight: fontWeights.medium,
  },
  disabledButton: {
    opacity: 0.6,
  },
  expiredInvite: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.error[50],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error[200],
  },
  expiredText: {
    ...typography.sm,
    color: colors.error[500],
    marginLeft: spacing.sm,
  },
  inviteCard: {
    backgroundColor: colors.background.primary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.md,
  },
  inviteHeader: {
    marginBottom: spacing.md,
  },
  inviterInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.gray[200],
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  inviterName: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  inviteLabel: {
    ...typography.xs,
    color: colors.text.secondary,
  },
  sessionDetails: {
    marginBottom: spacing.lg,
  },
  participantInfo: {
    ...typography.sm,
    color: colors.text.secondary,
    marginTop: spacing.xs,
  },
  inviteActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  inviteButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  declineButton: {
    backgroundColor: colors.background.secondary,
    borderWidth: 1,
    borderColor: colors.gray[300],
  },
  declineButtonText: {
    ...typography.sm,
    color: colors.text.secondary,
    fontWeight: fontWeights.medium,
  },
  acceptButton: {
    backgroundColor: colors.primary[500],
  },
  acceptButtonText: {
    ...typography.sm,
    color: colors.background.primary,
    fontWeight: fontWeights.medium,
  },
});
