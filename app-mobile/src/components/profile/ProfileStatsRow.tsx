/**
 * ProfileStatsRow — ORCH-0627 glass bento restructure.
 *
 * Layout (top → bottom):
 *   1. Level hero row: 96pt progress ring + tier badge + "X to next tier" context
 *   2. 2×2 tile grid: Saved | Scheduled / Friends | Streak
 *   3. Motivation text (own-profile only, contextual)
 *
 * Places Visited is not a separate tile — it drives the tier context line inside
 * the Level hero row (spec §4.3).
 *
 * Tokens: designSystem.ts → glass.profile.statTile / .levelRing / .tierBadge
 * Spec:   DESIGN_ORCH-0627_PROFILE_GLASS_REFRESH_SPEC.md §4.3
 */
import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Animated, Easing, Pressable } from 'react-native';
import { Icon, type IconName } from '../ui/Icon';
import Svg, { Circle } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { glass } from '../../constants/designSystem';

// --- Types ---

interface ProfileStatsRowProps {
  savedCount: number;
  scheduledCount: number;
  connectionsCount: number;
  placesVisited?: number;
  streakDays?: number;
  level?: number;
  levelProgress?: number;
  onStatPress?: (stat: 'saved' | 'scheduled' | 'connections') => void;
}

// --- Tier helpers ---

const TIERS = [
  { name: 'Explorer', min: 0 },
  { name: 'Adventurer', min: 5 },
  { name: 'Trailblazer', min: 15 },
  { name: 'Legend', min: 30 },
] as const;

const getTierName = (places: number): string => {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (places >= TIERS[i].min) return TIERS[i].name;
  }
  return TIERS[0].name;
};

const getNextTier = (places: number): { name: string; remaining: number } | null => {
  for (const tier of TIERS) {
    if (places < tier.min) {
      return { name: tier.name, remaining: tier.min - places };
    }
  }
  return null;
};

// --- Animated count hook (short-circuits on target === 0) ---

