/**
 * NameBuilder — smart adding for lists of names.
 *
 * Issue #1501 §4.2 + SPEC AMENDMENT 1 + OPEN QUESTION 1 RESOLVED.
 *
 * It replaces BOTH raw "one name per line" textareas (bulk create, and the
 * per-unit names of a named offering). Typing "Room 101" through "Room 120" by
 * hand twenty times is the kind of work software is supposed to do.
 *
 * PATTERN GENERATOR. `Starts with` + `From` + `To` -> "Add 20 names", with a
 * live preview (`Room 101, Room 102, Room 103 … Room 120`). Zero-padding is
 * INFERRED from the `From` string, so `01` gives `01…20` and `101` gives
 * `101…120` — the operator never has to explain padding. The pattern inputs
 * RETAIN their values after Add, so 101–120 followed by 201–220 is two edits,
 * not two retypes. Duplicates that the pattern would re-create are skipped and
 * counted rather than silently dropped.
 *
 * CAPS (binding, from the OPEN QUESTION 1 resolution on #1501):
 * - HARD 500, matching the server EXACTLY. `manage_stay_inventory`'s
 *   `bulk_create` raises `stay_invalid_bulk_request` unless
 *   `jsonb_array_length(items) BETWEEN 1 AND 500`
 *   (`20270131013808_issue_1387_stay_inventory_management.sql:1078-1080`).
 *   The client must never let an operator build a batch the server will reject
 *   with an opaque error after they typed 600 names.
 * - SOFT warning above 50 — a human threshold, not a technical one.
 *
 * AMENDMENT 1 — THE PATTERN ROW HAS EXPLICIT WIDTHS. In the design mockup the
 * "Starts with" field was crushed to one squashed word while From/To took the
 * space: the exact bug class this issue exists to fix. The numeric fields are
 * FIXED-basis and the name field takes the remainder — never the reverse. A
 * four-digit room number needs 96pt; a prefix like "Garden Suite" needs real
 * room. The row wraps and top-aligns, so below ~380pt the prefix takes a full
 * line rather than collapsing.
 *
 * The `testID` lands on the "add one by one" TEXT FIELD, so the pre-#1501
 * testID keeps pointing at the thing an operator types a name into.
 */

