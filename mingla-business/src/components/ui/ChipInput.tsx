/**
 * ChipInput — assisted list entry.
 *
 * Issue #1501 §4.1. "What's included" used to be a single free-text comma
 * field: nothing suggested anything, a stray comma inside a value silently
 * split it in two, and the operator had no idea what Mingla expected. This
 * replaces it with tap-to-add suggestions plus a text field that commits on
 * Enter or on a comma.
 *
 * BEHAVIOUR
 * - Tap a suggestion to add it; it disappears from the suggestion row.
 * - Type + Enter commits. A typed comma commits everything before it.
 * - Backspace on an EMPTY field pulls the last chip back into the draft (web),
 *   so a typo is one keystroke from being fixed rather than removed-and-retyped.
 * - Case-insensitive dedupe FLASHES the existing chip instead of adding a
 *   second one, so "nothing happened" is never the feedback.
 * - Caps: 32 characters per chip, 30 chips. Both are content rules, not layout.
 *
 * NATIVE vs WEB. On native there is no keyboard to reach a small X, so the
 * WHOLE chip is the remove target at a 48pt tap height. On web the chip is
 * denser and carries a visible X affordance.
 *
 * The `testID` lands on the TEXT FIELD, so the pre-#1501 testID keeps pointing
 * at the thing an operator types into.
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { NativeSyntheticEvent, TextInputKeyPressEventData } from "react-native";

import {
  accent,
  androidOpaque,
  durations,
  glass,
  radius,
  spacing,
  stayProseMaxWidth,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

/** Content caps (#1501 §4.1). Not layout — a chip is a value, not a paragraph. */
export const CHIP_MAX_LENGTH = 32;
export const CHIP_MAX_COUNT = 30;

/** How long an already-present chip stays highlighted after a duplicate add. */
const FLASH_MS = durations.slowest;

/**
 * Add `candidate` to `values`, or report the existing entry it duplicates.
 *
 * Pure and exported so the dedupe rule is testable without a renderer. Dedupe
 * is CASE-INSENSITIVE (an operator who types "wi-fi" after tapping "Wi-Fi"
 * means the same thing) but the ORIGINAL casing is what is kept.
 */
export function addChip(
  values: readonly string[],
  candidate: string,
): { values: string[]; duplicateOf: string | null } {
  const trimmed = candidate.trim().slice(0, CHIP_MAX_LENGTH);
  if (trimmed.length === 0) return { values: [...values], duplicateOf: null };
  const existing = values.find(
    (value) => value.toLowerCase() === trimmed.toLowerCase(),
  );
  if (existing !== undefined) {
    return { values: [...values], duplicateOf: existing };
  }
  if (values.length >= CHIP_MAX_COUNT) {
    return { values: [...values], duplicateOf: null };
  }
  return { values: [...values, trimmed], duplicateOf: null };
}

export interface ChipInputProps {
  label: string;
  helper: string;
  values: string[];
  onChange: (values: string[]) => void;
  /** Kind-aware quick adds. Already-chosen entries are filtered out. */
  suggestions?: readonly string[];
  placeholder: string;
  editable?: boolean;
  /** Lands on the TEXT FIELD (preserves the pre-#1501 testID's meaning). */
  testID: string;
}

