/**
 * #4271 door polish — the one live status line on the pay code and Tap to Pay
 * screens ("Point your camera here · 9:42", "Guest is paying…", "Hold the card
 * near the top of the iPhone."), so the two screens read as one family.
 *
 *   waiting  glass fill, 8pt accent dot (the dot turns warning when `urgent`)
 *   busy     faint accent fill, accent border, small spinner
 *
 * Accessibility: the pill reads its own `accessibilityLabel` on focus (a
 * countdown in words), and only a change of `stateLabel` is announced, never
 * every tick of the countdown. Motion: the fill crossfades over 200ms; none
 * under reduced motion.
 */
import React, { useEffect, useRef } from "react";
import { ActivityIndicator, Animated, Easing, StyleSheet, Text, View } from "react-native";

import {
  accent,
  durations,
  glass,
  radius as radiusTokens,
  semantic,
  text as textTokens,
} from "../../constants/designSystem";
import { useReduceMotion } from "../../hooks/useMotionPreferences";

export type DoorStatusPillVariant = "waiting" | "busy";

export interface DoorStatusPillProps {
  text: string;
  variant: DoorStatusPillVariant;
  /** Waiting only: under a minute left, the dot turns warning. */
  urgent?: boolean;
  /** Read on focus, e.g. "Code expires in 9 minutes 42 seconds". Defaults to `text`. */
  accessibilityLabel?: string;
  /** Announced when it changes (waiting → paying → paid), never per second. */
  stateLabel?: string;
  testID?: string;
}

export const DoorStatusPill = ({
  text,
  variant,
  urgent = false,
  accessibilityLabel,
  stateLabel,
  testID,
}: DoorStatusPillProps): React.ReactElement => {
  const reduceMotion = useReduceMotion();
  const busy = useRef(new Animated.Value(variant === "busy" ? 1 : 0)).current;
  useEffect(() => {
    const target = variant === "busy" ? 1 : 0;
    if (reduceMotion) {
      busy.setValue(target);
      return;
    }
    Animated.timing(busy, {
      toValue: target,
      duration: durations.normal,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [variant, reduceMotion, busy]);

  return (
    <View style={styles.wrap}>
      <View
        style={styles.pill}
        accessible
        accessibilityRole="text"
        accessibilityLabel={accessibilityLabel ?? text}
        testID={testID}
      >
        {/* The busy wash fades over the glass fill. */}
        <Animated.View pointerEvents="none" style={[styles.busyWash, { opacity: busy }]} />
        {variant === "busy" ? (
          <ActivityIndicator size="small" color={accent.warm} style={styles.spinner} />
        ) : (
          <View
            style={[styles.dot, urgent ? styles.dotUrgent : null]}
            testID={testID !== undefined ? `${testID}-dot${urgent ? "-urgent" : ""}` : undefined}
          />
        )}
        <Text style={styles.text} numberOfLines={2}>
          {text}
        </Text>
      </View>
      {stateLabel !== undefined ? (
        <Text style={styles.srOnly} accessibilityLiveRegion="polite" importantForAccessibility="yes">
          {stateLabel}
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { alignSelf: "center", maxWidth: "100%" },
  pill: {
    minHeight: 40,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radiusTokens.full,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: glass.tint.profileElevated,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
  },
  busyWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: accent.faint,
    borderRadius: radiusTokens.full,
    borderWidth: 1,
    borderColor: accent.border,
  },
  spinner: { transform: [{ scale: 0.7 }] },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: accent.warm },
  dotUrgent: { backgroundColor: semantic.warning },
  text: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: textTokens.primary,
    fontVariant: ["tabular-nums"],
  },
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    opacity: 0,
  },
});
