/**
 * Ve1 + #1424 — category pills. Stay remains server-flagged until activation.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";


import type { VenueCategory } from "../../types/brand";
import { VENUE_TYPES, builtPreset, joinFeatureLabels } from "../../types/venueFeatures";
import { GlassCard } from "../ui/GlassCard";

import {
  color,
  radius,
  space,
  type,
} from "../../constants/designSystem";
/**
 * #4490 — nine venue types. A type is a label and a starting preset only: it
 * switches on the features that kind of venue usually needs, and every one can
 * be changed later in Settings › Venue type and features.
 */
const OPTIONS: {
  id: VenueCategory;
  label: string;
  description: string;
}[] = VENUE_TYPES.filter((t) => t.key !== "stay").map((t) => ({
  id: t.key,
  label: t.label,
  description: t.description,
}));

const STAY_OPTION: (typeof OPTIONS)[number] = {
  id: "stay",
  label: "Stay",
  description: "Hotels, resorts & short stays · Reserve rooms and places",
};

/** "Starts with Menu and Events here" for a type (built features only). */
export function venueTypePresetLine(category: VenueCategory): string | null {
  // A new venue is not approved yet, and Table ordering waits for approval,
  // so the line only promises what create can switch on.
  const keys = builtPreset(category).filter((key) => key !== "table_ordering");
  if (keys.length === 0) return null;
  return `Starts with ${joinFeatureLabels(keys)}`;
}

export interface VenueCategoryPickerProps {
  value: VenueCategory | null;
  onChange: (next: VenueCategory) => void;
  /** Server-owned STAY_VENUE_AUTHORING gate. Defaults false (fail closed). */
  includeStay?: boolean;
  /** Keeps an already-selected draft visible without allowing a gated submit. */
  stayDisabled?: boolean;
  /** #4490 — show which features each type starts with (create and claim). */
  showPreset?: boolean;
  testID?: string;
}

export const VenueCategoryPicker: React.FC<VenueCategoryPickerProps> = ({
  value,
  onChange,
  includeStay = false,
  stayDisabled = false,
  showPreset = false,
  testID,
}) => {
  const visibleOptions =
    includeStay || value === "stay" ? [...OPTIONS, STAY_OPTION] : OPTIONS;
  return (
    <View style={styles.host} testID={testID}>
      {visibleOptions.map((opt) => {
        const selected = value === opt.id;
        const disabled = opt.id === "stay" && stayDisabled;
        const preset = showPreset ? venueTypePresetLine(opt.id) : null;
        return (
          <Pressable
            key={opt.id}
            onPress={() => onChange(opt.id)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`${opt.label}. ${opt.description}${
              preset !== null ? `. ${preset}` : ""
            }${disabled ? ". Temporarily unavailable" : ""}`}
            accessibilityState={{ selected, disabled }}
            style={({ pressed }) => [
              styles.cardOuter,
              pressed && styles.pressed,
              disabled && styles.disabled,
            ]}
          >
            <GlassCard
              variant={selected ? "elevated" : "base"}
              padding={space[4]}
            >
              <Text style={[styles.title, selected && styles.titleOn]}>
                {opt.label}
              </Text>
              <Text style={styles.desc}>{opt.description}</Text>
              {preset !== null ? (
                <Text style={styles.preset}>{preset}</Text>
              ) : null}
            </GlassCard>
          </Pressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    // B1: no inner horizontal padding — the cards now share the exact insets of
    // the page section (and the full-width Continue button below them) instead
    // of being double-padded. The parent screen already applies section
    // padding, so the cards and the CTA line up to the same width.
    gap: space[2],
  },
  cardOuter: {
    borderRadius: radius.md,
  },
  pressed: {
    opacity: 0.88,
  },
  disabled: {
    opacity: 0.5,
  },
  title: {
    fontSize: type.body.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
  titleOn: {
    color: color.text1,
  },
  preset: {
    marginTop: 4,
    fontSize: type.caption.fontSize,
    color: color.text3,
  },
  desc: {
    marginTop: 4,
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text2,
  },
});

export default VenueCategoryPicker;