import React, { useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  androidOpaque,
  glass,
  namePatternNumBasis,
  namePatternPrefixMinWidth,
  radius,
  semantic,
  spacing,
  stayProseMaxWidth,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { STAY_SPACING } from "../stay/stayLayoutContracts";

import { Button } from "./Button";

/** Matches `manage_stay_inventory`'s `bulk_create` server guard exactly. */
export const NAME_LIST_HARD_CAP = 500;
/** Above this many at once, warn — but never block. */
export const NAME_LIST_SOFT_WARN = 50;

export const NAME_LIST_OVER_CAP_COPY = `You can add up to ${NAME_LIST_HARD_CAP} at a time.`;

/** "That's 120 at once — check the range before you add." */
export const nameListSoftWarnCopy = (count: number): string =>
  `That’s ${count} at once — check the range before you add.`;

/**
 * How many names the range ASKS FOR — computed WITHOUT materialising them, so
 * a 1..999999 range is a number, not an out-of-memory event. This is the figure
 * the cap is judged on: the operator must be told "that is too many" rather
 * than watching the Add button do nothing.
 *
 * Returns 0 for anything that is not a real ascending integer range.
 */
export function patternRangeCount(from: string, to: string): number {
  const start = Number.parseInt(from.trim(), 10);
  const end = Number.parseInt(to.trim(), 10);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return 0;
  if (start < 0 || end < start) return 0;
  return end - start + 1;
}

/**
 * Expand a pattern into names.
 *
 * Zero-padding is inferred from `from`'s own width, so the operator's own
 * typing is the spec. Returns `[]` for any range that is not a real ascending
 * integer range, and for any range beyond the hard cap — the cap message is
 * driven by `patternRangeCount`, not by this emptiness.
 */
export function buildPatternNames(
  prefix: string,
  from: string,
  to: string,
): string[] {
  const count = patternRangeCount(from, to);
  if (count === 0 || count > NAME_LIST_HARD_CAP) return [];
  const start = Number.parseInt(from.trim(), 10);
  const end = Number.parseInt(to.trim(), 10);
  const width = from.trim().length;
  const head = prefix.trimEnd();
  // "Room" -> "Room 101"; "Suite-" -> "Suite-101"; "" -> "101".
  const joiner = head.length > 0 && /[A-Za-z0-9]$/.test(head) ? " " : "";
  const names: string[] = [];
  for (let value = start; value <= end; value += 1) {
    names.push(`${head}${joiner}${String(value).padStart(width, "0")}`);
  }
  return names;
}

/** `Room 101, Room 102, Room 103 … Room 120` */
export function namePatternPreview(names: readonly string[]): string {
  if (names.length === 0) return "";
  if (names.length <= 4) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} … ${names[names.length - 1]}`;
}

export interface NameBuilderProps {
  label: string;
  helper: string;
  values: string[];
  onChange: (values: string[]) => void;
  /** Placeholder for the "add one by one" field. */
  placeholder: string;
  /** Placeholder for the pattern prefix, e.g. "Room". */
  patternPlaceholder?: string;
  editable?: boolean;
  /** Lands on the "add one by one" TEXT FIELD. */
  testID: string;
}

export const NameBuilder: React.FC<NameBuilderProps> = ({
  label,
  helper,
  values,
  onChange,
  placeholder,
  patternPlaceholder = "Room",
  editable = true,
  testID,
}) => {
  const [prefix, setPrefix] = useState(patternPlaceholder);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [draft, setDraft] = useState("");

  const generated = useMemo(
    () => buildPatternNames(prefix, from, to),
    [prefix, from, to],
  );
  const preview = namePatternPreview(generated);

  const existing = useMemo(
    () => new Set(values.map((value) => value.toLowerCase())),
    [values],
  );
  const fresh = useMemo(
    () => generated.filter((name) => !existing.has(name.toLowerCase())),
    [generated, existing],
  );

  // The cap is judged on what the operator ASKED FOR plus what they already
  // have — the exact number that would reach the server's
  // `jsonb_array_length(items) BETWEEN 1 AND 500` guard.
  const requested = patternRangeCount(from, to);
  const projected = values.length + requested;
  const overCap = projected > NAME_LIST_HARD_CAP;
  const canAdd = editable && fresh.length > 0 && !overCap;
  // Derived, not state: the operator sees "you already have these" the moment
  // the range overlaps, not only after a press that would do nothing.
  const duplicates = generated.length - fresh.length;

  const addPattern = (): void => {
    if (!canAdd) return;
    onChange([...values, ...fresh]);
  };

  const addOne = (): void => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    if (existing.has(trimmed.toLowerCase())) {
      setDraft("");
      return;
    }
    if (values.length >= NAME_LIST_HARD_CAP) return;
    onChange([...values, trimmed]);
    setDraft("");
  };

  const remove = (name: string): void => {
    onChange(values.filter((value) => value !== name));
  };

  return (
    <View style={styles.field} testID={`${testID}-field`}>
      {/* #1532 §4 — label + helper are ONE unit at 2pt; the 8pt below the
          block separates them from the control. Before this all three sat on
          one 4pt gap, so a field had no internal hierarchy. */}
      <View style={styles.labelBlock}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.helper}>{helper}</Text>
      </View>

      {/* AMENDMENT 1: explicit widths. Numbers fixed, prefix takes the rest. */}
      <View style={styles.patternRow} testID={`${testID}-pattern-row`}>
        <View style={styles.patternPrefix} testID={`${testID}-prefix-field`}>
          <Text style={styles.subLabel}>Starts with</Text>
          <TextInput
            accessibilityLabel="Starts with"
            value={prefix}
            onChangeText={setPrefix}
            placeholder={patternPlaceholder}
            placeholderTextColor={textTokens.tertiary}
            editable={editable}
            style={styles.input}
            testID={`${testID}-prefix`}
          />
        </View>
        <View style={styles.patternNum} testID={`${testID}-from-field`}>
          <Text style={styles.subLabel}>From</Text>
          <TextInput
            accessibilityLabel="From"
            value={from}
            onChangeText={setFrom}
            placeholder="101"
            placeholderTextColor={textTokens.tertiary}
            keyboardType="numeric"
            editable={editable}
            style={styles.input}
            testID={`${testID}-from`}
          />
        </View>
        <View style={styles.patternNum} testID={`${testID}-to-field`}>
          <Text style={styles.subLabel}>To</Text>
          <TextInput
            accessibilityLabel="To"
            value={to}
            onChangeText={setTo}
            placeholder="120"
            placeholderTextColor={textTokens.tertiary}
            keyboardType="numeric"
            editable={editable}
            style={styles.input}
            testID={`${testID}-to`}
          />
        </View>
      </View>

      {preview ? (
        <Text style={styles.preview} testID={`${testID}-preview`}>
          {preview}
        </Text>
      ) : null}
      {overCap ? (
        <Text style={styles.error} testID={`${testID}-cap`}>
          {NAME_LIST_OVER_CAP_COPY}
        </Text>
      ) : projected > NAME_LIST_SOFT_WARN ? (
        <Text style={styles.warning} testID={`${testID}-soft-warn`}>
          {nameListSoftWarnCopy(projected)}
        </Text>
      ) : null}
      <Button
        label={
          fresh.length > 0
            ? `Add ${fresh.length} name${fresh.length === 1 ? "" : "s"}`
            : "Add names"
        }
        onPress={addPattern}
        disabled={!canAdd}
        variant="secondary"
        size="sm"
        testID={`${testID}-add-pattern`}
      />
      {duplicates > 0 ? (
        <Text style={styles.helper} testID={`${testID}-skipped`}>
          {`${duplicates} you already had ${duplicates === 1 ? "is" : "are"} skipped.`}
        </Text>
      ) : null}

      <Text style={styles.subLabel}>Or add them one by one</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={helper}
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={addOne}
        blurOnSubmit={false}
        returnKeyType="done"
        placeholder={placeholder}
        placeholderTextColor={textTokens.tertiary}
        editable={editable && values.length < NAME_LIST_HARD_CAP}
        style={styles.input}
        testID={testID}
      />

      {values.length > 0 ? (
        <>
          <Text style={styles.helper} testID={`${testID}-count`}>
            {`${values.length} name${values.length === 1 ? "" : "s"} ready`}
          </Text>
          <View style={styles.chipRow} testID={`${testID}-chips`}>
            {values.map((name) => (
              <Pressable
                key={name}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${name}`}
                onPress={() => remove(name)}
                disabled={!editable}
                testID={`${testID}-chip-${name}`}
                style={styles.chip}
              >
                <Text style={styles.chipText}>{name}</Text>
                <Text style={styles.chipRemove}>{"×"}</Text>
              </Pressable>
            ))}
          </View>
        </>
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

