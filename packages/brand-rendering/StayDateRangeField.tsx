/**
 * StayDateRangeField — WEB variant. Issue #1503 [stay-date-pickers], SPEC §4.2.
 *
 * Two REAL, visible, hit-testable HTML5 `<input type="date">` controls. The
 * input IS the affordance: the browser opens its own calendar anchored at the
 * field and dismisses it normally. There is deliberately NO hidden input, NO
 * `opacity: 0`, NO `pointerEvents: "none"`, NO `showPicker()` and NO `.click()`
 * bridge — that mechanism is banned by I-PROPOSED-1027-WEB-NATIVE-DATE-INPUT
 * because on desktop Chrome the calendar opened detached and un-dismissable.
 *
 * Metro resolves `StayDateRangeField.native.tsx` on iOS/Android, so this file
 * (and only this file) reaches the web bundle, and the native picker module
 * never does. Precedent inside packages/: offering-rendering's
 * `useCachedCoverVideoUri.ts` / `.native.ts` pair.
 *
 * `packages/brand-rendering` may not import `mingla-business/src` (CI gate
 * `orch-0964-brand-rendering-self-contained.mjs` + I-MOR-0827-PACKAGE-ISOLATION),
 * so `WebDateTimeInput` is NOT reused here; styling comes from the injected
 * `palette` only.
 *
 * Every date this control emits is a venue-local `YYYY-MM-DD` (or `""`). All
 * range maths lives in `./stayDateRules` — this file computes no dates.
 */

import { StyleSheet, Text, View } from "react-native";
import type { ThemePalette } from "@mingla/offering-rendering";

import {
  applyCheckInChange,
  applyCheckOutChange,
  type StayDateBounds,
  type StayDateRange,
} from "./stayDateRules";
import {
  BrandRenderingReact as React,
  type BrandRenderingReactElement,
} from "./PublicVenueTabs";

export interface StayDateRangeFieldProps {
  value: StayDateRange;
  bounds: StayDateBounds;
  palette: ThemePalette;
  onChange: (next: StayDateRange, field: "check_in" | "check_out") => void;
  disabled?: boolean;
  errorText?: string | null;
  checkInLabel?: string;
  checkOutLabel?: string;
  testID?: string;
}

export const STAY_DATE_RANGE_CHECK_IN_TESTID = "stay-date-check-in";
export const STAY_DATE_RANGE_CHECK_OUT_TESTID = "stay-date-check-out";

export function StayDateRangeField({
  value,
  bounds,
  palette,
  onChange,
  disabled = false,
  errorText = null,
  checkInLabel = "Check-in",
  checkOutLabel = "Check-out",
  testID,
}: StayDateRangeFieldProps): BrandRenderingReactElement {
  // The check-out control stays inert until a check-in exists — picking an end
  // before a start is meaningless and the bounds would be unanchored.
  const checkOutDisabled = disabled || value.checkIn === "";
  const inputStyle: React.CSSProperties = {
    boxSizing: "border-box",
    width: "100%",
    minHeight: 46,
    paddingLeft: 12,
    paddingRight: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderRadius: 12,
    borderColor: errorText === null ? palette.panelBorder : ERROR_COLOR,
    backgroundColor: palette.card,
    color: palette.primaryText,
    fontSize: 14,
    // Without this the browser paints its calendar popup and the indicator
    // glyph light-on-light over a dark brand surface.
    colorScheme: palette.glassTint,
  };

  return (
    <View style={styles.host}>
      <View style={styles.row}>
        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: palette.tertiaryText }]}>
            {checkInLabel}
          </Text>
          <input
            type="date"
            value={value.checkIn}
            min={bounds.minCheckIn}
            max={bounds.maxCheckIn}
            disabled={disabled}
            aria-label={checkInLabel}
            data-testid={`${testID ?? ""}${STAY_DATE_RANGE_CHECK_IN_TESTID}`}
            style={inputStyle}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              // An incomplete or cleared HTML5 date input emits "". That is a
              // legal value here and must never throw.
              onChange(applyCheckInChange(value, event.target.value), "check_in");
            }}
          />
        </View>
        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: palette.tertiaryText }]}>
            {checkOutLabel}
          </Text>
          <input
            type="date"
            value={value.checkOut}
            min={bounds.minCheckOut}
            max={bounds.maxCheckOut}
            disabled={checkOutDisabled}
            aria-label={checkOutLabel}
            aria-describedby={
              checkOutDisabled ? "stay-date-check-out-hint" : undefined
            }
            data-testid={`${testID ?? ""}${STAY_DATE_RANGE_CHECK_OUT_TESTID}`}
            style={
              checkOutDisabled
                ? { ...inputStyle, opacity: 0.55 }
                : inputStyle
            }
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              onChange(
                applyCheckOutChange(value, event.target.value),
                "check_out",
              );
            }}
          />
        </View>
      </View>
      {checkOutDisabled && !disabled ? (
        <Text
          nativeID="stay-date-check-out-hint"
          style={[styles.hint, { color: palette.tertiaryText }]}
        >
          Choose a check-in date first
        </Text>
      ) : null}
      {errorText !== null ? (
        <Text accessibilityRole="alert" style={styles.errorText}>
          {errorText}
        </Text>
      ) : null}
    </View>
  );
}

const ERROR_COLOR = "#ef4444";

const styles = StyleSheet.create({
  host: { gap: 6 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  field: { flex: 1, minWidth: 140, gap: 6 },
  fieldLabel: { fontSize: 12, fontWeight: "700" },
  hint: { fontSize: 12, lineHeight: 16 },
  errorText: { color: ERROR_COLOR, fontSize: 13, lineHeight: 18 },
});
