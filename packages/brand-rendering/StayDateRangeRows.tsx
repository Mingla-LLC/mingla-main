/**
 * StayDateRangeRows — the stay dates control on every platform (#4523,
 * reworking #1503). Two rows (Check-in, Check-out) open ONE Mingla range
 * calendar inline under them, drawn in the page palette. The host app renders
 * that calendar through `renderCalendar` (Host: its lazily loaded calendar
 * body; Explorer: `@mingla/calendar`), so this package imports no calendar
 * code and no picker: no OS spinner or dialog, no browser date box.
 *
 * Changing month never closes the calendar or changes a date; the range is
 * committed on Done, and closing it (tap a row again, Escape) keeps the dates.
 *
 * Every date this control emits is a venue-local `YYYY-MM-DD` (or `""`), and
 * every rule still comes from `./stayDateRules`: a committed range goes through
 * `applyCheckInChange` then `applyCheckOutChange`, exactly as two separate
 * picks did before, so the stored values and the analytics events are the same.
 */

import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ThemePalette } from "@mingla/offering-rendering";
import { accentFill } from "@mingla/offering-rendering/themeAccentStyle";

import {
  addStayDays,
  applyCheckInChange,
  applyCheckOutChange,
  formatStayDateLong,
  formatStayDateShort,
  MAX_STAY_NIGHTS,
  type StayDateBounds,
  type StayDateRange,
} from "./stayDateRules";
import {
  BrandRenderingReact as React,
  useBrandRenderingState as useState,
  type BrandRenderingReactElement,
  type BrandRenderingReactNode,
} from "./PublicVenueTabs";

/** The calendar colours, from the page palette (same shape as @mingla/calendar's tokens). */
export interface StayCalendarTokens {
  surface: string;
  text: string;
  textMuted: string;
  textFaint: string;
  border: string;
  fieldFill: string;
  selectedFill: string;
  onSelected: string;
  rangeFill: string;
  todayDot: string;
  /** The accent drawn as a fill (gradient when the page theme has one); see @mingla/calendar. */
  accentStyle?: { backgroundColor?: string; backgroundImage?: string; experimental_backgroundImage?: string };
  error: string;
  radius: number;
  dayRadius: number;
}

/** What the host app's calendar receives. Dates are `YYYY-MM-DD`. */
export interface StayRangeCalendarArgs {
  value: { start: string; end: string };
  /** Earliest check-in, inclusive. */
  min: string;
  /** Latest check-out, inclusive. */
  max: string;
  /** Latest check-in, inclusive (the booking horizon): later days only end a stay. */
  maxStart: string;
  /** Longest stay, in nights. */
  maxLength: number;
  /** The venue's IANA zone ("today" is the venue's today). */
  timeZone: string;
  tokens: StayCalendarTokens;
  label: string;
  testID: string;
  /** Done: the chosen range. The control closes the calendar itself. */
  onCommit: (range: { start: string; end: string }) => void;
  /** Escape or the host's own close: keeps the committed dates. */
  onClose: () => void;
}

export type RenderStayRangeCalendar = (args: StayRangeCalendarArgs) => BrandRenderingReactNode;

export interface StayDateRangeFieldProps {
  value: StayDateRange;
  bounds: StayDateBounds;
  palette: ThemePalette;
  onChange: (next: StayDateRange, field: "check_in" | "check_out") => void;
  /** The host app's Mingla range calendar (see StayRangeCalendarArgs). */
  renderCalendar: RenderStayRangeCalendar;
  /** The venue's IANA zone. */
  timeZone: string;
  disabled?: boolean;
  errorText?: string | null;
  checkInLabel?: string;
  checkOutLabel?: string;
  testID?: string;
}

export const STAY_DATE_RANGE_CHECK_IN_TESTID = "stay-date-check-in";
export const STAY_DATE_RANGE_CHECK_OUT_TESTID = "stay-date-check-out";
const ERROR_COLOR = "#ef4444";

export function stayCalendarTokens(palette: ThemePalette): StayCalendarTokens {
  // The accent is a fill here, so it goes through the gradient-aware helper (#1023).
  const accent = accentFill(palette);
  return {
    surface: "transparent",
    text: palette.primaryText,
    textMuted: palette.secondaryText,
    textFaint: palette.tertiaryText,
    border: palette.panelBorder,
    fieldFill: palette.card,
    selectedFill: accent.backgroundColor,
    onSelected: palette.accentText,
    rangeFill: palette.accentWash,
    todayDot: accent.backgroundColor,
    accentStyle: accent,
    error: ERROR_COLOR,
    radius: 12,
    dayRadius: 12,
  };
}

