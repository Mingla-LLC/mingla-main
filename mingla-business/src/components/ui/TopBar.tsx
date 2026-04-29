/**
 * TopBar — top-of-screen chrome.
 *
 * Three left-slot variants:
 *   - `brand` — brand label + chevron-down. Reads `useCurrentBrand()`
 *               from `currentBrandStore`. When no brand exists, label
 *               is "Create brand" and tapping fires a Toast saying
 *               brand creation lands in Cycle 1. When a brand exists,
 *               tapping fires a Toast saying the brand switcher lands
 *               in Cycle 2. Subsequent taps on the chip toggle the
 *               Toast (open → dismiss). MinglaMark logo intentionally
 *               omitted per ORCH-BIZ-0a-D1.
 *   - `back`  — `chevL` IconChrome + optional title.
 *   - `none`  — no left content (renders empty View for layout balance).
 *
 * Right slot is configurable; defaults to a search IconChrome + bell
 * IconChrome with badge. Caller passes any `React.ReactNode`.
 *
 * Wrapper uses `GlassChrome` with `intensity="cardElevated"` (premium
 * frost), tinted floor `rgba(12,14,18,0.55)`, and `shadows.glassCard-
 * Elevated` for stronger separation from the canvas. Component-level
 * overrides per ORCH-BIZ-0a-D2 (Path D — full premium).
 */

import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import {
  shadows,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useCurrentBrand } from "../../store/currentBrandStore";

import { GlassChrome } from "./GlassChrome";
import { Icon } from "./Icon";
import { IconChrome } from "./IconChrome";
import { Toast } from "./Toast";
import type { ToastKind } from "./Toast";

export type TopBarLeftKind = "brand" | "back" | "none";

export interface TopBarProps {
  leftKind: TopBarLeftKind;
  /** Title text (`back` variant). Ignored for other variants. */
  title?: string;
  /** Back-button handler (`back` variant). */
  onBack?: () => void;
  /** Right slot content. If undefined, renders default search + bell IconChromes. */
  rightSlot?: React.ReactNode;
  /** Bell badge count when default right slot renders. */
  unreadCount?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const TOPBAR_HEIGHT = 56;
const BRAND_LABEL_MAX_CHARS = 18;

interface ToastState {
  kind: ToastKind;
  message: string;
}

const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

const DefaultRightSlot: React.FC<{ unreadCount: number | undefined }> = ({
  unreadCount,
}) => (
  <View style={styles.rightCluster}>
    {/* [TRANSITIONAL] right-slot icons render but onPress is unwired in
        Cycle 0a — Cycle 1+ wires search + notifications navigation. */}
    <IconChrome icon="search" size={36} accessibilityLabel="Search" />
    <IconChrome
      icon="bell"
      size={36}
      badge={unreadCount}
      accessibilityLabel="Notifications"
    />
  </View>
);

export const TopBar: React.FC<TopBarProps> = ({
  leftKind,
  title,
  onBack,
  rightSlot,
  unreadCount,
  testID,
  style,
}) => {
  const currentBrand = useCurrentBrand();
  const [toast, setToast] = useState<ToastState | null>(null);

  const handleBrandTap = (): void => {
    if (toast !== null) {
      setToast(null);
      return;
    }
    if (currentBrand === null) {
      setToast({ kind: "info", message: "Brand creation lands in Cycle 1." });
    } else {
      setToast({ kind: "info", message: "Brand switcher lands in Cycle 2." });
    }
  };

  const dismissToast = (): void => setToast(null);

  const renderLeft = (): React.ReactNode => {
    switch (leftKind) {
      case "brand": {
        const label =
          currentBrand === null
            ? "Create brand"
            : truncate(currentBrand.displayName, BRAND_LABEL_MAX_CHARS);
        return (
          <Pressable
            onPress={handleBrandTap}
            accessibilityRole="button"
            accessibilityLabel={`Brand: ${label}`}
            style={styles.brandRow}
          >
            <Text style={styles.brandLabel} numberOfLines={1}>
              {label}
            </Text>
            <Icon name="chevD" size={16} color={textTokens.tertiary} />
          </Pressable>
        );
      }
      case "back": {
        return (
          <View style={styles.backRow}>
            <IconChrome
              icon="chevL"
              size={36}
              onPress={onBack}
              accessibilityLabel="Back"
            />
            {title !== undefined ? (
              <Text style={styles.backTitle} numberOfLines={1}>
                {title}
              </Text>
            ) : null}
          </View>
        );
      }
      case "none":
      default:
        return <View style={styles.none} />;
    }
  };

  return (
    <View testID={testID} style={style}>
      <GlassChrome
        intensity="cardElevated"
        tintColor="rgba(12, 14, 18, 0.55)"
        shadow={shadows.glassCardElevated}
        radius="lg"
        style={styles.bar}
      >
        <View style={styles.barInner}>
          <View style={styles.leftSlot}>{renderLeft()}</View>
          <View style={styles.rightSlot}>
            {rightSlot ?? <DefaultRightSlot unreadCount={unreadCount} />}
          </View>
        </View>
      </GlassChrome>
      {toast !== null ? (
        <View style={styles.toastWrap} pointerEvents="box-none">
          <Toast
            visible={toast !== null}
            kind={toast.kind}
            message={toast.message}
            onDismiss={dismissToast}
          />
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    minHeight: TOPBAR_HEIGHT,
  },
  barInner: {
    minHeight: TOPBAR_HEIGHT,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  leftSlot: {
    flexShrink: 1,
    minWidth: 0,
  },
  rightSlot: {
    flexShrink: 0,
  },
  rightCluster: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  brandLabel: {
    color: textTokens.primary,
    fontSize: typography.bodyLg.fontSize,
    lineHeight: typography.bodyLg.lineHeight,
    fontWeight: "600",
  },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  backTitle: {
    color: textTokens.primary,
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
  },
  none: {
    width: 36,
    height: 36,
  },
  toastWrap: {
    position: "absolute",
    top: TOPBAR_HEIGHT + spacing.sm,
    left: 0,
    right: 0,
    zIndex: 1000,
    elevation: 1000,
  },
});

export default TopBar;
