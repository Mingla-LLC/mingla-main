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

import React, { useState } from "react";
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View, type PressableStateCallbackType } from "react-native";
import { usePathname, useRouter } from "expo-router";

import { color, materials, radius, space, type } from "../../constants/designSystem";
import { DESKTOP_RAIL_WIDTH, DESKTOP_SIDEBAR_WIDTH } from "../../constants/desktopLayout";
import { MARKETING_SUB_NAV_TABS, detectMarketingSubNavActive } from "../marketing/marketingSubNavTabs";

import { isRailRoute, useDesktopSidebarStore } from "./desktopSidebarState";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
// ISSUE-1001 — the official business lockup from @mingla/brand-assets.
import { MINGLA_BUSINESS_LOGO } from "@mingla/brand-assets";

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


export interface SidebarItem {
  key: string;
  label: string;
  icon: IconName;
  path: string;
}

export interface SidebarGroup {
  key: string;
  /** null = the untitled top group. */
  title: string | null;
  items: SidebarItem[];
}

const MARKETING_ICONS: Record<string, IconName> = {
  overview: "megaphone",
  campaigns: "send",
  ads: "target",
  creators: "users",
  referrals: "gift",
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
  return (
    <View
      style={[styles.logoCrop, { width, height: Math.round(LOGO_ART.h * scale) }]}
      accessibilityRole="image"
      accessibilityLabel="Mingla Host"
      testID="desktop-sidebar-logo"
    >
      <Image
        source={Platform.OS === "web" ? LOGO_WEB_SOURCE : MINGLA_BUSINESS_LOGO}
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

  if (rail) {
    // #4389 P3 — the 80 icon rail shows every page: the top group, then each
    // titled group's items after a thin divider (in place of its title).
    // Expand and Account stay at the bottom. No Blast item.
    return (
      <View testID={testID} style={[styles.sidebar, styles.rail]} accessibilityRole="tablist">
        <View style={styles.railLogo}>
          <HostLogo width={LOGO_WIDTH_RAIL} />
        </View>
        {groups.map((group) => (
          <React.Fragment key={group.key}>
            {group.title !== null ? (
              <View style={styles.railDivider} testID={`sidebar-rail-divider-${group.key}`} />
            ) : null}
            {group.items.map((item) => {
              const on = item.key === activeKey;
              return (
                <RailItem key={item.key} tipKey={item.key} label={item.label} role="tab" on={on} onPress={go(item.path)}>
                  <Icon name={item.icon} size={20} color={on ? color.accent : color.text2} />
                </RailItem>
              );
            })}
          </React.Fragment>
        ))}
        <View style={styles.spacer} />
        {!forcedRail ? (
          <RailItem tipKey="expand" label="Expand sidebar" role="button" on={false} onPress={toggleCollapsed}>
            <Icon name="chevR" size={18} color={color.text3} />
          </RailItem>
        ) : null}
        {account !== null ? (
          <RailItem
            tipKey="account"
            label={account.label}
            role="tab"
            on={activeKey === "account"}
            onPress={go(account.path)}
          >
            <Icon name={account.icon} size={20} color={activeKey === "account" ? color.accent : color.text2} />
          </RailItem>
        ) : null}
      </View>
    );
  }

  return (
    <View testID={testID} style={[styles.sidebar, styles.expanded]} accessibilityRole="tablist">
      <View style={styles.brandRow}>
        <HostLogo width={LOGO_WIDTH_SIDEBAR} />
        <View style={styles.spacer} />
        <Pressable onPress={toggleCollapsed} accessibilityRole="button" accessibilityLabel="Collapse sidebar" hitSlop={8} style={styles.collapseButton}>
          <Icon name="chevL" size={16} color={color.text3} />
        </Pressable>
      </View>
      <ScrollView style={styles.groups} contentContainerStyle={styles.groupsContent} showsVerticalScrollIndicator={false}>
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
                  style={styles.groupHead}
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
                    <SidebarRow key={item.key} item={item} on={item.key === activeKey} onPress={go(item.path)} />
                  ))}
            </View>
          );
        })}
      </ScrollView>
      {account !== null ? (
        <View style={styles.footer}>
          <SidebarRow item={account} on={activeKey === "account"} onPress={go(account.path)} />
        </View>
      ) : null}
    </View>
  );
};

// MINGLA-INVARIANT: I-4389-RAIL-LABELS | issue #4389 | every collapsed-rail item (pages, Expand, Account) shows its page name in a label bubble on hover and on keyboard focus, hidden on leave, blur and press; the bubble is hidden from assistive tech (the Pressable carries the label). Enforced by src/components/ui/__tests__/issue_4389_sidebar_rail.implementor.test.tsx.
/**
 * #4389 P3 — one rail item with its hover / keyboard-focus label (web). The
 * bubble sits to the right of the 48 item (the sidebar is fixed and does not
 * clip), ignores the pointer and is hidden from assistive tech: the Pressable
 * already carries the accessibility label.
 */
