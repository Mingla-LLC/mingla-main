/**
 * HubSubNav (ORCH-0826) — sticky sub-navigation bar for the Hub tab.
 *
 * Pills: Events / Experiences / Trips / Venues. Active pill resolved from
 * `usePathname()` against the `/hub/{events|experiences|trips|listing}` route
 * structure. Tapping a pill navigates to the corresponding sub-route.
 *
 * #1565 — every data-driven pill carries its count ("Venues · 3"); see
 * `hubPillLabel` for the one case that renders a bare label instead.
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
  // #1565 — label pluralised to "Venues": every pill names the COLLECTION its
  // count belongs to, and the pill can legitimately carry more than one venue.
  { id: "venue", label: "Venues", route: "/(tabs)/hub/listing" },
] as const;

const LABELS: Record<HubDataDrivenTabId, string> = {
  getstarted: "Get started",
  events: "Events",
  trips: "Trips",
  experiences: "Experiences",
  venue: "Venues",
};

// ORCH-1145 — single source of truth for tab-name → real route. The Hub
// layout's nav-lock redirect (`_layout.tsx`) MUST resolve through this map
// instead of string-concatenating the bare tab name: the Venue tab's file is
// `listing.tsx` (route `/(tabs)/hub/listing`), so a bare `venue` would build
// the non-existent `/(tabs)/hub/venue` → expo-router 404. Exported so there is
// exactly ONE place that knows `venue → listing`.
export const HUB_TAB_ROUTES: Record<HubDataDrivenTabId, string> = {
  getstarted: "/(tabs)/hub/getstarted",
  events: "/(tabs)/hub/events",
  trips: "/(tabs)/hub/trips",
  experiences: "/(tabs)/hub/experiences",
  venue: "/(tabs)/hub/listing",
};

const ROUTES = HUB_TAB_ROUTES;

export const detectActiveSubTab = (pathname: string): HubDataDrivenTabId => {
  const lower = pathname.toLowerCase();
  if (lower.includes("/hub/getstarted")) return "getstarted";
  if (lower.includes("/hub/experiences")) return "experiences";
  if (lower.includes("/hub/trips")) return "trips";
  // ORCH-1145 — Venue tab route file is `listing.tsx` → URL `/(tabs)/hub/listing`.
  if (lower.includes("/hub/listing")) return "venue";
  return "events"; // default: Events sub-route is the Hub landing
};

/**
 * #1565 — the visible text of one Hub pill.
 *
 * A data-driven pill reads `"<Label> · <count>"`. Two ids never take a count:
 *
 *  - `getstarted` is an action, not a collection (pre-existing rule).
 *  - `venue` at ZERO. `deriveHubVisibleTabs` (useHubTabs.ts) shows the Venue
 *    pill when `venueCount > 0` OR one of the legacy `hasPhysicalLocation` /
 *    `hasPlacePool` arms fires. In that second case the tab exists for a
 *    reason that has nothing to do with how many venues the brand has, so
 *    "Venues · 0" would be a lie about a tab that is standing there for
 *    another purpose. Rendering the bare label instead makes
 *    **"Venues · 0" unreachable by construction** — the invariant #1565 tests.
 *
 * The count itself is EVERY venue the brand has, in any state, including one
 * still in review: it is exactly as wide as the pill's own existence gate.
 * Claim status lives on each venue's row and in the to-do list, not on a tab.
 *
 * Scoped to `venue` deliberately. Events/Trips/Experiences keep today's
 * behaviour verbatim (their count is the PUBLISHED count while their gate also
 * ORs the draft count, so a legitimate "Events · 0" exists for a draft-only
 * brand — out of scope here, do not fold it in).
 */
export const hubPillLabel = (
  id: HubDataDrivenTabId,
  label: string,
  count: number | undefined,
): string => {
  if (count === undefined) return label;
  if (id === "getstarted") return label;
  if (id === "venue" && count <= 0) return label;
  return `${label} · ${count}`;
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
                {hubPillLabel(tab.id, tab.label, count)}
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