const CHIP_MIN_HEIGHT = Platform.OS === "web" ? 32 : 48;

const styles = StyleSheet.create({
  // STACK measure — no flex-axis key (I-AXIS-SCOPED-FLEX).
  // #1532 §4 — the shared field rhythm, sourced from the ONE scale so this kit
  // input and the editor's own `LabeledInput` cannot drift apart.
  field: { width: "100%", minWidth: 0, gap: STAY_SPACING.helperToInput },
  labelBlock: { gap: STAY_SPACING.labelToHelper },
  label: { ...typography.bodySm, color: textTokens.primary, fontWeight: "700" },
  subLabel: { ...typography.caption, color: textTokens.secondary },
  helper: {
    ...typography.caption,
    color: textTokens.secondary,
    maxWidth: stayProseMaxWidth,
  },
  // SPEC AMENDMENT 1 — the pattern row. `alignItems: "flex-start"` keeps the
  // three fields top-aligned when the prefix wraps to its own line.
  patternRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: spacing.sm,
    rowGap: spacing.sm,
    alignItems: "flex-start",
  },
  // ROW-ONLY (I-AXIS-SCOPED-FLEX): the name field takes the REMAINDER.
  patternPrefix: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: namePatternPrefixMinWidth,
    gap: spacing.xxs,
  },
  // ROW-ONLY: fixed basis, never grows, never shrinks — a four-digit room
  // number always fits and never steals the prefix's space.
  patternNum: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: namePatternNumBasis,
    gap: spacing.xxs,
  },
  preview: {
    ...typography.caption,
    color: textTokens.tertiary,
    maxWidth: stayProseMaxWidth,
  },
  warning: { ...typography.caption, color: semantic.warning },
  error: { ...typography.caption, color: semantic.error },
  input: {
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    color: textTokens.primary,
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
  chipText: { ...typography.bodySm, color: textTokens.primary },
  chipRemove: { ...typography.bodySm, color: textTokens.tertiary },
});

export default NameBuilder;
