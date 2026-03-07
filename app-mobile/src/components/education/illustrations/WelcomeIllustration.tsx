import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type WelcomeScene = 'explore' | 'discover' | 'chats' | 'likes' | 'profile' | 'board';

interface WelcomeIllustrationProps {
  scene: WelcomeScene;
}

const CONTAINER_SIZE = 120;
const ORANGE = '#f97316';
const SPARKLE_COLOR = 'rgba(249,115,22,0.6)';
const SPARKLE_SIZE = 4;

// ─── Sparkle helper ──────────────────────────────────────────

interface SparkleProps {
  top?: number | string;
  left?: number | string;
  right?: number | string;
  bottom?: number | string;
  delay: number;
}

const Sparkle: React.FC<SparkleProps> = ({ top, left, right, bottom, delay }) => {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, delay]);

  return (
    <Animated.View
      style={[
        styles.sparkle,
        { opacity, transform: [{ rotate: '45deg' }] },
        top !== undefined && { top },
        left !== undefined && { left },
        right !== undefined && { right },
        bottom !== undefined && { bottom },
      ]}
    />
  );
};

// ─── Explore ─────────────────────────────────────────────────

const Explore: React.FC = () => {
  const slide0 = useRef(new Animated.Value(30)).current;
  const slide1 = useRef(new Animated.Value(30)).current;
  const slide2 = useRef(new Animated.Value(30)).current;
  const sparkleOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const entrance = Animated.sequence([
      Animated.timing(slide0, { toValue: 0, duration: 300, useNativeDriver: true }),
      Animated.timing(slide1, { toValue: 0, duration: 300, useNativeDriver: true }),
      Animated.timing(slide2, { toValue: 0, duration: 300, useNativeDriver: true }),
      Animated.timing(sparkleOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]);
    entrance.start();

    return () => entrance.stop();
  }, [slide0, slide1, slide2, sparkleOpacity]);

  return (
    <View style={styles.scene}>
      {/* Back card */}
      <Animated.View
        style={[
          styles.exploreCard,
          styles.exploreCardBack,
          {
            transform: [
              { translateX: -8 },
              { translateY: slide0 },
              { rotate: '-8deg' },
            ],
          },
        ]}
      />
      {/* Middle card */}
      <Animated.View
        style={[
          styles.exploreCard,
          styles.exploreCardMiddle,
          {
            transform: [
              { translateX: 0 },
              { translateY: slide1 },
              { rotate: '0deg' },
            ],
          },
        ]}
      />
      {/* Front card */}
      <Animated.View
        style={[
          styles.exploreCard,
          styles.exploreCardFront,
          {
            transform: [
              { translateX: 8 },
              { translateY: slide2 },
              { rotate: '8deg' },
            ],
          },
        ]}
      />
      {/* Sparkles above */}
      <Animated.View style={[styles.sparkleRow, { opacity: sparkleOpacity }]}>
        <Sparkle top={0} left={20} delay={0} />
        <Sparkle top={0} left={56} delay={150} />
        <Sparkle top={0} right={20} delay={300} />
      </Animated.View>
    </View>
  );
};

// ─── Discover ────────────────────────────────────────────────

const DISCOVER_ITEMS: Array<{
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  bg: string;
}> = [
  { icon: 'restaurant', color: ORANGE, bg: '#fff7ed' },
  { icon: 'leaf', color: '#22c55e', bg: '#f0fdf4' },
  { icon: 'musical-notes', color: '#f59e0b', bg: '#fef3c7' },
  { icon: 'color-palette', color: '#ec4899', bg: '#fce7f3' },
];

