import React, { Suspense, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  accent,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { captureDiscountEvent } from "../../analytics/discountAnalytics";
import type {
  BrandDiscount,
  BrandPriceRow,
  DiscountFilter,
} from "../../services/discountService";
import { Button } from "../ui/Button";
import { PricesWorkspace } from "./PricesWorkspace";

const loadDiscountService = () => import("../../services/discountService");
const DISCOUNT_QUERY_ROOT = "brand-discounts";
const discountListKey = (brandId: string, filter: DiscountFilter) =>
  [DISCOUNT_QUERY_ROOT, "list", brandId, filter] as const;
const discountPricesKey = (brandId: string) =>
  [DISCOUNT_QUERY_ROOT, "prices", brandId] as const;

const LazyEditSheet = React.lazy(async () => {
  const mod = await import("./DiscountEditSheet");
  return { default: mod.DiscountEditSheet };
});
const FILTERS: [
  [DiscountFilter, string],
  [DiscountFilter, string],
  [DiscountFilter, string],
  [DiscountFilter, string],
] = [
  ["live", "Live"],
  ["scheduled", "Scheduled"],
  ["ended", "Ended"],
  ["needs_attention", "Needs attention"],
];

export interface DiscountListViewProps {
  brandId: string;
  rank: number;
  currencyCode: string | null;
  onOpenReport: () => void;
  onOpenRoute: (route: string) => void;
  onShareBlast: (discountId: string) => void;
}

export const DiscountListView: React.FC<DiscountListViewProps> = ({
  brandId,
  rank,
  currencyCode,
  onOpenReport,
  onOpenRoute,
  onShareBlast,
}) => {
  const client = useQueryClient();
  const [tab, setTab] = useState<"discounts" | "prices">("discounts");
  const [filter, setFilter] = useState<DiscountFilter>("live");
  const [editing, setEditing] = useState<BrandDiscount | null | undefined>(
    undefined,
  );
  const [preset, setPreset] = useState<BrandPriceRow | null>(null);
  const [saved, setSaved] = useState(false);
  const list = useQuery({
    queryKey: discountListKey(brandId, filter),
    queryFn: async () =>
      (await loadDiscountService()).fetchBrandDiscounts(brandId, filter),
  });
  const prices = useQuery({
    queryKey: discountPricesKey(brandId),
    queryFn: async () =>
      (await loadDiscountService()).fetchBrandPrices(brandId),
  });
  const action = useMutation({
    mutationFn: ({
      row,
      op,
    }: {
      row: BrandDiscount;
      op: "pause" | "resume" | "end" | "delete_draft";
    }) =>
      loadDiscountService().then(({ writeBrandDiscount }) =>
        writeBrandDiscount(op, {
          id: row.id,
          brandId,
          version: row.version,
        }),
      ),
    onSuccess: async (_saved, variables) => {
      await client.invalidateQueries({ queryKey: [DISCOUNT_QUERY_ROOT] });
      captureDiscountEvent("discount_updated", { action: variables.op });
      setSaved(true);
    },
  });
  const run = (
    row: BrandDiscount,
    op: "pause" | "resume" | "end" | "delete_draft",
  ): void => {
    if (op === "end")
      Alert.alert(
        "End this discount?",
        "Buyers will stop receiving it. Existing orders keep their discount.",
        [
          { text: "Keep live", style: "cancel" },
          {
            text: "End discount",
            style: "destructive",
            onPress: () => action.mutate({ row, op }),
          },
        ],
      );
    else action.mutate({ row, op });
  };
  const rows = list.data ?? [];
  const priceRows = prices.data ?? [];
  return (
    <View style={styles.page}>
      <View style={styles.top}>
        <View style={styles.tabs}>
          <Pressable
            onPress={() => setTab("discounts")}
            style={[styles.tab, tab === "discounts" && styles.tabOn]}
          >
            <Text
              style={[styles.tabText, tab === "discounts" && styles.tabTextOn]}
            >
              Discounts
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setTab("prices")}
            style={[styles.tab, tab === "prices" && styles.tabOn]}
          >
            <Text
              style={[styles.tabText, tab === "prices" && styles.tabTextOn]}
            >
              Prices
            </Text>
          </Pressable>
        </View>
        <Button
          label="Results"
          variant="secondary"
          size="sm"
          onPress={onOpenReport}
        />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        {saved ? (
          <View style={styles.saved}>
            <Text style={styles.savedText}>Saved</Text>
          </View>
        ) : null}
        {tab === "discounts" ? (
          <>
            <View style={styles.hero}>
              <View style={styles.heroCopy}>
                <Text style={styles.heroTitle}>
                  Deals your buyers can trust
                </Text>
                <Text style={styles.heroSub}>
                  Create a code, an automatic discount or a sale price. You
                  choose where it works and what it can combine with.
                </Text>
              </View>
              <Button
                label="Create discount"
                onPress={() => {
                  setPreset(null);
                  setEditing(null);
                }}
              />
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filters}
            >
              {FILTERS.map(([value, label]) => (
                <Pressable
                  key={value}
                  onPress={() => setFilter(value)}
                  accessibilityRole="radio"
                  accessibilityLabel={`${label} discounts`}
                  accessibilityState={{ checked: filter === value }}
                  style={[styles.filter, filter === value && styles.filterOn]}
                >
                  <Text
                    style={[
                      styles.filterText,
                      filter === value && styles.filterTextOn,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            {filter === "needs_attention" && rows.length > 0 ? (
              <View style={styles.warning}>
                <Text style={styles.warningTitle}>Some discounts need you</Text>
                <Text style={styles.heroSub}>
                  A target was deleted or its currency changed. Open each row
                  and choose a replacement.
                </Text>
              </View>
            ) : null}
            {list.isLoading ? (
              <Text style={styles.state}>Loading discounts…</Text>
            ) : list.isError ? (
              <View style={styles.stateBox}>
                <Text style={styles.state}>Couldn’t load discounts.</Text>
                <Button
                  label="Try again"
                  variant="secondary"
                  onPress={() => void list.refetch()}
                />
              </View>
            ) : rows.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>
                  No{" "}
                  {FILTERS.find(([key]) => key === filter)?.[1].toLowerCase()}{" "}
                  discounts
                </Text>
                <Text style={styles.heroSub}>
                  Create one when you’re ready. Defaults guide you; every
                  available choice stays editable.
                </Text>
                <Button
                  label="Create discount"
                  onPress={() => {
                    setPreset(null);
                    setEditing(null);
                  }}
                />
              </View>
            ) : (
              rows.map((row) => (
                <DiscountRow
                  key={row.id}
                  row={row}
                  rank={rank}
                  onEdit={() => setEditing(row)}
                  onAction={(op) => run(row, op)}
                  onBlast={() => onShareBlast(row.id)}
                />
              ))
            )}
          </>
        ) : prices.isLoading ? (
          <Text style={styles.state}>Loading prices…</Text>
        ) : prices.isError ? (
          <View style={styles.stateBox}>
            <Text style={styles.state}>Couldn’t load prices.</Text>
            <Button
              label="Try again"
              variant="secondary"
              onPress={() => void prices.refetch()}
            />
          </View>
        ) : (
          <PricesWorkspace
            brandId={brandId}
            rank={rank}
            rows={priceRows}
            onStartSale={(row) => {
              setPreset(row);
              setEditing(null);
            }}
            onOpenOwner={onOpenRoute}
          />
        )}
      </ScrollView>
      {editing !== undefined ? (
        <Suspense fallback={null}>
          <LazyEditSheet
            visible
            brandId={brandId}
            rank={rank}
            currencyCode={currencyCode}
            prices={priceRows}
            discount={editing}
            presetTarget={preset}
            onClose={() => {
              setEditing(undefined);
              setPreset(null);
            }}
            onSaved={() => {
              setEditing(undefined);
              setPreset(null);
              setSaved(true);
            }}
          />
        </Suspense>
      ) : null}
    </View>
  );
};

const DiscountRow: React.FC<{
  row: BrandDiscount;
  rank: number;
  onEdit: () => void;
  onAction: (op: "pause" | "resume" | "end" | "delete_draft") => void;
  onBlast: () => void;
}> = ({ row, rank, onEdit, onAction, onBlast }) => {
  const value =
    row.valueType === "percent"
      ? `${(row.valueBps ?? 0) / 100}% off`
      : row.valueType === "set_price"
        ? `${((row.valueMinor ?? 0) / 100).toFixed(2)} sale price`
        : `${((row.valueMinor ?? 0) / 100).toFixed(2)} off`;
  const used = row.endsAfterCount ?? row.maxTotalUses;
  const consumed = row.endsAfterCount ? row.consumedUnits : row.liveUses;
  const ratio = used ? Math.min(1, consumed / used) : 0;
  return (
    <View style={styles.card}>
      <View style={styles.rowHead}>
        <View style={styles.type}>
          <Text style={styles.typeText}>
            {row.kind === "sale_price" ? "SALE" : row.kind.toUpperCase()}
          </Text>
        </View>
        <Text style={styles.status}>
          {row.needsAttention ? "NEEDS ATTENTION" : row.status.toUpperCase()}
        </Text>
      </View>
      <Pressable
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${row.name}`}
      >
        <Text style={styles.name}>{row.name}</Text>
        <Text style={styles.value}>
          {value} · {row.scopeKind.replace("_", " ")}
        </Text>
        <Text style={styles.heroSub}>
          {row.endsAt
            ? `Ends ${new Date(row.endsAt).toLocaleString()}`
            : "No end date"}
        </Text>
      </Pressable>
      {used ? (
        <View>
          <View style={styles.progress}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${ratio * 100}%`,
                  backgroundColor: ratio >= 0.8 ? "#f59e0b" : accent.warm,
                },
              ]}
            />
          </View>
          <Text style={styles.usage}>
            {consumed} of {used} used
          </Text>
        </View>
      ) : null}
      <View style={styles.actions}>
        <Button label="Edit" size="sm" variant="secondary" onPress={onEdit} />
        {row.kind === "code" ? (
          <Button
            label="Share in a Blast"
            size="sm"
            variant="ghost"
            onPress={onBlast}
          />
        ) : null}
        {row.status === "active" ? (
          <Button
            label="Pause"
            size="sm"
            variant="ghost"
            onPress={() => onAction("pause")}
          />
        ) : row.status === "paused" ? (
          <Button
            label="Resume"
            size="sm"
            variant="ghost"
            onPress={() => onAction("resume")}
          />
        ) : null}
        {row.status !== "ended" && rank >= 20 ? (
          <Button
            label="End"
            size="sm"
            variant="ghost"
            onPress={() => onAction("end")}
          />
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  page: { flex: 1 },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  tabs: {
    flexDirection: "row",
    padding: 3,
    borderRadius: radius.md,
    backgroundColor: glass.tint.profileBase,
  },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderRadius: radius.sm,
  },
  tabOn: { backgroundColor: accent.warm },
  tabText: { color: textTokens.secondary, fontWeight: "700" },
  tabTextOn: { color: "#fff" },
  scroll: { padding: spacing.md, gap: spacing.sm, paddingBottom: 80 },
  saved: {
    alignSelf: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: semantic.successTint,
  },
  savedText: { color: textTokens.primary, fontWeight: "700" },
  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: glass.tint.profileElevated,
  },
  heroCopy: { flex: 1, gap: 5 },
  heroTitle: { fontSize: 20, fontWeight: "800", color: textTokens.primary },
  heroSub: { fontSize: 12, lineHeight: 18, color: textTokens.secondary },
  filters: { gap: spacing.xs, paddingVertical: 2 },
  filter: {
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderRadius: radius.full,
    backgroundColor: glass.tint.profileBase,
  },
  filterOn: { backgroundColor: accent.warm },
  filterText: { fontSize: 12, fontWeight: "700", color: textTokens.secondary },
  filterTextOn: { color: "#fff" },
  warning: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: semantic.warningTint,
    gap: 4,
  },
  warningTitle: { color: textTokens.primary, fontWeight: "800" },
  state: {
    padding: spacing.xl,
    color: textTokens.secondary,
    textAlign: "center",
  },
  stateBox: { padding: spacing.xl, alignItems: "center", gap: spacing.sm },
  empty: { padding: spacing.xl, alignItems: "center", gap: spacing.sm },
  emptyTitle: { fontSize: 18, fontWeight: "800", color: textTokens.primary },
  card: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    gap: spacing.sm,
  },
  rowHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  type: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: "rgba(235,120,37,.18)",
  },
  typeText: { fontSize: 9, fontWeight: "900", color: accent.warm },
  status: { fontSize: 9, fontWeight: "800", color: textTokens.tertiary },
  name: { fontSize: 17, fontWeight: "800", color: textTokens.primary },
  value: {
    fontSize: 14,
    fontWeight: "700",
    color: textTokens.primary,
    marginTop: 4,
  },
  progress: {
    height: 6,
    borderRadius: radius.full,
    overflow: "hidden",
    backgroundColor: glass.tint.profileElevated,
  },
  progressFill: { height: 6 },
  usage: { fontSize: 11, color: textTokens.secondary, marginTop: 4 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
});
