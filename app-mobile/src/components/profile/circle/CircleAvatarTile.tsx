import React, { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fontWeights } from '../../../constants/designSystem';
import { Icon } from '../../ui/Icon';
import type { CirclePerson, CircleTier } from '../../../types/circle';

export const CIRCLE_AVATAR_DIAMETER = 58;
export const CIRCLE_RING_THICKNESS = 3;
export const CIRCLE_BADGE_DIAMETER = 20;
export const CIRCLE_TILE_WIDTH = 184;

export const CIRCLE_TIER_RING_COLORS: Record<CircleTier, string> = {
  close: colors.primary[500], // circle.tier.close.ring
  friend: colors.success[500], // circle.tier.friend.ring
  extended: colors.gray[500], // circle.tier.extended.ring
};

interface CircleAvatarTileProps {
  person: CirclePerson;
  size?: number;
  ringThickness?: number;
  onPress: () => void;
}

function getDisplayName(person: CirclePerson): string {
  return person.displayName || person.username || 'Mingla friend';
}

function getInitials(person: CirclePerson): string {
  const source = getDisplayName(person).trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return (source.slice(0, 2) || '?').toUpperCase();
}

const BusinessBadge: React.FC<{ hasBusinessApp: boolean }> = ({ hasBusinessApp }) => (
  <View
    style={styles.businessBadge}
    testID="circle-business-badge"
    accessibilityElementsHidden
    importantForAccessibility="no"
  >
    <Icon name={hasBusinessApp ? 'briefcase-outline' : 'briefcase-outline'} size={10} color={colors.text.inverse} />
  </View>
);

export const CircleAvatarTile: React.FC<CircleAvatarTileProps> = ({
  person,
  size = CIRCLE_AVATAR_DIAMETER,
  ringThickness = CIRCLE_RING_THICKNESS,
  onPress,
}) => {
  const [imageFailed, setImageFailed] = useState(false);
  const displayName = useMemo(() => getDisplayName(person), [person]);
  const initials = useMemo(() => getInitials(person), [person]);
  const relationshipLabel = person.relationshipLabel;
  const ringColor = CIRCLE_TIER_RING_COLORS[person.tier];
  const innerSize = size - ringThickness * 2;

  return (
    <Pressable
      onPress={onPress}
      style={styles.tile}
      testID={`circle-avatar-tile-${person.userId}`}
      accessibilityRole="button"
      accessibilityLabel={`View ${displayName}'s profile, ${relationshipLabel}`}
    >
      <View
        style={[
          styles.ring,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderColor: ringColor,
            borderWidth: ringThickness,
          },
        ]}
        testID={`circle-ring-${person.tier}`}
      >
        {person.avatarUrl && !imageFailed ? (
          <Image
            source={{ uri: person.avatarUrl }}
            cachePolicy="memory-disk"
            contentFit="cover"
            style={[
              styles.avatarImage,
              {
                width: innerSize,
                height: innerSize,
                borderRadius: innerSize / 2,
              },
            ]}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <LinearGradient
            colors={['rgba(249, 115, 22, 0.96)', 'rgba(124, 45, 18, 0.92)']}
            style={[
              styles.initialsAvatar,
              {
                width: innerSize,
                height: innerSize,
                borderRadius: innerSize / 2,
              },
            ]}
          >
            <Text style={[styles.initialsText, { fontSize: size * 0.34 }]}>
              {initials}
            </Text>
          </LinearGradient>
        )}
        <LinearGradient
          colors={['rgba(255, 255, 255, 0.34)', 'rgba(255, 255, 255, 0.08)', 'rgba(255, 255, 255, 0)']}
          locations={[0, 0.46, 1]}
          style={[styles.glassHighlight, { borderRadius: size / 2 }]}
          pointerEvents="none"
        />
        {person.hasBusinessApp ? <BusinessBadge hasBusinessApp={person.hasBusinessApp} /> : null}
      </View>
      <View style={styles.labelGroup}>
        <Text style={styles.nameText} numberOfLines={1}>
          {displayName}
        </Text>
        <Text style={styles.relationshipText} numberOfLines={1}>
          {relationshipLabel}
        </Text>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  tile: {
    width: CIRCLE_TILE_WIDTH,
    height: CIRCLE_AVATAR_DIAMETER,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  ring: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    shadowColor: '#eb7825',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 5,
  },
  avatarImage: {
    backgroundColor: 'transparent',
  },
  initialsAvatar: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  initialsText: {
    color: colors.text.inverse,
    fontWeight: fontWeights.bold,
  },
  glassHighlight: {
    position: 'absolute',
    top: 3,
    left: 3,
    right: 3,
    height: CIRCLE_AVATAR_DIAMETER * 0.45,
    opacity: 0.75,
  },
  businessBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: CIRCLE_BADGE_DIAMETER,
    height: CIRCLE_BADGE_DIAMETER,
    borderRadius: CIRCLE_BADGE_DIAMETER / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(17, 24, 39, 0.92)',
    borderColor: 'rgba(255, 255, 255, 0.72)',
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28,
    shadowRadius: 6,
    elevation: 4,
  },
  labelGroup: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  nameText: {
    color: colors.text.inverse,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: fontWeights.bold,
  },
  relationshipText: {
    marginTop: 2,
    color: 'rgba(255, 255, 255, 0.55)',
    fontSize: 12,
    lineHeight: 15,
    fontWeight: fontWeights.medium,
  },
});

export default CircleAvatarTile;
