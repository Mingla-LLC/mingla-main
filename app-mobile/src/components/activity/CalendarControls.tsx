/**
 * Issue #4265 — the Calendar's seven-day strip (approved design:
 * Calendar.dc.html). It serves List (next 7 days) and Week (the locale week).
 * The view switch and the type filter live on the Likes header line
 * (CalendarHeaderControls). Today is always marked (orange border + "Today"); the
 * selected day is filled orange.
 */
import React, { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { glass, ANDROID_GLASS_USES_OPAQUE_FALLBACK } from "../../constants/designSystem";
import { dayVisual, type StripDay } from "./calendarAgendaModel";

const L = glass.likes;
const C = L.calendar;
const OPAQUE = ANDROID_GLASS_USES_OPAQUE_FALLBACK;

// ── Day tile (strip and week rows share the today/selected treatment) ──────

export function dayTileA11yLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  input: { isToday: boolean; longDate: string; planCount: number },
): string {
  return input.isToday
    ? t("activity:calendarTab.dayTodayA11y", { date: input.longDate, n: input.planCount })
    : t("activity:calendarTab.dayA11y", { date: input.longDate, n: input.planCount });
}

export const CalendarDayStrip = memo(function CalendarDayStrip({
  days,
  locale,
  onPick,
}: {
  days: StripDay[];
  locale: string;
  onPick: (dayKey: string) => void;
}): React.ReactElement {
  const { t } = useTranslation(["activity"]);
  const dow = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const long = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" });
  return (
    <View style={styles.strip}>
      {days.map((day) => {
        const v = dayVisual(day);
        return (
          <Pressable
            key={day.dayKey}
            onPress={() => onPick(day.dayKey)}
            style={[
              styles.tile,
              v.fill === "accent" ? styles.tileAccentFill : styles.tileQuietFill,
              v.border === "accent" ? styles.tileAccentBorder : styles.tileQuietBorder,
              day.isPast && !day.isSelected && styles.tilePast,
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: day.isSelected }}
            accessibilityLabel={dayTileA11yLabel(t, { isToday: day.isToday, longDate: long.format(day.date), planCount: day.planCount })}
          >
            <Text
              style={[styles.tileDow, v.showTodayLabel && !v.textOnAccent && styles.tileTodayLabel, v.textOnAccent && styles.textOnAccent]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {v.showTodayLabel ? t("activity:calendarTab.today") : dow.format(day.date)}
            </Text>
            <Text style={styles.tileNum} numberOfLines={1}>
              {day.date.getDate()}
            </Text>
            <View
              style={[
                styles.tileDot,
                day.planCount > 0 ? (v.textOnAccent ? styles.dotOnAccent : styles.dotAccent) : styles.dotNone,
              ]}
            />
          </Pressable>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  strip: {
    flexDirection: "row",
    gap: 6,
  },
  tile: {
    flex: 1,
    minHeight: C.dayTileHeight,
    borderRadius: C.dayTileRadius,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingHorizontal: 2,
  },
  tilePast: {
    opacity: 0.45,
  },
  tileQuietFill: {
    backgroundColor: OPAQUE ? C.dayTileFillOpaque : C.dayTileFill,
  },
  tileAccentFill: {
    backgroundColor: L.accent,
  },
  tileQuietBorder: {
    borderWidth: 1,
    borderColor: C.dayTileBorder,
  },
  tileAccentBorder: {
    borderWidth: C.todayBorderWidth,
    borderColor: L.accent,
  },
  tileDow: {
    color: C.dayLabelIdle,
    fontSize: 11,
    fontWeight: "600",
  },
  tileTodayLabel: {
    color: L.accent,
    fontWeight: "700",
  },
  textOnAccent: {
    color: "#ffffff",
  },
  tileNum: {
    color: L.textPrimary,
    fontSize: 17,
    fontWeight: "700",
  },
  tileDot: {
    width: C.dayDotSize,
    height: C.dayDotSize,
    borderRadius: 999,
  },
  dotAccent: {
    backgroundColor: L.accent,
  },
  dotOnAccent: {
    backgroundColor: "#ffffff",
  },
  dotNone: {
    backgroundColor: "transparent",
  },
});
