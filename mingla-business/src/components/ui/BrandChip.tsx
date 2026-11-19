/**
 * #4389 (screen AB) — the brand chip, shared by Home's TopBar and Ari's top
 * bar.
 *
 * #4453 (contract section I) — the chip names the brand of the SCREEN you are
 * on, not just the current-brand store: a screen that names its brand (the
 * `brand` prop: its own, or the route's, e.g. `/brand/<id>/website`) wins. It is the
 * trigger of WorkspaceBrandSwitcher: brand mark, name, chevron, at least 44pt
 * tall, and its label always carries the full name ("Brand: Gameland Lagos.
 * Switch brand") however the visible name is shortened.
 *
 * `fullNameLabel`: the name truncates with "…" by layout instead of the
 * 18-character label Home keeps.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  radius as radiusTokens,
  color,
  space,
  type,
} from "../../constants/designSystem";
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
// issue #3345 — loading vs absent. Store selectors only (no new query mounts).
import { useCurrentBrandStore } from "../../store/currentBrandStore";
import type { Brand } from "../../types/brand";
import { isCurrentBrandPending } from "../../utils/currentBrandPending";

import { BrandMark } from "../brand/BrandMark";
import { Icon } from "./Icon";

export const BRAND_LABEL_MAX_CHARS = 18;
const BRAND_MARK_SIZE = 24;

const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

export interface BrandChipProps {
  onPress?: () => void;
  /** issue #3345 — the host knows the active brand is still being resolved. */
  brandLoading?: boolean;
  /** Ari: label truncates by layout; the accessibility label names the brand in full. */
  fullNameLabel?: boolean;
  /**
   * #4453 — the brand of the screen, when the screen names one: the switcher
   * passes its own, a bare chip passes the route's from the shell
   * (`useContext(WorkspaceRouteContext).brand`). Undefined: the current
   * brand. Null: that brand is still being read (pass `brandLoading` too).
   */
  brand?: Brand | null;
  /** #4453 — the brand mark's size (a tight header uses a smaller one). */
  markSize?: number;
  /** #4453 — the switcher says whether its menu is open (announced to screen readers). */
  accessibilityState?: { expanded: boolean };
  /** #4453 — the pressable, so a popover can anchor under it and hand focus back. */
  chipRef?: React.Ref<View>;
  testID?: string;
}

export const BrandChip: React.FC<BrandChipProps> = ({
  onPress,
  brandLoading = false,
  fullNameLabel = false,
  brand,
  markSize = BRAND_MARK_SIZE,
  accessibilityState,
  chipRef,
  testID,
}) => {
  // #4453 — a screen that names its brand shows that brand; otherwise the
  // chip follows the current brand, as before.
  const storeBrand = useCurrentBrand();
  const currentBrand = brand === undefined ? storeBrand : brand;
  const currentBrandId = useCurrentBrandStore((s) => s.currentBrandId);
  const hasBrandHydrated = useCurrentBrandStore((s) => s.hasHydrated);
  // issue #3345 — "no brand yet" is not "no brand". A selected brand whose record
  // is still on its way must never read "Create brand".
  const brandPending =
    currentBrand === null &&
    (brandLoading ||
      isCurrentBrandPending({
        brandPresent: false,
        currentBrandId,
        hasHydrated: hasBrandHydrated,
      }));

  if (brandPending) {
    return (
      <Pressable
        ref={chipRef}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Brand: loading"
        accessibilityState={{ busy: true }}
        style={styles.brandRow}
        testID="topbar-brand-loading"
      >
        <View style={styles.brandLabelPlaceholder} />
        <Icon name="chevD" size={16} color={color.text3} />
      </Pressable>
    );
  }
  const label =
    currentBrand === null
      ? "Create brand"
      : fullNameLabel
        ? currentBrand.displayName
        : truncate(currentBrand.displayName, BRAND_LABEL_MAX_CHARS);
  // #4453 — always the full name, and always says what a press does.
  const a11yLabel =
    currentBrand !== null
      ? `Brand: ${currentBrand.displayName}. Switch brand`
      : `Brand: ${label}`;
  return (
    <Pressable
      ref={chipRef}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityState={accessibilityState}
      style={fullNameLabel ? [styles.brandRow, styles.brandRowShrink] : styles.brandRow}
      testID={testID}
    >
      {/* #3355 bug 17 — the brand's uploaded logo beside its name.
          #4420: a brand without a logo shows its initial on the surface
          fill (BrandMark's fallback), the same mark the switcher uses. */}
      {currentBrand !== null ? (
        <BrandMark
          brand={currentBrand}
          size={markSize}
          testID="topbar-brand-mark"
        />
      ) : null}
      <Text
        style={fullNameLabel ? [styles.brandLabel, styles.brandLabelShrink] : styles.brandLabel}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Icon name="chevD" size={16} color={color.text3} />
    </Pressable>
  );
};

const styles = StyleSheet.create({
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    minWidth: 0,
    // #4453 — the chip is a control: never shorter than a 44pt target.
    minHeight: 44,
  },
  brandRowShrink: {
    flexShrink: 1,
    minWidth: 0,
  },
  // #4255 W5 — four icons on a 320pt phone: the brand name truncates.
  brandLabel: {
    flexShrink: 1,
    color: color.text1,
    fontSize: type.row.fontSize,
    lineHeight: type.row.lineHeight,
    fontWeight: "600",
  },
  brandLabelShrink: {
    flexShrink: 1,
  },
  // issue #3345 — the calm stand-in while the selected brand loads; the same
  // glass tint as Home's Recent skeletons, one label-line tall.
  brandLabelPlaceholder: {
    width: 112,
    height: type.row.fontSize,
    borderRadius: radiusTokens.sm,
    backgroundColor: color.fill.inset,
    borderWidth: 1,
    borderColor: color.line,
    opacity: 0.55,
  },
});

export default BrandChip;
