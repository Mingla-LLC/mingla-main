/**
 * Recurrence preset (repeat-pattern) picker sheet — extracted from
 * CreatorStep2When.tsx (Cycle 17d Stage 2 §F.2).
 *
 * Owns:
 *   - PRESET_OPTS / WEEKDAY_OPTS / SETPOS_OPTS option sets
 *   - The Sheet JSX (preset row + per-preset sub-pickers + Done button)
 *   - Sheet-specific styles
 *
 * Parent retains state ownership of `recurrenceRule`; this sheet is a
 * controlled UI surface that emits select events back to the parent.
 */

import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type {
  RecurrencePreset,
  RecurrenceRule,
  SetPos,
  Weekday,
} from "../../store/draftEventStore";
import { formatDayOfMonth } from "../../utils/recurrenceRule";

import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";

const WEEKDAY_OPTS: ReadonlyArray<{
  id: Weekday;
  label: string;
  short: string;
}> = [
  { id: "MO", label: "Monday", short: "Mon" },
  { id: "TU", label: "Tuesday", short: "Tue" },
  { id: "WE", label: "Wednesday", short: "Wed" },
  { id: "TH", label: "Thursday", short: "Thu" },
  { id: "FR", label: "Friday", short: "Fri" },
  { id: "SA", label: "Saturday", short: "Sat" },
  { id: "SU", label: "Sunday", short: "Sun" },
];

const SETPOS_OPTS: ReadonlyArray<{ id: SetPos; label: string }> = [
  { id: 1, label: "1st" },
  { id: 2, label: "2nd" },
  { id: 3, label: "3rd" },
  { id: 4, label: "4th" },
  { id: -1, label: "Last" },
];

const PRESET_OPTS: ReadonlyArray<{
  id: RecurrencePreset;
  label: string;
  sub: string;
}> = [
  { id: "daily", label: "Daily", sub: "Every day" },
  { id: "weekly", label: "Weekly", sub: "Every week on the same day" },
  { id: "biweekly", label: "Every 2 weeks", sub: "Every other week" },
  {
    id: "monthly_dom",
    label: "Monthly (by day)",
    sub: "Same day-of-month every month",
  },
  {
    id: "monthly_dow",
    label: "Monthly (by weekday)",
    sub: "e.g. 1st Monday of each month",
  },
];

export interface CreatorStep2WhenRepeatPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  recurrenceRule: RecurrenceRule | null;
  onSelectPreset: (preset: RecurrencePreset) => void;
  onSelectByDay: (day: Weekday) => void;
  onSelectByMonthDay: (n: number) => void;
  onSelectBySetPos: (p: SetPos) => void;
}

export const CreatorStep2WhenRepeatPickerSheet: React.FC<
  CreatorStep2WhenRepeatPickerSheetProps
> = ({
  visible,
  onClose,
  recurrenceRule,
  onSelectPreset,
  onSelectByDay,
  onSelectByMonthDay,
  onSelectBySetPos,
}) => {
  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="full">
      <ScrollView
        contentContainerStyle={styles.sheetContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sheetTitle}>Repeat pattern</Text>
        {PRESET_OPTS.map((opt) => {
          const active = recurrenceRule?.preset === opt.id;
          return (
            <Pressable
              key={opt.id}
              onPress={() => onSelectPreset(opt.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={opt.label}
              style={[styles.sheetRow, active && styles.sheetRowActive]}
            >
              <View style={styles.sheetRowTextCol}>
                <Text
                  style={[
                    styles.sheetRowLabel,
                    active && styles.sheetRowLabelActive,
                  ]}
                >
                  {opt.label}
                </Text>
                <Text style={styles.sheetRowSub}>{opt.sub}</Text>
              </View>
              {active ? (
                <Icon name="check" size={18} color={accent.warm} />
              ) : null}
            </Pressable>
          );
        })}

        {/* Sub-pickers per preset */}
        {recurrenceRule !== null &&
        (recurrenceRule.preset === "weekly" ||
          recurrenceRule.preset === "biweekly" ||
          recurrenceRule.preset === "monthly_dow") ? (
          <>
            <Text style={styles.sheetSubsectionLabel}>Day of the week</Text>
            <View style={styles.weekdayGrid}>
              {WEEKDAY_OPTS.map((opt) => {
                const active = recurrenceRule?.byDay === opt.id;
                return (
                  <Pressable
                    key={opt.id}
                    onPress={() => onSelectByDay(opt.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={opt.label}
                    style={[
                      styles.weekdayPill,
                      active && styles.weekdayPillActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.weekdayPillLabel,
                        active && styles.weekdayPillLabelActive,
                      ]}
                    >
                      {opt.short}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {recurrenceRule?.preset === "monthly_dom" ? (
          <>
            <Text style={styles.sheetSubsectionLabel}>Day of the month</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.domRow}
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map((n) => {
                const active = recurrenceRule?.byMonthDay === n;
                return (
                  <Pressable
                    key={n}
                    onPress={() => onSelectByMonthDay(n)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Day ${n}`}
                    style={[styles.domPill, active && styles.domPillActive]}
                  >
                    <Text
                      style={[
                        styles.domPillLabel,
                        active && styles.domPillLabelActive,
                      ]}
                    >
                      {formatDayOfMonth(n)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        ) : null}

        {recurrenceRule?.preset === "monthly_dow" ? (
          <>
            <Text style={styles.sheetSubsectionLabel}>Which week</Text>
            <View style={styles.setPosRow}>
              {SETPOS_OPTS.map((opt) => {
                const active = recurrenceRule?.bySetPos === opt.id;
                return (
                  <Pressable
                    key={opt.id}
                    onPress={() => onSelectBySetPos(opt.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={opt.label}
                    style={[
                      styles.setPosPill,
                      active && styles.setPosPillActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.setPosPillLabel,
                        active && styles.setPosPillLabelActive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Done picking pattern"
          style={styles.sheetDoneBtn}
        >
          <Text style={styles.sheetDoneLabel}>Done</Text>
        </Pressable>
      </ScrollView>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  sheetContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  sheetTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    letterSpacing: typography.h3.letterSpacing,
    color: textTokens.primary,
    marginBottom: spacing.md,
  },
  sheetSubsectionLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "500",
    color: textTokens.secondary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    marginBottom: spacing.xs,
  },
  sheetRowActive: {
    backgroundColor: accent.tint,
  },
  sheetRowTextCol: {
    flex: 1,
    minWidth: 0,
  },
  sheetRowLabel: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
  },
  sheetRowLabelActive: {
    fontWeight: "600",
  },
  sheetRowSub: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  sheetDoneBtn: {
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.md,
  },
  sheetDoneLabel: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
  weekdayGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  weekdayPill: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    minWidth: 56,
    alignItems: "center",
  },
  weekdayPillActive: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  weekdayPillLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "500",
    color: textTokens.primary,
  },
  weekdayPillLabelActive: {
    fontWeight: "700",
  },
  domRow: {
    flexDirection: "row",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  domPill: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    minWidth: 56,
    alignItems: "center",
  },
  domPillActive: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  domPillLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "500",
    color: textTokens.primary,
  },
  domPillLabelActive: {
    fontWeight: "700",
  },
  setPosRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  setPosPill: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  setPosPillActive: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  setPosPillLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "500",
    color: textTokens.primary,
  },
  setPosPillLabelActive: {
    fontWeight: "700",
  },
});
