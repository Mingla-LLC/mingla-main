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
 *
 * #4389 P6/P9 — the brand switcher is mounted in an overlay layer AFTER the
 * stack (zIndex above the sidebar's 50, starting right of it), never inside
 * the top-bar strip, so the panel always paints above the page. Its chunk is
 * prefetched on idle once the shell is active, so a first tap never shows
 * nothing on a slow connection.
 */

import React, { Suspense, useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useGlobalSearchParams, usePathname, useSegments } from "expo-router";

import { color, space } from "../../constants/designSystem";
import { DESKTOP_BEZEL_MARGIN, DESKTOP_RAIL_WIDTH, DESKTOP_SIDEBAR_WIDTH } from "../../constants/desktopLayout";
import { isTabVisible } from "../../config/featureFlags";
import { useAuth } from "../../context/AuthContext";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { useWorkspaceBrandRouteSync } from "../../hooks/useWorkspaceBrandRouteSync";
import { brandIdFromRoute, isAboveBrandScreen, phoneBrandStrip, type WorkspaceRouteParams } from "../../config/workspaceBrandRoute";
import { WorkspaceBrandSwitcher } from "../brand/WorkspaceBrandSwitcher";
import { WorkspaceRouteContext, type WorkspaceRoute } from "../brand/workspaceBrandContext";
import { useCurrentBrandStore } from "../../store/currentBrandStore";
import { visibleTabsForRank } from "../../utils/navTabGate";

import { DesktopSidebar, SIDEBAR_SOURCE_TABS } from "./DesktopSidebar";
import { useDesktopSidebarStore } from "./desktopSidebarState";
import { hostDesktopShellModeFor } from "./hostDesktopShellRoutes";
import { HostShellInsetContext } from "./hostShellContext";
import { useScreenOwnsBrandSwitcher } from "./phoneBrandSwitcherOwner";
import { TopBar } from "./TopBar";

const loadBrandSwitcherSheet = () => import("../brand/BrandSwitcherSheet");
const LazyBrandSwitcherSheet = React.lazy(async () => {
  const mod = await loadBrandSwitcherSheet();
  return { default: mod.BrandSwitcherSheet };
});

/** #4389 P9 cause C — the overlay sits above the fixed sidebar (zIndex 50). */
export const SHELL_SWITCHER_OVERLAY_Z = 60;

let switcherPrefetched = false;
/** #4389 P9 cause C — warm the switcher chunk once, on idle. */
const prefetchBrandSwitcherOnIdle = (): (() => void) => {
  if (switcherPrefetched) return () => undefined;
  const run = (): void => {
    if (switcherPrefetched) return;
    switcherPrefetched = true;
    loadBrandSwitcherSheet().catch(() => {
      // A failed warm-up is retried by the real open (React.lazy), which
      // surfaces its own error; allow another warm-up later.
      switcherPrefetched = false;
    });
  };
  const idle = (globalThis as {
    requestIdleCallback?: (cb: () => void) => number;
    cancelIdleCallback?: (id: number) => void;
  });
  if (typeof idle.requestIdleCallback === "function") {
    const id = idle.requestIdleCallback(run);
    return () => idle.cancelIdleCallback?.(id);
  }
  const timer = setTimeout(run, 1500);
  return () => clearTimeout(timer);
};

/** The rank-gated sidebar, mounted only when the shell is active. */
const ShellSidebar: React.FC<{ rail: boolean }> = ({ rail }) => {
  const currentBrandId = useCurrentBrandStore((s) => s.currentBrandId);
  const { rank } = useCurrentBrandRole(currentBrandId);
  const tabs = visibleTabsForRank(SIDEBAR_SOURCE_TABS, rank).filter((tab) => isTabVisible(tab.id));
  return <DesktopSidebar tabs={tabs} forceRail={rail} testID="host-shell-sidebar" />;
};

// #4453 — the brand name sits at the top of every brand screen and of none above brand level
// (Account, Notifications, Help, creating a brand): those are not about the brand last worked on.
const ShellTopBar: React.FC<{ onBrandTap: () => void; aboveBrand: boolean }> = ({ onBrandTap, aboveBrand }) => (
  <View style={styles.topBar} testID="host-shell-topbar">
    <TopBar leftKind={aboveBrand ? "none" : "brand"} onBrandTap={onBrandTap} />
  </View>
);

export const HostDesktopShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isWideDesktop } = useResponsiveLayout();
  const pathname = usePathname();
  const segments = useSegments();
  const { user } = useAuth();
  const collapsed = useDesktopSidebarStore((s) => s.collapsed);
  const globalParams = useGlobalSearchParams<{ mode?: string | string[] }>();
  const editModeParam = globalParams.mode;
  // #4453 — the route, shared with every brand chip and switcher below. The
  // route's brand is resolved here, in the render of the route change itself.
  const paramsKey = JSON.stringify(globalParams ?? {});
  const workspaceRoute = useMemo<WorkspaceRoute>(() => {
    const params = JSON.parse(paramsKey) as WorkspaceRouteParams;
    return { pathname: pathname ?? null, params, routeBrandId: brandIdFromRoute(pathname, params) };
  }, [paramsKey, pathname]);
  useWorkspaceBrandRouteSync(workspaceRoute.pathname, workspaceRoute.routeBrandId);
  const editMode = Array.isArray(editModeParam) ? editModeParam[0] : editModeParam;
  const mode = hostDesktopShellModeFor(pathname, segments as readonly string[], editMode ?? null);
  const active = Platform.OS === "web" && isWideDesktop && user != null && (mode === "sidebar" || mode === "rail");
  const rail = mode === "rail";
  const inset = active ? (rail || collapsed ? DESKTOP_RAIL_WIDTH : DESKTOP_SIDEBAR_WIDTH) : 0;
  const [switcherOpen, setSwitcherOpen] = useState(false);
  // #4453 — phones and narrow web: a brand's own screens (/brand/<id>/...) and one item of a brand
  // (a trip, an event, a listing...) open under a back bar that names the screen, not the brand. The brand being edited is named above it, and is the
  // switcher. (The Website workspace has it in its own bar and says so; desktop has the top bar;
  // native keeps its headers.)
  const screenOwnsSwitcher = useScreenOwnsBrandSwitcher();
  const phoneBrand = Platform.OS === "web" && !isWideDesktop && user != null && !screenOwnsSwitcher
    ? phoneBrandStrip(pathname, workspaceRoute.routeBrandId, mode)
    : null;

  useEffect(() => {
    if (!active) {
      // Leaving the shell (route or width) closes the switcher, so it never
      // reopens by itself when the shell comes back.
      setSwitcherOpen(false);
      return undefined;
    }
    return prefetchBrandSwitcherOnIdle();
  }, [active]);

  return (
    <WorkspaceRouteContext.Provider value={workspaceRoute}>
    <HostShellInsetContext.Provider value={active}>
      <View style={[styles.host, active ? [styles.canvas, { paddingLeft: inset + DESKTOP_BEZEL_MARGIN }] : null]}>
        {active ? <ShellTopBar onBrandTap={() => setSwitcherOpen(true)} aboveBrand={isAboveBrandScreen(pathname)} /> : null}
        {phoneBrand !== null ? (
          <View style={styles.phoneBrand} testID="host-phone-brand-strip">
            <WorkspaceBrandSwitcher brandId={phoneBrand.brandId} compact testID="host-phone-brand-switcher" />
          </View>
        ) : null}
        <View style={styles.stack}>{children}</View>
        {active && switcherOpen ? (
          <View
            style={[styles.overlayLayer, { left: inset + DESKTOP_BEZEL_MARGIN }]}
            testID="host-shell-switcher-overlay"
          >
            <Suspense fallback={null}>
              <LazyBrandSwitcherSheet visible onClose={() => setSwitcherOpen(false)} />
            </Suspense>
          </View>
        ) : null}
      </View>
      {active ? <ShellSidebar rail={rail} /> : null}
    </HostShellInsetContext.Provider>
    </WorkspaceRouteContext.Provider>
  );
};

const styles = StyleSheet.create({
  host: { flex: 1 },
  canvas: { backgroundColor: color.canvas },
  topBar: { paddingTop: space[4], paddingRight: DESKTOP_BEZEL_MARGIN, paddingBottom: space[2] },
  phoneBrand: { minHeight: 48, flexDirection: "row", alignItems: "center", paddingHorizontal: space[4], backgroundColor: color.canvas },
  stack: { flex: 1 },
  overlayLayer: { position: "absolute", top: 0, bottom: 0, right: 0, zIndex: SHELL_SWITCHER_OVERLAY_Z },
});

export default HostDesktopShell;
