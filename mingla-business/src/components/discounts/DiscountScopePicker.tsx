import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import type {
  BrandPriceRow,
  DiscountScopeKind,
  DiscountTarget,
} from "../../services/discountService";
import {
  DISCOUNT_LISTING_KIND_OPTIONS,
  hasOrphanedDiscountTarget,
  isDiscountPriceSelectable,
} from "./discountUiContract";

export interface DiscountScopePickerProps {
  scopeKind: DiscountScopeKind;
  targets: DiscountTarget[];
  prices: BrandPriceRow[];
  onScopeKindChange: (value: DiscountScopeKind) => void;
  onTargetsChange: (value: DiscountTarget[]) => void;
}

const selected = (targets: DiscountTarget[], target: DiscountTarget): boolean =>
  targets.some(
    (row) =>
      row.targetKind === target.targetKind &&
      row.targetId === target.targetId &&
      row.listingKind === target.listingKind,
  );

export const DiscountScopePicker: React.FC<DiscountScopePickerProps> = ({
  scopeKind,
  targets,
  prices,
  onScopeKindChange,
  onTargetsChange,
}) => {
  const toggle = (target: DiscountTarget): void => {
    onTargetsChange(
      selected(targets, target)
        ? targets.filter(
            (row) =>
              !(
                row.targetKind === target.targetKind &&
                row.targetId === target.targetId &&
                row.listingKind === target.listingKind
              ),
          )
        : [...targets, target],
    );
  };
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>What it applies to</Text>
      <View style={styles.segment}>
        {(["brand", "listing_kinds", "items"] as const).map((value) => (
          <Pressable
            key={value}
            onPress={() => onScopeKindChange(value)}
            accessibilityRole="radio"
            accessibilityLabel={
              value === "brand"
                ? "All eligible brand items"
                : value === "listing_kinds"
                  ? "Selected listing kinds"
                  : "Selected items"
            }
            accessibilityState={{ checked: scopeKind === value }}
            style={[
              styles.segmentButton,
              scopeKind === value && styles.segmentSelected,
            ]}
          >
            <Text
              style={[
                styles.segmentText,
                scopeKind === value && styles.segmentTextSelected,
              ]}
            >
              {value === "brand"
                ? "Brand"
                : value === "listing_kinds"
                  ? "Kinds"
                  : "Items"}
            </Text>
          </Pressable>
        ))}
      </View>
      {scopeKind === "brand" ? (
        <Text style={styles.help}>
          Every eligible paid item that has Allow discounts on.
        </Text>
      ) : null}
      {scopeKind === "listing_kinds"
        ? DISCOUNT_LISTING_KIND_OPTIONS.map(([kind, label]) => {
            const target: DiscountTarget = {
              targetKind: "listing_kind",
              listingKind: kind,
              targetId: null,
            };
            const isSelected = selected(targets, target);
            return (
              <Pressable
                key={kind}
                onPress={() => toggle(target)}
                style={styles.row}
                accessibilityRole="checkbox"
                accessibilityLabel={`${label} listing kind`}
                accessibilityState={{ checked: isSelected }}
              >
                <Text style={styles.rowMark}>{isSelected ? "✓" : "○"}</Text>
                <Text style={styles.rowText}>{label}</Text>
              </Pressable>
            );
          })
        : null}
      {scopeKind === "items"
        ? prices.map((price) => {
            const target: DiscountTarget = {
              targetKind: price.kind,
              targetId: price.id,
              listingKind: null,
            };
            const isSelected = selected(targets, target);
            return (
              <Pressable
                key={`${price.kind}:${price.id}`}
                disabled={!isDiscountPriceSelectable(price)}
                onPress={() => toggle(target)}
                style={[
                  styles.row,
                  !isDiscountPriceSelectable(price) && styles.rowDisabled,
                ]}
                accessibilityRole="checkbox"
                accessibilityLabel={`${price.itemName} in ${price.listingName}`}
                accessibilityState={{
                  checked: isSelected,
                  disabled: !isDiscountPriceSelectable(price),
                }}
              >
                <Text style={styles.rowMark}>{isSelected ? "✓" : "○"}</Text>
                <View style={styles.rowCopy}>
                  <Text style={styles.rowText}>{price.itemName}</Text>
                  <Text style={styles.rowSub}>
                    {price.listingName}
                    {isDiscountPriceSelectable(price)
                      ? ""
                      : " · Discounts are off for this item"}
                  </Text>
                </View>
              </Pressable>
            );
          })
        : null}
      {hasOrphanedDiscountTarget(targets) ? (
        <View style={styles.warning}>
          <Text style={styles.warningText}>
            Deleted item — remove it before saving.
          </Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { color: textTokens.primary, fontSize: 14, fontWeight: "700" },
  help: { color: textTokens.secondary, fontSize: 13, lineHeight: 19 },
  segment: {
    flexDirection: "row",
    padding: 3,
    backgroundColor: glass.tint.profileBase,
    borderRadius: radius.md,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 9,
    alignItems: "center",
    borderRadius: radius.sm,
  },
  segmentSelected: { backgroundColor: accent.warm },
  segmentText: { color: textTokens.secondary, fontWeight: "600", fontSize: 12 },
  segmentTextSelected: { color: "#fff" },
  row: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.profileBase,
    paddingVertical: spacing.xs,
  },
  rowDisabled: { opacity: 0.5 },
  rowMark: { width: 20, color: accent.warm, fontSize: 17 },
  rowCopy: { flex: 1 },
  rowText: { color: textTokens.primary, fontSize: 14, fontWeight: "600" },
  rowSub: { color: textTokens.secondary, fontSize: 12, marginTop: 2 },
  warning: {
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: "rgba(245,158,11,0.14)",
  },
  warningText: { color: textTokens.primary, fontSize: 13 },
});
