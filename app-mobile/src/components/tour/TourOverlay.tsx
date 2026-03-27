import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  FadeIn,
  ZoomIn,
} from 'react-native-reanimated';
import Svg, { Defs, Mask, Rect } from 'react-native-svg';
import type { TourTargetLayout } from '../../contexts/TourTargetContext';
import { radius, spacing, shadows, typography, colors, touchTargets } from '../../constants/designSystem';

const CUTOUT_PADDING = 8;
const CUTOUT_RADIUS = radius.lg; // 16
const TOOLTIP_MAX_WIDTH = 300;
const ARROW_SIZE = 8;
const BOTTOM_NAV_HEIGHT = 80; // bottom nav + gesture bar padding

interface TourOverlayProps {
  targetLayout: TourTargetLayout | null;
  text: string;
  stepNumber: number;
  totalSteps: number;
  isLastStep: boolean;
  onNext: () => void;
  onSkip: () => void;
}

export function TourOverlay({
  targetLayout,
  text,
  stepNumber,
  totalSteps,
  isLastStep,
  onNext,
  onSkip,
}: TourOverlayProps) {
  const { width: SCREEN_W, height: SCREEN_H } = useWindowDimensions();

  // If target hasn't measured yet, show dark overlay with skip escape hatch
  if (!targetLayout) {
    return (
      <Animated.View
        entering={FadeIn.duration(200)}
        style={[StyleSheet.absoluteFill, styles.overlayRoot]}
        pointerEvents="box-only"
      >
        <View style={styles.loadingOverlay} />
        <TouchableOpacity
          onPress={onSkip}
          style={styles.loadingSkipButton}
          accessibilityRole="button"
          accessibilityLabel="Skip tour"
        >
          <Text style={styles.loadingSkipText}>Skip Tour</Text>
        </TouchableOpacity>
      </Animated.View>
    );
  }

  const cutout = {
    x: targetLayout.x - CUTOUT_PADDING,
    y: targetLayout.y - CUTOUT_PADDING,
    width: targetLayout.width + CUTOUT_PADDING * 2,
    height: targetLayout.height + CUTOUT_PADDING * 2,
  };

  // Determine tooltip position: above or below the cutout
  const spaceAbove = cutout.y;
  const spaceBelow = SCREEN_H - (cutout.y + cutout.height);
  const placeAbove = spaceAbove > spaceBelow && spaceAbove > 200;

  // Tooltip horizontal center, clamped to screen edges
  const tooltipLeft = Math.max(
    16,
    Math.min(
      cutout.x + cutout.width / 2 - TOOLTIP_MAX_WIDTH / 2,
      SCREEN_W - TOOLTIP_MAX_WIDTH - 16
    )
  );

  // Clamp tooltip so it stays above the bottom nav (min 16px from edges)
  const tooltipTopBelow = Math.min(
    cutout.y + cutout.height + 16 + ARROW_SIZE,
    SCREEN_H - BOTTOM_NAV_HEIGHT - 160 // leave room for tooltip + bottom nav
  );
  const tooltipBottomAbove = Math.max(
    SCREEN_H - cutout.y + ARROW_SIZE + 8,
    16 // never clip at top
  );

  // Arrow horizontal center relative to cutout center
  const arrowLeft = Math.max(
    tooltipLeft + 20,
    Math.min(cutout.x + cutout.width / 2 - ARROW_SIZE, tooltipLeft + TOOLTIP_MAX_WIDTH - 20 - ARROW_SIZE * 2)
  );

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      style={[StyleSheet.absoluteFill, styles.overlayRoot]}
      pointerEvents="box-none"
    >
      {/* Dark overlay with cutout hole */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <Svg width={SCREEN_W} height={SCREEN_H} style={StyleSheet.absoluteFill}>
          <Defs>
            <Mask id="spotlightMask">
              {/* White = visible (dark overlay shows) */}
              <Rect x="0" y="0" width={SCREEN_W} height={SCREEN_H} fill="white" />
              {/* Black = hidden (cutout hole) */}
              <Rect
                x={cutout.x}
                y={cutout.y}
                width={cutout.width}
                height={cutout.height}
                rx={CUTOUT_RADIUS}
                ry={CUTOUT_RADIUS}
                fill="black"
              />
            </Mask>
          </Defs>
          <Rect
            x="0"
            y="0"
            width={SCREEN_W}
            height={SCREEN_H}
            fill="rgba(0,0,0,0.6)"
            mask="url(#spotlightMask)"
          />
        </Svg>
      </View>

      {/* Touch absorber: tapping the dark area does nothing */}
      <TouchableOpacity
        activeOpacity={1}
        style={StyleSheet.absoluteFill}
        onPress={() => {}}
      />

      {/* Arrow */}
      <View
        style={[
          styles.arrow,
          {
            left: arrowLeft,
            ...(placeAbove
              ? { top: cutout.y - ARROW_SIZE - 2, transform: [{ rotate: '180deg' }] }
              : { top: cutout.y + cutout.height + 2 }),
          },
        ]}
      />

      {/* Tooltip card */}
      <Animated.View
        entering={ZoomIn.duration(300).springify()}
        style={[
          styles.tooltip,
          {
            left: tooltipLeft,
            top: placeAbove ? undefined : tooltipTopBelow,
            bottom: placeAbove ? tooltipBottomAbove : undefined,
          },
        ]}
      >
        <Text style={styles.stepIndicator}>
          {stepNumber} of {totalSteps}
        </Text>
        <Text style={styles.tooltipText}>{text}</Text>
        <View style={styles.buttonRow}>
          <TouchableOpacity
            onPress={onSkip}
            style={styles.skipButton}
            accessibilityRole="button"
            accessibilityLabel="Skip tour"
          >
            <Text style={styles.skipButtonText}>Skip Tour</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onNext}
            style={styles.nextButton}
            accessibilityRole="button"
            accessibilityLabel={isLastStep ? 'Finish tour' : 'Next step'}
          >
            <Text style={styles.nextButtonText}>
              {isLastStep ? 'Finish' : 'Next'}
            </Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    zIndex: 10,
    elevation: 10,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  loadingSkipButton: {
    position: 'absolute',
    bottom: 80,
    alignSelf: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    minHeight: touchTargets.minimum,
    justifyContent: 'center',
  },
  loadingSkipText: {
    fontSize: typography.md.fontSize,
    color: '#ffffff',
    textDecorationLine: 'underline',
  },
  arrow: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderLeftWidth: ARROW_SIZE,
    borderRightWidth: ARROW_SIZE,
    borderBottomWidth: ARROW_SIZE,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#ffffff',
    zIndex: 1001,
  },
  tooltip: {
    position: 'absolute',
    maxWidth: TOOLTIP_MAX_WIDTH,
    backgroundColor: '#ffffff',
    borderRadius: radius.lg,
    padding: spacing.md,
    zIndex: 1000,
    ...shadows.lg,
  },
  stepIndicator: {
    fontSize: typography.sm.fontSize,
    lineHeight: typography.sm.lineHeight,
    color: colors.text.tertiary,
    marginBottom: spacing.xs,
  },
  tooltipText: {
    fontSize: typography.md.fontSize,
    lineHeight: typography.md.lineHeight,
    color: colors.text.primary,
    marginBottom: spacing.md,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  skipButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: touchTargets.minimum,
    justifyContent: 'center',
  },
  skipButtonText: {
    fontSize: typography.sm.fontSize,
    color: colors.text.tertiary,
  },
  nextButton: {
    backgroundColor: colors.primary[500],
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    minHeight: touchTargets.comfortable,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nextButtonText: {
    fontSize: typography.md.fontSize,
    fontWeight: '600',
    color: '#ffffff',
  },
});
