import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type GestureType =
  | 'swipe-right'
  | 'swipe-left'
  | 'tap'
  | 'long-press'
  | 'pull-down'
  | 'swipe-card-left';

interface GestureIllustrationProps {
  gesture: GestureType;
}

const CONTAINER_SIZE = 120;
const CARD_W = 40;
const CARD_H = 56;
const HAND_SIZE = 20;
const FINGER_SIZE = 12;
const TARGET_SIZE = 32;

const COLORS = {
  cardOrange: 'rgba(249,115,22,0.3)',
  hand: '#9ca3af',
  check: '#22c55e',
  x: '#d1d5db',
  orange: '#f97316',
  orangeLight: 'rgba(249,115,22,0.2)',
  orangeRipple: 'rgba(249,115,22,0.15)',
  bar: '#e5e7eb',
  listItem: '#f3f4f6',
  blue: '#3b82f6',
  gray: '#9ca3af',
};

// ─── Swipe Right ─────────────────────────────────────────────

const SwipeRight: React.FC = () => {
  const handX = useRef(new Animated.Value(-30)).current;
  const cardX = useRef(new Animated.Value(0)).current;
  const cardRotate = useRef(new Animated.Value(0)).current;
  const checkOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(handX, { toValue: 10, duration: 600, useNativeDriver: true }),
          Animated.timing(cardX, { toValue: 30, duration: 600, useNativeDriver: true }),
          Animated.timing(cardRotate, { toValue: 12, duration: 600, useNativeDriver: true }),
          Animated.timing(checkOpacity, { toValue: 1, duration: 600, useNativeDriver: true }),
        ]),
        Animated.delay(400),
        Animated.parallel([
          Animated.timing(handX, { toValue: -30, duration: 400, useNativeDriver: true }),
          Animated.timing(cardX, { toValue: 0, duration: 400, useNativeDriver: true }),
          Animated.timing(cardRotate, { toValue: 0, duration: 400, useNativeDriver: true }),
          Animated.timing(checkOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
        ]),
        Animated.delay(500),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [handX, cardX, cardRotate, checkOpacity]);

  const rotate = cardRotate.interpolate({
    inputRange: [0, 12],
    outputRange: ['0deg', '12deg'],
  });

  return (
    <View style={styles.scene}>
      <Animated.View
        style={[
          styles.card,
          { transform: [{ translateX: cardX }, { rotate }] },
        ]}
      />
      <Animated.View
        style={[
          styles.checkContainer,
          { opacity: checkOpacity },
        ]}
      >
        <Ionicons name="checkmark-circle" size={16} color={COLORS.check} />
      </Animated.View>
      <Animated.View
        style={[
          styles.hand,
          { transform: [{ translateX: handX }, { translateY: 0 }] },
        ]}
      />
    </View>
  );
};

// ─── Swipe Left ──────────────────────────────────────────────

const SwipeLeft: React.FC = () => {
  const handX = useRef(new Animated.Value(30)).current;
  const cardX = useRef(new Animated.Value(0)).current;
  const cardRotate = useRef(new Animated.Value(0)).current;
  const xOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(handX, { toValue: -10, duration: 600, useNativeDriver: true }),
          Animated.timing(cardX, { toValue: -30, duration: 600, useNativeDriver: true }),
          Animated.timing(cardRotate, { toValue: -12, duration: 600, useNativeDriver: true }),
          Animated.timing(xOpacity, { toValue: 1, duration: 600, useNativeDriver: true }),
        ]),
        Animated.delay(400),
        Animated.parallel([
          Animated.timing(handX, { toValue: 30, duration: 400, useNativeDriver: true }),
          Animated.timing(cardX, { toValue: 0, duration: 400, useNativeDriver: true }),
          Animated.timing(cardRotate, { toValue: 0, duration: 400, useNativeDriver: true }),
          Animated.timing(xOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
        ]),
        Animated.delay(500),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [handX, cardX, cardRotate, xOpacity]);

  const rotate = cardRotate.interpolate({
    inputRange: [-12, 0],
    outputRange: ['-12deg', '0deg'],
  });

  return (
    <View style={styles.scene}>
      <Animated.View
        style={[
          styles.card,
          { transform: [{ translateX: cardX }, { rotate }] },
        ]}
      />
      <Animated.View
        style={[
          styles.xContainer,
          { opacity: xOpacity },
        ]}
      >
        <Ionicons name="close-circle" size={16} color={COLORS.x} />
      </Animated.View>
      <Animated.View
        style={[
          styles.hand,
          { transform: [{ translateX: handX }, { translateY: 0 }] },
        ]}
      />
    </View>
  );
};

// ─── Tap ─────────────────────────────────────────────────────

