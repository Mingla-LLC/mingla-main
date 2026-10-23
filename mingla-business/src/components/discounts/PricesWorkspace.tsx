import React, { useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { captureDiscountEvent } from "../../analytics/discountAnalytics";
import type { BrandPriceRow } from "../../services/discountService";
import { Button } from "../ui/Button";

const loadDiscountService = () => import("../../services/discountService");
const DISCOUNT_QUERY_ROOT = "brand-discounts";

export interface PricesWorkspaceProps {
  brandId: string;
  rank: number;
  rows: BrandPriceRow[];
  onStartSale: (row: BrandPriceRow) => void;
  onOpenOwner: (route: string) => void;
}

export const PricesWorkspace: React.FC<PricesWorkspaceProps> = ({
  brandId,
  rank,
  rows,
  onStartSale,
  onOpenOwner,
}) => {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const mutation = useMutation({
    mutationFn: ({
      kind,
      ids,
      allowed,
    }: {
      kind: BrandPriceRow["kind"];
      ids: string[];
      allowed: boolean;
    }) =>
      loadDiscountService().then(({ setDiscountsAllowed }) =>
        setDiscountsAllowed(kind, ids, allowed),
      ),
    onSuccess: async (_result, variables) => {
      captureDiscountEvent("discount_allow_toggled", {
        item_kind: variables.kind,
        allowed: variables.allowed,
      });
      await queryClient.invalidateQueries({
        queryKey: [DISCOUNT_QUERY_ROOT, "prices", brandId],
      });
    },
  });
  const toggleSelect = (id: string): void =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  const selectedRows = rows.filter((row) => selected.includes(row.id));
  return (
    <View style={styles.wrap}>
      {rank < 30 ? (
        <Text style={styles.notice}>
          You can view prices. Ask an owner, admin or finance manager to change
          sales or Allow discounts.
        </Text>
      ) : null}
      {selectedRows.length > 0 && rank >= 30 ? (
        <View style={styles.bulk}>
          <Text style={styles.bulkTitle}>{selectedRows.length} selected</Text>
          <View style={styles.bulkActions}>
            <Button
              label="Allow"
              size="sm"
              variant="secondary"
              onPress={() => {
                for (const row of selectedRows)
                  mutation.mutate({
                    kind: row.kind,
                    ids: [row.id],
                    allowed: true,
                  });
              }}
            />
            <Button
              label="Turn off"
              size="sm"
              variant="secondary"
              onPress={() => {
                for (const row of selectedRows)
                  mutation.mutate({
                    kind: row.kind,
                    ids: [row.id],
                    allowed: false,
                  });
              }}
            />
            <Button
              label="Start discount"
              size="sm"
              disabled={selectedRows.length !== 1}
              onPress={() => {
                if (selectedRows[0]) onStartSale(selectedRows[0]);
              }}
            />
          </View>
          {selectedRows.length !== 1 ? (
            <Text style={styles.help}>
              Select exactly one item to set a sale price.
            </Text>
          ) : null}
        </View>
      ) : null}
      {rows.map((row) => (
        <View key={`${row.kind}:${row.id}`} style={styles.card}>
          <Pressable
            onPress={() => toggleSelect(row.id)}
            disabled={rank < 30}
            style={styles.check}
            accessibilityRole="checkbox"
            accessibilityLabel={`Select ${row.itemName}`}
            accessibilityState={{
              checked: selected.includes(row.id),
              disabled: rank < 30,
            }}
          >
            <Text style={styles.checkText}>
              {selected.includes(row.id) ? "✓" : "○"}
            </Text>
          </Pressable>
          <Pressable
            style={styles.copy}
            onPress={() => onOpenOwner(row.ownerRoute)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${row.itemName} in ${row.listingName}`}
          >
            <Text style={styles.name}>{row.itemName}</Text>
            <Text style={styles.sub}>{row.listingName}</Text>
            <Text style={styles.price}>
              {row.currentSaleCents == null
                ? `${(row.listUnitCents / 100).toFixed(2)}`
                : `${(row.currentSaleCents / 100).toFixed(2)} · was ${(row.listUnitCents / 100).toFixed(2)}`}
            </Text>
          </Pressable>
          <View style={styles.allow}>
            <Text style={styles.pill}>
              {row.discountsAllowed ? "ALLOW ON" : "ALLOW OFF"}
            </Text>
            <Switch
              value={row.discountsAllowed}
              disabled={rank < 30 || mutation.isPending}
              onValueChange={(allowed) =>
                mutation.mutate({ kind: row.kind, ids: [row.id], allowed })
              }
            />
          </View>
        </View>
      ))}
      {rows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.name}>No discountable prices yet</Text>
          <Text style={styles.sub}>
            Publish a paid ticket, menu item or reservation deposit first.
          </Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  notice: {
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: glass.tint.profileBase,
    color: textTokens.secondary,
    fontSize: 13,
    lineHeight: 19,
  },
  bulk: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: glass.tint.profileElevated,
    gap: spacing.sm,
  },
  bulkTitle: { fontWeight: "800", color: textTokens.primary },
  bulkActions: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" },
  help: { color: textTokens.secondary, fontSize: 12 },
  card: {
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    gap: spacing.sm,
  },
  check: {
    width: 28,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  checkText: { color: accent.warm, fontSize: 19 },
  copy: { flex: 1 },
  name: { color: textTokens.primary, fontWeight: "700", fontSize: 14 },
  sub: { color: textTokens.secondary, fontSize: 12, marginTop: 2 },
  price: {
    color: textTokens.primary,
    fontWeight: "700",
    fontSize: 13,
    marginTop: 5,
  },
  allow: { alignItems: "flex-end", gap: 4 },
  pill: { color: textTokens.tertiary, fontSize: 9, fontWeight: "800" },
  empty: { padding: spacing.xl, alignItems: "center", gap: spacing.xs },
});
