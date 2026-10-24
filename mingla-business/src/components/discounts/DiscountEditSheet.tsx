import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
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
  DiscountDraft,
  DiscountKind,
  DiscountValueType,
} from "../../services/discountService";
import { currencyCodeOrNull, formatCurrency } from "../../utils/currency";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { WebDateTimeInput } from "../ui/WebDateTimeInput";
import { DiscountScopePicker } from "./DiscountScopePicker";
import { isoFromLocalDateTime, localDateTimeValue } from "./discountDateTime";
import {
  canCreateDiscountKind,
  DISCOUNT_COMBINATION_LABELS,
  DISCOUNT_KIND_OPTIONS,
  isDiscountDraftValid,
} from "./discountEditorContract";

const loadDiscountService = () => import("../../services/discountService");
const DISCOUNT_QUERY_ROOT = "brand-discounts";

const DISCOUNT_KIND_DESCRIPTIONS: Record<DiscountKind, string> = {
  code: "Buyers enter a code at checkout.",
  automatic: "The best eligible deal is applied automatically.",
  sale_price: "Show a lower price on selected items.",
};

const isoNow = (): string => new Date().toISOString();
const numeric = (value: string): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
};

export interface DiscountEditSheetProps {
  visible: boolean;
  brandId: string;
  rank: number;
  currencyCode: string | null;
  prices: BrandPriceRow[];
  discount?: BrandDiscount | null;
  presetTarget?: BrandPriceRow | null;
  onClose: () => void;
  onSaved: (discount: BrandDiscount) => void;
}

const defaultDraft = (
  brandId: string,
  presetTarget?: BrandPriceRow | null,
): DiscountDraft => ({
  brandId,
  kind: presetTarget ? "sale_price" : "code",
  code: presetTarget ? null : "",
  name: presetTarget ? `${presetTarget.itemName} sale` : "",
  valueType: presetTarget ? "set_price" : "percent",
  valueBps: presetTarget ? null : 1000,
  valueMinor: presetTarget?.currentSaleCents ?? null,
  scopeKind: presetTarget ? "items" : "brand",
  combinesWith: presetTarget ? "any" : "automatic_only",
  startsAt: isoNow(),
  endsAt: null,
  schedule: null,
  endsAfterCount: null,
  maxTotalUses: null,
  maxUsesPerBuyer: null,
  minSubtotalMinor: null,
  targets: presetTarget
    ? [
        {
          targetKind: presetTarget.kind,
          targetId: presetTarget.id,
          listingKind: null,
        },
      ]
    : [],
});

const fromDiscount = (row: BrandDiscount): DiscountDraft => ({
  id: row.id,
  brandId: row.brandId,
  kind: row.kind,
  code: row.code,
  name: row.name,
  valueType: row.valueType,
  valueBps: row.valueBps,
  valueMinor: row.valueMinor,
  scopeKind: row.scopeKind,
  combinesWith: row.combinesWith,
  startsAt: row.startsAt,
  endsAt: row.endsAt,
  schedule: row.schedule,
  endsAfterCount: row.endsAfterCount,
  maxTotalUses: row.maxTotalUses,
  maxUsesPerBuyer: row.maxUsesPerBuyer,
  minSubtotalMinor: row.minSubtotalMinor,
  version: row.version,
  targets: row.targets,
});

