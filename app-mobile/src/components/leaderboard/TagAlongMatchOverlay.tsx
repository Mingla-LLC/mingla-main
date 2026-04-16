/**
 * ORCH-0437: Match celebration overlay.
 * Full-screen overlay when a tag-along is accepted by both sides.
 */

import React, { useEffect } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Dimensions, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Icon } from '../ui/Icon';
import { colors, glass } from '../../constants/designSystem';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface TagAlongMatchOverlayProps {
  visible: boolean;
  yourAvatarUrl: string | null;
  theirAvatarUrl: string | null;
  theirName: string;
  sessionId: string;
  onGoToSession: (sessionId: string) => void;
}

export function TagAlongMatchOverlay({
  visible,
  yourAvatarUrl,
  theirAvatarUrl,
  theirName,
  sessionId,
  onGoToSession,
}: TagAlongMatchOverlayProps): React.ReactElement | null {
  const overlayOpacity = useSharedValue(0);
  const cardScale = useSharedValue(0.8);
  const cardOpacity = useSharedValue(0);
  const headlineOpacity = useSharedValue(0);
  const ctaTranslateY = useSharedValue(20);
  const ctaOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Choreographed entry
      overlayOpacity.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.ease) });
      cardScale.value = withDelay(100, withSpring(1, { damping: 16, stiffness: 140 }));
      cardOpacity.value = withDelay(100, withTiming(1, { duration: 300 }));
      headlineOpacity.value = withDelay(450, withTiming(1, { duration: 200 }));
      ctaOpacity.value = withDelay(650, withTiming(1, { duration: 250 }));
      ctaTranslateY.value = withDelay(650, withTiming(0, { duration: 250, easing: Easing.out(Easing.ease) }));
    } else {
      overlayOpacity.value = withTiming(0, { duration: 200 });
      cardScale.value = 0.8;
      cardOpacity.value = 0;
      headlineOpacity.value = 0;
      ctaOpacity.value = 0;
      ctaTranslateY.value = 20;
    }
  }, [visible]);

  const handleGoToSession = (): void => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onGoToSession(sessionId);
  };

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cardScale.value }],
    opacity: cardOpacity.value,
  }));

  const headlineStyle = useAnimatedStyle(() => ({
    opacity: headlineOpacity.value,
  }));

  const ctaStyle = useAnimatedStyle(() => ({
    opacity: ctaOpacity.value,
    transform: [{ translateY: ctaTranslateY.value }],
  }));

  if (!visible) return null;

  return (
    <Animated.View style={[styles.overlay, overlayStyle]}>
      <Pressable style={StyleSheet.absoluteFillObject} onPress={handleGoToSession} />
      <Animated.View style={[styles.card, cardStyle]}>
        {/* Avatars */}
        <View style={styles.avatarRow}>
          {yourAvatarUrl ? (
            <Image source={{ uri: yourAvatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitials}>You</Text>
            </View>
          )}
          <Icon name="swap-horizontal" size={20} color={colors.accent} />
          {theirAvatarUrl ? (
            <Image source={{ uri: theirAvatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitials}>{(theirName || 'U').charAt(0).toUpperCase()}</Text>
            </View>
          )}
        </View>

        {/* Headline */}
        <Animated.View style={headlineStyle}>
          <Text style={styles.headline}>Let's explore together!</Text>
          <Text style={styles.subtext}>Your preferences have been shared.</Text>
        </Animated.View>

        {/* CTA */}
        <Animated.View style={ctaStyle}>
          <TouchableOpacity
            style={styles.ctaButton}
            onPress={handleGoToSession}
            activeOpacity={0.8}
            accessibilityLabel={`Go to session with ${theirName}`}
            accessibilityRole="button"
          >
            <Text style={styles.ctaText}>Go to Session</Text>
            <Icon name="arrow-forward" size={14} color="#fff" />
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    zIndex: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: SCREEN_WIDTH - 64,
    ...glass.leaderboard.matchCard,
    padding: 32,
    alignItems: 'center',
    ...glass.shadow,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 3,
    borderColor: colors.accent,
  },
  avatarFallback: {
    backgroundColor: colors.primary[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.primary[700],
  },
  headline: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text.primary,
    textAlign: 'center',
    marginTop: 20,
  },
  subtext: {
    fontSize: 14,
    fontWeight: '400',
    color: colors.gray[500],
    textAlign: 'center',
    marginTop: 8,
  },
  ctaButton: {
    marginTop: 24,
    backgroundColor: colors.accent,
    borderRadius: 14,
    height: 48,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
  },
  ctaText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
});
