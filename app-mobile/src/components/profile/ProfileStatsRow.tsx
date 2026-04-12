import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { TrackedTouchableOpacity } from '../TrackedTouchableOpacity';
import { Icon } from '../ui/Icon';
import Svg, { Circle } from 'react-native-svg';

// --- Types ---

interface ProfileStatsRowProps {
  savedCount: number;
  connectionsCount: number;
  boardsCount: number;
  placesVisited?: number;
  streakDays?: number;
  level?: number;
  levelProgress?: number;
  onStatPress?: (stat: 'saved' | 'connections' | 'boards') => void;
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
  return null; // Already at max tier
};

// --- Animated number hook ---

const useAnimatedCount = (target: number, duration = 600) => {
  const animValue = useRef(new Animated.Value(0)).current;
  const displayRef = useRef(0);
  const [, forceUpdate] = React.useState(0);

  useEffect(() => {
    animValue.setValue(0);
    const listener = animValue.addListener(({ value }) => {
      const newVal = Math.round(value);
      if (newVal !== displayRef.current) {
        displayRef.current = newVal;
        forceUpdate(n => n + 1);
      }
    });
    Animated.timing(animValue, {
      toValue: target,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    return () => animValue.removeListener(listener);
  }, [target]);

  return displayRef.current;
};

// --- Circular progress component ---

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const ProgressRing: React.FC<{ progress: number; size?: number; strokeWidth?: number }> = ({
  progress,
  size = 36,
  strokeWidth = 3,
}) => {
  const animProgress = useRef(new Animated.Value(0)).current;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  useEffect(() => {
    Animated.timing(animProgress, {
      toValue: progress,
      duration: 800,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [progress]);

  const strokeDashoffset = animProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  });

  return (
    <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="#f3f4f6"
        strokeWidth={strokeWidth}
        fill="transparent"
      />
      <AnimatedCircle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="#f59e0b"
        strokeWidth={strokeWidth}
        fill="transparent"
        strokeDasharray={`${circumference}`}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
      />
    </Svg>
  );
};

// --- Stat column for top row ---

interface StatColumnProps {
  icon: string;
  iconColor: string;
  iconBg: string;
  count: number;
  label: string;
  statKey: 'saved' | 'connections' | 'boards';
  highlightColor?: string;
  onPress?: (stat: 'saved' | 'connections' | 'boards') => void;
}

const StatColumn: React.FC<StatColumnProps> = ({
  icon, iconColor, iconBg, count, label, statKey, highlightColor, onPress,
}) => {
  const displayCount = useAnimatedCount(count);

  const content = (
    <View style={styles.statItem}>
      <View style={[styles.statIconCircle, { backgroundColor: iconBg }]}>
        <Icon name={icon} size={14} color={iconColor} />
      </View>
      <Text style={[
        styles.statNumber,
        count > 0 && highlightColor ? { color: highlightColor } : null,
        count === 0 ? styles.statNumberZero : null,
      ]}>
        {displayCount}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );

  if (onPress) {
    return (
      <TrackedTouchableOpacity
        logComponent="ProfileStatsRow"
        style={styles.statFlex}
        onPress={() => onPress(statKey)}
        activeOpacity={0.7}
        accessibilityLabel={`${count} ${label}. Double tap to view.`}
        accessibilityRole="button"
      >
        {content}
      </TrackedTouchableOpacity>
    );
  }
  return <View style={styles.statFlex}>{content}</View>;
};

// --- Main component ---

const ProfileStatsRow: React.FC<ProfileStatsRowProps> = ({
  savedCount,
  connectionsCount,
  boardsCount,
  placesVisited = 0,
  streakDays = 0,
  level = 1,
  levelProgress = 0,
  onStatPress,
}) => {
  const nextTier = getNextTier(placesVisited);
  const tierName = getTierName(placesVisited);

  // Streak flame glow animation
  const glowOpacity = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    if (streakDays > 0) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowOpacity, { toValue: 1, duration: 1000, useNativeDriver: true }),
          Animated.timing(glowOpacity, { toValue: 0.6, duration: 1000, useNativeDriver: true }),
        ])
      ).start();
    }
  }, [streakDays]);

  const visitedDisplay = useAnimatedCount(placesVisited);
  const streakDisplay = useAnimatedCount(streakDays);

  // Motivational text — only shown on own profile (onStatPress is the implicit signal)
  let motivationText = '';
  if (onStatPress) {
    if (placesVisited === 0 && streakDays === 0) {
      motivationText = 'Your stats start building the moment you do something. Go explore.';
    } else if (nextTier && nextTier.remaining <= 3) {
      motivationText = `${nextTier.remaining} more place${nextTier.remaining === 1 ? '' : 's'} to hit ${nextTier.name}. You're close.`;
    } else if (streakDays === 7) {
      motivationText = 'A whole week. Consistency looks good on you.';
    } else if (streakDays === 30) {
      motivationText = '30 days straight. You might be unstoppable.';
    }
  }

  return (
    <View style={styles.container}>
      {/* Top row: Original 3 stats */}
      <View style={styles.topRow}>
        <StatColumn
          icon="bookmark" iconColor="#eb7825" iconBg="#fff7ed"
          count={savedCount} label="SAVED" statKey="saved"
          highlightColor="#eb7825" onPress={onStatPress}
        />
        <View style={styles.divider} />
        <StatColumn
          icon="people" iconColor="#22c55e" iconBg="#f0fdf4"
          count={connectionsCount} label="FRIENDS" statKey="connections"
          onPress={onStatPress}
        />
        <View style={styles.divider} />
        <StatColumn
          icon="grid" iconColor="#3b82f6" iconBg="#eff6ff"
          count={boardsCount} label="BOARDS" statKey="boards"
          onPress={onStatPress}
        />
      </View>

      {/* Bottom row: Gamified cards */}
      <View style={styles.bottomRow}>
        {/* Places Visited */}
        <View style={styles.gamifiedCard}>
          <Icon name="location" size={18} color="#eb7825" />
          <Text style={[styles.gamifiedNumber, placesVisited === 0 && styles.gamifiedNumberZero]}>
            {visitedDisplay}
          </Text>
          <Text style={styles.gamifiedLabel}>PLACES</Text>
        </View>

        {/* Streak */}
        <View style={styles.gamifiedCard}>
          <View style={styles.streakIconWrap}>
            {streakDays > 0 && (
              <Animated.View style={[styles.streakGlow, { opacity: glowOpacity }]} />
            )}
            <Icon name="flame" size={18} color="#f97316" />
          </View>
          <View style={styles.streakRow}>
            <Text style={[styles.gamifiedNumber, streakDays === 0 && styles.gamifiedNumberZero]}>
              {streakDisplay}
            </Text>
            <Text style={styles.streakSuffix}>d</Text>
          </View>
          <Text style={styles.gamifiedLabel}>STREAK</Text>
        </View>

        {/* Level */}
        <View style={styles.gamifiedCard}>
          <Icon name="trophy" size={18} color="#f59e0b" />
          <View style={styles.levelRingWrap}>
            <ProgressRing progress={levelProgress} />
            <Text style={styles.levelNumber}>{level}</Text>
          </View>
          <Text style={styles.gamifiedLabel}>LEVEL</Text>
        </View>
      </View>

      {/* Tier badge */}
      <View style={styles.tierRow}>
        <View style={styles.tierBadge}>
          <Icon name="shield-checkmark" size={12} color="#f59e0b" />
          <Text style={styles.tierText}>{tierName}</Text>
        </View>
      </View>

      {/* Motivational text */}
      {motivationText ? (
        <Text style={styles.motivationText}>{motivationText}</Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { paddingHorizontal: 24 },
  // Top row
  topRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#ffffff', borderRadius: 16,
    borderWidth: 1, borderColor: '#f3f4f6',
    paddingVertical: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 3, elevation: 2,
  },
  statFlex: { flex: 1 },
  statItem: { alignItems: 'center' },
  statIconCircle: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  statNumber: { fontSize: 22, fontWeight: '800', color: '#111827', marginTop: 6 },
  statNumberZero: { color: '#d1d5db' },
  statLabel: {
    fontSize: 11, fontWeight: '600', color: '#9ca3af',
    textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2,
  },
  divider: { width: 1, height: 40, backgroundColor: '#f3f4f6' },
  // Bottom row
  bottomRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  gamifiedCard: {
    flex: 1, backgroundColor: '#ffffff', borderRadius: 12,
    borderWidth: 1, borderColor: '#f3f4f6',
    paddingVertical: 12, paddingHorizontal: 8, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 2, elevation: 1,
  },
  gamifiedNumber: { fontSize: 24, fontWeight: '800', color: '#111827', marginTop: 4 },
  gamifiedNumberZero: { color: '#d1d5db' },
  gamifiedLabel: {
    fontSize: 11, fontWeight: '600', color: '#9ca3af',
    textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2,
  },
  // Streak
  streakIconWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  streakGlow: {
    position: 'absolute', width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#fff7ed',
  },
  streakRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 4 },
  streakSuffix: { fontSize: 14, fontWeight: '500', color: '#9ca3af', marginLeft: 1 },
  // Level
  levelRingWrap: {
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    marginTop: 4,
  },
  levelNumber: {
    position: 'absolute', fontSize: 14, fontWeight: '800', color: '#111827',
  },
  // Tier
  tierRow: { alignItems: 'center', marginTop: 10 },
  tierBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#fffbeb', borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: '#fde68a',
  },
  tierText: { fontSize: 12, fontWeight: '600', color: '#92400e' },
  // Motivation
  motivationText: {
    fontSize: 13, color: '#6b7280', textAlign: 'center',
    marginTop: 8, lineHeight: 18,
  },
});

export default ProfileStatsRow;
