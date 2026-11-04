/**
 * Issue #4265 — the Calendar's Week and Month views (approved design:
 * Calendar.dc.html + the List · Week · Month toggle added after approval).
 *
 * Week: just its title and arrows here — the days are the List strip and its
 * plans are the List rows (CalendarTab).
 * Month: a 7-column grid with up to three type-coloured dots (or "+n") per
 * day; today = orange ring, selected = filled orange, outside days dimmed.
 * Past days stay dimmed but tappable.
 */
import React, { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Icon } from "../ui/Icon";
import { glass } from "../../constants/designSystem";
import { dayVisual, type MonthCell, type WeekStart } from "./calendarAgendaModel";
import { dayTileA11yLabel } from "./CalendarControls";

const L = glass.likes;
const C = L.calendar;

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

export const CalendarWeekHeader = memo(function CalendarWeekHeader({
  first,
  last,
  locale,
  onPrev,
  onNext,
}: {
  first: Date;
  last: Date;
  locale: string;
  onPrev: () => void;
  onNext: () => void;
}): React.ReactElement {
  const { t } = useTranslation(["activity"]);
  return (
    <GridHeader
      title={formatWeekRange(locale, first, last)}
      prevLabel={t("activity:calendarTab.weekPrev")}
      nextLabel={t("activity:calendarTab.weekNext")}
      onPrev={onPrev}
      onNext={onNext}
    />
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
  pastDim: {
    opacity: 0.45,
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
