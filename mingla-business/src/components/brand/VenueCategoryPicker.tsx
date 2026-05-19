/**
 * Ve1 — category pills (Restaurant / Play / Creative and arts).
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

export interface VenueCategoryPickerProps {
  value: VenueCategory | null;
  onChange: (next: VenueCategory) => void;
  testID?: string;
}

export const VenueCategoryPicker: React.FC<VenueCategoryPickerProps> = ({
  value,
  onChange,
  testID,
}) => {
  return (
    <View style={styles.host} testID={testID}>
      {OPTIONS.map((opt) => {
        const selected = value === opt.id;
        return (
          <Pressable
            key={opt.id}
            onPress={() => onChange(opt.id)}
            accessibilityRole="button"
            accessibilityLabel={`${opt.label}. ${opt.description}`}
            accessibilityState={{ selected }}
            style={({ pressed }) => [
              styles.cardOuter,
              pressed && styles.pressed,
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
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  cardOuter: {
    borderRadius: radiusTokens.lg,
  },
  pressed: {
    opacity: 0.88,
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
