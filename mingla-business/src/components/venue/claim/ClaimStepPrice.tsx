import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import {
  usePreviewBrandCurrencyReconciliation,
  useBrandDiscoveryCurrency,
  useResolveBrandCurrencyReconciliation,
  useSetBrandProvisionalCurrency,
} from "../../../hooks/useBrandDiscoveryCurrency";
import { useBrandReconciliationPriceRanges } from "../../../hooks/usePlaceDiscoveryPriceRange";
import {
  BrandCurrencyActionError,
  type BrandCurrencyReconciliationPreview,
} from "../../../services/businessPlaceAuthoringService";
import { useDraftVenueStore } from "../../../store/draftVenueStore";
import {
  formatSourceRange,
  parseMajorToMinor,
} from "../../../utils/currencyFormatter";
import { venueStepError } from "../venueWizardValidation";

export interface ClaimStepPriceProps {
  showErrors: boolean;
}

type ReentryInputs = Record<string, { min: string; max: string }>;

const currencyLabel = (code: string): string => {
  if (code === "NGN") return "Nigerian naira";
  if (code === "GBP") return "British pounds";
  if (code === "USD") return "US dollars";
  if (code === "EUR") return "euros";
  return code;
};

function reconciliationErrorCopy(error: Error | null): string | null {
  if (error === null) return null;
  const code = error instanceof BrandCurrencyActionError ? error.code : "";
  if (code === "range_version_conflict" || code === "range_set_changed") {
    return "Prices changed while you were reviewing them. Reload this review before continuing.";
  }
  if (code === "fx_snapshot_stale" || code === "fx_unavailable") {
    return "The conversion rate expired or is unavailable. Review a fresh conversion before continuing.";
  }
  if (code === "incomplete_reentry" || code === "invalid_range") {
    return "Enter a valid range for every affected place before continuing.";
  }
  return "We couldn’t finish the currency review. Your prices were not changed. Try again.";
}