export const ChipInput: React.FC<ChipInputProps> = ({
  label,
  helper,
  values,
  onChange,
  suggestions = [],
  placeholder,
  editable = true,
  testID,
}) => {
  const [draft, setDraft] = useState("");
  const [flashed, setFlashed] = useState<string | null>(null);

  useEffect(() => {
    if (flashed === null) return undefined;
    const timer = setTimeout(() => setFlashed(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashed]);

  const remaining = useMemo(
    () =>
      suggestions.filter(
        (suggestion) =>
          !values.some(
            (value) => value.toLowerCase() === suggestion.toLowerCase(),
          ),
      ),
    [suggestions, values],
  );

  const atCap = values.length >= CHIP_MAX_COUNT;

  const commit = (candidate: string): void => {
    const result = addChip(values, candidate);
    if (result.duplicateOf !== null) {
      // Never silently no-op: show the operator the chip they already have.
      setFlashed(result.duplicateOf);
      setDraft("");
      return;
    }
    onChange(result.values);
    setDraft("");
  };

  /** A typed comma commits everything before it and keeps the remainder. */
  const handleChangeText = (next: string): void => {
    if (!next.includes(",")) {
      setDraft(next.slice(0, CHIP_MAX_LENGTH));
      return;
    }
    const parts = next.split(",");
    const tail = parts.pop() ?? "";
    let working = values;
    let duplicate: string | null = null;
    for (const part of parts) {
      const result = addChip(working, part);
      if (result.duplicateOf !== null) duplicate = result.duplicateOf;
      working = result.values;
    }
    if (working.length !== values.length) onChange(working);
    if (duplicate !== null) setFlashed(duplicate);
    setDraft(tail.slice(0, CHIP_MAX_LENGTH));
  };

  /** Backspace on an EMPTY field pulls the last chip back for editing. */
  const handleKeyPress = (
    event: NativeSyntheticEvent<TextInputKeyPressEventData>,
  ): void => {
    if (event.nativeEvent.key !== "Backspace" || draft.length > 0) return;
    if (values.length === 0) return;
    const last = values[values.length - 1];
    onChange(values.slice(0, -1));
    setDraft(last);
  };

  const remove = (value: string): void => {
    onChange(values.filter((entry) => entry !== value));
  };

  return (
    <View style={styles.field} testID={`${testID}-field`}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.helper}>{helper}</Text>
      {values.length > 0 ? (
        <View style={styles.chipRow} testID={`${testID}-chips`}>
          {values.map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${value}`}
              onPress={() => remove(value)}
              disabled={!editable}
              testID={`${testID}-chip-${value}`}
              style={[
                styles.chip,
                flashed === value ? styles.chipFlashed : null,
              ]}
            >
              <Text style={styles.chipText}>{value}</Text>
              <Text style={styles.chipRemove}>{"×"}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={helper}
        value={draft}
        onChangeText={handleChangeText}
        onKeyPress={handleKeyPress}
        onSubmitEditing={() => commit(draft)}
        blurOnSubmit={false}
        returnKeyType="done"
        maxLength={CHIP_MAX_LENGTH}
        placeholder={atCap ? `${CHIP_MAX_COUNT} is the most you can add` : placeholder}
        placeholderTextColor={textTokens.tertiary}
        editable={editable && !atCap}
        style={[styles.input, !editable || atCap ? styles.inputDisabled : null]}
        testID={testID}
      />
      {remaining.length > 0 && editable && !atCap ? (
        <View style={styles.chipRow} testID={`${testID}-suggestions`}>
          {remaining.map((suggestion) => (
            <Pressable
              key={suggestion}
              accessibilityRole="button"
              accessibilityLabel={`Add ${suggestion}`}
              onPress={() => commit(suggestion)}
              testID={`${testID}-suggest-${suggestion}`}
              style={styles.suggestion}
            >
              <Text style={styles.suggestionText}>{`+ ${suggestion}`}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
};

const CHIP_SURFACE = Platform.select({
  android: {
    backgroundColor: androidOpaque.rowFill,
    borderColor: androidOpaque.rowBorder,
  },
  default: {
    backgroundColor: glass.tint.profileBase,
    borderColor: glass.border.profileBase,
  },
}) as { backgroundColor: string; borderColor: string };

const FLASH_SURFACE = Platform.select({
  android: { backgroundColor: androidOpaque.accentFill, borderColor: accent.warm },
  default: { backgroundColor: accent.tint, borderColor: accent.warm },
}) as { backgroundColor: string; borderColor: string };

// On native the whole chip is the remove target, so it needs a real 48pt tap
// height; on web the pointer is precise and the chip can stay dense.
const CHIP_MIN_HEIGHT = Platform.OS === "web" ? 32 : 48;

const styles = StyleSheet.create({
  // STACK measure — no flex-axis key (I-AXIS-SCOPED-FLEX). This whole control
  // sits in the form COLUMN.
  field: { width: "100%", minWidth: 0, gap: spacing.xs },
  label: { ...typography.bodySm, color: textTokens.primary, fontWeight: "700" },
  helper: {
    ...typography.caption,
    color: textTokens.secondary,
    maxWidth: stayProseMaxWidth,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: CHIP_MIN_HEIGHT,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    ...CHIP_SURFACE,
  },
  chipFlashed: FLASH_SURFACE,
  chipText: { ...typography.bodySm, color: textTokens.primary },
  chipRemove: { ...typography.bodySm, color: textTokens.tertiary },
  input: {
    minHeight: 46,
    maxWidth: stayProseMaxWidth,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    color: textTokens.primary,
  },
  inputDisabled: { opacity: 0.55 },
  suggestion: {
    minHeight: CHIP_MIN_HEIGHT,
    justifyContent: "center",
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
    borderColor: glass.border.profileBase,
    paddingHorizontal: spacing.md,
  },
  suggestionText: { ...typography.caption, color: textTokens.secondary },
});

export default ChipInput;