export const DiscountEditSheet: React.FC<DiscountEditSheetProps> = ({
  visible,
  brandId,
  rank,
  currencyCode,
  prices,
  discount,
  presetTarget,
  onClose,
  onSaved,
}) => {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<DiscountDraft>(() =>
    discount ? fromDiscount(discount) : defaultDraft(brandId, presetTarget),
  );
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setDraft(
      discount ? fromDiscount(discount) : defaultDraft(brandId, presetTarget),
    );
    setDirty(false);
    setError(null);
    setShowSchedule(discount?.schedule != null);
  }, [visible, discount, brandId, presetTarget]);

  const set = <K extends keyof DiscountDraft>(
    key: K,
    value: DiscountDraft[K],
  ): void => {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setError(null);
  };
  const valid = isDiscountDraftValid(draft, rank);

  const previewQuery = useQuery({
    queryKey: [DISCOUNT_QUERY_ROOT, "preview", brandId, JSON.stringify(draft)],
    queryFn: async () =>
      (await loadDiscountService()).previewBrandDiscount(brandId, draft),
    enabled: visible && valid,
    staleTime: 10_000,
  });
  const saveMutation = useMutation({
    mutationFn: async () =>
      (await loadDiscountService()).writeBrandDiscount(
        discount ? "update" : "create",
        draft,
      ),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: [DISCOUNT_QUERY_ROOT] });
      captureDiscountEvent(
        discount ? "discount_updated" : "discount_created",
        discount
          ? { action: "edit" }
          : {
              kind: draft.kind,
              value_type: draft.valueType,
              scope_kind: draft.scopeKind,
              has_limit:
                draft.endsAfterCount !== null ||
                draft.maxTotalUses !== null ||
                draft.maxUsesPerBuyer !== null,
            },
      );
      setDirty(false);
      onSaved(saved);
    },
    onError: (cause) => {
      const detail =
        typeof cause === "object" &&
        cause !== null &&
        "detail" in cause &&
        typeof cause.detail === "string"
          ? cause.detail
          : "internal";
      setError(
        detail === "version_conflict"
          ? "This discount changed elsewhere. Load latest, then redo your change."
          : detail === "code_taken"
            ? "That code is already in use."
            : detail === "sale_price_overlap"
              ? "This item already has a sale in that time window."
              : detail === "set_price_not_lower"
                ? "A sale price must be lower than the list price."
                : detail === "too_many_automatics"
                  ? "This brand already has the maximum number of live automatic discounts."
                  : "Couldn't save this discount. Check the fields and try again.",
      );
    },
  });

  const changeKind = (kind: DiscountKind): void => {
    if (!canCreateDiscountKind(rank, kind)) return;
    setDraft((current) => ({
      ...current,
      kind,
      code: kind === "code" ? (current.code ?? "") : null,
      valueType: kind === "sale_price" ? "set_price" : current.valueType,
      combinesWith: kind === "code" ? "automatic_only" : "any",
      scopeKind: kind === "sale_price" ? "items" : current.scopeKind,
    }));
    setDirty(true);
    setError(null);
  };
  const requestClose = (): void => {
    if (!dirty) {
      onClose();
      return;
    }
    Alert.alert("Discard changes?", "Your unsaved discount will be lost.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: onClose },
    ]);
  };
  const percentText = useMemo(
    () => (draft.valueBps == null ? "" : String(draft.valueBps / 100)),
    [draft.valueBps],
  );
  const moneyText =
    draft.valueMinor == null ? "" : String(draft.valueMinor / 100);
  const previewCurrency = currencyCodeOrNull(currencyCode);
  const previewMoney = (minor: number): string =>
    previewCurrency === null
      ? "—"
      : formatCurrency(minor, previewCurrency, true);

  return (
    <Sheet visible={visible} onClose={requestClose} snapPoint="full">
      <View style={styles.shell}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>
              {discount ? "Edit discount" : "New discount"}
            </Text>
            <Text style={styles.sub}>
              Hosts choose the deal. Mingla verifies every price at checkout.
            </Text>
          </View>
        </View>
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.label}>Type</Text>
          <View style={styles.kindCards} accessibilityRole="radiogroup">
            {DISCOUNT_KIND_OPTIONS.map(({ kind, label }) => {
              const disabled = !canCreateDiscountKind(rank, kind);
              const isSelected = draft.kind === kind;
              return (
                <Pressable
                  key={kind}
                  disabled={disabled}
                  onPress={() => changeKind(kind)}
                  accessibilityRole="radio"
                  accessibilityLabel={`${label} discount`}
                  accessibilityState={{
                    checked: isSelected,
                    disabled,
                  }}
                  style={[
                    styles.kindCard,
                    isSelected && styles.kindCardSelected,
                    disabled && styles.disabled,
                  ]}
                >
                  <View
                    style={[styles.kindRadio, isSelected && styles.kindRadioOn]}
                  >
                    {isSelected ? (
                      <View style={styles.kindRadioCenter} />
                    ) : null}
                  </View>
                  <View style={styles.kindCopy}>
                    <Text style={styles.kindTitle}>{label}</Text>
                    <Text style={styles.kindDescription}>
                      {DISCOUNT_KIND_DESCRIPTIONS[kind]}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          {rank < 30 ? (
            <Text style={styles.help}>
              You can create codes. Ask an owner, admin or finance manager to
              set up automatic discounts and sale prices.
            </Text>
          ) : null}
          {draft.kind === "code" ? (
            <Field
              label="Code"
              value={draft.code ?? ""}
              autoCapitalize="characters"
              onChange={(value) =>
                set("code", value.replace(/[\s-]/g, "").toUpperCase())
              }
            />
          ) : null}
          <Field
            label="Name (shown on receipts)"
            value={draft.name}
            onChange={(value) => set("name", value.slice(0, 60))}
          />

          {draft.kind !== "sale_price" ? (
            <>
              <Text style={styles.label}>Value</Text>
              <View style={styles.segment}>
                {(["percent", "amount"] as DiscountValueType[]).map((type) => (
                  <Pressable
                    key={type}
                    onPress={() => {
                      set("valueType", type);
                      set("valueBps", type === "percent" ? 1000 : null);
                      set("valueMinor", type === "amount" ? 1000 : null);
                    }}
                    accessibilityRole="radio"
                    accessibilityLabel={
                      type === "percent" ? "Percent off" : "Amount off"
                    }
                    style={[
                      styles.segmentButton,
                      draft.valueType === type && styles.segmentSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        draft.valueType === type && styles.segmentTextSelected,
                      ]}
                    >
                      {type === "percent" ? "% off" : "Amount off"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
          <Field
            label={
              draft.valueType === "percent" ? "Percent off" : "Price / amount"
            }
            value={draft.valueType === "percent" ? percentText : moneyText}
            keyboardType="decimal-pad"
            onChange={(value) =>
              draft.valueType === "percent"
                ? set(
                    "valueBps",
                    numeric(value) == null
                      ? null
                      : Math.round(Number(value) * 100),
                  )
                : set(
                    "valueMinor",
                    numeric(value) == null
                      ? null
                      : Math.round(Number(value) * 100),
                  )
            }
          />

          <DiscountScopePicker
            scopeKind={draft.scopeKind}
            targets={draft.targets}
            prices={prices}
            currencyCode={currencyCode}
            onScopeKindChange={(value) => {
              setDraft((current) => ({
                ...current,
                scopeKind: value,
                targets: [],
              }));
              setDirty(true);
              setError(null);
            }}
            onTargetsChange={(value) => set("targets", value)}
          />

          <Text style={styles.label}>Can combine with</Text>
          {(["none", "automatic_only", "any"] as const).map((choice) => (
            <Pressable
              key={choice}
              onPress={() => set("combinesWith", choice)}
              style={styles.radioRow}
              accessibilityRole="radio"
              accessibilityLabel={DISCOUNT_COMBINATION_LABELS[choice]}
              accessibilityState={{ checked: draft.combinesWith === choice }}
            >
              <Text style={styles.radioMark}>
                {draft.combinesWith === choice ? "●" : "○"}
              </Text>
              <Text style={styles.radioText}>
                {DISCOUNT_COMBINATION_LABELS[choice]}
              </Text>
            </Pressable>
          ))}

          <View style={styles.dateRow}>
            <View style={styles.dateColumn}>
              <DiscountDateTimeField
                label="Starts at"
                value={draft.startsAt}
                onChange={(value) => {
                  if (value !== null) set("startsAt", value);
                }}
                testID="discount-starts-at"
              />
            </View>
            <View style={styles.dateColumn}>
              <DiscountDateTimeField
                label="Ends at"
                optional
                value={draft.endsAt ?? null}
                min={draft.startsAt}
                onChange={(value) => set("endsAt", value)}
                testID="discount-ends-at"
              />
            </View>
          </View>
          {draft.kind !== "code" ? (
            <View style={styles.switchRow}>
              <View style={styles.switchCopy}>
                <Text style={styles.label}>Weekly schedule</Text>
                <Text style={styles.help}>
                  Limit this deal to selected days and local times.
                </Text>
              </View>
              <Switch
                value={showSchedule}
                onValueChange={(value) => {
                  setShowSchedule(value);
                  set(
                    "schedule",
                    value
                      ? { days: [1, 2, 3, 4, 5], from: "09:00", to: "17:00" }
                      : null,
                  );
                }}
              />
            </View>
          ) : null}
          {showSchedule && draft.schedule ? (
            <>
              <Field
                label="Days (0–6, comma-separated)"
                value={draft.schedule.days.join(",")}
                onChange={(value) =>
                  set("schedule", {
                    ...draft.schedule!,
                    days: value
                      .split(",")
                      .map(Number)
                      .filter((n) => n >= 0 && n <= 6),
                  })
                }
              />
              <View style={styles.two}>
                <View style={styles.flex}>
                  <Field
                    label="From"
                    value={draft.schedule.from}
                    onChange={(value) =>
                      set("schedule", { ...draft.schedule!, from: value })
                    }
                  />
                </View>
                <View style={styles.flex}>
                  <Field
                    label="To"
                    value={draft.schedule.to}
                    onChange={(value) =>
                      set("schedule", { ...draft.schedule!, to: value })
                    }
                  />
                </View>
              </View>
            </>
          ) : null}
          <View style={styles.two}>
            <View style={styles.flex}>
              <Field
                label="Total uses"
                value={draft.maxTotalUses?.toString() ?? ""}
                keyboardType="number-pad"
                onChange={(value) => set("maxTotalUses", numeric(value))}
              />
            </View>
            <View style={styles.flex}>
              <Field
                label="Per buyer"
                value={draft.maxUsesPerBuyer?.toString() ?? ""}
                keyboardType="number-pad"
                onChange={(value) => set("maxUsesPerBuyer", numeric(value))}
              />
            </View>
          </View>
          {draft.kind !== "code" ? (
            <Field
              label="End after N sold"
              value={draft.endsAfterCount?.toString() ?? ""}
              keyboardType="number-pad"
              onChange={(value) => set("endsAfterCount", numeric(value))}
            />
          ) : null}
          <Field
            label="Minimum spend"
            value={
              draft.minSubtotalMinor == null
                ? ""
                : String(draft.minSubtotalMinor / 100)
            }
            keyboardType="decimal-pad"
            onChange={(value) =>
              set(
                "minSubtotalMinor",
                numeric(value) == null ? null : Math.round(Number(value) * 100),
              )
            }
          />

          <View style={styles.preview}>
            <Text style={styles.previewTitle}>Buyer preview</Text>
            <Text style={styles.help}>
              What buyers would pay today, including fees.
            </Text>
            {previewQuery.isLoading ? (
              <Text style={styles.help}>Checking eligible prices…</Text>
            ) : previewQuery.isError ? (
              <>
                <Text style={styles.errorText}>
                  Couldn’t load the preview. You can still save; Mingla checks
                  the price at checkout.
                </Text>
                <Pressable onPress={() => void previewQuery.refetch()}>
                  <Text style={styles.link}>Try again</Text>
                </Pressable>
              </>
            ) : previewQuery.data?.length === 0 ? (
              <Text style={styles.help}>
                No ticket here can be discounted. Change what it applies to.
              </Text>
            ) : (
              <>
                {previewQuery.data?.slice(0, 3).map((row, index) => {
                  const savings = Math.max(
                    0,
                    row.allInListCents - row.allInNetCents,
                  );
                  return (
                    <View
                      key={`${row.itemName}:${index}`}
                      style={styles.previewRow}
                    >
                      <Text style={styles.previewItem}>{row.itemName}</Text>
                      <Text style={styles.previewPrice}>
                        Buyer pays {previewMoney(row.allInNetCents)}
                      </Text>
                      <Text style={styles.previewMeta}>
                        Was {previewMoney(row.allInListCents)} · Saves{" "}
                        {previewMoney(savings)}
                      </Text>
                      <Text style={styles.previewMeta}>
                        Before fees {previewMoney(row.netUnitMinor)}
                      </Text>
                    </View>
                  );
                })}
                {(previewQuery.data?.length ?? 0) > 3 ? (
                  <Text style={styles.help}>
                    And {(previewQuery.data?.length ?? 0) - 3} more eligible
                    items
                  </Text>
                ) : null}
              </>
            )}
          </View>
          {error ? (
            <View style={styles.error}>
              <Text style={styles.errorText}>{error}</Text>
              {error.includes("changed elsewhere") ? (
                <Pressable onPress={onClose}>
                  <Text style={styles.link}>Load latest</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
        <View style={styles.footer}>
          <Button
            label={discount ? "Save changes" : "Create discount"}
            onPress={() => saveMutation.mutate()}
            disabled={!valid || saveMutation.isPending}
            loading={saveMutation.isPending}
            fullWidth
            size="lg"
          />
        </View>
      </View>
    </Sheet>
  );
};

const Field: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  keyboardType?: "default" | "number-pad" | "decimal-pad";
  autoCapitalize?: "none" | "characters";
}> = ({
  label,
  value,
  onChange,
  keyboardType = "default",
  autoCapitalize = "none",
}) => (
  <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput
      value={value}
      onChangeText={onChange}
      keyboardType={keyboardType}
      autoCapitalize={autoCapitalize}
      style={styles.input}
      placeholderTextColor={textTokens.tertiary}
    />
  </View>
);

const DiscountDateTimeField: React.FC<{
  label: string;
  value: string | null;
  min?: string;
  optional?: boolean;
  testID: string;
  onChange: (value: string | null) => void;
}> = ({ label, value, min, optional = false, testID, onChange }) => {
  const [picker, setPicker] = useState<"date" | "time" | null>(null);
  const parsed = value === null ? null : new Date(value);
  const current =
    parsed !== null && Number.isFinite(parsed.getTime()) ? parsed : null;

  const updateNative =
    (part: "date" | "time") =>
    (event: DateTimePickerEvent, selected?: Date): void => {
      if (Platform.OS === "android") setPicker(null);
      if (event.type === "dismissed" || selected === undefined) return;
      const next = current === null ? new Date() : new Date(current);
      if (part === "date") {
        next.setFullYear(
          selected.getFullYear(),
          selected.getMonth(),
          selected.getDate(),
        );
      } else {
        next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
      }
      onChange(next.toISOString());
    };

  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {optional ? " (optional)" : ""}
      </Text>
      {Platform.OS === "web" ? (
        <WebDateTimeInput
          type="datetime-local"
          value={localDateTimeValue(value)}
          min={min === undefined ? undefined : localDateTimeValue(min)}
          ariaLabel={`${label} date and time`}
          testID={testID}
          onChangeValue={(next) => onChange(isoFromLocalDateTime(next))}
        />
      ) : (
        <View style={styles.nativeDateWrap}>
          <View style={styles.nativeDateButtons}>
            <Pressable
              onPress={() => setPicker("date")}
              accessibilityRole="button"
              accessibilityLabel={`Choose ${label.toLowerCase()} date`}
              style={styles.nativeDateButton}
            >
              <Text style={styles.nativeDateText}>
                {current?.toLocaleDateString() ?? "Choose date"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setPicker("time")}
              accessibilityRole="button"
              accessibilityLabel={`Choose ${label.toLowerCase()} time`}
              style={styles.nativeDateButton}
            >
              <Text style={styles.nativeDateText}>
                {current?.toLocaleTimeString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                }) ?? "Choose time"}
              </Text>
            </Pressable>
            {optional && value !== null ? (
              <Pressable
                onPress={() => onChange(null)}
                accessibilityRole="button"
                accessibilityLabel={`Clear ${label.toLowerCase()}`}
                style={styles.clearDateButton}
              >
                <Text style={styles.clearDateText}>Clear</Text>
              </Pressable>
            ) : null}
          </View>
          {picker !== null ? (
            <>
              <DateTimePicker
                value={current ?? new Date()}
                mode={picker}
                display={Platform.OS === "ios" ? "spinner" : "default"}
                minimumDate={
                  picker === "date" && min !== undefined
                    ? new Date(min)
                    : undefined
                }
                onChange={updateNative(picker)}
                themeVariant="dark"
              />
              {Platform.OS === "ios" ? (
                <Button
                  label="Done"
                  size="sm"
                  variant="ghost"
                  onPress={() => setPicker(null)}
                />
              ) : null}
            </>
          ) : null}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  shell: { flex: 1 },
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.profileBase,
  },
  title: { fontSize: 24, fontWeight: "800", color: textTokens.primary },
  sub: {
    fontSize: 13,
    lineHeight: 19,
    color: textTokens.secondary,
    marginTop: 4,
  },
  body: { padding: spacing.md, gap: spacing.sm, paddingBottom: 120 },
  footer: {
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileBase,
  },
  label: { fontSize: 13, fontWeight: "700", color: textTokens.primary },
  help: { fontSize: 12, lineHeight: 18, color: textTokens.secondary },
  field: { gap: 6 },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: glass.border.control,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    color: textTokens.primary,
    backgroundColor: glass.tint.profileBase,
  },
  kindCards: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  kindCard: {
    flex: 1,
    minWidth: 180,
    minHeight: 82,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: glass.border.control,
    borderRadius: radius.md,
    backgroundColor: glass.tint.profileBase,
  },
  kindCardSelected: {
    borderColor: accent.warm,
    backgroundColor: "rgba(249,115,22,0.10)",
  },
  kindRadio: {
    width: 19,
    height: 19,
    marginTop: 1,
    borderWidth: 2,
    borderColor: textTokens.tertiary,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  kindRadioOn: { borderColor: accent.warm },
  kindRadioCenter: {
    width: 9,
    height: 9,
    borderRadius: radius.full,
    backgroundColor: accent.warm,
  },
  kindCopy: { flex: 1, gap: 3 },
  kindTitle: { color: textTokens.primary, fontSize: 14, fontWeight: "700" },
  kindDescription: {
    color: textTokens.secondary,
    fontSize: 12,
    lineHeight: 17,
  },
  segment: {
    flexDirection: "row",
    padding: 3,
    backgroundColor: glass.tint.profileBase,
    borderRadius: radius.md,
  },
  segmentButton: {
    flex: 1,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    paddingHorizontal: 4,
  },
  segmentSelected: { backgroundColor: accent.warm },
  segmentText: {
    fontSize: 12,
    fontWeight: "700",
    color: textTokens.secondary,
    textAlign: "center",
  },
  segmentTextSelected: { color: "#fff" },
  disabled: { opacity: 0.4 },
  radioRow: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  radioMark: { fontSize: 18, color: accent.warm },
  radioText: { fontSize: 14, color: textTokens.primary },
  dateRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  dateColumn: { flex: 1, minWidth: 220 },
  nativeDateWrap: { gap: spacing.xs },
  nativeDateButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  nativeDateButton: {
    flexGrow: 1,
    minHeight: 46,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: glass.border.control,
    borderRadius: radius.md,
    backgroundColor: glass.tint.profileBase,
  },
  nativeDateText: {
    color: textTokens.primary,
    fontSize: 13,
    fontWeight: "600",
  },
  clearDateButton: {
    minHeight: 46,
    justifyContent: "center",
    paddingHorizontal: spacing.xs,
  },
  clearDateText: { color: accent.warm, fontSize: 13, fontWeight: "700" },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  switchCopy: { flex: 1, gap: 3 },
  two: { flexDirection: "row", gap: spacing.sm },
  flex: { flex: 1 },
  preview: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: glass.tint.profileBase,
    gap: 6,
  },
  previewTitle: { fontWeight: "800", color: textTokens.primary },
  previewRow: {
    gap: 3,
    paddingTop: spacing.sm,
    marginTop: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileBase,
  },
  previewItem: { color: textTokens.primary, fontSize: 14, fontWeight: "700" },
  previewPrice: { color: accent.warm, fontSize: 17, fontWeight: "800" },
  previewMeta: { color: textTokens.secondary, fontSize: 12, lineHeight: 17 },
  error: {
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: semantic.errorTint,
    gap: 6,
  },
  errorText: { fontSize: 13, lineHeight: 18, color: textTokens.primary },
  link: { fontSize: 13, fontWeight: "700", color: accent.warm },
});