const Tap: React.FC = () => {
  const fingerY = useRef(new Animated.Value(-15)).current;
  const rippleScale = useRef(new Animated.Value(0)).current;
  const rippleOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(fingerY, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.parallel([
          Animated.timing(rippleScale, { toValue: 1, duration: 500, useNativeDriver: true }),
          Animated.sequence([
            Animated.timing(rippleOpacity, { toValue: 1, duration: 100, useNativeDriver: true }),
            Animated.timing(rippleOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
          ]),
        ]),
        Animated.timing(fingerY, { toValue: -15, duration: 300, useNativeDriver: true }),
        Animated.parallel([
          Animated.timing(rippleScale, { toValue: 0, duration: 0, useNativeDriver: true }),
          Animated.timing(rippleOpacity, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
        Animated.delay(400),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [fingerY, rippleScale, rippleOpacity]);

  const rippleTransform = rippleScale.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 48 / TARGET_SIZE],
  });

  return (
    <View style={styles.scene}>
      <View style={styles.tapTarget} />
      <Animated.View
        style={[
          styles.ripple,
          {
            opacity: rippleOpacity,
            transform: [{ scale: rippleTransform }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.finger,
          { transform: [{ translateY: fingerY }] },
        ]}
      />
    </View>
  );
};

// ─── Long Press ──────────────────────────────────────────────

const LongPress: React.FC = () => {
  const fingerY = useRef(new Animated.Value(-15)).current;
  const arcRotation = useRef(new Animated.Value(0)).current;
  const targetScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        // Finger descends
        Animated.timing(fingerY, { toValue: 0, duration: 300, useNativeDriver: true }),
        // Arc draws clockwise
        Animated.timing(arcRotation, { toValue: 1, duration: 1200, useNativeDriver: true }),
        // Target pulses
        Animated.sequence([
          Animated.timing(targetScale, { toValue: 1.1, duration: 200, useNativeDriver: true }),
          Animated.timing(targetScale, { toValue: 1.0, duration: 200, useNativeDriver: true }),
        ]),
        // Finger lifts
        Animated.timing(fingerY, { toValue: -15, duration: 300, useNativeDriver: true }),
        // Reset arc
        Animated.timing(arcRotation, { toValue: 0, duration: 0, useNativeDriver: true }),
        Animated.delay(500),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [fingerY, arcRotation, targetScale]);

  const arcRotateDeg = arcRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={styles.scene}>
      <Animated.View
        style={[
          styles.longPressTarget,
          { transform: [{ scale: targetScale }] },
        ]}
      />
      {/* Progress arc: half-circle rotating with a clip */}
      <View style={styles.arcContainer}>
        <Animated.View
          style={[
            styles.arcRotator,
            { transform: [{ rotate: arcRotateDeg }] },
          ]}
        >
          <View style={styles.arcHalf} />
        </Animated.View>
      </View>
      <Animated.View
        style={[
          styles.finger,
          { transform: [{ translateY: fingerY }] },
        ]}
      />
    </View>
  );
};

// ─── Pull Down ───────────────────────────────────────────────

const PullDown: React.FC = () => {
  const handY = useRef(new Animated.Value(0)).current;
  const barY = useRef(new Animated.Value(0)).current;
  const refreshOpacity = useRef(new Animated.Value(0)).current;
  const refreshRotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(handY, { toValue: 24, duration: 600, useNativeDriver: true }),
          Animated.timing(barY, { toValue: 24, duration: 600, useNativeDriver: true }),
          Animated.timing(refreshOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(refreshRotate, { toValue: 180, duration: 600, useNativeDriver: true }),
        ]),
        Animated.delay(400),
        Animated.parallel([
          Animated.timing(handY, { toValue: 0, duration: 400, useNativeDriver: true }),
          Animated.timing(barY, { toValue: 0, duration: 400, useNativeDriver: true }),
          Animated.timing(refreshOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.timing(refreshRotate, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
        Animated.delay(500),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [handY, barY, refreshOpacity, refreshRotate]);

  const rotateDeg = refreshRotate.interpolate({
    inputRange: [0, 180],
    outputRange: ['0deg', '180deg'],
  });

  return (
    <View style={styles.scene}>
      <Animated.View
        style={[
          styles.pullBar,
          { transform: [{ translateY: barY }] },
        ]}
      />
      <Animated.View
        style={[
          styles.refreshIcon,
          {
            opacity: refreshOpacity,
            transform: [{ translateY: barY }, { rotate: rotateDeg }],
          },
        ]}
      >
        <Ionicons name="refresh" size={16} color={COLORS.orange} />
      </Animated.View>
      <Animated.View
        style={[
          styles.handDot,
          { transform: [{ translateY: handY }] },
        ]}
      />
    </View>
  );
};

// ─── Swipe Card Left ─────────────────────────────────────────

const SwipeCardLeft: React.FC = () => {
  const handX = useRef(new Animated.Value(20)).current;
  const itemX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(handX, { toValue: -20, duration: 600, useNativeDriver: true }),
          Animated.timing(itemX, { toValue: -30, duration: 600, useNativeDriver: true }),
        ]),
        Animated.delay(500),
        Animated.parallel([
          Animated.timing(handX, { toValue: 20, duration: 400, useNativeDriver: true }),
          Animated.timing(itemX, { toValue: 0, duration: 400, useNativeDriver: true }),
        ]),
        Animated.delay(500),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [handX, itemX]);

  return (
    <View style={styles.scene}>
      {/* Revealed action squares behind the list item */}
      <View style={styles.actionSquaresRow}>
        <View style={[styles.actionSquare, styles.actionOrange]} />
        <View style={[styles.actionSquare, styles.actionBlue]} />
        <View style={[styles.actionSquare, styles.actionGray]} />
      </View>
      <Animated.View
        style={[
          styles.listItem,
          { transform: [{ translateX: itemX }] },
        ]}
      />
      <Animated.View
        style={[
          styles.hand,
          { transform: [{ translateX: handX }, { translateY: 0 }] },
        ]}
      />
    </View>
  );
};

