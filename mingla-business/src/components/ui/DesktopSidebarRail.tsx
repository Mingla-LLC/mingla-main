/**
 * DesktopSidebarRail — the collapsed 80 icon rail of DesktopSidebar (#4420 B6,
 * #4389 P3). Loaded on intent by DesktopSidebar (React.lazy): the rail shows
 * only when the host collapsed the sidebar or on a wizard / full-screen
 * route, so this code stays off the eager boot chunk.
 *
 * Every page shows (the top group, then each titled group's items after a thin
 * divider; group titles live only in the expanded sidebar), the page list
 * scrolls between the logo and the pinned Expand + Account items, and every
 * item shows its name on hover and keyboard focus. No Blast item.
 */

import React, { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type PressableStateCallbackType, type StyleProp, type ViewStyle } from "react-native";

import { color, materials, radius, space, type } from "../../constants/designSystem";
import { DESKTOP_RAIL_WIDTH } from "../../constants/desktopLayout";

import type { SidebarGroup, SidebarItem } from "./DesktopSidebar";
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
}> = ({ testID, frameStyle, logo, groups, account, activeKey, showExpand, onExpand, go }) => (
  <View testID={testID} style={frameStyle} accessibilityRole="tablist">
    <View style={styles.railLogo}>{logo}</View>
    <RailPages groups={groups} activeKey={activeKey} go={go} />
    {showExpand ? (
      <RailItem tipKey="expand" label="Expand sidebar" role="button" on={false} onPress={onExpand}>
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

/**
 * #4389 P3 rework — the rail's page list scrolls inside the rail (a full rail
 * is ~780 tall; a 768 window must still reach Account), while the logo stays
 * on top and Expand + Account stay pinned below it. A scroll container clips
 * horizontally, so the pages' labels are drawn here, OUTSIDE the scroll view
 * (absolute in the rail), at the hovered item's offset minus the scroll.
 */
const RAIL_SLOT = 48;
const RAIL_TIP_LEFT = (DESKTOP_RAIL_WIDTH - RAIL_SLOT) / 2 + 56;
const RailPages: React.FC<{
  groups: SidebarGroup[];
  activeKey: string;
  go: (path: string) => () => void;
}> = ({ groups, activeKey, go }) => {
  const [tip, setTip] = useState<{ key: string; label: string } | null>(null);
  const [scrollY, setScrollY] = useState(0);
  const [areaY, setAreaY] = useState(0);
  const slotY = useRef<Record<string, number>>({});
  const tipTop = tip === null ? 0 : areaY + (slotY.current[tip.key] ?? 0) - scrollY;
  return (
    <>
      <ScrollView
        style={styles.railScroll}
        contentContainerStyle={styles.railScrollContent}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e) => setScrollY(e.nativeEvent.contentOffset.y)}
        onLayout={(e) => setAreaY(e.nativeEvent.layout.y)}
        testID="sidebar-rail-scroll"
      >
        {groups.map((group) => (
          <React.Fragment key={group.key}>
            {group.title !== null ? (
              <View style={styles.railDivider} testID={`sidebar-rail-divider-${group.key}`} />
            ) : null}
            {group.items.map((item) => {
              const on = item.key === activeKey;
              return (
                <RailItem
                  key={item.key}
                  tipKey={item.key}
                  label={item.label}
                  role="tab"
                  on={on}
                  onPress={go(item.path)}
                  onTip={(show) =>
                    setTip((cur) => (show ? { key: item.key, label: item.label } : cur?.key === item.key ? null : cur))
                  }
                  onSlotLayout={(y) => {
                    slotY.current[item.key] = y;
                  }}
                >
                  <Icon name={item.icon} size={20} color={on ? color.accent : color.text2} />
                </RailItem>
              );
            })}
          </React.Fragment>
        ))}
      </ScrollView>
      {tip !== null ? (
        <RailTip tipKey={tip.key} label={tip.label} style={{ top: tipTop, left: RAIL_TIP_LEFT }} />
      ) : null}
    </>
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
  /** Pages in the scroll list: the rail draws the label (see RailPages). */
  onTip?: (show: boolean) => void;
  onSlotLayout?: (y: number) => void;
}> = ({ tipKey, label, role, on, onPress, children, onTip, onSlotLayout }) => {
  const [localTip, setLocalTip] = useState(false);
  const setTip = onTip ?? setLocalTip;
  const tip = onTip === undefined && localTip;
  const show = (): void => setTip(true);
  const hide = (): void => setTip(false);
  return (
    <View
      style={styles.railSlot}
      onLayout={onSlotLayout !== undefined ? (e) => onSlotLayout(e.nativeEvent.layout.y) : undefined}
    >
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
      {tip ? <RailTip tipKey={tipKey} label={label} /> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  railLogo: { marginBottom: space[3], alignItems: "center", justifyContent: "center" },
  itemOn: { backgroundColor: color.fill.railOn },
  itemHover: { backgroundColor: color.fill.rowHover },
  railItem: { width: 48, height: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  // The rail item's slot (anchors its label).
  railSlot: { position: "relative", width: 48, height: 48 },
  // The page list scrolls between the logo and Expand / Account.
  railScroll: { flex: 1, minHeight: 0, alignSelf: "stretch" },
  railScrollContent: { alignItems: "center", gap: space[2] },
  // The thin divider that stands in for a group title.
  railDivider: { width: 32, height: StyleSheet.hairlineWidth, backgroundColor: color.line, marginVertical: space[1] },
  railTipWrap: { position: "absolute", left: 56, top: 0, height: RAIL_SLOT, justifyContent: "center", zIndex: 1 },
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
