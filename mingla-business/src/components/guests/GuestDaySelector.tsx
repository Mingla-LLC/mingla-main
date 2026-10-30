/**
 * issue #3281 PR8 / S24 — Day selector for guest rosters with >7 dates.
 * Month-grouped vertical list (occurrence-local month, not UTC slice) so the
 * default upcoming day stays on-screen. Loaded on intent from the guests
 * route to keep the web __common boot chunk under the shared movement ceiling.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { occurrenceLocalDay } from "@mingla/offering-rendering/eventDateSchedule";

import {
  accent,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import type { PublicEventOccurrence } from "../../services/publicEventOccurrencesService";

export interface GuestDaySelectorProps {
  occurrences: readonly PublicEventOccurrence[];
  dayLabels: ReadonlyMap<string, string>;
  dayHeadCounts: ReadonlyMap<string, number>;
  dayFilter: string | null;
  onSelectDay: (dayId: string | null) => void;
  allAccessibilityLabel: string;
  headcountLabelForCount: (count: number) => string;
}

const monthIndexForDay = (
  months: ReadonlyArray<readonly [string, PublicEventOccurrence[]]>,
  dayId: string | null,
): number => {
  if (dayId === null) return 0;
  const idx = months.findIndex(([, dates]) =>
    dates.some((o) => o.id === dayId),
  );
  return idx >= 0 ? idx : 0;
};

export const GuestDaySelector: React.FC<GuestDaySelectorProps> = ({
  occurrences,
  dayLabels,
  dayHeadCounts,
  dayFilter,
  onSelectDay,
  allAccessibilityLabel,
  headcountLabelForCount,
}) => {
  const months = useMemo(() => {
    const map = new Map<string, PublicEventOccurrence[]>();
    for (const occ of occurrences) {
      if (!dayLabels.has(occ.id)) continue;
      const local = occurrenceLocalDay(occ.startAt, occ.timezone);
      const key = local !== null ? local.slice(0, 7) : "0000-01";
      const list = map.get(key) ?? [];
      list.push(occ);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [occurrences, dayLabels]);

  const [monthIndex, setMonthIndex] = useState(() =>
    monthIndexForDay(months, dayFilter),
  );
  // When the route seeds upcoming (null → dayId) or the selected day changes,
  // jump to that month. Arrow browsing does not change dayFilter, so it stays.
  const prevDayFilterRef = useRef(dayFilter);
  useEffect(() => {
    if (dayFilter !== null && dayFilter !== prevDayFilterRef.current) {
      setMonthIndex(monthIndexForDay(months, dayFilter));
    }
    prevDayFilterRef.current = dayFilter;
  }, [dayFilter, months]);

  const safeIndex = Math.min(monthIndex, Math.max(0, months.length - 1));
  const visible = months[safeIndex]?.[1] ?? [];
  const monthKey = months[safeIndex]?.[0] ?? "";

  return (
    <View style={styles.host} testID="issue-3281-day-selector">
      <Text style={styles.label}>Day</Text>
      <Pressable
        onPress={() => onSelectDay(null)}
        accessibilityRole="button"
        accessibilityState={{ selected: dayFilter === null }}
        accessibilityLabel={allAccessibilityLabel}
        testID="issue-2160-day-chip-all"
        style={[styles.chip, dayFilter === null ? styles.chipActive : null]}
      >
        <Text
          style={[
            styles.chipLabel,
            dayFilter === null ? styles.chipLabelActive : null,
          ]}
        >
          All
        </Text>
      </Pressable>
      {months.length > 1 ? (
        <View style={styles.monthRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            disabled={safeIndex <= 0}
            onPress={() => setMonthIndex((i) => Math.max(0, i - 1))}
            style={styles.monthHit}
          >
            <Text
              style={{
                color: safeIndex <= 0 ? "rgba(255,255,255,0.35)" : accent.warm,
              }}
            >
              ‹
            </Text>
          </Pressable>
          <Text style={styles.monthKey}>{monthKey}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next month"
            disabled={safeIndex >= months.length - 1}
            onPress={() =>
              setMonthIndex((i) => Math.min(months.length - 1, i + 1))
            }
            style={styles.monthHit}
          >
            <Text
              style={{
                color:
                  safeIndex >= months.length - 1
                    ? "rgba(255,255,255,0.35)"
                    : accent.warm,
              }}
            >
              ›
            </Text>
          </Pressable>
        </View>
      ) : monthKey.length > 0 ? (
        <Text style={styles.monthKeySolo}>{monthKey}</Text>
      ) : null}
      <View style={styles.list}>
        {visible.map((occ) => {
          const label = dayLabels.get(occ.id);
          if (label === undefined) return null;
          const active = dayFilter === occ.id;
          const count = dayHeadCounts.get(occ.id) ?? 0;
          return (
            <Pressable
              key={occ.id}
              onPress={() => onSelectDay(active ? null : occ.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${label} — ${count} ${headcountLabelForCount(count)}`}
              testID={`issue-2160-day-chip-${occ.id}`}
              style={[styles.chip, active ? styles.chipActive : null]}
            >
              <Text
                style={[
                  styles.chipLabel,
                  active ? styles.chipLabelActive : null,
                ]}
              >
                {label} · {count}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flexGrow: 0,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: textTokens.secondary,
    marginBottom: 4,
  },
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  monthHit: { paddingHorizontal: 8, paddingVertical: 4 },
  monthKey: {
    fontSize: 12,
    color: textTokens.secondary,
    fontWeight: "700",
  },
  monthKeySolo: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginBottom: 2,
  },
  list: { gap: spacing.xs },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.16)",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    alignSelf: "flex-start",
  },
  chipActive: {
    borderColor: accent.warm,
    backgroundColor: "rgba(235, 120, 37, 0.16)",
  },
  chipLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "rgba(255, 255, 255, 0.72)",
  },
  chipLabelActive: { color: "rgba(255, 255, 255, 0.98)" },
});