const Discover: React.FC = () => {
  const scales = [
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
  ];

  useEffect(() => {
    const entrance = Animated.stagger(
      150,
      scales.map((s) =>
        Animated.timing(s, { toValue: 1, duration: 300, useNativeDriver: true }),
      ),
    );
    entrance.start();
    return () => entrance.stop();
  }, [scales[0], scales[1], scales[2], scales[3]]);

  return (
    <View style={styles.scene}>
      {/* Dotted cross lines */}
      <View style={styles.discoverHLine} />
      <View style={styles.discoverVLine} />

      {/* 2x2 grid */}
      <View style={styles.discoverGrid}>
        {DISCOVER_ITEMS.map((item, i) => (
          <Animated.View
            key={i}
            style={[
              styles.discoverCircle,
              { backgroundColor: item.bg, transform: [{ scale: scales[i] }] },
            ]}
          >
            <Ionicons name={item.icon} size={16} color={item.color} />
          </Animated.View>
        ))}
      </View>
    </View>
  );
};

// ─── Chats ───────────────────────────────────────────────────

const Chats: React.FC = () => {
  const leftX = useRef(new Animated.Value(-40)).current;
  const rightX = useRef(new Animated.Value(40)).current;
  const dot0 = useRef(new Animated.Value(0.3)).current;
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    // Entrance
    const entrance = Animated.parallel([
      Animated.timing(leftX, { toValue: 0, duration: 300, useNativeDriver: true }),
      Animated.timing(rightX, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]);
    entrance.start();

    // Pulsing dots
    const dotLoops = [dot0, dot1, dot2].map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 200),
          Animated.timing(d, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(d, { toValue: 0.3, duration: 400, useNativeDriver: true }),
        ]),
      ),
    );
    dotLoops.forEach((l) => l.start());

    return () => {
      entrance.stop();
      dotLoops.forEach((l) => l.stop());
    };
  }, [leftX, rightX, dot0, dot1, dot2]);

  return (
    <View style={styles.scene}>
      {/* Left bubble */}
      <Animated.View
        style={[
          styles.bubbleLeft,
          { transform: [{ translateX: leftX }] },
        ]}
      >
        <View style={styles.bubbleDotsRow}>
          <Animated.View style={[styles.bubbleDot, { opacity: dot0 }]} />
          <Animated.View style={[styles.bubbleDot, { opacity: dot1 }]} />
          <Animated.View style={[styles.bubbleDot, { opacity: dot2 }]} />
        </View>
        <View style={styles.bubbleTailLeft} />
      </Animated.View>

      {/* Right bubble */}
      <Animated.View
        style={[
          styles.bubbleRight,
          { transform: [{ translateX: rightX }] },
        ]}
      >
        <View style={styles.bubbleTailRight} />
      </Animated.View>
    </View>
  );
};

// ─── Likes ───────────────────────────────────────────────────

