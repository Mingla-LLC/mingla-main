/**
 * Trip tickets selection screen. ORCH-0876 [Trip CRUD + Purchase Flow
 * Completion] — mirror of `app/checkout/[eventId]/index.tsx` for trips.
 *
 * Route: /checkout-trip/{tripEventId}
 *
 * Buyer arrives from TripPreview's "Reserve my spot" CTA. They pick which
 * pricing tier(s) + quantities. Subtotal updates live. Continue routes to
 * /checkout-trip/{tripEventId}/buyer.
 *
 * Architecture: trips have their own buyer-checkout chain — event-side
 * `getPublicEventById` hard-rejects trips by audit-test invariant. The
 * underlying `biz_ticket_checkout_create_session` RPC stays shared (Tr3
 * branching). Trip-tier shape adapts to TicketStub for QuantityRow reuse.
 *
 * Per SPEC_ORCH-0876_V2_FULL_PARITY §8.3.
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — design-intent full-bleed checkout header mirroring /checkout/[eventId]/index.tsx; insets.bottom IS applied (bottom dock) for home-indicator clearance; the top status-bar overlap with back arrow / "Reserve your spot" header / "1 OF 3" pill is the intended banner-style buyer aesthetic. Per ORCH-0876 mirror of ORCH-0859 [Tr2] REWORK 5b operator design ruling.

import React, { useCallback, useMemo } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../../src/constants/designSystem";
import { tripPublicPath } from "../../../src/constants/publicUrls";
import { usePublicTripById } from "../../../src/hooks/usePublicTripById";
import { formatCurrency } from "../../../src/utils/currency";
import type { TripPricingTier } from "../../../src/services/tripsService";
import { projectInstallmentSchedule } from "../../../src/utils/installmentScheduleProjection";
import type {
  TicketAvailableAt,
  TicketStub,
  TicketVisibility,
} from "../../../src/store/draftEventStore";

import { Button } from "../../../src/components/ui/Button";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { EventCoverMedia } from "../../../src/components/ui/EventCoverMedia";
import { InstallmentScheduleDisplay } from "../../../src/components/trip/InstallmentScheduleDisplay";

import {
  useCart,
  useCartTotals,
} from "../../../src/components/checkout/CartContext";
import { CheckoutHeader } from "../../../src/components/checkout/CheckoutHeader";
import { QuantityRow } from "../../../src/components/checkout/QuantityRow";

/**
 * Convert a TripPricingTier (DB shape) to a TicketStub (QuantityRow's
 * expected shape). Trip tiers are simpler than event tickets — no
 * visibility/door/sale-window mechanics — so we map straight defaults
 * for the buyer-checkout-irrelevant fields.
 */
const tierToTicketStub = (tier: TripPricingTier): TicketStub => ({
  id: tier.ticketTypeId,
  name: tier.tierName,
  priceGbp: tier.priceCents > 0 ? tier.priceCents / 100 : null,
  currency: tier.currency,
  capacity: tier.quantityTotal,
  isFree: tier.priceCents === 0,
  isUnlimited: tier.isUnlimited,
  visibility: "public" as TicketVisibility,
  displayOrder: 0,
  approvalRequired: false,
  passwordProtected: false,
  password: null,
  waitlistEnabled: false,
  minPurchaseQty: 1,
  maxPurchaseQty: null,
  allowTransfers: true,
  description: null,
  saleStartAt: null,
  saleEndAt: null,
  availableAt: "online" as TicketAvailableAt,
});

const isTripPast = (endAtIso: string | null): boolean => {
  if (endAtIso === null) return false;
  const end = new Date(endAtIso).getTime();
  return Number.isFinite(end) && end + 24 * 60 * 60 * 1000 < Date.now();
};

const formatTripDateLine = (
  startAtIso: string | null,
  endAtIso: string | null,
): string => {
  if (startAtIso === null) return "";
  try {
    const fmt = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    });
    const start = fmt.format(new Date(startAtIso));
    if (endAtIso !== null) {
      const end = fmt.format(new Date(endAtIso));
      return `${start} – ${end}`;
    }
    return start;
  } catch {
    return "";
  }
};

