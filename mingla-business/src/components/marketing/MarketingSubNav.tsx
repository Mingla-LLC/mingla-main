/**
 * MarketingSubNav — sticky 4-pill segmented control inside the Marketing tab
 * (ORCH-0815-B foundation).
 *
 * Sits at the top of every `/(tabs)/marketing/*` route (except composer,
 * which hides it). Four pills: Overview · Audiences · Campaigns · Templates.
 * Active pill: `accent.tint` background + `accent.border`. Inactive: text
 * tertiary on transparent. Tap switches sub-route via expo-router `replace`.
 *
 * Animation: simple opacity / background fade on press. Per design §6.1
 * the full animated-spotlight is a polish target — Phase B foundation
 * ships with the simpler approach (static pill highlight) and the
 * spring-spotlight pattern from `BottomNav.tsx` lands as ORCH-0815-B-A
 * polish if needed. Functionally identical, visually slightly less
 * premium until then.
 *
 * Design ref: §6.1 (sub-nav specification).
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter, usePathname } from "expo-router";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export type MarketingSubNavId = "overview" | "audiences" | "campaigns" | "templates";

interface SubNavTab {
  id: MarketingSubNavId;
  label: string;
  /** Expo-router path (relative to `/(tabs)/marketing/`). */
  path: string;
}

const TABS: ReadonlyArray<SubNavTab> = [
  { id: "overview", label: "Overview", path: "/(tabs)/marketing" },
  { id: "audiences", label: "Audiences", path: "/(tabs)/marketing/audiences" },
  { id: "campaigns", label: "Campaigns", path: "/(tabs)/marketing/campaigns" },
  { id: "templates", label: "Templates", path: "/(tabs)/marketing/templates" },
];

function detectActive(pathname: string): MarketingSubNavId {
  const lower = pathname.toLowerCase();
  if (lower.includes("/marketing/audiences")) return "audiences";
  if (lower.includes("/marketing/campaigns")) return "campaigns";
  if (lower.includes("/marketing/templates")) return "templates";
  return "overview";
}

export const MarketingSubNav: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  // Composer is a child route of Campaigns, NOT a sub-nav tab — hide the
  // 4-pill segmented control while the operator is authoring a campaign.
  // SPEC §4.2 (ORCH-0815-B) + Phase A `_layout.tsx` deferred this to Phase B.
  if (pathname.includes("/campaigns/compose")) return null;
  const active = detectActive(pathname);

  const handleTabPress = (path: string): void => {
    router.replace(path as never);
  };

  return (
    <View style={styles.host}>
      <View style={styles.bar}>
        {TABS.map((tab) => {
          const isActive = tab.id === active;
          return (
            <Pressable
              key={tab.id}
              onPress={() => handleTabPress(tab.path)}
              style={({ pressed }) => [
                styles.pill,
                isActive ? styles.pillActive : styles.pillInactive,
                pressed && !isActive ? styles.pillPressed : null,
              ]}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
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
            </Pressable>
          );
        })}
      </View>
    </View>
  );
};

const SUB_NAV_HEIGHT = 44;
const PILL_HEIGHT = 36;

const styles = StyleSheet.create({
  host: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  bar: {
    height: SUB_NAV_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xs,
    backgroundColor: glass.tint.chrome.idle,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.chrome,
    borderRadius: radius.full,
  },
  pill: {
    flex: 1,
    height: PILL_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    marginHorizontal: 2,
    paddingHorizontal: spacing.xs,
  },
  pillActive: {
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  pillInactive: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "transparent",
  },
  pillPressed: {
    backgroundColor: glass.tint.profileBase,
  },
  label: {
    ...typography.caption,
  },
  labelActive: {
    color: textTokens.primary,
  },
  labelInactive: {
    color: textTokens.secondary,
  },
});
