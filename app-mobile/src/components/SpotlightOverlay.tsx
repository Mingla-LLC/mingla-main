import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Easing,
  Keyboard,
  Dimensions,
  AccessibilityInfo,
} from 'react-native';
import Svg, { Defs, Rect, Mask } from 'react-native-svg';
import { useCoachMarkContext, TargetRect } from '../contexts/CoachMarkContext';
import { useAppLayout } from '../hooks/useAppLayout';
import { COACH_STEP_COUNT } from '../constants/coachMarkSteps';

// ── Constants ───────────────────────────────────────────────────────────────

const OVERLAY_COLOR = 'rgba(0,0,0,0.65)';
const OVERLAY_MAP_COLOR = 'rgba(0,0,0,0.45)';
const CUTOUT_PADDING = 8;
const CUTOUT_EXTRA_RADIUS = 4;
const GLOW_COLOR = 'rgba(235,120,37,0.4)';
const GLOW_WIDTH = 2;
const BUBBLE_MARGIN = 16;
const BUBBLE_CUTOUT_GAP = 12;
const ARROW_WIDTH = 12;
const ARROW_HEIGHT = 8;
const ARROW_MIN_OFFSET = 24;

const ENTRY_DELAY = 1500;
const FADE_IN_DURATION = 300;
const FADE_OUT_DURATION = 250;
const BUBBLE_ENTRY_DURATION = 200;

const MAP_STEP = 6;

// ── Component ───────────────────────────────────────────────────────────────