/** Pure: the onChange calls a committed range makes, in order (check-in first). */
export function stayRangeCommits(
  value: StayDateRange,
  range: { start: string; end: string },
): Array<{ next: StayDateRange; field: "check_in" | "check_out" }> {
  const calls: Array<{ next: StayDateRange; field: "check_in" | "check_out" }> = [];
  let next = value;
  if (range.start !== value.checkIn) {
    next = applyCheckInChange(next, range.start);
    calls.push({ next, field: "check_in" });
  }
  if (range.end !== next.checkOut) {
    next = applyCheckOutChange(next, range.end);
    calls.push({ next, field: "check_out" });
  }
  return calls;
}

export function StayDateRangeRows({
  value,
  bounds,
  palette,
  onChange,
  renderCalendar,
  timeZone,
  disabled = false,
  errorText = null,
  checkInLabel = "Check-in",
  checkOutLabel = "Check-out",
  testID,
}: StayDateRangeFieldProps): BrandRenderingReactElement {
  const [open, setOpen] = useState(false);
  // The check-out row stays inert until a check-in exists, as before.
  const checkOutDisabled = disabled || value.checkIn === "";
  const prefix = testID ?? "";
  const toggle = (): void => setOpen((was) => !was);

  return (
    <View style={styles.host}>
      <View style={styles.row}>
        <DateRow
          label={checkInLabel}
          display={formatStayDateShort(value.checkIn)}
          spoken={formatStayDateLong(value.checkIn)}
          disabled={disabled}
          expanded={open}
          palette={palette}
          testID={`${prefix}${STAY_DATE_RANGE_CHECK_IN_TESTID}`}
          onPress={toggle}
        />
        <DateRow
          label={checkOutLabel}
          display={formatStayDateShort(value.checkOut)}
          spoken={formatStayDateLong(value.checkOut)}
          disabled={checkOutDisabled}
          expanded={open}
          hint={value.checkIn === "" ? "Choose a check-in date first" : undefined}
          palette={palette}
          testID={`${prefix}${STAY_DATE_RANGE_CHECK_OUT_TESTID}`}
          onPress={toggle}
        />
      </View>
      {checkOutDisabled && !disabled ? (
        <Text style={[styles.hint, { color: palette.tertiaryText }]}>Choose a check-in date first</Text>
      ) : null}
      {open && !disabled ? (
        <View style={styles.calendar}>
          {renderCalendar({
            value: { start: value.checkIn, end: value.checkOut },
            min: bounds.minCheckIn,
            // A check-out may fall up to MAX_STAY_NIGHTS after the last check-in.
            max: addStayDays(bounds.maxCheckIn, MAX_STAY_NIGHTS),
            maxStart: bounds.maxCheckIn,
            maxLength: MAX_STAY_NIGHTS,
            timeZone,
            tokens: stayCalendarTokens(palette),
            label: `${checkInLabel} and ${checkOutLabel}`,
            testID: `${prefix}stay-date-calendar`,
            onCommit: (range) => {
              for (const call of stayRangeCommits(value, range)) onChange(call.next, call.field);
              setOpen(false);
            },
            onClose: () => setOpen(false),
          })}
        </View>
      ) : null}
      {errorText !== null ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.errorText}>
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
  expanded,
  hint,
  palette,
  testID,
  onPress,
}: {
  label: string;
  display: string;
  spoken: string;
  disabled: boolean;
  expanded: boolean;
  hint?: string;
  palette: ThemePalette;
  testID: string;
  onPress: () => void;
}): BrandRenderingReactElement {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: palette.tertiaryText }]}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} date, currently ${spoken}`}
        accessibilityHint={hint}
        accessibilityState={{ disabled, expanded }}
        disabled={disabled}
        onPress={onPress}
        testID={testID}
        style={[
          styles.row44,
          { borderColor: palette.panelBorder, backgroundColor: palette.card },
          disabled && styles.disabled,
        ]}
      >
        <Text style={[styles.rowValue, { color: palette.primaryText }]}>{display}</Text>
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
  hint: { fontSize: 12, lineHeight: 16 },
  calendar: { marginTop: 6 },
  errorText: { color: ERROR_COLOR, fontSize: 13, lineHeight: 18 },
});
