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
// ORCH-1193 [sheet-cutoff]: the VERTICAL body scroller becomes SmartScrollView so
// the "Done" CTA clears the keyboard + 42dp Done bar and is bounded to the panel
// (I-PROPOSED-KEYBOARD-TOOLBAR-CLEARANCE). The nested HORIZONTAL day-of-month
// ScrollView stays plain RN (no keyboard role).
import { ScrollView as BodyScrollView } from "../../wrappers/SmartScrollView";

import {
  radius as radiusTokens,
  color,
  space,
  type,
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
      <BodyScrollView
        style={styles.scrollFlex}
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
                <Icon name="check" size={18} color={color.text1} />
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
      </BodyScrollView>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  // ORCH-1193: bound the body scroll viewport to the fixed-height panel so the
  // "Done" CTA scrolls into view instead of overflowing past overflow:hidden.
  scrollFlex: {
    flex: 1,
  },
  // #4420 (native run): no side padding here. Sheet's body already pads by
  // SHEET_SIDE_GUTTER, so a second gutter pushed the content to 44pt.
  sheetContent: {
    paddingTop: space[4],
    paddingBottom: space[7],
  },
  sheetTitle: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    letterSpacing: type.h1.letterSpacing,
    color: color.text1,
    marginBottom: space[4],
  },
  sheetSubsectionLabel: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    fontWeight: "500",
    color: color.text2,
    marginTop: space[4],
    marginBottom: space[1],
  },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: space[4],
    paddingHorizontal: space[4],
    borderRadius: radiusTokens.md,
    marginBottom: space[1],
  },
  sheetRowActive: {
    backgroundColor: color.fill.tabOn,
  },
  sheetRowTextCol: {
    flex: 1,
    minWidth: 0,
  },
  sheetRowLabel: {
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    color: color.text1,
  },
  sheetRowLabelActive: {
    fontWeight: "600",
  },
  sheetRowSub: {
    fontSize: type.caption.fontSize,
    color: color.text3,
    marginTop: 2,
  },
  sheetDoneBtn: {
    paddingVertical: space[4],
    alignItems: "center",
    marginTop: space[4],
  },
  sheetDoneLabel: {
    fontSize: type.body.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
  weekdayGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[1],
    marginBottom: space[2],
  },
  weekdayPill: {
    paddingVertical: space[2],
    paddingHorizontal: space[4],
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
    minWidth: 56,
    alignItems: "center",
  },
  weekdayPillActive: {
    backgroundColor: color.fill.tabOn,
    borderColor: color.lineStrong,
  },
  weekdayPillLabel: {
    fontSize: type.small.fontSize,
    fontWeight: "500",
    color: color.text1,
  },
  weekdayPillLabelActive: {
    fontWeight: "700",
  },
  domRow: {
    flexDirection: "row",
    gap: space[1],
    paddingVertical: space[1],
  },
  domPill: {
    paddingVertical: space[2],
    paddingHorizontal: space[4],
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
    minWidth: 56,
    alignItems: "center",
  },
  domPillActive: {
    backgroundColor: color.fill.tabOn,
    borderColor: color.lineStrong,
  },
  domPillLabel: {
    fontSize: type.small.fontSize,
    fontWeight: "500",
    color: color.text1,
  },
  domPillLabelActive: {
    fontWeight: "700",
  },
  setPosRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[1],
    marginBottom: space[2],
  },
  setPosPill: {
    paddingVertical: space[2],
    paddingHorizontal: space[4],
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  setPosPillActive: {
    backgroundColor: color.fill.tabOn,
    borderColor: color.lineStrong,
  },
  setPosPillLabel: {
    fontSize: type.small.fontSize,
    fontWeight: "500",
    color: color.text1,
  },
  setPosPillLabelActive: {
    fontWeight: "700",
  },
});
