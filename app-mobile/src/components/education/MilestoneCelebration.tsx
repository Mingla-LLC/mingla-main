import React, { useRef, useEffect } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { MilestoneDefinition, MilestoneType } from '../../types/coachMark';

const CONFETTI_COUNT = 16;
const CONFETTI_COLORS = ['#f97316', '#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];
const AUTO_DISMISS_MS = 5000;

interface MilestoneCelebrationProps {
  milestone: MilestoneDefinition | null;
  onDismiss: () => void;
}

const MILESTONE_CONFIG: Record<MilestoneType, {
  icon: keyof typeof Ionicons.glyphMap;
  gradientColor: string;
}> = {
  explorer: { icon: 'compass', gradientColor: '#f97316' },
  discoverer: { icon: 'telescope', gradientColor: '#f97316' },
  connector: { icon: 'people', gradientColor: '#22c55e' },
  planner: { icon: 'calendar', gradientColor: '#3b82f6' },
  pro: { icon: 'star', gradientColor: '#f59e0b' },
  'team-player': { icon: 'people-circle', gradientColor: '#8b5cf6' },
  master: { icon: 'trophy', gradientColor: '#f59e0b' },
};

export function MilestoneCelebration({ milestone, onDismiss }: MilestoneCelebrationProps) {
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const badgeScale = useRef(new Animated.Value(0)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const bodyOpacity = useRef(new Animated.Value(0)).current;
  const buttonTranslateY = useRef(new Animated.Value(30)).current;
  const buttonOpacity = useRef(new Animated.Value(0)).current;

  // Confetti particles
  const confettiAnims = useRef(
    Array.from({ length: CONFETTI_COUNT }, () => ({
      translateX: new Animated.Value(0),
      translateY: new Animated.Value(0),
      opacity: new Animated.Value(1),
      rotate: new Animated.Value(0),
      scale: new Animated.Value(0),
    }))
  ).current;

  // Pre-compute random sizes to avoid Math.random() in render path (HIGH-003)
  const confettiSizes = useRef(
    Array.from({ length: CONFETTI_COUNT }, () => 6 + Math.random() * 4)
  ).current;

  useEffect(() => {
    if (!milestone) return;

    // Reset all animation values for clean re-entry
    backdropOpacity.setValue(0);
    badgeScale.setValue(0);
    titleOpacity.setValue(0);
    bodyOpacity.setValue(0);
    buttonTranslateY.setValue(30);
    buttonOpacity.setValue(0);
    confettiAnims.forEach(anim => {
      anim.translateX.setValue(0);
      anim.translateY.setValue(0);
      anim.opacity.setValue(1);
      anim.rotate.setValue(0);
      anim.scale.setValue(0);
    });

    const isMaster = milestone.id === 'master';

    // Haptic
    if (isMaster) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

    // 1. Backdrop fade in
    Animated.timing(backdropOpacity, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();

    // 2. Badge spring
    Animated.spring(badgeScale, {
      toValue: 1,
      tension: 120,
      friction: 6,
      useNativeDriver: true,
      delay: 200,
    }).start();

    // 3. Confetti burst after badge lands
    const confettiTimer = setTimeout(() => {
      confettiAnims.forEach((anim, i) => {
        const angle = (Math.random() * 360 * Math.PI) / 180;
        const distance = 80 + Math.random() * 80;
        const targetX = Math.cos(angle) * distance;
        const targetY = Math.sin(angle) * distance;

        anim.scale.setValue(1);

        const startDelay = Math.random() * 100;

        Animated.sequence([
          Animated.delay(startDelay),
          Animated.parallel([
            // Fly outward
            Animated.timing(anim.translateX, {
              toValue: targetX,
              duration: 600,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.timing(anim.translateY, {
              toValue: targetY,
              duration: 600,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.timing(anim.rotate, {
              toValue: Math.random() * 4 - 2,
              duration: 600,
              useNativeDriver: true,
            }),
          ]),
          // Fall with gravity
          Animated.parallel([
            Animated.timing(anim.translateY, {
              toValue: targetY + 200,
              duration: 800,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(anim.opacity, {
              toValue: 0,
              duration: 800,
              useNativeDriver: true,
            }),
          ]),
        ]).start();
      });
    }, 500);

    // 4. Title fade
    Animated.timing(titleOpacity, {
      toValue: 1,
      duration: 300,
      delay: 600,
      useNativeDriver: true,
    }).start();

    // 5. Body fade
    Animated.timing(bodyOpacity, {
      toValue: 1,
      duration: 300,
      delay: 800,
      useNativeDriver: true,
    }).start();

    // 6. Button slide up
    Animated.parallel([
      Animated.timing(buttonTranslateY, {
        toValue: 0,
        duration: 300,
        delay: 1000,
        useNativeDriver: true,
      }),
      Animated.timing(buttonOpacity, {
        toValue: 1,
        duration: 300,
        delay: 1000,
        useNativeDriver: true,
      }),
    ]).start();

    // Auto-dismiss
    const autoDismissTimer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => {
      clearTimeout(confettiTimer);
      clearTimeout(autoDismissTimer);
    };
  }, [milestone?.id]);

  if (!milestone) return null;

  const config = MILESTONE_CONFIG[milestone.id];
  const isMaster = milestone.id === 'master';
  const iconSize = isMaster ? 56 : 48;
  const badgeSize = isMaster ? 88 : 72;

  return (
    <View style={styles.overlay}>
      <Animated.View
        style={[styles.backdrop, { opacity: backdropOpacity }]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
      </Animated.View>

      <View style={styles.cardWrapper}>
        <View style={styles.card}>
          {/* Badge with confetti origin */}
          <View style={styles.badgeArea}>
            {/* Confetti particles */}
            {confettiAnims.map((anim, i) => {
              const isCircle = i % 2 === 0;
              const size = confettiSizes[i];
              const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];

              return (
                <Animated.View
                  key={i}
                  style={[
                    styles.confetti,
                    {
                      width: size,
                      height: size,
                      backgroundColor: color,
                      borderRadius: isCircle ? size / 2 : 0,
                      transform: [
                        { translateX: anim.translateX },
                        { translateY: anim.translateY },
                        {
                          rotate: isCircle
                            ? anim.rotate.interpolate({
                                inputRange: [-2, 2],
                                outputRange: ['-360deg', '360deg'],
                              })
                            : '45deg',
                        },
                        { scale: anim.scale },
                      ],
                      opacity: anim.opacity,
                    },
                  ]}
                />
              );
            })}

            {/* Badge icon */}
            <Animated.View
              style={[
                styles.badge,
                {
                  width: badgeSize,
                  height: badgeSize,
                  borderRadius: badgeSize / 2,
                  backgroundColor: config.gradientColor,
                  transform: [{ scale: badgeScale }],
                },
              ]}
            >
              <Ionicons name={config.icon as any} size={iconSize} color="#ffffff" />
            </Animated.View>
          </View>

          <Animated.Text style={[styles.title, { opacity: titleOpacity }]}>
            {milestone.title}
          </Animated.Text>

          <Animated.Text style={[styles.body, { opacity: bodyOpacity }]}>
            {milestone.body}
          </Animated.Text>

          <Animated.View
            style={{
              transform: [{ translateY: buttonTranslateY }],
              opacity: buttonOpacity,
            }}
          >
            <Pressable style={styles.button} onPress={onDismiss}>
              <Text style={styles.buttonText}>Awesome!</Text>
            </Pressable>
          </Animated.View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  cardWrapper: {
    paddingHorizontal: 32,
    width: '100%',
    maxWidth: 400,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 28,
    padding: 32,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowRadius: 24,
    shadowOpacity: 0.15,
    elevation: 12,
  },
  badgeArea: {
    width: 100,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  badge: {
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    shadowOpacity: 0.2,
    elevation: 8,
  },
  confetti: {
    position: 'absolute',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 8,
  },
  body: {
    fontSize: 16,
    fontWeight: '400',
    color: '#4b5563',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  button: {
    backgroundColor: '#f97316',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 40,
    shadowColor: '#f97316',
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    shadowOpacity: 0.4,
    elevation: 6,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
});
