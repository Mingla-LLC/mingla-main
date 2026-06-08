/**
 * ORCH-0821 — QuickReplyChips
 * Horizontal/vertical chip list for tap-to-send shortcuts.
 *
 * ORCH-1101 — doubles as the §5.1 single-select choice-chip base. Two modes,
 * back-compat preserved:
 *   - LEGACY (existing suggestions panel): pass `chips: string[]` + `onSelect`
 *     + optional `layout`. Behavior unchanged — taller stack rows, no
 *     selection state. The AriChatScreen suggestions panel keeps working.
 *   - CHOICE (new, presentational; wired by the smart-Ari ORCH): pass
 *     `options: {id,label}[]` + `selectedId?` + `state` + `onSelectId`. Renders
 *     the dense 30px wrapping chip row with default / selected (userBubble +
 *     Check) / loading (spinner) / submitted (siblings collapse) states.
 *
 * The component is presentational in CHOICE mode — the data + callbacks come
 * from the downstream ORCH; the look is finished here.
 */

import React from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Check } from "lucide-react-native";

import {
  ariPalette,
  ariThread,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export interface ChoiceOption {
  id: string;
  label: string;
}

export type ChoiceState = "default" | "loading" | "submitted";

export interface QuickReplyChipsProps {
  // LEGACY mode -----------------------------------------------------------
  chips?: string[];
  onSelect?: (chip: string) => void;
  layout?: "stack" | "row";
  // CHOICE mode (§5.1, presentational) ------------------------------------
  options?: ChoiceOption[];
  selectedId?: string;
  state?: ChoiceState;
  onSelectId?: (id: string) => void;
  disabled?: boolean;
}

export const QuickReplyChips: React.FC<QuickReplyChipsProps> = ({
  chips,
  onSelect,
  layout = "stack",
  options,
  selectedId,
  state = "default",
  onSelectId,
  disabled = false,
}) => {
  // CHOICE mode — the new §5.1 single-select chip row.
  if (options) {
    // Submitted → only the chosen chip survives (siblings unmount so the
    // thread doesn't carry dead options).
    const visible =
      state === "submitted" && selectedId
        ? options.filter((o) => o.id === selectedId)
        : options;
    const interactive = state === "default" && !disabled;
    return (
      <View style={styles.choiceRow} accessibilityRole="radiogroup">
        {visible.map((opt) => {
          const isSelected = opt.id === selectedId;
          const isLoading = state === "loading" && isSelected;
          return (
            <Pressable
              key={opt.id}
              onPress={interactive ? () => onSelectId?.(opt.id) : undefined}
              disabled={!interactive}
              style={({ pressed }) => [
                styles.choiceChip,
                isSelected && styles.choiceChipSelected,
                pressed && interactive && styles.chipPressed,
                disabled && styles.chipDisabled,
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected, disabled: !interactive }}
              accessibilityLabel={opt.label}
              hitSlop={6}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={textTokens.inverse} />
              ) : isSelected ? (
                <Check size={13} color={textTokens.inverse} strokeWidth={2.5} />
              ) : null}
              <Text
                style={[styles.choiceText, isSelected && styles.choiceTextSelected]}
                numberOfLines={1}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  // LEGACY mode — unchanged.
  if (!chips || chips.length === 0) return null;
  return (
    <View style={[layout === "row" ? styles.row : styles.stack]}>
      {chips.map((chip) => (
        <Pressable
          key={chip}
          onPress={() => onSelect?.(chip)}
          style={({ pressed }) => [styles.chip, pressed && styles.legacyChipPressed]}
          accessibilityRole="button"
          accessibilityLabel={chip}
          accessibilityHint="Sends this message to Ari"
        >
          <Text style={styles.chipText} numberOfLines={layout === "row" ? 1 : 2}>
            {chip}
          </Text>
        </Pressable>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  stack: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: "row",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  chip: {
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radius.md,
    overflow: "hidden",
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: "center",
  },
  legacyChipPressed: {
    backgroundColor: glass.tint.profileElevated,
    opacity: 0.95,
  },
  chipText: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "500",
    color: textTokens.primary,
  },
  // CHOICE mode -----------------------------------------------------------
  choiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  choiceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 30,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    overflow: "hidden",
    // Android opaque equivalent; iOS/web glass tint + hairline.
    backgroundColor:
      Platform.OS === "android" ? ariThread.ariBubbleAndroid : glass.tint.profileBase,
    ...(Platform.OS === "android"
      ? {}
      : { borderWidth: 1, borderColor: glass.border.profileBase }),
  },
  choiceChipSelected: {
    backgroundColor: ariPalette.userBubble,
    ...(Platform.OS === "android" ? {} : { borderColor: ariPalette.userBubble }),
  },
  choiceText: {
    fontSize: ariThread.chipFont, // 13
    lineHeight: ariThread.chipLine, // 17
    fontWeight: "500",
    color: textTokens.primary,
  },
  choiceTextSelected: {
    color: textTokens.inverse,
  },
  chipPressed: {
    opacity: 0.85,
  },
  chipDisabled: {
    opacity: 0.4,
  },
});

export default QuickReplyChips;
