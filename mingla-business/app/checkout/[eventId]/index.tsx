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
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../../src/constants/designSystem";
import { useLiveEventStore } from "../../../src/store/liveEventStore";
import type { LiveEvent } from "../../../src/store/liveEventStore";
import type { TicketStub } from "../../../src/store/draftEventStore";
import { useBrandList } from "../../../src/store/currentBrandStore";
import { formatGbp } from "../../../src/utils/currency";
import { formatDraftDateLine } from "../../../src/utils/eventDateDisplay";

import { Button } from "../../../src/components/ui/Button";
import { EmptyState } from "../../../src/components/ui/EmptyState";

import {
  useCart,
  useCartTotals,
} from "../../../src/components/checkout/CartContext";
import { CheckoutHeader } from "../../../src/components/checkout/CheckoutHeader";
import { QuantityRow } from "../../../src/components/checkout/QuantityRow";

const sortByDisplayOrder = (a: TicketStub, b: TicketStub): number =>
  a.displayOrder - b.displayOrder;

// Cycle 12 I-30 — door-only tiers excluded from online checkout. SUBTRACT
// before adding pattern: this filter MUST stay in place forever; door-only
// tiers exist for J-D3 (operator door sale flow) only.
const isVisibleForBuyer = (t: TicketStub): boolean =>
  t.visibility !== "hidden" && t.availableAt !== "door";

const computeIsPast = (event: LiveEvent): boolean => {
  if (event.status === "cancelled") return true;
  if (event.endedAt !== null) return true;
  if (event.date === null) return false;
  const dateMs = new Date(event.date).getTime();
  if (!Number.isFinite(dateMs)) return false;
  // Treat "past" as 24h after start — matches PublicEventPage's variant logic.
  return dateMs + 24 * 60 * 60 * 1000 < Date.now();
};

export default function CheckoutTicketsScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ eventId: string }>();
  const eventId = typeof params.eventId === "string" ? params.eventId : null;

  const event = useLiveEventStore((s) =>
    eventId === null ? null : s.events.find((e) => e.id === eventId) ?? null,
  );
  const userBrands = useBrandList();
  const brand = useMemo(
    () =>
      event === null
        ? null
        : userBrands.find((b) => b.id === event.brandId) ?? null,
    [event, userBrands],
  );

  const { lines, setLineQuantity } = useCart();
  const totals = useCartTotals();

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (event !== null) {
      router.replace(
        `/e/${event.brandSlug}/${event.eventSlug}` as never,
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

  const isPast = computeIsPast(event);
  const allSoldOut =
    visibleTickets.length > 0 &&
    visibleTickets.every(
      (t) => !t.isUnlimited && (t.capacity ?? 0) <= 0,
    );

  if (isPast || visibleTickets.length === 0 || allSoldOut) {
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
            title={isPast ? "This event isn't taking new tickets" : "Sold out"}
            description={
              isPast
                ? "Sales are closed for this event."
                : "All tickets for this event are gone."
            }
            cta={{ label: "Back to event", onPress: handleBack }}
          />
        </View>
      </View>
    );
  }

  const continueLabel = totals.isFree
    ? "Reserve free ticket"
    : "Continue";

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
          <View
            style={[
              styles.miniCover,
              { backgroundColor: `hsl(${event.coverHue}, 60%, 45%)` },
            ]}
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
              onQuantityChange={(next): void =>
                setLineQuantity({
                  ticketTypeId: ticket.id,
                  ticketName: ticket.name,
                  unitPriceGbp: ticket.priceGbp ?? 0,
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
        <View style={styles.subtotalRow}>
          <Text style={styles.subtotalLabel}>Subtotal</Text>
          <Text style={styles.subtotalValue}>
            {totals.isEmpty
              ? "—"
              : totals.isFree
                ? "Free"
                : formatGbp(totals.totalGbp)}
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
                : `Continue to buyer details, total ${formatGbp(totals.totalGbp)}`
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
