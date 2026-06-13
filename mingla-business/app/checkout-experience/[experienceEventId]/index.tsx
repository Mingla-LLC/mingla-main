/**
 * Experience ticket selection screen. META-ORCH-1059 Sub-D — mirror of
 * `app/checkout-trip/[tripEventId]/index.tsx` for experiences.
 *
 * Route: /checkout-experience/{experienceEventId}
 *
 * Buyer arrives from ExperienceCheckoutFlow's "Get my spot" CTA. An
 * experience sells as ONE ticket (the whole itinerary) — there is NO per-stop
 * or multi-tier selection. The single ticket_types row is shown with a
 * QuantityRow (1+); Continue routes to /buyer.
 *
 * Architecture: experiences have their own buyer-checkout chain (event-side
 * /checkout/[eventId] hard-rejects non-event rows by audit-test invariant).
 * The underlying `ticket-checkout-create` edge fn / RPC stays shared — keyed
 * on the experience's events-row id (COMMS-0014/0016).
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — design-intent full-bleed checkout header mirroring /checkout-trip/[tripEventId]/index.tsx; insets.bottom IS applied (bottom dock); the top status-bar overlap with the banner header is the intended buyer aesthetic.

import React, { useCallback } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../../src/constants/designSystem";
import { usePublicExperienceById } from "../../../src/hooks/usePublicExperience";
import { formatCurrency } from "../../../src/utils/currency";
import { formatExperienceDateSubline } from "../../../src/utils/experienceDateSubline";
import type { PublicExperienceTicket } from "../../../src/services/publicExperienceService";
import type {
  TicketAvailableAt,
  TicketStub,
  TicketVisibility,
} from "../../../src/store/draftEventStore";

import { Button } from "../../../src/components/ui/Button";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { EventCoverMedia } from "../../../src/components/ui/EventCoverMedia";

import {
  useCart,
  useCartTotals,
} from "../../../src/components/checkout/CartContext";
import { CheckoutHeader } from "../../../src/components/checkout/CheckoutHeader";
import { QuantityRow } from "../../../src/components/checkout/QuantityRow";

const ticketToStub = (ticket: PublicExperienceTicket): TicketStub => ({
  id: ticket.ticketTypeId,
  name: ticket.name,
  priceGbp: ticket.priceCents > 0 ? ticket.priceCents / 100 : null,
  currency: ticket.currency,
  capacity: ticket.ticketsRemaining ?? ticket.quantityTotal,
  isFree: ticket.priceCents === 0 || ticket.isFree,
  isUnlimited: ticket.isUnlimited,
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

const allDatesPast = (isos: string[], nowMs: number = Date.now()): boolean => {
  const valid = isos
    .map((iso) => new Date(iso).getTime())
    .filter((ms) => Number.isFinite(ms));
  if (valid.length === 0) return false;
  return valid.every((ms) => ms < nowMs);
};

export default function CheckoutExperienceTicketScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ experienceEventId: string }>();
  const experienceEventId =
    typeof params.experienceEventId === "string"
      ? params.experienceEventId
      : null;

  const query = usePublicExperienceById(experienceEventId);
  const experience = query.data?.experience ?? null;
  const brand = query.data?.brand ?? null;

  const { lines, setLineQuantity } = useCart();
  const totals = useCartTotals();

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (experience !== null) {
      router.replace(
        `/exp/${experience.brandSlug}/${experience.slug}` as never,
      );
      return;
    }
    router.replace("/(tabs)/home" as never);
  }, [router, experience]);

  const handleContinue = useCallback((): void => {
    if (experienceEventId === null || totals.isEmpty) return;
    router.push(`/checkout-experience/${experienceEventId}/buyer` as never);
  }, [router, experienceEventId, totals.isEmpty]);

  if (query.isLoading || query.isFetching) {
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={0}
          totalSteps={3}
          title="Get your spot"
          onBack={handleBack}
        />
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Loading experience…</Text>
        </View>
      </View>
    );
  }

  if (query.isError) {
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={0}
          totalSteps={3}
          title="Get your spot"
          onBack={handleBack}
        />
        <View style={styles.emptyWrap}>
          <EmptyState
            illustration="ticket"
            title="Experience couldn't load"
            description="Refresh this page or try the experience link again."
            cta={{ label: "Back", onPress: handleBack }}
          />
        </View>
      </View>
    );
  }

  if (experience === null) {
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={0}
          totalSteps={3}
          title="Get your spot"
          onBack={handleBack}
        />
        <View style={styles.emptyWrap}>
          <EmptyState
            illustration="ticket"
            title="Experience not found"
            description="This experience link may be expired or moved."
            cta={{ label: "Back", onPress: handleBack }}
          />
        </View>
      </View>
    );
  }

  const ticket = experience.ticket;
  const dateIsos = experience.dates.map((d) => d.startAt);
  const isEnded = allDatesPast(dateIsos);
  const isSoldOut =
    ticket !== null &&
    !ticket.isUnlimited &&
    (ticket.ticketsRemaining ?? ticket.quantityTotal ?? 0) <= 0 &&
    (ticket.quantityTotal !== null || ticket.ticketsRemaining !== null);

  if (ticket === null || isEnded || isSoldOut) {
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={0}
          totalSteps={3}
          title="Get your spot"
          onBack={handleBack}
        />
        <View style={styles.emptyWrap}>
          <EmptyState
            illustration="ticket"
            title={
              isEnded
                ? "This experience has ended"
                : ticket === null
                  ? "Not on sale yet"
                  : "Sold out"
            }
            description={
              isEnded
                ? "Bookings are closed for this experience."
                : ticket === null
                  ? "Pricing hasn't been set for this experience."
                  : "Every spot on this experience is gone."
            }
            cta={{ label: "Back to experience", onPress: handleBack }}
          />
        </View>
      </View>
    );
  }

  const stub = ticketToStub(ticket);
  const line = lines.find((l) => l.ticketTypeId === stub.id);
  const qty = line?.quantity ?? 0;
  const continueLabel = totals.isFree ? "Reserve free spot" : "Continue";
  const subline = formatExperienceDateSubline({
    venueText: experience.venueText,
    dateStartIsos: dateIsos,
    whenMode: experience.whenMode,
    recurrenceRule: experience.recurrenceRule,
  });

  return (
    <View style={styles.host}>
      <CheckoutHeader
        stepIndex={0}
        totalSteps={3}
        title="Get your spot"
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
        <View style={styles.miniCard}>
          <EventCoverMedia
            hue={0}
            mediaUrl={experience.coverMediaUrl}
            mediaType={experience.coverMediaType}
            radius={0}
            label=""
            style={styles.miniCover}
          />
          <Text style={styles.miniTitle} numberOfLines={2}>
            {experience.title.trim().length > 0
              ? experience.title
              : "Untitled experience"}
          </Text>
          <Text style={styles.miniSubtitle} numberOfLines={1}>
            {brand?.name ?? "Mingla"}
          </Text>
          {subline.length > 0 ? (
            <Text style={styles.miniSubtitle} numberOfLines={1}>
              {subline}
            </Text>
          ) : null}
        </View>

        <Text style={styles.sectionLabel}>Your spot</Text>

        <QuantityRow
          ticket={stub}
          quantity={qty}
          onQuantityChange={(next): void =>
            setLineQuantity({
              ticketTypeId: stub.id,
              ticketName: stub.name,
              unitPrice: stub.priceGbp ?? 0,
              currency: stub.currency ?? experience.ticket?.currency ?? "USD",
              isFree: stub.isFree,
              quantity: next,
            })
          }
        />
      </ScrollView>

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
              ? "Add your spot above"
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
  host: { flex: 1, backgroundColor: "#0c0e12" },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  miniCard: { marginBottom: spacing.lg },
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
