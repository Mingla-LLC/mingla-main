/**
 * ORCH-0821 — Ari InputBar
 * Keyboard-aware composer at the bottom of the chat. Mirrors the Cycle 3
 * wizard pattern: Keyboard listener + dynamic paddingBottom managed by the
 * parent screen (this component is keyboard-aware via the parent's KAV).
 *
 * The PARENT screen wraps this in a KeyboardAvoidingView OR pads the bottom
 * by the keyboard height — see AriChatScreen.
 *
 * ORCH-1057 — Send button redesign ("Ember Send", design spec A1):
 * lucide ArrowUp on a warm flame→ember radial circle that rhymes with the
 * Ari orb. iOS-only ember glow; Android opaque + overflow:hidden + no
 * elevation per ANDROID_GLASS_USES_OPAQUE_FALLBACK. Send-moment scale spring
 * + glow pulse gated behind useReducedMotion().
 */

import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { ArrowUp } from "lucide-react-native";
import * as Haptics from "expo-haptics";

import {
  ariPalette,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export interface InputBarProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Called when the user taps the "suggestions" button. When provided, a
   *  small + icon renders to the left of the send button. */
  onShowSuggestions?: () => void;
}

export const InputBar: React.FC<InputBarProps> = ({
  onSend,
  disabled = false,
  placeholder = "Ask Ari…",
  onShowSuggestions,
}) => {
  const [text, setText] = useState("");
  const reduceMotion = useReducedMotion();

  const canSend = text.trim().length > 0 && !disabled;

  // Send-moment micro-interaction (A1 "ember flicker + lift").
  const sendScale = useSharedValue(1);
  const glowOpacity = useSharedValue(0.4);

  // Scale transform on the circle + iOS-only glow pulse via shadowOpacity
  // (Android ignores shadow* — no-op there, per the opaque-glass policy).
  const sendAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: sendScale.value }],
    ...(Platform.OS === "ios" ? { shadowOpacity: glowOpacity.value } : {}),
  }));

  const handleSend = (): void => {
    const t = text.trim();
    if (!t) return;

    if (reduceMotion) {
      // Reduced motion: simple dim → restore, no spring/flicker.
      sendScale.value = withSequence(
        withTiming(0.92, { duration: 80 }),
        withTiming(1, { duration: 80 }),
      );
    } else {
      // Press-down → ember flicker + lift spring.
      sendScale.value = withSequence(
        withTiming(0.92, { duration: 80 }),
        withSpring(1, { damping: 14, stiffness: 220, mass: 0.7 }),
      );
      if (Platform.OS === "ios") {
        glowOpacity.value = withSequence(
          withTiming(0.7, { duration: 100 }),
          withTiming(0.4, { duration: 100 }),
        );
      }
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);

    onSend(t);
    setText("");
  };

  return (
    <View style={styles.host}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={textTokens.tertiary}
        editable={!disabled}
        multiline
        style={styles.input}
        accessibilityLabel="Ask Ari"
        maxLength={4096}
      />
      {onShowSuggestions ? (
        <Pressable
          onPress={onShowSuggestions}
          disabled={disabled}
          style={({ pressed }) => [
            styles.suggestBtn,
            disabled && styles.btnDisabled,
            pressed && !disabled && styles.btnPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Show example prompts"
          hitSlop={6}
        >
          <View style={styles.plusH} />
          <View style={styles.plusV} />
        </Pressable>
      ) : null}
      <Pressable
        onPress={handleSend}
        disabled={!canSend}
        style={({ pressed }) => [
          pressed && canSend && reduceMotion && styles.btnPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Send message to Ari"
        accessibilityState={{ disabled: !canSend }}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Animated.View
          style={[styles.sendBtn, !canSend && styles.btnDisabled, sendAnimStyle]}
        >
          <Svg
            width={38}
            height={38}
            viewBox="0 0 100 100"
            style={styles.sendFill}
          >
            <Defs>
              {/* Warm radial echoing the Ari orb — lit from above, ember bottom. */}
              <RadialGradient
                id="ari-send-fill"
                cx="50"
                cy="36"
                rx="60"
                ry="60"
                fx="50"
                fy="32"
                gradientUnits="userSpaceOnUse"
              >
                <Stop offset="0%" stopColor={ariPalette.flame} stopOpacity="1" />
                <Stop offset="100%" stopColor={ariPalette.ember} stopOpacity="1" />
              </RadialGradient>
            </Defs>
            <Circle cx="50" cy="50" r="50" fill="url(#ari-send-fill)" />
          </Svg>
          <ArrowUp size={20} color="#ffffff" strokeWidth={2.5} />
        </Animated.View>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radius.xl,
    overflow: "hidden",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    minHeight: 52,
  },
  input: {
    flex: 1,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
    paddingVertical: 8,
    maxHeight: 120,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      // iOS-only ember glow (purposeful depth, echoes orb halo). shadowOpacity
      // is animated on send; this is the base. iOS shadow renders outside the
      // bounds, so we do NOT clip with overflow on iOS.
      ios: {
        shadowColor: ariPalette.ember,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.4,
        shadowRadius: 7,
      },
      // Android: NO elevation/shadow (draws a hard rectangle through rounded
      // fills). Clip the SVG fill to the round shape (ANDROID_GLASS_USES_OPAQUE_FALLBACK).
      default: {
        overflow: "hidden",
      },
    }),
  },
  // The SVG radial fill sits behind the glyph, filling the circle.
  sendFill: {
    position: "absolute",
    top: 0,
    left: 0,
  },
  suggestBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  plusH: {
    position: "absolute",
    width: 12,
    height: 1.5,
    backgroundColor: textTokens.secondary,
    borderRadius: 1,
  },
  plusV: {
    position: "absolute",
    width: 1.5,
    height: 12,
    backgroundColor: textTokens.secondary,
    borderRadius: 1,
  },
  btnDisabled: {
    opacity: 0.4,
  },
  btnPressed: {
    opacity: 0.8,
  },
});

export default InputBar;
