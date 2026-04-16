/**
 * ORCH-0437: Self-profile header for the leaderboard.
 * Shows how you appear to others. Tap to edit preferences.
 */

import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Icon } from '../ui/Icon';
import { ActivityRing } from './ActivityRing';
import { colors, glass } from '../../constants/designSystem';

interface LeaderboardProfileHeaderProps {
  avatarUrl: string | null;
  displayName: string;
  level: number;
  status: string | null;
  categories: string[];
  availableSeats: number;
  activeMinutes: number;
  isDiscoverable: boolean;
  swipeCount: number;
  onPress: () => void;
}

const CATEGORY_ICONS: Record<string, string> = {
  'Nature & Views': 'leaf-outline',
  'Icebreakers': 'sparkles',
  'Drinks & Music': 'wine-outline',
  'Brunch Lunch & Casual': 'fast-food-outline',
  'Upscale & Fine Dining': 'restaurant-outline',
  'Movies & Theatre': 'film-outline',
  'Creative & Arts': 'color-palette-outline',
  'Play': 'game-controller-outline',
};

export function LeaderboardProfileHeader({
  avatarUrl,
  displayName,
  level,
  status,
  categories,
  availableSeats,
  activeMinutes,
  isDiscoverable,
  swipeCount,
  onPress,
}: LeaderboardProfileHeaderProps): React.ReactElement {
  const handlePress = (): void => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  const activeLabel = activeMinutes < 60
    ? `${activeMinutes} min`
    : `${Math.floor(activeMinutes / 60)}h ${activeMinutes % 60}m`;

  return (
    <TouchableOpacity
      style={[styles.container, !isDiscoverable && styles.containerHidden]}
      onPress={handlePress}
      activeOpacity={0.85}
      accessibilityLabel={`Your leaderboard profile. ${displayName}, Level ${level}${status ? `, ${status}` : ''}. Tap to edit preferences.`}
      accessibilityRole="button"
    >
      {/* Avatar with ring */}
      <ActivityRing size={48} swipeCount={swipeCount}>
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={[styles.avatar, isDiscoverable && styles.avatarDiscoverable]} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback, isDiscoverable && styles.avatarDiscoverable]}>
            <Text style={styles.avatarInitials}>{(displayName || 'U').charAt(0).toUpperCase()}</Text>
          </View>
        )}
      </ActivityRing>

      {/* Content */}
      <View style={styles.content}>
        {/* Row 1: Name + Level */}
        <View style={styles.topRow}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
            <View style={styles.levelPill}>
              <Text style={styles.levelText}>Lvl {level}</Text>
            </View>
          </View>
          <Text style={styles.activeTime}>{activeLabel}</Text>
        </View>

        {/* Row 2: Status */}
        <Text style={[styles.status, !status && styles.statusEmpty]} numberOfLines={1}>
          {status || 'No status set'}
        </Text>

        {/* Row 3: Categories + Seats */}
        <View style={styles.bottomRow}>
          <View style={styles.categoriesRow}>
            {categories.slice(0, 5).map((cat) => (
              <Icon
                key={cat}
                name={CATEGORY_ICONS[cat] || 'ellipse-outline'}
                size={14}
                color={colors.gray[500]}
              />
            ))}
          </View>
          <Text style={[styles.seatText, !isDiscoverable && styles.seatTextHidden]}>
            {isDiscoverable ? `${availableSeats} seat${availableSeats !== 1 ? 's' : ''} open` : 'Hidden'}
          </Text>
        </View>
      </View>

      {/* Edit chevron */}
      <View style={styles.editChevron}>
        <Text style={styles.editLabel}>Edit</Text>
        <Icon name="chevron-forward" size={10} color={colors.gray[400]} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    height: 72,
    ...glass.leaderboard.header,
    ...glass.shadow,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  containerHidden: {
    opacity: 0.6,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarFallback: {
    backgroundColor: colors.primary[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary[700],
  },
  avatarDiscoverable: {
    borderWidth: 2,
    borderColor: colors.accent,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    gap: 1,
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
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text.primary,
    maxWidth: 130,
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
    fontSize: 11,
    fontWeight: '700',
    color: '#92400e',
  },
  activeTime: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.gray[400],
  },
  status: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.accent,
  },
  statusEmpty: {
    color: colors.gray[400],
    fontStyle: 'italic',
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  categoriesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  seatText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.success[600],
  },
  seatTextHidden: {
    color: colors.gray[400],
  },
  editChevron: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    position: 'absolute',
    bottom: 8,
    right: 12,
  },
  editLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.gray[400],
  },
});
