import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  color,
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
import { currencyCodeOrNull, formatCurrency } from "../../utils/currency";
import {
  DISCOUNT_LISTING_KIND_OPTIONS,
  DISCOUNT_SCOPE_OPTIONS,
  hasOrphanedDiscountTarget,
  isDiscountPriceSelectable,
} from "./discountEditorContract";

export interface DiscountScopePickerProps {
  scopeKind: DiscountScopeKind;
  targets: DiscountTarget[];
  prices: BrandPriceRow[];
  currencyCode: string | null;
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
  currencyCode,
  onScopeKindChange,
  onTargetsChange,
}) => {
  const code = currencyCodeOrNull(currencyCode);
  const groupedPrices = useMemo(() => {
    const groups = new Map<string, BrandPriceRow[]>();
    prices.forEach((price) => {
      const group = groups.get(price.listingName) ?? [];
      group.push(price);
      groups.set(price.listingName, group);
    });
    return Array.from(groups.entries());
  }, [prices]);

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
      <Text style={styles.help}>Choose one scope for this discount.</Text>
      <View style={styles.scopeCards} accessibilityRole="radiogroup">
        {DISCOUNT_SCOPE_OPTIONS.map(({ value, label, description }) => {
          const isSelected = scopeKind === value;
          return (
            <Pressable
              key={value}
              onPress={() => onScopeKindChange(value)}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityHint={description}
              accessibilityState={{ checked: isSelected }}
              style={[styles.scopeCard, isSelected && styles.scopeCardSelected]}
            >
              <View style={[styles.radio, isSelected && styles.radioSelected]}>
                {isSelected ? <View style={styles.radioCenter} /> : null}
              </View>
              <View style={styles.scopeCopy}>
                <Text style={styles.scopeTitle}>{label}</Text>
                <Text style={styles.scopeDescription}>{description}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {scopeKind === "brand" ? (
        <Text style={styles.help}>
          Items with Allow discounts turned off will still be excluded.
        </Text>
      ) : null}

      {scopeKind === "listing_kinds" ? (
        <View style={styles.chipWrap}>
          {DISCOUNT_LISTING_KIND_OPTIONS.map(([kind, label]) => {
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
                style={[styles.chip, isSelected && styles.chipSelected]}
                accessibilityRole="checkbox"
                accessibilityLabel={`${label} offering type`}
                accessibilityState={{ checked: isSelected }}
              >
                <Text
                  style={[
                    styles.chipText,
                    isSelected && styles.chipTextSelected,
                  ]}
                >
                  {isSelected ? "✓ " : ""}
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {scopeKind === "items" ? (
        groupedPrices.length === 0 ? (
          <Text style={styles.help}>No paid items are available yet.</Text>
        ) : (
          <View style={styles.itemGroups}>
            {groupedPrices.map(([listingName, rows]) => (
              <View key={listingName} style={styles.itemGroup}>
                <Text style={styles.groupTitle}>{listingName}</Text>
                <View style={styles.itemGrid}>
                  {rows.map((price) => {
                    const target: DiscountTarget = {
                      targetKind: price.kind,
                      targetId: price.id,
                      listingKind: null,
                    };
                    const isSelected = selected(targets, target);
                    const selectable = isDiscountPriceSelectable(price);
                    return (
                      <Pressable
                        key={`${price.kind}:${price.id}`}
                        disabled={!selectable}
                        onPress={() => toggle(target)}
                        style={[
                          styles.itemCard,
                          isSelected && styles.itemCardSelected,
                          !selectable && styles.itemCardDisabled,
                        ]}
                        accessibilityRole="checkbox"
                        accessibilityLabel={`${price.itemName} in ${price.listingName}`}
                        accessibilityState={{
                          checked: isSelected,
                          disabled: !selectable,
                        }}
                      >
                        <View
                          style={[
                            styles.checkbox,
                            isSelected && styles.checkboxSelected,
                          ]}
                        >
                          {isSelected ? (
                            <Text style={styles.checkmark}>✓</Text>
                          ) : null}
                        </View>
                        <View style={styles.itemCopy}>
                          <Text style={styles.itemName}>{price.itemName}</Text>
                          <Text style={styles.itemMeta}>
                            {selectable
                              ? code === null
                                ? "Price unavailable"
                                : formatCurrency(
                                    price.listUnitCents,
                                    code,
                                    true,
                                  )
                              : "Discounts are off for this item"}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>
        )
      ) : null}

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
  wrap: { gap: spacing.sm },
  label: { color: textTokens.primary, fontSize: 14, fontWeight: "700" },
  help: { color: textTokens.secondary, fontSize: 13, lineHeight: 19 },
  scopeCards: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  scopeCard: {
    flex: 1,
    minWidth: 180,
    minHeight: 76,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: glass.border.control,
    borderRadius: radius.md,
    backgroundColor: glass.tint.profileBase,
  },
  // #4420 — selection is the selected material, not orange.
  scopeCardSelected: {
    borderColor: color.lineStrong,
    backgroundColor: color.card3,
  },
  radio: {
    width: 19,
    height: 19,
    marginTop: 1,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: textTokens.tertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: { borderColor: color.paper },
  radioCenter: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: color.paper,
  },
  scopeCopy: { flex: 1, gap: 3 },
  scopeTitle: { color: textTokens.primary, fontSize: 14, fontWeight: "700" },
  scopeDescription: {
    color: textTokens.secondary,
    fontSize: 12,
    lineHeight: 17,
  },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: {
    minHeight: 38,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: glass.border.control,
    borderRadius: radius.full,
    backgroundColor: glass.tint.profileBase,
  },
  chipSelected: {
    borderColor: color.lineStrong,
    backgroundColor: color.card3,
  },
  chipText: { color: textTokens.secondary, fontSize: 13, fontWeight: "600" },
  chipTextSelected: { color: textTokens.primary },
  itemGroups: { gap: spacing.md },
  itemGroup: { gap: spacing.xs },
  groupTitle: {
    color: textTokens.secondary,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  itemGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  itemCard: {
    flexGrow: 1,
    flexBasis: 220,
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: glass.border.control,
    borderRadius: radius.md,
    backgroundColor: glass.tint.profileBase,
  },
  itemCardSelected: { borderColor: color.lineStrong, backgroundColor: color.card3 },
  itemCardDisabled: { opacity: 0.5 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: textTokens.tertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxSelected: { borderColor: color.paper, backgroundColor: color.paper },
  checkmark: { color: color.ink, fontSize: 13, fontWeight: "800" },
  itemCopy: { flex: 1, gap: 3 },
  itemName: { color: textTokens.primary, fontSize: 14, fontWeight: "600" },
  itemMeta: { color: textTokens.secondary, fontSize: 12 },
  warning: {
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: color.warningTint,
  },
  warningText: { color: textTokens.primary, fontSize: 13 },
});