const Likes: React.FC = () => {
  const heartOpacity = useRef(new Animated.Value(1)).current;
  const heartScale = useRef(new Animated.Value(1)).current;
  const calendarOpacity = useRef(new Animated.Value(0)).current;
  const calendarScale = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(1000),
        // Heart out, calendar in
        Animated.parallel([
          Animated.timing(heartOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
          Animated.timing(heartScale, { toValue: 0.8, duration: 400, useNativeDriver: true }),
          Animated.timing(calendarOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(calendarScale, { toValue: 1, duration: 400, useNativeDriver: true }),
        ]),
        Animated.delay(1000),
        // Calendar out, heart in
        Animated.parallel([
          Animated.timing(calendarOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
          Animated.timing(calendarScale, { toValue: 0.8, duration: 400, useNativeDriver: true }),
          Animated.timing(heartOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(heartScale, { toValue: 1, duration: 400, useNativeDriver: true }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [heartOpacity, heartScale, calendarOpacity, calendarScale]);

  return (
    <View style={styles.scene}>
      <Sparkle top={16} left={20} delay={0} />
      <Sparkle top={16} right={20} delay={300} />
      <Sparkle bottom={20} left={28} delay={600} />
      <Sparkle bottom={20} right={28} delay={900} />

      <Animated.View
        style={[
          styles.likesIcon,
          { opacity: heartOpacity, transform: [{ scale: heartScale }] },
        ]}
      >
        <Ionicons name="heart" size={32} color={ORANGE} />
      </Animated.View>

      <Animated.View
        style={[
          styles.likesIcon,
          { opacity: calendarOpacity, transform: [{ scale: calendarScale }] },
        ]}
      >
        <Ionicons name="calendar" size={32} color={ORANGE} />
      </Animated.View>
    </View>
  );
};

// ─── Profile ─────────────────────────────────────────────────

const Profile: React.FC = () => {
  const pencilScale = useRef(new Animated.Value(1)).current;
  const circleRotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pencilLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pencilScale, { toValue: 1.2, duration: 800, useNativeDriver: true }),
        Animated.timing(pencilScale, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]),
    );

    const rotateLoop = Animated.loop(
      Animated.timing(circleRotate, {
        toValue: 360,
        duration: 12000,
        useNativeDriver: true,
      }),
    );

    pencilLoop.start();
    rotateLoop.start();

    return () => {
      pencilLoop.stop();
      rotateLoop.stop();
    };
  }, [pencilScale, circleRotate]);

  const rotateDeg = circleRotate.interpolate({
    inputRange: [0, 360],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={styles.scene}>
      {/* Dashed circle */}
      <Animated.View
        style={[
          styles.profileDashedCircle,
          { transform: [{ rotate: rotateDeg }] },
        ]}
      />

      {/* Person icon */}
      <View style={styles.profilePerson}>
        <Ionicons name="person" size={40} color={ORANGE} />
      </View>

      {/* Edit pencil at top-right */}
      <Animated.View
        style={[
          styles.profilePencil,
          { transform: [{ scale: pencilScale }] },
        ]}
      >
        <Ionicons name="pencil" size={12} color={ORANGE} />
      </Animated.View>

      <Sparkle top={14} left={22} delay={0} />
      <Sparkle bottom={18} right={24} delay={400} />
    </View>
  );
};

// ─── Board ───────────────────────────────────────────────────

const Board: React.FC = () => {
  const avatar0 = useRef(new Animated.Value(0)).current;
  const avatar1 = useRef(new Animated.Value(0)).current;
  const avatar2 = useRef(new Animated.Value(0)).current;
  const lineOpacity = useRef(new Animated.Value(0)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const entrance = Animated.sequence([
      Animated.stagger(150, [
        Animated.timing(avatar0, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(avatar1, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(avatar2, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]),
      Animated.timing(lineOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(cardOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]);
    entrance.start();
    return () => entrance.stop();
  }, [avatar0, avatar1, avatar2, lineOpacity, cardOpacity]);

  return (
    <View style={styles.scene}>
      {/* Lines connecting avatars */}
      <Animated.View style={[styles.boardLines, { opacity: lineOpacity }]}>
        {/* Top to bottom-left */}
        <View style={[styles.boardLine, styles.boardLineTopLeft]} />
        {/* Top to bottom-right */}
        <View style={[styles.boardLine, styles.boardLineTopRight]} />
        {/* Bottom left to right */}
        <View style={[styles.boardLine, styles.boardLineBottom]} />
      </Animated.View>

      {/* Top avatar */}
      <Animated.View
        style={[
          styles.boardAvatar,
          styles.boardAvatarTop,
          { backgroundColor: ORANGE, transform: [{ scale: avatar0 }] },
        ]}
      />
      {/* Bottom-left avatar */}
      <Animated.View
        style={[
          styles.boardAvatar,
          styles.boardAvatarBL,
          { backgroundColor: '#22c55e', transform: [{ scale: avatar1 }] },
        ]}
      />
      {/* Bottom-right avatar */}
      <Animated.View
        style={[
          styles.boardAvatar,
          styles.boardAvatarBR,
          { backgroundColor: '#3b82f6', transform: [{ scale: avatar2 }] },
        ]}
      />

      {/* Center card */}
      <Animated.View style={[styles.boardCard, { opacity: cardOpacity }]} />
    </View>
  );
};

// ─── Main Component ──────────────────────────────────────────

const WelcomeIllustration: React.FC<WelcomeIllustrationProps> = ({ scene }) => {
  const renderScene = (): React.ReactNode => {
    switch (scene) {
      case 'explore':
        return <Explore />;
      case 'discover':
        return <Discover />;
      case 'chats':
        return <Chats />;
      case 'likes':
        return <Likes />;
      case 'profile':
        return <Profile />;
      case 'board':
        return <Board />;
      default:
        return null;
    }
  };

  return <View style={styles.container}>{renderScene()}</View>;
};

export { WelcomeIllustration };

// ─── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    width: CONTAINER_SIZE,
    height: CONTAINER_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scene: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkle: {
    position: 'absolute',
    width: SPARKLE_SIZE,
    height: SPARKLE_SIZE,
    backgroundColor: SPARKLE_COLOR,
  },

  // ── Explore ──
  exploreCard: {
    width: 36,
    height: 48,
    borderRadius: 6,
    position: 'absolute',
  },
  exploreCardBack: {
    backgroundColor: '#fed7aa',
    zIndex: 1,
  },
  exploreCardMiddle: {
    backgroundColor: '#fdba74',
    zIndex: 2,
  },
  exploreCardFront: {
    backgroundColor: ORANGE,
    zIndex: 3,
  },
  sparkleRow: {
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    height: 20,
  },

  // ── Discover ──
  discoverGrid: {
    width: 76,
    height: 76,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignContent: 'space-between',
  },
  discoverCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discoverHLine: {
    position: 'absolute',
    width: 40,
    height: 1,
    borderStyle: 'dashed',
    borderWidth: 0.5,
    borderColor: '#e5e7eb',
  },
  discoverVLine: {
    position: 'absolute',
    width: 1,
    height: 40,
    borderStyle: 'dashed',
    borderWidth: 0.5,
    borderColor: '#e5e7eb',
  },

  // ── Chats ──
  bubbleLeft: {
    position: 'absolute',
    left: '10%',
    top: '25%',
    width: 48,
    height: 32,
    borderRadius: 12,
    backgroundColor: ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleDotsRow: {
    flexDirection: 'row',
    gap: 4,
  },
  bubbleDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ffffff',
  },
  bubbleTailLeft: {
    position: 'absolute',
    bottom: -5,
    left: 6,
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: ORANGE,
  },
  bubbleRight: {
    position: 'absolute',
    right: '10%',
    top: '42%',
    width: 48,
    height: 32,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  bubbleTailRight: {
    position: 'absolute',
    bottom: -5,
    right: 6,
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#ffffff',
  },

  // ── Likes ──
  likesIcon: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Profile ──
  profileDashedCircle: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(249,115,22,0.3)',
  },
  profilePerson: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profilePencil: {
    position: 'absolute',
    top: '18%',
    right: '22%',
  },

  // ── Board ──
  boardAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    position: 'absolute',
  },
  boardAvatarTop: {
    top: '18%',
    left: '50%',
    marginLeft: -10,
  },
  boardAvatarBL: {
    bottom: '22%',
    left: '25%',
    marginLeft: -10,
  },
  boardAvatarBR: {
    bottom: '22%',
    right: '25%',
    marginRight: -10,
  },
  boardLines: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  boardLine: {
    position: 'absolute',
    backgroundColor: '#e5e7eb',
  },
  boardLineTopLeft: {
    width: 1,
    height: 36,
    top: '30%',
    left: '38%',
    transform: [{ rotate: '30deg' }],
  },
  boardLineTopRight: {
    width: 1,
    height: 36,
    top: '30%',
    right: '38%',
    transform: [{ rotate: '-30deg' }],
  },
  boardLineBottom: {
    width: 36,
    height: 1,
    bottom: '28%',
    left: '50%',
    marginLeft: -18,
  },
  boardCard: {
    width: 16,
    height: 20,
    borderRadius: 3,
    backgroundColor: '#f3f4f6',
    position: 'absolute',
  },
});
