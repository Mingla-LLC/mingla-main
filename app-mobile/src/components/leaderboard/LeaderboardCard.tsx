/**
 * ORCH-0437: Individual leaderboard user card.
 * Compact 88px glass card with slide-to-interest gesture.
 */

import React, { useCallback, useMemo } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Icon } from '../ui/Icon';
import { ActivityRing } from './ActivityRing';
import { colors, glass } from '../../constants/designSystem';
import type { LeaderboardUser, ProximityTier } from '../../types/leaderboard';

const CATEGORY_ICONS: Record<string, string> = {
  'Nature & Views': 'leaf-outline',
  'Icebreakers': 'sparkles',
  'Drinks & Music': 'wine-outline',
  'Brunch Lunch & Casual': 'fast-food-outline',
  'Upscale & Fine Dining': 'restaurant-outline',
  'Movies & Theatre': 'film-outline',
  'Creative & Arts': 'color-palette-outline',
  'Play': 'game-controller-outline',
  'Wellness': 'body-outline',
  'Flowers': 'flower-outline',
  'Drink': 'wine-outline',
  'Nature': 'leaf-outline',
  'Picnic Park': 'basket-outline',
  'First Meet': 'chatbubbles-outline',
  'Live Performance': 'musical-notes-outline',
  'Watch': 'film-outline',
  'Fine Dining': 'restaurant-outline',
  'Casual Eats': 'fast-food-outline',
};

const PROXIMITY_COLORS: Record<ProximityTier, string> = {
  very_close: colors.success[500],
  nearby: colors.primary[500],
  in_your_area: colors.warning[500],
  further_out: colors.gray[400],
  far_away: colors.gray[300],
};

const PROXIMITY_LABELS: Record<ProximityTier, string> = {
  very_close: 'Very close',
  nearby: 'Nearby',
  in_your_area: 'In your area',
  further_out: 'Further out',
  far_away: 'Far away',
};

interface LeaderboardCardProps {
  user: LeaderboardUser;
  interestSent: boolean;
  onSendInterest: (userId: string) => void;
  isSending: boolean;
  cardWidth: number;
}

