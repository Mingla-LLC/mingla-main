/**
 * DesktopSidebarRail — the collapsed 80 icon rail of DesktopSidebar (#4420 B6,
 * #4389 P3). Loaded on intent by DesktopSidebar (React.lazy): the rail shows
 * only when the host collapsed the sidebar or on a wizard / full-screen
 * route, so this code stays off the eager boot chunk.
 *
 * Every page shows (the top group, then each titled group's items after a thin
 * divider; group titles live only in the expanded sidebar) and every item
 * shows its name on hover and keyboard focus. No Blast item. #4420: the rail
 * never scrolls; every slot (pages, Expand, Account) takes an equal share of
 * the measured height and the tile shrinks to fit.
 */

import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent, type PressableStateCallbackType, type StyleProp, type ViewStyle } from "react-native";

import { color, materials, radius, space, type } from "../../constants/designSystem";

import { RAIL_DIVIDER_HEIGHT, railLayout, railVerticalPadding, type RailLayout, type SidebarGroup, type SidebarItem } from "./desktopSidebarState";
import { Icon } from "./Icon";

const DesktopSidebarRail: React.FC<{
  testID?: string;
  frameStyle: StyleProp<ViewStyle>;
  logo: React.ReactNode;
  groups: SidebarGroup[];
  account: SidebarItem | null;
  activeKey: string;
  showExpand: boolean;
  onExpand: () => void;
  go: (path: string) => () => void;
}> = ({ testID, frameStyle, logo, groups, account, activeKey, showExpand, onExpand, go }) => {
  // #4420 — measured, never hard-coded to the item count. Until the first
  // layout the full 48 tile shows (a frame or two).
  const [panelH, setPanelH] = useState(0);
  const [bodyH, setBodyH] = useState(0);
  const pageCount = groups.reduce((n, g) => n + g.items.length, 0);
  const slotCount = pageCount + (showExpand ? 1 : 0) + (account !== null ? 1 : 0);
  const dividerCount = groups.filter((g) => g.title !== null).length;
  const m: RailLayout = bodyH > 0 ? railLayout(bodyH, slotCount, dividerCount) : { slot: 48, tile: 48, icon: 20 };
  const padV = panelH > 0 ? railVerticalPadding(panelH) : 20;
  return (
    <View
      testID={testID}
      style={[frameStyle, { paddingVertical: padV, gap: 0 }]}
      accessibilityRole="tablist"
      onLayout={(e: LayoutChangeEvent) => setPanelH(e.nativeEvent.layout.height)}
    >
      <View style={styles.railLogo}>{logo}</View>
      <View style={styles.railBody} onLayout={(e: LayoutChangeEvent) => setBodyH(e.nativeEvent.layout.height)}>
        {groups.map((group) => (
          <React.Fragment key={group.key}>
            {group.title !== null ? (
              <View style={styles.railDividerBox} testID={`sidebar-rail-divider-${group.key}`}>
                <View style={styles.railDivider} />
              </View>
            ) : null}
            {group.items.map((item) => {
              const on = item.key === activeKey;
              return (
                <RailItem key={item.key} tipKey={item.key} label={item.label} role="tab" on={on} onPress={go(item.path)} tile={m.tile}>
                  <Icon name={item.icon} size={m.icon} color={on ? color.accent : color.text2} />
                </RailItem>
              );
            })}
          </React.Fragment>
        ))}
        {showExpand ? (
          <RailItem tipKey="expand" label="Expand sidebar" role="button" on={false} onPress={onExpand} tile={m.tile}>
            <Icon name="chevR" size={m.icon} color={color.text3} />
          </RailItem>
        ) : null}
        {account !== null ? (
          <RailItem tipKey="account" label={account.label} role="tab" on={activeKey === "account"} onPress={go(account.path)} tile={m.tile}>
            <Icon name={account.icon} size={m.icon} color={activeKey === "account" ? color.accent : color.text2} />
          </RailItem>
        ) : null}
      </View>
    </View>
  );
};

/** The label bubble: ignores the pointer, hidden from assistive tech. */
const RailTip: React.FC<{ tipKey: string; label: string; style?: ViewStyle }> = ({ tipKey, label, style }) => (
  <View
    style={[styles.railTipWrap, style]}
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
);

/**
 * #4389 P3 — one rail item with its hover / keyboard-focus label (web). Each
 * item draws its own label (#4420: nothing scrolls, so no offset maths). The
 * bubble sits to the right, ignores the pointer and is hidden from assistive
 * tech: the Pressable already carries the accessibility label. The slot takes
 * an equal flex share of the rail; the tile is centred in it.
 */
const RailItem: React.FC<{
  tipKey: string;
  label: string;
  role: "tab" | "button";
  on: boolean;
  onPress: () => void;
  tile: number;
  children: React.ReactNode;
}> = ({ tipKey, label, role, on, onPress, tile, children }) => {
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
          { width: tile, height: tile },
          on ? styles.itemOn : state.hovered ? styles.itemHover : null,
        ]}
      >
        {children}
      </Pressable>
      {tip ? <RailTip tipKey={tipKey} label={label} /> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  railLogo: { marginBottom: space[3], alignItems: "center", justifyContent: "center" },
  itemOn: { backgroundColor: color.fill.railOn },
  itemHover: { backgroundColor: color.fill.rowHover },
  railItem: { borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  // Every slot shares the body's height equally (no cap); the tile is centred.
  railSlot: { position: "relative", flex: 1, minHeight: 0, alignSelf: "stretch", alignItems: "center", justifyContent: "center" },
  // Logo on top; everything under it shares the remaining height. Never scrolls.
  railBody: { flex: 1, minHeight: 0, alignSelf: "stretch", alignItems: "center" },
  // The thin divider that stands in for a group title.
  railDividerBox: { height: RAIL_DIVIDER_HEIGHT, alignSelf: "stretch", alignItems: "center", justifyContent: "center" },
  railDivider: { width: 32, height: StyleSheet.hairlineWidth, backgroundColor: color.line },
  // Label sits right of the rail column (slot is the full 80 wide), vertically centred on the slot.
  railTipWrap: { position: "absolute", left: 72, top: 0, bottom: 0, justifyContent: "center", zIndex: 1 },
  railTip: {
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineStrong,
    backgroundColor: materials.onPhoto.solidFill,
  },
  railTipText: { ...type.caption, fontWeight: "600", color: color.text1 },
});

export default DesktopSidebarRail;
