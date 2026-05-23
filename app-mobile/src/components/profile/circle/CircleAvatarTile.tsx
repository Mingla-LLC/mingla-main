import React, { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { colors, fontWeights } from '../../../constants/designSystem';
import { Icon } from '../../ui/Icon';
import type { CirclePerson, CircleTier } from '../../../types/circle';

export const CIRCLE_AVATAR_DIAMETER = 44;
export const CIRCLE_RING_THICKNESS = 2.5;
export const CIRCLE_BADGE_DIAMETER = 16;

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
  const ringColor = CIRCLE_TIER_RING_COLORS[person.tier];
  const innerSize = size - ringThickness * 2;

  return (
    <Pressable
      onPress={onPress}
      style={styles.tile}
      testID={`circle-avatar-tile-${person.userId}`}
      accessibilityRole="button"
      accessibilityLabel={`View ${displayName}'s profile`}
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
          <View
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
          </View>
        )}
        {person.hasBusinessApp ? <BusinessBadge hasBusinessApp={person.hasBusinessApp} /> : null}
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  tile: {
    width: CIRCLE_AVATAR_DIAMETER,
    height: CIRCLE_AVATAR_DIAMETER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background.primary,
  },
  avatarImage: {
    backgroundColor: colors.gray[200],
  },
  initialsAvatar: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary[600],
  },
  initialsText: {
    color: colors.text.inverse,
    fontWeight: fontWeights.semibold,
  },
  businessBadge: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: CIRCLE_BADGE_DIAMETER,
    height: CIRCLE_BADGE_DIAMETER,
    borderRadius: CIRCLE_BADGE_DIAMETER / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gray[900],
    borderColor: colors.background.primary,
    borderWidth: 2,
  },
});

export default CircleAvatarTile;
