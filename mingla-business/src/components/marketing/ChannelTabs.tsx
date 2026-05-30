/**
 * ChannelTabs — 3-segment tab row (Email · SMS · RCS) inside the composer
 * Step 2 "What" card.
 *
 * Phase B: Email active. SMS + RCS rendered visibly but disabled with a
 * "pending" caption. This enforces I-PROPOSED-BS (literal `email`, `sms`,
 * `rcs` strings co-located in this file — checked by strict-grep gate so
 * future phases plugging in SMS/RCS know exactly where to enable them).
 *
 * Accessibility (I-39): every Pressable has accessibilityLabel +
 * accessibilityState.disabled.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export type MarketingChannelKind = "email" | "sms" | "rcs";

export interface ChannelTabsProps {
  active: MarketingChannelKind;
  onChange: (kind: MarketingChannelKind) => void;
}

interface TabSpec {
  kind: MarketingChannelKind;
  label: string;
  enabled: boolean;
  caption: string;
}

const TABS: ReadonlyArray<TabSpec> = [
  { kind: "email", label: "Email", enabled: true, caption: "" },
  { kind: "sms", label: "SMS", enabled: false, caption: "pending" },
  { kind: "rcs", label: "RCS", enabled: false, caption: "pending" },
];

export const ChannelTabs: React.FC<ChannelTabsProps> = ({ active, onChange }) => {
  return (
    <View style={styles.host} accessibilityRole="tablist">
      {TABS.map((tab) => {
        const isActive = tab.kind === active;
        const disabled = !tab.enabled;
        return (
          <Pressable
            key={tab.kind}
            onPress={() => {
              if (!disabled) onChange(tab.kind);
            }}
            disabled={disabled}
            accessibilityRole="tab"
            accessibilityLabel={
              tab.enabled
                ? `${tab.label} channel`
                : `${tab.label} channel (${tab.caption})`
            }
            accessibilityState={{ selected: isActive, disabled }}
            style={({ pressed }) => [
              styles.tab,
              isActive ? styles.tabActive : null,
              disabled ? styles.tabDisabled : null,
              pressed && !disabled ? styles.tabPressed : null,
            ]}
          >
            <Text
              style={[
                styles.label,
                isActive ? styles.labelActive : styles.labelInactive,
                disabled ? styles.labelDisabled : null,
              ]}
            >
              {tab.label}
            </Text>
            {tab.caption.length > 0 ? (
              <Text style={styles.caption}>{tab.caption}</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flexDirection: "row",
    gap: spacing.xs,
    padding: spacing.xs,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: glass.tint.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
  },
  tab: {
    flex: 1,
    minHeight: 44,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  tabActive: {
    backgroundColor: "rgba(235, 120, 37, 0.18)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accent.border,
  },
  tabDisabled: {
    opacity: 0.5,
  },
  tabPressed: {
    opacity: 0.82,
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
  labelDisabled: {
    color: textTokens.tertiary,
  },
  caption: {
    ...typography.labelCap,
    color: textTokens.tertiary,
    fontSize: 10,
    letterSpacing: 1,
  },
});
