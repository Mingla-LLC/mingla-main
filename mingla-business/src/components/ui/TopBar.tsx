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
import { useRouter } from "expo-router";

import {
  shadows,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
// META-ORCH-1073 Sub-A — the TopBar search icon opens the global search sheet
// (mounted once at the (tabs) root). `getState().open()` avoids subscribing
// the whole TopBar to the sheet store. The bell stays unwired (out of scope).
import { useGlobalSearchSheet } from "../../hooks/useGlobalSearchSheet";

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
  /**
   * Right slot content. If defined, REPLACES the default `[search, bell]`
   * cluster.
   *
   * Per I-37: `leftKind="brand"` consumers MUST NOT pass `rightSlot=` —
   * use `extraRightSlot` to ADD icons after the default cluster instead.
   *
   * For `leftKind="back"` consumers, `rightSlot=` is the canonical
   * suppress/replace mechanism. Three documented patterns:
   *   - `rightSlot={null}` → suppresses default cluster entirely
   *     (e.g., `app/brand/[id]/audit-log.tsx`, `app/brand/[id]/team.tsx`
   *      loading branch)
   *   - `rightSlot={<View />}` → empty placeholder for layout balance
   *     (e.g., `BrandProfileView.tsx`, `BrandPaymentsView.tsx` ready/loading
   *      branches)
   *   - `rightSlot={<page-specific-action>}` → page-specific replace
   *     (e.g., `BrandEditView.tsx` Save button, `event/[id]/index.tsx`
   *      Share + Manage cluster, `team.tsx` invite Plus)
   *
   * Strict-grep CI gate enforces I-37 — `.github/workflows/strict-grep-
   * mingla-business.yml` fails CI if any `<TopBar leftKind="brand">`
   * consumer passes `rightSlot=`.
   */
  rightSlot?: React.ReactNode;
  /**
   * Optional icons composed AFTER the default `[search, bell]` cluster.
   * Use this for primary-tab page-specific extras (e.g., events tab `+`).
   * Renders inside the same flex row, gap=spacing.sm, in source order.
   *
   * Per I-37: ONLY honored when `rightSlot` is undefined. If both are
   * passed, `rightSlot` wins (preserves back-route compatibility);
   * the strict-grep CI gate flags `leftKind="brand"` consumers that
   * pass `rightSlot=` as I-37 violations.
   */
  extraRightSlot?: React.ReactNode;
  /** Bell badge count when default right slot renders. */
  unreadCount?: number;
  /**
   * Cycle 1+ override for brand-chip-tap behaviour (per DEC-079 carve-out).
   * When defined, suppresses the Cycle 0a transitional Toast and fires this
   * handler instead — typically to open BrandSwitcherSheet. When undefined,
   * the existing Cycle 0a Toast fires (backward compatible).
   * Anchor: line 11 header comment marks the Toast as Cycle 0a-transitional.
   */
  onBrandTap?: () => void;
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

/**
 * Default right-slot icons (search + bell). Rendered WITHOUT outer View
 * wrap so the parent render branch can compose with `extraRightSlot` in
 * one flex row. The wrapping `<View style={styles.rightCluster}>` lives
 * in the TopBar render branch below.
 */
const DefaultRightSlotInner: React.FC<{ unreadCount: number | undefined }> = ({
  unreadCount,
}) => (
  <>
    {/* META-ORCH-1073 Sub-A: the search icon opens the global search sheet. */}
    <IconChrome
      icon="search"
      size={36}
      accessibilityLabel="Search"
      onPress={() => useGlobalSearchSheet.getState().open()}
    />
    {/* [TRANSITIONAL] the bell's onPress is unwired in Cycle 0a — a later
        cycle wires notifications navigation (out of scope for Sub-A). */}
    <IconChrome
      icon="bell"
      size={36}
      badge={unreadCount}
      accessibilityLabel="Notifications"
    />
  </>
);

export const TopBar: React.FC<TopBarProps> = ({
  leftKind,
  title,
  onBack,
  rightSlot,
  extraRightSlot,
  unreadCount,
  onBrandTap,
  testID,
  style,
}) => {
  const currentBrand = useCurrentBrand();
  const router = useRouter();
  const { isWideDesktop } = useResponsiveLayout();
  const [toast, setToast] = useState<ToastState | null>(null);

  // Desktop top-bar layout (web ≥1024px, default-cluster consumers only):
  // `extraRightSlot` (typically the "+" CTA) moves to an absolutely-positioned
  // centre slot; right cluster gains an Account IconChrome after the bell.
  // Gate: isWideDesktop + rightSlot === undefined (respect any consumer
  // that fully replaces the right slot — back routes, BrandEdit Save, etc.).
  // Mobile + narrow web + rightSlot consumers: render byte-identical to today.
  const useDesktopLayout = isWideDesktop && rightSlot === undefined;

  const handleAccountTap = (): void => {
    router.push("/(tabs)/account" as never);
  };

  const handleBrandTap = (): void => {
    // Cycle 1+ override per DEC-079: caller supplies real handler (typically
    // opens BrandSwitcherSheet). Toast path remains for any consumer that
    // hasn't migrated yet.
    if (onBrandTap !== undefined) {
      onBrandTap();
      return;
    }
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
          {/* Centre slot — absolutely positioned + pointerEvents="box-none"
              so it doesn't intercept taps destined for left/right clusters.
              Only mounts when desktop layout is active AND extraRightSlot
              is non-null (otherwise empty overlay = no visual change). */}
          {useDesktopLayout && extraRightSlot !== undefined ? (
            <View style={styles.centerSlot} pointerEvents="box-none">
              {extraRightSlot}
            </View>
          ) : null}
          <View style={styles.rightSlot}>
            {rightSlot !== undefined ? rightSlot : (
              <View style={styles.rightCluster}>
                <DefaultRightSlotInner unreadCount={unreadCount} />
                {/* On desktop, Account moves from the rail to here; the +
                    button that would have been here moves to centerSlot
                    above. On mobile/narrow-web, render exactly as today
                    (extraRightSlot appended). */}
                {useDesktopLayout ? (
                  <IconChrome
                    icon="user"
                    size={36}
                    onPress={handleAccountTap}
                    accessibilityLabel="Account"
                  />
                ) : (
                  extraRightSlot
                )}
              </View>
            )}
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
  // Desktop-only centre slot. Absolutely positioned so it spans the full
  // bar width regardless of left/right cluster widths, guaranteeing the
  // child renders at the visual horizontal centre of the bar.
  centerSlot: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
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
