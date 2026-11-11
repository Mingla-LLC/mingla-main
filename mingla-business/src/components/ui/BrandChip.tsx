/**
 * #4389 (screen AB) — the brand chip, shared by Home's TopBar and Ari's top
 * bar. Extracted from TopBar unchanged: the same element tree, styles and
 * labels, so Home renders exactly as before (U-9).
 *
 * `fullNameLabel` is Ari's only difference: on a narrow first-run bar the name
 * truncates with "…" by layout, and the chip's accessibility label carries
 * the full name. Home keeps its 18-character label.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
// issue #3345 — loading vs absent. Store selectors only (no new query mounts).
import { useCurrentBrandStore } from "../../store/currentBrandStore";
import { isCurrentBrandPending } from "../../utils/currentBrandPending";

import { BrandMark, brandMarkPhotoUrl } from "../brand/BrandMark";
import { Icon } from "./Icon";

export const BRAND_LABEL_MAX_CHARS = 18;
const BRAND_MARK_SIZE = 24;

const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

export interface BrandChipProps {
  onPress: () => void;
  /** issue #3345 — the host knows the active brand is still being resolved. */
  brandLoading?: boolean;
  /** Ari: label truncates by layout; the accessibility label names the brand in full. */
  fullNameLabel?: boolean;
  testID?: string;
}

export const BrandChip: React.FC<BrandChipProps> = ({
  onPress,
  brandLoading = false,
  fullNameLabel = false,
  testID,
}) => {
  const currentBrand = useCurrentBrand();
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
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Brand: loading"
        accessibilityState={{ busy: true }}
        style={styles.brandRow}
        testID="topbar-brand-loading"
      >
        <View style={styles.brandLabelPlaceholder} />
        <Icon name="chevD" size={16} color={textTokens.tertiary} />
      </Pressable>
    );
  }
  const label =
    currentBrand === null
      ? "Create brand"
      : fullNameLabel
        ? currentBrand.displayName
        : truncate(currentBrand.displayName, BRAND_LABEL_MAX_CHARS);
  const a11yLabel =
    fullNameLabel && currentBrand !== null
      ? `Brand: ${currentBrand.displayName}. Switch brand`
      : `Brand: ${label}`;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      style={fullNameLabel ? [styles.brandRow, styles.brandRowShrink] : styles.brandRow}
      testID={testID}
    >
      {/* #3355 bug 17 — the brand's uploaded logo beside its name. The
          chip never showed a mark, so a brand without a logo keeps the
          name-only chip. */}
      {currentBrand !== null && brandMarkPhotoUrl(currentBrand) !== null ? (
        <BrandMark
          brand={currentBrand}
          size={BRAND_MARK_SIZE}
          testID="topbar-brand-mark"
        />
      ) : null}
      <Text
        style={fullNameLabel ? [styles.brandLabel, styles.brandLabelShrink] : styles.brandLabel}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Icon name="chevD" size={16} color={textTokens.tertiary} />
    </Pressable>
  );
};

const styles = StyleSheet.create({
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  brandRowShrink: {
    flexShrink: 1,
    minWidth: 0,
  },
  brandLabel: {
    color: textTokens.primary,
    fontSize: typography.bodyLg.fontSize,
    lineHeight: typography.bodyLg.lineHeight,
    fontWeight: "600",
  },
  brandLabelShrink: {
    flexShrink: 1,
  },
  // issue #3345 — the calm stand-in while the selected brand loads; the same
  // glass tint as Home's Recent skeletons, one label-line tall.
  brandLabelPlaceholder: {
    width: 112,
    height: typography.bodyLg.fontSize,
    borderRadius: radiusTokens.sm,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    opacity: 0.55,
  },
});

export default BrandChip;
