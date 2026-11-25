/**
 * DesktopSidebar — the desktop (>= 1024) host navigation (#4420 B6).
 *
 * The grouped 248 sidebar: (Home, Hub, Ari) · Promote (Overview, Campaigns,
 * Ads, Creators, Referrals) · Audience (People, Templates) · Account pinned at
 * the bottom. Groups collapse (a collapsed group holding the page shows an
 * orange dot); the whole sidebar collapses to the 80 icon rail (remembered,
 * localStorage try/catch) and is always the rail on wizard / full-screen
 * routes. The rail shows EVERY page (#4389 P3, Seth 2026-11-18): the top
 * group, then each titled group's items after a thin divider (group titles
 * and their chevrons live only in the expanded sidebar); every rail item has
 * a hover / keyboard-focus label. The rail has no Blast item. The rank gate applies: groups and items
 * appear only for the tabs passed in (already rank-filtered by the caller).
 * Analytics stays out (BUILD_DECISIONS 11-14).
 *
 * Mounted by `BottomNav.web` inside `(tabs)` and by `HostDesktopShell` for
 * every signed-in host route outside `(tabs)`, so it is ONE component.
 * Web only in practice: both mounts sit behind `useResponsiveLayout`.
 */

import React from "react";
import { Image, Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent, type PressableStateCallbackType } from "react-native";
import { usePathname, useRouter } from "expo-router";

import { color, materials, radius, space, type } from "../../constants/designSystem";
import { DESKTOP_RAIL_WIDTH, DESKTOP_SIDEBAR_WIDTH } from "../../constants/desktopLayout";
import { MARKETING_SUB_NAV_TABS, detectMarketingSubNavActive } from "../marketing/marketingSubNavTabs";

import { EXPANDED_BRAND_ROW_HEIGHT, expandedAvailable, expandedLayout, isRailRoute, useDesktopSidebarStore, type ExpandedLayout } from "./desktopSidebarState";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
// ISSUE-1001 — the official business lockup from @mingla/brand-assets.
import { MINGLA_BUSINESS_LOGO } from "@mingla/brand-assets";

const LazyDesktopRail = React.lazy(() => import("./DesktopSidebarRail"));

export interface SidebarTab {
  id: string;
  icon: IconName;
  label: string;
}

/**
 * The destinations the sidebar is built from, before the rank gate. Mirrors
 * the (tabs) TABS minus Create (an action, not a destination); the #4420 nav
 * test pins that the two lists agree.
 */
export const SIDEBAR_SOURCE_TABS: readonly SidebarTab[] = [
  { id: "home", icon: "home", label: "Home" },
  { id: "hub", icon: "calendar", label: "Hub" },
  { id: "ari", icon: "ari", label: "Ari" },
  { id: "marketing", icon: "send", label: "Blast" },
];


// SidebarItem / SidebarGroup live in desktopSidebarState so the lazy rail can
// import them without a DesktopSidebar <-> DesktopSidebarRail require cycle (#4389).
export type { SidebarItem, SidebarGroup } from "./desktopSidebarState";
import type { SidebarItem, SidebarGroup } from "./desktopSidebarState";

const MARKETING_ICONS: Record<string, IconName> = {
  overview: "megaphone",
  campaigns: "send",
  // #4389 P2-2 (Seth 2026-11-18) — `target` read like the Ari orb at 20px.
  ads: "rocket",
  creators: "users",
  referrals: "gift",
  // #4514 — Forms (host-built guest questions) sits after Referrals in Promote.
  forms: "list",
  // #4389 P4/P5 — People is the contact book (`notebook`), never Account's
  // `user` (Creators keeps `users`), so the rail shows no two identical glyphs.
  people: "notebook",
  templates: "template",
};

const AUDIENCE_IDS = new Set(["people", "templates"]);

/**
 * The grouped IA for the tabs the shell passed in (already rank-gated).
 * Pure, so the sidebar's rank filter is unit-tested.
 */
export const buildSidebarGroups = (tabs: readonly SidebarTab[]): { groups: SidebarGroup[]; account: SidebarItem | null } => {
  const has = (id: string): boolean => tabs.some((t) => t.id === id);
  const top: SidebarItem[] = [];
  for (const tab of tabs) {
    if (tab.id === "home" || tab.id === "hub" || tab.id === "ari") {
      top.push({ key: tab.id, label: tab.label, icon: tab.icon, path: `/(tabs)/${tab.id}` });
    }
  }
  const groups: SidebarGroup[] = [{ key: "main", title: null, items: top }];
  if (has("marketing")) {
    const promote: SidebarItem[] = [];
    const audience: SidebarItem[] = [];
    for (const sub of MARKETING_SUB_NAV_TABS) {
      const item = { key: sub.id, label: sub.label, icon: MARKETING_ICONS[sub.id] ?? "send", path: sub.path };
      (AUDIENCE_IDS.has(sub.id) ? audience : promote).push(item);
    }
    groups.push({ key: "promote", title: "Promote", items: promote });
    if (audience.length > 0) groups.push({ key: "audience", title: "Audience", items: audience });
  }
  return {
    groups: groups.filter((g) => g.items.length > 0),
    account: { key: "account", label: "Account", icon: "user", path: "/(tabs)/account" },
  };
};

