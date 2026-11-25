/**
 * Ve1 + #1424 — category pills. Stay remains server-flagged until activation.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";


import type { VenueCategory } from "../../types/brand";
import { VENUE_TYPES, builtPreset, joinFeatureLabels } from "../../types/venueFeatures";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";

import {
  color,
  materials,
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

// #4490 D2 — the same shape as the other eight rows (no "· …" tail); the
// #1424 canonical wording is kept.
const STAY_OPTION: (typeof OPTIONS)[number] = {
  id: "stay",
  label: "Stay",
  description: "Hotels, resorts and short stays",
};

/** "Starts with Menu and Events here" for a type (built features only). */
export function venueTypePresetLine(category: VenueCategory): string {
  // #4490 D2 — every type says what it starts with, in one shape. Stays are
  // run from the Stay workspace. A new venue is not approved yet and Table
  // ordering waits for approval, so the line only promises what create can
  // switch on; a type whose usual features are not built yet says so.
  if (category === "stay") return "Starts with Stays";
  const keys = builtPreset(category).filter((key) => key !== "table_ordering");
  if (keys.length === 0) return "Starts with nothing switched on. Pick features next.";
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
            {/* #4490 D1 — the picked card is plainly picked: accent border,
                tinted fill and a check, not only a lighter glass. */}
            <GlassCard
              variant={selected ? "elevated" : "base"}
              padding={space[4]}
              style={selected ? styles.cardSelected : styles.cardIdle}
            >
              <View style={styles.headRow}>
                <Text style={[styles.title, selected && styles.titleOn]}>
                  {opt.label}
                </Text>
                {selected ? (
                  <View style={styles.check} testID={testID !== undefined ? `${testID}-selected-${opt.id}` : undefined}>
                    <Icon name="check" size={14} color={color.ink} />
                  </View>
                ) : null}
              </View>
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
  // The kit's selected surface (OptionCard): a paper border and the selected
  // material, never accent orange (contrast beats decoration).
  cardSelected: {
    borderWidth: 1.5,
    borderColor: color.paper,
    backgroundColor: materials.selected.glassFill,
    borderRadius: radius.md,
  },
  cardIdle: {
    borderWidth: 1.5,
    borderColor: "transparent",
    borderRadius: radius.md,
  },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: color.paper,
    alignItems: "center",
    justifyContent: "center",
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
