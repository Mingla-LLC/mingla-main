/**
 * WebDateTimeInput — the ONE shared visible native date/time control for the
 * business app's WEB target (issue #1027, Thread B).
 *
 * WHY THIS EXISTS (the "fixed for good" structural fix):
 * Business date/time selection on web historically diverged per file. Two
 * broken mechanisms had spread across the codebase:
 *   1. Class 1 — a hidden 1×1 `opacity:0; pointer-events:none` <input> triggered
 *      programmatically via `el.showPicker()` / `.click()` from a Pressable. On
 *      desktop Chrome the calendar opened detached from the tapped row and was
 *      un-dismissable; the `.click()` fallback is a documented Chromium no-op
 *      (silent failure on Safari<16 / Firefox<101); time rows read as dead.
 *   2. Class 2 — `@react-native-community/datetimepicker` (which ships NO web
 *      build) rendered on web with only `ios`/`android` branches → nothing
 *      renders, a hard silent no-op on buyer/trip/marketing web surfaces.
 *
 * Seth confirmed the live symptom on desktop Chrome: "the date picker comes up,
 * clicking out does not close it... the times don't work — clicking does
 * nothing." This component resolves both: a REAL, visible, hit-testable native
 * `<input type=date|time|datetime-local>` the user clicks directly. The browser
 * opens its own picker anchored at the field and dismisses normally (it is an
 * in-flow input, not a detached hidden one); `onChange` commits immediately —
 * no bridge, no `showPicker`, no hidden element.
 *
 * Callers gate on `Platform.OS === "web"` and render this in place of the native
 * Pressable/`DateTimePicker`. iOS/Android keep their `DateTimePicker` Sheet/
 * dialog flows byte-identical. Mirrors the proven-good pattern already shipped in
 * `trip/TripCreatorStep1Basics.tsx` + `venue/BrandHoursEditor.tsx`.
 *
 * INVARIANT: I-PROPOSED-1027-WEB-NATIVE-DATE-INPUT — on web, business date/time
 * selection MUST render a real, visible, hit-testable native input the user
 * clicks directly; it MUST NOT use a hidden (`opacity:0`/`pointer-events:none`/
 * `display:none`) input driven by `showPicker()`/`.click()`, and MUST NOT render
 * `@react-native-community/datetimepicker` on web.
 */

import React from "react";

import {
  glass,
  radius,
  semantic,
  text as textTokens,
} from "../../constants/designSystem";

export type WebDateTimeInputType = "date" | "time" | "datetime-local";

export interface WebDateTimeInputProps {
  /** HTML5 input type. */
  type: WebDateTimeInputType;
  /**
   * HTML5-formatted value: `YYYY-MM-DD` (date), `HH:MM` (time), or
   * `YYYY-MM-DDTHH:MM` (datetime-local). Empty string = unset (placeholder).
   */
  value: string;
  /** Fired with the raw HTML5 value string on every change. Empty is possible. */
  onChangeValue: (value: string) => void;
  /** Accessibility label — required (this replaces a labelled Pressable). */
  ariaLabel: string;
  /** Optional lower bound (HTML5-formatted, matching `type`). */
  min?: string;
  /** Optional upper bound (HTML5-formatted, matching `type`). */
  max?: string;
  disabled?: boolean;
  /** Draws the error border (mirrors `styles.inputError`). */
  hasError?: boolean;
  /** Stable id for query in tests + browser automation. */
  testID?: string;
}

/** Default marker for tests/automation when a caller sets no explicit testID. */
export const WEB_DATETIME_INPUT_TESTID = "web-native-datetime-input";

// Visible, hit-testable control styled to match `styles.pickerRow` (dark glass
// bg, 1px border, ~48px tall, white 16px text). NO opacity/pointer-events
// hiding — this input IS the affordance the user clicks. `colorScheme: dark`
// makes the browser render the native calendar/clock popup and its indicator
// glyph light-on-dark to match the app.
const BASE_STYLE: React.CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  height: 48,
  paddingLeft: 14,
  paddingRight: 14,
  borderRadius: radius.md,
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: glass.border.profileBase,
  backgroundColor: glass.tint.profileBase,
  color: textTokens.primary,
  fontSize: 16,
  colorScheme: "dark",
};

export function WebDateTimeInput({
  type,
  value,
  onChangeValue,
  ariaLabel,
  min,
  max,
  disabled = false,
  hasError = false,
  testID,
}: WebDateTimeInputProps): React.ReactElement {
  const style: React.CSSProperties = hasError
    ? { ...BASE_STYLE, borderColor: semantic.error }
    : BASE_STYLE;

  return (
    <input
      type={type}
      value={value}
      min={min}
      max={max}
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid={testID ?? WEB_DATETIME_INPUT_TESTID}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
        onChangeValue(e.target.value);
      }}
      style={style}
    />
  );
}
