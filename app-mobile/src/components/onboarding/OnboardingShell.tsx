import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
  Easing,
  AccessibilityInfo,
  StyleSheet,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { SegmentedProgressBar } from './SegmentedProgressBar';
import { logger } from '../../utils/logger';
import {
  colors,
  typography,
  fontWeights,
  spacing,
  radius,
  touchTargets,
  backgroundWarmGlow,
} from '../../constants/designSystem';

interface OnboardingShellProps {
  step: number; // 1-5
  segmentFill: number; // 0-1
  showBackButton: boolean;
  onBack: () => void;
  primaryCtaLabel: string;
  primaryCtaDisabled: boolean;
  primaryCtaLoading: boolean;
  onPrimaryCta: () => void;
  hidePrimaryCta?: boolean;
  hideBottomBar?: boolean;
  scrollEnabled?: boolean;
  onBackToWelcome?: () => void;
  children: React.ReactNode;
}

export const OnboardingShell: React.FC<OnboardingShellProps> = ({
  step,
  segmentFill,
  showBackButton,
  onBack,
  primaryCtaLabel,
  primaryCtaDisabled,
  primaryCtaLoading,
  onPrimaryCta,
  hidePrimaryCta = false,
  hideBottomBar = false,
  scrollEnabled = true,
  onBackToWelcome,
  children,
}) => {
  // CTA press animation
  const ctaScale = useRef(new Animated.Value(1)).current;
  const secondaryScale = useRef(new Animated.Value(1)).current;

  // CTA entrance animation (per screen transition)
  const ctaEntrance = useRef({
    opacity: new Animated.Value(0),
    translateY: new Animated.Value(16),
  }).current;

  // Re-run CTA entrance when primaryCtaLabel changes (proxy for subStep change)
  useEffect(() => {
    const runEntrance = async () => {
      let reducedMotion = false;
      try {
        reducedMotion = await AccessibilityInfo.isReduceMotionEnabled();
      } catch {
        reducedMotion = false;
      }

      if (reducedMotion) {
        ctaEntrance.opacity.setValue(1);
        ctaEntrance.translateY.setValue(0);
        return;
      }

      ctaEntrance.opacity.setValue(0);
      ctaEntrance.translateY.setValue(16);

      Animated.parallel([
        Animated.timing(ctaEntrance.opacity, {
          toValue: 1,
          duration: 250,
          delay: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(ctaEntrance.translateY, {
          toValue: 0,
          duration: 250,
          delay: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    };

    runEntrance();
  }, [primaryCtaLabel]);

  const insets = useSafeAreaInsets();

  // Fix B: Don't hardcode step === 1 as the first screen.
  // OnboardingFlow controls which screen is "first" via showBackButton and
  // onBackToWelcome. The shell trusts those props — if showBackButton is false
  // and onBackToWelcome is provided, this is the first screen (show "Back to sign in").
  // This works whether the user starts at Step 1 or Step 2 (phone pre-verified).
  const showBackToWelcome = !showBackButton && !!onBackToWelcome;
  const hasSecondaryButton = showBackToWelcome || showBackButton;

  const handleBack = () => {
    logger.action('Back button pressed', { step });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onBack();
  };

  const handleBackToWelcome = () => {
    logger.action('Back to sign in pressed');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onBackToWelcome?.();
  };

  const handlePrimaryPressIn = () => {
    Animated.spring(ctaScale, {
      toValue: 0.97,
      tension: 200,
      friction: 12,
      useNativeDriver: true,
    }).start();
  };

  const handlePrimaryPressOut = () => {
    Animated.spring(ctaScale, {
      toValue: 1,
      tension: 200,
      friction: 12,
      useNativeDriver: true,
    }).start();
  };

  const handleSecondaryPressIn = () => {
    Animated.spring(secondaryScale, {
      toValue: 0.97,
      tension: 200,
      friction: 12,
      useNativeDriver: true,
    }).start();
  };

  const handleSecondaryPressOut = () => {
    Animated.spring(secondaryScale, {
      toValue: 1,
      tension: 200,
      friction: 12,
      useNativeDriver: true,
    }).start();
  };

  const handlePrimaryCta = () => {
    if (primaryCtaDisabled || primaryCtaLoading) return;
    logger.action(`Primary CTA pressed: "${primaryCtaLabel}"`, { step, disabled: primaryCtaDisabled, loading: primaryCtaLoading });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPrimaryCta();
  };

  const secondaryLabel = showBackToWelcome ? 'Back to sign in' : 'Back';
  const secondaryAccessibilityLabel = showBackToWelcome ? 'Back to sign in' : 'Go back';
  const secondaryHandler = showBackToWelcome ? handleBackToWelcome : handleBack;

  const renderBottomBarContent = () => (
    <>
      {/* Primary CTA — full width, solid orange */}
      {!hidePrimaryCta && (
        <Animated.View
          style={{
            opacity: ctaEntrance.opacity,
            transform: [
              { translateY: ctaEntrance.translateY },
              { scale: ctaScale },
            ],
          }}
        >
          <TouchableOpacity
            style={[
              styles.primaryCta,
              primaryCtaLoading
                ? styles.primaryCtaLoading
                : primaryCtaDisabled
                  ? styles.primaryCtaDisabled
                  : styles.primaryCtaEnabled,
            ]}
            onPress={handlePrimaryCta}
            onPressIn={handlePrimaryPressIn}
            onPressOut={handlePrimaryPressOut}
            disabled={primaryCtaDisabled || primaryCtaLoading}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel={primaryCtaLabel}
          >
            {primaryCtaLoading ? (
              <>
                <ActivityIndicator
                  size="small"
                  color={colors.text.inverse}
                  style={styles.ctaSpinner}
                />
                <Text style={styles.primaryCtaTextEnabled}>Saving...</Text>
              </>
            ) : (
              <Text
                style={[
                  styles.primaryCtaText,
                  primaryCtaDisabled
                    ? styles.primaryCtaTextDisabled
                    : styles.primaryCtaTextEnabled,
                ]}
              >
                {primaryCtaLabel}
              </Text>
            )}
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Secondary button — full width, glass/outline style */}
      {hasSecondaryButton && (
        <Animated.View style={{ transform: [{ scale: secondaryScale }] }}>
          <TouchableOpacity
            style={styles.secondaryCta}
            onPress={secondaryHandler}
            onPressIn={handleSecondaryPressIn}
            onPressOut={handleSecondaryPressOut}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={secondaryAccessibilityLabel}
          >
            <Ionicons
              name="chevron-back"
              size={18}
              color={colors.text.secondary}
              style={styles.secondaryIcon}
            />
            <Text style={styles.secondaryCtaText}>{secondaryLabel}</Text>
          </TouchableOpacity>
        </Animated.View>
      )}
    </>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Progress bar */}
        <View style={styles.progressContainer}>
          <SegmentedProgressBar
            totalSegments={5}
            currentStep={step}
            currentSegmentFill={segmentFill}
          />
        </View>

        {/* Scrollable content */}
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.scrollContent,
            hideBottomBar && { paddingBottom: 160 + insets.bottom },
            !scrollEnabled && styles.scrollContentFixed,
          ]}
          scrollEnabled={scrollEnabled}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>

        {/* Fixed bottom bar — frosted glass panel */}
        {!hideBottomBar && (
          <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            {renderBottomBarContent()}
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: backgroundWarmGlow,
  },
  flex: {
    flex: 1,
  },
  progressContainer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 160,
  },
  scrollContentFixed: {
    flexGrow: 1,
  },
  bottomBar: {
    flexDirection: 'column',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255, 255, 255, 0.45)',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    gap: 10,
  },
  // ─── Primary Button ───
  primaryCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: 56,
    borderRadius: radius.lg,
  },
  primaryCtaEnabled: {
    backgroundColor: colors.primary[500],
    shadowColor: colors.primary[500],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  primaryCtaDisabled: {
    backgroundColor: colors.gray[200],
  },
  primaryCtaLoading: {
    backgroundColor: colors.primary[500],
    opacity: 0.85,
  },
  primaryCtaText: {
    fontSize: 17,
    fontWeight: fontWeights.semibold,
    letterSpacing: 0.3,
  },
  primaryCtaTextEnabled: {
    fontSize: 17,
    fontWeight: fontWeights.semibold,
    letterSpacing: 0.3,
    color: colors.text.inverse,
  },
  primaryCtaTextDisabled: {
    color: colors.text.tertiary,
  },
  ctaSpinner: {
    marginRight: spacing.sm,
  },
  // ─── Secondary Button (glass outline) ───
  secondaryCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.06)',
  },
  secondaryCtaText: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.secondary,
    letterSpacing: 0.2,
  },
  secondaryIcon: {
    marginRight: 4,
  },
});
