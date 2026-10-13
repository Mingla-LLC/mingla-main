/**
 * PayoutCountryInlinePrompt — #3645: a brand has no currency until its
 * organiser chooses a payout country. When they enter a price before doing so,
 * the creator shows this card in place, with the very same country field brand
 * creation uses, instead of sending them away to bank setup.
 *
 * Renders nothing unless a price has been entered AND the brand has no
 * currency. Free items never see it.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { Brand } from "../../types/brand";
import { currencyCodeOrNull } from "../../utils/currency";

export const PAYOUT_COUNTRY_PROMPT_COPY = {
  title: "Choose your payout country",
  body: "Prices need a currency. Pick the country your bank account is in and we'll use its currency for this brand. Free listings don't need one.",
  loading: "Loading payout countries…",
} as const;

/** True when the brand has no currency yet, so a price cannot be shown or sold. */
export function brandNeedsPayoutCountry(
  brand: Pick<Brand, "defaultCurrency"> | null | undefined,
): boolean {
  return (
    brand !== null &&
    brand !== undefined &&
    currencyCodeOrNull(brand.defaultCurrency) === null
  );
}

// The field (and, behind it, the country sheet) loads only when a prompt is
// actually shown.
const LazyBrandPayoutCountryField = React.lazy(async () => {
  const module = await import("./BrandPayoutCountryField");
  return { default: module.BrandPayoutCountryField };
});

export interface PayoutCountryInlinePromptProps {
  brand: Brand | null | undefined;
  /** True once the organiser has entered a price above zero. */
  priced: boolean;
  testID?: string;
}

export function PayoutCountryInlinePrompt({
  brand,
  priced,
  testID = "payout-country-inline-prompt",
}: PayoutCountryInlinePromptProps): React.ReactElement | null {
  if (!priced || brand === null || brand === undefined) return null;
  if (!brandNeedsPayoutCountry(brand)) return null;
  return (
    <View style={styles.card} testID={testID} accessibilityRole="summary">
      <Text style={styles.title}>{PAYOUT_COUNTRY_PROMPT_COPY.title}</Text>
      <Text style={styles.body}>{PAYOUT_COUNTRY_PROMPT_COPY.body}</Text>
      <React.Suspense
        fallback={(
          <Text style={styles.body} accessibilityRole="text">
            {PAYOUT_COUNTRY_PROMPT_COPY.loading}
          </Text>
        )}
      >
        <LazyBrandPayoutCountryField
          brand={brand}
          testID={`${testID}-field`}
        />
      </React.Suspense>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: accent.border,
    backgroundColor: glass.tint.profileBase,
  },
  title: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  body: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
});

export default PayoutCountryInlinePrompt;
