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
  accent,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { captureDiscountEvent } from "../../analytics/discountAnalytics";
import { discountKeys } from "../../services/discountKeys";
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
      queryKey: discountKeys.prices(brandId),
      queryFn: async () =>
        (await loadDiscountService()).fetchBrandPrices(brandId),
      enabled: hasQueryClient,
    },
    client,
  );
  const live = useQuery(
    {
      queryKey: discountKeys.list(brandId, "live"),
      queryFn: async () =>
        (await loadDiscountService()).fetchBrandDiscounts(brandId, "live"),
      enabled: hasQueryClient,
    },
    client,
  );
  const scheduled = useQuery(
    {
      queryKey: discountKeys.list(brandId, "scheduled"),
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
    await client.invalidateQueries({ queryKey: discountKeys.all });
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
            placeholderTextColor={textTokens.quaternary}
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
              placeholderTextColor={textTokens.quaternary}
              style={styles.input}
              testID={`${testID}-ends-at`}
            />
          ) : (
            <TextInput
              value={endsAfterCount}
              onChangeText={setEndsAfterCount}
              keyboardType="number-pad"
              placeholder="Number sold"
              placeholderTextColor={textTokens.quaternary}
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
          Couldn't save this sale. Check the price and try again.
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

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  copy: { flex: 1 },
  label: { color: textTokens.primary, fontWeight: "700", fontSize: 14 },
  help: { color: textTokens.secondary, fontSize: 12, lineHeight: 17 },
  fields: { gap: spacing.sm },
  fieldLabel: { color: textTokens.secondary, fontSize: 12, fontWeight: "600" },
  input: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    color: textTokens.primary,
    backgroundColor: glass.tint.profileElevated,
  },
  segments: { flexDirection: "row", gap: spacing.xs },
  segment: {
    flex: 1,
    alignItems: "center",
    padding: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  segmentOn: { backgroundColor: accent.warm, borderColor: accent.warm },
  segmentText: { color: textTokens.secondary, fontSize: 12, fontWeight: "600" },
  segmentTextOn: { color: "#fff" },
  schedule: { gap: spacing.sm },
  days: { flexDirection: "row", gap: spacing.xs },
  day: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  dayOn: { backgroundColor: accent.warm, borderColor: accent.warm },
  dayText: { color: textTokens.secondary, fontWeight: "700" },
  dayTextOn: { color: "#fff", fontWeight: "700" },
  times: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  timeInput: {
    flex: 1,
    minHeight: 40,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    color: textTokens.primary,
  },
  error: { color: semantic.error, fontSize: 12 },
  saved: { color: semantic.success, fontSize: 12, fontWeight: "600" },
});
