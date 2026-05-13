/**
 * (tabs) layout — renders the active tab via `<Slot />` and our custom
 * glass `BottomNav` capsule below it.
 *
 * Per DEC-073: was 3 fixed tabs (Home / Events / Account). Updated to
 * 4 tabs in ORCH-0815-B (Cycle B5 — Marketing Hub, DEC-149 dual-surface).
 * The Marketing tab sits between Events and Account: brand creates events,
 * blasts about them via Marketing, manages account profile. `send` icon
 * (paper plane) chosen over `megaphone` (not in icon set) per design §3.1
 * — it reads as "broadcast / campaign" and lives in the icon set already.
 */

import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Slot, useRouter, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BottomNav } from "../../src/components/ui/BottomNav";
import type { BottomNavTab } from "../../src/components/ui/BottomNav";
import { canvas, spacing } from "../../src/constants/designSystem";

const TABS: BottomNavTab[] = [
  { id: "home", icon: "home", label: "Home" },
  { id: "events", icon: "calendar", label: "Events" },
  // ORCH-0815-B (DEC-149): Marketing Hub. Tab id stays `marketing` (so
  // every `/(tabs)/marketing/*` route resolves correctly), label is the
  // shorter "Blast" (5 chars) — fits the 4-tab capsule without clipping
  // AND mirrors the verb used in every primary CTA ("Blast these N
  // buyers"). `send` icon (paper-plane) is the closest semantic match
  // for "broadcast / campaign" in the existing icon set. Sub-routes
  // live under `/(tabs)/marketing/{overview, audiences, campaigns,
  // templates}` with a sticky MarketingSubNav.
  { id: "marketing", icon: "send", label: "Blast" },
  { id: "account", icon: "user", label: "Account" },
];

const DEFAULT_TAB_ID = "home";

const detectActiveTab = (pathname: string): string => {
  // ORCH-0815-B fix: nested tab routes (e.g. `/marketing/audiences`,
  // `/marketing/campaigns`) MUST resolve to their parent tab — previous
  // `endsWith` check failed because the path ends with the sub-route id,
  // not the tab id, and fell through to DEFAULT_TAB_ID="home" so the
  // active dot jumped to Home when the user switched Marketing sub-tabs.
  // New rule: a tab is active if the pathname is exactly `/${tabId}` OR
  // starts with `/${tabId}/` (nested route boundary).
  const lower = pathname.toLowerCase();
  const match = TABS.find((tab) => {
    const prefix = `/${tab.id}`;
    return lower === prefix || lower.startsWith(`${prefix}/`);
  });
  return match?.id ?? DEFAULT_TAB_ID;
};

export default function TabsLayout(): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  const activeId = useMemo(() => detectActiveTab(pathname), [pathname]);

  // Focused authoring surfaces hide the BottomNav so the route's own
  // sticky footer (e.g. ComposerFooter's Save draft + Review & schedule)
  // isn't covered. Currently: marketing composer (ORCH-0815-B).
  const hideBottomNav = pathname.includes("/campaigns/compose");

  const handleChange = (id: string): void => {
    // Expo Router resolves /(tabs)/<id> to /<id> at runtime.
    router.push(`/(tabs)/${id}` as never);
  };

  return (
    <View style={styles.host}>
      <Slot />
      {hideBottomNav ? null : (
        <View
          pointerEvents="box-none"
          style={[
            styles.navWrap,
            {
              paddingBottom: Math.max(insets.bottom, spacing.sm),
              paddingTop: spacing.sm,
            },
          ]}
        >
          <BottomNav tabs={TABS} active={activeId} onChange={handleChange} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    // App canvas — shows through the safe-area zone behind the floating nav
    // so the home-indicator area blends seamlessly with the dark theme. The
    // BottomNav is a floating capsule positioned absolute on top.
    backgroundColor: canvas.discover,
  },
  navWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
  },
});