/** Which sidebar item the pathname belongs to. */
export const activeSidebarKey = (pathname: string): string => {
  const lower = pathname.toLowerCase();
  if (lower === "/marketing" || lower.startsWith("/marketing/")) return detectMarketingSubNavActive(pathname);
  const first = lower.split("/").filter(Boolean)[0];
  return first ?? "home";
};

export interface DesktopSidebarProps {
  /** Rank-gated tabs (home / hub / ari / marketing...). */
  tabs: readonly SidebarTab[];
  /** #4420: always the 80 rail (wizard / full-screen routes outside (tabs)). */
  forceRail?: boolean;
  testID?: string;
}

/**
 * #4420 — the Mingla Host lockup at the kit's size (graphite-glass.css:
 * `.sidebar .logo { width: 64px }`, rail 48 per kit2 conform.css). The master
 * is a 2000 square with the lockup in the middle, so drawing the whole square
 * in a 36 box left the mark about 24 wide and soft. The frame below crops to
 * the lockup's measured bounds (x 307-1692, y 628-1371 of 2000). On web it
 * draws the served vector master (public/brand, byte-identical to
 * packages/brand-assets per the #1001 parity gate), so it is sharp at any
 * density; native keeps the 2000px PNG master.
 */
const LOGO_MASTER = 2000;
const LOGO_ART = { x: 307, y: 628, w: 1386, h: 744 } as const;
const LOGO_WIDTH_SIDEBAR = 64;
const LOGO_WIDTH_RAIL = 48;
const LOGO_WEB_SOURCE = { uri: "/brand/mingla-business-logo.svg" };

const HostLogo: React.FC<{ width: number }> = ({ width }) => {
  const scale = width / LOGO_ART.w;
  const full = LOGO_MASTER * scale;
  // #4490 N63: if the served vector fails to load (a busy server, a cold
  // cache), fall back to the bundled PNG master so the box is never empty.
  const [webFailed, setWebFailed] = React.useState(false);
  const useWeb = Platform.OS === "web" && !webFailed;
  return (
    <View
      style={[styles.logoCrop, { width, height: Math.round(LOGO_ART.h * scale) }]}
      accessibilityRole="image"
      accessibilityLabel="Mingla Host"
      testID="desktop-sidebar-logo"
    >
      <Image
        source={useWeb ? LOGO_WEB_SOURCE : MINGLA_BUSINESS_LOGO}
        onError={useWeb ? () => setWebFailed(true) : undefined}
        style={{ position: "absolute", width: full, height: full, left: -LOGO_ART.x * scale, top: -LOGO_ART.y * scale }}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
    </View>
  );
};

