/**
 * issue #3281 — the "Valid on" picker for a ticket. Rendered inside the ticket
 * sheet, beside its Visibility and Available-at pickers.
 *
 * Days with sales cannot be removed. While sales are unknown, every selected
 * day behaves as sold, so a removal can only happen on known numbers.
 */
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ScrollView } from "../../wrappers/SmartScrollView";

import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { MultiDateEntry } from "../../store/draftEventStore";
import { formatMultiDateList } from "../../utils/eventDateDisplay";
import { tapValidDay } from "../../utils/ticketDayScopeCopy";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";

export interface ValidDaysSheetProps {
  visible: boolean;
  entries: readonly MultiDateEntry[];
  selected: readonly string[] | null;
  /** Sold passes per date for this ticket. Null while unknown. */
  soldByDay: Readonly<Record<string, number>> | null;
  onChange: (next: string[] | null) => void;
  onClose: () => void;
}

export const ValidDaysSheet: React.FC<ValidDaysSheetProps> = ({
  visible,
  entries,
  selected,
  soldByDay,
  onChange,
  onClose,
}) => {
  const [alert, setAlert] = useState<string | null>(null);
  useEffect(() => {
    if (visible) setAlert(null);
  }, [visible]);

  const soldOn = (id: string): number => soldByDay?.[id] ?? 0;

  const handleAllDates = (): void => {
    setAlert(null);
    onChange(null);
  };

  const handleDay = (entry: MultiDateEntry): void => {
    const tap = tapValidDay(entries, selected, entry.id, soldByDay);
    setAlert(tap.alert);
    onChange(tap.next);
  };

  const count =
    selected === null
      ? `Valid on all ${entries.length} dates`
      : selected.length === 0
        ? "No days selected"
        : `${selected.length} of ${entries.length} days selected`;
  const everyDate =
    selected !== null && selected.length === entries.length;
  const labels = formatMultiDateList([...entries]);

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="full">
      <View style={styles.root} testID="issue-3281-valid-days-sheet">
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            Valid on
          </Text>
          <Text
            style={styles.count}
            accessibilityLiveRegion="polite"
            testID="issue-3281-valid-days-count"
          >
            {soldByDay === null ? `${count} · Checking sales…` : count}
          </Text>
          {everyDate ? (
            <Text style={styles.hint}>
              Every current date is selected. Dates you add later won't be
              included — choose All dates if they should be.
            </Text>
          ) : null}
          {alert !== null ? (
            <Text
              style={styles.alert}
              accessibilityRole="alert"
              testID="issue-3281-valid-days-alert"
            >
              {alert}
            </Text>
          ) : null}
        </View>
        <ScrollView contentContainerStyle={styles.list}>
          <Pressable
            onPress={handleAllDates}
            accessibilityRole="button"
            accessibilityState={{ selected: selected === null }}
            accessibilityLabel="All dates"
            accessibilityHint="Includes any dates you add later"
            testID="issue-3281-all-dates-row"
            style={[styles.row, selected === null && styles.rowSelected]}
          >
            <View style={styles.radio}>
              {selected === null ? <View style={styles.radioDot} /> : null}
            </View>
            <View style={styles.textCol}>
              <Text style={styles.rowLabel}>All dates</Text>
              <Text style={styles.rowSub}>Includes any dates you add later.</Text>
            </View>
          </Pressable>
          <Text style={styles.section}>Specific days</Text>
          {entries.map((entry, index) => {
            const checked = selected?.includes(entry.id) === true;
            const sold = soldOn(entry.id);
            const sub = [
              entry.overrides?.title,
              sold > 0 ? `${sold} sold` : null,
            ].filter(Boolean).join(" · ");
            return (
              <Pressable
                key={entry.id}
                onPress={() => handleDay(entry)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                accessibilityLabel={[labels[index], sub].filter(Boolean).join(", ")}
                accessibilityHint={
                  sold > 0 ? "Has sales on this ticket. Can't be removed." : undefined
                }
                testID={`issue-3281-day-row-${entry.id}`}
                style={[styles.row, checked && styles.rowSelected]}
              >
                <View style={[styles.box, checked && styles.boxChecked]}>
                  {checked ? (
                    <Icon name="check" size={14} color={textTokens.primary} />
                  ) : null}
                </View>
                <View style={styles.textCol}>
                  <Text style={styles.rowLabel}>{labels[index]}</Text>
                  {sub.length > 0 ? (
                    <Text style={styles.rowSub}>{sub}</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.dock}>
          <Button label="Done" onPress={onClose} variant="primary" size="md" fullWidth />
        </View>
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  title: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
    marginBottom: spacing.sm,
  },
  count: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "500",
    color: textTokens.secondary,
  },
  hint: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
  },
  alert: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "600",
    color: accent.warm,
    marginTop: spacing.xs,
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: 72,
    gap: spacing.sm,
  },
  section: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: accent.warm,
    marginTop: spacing.md,
  },
  row: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    overflow: "hidden",
  },
  rowSelected: {
    backgroundColor: accent.tint,
    borderColor: accent.warm,
  },
  box: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: textTokens.tertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  boxChecked: { borderColor: accent.warm },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: textTokens.tertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: accent.warm,
  },
  textCol: { flex: 1, gap: 2 },
  rowLabel: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  rowSub: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
  },
  dock: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
});
