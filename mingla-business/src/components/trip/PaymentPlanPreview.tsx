/** Issue #4522 slice 3 — display-only preview of one traveler's v2 schedule. */

import React, { useMemo, useState } from "react";
import {
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  computeTripPlanV2Schedule,
  tripCalendarDayAt,
  type TripPaymentPlanV2,
} from "../../../../packages/offering-rendering/tripPlanV2Math";
import { withCurrencyGlyph } from "@mingla/offering-rendering/currencyGlyph";

import { color, radius, space, type } from "../../constants/designSystem";

export interface PaymentPlanPreviewProps {
  plan: TripPaymentPlanV2;
  totalAmountMinor: number;
  currency: string;
  tripStartAt: string | null;
  timeZone: string | null;
}

const DAY_MS = 86_400_000;
const PREVIEW_MIN_DAYS = 1;
const PREVIEW_MAX_DAYS = 150;
const CHIPS = [60, 38, 20] as const;

const clampLead = (value: number): number =>
  Math.max(PREVIEW_MIN_DAYS, Math.min(PREVIEW_MAX_DAYS, Math.round(value)));

/**
 * issue #4522 W-1 — the simulated booking instant. "Today" books now, as the
 * server quote does; a lead of N days books at noon in the trip zone on the
 * trip's start calendar date (its stored UTC Y-M-D, #4420) minus N. Never
 * `start - N days`: the start is UTC midnight, the previous evening west of UTC.
 */
export const previewBookedAt = (
  start: Date,
  leadDays: number,
  todayLead: number,
  timeZone: string,
  nowMs: number = Date.now(),
): Date =>
  leadDays === todayLead
    ? new Date(nowMs)
    : tripCalendarDayAt(start, leadDays, timeZone, 12);

