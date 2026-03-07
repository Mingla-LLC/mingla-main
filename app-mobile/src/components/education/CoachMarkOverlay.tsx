import { useRef, useEffect, useCallback, useState } from 'react';
import { Animated, Pressable, StyleSheet, View, AccessibilityInfo } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useCoachMarkStore } from '../../store/coachMarkStore';
import { COACH_MARKS, TUTORIAL_SEQUENCE } from '../../constants/coachMarks';
import { SpotlightMask } from './SpotlightMask';
import { CoachMarkTooltip } from './CoachMarkTooltip';

export function CoachMarkOverlay() {
  const isVisible = useCoachMarkStore(s => s.isVisible);
  const currentMark = useCoachMarkStore(s => s.currentMark);
  const currentTargetLayout = useCoachMarkStore(s => s.currentTargetLayout);
  const completedIds = useCoachMarkStore(s => s.completedIds);
  const dismiss = useCoachMarkStore(s => s.dismiss);
  const skipGroup = useCoachMarkStore(s => s.skipGroup);
  const isTutorialMode = useCoachMarkStore(s => s.isTutorialMode);
  const tutorialIndex = useCoachMarkStore(s => s.tutorialIndex);
  const restartTutorial = useCoachMarkStore(s => s.restartTutorial);
  const insets = useSafeAreaInsets();

  // Entrance animation protection: buttons and backdrop are inactive until animation completes
  const [isEntranceComplete, setIsEntranceComplete] = useState(false);

  // Reduced motion preference
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  // Animation values
  const maskOpacity = useRef(new Animated.Value(0)).current;
  const glowScale = useRef(new Animated.Value(0.9)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const tooltipTranslateY = useRef(new Animated.Value(30)).current;
  const tooltipOpacity = useRef(new Animated.Value(0)).current;
  const isAnimatingOut = useRef(false);

  // Entrance animation
  useEffect(() => {
    if (isVisible && currentMark) {
      isAnimatingOut.current = false;
      setIsEntranceComplete(false);

      // Reset values
      maskOpacity.setValue(0);
      glowScale.setValue(0.9);
      glowOpacity.setValue(0);
      tooltipTranslateY.setValue(30);
      tooltipOpacity.setValue(0);

      // Haptic on show
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      if (reduceMotion) {
        // Skip animations for reduced motion
        maskOpacity.setValue(1);
        glowScale.setValue(1);
        glowOpacity.setValue(1);
        tooltipTranslateY.setValue(0);
        tooltipOpacity.setValue(1);
        setIsEntranceComplete(true);
        return;
      }

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
      ]).start(() => {
        setIsEntranceComplete(true);
      });
    }
  }, [isVisible, currentMark?.id]);

  // Reset isEntranceComplete when visibility drops
  useEffect(() => {
    if (!isVisible) {
      setIsEntranceComplete(false);
    }
  }, [isVisible]);

  const animateOut = useCallback((callback: () => void) => {
    if (isAnimatingOut.current) return;
    isAnimatingOut.current = true;

    if (reduceMotion) {
      callback();
      return;
    }

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
  }, [reduceMotion]);

  const handleGotIt = useCallback(() => {
    if (!isEntranceComplete) return;
    Haptics.selectionAsync();
    animateOut(() => dismiss());
  }, [dismiss, animateOut, isEntranceComplete]);

  const handleSkipAll = useCallback(() => {
    if (!isEntranceComplete) return;
    if (!currentMark) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animateOut(() => skipGroup(currentMark.group));
  }, [currentMark, skipGroup, animateOut, isEntranceComplete]);

  const handleBack = useCallback(() => {
    if (!isEntranceComplete) return;
    if (!isTutorialMode) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    animateOut(() => restartTutorial());
  }, [isTutorialMode, restartTutorial, animateOut, isEntranceComplete]);

  if (!isVisible || !currentMark) {
    return null;
  }

  // Determine if we have a spotlight target
  const hasTarget = currentTargetLayout !== null;
  const target = currentTargetLayout;

  const spotlightPadding = currentMark.spotlight.padding;
  const spotlightBorderRadius = currentMark.spotlight.borderRadius ?? 16;

  // Calculate group progress for step indicator
  const groupMarks = Object.values(COACH_MARKS).filter(m => m.group === currentMark.group);
  const totalInGroup = groupMarks.length;
  const completedInGroup = groupMarks.filter(m => completedIds.includes(m.id)).length;
  const currentPosition = completedInGroup + 1;

  // Tutorial global progress
  const tutorialTotal = TUTORIAL_SEQUENCE.length;
  const tutorialCurrent = tutorialIndex + 1;

  // Glow border position (only when target exists)
  const glowStyle = hasTarget && target
    ? currentMark.spotlight.shape === 'circle'
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
        }
    : null;

  return (
    <View
      style={styles.overlay}
      pointerEvents="box-none"
      accessibilityViewIsModal={true}
    >
      {/* Backdrop: absorbs touches but does NOT dismiss */}
      <Pressable
        style={StyleSheet.absoluteFill}
        pointerEvents={isEntranceComplete ? 'auto' : 'none'}
        accessibilityLabel="Tutorial tip overlay"
      >
        {hasTarget && target ? (
          <SpotlightMask
            targetLayout={target}
            shape={currentMark.spotlight.shape}
            padding={spotlightPadding}
            borderRadius={spotlightBorderRadius}
            opacity={maskOpacity}
          />
        ) : (
          // No target — just a dark backdrop, no spotlight hole
          <Animated.View
            style={[StyleSheet.absoluteFill, styles.darkBackdrop, { opacity: maskOpacity }]}
          />
        )}
      </Pressable>

      {/* Glow border around target (only when target exists) */}
      {hasTarget && glowStyle && (
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
      )}

      {/* Tooltip */}
      <CoachMarkTooltip
        mark={currentMark}
        targetLayout={target}
        translateY={tooltipTranslateY}
        opacity={tooltipOpacity}
        onGotIt={handleGotIt}
        onSkipAll={handleSkipAll}
        onBack={isTutorialMode ? handleBack : undefined}
        insets={{ top: insets.top, bottom: insets.bottom }}
        isInteractive={isEntranceComplete}
        groupProgress={{ current: currentPosition, total: totalInGroup }}
        tutorialProgress={isTutorialMode ? { current: tutorialCurrent, total: tutorialTotal } : undefined}
        isTutorialMode={isTutorialMode}
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
  darkBackdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
});
