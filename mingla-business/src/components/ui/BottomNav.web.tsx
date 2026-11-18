/**
 * BottomNav.web — the web navigation (#4420 Graphite Glass, spec §3.4 / B6).
 *
 * Metro resolves `BottomNav` to this file on web and to the native capsule
 * (`BottomNav.tsx`) on iOS / Android.
 *
 * - `isWideDesktop === false` → `MobileWebCapsule`: the same tab bar as the
 *   phone (Home, Hub, [Create], Ari, Blast) with a STATIC active highlight and
 *   no reanimated (ORCH-1098: the reanimated capsule OOM-crashed phone
 *   browsers). Solid liquid fill (phone web is blur-killed).
 * - `isWideDesktop === true` → `DesktopSidebar`: the grouped 248 sidebar
 *     (Home, Hub, Ari) · Promote (Overview, Campaigns, Ads, Creators,
 *     Referrals) · Audience (People, Templates) · Account pinned at the bottom.
 *   Groups collapse; a collapsed group holding the current page shows an
 *   orange dot. The whole sidebar collapses to the 80 icon rail (remembered in
 *   localStorage, try/catch) and is always the rail on wizard / full-screen
 *   routes. The rail has no Blast item. The nested Blast hub is un-nested on
 *   desktop: its sections are sidebar items. The rank gate applies: groups and
 *   items appear only for tabs the shell passed in (already rank-filtered).
 *   Analytics stays out of the sidebar (BUILD_DECISIONS 11-14: one bottom bar
 *   on Home only).
 *
 * Invariants: I-DESKTOP-GATE-VIA-HOOK (gates only via useResponsiveLayout),
 * I-NO-BOTTOMNAV-OUTSIDE-LAYOUT (only `(tabs)/_layout.tsx` imports it),
 * I-PRIVACY-BAR-NEVER-OCCLUDES (the fixed sidebar ends above the privacy bar).
 */

import React, { useCallback } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { color, materials, space, type } from "../../constants/designSystem";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";

import { BOTTOM_NAV_CAPSULE_HEIGHT, BOTTOM_NAV_EMBER_SIZE } from "./bottomNavMetrics";
import { DesktopSidebar } from "./DesktopSidebar";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

export interface BottomNavTab {
  id: string;
  icon: IconName;
  label: string;
}

// The sidebar's IA helpers live in DesktopSidebar (also mounted by the root
// host shell for routes outside (tabs)); re-exported for existing callers.
export { activeSidebarKey, buildSidebarGroups } from "./DesktopSidebar";
export type { SidebarGroup, SidebarItem } from "./DesktopSidebar";

export interface BottomNavProps {
  tabs: BottomNavTab[];
  active: string;
  onChange: (id: string) => void;
  /** #4420: the Create ember was pressed. */
  onCreate?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const CREATE_TAB_ID = "create";

export const BottomNav: React.FC<BottomNavProps> = ({ tabs, active, onChange, onCreate, testID, style }) => {
  const { isWideDesktop } = useResponsiveLayout();
  if (!isWideDesktop) {
    return <MobileWebCapsule tabs={tabs} active={active} onChange={onChange} onCreate={onCreate} testID={testID} style={style} />;
  }
  return <DesktopSidebar tabs={tabs} testID={testID} />;
};

// ORCH-1098 root-cause fix — non-reanimated mobile-web capsule: a STATIC
// per-tab highlight (no spotlight Animated.View, no onLayout measurement, no
// reanimated hooks) so the phone renderer never enters the OOM feedback loop.
const CAPSULE_HEIGHT = BOTTOM_NAV_CAPSULE_HEIGHT;
const CAPSULE_PAD = space[2];

const MobileWebCapsule: React.FC<BottomNavProps> = ({ tabs, active, onChange, onCreate, testID, style }) => {
  const handlePress = useCallback(
    (id: string) => (): void => {
      if (id === CREATE_TAB_ID) {
        onCreate?.();
        return;
      }
      onChange(id);
    },
    [onChange, onCreate],
  );
  return (
    <View testID={testID} style={[mwStyles.host, style]}>
      <View style={mwStyles.bar}>
        <View style={mwStyles.row}>
          {tabs.map((tab) => {
            if (tab.id === CREATE_TAB_ID) {
              return (
                <View key={tab.id} style={mwStyles.tab}>
                  <Pressable
                    onPress={handlePress(tab.id)}
                    accessibilityRole="button"
                    accessibilityLabel={tab.label}
                    testID="bottom-nav-create"
                    style={mwStyles.ember}
                  >
                    <Icon name="plus" size={24} color={color.onAccent} />
                  </Pressable>
                </View>
              );
            }
            const isActive = tab.id === active;
            return (
              <Pressable
                key={tab.id}
                onPress={handlePress(tab.id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={tab.label}
                style={[mwStyles.tab, isActive ? mwStyles.tabActive : null]}
              >
                <Icon name={tab.icon} size={22} color={isActive ? color.accent : color.text3} />
                <Text
                  style={[mwStyles.label, { color: isActive ? color.text1 : color.text3, fontWeight: isActive ? "600" : "500" }]}
                  numberOfLines={1}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
};

const mwStyles = StyleSheet.create({
  host: { paddingHorizontal: space[4] },
  bar: {
    height: CAPSULE_HEIGHT,
    borderRadius: CAPSULE_HEIGHT / 2,
    backgroundColor: materials.liquid.solidFill,
    borderWidth: materials.liquid.rim.edgeWidth,
    borderColor: materials.liquid.rim.edge,
    borderTopWidth: 1,
    borderTopColor: materials.liquid.rim.top ?? materials.liquid.rim.edge,
    overflow: "hidden",
  },
  row: {
    height: CAPSULE_HEIGHT,
    paddingHorizontal: CAPSULE_PAD,
    paddingVertical: CAPSULE_PAD,
    flexDirection: "row",
    alignItems: "center",
  },
  tab: {
    flex: 1,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    borderRadius: (CAPSULE_HEIGHT - CAPSULE_PAD * 2) / 2,
  },
  tabActive: { backgroundColor: color.fill.tabOn },
  ember: {
    width: BOTTOM_NAV_EMBER_SIZE,
    height: BOTTOM_NAV_EMBER_SIZE - 8,
    borderRadius: (BOTTOM_NAV_EMBER_SIZE - 8) / 2,
    backgroundColor: color.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { fontSize: type.nav.fontSize, lineHeight: type.nav.lineHeight, letterSpacing: type.nav.letterSpacing },
});

export default BottomNav;
