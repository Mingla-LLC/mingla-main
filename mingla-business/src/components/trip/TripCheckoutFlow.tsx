/**
 * TripCheckoutFlow — buyer-side trip checkout entry. Tr2 (ORCH-0859).
 *
 * Renders a tier picker (Tr2 ships single tier — auto-selects), then
 * navigates to the existing event-buyer-checkout chain at
 * `/checkout/{tripEventId}/*` via router.push.
 *
 * Per SPEC §4.9 + investigation G-1: the underlying ticket-checkout-create
 * edge function is event_type-agnostic. Trip orders route via brand's
 * stripe_connect_id, exactly like paid events do today. Tr2 buyer flow
 * reuses the existing /checkout chain end-to-end.
 *
 * This component exists so trip-specific entry copy ("Reserve your spot on
 * X") can diverge from event copy without duplicating the buyer-info →
 * payment → confirmation chain.
 */

import React from "react";
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

  const handleReserve = (): void => {
    // Route into the existing event-buyer checkout chain. The underlying
    // edge function is event_type-agnostic per investigation G-1.
    router.push(`/checkout/${trip.id}` as never);
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
