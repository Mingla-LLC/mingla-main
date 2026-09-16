/**
 * NumberStepper — a labelled whole-number control: [−] [typeable value] [+].
 *
 * WHY: the RSVP creator's "Max guests" control could only move one step per
 * tap. A host who wanted 80 guests tapped + 79 times, and 300 was effectively
 * out of reach. It lived as a private copy inside RsvpStep5Setup; it is shared
 * here so every count field gets the same three ways to set a number, all
 * clamped to [min, max]:
 *
 *   1. TYPE — tap the value and a number pad opens. Non-digits are dropped as
 *      they arrive (a pasted "1,000" becomes 1000), the same digits-only
 *      number-pad shape as the ticket capacity field in TicketTierEditSheet.
 *      An in-range number is written through as it is typed, so a save that
 *      runs while the field is still focused never loses it. On blur or
 *      submit an out-of-range number is clamped, and an emptied field puts
 *      back the value it had when it was focused.
 *   2. TAP − / + — one step.
 *   3. HOLD − / + — repeats after the long-press delay and speeds up; see
 *      `holdRepeatStep`.
 *
 * ACCESSIBILITY: on iOS/Android the label is one `adjustable` element that
 * carries the value and range and answers increment/decrement (VoiceOver swipe
 * up/down, TalkBack adjust). The field and both buttons stay reachable as
 * SIBLINGS — never nested inside it — so a screen-reader user can still type a
 * large number instead of swiping to it. Web gets no slider role: a div slider
 * with no arrow-key handling is worse than the plain field + buttons, which are
 * already keyboard operable there.
 *
 * KEYBOARD: the field is a plain TextInput, so the host screen's SmartScrollView
 * (KeyboardAwareScrollView on native) scrolls it clear of the keyboard, and the
 * app-root KeyboardToolbarRoot Done bar blurs it — iOS number pads have no
 * return key. Hosts must render this inside a SmartScrollView.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type AccessibilityActionEvent,
  type GestureResponderEvent,
} from "react-native";

import {
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

// Same row fill as the RSVP step it came from — Android gets the opaque
// fallback (ANDROID_GLASS_USES_OPAQUE_FALLBACK; #1028 tracks the composite).
const ROW_BG = Platform.select({
  ios: glass.tint.profileBase,
  android: "#23262b",
  default: glass.tint.profileBase,
});

/** Long-press delay before a held − / + starts repeating (ms). */
export const HOLD_DELAY_MS = 350;

/**
 * The repeat schedule for a held button, by how many repeats have already
 * fired: a slow start so a short hold is controllable, then faster, then steps
 * of ten so a large count is a couple of seconds away rather than a minute.
 */
export const holdRepeatStep = (
  repeatsSoFar: number,
): { intervalMs: number; step: number } => {
  if (repeatsSoFar < 8) return { intervalMs: 150, step: 1 };
  if (repeatsSoFar < 24) return { intervalMs: 60, step: 1 };
  return { intervalMs: 60, step: 10 };
};

/** Round to a whole number and clamp into [min, max]. */
export const clampCount = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(n)));

/**
 * One step from `current`. A step of 1 moves by one; a larger step snaps to
 * its multiples (47 → 50 → 60 going up, 47 → 40 → 30 going down) so a fast
 * hold lands on round numbers.
 */
export const stepCount = (
  current: number,
  direction: 1 | -1,
  step: number,
  min: number,
  max: number,
): number => {
  const raw =
    step <= 1
      ? current + direction
      : direction > 0
        ? Math.floor(current / step) * step + step
        : Math.ceil(current / step) * step - step;
  return clampCount(raw, min, max);
};

/** Keep only digits, at most `maxDigits` of them. */
export const sanitizeTypedCount = (raw: string, maxDigits: number): string =>
  raw.replace(/\D/g, "").slice(0, maxDigits);

/** The whole number in already-sanitized text, or null when there is none. */
export const parseTypedCount = (digits: string): number | null =>
  digits.length === 0 ? null : parseInt(digits, 10);

const hasSelectionRange = (
  target: unknown,
): target is { setSelectionRange: (start: number, end: number) => void } =>
  typeof target === "object" &&
  target !== null &&
  "setSelectionRange" in target &&
  typeof target.setSelectionRange === "function";

// Web: a click lands the caret after focus has selected the text, so select it
// again on the next frame — the TicketTierEditSheet capacity field does this.
const reselectOnWebPointer = (
  event: GestureResponderEvent,
  value: string,
): void => {
  if (Platform.OS !== "web" || value.length === 0) return;
  if (typeof requestAnimationFrame !== "function") return;
  const target: unknown = event.currentTarget;
  requestAnimationFrame(() => {
    if (hasSelectionRange(target)) target.setSelectionRange(0, value.length);
  });
};

export interface NumberStepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  /** Suffixed: `-adjust` (label), `-dec`, `-value` (field), `-inc`. */
  testID?: string;
}

