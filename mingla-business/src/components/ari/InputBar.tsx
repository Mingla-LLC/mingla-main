/**
 * ORCH-0821 — Ari InputBar
 * Keyboard-aware composer at the bottom of the chat. Mirrors the Cycle 3
 * wizard pattern: Keyboard listener + dynamic paddingBottom managed by the
 * parent screen (this component is keyboard-aware via the parent's KAV).
 *
 * The PARENT screen wraps this in a KeyboardAvoidingView OR pads the bottom
 * by the keyboard height — see AriChatScreen.
 */

import React, { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

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

  const canSend = text.trim().length > 0 && !disabled;

  const handleSend = (): void => {
    const t = text.trim();
    if (!t) return;
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
          styles.sendBtn,
          !canSend && styles.btnDisabled,
          pressed && canSend && styles.btnPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Send message to Ari"
        accessibilityState={{ disabled: !canSend }}
      >
        <View style={styles.sendArrow} />
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
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: ariPalette.flame,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: ariPalette.flame,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
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
  // Simple upward-pointing triangle as the send icon (no extra icon dep needed)
  sendArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderBottomWidth: 11,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#ffffff",
    marginBottom: 2,
  },
});

export default InputBar;
