/**
 * DesktopCanvas — the wide-desktop (>= 1024) page canvas (ORCH-0885-A, #4420).
 *
 * Native: a Fragment passthrough. Web: ONE tree on both sides of the
 * breakpoint (#4273). Wide desktop: the flat Graphite `color.canvas` (the old
 * ambient gradient is retired, spec §3.6), padded clear of the sidebar (248,
 * or the 80 rail when collapsed / on wizard routes, from desktopSidebarState)
 * plus the 12 bezel. `template` sets the column max width; `DesktopColumns`
 * lays out the 8/4 or 340/1fr split. The desktop gate stays in
 * `useResponsiveLayout` (I-DESKTOP-GATE-VIA-HOOK).
 */

import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { usePathname } from "expo-router";

import { color, size, space } from "../../constants/designSystem";
import {
  DESKTOP_BEZEL_MARGIN,
  DESKTOP_RAIL_WIDTH,
  DESKTOP_TOP_INSET,
} from "../../constants/desktopLayout";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";

import { desktopSidebarWidth, useDesktopSidebarStore } from "./desktopSidebarState";
import { HostShellInsetContext } from "./hostShellContext";

/**
 * #4420 (spec §3.6) desktop page templates, 12-col / 24 gutter / max 1680:
 *   dashboard (T1 8/4), list (T2, row → 400 inspector), detail (T3 8/4),
 *   wizard (T4 280 / 720 / summary), settings (T5 8/4), twopane (T6 340 / 1fr),
 *   public (1120 max), status (1040 max). The template sets the column's
 *   max width; `DesktopColumns` lays out the main / aside split inside it.
 */
export type DesktopTemplate =
  | "dashboard"
  | "list"
  | "detail"
  | "wizard"
  | "settings"
  | "twopane"
  | "public"
  | "status";

export const DESKTOP_TEMPLATE_MAX_WIDTH: Record<DesktopTemplate, number> = {
  dashboard: size.pageMax,
  list: size.pageMax,
  detail: size.pageMax,
  wizard: size.pageMax,
  settings: size.pageMax,
  twopane: size.pageMax,
  public: 1120,
  status: 1040,
};

export interface DesktopCanvasProps {
  children: React.ReactNode;
  /** Optional max content-column width for constrained routes (wins over `template`). */
  maxWidth?: number;
  /** #4420: the page template (sets the column's max width). */
  template?: DesktopTemplate;
}

export {
  DESKTOP_BEZEL_MARGIN,
  DESKTOP_RAIL_WIDTH,
  DESKTOP_TOP_INSET,
};

/** The left inset the canvas keeps clear of the sidebar (or rail). */
const useSidebarInset = (): number => {
  const collapsed = useDesktopSidebarStore((s) => s.collapsed);
  const pathname = usePathname() ?? "";
  // Outside (tabs) the root HostDesktopShell already reserves the sidebar.
  const shellReserves = React.useContext(HostShellInsetContext);
  return shellReserves ? 0 : desktopSidebarWidth(collapsed, pathname);
};

export const DesktopCanvas: React.FC<DesktopCanvasProps> = ({ children, maxWidth, template }) => {
  const { isWideDesktop } = useResponsiveLayout();
  const sidebarInset = useSidebarInset();

  // Native never crosses the breakpoint and stays a passthrough.
  if (Platform.OS !== "web") {
    return <>{children}</>;
  }

  // #4273 — one tree on both sides of the breakpoint. Swapping a Fragment for two
  // Views remounted every route under this canvas, so resizing a browser or
  // turning a tablet threw away an open composer: its text, ticks and picker.
  //
  // #4420: the canvas is the flat Graphite `color.canvas` (the ambient
  // gradient is retired) and the page sits to the right of the sidebar.
  const columnMax = maxWidth ?? (template !== undefined ? DESKTOP_TEMPLATE_MAX_WIDTH[template] : undefined);
  return (
    <View
      style={
        isWideDesktop
          ? [styles.canvas, { paddingLeft: sidebarInset + DESKTOP_BEZEL_MARGIN }]
          : styles.narrow
      }
    >
      <View style={isWideDesktop ? [styles.column, columnMax !== undefined ? { maxWidth: columnMax } : null] : styles.narrow}>
        {children}
      </View>
    </View>
  );
};

export interface DesktopColumnsProps {
  /** The main column (8 of 12, or the form in a wizard). */
  main: React.ReactNode;
  /** The aside (4 of 12; the summary / next-action panel). */
  aside?: React.ReactNode;
  /** `split` 8/4 (T1, T3, T5), `twopane` 340 / 1fr (T6). Default `split`. */
  layout?: "split" | "twopane";
  style?: StyleProp<ViewStyle>;
}

/**
 * #4420 — the main / aside split inside a template column. Tracks are
 * `minmax(0, 1fr)` in RN terms (`flex` + `minWidth: 0`), so content never
 * bleeds out of its column; the gap is the kit gutter (24).
 */
export const DesktopColumns: React.FC<DesktopColumnsProps> = ({ main, aside, layout = "split", style }) => {
  const { isWideDesktop } = useResponsiveLayout();
  if (!isWideDesktop || aside === undefined) {
    return (
      <View style={[styles.stack, style]}>
        {main}
        {aside}
      </View>
    );
  }
  return (
    <View style={[styles.split, style]}>
      {layout === "twopane" ? (
        <>
          <View style={styles.twopaneList}>{aside}</View>
          <View style={styles.main}>{main}</View>
        </>
      ) : (
        <>
          <View style={styles.main}>{main}</View>
          <View style={styles.aside}>{aside}</View>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  narrow: { flex: 1 },
  canvas: {
    flex: 1,
    backgroundColor: color.canvas,
    alignItems: "stretch",
    paddingRight: DESKTOP_BEZEL_MARGIN,
    paddingTop: DESKTOP_TOP_INSET,
    position: "relative",
  },
  column: {
    flex: 1,
    width: "100%",
  },
  stack: { gap: space[4] },
  split: { flexDirection: "row", alignItems: "flex-start", gap: size.gutter },
  main: { flex: 2, minWidth: 0 },
  aside: { flex: 1, minWidth: 0 },
  twopaneList: { width: 340, flexShrink: 0 },
});

export default DesktopCanvas;
