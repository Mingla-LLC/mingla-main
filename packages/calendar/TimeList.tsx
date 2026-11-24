import React, { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import type { CalendarStyles } from "./styles";
import type { WallTime } from "./types";

export interface TimeListProps {
  value: WallTime | "";
  onChange: (time: WallTime) => void;
  stepMinutes?: 5 | 15 | 30;
  min?: WallTime;
  max?: WallTime;
  styles: CalendarStyles;
  testIDPrefix?: string;
  /** Beside the grid (wide datetime): as tall as the grid. */
  tall?: boolean;
}

const pad = (n: number): string => String(n).padStart(2, "0");

export function timeSlots(step: number, min?: WallTime, max?: WallTime): WallTime[] {
  const slots: WallTime[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += step) {
    const slot = `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
    if (min !== undefined && slot < min) continue;
    if (max !== undefined && slot > max) continue;
    slots.push(slot);
  }
  return slots;
}

/** Scrollable HH:mm slots. Disabled slots are simply not offered. */
export function TimeList({ value, onChange, stepMinutes = 15, min, max, styles, testIDPrefix = "time", tall = false }: TimeListProps): React.ReactElement {
  const slots = useMemo(() => timeSlots(stepMinutes, min, max), [stepMinutes, min, max]);
  return (
    <ScrollView style={tall ? styles.timeListTall : styles.timeList} nestedScrollEnabled testID={`${testIDPrefix}-list`}>
      <View style={styles.timeWrap}>
        {slots.map((slot) => {
          const selected = slot === value;
          return (
            <Pressable
              key={slot}
              accessibilityRole="button"
              accessibilityLabel={slot}
              accessibilityState={{ selected }}
              onPress={() => onChange(slot)}
              testID={`${testIDPrefix}-${slot}`}
              style={[styles.timeItem, selected && styles.cellSelected]}
            >
              <Text style={[styles.cellText, selected && styles.cellTextSelected]}>{slot}</Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}
