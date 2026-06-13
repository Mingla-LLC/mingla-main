/**
 * /t/[brandSlug]/[tripSlug] — public buyer-anon trip detail route.
 * Tr2 (ORCH-0859). ORCH-0874 [Trip surfaces visual parity with Events]
 * adds the X-close + share IconChrome overlays mirroring the public event
 * page hero pattern. Per SPEC §4.5 + SPEC_ORCH-0874 §3.3.7.
 *
 * Anon-tolerant per feedback_anon_buyer_routes.md: no useAuth on this page.
 * The "no sign-in redirect" guarantee is enforced at the ROOT layout by the
 * `PUBLIC_BUYER_ROUTE_PREFIXES` allowlist in coldLoadAuthGates.ts (ORCH-1115) —
 * the `/t/` prefix is exempted from the ORCH-1102 unauthenticated redirect, so a
 * logged-out guest with the share link sees this page (NOT the sign-in wall).
 * (Living OUTSIDE app/(tabs)/ is no longer sufficient on its own — ORCH-1102
 * moved the redirect to the root layout that wraps every route.)
 *
 * Renders TripPreview (full trip detail) + TripCheckoutFlow (Reserve CTA +
 * tier picker that routes to the existing /checkout/{tripEventId} chain).
 *
 * Lives OUTSIDE app/(tabs)/ — same as /e/, /b/, /checkout/.
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — design-intent full-bleed cover on the public trip share-link page (mirrors /e/{brandSlug}/{eventSlug}); the buyer-facing banner aesthetic is intentional. TripPreview renders the cover full-bleed to the screen edge by design; status-bar overlap is the chosen look. Per ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 5b operator design ruling 2026-05-17 (QA report §1, pattern parity with screenshot 17-PUBLIC-EVENT-PAGE.png). ORCH-0874 preserves this; X-close + share overlays absolute-position over the cover but do not introduce SafeScreen wrapping.

import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { IconChrome } from "../../../src/components/ui/IconChrome";
import { ShareModal } from "../../../src/components/ui/ShareModal";
import { FloatingOfferingBar } from "../../../src/components/offering/FloatingOfferingBar";
import type { CtaState } from "@mingla/event-rendering";
import {
  tripCheckoutPath,
  tripPublicUrl,
} from "../../../src/constants/publicUrls";
import { usePublicTripBySlug } from "../../../src/hooks/usePublicTripBySlug";
import { TripPreview } from "../../../src/components/trip/TripPreview";
import { TripCheckoutFlow } from "../../../src/components/trip/TripCheckoutFlow";
import type { TripPaymentChoiceValue } from "../../../src/components/trip/TripPaymentChoice";
import { projectInstallmentSchedule } from "../../../src/utils/installmentScheduleProjection";
// ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — public-facing refund
// policy ladder + countdown/closed-banner per DESIGN_ORCH-0875 §4.4 + §5.2.
import { RefundPolicyDisplay } from "../../../src/components/trip/RefundPolicyDisplay";

export default function PublicTripRoute(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    brandSlug: string | string[];
    tripSlug: string | string[];
  }>();
  const brandSlug = Array.isArray(params.brandSlug)
    ? params.brandSlug[0]
    : params.brandSlug;
  const tripSlug = Array.isArray(params.tripSlug)
    ? params.tripSlug[0]
    : params.tripSlug;

  const [shareModalVisible, setShareModalVisible] = useState<boolean>(false);
  // ORCH-1130 — the public-page pay-full vs pay-over-time choice. The /t/ route
  // lives OUTSIDE the checkout CartProvider, so the choice is held here and
  // threaded into checkout as a route param on Reserve (the checkout index seeds
  // CartContext.paymentPlanChoice from it). Default "full".
  const [paymentPlanChoice, setPaymentPlanChoice] =
    useState<TripPaymentChoiceValue>("full");

  const query = usePublicTripBySlug(
    typeof brandSlug === "string" ? brandSlug : null,
    typeof tripSlug === "string" ? tripSlug : null,
  );

  // ORCH-0874: X-close → router.back() if possible, otherwise navigate to
  // the brand page as a fallback (mirror public event page UX).
  const handleClose = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (typeof brandSlug === "string" && brandSlug.length > 0) {
      router.replace(`/b/${brandSlug}` as never);
    } else {
      router.replace("/" as never);
    }
  }, [router, brandSlug]);

  // ORCH-1114: share → web-aware ShareModal (copy-link/QR/native-share-via).
  // NEVER revert to the bare react-native share API — it dead-taps on
  // react-native-web (navigator.share undefined). See SPEC_ORCH-1114.
  const handleShare = useCallback((): void => {
    setShareModalVisible(true);
  }, []);

  if (query.isLoading || query.isFetching) {
    return (
      <View style={styles.stateHost}>
        <ActivityIndicator />
        <Text style={styles.stateText}>Loading trip…</Text>
      </View>
    );
  }

  if (query.isError) {
    // ORCH-0879: surface PostgrestError.message (Supabase errors are
    // { code, message, details, hint } objects, NOT JS Error instances).
    // The previous JS-Error-only check fell back to the generic
    // "Check your connection" string, hiding real failures like
    // "42501 permission denied for table brands".
    const rawError: unknown = query.error;
    const errorMessage =
      rawError !== null &&
      typeof rawError === "object" &&
      "message" in rawError &&
      typeof (rawError as { message: unknown }).message === "string"
        ? (rawError as { message: string }).message
        : "Check your connection and try again.";
    return (
      <View style={styles.stateHost}>
        <Text style={styles.stateTitle}>Couldn&rsquo;t load trip</Text>
        <Text style={styles.stateText}>{errorMessage}</Text>
      </View>
    );
  }

  const payload = query.data;
  if (payload === null || payload === undefined) {
    return (
      <View style={styles.stateHost}>
        <Text style={styles.stateTitle}>Trip not found</Text>
        <Text style={styles.stateText}>
          This trip may not be live yet, or the link is wrong.
        </Text>
      </View>
    );
  }

  // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — booking-deadline state
  // for the public page. Three cases per DESIGN_ORCH-0875 §4.4:
  //   - bookings_closed=true → red banner "Bookings closed"
  //   - booking_deadline future → "Bookings close in N days/hours" pill
  //   - no deadline / closed=false → no banner
  const trip = payload.trip;
  const deadlineIso = trip.bookingDeadline;
  const isClosed = trip.bookingsClosed === true;
  let countdownLabel: string | null = null;
  if (!isClosed && deadlineIso !== null) {
    const deadlineMs = Date.parse(deadlineIso);
    if (Number.isFinite(deadlineMs)) {
      const diffMs = deadlineMs - Date.now();
      if (diffMs > 0) {
        const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
        const hours = Math.floor(diffMs / (60 * 60 * 1000));
        const minutes = Math.floor(diffMs / (60 * 1000));
        if (days >= 1) {
          countdownLabel = `Bookings close in ${days} day${days === 1 ? "" : "s"}`;
        } else if (hours >= 1) {
          countdownLabel = `Bookings close in ${hours} hour${hours === 1 ? "" : "s"}`;
        } else if (minutes >= 1) {
          countdownLabel = `Bookings close in ${minutes} minute${minutes === 1 ? "" : "s"}`;
        }
      }
    }
  }

  // ORCH-1117 — floating Buy bar CTA for the trip. Single-ticket; the inline
  // Reserve CTA was removed (locked rule) so this bar is the ONLY Reserve action
  // and owns navigation to /checkout-trip/{id}. States (precedence):
  //   !bookable          → "Booking unavailable" info strip (NON-tappable)
  //   bookings closed     → "Bookings closed" info strip (NON-tappable)
  //   else                → "Reserve my spot" + "From {price}"
  const tripTier = trip.pricingTiers[0];
  const tripPrice =
    tripTier !== undefined && tripTier.priceCents > 0
      ? formatTripPrice(tripTier.priceCents, tripTier.currency)
      : tripTier !== undefined && tripTier.priceCents === 0
        ? "Free"
        : "";
  // ORCH-1130 — does this trip have an installment plan? The bar's price label
  // must disambiguate the full-vs-deposit ambiguity. The deposit number is read
  // from the SAME projected schedule the TripPaymentChoice module renders
  // (projectInstallmentSchedule), never recomputed.
  //
  // ORCH-1130 ADDENDUM (Seth-BINDING): the CTA amount follows the live toggle
  // selection on this page —
  //   pay-over-time → the bar LEADS with the deposit due today
  //                   ("Reserve · {deposit} today"); full price stays
  //                   discoverable inside the module.
  //   pay-in-full   → "{full} total" (the whole trip price).
  // Updates live because `paymentPlanChoice` is this component's state, threaded
  // into TripCheckoutFlow's toggle. Single-tier (prod-universal) full path uses
  // the exact price; multi-tier (no prod data) keeps the "From {price}" hint.
  const barSchedule =
    tripTier !== undefined
      ? projectInstallmentSchedule(tripTier, new Date())
      : null;
  const tripHasPlan = barSchedule !== null;
  const multiTier = trip.pricingTiers.length > 1;
  const depositLabel =
    barSchedule !== null
      ? formatTripPrice(barSchedule.depositCents, tripTier?.currency ?? "USD")
      : "";
  const barPrice = tripHasPlan
    ? paymentPlanChoice === "installments"
      ? `${depositLabel} today`
      : `${tripPrice} total`
    : multiTier
      ? `From ${tripPrice}`
      : tripPrice;
  const tripCta: CtaState =
    payload.bookable === false
      ? {
          kind: "unavailable",
          title: "Booking unavailable",
          subline: "The organizer is finishing payment setup.",
          tappable: false,
        }
      : isClosed
        ? {
            kind: "unavailable",
            title: "Bookings closed",
            subline: null,
            tappable: false,
          }
        : tripTier === undefined
          ? {
              kind: "unavailable",
              title: "Not bookable yet",
              subline: null,
              tappable: false,
            }
          : tripPrice === "Free"
            ? { kind: "free", label: "Reserve my spot", tappable: true }
            : {
                kind: "buy",
                label: "Reserve my spot",
                price: barPrice,
                tappable: true,
              };
  const handleTripReserve = (): void => {
    // ORCH-1130 — thread the public-page choice into checkout as a route param
    // (the /t/ page is outside the CartProvider; the checkout index seeds
    // CartContext from this param). Only meaningful for plan trips; harmless
    // otherwise (the funnel ignores it for no-plan trips).
    router.push(
      {
        pathname: tripCheckoutPath(trip.id),
        params: { plan: paymentPlanChoice },
      } as never,
    );
  };

  return (
    <View style={styles.host}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: spacing.xl + 96 + insets.bottom },
        ]}
      >
        <TripPreview
          trip={payload.trip}
          brand={payload.brand}
          showCta={false}
        />

        {/* ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — booking-deadline
            countdown pill (open) OR closed banner (past). Renders BELOW the
            TripPreview hero + ABOVE the CheckoutFlow so buyers see the
            urgency cue before reaching the Reserve CTA. */}
        {isClosed && (
          <View style={styles.closedBannerWrap}>
            <GlassCard variant="elevated" padding={spacing.md} radius="lg">
              <Text style={styles.closedBannerTitle}>⚠ Bookings closed</Text>
              <Text style={styles.closedBannerBody}>
                This trip stopped accepting new bookings. Contact the organizer
                if you have questions.
              </Text>
            </GlassCard>
          </View>
        )}
        {!isClosed && countdownLabel !== null && (
          <View style={styles.countdownPillWrap}>
            <View style={styles.countdownPill}>
              <Text style={styles.countdownPillText}>{countdownLabel}</Text>
            </View>
          </View>
        )}

        {/* ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — cancellation
            policy ladder. Renders ONLY when the trip has a policy set. Public
            page omits the "You're here →" callout (no per-buyer context). */}
        {trip.refundPolicy !== null && (
          <View style={styles.refundPolicyWrap}>
            <GlassCard variant="base" padding={spacing.md} radius="lg">
              <RefundPolicyDisplay policy={trip.refundPolicy} />
            </GlassCard>
          </View>
        )}

        <TripCheckoutFlow
          trip={payload.trip}
          brand={payload.brand}
          paymentPlanChoice={paymentPlanChoice}
          onPaymentPlanChoiceChange={setPaymentPlanChoice}
        />
      </ScrollView>

      {/* ORCH-0874: X-close + share IconChrome overlays on the cover hero.
          Absolute-positioned siblings of the ScrollView so they sit on top
          of the cover. Top inset + spacing.sm clears the status bar but
          sits on the gradient overlay region of the cover. */}
      <View
        style={[styles.closeOverlay, { top: insets.top + spacing.sm }]}
        pointerEvents="box-none"
      >
        <IconChrome
          icon="close"
          size={36}
          onPress={handleClose}
          accessibilityLabel="Close"
        />
      </View>
      <View
        style={[styles.shareOverlay, { top: insets.top + spacing.sm }]}
        pointerEvents="box-none"
      >
        <IconChrome
          icon="share"
          size={36}
          onPress={handleShare}
          accessibilityLabel="Share"
        />
      </View>

      {typeof brandSlug === "string" && typeof tripSlug === "string" && (
        <ShareModal
          visible={shareModalVisible}
          onClose={() => setShareModalVisible(false)}
          url={tripPublicUrl({ brandSlug, tripSlug })}
          title={payload.trip.title}
          description={payload.trip.description?.slice(0, 200)}
        />
      )}

      {/* ORCH-1117 — floating Reserve bar (the ONLY Reserve action; inline CTA
          removed). NON-tappable info strip when not bookable / bookings closed. */}
      <FloatingOfferingBar
        cta={tripCta}
        onPress={handleTripReserve}
        surface="dark"
        testID="orch-1117-trip-floating-bar"
      />
    </View>
  );
}