// ─── Main Component ──────────────────────────────────────────

const GestureIllustration: React.FC<GestureIllustrationProps> = ({ gesture }) => {
  const renderScene = (): React.ReactNode => {
    switch (gesture) {
      case 'swipe-right':
        return <SwipeRight />;
      case 'swipe-left':
        return <SwipeLeft />;
      case 'tap':
        return <Tap />;
      case 'long-press':
        return <LongPress />;
      case 'pull-down':
        return <PullDown />;
      case 'swipe-card-left':
        return <SwipeCardLeft />;
      default:
        return null;
    }
  };

  return <View style={styles.container}>{renderScene()}</View>;
};

export { GestureIllustration };

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

  // Swipe card
  card: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 8,
    backgroundColor: COLORS.cardOrange,
    position: 'absolute',
  },
  hand: {
    width: HAND_SIZE,
    height: HAND_SIZE,
    borderRadius: HAND_SIZE / 2,
    backgroundColor: COLORS.hand,
    position: 'absolute',
  },
  checkContainer: {
    position: 'absolute',
    left: '20%',
  },
  xContainer: {
    position: 'absolute',
    right: '20%',
  },

  // Tap
  tapTarget: {
    width: TARGET_SIZE,
    height: TARGET_SIZE,
    borderRadius: TARGET_SIZE / 2,
    backgroundColor: COLORS.orangeLight,
    position: 'absolute',
  },
  ripple: {
    width: TARGET_SIZE,
    height: TARGET_SIZE,
    borderRadius: TARGET_SIZE / 2,
    backgroundColor: COLORS.orangeRipple,
    position: 'absolute',
  },
  finger: {
    width: FINGER_SIZE,
    height: FINGER_SIZE,
    borderRadius: FINGER_SIZE / 2,
    backgroundColor: COLORS.hand,
    position: 'absolute',
  },

  // Long press
  longPressTarget: {
    width: TARGET_SIZE,
    height: TARGET_SIZE,
    borderRadius: TARGET_SIZE / 2,
    backgroundColor: COLORS.orangeLight,
    position: 'absolute',
  },
  arcContainer: {
    width: TARGET_SIZE + 8,
    height: TARGET_SIZE + 8,
    borderRadius: (TARGET_SIZE + 8) / 2,
    position: 'absolute',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arcRotator: {
    width: TARGET_SIZE + 8,
    height: TARGET_SIZE + 8,
    position: 'absolute',
  },
  arcHalf: {
    width: (TARGET_SIZE + 8) / 2,
    height: TARGET_SIZE + 8,
    borderTopLeftRadius: (TARGET_SIZE + 8) / 2,
    borderBottomLeftRadius: (TARGET_SIZE + 8) / 2,
    borderWidth: 2,
    borderRightWidth: 0,
    borderColor: COLORS.orange,
  },

  // Pull down
  pullBar: {
    width: 60,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.bar,
    position: 'absolute',
    top: '25%',
  },
  refreshIcon: {
    position: 'absolute',
    top: '42%',
  },
  handDot: {
    width: FINGER_SIZE,
    height: FINGER_SIZE,
    borderRadius: FINGER_SIZE / 2,
    backgroundColor: COLORS.hand,
    position: 'absolute',
    top: '22%',
  },

  // Swipe card left
  listItem: {
    width: 80,
    height: 24,
    borderRadius: 6,
    backgroundColor: COLORS.listItem,
    position: 'absolute',
  },
  actionSquaresRow: {
    flexDirection: 'row',
    position: 'absolute',
    right: '12%',
    gap: 2,
  },
  actionSquare: {
    width: 16,
    height: 16,
    borderRadius: 2,
  },
  actionOrange: {
    backgroundColor: COLORS.orange,
  },
  actionBlue: {
    backgroundColor: COLORS.blue,
  },
  actionGray: {
    backgroundColor: COLORS.hand,
  },
});
