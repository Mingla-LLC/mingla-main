/**
 * TripCheckoutFlow — buyer-side trip checkout entry. Tr2 (ORCH-0859),
 * route-corrected by ORCH-0876 [Trip CRUD + Purchase Flow Completion].
 *
 * Renders a tier picker (Tr2 ships single tier — auto-selects), then
 * navigates to the trip-specific buyer-checkout chain at
 * `/checkout-trip/{tripEventId}/*` via router.push.
 *
 * ORCH-0876 correction: Tr2's "reuse /checkout chain end-to-end" assumption
 * was invalidated by ORCH-0859 REWORK 3 — `getPublicEventById` hard-rejects
 * trip rows by design (audit-enforced at
 * `mingla-business/src/services/__tests__/eventType.filter.audit.test.ts`).
 * Trips therefore route into their own buyer chain. The underlying
 * `biz_ticket_checkout_create_session` RPC remains shared (it branches on
 * `event_type='trip'` per Tr3 [ORCH-0869 Installment Payments] migration).
 *
 * This component exists so trip-specific entry copy ("Reserve your spot on
 * X") can diverge from event copy without duplicating the buyer-info →
 * payment → confirmation chain.
 */

import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { ThemePalette } from "@mingla/offering-rendering";
import type { Trip } from "../../services/tripsService";
import type { TripPreviewBrand } from "./TripPreview";
import { projectInstallmentSchedule } from "../../utils/installmentScheduleProjection";
import {
  TripPaymentChoice,
  type TripPaymentChoiceValue,
} from "./TripPaymentChoice";

export interface TripCheckoutFlowProps {
  trip: Trip;
  /**
   * Retained in the signature so callers (`[tripSlug].tsx`) need not change
   * their prop list. ORCH-1130 removed the hero dupe that consumed `brand`;
   * the value is no longer read here (the hero lives once in `TripPreview`).
   */
  brand: TripPreviewBrand;
  /**
   * ORCH-1130 — the public-page pay-full vs pay-over-time choice. The public
   * `/t/` route owns this state (it lives OUTSIDE the checkout CartProvider)
   * and threads the value into checkout as a route param on Reserve.
   */
  paymentPlanChoice: TripPaymentChoiceValue;
  onPaymentPlanChoiceChange: (value: TripPaymentChoiceValue) => void;
  /**
   * ORCH-1138 B5 (additive) — passthrough to TripPaymentChoice. The public trip
   * page passes the resolved brand palette; the /checkout-trip payment route +
   * wizard do NOT (so they render byte-identical to pre-1138). RT-2 guards this.
   */
  palette?: ThemePalette;
  /**
   * ORCH-1138 R2 (additive) — resolved brand font for the themed amount block.
   * Passthrough to TripPaymentChoice. Absent ⇒ unused (no-palette byte-identical).
   */
  fontFamily?: string;
  testID?: string;
}

function formatPriceMajor(priceCents: number, currency: string): string {
  if (priceCents === 0) return "Free";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
    }).format(priceCents / 100);
  } catch {
    return `${(priceCents / 100).toFixed(2)} ${currency}`;
  }
}

export const TripCheckoutFlow: React.FC<TripCheckoutFlowProps> = ({
  trip,
  paymentPlanChoice,
  onPaymentPlanChoiceChange,
  palette,
  fontFamily,
  testID,
}) => {
  const tier = trip.pricingTiers[0];

  // ORCH-1130 — project the schedule template using a now() anchor. Null when
  // the tier has no payment plan; that short-circuits the selector and the
  // caller renders the quiet price recap line instead.
  const projectedSchedule = useMemo(
    () =>
      tier === undefined
        ? null
        : projectInstallmentSchedule(tier, new Date()),
    [tier],
  );

  // ORCH-1117 — the inline Reserve CTA is REMOVED (locked single-ticket rule).
  // The floating Buy bar on /t/[brandSlug]/[tripSlug] is the ONLY Reserve
  // action and owns navigation to `/checkout-trip/{trip.id}` (tripCheckoutPath).
  //
  // ORCH-1130 — TripCheckoutFlow no longer repeats the hero (title + brand
  // byline lived twice; TripPreview above already shows them once). The passive
  // standalone installment projection is replaced by the selector-gated
  // `TripPaymentChoice` module: pay-full vs pay-over-time at consideration time,
  // with the schedule revealed only under the over-time option.
  //
  // ORCH-0876 trip-specific chain invariant PRESERVED: the Reserve nav still
  // targets `/checkout-trip/{trip.id}`, never the events-side `/checkout/{id}`
  // chain (eventType.filter.audit.test.ts). The nav lives in the route's
  // floating bar via tripCheckoutPath(trip.id).

  if (tier === undefined) {
    return (
      <View style={styles.host} testID={testID}>
        <Text style={styles.errorText}>
          This trip isn&rsquo;t bookable yet. Pricing hasn&rsquo;t been set.
        </Text>
      </View>
    );
  }

  // No-plan trip → quiet price recap line (no selector). DESIGN §2.1 wireframe 3.
  // ORCH-1138 R2 (additive) — palette present (public page) themes the recap text
  // so it reads on a light brand page; absent → byte-identical (warm-dark tokens).
  if (projectedSchedule === null) {
    return (
      <View style={palette !== undefined ? null : styles.host} testID={testID}>
        <View style={styles.recapRow}>
          <Text
            style={[
              styles.recapTierName,
              palette !== undefined ? { color: palette.secondaryText } : null,
            ]}
            numberOfLines={1}
          >
            {tier.tierName}
          </Text>
          <Text
            style={[
              styles.recapPrice,
              palette !== undefined ? { color: palette.primaryText } : null,
            ]}
          >
            {formatPriceMajor(tier.priceCents, tier.currency)}
          </Text>
        </View>
        <Text
          style={[
            styles.recapHelper,
            palette !== undefined ? { color: palette.tertiaryText } : null,
          ]}
        >
          One secure payment. Stripe handles it; we never see your card.
        </Text>
      </View>
    );
  }

  // Plan trip → the segmented toggle module.
  // ORCH-1138 R2 (additive) — on the PUBLIC trip page (palette present) drop the
  // host inset so the themed mockup pay card sits flush in its section; the
  // no-palette callers keep the original `host` padding (byte-identical).
  return (
    <View style={palette !== undefined ? null : styles.host} testID={testID}>
      <TripPaymentChoice
        schedule={projectedSchedule}
        fullPriceCents={tier.priceCents}
        currency={tier.currency}
        depositPct={tier.installmentSchedule?.deposit_pct ?? 0}
        value={paymentPlanChoice}
        onChange={onPaymentPlanChoiceChange}
        palette={palette}
        fontFamily={fontFamily}
        testID={testID !== undefined ? `${testID}-payment-choice` : undefined}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  // ORCH-1130 — no-plan quiet price recap (replaces the tier card + passive
  // projection + helper for single-payment trips).
  recapRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  recapTierName: {
    flexShrink: 1,
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  recapPrice: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
  },
  recapHelper: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    textAlign: "center",
  },
  errorText: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    textAlign: "center",
  },
});

export default TripCheckoutFlow;