export function LeaderboardCard({
  user,
  interestSent,
  onSendInterest,
  isSending,
  cardWidth,
}: LeaderboardCardProps): React.ReactElement {
  const translateX = useSharedValue(0);
  const hasTriggeredHaptic = useSharedValue(false);
  const threshold40 = cardWidth * 0.4;
  const threshold75 = cardWidth * 0.75;

  const handleSend = useCallback((): void => {
    if (!interestSent) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSendInterest(user.user_id);
    }
  }, [interestSent, onSendInterest, user.user_id]);

  const triggerHapticTick = useCallback((): void => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const panGesture = useMemo(() => Gesture.Pan()
    .activeOffsetX(15)
    .failOffsetY([-10, 10])
    .enabled(!interestSent)
    .onUpdate((e) => {
      if (e.translationX < 0) return; // right-only
      translateX.value = e.translationX;
      if (e.translationX >= threshold40 && !hasTriggeredHaptic.value) {
        hasTriggeredHaptic.value = true;
        runOnJS(triggerHapticTick)();
      }
    })
    .onEnd((e) => {
      if (e.translationX >= threshold75) {
        translateX.value = withSpring(0, { damping: 15, stiffness: 150 });
        runOnJS(handleSend)();
      } else {
        translateX.value = withSpring(0, { damping: 15, stiffness: 150 });
      }
      hasTriggeredHaptic.value = false;
    }),
  [interestSent, threshold40, threshold75, handleSend, triggerHapticTick, translateX, hasTriggeredHaptic]);

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const behindCardStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [0, threshold40], [0, 1], Extrapolation.CLAMP),
  }));

  const proxColor = PROXIMITY_COLORS[user.proximity_tier];
  const seatColor = user.available_seats >= 2 ? colors.success[600] : colors.warning[600];
  const activeMinLabel = user.active_for_minutes < 60
    ? `${user.active_for_minutes} min`
    : `${Math.floor(user.active_for_minutes / 60)}h ${user.active_for_minutes % 60}m`;

  const cardOpacity = interestSent ? glass.leaderboard.cardSent.opacity : 1;

  return (
    <View style={styles.outerWrapper}>
      {/* Behind-card surface (revealed on slide) */}
      <Animated.View style={[styles.behindCard, behindCardStyle]}>
        <Icon name="sparkles" size={16} color="#fff" />
        <Text style={styles.behindCardText}>Tag Along</Text>
      </Animated.View>

      {/* Main card */}
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.card, cardAnimatedStyle, { opacity: cardOpacity }]}>
          {/* Left: Avatar with ring */}
          <ActivityRing size={44} swipeCount={user.swipe_count} isActive={user.parsed_swiped_category !== null}>
            {user.avatar_url ? (
              <Image source={{ uri: user.avatar_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitials}>
                  {(user.display_name || 'U').charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </ActivityRing>

          {/* Content area */}
          <View style={styles.content}>
            {/* Row 1: Name + Level + Proximity */}
            <View style={styles.topRow}>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1}>{user.display_name}</Text>
                <View style={styles.levelPill}>
                  <Text style={styles.levelText}>Lvl {user.user_level}</Text>
                </View>
              </View>
              <View style={styles.proximityRow}>
                <View style={[styles.proximityDot, { backgroundColor: proxColor }]} />
                <Text style={[styles.proximityText, { color: proxColor }]}>
                  {PROXIMITY_LABELS[user.proximity_tier]}
                </Text>
              </View>
            </View>

            {/* Row 2: Status */}
            {user.activity_status && (
              <View style={styles.statusRow}>
                <Icon name="search-outline" size={12} color={colors.accent} />
                <Text style={styles.statusText} numberOfLines={1}>{user.activity_status}</Text>
              </View>
            )}

            {/* Row 3: Categories + Seats + Active time */}
            <View style={styles.bottomRow}>
              <View style={styles.categoriesRow}>
                {user.preference_categories.slice(0, 4).map((cat) => (
                  <Icon
                    key={cat}
                    name={CATEGORY_ICONS[cat] || 'ellipse-outline'}
                    size={16}
                    color={user.parsed_swiped_category === cat ? colors.accent : colors.gray[400]}
                  />
                ))}
                {user.available_seats > 0 && (
                  <>
                    <Text style={styles.separator}>·</Text>
                    <Text style={[styles.seatText, { color: seatColor }]}>
                      {user.available_seats} seat{user.available_seats !== 1 ? 's' : ''}
                    </Text>
                  </>
                )}
              </View>
              <Text style={styles.activeTime}>Active for {activeMinLabel}</Text>
            </View>
          </View>
        </Animated.View>
      </GestureDetector>

      {/* Interest button (below card content) */}
      <View style={[styles.buttonWrapper, interestSent && styles.buttonWrapperSent]}>
        <TouchableOpacity
          style={[styles.interestButton, interestSent && styles.interestButtonSent]}
          onPress={() => !interestSent && onSendInterest(user.user_id)}
          disabled={interestSent || isSending}
          activeOpacity={0.8}
          accessibilityLabel={interestSent ? `Interest sent to ${user.display_name}` : `Indicate interest in ${user.display_name}`}
          accessibilityRole={interestSent ? 'text' : 'button'}
        >
          {isSending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Icon
                name={interestSent ? 'checkmark' : 'sparkles'}
                size={14}
                color={interestSent ? colors.gray[500] : '#fff'}
              />
              <Text style={[styles.interestButtonText, interestSent && styles.interestButtonTextSent]}>
                {interestSent ? 'Interest Sent' : 'Indicate Interest'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerWrapper: {
    marginHorizontal: 16,
    marginBottom: 10,
    position: 'relative',
  },
  behindCard: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 88,
    backgroundColor: colors.accent,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingRight: 24,
    gap: 6,
  },
  behindCardText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  card: {
    height: 88,
    ...glass.leaderboard.card,
    ...glass.shadowLight,
    padding: 12,
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
  content: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  name: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text.primary,
    maxWidth: 120,
  },
  levelPill: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  levelText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#92400e',
  },
  proximityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  proximityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  proximityText: {
    fontSize: 11,
    fontWeight: '600',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.gray[600],
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  categoriesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  separator: {
    fontSize: 11,
    color: colors.gray[300],
    marginHorizontal: 2,
  },
  seatText: {
    fontSize: 11,
    fontWeight: '600',
  },
  activeTime: {
    fontSize: 10,
    fontWeight: '500',
    color: colors.gray[400],
  },
  buttonWrapper: {
    marginTop: 4,
  },
  buttonWrapperSent: {
    opacity: 0.55,
  },
  interestButton: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  interestButtonSent: {
    backgroundColor: colors.gray[100],
  },
  interestButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  interestButtonTextSent: {
    color: colors.gray[500],
  },
});
