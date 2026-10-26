/**
 * MarketingSubNav — sticky 4-pill segmented control inside the Marketing tab
 * (ORCH-0815-B foundation).
 *
 * Sits at the top of every `/(tabs)/marketing/*` route (except composer,
 * which hides it). Pills: Overview · Campaigns · Ads · Creators · Referrals ·
 * People · Templates (#3872 round 2).
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

import React, { useEffect, useRef } from "react";
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
import {
  MARKETING_SUB_NAV_TABS,
  detectMarketingSubNavActive,
  type MarketingSubNavId,
} from "./marketingSubNavTabs";

export type { MarketingSubNavId } from "./marketingSubNavTabs";

/**
 * #3872 round 2 — seven sections (Overview, Campaigns, Ads, Creators,
 * Referrals, People, Templates). The row scrolls sideways and every pill is
 * sized to its own label, so no name is ever cut off ("Campai…").
 */
export const MarketingSubNav: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<Partial<Record<MarketingSubNavId, number>>>({});
  const active = detectMarketingSubNavActive(pathname);
  // Keep the active pill in view when a deep link lands on a later section.
  useEffect(() => {
    const x = offsets.current[active];
    if (typeof x === "number") {
      scrollRef.current?.scrollTo({ x: Math.max(0, x - spacing.xl), animated: false });
    }
  }, [active]);
  // Composer is a child route of Campaigns, NOT a sub-nav tab — hide the
  // pill row while the operator is authoring a campaign.
  if (pathname.includes("/campaigns/compose")) return null;

  return (
    <View style={styles.host}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.bar}
        accessibilityRole="tablist"
      >
        {MARKETING_SUB_NAV_TABS.map((tab) => {
          const isActive = tab.id === active;
          return (
            <Pressable
              key={tab.id}
              onLayout={(event) => {
                offsets.current[tab.id] = event.nativeEvent.layout.x;
              }}
              onPress={() => router.replace(tab.path as never)}
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

const PILL_HEIGHT = 36;

const styles = StyleSheet.create({
  host: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  pill: {
    height: PILL_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
  },
  pillActive: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  pillInactive: {
    backgroundColor: glass.tint.chrome.idle,
    borderColor: glass.border.chrome,
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
