/**
 * DesktopSidebar — the desktop (>= 1024) host navigation (#4420 B6).
 *
 * The grouped 248 sidebar: (Home, Hub, Ari) · Promote (Overview, Campaigns,
 * Ads, Creators, Referrals) · Audience (People, Templates) · Account pinned at
 * the bottom. Groups collapse (a collapsed group holding the page shows an
 * orange dot); the whole sidebar collapses to the 80 icon rail (remembered,
 * localStorage try/catch) and is always the rail on wizard / full-screen
 * routes. The rail has no Blast item. The rank gate applies: groups and items
 * appear only for the tabs passed in (already rank-filtered by the caller).
 * Analytics stays out (BUILD_DECISIONS 11-14).
 *
 * Mounted by `BottomNav.web` inside `(tabs)` and by `HostDesktopShell` for
 * every signed-in host route outside `(tabs)`, so it is ONE component.
 * Web only in practice: both mounts sit behind `useResponsiveLayout`.
 */

import React from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View, type PressableStateCallbackType } from "react-native";
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
  { id: "ari", icon: "sparkle", label: "Ari" },
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
  people: "user",
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
    // The 80 icon rail: the top group, then one icon per remaining group (its
    // first item), Account at the bottom. No Blast item.
    const railItems: SidebarItem[] = [
      ...(groups[0]?.title === null ? groups[0].items : []),
      ...groups.filter((g) => g.title !== null).map((g) => ({ ...g.items[0], key: `${g.key}:${g.items[0].key}`, label: g.title ?? g.items[0].label })),
    ];
    return (
      <View testID={testID} style={[styles.sidebar, styles.rail]} accessibilityRole="tablist">
        <View style={styles.railLogo}>
          <Image source={MINGLA_BUSINESS_LOGO} style={styles.logoMark} resizeMode="contain" accessibilityIgnoresInvertColors />
        </View>
        {railItems.map((item) => {
          const group = groups.find((g) => item.key.startsWith(`${g.key}:`));
          const on = group !== undefined ? group.items.some((i) => i.key === activeKey) : item.key === activeKey;
          return (
            <Pressable
              key={item.key}
              onPress={go(item.path)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={item.label}
              style={(state: PressableStateCallbackType & { hovered?: boolean }) => [
                styles.railItem,
                on ? styles.itemOn : state.hovered ? styles.itemHover : null,
              ]}
            >
              <Icon name={item.icon} size={20} color={on ? color.accent : color.text2} />
            </Pressable>
          );
        })}
        <View style={styles.spacer} />
        {!forcedRail ? (
          <Pressable onPress={toggleCollapsed} accessibilityRole="button" accessibilityLabel="Expand sidebar" style={styles.railItem}>
            <Icon name="chevR" size={18} color={color.text3} />
          </Pressable>
        ) : null}
        {account !== null ? (
          <Pressable
            onPress={go(account.path)}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeKey === "account" }}
            accessibilityLabel={account.label}
            style={[styles.railItem, activeKey === "account" ? styles.itemOn : null]}
          >
            <Icon name={account.icon} size={20} color={activeKey === "account" ? color.accent : color.text2} />
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View testID={testID} style={[styles.sidebar, styles.expanded]} accessibilityRole="tablist">
      <View style={styles.brandRow}>
        <Image source={MINGLA_BUSINESS_LOGO} style={styles.logoMark} resizeMode="contain" accessibilityIgnoresInvertColors />
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
  railLogo: { width: 40, height: 40, marginBottom: space[3], alignItems: "center", justifyContent: "center" },
  logoMark: { width: 36, height: 36 },
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
  footer: { paddingHorizontal: space[3], paddingTop: space[3], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  spacer: { flex: 1 },
});

