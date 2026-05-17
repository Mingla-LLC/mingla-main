/**
 * TripCreatorStep2Itinerary — Step 2 of TripCreatorWizard. Manages the
 * day-by-day itinerary list. Stacked cards via TripDayEditor + add-day +
 * reorder via swap-buttons.
 *
 * Tr2 (ORCH-0859). Per SPEC §4.8 Step 2.
 */

import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";
import { TripDayEditor, type TripDayDraft } from "./TripDayEditor";

export interface TripCreatorStep2ItineraryProps {
  days: TripDayDraft[];
  onChange: (days: TripDayDraft[]) => void;
  disabled?: boolean;
}

export const TripCreatorStep2Itinerary: React.FC<TripCreatorStep2ItineraryProps> = ({
  days,
  onChange,
  disabled,
}) => {
  const handleAddDay = (): void => {
    const nextOrdinal = days.length === 0 ? 1 : days[days.length - 1].ordinal + 1;
    onChange([...days, { ordinal: nextOrdinal, title: "", narrative: "" }]);
  };

  const handleDayChange = (index: number, patch: Partial<TripDayDraft>): void => {
    const next = [...days];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };

  const handleDelete = (index: number): void => {
    const next = days.filter((_, i) => i !== index);
    // Re-number ordinals so they stay 1-based sequential
    onChange(next.map((d, i) => ({ ...d, ordinal: i + 1 })));
  };

  const handleSwap = (a: number, b: number): void => {
    if (a < 0 || b < 0 || a >= days.length || b >= days.length) return;
    const next = [...days];
    [next[a], next[b]] = [next[b], next[a]];
    onChange(next.map((d, i) => ({ ...d, ordinal: i + 1 })));
  };

  return (
    <ScrollView
      style={styles.host}
      contentContainerStyle={styles.contentContainer}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.helper}>
        Add a card per day. Travelers see this on the public trip page.
      </Text>

      {days.length === 0 ? (
        <View style={styles.emptyState}>
          <Icon name="calendar" size={32} color={textTokens.tertiary} />
          <Text style={styles.emptyText}>No days yet. Add your first day below.</Text>
        </View>
      ) : (
        <View style={styles.daysList}>
          {days.map((day, index) => (
            <TripDayEditor
              key={`day-${index}-${day.ordinal}`}
              day={day}
              index={index}
              total={days.length}
              onChange={(patch) => handleDayChange(index, patch)}
              onDelete={() => handleDelete(index)}
              onMoveUp={() => handleSwap(index, index - 1)}
              onMoveDown={() => handleSwap(index, index + 1)}
              disabled={disabled}
              testID={`trip-step2-day-${index}`}
            />
          ))}
        </View>
      )}

      <Pressable
        onPress={handleAddDay}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Add a day"
        accessibilityState={{ disabled: disabled === true }}
        style={[styles.addBtn, disabled === true && styles.addBtnDisabled]}
        testID="trip-step2-add-day"
      >
        <Icon name="plus" size={16} color={accent.warm} />
        <Text style={styles.addBtnText}>Add a day</Text>
      </Pressable>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  helper: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  emptyState: {
    padding: spacing.lg,
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radiusTokens.lg,
    backgroundColor: "rgba(255, 255, 255, 0.02)",
    borderStyle: "dashed",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  emptyText: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    textAlign: "center",
  },
  daysList: {
    gap: spacing.md,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(235, 120, 37, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(235, 120, 37, 0.4)",
    borderStyle: "dashed",
  },
  addBtnDisabled: {
    opacity: 0.4,
  },
  addBtnText: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
});

export default TripCreatorStep2Itinerary;
