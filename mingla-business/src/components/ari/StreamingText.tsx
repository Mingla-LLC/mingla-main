/**
 * ORCH-0821 — StreamingText
 * Shows a thinking indicator (blinking cursor in ariPalette.cursor) for use
 * while Ari is generating a response. Buffered MVP — real word-by-word
 * streaming is a Phase 1.5 enhancement.
 */

import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import {
  ariPalette,
  glass,
  spacing,
} from "../../constants/designSystem";
import { AriOrb } from "./AriOrb";

export interface StreamingTextProps {
  visible: boolean;
}

export const StreamingText: React.FC<StreamingTextProps> = ({ visible }) => {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (visible && !reduceMotion) {
      opacity.value = withRepeat(
        withTiming(0.2, { duration: 600, easing: Easing.inOut(Easing.cubic) }),
        -1,
        true,
      );
    } else {
      opacity.value = 1;
    }
    return (): void => {
      cancelAnimation(opacity);
    };
  }, [visible, reduceMotion, opacity]);

  const cursorStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (!visible) return null;

  return (
    <View
      style={styles.row}
      accessibilityLiveRegion="polite"
      accessibilityRole="text"
      accessibilityLabel="Ari is thinking"
    >
      <View style={styles.orbWrap}>
        <AriOrb size="sm" thinking decorative />
      </View>
      <View style={styles.bubble}>
        <Animated.View style={[styles.cursor, cursorStyle]} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  orbWrap: {
    marginTop: 2,
    marginRight: spacing.sm,
  },
  bubble: {
    backgroundColor: glass.tint.profileBase,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    minWidth: 36,
    justifyContent: "center",
  },
  cursor: {
    width: 2,
    height: 14, // matches premium chat font-size, not the older 24pt body line-height
    backgroundColor: ariPalette.cursor,
  },
});

export default StreamingText;
