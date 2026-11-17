/**
 * StayDateStrip — issue #4420 (design file → venueDef stay "Check-in /
 * Check-out" strip).
 *
 * A quick-pick row of the next three weeks above the existing
 * StayDateRangeField (which stays, for any date further out and for its own
 * accessibility path). Tap a day for check-in, then a later day for
 * check-out; the nights in between fill in. Tapping on or before check-in,
 * or tapping again once both are set, starts a new check-in.
 *
 * Every rule comes from `./stayDateRules` (the bounds the field already
 * uses): days before the first allowed check-in, or past the last allowed
 * check-in / check-out, are not offered. No price or "booked" state is shown,
 * because the page has no per-night availability to show (Constitution 9).
 */

import { StyleSheet, View } from "react-native";
import type { ThemePalette } from "@mingla/offering-rendering";
import { OfferingDateStrip } from "@mingla/offering-rendering/OfferingDecideParts";
import { OfferingSubLabel } from "@mingla/offering-rendering/OfferingSectionTitle";

import {
  addStayDays,
  applyCheckInChange,
  applyCheckOutChange,
  compareStayDates,
  formatStayDateLong,
  parseStayDate,
  type StayDate,
  type StayDateBounds,
  type StayDateRange,
} from "./stayDateRules";
import {
  BrandRenderingReact as React,
  type BrandRenderingReactElement,
} from "./PublicVenueTabs";

export const STAY_DATE_STRIP_DAYS = 21;

export interface StayDateStripProps {
  value: StayDateRange;
  bounds: StayDateBounds;
  palette: ThemePalette;
  onChange: (next: StayDateRange, field: "check_in" | "check_out") => void;
  disabled?: boolean;
  testID?: string;
}

/** Pure: the range after tapping `day` (exported for the regression test). */
export function stayStripTap(
  range: StayDateRange,
  day: StayDate,
  bounds: StayDateBounds,
): { next: StayDateRange; field: "check_in" | "check_out" } {
  const choosingCheckOut =
    range.checkIn !== "" &&
    range.checkOut === "" &&
    compareStayDates(day, range.checkIn) > 0 &&
    compareStayDates(day, bounds.maxCheckOut) <= 0;
  if (choosingCheckOut) {
    return { next: applyCheckOutChange(range, day), field: "check_out" };
  }
  return {
    next: applyCheckInChange({ checkIn: range.checkIn, checkOut: "" }, day),
    field: "check_in",
  };
}

/** Pure: may this day be tapped right now? */
export function stayStripDayEnabled(
  range: StayDateRange,
  day: StayDate,
  bounds: StayDateBounds,
): boolean {
  if (compareStayDates(day, bounds.minCheckIn) < 0) return false;
  const choosingCheckOut =
    range.checkIn !== "" &&
    range.checkOut === "" &&
    compareStayDates(day, range.checkIn) > 0;
  if (choosingCheckOut) return compareStayDates(day, bounds.maxCheckOut) <= 0;
  return compareStayDates(day, bounds.maxCheckIn) <= 0;
}

export function StayDateStrip({
  value,
  bounds,
  palette,
  onChange,
  disabled = false,
  testID = "issue-4420-stay-date-strip",
}: StayDateStripProps): BrandRenderingReactElement {
  const days: StayDate[] = [];
  for (let i = 0; i < STAY_DATE_STRIP_DAYS; i++) {
    days.push(addStayDays(bounds.minCheckIn, i));
  }
  const label =
    value.checkIn === ""
      ? "Check-in"
      : value.checkOut === ""
        ? "Check-out"
        : "Your dates";
  return (
    <View style={styles.wrap} testID={testID}>
      <OfferingSubLabel palette={palette}>{label}</OfferingSubLabel>
      <OfferingDateStrip
        palette={palette}
        accessibilityLabel={label}
        testID={testID}
        onPress={(day: string) => {
          if (disabled) return;
          const { next, field } = stayStripTap(value, day, bounds);
          onChange(next, field);
        }}
        tiles={days.map((day) => {
          const parsed = parseStayDate(day);
          const isEnd = day === value.checkIn || day === value.checkOut;
          const inRange =
            value.checkIn !== "" &&
            value.checkOut !== "" &&
            compareStayDates(day, value.checkIn) > 0 &&
            compareStayDates(day, value.checkOut) < 0;
          return {
            key: day,
            top:
              parsed === null
                ? ""
                : parsed.toLocaleDateString("en-GB", { weekday: "short" }),
            big: parsed === null ? day : String(parsed.getDate()),
            bottom:
              parsed === null
                ? ""
                : parsed.toLocaleDateString("en-GB", { month: "short" }),
            selected: isEnd,
            inRange,
            disabled: disabled || !stayStripDayEnabled(value, day, bounds),
            accessibilityLabel: `${formatStayDateLong(day)}${
              day === value.checkIn ? ", check-in" : day === value.checkOut ? ", check-out" : ""
            }`,
          };
        })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
});
