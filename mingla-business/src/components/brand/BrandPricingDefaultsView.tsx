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
import { useRouter } from "expo-router";

import {
  color,
  radius as radiusTokens,
  scrim,
  space,
  type,
  suiteFormMaxWidth,
} from "../../constants/designSystem";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { DEFAULT_TAKE_RATE_BPS } from "../../constants/pricing";
import { formatCurrencyRound, currencyCodeOrNull } from "../../utils/currency";
import { useBrand, brandKeys } from "../../hooks/useBrands";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import { useBrandTaxRegistration } from "../../hooks/useBrandTaxRegistration";
import { canPerformAction, gateCaptionFor } from "../../utils/permissionGates";
import {
  setBrandPricingDefaults,
  type BrandPricingDefaults,
  type PricingSwitchOverrides,
} from "../../services/pricingSwitchesService";
import { WhoCoversCostsSection } from "../pricing/LazyWhoCoversCostsSection";
import { usesConfiguredVat } from "../../utils/pricingTaxContext";

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
  const router = useRouter();
  const { isWideDesktop } = useResponsiveLayout();
  const role = useCurrentBrandRole(brandId);
  const taxRegistration = useBrandTaxRegistration(brandId);
  const canEdit = !role.isLoading && !role.isError && canPerformAction(role.rank, "EDIT_TICKET_PRICE");

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
      if (!canEdit) return;
      const previous = defaults;
      const resolved: BrandPricingDefaults = {
        passTax: next.passTax ?? false,
        passMinglaFee: next.passMinglaFee ?? false,
        passServiceFee: next.passServiceFee ?? false,
      };
      setDefaults(resolved);
      setSaveError(null);
      void setBrandPricingDefaults(brandId, resolved, {
        paymentProvider: brand?.paymentProvider,
        paymentCountry: brand?.paymentCountry,
      })
        .then((saved) => {
          setDefaults(saved);
          void rqClient.invalidateQueries({
            queryKey: brandKeys.detail(brandId),
          });
        })
        .catch((err: unknown) => {
          setDefaults(previous);
          const message = err instanceof Error ? err.message : "";
          setSaveError(
            message.includes("tax_registration_required")
              ? "Set up an active tax registration in Payments before passing tax to buyers."
              : message.length > 0
              ? message
              : "Couldn't save — check your connection and try again.",
          );
        });
    },
    [
      brand?.paymentCountry,
      brand?.paymentProvider,
      brandId,
      canEdit,
      defaults,
      rqClient,
    ],
  );

  if (brand === null || defaults === null) {
    return (
      <View style={[styles.host, styles.center]}>
        <ActivityIndicator color={color.text2} />
      </View>
    );
  }

  // ORCH-1006 / #962 G7 — defaults display in the brand's Stripe currency once
  // Stripe is set (brands.default_currency is populated only after connect).
  // Before that (pre-bank) the brand has NO currency: render the example amount
  // as a PLAIN NUMBER with no symbol (OQ-3 decision); never manufacture GBP.
  const displayCurrency = currencyCodeOrNull(brand.defaultCurrency);
  const exampleOrder =
    displayCurrency !== null
      ? formatCurrencyRound(EXAMPLE_ORDER_CENTS, displayCurrency, true)
      : String(Math.round(EXAMPLE_ORDER_CENTS / 100));
  const configuredVat = usesConfiguredVat(brand);

  return (
    <ScrollView
      style={styles.host}
      contentContainerStyle={[styles.content, isWideDesktop && styles.contentDesktop]}
      keyboardShouldPersistTaps="handled"
    >
      {/* #4420 — the title lives in the route's top bar (no repeat). */}
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
        paymentProvider={brand.paymentProvider}
        paymentCountry={brand.paymentCountry}
        vatRegistered={taxRegistration.data?.hasActiveRegistration === true}
        onSetupVat={() => router.push(`/brand/${brandId}/payments` as never)}
        disabled={!canEdit || (!configuredVat && taxRegistration.isLoading)}
        disabledReason={
          role.isLoading || (!configuredVat && taxRegistration.isLoading)
            ? "Checking your access and tax registration…"
            : role.isError
              ? "We couldn't verify your role. Refresh and try again."
              : gateCaptionFor("EDIT_TICKET_PRICE")
        }
        footerOverride={
          <View style={styles.regionChip}>
            <Text style={styles.regionText}>
              {configuredVat
                ? `Example on a ${exampleOrder} order · 7.5% VAT is added only when selected`
                : `Example on a ${exampleOrder} order · VAT inclusive`}
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
    backgroundColor: color.canvas,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    padding: space[4],
    paddingBottom: space[7],
    gap: space[4],
  },
  // #4420 — desktop (T4 form column): a readable 720 column, not full width.
  contentDesktop: {
    width: "100%",
    maxWidth: suiteFormMaxWidth + space[6] * 2,
    paddingHorizontal: space[6],
  },
  screenTitle: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: "700",
    color: color.text1,
  },
  screenSubtitle: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: color.text2,
    paddingHorizontal: space[1],
  },
  regionChip: {
    paddingVertical: space[1],
    paddingHorizontal: space[2],
    borderRadius: radiusTokens.full,
    backgroundColor: scrim.modal,
    alignSelf: "flex-start",
  },
  regionText: {
    fontSize: type.caption.fontSize,
    color: color.text2,
  },
  error: {
    fontSize: type.caption.fontSize,
    color: color.errorText,
    marginTop: space[4],
  },
});

export default BrandPricingDefaultsView;