export default function CheckoutTripTicketsScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ tripEventId: string }>();
  const tripEventId =
    typeof params.tripEventId === "string" ? params.tripEventId : null;

  const publicTripQuery = usePublicTripById(tripEventId);
  const trip = publicTripQuery.data?.trip ?? null;
  const brand = publicTripQuery.data?.brand ?? null;

  const { lines, setLineQuantity } = useCart();
  const totals = useCartTotals();

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (trip !== null && trip.brandSlug !== null) {
      router.replace(
        tripPublicPath({
          brandSlug: trip.brandSlug,
          tripSlug: trip.slug,
        }) as never,
      );
      return;
    }
    router.replace("/(tabs)/home" as never);
  }, [router, trip]);

  const handleContinue = useCallback((): void => {
    if (tripEventId === null || totals.isEmpty) return;
    router.push(`/checkout-trip/${tripEventId}/buyer` as never);
  }, [router, tripEventId, totals.isEmpty]);

  // ----- Trip-not-found / past / closed empty states -----
  if (publicTripQuery.isLoading || publicTripQuery.isFetching) {
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={0}
          totalSteps={3}
          title="Reserve your spot"
          onBack={handleBack}
        />
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Loading trip…</Text>
        </View>
      </View>
    );
  }

  if (publicTripQuery.isError) {
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={0}
          totalSteps={3}
          title="Reserve your spot"
          onBack={handleBack}
        />
        <View style={styles.emptyWrap}>
          <EmptyState
            illustration="ticket"
            title="Trip couldn't load"
            description="Refresh this page or try the trip link again."
            cta={{ label: "Back", onPress: handleBack }}
          />
        </View>
      </View>
    );
  }

  if (trip === null) {
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={0}
          totalSteps={3}
          title="Reserve your spot"
          onBack={handleBack}
        />
        <View style={styles.emptyWrap}>
          <EmptyState
            illustration="ticket"
            title="Trip not found"
            description="This trip link may be expired or moved."
            cta={{ label: "Back", onPress: handleBack }}
          />
        </View>
      </View>
    );
  }

  // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline]: respect bookings_closed
  // gate. Tr4 SPEC §3.5.8 amendment will replace this branch with a richer
  // "Bookings closed on <date>" banner.
  if (trip.bookingsClosed) {
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={0}
          totalSteps={3}
          title="Reserve your spot"
          onBack={handleBack}
        />
        <View style={styles.emptyWrap}>
          <EmptyState
            illustration="ticket"
            title="Bookings closed"
            description="This trip stopped accepting new reservations."
            cta={{ label: "Back", onPress: handleBack }}
          />
        </View>
      </View>
    );
  }

  // Map pricing tiers → TicketStub for QuantityRow reuse.
  const tickets = trip.pricingTiers.map(tierToTicketStub);
  const isPast = isTripPast(trip.businessTrip.endAt);
  const allSoldOut =
    tickets.length > 0 &&
    tickets.every((t) => !t.isUnlimited && (t.capacity ?? 0) <= 0);

  if (isPast || tickets.length === 0 || allSoldOut) {
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={0}
          totalSteps={3}
          title="Reserve your spot"
          onBack={handleBack}
        />
        <View style={styles.emptyWrap}>
          <EmptyState
            illustration="ticket"
            title={
              isPast
                ? "This trip has ended"
                : tickets.length === 0
                  ? "Pricing isn't ready yet"
                  : "Sold out"
            }
            description={
              isPast
                ? "Reservations are closed for this trip."
                : tickets.length === 0
                  ? "The trip planner hasn't set pricing tiers yet."
                  : "All spots on this trip are gone."
            }
            cta={{ label: "Back to trip", onPress: handleBack }}
          />
        </View>
      </View>
    );
  }

  const continueLabel = totals.isFree ? "Reserve free spot" : "Continue";
  const dateLine = formatTripDateLine(
    trip.businessTrip.startAt,
    trip.businessTrip.endAt,
  );

  return (
    <View style={styles.host}>
      <CheckoutHeader
        stepIndex={0}
        totalSteps={3}
        title="Reserve your spot"
        onBack={handleBack}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 140 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Trip mini-card: cover + title + brand/date line */}
        <View style={styles.miniCard}>
          <EventCoverMedia
            hue={0}
            mediaUrl={trip.coverMediaUrl}
            mediaType={
              trip.coverMediaType as "image" | "video" | "gif" | null
            }
            radius={0}
            label=""
            style={styles.miniCover}
          />
          <Text style={styles.miniTitle} numberOfLines={2}>
            {trip.title.trim().length > 0 ? trip.title : "Untitled trip"}
          </Text>
          <Text style={styles.miniSubtitle} numberOfLines={1}>
            {brand?.name ?? "Mingla"}
            {dateLine.length > 0 ? ` · ${dateLine}` : ""}
          </Text>
          {trip.businessTrip.destinationLocationText !== null ? (
            <Text style={styles.miniDestination} numberOfLines={1}>
              {trip.businessTrip.destinationLocationText}
            </Text>
          ) : null}
        </View>

        <Text style={styles.sectionLabel}>Select your tier</Text>

        {tickets.map((ticket) => {
          const line = lines.find((l) => l.ticketTypeId === ticket.id);
          const qty = line?.quantity ?? 0;
          // ORCH-0882 — find the source TripPricingTier for this ticket
          // (mapped through tierToTicketStub above) to get the schedule
          // template. Per-tier per-line render: only show when qty >= 1
          // AND the tier has a plan configured. Pass `qty` so the
          // disclosure scales with cart quantity (€500/tier × qty=2 →
          // €250 deposit, not €125).
          const sourceTier: TripPricingTier | undefined =
            trip.pricingTiers.find((t) => t.ticketTypeId === ticket.id);
          const projectedSchedule =
            sourceTier !== undefined && qty >= 1
              ? projectInstallmentSchedule(sourceTier, new Date(), qty)
              : null;
          return (
            <View key={ticket.id} style={styles.tierWrap}>
              <QuantityRow
                ticket={ticket}
                quantity={qty}
                onQuantityChange={(next): void =>
                  setLineQuantity({
                    ticketTypeId: ticket.id,
                    ticketName: ticket.name,
                    unitPrice: ticket.priceGbp ?? 0,
                    currency:
                      ticket.currency ??
                      trip.pricingTiers[0]?.currency ??
                      "USD",
                    isFree: ticket.isFree,
                    quantity: next,
                  })
                }
              />
              {projectedSchedule !== null && qty >= 1 ? (
                <View style={styles.tierPlanWrap}>
                  <InstallmentScheduleDisplay
                    schedule={projectedSchedule}
                    variant="buyer"
                    isProjection={true}
                  />
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      {/* Sticky bottom bar — subtotal + Continue */}
      <View
        style={[
          styles.bottomBar,
          { paddingBottom: insets.bottom + spacing.md },
        ]}
      >
        <View style={styles.subtotalRow}>
          <Text style={styles.subtotalLabel}>Subtotal</Text>
          <Text style={styles.subtotalValue}>
            {totals.isEmpty
              ? "—"
              : totals.isFree
                ? "Free"
                : formatCurrency(totals.total, totals.currency)}
          </Text>
        </View>
        <Button
          label={continueLabel}
          onPress={handleContinue}
          variant="primary"
          size="lg"
          fullWidth
          disabled={totals.isEmpty}
          accessibilityLabel={
            totals.isEmpty
              ? "Add a tier above"
              : totals.isFree
                ? "Reserve free spot"
                : `Continue to buyer details, total ${formatCurrency(totals.total, totals.currency)}`
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: "#0c0e12",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  miniCard: {
    marginBottom: spacing.lg,
  },
  miniCover: {
    height: 64,
    borderRadius: radiusTokens.md,
    marginBottom: spacing.sm,
  },
  miniTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.3,
  },
  miniSubtitle: {
    fontSize: 13,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  miniDestination: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: textTokens.tertiary,
    letterSpacing: 1.4,
    marginBottom: spacing.sm,
  },
  // ORCH-0882 — wrap each QuantityRow + its plan disclosure so spacing
  // between tier rows stays consistent regardless of plan presence.
  tierWrap: {
    width: "100%",
  },
  // Tight vertical spacing between the QuantityRow and the plan card
  // for the same tier.
  tierPlanWrap: {
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  emptyTitle: {
    color: textTokens.secondary,
    fontSize: 14,
    textAlign: "center",
  },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: "rgba(12, 14, 18, 0.94)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.06)",
  },
  subtotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: spacing.sm,
  },
  subtotalLabel: {
    fontSize: 13,
    color: textTokens.tertiary,
    fontWeight: "500",
  },
  subtotalValue: {
    fontSize: 20,
    color: textTokens.primary,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
});
