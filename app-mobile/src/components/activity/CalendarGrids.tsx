/**
 * Issue #4265 — the Calendar's Week and Month views (approved design:
 * Calendar.dc.html + the List · Week · Month toggle added after approval).
 *
 * Week: one row per day, the day on the left (today marked the same way as
 * the strip), that day's plans as compact chips; an empty day shows "—".
 * Month: a 7-column grid with up to three type-coloured dots (or "+n") per
 * day; today = orange ring, selected = filled orange, outside days dimmed.
 * Past days stay dimmed but tappable.
 */
import React, { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Icon } from "../ui/Icon";
import { glass, ANDROID_GLASS_USES_OPAQUE_FALLBACK } from "../../constants/designSystem";
import { addDays, dayVisual, type MonthCell, type WeekDay, type WeekStart } from "./calendarAgendaModel";
import type { CalendarRow } from "./CalendarAgendaRow";
import { dayTileA11yLabel } from "./CalendarControls";

const L = glass.likes;
const C = L.calendar;
const OPAQUE = ANDROID_GLASS_USES_OPAQUE_FALLBACK;

function GridHeader({
  title,
  prevLabel,
  nextLabel,
  onPrev,
  onNext,
}: {
  title: string;
  prevLabel: string;
  nextLabel: string;
  onPrev: () => void;
  onNext: () => void;
}): React.ReactElement {
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle} accessibilityRole="header" numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.arrows}>
        <Pressable onPress={onPrev} style={styles.arrow} accessibilityRole="button" accessibilityLabel={prevLabel}>
          <Icon name="chevron-back" size={20} color={L.textPrimary} />
        </Pressable>
        <Pressable onPress={onNext} style={styles.arrow} accessibilityRole="button" accessibilityLabel={nextLabel}>
          <Icon name="chevron-forward" size={20} color={L.textPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

/** "3 – 9 Nov" in the viewer's locale. */
export function formatWeekRange(locale: string, first: Date, last: Date): string {
  const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
  const ranged = fmt as Intl.DateTimeFormat & { formatRange?: (a: Date, b: Date) => string };
  if (typeof ranged.formatRange === "function") {
    try {
      return ranged.formatRange(first, last);
    } catch {
      // Older Intl builds: fall through to the joined form.
    }
  }
  return `${fmt.format(first)} – ${fmt.format(last)}`;
}

// ── Week ────────────────────────────────────────────────────────────────────

export const CalendarWeekView = memo(function CalendarWeekView({
  days,
  locale,
  timeLabel,
  onPrev,
  onNext,
  onOpenRow,
}: {
  days: WeekDay<CalendarRow>[];
  locale: string;
  timeLabel: (row: CalendarRow) => string;
  onPrev: () => void;
  onNext: () => void;
  onOpenRow: (row: CalendarRow) => void;
}): React.ReactElement {
  const { t } = useTranslation(["activity"]);
  const dow = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const long = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" });
  const first = days[0]?.date ?? new Date();
  const last = days[days.length - 1]?.date ?? addDays(first, 6);
  return (
    <View>
      <GridHeader
        title={formatWeekRange(locale, first, last)}
        prevLabel={t("activity:calendarTab.weekPrev")}
        nextLabel={t("activity:calendarTab.weekNext")}
        onPrev={onPrev}
        onNext={onNext}
      />
      {days.map((day) => {
        const v = dayVisual({ isToday: day.isToday, isSelected: false });
        return (
          <View key={day.dayKey} style={[styles.weekRow, day.isPast && styles.pastDim]}>
            <View
              style={[styles.weekDay, v.border === "accent" ? styles.weekDayToday : styles.weekDayQuiet]}
              accessible
              accessibilityLabel={dayTileA11yLabel(t, { isToday: day.isToday, longDate: long.format(day.date), planCount: day.rows.length })}
            >
              <Text style={[styles.weekDow, v.showTodayLabel && styles.todayText]} numberOfLines={1} adjustsFontSizeToFit>
                {v.showTodayLabel ? t("activity:calendarTab.today") : dow.format(day.date)}
              </Text>
              <Text style={styles.weekNum}>{day.date.getDate()}</Text>
            </View>
            <View style={styles.weekChips}>
              {day.rows.length === 0 ? (
                <Text style={styles.weekEmpty} accessibilityLabel={t("activity:calendarTab.noPlans")}>
                  —
                </Text>
              ) : (
                day.rows.map((row) => {
                  const tone = C.tag[row.tag];
                  const time = timeLabel(row);
                  return (
                    <Pressable
                      key={row.key}
                      onPress={() => onOpenRow(row)}
                      style={[styles.weekChip, { backgroundColor: OPAQUE ? tone.bgOpaque : tone.bg }]}
                      accessibilityRole="button"
                      accessibilityLabel={[time, row.title].filter(Boolean).join(", ")}
                    >
                      {time ? <Text style={[styles.weekChipTime, { color: tone.fg }]}>{time}</Text> : null}
                      <Text style={styles.weekChipTitle} numberOfLines={1}>
                        {row.title}
                      </Text>
                    </Pressable>
                  );
                })
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
});

// ── Month ───────────────────────────────────────────────────────────────────

export const CalendarMonthView = memo(function CalendarMonthView({
  cells,
  year,
  monthIndex,
  weekStart,
  locale,
  onPrev,
  onNext,
  onPick,
}: {
  cells: MonthCell[];
  year: number;
  monthIndex: number;
  weekStart: WeekStart;
  locale: string;
  onPrev: () => void;
  onNext: () => void;
  onPick: (dayKey: string) => void;
}): React.ReactElement {
  const { t } = useTranslation(["activity"]);
  const title = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(year, monthIndex, 1));
  const narrow = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
  const long = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" });
  // 4 Jan 2026 is a Sunday: offset from it to get each weekday's name.
  const headers = Array.from({ length: 7 }, (_, i) => narrow.format(new Date(2026, 0, 4 + ((weekStart + i) % 7))));
  const weeks: MonthCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return (
    <View>
      <GridHeader
        title={title}
        prevLabel={t("activity:calendarTab.monthPrev")}
        nextLabel={t("activity:calendarTab.monthNext")}
        onPrev={onPrev}
        onNext={onNext}
      />
      <View style={styles.monthRow} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {headers.map((h, i) => (
          <Text key={`h${i}`} style={styles.monthHead}>
            {h}
          </Text>
        ))}
      </View>
      {weeks.map((week) => (
        <View key={week[0].dayKey} style={styles.monthRow}>
          {week.map((cell) => {
            const v = dayVisual(cell);
            return (
              <Pressable
                key={cell.dayKey}
                onPress={() => onPick(cell.dayKey)}
                style={[
                  styles.monthCell,
                  v.fill === "accent" && styles.monthCellSelected,
                  v.border === "accent" && styles.monthCellRing,
                  (!cell.inMonth || cell.isPast) && !cell.isSelected && styles.pastDim,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: cell.isSelected }}
                accessibilityLabel={dayTileA11yLabel(t, { isToday: cell.isToday, longDate: long.format(cell.date), planCount: cell.planCount })}
              >
                <Text style={[styles.monthNum, !cell.inMonth && styles.outsideText, v.textOnAccent && styles.onAccent]}>
                  {cell.date.getDate()}
                </Text>
                <View style={styles.dots}>
                  {cell.dots.map((tag, i) => (
                    <View
                      key={`${tag}${i}`}
                      style={[styles.dot, { backgroundColor: v.textOnAccent ? "#ffffff" : C.tag[tag].dot }]}
                    />
                  ))}
                  {cell.extra > 0 ? (
                    <Text style={[styles.extra, v.textOnAccent && styles.onAccent]}>+{cell.extra}</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  headerTitle: {
    flex: 1,
    color: L.textPrimary,
    fontSize: 16,
    fontWeight: "700",
  },
  arrows: {
    flexDirection: "row",
  },
  arrow: {
    width: C.gridArrow,
    height: C.gridArrow,
    alignItems: "center",
    justifyContent: "center",
  },
  weekRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 52,
    marginBottom: 6,
  },
  pastDim: {
    opacity: 0.45,
  },
  weekDay: {
    width: 44,
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OPAQUE ? C.dayTileFillOpaque : C.dayTileFill,
  },
  weekDayQuiet: {
    borderWidth: 1,
    borderColor: C.dayTileBorder,
  },
  weekDayToday: {
    borderWidth: C.todayBorderWidth,
    borderColor: L.accent,
  },
  weekDow: {
    color: C.dayLabelIdle,
    fontSize: 10,
    fontWeight: "600",
  },
  todayText: {
    color: L.accent,
    fontWeight: "700",
  },
  weekNum: {
    color: L.textPrimary,
    fontSize: 15,
    fontWeight: "700",
  },
  weekChips: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },
  weekEmpty: {
    color: L.textSecondary,
    fontSize: 15,
    opacity: 0.5,
  },
  weekChip: {
    minHeight: 44,
    maxWidth: "100%",
    paddingHorizontal: 10,
    borderRadius: 10,
    justifyContent: "center",
  },
  weekChipTime: {
    fontSize: 11,
    fontWeight: "700",
  },
  weekChipTitle: {
    color: L.textPrimary,
    fontSize: 13,
    fontWeight: "600",
  },
  monthRow: {
    flexDirection: "row",
    gap: 4,
    marginBottom: 4,
  },
  monthHead: {
    flex: 1,
    textAlign: "center",
    color: L.textSecondary,
    fontSize: 11,
    fontWeight: "600",
  },
  monthCell: {
    flex: 1,
    minHeight: C.monthCellMinHeight,
    borderRadius: C.monthCellRadius,
    borderWidth: C.todayBorderWidth,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  monthCellRing: {
    borderColor: L.accent,
  },
  monthCellSelected: {
    backgroundColor: L.accent,
  },
  monthNum: {
    color: L.textPrimary,
    fontSize: 13,
    fontWeight: "600",
  },
  outsideText: {
    color: C.outsideMonthText,
  },
  onAccent: {
    color: "#ffffff",
  },
  dots: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minHeight: C.monthDot + 2,
  },
  dot: {
    width: C.monthDot,
    height: C.monthDot,
    borderRadius: 999,
  },
  extra: {
    color: L.textSecondary,
    fontSize: 9,
    fontWeight: "700",
  },
});
