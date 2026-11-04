/**
 * Issue #4265 — the Calendar header controls (approved design:
 * Calendar.dc.html): the List · Week · Month toggle, the seven-day strip and
 * the type chips. The day strip serves List (next 7 days) and Week (the
 * locale week). Today is always marked (orange border + "Today"); the
 * selected day is filled orange.
 */
import React, { memo } from "react";
import { Pressable, ScrollView as HorizontalScroll, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { glass, ANDROID_GLASS_USES_OPAQUE_FALLBACK } from "../../constants/designSystem";
import {
  AGENDA_TYPE_FILTERS,
  CALENDAR_VIEWS,
  dayVisual,
  type AgendaTypeFilter,
  type CalendarView,
  type StripDay,
} from "./calendarAgendaModel";

const L = glass.likes;
const C = L.calendar;
const OPAQUE = ANDROID_GLASS_USES_OPAQUE_FALLBACK;

const VIEW_KEY: Record<CalendarView, string> = {
  list: "activity:calendarTab.viewList",
  week: "activity:calendarTab.viewWeek",
  month: "activity:calendarTab.viewMonth",
};

const TYPE_KEY: Record<AgendaTypeFilter, string> = {
  all: "activity:calendarTab.typeAll",
  tickets: "activity:calendarTab.typeTickets",
  reservations: "activity:calendarTab.typeReservations",
  plans: "activity:calendarTab.typePlans",
  stays: "activity:calendarTab.typeStays",
};

// ── View toggle ─────────────────────────────────────────────────────────────

export const CalendarViewToggle = memo(function CalendarViewToggle({
  view,
  onChange,
}: {
  view: CalendarView;
  onChange: (view: CalendarView) => void;
}): React.ReactElement {
  const { t } = useTranslation(["activity"]);
  return (
    <View style={styles.toggleTrack} accessibilityRole="tablist" accessibilityLabel={t("activity:calendarTab.viewToggleLabel")}>
      {CALENDAR_VIEWS.map((id) => {
        const on = id === view;
        return (
          <Pressable
            key={id}
            onPress={() => onChange(id)}
            style={[styles.togglePill, on && styles.togglePillOn]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            hitSlop={{ top: 6, bottom: 6 }}
          >
            <Text style={[styles.toggleText, on && styles.toggleTextOn]}>{t(VIEW_KEY[id])}</Text>
          </Pressable>
        );
      })}
    </View>
  );
});

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

// ── Type chips ──────────────────────────────────────────────────────────────

export const CalendarTypeChips = memo(function CalendarTypeChips({
  value,
  onChange,
}: {
  value: AgendaTypeFilter;
  onChange: (value: AgendaTypeFilter) => void;
}): React.ReactElement {
  const { t } = useTranslation(["activity"]);
  return (
    <HorizontalScroll
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chips}
      style={styles.chipsScroll}
      accessibilityLabel={t("activity:calendarTab.typeFilterLabel")}
    >
      {AGENDA_TYPE_FILTERS.map((id) => {
        const on = id === value;
        return (
          <Pressable
            key={id}
            onPress={() => onChange(id)}
            style={[styles.chip, on ? styles.chipOn : styles.chipIdle]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            hitSlop={{ top: 5, bottom: 5 }}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{t(TYPE_KEY[id])}</Text>
          </Pressable>
        );
      })}
    </HorizontalScroll>
  );
});

const styles = StyleSheet.create({
  toggleTrack: {
    flexDirection: "row",
    alignSelf: "flex-start",
    gap: 6,
    padding: C.togglePadding,
    borderRadius: 999,
    backgroundColor: OPAQUE ? C.toggleTrackOpaque : C.toggleTrack,
  },
  togglePill: {
    minHeight: C.toggleHeight,
    paddingHorizontal: 16,
    borderRadius: 999,
    justifyContent: "center",
    alignItems: "center",
  },
  togglePillOn: {
    backgroundColor: C.toggleSelectedBg,
  },
  toggleText: {
    color: C.toggleIdleText,
    fontSize: 14,
    fontWeight: "500",
  },
  toggleTextOn: {
    color: C.toggleSelectedText,
    fontWeight: "600",
  },
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
  chipsScroll: {
    marginHorizontal: -L.grid.sidePadding,
    flexGrow: 0,
  },
  chips: {
    gap: 8,
    paddingHorizontal: L.grid.sidePadding,
  },
  chip: {
    minHeight: C.chipHeight,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
  },
  chipIdle: {
    backgroundColor: OPAQUE ? C.chipIdleFillOpaque : C.chipIdleFill,
    borderColor: C.chipBorder,
  },
  chipOn: {
    backgroundColor: "#ffffff",
    borderColor: "#ffffff",
  },
  chipText: {
    color: L.textPrimary,
    fontSize: 13,
    fontWeight: "600",
  },
  chipTextOn: {
    color: C.toggleSelectedText,
  },
});
