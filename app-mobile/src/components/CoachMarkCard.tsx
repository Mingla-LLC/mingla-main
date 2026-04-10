import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Easing,
  Keyboard,
  AccessibilityInfo,
} from 'react-native';
import { useCoachMarkContext } from '../contexts/CoachMarkContext';
import { useAppLayout } from '../hooks/useAppLayout';
import { COACH_STEP_COUNT } from '../constants/coachMarkSteps';

// ── Constants ───────────────────────────────────────────────────────────────

const ENTRY_DELAY_MS = 1500;
const EXIT_DURATION_MS = 250;
const CROSS_FADE_OUT_MS = 120;
const CROSS_FADE_IN_MS = 180;
const CARD_ESTIMATED_HEIGHT = 180;

// ── Component ───────────────────────────────────────────────────────────────

export default function CoachMarkCard(): React.ReactElement | null {
  const { isCoachActive, currentStep, currentStepConfig, nextStep, skipTour } = useCoachMarkContext();
  const layout = useAppLayout();

  // Animation refs
  const slideAnim = useRef(new Animated.Value(CARD_ESTIMATED_HEIGHT)).current;
  const textOpacity = useRef(new Animated.Value(1)).current;
  const [displayedStep, setDisplayedStep] = useState(currentStep);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const hasEnteredRef = useRef(false);
  const prevStepRef = useRef(currentStep);
  const isExitingRef = useRef(false);

  // Check reduced motion preference
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  // Keyboard listeners — hide card when keyboard is open
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Entry animation
  useEffect(() => {
    if (!isCoachActive || hasEnteredRef.current || isExitingRef.current) return;

    if (reduceMotion) {
      slideAnim.setValue(0);
      hasEnteredRef.current = true;
      return;
    }

    const timer = setTimeout(() => {
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 65,
        friction: 11,
        useNativeDriver: true,
      }).start();
      hasEnteredRef.current = true;
    }, ENTRY_DELAY_MS);

    return () => clearTimeout(timer);
  }, [isCoachActive, reduceMotion, slideAnim]);

  // Exit animation when tour completes/skips
  useEffect(() => {
    if (isCoachActive || !hasEnteredRef.current || isExitingRef.current) return;

    isExitingRef.current = true;

    if (reduceMotion) {
      slideAnim.setValue(CARD_ESTIMATED_HEIGHT);
      return;
    }

    Animated.timing(slideAnim, {
      toValue: CARD_ESTIMATED_HEIGHT,
      duration: EXIT_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [isCoachActive, reduceMotion, slideAnim]);

  // Cross-fade text on step change
  useEffect(() => {
    if (currentStep === prevStepRef.current) return;
    if (currentStep < 1 || currentStep > COACH_STEP_COUNT) {
      prevStepRef.current = currentStep;
      return;
    }

    if (reduceMotion) {
      setDisplayedStep(currentStep);
      prevStepRef.current = currentStep;
      return;
    }

    // Fade out
    Animated.timing(textOpacity, {
      toValue: 0,
      duration: CROSS_FADE_OUT_MS,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start(() => {
      setDisplayedStep(currentStep);
      // Fade in
      Animated.timing(textOpacity, {
        toValue: 1,
        duration: CROSS_FADE_IN_MS,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }).start();
    });

    prevStepRef.current = currentStep;
  }, [currentStep, reduceMotion, textOpacity]);

  // Keep displayedStep in sync on initial render
  useEffect(() => {
    if (currentStep >= 1 && currentStep <= COACH_STEP_COUNT) {
      setDisplayedStep(currentStep);
    }
  }, []);

  // Don't render if not active or keyboard is open
  if (!isCoachActive || keyboardVisible) return null;

  const stepConfig = currentStepConfig;
  if (!stepConfig) return null;

  const isLastStep = currentStep === COACH_STEP_COUNT;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          bottom: layout.bottomNavTotalHeight,
          transform: [{ translateY: slideAnim }],
        },
      ]}
      accessibilityRole="summary"
      accessibilityLabel={`Guided tour, step ${currentStep} of ${COACH_STEP_COUNT}`}
    >
      {/* Progress bar + step counter */}
      <View style={styles.progressRow}>
        <View style={styles.progressBarContainer}>
          {Array.from({ length: COACH_STEP_COUNT }, (_, i) => (
            <View
              key={i}
              style={[
                styles.progressSegment,
                i < currentStep ? styles.progressSegmentFilled : styles.progressSegmentEmpty,
              ]}
            />
          ))}
        </View>
        <Text style={styles.stepCounter}>Step {currentStep} of {COACH_STEP_COUNT}</Text>
      </View>

      {/* Title + description (cross-fade) */}
      <Animated.View style={{ opacity: textOpacity }}>
        <Text
          style={styles.title}
          accessibilityRole="header"
        >
          {stepConfig.title}
        </Text>
        <Text
          style={styles.description}
          numberOfLines={2}
          ellipsizeMode="tail"
        >
          {stepConfig.description}
        </Text>
      </Animated.View>

      {/* Action row */}
      <View style={styles.actionRow}>
        {!isLastStep && (
          <TouchableOpacity
            onPress={skipTour}
            style={styles.skipButton}
            activeOpacity={0.5}
            hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
            accessibilityLabel="Skip guided tour"
            accessibilityRole="button"
          >
            <Text style={styles.skipText}>Skip tour</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          onPress={nextStep}
          style={[
            styles.primaryButton,
            isLastStep && styles.primaryButtonFullWidth,
          ]}
          activeOpacity={0.85}
          accessibilityLabel={isLastStep ? 'Finish guided tour' : 'Next step'}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>{stepConfig.buttonLabel}</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 10,
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 0, 0, 0.04)',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 16,
    // Upward shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 8,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
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
  progressSegmentFilled: {
    backgroundColor: '#eb7825',
  },
  progressSegmentEmpty: {
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
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
    color: '#4b5563',
    marginTop: 6,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  skipButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  skipText: {
    fontSize: 14,
    fontWeight: '400',
    color: '#6b7280',
  },
  primaryButton: {
    backgroundColor: '#eb7825',
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonFullWidth: {
    flex: 1,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
});
