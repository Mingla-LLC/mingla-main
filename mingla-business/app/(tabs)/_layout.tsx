/**
 * (tabs) layout — renders the active tab via `<Slot />` and our custom
 * glass `BottomNav` capsule below it.
 *
 * Per DEC-073: was 3 fixed tabs (Home / Events / Account). Updated to
 * 4 tabs in ORCH-0815-B (Cycle B5 — Marketing Hub, DEC-149 dual-surface).
 * Updated to current 5 tabs in ORCH-0826 (Mingla Business 1.2 M0): the
 * "Events" tab was renamed to "Hub" with three sub-routes (events /
 * experiences / trips). The Hub tab id is `hub`; the `detectActiveTab`
 * logic resolves nested routes (`/hub/events`, `/hub/experiences`, etc.)
 * via the existing `startsWith(prefix + "/")` clause.
 */

import React, { Suspense, useMemo } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Slot, useRouter, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BottomNav } from "../../src/components/ui/BottomNav";
import type { BottomNavTab } from "../../src/components/ui/BottomNav";
// ORCH-0885-A: DesktopCanvas wraps Slot children. On native + narrow web
// (<1024px) it's a passthrough Fragment — zero layout cost. On web ≥1024px
// it paints the Tier-1 ambient gradient + centres content inside a
// max-width 640px column. Per SPEC_ORCH-0885-A §3.
import { DesktopCanvas } from "../../src/components/ui/DesktopCanvas";
import { canvas, spacing } from "../../src/constants/designSystem";
import { useResponsiveLayout } from "../../src/hooks/useResponsiveLayout";
// ORCH-1055 (META-ORCH-1048 sub-F): rank-aware tab filtering. The TABS
// array below is the registered superset; the actual visible set is
// derived per-render from the caller's rank on the current brand. A
// rank-10 scanner sees Home + Account only (no Hub / Ari / Blast). The
// per-action `MIN_RANK` chokepoint in `permissionGates.ts` still gates
// destructive actions inside surviving surfaces; RLS remains the ultimate
// safety net.
import { useCurrentBrandRole } from "../../src/hooks/useCurrentBrandRole";
import { useCurrentBrandStore } from "../../src/store/currentBrandStore";
import { visibleTabsForRank } from "../../src/utils/navTabGate";

import { CommandPaletteHost } from "../../src/components/ui/CommandPaletteHost";
import { GlobalSearchSheetHost } from "../../src/components/ui/GlobalSearchSheetHost";

const TABS: BottomNavTab[] = [
  { id: "home", icon: "home", label: "Home" },
  // ORCH-0826 (Mingla Business 1.2 M0): tab id `events` renamed to `hub`,
  // label "Events" → "Hub". Hub houses three sub-routes: Events
  // (relocated, today's content unchanged), Experiences (placeholder for
  // Ve5+), Trips (placeholder for Tr2+). The `calendar` icon is preserved
  // since Events is the default sub-route.
  { id: "hub", icon: "calendar", label: "Hub" },
  // Ari sits in the middle slot — AI assistant as the visual/thumb center
  // of the capsule, with creation (Events) on its left and broadcast
  // (Blast) on its right. Account stays rightmost (thumb-edge = settings,
  // muscle memory).
  { id: "ari", icon: "sparkle", label: "Ari" },
  // Marketing Hub. Tab id stays `marketing` (so every `/(tabs)/marketing/*`
  // route resolves correctly), label is the shorter "Blast" — mirrors the
  // verb used in every primary CTA ("Blast these N buyers"). `send` icon
  // (paper-plane) is the closest semantic match for broadcast/campaign in
  // the existing icon set.
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
  const { isWideDesktop } = useResponsiveLayout();

  // ORCH-1055: derive visible tabs from the caller's rank on the current
  // brand. While the role query is loading (rank defaults to 0 in the
  // hook's pending state) we render the safer scanner-shape (Home + Account)
  // to avoid a one-frame flash of brand-management tabs to a scanner. The
  // full set hydrates on the next render once the query resolves.
  const currentBrandId = useCurrentBrandStore((s) => s.currentBrandId);
  const { rank } = useCurrentBrandRole(currentBrandId);
  const visibleTabs = useMemo(() => visibleTabsForRank(TABS, rank), [rank]);

  const activeId = useMemo(() => detectActiveTab(pathname), [pathname]);

  // Focused authoring surfaces hide the mobile bottom capsule so the route's
  // own sticky footer is not covered. Desktop web keeps the left rail visible
  // as persistent app chrome.
  const hideBottomNav = pathname.includes("/campaigns/compose") && !isWideDesktop;

  const handleChange = (id: string): void => {
    // Expo Router resolves /(tabs)/<id> to /<id> at runtime.
    router.push(`/(tabs)/${id}` as never);
  };

  return (
    <View style={styles.host}>
      <DesktopCanvas>
        <Slot />
      </DesktopCanvas>
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
          <BottomNav tabs={visibleTabs} active={activeId} onChange={handleChange} />
        </View>
      )}
      {/* ORCH-1093: keep desktop command UI out of phone route entry. */}
      {Platform.OS === "web" && isWideDesktop ? <CommandPaletteHost /> : null}
      {/* META-ORCH-1073 Sub-A: the global search sheet — single mount,
          reachable from every default-cluster screen on all surfaces
          (native bottom sheet / narrow-web bottom sheet / wide-desktop
          centred card, resolved by the Sheet primitive). */}
      <Suspense fallback={null}>
        <GlobalSearchSheetHost />
      </Suspense>
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
