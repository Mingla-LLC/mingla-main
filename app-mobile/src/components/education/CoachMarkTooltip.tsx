import React, { useRef, useEffect } from 'react';
import {
  Animated,
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

interface CoachMarkTooltipProps {
  mark: CoachMarkDefinition;
  targetLayout: TargetLayout;
  translateY: Animated.Value;
  opacity: Animated.Value;
  onGotIt: () => void;
  onSkipAll: () => void;
}

export function CoachMarkTooltip({
  mark,
  targetLayout,
  translateY,
  opacity,
  onGotIt,
  onSkipAll,
}: CoachMarkTooltipProps) {
  const { height: screenHeight } = useWindowDimensions();
  const buttonScale = useRef(new Animated.Value(1)).current;

  const handleGotItPressIn = () => {
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

  // Calculate tooltip position
  const tooltipTop = getTooltipTop(mark, targetLayout, screenHeight);

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

  return (
    <Animated.View
      style={[
        styles.container,
        {
          top: tooltipTop,
          transform: [{ translateY }],
          opacity,
        },
      ]}
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

        <View style={styles.actions}>
          <Pressable
            onPress={onGotIt}
            onPressIn={handleGotItPressIn}
            onPressOut={handleGotItPressOut}
          >
            <Animated.View
              style={[styles.gotItButton, { transform: [{ scale: buttonScale }] }]}
            >
              <Text style={styles.gotItText}>Got it</Text>
            </Animated.View>
          </Pressable>

          <Pressable onPress={onSkipAll} hitSlop={8}>
            <Text style={styles.skipText}>Skip all</Text>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

function getTooltipTop(
  mark: CoachMarkDefinition,
  target: TargetLayout,
  screenHeight: number
): number {
  const position = mark.tooltip.position;
  const offsetY = mark.tooltip.offsetY ?? 0;

  if (position === 'center') {
    // Centered on screen
    return screenHeight * 0.3 + offsetY;
  }

  if (position === 'above') {
    // Tooltip bottom edge above target top, with gap
    const top = target.y - GAP - 300 + offsetY; // 300 is approx tooltip height
    // If it would go above screen, flip to below
    if (top < 60) {
      return target.y + target.height + GAP + offsetY;
    }
    return Math.max(60, top);
  }

  // 'below'
  const top = target.y + target.height + GAP + offsetY;
  // If it would go below screen, flip to above
  if (top + 300 > screenHeight - 40) {
    return target.y - GAP - 300 + offsetY;
  }
  return top;
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
    backgroundColor: '#fdf6f0',
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
    marginBottom: 20,
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
});
