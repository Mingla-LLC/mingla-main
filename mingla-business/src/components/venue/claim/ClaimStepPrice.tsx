import React, { useMemo } from "react";
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
  useBrandDiscoveryCurrency,
  useSetBrandProvisionalCurrency,
} from "../../../hooks/useBrandDiscoveryCurrency";
import { useDraftVenueStore } from "../../../store/draftVenueStore";
import { parseMajorToMinor } from "../../../utils/currencyFormatter";
import { venueStepError } from "../venueWizardValidation";

export interface ClaimStepPriceProps {
  showErrors: boolean;
}

const currencyLabel = (code: string): string => {
  if (code === "NGN") return "Nigerian naira";
  if (code === "GBP") return "British pounds";
  if (code === "USD") return "US dollars";
  if (code === "EUR") return "euros";
  return code;
};

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
    return (
      <View style={styles.host}>
        <Text style={styles.labelCap}>PRICE RANGE NEEDS REVIEW</Text>
        <Text style={styles.warning}>
          Your payout account uses {state.reconciliation.to_currency_code}.
          Review existing {state.reconciliation.from_currency_code ?? "source"}
          {" "}ranges before accepting paid reservations.
        </Text>
        <Text style={styles.helper}>
          Use Payments to review and convert or re-enter every affected range.
        </Text>
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
});

export default ClaimStepPrice;
