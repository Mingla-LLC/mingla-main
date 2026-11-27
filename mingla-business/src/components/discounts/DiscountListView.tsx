import React, { Suspense, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { color, radius, space, type } from "../../constants/designSystem";
import { captureDiscountEvent } from "../../analytics/discountAnalytics";
import type {
  BrandDiscount,
  BrandPriceRow,
  DiscountFilter,
} from "../../services/discountService";
import { Button } from "../ui/Button";
import { Chip, Segmented } from "../ui/Pill";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { PricesWorkspace } from "./PricesWorkspace";
import { DISCOUNT_SCOPE_LABELS } from "./discountScopeLabels";
import { discountOverLimitLabel, discountUsageLabel } from "./discountUsageLabel";

const loadDiscountService = () => import("../../services/discountService");
const DISCOUNT_QUERY_ROOT = "brand-discounts";
const discountListKey = (brandId: string, filter: DiscountFilter) =>
  [DISCOUNT_QUERY_ROOT, "list", brandId, filter] as const;
const discountPricesKey = (brandId: string) =>
  [DISCOUNT_QUERY_ROOT, "prices", brandId] as const;
// #4624: the "Specific offerings" picker's events, experiences and trips.
const discountOfferingsKey = (brandId: string) =>
  [DISCOUNT_QUERY_ROOT, "offerings", brandId] as const;

const LazyEditSheet = React.lazy(async () => {
  const mod = await import("./DiscountEditSheet");
  return { default: mod.DiscountEditSheet };
});
/**
 * #4304: Alert.alert with buttons is a no-op on react-native-web, so End did
 * nothing on host.usemingla.com. ConfirmDialog works on web and native; it
 * loads only when the dialog opens, keeping it off the boot bundle.
 */
const LazyConfirmDialog = React.lazy(() =>
  import("../ui/ConfirmDialog").then((module) => ({
    default: module.ConfirmDialog,
  })),
);
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
  const { isWideDesktop } = useResponsiveLayout();
  const [tab, setTab] = useState<"discounts" | "prices">("discounts");
  const [filter, setFilter] = useState<DiscountFilter>("live");
  const [editing, setEditing] = useState<BrandDiscount | null | undefined>(
    undefined,
  );
  const [preset, setPreset] = useState<BrandPriceRow | null>(null);
  const [saved, setSaved] = useState(false);
  const [endTarget, setEndTarget] = useState<BrandDiscount | null>(null);
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
  const offerings = useQuery({
    queryKey: discountOfferingsKey(brandId),
    queryFn: async () =>
      (await loadDiscountService()).fetchDiscountOfferings(brandId),
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
    if (op === "end") setEndTarget(row);
    else action.mutate({ row, op });
  };
  const confirmEnd = (): void => {
    const row = endTarget;
    setEndTarget(null);
    if (row) action.mutate({ row, op: "end" });
  };
  const rows = list.data ?? [];
  const priceRows = prices.data ?? [];
  return (
    <View style={styles.page}>
      <View style={styles.top}>
        {/* #4420 — neutral one-line switcher (orange is not a control fill). */}
        <Segmented<"discounts" | "prices">
          options={[
            { key: "discounts", label: "Discounts" },
            { key: "prices", label: "Prices" },
          ]}
          value={tab}
          onChange={setTab}
          accessibilityLabel="Discounts or prices"
          style={styles.tabs}
        />
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
              {/* #4420 — phone: a full-width action under the copy (mockup). */}
              <View style={isWideDesktop ? null : styles.heroActionPhone}>
                <Button
                  label="Create discount"
                  fullWidth={!isWideDesktop}
                  onPress={() => {
                    setPreset(null);
                    setEditing(null);
                  }}
                />
              </View>
            </View>
            {/* #4420 round-3 item 23 — the filter chips wrap inside the page
                instead of running off the edge. */}
            <View style={styles.filters} accessibilityRole="radiogroup">
              {FILTERS.map(([value, label]) => (
                <Chip
                  key={value}
                  label={label}
                  selected={filter === value}
                  onPress={() => setFilter(value)}
                  testID={`discount-filter-${value}`}
                />
              ))}
            </View>
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
            offerings={offerings.data ?? []}
            offeringsStatus={
              offerings.data !== undefined
                ? "ready"
                : offerings.isError && !offerings.isFetching
                  ? "error"
                  : "loading"
            }
            onRetryOfferings={() => void offerings.refetch()}
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
      {endTarget ? (
        <Suspense fallback={null}>
          <LazyConfirmDialog
            visible
            onClose={() => setEndTarget(null)}
            onConfirm={confirmEnd}
            title="End this discount?"
            description="Buyers will stop receiving it. Existing orders keep their discount."
            cancelLabel="Keep live"
            confirmLabel="End discount"
            destructive
            initialFocus="cancel"
            testID="discount-end-confirm"
            confirmTestID="discount-end-confirm-yes"
            cancelTestID="discount-end-confirm-cancel"
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
  const overLimit = discountOverLimitLabel(row.overLimitUnits ?? 0);
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
          <Text style={styles.valueAmount}>{value}</Text> ·{" "}
          {DISCOUNT_SCOPE_LABELS[row.scopeKind] ?? row.scopeKind}
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
                  backgroundColor: ratio >= 0.8 ? color.warning : color.accent,
                },
              ]}
            />
          </View>
          <Text style={styles.usage}>
            {discountUsageLabel(
              consumed,
              used,
              row.kind === "code" && row.endsAfterCount != null,
            )}
          </Text>
          {overLimit !== null ? (
            <Text style={styles.overLimit}>{overLimit}</Text>
          ) : null}
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
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[2],
  },
  tabs: { flex: 1, minWidth: 0, maxWidth: 360 },
  scroll: { padding: space[4], gap: space[3], paddingBottom: space[10] + space[4] },
  saved: {
    alignSelf: "center",
    paddingHorizontal: space[4],
    paddingVertical: space[1] + 2,
    borderRadius: radius.full,
    backgroundColor: color.successTint,
  },
  savedText: { ...type.small, color: color.text1, fontWeight: "600" },
  hero: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space[4],
    padding: space[4],
    borderRadius: radius.lg,
    backgroundColor: color.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  heroCopy: { flex: 1, minWidth: 220, gap: space[1] },
  heroActionPhone: { width: "100%" },
  heroTitle: { ...type.h2, color: color.text1 },
  heroSub: { ...type.small, color: color.text2 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  warning: {
    padding: space[4],
    borderRadius: radius.md,
    backgroundColor: color.warningTint,
    gap: space[1],
  },
  warningTitle: { ...type.row, color: color.text1, fontWeight: "600" },
  state: {
    padding: space[7],
    ...type.body,
    color: color.text2,
    textAlign: "center",
  },
  stateBox: { padding: space[7], alignItems: "center", gap: space[2] },
  empty: { padding: space[7], alignItems: "center", gap: space[2] },
  emptyTitle: { ...type.h2, color: color.text1 },
  card: {
    padding: space[4],
    borderRadius: radius.lg,
    backgroundColor: color.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    gap: space[2],
  },
  rowHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space[2],
  },
  type: {
    paddingHorizontal: space[2],
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: color.fill.tile,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineStrong,
  },
  typeText: { ...type.label, fontSize: 10, color: color.text2 },
  status: { ...type.label, fontSize: 10, color: color.text3 },
  name: { ...type.row, fontWeight: "600", color: color.text1 },
  // #4624 design §3: scope label 14/600, the value text 14/400.
  value: {
    fontSize: 14,
    fontWeight: "600",
    color: color.text1,
    marginTop: space[1],
  },
  valueAmount: { fontWeight: "400" },
  progress: {
    height: 6,
    borderRadius: radius.full,
    overflow: "hidden",
    backgroundColor: color.fill.tile,
  },
  progressFill: { height: 6 },
  usage: { ...type.caption, color: color.text2, marginTop: space[1] },
  // #4624: payments honoured after their hold ran out (design v2, warnText 12/17).
  overLimit: { fontSize: 12, lineHeight: 17, color: color.warningText, marginTop: 2 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
});
