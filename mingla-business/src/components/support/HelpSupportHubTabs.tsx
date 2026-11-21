/**
 * #4420 — Help & Support's two tabs on a phone: Announcements and Support.
 * (Desktop shows both as columns, so it has no tabs.) Replaces #3720's
 * three-tab control.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  color,
  space,
} from "../../constants/designSystem";
import type { HelpSupportTab } from "./helpSupportRoute";
import { hubCopy } from "./helpSupportHubCopy";

type TabDef = {
  id: HelpSupportTab;
  label: string;
};

const TABS: readonly TabDef[] = [
  { id: "announcements", label: hubCopy("tabs.announcements") },
  { id: "support", label: hubCopy("tabs.support") },
];

export type HelpSupportHubTabsProps = {
  active: HelpSupportTab;
  onChange: (tab: HelpSupportTab) => void;
  /** Unread announcements, shown as a count on Announcements ("9+" cap). */
  announcementsBadge?: number;
};

export const HelpSupportHubTabs: React.FC<HelpSupportHubTabsProps> = ({
  active,
  onChange,
  announcementsBadge = 0,
}) => (
  <View style={styles.host} accessibilityRole="tablist" accessibilityLabel={hubCopy("tabs.label")}>
    <View style={styles.bar}>
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        const showBadge = tab.id === "announcements" && announcementsBadge > 0;
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
                ? hubCopy("tabs.unread", { label: tab.label, count: announcementsBadge })
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
                  {announcementsBadge > 9 ? "9+" : String(announcementsBadge)}
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
    paddingHorizontal: space[4],
    paddingTop: space[1],
    paddingBottom: space[2],
  },
  bar: {
    flexDirection: "row",
    gap: space[1],
    backgroundColor: color.fill.inset,
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
    paddingHorizontal: space[2],
  },
  pillActive: {
    backgroundColor: color.fill.tabOn,
    borderWidth: 1,
    borderColor: color.lineStrong,
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
    color: color.text1,
  },
  labelInactive: {
    color: color.text3,
  },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: color.badge,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: color.textStrong,
  },
});
