import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Icon } from '../ui/Icon';
import { chatTokens } from '../../constants/chatTokens';

interface ReplyPreviewBarProps {
  senderName: string;
  previewText: string;
  isOwnMessage: boolean;
  onClose: () => void;
  /** Issue #4114 Wave 3: the dark chat screen passes `dark`; other hosts keep light. */
  theme?: 'light' | 'dark';
  closeLabel?: string;
}

/**
 * Preview bar shown above the message input when replying to a message.
 * Shows the sender name, truncated message preview, and close button.
 */
export function ReplyPreviewBar({
  senderName,
  previewText,
  isOwnMessage,
  onClose,
  theme = 'light',
  closeLabel = 'Cancel reply',
}: ReplyPreviewBarProps): React.ReactElement {
  const dark = theme === 'dark';
  return (
    <View style={[styles.container, dark && styles.containerDark]}>
      <View style={[styles.accentBar, isOwnMessage ? styles.accentBarOwn : styles.accentBarOther]} />
      <View style={styles.content}>
        <Text style={[styles.senderName, dark && styles.senderNameDark]} numberOfLines={1}>
          {senderName}
        </Text>
        <Text style={[styles.previewText, dark && styles.previewTextDark]} numberOfLines={1}>
          {previewText}
        </Text>
      </View>
      <TouchableOpacity
        onPress={onClose}
        style={styles.closeButton}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        accessibilityLabel={closeLabel}
        accessibilityRole="button"
      >
        <Icon name="close" size={18} color={dark ? chatTokens.textSoft : '#9ca3af'} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#ffffff',
  },
  containerDark: {
    borderTopWidth: 0,
    backgroundColor: 'transparent',
  },
  senderNameDark: {
    color: chatTokens.textPrimary,
  },
  previewTextDark: {
    color: chatTokens.textSoft,
  },
  accentBar: {
    width: 3,
    height: '100%',
    minHeight: 32,
    borderRadius: 2,
    marginRight: 10,
  },
  accentBarOwn: {
    backgroundColor: '#eb7825',
  },
  accentBarOther: {
    backgroundColor: '#d1d5db',
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  senderName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  previewText: {
    fontSize: 13,
    color: '#6B6B6B',
    marginTop: 1,
  },
  closeButton: {
    padding: 4,
    marginLeft: 8,
  },
});
