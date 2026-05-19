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
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";
import type { Trip } from "../../services/tripsService";
import type { TripPreviewBrand } from "./TripPreview";
import { InstallmentScheduleDisplay } from "./InstallmentScheduleDisplay";
import { projectInstallmentSchedule } from "../../utils/installmentScheduleProjection";

export interface TripCheckoutFlowProps {
  trip: Trip;
  brand: TripPreviewBrand;
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
  brand,
  testID,
}) => {
  const router = useRouter();
  const tier = trip.pricingTiers[0];

  // ORCH-0882 [Render Payment Plan Disclosure on Trip Buyer + Planner
  // Surfaces] — project the schedule template using a now() anchor.
  // `installmentSchedule === null` short-circuits the render (component
  // returns null on null schedule).
  const projectedSchedule = useMemo(
    () =>
      tier === undefined
        ? null
        : projectInstallmentSchedule(tier, new Date()),
    [tier],
  );

  const handleReserve = (): void => {
    // ORCH-0876: trip-specific chain. Event-side /checkout/[eventId]/*
    // hard-rejects trips by audit-test invariant — see
    // mingla-business/src/services/__tests__/eventType.filter.audit.test.ts.
    // The underlying biz_ticket_checkout_create_session RPC stays shared
    // (branches on event_type='trip' per Tr3 [ORCH-0869] migration).
    router.push(`/checkout-trip/${trip.id}` as never);
  };

  if (tier === undefined) {
    return (
      <View style={styles.host} testID={testID}>
        <Text style={styles.errorText}>
          This trip isn&rsquo;t bookable yet. Pricing hasn&rsquo;t been set.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.host} testID={testID}>
      <Text style={styles.brandByline}>by {brand.name}</Text>
      <Text style={styles.tripTitle}>{trip.title}</Text>

      <View style={styles.tierCard}>
        <View style={styles.tierTextCol}>
          <Text style={styles.tierName}>{tier.tierName}</Text>
          <Text style={styles.tierPrice}>
            {formatPriceMajor(tier.priceCents, tier.currency)}
          </Text>
        </View>
        <View style={styles.tierSelectedBadge}>
          <Icon name="check" size={14} color={accent.warm} />
        </View>
      </View>

      {/* ORCH-0882 — buyer-facing payment plan disclosure. Component
          returns null when projectedSchedule is null (tier has no plan),
          so layout stays identical for trips without plans. */}
      {projectedSchedule !== null ? (
        <View style={styles.planWrap}>
          <InstallmentScheduleDisplay
            schedule={projectedSchedule}
            variant="buyer"
            isProjection={true}
          />
        </View>
      ) : null}

      <Pressable
        onPress={handleReserve}
        accessibilityRole="button"
        accessibilityLabel={`Reserve your spot on ${trip.title}`}
        style={styles.cta}
        testID="trip-checkout-reserve"
      >
        <Text style={styles.ctaText}>Reserve my spot</Text>
      </Pressable>

      <Text style={styles.helper}>
        You&rsquo;ll enter your details + pay securely on the next screen.
        Stripe handles the payment; Mingla never sees your card.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  brandByline: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  tripTitle: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    color: textTokens.primary,
  },
  tierCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radiusTokens.lg,
    backgroundColor: "rgba(235, 120, 37, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(235, 120, 37, 0.5)",
  },
  tierTextCol: {
    flex: 1,
  },
  tierName: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  tierPrice: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
    marginTop: 2,
  },
  tierSelectedBadge: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "rgba(235, 120, 37, 0.16)",
  },
  // ORCH-0882 — wrapper so the schedule card sits between the tier card
  // and the Reserve CTA with consistent vertical spacing.
  planWrap: {
    width: "100%",
  },
  cta: {
    paddingVertical: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: accent.warm,
    alignItems: "center",
  },
  ctaText: {
    fontSize: typography.body.fontSize,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  helper: {
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