const useAnimatedCount = (target: number, duration: number = glass.profile.motion.countUpMs): number => {
  const animValue = useRef(new Animated.Value(0)).current;
  const displayRef = useRef<number>(0);
  const [, forceUpdate] = React.useState<number>(0);

  useEffect(() => {
    // ORCH-0627 — short-circuit when target is 0 (no animation needed, saves a frame)
    if (target === 0) {
      displayRef.current = 0;
      forceUpdate((n) => n + 1);
      return;
    }

    animValue.setValue(0);
    const listener = animValue.addListener(({ value }: { value: number }) => {
      const newVal = Math.round(value);
      if (newVal !== displayRef.current) {
        displayRef.current = newVal;
        forceUpdate((n) => n + 1);
      }
    });
    Animated.timing(animValue, {
      toValue: target,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    return () => animValue.removeListener(listener);
  }, [target, duration, animValue]);

  return displayRef.current;
};

// --- Progress ring (96pt) ---

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const ProgressRing: React.FC<{ progress: number }> = ({ progress }) => {
  const r = glass.profile.levelRing;
  const animProgress = useRef(new Animated.Value(0)).current;
  const radius = (r.size - r.strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  useEffect(() => {
    Animated.timing(animProgress, {
      toValue: progress,
      duration: r.animationMs,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [progress, animProgress, r.animationMs]);

  const strokeDashoffset = animProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  });

  return (
    <Svg width={r.size} height={r.size} style={{ transform: [{ rotate: '-90deg' }] }}>
      <Circle
        cx={r.size / 2}
        cy={r.size / 2}
        r={radius}
        stroke={r.trackColor}
        strokeWidth={r.strokeWidth}
        fill="transparent"
      />
      <AnimatedCircle
        cx={r.size / 2}
        cy={r.size / 2}
        r={radius}
        stroke={r.fillColor}
        strokeWidth={r.strokeWidth}
        fill="transparent"
        strokeDasharray={`${circumference}`}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
      />
    </Svg>
  );
};

// --- Stat tile (bento grid cell) ---

interface StatTileProps {
  icon: IconName;
  iconColor: string;
  count: number;
  label: string;
  statKey: 'saved' | 'scheduled' | 'connections';
  onPress?: (stat: 'saved' | 'scheduled' | 'connections') => void;
  /** If true, render the small flame-pulse glow (used by streak tile) */
  pulseGlow?: boolean;
  /** Suffix appended to the numeric count (e.g. "d" for streak days) */
  suffix?: string;
}

const StatTile: React.FC<StatTileProps> = ({
  icon,
  iconColor,
  count,
  label,
  statKey,
  onPress,
  pulseGlow,
  suffix,
}) => {
  const displayCount = useAnimatedCount(count);

  // Flame glow pulse for streak > 0
  const glowOpacity = useRef(new Animated.Value(pulseGlow ? 0.6 : 0)).current;
  useEffect(() => {
    if (!pulseGlow) {
      glowOpacity.setValue(0);
      return;
    }
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowOpacity, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(glowOpacity, { toValue: 0.6, duration: 1000, useNativeDriver: true }),
      ]),
    ).start();
  }, [pulseGlow, glowOpacity]);

  // Press scale
  const pressScale = useRef(new Animated.Value(1)).current;
  const handlePressIn = () => {
    if (!onPress) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Animated.timing(pressScale, {
      toValue: glass.profile.statTile.pressScale,
      duration: glass.profile.statTile.pressDurationMs,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  };
  const handlePressOut = () => {
    Animated.timing(pressScale, {
      toValue: 1,
      duration: glass.profile.statTile.pressDurationMs,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  };

  const content = (
    <Animated.View style={[styles.tile, { transform: [{ scale: pressScale }] }]}>
      <View style={styles.tileIconCircle}>
        {pulseGlow && (
          <Animated.View style={[styles.tileIconGlow, { opacity: glowOpacity }]} />
        )}
        <Icon name={icon} size={glass.profile.statTile.iconSize} color={iconColor} />
      </View>
      <View style={styles.tileValueRow}>
        <Text style={count > 0 ? styles.tileValue : styles.tileValueZero}>
          {displayCount}
        </Text>
        {suffix ? (
          <Text style={styles.tileSuffix}>{suffix}</Text>
        ) : null}
      </View>
      <Text style={styles.tileLabel}>{label}</Text>
    </Animated.View>
  );

  if (onPress) {
    return (
      <Pressable
        style={styles.tileFlex}
        onPress={() => onPress(statKey)}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityLabel={`${count} ${label}. Double-tap to view.`}
        accessibilityRole="button"
      >
        {content}
      </Pressable>
    );
  }
  return <View style={styles.tileFlex}>{content}</View>;
};

// --- Main component ---

const ProfileStatsRow: React.FC<ProfileStatsRowProps> = ({
  savedCount,
  scheduledCount,
  connectionsCount,
  placesVisited = 0,
  streakDays = 0,
  level = 1,
  levelProgress = 0,
  onStatPress,
}) => {
  const { t } = useTranslation(['profile', 'common']);
  const nextTier = getNextTier(placesVisited);
  const tierName = getTierName(placesVisited);

  // Motivational text — shown on own profile only (onStatPress is the implicit signal)
  let motivationText = '';
  if (onStatPress) {
    if (placesVisited === 0 && streakDays === 0) {
      motivationText = t('profile:stats.motivation_start');
    } else if (nextTier && nextTier.remaining <= 3) {
      motivationText = nextTier.remaining === 1
        ? t('profile:stats.motivation_close', { count: nextTier.remaining, tier: nextTier.name })
        : t('profile:stats.motivation_close_plural', { count: nextTier.remaining, tier: nextTier.name });
    } else if (streakDays === 7) {
      motivationText = t('profile:stats.motivation_week');
    } else if (streakDays === 30) {
      motivationText = t('profile:stats.motivation_month');
    }
  }

  // Tier context line (right of level ring)
  let tierContext: string;
  if (nextTier) {
    tierContext = nextTier.remaining === 1
      ? t('profile:stats.tier_context_one', { tier: nextTier.name })
      : t('profile:stats.tier_context_plural', { count: nextTier.remaining, tier: nextTier.name });
  } else {
    tierContext = t('profile:stats.tier_context_max');
  }

  return (
    <View>
      {/* Level hero row: ring + tier + context */}
      <View style={styles.levelRow}>
        <View style={styles.levelRingWrap}>
          <ProgressRing progress={levelProgress} />
          <View style={styles.levelNumberAbsolute} pointerEvents="none">
            <Text style={styles.levelNumber}>{level}</Text>
          </View>
        </View>
        <View style={styles.levelRightCol}>
          <View style={styles.tierBadge}>
            <Icon
              name="shield-checkmark"
              size={glass.profile.tierBadge.iconSize}
              color={glass.profile.tierBadge.iconColor}
            />
            <Text style={styles.tierLabel}>{tierName}</Text>
          </View>
          <Text style={styles.tierContext}>{tierContext}</Text>
          {motivationText ? (
            <Text style={styles.motivationText} numberOfLines={2}>{motivationText}</Text>
          ) : null}
        </View>
      </View>

      {/* 2×2 bento tile grid */}
      <View style={styles.bentoRow}>
        <StatTile
          icon="bookmark"
          iconColor={glass.profile.statTile.iconColorSaved}
          count={savedCount}
          label={t('profile:stats.saved')}
          statKey="saved"
          onPress={onStatPress}
        />
        <StatTile
          icon="calendar"
          iconColor={glass.profile.statTile.iconColorScheduled}
          count={scheduledCount}
          label={t('profile:stats.scheduled')}
          statKey="scheduled"
          onPress={onStatPress}
        />
      </View>
      <View style={[styles.bentoRow, styles.bentoRowSpacing]}>
        <StatTile
          icon="people"
          iconColor={glass.profile.statTile.iconColorFriends}
          count={connectionsCount}
          label={t('profile:stats.friends')}
          statKey="connections"
          onPress={onStatPress}
        />
        <StatTile
          icon="flame"
          iconColor={glass.profile.statTile.iconColorStreak}
          count={streakDays}
          label={t('profile:stats.streak')}
          statKey="connections"
          pulseGlow={streakDays > 0}
          suffix="d"
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  // Level hero row
  levelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 14,
  },
  levelRingWrap: {
    width: glass.profile.levelRing.size,
    height: glass.profile.levelRing.size,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelNumberAbsolute: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    width: glass.profile.levelRing.size,
    height: glass.profile.levelRing.size,
  },
  levelNumber: {
    fontSize: glass.profile.levelRing.innerNumberFontSize,
    fontWeight: glass.profile.levelRing.innerNumberFontWeight,
    color: glass.profile.levelRing.innerNumberColor,
    letterSpacing: glass.profile.levelRing.innerNumberLetterSpacing,
  },
  levelRightCol: {
    flex: 1,
    gap: 6,
  },
  tierBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: glass.profile.tierBadge.iconLabelGap,
    backgroundColor: glass.profile.tierBadge.bg,
    borderWidth: glass.profile.tierBadge.borderWidth,
    borderColor: glass.profile.tierBadge.border,
    borderRadius: glass.profile.tierBadge.radius,
    paddingHorizontal: glass.profile.tierBadge.paddingHorizontal,
    paddingVertical: glass.profile.tierBadge.paddingVertical,
  },
  tierLabel: {
    fontSize: glass.profile.tierBadge.labelFontSize,
    fontWeight: glass.profile.tierBadge.labelFontWeight,
    color: glass.profile.tierBadge.labelColor,
    letterSpacing: glass.profile.tierBadge.labelLetterSpacing,
    textTransform: glass.profile.tierBadge.labelTextTransform,
  },
  tierContext: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 17,
  },
  motivationText: {
    color: 'rgba(255, 255, 255, 0.55)',
    fontSize: 12,
    fontStyle: 'italic',
    lineHeight: 16,
  },
  // Bento
  bentoRow: {
    flexDirection: 'row',
    gap: 10,
  },
  bentoRowSpacing: {
    marginTop: 10,
  },
  tileFlex: {
    flex: 1,
  },
  tile: {
    backgroundColor: glass.profile.statTile.bg,
    borderWidth: glass.profile.statTile.borderWidth,
    borderColor: glass.profile.statTile.border,
    borderRadius: glass.profile.statTile.radius,
    paddingVertical: glass.profile.statTile.paddingVertical,
    paddingHorizontal: glass.profile.statTile.paddingHorizontal,
    minHeight: glass.profile.statTile.minHeight,
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  tileIconCircle: {
    width: glass.profile.statTile.iconBgSize,
    height: glass.profile.statTile.iconBgSize,
    borderRadius: glass.profile.statTile.iconBgRadius,
    backgroundColor: glass.profile.statTile.iconBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileIconGlow: {
    position: 'absolute',
    width: glass.profile.statTile.iconBgSize + 4,
    height: glass.profile.statTile.iconBgSize + 4,
    borderRadius: (glass.profile.statTile.iconBgSize + 4) / 2,
    backgroundColor: 'rgba(249, 115, 22, 0.25)',
  },
  tileValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 10,
  },
  tileValue: {
    ...glass.profile.text.statValue,
  },
  tileValueZero: {
    ...glass.profile.text.statValueZero,
  },
  tileSuffix: {
    color: 'rgba(255, 255, 255, 0.40)',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 2,
  },
  tileLabel: {
    ...glass.profile.text.statLabel,
    marginTop: 2,
  },
});

export default ProfileStatsRow;
