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

      <View style={styles.previewWrap}>
        <TripPreview
          trip={trip}
          brand={brand}
          showCta={false}
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
    paddingHorizontal: spacing.lg,
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
  previewWrap: {
    marginTop: spacing.xs,
  },
});

export default TripCreatorStep5Review;
