/**
 * VenueSlotPicker — META-ORCH-1148 sub-ORCH 2.2b (SPEC §4.E.1).
 * ---------------------------------------------------------------------------
 * The slot-grid STEP VIEW for VenueReserveSheet step 2. Mirrors
 * ExperienceOccurrencePicker's dark-sheet vocabulary (available chip + disabled
 * "full" rows at opacity 0.45 — NEVER hidden) but is a content component, not
 * its own BaseBottomSheet (the 3 reserve steps share ONE sheet).
 *
 * Slots come ONLY from the engine (pg_venue_available_slots) — this view never
 * fabricates a slot. Empty list = "fully booked" (W1), NOT a fallback. Full
 * slots render disabled (no dead tap).
 */

import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

import { Icon } from "../ui/Icon";
import type { VenueSlot } from "../../hooks/useVenueAvailability";

export interface VenueSlotPickerProps {
  slots: readonly VenueSlot[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  /** Fires with the chosen slot's UTC instant. */
  onSelect: (slot: VenueSlot) => void;
  /** The currently-selected slot UTC instant (highlight), if any. */
  selectedSlotUtc: string | null;
}

/** Remaining-capacity chip copy for one slot. */
const remainingLabel = (remaining: number | null): string | null => {
  if (remaining === null) return null; // unlimited → no chip
  if (remaining <= 0) return "Full";
  if (remaining <= 10) return `${remaining} left`;
  return "Available";
};

export const VenueSlotPicker: React.FC<VenueSlotPickerProps> = ({
  slots,
  isLoading,
  isError,
  onRetry,
  onSelect,
  selectedSlotUtc,
}) => {
  if (isLoading) {
    return (
      <View style={styles.stateBox} accessibilityLabel="Loading times">
        <ActivityIndicator color="rgba(255,255,255,0.85)" />
        <Text style={styles.stateText}>Finding open tables…</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.stateBox}>
        <Text style={styles.stateText}>We couldn&apos;t load times.</Text>
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          style={({ pressed }) => [styles.retryBtn, pressed && styles.retryBtnPressed]}
        >
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (slots.length === 0) {
    // W1 — no-availability state. NOT a fabricated fallback.
    return (
      <View style={styles.stateBox} accessibilityLabel="Fully booked">
        <Icon name="calendar-outline" size={28} color="rgba(255,255,255,0.45)" />
        <Text style={styles.emptyTitle}>Fully booked</Text>
        <Text style={styles.emptySub}>Try another day.</Text>
      </View>
    );
  }

  return (
    <View style={styles.grid}>
      {slots.map((slot) => {
        const full = slot.isFull || (slot.remaining !== null && slot.remaining <= 0);
        const chip = remainingLabel(slot.remaining);
        const selected = selectedSlotUtc === slot.slotStartUtc;
        return (
          <Pressable
            key={slot.slotStartUtc}
            onPress={() => {
              if (full) return;
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onSelect(slot);
            }}
            disabled={full}
            accessibilityRole="button"
            accessibilityState={{ disabled: full, selected }}
            accessibilityLabel={`${slot.label}${chip ? `, ${chip}` : ""}${
              full ? ", full" : ""
            }`}
            style={({ pressed }) => [
              styles.slot,
              selected && styles.slotSelected,
              full && styles.slotDisabled,
              pressed && !full && styles.slotPressed,
            ]}
          >
            <Text
              style={[
                styles.slotLabel,
                selected && styles.slotLabelSelected,
                full && styles.slotLabelDisabled,
              ]}
            >
              {slot.label}
            </Text>
            {chip ? (
              <Text
                style={[
                  styles.slotChip,
                  full
                    ? styles.slotChipFull
                    : (slot.remaining ?? 99) <= 10
                      ? styles.slotChipLow
                      : styles.slotChipOk,
                ]}
              >
                {chip}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  stateBox: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 36,
  },
  stateText: {
    fontSize: 15,
    color: "rgba(255,255,255,0.75)",
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "rgba(255,255,255,0.92)",
  },
  emptySub: {
    fontSize: 14,
    color: "rgba(255,255,255,0.6)",
  },
  retryBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  retryBtnPressed: {
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  retryText: {
    color: "rgba(255,255,255,0.92)",
    fontWeight: "600",
    fontSize: 14,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingVertical: 4,
  },
  slot: {
    minWidth: 92,
    flexGrow: 1,
    flexBasis: "30%",
    alignItems: "center",
    gap: 4,
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  slotSelected: {
    borderColor: "#f59e0b",
    backgroundColor: "rgba(245,158,11,0.16)",
  },
  slotPressed: {
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  slotDisabled: {
    opacity: 0.45,
  },
  slotLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: "rgba(255,255,255,0.92)",
  },
  slotLabelSelected: {
    color: "#fbbf24",
  },
  slotLabelDisabled: {
    color: "rgba(255,255,255,0.55)",
  },
  slotChip: {
    fontSize: 11,
    fontWeight: "600",
  },
  slotChipOk: {
    color: "#34d399",
  },
  slotChipLow: {
    color: "#fbbf24",
  },
  slotChipFull: {
    color: "#f87171",
  },
});

export default VenueSlotPicker;
