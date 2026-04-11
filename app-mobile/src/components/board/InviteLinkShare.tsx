import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Share,
} from 'react-native';
import { Icon } from '../ui/Icon';
import { Clipboard } from 'react-native';
import { useTranslation } from 'react-i18next';

interface InviteLinkShareProps {
  inviteLink: string;
  inviteCode?: string;
}

export const InviteLinkShare: React.FC<InviteLinkShareProps> = ({
  inviteLink,
  inviteCode,
}) => {
  const { t } = useTranslation(['board', 'common']);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    try {
      Clipboard.setString(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      Alert.alert(t('board:inviteLinkShare.copied'), t('board:inviteLinkShare.copiedMsg'));
    } catch (error) {
      console.error('Failed to copy link:', error);
      Alert.alert(t('board:inviteLinkShare.error'), t('board:inviteLinkShare.errorCopy'));
    }
  };

  const handleShare = async () => {
    try {
      const result = await Share.share({
        message: t('board:inviteLinkShare.shareMessage', { link: inviteLink }),
        url: inviteLink,
      });
    } catch (error: any) {
      if (error.message !== 'User did not share') {
        Alert.alert(t('board:inviteLinkShare.error'), t('board:inviteLinkShare.errorShare'));
      }
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('board:inviteLinkShare.shareInviteLink')}</Text>
      <Text style={styles.description}>
        {t('board:inviteLinkShare.description')}
      </Text>

      <View style={styles.linkContainer}>
        <Text style={styles.linkText} numberOfLines={1} ellipsizeMode="middle">
          {inviteLink}
        </Text>
      </View>

      {inviteCode && (
        <View style={styles.codeContainer}>
          <Text style={styles.codeLabel}>{t('board:inviteLinkShare.orShareCode')}</Text>
          <Text style={styles.codeText}>{inviteCode}</Text>
        </View>
      )}

      <View style={styles.actionsContainer}>
        <TouchableOpacity
          style={[styles.actionButton, styles.copyButton]}
          onPress={handleCopy}
        >
          <Icon
            name={copied ? 'checkmark' : 'copy-outline'}
            size={20}
            color="white"
          />
          <Text style={styles.actionButtonText}>
            {copied ? t('board:inviteLinkShare.copied') : t('board:inviteLinkShare.copyLink')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, styles.shareButton]}
          onPress={handleShare}
        >
          <Icon name="share-outline" size={20} color="white" />
          <Text style={styles.actionButtonText}>{t('board:inviteLinkShare.share')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
  },
  linkContainer: {
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  linkText: {
    fontSize: 14,
    color: '#1a1a1a',
    fontFamily: 'monospace',
  },
  codeContainer: {
    backgroundColor: '#E3F2FD',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    alignItems: 'center',
  },
  codeLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
  },
  codeText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#007AFF',
    letterSpacing: 2,
  },
  actionsContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  copyButton: {
    backgroundColor: '#007AFF',
  },
  shareButton: {
    backgroundColor: '#34C759',
  },
  actionButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});

