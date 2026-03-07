import React, { useRef, useEffect, useCallback } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useCoachMarkStore } from '../../store/coachMarkStore';
import { SpotlightMask } from './SpotlightMask';
import { CoachMarkTooltip } from './CoachMarkTooltip';

export function CoachMarkOverlay() {
  const isVisible = useCoachMarkStore(s => s.isVisible);
  const currentMark = useCoachMarkStore(s => s.currentMark);
  const currentTargetLayout = useCoachMarkStore(s => s.currentTargetLayout);
  const dismiss = useCoachMarkStore(s => s.dismiss);
  const skipGroup = useCoachMarkStore(s => s.skipGroup);

  // Animation values
  const maskOpacity = useRef(new Animated.Value(0)).current;
  const glowScale = useRef(new Animated.Value(0.9)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const tooltipTranslateY = useRef(new Animated.Value(30)).current;
  const tooltipOpacity = useRef(new Animated.Value(0)).current;
  const isAnimatingOut = useRef(false);

  // Entrance animation
  useEffect(() => {
    if (isVisible && currentMark && currentTargetLayout) {
      isAnimatingOut.current = false;
      // Reset values
      maskOpacity.setValue(0);
      glowScale.setValue(0.9);
      glowOpacity.setValue(0);
      tooltipTranslateY.setValue(30);
      tooltipOpacity.setValue(0);

      // Haptic on show
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // Animate in
      Animated.parallel([
        Animated.timing(maskOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.spring(glowScale, {
          toValue: 1,
          tension: 100,
          friction: 8,
          useNativeDriver: true,
        }),
        Animated.timing(glowOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(tooltipTranslateY, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(tooltipOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isVisible, currentMark?.id]);

  const animateOut = useCallback((callback: () => void) => {
    if (isAnimatingOut.current) return;
    isAnimatingOut.current = true;

    Animated.parallel([
      Animated.timing(maskOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(glowScale, {
        toValue: 0.9,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(glowOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(tooltipTranslateY, {
        toValue: 20,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(tooltipOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      callback();
    });
  }, []);

  const handleGotIt = useCallback(() => {
    Haptics.selectionAsync();
    animateOut(() => dismiss());
  }, [dismiss, animateOut]);

  const handleSkipAll = useCallback(() => {
    if (!currentMark) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animateOut(() => skipGroup(currentMark.group));
  }, [currentMark, skipGroup, animateOut]);

  const handleOverlayPress = useCallback(() => {
    // Tapping outside = same as "Got it"
    handleGotIt();
  }, [handleGotIt]);

  if (!isVisible || !currentMark || !currentTargetLayout) {
    return null;
  }

  const target = currentTargetLayout;
  const spotlightPadding = currentMark.spotlight.padding;
  const spotlightBorderRadius = currentMark.spotlight.borderRadius ?? 16;

  // Glow border position (matches spotlight hole)
  const glowStyle =
    currentMark.spotlight.shape === 'circle'
      ? {
          left: target.x + target.width / 2 - Math.max(target.width, target.height) / 2 - spotlightPadding,
          top: target.y + target.height / 2 - Math.max(target.width, target.height) / 2 - spotlightPadding,
          width: Math.max(target.width, target.height) + spotlightPadding * 2,
          height: Math.max(target.width, target.height) + spotlightPadding * 2,
          borderRadius: (Math.max(target.width, target.height) + spotlightPadding * 2) / 2,
        }
      : {
          left: target.x - spotlightPadding,
          top: target.y - spotlightPadding,
          width: target.width + spotlightPadding * 2,
          height: target.height + spotlightPadding * 2,
          borderRadius: spotlightBorderRadius,
        };

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      {/* Tappable backdrop behind everything */}
      <Pressable style={StyleSheet.absoluteFill} onPress={handleOverlayPress}>
        <SpotlightMask
          targetLayout={target}
          shape={currentMark.spotlight.shape}
          padding={spotlightPadding}
          borderRadius={spotlightBorderRadius}
          opacity={maskOpacity}
        />
      </Pressable>

      {/* Glow border around target */}
      <Animated.View
        style={[
          styles.glowBorder,
          glowStyle,
          {
            opacity: glowOpacity,
            transform: [{ scale: glowScale }],
          },
        ]}
        pointerEvents="none"
      />

      {/* Tooltip */}
      <CoachMarkTooltip
        mark={currentMark}
        targetLayout={target}
        translateY={tooltipTranslateY}
        opacity={tooltipOpacity}
        onGotIt={handleGotIt}
        onSkipAll={handleSkipAll}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
  },
  glowBorder: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#f97316',
    shadowColor: '#f97316',
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 12,
    shadowOpacity: 0.6,
    elevation: 6,
  },
});
