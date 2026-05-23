/**
 * Trip confirmation screen. ORCH-0876 [Trip CRUD + Purchase Flow Completion] —
 * mirror of `app/checkout/[eventId]/confirm.tsx` for trips.
 *
 * Route: /checkout-trip/{tripEventId}/confirm
 *
 * Reached via:
 *   - Paid order → /payment success → router.replace
 *   - Paid order → native PaymentSheet success → server status → replace
 *   - Free order → /buyer "Reserve free spot" → server order/ticket creation
 *
 * Native back is BLOCKED — buyer must use explicit "Back to trip" CTA.
 *
 * Inherits ORCH-0852 web sync-confirm + Realtime fallback verbatim from
 * event-side confirm.tsx. The `confirmTicketCheckout` service + Realtime
 * subscription are event_type-agnostic.
 *
 * Tr4 [ORCH-0875 Refund Tiers + Booking Deadline] coordination: this is
 * the surface Tr4 SPEC §3.5.7 will mount its buyer-cancel CTA on after
 * v2 CLOSE per F-16. Phase 2b ships the bare confirmation; Tr4 amendment
 * adds the cancel CTA.
 *
 * Per SPEC_ORCH-0876_V2_FULL_PARITY §8.4 + SC-3.7.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";

import {
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
} from "../../../src/constants/designSystem";
import { tripPublicPath } from "../../../src/constants/publicUrls";
import { usePublicTripById } from "../../../src/hooks/usePublicTripById";
import { formatCurrency } from "../../../src/utils/currency";

import { Button } from "../../../src/components/ui/Button";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { Icon } from "../../../src/components/ui/Icon";
import { useCart } from "../../../src/components/checkout/CartContext";
import {
  clearCheckoutResumePayload,
  readCheckoutResumePayload,
} from "../../../src/components/checkout/checkoutPersistence";
import { TicketQrCarousel } from "../../../src/components/checkout/TicketQrCarousel";
import { confirmTicketCheckout } from "../../../src/services/ticketCheckoutService";
import { useOrderRealtimeSubscription } from "../../../src/hooks/useOrderRealtimeSubscription";

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

export default function CheckoutTripConfirmScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ tripEventId: string }>();
  const tripEventId =
    typeof params.tripEventId === "string" ? params.tripEventId : null;

  const publicTripQuery = usePublicTripById(tripEventId);
  const trip = publicTripQuery.data?.trip ?? null;
  const {
    lines,
    buyer,
    result,
    recordResult,
    setLineQuantity,
    setBuyer,
  } = useCart();

  const [realtimePending, setRealtimePending] = useState<boolean>(false);
  const [pendingSession, setPendingSession] = useState<{
    checkoutSessionId: string;
    buyerStatusToken: string;
  } | null>(null);
  const exitingViaCtaRef = useRef<boolean>(false);

  // ----- Native back guard -----
  useEffect(() => {
    const sub = navigation.addListener(
      "beforeRemove" as never,
      ((e: { preventDefault: () => void }) => {
        if (exitingViaCtaRef.current) return;
        e.preventDefault();
      }) as never,
    );
    return (): void => {
      sub();
    };
  }, [navigation]);

  // ----- Web browser-back guard -----
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const win = (globalThis as unknown as {
      window?: {
        addEventListener?: (
          type: string,
          listener: (e: BeforeUnloadEvent) => void,
        ) => void;
        removeEventListener?: (
          type: string,
          listener: (e: BeforeUnloadEvent) => void,
        ) => void;
        history?: { pushState?: (state: unknown, title: string, url?: string) => void };
      };
    }).window;
    if (win === undefined) return;
    win.history?.pushState?.(null, "", "");
    const handler = (): void => {
      if (exitingViaCtaRef.current) return;
      win.history?.pushState?.(null, "", "");
    };
    win.addEventListener?.("popstate", handler as unknown as (e: BeforeUnloadEvent) => void);
    return (): void => {
      win.removeEventListener?.("popstate", handler as unknown as (e: BeforeUnloadEvent) => void);
    };
  }, []);

  // ----- ORCH-0852 web sync-confirm + Realtime fallback -----
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (tripEventId === null) return;
    if (result !== null) return;
    const win = (globalThis as unknown as {
      sessionStorage?: Storage;
      location?: { search?: string };
    });
    const search = win.location?.search ?? "";
    if (!/[?&]cs=/.test(search)) return;
    let payload = readCheckoutResumePayload(win.sessionStorage, tripEventId);
    // ORCH-0928 v2 (2026-05-23) — when sessionStorage payload is missing
    // (Safari dropped it during cross-origin Stripe redirect, buyer opened
    // URL in different tab, etc.), recover internal checkoutSessionId +
    // buyerStatusToken from the URL query string params `csi` + `bst` that
    // ticket-checkout-create now appends to success_url alongside `cs`.
    // (v1 used URL fragment `#csi=…&bst=…` but Expo Router's web hydration
    // silently reformatted the URL putting `?cs=…` INSIDE the fragment,
    // breaking the `?cs=` regex check above. Query string is robust against
    // that reformatting — verified via Playwright forensic harness
    // 2026-05-23.) Cart context (lines + buyer) cannot be recovered from
    // the URL; we synthesize an empty payload so the confirm flow can
    // proceed — the rendered order summary uses server-returned order rows,
    // not the cart context, so empty lines/buyer here doesn't affect the
    // QR display.
    if (payload === null) {
      const params = new URLSearchParams(search);
      const csi = params.get("csi");
      const bst = params.get("bst");
      if (csi !== null && csi.length > 0 && bst !== null && bst.length > 0) {
        payload = {
          checkoutSessionId: csi,
          buyerStatusToken: bst,
          lines: [],
          buyer: {
            name: "",
            email: "",
            phone: "",
            marketingOptIn: false,
          },
        };
      }
    }
    if (payload === null) return;

    // Restore cart context BEFORE the confirm so the summary + hero render
    // correctly even while the order is still finalising.
    if (lines.length === 0) {
      for (const l of payload.lines) {
        setLineQuantity({
          ticketTypeId: l.ticketTypeId,
          ticketName: l.ticketName,
          unitPrice: l.unitPrice,
          unitPriceGbp: l.unitPriceGbp,
          currency: l.currency,
          isFree: l.isFree,
          quantity: l.quantity,
        });
      }
    }
    if (buyer.email.length === 0 && buyer.phone.length === 0) {
      setBuyer(payload.buyer);
    }

    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const confirmResult = await confirmTicketCheckout(
          payload.checkoutSessionId,
          payload.buyerStatusToken,
        );
        if (cancelled) return;
        if (confirmResult.status === "paid" && confirmResult.order !== null) {
          const taxCents = Number(confirmResult.order.taxAmountCents ?? 0);
          recordResult({
            orderId: confirmResult.order.orderId,
            ticketIds: confirmResult.order.tickets.map((t) => t.ticketId),
            checkoutSessionId: confirmResult.checkoutSessionId,
            paidAt: new Date().toISOString(),
            paymentMethod: "card",
            total: confirmResult.order.totalCents / 100,
            totalCents: confirmResult.order.totalCents,
            currency: confirmResult.order.currency,
            tax: taxCents > 0 ? taxCents / 100 : 0,
            taxAmountCents: taxCents,
            paymentStatus: confirmResult.order.paymentStatus,
            notificationStatus: confirmResult.order.notificationStatus,
            tickets: confirmResult.order.tickets,
          });
          clearCheckoutResumePayload(win.sessionStorage, tripEventId);
          return;
        }
        setPendingSession({
          checkoutSessionId: payload.checkoutSessionId,
          buyerStatusToken: payload.buyerStatusToken,
        });
        setRealtimePending(true);
      } catch (err) {
        if (cancelled) return;
        console.warn(
          "[checkout-trip-confirm] sync confirm failed, falling back to realtime",
          err,
        );
        setPendingSession({
          checkoutSessionId: payload.checkoutSessionId,
          buyerStatusToken: payload.buyerStatusToken,
        });
        setRealtimePending(true);
      }
    })();
    return (): void => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripEventId, result]);

  // ----- Realtime safety net -----
  useOrderRealtimeSubscription({
    checkoutSessionId: realtimePending ? pendingSession?.checkoutSessionId ?? null : null,
    buyerStatusToken: realtimePending ? pendingSession?.buyerStatusToken ?? null : null,
    onOrderReady: (order) => {
      const taxCents = Number(order.taxAmountCents ?? 0);
      recordResult({
        orderId: order.orderId,
        ticketIds: order.tickets.map((t) => t.ticketId),
        checkoutSessionId: order.checkoutSessionId,
        paidAt: new Date().toISOString(),
        paymentMethod: "card",
        total: order.totalCents / 100,
        totalCents: order.totalCents,
        currency: order.currency,
        tax: taxCents > 0 ? taxCents / 100 : 0,
        taxAmountCents: taxCents,
        paymentStatus: order.paymentStatus,
        notificationStatus: order.notificationStatus,
        tickets: order.tickets,
      });
      if (Platform.OS === "web" && tripEventId !== null) {
        const win = (globalThis as unknown as { sessionStorage?: Storage });
        clearCheckoutResumePayload(win.sessionStorage, tripEventId);
      }
      setRealtimePending(false);
      setPendingSession(null);
    },
  });

  // ----- Defensive bounce -----
  useEffect(() => {
    if (tripEventId === null) return;
    if (result !== null) return;
    if (Platform.OS === "web") {
      const win = (globalThis as unknown as {
        location?: { search?: string };
        sessionStorage?: Storage;
      });
      const search = win.location?.search ?? "";
      // ORCH-0928 v2 (2026-05-23) — recognise the query-string recovery
      // path (`?cs=…&csi=…&bst=…`) so the bounce doesn't race ahead of the
      // async confirmTicketCheckout call. v1 read csi+bst from URL fragment
      // (#csi=…&bst=…) which Expo Router silently reformatted (Playwright
      // forensic harness 2026-05-23 confirmed: search became empty, hash
      // captured the full `?cs=…` portion). Query string is robust against
      // the reformatting.
      const hasQueryRecovery = /[?&]csi=[^&]+/.test(search) && /[?&]bst=[^&]+/.test(search);
      if (
        /[?&]cs=/.test(search) &&
        (readCheckoutResumePayload(win.sessionStorage, tripEventId) !== null ||
          hasQueryRecovery)
      ) {
        return;
      }
      if (realtimePending) return;
    }
    router.replace(`/checkout-trip/${tripEventId}` as never);
  }, [result, tripEventId, router, realtimePending]);

  // ----- Handlers -----
  const handleBackToTrip = useCallback((): void => {
    exitingViaCtaRef.current = true;
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

  // ----- Memos -----
  const carouselTickets = useMemo(() => {
    if (result === null) return [];
    return result.tickets.map((ticket) => ({
      ticketId: ticket.ticketId,
      ticketName: ticket.ticketName,
      qrPayload: ticket.qrPayload,
    }));
  }, [result]);

  const totalTickets = carouselTickets.length;

  if (result === null) {
    if (Platform.OS === "web") {
      const win = (globalThis as unknown as { location?: { search?: string } });
      const hasCs = /[?&]cs=/.test(win.location?.search ?? "");
      if (hasCs) {
        // ORCH-0911: render from first paint on ?cs= arrival, independent
        // of trip/realtimePending state. ORCH-0852 auto-resolution remains.
        return (
          <View style={styles.host}>
            <View style={[styles.hero, { paddingTop: insets.top + spacing.xl }]}>
              <View style={styles.checkBadge}>
                <Icon name="check" size={36} color={textTokens.primary} />
              </View>
              <Text style={styles.heroTitle}>Confirming your reservation…</Text>
              <Text style={styles.heroEmail} numberOfLines={3}>
                Payment received. Your tickets will appear here in a moment.
              </Text>
            </View>
          </View>
        );
      }
    }
    return <View style={styles.host} />;
  }

  if (trip === null) {
    return (
      <View style={styles.host}>
        <View style={[styles.hero, { paddingTop: insets.top + spacing.xl }]}>
          <View style={styles.checkBadge}>
            <Icon name="check" size={36} color={textTokens.primary} />
          </View>
          <Text style={styles.heroTitle}>Confirming your reservation…</Text>
          <Text style={styles.heroEmail} numberOfLines={3}>
            Payment received. Your tickets will appear here in a moment.
          </Text>
        </View>
      </View>
    );
  }

  const dateLine = formatTripDateLine(
    trip.businessTrip.startAt,
    trip.businessTrip.endAt,
  );

  return (
    <View style={styles.host}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + spacing.xl,
            paddingBottom: insets.bottom + 120,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero — checkmark + heading + email line */}
        <View style={styles.hero}>
          <View style={styles.checkBadge}>
            <Icon name="check" size={36} color={textTokens.primary} />
          </View>
          <Text style={styles.heroTitle}>You&apos;re in</Text>
          <Text style={styles.heroEmail} numberOfLines={2}>
            Sent to {buyer.email} and {buyer.phone}.
          </Text>
        </View>

        {/* Order summary */}
        <GlassCard
          variant="base"
          radius="lg"
          padding={spacing.md}
          style={styles.summary}
        >
          <View style={styles.summaryHeader}>
            <Text style={styles.summaryEventName} numberOfLines={2}>
              {trip.title.trim().length > 0 ? trip.title : "Untitled trip"}
            </Text>
            <Text style={styles.summaryEventSubline} numberOfLines={1}>
              {dateLine}
              {trip.businessTrip.destinationLocationText !== null
                ? `${dateLine.length > 0 ? " · " : ""}${trip.businessTrip.destinationLocationText}`
                : ""}
            </Text>
          </View>
          <View style={styles.summaryDivider} />
          {lines.map((l) => (
            <View key={l.ticketTypeId} style={styles.summaryLine}>
              <Text style={styles.summaryQty}>{l.quantity}×</Text>
              <Text style={styles.summaryName} numberOfLines={1}>
                {l.ticketName}
              </Text>
              <Text style={styles.summaryTotal}>
                {l.isFree ? "Free" : formatCurrency(l.unitPrice * l.quantity, l.currency)}
              </Text>
            </View>
          ))}
          <View style={styles.summaryDivider} />
          {typeof result.tax === "number" && result.tax > 0 ? (
            <View style={styles.summaryTotalRow}>
              <Text style={styles.summaryTotalLabel}>Tax</Text>
              <Text style={styles.summaryTotalValue}>
                {formatCurrency(result.tax, result.currency)}
              </Text>
            </View>
          ) : null}
          <View style={styles.summaryTotalRow}>
            <Text style={styles.summaryTotalLabel}>Total</Text>
            <Text style={styles.summaryTotalValue}>
              {result.total === 0 ? "Free" : formatCurrency(result.total, result.currency)}
            </Text>
          </View>
          <Text style={styles.orderId} accessibilityLabel={`Order ${result.orderId}`}>
            Order {result.orderId}
          </Text>
        </GlassCard>

        {/* QR carousel */}
        <GlassCard
          variant="base"
          radius="lg"
          padding={spacing.md}
          style={styles.qrCard}
        >
          {totalTickets > 0 ? (
            <TicketQrCarousel
              orderId={result.orderId}
              tickets={carouselTickets}
            />
          ) : null}
        </GlassCard>

        {/* Tr4 [ORCH-0875 Refund Tiers + Booking Deadline] integration point:
            The buyer-cancel CTA mounts here after Tr4 SPEC amendment ships
            (post v2 CLOSE per F-16). Phase 2b leaves this surface bare for
            the integration. */}
      </ScrollView>

      {/* Sticky bottom CTA */}
      <View
        style={[
          styles.bottomBar,
          { paddingBottom: insets.bottom + spacing.md },
        ]}
      >
        <Button
          label="Back to trip"
          onPress={handleBackToTrip}
          variant="primary"
          size="lg"
          fullWidth
          accessibilityLabel="Back to trip page"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: "#0c0e12" },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg },
  hero: {
    alignItems: "center",
    marginBottom: spacing.xl,
    gap: spacing.sm,
  },
  checkBadge: {
    width: 72,
    height: 72,
    borderRadius: radiusTokens.full,
    backgroundColor: semantic.success,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.6,
  },
  heroEmail: {
    fontSize: 14,
    color: textTokens.secondary,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 360,
  },
  summary: { marginBottom: spacing.md },
  summaryHeader: { marginBottom: spacing.sm },
  summaryEventName: {
    fontSize: 17,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.2,
  },
  summaryEventSubline: {
    fontSize: 13,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  summaryLine: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    gap: spacing.sm,
  },
  summaryQty: {
    fontSize: 14,
    color: textTokens.tertiary,
    fontWeight: "500",
    minWidth: 28,
  },
  summaryName: {
    flex: 1,
    fontSize: 14,
    color: textTokens.primary,
    fontWeight: "500",
  },
  summaryTotal: {
    fontSize: 14,
    color: textTokens.primary,
    fontWeight: "600",
  },
  summaryDivider: {
    marginVertical: spacing.sm,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  summaryTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  summaryTotalLabel: {
    fontSize: 13,
    color: textTokens.tertiary,
    fontWeight: "500",
  },
  summaryTotalValue: {
    fontSize: 18,
    color: textTokens.primary,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  orderId: {
    marginTop: spacing.sm,
    fontSize: 11,
    color: textTokens.quaternary,
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      web: "ui-monospace, monospace",
      default: "monospace",
    }),
  },
  qrCard: {
    marginBottom: spacing.md,
    alignItems: "center",
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
});
