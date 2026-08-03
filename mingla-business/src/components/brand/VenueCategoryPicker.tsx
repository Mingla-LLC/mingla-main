/**
 * Ve1 + #1424 — category pills. Stay remains server-flagged until activation.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { VenueCategory } from "../../types/brand";
import { GlassCard } from "../ui/GlassCard";

const OPTIONS: {
  id: VenueCategory;
  label: string;
  description: string;
}[] = [
  { id: "restaurant", label: "Restaurant", description: "Food & drink venues" },
  { id: "play", label: "Play", description: "Activities & family fun" },
  {
    id: "creative_and_arts",
    label: "Creative & arts",
    description: "Studios, galleries, performance",
  },
];

const STAY_OPTION: (typeof OPTIONS)[number] = {
  id: "stay",
  label: "Stay",
  description: "Hotels, resorts & short stays · Reserve rooms and places",
};

export interface VenueCategoryPickerProps {
  value: VenueCategory | null;
  onChange: (next: VenueCategory) => void;
  /** Server-owned STAY_VENUE_AUTHORING gate. Defaults false (fail closed). */
  includeStay?: boolean;
  /** Keeps an already-selected draft visible without allowing a gated submit. */
  stayDisabled?: boolean;
  testID?: string;
}

export const VenueCategoryPicker: React.FC<VenueCategoryPickerProps> = ({
  value,
  onChange,
  includeStay = false,
  stayDisabled = false,
  testID,
}) => {
  const visibleOptions =
    includeStay || value === "stay" ? [...OPTIONS, STAY_OPTION] : OPTIONS;
  return (
    <View style={styles.host} testID={testID}>
      {visibleOptions.map((opt) => {
        const selected = value === opt.id;
        const disabled = opt.id === "stay" && stayDisabled;
        return (
          <Pressable
            key={opt.id}
            onPress={() => onChange(opt.id)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`${opt.label}. ${opt.description}${
              disabled ? ". Temporarily unavailable" : ""
            }`}
            accessibilityState={{ selected, disabled }}
            style={({ pressed }) => [
              styles.cardOuter,
              pressed && styles.pressed,
              disabled && styles.disabled,
            ]}
          >
            <GlassCard
              variant={selected ? "elevated" : "base"}
              padding={spacing.md}
            >
              <Text style={[styles.title, selected && styles.titleOn]}>
                {opt.label}
              </Text>
              <Text style={styles.desc}>{opt.description}</Text>
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
    gap: spacing.sm,
  },
  cardOuter: {
    borderRadius: radiusTokens.lg,
  },
  pressed: {
    opacity: 0.88,
  },
  disabled: {
    opacity: 0.5,
  },
  title: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  titleOn: {
    color: accent.warm,
  },
  desc: {
    marginTop: 4,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
  },
});

export default VenueCategoryPicker;