export const DesktopSidebar: React.FC<DesktopSidebarProps> = ({ tabs, forceRail = false, testID }) => {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const collapsedPref = useDesktopSidebarStore((s) => s.collapsed);
  const closedGroups = useDesktopSidebarStore((s) => s.closedGroups);
  const toggleCollapsed = useDesktopSidebarStore((s) => s.toggleCollapsed);
  const toggleGroup = useDesktopSidebarStore((s) => s.toggleGroup);
  const forcedRail = forceRail || isRailRoute(pathname);
  const rail = collapsedPref || forcedRail;
  const { groups, account } = buildSidebarGroups(tabs);
  const activeKey = activeSidebarKey(pathname);
  const go = (path: string) => (): void => router.push(path as never);
  // #4420 — the expanded menu never scrolls: sizes come from the measured panel.
  const [panelH, setPanelH] = React.useState(0);
  const visibleRows = groups.reduce(
    (n, g) => n + (g.title !== null && closedGroups.includes(g.key) ? 0 : g.items.length),
    0,
  ) + (account !== null ? 1 : 0);
  const titleCount = groups.filter((g) => g.title !== null).length;
  const m: ExpandedLayout = expandedLayout(
    panelH > 0 ? expandedAvailable(panelH, EXPANDED_BRAND_ROW_HEIGHT) : Number.MAX_SAFE_INTEGER,
    visibleRows,
    titleCount,
    groups.length,
  );

  if (rail) {
    // #4389 P3 — the 80 icon rail (every page, hover / focus labels, no
    // scrolling) loads on intent: it shows only when the host
    // collapsed the sidebar or on a wizard route, so it stays off the eager
    // boot chunk. Until it loads, the empty rail column holds the layout.
    return (
      <React.Suspense
        fallback={<View testID={testID} style={[styles.sidebar, styles.rail]} accessibilityRole="tablist" />}
      >
        <LazyDesktopRail
          testID={testID}
          frameStyle={[styles.sidebar, styles.rail]}
          logo={<HostLogo width={LOGO_WIDTH_RAIL} />}
          groups={groups}
          account={account}
          activeKey={activeKey}
          showExpand={!forcedRail}
          onExpand={toggleCollapsed}
          go={go}
        />
      </React.Suspense>
    );
  }

  return (
    <View
      testID={testID}
      style={[styles.sidebar, styles.expanded]}
      accessibilityRole="tablist"
      onLayout={(e: LayoutChangeEvent) => setPanelH(e.nativeEvent.layout.height)}
    >
      <View style={styles.brandRow}>
        <HostLogo width={LOGO_WIDTH_SIDEBAR} />
        <View style={styles.spacer} />
        <Pressable onPress={toggleCollapsed} accessibilityRole="button" accessibilityLabel="Collapse sidebar" hitSlop={8} style={styles.collapseButton}>
          <Icon name="chevL" size={16} color={color.text3} />
        </Pressable>
      </View>
      <View style={[styles.groups, { gap: m.gap, paddingBottom: m.gap }]}>
        {groups.map((group) => {
          const closed = group.title !== null && closedGroups.includes(group.key);
          const holdsActive = group.items.some((i) => i.key === activeKey);
          return (
            <View key={group.key} style={styles.group}>
              {group.title !== null ? (
                <Pressable
                  onPress={() => toggleGroup(group.key)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: !closed }}
                  accessibilityLabel={group.title}
                  style={[styles.groupHead, { height: m.title }]}
                  testID={`sidebar-group-${group.key}`}
                >
                  <Text style={styles.groupTitle}>{group.title}</Text>
                  {closed && holdsActive ? <View style={styles.activeDot} testID={`sidebar-group-${group.key}-dot`} /> : null}
                  <View style={styles.spacer} />
                  <Icon name={closed ? "chevR" : "chevD"} size={14} color={color.text3} />
                </Pressable>
              ) : null}
              {closed
                ? null
                : group.items.map((item) => (
                    <SidebarRow key={item.key} item={item} on={item.key === activeKey} onPress={go(item.path)} m={m} />
                  ))}
            </View>
          );
        })}
      </View>
      {account !== null ? (
        <View style={styles.footer}>
          <SidebarRow item={account} on={activeKey === "account"} onPress={go(account.path)} m={m} />
        </View>
      ) : null}
    </View>
  );
};

const SidebarRow: React.FC<{ item: SidebarItem; on: boolean; onPress: () => void; m: ExpandedLayout }> = ({ item, on, onPress, m }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="tab"
    accessibilityState={{ selected: on }}
    accessibilityLabel={item.label}
    testID={`sidebar-item-${item.key}`}
    style={(state: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      { height: m.row },
      on ? styles.itemOn : state.hovered ? styles.itemHover : null,
    ]}
  >
    <Icon name={item.icon} size={m.icon} color={on ? color.accent : color.text2} />
    <Text style={[styles.rowLabel, { fontSize: m.labelSize }, on ? styles.rowLabelOn : null]} numberOfLines={1}>
      {item.label}
    </Text>
  </Pressable>
);

const styles = StyleSheet.create({
  sidebar: {
    position: "fixed" as unknown as "absolute",
    top: 0,
    left: 0,
    // #2331 — fixed inside the app root, which ends at the privacy strip's
    // top edge (I-PRIVACY-BAR-NEVER-OCCLUDES).
    bottom: 0,
    backgroundColor: materials.chrome.solidFill,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: color.line,
    zIndex: 50,
  },
  expanded: { width: DESKTOP_SIDEBAR_WIDTH, paddingVertical: space[4] },
  rail: { width: DESKTOP_RAIL_WIDTH, alignItems: "center", paddingVertical: space[5], gap: space[2] },
  logoCrop: { overflow: "hidden" },
  brandRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: space[5], paddingBottom: space[4] },
  collapseButton: { width: 28, height: 28, borderRadius: radius.xs, alignItems: "center", justifyContent: "center" },
  // Groups share the height; leftover (tall monitors) lands between them.
  groups: { flex: 1, minHeight: 0, paddingHorizontal: space[3], justifyContent: "space-between" },
  group: {},
  groupHead: { flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3] },
  groupTitle: { ...type.label, textTransform: "uppercase", color: color.text3 },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.accent },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[3], borderRadius: radius.sm },
  rowLabel: { ...type.small, fontWeight: "500", color: color.text2, flex: 1 },
  rowLabelOn: { color: color.text1, fontWeight: "600" },
  itemOn: { backgroundColor: color.fill.railOn },
  itemHover: { backgroundColor: color.fill.rowHover },
  footer: { paddingHorizontal: space[3], paddingTop: space[3], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  spacer: { flex: 1 },
});

