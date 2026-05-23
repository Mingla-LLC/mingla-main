/**
 * J-C5 — Confirmation screen.
 *
 * Route: /checkout/{eventId}/confirm
 *
 * Reached via:
 *   - Paid order → J-C3 Payment success → router.replace
 *   - Paid order → J-C3 Stripe PaymentSheet success → server status → replace
 *   - Free order → J-C2 Buyer "Reserve free ticket" → server order/ticket
 *     creation → router.replace
 *
 * Native back is BLOCKED — buyer must use explicit "Back to event" CTA.
 *
 * Email/SMS send is queued by the checkout backend after tickets exist.
 *
 * Wallet pass buttons removed per ORCH-0852 — future ORCH-XXXX
 * [Wallet pass issuance] will reintroduce when .pkpass + Google Wallet
 * JWT infrastructure ships.
 *
 * Per Cycle 8 spec §4.10.
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
  accent,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
} from "../../../src/constants/designSystem";
import { eventPublicPath } from "../../../src/constants/publicUrls";
import { usePublicEventById } from "../../../src/hooks/usePublicEvents";
import { formatCurrency } from "../../../src/utils/currency";
import { formatDraftDateLine } from "../../../src/utils/eventDateDisplay";

import { Button } from "../../../src/components/ui/Button";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { Icon } from "../../../src/components/ui/Icon";
import { useCart } from "../../../src/components/checkout/CartContext";
import {
  clearCheckoutResumePayload,
  readCheckoutResumePayload,
} from "../../../src/components/checkout/checkoutPersistence";
import { TicketQrCarousel } from "../../../src/components/checkout/TicketQrCarousel";
import { DownloadMinglaCta } from "../../../src/components/checkout/DownloadMinglaCta";
import { confirmTicketCheckout } from "../../../src/services/ticketCheckoutService";
import { useOrderRealtimeSubscription } from "../../../src/hooks/useOrderRealtimeSubscription";

export default function CheckoutConfirmScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ eventId: string }>();
  const eventId = typeof params.eventId === "string" ? params.eventId : null;

  const publicEventQuery = usePublicEventById(eventId);
  const event = publicEventQuery.data?.event ?? null;
  const {
    lines,
    buyer,
    result,
    recordResult,
    setLineQuantity,
    setBuyer,
  } = useCart();
  // ORCH-0852: bulletproof web confirmation. On `?cs=…` arrival we call the
  // new `ticket-checkout-confirm` edge function once. It synchronously
  // verifies the Stripe PaymentIntent and idempotently finalizes the order,
  // so the buyer's screen does NOT depend on Stripe webhook arrival timing.
  // If that call returns status: "pending" OR throws, we fall through to
  // `useOrderRealtimeSubscription` below — a Postgres-Realtime push from
  // ticket_checkout_sessions.order_id finalizes the screen as soon as
  // either path (the same sync confirm retried, or the webhook backup)
  // lands the order. There is no retry button, no help link, no dead-end
  // fallback — the user sees a calm "Confirming your tickets…" state for
  // the rare seconds-to-30s window between PaymentSheet success and order
  // finalization, and the screen auto-resolves to the full order view.
  const [realtimePending, setRealtimePending] = useState<boolean>(false);
  const [pendingSession, setPendingSession] = useState<{
    checkoutSessionId: string;
    buyerStatusToken: string;
  } | null>(null);
  // ORCH-0930 v2 (2026-05-23) — parent-level hydration gate for
  // TicketQrCarousel mount. See parallel patch in
  // checkout-trip/[tripEventId]/confirm.tsx for the full rationale.
  const [hydrated, setHydrated] = useState<boolean>(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  // Ref flag — flipped to true when buyer taps "Back to event." The
  // beforeRemove listener checks this and lets the navigation through
  // when set, so the explicit CTA exit isn't blocked by the same guard
  // that blocks swipe-back / hardware back / browser back.
  const exitingViaCtaRef = useRef<boolean>(false);

  // ----- Native back guard -----
  // Block native swipe-back / hardware back / browser back. Buyer must
  // tap explicit "Back to event" — which sets exitingViaCtaRef=true,
  // disarming this listener for that one navigation event.
  useEffect(() => {
    const sub = navigation.addListener(
      "beforeRemove" as never,
      ((e: { preventDefault: () => void }) => {
        if (exitingViaCtaRef.current) {
          // Explicit CTA exit — let the navigation through.
          return;
        }
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
    // Push a history entry so browser-back fires popstate against this
    // screen instead of leaving. On popstate we re-push to stay put —
    // unless the buyer just tapped "Back to event" (CTA disarms via
    // exitingViaCtaRef), in which case we let the popstate through.
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

  // ----- ORCH-0852: web Stripe Checkout sync confirm + Realtime fallback -----
  // On web, Stripe's success_url returns us here with ?cs=…, after a
  // full-page reload that wiped cart context. Read the persisted resume
  // payload from sessionStorage, restore lines + buyer (so the summary
  // card and "Sent to {email}" line render with real data), then call
  // `ticket-checkout-confirm` synchronously. That edge function calls
  // Stripe's API directly + invokes the idempotent finalize RPC, so the
  // buyer is NOT dependent on Stripe webhook arrival timing. On success,
  // recordResult fires and the QR carousel mounts. On `pending` or thrown
  // error, we set `realtimePending` + `pendingSession` and the Realtime
  // hook below picks up the order the moment the webhook lands.
  // Storage is cleared only on confirmed success — pending/failed paths
  // leave the entry in place so a refresh can retry.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (eventId === null) return;
    if (result !== null) return;
    const win = (globalThis as unknown as {
      sessionStorage?: Storage;
      location?: { search?: string };
    });
    const search = win.location?.search ?? "";
    if (!/[?&]cs=/.test(search)) return;
    let payload = readCheckoutResumePayload(win.sessionStorage, eventId);
    // ORCH-0928 v2 (2026-05-23) — query-string recovery (v1 used URL
    // fragment but Expo Router silently reformatted the URL — see
    // parallel patch in checkout-trip/[tripEventId]/confirm.tsx).
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
          // ORCH-0804 — pass Stripe Tax data into the order result so the
          // confirmation can render a tax line. taxAmountCents defaults to 0
          // when missing (free order / brand not registered in buyer
          // jurisdiction).
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
          clearCheckoutResumePayload(win.sessionStorage, eventId);
          return;
        }
        // status === "pending" — Stripe PI still processing OR no PI tied
        // to the session yet. Fall through to Realtime; the webhook backup
        // will populate ticket_checkout_sessions.order_id and the Realtime
        // hook below will materialize the order.
        setPendingSession({
          checkoutSessionId: payload.checkoutSessionId,
          buyerStatusToken: payload.buyerStatusToken,
        });
        setRealtimePending(true);
      } catch (err) {
        if (cancelled) return;
        // Confirm errored (network, 502 stripe_unavailable, etc.). Webhook
        // backup is still in flight — fall through to Realtime so the
        // buyer never sees a dead-end retry screen.
        console.warn(
          "[checkout-confirm] sync confirm failed, falling back to realtime",
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally
    // only runs when eventId / result first allow it; lines/buyer not in deps
    // because we read them once for the empty-check then restore.
  }, [eventId, result]);

  // ORCH-0852: Realtime safety net. Subscribes to ticket_checkout_sessions
  // UPDATE events filtered to the active session. When session.order_id
  // transitions from NULL to a finalized UUID (via either path: a follow-up
  // sync confirm OR the webhook backup), `onOrderReady` fires and we
  // populate `result` so the screen transitions to the full order view.
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
      if (Platform.OS === "web" && eventId !== null) {
        const win = (globalThis as unknown as { sessionStorage?: Storage });
        clearCheckoutResumePayload(win.sessionStorage, eventId);
      }
      setRealtimePending(false);
      setPendingSession(null);
    },
  });

  // ----- Defensive: result missing → bounce to /checkout/{eventId} -----
  // Skip the bounce on web while either (a) the ?cs= resume hasn't run yet,
  // or (b) realtimePending is true (sync confirm returned pending OR
  // errored, Realtime is now waiting for the webhook backup). This keeps
  // the buyer on /confirm instead of bouncing them to the cart screen
  // mid-finalization.
  useEffect(() => {
    if (eventId === null) return;
    if (result !== null) return;
    if (Platform.OS === "web") {
      const win = (globalThis as unknown as {
        location?: { search?: string };
        sessionStorage?: Storage;
      });
      const search = win.location?.search ?? "";
      // ORCH-0928 v2 (2026-05-23) — see parallel patch in
      // checkout-trip/[tripEventId]/confirm.tsx. Query-string recovery
      // (v1 used URL fragment which Expo Router silently reformatted).
      const hasQueryRecovery = /[?&]csi=[^&]+/.test(search) && /[?&]bst=[^&]+/.test(search);
      if (
        /[?&]cs=/.test(search) &&
        (readCheckoutResumePayload(win.sessionStorage, eventId) !== null ||
          hasQueryRecovery)
      ) {
        return;
      }
      if (realtimePending) return;
    }
    router.replace(`/checkout/${eventId}` as never);
  }, [result, eventId, router, realtimePending]);

  // ----- Handlers -----
  const handleBackToEvent = useCallback((): void => {
    // Disarm the beforeRemove + popstate guards — this is the explicit
    // sanctioned exit. Set ref BEFORE calling replace so the listener
    // sees the flag during the synchronous removal event.
    exitingViaCtaRef.current = true;
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

  // ----- Memos -----
  // Production checkout returns server-issued QR payloads. Confirmation renders
  // only those durable tickets so scanner and organizer views share truth.
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
        // of event/realtimePending state. ORCH-0852 auto-resolution remains.
        return (
          <View style={styles.host}>
            <View style={[styles.hero, { paddingTop: insets.top + spacing.xl }]}>
              <View style={styles.checkBadge}>
                <Icon name="check" size={36} color={textTokens.primary} />
              </View>
              <Text style={styles.heroTitle}>Confirming your tickets…</Text>
              <Text style={styles.heroEmail} numberOfLines={3}>
                Payment received. Your tickets will appear here in a moment.
              </Text>
            </View>
          </View>
        );
      }
    }
    // Non-?cs= path: defensive redirect is firing.
    return <View style={styles.host} />;
  }

  if (event === null) {
    return (
      <View style={styles.host}>
        <View style={[styles.hero, { paddingTop: insets.top + spacing.xl }]}>
          <View style={styles.checkBadge}>
            <Icon name="check" size={36} color={textTokens.primary} />
          </View>
          <Text style={styles.heroTitle}>Confirming your tickets…</Text>
          <Text style={styles.heroEmail} numberOfLines={3}>
            Payment received. Your tickets will appear here in a moment.
          </Text>
        </View>
      </View>
    );
  }

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
              {event.name.trim().length > 0 ? event.name : "Untitled event"}
            </Text>
            <Text style={styles.summaryEventSubline} numberOfLines={1}>
              {formatDraftDateLine(event)}
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
          {/* ORCH-0804 — Stripe Tax line. Renders ONLY when tax was
              collected (tax > 0). Zero-tax orders show the total row alone
              per Constitution #9 (no fabricated data — never display a
              "Tax £0.00" row that misleads buyers about jurisdictional
              registration state). */}
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

        {/* QR — Cycle 11 J-S8 multi-ticket carousel. Single-ticket case
            renders one QR with no dots/swipe affordance (visual parity). */}
        <GlassCard
          variant="base"
          radius="lg"
          padding={spacing.md}
          style={styles.qrCard}
        >
          {/* ORCH-0930 v2: hydration-gated mount; see parallel patch in
              checkout-trip/[tripEventId]/confirm.tsx. */}
          {hydrated && totalTickets > 0 ? (
            <TicketQrCarousel
              orderId={result.orderId}
              tickets={carouselTickets}
            />
          ) : null}
        </GlassCard>

        <DownloadMinglaCta
          orderId={result.orderId}
          eventName={event.name.trim().length > 0 ? event.name : "your event"}
          eventType={(event as { event_type?: string }).event_type === "trip" ? "trip" : "event"}
        />

        {/* Wallet pass buttons removed per ORCH-0852 — future ORCH-XXXX
            [Wallet pass issuance] will reintroduce when .pkpass + Google
            Wallet JWT infrastructure ships. */}
      </ScrollView>

      {/* Sticky bottom CTA */}
      <View
        style={[
          styles.bottomBar,
          { paddingBottom: insets.bottom + spacing.md },
        ]}
      >
        <Button
          label="Back to event"
          onPress={handleBackToEvent}
          variant="primary"
          size="lg"
          fullWidth
          accessibilityLabel="Back to event page"
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
  },
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
  summary: {
    marginBottom: spacing.md,
  },
  summaryHeader: {
    marginBottom: spacing.sm,
  },
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
