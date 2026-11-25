/**
 * #4490 — pick days of the week (0 = Monday … 6 = Sunday). Extracted from the
 * bulk day chips in BrandHoursEditor: 34pt chips with hitSlop to a 44pt target,
 * each a labelled checkbox.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTouchFloor } from "../../hooks/useTouchFloor";

import { color, radius, space, type } from "../../constants/designSystem";
import { WEEKDAY_NAMES, WEEKDAY_SHORT, toggleWeekday, weekdaysSummary } from "./fieldModels";

export interface WeekdayChipsProps {
  value: readonly number[];
  onChange: (next: number[]) => void;
  label?: string;
  disabled?: boolean;
  /** Show "Mon to Thu" under the chips. */
  showSummary?: boolean;
  testID?: string;
  /** A test id per chip (default `${testID}-${day}`). */
  dayTestID?: (day: number) => string;
  /** Draw each chip at the full 44 target (sheets whose contract pins it). */
  fullTarget?: boolean;
}

export function WeekdayChips({
  value,
  onChange,
  label,
  disabled = false,
  showSummary = true,
  testID,
  dayTestID,
  fullTarget = false,
}: WeekdayChipsProps): React.ReactElement {
  // #4490: hitSlop does nothing in a phone browser, so the 34 chip is drawn 44 there.
  const touchFloor = useTouchFloor();
  return (
    <View style={styles.host} testID={testID}>
      {label !== undefined ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.row}>
        {WEEKDAY_SHORT.map((short, day) => {
          const on = value.includes(day);
          return (
            <Pressable
              key={short}
              onPress={() => onChange(toggleWeekday(value, day))}
              disabled={disabled}
              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on, disabled }}
              aria-checked={on}
              accessibilityLabel={WEEKDAY_NAMES[day]}
              style={[styles.chip, touchFloor > 0 ? { height: touchFloor, minWidth: touchFloor } : null, fullTarget && styles.chipFull, on && styles.chipOn, disabled && styles.disabled]}
              testID={dayTestID !== undefined ? dayTestID(day) : testID !== undefined ? `${testID}-${day}` : undefined}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{short.slice(0, 2)}</Text>
            </Pressable>
          );
        })}
      </View>
      {showSummary ? <Text style={styles.summary}>{weekdaysSummary(value)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: space[1] },
  label: { ...type.small, color: color.text2 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space[1] },
  chipFull: { minHeight: 44, height: 44, minWidth: 44 },
  chip: {
    minWidth: 40,
    height: 34,
    paddingHorizontal: space[2],
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  chipOn: { borderColor: color.accent, backgroundColor: color.accentLine },
  chipText: { ...type.small, fontWeight: "600", color: color.text2 },
  chipTextOn: { color: color.text1 },
  disabled: { opacity: 0.5 },
  summary: { ...type.caption, color: color.text3 },
});