const RailItem: React.FC<{
  tipKey: string;
  label: string;
  role: "tab" | "button";
  on: boolean;
  onPress: () => void;
  children: React.ReactNode;
}> = ({ tipKey, label, role, on, onPress, children }) => {
  const [tip, setTip] = useState(false);
  const show = (): void => setTip(true);
  const hide = (): void => setTip(false);
  return (
    <View style={styles.railSlot}>
      <Pressable
        onPress={() => {
          hide();
          onPress();
        }}
        onHoverIn={show}
        onHoverOut={hide}
        onFocus={show}
        onBlur={hide}
        accessibilityRole={role}
        accessibilityState={role === "tab" ? { selected: on } : undefined}
        accessibilityLabel={label}
        testID={`sidebar-rail-item-${tipKey}`}
        style={(state: PressableStateCallbackType & { hovered?: boolean }) => [
          styles.railItem,
          on ? styles.itemOn : state.hovered ? styles.itemHover : null,
        ]}
      >
        {children}
      </Pressable>
      {tip ? (
        <View
          style={styles.railTipWrap}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          aria-hidden
          testID={`sidebar-rail-tip-${tipKey}`}
        >
          <View style={styles.railTip}>
            <Text style={styles.railTipText} numberOfLines={1}>
              {label}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
};

const SidebarRow: React.FC<{ item: SidebarItem; on: boolean; onPress: () => void }> = ({ item, on, onPress }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="tab"
    accessibilityState={{ selected: on }}
    accessibilityLabel={item.label}
    testID={`sidebar-item-${item.key}`}
    style={(state: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      on ? styles.itemOn : state.hovered ? styles.itemHover : null,
    ]}
  >
    <Icon name={item.icon} size={18} color={on ? color.accent : color.text2} />
    <Text style={[styles.rowLabel, on ? styles.rowLabelOn : null]} numberOfLines={1}>
      {item.label}
    </Text>
  </Pressable>
);

const styles = StyleSheet.create({
  sidebar: {
    position: "fixed" as unknown as "absolute",
    top: 0,
    left: 0,
    // #2331 — ends above the privacy bar (I-PRIVACY-BAR-NEVER-OCCLUDES).
    bottom: "var(--mingla-privacy-inset, 0px)" as unknown as number,
    backgroundColor: materials.chrome.solidFill,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: color.line,
    zIndex: 50,
  },
  expanded: { width: DESKTOP_SIDEBAR_WIDTH, paddingVertical: space[4] },
  rail: { width: DESKTOP_RAIL_WIDTH, alignItems: "center", paddingVertical: space[5], gap: space[2] },
  railLogo: { marginBottom: space[3], alignItems: "center", justifyContent: "center" },
  logoCrop: { overflow: "hidden" },
  brandRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: space[5], paddingBottom: space[4] },
  collapseButton: { width: 28, height: 28, borderRadius: radius.xs, alignItems: "center", justifyContent: "center" },
  groups: { flex: 1 },
  groupsContent: { paddingHorizontal: space[3], gap: space[4] },
  group: { gap: 2 },
  groupHead: { flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 28, paddingHorizontal: space[3] },
  groupTitle: { ...type.label, textTransform: "uppercase", color: color.text3 },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.accent },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 40, paddingHorizontal: space[3], borderRadius: radius.sm },
  rowLabel: { ...type.small, fontWeight: "500", color: color.text2, flex: 1 },
  rowLabelOn: { color: color.text1, fontWeight: "600" },
  itemOn: { backgroundColor: color.fill.railOn },
  itemHover: { backgroundColor: color.fill.rowHover },
  railItem: { width: 48, height: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  // #4389 P3 — the rail item's slot (anchors its label) and the thin divider
  // that stands in for a group title.
  railSlot: { position: "relative", width: 48, height: 48 },
  railDivider: { width: 32, height: StyleSheet.hairlineWidth, backgroundColor: color.line, marginVertical: space[1] },
  railTipWrap: { position: "absolute", left: 56, top: 0, height: 48, justifyContent: "center", zIndex: 1 },
  railTip: {
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineStrong,
    backgroundColor: materials.onPhoto.solidFill,
  },
  railTipText: { ...type.caption, fontWeight: "600", color: color.text1 },
  footer: { paddingHorizontal: space[3], paddingTop: space[3], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  spacer: { flex: 1 },
});