export default function SpotlightOverlay(): React.ReactElement | null {
  const {
    isCoachActive,
    currentStep,
    currentStepConfig,
    nextStep,
    prevStep,
    skipTour,
    targetMeasurements,
    overlayVisible,
  } = useCoachMarkContext();
  const layout = useAppLayout();

  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const bubbleOpacity = useRef(new Animated.Value(0)).current;
  const bubbleScale = useRef(new Animated.Value(0.95)).current;
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [bubbleHeight, setBubbleHeight] = useState(0);
  const hasEnteredRef = useRef(false);

  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

  // ── Accessibility ───────────────────────────────────────────────────────
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  // ── Keyboard ────────────────────────────────────────────────────────────
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // ── Overlay fade in/out ─────────────────────────────────────────────────
  useEffect(() => {
    if (overlayVisible && !keyboardVisible) {
      const duration = reduceMotion ? 0 : (hasEnteredRef.current ? FADE_IN_DURATION : FADE_IN_DURATION);
      const delay = hasEnteredRef.current ? 0 : (reduceMotion ? 0 : ENTRY_DELAY);

      Animated.timing(overlayOpacity, {
        toValue: 1,
        duration,
        delay,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start(() => {
        hasEnteredRef.current = true;
        // Fade in bubble
        Animated.parallel([
          Animated.timing(bubbleOpacity, {
            toValue: 1,
            duration: reduceMotion ? 0 : BUBBLE_ENTRY_DURATION,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(bubbleScale, {
            toValue: 1,
            duration: reduceMotion ? 0 : BUBBLE_ENTRY_DURATION,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ]).start();
      });
    } else {
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: reduceMotion ? 0 : FADE_OUT_DURATION,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }).start();
      bubbleOpacity.setValue(0);
      bubbleScale.setValue(0.95);
    }
  }, [overlayVisible, keyboardVisible, reduceMotion]);

  // ── Bubble content fade on step change ──────────────────────────────────
  useEffect(() => {
    if (!overlayVisible || !hasEnteredRef.current) return;
    // Quick fade for content change
    Animated.sequence([
      Animated.timing(bubbleOpacity, {
        toValue: 0,
        duration: reduceMotion ? 0 : 100,
        useNativeDriver: true,
      }),
      Animated.timing(bubbleOpacity, {
        toValue: 1,
        duration: reduceMotion ? 0 : 150,
        useNativeDriver: true,
      }),
    ]).start();
  }, [currentStep]);

  // ── Don't render if inactive or hidden ──────────────────────────────────
  if (!isCoachActive || keyboardVisible) return null;
  if (!currentStepConfig) return null;

  const isMapStep = currentStep === MAP_STEP;
  const isFirstStep = currentStep === 1;
  const isLastStep = currentStep === COACH_STEP_COUNT;
  const target: TargetRect | undefined = targetMeasurements.get(currentStep);
  const hasTarget = target && target.width > 0 && target.height > 0;

  // ── Cutout calculation ──────────────────────────────────────────────────
  const cutout = hasTarget && !isMapStep ? {
    x: target.x - CUTOUT_PADDING,
    y: target.y - CUTOUT_PADDING,
    width: target.width + CUTOUT_PADDING * 2,
    height: target.height + CUTOUT_PADDING * 2,
    radius: target.radius + CUTOUT_EXTRA_RADIUS,
  } : null;

  // ── Bubble positioning ──────────────────────────────────────────────────
  const bubbleMaxWidth = screenWidth - BUBBLE_MARGIN * 2;
  const bubbleWidth = Math.min(bubbleMaxWidth, 360);

  let bubbleTop: number | undefined;
  let bubbleLeft: number;
  let arrowDirection: 'up' | 'down' | 'none' = 'none';
  let arrowX = 0;

  if (isMapStep || !cutout) {
    // Centered bubble (map step or no measurement)
    bubbleTop = (screenHeight - (bubbleHeight || 180)) / 2;
    bubbleLeft = (screenWidth - bubbleWidth) / 2;
    arrowDirection = 'none';
  } else {
    const cutoutBottom = cutout.y + cutout.height;
    const cutoutTop = cutout.y;
    const spaceBelow = screenHeight - cutoutBottom - layout.bottomNavTotalHeight - 8;
    const estimatedBubbleH = bubbleHeight || 180;

    if (spaceBelow >= estimatedBubbleH + ARROW_HEIGHT + BUBBLE_CUTOUT_GAP) {
      // Below
      bubbleTop = cutoutBottom + ARROW_HEIGHT + 4;
      arrowDirection = 'up';
    } else {
      // Above
      bubbleTop = cutoutTop - estimatedBubbleH - ARROW_HEIGHT - 4;
      if (bubbleTop < layout.insets.top + 8) {
        bubbleTop = layout.insets.top + 8;
      }
      arrowDirection = 'down';
    }

    // Horizontal: center on target, clamp to screen
    const targetCenterX = target.x + target.width / 2;
    bubbleLeft = Math.max(
      BUBBLE_MARGIN,
      Math.min(targetCenterX - bubbleWidth / 2, screenWidth - bubbleWidth - BUBBLE_MARGIN)
    );

    // Arrow X: centered on target, clamped to bubble bounds
    arrowX = Math.max(
      bubbleLeft + ARROW_MIN_OFFSET,
      Math.min(targetCenterX, bubbleLeft + bubbleWidth - ARROW_MIN_OFFSET)
    );
  }

  const overlayColor = isMapStep ? OVERLAY_MAP_COLOR : OVERLAY_COLOR;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { zIndex: 100, opacity: overlayOpacity }]}
      pointerEvents={overlayVisible ? 'auto' : 'none'}
      accessibilityRole="none"
      accessibilityLabel={`Guided tour step ${currentStep} of ${COACH_STEP_COUNT}`}
    >
      {/* Layer 2: Dark overlay with SVG cutout (visual only — no touch handling) */}
      <Svg
        width={screenWidth}
        height={screenHeight}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      >
        <Defs>
          <Mask id="spotlight-mask">
            <Rect x="0" y="0" width={screenWidth} height={screenHeight} fill="white" />
            {cutout && (
              <Rect
                x={cutout.x}
                y={cutout.y}
                width={cutout.width}
                height={cutout.height}
                rx={cutout.radius}
                ry={cutout.radius}
                fill="black"
              />
            )}
          </Mask>
        </Defs>
        <Rect
          x="0"
          y="0"
          width={screenWidth}
          height={screenHeight}
          fill={overlayColor}
          mask="url(#spotlight-mask)"
        />
        {/* Glow ring around cutout */}
        {cutout && (
          <Rect
            x={cutout.x}
            y={cutout.y}
            width={cutout.width}
            height={cutout.height}
            rx={cutout.radius}
            ry={cutout.radius}
            fill="none"
            stroke={GLOW_COLOR}
            strokeWidth={GLOW_WIDTH}
          />
        )}
      </Svg>

      {/* Arrow */}
      {arrowDirection !== 'none' && cutout && (
        <View
          style={{
            position: 'absolute',
            left: arrowX - ARROW_WIDTH / 2,
            top: arrowDirection === 'up'
              ? (bubbleTop ?? 0) - ARROW_HEIGHT
              : (bubbleTop ?? 0) + (bubbleHeight || 180),
            width: 0,
            height: 0,
            borderLeftWidth: ARROW_WIDTH / 2,
            borderRightWidth: ARROW_WIDTH / 2,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            ...(arrowDirection === 'up'
              ? { borderBottomWidth: ARROW_HEIGHT, borderBottomColor: '#ffffff' }
              : { borderTopWidth: ARROW_HEIGHT, borderTopColor: '#ffffff' }),
          }}
          pointerEvents="none"
        />
      )}

      {/* Layer 3: Speech bubble — rendered last so it's on top for touch handling */}
      <Animated.View
        style={[
          styles.bubble,
          {
            top: bubbleTop,
            left: bubbleLeft,
            width: bubbleWidth,
            opacity: bubbleOpacity,
            transform: [{ scale: bubbleScale }],
          },
        ]}
        onLayout={(e) => setBubbleHeight(e.nativeEvent.layout.height)}
      >
        {/* Progress bar + counter */}
        <View style={styles.progressRow}>
          <View style={styles.progressBarContainer}>
            {Array.from({ length: COACH_STEP_COUNT }, (_, i) => (
              <View
                key={i}
                style={[
                  styles.progressSegment,
                  i < currentStep ? styles.segmentFilled : styles.segmentEmpty,
                ]}
              />
            ))}
          </View>
          <Text style={styles.stepCounter}>{currentStep} of {COACH_STEP_COUNT}</Text>
        </View>

        {/* Title */}
        <Text style={styles.title} accessibilityRole="header">
          {currentStepConfig.title}
        </Text>

        {/* Description */}
        <Text style={styles.description} numberOfLines={2} ellipsizeMode="tail">
          {currentStepConfig.description}
        </Text>

        {/* Action row */}
        <View style={styles.actionRow}>
          {/* Back button */}
          {!isFirstStep ? (
            <TouchableOpacity
              onPress={prevStep}
              style={styles.backButton}
              activeOpacity={0.5}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Go to previous step"
              accessibilityRole="button"
            >
              <Text style={styles.backText}>← Back</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.backButton} />
          )}

          {/* Skip */}
          {!isLastStep && (
            <TouchableOpacity
              onPress={skipTour}
              style={styles.skipButton}
              activeOpacity={0.5}
              accessibilityLabel="Skip guided tour"
              accessibilityRole="button"
            >
              <Text style={styles.skipText}>Skip</Text>
            </TouchableOpacity>
          )}

          {/* Primary button */}
          <TouchableOpacity
            onPress={nextStep}
            style={styles.primaryButton}
            activeOpacity={0.85}
            accessibilityLabel={isLastStep ? 'Finish guided tour' : 'Go to next step'}
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>{currentStepConfig.buttonLabel}</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bubble: {
    position: 'absolute',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    minWidth: 280,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressBarContainer: {
    flex: 1,
    flexDirection: 'row',
    gap: 4,
  },
  progressSegment: {
    flex: 1,
    height: 3,
    borderRadius: 1.5,
  },
  segmentFilled: {
    backgroundColor: '#eb7825',
  },
  segmentEmpty: {
    backgroundColor: '#e5e7eb',
  },
  stepCounter: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400',
    color: '#6b7280',
    marginLeft: 12,
  },
  title: {
    fontSize: 18,
    lineHeight: 28,
    fontWeight: '600',
    color: '#111827',
    marginTop: 10,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
    color: '#4b5563',
    marginTop: 4,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  backButton: {
    minHeight: 40,
    justifyContent: 'center',
    minWidth: 60,
  },
  backText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6b7280',
  },
  skipButton: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  skipText: {
    fontSize: 13,
    fontWeight: '400',
    color: '#9ca3af',
  },
  primaryButton: {
    backgroundColor: '#eb7825',
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 10,
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
});
