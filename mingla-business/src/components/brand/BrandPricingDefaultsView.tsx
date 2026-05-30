/**
 * ORCH-1006 [Universal all-in pricing engine] — Surface 2.
 *
 * Brand-level pricing-defaults screen. Set-once policy that every new event,
 * trip and experience inherits (per-offering switches override via NULL=inherit
 * COALESCE on the server view). This IS the source of truth, so there is no
 * inherit indicator — the shared section renders with a read-only region chip
 * footer and an illustrative £100 preview.
 *
 * Writes via business_set_brand_pricing_defaults (wrapped in
 * pricingSwitchesService). Defaults are always concrete booleans (never NULL).
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import {
  canvas,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { DEFAULT_TAKE_RATE_BPS } from "../../constants/pricing";
import { formatCurrencyRound } from "../../utils/currency";
import { useBrand, brandKeys } from "../../hooks/useBrands";
import {
  setBrandPricingDefaults,
  type BrandPricingDefaults,
  type PricingSwitchOverrides,
} from "../../services/pricingSwitchesService";
import { WhoCoversCostsSection } from "../pricing/WhoCoversCostsSection";

const EXAMPLE_ORDER_CENTS = 10000; // £100 illustrative order

export interface BrandPricingDefaultsViewProps {
  brandId: string;
}

export const BrandPricingDefaultsView: React.FC<
  BrandPricingDefaultsViewProps
> = ({ brandId }) => {
  const brandQuery = useBrand(brandId);
  const brand = brandQuery.data ?? null;
  const rqClient = useQueryClient();

  const [defaults, setDefaults] = useState<BrandPricingDefaults | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Seed local state once the brand loads (server is the source until first edit).
  useEffect(() => {
    if (brand === null || defaults !== null) return;
    setDefaults({
      passTax: brand.defaultPassTax ?? false,
      passMinglaFee: brand.defaultPassMinglaFee ?? false,
      passServiceFee: brand.defaultPassServiceFee ?? false,
    });
  }, [brand, defaults]);

  const handleChange = useCallback(
    (next: PricingSwitchOverrides): void => {
      const resolved: BrandPricingDefaults = {
        passTax: next.passTax ?? false,
        passMinglaFee: next.passMinglaFee ?? false,
        passServiceFee: next.passServiceFee ?? false,
      };
      setDefaults(resolved);
      setSaveError(null);
      void setBrandPricingDefaults(brandId, resolved)
        .then(() => {
          void rqClient.invalidateQueries({
            queryKey: brandKeys.detail(brandId),
          });
        })
        .catch((err: unknown) => {
          setSaveError(
            err instanceof Error
              ? err.message
              : "Couldn't save — check your connection and try again.",
          );
        });
    },
    [brandId, rqClient],
  );

  if (brand === null || defaults === null) {
    return (
      <View style={[styles.host, styles.center]}>
        <ActivityIndicator color={textTokens.secondary} />
      </View>
    );
  }

  // ORCH-1006 — defaults always display in the brand's Stripe currency once
  // Stripe is set (brands.default_currency is populated only after connect);
  // fall back to GBP (the pricing region) when no currency is set yet.
  const displayCurrency = brand.defaultCurrency ?? "GBP";
  const exampleOrder = formatCurrencyRound(
    EXAMPLE_ORDER_CENTS,
    displayCurrency,
    true,
  );

  return (
    <ScrollView
      style={styles.host}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.screenTitle}>Pricing defaults</Text>
      <Text style={styles.screenSubtitle}>
        Set once. Every new event, trip and experience starts from these — you
        can override per offering.
      </Text>

      <WhoCoversCostsSection
        format="event"
        // Concrete defaults (never NULL) → no inherit ring; this IS the source.
        overrides={defaults}
        defaults={defaults}
        onChange={handleChange}
        previewBaseCents={EXAMPLE_ORDER_CENTS}
        currency={displayCurrency}
        effectiveTakeRateBps={brand.takeRateBpsOverride ?? DEFAULT_TAKE_RATE_BPS}
        footerOverride={
          <View style={styles.regionChip}>
            <Text style={styles.regionText}>
              {`Example on a ${exampleOrder} order · VAT inclusive`}
            </Text>
          </View>
        }
      />

      {saveError !== null ? (
        <Text style={styles.error}>{saveError}</Text>
      ) : null}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.profile,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  screenTitle: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
  },
  screenSubtitle: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    marginTop: spacing.xs,
  },
  regionChip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radiusTokens.full,
    backgroundColor: glass.tint.backdrop,
    alignSelf: "flex-start",
  },
  regionText: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
  },
  error: {
    fontSize: typography.caption.fontSize,
    color: semantic.error,
    marginTop: spacing.md,
  },
});

export default BrandPricingDefaultsView;
