/**
 * Menu — #4420 Graphite Glass (spec §3.2). Row actions.
 *   Phone and narrow web: an action sheet over the shared Sheet (handle,
 *   rows, a Cancel row), sized to its rows and clamped to the safe area.
 *   Web >= 1024 with an `anchor`: a popover in the sheet material, under the
 *   anchor and right-aligned to it, kept inside the viewport.
 * Danger items read red. Pressing an item closes the menu, then runs it.
 */

import React from "react";
import { Modal as RNModal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import type { PressableStateCallbackType } from "react-native";

import { color, radius, shadow, space, type } from "../../constants/designSystem";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";

import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import { Material } from "./Material";
import { Sheet } from "./Sheet";

export interface MenuItem {
  key: string;
  label: string;
  icon?: IconName;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
}

export interface MenuAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MenuProps {
  visible: boolean;
  onClose: () => void;
  items: readonly MenuItem[];
  title?: string;
  /** Web popover anchor (page coordinates of the trigger). */
  anchor?: MenuAnchor | null;
  cancelLabel?: string;
  testID?: string;
}

export const MENU_ROW_HEIGHT = 52;
export const MENU_POPOVER_WIDTH = 240;

/** Popover position: under the anchor, right-aligned, inside the viewport. */
export const menuPopoverPosition = (
  anchor: MenuAnchor,
  itemCount: number,
  viewport: { width: number; height: number },
): { left: number; top: number } => {
  const height = itemCount * 40 + space[2] * 2;
  const gap = space[1];
  const left = Math.max(space[2], Math.min(anchor.x + anchor.width - MENU_POPOVER_WIDTH, viewport.width - MENU_POPOVER_WIDTH - space[2]));
  const below = anchor.y + anchor.height + gap;
  const top = below + height <= viewport.height - space[2] ? below : Math.max(space[2], anchor.y - gap - height);
  return { left, top };
};

export const Menu: React.FC<MenuProps> = ({ visible, onClose, items, title, anchor, cancelLabel = "Cancel", testID }) => {
  const { isWideDesktop } = useResponsiveLayout();
  const viewport = useWindowDimensions();
  const run = (item: MenuItem): void => {
    if (item.disabled) return;
    onClose();
    item.onPress();
  };

  if (isWideDesktop && anchor) {
    if (!visible) return null;
    const pos = menuPopoverPosition(anchor, items.length, viewport);
    return (
      <RNModal visible transparent animationType="none" onRequestClose={onClose}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close menu" accessibilityRole="button" />
        <View style={[styles.popover, shadow.menu, { left: pos.left, top: pos.top }]} testID={testID}>
          <Material kind="sheet" radius={radius.md} style={styles.popoverSurface}>
            {items.map((item) => (
              <Pressable
                key={item.key}
                onPress={() => run(item)}
                disabled={item.disabled}
                accessibilityRole="menuitem"
                accessibilityLabel={item.label}
                accessibilityState={{ disabled: item.disabled === true }}
                testID={item.testID}
              >
                {(state: PressableStateCallbackType & { hovered?: boolean }) => (
                  <View style={[styles.popRow, state.hovered || state.pressed ? styles.popRowHover : null, item.disabled ? styles.disabled : null]}>
                    {item.icon !== undefined ? <Icon name={item.icon} size={16} color={item.danger ? color.errorText : color.text2} /> : null}
                    <Text style={[styles.popLabel, item.danger ? styles.danger : null]} numberOfLines={1}>
                      {item.label}
                    </Text>
                  </View>
                )}
              </Pressable>
            ))}
          </Material>
        </View>
      </RNModal>
    );
  }

  const headerHeight = title !== undefined ? 44 : 0;
  const sheetHeight = 24 + headerHeight + (items.length + 1) * MENU_ROW_HEIGHT + space[3] + space[6];
  return (
    <Sheet visible={visible} onClose={onClose} snapPoint={sheetHeight} testID={testID}>
      <View style={styles.sheetBody}>
        {title !== undefined ? <Text style={styles.sheetTitle} numberOfLines={1}>{title}</Text> : null}
        {items.map((item, index) => (
          <Pressable
            key={item.key}
            onPress={() => run(item)}
            disabled={item.disabled}
            accessibilityRole="menuitem"
            accessibilityLabel={item.label}
            accessibilityState={{ disabled: item.disabled === true }}
            testID={item.testID}
            style={({ pressed }) => [styles.sheetRow, index > 0 ? styles.divider : null, pressed ? styles.pressed : null, item.disabled ? styles.disabled : null]}
          >
            {item.icon !== undefined ? <Icon name={item.icon} size={18} color={item.danger ? color.errorText : color.text1} /> : null}
            <Text style={[styles.sheetLabel, item.danger ? styles.danger : null]} numberOfLines={1}>
              {item.label}
            </Text>
          </Pressable>
        ))}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={cancelLabel}
          style={({ pressed }) => [styles.sheetRow, styles.cancel, pressed ? styles.pressed : null]}
        >
          <Text style={[styles.sheetLabel, styles.cancelLabel]}>{cancelLabel}</Text>
        </Pressable>
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  popover: { position: "absolute", width: MENU_POPOVER_WIDTH, borderRadius: radius.md },
  popoverSurface: { paddingVertical: space[2] },
  popRow: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 40, paddingHorizontal: space[4] },
  popRowHover: { backgroundColor: color.fill.rowHover },
  popLabel: { ...type.small, color: color.text1, flex: 1 },
  sheetBody: { flex: 1 },
  sheetTitle: { ...type.caption, color: color.text3, textAlign: "center", paddingBottom: space[3], minHeight: 44 - space[3] },
  sheetRow: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: MENU_ROW_HEIGHT, paddingHorizontal: space[1] },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  pressed: { backgroundColor: color.fill.pressed },
  sheetLabel: { ...type.row, color: color.text1, flex: 1 },
  danger: { color: color.errorText },
  disabled: { opacity: 0.45 },
  cancel: { marginTop: space[3], justifyContent: "center", borderRadius: radius.md, backgroundColor: color.fill.tile },
  cancelLabel: { textAlign: "center" },
});

export default Menu;
