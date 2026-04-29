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
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export interface StepperStep {
  id: string;
  label: string;
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
}) => (
  <View testID={testID} style={[styles.mobileWrap, style]}>
    <View style={styles.dotRow}>
      {steps.map((step, index) => {
        const dotColor =
          index === currentIndex
            ? accent.warm
            : index < currentIndex
              ? textTokens.inverse
              : FUTURE_DOT_BG;
        return (
          <View
            key={step.id}
            style={[styles.dot, { backgroundColor: dotColor }]}
          />
        );
      })}
    </View>
    {showCaption ? (
      <Text style={styles.caption}>
        Step {Math.min(currentIndex + 1, steps.length)} of {steps.length}
      </Text>
    ) : null}
  </View>
);

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

      const circleBg = isCurrent || isCompleted ? accent.warm : glass.tint.profileBase;
      const circleBorder = isCurrent ? accent.border : glass.border.profileBase;
      const numberColor = isFuture ? textTokens.tertiary : textTokens.inverse;
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
