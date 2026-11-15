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
  radius as radiusTokens,
  color,
  space,
  type,
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
                    <Icon name="check" size={14} color={color.text1} />
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
    paddingTop: space[2],
    paddingBottom: space[2],
  },
  title: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: "600",
    color: color.text1,
    marginBottom: space[2],
  },
  count: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    fontWeight: "500",
    color: color.text2,
  },
  hint: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text3,
    marginTop: space[1],
  },
  alert: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    fontWeight: "600",
    color: color.text1,
    marginTop: space[1],
  },
  list: {
    paddingTop: space[2],
    paddingBottom: 72,
    gap: space[2],
  },
  section: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: color.text1,
    marginTop: space[4],
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
    borderColor: color.line,
    backgroundColor: color.fill.inset,
    overflow: "hidden",
  },
  rowSelected: {
    backgroundColor: color.fill.tabOn,
    borderColor: color.lineStrong,
  },
  box: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: color.text3,
    alignItems: "center",
    justifyContent: "center",
  },
  boxChecked: { borderColor: color.lineStrong },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: color.text3,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: color.paper,
  },
  textCol: { flex: 1, gap: 2 },
  rowLabel: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    fontWeight: "600",
    color: color.text1,
  },
  rowSub: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text2,
  },
  dock: {
    paddingBottom: space[4],
  },
});
