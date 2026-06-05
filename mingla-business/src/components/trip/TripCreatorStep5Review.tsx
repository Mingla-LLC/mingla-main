/**
 * TripCreatorStep5Review — Step 5 of TripCreatorWizard. Renders TripPreview
 * (the same component the public /t/{slug} route uses) so operator sees
 * exactly what buyers will see, plus an inline error banner surfacing any
 * publish-RPC validation failure.
 *
 * Tr2 (ORCH-0859). Per SPEC §4.8 Step 5.
 *
 * The Publish button itself lives in TripCreatorWizard footer (sticky dock
 * pattern — mirrors EventCreatorWizard).
 */

import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import {
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { Trip } from "../../services/tripsService";
import { StripeBlockedCard } from "../offering/StripeBlockedCard";
import { TripPreview, type TripPreviewBrand } from "./TripPreview";

export interface TripCreatorStep5ReviewProps {
  trip: Trip;
  brand: TripPreviewBrand;
  /**
   * Publish-validation error code from `business_publish_trip_draft` RPC.
   * Shown as an inline banner pointing back to the failing step. Null when
   * no error or before first publish attempt.
   */
  publishError: PublishErrorState | null;
  /**
   * ORCH-1076 Stream B — proactive Stripe gate: true when this is a PAID trip
   * on a brand whose Stripe is not active. Shows the StripeBlockedCard banner
   * (the same proactive guidance events have on Step 7). Defaults to false so
   * existing call sites / the public preview are unaffected.
   */
  needsStripe?: boolean;
  /** Connect-Stripe CTA handler — routes to the brand's Stripe onboarding. */
  onConnectStripe?: () => void;
}

export interface PublishErrorState {
  /** RPC error code, e.g. "trip_days_required". */
  code: string;
  /** Plain-English message for the operator. */
  message: string;
  /** Which wizard step to jump back to (1-5) — operator-friendly. */
  pointsToStep: 1 | 2 | 3 | 4 | 5;
}

export const TripCreatorStep5Review: React.FC<TripCreatorStep5ReviewProps> = ({
  trip,
  brand,
  publishError,
  needsStripe = false,
  onConnectStripe,
}) => {
  return (
    <ScrollView
      style={styles.host}
      contentContainerStyle={styles.contentContainer}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.helper}>
        Preview what buyers will see. Tap Publish in the footer when ready.
      </Text>

      {publishError !== null ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerTitle}>Can&rsquo;t publish yet</Text>
          <Text style={styles.errorBannerText}>{publishError.message}</Text>
          <Text style={styles.errorBannerStep}>
            Go back to Step {publishError.pointsToStep} to fix.
          </Text>
        </View>
      ) : null}

      {/* ORCH-1076 Stream B — proactive Stripe banner. Renders BELOW any
          reactive publishError (they describe different things and must not
          suppress each other) and ABOVE the preview. */}
      {needsStripe ? (
        <View style={styles.stripeBannerWrap}>
          <StripeBlockedCard
            title="Bank required for paid trips"
            body="Connect a bank to publish this paid trip. Free trips can be published any time."
            ctaLabel="Connect bank"
            onConnectStripe={onConnectStripe ?? (() => undefined)}
            testID="trip-step5-stripe-blocked"
          />
        </View>
      ) : null}

      <View style={styles.previewWrap}>
        <TripPreview
          trip={trip}
          brand={brand}
          showCta={false}
          contentPadding={0}
          testID="trip-step5-preview"
        />
      </View>
    </ScrollView>
  );
};

/**
 * Map a `business_publish_trip_draft` RPC error code to operator-friendly
 * copy + which step to jump to. Used by TripCreatorWizard's publish error
 * handler.
 */
export function mapPublishErrorToState(
  code: string,
  rawMessage: string,
): PublishErrorState {
  // Discriminator is `rawMessage`, NOT `code`. Supabase Postgrest returns
  // `code = "P0001"` (SQLSTATE) for unqualified `RAISE EXCEPTION 'foo'`
  // statements; the literal name lives in `message`. The trip publish RPC
  // (supabase/migrations/20260608000100_orch_0859_publish_rpc_trip.sql)
  // uses unqualified RAISE for every validation, so switching on `code`
  // always falls through to `default` in production. ORCH-0859 [Tr2
  // Minimum Viable Trip] tester adversarial regression at
  // publishErrorMapper.adversarial.test.ts pins this.
  switch (rawMessage) {
    case "trip_destination_required":
      return {
        code,
        message: "Add a destination before publishing.",
        pointsToStep: 1,
      };
    case "trip_capacity_required":
      return {
        code,
        message: "Set a positive capacity before publishing.",
        pointsToStep: 1,
      };
    case "trip_dates_required":
      return {
        code,
        message: "Set both start and end dates before publishing.",
        pointsToStep: 1,
      };
    case "trip_end_before_start":
      return {
        code,
        message: "Trip end date must come after the start date.",
        pointsToStep: 1,
      };
    case "event_title_required":
      return {
        code,
        message: "Add a trip title before publishing.",
        pointsToStep: 1,
      };
    case "trip_days_required":
      return {
        code,
        message: "Add at least one day to the itinerary before publishing.",
        pointsToStep: 2,
      };
    case "trip_pricing_tier_required":
      return {
        code,
        message: "Configure pricing before publishing.",
        pointsToStep: 4,
      };
    case "insufficient_event_permission":
      return {
        code,
        message: "You don't have permission to publish for this brand.",
        pointsToStep: 5,
      };
    case "event_draft_not_publishable":
      return {
        code,
        message: "This trip is no longer in draft state. Refresh and try again.",
        pointsToStep: 5,
      };
    // ORCH-1075 — paid-publish integrity guards (locked copy, SPEC §3.7). The
    // wizard's catch ALSO routes stripe_charges_disabled to Stripe onboarding;
    // offering_date_past points back to the dates step.
    case "stripe_charges_disabled":
      return {
        code,
        message:
          "You can't publish a paid listing until your Stripe payouts are switched on. It takes a couple of minutes.",
        pointsToStep: 5,
      };
    case "offering_date_past":
      return {
        code,
        message:
          "This date has already passed. Choose a date that's still ahead so people can book it.",
        pointsToStep: 1,
      };
    default:
      return {
        code,
        message: rawMessage || "Couldn't publish. Tap Publish to try again.",
        pointsToStep: 5,
      };
  }
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: spacing.lg,
  },
  helper: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  errorBanner: {
    margin: spacing.lg,
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.4)",
  },
  errorBannerTitle: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "700",
    color: "#EF4444",
    marginBottom: spacing.xs,
  },
  errorBannerText: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: "#EF4444",
  },
  errorBannerStep: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
  },
  stripeBannerWrap: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  previewWrap: {
    marginTop: spacing.xs,
  },
});

export default TripCreatorStep5Review;