// ORCH-1117 — minor-unit price formatter for the floating bar (mirrors
// TripCheckoutFlow.formatPriceMajor; never recomputes fees — reads priceCents).
function formatTripPrice(priceCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(priceCents / 100);
  } catch {
    return `${(priceCents / 100).toFixed(0)} ${currency}`;
  }
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: "#0c0e12",
    position: "relative",
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  closeOverlay: {
    position: "absolute",
    left: spacing.sm,
    zIndex: 50,
  },
  shareOverlay: {
    position: "absolute",
    right: spacing.sm,
    zIndex: 50,
  },
  stateHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
    backgroundColor: "#0c0e12",
  },
  stateTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
    textAlign: "center",
  },
  stateText: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
    textAlign: "center",
  },
  // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] styles —
  // closed-banner / countdown-pill / refund-policy ladder wraps.
  closedBannerWrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  closedBannerTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: semantic.error,
  },
  closedBannerBody: {
    fontSize: 13,
    color: textTokens.secondary,
    marginTop: spacing.xs,
    lineHeight: 18,
  },
  countdownPillWrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    flexDirection: "row",
  },
  countdownPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  countdownPillText: {
    fontSize: 12,
    fontWeight: "600",
    color: accent.warm,
  },
  refundPolicyWrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
});
