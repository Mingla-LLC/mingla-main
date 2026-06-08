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
 *
 * ORCH-1101 — composer + send overhaul (fixes the two desktop-web defects):
 *   Bug B (send "blob"): the old react-native-svg radial-gradient circle block
 *   stacked a gradient circle BEHIND the glyph; react-native-web mis-composited
 *   it into an amorphous orange blob (gradient-id collisions made it worse).
 *   It is DELETED. The send button is now a flat ember disc
 *   (ariPalette.userBubble) with a single lucide ArrowUp as its only child —
 *   renders identically on iOS/Android/web (single-path SVG, no gradient, no
 *   sibling). The Animated.View (scale + iOS shadowOpacity glow) + the send
 *   micro-interaction + reduced-motion gate are kept verbatim — they were
 *   never the blob.
 *   Bug A (web bottom gap): the input is explicitly one line tall on every
 *   surface — fontSize 14 / lineHeight 19 / paddingVertical 6 / minHeight 30,
 *   host minHeight 48 — and on react-native-web the <textarea> gets
 *   rows={1} + resize:'none' + height:'auto' so the browser's intrinsic
 *   multi-row height can't open dead space below the single line. (The
 *   AriChatScreen paddingBottom phantom-80px half of Bug A is fixed there.)
 */

import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
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
  ariThread,
  glass,
  radius,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";

// Web-only TextInput props: on react-native-web a multiline TextInput renders
// as a <textarea> whose browser-default rows (~2) + larger default line-height
// open dead space below the single text line. Force a one-line box: explicit
// lineHeight, rows={1}, height:'auto', no manual resize. Native ignores these.
const WEB_INPUT_PROPS =
  Platform.OS === "web"
    ? ({
        rows: 1,
        // react-native-web forwards unknown style keys to the DOM node.
        style: { height: "auto", resize: "none", overflowY: "auto" },
      } as unknown as Record<string, unknown>)
    : {};

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
        style={[styles.input, Platform.OS === "web" && (WEB_INPUT_PROPS.style as object)]}
        accessibilityLabel="Ask Ari"
        maxLength={4096}
        {...(Platform.OS === "web" ? { rows: WEB_INPUT_PROPS.rows } : {})}
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
          {/* ORCH-1101: flat ember disc + a single lucide ArrowUp as the ONLY
              child (no SVG gradient, no two-layer composition) — renders
              identically on iOS/Android/web. lucide-react-native is a
              single-path stroke glyph; with no gradient sibling it never blobs. */}
          <ArrowUp size={18} color="#ffffff" strokeWidth={2.75} />
        </Animated.View>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flexDirection: "row",
    alignItems: "flex-end",
    // ORCH-1101 REWORK Bug #4: OPAQUE fill. Was glass.tint.profileBase (rgba .04)
    // which let the empty-state hint + thread bleed through the field. Solid
    // surface on every platform (no rgba/hsla → ANDROID_GLASS_USES_OPAQUE_FALLBACK
    // honored); border + radius preserved so it still reads as a glass-edged input.
    backgroundColor: ariThread.composerSurface,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radius.xl,
    overflow: "hidden",
    paddingHorizontal: spacing.md,
    // Web has no soft keyboard + tighter chrome → 6; native keeps 8.
    paddingVertical: Platform.OS === "web" ? 6 : ariThread.composerPadV,
    gap: spacing.sm,
    minHeight: ariThread.composerMinH, // 48 (was 52)
  },
  input: {
    flex: 1,
    fontSize: ariThread.bodyFont, // 14 (was body 16 → align to thread)
    lineHeight: ariThread.bodyLine, // 19 (explicit — overrides the web textarea's taller default)
    color: textTokens.primary,
    paddingVertical: ariThread.inputPadV, // 6 (was 8)
    minHeight: ariThread.inputMinH, // 30 — caps the empty box to one line
    maxHeight: 120,
  },
  sendBtn: {
    width: ariThread.sendSize, // 34 (was 38)
    height: ariThread.sendSize,
    borderRadius: ariThread.sendSize / 2,
    // ORCH-1101: flat deepened ember disc (no SVG gradient). Same fill as the
    // user bubble — "Ari's warmth, owned by me". white ArrowUp = 4.6:1.
    backgroundColor: ariPalette.userBubble,
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
      // fills). Clip the flat fill to the round shape (ANDROID_GLASS_USES_OPAQUE_FALLBACK).
      // Web also lands here: flat fill, no shadow (react-native-web shadow is
      // unreliable and can itself read as a halo-blob).
      default: {
        overflow: "hidden",
      },
    }),
  },
  suggestBtn: {
    width: 30, // ORCH-1101: 30 to pair with the 34 send + tighter composer (was 32)
    height: 30,
    borderRadius: 15,
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
