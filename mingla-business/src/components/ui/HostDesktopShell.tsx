/**
 * HostDesktopShell — #4420 (spec §3.4 / B6). Desktop chrome for every
 * signed-in host route OUTSIDE app/(tabs).
 *
 * Wraps the root Stack. On wide desktop (the gate stays in
 * useResponsiveLayout, I-DESKTOP-GATE-VIA-HOOK), for a signed-in host, the
 * route table (hostDesktopShellRoutes) picks:
 *   sidebar → the 248 grouped sidebar + the web top bar,
 *   rail    → the 80 icon rail + the web top bar (wizard / full-screen),
 *   tabs    → nothing here: (tabs)/_layout mounts the same sidebar itself,
 *   none    → nothing: auth, public buyer routes, door / scanner, own-rail wizards.
 * Phones, native and signed-out visitors get a pure passthrough.
 *
 * ONE TREE (#4273): the Stack always sits in the same slot of the same View,
 * so moving between routes (or resizing) never remounts navigation. The rank
 * gate applies to sidebar items exactly as in (tabs) (navTabGate).
 */

import React, { Suspense, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useGlobalSearchParams, usePathname, useSegments } from "expo-router";

import { color, space } from "../../constants/designSystem";
import { DESKTOP_BEZEL_MARGIN, DESKTOP_RAIL_WIDTH, DESKTOP_SIDEBAR_WIDTH } from "../../constants/desktopLayout";
import { isTabVisible } from "../../config/featureFlags";
import { useAuth } from "../../context/AuthContext";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { useCurrentBrandStore } from "../../store/currentBrandStore";
import { visibleTabsForRank } from "../../utils/navTabGate";

import { DesktopSidebar, SIDEBAR_SOURCE_TABS } from "./DesktopSidebar";
import { useDesktopSidebarStore } from "./desktopSidebarState";
import { hostDesktopShellModeFor } from "./hostDesktopShellRoutes";
import { HostShellInsetContext } from "./hostShellContext";
import { TopBar } from "./TopBar";

const LazyBrandSwitcherSheet = React.lazy(async () => {
  const mod = await import("../brand/BrandSwitcherSheet");
  return { default: mod.BrandSwitcherSheet };
});

/** The rank-gated sidebar, mounted only when the shell is active. */
const ShellSidebar: React.FC<{ rail: boolean }> = ({ rail }) => {
  const currentBrandId = useCurrentBrandStore((s) => s.currentBrandId);
  const { rank } = useCurrentBrandRole(currentBrandId);
  const tabs = visibleTabsForRank(SIDEBAR_SOURCE_TABS, rank).filter((tab) => isTabVisible(tab.id));
  return <DesktopSidebar tabs={tabs} forceRail={rail} testID="host-shell-sidebar" />;
};

const ShellTopBar: React.FC = () => {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  return (
    <View style={styles.topBar} testID="host-shell-topbar">
      <TopBar leftKind="brand" onBrandTap={() => setSwitcherOpen(true)} />
      {switcherOpen ? (
        <Suspense fallback={null}>
          <LazyBrandSwitcherSheet visible onClose={() => setSwitcherOpen(false)} />
        </Suspense>
      ) : null}
    </View>
  );
};

export const HostDesktopShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isWideDesktop } = useResponsiveLayout();
  const pathname = usePathname();
  const segments = useSegments();
  const { user } = useAuth();
  const collapsed = useDesktopSidebarStore((s) => s.collapsed);
  const { mode: editModeParam } = useGlobalSearchParams<{ mode?: string | string[] }>();
  const editMode = Array.isArray(editModeParam) ? editModeParam[0] : editModeParam;
  const mode = hostDesktopShellModeFor(pathname, segments as readonly string[], editMode ?? null);
  const active = Platform.OS === "web" && isWideDesktop && user != null && (mode === "sidebar" || mode === "rail");
  const rail = mode === "rail";
  const inset = active ? (rail || collapsed ? DESKTOP_RAIL_WIDTH : DESKTOP_SIDEBAR_WIDTH) : 0;

  return (
    <HostShellInsetContext.Provider value={active}>
      <View style={[styles.host, active ? [styles.canvas, { paddingLeft: inset + DESKTOP_BEZEL_MARGIN }] : null]}>
        {active ? <ShellTopBar /> : null}
        <View style={styles.stack}>{children}</View>
      </View>
      {active ? <ShellSidebar rail={rail} /> : null}
    </HostShellInsetContext.Provider>
  );
};

const styles = StyleSheet.create({
  host: { flex: 1 },
  canvas: { backgroundColor: color.canvas },
  topBar: { paddingTop: space[4], paddingRight: DESKTOP_BEZEL_MARGIN, paddingBottom: space[2] },
  stack: { flex: 1 },
});

export default HostDesktopShell;
