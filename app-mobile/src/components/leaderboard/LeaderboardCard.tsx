/**
 * ORCH-0437: Leaderboard user card.
 * Premium white card. Orange-only color scheme. Shows all user selections.
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
import { colors } from '../../constants/designSystem';
import type { LeaderboardUser, ProximityTier } from '../../types/leaderboard';

const CATEGORY_ICONS: Record<string, string> = {
  'Nature & Views': 'leaf-outline', 'nature': 'leaf-outline',
  'Icebreakers': 'sparkles', 'icebreakers': 'sparkles',
  'Drinks & Music': 'wine-outline', 'drinks_and_music': 'wine-outline',
  'Brunch Lunch & Casual': 'fast-food-outline', 'brunch_lunch_casual': 'fast-food-outline',
  'Upscale & Fine Dining': 'restaurant-outline', 'upscale_fine_dining': 'restaurant-outline',
  'Movies & Theatre': 'film-outline', 'movies_theatre': 'film-outline',
  'Creative & Arts': 'color-palette-outline', 'creative_arts': 'color-palette-outline',
  'Play': 'game-controller-outline', 'play': 'game-controller-outline',
  // Intents
  'adventurous': 'compass-outline',
  'first-date': 'heart-outline',
  'romantic': 'rose-outline',
  'group-fun': 'people-outline',
  'picnic-dates': 'basket-outline',
  'take-a-stroll': 'walk-outline',
};

const PILL_LABELS: Record<string, string> = {
  'Nature & Views': 'Nature', 'nature': 'Nature',
  'Icebreakers': 'Icebreakers', 'icebreakers': 'Icebreakers',
  'Drinks & Music': 'Drinks', 'drinks_and_music': 'Drinks',
  'Brunch Lunch & Casual': 'Casual', 'brunch_lunch_casual': 'Casual',
  'Upscale & Fine Dining': 'Dining', 'upscale_fine_dining': 'Dining',
  'Movies & Theatre': 'Movies', 'movies_theatre': 'Movies',
  'Creative & Arts': 'Arts', 'creative_arts': 'Arts',
  'Play': 'Play', 'play': 'Play',
  'adventurous': 'Adventurous',
  'first-date': 'First Date',
  'romantic': 'Romantic',
  'group-fun': 'Group Fun',
  'picnic-dates': 'Picnic',
  'take-a-stroll': 'Stroll',
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
      if (e.translationX < 0) return;
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

  const activeMinLabel = user.active_for_minutes < 60
    ? `Active ${user.active_for_minutes}m`
    : `Active ${Math.floor(user.active_for_minutes / 60)}h`;

  return (
    <View style={styles.outerWrapper}>
      {/* Behind-card */}
      <Animated.View style={[styles.behindCard, behindCardStyle]}>
        <Icon name="hand-right" size={20} color="#fff" />
        <Text style={styles.behindCardText}>Interested</Text>
      </Animated.View>

      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.card, cardAnimatedStyle, interestSent && styles.cardSent]}>

          {/* ── Row 1: Identity ── */}
          <View style={styles.identityRow}>
            {user.avatar_url ? (
              <Image source={{ uri: user.avatar_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitials}>
                  {(user.display_name || 'U').charAt(0).toUpperCase()}
                </Text>
              </View>
            )}

            <View style={styles.identityInfo}>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1}>{user.display_name}</Text>
                <View style={styles.levelBadge}>
                  <Icon name="trophy" size={8} color={colors.accent} />
                  <Text style={styles.levelText}>Lvl {user.user_level}</Text>
                </View>
              </View>

              {user.activity_status && (
                <View style={styles.statusRow}>
                  <Icon name="hand-right-outline" size={12} color={colors.accent} />
                  <Text style={styles.statusText} numberOfLines={1}>{user.activity_status}</Text>
                </View>
              )}

              {/* Meta: proximity + active + seats */}
              <View style={styles.metaRow}>
                <View style={styles.metaPill}>
                  <Icon name="location-outline" size={10} color={colors.accent} />
                  <Text style={styles.metaPillText}>{PROXIMITY_LABELS[user.proximity_tier]}</Text>
                </View>
                <Text style={styles.metaDot}>·</Text>
                <Text style={styles.metaText}>{activeMinLabel}</Text>
                {user.available_seats > 0 && (
                  <>
                    <Text style={styles.metaDot}>·</Text>
                    <Text style={styles.metaText}>
                      {user.available_seats >= 99 ? 'Open' : `${user.available_seats} seat${user.available_seats !== 1 ? 's' : ''}`}
                    </Text>
                  </>
                )}
              </View>
            </View>
          </View>

          {/* ── Row 2: All preferences as pills ── */}
          <View style={styles.pillsSection}>
            <View style={styles.pillsRow}>
              {user.preference_categories.map((cat) => (
                <View
                  key={cat}
                  style={[
                    styles.prefPill,
                    user.parsed_swiped_category === cat && styles.prefPillLive,
                  ]}
                >
                  <Icon
                    name={CATEGORY_ICONS[cat] || 'ellipse-outline'}
                    size={11}
                    color={user.parsed_swiped_category === cat ? '#fff' : colors.accent}
                  />
                  <Text
                    style={[
                      styles.prefPillText,
                      user.parsed_swiped_category === cat && styles.prefPillTextLive,
                    ]}
                    numberOfLines={1}
                  >
                    {PILL_LABELS[cat] || cat}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          {/* ── Row 3: Action ── */}
          <TouchableOpacity
            style={[styles.actionButton, interestSent && styles.actionButtonSent]}
            onPress={() => !interestSent && onSendInterest(user.user_id)}
            disabled={interestSent || isSending}
            activeOpacity={0.8}
            accessibilityLabel={interestSent ? `Interest sent to ${user.display_name}` : `Interested in ${user.display_name}`}
            accessibilityRole={interestSent ? 'text' : 'button'}
          >
            {isSending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Icon
                  name={interestSent ? 'checkmark-circle' : 'hand-right-outline'}
                  size={15}
                  color={interestSent ? colors.gray[400] : '#fff'}
                />
                <Text style={[styles.actionText, interestSent && styles.actionTextSent]}>
                  {interestSent ? 'Interest Sent' : 'Interested'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  outerWrapper: {
    marginHorizontal: 16,
    marginBottom: 12,
    position: 'relative',
  },
  behindCard: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: colors.accent,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingRight: 28,
    gap: 8,
  },
  behindCardText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 4,
  },
  cardSent: {
    opacity: 0.4,
  },

  // ── Identity ──
  identityRow: {
    flexDirection: 'row',
    gap: 12,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  avatarFallback: {
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.accent,
  },
  identityInfo: {
    flex: 1,
    gap: 3,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text.primary,
    maxWidth: 150,
  },
  levelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(235, 120, 37, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(235, 120, 37, 0.15)',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  levelText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.accent,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.accent,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  metaPillText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.accent,
  },
  metaDot: {
    fontSize: 10,
    color: colors.gray[300],
  },
  metaText: {
    fontSize: 10,
    fontWeight: '500',
    color: colors.gray[500],
  },

  // ── Preference pills ──
  pillsSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.gray[100],
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  prefPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(235, 120, 37, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(235, 120, 37, 0.12)',
  },
  prefPillLive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  prefPillText: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.accent,
  },
  prefPillTextLive: {
    color: '#fff',
    fontWeight: '600',
  },

  // ── Action ──
  actionButton: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    shadowColor: colors.accent,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  actionButtonSent: {
    backgroundColor: colors.gray[100],
    shadowOpacity: 0,
    elevation: 0,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  actionTextSent: {
    color: colors.gray[400],
  },
});
