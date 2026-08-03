/**
 * StayDateRangeField — NATIVE variant (iOS + Android).
 * Issue #1503 [stay-date-pickers], SPEC §4.3.
 *
 * Metro resolves this file over the bare `StayDateRangeField.tsx` on
 * `platform: ios | android`, which is what keeps
 * `@react-native-community/datetimepicker` — a module with NO web build — out of
 * the web bundle entirely. Same props, same exported name, same value contract
 * as the web twin: `YYYY-MM-DD` strings or `""`, never a `Date`.
 *
 * `@react-native-community/datetimepicker@8.4.4` is ALREADY a dependency of both
 * apps and is already imported by 22 shipping components, so this file adds ZERO
 * new native code and ships over the air.
 *
 * Behaviour mirrors the shipped consumer precedent
 * `app-mobile/src/components/discover/StayFilterChips.tsx:282-320`.
 */

import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { ThemePalette } from "@mingla/offering-rendering";

import {
  applyCheckInChange,
  applyCheckOutChange,
  formatStayDate,
  formatStayDateLong,
  formatStayDateShort,
  parseStayDate,
  type StayDateBounds,
  type StayDateRange,
} from "./stayDateRules";
import {
  useBrandRenderingState as useState,
  type BrandRenderingReactElement,
} from "./PublicVenueTabs";

/**
 * SC-8 tripwire. The web export MUST NOT contain this string; the iOS/Android
 * bundle MUST. Its presence in `mingla-business`'s web export would mean Metro
 * had pulled the native picker into the web bundle and the `.native.tsx` split
 * had silently stopped working.
 *
 * It is ATTACHED AT RUNTIME (`nativeID` on the root View below), not merely
 * exported. An exported-but-unused constant is dead-code-eliminated by the
 * minifier — measured: as a bare export it was absent from BOTH the web and the
 * iOS bundle, which would make the web-absence grep vacuously green and prove
 * nothing. Verified after the change: present in the iOS export, absent from the
 * web export.
 */
export const STAY_DATE_RANGE_FIELD_NATIVE_MARKER =
  "stay-date-range-field-native-only-1503";

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

type OpenField = "check_in" | "check_out" | null;

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
  const [openField, setOpenField] = useState<OpenField>(null);
  const checkOutDisabled = disabled || value.checkIn === "";

  const anchor = (field: "check_in" | "check_out"): Date => {
    const current = field === "check_in" ? value.checkIn : value.checkOut;
    const fallback = field === "check_in" ? bounds.minCheckIn : bounds.minCheckOut;
    return (
      (current === "" ? null : parseStayDate(current)) ??
      parseStayDate(fallback) ??
      new Date()
    );
  };

  const handlePicked = (
    event: DateTimePickerEvent,
    selected?: Date,
  ): void => {
    const field = openField;
    // Android renders a modal dialog that owns its own lifecycle: close on every
    // event, including a back-press dismissal.
    setOpenField(null);
    if (field === null) return;
    if (event.type === "dismissed" || selected === undefined) return;
    const picked = formatStayDate(selected);
    if (field === "check_in") {
      onChange(applyCheckInChange(value, picked), "check_in");
    } else {
      onChange(applyCheckOutChange(value, picked), "check_out");
    }
  };

  return (
    <View style={styles.host} nativeID={STAY_DATE_RANGE_FIELD_NATIVE_MARKER}>
      <View style={styles.row}>
        <DateRow
          label={checkInLabel}
          display={formatStayDateShort(value.checkIn)}
          spoken={formatStayDateLong(value.checkIn)}
          disabled={disabled}
          palette={palette}
          testID={`${testID ?? ""}${STAY_DATE_RANGE_CHECK_IN_TESTID}`}
          onPress={() => setOpenField("check_in")}
        />
        <DateRow
          label={checkOutLabel}
          display={formatStayDateShort(value.checkOut)}
          spoken={formatStayDateLong(value.checkOut)}
          disabled={checkOutDisabled}
          hint={
            value.checkIn === "" ? "Choose a check-in date first" : undefined
          }
          palette={palette}
          testID={`${testID ?? ""}${STAY_DATE_RANGE_CHECK_OUT_TESTID}`}
          onPress={() => setOpenField("check_out")}
        />
      </View>
      {openField !== null ? (
        <DateTimePicker
          value={anchor(openField)}
          mode="date"
          display={Platform.OS === "ios" ? "inline" : "default"}
          minimumDate={
            parseStayDate(
              openField === "check_in" ? bounds.minCheckIn : bounds.minCheckOut,
            ) ?? undefined
          }
          maximumDate={
            parseStayDate(
              openField === "check_in" ? bounds.maxCheckIn : bounds.maxCheckOut,
            ) ?? undefined
          }
          themeVariant={palette.glassTint}
          onChange={handlePicked}
        />
      ) : null}
      {errorText !== null ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={styles.errorText}
        >
          {errorText}
        </Text>
      ) : null}
    </View>
  );
}

function DateRow({
  label,
  display,
  spoken,
  disabled,
  hint,
  palette,
  testID,
  onPress,
}: {
  label: string;
  display: string;
  spoken: string;
  disabled: boolean;
  hint?: string;
  palette: ThemePalette;
  testID: string;
  onPress: () => void;
}): BrandRenderingReactElement {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: palette.tertiaryText }]}>
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} date, currently ${spoken}`}
        accessibilityHint={hint}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        testID={testID}
        style={[
          styles.row44,
          {
            borderColor: palette.panelBorder,
            backgroundColor: palette.card,
          },
          disabled && styles.disabled,
        ]}
      >
        <Text style={[styles.rowValue, { color: palette.primaryText }]}>
          {display}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: 6 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  field: { flex: 1, minWidth: 140, gap: 6 },
  fieldLabel: { fontSize: 12, fontWeight: "700" },
  row44: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  rowValue: { fontSize: 14, fontWeight: "600" },
  disabled: { opacity: 0.28 },
  errorText: { color: "#ef4444", fontSize: 13, lineHeight: 18 },
});
