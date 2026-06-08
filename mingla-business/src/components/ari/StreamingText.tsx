/**
 * ORCH-0821 — StreamingText
 * Shows a thinking indicator (blinking cursor in ariPalette.cursor) for use
 * while Ari is generating a response. Buffered MVP — real word-by-word
 * streaming is a Phase 1.5 enhancement.
 */

import React, { useEffect } from "react";
import { Platform, StyleSheet, View } from "react-native";
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
  ariThread,
  glass,
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
    marginRight: ariThread.orbGap, // 6 (matches ChatBubble)
  },
  bubble: {
    // Android opaque equivalent; iOS/web keep glass + hairline (matches ChatBubble).
    backgroundColor:
      Platform.OS === "android" ? ariThread.ariBubbleAndroid : glass.tint.profileBase,
    borderTopLeftRadius: ariThread.bubbleTail, // 4 tail
    borderTopRightRadius: ariThread.bubbleRadius, // 16
    borderBottomLeftRadius: ariThread.bubbleRadius,
    borderBottomRightRadius: ariThread.bubbleRadius,
    paddingHorizontal: ariThread.bubblePadH, // 12 (was 14)
    paddingVertical: ariThread.bubblePadV, // 8 (was 9)
    overflow: "hidden",
    ...(Platform.OS === "android"
      ? {}
      : { borderWidth: 1, borderColor: glass.border.profileBase }),
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
