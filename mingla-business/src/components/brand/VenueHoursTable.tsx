/**
 * Ve4 — weekly hours table for verified public venue pages.
 * Times are shown in venue-local wall-clock (stored on brand_hours rows).
 */

import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { BrandHourEntry } from "../../types/brand";

const WEEKDAY_LABELS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

const formatHourRange = (entry: BrandHourEntry): string => {
  if (entry.isClosed) return "Closed";
  if (
    entry.openTime !== null &&
    entry.openTime.length > 0 &&
    entry.closeTime !== null &&
    entry.closeTime.length > 0
  ) {
    return `${entry.openTime} – ${entry.closeTime}`;
  }
  return "Hours not listed";
};

export interface VenueHoursTableProps {
  hours: BrandHourEntry[];
}

export const VenueHoursTable: React.FC<VenueHoursTableProps> = ({ hours }) => {
  const rows = useMemo(() => {
    const byWeekday = new Map(hours.map((h) => [h.weekday, h]));
    return WEEKDAY_LABELS.map((label, weekday) => ({
      label,
      value: formatHourRange(
        byWeekday.get(weekday) ?? {
          weekday,
          openTime: null,
          closeTime: null,
          isClosed: true,
        },
      ),
    }));
  }, [hours]);

  if (hours.length === 0) return null;

  return (
    <View style={styles.host}>
      <Text style={styles.title}>Hours</Text>
      {rows.map((row) => (
        <View key={row.label} style={styles.row}>
          <Text style={styles.day}>{row.label}</Text>
          <Text style={styles.time}>{row.value}</Text>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: spacing.xs,
    width: "100%",
  },
  title: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: 4,
  },
  day: {
    flex: 1,
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  time: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.primary,
    textAlign: "right",
  },
});

export default VenueHoursTable;
