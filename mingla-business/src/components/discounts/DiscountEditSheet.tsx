import React, { Suspense, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  color,
  radius,
  space,
  edge,
} from "../../constants/designSystem";
import { discountWriteHostCopy } from "@mingla/offering-rendering/discountWriteRefusalCopy";
import { captureDiscountEvent } from "../../analytics/discountAnalytics";
import type {
  BrandDiscount,
  BrandPriceRow,
  DiscountDraft,
  DiscountKind,
  DiscountOfferingRow,
  DiscountValueType,
} from "../../services/discountService";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { HostDateTimeField } from "../ui/HostCalendarFields";
import {
  DiscountScopePicker,
  type DiscountOfferingsStatus,
} from "./DiscountScopePicker";

/**
 * #4304: Alert.alert with buttons is a no-op on react-native-web, so closing a
 * changed discount did nothing on host.usemingla.com. ConfirmDialog works on
 * web and native and loads only when it opens.
 */
const LazyConfirmDialog = React.lazy(() =>
  import("../ui/ConfirmDialog").then((module) => ({
    default: module.ConfirmDialog,
  })),
);
import { isoFromLocalDateTime, localDateTimeValue } from "./discountDateTime";
import {
  applyDiscountKindChange,
  canCreateDiscountKind,
  DISCOUNT_COMBINATION_LABELS,
  DISCOUNT_KIND_DESCRIPTIONS,
  DISCOUNT_KIND_OPTIONS,
  discountSaveBlockedReason,
  formatDiscountPreviewMoney,
  isDiscountDraftValid,
} from "./discountEditorContract";

