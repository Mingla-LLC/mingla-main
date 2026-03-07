import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type FeatureIcon =
  | 'heart'
  | 'calendar'
  | 'compass'
  | 'chat'
  | 'profile'
  | 'bell'
  | 'qr'
  | 'gift'
  | 'link'
  | 'vote'
  | 'mention'
  | 'pin'
  | 'share'
  | 'board'
  | 'settings'
  | 'people'
  | 'filter';

interface FeatureIllustrationProps {
  icon: FeatureIcon;
}

const CONTAINER_SIZE = 120;
const GLOW_SIZE = 56;
const RING_SIZE = 64;
const ICON_SIZE = 28;
const SPARKLE_SIZE = 4;

const ORANGE = '#f97316';
const GLOW_COLOR = 'rgba(249,115,22,0.12)';
const SPARKLE_COLOR = 'rgba(249,115,22,0.6)';
const RING_COLOR = 'rgba(249,115,22,0.15)';

const ICON_MAP: Record<FeatureIcon, keyof typeof Ionicons.glyphMap> = {
  heart: 'heart',
  calendar: 'calendar',
  compass: 'compass',
  chat: 'chatbubble-ellipses',
  profile: 'person-circle',
  bell: 'notifications',
  qr: 'qr-code',
  gift: 'gift',
  link: 'link',
  vote: 'thumbs-up',
  mention: 'at',
  pin: 'pin',
  share: 'share',
  board: 'people',
  settings: 'settings',
  people: 'people-circle',
  filter: 'options',
};

// Sparkle positions at 12, 3, 5, 8 o'clock around the glow
// Radius from center = ~38px
const SPARKLE_POSITIONS = [
  { top: '12%', left: '50%' },  // 12 o'clock
  { top: '50%', right: '12%' }, // 3 o'clock
  { bottom: '18%', right: '22%' }, // 5 o'clock
  { bottom: '30%', left: '18%' },  // 8 o'clock
];

const FeatureIllustration: React.FC<FeatureIllustrationProps> = ({ icon }) => {
  const glowScale = useRef(new Animated.Value(0.95)).current;
  const sparkle0 = useRef(new Animated.Value(0.3)).current;
  const sparkle1 = useRef(new Animated.Value(0.3)).current;
  const sparkle2 = useRef(new Animated.Value(0.3)).current;
  const sparkle3 = useRef(new Animated.Value(0.3)).current;

  const sparkles = [sparkle0, sparkle1, sparkle2, sparkle3];

  useEffect(() => {
    // Breathing glow
    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowScale, {
          toValue: 1.05,
          duration: 750,
          useNativeDriver: true,
        }),
        Animated.timing(glowScale, {
          toValue: 0.95,
          duration: 750,
          useNativeDriver: true,
        }),
      ]),
    );

    // Staggered sparkle opacities
    const sparkleLoops = sparkles.map((s, i) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(i * 200),
          Animated.timing(s, {
            toValue: 1.0,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(s, {
            toValue: 0.3,
            duration: 600,
            useNativeDriver: true,
          }),
        ]),
      );
    });

    glowLoop.start();
    sparkleLoops.forEach((l) => l.start());

    return () => {
      glowLoop.stop();
      sparkleLoops.forEach((l) => l.stop());
    };
  }, [glowScale, sparkle0, sparkle1, sparkle2, sparkle3]);

  const ionName = ICON_MAP[icon];

  return (
    <View style={styles.container}>
      {/* Static ring */}
      <View style={styles.ring} />

      {/* Breathing glow */}
      <Animated.View
        style={[
          styles.glow,
          { transform: [{ scale: glowScale }] },
        ]}
      />

      {/* Central icon */}
      <View style={styles.iconContainer}>
        <Ionicons name={ionName} size={ICON_SIZE} color={ORANGE} />
      </View>

      {/* Sparkle diamonds */}
      {SPARKLE_POSITIONS.map((pos, i) => (
        <Animated.View
          key={i}
          style={[
            styles.sparkle,
            pos as Record<string, string | number>,
            {
              opacity: sparkles[i],
              transform: [{ rotate: '45deg' }],
            },
          ]}
        />
      ))}
    </View>
  );
};

export { FeatureIllustration };

const styles = StyleSheet.create({
  container: {
    width: CONTAINER_SIZE,
    height: CONTAINER_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 1,
    borderColor: RING_COLOR,
  },
  glow: {
    position: 'absolute',
    width: GLOW_SIZE,
    height: GLOW_SIZE,
    borderRadius: GLOW_SIZE / 2,
    backgroundColor: GLOW_COLOR,
  },
  iconContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkle: {
    position: 'absolute',
    width: SPARKLE_SIZE,
    height: SPARKLE_SIZE,
    backgroundColor: SPARKLE_COLOR,
  },
});
