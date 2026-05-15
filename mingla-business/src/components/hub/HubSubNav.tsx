/**
 * HubSubNav (ORCH-0826) — sticky sub-navigation bar for the Hub tab.
 *
 * Three pills: Events / Experiences / Trips. Active pill resolved from
 * `usePathname()` against the `/hub/{events|experiences|trips}` route
 * structure. Tapping a pill navigates to the corresponding sub-route.
 *
 * Mirrors the MarketingSubNav pattern at
 * `mingla-business/src/components/marketing/MarketingSubNav.tsx` for visual
 * + interaction parity.
 *
 * Per Q1 SPEC: hard sub-tabs (Pattern A) — each sub-tab is a real Expo Router
 * route under `app/(tabs)/hub/`.
 *
 * Mingla_Artifacts/specs/SPEC_ORCH-0826_M0_HUB_FOUNDATION.md §6.6
 */

import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter, usePathname } from "expo-router";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export type HubSubTabId = "events" | "experiences" | "trips";

interface HubSubTab {
  readonly id: HubSubTabId;
  readonly label: string;
  readonly route: string;
}

const SUB_TABS: readonly HubSubTab[] = [
  { id: "events", label: "Events", route: "/(tabs)/hub/events" },
  { id: "experiences", label: "Experiences", route: "/(tabs)/hub/experiences" },
  { id: "trips", label: "Trips", route: "/(tabs)/hub/trips" },
] as const;

export const detectActiveSubTab = (pathname: string): HubSubTabId => {
  const lower = pathname.toLowerCase();
  if (lower.includes("/hub/experiences")) return "experiences";
  if (lower.includes("/hub/trips")) return "trips";
  return "events"; // default: Events sub-route is the Hub landing
};

export const HubSubNav: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  const activeId = detectActiveSubTab(pathname);

  return (
    <View style={styles.host}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {SUB_TABS.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <Pressable
              key={tab.id}
              accessibilityRole="tab"
              accessibilityLabel={`${tab.label} sub-tab`}
              accessibilityState={{ selected: isActive }}
              onPress={() => router.push(tab.route as never)}
              style={[
                styles.pill,
                isActive ? styles.pillActive : styles.pillInactive,
              ]}
              testID={`hub-subtab-${tab.id}`}
            >
              <Text
                style={[
                  styles.pillLabel,
                  isActive ? styles.pillLabelActive : styles.pillLabelInactive,
                ]}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  content: {
    gap: spacing.sm,
  },
  pill: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 999, // pill radius
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillActive: {
    backgroundColor: accent.warm,
    borderColor: accent.warm,
  },
  pillInactive: {
    backgroundColor: glass.tint.profileBase,
    borderColor: glass.border.profileBase,
  },
  pillLabel: {
    fontSize: typography.bodySm?.fontSize ?? typography.body.fontSize,
    lineHeight: typography.bodySm?.lineHeight ?? typography.body.lineHeight,
    fontWeight: "600",
  },
  pillLabelActive: {
    color: "#0c0e12",
  },
  pillLabelInactive: {
    color: textTokens.secondary,
  },
});

export default HubSubNav;
