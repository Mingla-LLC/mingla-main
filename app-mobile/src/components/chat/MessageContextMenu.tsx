import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
  Dimensions,
  Clipboard,
  Modal,
} from 'react-native';
import { Icon } from '../ui/Icon';
import * as Haptics from 'expo-haptics';
import { colors } from '../../constants/designSystem';

const EMOJI_OPTIONS = ['❤️', '😂', '👍', '😮', '😢', '🔥'];
const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface MessageContextMenuProps {
  visible: boolean;
  onClose: () => void;
  position: { top: number };
  messageId: string;
  messageContent: string;
  isOwnMessage: boolean;
  existingReactions?: string[];
  onReaction: (messageId: string, emoji: string) => void;
  onReply: (messageId: string) => void;
  onCopy: (content: string) => void;
  onEdit?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
}

export function MessageContextMenu({
  visible,
  onClose,
  position,
  messageId,
  messageContent,
  isOwnMessage,
  existingReactions = [],
  onReaction,
  onReply,
  onCopy,
  onEdit,
  onDelete,
}: MessageContextMenuProps): React.ReactElement {
  const scale = useRef(new Animated.Value(0.9)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      scale.setValue(0.9);
      opacity.setValue(0);
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 24, bounciness: 3 }),
        Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, scale, opacity]);

  const dismiss = (): void => {
    Animated.parallel([
      Animated.timing(scale, { toValue: 0.95, duration: 80, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 80, useNativeDriver: true }),
    ]).start(() => onClose());
  };

  const act = (fn: () => void): void => { fn(); onClose(); };

  const menuHeight = 92;
  const showAbove = position.top > menuHeight + 80;
  const rawTop = showAbove ? position.top - menuHeight - 8 : position.top + 8;
  const clampedTop = Math.max(50, Math.min(rawTop, SCREEN_HEIGHT - menuHeight - 50));

  // Action icons
  const actions: { icon: string; color: string; onPress: () => void; label: string }[] = [
    { icon: 'arrow-undo-outline', color: colors.gray[500], onPress: () => act(() => onReply(messageId)), label: 'Reply' },
    { icon: 'copy-outline', color: colors.gray[500], onPress: () => act(() => {
      try { Clipboard.setString(messageContent); } catch (e) { console.error(e); }
      onCopy(messageContent);
    }), label: 'Copy' },
  ];
  if (isOwnMessage && onEdit) {
    actions.push({ icon: 'create-outline', color: colors.gray[500], onPress: () => act(() => onEdit(messageId)), label: 'Edit' });
  }
  if (isOwnMessage && onDelete) {
    actions.push({ icon: 'trash-outline', color: '#EF4444', onPress: () => act(() => onDelete(messageId)), label: 'Delete' });
  }

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={dismiss}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={dismiss}>
        <Animated.View style={[styles.menu, { top: clampedTop, transform: [{ scale }], opacity }]}>
          {/* Emoji row */}
          <View style={styles.emojiRow}>
            {EMOJI_OPTIONS.map((emoji) => (
              <TouchableOpacity
                key={emoji}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onReaction(messageId, emoji);
                  onClose();
                }}
                style={[styles.emojiBtn, existingReactions.includes(emoji) && styles.emojiBtnUsed]}
              >
                <Text style={styles.emojiText}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Action icons — small, no text, aligned left */}
          <View style={styles.actionRow}>
            {actions.map((a) => (
              <TouchableOpacity
                key={a.icon}
                style={styles.actionBtn}
                onPress={a.onPress}
                accessibilityLabel={a.label}
              >
                <Icon name={a.icon} size={16} color={a.color} />
              </TouchableOpacity>
            ))}
          </View>
        </Animated.View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  menu: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  emojiRow: {
    flexDirection: 'row',
    gap: 6,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[200],
  },
  emojiBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiBtnUsed: {
    backgroundColor: '#FFF0E8',
  },
  emojiText: {
    fontSize: 20,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    gap: 6,
    paddingTop: 8,
  },
  actionBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
});
