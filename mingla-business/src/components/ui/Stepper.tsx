/**
 * Stepper — wizard step indicator.
 *
 * Mobile (compact): 8×8 dots in a horizontal row, optional
 * "Step N of M" caption. Current dot `accent.warm`, completed dots
 * `text.inverse`, future dots `rgba(255,255,255,0.32)`.
 *
 * Web (numbered): 24×24 numbered circles + label below + 2px connector.
 * Connector fills `accent.warm` left-to-right over 280ms when a step
 * transitions from future → completed. Reduce-motion: jumps to filled
 * immediately, no animation.
 */

import React, { useEffect } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import {
  accent,
  glass,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export interface StepperStep {
  id: string;
  label: string;
  /**
   * ORCH-1263 (DESIGN §5.2) — the step's content ARRIVED filled (claim
   * adoption). Future prefilled dots render green-45 ("already has content,
   * awaiting your look"); a visited prefilled dot becomes standard white —
   * confirmation converts green to done. No checkmarks, no % bar.
   */
  prefilled?: boolean;
}

export interface StepperProps {
  steps: StepperStep[];
  /** 0-based index of the current step. */
  currentIndex: number;
  /** Show "Step N of M" caption on mobile. Default `true`. */
  showCaption?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const DOT_SIZE = 8;
const CIRCLE_SIZE = 24;
const CONNECTOR_FILL_DURATION = 280;
const FUTURE_DOT_BG = "rgba(255, 255, 255, 0.32)";
// ORCH-1263 (DESIGN §5.2) — success at dot-legible alpha for prefilled-future.
const PREFILLED_DOT_BG = "rgba(34, 197, 94, 0.45)";
const PREFILLED_CIRCLE_BORDER = "rgba(34, 197, 94, 0.45)";
// M-8: prefilled → confirmed dot color transition.
const DOT_CONFIRM_DURATION = 120;

/** One mobile dot — animated so M-8 (green-45 → white on confirm) can run. */
const StepDot: React.FC<{ color: string }> = ({ color }) => {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(1);
  const prevColor = React.useRef(color);
  const fromColor = React.useRef(color);

  useEffect(() => {
    if (prevColor.current !== color) {
      fromColor.current = prevColor.current;
      prevColor.current = color;
      if (!reduceMotion) {
        progress.value = 0;
        progress.value = withTiming(1, { duration: DOT_CONFIRM_DURATION });
      } else {
        progress.value = 1;
      }
    }
    return (): void => {
      cancelAnimation(progress);
    };
  }, [color, progress, reduceMotion]);

  const style = useAnimatedStyle(() => ({
    // Cross-fade via opacity over the target color (color interpolation of
    // rgba strings on the UI thread is host-dependent; an opacity ramp on the
    // new color reads identically at 8px).
    backgroundColor: color,
    opacity: 0.4 + 0.6 * progress.value,
  }));

  return <Animated.View style={[styles.dot, style]} />;
};

interface ConnectorProps {
  filled: boolean;
}

const Connector: React.FC<ConnectorProps> = ({ filled }) => {
  const fill = useSharedValue(filled ? 1 : 0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const target = filled ? 1 : 0;
    if (reduceMotion) {
      fill.value = target;
    } else {
      fill.value = withTiming(target, {
        duration: CONNECTOR_FILL_DURATION,
        easing: Easing.out(Easing.cubic),
      });
    }
    return (): void => {
      cancelAnimation(fill);
    };
  }, [fill, filled, reduceMotion]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${fill.value * 100}%`,
  }));

  return (
    <View style={styles.connector}>
      <Animated.View style={[styles.connectorFill, fillStyle]} />
    </View>
  );
};

const StepperMobile: React.FC<StepperProps> = ({
  steps,
  currentIndex,
  showCaption = true,
  testID,
  style,
}) => {
  // ORCH-1263 (DESIGN §5.2) — the caption promises quick confirms only when
  // most steps genuinely arrived filled (never overpromise a sparse place).
  const prefilledCount = steps.filter((s) => s.prefilled === true).length;
  return (
    <View testID={testID} style={[styles.mobileWrap, style]}>
      <View style={styles.dotRow}>
        {steps.map((step, index) => {
          const dotColor =
            index === currentIndex
              ? accent.warm
              : index < currentIndex
                ? textTokens.inverse
                : step.prefilled === true
                  ? PREFILLED_DOT_BG
                  : FUTURE_DOT_BG;
          return <StepDot key={step.id} color={dotColor} />;
        })}
      </View>
      {showCaption ? (
        <Text style={styles.caption}>
          Step {Math.min(currentIndex + 1, steps.length)} of {steps.length}
          {prefilledCount >= 6 ? " · most are quick confirms" : ""}
        </Text>
      ) : null}
    </View>
  );
};

const StepperWeb: React.FC<StepperProps> = ({
  steps,
  currentIndex,
  testID,
  style,
}) => (
  <View testID={testID} style={[styles.webWrap, style]}>
    {steps.map((step, index) => {
      const isCurrent = index === currentIndex;
      const isCompleted = index < currentIndex;
      const isFuture = index > currentIndex;
      // ORCH-1263 (DESIGN §5.2) — future-prefilled circles: successTint fill,
      // green-45 border, number text.secondary. Current/completed unchanged.
      const isPrefilledFuture = isFuture && step.prefilled === true;

      const circleBg = isCurrent || isCompleted
        ? accent.warm
        : isPrefilledFuture
          ? semantic.successTint
          : glass.tint.profileBase;
      const circleBorder = isCurrent
        ? accent.border
        : isPrefilledFuture
          ? PREFILLED_CIRCLE_BORDER
          : glass.border.profileBase;
      const numberColor = isPrefilledFuture
        ? textTokens.secondary
        : isFuture
          ? textTokens.tertiary
          : textTokens.inverse;
      const labelColor = isFuture ? textTokens.tertiary : textTokens.primary;

      return (
        <React.Fragment key={step.id}>
          <View style={styles.stepCol}>
            <View
              style={[
                styles.circle,
                { backgroundColor: circleBg, borderColor: circleBorder },
              ]}
            >
              <Text style={[styles.circleNumber, { color: numberColor }]}>
                {index + 1}
              </Text>
            </View>
            <Text
              style={[styles.stepLabel, { color: labelColor }]}
              numberOfLines={1}
            >
              {step.label}
            </Text>
          </View>
          {index < steps.length - 1 ? (
            <Connector filled={index < currentIndex} />
          ) : null}
        </React.Fragment>
      );
    })}
  </View>
);

export const Stepper: React.FC<StepperProps> = (props) => {
  if (Platform.OS === "web") {
    return <StepperWeb {...props} />;
  }
  return <StepperMobile {...props} />;
};

const styles = StyleSheet.create({
  mobileWrap: {
    alignItems: "center",
    gap: spacing.sm,
  },
  dotRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
  caption: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: typography.caption.fontWeight,
    letterSpacing: typography.caption.letterSpacing,
    color: textTokens.tertiary,
  },
  webWrap: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.xs,
  },
  stepCol: {
    alignItems: "center",
    gap: spacing.xs,
  },
  circle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  circleNumber: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "600",
  },
  stepLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: typography.caption.fontWeight,
    letterSpacing: typography.caption.letterSpacing,
    maxWidth: 120,
    textAlign: "center",
  },
  connector: {
    flex: 1,
    height: 2,
    minWidth: 24,
    backgroundColor: glass.border.profileBase,
    borderRadius: 1,
    overflow: "hidden",
    marginTop: CIRCLE_SIZE / 2 - 1, // visually centred against the 24px circle
  },
  connectorFill: {
    height: 2,
    backgroundColor: accent.warm,
  },
});

export default Stepper;
