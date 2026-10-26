/**
 * #3872 — shoot-dates range picker (approved M-daterange): a month grid,
 * anchored to the event date, with "The event day / Week before / Custom".
 */
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Sheet } from "../ui/Sheet";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Chip, Muted, SheetBody } from "./ProgramKit";
import {
  accent,
  radius,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import {
  addDays,
  parseProgramDate,
  shortDate,
} from "../../utils/creatorProgramFormat";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAY_HEADERS = ["M", "T", "W", "T", "F", "S", "S"];

import { monthGrid, nextRange, type DayRange } from "./dateRangeGrid";

export type { DayRange };

export function DateRangeSheet({
  visible,
  onClose,
  value,
  onChange,
  anchorDay,
  minDay,
}: {
  visible: boolean;
  onClose: () => void;
  value: DayRange | null;
  onChange: (range: DayRange) => void;
  /** The event's date, when the listing has one. */
  anchorDay: string | null;
  /** Earliest pickable day (today). */
  minDay: string;
}): React.ReactElement {
  const initial =
    parseProgramDate(value?.start ?? anchorDay ?? minDay) ?? new Date();
  const [cursor, setCursor] = useState({
    year: initial.getFullYear(),
    month: initial.getMonth(),
  });
  const [draft, setDraft] = useState<DayRange | null>(value);
  const [picking, setPicking] = useState<"start" | "end">("start");

  useEffect(() => {
    if (!visible) return;
    setDraft(value);
    setPicking("start");
    const focus =
      parseProgramDate(value?.start ?? anchorDay ?? minDay) ?? new Date();
    setCursor({ year: focus.getFullYear(), month: focus.getMonth() });
  }, [visible, value, anchorDay, minDay]);

  const cells = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const anchorUsable = anchorDay !== null && anchorDay >= minDay;
  const weekBefore: DayRange | null = anchorDay
    ? {
        start:
          addDays(anchorDay, -7) < minDay ? minDay : addDays(anchorDay, -7),
        end: addDays(anchorDay, -1) < minDay ? minDay : addDays(anchorDay, -1),
      }
    : null;
  const preset =
    draft && anchorDay && draft.start === anchorDay && draft.end === anchorDay
      ? "event"
      : draft &&
          weekBefore &&
          draft.start === weekBefore.start &&
          draft.end === weekBefore.end
        ? "week"
        : "custom";

  const move = (delta: number) => {
    const next = new Date(cursor.year, cursor.month + delta, 1);
    setCursor({ year: next.getFullYear(), month: next.getMonth() });
  };

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="full">
      <SheetBody>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Shoot dates</Text>
          <Button
            size="sm"
            label="Done"
            disabled={!draft}
            onPress={() => {
              if (draft) onChange(draft);
              onClose();
            }}
          />
        </View>
        {anchorDay ? (
          <Muted>{`Your event is ${shortDate(anchorDay)}. Shooting at the event? Pick that day.`}</Muted>
        ) : (
          <Muted>
            Pick the days a creator can film. Tap a first and last day.
          </Muted>
        )}
        {anchorDay ? (
          <View style={styles.chips}>
            {anchorUsable ? (
              <Chip
                label="The event day"
                selected={preset === "event"}
                onPress={() => setDraft({ start: anchorDay, end: anchorDay })}
              />
            ) : null}
            {weekBefore && weekBefore.end >= minDay ? (
              <Chip
                label="Week before"
                selected={preset === "week"}
                onPress={() => setDraft(weekBefore)}
              />
            ) : null}
            <Chip
              label="Custom"
              selected={preset === "custom"}
              onPress={() => setPicking("start")}
            />
          </View>
        ) : null}
        <View style={styles.monthRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            onPress={() => move(-1)}
            hitSlop={8}
            style={styles.arrow}
          >
            <Icon name="chevL" size={18} color={textTokens.primary} />
          </Pressable>
          <Text
            style={styles.month}
          >{`${MONTH_NAMES[cursor.month]} ${cursor.year}`}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next month"
            onPress={() => move(1)}
            hitSlop={8}
            style={styles.arrow}
          >
            <Icon name="chevR" size={18} color={textTokens.primary} />
          </Pressable>
        </View>
        <View style={styles.grid}>
          {DAY_HEADERS.map((label, index) => (
            <View key={`h${index}`} style={styles.cell}>
              <Text style={styles.dayHeader}>{label}</Text>
            </View>
          ))}
          {cells.map((day, index) => {
            if (!day) return <View key={`p${index}`} style={styles.cell} />;
            const disabled = day < minDay;
            const inRange =
              draft !== null && day >= draft.start && day <= draft.end;
            const isEdge =
              draft !== null && (day === draft.start || day === draft.end);
            const isAnchor = day === anchorDay;
            return (
              <Pressable
                key={day}
                disabled={disabled}
                onPress={() => {
                  const next = nextRange(draft, picking, day);
                  setDraft(next.range);
                  setPicking(next.picking);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${shortDate(day)}${isAnchor ? ", event day" : ""}`}
                accessibilityState={{ selected: inRange, disabled }}
                style={styles.cell}
              >
                <View
                  style={[
                    styles.day,
                    inRange && styles.dayInRange,
                    isEdge && styles.dayEdge,
                    isAnchor && !isEdge && styles.dayAnchor,
                  ]}
                >
                  <Text
                    style={[
                      styles.dayText,
                      disabled && styles.dayDisabled,
                      isEdge && styles.dayEdgeText,
                    ]}
                  >
                    {Number(day.slice(8))}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        {draft ? (
          <Muted>
            {draft.start === draft.end
              ? `Filming on ${shortDate(draft.start)}`
              : `Filming between ${shortDate(draft.start)} and ${shortDate(draft.end)}`}
          </Muted>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: { color: textTokens.primary, fontSize: 20, fontWeight: "800" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  arrow: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  month: { color: textTokens.primary, fontSize: 16, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 2,
  },
  dayHeader: { color: textTokens.tertiary, fontSize: 12, fontWeight: "700" },
  day: {
    flex: 1,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
  },
  dayInRange: { backgroundColor: accent.tint },
  dayEdge: { backgroundColor: accent.warm },
  dayAnchor: { borderWidth: 1, borderColor: accent.border },
  dayText: { color: textTokens.primary, fontSize: 15, fontWeight: "600" },
  dayEdgeText: { color: textTokens.inverse },
  dayDisabled: { color: textTokens.quaternary },
});
