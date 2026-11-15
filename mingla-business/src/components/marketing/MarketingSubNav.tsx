/**
 * MarketingSubNav — sticky, sideways-scrolling section row inside the Blast tab
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

import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter, usePathname } from "expo-router";

import { color, radius, space, type } from "../../constants/designSystem";
import {
  MARKETING_SECTION_TITLES,
  MARKETING_SUB_NAV_TABS,
  detectMarketingSubNavActive,
  type MarketingSubNavId,
} from "./marketingSubNavTabs";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { useMarketingAction } from "./MarketingActionContext";
import { MarketingActionButton } from "./MarketingActionButton";

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
  const offsets = useRef<Partial<Record<MarketingSubNavId, { x: number; width: number }>>>({});
  const [viewportWidth, setViewportWidth] = useState(0);
  const { isWideDesktop } = useResponsiveLayout();
  const action = useMarketingAction();
  const active = detectMarketingSubNavActive(pathname);
  // Keep the active pill in view when a deep link lands on a later section.
  useEffect(() => {
    const frame = offsets.current[active];
    if (frame && viewportWidth > 0) {
      scrollRef.current?.scrollTo({
        x: Math.max(0, frame.x + frame.width / 2 - viewportWidth / 2),
        animated: false,
      });
    }
  }, [active, viewportWidth]);
  // Composer is a child route of Campaigns, NOT a sub-nav tab — hide the
  // pill row while the operator is authoring a campaign.
  if (pathname.includes("/campaigns/compose")) return null;

  // #4420 — desktop: the sidebar already lists every section, so the page
  // opens with the kit's header row instead: the section title on the left
  // and the section's one action (full label) on the right.
  if (isWideDesktop) {
    return (
      <View style={styles.deskHeader} testID="marketing-desk-header">
        <Text style={styles.deskTitle} accessibilityRole="header">
          {MARKETING_SECTION_TITLES[active]}
        </Text>
        <MarketingActionButton action={action} />
      </View>
    );
  }

  // #4420 — phone: the pills alone. The section action is the shell's
  // floating button; the compact circle that sat on top of the pill row
  // duplicated it and covered the last visible pill.
  return (
    <View style={styles.host}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.bar}
        accessibilityRole="tablist"
        onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
      >
        {MARKETING_SUB_NAV_TABS.map((tab) => {
          const isActive = tab.id === active;
          return (
            <Pressable
              key={tab.id}
              onLayout={(event) => {
                offsets.current[tab.id] = {
                  x: event.nativeEvent.layout.x,
                  width: event.nativeEvent.layout.width,
                };
                if (tab.id === active && viewportWidth > 0) {
                  const frame = offsets.current[tab.id];
                  scrollRef.current?.scrollTo({
                    x: Math.max(
                      0,
                      (frame?.x ?? 0) + (frame?.width ?? 0) / 2 - viewportWidth / 2,
                    ),
                    animated: false,
                  });
                }
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
    flexDirection: "row",
    alignItems: "center",
    paddingTop: space[2],
    paddingBottom: space[2],
  },
  deskHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[4],
    paddingHorizontal: space[4],
    paddingTop: space[4],
    paddingBottom: space[2],
  },
  deskTitle: {
    ...type.title,
    color: color.text1,
    flexShrink: 1,
  },
  scroller: { flex: 1, minWidth: 0 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    paddingHorizontal: space[4],
  },
  pill: {
    height: PILL_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    paddingHorizontal: space[4],
    borderWidth: 1,
  },
  pillActive: {
    backgroundColor: color.fill.tabOn,
    borderColor: color.lineStrong,
  },
  pillInactive: {
    backgroundColor: color.fill.tile,
    borderColor: color.lineStrong,
  },
  pillPressed: {
    backgroundColor: color.fill.inset,
  },
  label: {
    ...type.caption,
  },
  labelActive: {
    color: color.text1,
  },
  labelInactive: {
    color: color.text2,
  },
});
