/** issue #4522 — lazy public-card disclosure for a saved v2 plan. */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import type { ThemePalette } from "./themePalette";
import type { TripOfferingTier } from "./tripOfferingTypes";
import { withCurrencyGlyph } from "./currencyGlyph";
import { priceDecimals, priceFallbackDecimals } from "./priceDecimals";

const formatTripPrice = (priceCents: number, currency: string): string => {
  try {
    return withCurrencyGlyph(
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency || "USD",
        ...priceDecimals(priceCents / 100),
      }).format(priceCents / 100),
      currency,
    );
  } catch {
    return `${(priceCents / 100).toFixed(priceFallbackDecimals(priceCents / 100))} ${currency}`;
  }
};

export interface TripPlanV2PublicSummaryValue {
  planLine: string;
  flexLine: string | null;
  depositPolicyLine: string | null;
}

/** Concise public disclosure; dates remain server-owned at checkout. */
export function tripPlanV2PublicSummary(
  tier: TripOfferingTier,
  depositNonRefundable: boolean,
): TripPlanV2PublicSummaryValue | null {
  const plan = tier.paymentPlanV2;
  if (plan === null || plan === undefined) return null;
  const packagePriceCents = Math.max(
    0,
    tier.salePriceCents ?? tier.priceCents,
  );
  const depositCents =
    plan.deposit.mode === "amount"
      ? Math.min(plan.deposit.amount_minor, packagePriceCents)
      : Math.floor((packagePriceCents * plan.deposit.pct) / 100);
  return {
    planLine:
      `${formatTripPrice(depositCents, tier.currency)} today, then up to ` +
      `${plan.count} payment${plan.count === 1 ? "" : "s"} · last one ` +
      `${plan.final_due_days_before_start} day${
        plan.final_due_days_before_start === 1 ? "" : "s"
      } before departure`,
    flexLine:
      plan.flex?.enabled === true ? "Pay any amount after your deposit" : null,
    depositPolicyLine: depositNonRefundable
      ? "Deposit is non-refundable"
      : null,
  };
}

export const TripPlanV2PublicSummary: React.FC<{
  tier: TripOfferingTier;
  palette: ThemePalette;
  depositNonRefundable: boolean;
}> = ({ tier, palette, depositNonRefundable }) => {
  const summary = tripPlanV2PublicSummary(tier, depositNonRefundable);
  if (summary === null) return null;
  return (
    <View style={styles.wrap} testID={`trip-body-pkg-plan-v2-${tier.ticketTypeId}`}>
      <Text style={[styles.main, { color: palette.secondaryText }]}>
        {summary.planLine}
      </Text>
      {summary.flexLine !== null ? (
        <Text style={[styles.sub, { color: palette.accent }]}>
          {summary.flexLine}
        </Text>
      ) : null}
      {summary.depositPolicyLine !== null ? (
        <Text style={[styles.sub, { color: palette.tertiaryText }]}>
          {summary.depositPolicyLine}
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginTop: 8, gap: 3 },
  main: { fontSize: 12, lineHeight: 17, fontWeight: "700" },
  sub: { fontSize: 11, lineHeight: 15, fontWeight: "700" },
});

export default TripPlanV2PublicSummary;
