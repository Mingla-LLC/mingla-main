import { useRef, useState, useCallback } from 'react';
import {
  Animated,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { CoachMarkDefinition, TargetLayout } from '../../types/coachMark';
import { GestureIllustration } from './illustrations/GestureIllustration';
import { FeatureIllustration } from './illustrations/FeatureIllustration';
import { WelcomeIllustration } from './illustrations/WelcomeIllustration';

const TOOLTIP_MARGIN = 24;
const GAP = 16;
const STATUS_BAR_CLEARANCE = 8;
const TAB_BAR_HEIGHT = 80;

interface CoachMarkTooltipProps {
  mark: CoachMarkDefinition;
  targetLayout: TargetLayout | null;
  translateY: Animated.Value;
  opacity: Animated.Value;
  onGotIt: () => void;
  onSkipAll: () => void;
  onBack?: () => void;
  insets: { top: number; bottom: number };
  isInteractive: boolean;
  groupProgress: { current: number; total: number };
  tutorialProgress?: { current: number; total: number };
  isTutorialMode?: boolean;
}

export function CoachMarkTooltip({
  mark,
  targetLayout,
  translateY,
  opacity,
  onGotIt,
  onSkipAll,
  onBack,
  insets,
  isInteractive,
  groupProgress,
  tutorialProgress,
  isTutorialMode,
}: CoachMarkTooltipProps) {
  const { height: screenHeight } = useWindowDimensions();
  const buttonScale = useRef(new Animated.Value(1)).current;
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const { height } = e.nativeEvent.layout;
    if (height > 0) {
      setMeasuredHeight(height);
    }
  }, []);

  // Reset measuredHeight when mark changes so we re-measure
  const markIdRef = useRef(mark.id);
  if (markIdRef.current !== mark.id) {
    markIdRef.current = mark.id;
    setMeasuredHeight(null);
  }

  const handleGotItPressIn = () => {
    if (!isInteractive) return;
    Animated.timing(buttonScale, {
      toValue: 0.95,
      duration: 150,
      useNativeDriver: true,
    }).start();
  };

  const handleGotItPressOut = () => {
    Animated.timing(buttonScale, {
      toValue: 1,
      duration: 150,
      useNativeDriver: true,
    }).start();
  };

  // Phase 1: invisible render for measurement
  const isMeasuring = measuredHeight === null;

  // Phase 2: calculate position using actual measured height
  const tooltipTop = isMeasuring
    ? -9999 // Off-screen during measurement phase
    : targetLayout
      ? getTooltipTop(mark, targetLayout, screenHeight, measuredHeight, insets)
      : getCenteredTop(screenHeight, measuredHeight); // No target — center on screen

  const renderIllustration = () => {
    const { illustration } = mark.content;
    switch (illustration.type) {
      case 'gesture':
        return <GestureIllustration gesture={illustration.gesture} />;
      case 'feature':
        return <FeatureIllustration icon={illustration.icon} />;
      case 'welcome':
        return <WelcomeIllustration scene={illustration.scene} />;
      case 'none':
        return null;
    }
  };

  // Button label: "Next" during tutorial, "Got it" otherwise
  const gotItLabel = isTutorialMode ? 'Next' : 'Got it';

  return (
    <Animated.View
      style={[
        styles.container,
        {
          top: tooltipTop,
          transform: [{ translateY }],
          opacity: isMeasuring ? 0 : opacity,
        },
      ]}
      onLayout={handleLayout}
    >
      <View style={styles.accentLine} />
      <View style={styles.content}>
        {mark.content.illustration.type !== 'none' && (
          <View style={styles.illustrationContainer}>
            {renderIllustration()}
          </View>
        )}

        <Text style={styles.title}>{mark.content.title}</Text>
        <Text style={styles.body}>{mark.content.body}</Text>

        {/* Progress indicator */}
        {tutorialProgress ? (
          // Tutorial mode: show global progress
          <Text style={styles.stepIndicator}>
            {tutorialProgress.current} of {tutorialProgress.total}
          </Text>
        ) : groupProgress.total > 1 ? (
          // Normal mode: show group progress for multi-mark groups
          <Text style={styles.stepIndicator}>
            {groupProgress.current} of {groupProgress.total}
          </Text>
        ) : null}

        <View style={styles.actions}>
          {/* Back button (tutorial mode only) */}
          {isTutorialMode && onBack && (
            <Pressable
              onPress={onBack}
              hitSlop={8}
              disabled={!isInteractive}
              accessibilityRole="button"
              accessibilityLabel="Restart tutorial from the beginning"
            >
              <Text style={[styles.backText, !isInteractive && styles.buttonDisabled]}>
                Back to start
              </Text>
            </Pressable>
          )}

          {/* Got it / Next button */}
          <Pressable
            onPress={onGotIt}
            onPressIn={handleGotItPressIn}
            onPressOut={handleGotItPressOut}
            disabled={!isInteractive}
            accessibilityRole="button"
            accessibilityLabel={gotItLabel}
          >
            <Animated.View
              style={[
                styles.gotItButton,
                { transform: [{ scale: buttonScale }] },
                !isInteractive && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.gotItText}>{gotItLabel}</Text>
            </Animated.View>
          </Pressable>

          {/* Skip all (normal mode only — hidden during tutorial) */}
          {!isTutorialMode && (
            <Pressable
              onPress={onSkipAll}
              hitSlop={8}
              disabled={!isInteractive}
              accessibilityRole="button"
              accessibilityLabel="Skip all tips in this group"
            >
              <Text style={[styles.skipText, !isInteractive && styles.buttonDisabled]}>
                Skip all
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </Animated.View>
  );
}

function getCenteredTop(
  screenHeight: number,
  measuredHeight: number,
): number {
  return (screenHeight - measuredHeight) / 2;
}

function getTooltipTop(
  mark: CoachMarkDefinition,
  target: TargetLayout,
  screenHeight: number,
  measuredHeight: number,
  insets: { top: number; bottom: number },
): number {
  const position = mark.tooltip.position;
  const offsetY = mark.tooltip.offsetY ?? 0;
  const safeTop = insets.top + STATUS_BAR_CLEARANCE;
  const safeBottom = screenHeight - insets.bottom - TAB_BAR_HEIGHT;

  // Clamp helper: ensures tooltip stays within safe viewport
  const clamp = (top: number) =>
    Math.min(Math.max(top, safeTop), safeBottom - measuredHeight);

  if (position === 'center') {
    return clamp((screenHeight - measuredHeight) / 2 + offsetY);
  }

  if (position === 'above') {
    const candidateTop = target.y - GAP - measuredHeight + offsetY;
    // If it would go above safe area, flip to below
    if (candidateTop < safeTop) {
      return clamp(target.y + target.height + GAP + offsetY);
    }
    return clamp(candidateTop);
  }

  // 'below'
  const candidateTop = target.y + target.height + GAP + offsetY;
  // If it would go below safe area, flip to above
  if (candidateTop + measuredHeight > safeBottom) {
    return clamp(target.y - GAP - measuredHeight + offsetY);
  }
  return clamp(candidateTop);
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: TOOLTIP_MARGIN,
    right: TOOLTIP_MARGIN,
    zIndex: 1001,
  },
  accentLine: {
    height: 3,
    backgroundColor: '#f97316',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginHorizontal: 1,
  },
  content: {
    backgroundColor: '#fff7ed',
    borderRadius: 24,
    borderTopLeftRadius: 21,
    borderTopRightRadius: 21,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 15,
    shadowOpacity: 0.1,
    elevation: 8,
  },
  illustrationContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
    textAlign: 'center',
  },
  body: {
    fontSize: 16,
    fontWeight: '400',
    color: '#4b5563',
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 8,
  },
  stepIndicator: {
    fontSize: 12,
    lineHeight: 16,
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: 24,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  gotItButton: {
    backgroundColor: '#f97316',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 32,
    shadowColor: '#f97316',
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    shadowOpacity: 0.4,
    elevation: 6,
  },
  gotItText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  skipText: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '400',
  },
  backText: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '400',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
