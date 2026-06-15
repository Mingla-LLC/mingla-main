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

export type HubSubTabId = "events" | "experiences" | "trips" | "venue";
export type HubDataDrivenTabId = HubSubTabId | "getstarted";

interface HubSubTab {
  readonly id: HubDataDrivenTabId;
  readonly label: string;
  readonly route: string;
}

const SUB_TABS: readonly HubSubTab[] = [
  { id: "events", label: "Events", route: "/(tabs)/hub/events" },
  { id: "experiences", label: "Experiences", route: "/(tabs)/hub/experiences" },
  { id: "trips", label: "Trips", route: "/(tabs)/hub/trips" },
  // ORCH-1145 — conditional Venue pill (rightmost peer; visibility gated in
  // deriveHubVisibleTabs on hasPhysicalLocation || placePoolId).
  { id: "venue", label: "Venue", route: "/(tabs)/hub/listing" },
] as const;

const LABELS: Record<HubDataDrivenTabId, string> = {
  getstarted: "Get started",
  events: "Events",
  trips: "Trips",
  experiences: "Experiences",
  venue: "Venue",
};

const ROUTES: Record<HubDataDrivenTabId, string> = {
  getstarted: "/(tabs)/hub/getstarted",
  events: "/(tabs)/hub/events",
  trips: "/(tabs)/hub/trips",
  experiences: "/(tabs)/hub/experiences",
  venue: "/(tabs)/hub/listing",
};

export const detectActiveSubTab = (pathname: string): HubDataDrivenTabId => {
  const lower = pathname.toLowerCase();
  if (lower.includes("/hub/getstarted")) return "getstarted";
  if (lower.includes("/hub/experiences")) return "experiences";
  if (lower.includes("/hub/trips")) return "trips";
  // ORCH-1145 — Venue tab route file is `listing.tsx` → URL `/(tabs)/hub/listing`.
  if (lower.includes("/hub/listing")) return "venue";
  return "events"; // default: Events sub-route is the Hub landing
};

export interface HubSubNavProps {
  visibleTabs?: readonly HubDataDrivenTabId[];
  counts?: Partial<Record<HubDataDrivenTabId, number>>;
  loading?: boolean;
  onTabPress?: (tab: HubDataDrivenTabId) => void;
}

export const HubSubNav: React.FC<HubSubNavProps> = ({
  visibleTabs,
  counts,
  loading = false,
  onTabPress,
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const activeId = detectActiveSubTab(pathname);
  const tabs =
    visibleTabs === undefined
      ? SUB_TABS
      : visibleTabs.map((id) => ({
          id,
          label: LABELS[id],
          route: ROUTES[id],
        }));

  if (loading) {
    return (
      <View style={styles.host}>
        <View style={styles.content}>
          <View style={styles.shimmerPill} />
          <View style={styles.shimmerPill} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.host}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          const count = counts?.[tab.id];
          return (
            <Pressable
              key={tab.id}
              accessibilityRole="tab"
              accessibilityLabel={`${tab.label} sub-tab`}
              accessibilityState={{ selected: isActive }}
              onPress={() => {
                onTabPress?.(tab.id);
                router.push(tab.route as never);
              }}
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
                {count !== undefined && tab.id !== "getstarted"
                  ? `${tab.label} · ${count}`
                  : tab.label}
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
    flexDirection: "row",
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
  shimmerPill: {
    width: 116,
    height: 38,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: glass.tint.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
  },
});

export default HubSubNav;
