/**
 * CampaignFilterPills — row of pills: All · Scheduled · Sent · Drafts · Failed.
 */

import React from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { CampaignStatus } from "../../types/marketing";

export type CampaignFilter = CampaignStatus | "all";

export interface CampaignFilterPillsProps {
  active: CampaignFilter;
  onChange: (filter: CampaignFilter) => void;
}

interface Option {
  value: CampaignFilter;
  label: string;
}

const OPTIONS: ReadonlyArray<Option> = [
  { value: "all", label: "All" },
  { value: "scheduled", label: "Scheduled" },
  { value: "sent", label: "Sent" },
  { value: "draft", label: "Drafts" },
  { value: "failed", label: "Failed" },
];

export const CampaignFilterPills: React.FC<CampaignFilterPillsProps> = ({
  active,
  onChange,
}) => {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // flexGrow:0 prevents the ScrollView from filling its parent's
      // vertical flex space (which was stretching every pill into a
      // full-height capsule column).
      style={styles.scrollHost}
      contentContainerStyle={styles.host}
    >
      {OPTIONS.map((option) => {
        const isActive = option.value === active;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityLabel={`Filter campaigns: ${option.label}`}
            accessibilityState={{ selected: isActive }}
            style={({ pressed }) => [
              styles.pill,
              isActive ? styles.pillActive : null,
              pressed ? styles.pillPressed : null,
            ]}
          >
            <Text
              style={[
                styles.label,
                isActive ? styles.labelActive : styles.labelInactive,
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scrollHost: {
    flexGrow: 0,
    flexShrink: 0,
  },
  host: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pill: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    alignItems: "center",
    justifyContent: "center",
  },
  pillActive: {
    borderColor: accent.border,
    backgroundColor: "rgba(235, 120, 37, 0.18)",
  },
  pillPressed: {
    opacity: 0.85,
  },
  label: {
    ...typography.bodySm,
    fontWeight: "600",
  },
  labelActive: {
    color: textTokens.primary,
  },
  labelInactive: {
    color: textTokens.secondary,
  },
});
