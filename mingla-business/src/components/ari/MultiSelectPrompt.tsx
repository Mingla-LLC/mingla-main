/**
 * ORCH-1101 — MultiSelectPrompt (§5.3)
 *
 * Presentational ONLY. "Pick all that apply" — checkbox rows in a glass card
 * with a sticky confirm. The downstream smart-Ari ORCH supplies the data +
 * wires the callbacks.
 *
 * The 5 named states (default / selected / disabled / loading / submitted) are
 * all rendered from the `state` prop.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Check, CheckSquare, Square } from "lucide-react-native";

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

export interface MultiSelectOption {
  id: string;
  label: string;
}

export type MultiSelectState =
  | "default" // none / some checked, Confirm disabled until ≥1
  | "loading" // Confirm → spinner, rows locked
  | "disabled" // whole card 0.4
  | "submitted"; // collapses to "✓ <n> selected: A, B, C" ribbon

export interface MultiSelectPromptProps {
  title: string;
  options: MultiSelectOption[];
  selectedIds: string[];
  state: MultiSelectState;
  onToggle?: (id: string) => void;
  onConfirm?: () => void;
}

export const MultiSelectPrompt: React.FC<MultiSelectPromptProps> = ({
  title,
  options,
  selectedIds,
  state,
  onToggle,
  onConfirm,
}) => {
  const selectedSet = new Set(selectedIds);
  const count = selectedIds.length;

  // Submitted → compact success ribbon.
  if (state === "submitted") {
    const labels = options
      .filter((o) => selectedSet.has(o.id))
      .map((o) => o.label)
      .join(", ");
    return (
      <View
        style={styles.submittedRibbon}
        accessibilityRole="text"
        accessibilityLabel={`${count} selected: ${labels}`}
      >
        <Check size={13} color={semantic.success} strokeWidth={2.5} />
        <Text style={styles.submittedText} numberOfLines={2}>
          {count} selected: {labels}
        </Text>
      </View>
    );
  }

  const isDisabled = state === "disabled";
  const isLoading = state === "loading";
  const rowsLocked = isDisabled || isLoading;
  const canConfirm = count >= 1 && state === "default";

  return (
    <GlassChrome
      intensity="cardBase"
      tintColor={glass.tint.profileBase}
      borderColor={glass.border.profileBase}
      radius="lg"
      style={[styles.card, isDisabled && styles.cardDisabled]}
    >
      <View style={styles.inner} accessibilityRole="summary">
        <Text style={styles.title} numberOfLines={3}>
          {title}
        </Text>
        <View style={styles.rows}>
          {options.map((opt, i) => {
            const checked = selectedSet.has(opt.id);
            return (
              <View key={opt.id}>
                {i > 0 ? <View style={styles.divider} /> : null}
                <Pressable
                  onPress={!rowsLocked ? () => onToggle?.(opt.id) : undefined}
                  disabled={rowsLocked}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && !rowsLocked && styles.rowPressed,
                  ]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked, disabled: rowsLocked }}
                  accessibilityLabel={opt.label}
                >
                  {checked ? (
                    <CheckSquare size={18} color={ariPalette.userBubble} strokeWidth={2} />
                  ) : (
                    <Square size={18} color={textTokens.tertiary} strokeWidth={2} />
                  )}
                  <Text style={styles.rowLabel} numberOfLines={1}>
                    {opt.label}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
        <View style={styles.footer}>
          <Text style={styles.countPill}>
            {count} selected
          </Text>
          <Pressable
            onPress={canConfirm ? onConfirm : undefined}
            disabled={!canConfirm}
            hitSlop={{ top: 5, bottom: 5 }}
            style={({ pressed }) => [
              styles.confirmBtn,
              !canConfirm && styles.btnDisabled,
              pressed && canConfirm && styles.btnPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Confirm selection"
            accessibilityState={{ disabled: !canConfirm }}
          >
            <Text style={styles.confirmText}>{isLoading ? "Working…" : "Confirm"}</Text>
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
  title: {
    fontSize: ariThread.cardTitleFont,
    lineHeight: ariThread.cardTitleLine,
    fontWeight: "600",
    color: textTokens.primary,
    letterSpacing: -0.1,
  },
  rows: {
    marginTop: spacing.sm,
  },
  divider: {
    height: 1,
    backgroundColor: glass.border.profileBase,
  },
  row: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowLabel: {
    fontSize: ariThread.bodyFont,
    lineHeight: ariThread.bodyLine,
    color: textTokens.primary,
    flexShrink: 1,
  },
  footer: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  countPill: {
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    fontWeight: "600",
    letterSpacing: 0.3,
    color: textTokens.secondary,
  },
  confirmBtn: {
    height: ariThread.btnHeight,
    minWidth: 96,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: ariPalette.userBubble,
    overflow: "hidden",
  },
  confirmText: {
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
  submittedRibbon: {
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
  submittedText: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: semantic.success,
    flexShrink: 1,
  },
});

export default MultiSelectPrompt;