export const NumberStepper: React.FC<NumberStepperProps> = ({
  label,
  value,
  min,
  max,
  onChange,
  testID,
}) => {
  const maxDigits = String(Math.max(0, Math.trunc(max))).length;

  // Non-null only while the field is being edited; mirrored in a ref so the
  // blur that follows a submit sees the cleared state in the same tick.
  const [editText, setEditText] = useState<string | null>(null);
  const editTextRef = useRef<string | null>(null);
  const valueAtFocusRef = useRef(value);

  const setEditing = useCallback((next: string | null) => {
    editTextRef.current = next;
    setEditText(next);
  }, []);

  // A held button calls the LATEST onChange, not the one it started with.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopHold = useCallback(() => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);
  useEffect(() => stopHold, [stopHold]);

  const current = clampCount(value, min, max);
  const canDec = current > min;
  const canInc = current < max;

  const bump = useCallback(
    (direction: 1 | -1) => {
      const typed =
        editTextRef.current === null
          ? null
          : parseTypedCount(editTextRef.current);
      const base = typed === null ? value : clampCount(typed, min, max);
      const next = stepCount(base, direction, 1, min, max);
      if (editTextRef.current !== null) setEditing(String(next));
      if (next !== value) onChange(next);
    },
    [max, min, onChange, setEditing, value],
  );

  const startHold = useCallback(
    (direction: 1 | -1) => {
      stopHold();
      let running = clampCount(value, min, max);
      let repeats = 0;
      const tick = (): void => {
        const { intervalMs, step } = holdRepeatStep(repeats);
        const next = stepCount(running, direction, step, min, max);
        if (next === running) {
          holdTimerRef.current = null;
          return;
        }
        running = next;
        repeats += 1;
        if (editTextRef.current !== null) setEditing(String(next));
        onChangeRef.current(next);
        holdTimerRef.current = setTimeout(tick, intervalMs);
      };
      tick();
    },
    [max, min, setEditing, stopHold, value],
  );

  const commitTyped = useCallback(() => {
    const text = editTextRef.current;
    if (text === null) return;
    const typed = parseTypedCount(text);
    const next =
      typed === null ? valueAtFocusRef.current : clampCount(typed, min, max);
    setEditing(null);
    if (next !== value) onChange(next);
  }, [max, min, onChange, setEditing, value]);

  const handleChangeText = useCallback(
    (raw: string) => {
      const digits = sanitizeTypedCount(raw, maxDigits);
      setEditing(digits);
      const typed = parseTypedCount(digits);
      if (typed !== null && typed >= min && typed <= max && typed !== value) {
        onChange(typed);
      }
    },
    [max, maxDigits, min, onChange, setEditing, value],
  );

  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === "increment") bump(1);
      else if (event.nativeEvent.actionName === "decrement") bump(-1);
    },
    [bump],
  );

  const shownText = editText ?? String(value);
  const isNative = Platform.OS !== "web";
  const fieldLabel = `Type ${label.charAt(0).toLowerCase()}${label.slice(1)}`;

  return (
    <View style={styles.row}>
      <View
        accessible={isNative}
        accessibilityRole={isNative ? "adjustable" : undefined}
        accessibilityLabel={isNative ? label : undefined}
        accessibilityValue={
          isNative ? { min, max, now: current, text: String(current) } : undefined
        }
        accessibilityActions={
          isNative ? [{ name: "increment" }, { name: "decrement" }] : undefined
        }
        onAccessibilityAction={isNative ? handleAccessibilityAction : undefined}
        style={styles.labelCol}
        testID={testID ? `${testID}-adjust` : undefined}
      >
        <Text style={styles.label}>{label}</Text>
      </View>
      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label}`}
          accessibilityState={{ disabled: !canDec }}
          disabled={!canDec}
          hitSlop={4}
          onPress={() => bump(-1)}
          onLongPress={() => startHold(-1)}
          onPressOut={stopHold}
          delayLongPress={HOLD_DELAY_MS}
          style={[styles.btn, !canDec && styles.btnDisabled]}
          testID={testID ? `${testID}-dec` : undefined}
        >
          <Text style={styles.btnText}>−</Text>
        </Pressable>
        <TextInput
          value={shownText}
          onChangeText={handleChangeText}
          onFocus={() => {
            valueAtFocusRef.current = value;
            setEditing(String(value));
          }}
          onBlur={commitTyped}
          onSubmitEditing={commitTyped}
          onPressIn={(event) => reselectOnWebPointer(event, shownText)}
          keyboardType="number-pad"
          returnKeyType="done"
          selectTextOnFocus
          maxLength={maxDigits}
          accessibilityLabel={fieldLabel}
          style={styles.field}
          testID={testID ? `${testID}-value` : undefined}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label}`}
          accessibilityState={{ disabled: !canInc }}
          disabled={!canInc}
          hitSlop={4}
          onPress={() => bump(1)}
          onLongPress={() => startHold(1)}
          onPressOut={stopHold}
          delayLongPress={HOLD_DELAY_MS}
          style={[styles.btn, !canInc && styles.btnDisabled]}
          testID={testID ? `${testID}-inc` : undefined}
        >
          <Text style={styles.btnText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: ROW_BG,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    marginBottom: spacing.sm,
  },
  labelCol: { flex: 1, marginRight: spacing.sm },
  label: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "500",
    color: textTokens.primary,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  btn: {
    width: 36,
    height: 36,
    borderRadius: radiusTokens.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileElevated,
  },
  btnDisabled: { opacity: 0.4 },
  btnText: {
    fontSize: 20,
    fontWeight: "700",
    color: textTokens.primary,
  },
  field: {
    minWidth: 64,
    height: 36,
    paddingHorizontal: spacing.sm,
    paddingVertical: 0,
    borderRadius: radiusTokens.sm,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
    backgroundColor: glass.tint.profileElevated,
    textAlign: "center",
    fontSize: typography.bodyLg.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
    fontVariant: ["tabular-nums"],
  },
});
