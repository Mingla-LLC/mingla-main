import {
  QueryClient,
  QueryClientContext,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import React, { useContext, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  color,
  materials,
  radius,
  space,
  type,
} from "../../constants/designSystem";
import { captureDiscountEvent } from "../../analytics/discountAnalytics";
import type {
  BrandDiscount,
  BrandPriceRow,
  DiscountTarget,
} from "../../services/discountService";
import {
  majorFromMinor,
  minorFromMajor,
  normalizeCurrency,
} from "../../utils/currency";
import { Button } from "../ui/Button";

const loadDiscountService = () => import("../../services/discountService");
const DISCOUNT_QUERY_ROOT = "brand-discounts";
const discountListKey = (brandId: string, state: "live" | "scheduled") =>
  [DISCOUNT_QUERY_ROOT, "list", brandId, state] as const;
const discountPricesKey = (brandId: string) =>
  [DISCOUNT_QUERY_ROOT, "prices", brandId] as const;

const DAYS = [
  [1, "M"],
  [2, "T"],
  [3, "W"],
  [4, "T"],
  [5, "F"],
  [6, "S"],
  [0, "S"],
] as const;

// A few old isolated sheet tests mount their subject without the app's
// QueryClientProvider. Keep the newly lazy-loaded discount section absent in
// that artificial shell while the real app continues to use its shared client.
const isolatedFallbackClient = new QueryClient({
  defaultOptions: { queries: { enabled: false, retry: false } },
});

export interface ItemDiscountControlsProps {
  brandId: string;
  itemId: string;
  itemKind: BrandPriceRow["kind"];
  listingKind: NonNullable<DiscountTarget["listingKind"]>;
  itemLabel: string;
  currency?: string | null;
  listUnitCents?: number | null;
  allowLabel: string;
  saleLabel: string;
  weeklySchedule?: boolean;
  countLimit?: boolean;
  testID?: string;
}

const isThisSale = (
  row: BrandDiscount,
  itemKind: BrandPriceRow["kind"],
  itemId: string,
): boolean =>
  row.kind === "sale_price" &&
  row.targets.some(
    (target) => target.targetKind === itemKind && target.targetId === itemId,
  );

export const ItemDiscountControls: React.FC<ItemDiscountControlsProps> = ({
  brandId,
  itemId,
  itemKind,
  listingKind,
  itemLabel,
  currency,
  listUnitCents,
  allowLabel,
  saleLabel,
  weeklySchedule = false,
  countLimit = false,
  testID = "item-discount-controls",
}) => {
  const providedClient = useContext(QueryClientContext);
  const client = providedClient ?? isolatedFallbackClient;
  const hasQueryClient = providedClient !== undefined;
  const code = normalizeCurrency(currency);
  const prices = useQuery(
    {
      queryKey: discountPricesKey(brandId),
      queryFn: async () =>
        (await loadDiscountService()).fetchBrandPrices(brandId),
      enabled: hasQueryClient,
    },
    client,
  );
  const live = useQuery(
    {
      queryKey: discountListKey(brandId, "live"),
      queryFn: async () =>
        (await loadDiscountService()).fetchBrandDiscounts(brandId, "live"),
      enabled: hasQueryClient,
    },
    client,
  );
  const scheduled = useQuery(
    {
      queryKey: discountListKey(brandId, "scheduled"),
      queryFn: async () =>
        (await loadDiscountService()).fetchBrandDiscounts(brandId, "scheduled"),
      enabled: hasQueryClient,
    },
    client,
  );
  const priceRow = prices.data?.find(
    (row) => row.kind === itemKind && row.id === itemId,
  );
  const existingSale = useMemo(
    () =>
      [...(live.data ?? []), ...(scheduled.data ?? [])].find((row) =>
        isThisSale(row, itemKind, itemId),
      ) ?? null,
    [itemId, itemKind, live.data, scheduled.data],
  );
  const effectiveListCents = priceRow?.listUnitCents ?? listUnitCents ?? 0;
  const [allowed, setAllowed] = useState(true);
  const [saleOn, setSaleOn] = useState(false);
  const [salePrice, setSalePrice] = useState("");
  const [limitMode, setLimitMode] = useState<"date" | "count">("date");
  const [endsAt, setEndsAt] = useState("");
  const [endsAfterCount, setEndsAfterCount] = useState("");
  const [scheduleOn, setScheduleOn] = useState(false);
  const [scheduleDays, setScheduleDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [scheduleFrom, setScheduleFrom] = useState("11:00");
  const [scheduleTo, setScheduleTo] = useState("14:00");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (priceRow !== undefined) setAllowed(priceRow.discountsAllowed);
    const currentSale =
      priceRow?.currentSaleCents ?? existingSale?.valueMinor ?? null;
    setSaleOn(existingSale !== null || currentSale !== null);
    if (currentSale !== null)
      setSalePrice(String(majorFromMinor(currentSale, code)));
    if (existingSale?.endsAt) setEndsAt(existingSale.endsAt.slice(0, 16));
    if (existingSale?.endsAfterCount != null) {
      setLimitMode("count");
      setEndsAfterCount(String(existingSale.endsAfterCount));
    }
    if (existingSale?.schedule) {
      setScheduleOn(true);
      setScheduleDays(existingSale.schedule.days);
      setScheduleFrom(existingSale.schedule.from);
      setScheduleTo(existingSale.schedule.to);
    }
  }, [code, existingSale, priceRow]);

  const refresh = async (): Promise<void> => {
    await client.invalidateQueries({ queryKey: [DISCOUNT_QUERY_ROOT] });
  };
  const allowMutation = useMutation(
    {
      mutationFn: async (next: boolean) =>
        (await loadDiscountService()).setDiscountsAllowed(
          itemKind,
          [itemId],
          next,
        ),
      onMutate: (next) => setAllowed(next),
      onError: () => setAllowed((current) => !current),
      onSuccess: async (_result, allowedValue) => {
        captureDiscountEvent("discount_allow_toggled", {
          item_kind: itemKind,
          allowed: allowedValue,
        });
        await refresh();
      },
    },
    client,
  );
  const saleMinor = minorFromMajor(Number(salePrice), code);
  const saleValid =
    !saleOn ||
    (Number.isFinite(Number(salePrice)) &&
      saleMinor > 0 &&
      saleMinor < effectiveListCents &&
      (limitMode !== "count" || !countLimit || Number(endsAfterCount) > 0) &&
      (!scheduleOn || (scheduleDays.length > 0 && scheduleFrom < scheduleTo)));
  const saleMutation = useMutation(
    {
      mutationFn: async () => {
        const { writeBrandDiscount } = await loadDiscountService();
        if (!saleOn) {
          if (existingSale === null) return null;
          return writeBrandDiscount("end", {
            id: existingSale.id,
            brandId,
            version: existingSale.version,
          });
        }
        return writeBrandDiscount(existingSale === null ? "create" : "update", {
          id: existingSale?.id,
          brandId,
          kind: "sale_price",
          name: `${itemLabel} sale`,
          valueType: "set_price",
          valueMinor: saleMinor,
          currency: code,
          scopeKind: "items",
          combinesWith: "any",
          startsAt: existingSale?.startsAt ?? new Date().toISOString(),
          endsAt:
            limitMode === "date" && endsAt.length > 0
              ? new Date(endsAt).toISOString()
              : null,
          endsAfterCount:
            countLimit && limitMode === "count" ? Number(endsAfterCount) : null,
          schedule:
            weeklySchedule && scheduleOn
              ? { days: scheduleDays, from: scheduleFrom, to: scheduleTo }
              : null,
          status: "active",
          source: "host",
          version: existingSale?.version,
          targets: [{ targetKind: itemKind, targetId: itemId, listingKind }],
        });
      },
      onSuccess: async () => {
        await refresh();
        captureDiscountEvent(
          existingSale === null ? "discount_created" : "discount_updated",
          existingSale === null
            ? {
                kind: "sale_price",
                value_type: "set_price",
                scope_kind: "items",
                has_limit: Boolean(endsAt) || Boolean(endsAfterCount),
              }
            : { action: saleOn ? "edit" : "end" },
        );
        setSaved(true);
      },
    },
    client,
  );

  if (!hasQueryClient) return null;

  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.toggleRow}>
        <View style={styles.copy}>
          <Text style={styles.label}>{allowLabel}</Text>
          <Text style={styles.help}>
            Hosts decide whether this price can receive a discount.
          </Text>
        </View>
        <Switch
          value={allowed}
          disabled={allowMutation.isPending}
          onValueChange={(next) => allowMutation.mutate(next)}
          testID={`${testID}-allow`}
        />
      </View>
      <View style={styles.toggleRow}>
        <View style={styles.copy}>
          <Text style={styles.label}>{saleLabel}</Text>
          <Text style={styles.help}>
            Set a lower public price without changing the list price.
          </Text>
        </View>
        <Switch
          value={saleOn}
          onValueChange={setSaleOn}
          testID={`${testID}-sale`}
        />
      </View>
      {saleOn ? (
        <View style={styles.fields}>
          <Text style={styles.fieldLabel}>Sale price ({code})</Text>
          <TextInput
            value={salePrice}
            onChangeText={setSalePrice}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={color.text3}
            style={styles.input}
            accessibilityLabel={`Sale price in ${code}`}
            testID={`${testID}-price`}
          />
          {effectiveListCents > 0 ? (
            <Text style={styles.help}>
              Must be below {majorFromMinor(effectiveListCents, code)} {code}.
            </Text>
          ) : null}
          {countLimit ? (
            <View style={styles.segments}>
              {(
                [
                  ["date", "Ends on date"],
                  ["count", "After N sold"],
                ] as const
              ).map(([value, label]) => (
                <Pressable
                  key={value}
                  onPress={() => setLimitMode(value)}
                  accessibilityRole="radio"
                  accessibilityLabel={label}
                  accessibilityState={{ checked: limitMode === value }}
                  style={[
                    styles.segment,
                    limitMode === value && styles.segmentOn,
                  ]}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      limitMode === value && styles.segmentTextOn,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {limitMode === "date" || !countLimit ? (
            <TextInput
              value={endsAt}
              onChangeText={setEndsAt}
              placeholder="End date (YYYY-MM-DDTHH:mm), optional"
              placeholderTextColor={color.text3}
              style={styles.input}
              testID={`${testID}-ends-at`}
            />
          ) : (
            <TextInput
              value={endsAfterCount}
              onChangeText={setEndsAfterCount}
              keyboardType="number-pad"
              placeholder="Number sold"
              placeholderTextColor={color.text3}
              style={styles.input}
              testID={`${testID}-ends-after-count`}
            />
          )}
          {weeklySchedule ? (
            <>
              <View style={styles.toggleRow}>
                <Text style={styles.label}>Repeat weekly schedule</Text>
                <Switch
                  value={scheduleOn}
                  onValueChange={setScheduleOn}
                  testID={`${testID}-schedule`}
                />
              </View>
              {scheduleOn ? (
                <View style={styles.schedule}>
                  <View style={styles.days}>
                    {DAYS.map(([day, label], index) => {
                      const selected = scheduleDays.includes(day);
                      return (
                        <Pressable
                          key={`${day}-${index}`}
                          onPress={() =>
                            setScheduleDays((current) =>
                              selected
                                ? current.filter((value) => value !== day)
                                : [...current, day],
                            )
                          }
                          accessibilityRole="checkbox"
                          accessibilityLabel={`${label} weekly schedule`}
                          accessibilityState={{ checked: selected }}
                          style={[styles.day, selected && styles.dayOn]}
                        >
                          <Text
                            style={selected ? styles.dayTextOn : styles.dayText}
                          >
                            {label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <View style={styles.times}>
                    <TextInput
                      value={scheduleFrom}
                      onChangeText={setScheduleFrom}
                      placeholder="From 11:00"
                      style={styles.timeInput}
                    />
                    <Text style={styles.help}>to</Text>
                    <TextInput
                      value={scheduleTo}
                      onChangeText={setScheduleTo}
                      placeholder="To 14:00"
                      style={styles.timeInput}
                    />
                  </View>
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}
      {saleMutation.isError ? (
        <Text style={styles.error}>
          Couldn’t save this sale. Check the price and try again.
        </Text>
      ) : null}
      {saved ? <Text style={styles.saved}>Sale settings saved.</Text> : null}
      <Button
        label="Save sale settings"
        variant="secondary"
        size="sm"
        disabled={!saleValid || saleMutation.isPending}
        loading={saleMutation.isPending}
        onPress={() => saleMutation.mutate()}
        testID={`${testID}-save`}
      />
    </View>
  );
};

// #4420 — Graphite tokens. The chosen limit and the chosen days use the
// neutral selected material (orange is not a selection fill), and their labels
// read `color.textStrong` instead of the old "#fff" literals.
const selectedSurface = {
  backgroundColor: materials.selected.solidFill,
  borderColor: materials.selected.rim.edge,
  borderTopColor: materials.selected.rim.top ?? materials.selected.rim.edge,
} as const;

const styles = StyleSheet.create({
  wrap: {
    gap: space[2],
    padding: space[4],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  copy: { flex: 1 },
  label: { ...type.row, color: color.text1 },
  help: { ...type.caption, fontWeight: "400", color: color.text2 },
  fields: { gap: space[2] },
  fieldLabel: { ...type.caption, fontWeight: "600", color: color.text2 },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    borderRadius: radius.sm,
    paddingHorizontal: space[3],
    color: color.text1,
    backgroundColor: color.fill.input,
  },
  segments: { flexDirection: "row", gap: space[1] },
  segment: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: space[2],
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    backgroundColor: color.fill.tile,
  },
  segmentOn: selectedSurface,
  segmentText: { ...type.caption, fontWeight: "600", color: color.text2 },
  segmentTextOn: { color: color.textStrong },
  schedule: { gap: space[2] },
  days: { flexDirection: "row", gap: space[1] },
  day: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    backgroundColor: color.fill.tile,
  },
  dayOn: selectedSurface,
  dayText: { ...type.caption, fontWeight: "700", color: color.text2 },
  dayTextOn: { ...type.caption, fontWeight: "700", color: color.textStrong },
  times: { flexDirection: "row", alignItems: "center", gap: space[2] },
  timeInput: {
    flex: 1,
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    borderRadius: radius.sm,
    paddingHorizontal: space[3],
    color: color.text1,
    backgroundColor: color.fill.input,
  },
  error: { ...type.caption, fontWeight: "400", color: color.errorText },
  saved: { ...type.caption, fontWeight: "600", color: color.successText },
});
