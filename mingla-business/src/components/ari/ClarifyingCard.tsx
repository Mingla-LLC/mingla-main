/**
 * ORCH-1101 — ClarifyingCard (§5.2)
 *
 * Presentational ONLY. When Ari needs a typed/structured answer before acting,
 * this glass card reads as "an ask" (not a chat bubble). The downstream
 * smart-Ari ORCH supplies the data + wires the callbacks; the look is finished
 * here.
 *
 * The 5 named states (default / selected-typed / loading / disabled /
 * submitted) are all rendered from the `state` prop. No data fetching, no model
 * output — purely the visual home.
 */

import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Check } from "lucide-react-native";

import {
  ariPalette,
  ariThread,
  glass,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { GlassChrome } from "../ui/GlassChrome";

export type ClarifyingState =
  | "default" // field empty, Send disabled
  | "typed" // field has a value, Send enabled
  | "loading" // Send → "Working…", field locked
  | "disabled" // whole card 0.4 (e.g. superseded by a newer turn)
  | "submitted"; // collapses to a compact "Answered: <value>" ribbon

export interface ClarifyingCardProps {
  /** Micro eyebrow, e.g. "ARI NEEDS A DETAIL". */
  eyebrow?: string;
  /** The question title. */
  question: string;
  /** Current field value (controlled). */
  value: string;
  state: ClarifyingState;
  onChange?: (next: string) => void;
  onSubmit?: () => void;
  onSkip?: () => void;
}

const DEFAULT_EYEBROW = "ARI NEEDS A DETAIL";

export const ClarifyingCard: React.FC<ClarifyingCardProps> = ({
  eyebrow = DEFAULT_EYEBROW,
  question,
  value,
  state,
  onChange,
  onSubmit,
  onSkip,
}) => {
  // Submitted → compact success ribbon (collapses the card).
  if (state === "submitted") {
    return (
      <View
        style={styles.answeredRibbon}
        accessibilityRole="text"
        accessibilityLabel={`Answered: ${value}`}
      >
        <Check size={13} color={semantic.success} strokeWidth={2.5} />
        <Text style={styles.answeredText} numberOfLines={1}>
          Answered: {value}
        </Text>
      </View>
    );
  }

  const isDisabled = state === "disabled";
  const isLoading = state === "loading";
  const canSend = state === "typed";
  const fieldEditable = state === "default" || state === "typed";

  return (
    <GlassChrome
      intensity="cardBase"
      tintColor={glass.tint.profileBase}
      borderColor={glass.border.profileBase}
      radius="lg"
      style={[styles.card, isDisabled && styles.cardDisabled]}
    >
      <View style={styles.inner} accessibilityRole="summary">
        <Text style={styles.eyebrow} numberOfLines={1}>
          {eyebrow.toUpperCase()}
        </Text>
        <Text style={styles.question} numberOfLines={3}>
          {question}
        </Text>
        <TextInput
          value={value}
          onChangeText={fieldEditable ? onChange : undefined}
          editable={fieldEditable}
          placeholder="Type your answer"
          placeholderTextColor={textTokens.tertiary}
          style={styles.field}
          accessibilityLabel={`Answer: ${question}`}
        />
        <View style={styles.actions}>
          <Pressable
            onPress={!isLoading && !isDisabled ? onSkip : undefined}
            disabled={isLoading || isDisabled}
            hitSlop={{ top: 5, bottom: 5 }}
            style={({ pressed }) => [
              styles.ghostBtn,
              pressed && styles.btnPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Skip this detail"
          >
            <Text style={styles.ghostText}>Skip</Text>
          </Pressable>
          <Pressable
            onPress={canSend ? onSubmit : undefined}
            disabled={!canSend}
            hitSlop={{ top: 5, bottom: 5 }}
            style={({ pressed }) => [
              styles.primaryBtn,
              !canSend && styles.btnDisabled,
              pressed && canSend && styles.btnPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Send answer"
            accessibilityState={{ disabled: !canSend }}
          >
            <Text style={styles.primaryText}>{isLoading ? "Working…" : "Send"}</Text>
          </Pressable>
        </View>
      </View>
    </GlassChrome>
  );
};

const styles = StyleSheet.create({
  card: {
    marginVertical: 6,
    alignSelf: "stretch",
  },
  cardDisabled: {
    opacity: 0.4,
  },
  inner: {
    padding: ariThread.cardPad,
  },
  eyebrow: {
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    fontWeight: "600",
    letterSpacing: 1.1,
    color: textTokens.secondary,
  },
  question: {
    marginTop: spacing.sm,
    fontSize: ariThread.cardTitleFont,
    lineHeight: ariThread.cardTitleLine,
    fontWeight: "600",
    color: textTokens.primary,
    letterSpacing: -0.1,
  },
  field: {
    marginTop: spacing.md,
    fontSize: 13,
    lineHeight: 17,
    color: textTokens.primary,
    paddingVertical: ariThread.inputPadV,
    borderBottomWidth: 1,
    borderBottomColor: glass.border.pending,
  },
  actions: {
    marginTop: spacing.md,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 6,
  },
  ghostBtn: {
    height: ariThread.btnHeight,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  ghostText: {
    fontSize: 13,
    fontWeight: "500",
    color: textTokens.secondary,
    letterSpacing: -0.1,
  },
  primaryBtn: {
    height: ariThread.btnHeight,
    minWidth: 88,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: ariPalette.userBubble,
    overflow: "hidden",
  },
  primaryText: {
    fontSize: 13,
    fontWeight: "600",
    color: textTokens.inverse,
    letterSpacing: -0.1,
  },
  btnPressed: {
    opacity: 0.85,
  },
  btnDisabled: {
    opacity: 0.4,
  },
  answeredRibbon: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginVertical: 6,
    backgroundColor: semantic.successTint,
    borderWidth: 1,
    borderColor: "rgba(34, 197, 94, 0.4)",
    borderRadius: 999,
    overflow: "hidden",
    paddingHorizontal: ariThread.ribbonPadH,
    paddingVertical: ariThread.ribbonPadV,
    maxWidth: "100%",
  },
  answeredText: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: semantic.success,
    flexShrink: 1,
  },
});

export default ClarifyingCard;
