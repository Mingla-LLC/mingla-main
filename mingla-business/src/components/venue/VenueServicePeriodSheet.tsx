/**
 * META-ORCH-1148 sub-ORCH 2.1a — add/edit a service period.
 *
 * Edits one entry of venue_availability_config.service_periods: a name, the
 * days[] it runs (0..6 Sun..Sat), and a venue-local start/end 'HH:MM'. The
 * parent module owns the array + persistence; this sheet returns the edited
 * period. All Pressables carry a11y labels (I-39).
 */

import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  accent,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Sheet } from "../ui/Sheet";
import type { ServicePeriod } from "../../types/venueReservation";

const DAY_LABELS: readonly string[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export interface VenueServicePeriodSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Present → edit; absent → add. */
  period: ServicePeriod | null;
  onSave: (period: ServicePeriod) => void;
  /** When editing, allow delete. */
  onDelete?: () => void;
  testID?: string;
}

export function VenueServicePeriodSheet({
  visible,
  onClose,
  period,
  onSave,
  onDelete,
  testID,
}: VenueServicePeriodSheetProps): React.ReactElement {
  const isEdit = period !== null;
  const [name, setName] = useState<string>("");
  const [days, setDays] = useState<number[]>([]);
  const [start, setStart] = useState<string>("");
  const [end, setEnd] = useState<string>("");

  useEffect(() => {
    if (!visible) return;
    setName(period?.name ?? "");
    setDays(period?.days ?? []);
    setStart(period?.start ?? "");
    setEnd(period?.end ?? "");
  }, [visible, period]);

  const toggleDay = useCallback((d: number): void => {
    setDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b),
    );
  }, []);

  const startValid = HHMM.test(start);
  const endValid = HHMM.test(end);
  const orderValid =
    startValid && endValid && timeToMin(start) < timeToMin(end);
  const canSave =
    name.trim().length > 0 && days.length > 0 && orderValid;

  const handleSave = useCallback((): void => {
    if (!canSave) return;
    onSave({
      name: name.trim(),
      days: [...days].sort((a, b) => a - b),
      start,
      end,
      type: period?.type,
    });
  }, [canSave, onSave, name, days, start, end, period]);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      snapPoint={0.7}
      testID={testID ?? "venue-service-period-sheet"}
    >
      <View style={styles.body}>
        <Text style={styles.heading}>
          {isEdit ? "Edit service period" : "Add service period"}
        </Text>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.label}>Name</Text>
          <Input
            value={name}
            onChangeText={setName}
            placeholder="e.g. Dinner"
            accessibilityLabel="Service period name"
            testID="venue-period-name"
          />

          <Text style={styles.label}>Days</Text>
          <View style={styles.dayRow}>
            {DAY_LABELS.map((d, i) => {
              const active = days.includes(i);
              return (
                <Pressable
                  key={d}
                  onPress={() => toggleDay(i)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${d}${active ? " selected" : ""}`}
                  style={[styles.dayChip, active ? styles.dayChipActive : null]}
                  testID={`venue-period-day-${i}`}
                >
                  <Text style={[styles.dayLabel, active ? styles.dayLabelActive : null]}>
                    {d}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.timeRow}>
            <View style={styles.flex1}>
              <Text style={styles.label}>Opens (HH:MM)</Text>
              <Input
                value={start}
                onChangeText={setStart}
                variant="number"
                placeholder="17:00"
                accessibilityLabel="Service period start time, 24-hour HH colon MM"
                testID="venue-period-start"
              />
            </View>
            <View style={styles.flex1}>
              <Text style={styles.label}>Closes (HH:MM)</Text>
              <Input
                value={end}
                onChangeText={setEnd}
                variant="number"
                placeholder="22:00"
                accessibilityLabel="Service period end time, 24-hour HH colon MM"
                testID="venue-period-end"
              />
            </View>
          </View>
          {(start.length > 0 || end.length > 0) && !orderValid ? (
            <Text style={styles.invalid}>
              Use 24-hour HH:MM and make sure the close time is after the open
              time.
            </Text>
          ) : null}

          <Button
            label={isEdit ? "Save period" : "Add period"}
            onPress={handleSave}
            variant="primary"
            size="lg"
            fullWidth
            disabled={!canSave}
            style={styles.saveBtn}
            testID="venue-period-save"
          />
          {isEdit && onDelete != null ? (
            <Button
              label="Remove this period"
              onPress={onDelete}
              variant="ghost"
              size="md"
              fullWidth
              style={styles.deleteBtn}
              testID="venue-period-delete"
            />
          ) : null}
        </ScrollView>
      </View>
    </Sheet>
  );
}

function timeToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  heading: {
    ...typography.h3,
    color: textTokens.primary,
    marginBottom: spacing.sm,
  },
  scroll: {
    paddingBottom: spacing.xxl,
    gap: spacing.xs,
  },
  label: {
    ...typography.bodySm,
    color: textTokens.secondary,
    marginTop: spacing.sm,
    marginBottom: spacing.xxs,
  },
  dayRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  dayChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  dayChipActive: {
    backgroundColor: accent.warm,
  },
  dayLabel: {
    ...typography.bodySm,
    color: textTokens.secondary,
    fontWeight: "600",
  },
  dayLabelActive: {
    color: "#0c0e12",
  },
  timeRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  flex1: {
    flex: 1,
  },
  invalid: {
    ...typography.caption,
    color: semantic.error,
    marginTop: spacing.xxs,
  },
  saveBtn: {
    marginTop: spacing.lg,
  },
  deleteBtn: {
    marginTop: spacing.xs,
  },
});

export default VenueServicePeriodSheet;
