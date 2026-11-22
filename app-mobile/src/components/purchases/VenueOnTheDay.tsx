/**
 * #4490 W7 (d) — "On the day" on a venue pass (Entry, Group, By the hour and a
 * confirmed Private hire): the weather at the booked time, today's drive
 * estimate and when to leave. No chips (the time is fixed) and never a crowd
 * (you have already booked). A booking more than the forecast's reach out
 * says from which day the weather shows. Every row hides when its source is
 * empty; with nothing to say the whole block is absent.
 */
import React, { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { fontWeights, radius, spacing, typography } from "../../constants/designSystem";
import { useLocalePreferences } from "../../hooks/useLocalePreferences";
import { useUserLocation } from "../../hooks/useUserLocation";
import { useVenueForecast } from "../../hooks/useVenueForecast";
import { useAppStore } from "../../store/appStore";
import { estimateTravelMinutes, haversineKm } from "../../utils/mutateCuratedCard";
import { formatTemperature } from "../utils/formatters";
import { formatClockMinute } from "../deckCard/useDeckFactLabels";
import {
  onTheDayFor,
  wallDayDiff,
  wallWeekday,
  zoneClock,
  type LeaveBy,
} from "../expandedCard/whenYoudGoModel";
import { PURCHASE_SHEET_COLORS as C } from "./purchaseSheetTheme";
import { venueBookingSpan, type VenueBooking } from "./venuePurchaseModel";

export function VenueOnTheDay({ booking, now: nowProp }: { booking: VenueBooking; now?: Date }): React.ReactElement | null {
  const { t, i18n } = useTranslation(["cards"]);
  const { measurementSystem } = useLocalePreferences();
  const userId = useAppStore((s) => s.user?.id);
  const forecast = useVenueForecast(booking.venue.lat, booking.venue.lng);
  const viewer = useUserLocation(userId, "solo").data ?? null;
  const [now] = useState<Date>(() => nowProp ?? new Date());
  const startsAtIso = venueBookingSpan(booking).startsAt;
  const resolve = useMemo(() => zoneClock(booking.venue.timezone), [booking.venue.timezone]);

  const startsAt = startsAtIso !== null && startsAtIso !== "" ? new Date(startsAtIso) : null;
  const { lat, lng } = booking.venue;
  const driveMinutes =
    viewer !== null && typeof lat === "number" && typeof lng === "number"
      ? estimateTravelMinutes(haversineKm(viewer.lat, viewer.lng, lat, lng), "driving")
      : null;
  const facts = onTheDayFor({
    startsAt,
    now,
    resolve,
    hourly: forecast.data?.hourlyForecast ?? null,
    weatherUtcOffsetSeconds: forecast.data?.utcOffsetSeconds ?? null,
    driveMinutes,
  });
  if (facts === null) return null;

  const language = i18n?.language ?? "en";
  const clockOf = (at: Date): string => {
    const w = resolve(at);
    return w === null ? "" : formatClockMinute(w.hour * 60 + w.minute, language);
  };
  const leaveValue = (l: LeaveBy): { label: string; value: string } => {
    if (l.kind === "now") return { label: t("cards:sheet.leave_now"), value: "" };
    const start = startsAt === null ? null : resolve(startsAt);
    const at = resolve(l.at);
    const otherDay = start !== null && at !== null && wallDayDiff(at, start) !== 0;
    return { label: t("cards:sheet.leave_by"), value: otherDay && at !== null ? `${wallWeekday(at)} ${clockOf(l.at)}` : clockOf(l.at) };
  };

  const weather = facts.weather;
  const rain = weather && typeof weather.precipitationProbability === "number" && weather.precipitationProbability >= 30
    ? ` · ${t("cards:sheet.rain_chance", { pct: Math.round(weather.precipitationProbability) })}`
    : "";
  const leave = facts.leaveBy === null ? null : leaveValue(facts.leaveBy);
  const note = facts.forecastFrom !== null ? t("cards:pass.forecast_from", { day: facts.forecastFrom }) : null;

  return (
    <View testID="venue-on-the-day">
      <Text style={styles.heading} accessibilityRole="header">
        {t("cards:pass.on_the_day")}
      </Text>
      {weather !== null || facts.driveMinutes !== null ? (
        <View style={styles.tiles}>
          {weather !== null ? (
            <View style={styles.tile} testID="venue-on-the-day-weather">
              <Text style={styles.tileLabel}>{t("cards:sheet.weather")}</Text>
              <Text style={styles.tileValue}>{`${formatTemperature(weather.temperature, measurementSystem)}${rain}`}</Text>
            </View>
          ) : null}
          {facts.driveMinutes !== null ? (
            <View style={styles.tile} testID="venue-on-the-day-drive">
              <Text style={styles.tileLabel}>{t("cards:sheet.drive")}</Text>
              <Text style={styles.tileValue}>{t("cards:sheet.drive_estimate", { time: `${facts.driveMinutes} min` })}</Text>
            </View>
          ) : null}
          {leave !== null ? (
            <View style={styles.tile} testID="venue-on-the-day-leave">
              <Text style={styles.tileLabel}>{leave.value === "" ? leave.label : t("cards:sheet.leave_by")}</Text>
              {leave.value !== "" ? <Text style={styles.tileValue}>{leave.value}</Text> : null}
            </View>
          ) : null}
        </View>
      ) : null}
      {note !== null ? (
        <Text style={styles.note} testID="venue-on-the-day-forecast-from">
          {note}
        </Text>
      ) : null}
      {facts.driveMinutes !== null ? <Text style={styles.note}>{t("cards:sheet.drive_note")}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { color: C.text, ...typography.lg, fontWeight: fontWeights.bold, marginTop: spacing.lg },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  tile: {
    flexGrow: 1,
    flexBasis: "30%",
    backgroundColor: C.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: C.border,
    padding: spacing.sm,
  },
  tileLabel: { color: C.textMeta, ...typography.xs },
  tileValue: { color: C.text, ...typography.sm, fontWeight: fontWeights.semibold, marginTop: spacing.xs },
  note: { color: C.textSecondary, ...typography.xs, marginTop: spacing.sm },
});