function formatMoney(amountMinor: number, currency: string): string {
  try {
    return withCurrencyGlyph(
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency.toUpperCase(),
        maximumFractionDigits: 2,
      }).format(amountMinor / 100),
      currency,
    );
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function formatDay(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export const PaymentPlanPreview: React.FC<PaymentPlanPreviewProps> = ({
  plan,
  totalAmountMinor,
  currency,
  tripStartAt,
  timeZone,
}) => {
  const start = useMemo(() => {
    const parsed = tripStartAt === null ? Number.NaN : Date.parse(tripStartAt);
    return Number.isFinite(parsed) ? new Date(parsed) : null;
  }, [tripStartAt]);
  const todayLead = start === null
    ? 60
    : clampLead((start.getTime() - Date.now()) / DAY_MS);
  const [leadDays, setLeadDays] = useState(todayLead);
  const [trackWidth, setTrackWidth] = useState(1);
  const tz = timeZone?.trim() || "UTC";

  const schedule = useMemo(() => {
    if (start === null || totalAmountMinor < 0) return null;
    try {
      return computeTripPlanV2Schedule({
        lineNetMinor: totalAmountMinor,
        units: 1,
        plan,
        tripStartAt: start,
        timeZone: tz,
        bookedAt: previewBookedAt(start, leadDays, todayLead, tz),
      });
    } catch {
      return null;
    }
  }, [leadDays, plan, start, todayLead, totalAmountMinor, tz]);

  const chooseFromTrack = (locationX: number): void => {
    const ratio = Math.max(0, Math.min(1, locationX / Math.max(1, trackWidth)));
    setLeadDays(
      clampLead(PREVIEW_MIN_DAYS + ratio * (PREVIEW_MAX_DAYS - PREVIEW_MIN_DAYS)),
    );
  };

  return (
    <View style={styles.card} testID="trip-plan-v2-preview">
      <Text style={styles.eyebrow}>What a traveler pays</Text>
      <Text style={styles.title}>Simulate a booking on</Text>
      <View style={styles.chips}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: leadDays === todayLead }}
          onPress={() => setLeadDays(todayLead)}
          style={[styles.chip, leadDays === todayLead && styles.chipOn]}
          testID="trip-plan-preview-today"
        >
          <Text style={[styles.chipText, leadDays === todayLead && styles.chipTextOn]}>
            Today
          </Text>
        </Pressable>
        {CHIPS.map((days) => (
          <Pressable
            key={days}
            accessibilityRole="button"
            accessibilityLabel={`${days} days before`}
            accessibilityState={{ selected: leadDays === days }}
            onPress={() => setLeadDays(days)}
            style={[styles.chip, leadDays === days && styles.chipOn]}
            testID={`trip-plan-preview-${days}`}
          >
            <Text style={[styles.chipText, leadDays === days && styles.chipTextOn]}>
              {days} days before
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.sliderRow}>
        <Text style={styles.sliderValue}>{leadDays} days before departure</Text>
        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel="Simulated booking date"
          accessibilityValue={{ min: 1, max: 150, now: leadDays }}
          onLayout={(event: LayoutChangeEvent) =>
            setTrackWidth(Math.max(1, event.nativeEvent.layout.width))
          }
          onPress={(event) => chooseFromTrack(event.nativeEvent.locationX)}
          style={styles.sliderTrack}
          testID="trip-plan-preview-slider"
        >
          <View
            style={[
              styles.sliderFill,
              { width: `${((leadDays - 1) / 149) * 100}%` },
            ]}
          />
          <View
            style={[
              styles.sliderThumb,
              { left: `${((leadDays - 1) / 149) * 100}%` },
            ]}
          />
        </Pressable>
      </View>

      {start === null ? (
        <Text style={styles.notice}>Add trip dates to preview the schedule.</Text>
      ) : schedule === null ? (
        <Text style={styles.notice}>Finish the plan to preview the schedule.</Text>
      ) : schedule.availability === "full_window" ? (
        <Text style={styles.notice} testID="trip-plan-preview-full-window">
          Booking is inside the {plan.final_due_days_before_start}-day window before
          departure, so this traveler pays in full.
        </Text>
      ) : schedule.availability === "full_only" ? (
        <Text style={styles.notice} testID="trip-plan-preview-full-only">
          Only {paymentsPhrase(Math.floor(leadDays / 7))}{" "}
          {Math.floor(leadDays / 7) === 1 ? "fits" : "fit"} before the final due date,
          and automatic adjustment is off. This traveler can only pay in full.
        </Text>
      ) : schedule.availability === "full_deposit" ? (
        <Text style={styles.notice}>The deposit covers the full price.</Text>
      ) : (
        <View style={styles.rows}>
          <View style={styles.moneyRow}>
            <Text style={styles.rowLabel}>At booking</Text>
            <Text style={styles.rowAmount}>
              {formatMoney(schedule.deposit_minor, currency)}
            </Text>
          </View>
          {schedule.rows.map((row, index) => (
            <View key={`${row.due_at}-${index}`} style={styles.moneyRow}>
              <Text style={styles.rowLabel}>{formatDay(row.due_at, tz)}</Text>
              <Text style={styles.rowAmount}>
                {formatMoney(row.amount_minor, currency)}
              </Text>
            </View>
          ))}
          {schedule.count_given < schedule.count_offered ? (
            <Text style={styles.notice} testID="trip-plan-preview-adjusted">
              Late booking: {paymentsPhrase(schedule.count_given)} instead of{" "}
              {schedule.count_offered}, still at least 7 days apart.
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
};

/** #4522 S-17 — "1 payment", "3 payments" (spec "{n} payment(s)"). */
export const paymentsPhrase = (count: number): string =>
  `${count} ${count === 1 ? "payment" : "payments"}`;

const styles = StyleSheet.create({
  card: {
    gap: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  eyebrow: {
    fontSize: type.caption.fontSize,
    fontWeight: "700",
    color: color.accent,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  title: {
    fontSize: type.body.fontSize,
    fontWeight: "700",
    color: color.text1,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[1] },
  chip: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: space[3],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.lineStrong,
    backgroundColor: color.fill.tableHead,
  },
  chipOn: { borderColor: color.accent, backgroundColor: color.accentTint },
  chipText: { fontSize: type.caption.fontSize, color: color.text2 },
  chipTextOn: { color: color.text1, fontWeight: "700" },
  sliderRow: { gap: space[2] },
  sliderValue: { fontSize: type.caption.fontSize, color: color.text2 },
  sliderTrack: {
    height: 28,
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: color.fill.step,
    overflow: "visible",
  },
  sliderFill: {
    position: "absolute",
    left: 0,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: color.accent,
  },
  sliderThumb: {
    position: "absolute",
    width: 18,
    height: 18,
    marginLeft: -9,
    borderRadius: radius.full,
    backgroundColor: color.paper,
    borderWidth: 4,
    borderColor: color.accent,
  },
  rows: { gap: space[2] },
  moneyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: space[3],
  },
  rowLabel: { flex: 1, fontSize: type.small.fontSize, color: color.text2 },
  rowAmount: { fontSize: type.small.fontSize, fontWeight: "700", color: color.text1 },
  notice: { fontSize: type.caption.fontSize, lineHeight: 18, color: color.text2 },
});

export default PaymentPlanPreview;
