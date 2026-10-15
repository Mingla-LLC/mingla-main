/**
 * #3720 Slice G — Community · Support · Guides segmented control.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import type { HelpSupportTabId } from "../../utils/helpSupportLastTab";

type TabDef = {
  id: HelpSupportTabId;
  label: string;
};

const TABS: readonly TabDef[] = [
  { id: "community", label: "Community" },
  { id: "support", label: "Support" },
  { id: "guides", label: "Guides" },
];

export type HelpSupportHubTabsProps = {
  active: HelpSupportTabId;
  onChange: (tab: HelpSupportTabId) => void;
  /** Unread announcements — shown as a count on Community. */
  communityBadge?: number;
};

export const HelpSupportHubTabs: React.FC<HelpSupportHubTabsProps> = ({
  active,
  onChange,
  communityBadge = 0,
}) => (
  <View style={styles.host} accessibilityRole="tablist">
    <View style={styles.bar}>
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        const showBadge = tab.id === "community" && communityBadge > 0;
        return (
          <Pressable
            key={tab.id}
            onPress={() => onChange(tab.id)}
            style={({ pressed }) => [
              styles.pill,
              isActive ? styles.pillActive : styles.pillInactive,
              pressed && !isActive ? styles.pillPressed : null,
            ]}
            accessibilityRole="tab"
            accessibilityLabel={
              showBadge
                ? `${tab.label}, ${communityBadge} unread`
                : tab.label
            }
            accessibilityState={{ selected: isActive }}
            hitSlop={6}
          >
            <Text
              style={[
                styles.label,
                isActive ? styles.labelActive : styles.labelInactive,
              ]}
              numberOfLines={1}
            >
              {tab.label}
            </Text>
            {showBadge ? (
              <View style={styles.badge} accessibilityElementsHidden>
                <Text style={styles.badgeText}>
                  {communityBadge > 9 ? "9+" : String(communityBadge)}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  </View>
);

const styles = StyleSheet.create({
  host: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  bar: {
    flexDirection: "row",
    gap: spacing.xs,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderRadius: 12,
    padding: 4,
  },
  pill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 36,
    borderRadius: 10,
    paddingHorizontal: spacing.sm,
  },
  pillActive: {
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  pillInactive: {
    backgroundColor: "transparent",
  },
  pillPressed: {
    opacity: 0.7,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: -0.1,
  },
  labelActive: {
    color: textTokens.primary,
  },
  labelInactive: {
    color: textTokens.tertiary,
  },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: accent.warm,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#ffffff",
  },
});
