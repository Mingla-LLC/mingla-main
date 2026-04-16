/**
 * ORCH-0437: Tag-along interest request banner.
 * Slides in from top, accept/decline, auto-dismiss after 30s.
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../ui/Icon';
import { colors, glass } from '../../constants/designSystem';
import type { TagAlongRequestWithSender } from '../../types/leaderboard';

interface TagAlongBannerProps {
  request: TagAlongRequestWithSender;
  onAccept: (requestId: string) => void;
  onDecline: (requestId: string) => void;
  isAccepting: boolean;
}

export function TagAlongBanner({
  request,
  onAccept,
  onDecline,
  isAccepting,
}: TagAlongBannerProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(-120);
  const opacity = useSharedValue(0);
  const autoDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Entry animation
    translateY.value = withSpring(0, { damping: 18, stiffness: 140 });
    opacity.value = withTiming(1, { duration: 200 });

    // Auto-dismiss after 30s
    autoDismissTimer.current = setTimeout(() => {
      dismiss(() => onDecline(request.id));
    }, 30000);

    return () => {
      if (autoDismissTimer.current) clearTimeout(autoDismissTimer.current);
    };
  }, []);

  const dismiss = (callback: () => void): void => {
    translateY.value = withTiming(-120, { duration: 250 });
    opacity.value = withTiming(0, { duration: 250 });
    setTimeout(() => callback(), 260);
  };

  const handleAccept = (): void => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (autoDismissTimer.current) clearTimeout(autoDismissTimer.current);
    onAccept(request.id);
  };

  const handleDecline = (): void => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (autoDismissTimer.current) clearTimeout(autoDismissTimer.current);
    dismiss(() => onDecline(request.id));
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[styles.container, { marginTop: insets.top + 8 }, animatedStyle]}>
      <View style={styles.content}>
        {request.sender_avatar_url ? (
          <Image source={{ uri: request.sender_avatar_url }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitials}>{(request.sender_display_name || 'U').charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <View style={styles.textArea}>
          <Text style={styles.title} numberOfLines={1}>
            <Text style={styles.titleBold}>{request.sender_display_name}</Text>
            {' '}(Level {request.sender_level}) wants to tag along
          </Text>
          {request.sender_status && (
            <Text style={styles.subtitle} numberOfLines={1}>
              {request.sender_status}
            </Text>
          )}
        </View>
      </View>
      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={styles.declineButton}
          onPress={handleDecline}
          activeOpacity={0.7}
          accessibilityLabel={`Decline tag along from ${request.sender_display_name}`}
          accessibilityRole="button"
        >
          <Text style={styles.declineText}>Decline</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.acceptButton}
          onPress={handleAccept}
          activeOpacity={0.7}
          disabled={isAccepting}
          accessibilityLabel={`Accept tag along from ${request.sender_display_name}`}
          accessibilityRole="button"
        >
          <Icon name="sparkles" size={12} color="#fff" />
          <Text style={styles.acceptText}>{isAccepting ? 'Accepting...' : 'Accept'}</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    ...glass.leaderboard.banner,
    ...glass.shadow,
    padding: 12,
    zIndex: 50,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarFallback: {
    backgroundColor: colors.primary[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary[700],
  },
  textArea: {
    flex: 1,
  },
  title: {
    fontSize: 13,
    fontWeight: '400',
    color: colors.text.primary,
  },
  titleBold: {
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.gray[500],
    marginTop: 1,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  declineButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.gray[100],
  },
  declineText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.gray[600],
  },
  acceptButton: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  acceptText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
});