const loadDiscountService = () => import("../../services/discountService");
const DISCOUNT_QUERY_ROOT = "brand-discounts";

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
  /** #4624: the "Specific offerings" picker's rows and their query state. */
  offerings: DiscountOfferingRow[];
  offeringsStatus: DiscountOfferingsStatus;
  onRetryOfferings: () => void;
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
  offerings,
  offeringsStatus,
  onRetryOfferings,
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
  const [confirmDiscard, setConfirmDiscard] = useState(false);
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
  // #4624 D4: the reason Save is disabled, shown above it on every scope.
  const blockedReason = discountSaveBlockedReason(draft, rank);
  const offeringsPending =
    draft.scopeKind === "listings" && offeringsStatus !== "ready";
  const saveBlockedText =
    blockedReason ??
    (offeringsPending && offeringsStatus === "error"
      ? "Your offerings didn’t load. Retry to save."
      : null);

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
      // #4304: one shared wording per writer refusal (Ari reads it too).
      setError(discountWriteHostCopy(detail));
    },
  });

  const changeKind = (kind: DiscountKind): void => {
    if (!canCreateDiscountKind(rank, kind)) return;
    setDraft((current) => applyDiscountKindChange(current, kind));
    setDirty(true);
    setError(null);
  };
  const requestClose = (): void => {
    if (!dirty) {
      onClose();
      return;
    }
    setConfirmDiscard(true);
  };
  const percentText = useMemo(
    () => (draft.valueBps == null ? "" : String(draft.valueBps / 100)),
    [draft.valueBps],
  );
  const moneyText =
    draft.valueMinor == null ? "" : String(draft.valueMinor / 100);
  const previewMoney = (minor: number): string =>
    formatDiscountPreviewMoney(minor, currencyCode);

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
            discountKind={draft.kind}
            offerings={offerings}
            offeringsStatus={offeringsStatus}
            onRetryOfferings={onRetryOfferings}
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
            {draft.scopeKind === "listings" &&
            !draft.targets.some((target) => target.targetKind === "event") ? (
              <Text style={styles.help}>
                Tick an offering to see what buyers will pay.
              </Text>
            ) : previewQuery.isLoading ? (
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
                      {row.listingName ? (
                        <Text style={styles.previewMeta}>
                          {row.listingName}
                        </Text>
                      ) : null}
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
          {saveBlockedText ? (
            <View style={styles.blockRow} testID="discount-save-blocked">
              <View style={styles.blockDot}>
                <Text style={styles.blockDotText}>!</Text>
              </View>
              <Text style={styles.blockText}>{saveBlockedText}</Text>
            </View>
          ) : null}
          <Button
            label={discount ? "Save changes" : "Create discount"}
            onPress={() => saveMutation.mutate()}
            accessibilityHint={saveBlockedText ?? undefined}
            disabled={!valid || offeringsPending || saveMutation.isPending}
            loading={saveMutation.isPending}
            fullWidth
            size="lg"
          />
        </View>
      </View>
      {confirmDiscard ? (
        <Suspense fallback={null}>
          <LazyConfirmDialog
            visible
            onClose={() => setConfirmDiscard(false)}
            onConfirm={() => {
              setConfirmDiscard(false);
              onClose();
            }}
            title="Discard changes?"
            description="Your unsaved discount will be lost."
            cancelLabel="Keep editing"
            confirmLabel="Discard"
            destructive
            initialFocus="cancel"
            testID="discount-discard-confirm"
            confirmTestID="discount-discard-confirm-yes"
            cancelTestID="discount-discard-confirm-cancel"
          />
        </Suspense>
      ) : null}
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
      placeholderTextColor={color.text3}
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
  // The saved value is still an ISO instant, converted through the same two
  // helpers as before (SC-9: the saved payload does not change).
  const local = localDateTimeValue(value);
  const minLocal = min === undefined ? "" : localDateTimeValue(min);
  return (
    <View style={styles.field}>
      <HostDateTimeField
        label={`${label}${optional ? " (optional)" : ""}`}
        accessibilityLabel={`${label} date and time`}
        placeholder={optional ? "Not set" : undefined}
        value={{ date: local.slice(0, 10), time: local.slice(11, 16) }}
        min={minLocal === "" ? undefined : minLocal.slice(0, 10)}
        minTime={minLocal === "" ? undefined : minLocal.slice(11, 16)}
        onChangeValue={(next) => onChange(isoFromLocalDateTime(`${next.date}T${next.time}`))}
        onClear={optional ? () => onChange(null) : undefined}
        testID={testID}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  shell: { flex: 1 },
  header: {
    paddingHorizontal: space[4],
    paddingTop: space[2],
    paddingBottom: space[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  title: { fontSize: 24, fontWeight: "800", color: color.text1 },
  sub: {
    fontSize: 13,
    lineHeight: 19,
    color: color.text2,
    marginTop: 4,
  },
  body: { padding: space[4], gap: space[2], paddingBottom: 120 },
  footer: {
    padding: space[4],
    gap: space[2] + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
  },
  // #4624 D4: why Save is disabled, beside the control it disables.
  blockRow: { flexDirection: "row", alignItems: "flex-start", gap: space[2] },
  blockDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.warningTint,
  },
  blockDotText: { color: color.warningText, fontSize: 12, fontWeight: "800" },
  blockText: { flex: 1, color: color.text2, fontSize: 13, lineHeight: 18 },
  label: { fontSize: 13, fontWeight: "700", color: color.text1 },
  help: { fontSize: 12, lineHeight: 18, color: color.text2 },
  field: { gap: 6 },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: edge.ringInputFocus.borderColor,
    borderRadius: radius.md,
    paddingHorizontal: space[2],
    color: color.text1,
    backgroundColor: color.fill.inset,
  },
  kindCards: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  kindCard: {
    flex: 1,
    minWidth: 180,
    minHeight: 82,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[2],
    padding: space[2],
    borderWidth: 1,
    borderColor: edge.ringInputFocus.borderColor,
    borderRadius: radius.md,
    backgroundColor: color.fill.inset,
  },
  // #4420 — selection is the selected material, not orange.
  kindCardSelected: {
    borderColor: color.lineStrong,
    backgroundColor: color.card3,
  },
  kindRadio: {
    width: 19,
    height: 19,
    marginTop: 1,
    borderWidth: 2,
    borderColor: color.text3,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  kindRadioOn: { borderColor: color.paper },
  kindRadioCenter: {
    width: 9,
    height: 9,
    borderRadius: radius.full,
    backgroundColor: color.paper,
  },
  kindCopy: { flex: 1, gap: 3 },
  kindTitle: { color: color.text1, fontSize: 14, fontWeight: "700" },
  kindDescription: {
    color: color.text2,
    fontSize: 12,
    lineHeight: 17,
  },
  segment: {
    flexDirection: "row",
    padding: 3,
    backgroundColor: color.fill.inset,
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
  segmentSelected: { backgroundColor: color.fill.tabOn },
  segmentText: {
    fontSize: 12,
    fontWeight: "700",
    color: color.text2,
    textAlign: "center",
  },
  segmentTextSelected: { color: color.textStrong },
  disabled: { opacity: 0.4 },
  radioRow: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  radioMark: { fontSize: 18, color: color.text1 },
  radioText: { fontSize: 14, color: color.text1 },
  dateRow: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  dateColumn: { flex: 1, minWidth: 220 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: space[4] },
  switchCopy: { flex: 1, gap: 3 },
  two: { flexDirection: "row", gap: space[2] },
  flex: { flex: 1 },
  preview: {
    padding: space[4],
    borderRadius: radius.md,
    backgroundColor: color.fill.inset,
    gap: 6,
  },
  previewTitle: { fontWeight: "800", color: color.text1 },
  previewRow: {
    gap: 3,
    paddingTop: space[2],
    marginTop: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
  },
  previewItem: { color: color.text1, fontSize: 14, fontWeight: "700" },
  previewPrice: { color: color.text1, fontSize: 17, fontWeight: "800" },
  previewMeta: { color: color.text2, fontSize: 12, lineHeight: 17 },
  error: {
    padding: space[2],
    borderRadius: radius.sm,
    backgroundColor: color.errorTint,
    gap: 6,
  },
  errorText: { fontSize: 13, lineHeight: 18, color: color.text1 },
  link: { fontSize: 13, fontWeight: "700", color: color.text1 },
});
