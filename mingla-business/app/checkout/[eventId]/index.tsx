/**
 * J-C1 — Tickets selection screen.
 *
 * Route: /checkout/{eventId}
 *
 * Buyer arrives from PublicEventPage's "Get tickets" CTA. They pick
 * which ticket types + quantities. Subtotal updates live. Continue
 * routes to /checkout/{eventId}/buyer.
 *
 * Hidden tickets (visibility="hidden") are filtered out at this surface
 * (Cycle 5 contract — direct-link only). Disabled / pre-sale / sales-
 * ended tickets render greyed (handled inside QuantityRow).
 *
 * Per Cycle 8 spec §4.4.
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — design-intent full-bleed checkout header: insets.bottom IS applied (line 230 + 283) for home-indicator clearance; the top status-bar overlap with back arrow / "Get tickets" header / "1 OF 3" pill is the intended banner-style buyer aesthetic. Per ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 5b operator design ruling 2026-05-17 (QA report §1) + pixel verification on iPhone 17 Pro Max sim (screenshot 18-CHECKOUT-INDEX.png).

import React, { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../../src/constants/designSystem";
import { eventPublicPath } from "../../../src/constants/publicUrls";
import type { LiveEvent } from "../../../src/store/liveEventStore";
import type { TicketStub } from "../../../src/store/draftEventStore";
import { usePublicEventById } from "../../../src/hooks/usePublicEvents";
import { formatCurrency } from "../../../src/utils/currency";
import { formatDraftDateLine } from "../../../src/utils/eventDateDisplay";

import { Button } from "../../../src/components/ui/Button";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { EventCoverMedia } from "../../../src/components/ui/EventCoverMedia";

import {
  useCart,
  useCartTotals,
} from "../../../src/components/checkout/CartContext";
import { CheckoutHeader } from "../../../src/components/checkout/CheckoutHeader";
import { QuantityRow } from "../../../src/components/checkout/QuantityRow";
import { JoinWaitlistSheet } from "../../../src/components/waitlist/JoinWaitlistSheet";
// ORCH-0850 [End-not-start parity systemic]: route the past gate through the
// canonical helper. Pre-0850 local `computeIsPast` used `new Date(event.date)
// + 24h < Date.now()` which fired at 8pm EDT on the start day for any
// US-Eastern event — blocking ticket purchases on still-live events (S0).
import { isEventPast } from "../../../src/utils/eventLifecycle";
import { computeMasterEndAtUtc } from "../../../src/utils/eventDateMath";

const sortByDisplayOrder = (a: TicketStub, b: TicketStub): number =>
  a.displayOrder - b.displayOrder;

// Cycle 12 I-30 — door-only tiers excluded from online checkout. SUBTRACT
// before adding pattern: this filter MUST stay in place forever; door-only
// tiers exist for J-D3 (operator door sale flow) only.
const isVisibleForBuyer = (t: TicketStub): boolean =>
  t.visibility !== "hidden" && t.availableAt !== "door";

const ticketSalesEnded = (ticket: TicketStub): boolean => {
  if (ticket.saleEndAt === null) return false;
  const end = new Date(ticket.saleEndAt).getTime();
  return Number.isFinite(end) && end <= Date.now();
};

export default function CheckoutTicketsScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ eventId: string }>();
  const eventId = typeof params.eventId === "string" ? params.eventId : null;

  const publicEventQuery = usePublicEventById(eventId);
  const event = publicEventQuery.data?.event ?? null;
  const brand = publicEventQuery.data?.brand ?? null;

  const { lines, setLineQuantity } = useCart();
  const totals = useCartTotals();
  const [waitlistTicketId, setWaitlistTicketId] = useState<string | null>(null);

  // ORCH-1147R2 — the selection bottom bar leads with the server fee-grossed
  // all-in (totals.allInTotal), NOT the bare base subtotal (totals.total), so
  // the lead number matches the public page. The combined "Fees & tax" line
  // renders only on a real pass-fee delta (never split service-fee + VAT;
  // feedback_cart_combined_fees_tax_line). I-PROPOSED-1147R2-SELECTION-SHOWS-ALLIN.
  // ORCH-1152 — guard the empty cart: on mount the cart is empty and
  // useCartTotals() returns currency "", which crashed formatCurrency
  // (RangeError: Currency is invalid). headlineAllIn is only DISPLAYED when
  // !isEmpty, so compute it only then. (formatCurrency itself is also hardened
  // against blank codes — defense in depth.)
  const headlineAllIn = totals.isEmpty
    ? ""
    : formatCurrency(totals.allInTotal, totals.currency);
  const showFeesTaxLine =
    !totals.isEmpty && !totals.isFree && totals.hasFeesTaxDelta;

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (event !== null) {
      router.replace(
        eventPublicPath({
          brandSlug: event.brandSlug,
          eventSlug: event.eventSlug,
        }) as never,
      );
      return;
    }
    router.replace("/(tabs)/home" as never);
  }, [router, event]);

  const handleContinue = useCallback((): void => {
    if (eventId === null || totals.isEmpty) return;
    router.push(`/checkout/${eventId}/buyer` as never);
  }, [router, eventId, totals.isEmpty]);

  // ----- Event-not-found / past / cancelled empty state -----
  if (publicEventQuery.isLoading || publicEventQuery.isFetching) {
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={0}
          totalSteps={3}
          title="Get tickets"
          onBack={handleBack}
        />
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Loading tickets...</Text>
        </View>
      </View>
    );
  }

  if (publicEventQuery.isError) {
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={0}
          totalSteps={3}
          title="Get tickets"
          onBack={handleBack}
        />
        <View style={styles.emptyWrap}>
          <EmptyState
            illustration="ticket"
            title="Tickets could not load"
            description="Refresh this page or try the event link again."
            cta={{ label: "Back", onPress: handleBack }}
          />
        </View>
      </View>
    );
  }

  if (event === null) {
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={0}
          totalSteps={3}
          title="Get tickets"
          onBack={handleBack}
        />
        <View style={styles.emptyWrap}>
          <EmptyState
            illustration="ticket"
            title="Event not found"
            description="This link may be expired or moved."
            cta={{ label: "Back", onPress: handleBack }}
          />
        </View>
      </View>
    );
  }

  const visibleTickets = event.tickets
    .filter(isVisibleForBuyer)
    .slice()
    .sort(sortByDisplayOrder);

  const isPast = isEventPast(event, computeMasterEndAtUtc(event));
  const allSoldOut =
    visibleTickets.length > 0 &&
    visibleTickets.every((t) => !t.isUnlimited && (t.capacity ?? 0) <= 0);
  const hasWaitlistSoldOut = visibleTickets.some(
    (t) => !t.isUnlimited && (t.capacity ?? 0) <= 0 && t.waitlistEnabled,
  );
  const allUnavailable =
    visibleTickets.length > 0 &&
    visibleTickets.every(
      (t) =>
        t.visibility === "disabled" ||
        ticketSalesEnded(t) ||
        (!t.isUnlimited && (t.capacity ?? 0) <= 0),
    );
  const waitlistTicket =
    visibleTickets.find((ticket) => ticket.id === waitlistTicketId) ?? null;

  if (
    isPast ||
    visibleTickets.length === 0 ||
    (allSoldOut && !hasWaitlistSoldOut) ||
    (allUnavailable && !hasWaitlistSoldOut)
  ) {
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={0}
          totalSteps={3}
          title="Get tickets"
          onBack={handleBack}
        />
        <View style={styles.emptyWrap}>
          <EmptyState
            illustration="ticket"
            title={
              isPast || allUnavailable
                ? "This event isn't taking new tickets"
                : "Sold out"
            }
            description={
              isPast || allUnavailable
                ? "Sales are closed for this event."
                : "All tickets for this event are gone."
            }
            cta={{ label: "Back to event", onPress: handleBack }}
          />
        </View>
      </View>
    );
  }

  const continueLabel = totals.isFree ? "Reserve free ticket" : "Continue";

  return (
    <View style={styles.host}>
      <CheckoutHeader
        stepIndex={0}
        totalSteps={3}
        title="Get tickets"
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
        {/* Event mini-card: cover hue band + name + date line */}
        <View style={styles.miniCard}>
          <EventCoverMedia
            hue={event.coverHue}
            mediaUrl={event.coverMediaUrl}
            mediaType={event.coverMediaType}
            radius={0}
            label=""
            style={styles.miniCover}
          />
          <Text style={styles.miniTitle} numberOfLines={2}>
            {event.name.trim().length > 0 ? event.name : "Untitled event"}
          </Text>
          <Text style={styles.miniSubtitle} numberOfLines={1}>
            {brand?.displayName ?? "Mingla"}
            {" · "}
            {formatDraftDateLine(event)}
          </Text>
        </View>

        <Text style={styles.sectionLabel}>Select your tickets</Text>

        {visibleTickets.map((ticket) => {
          const line = lines.find((l) => l.ticketTypeId === ticket.id);
          const qty = line?.quantity ?? 0;
          return (
            <QuantityRow
              key={ticket.id}
              ticket={ticket}
              quantity={qty}
              onJoinWaitlist={setWaitlistTicketId}
              onQuantityChange={(next): void =>
                setLineQuantity({
                  ticketTypeId: ticket.id,
                  ticketName: ticket.name,
                  unitPrice: ticket.priceGbp ?? 0,
                  // ORCH-1147 — seed the server fee-grossed all-in
                  // (priceAllInGbp, from pg_public_event_tier_allin) as the
                  // headline-Total basis; fall back to base when the tier has
                  // no all-in (free / RPC miss — never fabricate).
                  unitPriceAllIn:
                    ticket.priceAllInGbp ?? ticket.priceGbp ?? 0,
                  currency: ticket.currency ?? event.currency ?? "GBP",
                  isFree: ticket.isFree,
                  quantity: next,
                })
              }
            />
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
        {showFeesTaxLine ? (
          <View style={styles.feesTaxRow}>
            <Text style={styles.feesTaxLabel}>Fees &amp; tax</Text>
            <Text style={styles.feesTaxValue}>
              {formatCurrency(totals.feesTaxCents, totals.currency, true)}
            </Text>
          </View>
        ) : null}
        <View style={styles.subtotalRow}>
          <Text style={styles.subtotalLabel}>Total</Text>
          <Text style={styles.subtotalValue}>
            {totals.isEmpty
              ? "—"
              : totals.isFree
                ? "Free"
                : headlineAllIn}
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
              ? "Add tickets above"
              : totals.isFree
                ? "Reserve free ticket"
                : `Continue to buyer details, total ${headlineAllIn}`
          }
        />
      </View>

      <JoinWaitlistSheet
        visible={waitlistTicket !== null}
        eventId={event.id}
        ticket={waitlistTicket}
        onClose={() => setWaitlistTicketId(null)}
      />
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
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: textTokens.tertiary,
    letterSpacing: 1.4,
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
  // ORCH-1147R2 — quiet combined "Fees & tax" line above the prominent Total.
  feesTaxRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: spacing.xs,
  },
  feesTaxLabel: {
    fontSize: 12,
    color: textTokens.tertiary,
    fontWeight: "500",
  },
  feesTaxValue: {
    fontSize: 13,
    color: textTokens.tertiary,
    fontWeight: "600",
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