export const ClaimStepPrice: React.FC<ClaimStepPriceProps> = ({
  showErrors,
}) => {
  const brandId = useDraftVenueStore((state) => state.activeBrandId);
  const minInput = useDraftVenueStore(
    (state) => state.discoveryPriceMinInput ?? "",
  );
  const maxInput = useDraftVenueStore(
    (state) => state.discoveryPriceMaxInput ?? "",
  );
  const patch = useDraftVenueStore((state) => state.patch);
  const draft = useDraftVenueStore();
  const stateQuery = useBrandDiscoveryCurrency(brandId);
  const setProvisional = useSetBrandProvisionalCurrency(brandId);
  const reconciliationId = stateQuery.data?.reconciliation?.id ?? null;
  const previewMutation = usePreviewBrandCurrencyReconciliation(
    brandId,
    reconciliationId,
  );
  const resolveMutation = useResolveBrandCurrencyReconciliation(
    brandId,
    reconciliationId,
  );
  const reconciliationRanges = useBrandReconciliationPriceRanges(
    reconciliationId === null ? null : brandId,
  );
  const [preview, setPreview] =
    useState<BrandCurrencyReconciliationPreview | null>(null);
  const [reviewMode, setReviewMode] =
    useState<"choices" | "conversion" | "reentry">("choices");
  const [reentryInputs, setReentryInputs] = useState<ReentryInputs>({});
  const [actionError, setActionError] = useState<Error | null>(null);
  const state = stateQuery.data;
  const currency = state?.currencyCode ?? null;
  const metadata = state?.supportedCurrencies.find(
    (candidate) => candidate.code === currency,
  );
  const exponent = metadata?.minorUnitExponent ?? 2;
  const minMinor = parseMajorToMinor(minInput, exponent);
  const maxMinor = maxInput.trim().length === 0
    ? null
    : parseMajorToMinor(maxInput, exponent);
  const inputError = useMemo(() => {
    if (minInput.trim().length > 0 && minMinor === null) {
      return `Use no more than ${exponent} decimal places.`;
    }
    if (maxInput.trim().length > 0 && maxMinor === null) {
      return `Use no more than ${exponent} decimal places.`;
    }
    if (minMinor !== null && maxMinor !== null && maxMinor < minMinor) {
      return "Up to must be the same as or more than Typical spend from.";
    }
    return null;
  }, [exponent, maxInput, maxMinor, minInput, minMinor]);
  const stepError = showErrors ? venueStepError("c7", draft) : null;

  if (stateQuery.isLoading) {
    return (
      <View style={styles.host}>
        <ActivityIndicator color={textTokens.primary} />
        <Text style={styles.helper}>Loading your brand currency…</Text>
      </View>
    );
  }
  if (stateQuery.isError || !state) {
    return (
      <View style={styles.host}>
        <Text style={styles.err}>
          We couldn’t load your brand currency. Try again.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void stateQuery.refetch()}
          style={styles.retry}
        >
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (state.authority === "unset") {
    return (
      <View style={styles.host}>
        <Text style={styles.labelCap}>CHOOSE YOUR BRAND CURRENCY</Text>
        <Text style={styles.helper}>
          This applies to every listing. You’ll confirm it when you connect a
          payout account.
        </Text>
        <View style={styles.currencyGrid}>
          {state.supportedCurrencies.map((candidate) => (
            <Pressable
              key={candidate.code}
              accessibilityRole="button"
              accessibilityLabel={`Use ${candidate.code} for this brand`}
              disabled={setProvisional.isPending}
              onPress={() =>
                setProvisional.mutate({
                  currencyCode: candidate.code,
                  expectedStateVersion: state.stateVersion,
                })}
              style={styles.currencyChip}
            >
              <Text style={styles.currencyChipText}>{candidate.code}</Text>
            </Pressable>
          ))}
        </View>
        {setProvisional.isError ? (
          <Text style={styles.err}>
            We couldn’t save that currency. Refresh and try again.
          </Text>
        ) : null}
      </View>
    );
  }

  if (state.reconciliation !== null) {
    const targetMetadata = state.supportedCurrencies.find(
      (candidate) =>
        candidate.code === state.reconciliation?.to_currency_code,
    );
    const targetExponent = targetMetadata?.minorUnitExponent ?? 2;
    const currentRanges = reconciliationRanges.data ?? [];
    const parsedReentryRanges = currentRanges.map((range) => {
      const values = reentryInputs[range.place_pool_id] ?? { min: "", max: "" };
      const parsedMin = parseMajorToMinor(values.min, targetExponent);
      const parsedMax = values.max.trim().length === 0
        ? null
        : parseMajorToMinor(values.max, targetExponent);
      return {
        placePoolId: range.place_pool_id,
        expectedVersion: range.version,
        currencyCode: state.reconciliation?.to_currency_code ?? "",
        sourceMinMinor: parsedMin,
        sourceMaxMinor: parsedMax,
        valid:
          parsedMin !== null &&
          (values.max.trim().length === 0 || parsedMax !== null) &&
          (parsedMax === null || parsedMax >= parsedMin),
      };
    });
    const canSubmitReentry =
      !reconciliationRanges.isLoading &&
      !reconciliationRanges.isError &&
      parsedReentryRanges.length > 0 &&
      parsedReentryRanges.every((range) => range.valid);
    const busy = previewMutation.isPending || resolveMutation.isPending;
    const visibleError =
      reconciliationErrorCopy(actionError) ??
      (reconciliationRanges.isError
        ? "We couldn’t load every affected price. Reload before continuing."
        : null);

    const reviewConversion = async (): Promise<void> => {
      setActionError(null);
      try {
        const nextPreview = await previewMutation.mutateAsync();
        setPreview(nextPreview);
        setReviewMode("conversion");
      } catch (error) {
        setActionError(
          error instanceof Error ? error : new Error("preview_failed"),
        );
      }
    };

    const applyConversion = async (): Promise<void> => {
      if (preview === null) return;
      setActionError(null);
      try {
        await resolveMutation.mutateAsync({
          decision: "convert",
          fxSnapshotId: preview.snapshot.id,
          ranges: [...preview.ranges]
            .sort((left, right) =>
              left.placePoolId.localeCompare(right.placePoolId))
            .map((range) => ({
              placePoolId: range.placePoolId,
              expectedVersion: range.expectedVersion,
            })),
        });
        setPreview(null);
        setReviewMode("choices");
      } catch (error) {
        setActionError(
          error instanceof Error ? error : new Error("conversion_failed"),
        );
      }
    };

    const applyReentry = async (): Promise<void> => {
      if (!canSubmitReentry) return;
      setActionError(null);
      try {
        await resolveMutation.mutateAsync({
          decision: "reenter",
          fxSnapshotId: null,
          ranges: parsedReentryRanges
            .sort((left, right) =>
              left.placePoolId.localeCompare(right.placePoolId))
            .map((range) => ({
              placePoolId: range.placePoolId,
              expectedVersion: range.expectedVersion,
              currencyCode: range.currencyCode,
              sourceMinMinor: range.sourceMinMinor as number,
              sourceMaxMinor: range.sourceMaxMinor,
            })),
        });
        setReviewMode("choices");
        setReentryInputs({});
      } catch (error) {
        setActionError(
          error instanceof Error ? error : new Error("reentry_failed"),
        );
      }
    };

    return (
      <View style={styles.host}>
        <Text style={styles.labelCap}>PRICE RANGE NEEDS REVIEW</Text>
        <Text style={styles.warning}>
          Your payout account uses {state.reconciliation.to_currency_code}.
          Review existing {state.reconciliation.from_currency_code ?? "source"}
          {" "}ranges before accepting paid reservations.
        </Text>
        {reviewMode === "choices" ? (
          <View style={styles.actionGroup}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void reviewConversion()}
              style={styles.primaryAction}
              testID="issue1384-review-convert"
            >
              <Text style={styles.primaryActionText}>
                {previewMutation.isPending ? "Loading conversion…" : "Review and convert"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy || reconciliationRanges.isLoading}
              onPress={() => {
                setActionError(null);
                setReviewMode("reentry");
              }}
              style={styles.secondaryAction}
              testID="issue1384-review-reenter"
            >
              <Text style={styles.secondaryActionText}>Re-enter prices</Text>
            </Pressable>
          </View>
        ) : null}
        {reviewMode === "conversion" && preview !== null ? (
          <View style={styles.reviewPanel} testID="issue1384-conversion-preview">
            <Text style={styles.helper}>
              Conversion rate: {preview.snapshot.provider} · {preview.snapshot.id}
            </Text>
            {preview.ranges.map((range) => {
              const sourceMetadata = state.supportedCurrencies.find(
                (candidate) => candidate.code === range.sourceCurrencyCode,
              );
              return (
                <View key={range.placePoolId} style={styles.rangeCard}>
                  <Text style={styles.fieldLabel}>{range.placePoolId}</Text>
                  <Text style={styles.helper}>
                    Source: {formatSourceRange({
                      minMinor: range.sourceMinMinor,
                      maxMinor: range.sourceMaxMinor,
                      currencyCode: range.sourceCurrencyCode,
                      exponent: sourceMetadata?.minorUnitExponent ?? 2,
                    })}
                  </Text>
                  <Text style={styles.helper}>
                    Proposed: {formatSourceRange({
                      minMinor: range.proposedMinMinor,
                      maxMinor: range.proposedMaxMinor,
                      currencyCode: preview.toCurrencyCode,
                      exponent: targetExponent,
                    })}
                  </Text>
                  <Text style={styles.helper}>
                    Version {range.expectedVersion}
                  </Text>
                </View>
              );
            })}
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void applyConversion()}
              style={styles.primaryAction}
              testID="issue1384-apply-conversion"
            >
              <Text style={styles.primaryActionText}>
                {resolveMutation.isPending ? "Applying…" : "Apply conversion"}
              </Text>
            </Pressable>
          </View>
        ) : null}
        {reviewMode === "reentry" ? (
          <View style={styles.reviewPanel} testID="issue1384-reentry-form">
            <Text style={styles.helper}>
              Enter every affected range in {state.reconciliation.to_currency_code}.
            </Text>
            {currentRanges.map((range) => {
              const values = reentryInputs[range.place_pool_id] ??
                { min: "", max: "" };
              return (
                <View key={range.place_pool_id} style={styles.rangeCard}>
                  <Text style={styles.fieldLabel}>
                    {range.place_pool_id} · Version {range.version}
                  </Text>
                  <TextInput
                    accessibilityLabel={`Minimum for ${range.place_pool_id} in ${state.reconciliation?.to_currency_code}`}
                    keyboardType="decimal-pad"
                    onChangeText={(value) =>
                      setReentryInputs((current) => ({
                        ...current,
                        [range.place_pool_id]: {
                          ...(current[range.place_pool_id] ??
                            { min: "", max: "" }),
                          min: value,
                        },
                      }))}
                    placeholder="Minimum"
                    style={styles.reentryInput}
                    testID={`issue1384-reentry-min-${range.place_pool_id}`}
                    value={values.min}
                  />
                  <TextInput
                    accessibilityLabel={`Maximum for ${range.place_pool_id} in ${state.reconciliation?.to_currency_code}`}
                    keyboardType="decimal-pad"
                    onChangeText={(value) =>
                      setReentryInputs((current) => ({
                        ...current,
                        [range.place_pool_id]: {
                          ...(current[range.place_pool_id] ??
                            { min: "", max: "" }),
                          max: value,
                        },
                      }))}
                    placeholder="Maximum (optional)"
                    style={styles.reentryInput}
                    testID={`issue1384-reentry-max-${range.place_pool_id}`}
                    value={values.max}
                  />
                </View>
              );
            })}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSubmitReentry || busy }}
              disabled={!canSubmitReentry || busy}
              onPress={() => void applyReentry()}
              style={styles.primaryAction}
              testID="issue1384-apply-reentry"
            >
              <Text style={styles.primaryActionText}>
                {resolveMutation.isPending ? "Saving…" : "Save all prices"}
              </Text>
            </Pressable>
          </View>
        ) : null}
        {visibleError !== null ? (
          <Text style={styles.err} testID="issue1384-reconciliation-error">
            {visibleError}
          </Text>
        ) : null}
      </View>
    );
  }

  const authorityCopy = state.authority === "settlement"
    ? `Prices in ${currencyLabel(currency ?? "")} (${currency}) · Set by your payout account.`
    : `Prices in ${currencyLabel(currency ?? "")} (${currency}) · Confirmed when you add a payout account.`;

  return (
    <View style={styles.host}>
      <Text style={styles.labelCap}>TYPICAL SPEND</Text>
      <Text style={styles.helper}>{authorityCopy}</Text>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Typical spend from</Text>
        <View style={styles.inputRow}>
          <Text style={styles.currencyCode}>{currency}</Text>
          <TextInput
            accessibilityLabel={`Typical spend from in ${currency}`}
            value={minInput}
            onChangeText={(value) => patch({ discoveryPriceMinInput: value })}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={textTokens.tertiary}
            style={styles.input}
          />
        </View>
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Up to (optional)</Text>
        <View style={styles.inputRow}>
          <Text style={styles.currencyCode}>{currency}</Text>
          <TextInput
            accessibilityLabel={`Typical spend up to in ${currency}`}
            value={maxInput}
            onChangeText={(value) => patch({ discoveryPriceMaxInput: value })}
            keyboardType="decimal-pad"
            placeholder="No upper limit"
            placeholderTextColor={textTokens.tertiary}
            style={styles.input}
          />
        </View>
      </View>
      {inputError !== null ? <Text style={styles.err}>{inputError}</Text> : null}
      {stepError !== null ? <Text style={styles.err}>{stepError}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  labelCap: {
    fontSize: typography.labelCap.fontSize,
    lineHeight: typography.labelCap.lineHeight,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
    color: textTokens.tertiary,
  },
  helper: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    lineHeight: 20,
  },
  warning: {
    fontSize: typography.bodySm.fontSize,
    color: "#F59E0B",
    lineHeight: 20,
  },
  currencyGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  currencyChip: {
    minHeight: 44,
    minWidth: 64,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
    paddingHorizontal: spacing.md,
  },
  currencyChipText: {
    color: textTokens.primary,
    fontSize: typography.bodySm.fontSize,
    fontWeight: "700",
  },
  field: {
    gap: spacing.xs,
  },
  fieldLabel: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
  },
  inputRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  currencyCode: {
    color: textTokens.secondary,
    paddingLeft: spacing.md,
    fontSize: typography.bodySm.fontSize,
    fontWeight: "700",
  },
  input: {
    flex: 1,
    color: textTokens.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontSize: typography.body.fontSize,
  },
  err: {
    fontSize: typography.caption.fontSize,
    color: "#EF4444",
  },
  retry: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  retryText: {
    color: textTokens.primary,
    fontWeight: "700",
  },
  actionGroup: {
    gap: spacing.sm,
  },
  reviewPanel: {
    gap: spacing.sm,
  },
  rangeCard: {
    gap: spacing.xs,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    padding: spacing.md,
  },
  primaryAction: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
    backgroundColor: textTokens.primary,
    paddingHorizontal: spacing.lg,
  },
  primaryActionText: {
    color: "#000000",
    fontSize: typography.bodySm.fontSize,
    fontWeight: "700",
  },
  secondaryAction: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    paddingHorizontal: spacing.lg,
  },
  secondaryActionText: {
    color: textTokens.primary,
    fontSize: typography.bodySm.fontSize,
    fontWeight: "700",
  },
  reentryInput: {
    minHeight: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    color: textTokens.primary,
    paddingHorizontal: spacing.md,
  },
});

export default ClaimStepPrice;
