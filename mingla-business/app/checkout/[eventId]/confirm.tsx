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
 * [TRANSITIONAL] Wallet add is a toast — Apple .pkpass + Google Wallet
 * pass land in B-cycle (requires Apple Developer cert + service account
 * JSON).
 *
 * Per Cycle 8 spec §4.10.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";

import {
  accent,
  glass,
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
import { Toast } from "../../../src/components/ui/Toast";

import { useCart } from "../../../src/components/checkout/CartContext";
import {
  clearCheckoutResumePayload,
  readCheckoutResumePayload,
} from "../../../src/components/checkout/checkoutPersistence";
import { TicketQrCarousel } from "../../../src/components/checkout/TicketQrCarousel";
import { pollTicketCheckoutStatus } from "../../../src/services/ticketCheckoutService";

// Wallet button visibility:
//   - iOS native: Apple Wallet only (Apple's platform)
//   - Android native: Google Wallet only (Google's platform)
//   - Web: BOTH render — buyers may use any browser regardless of OS,
//     and both are stubbed anyway. Real platform-specific gating
//     happens at B-cycle when Apple Developer cert + Google service
//     account JSON arrive.
const isWeb = Platform.OS === "web";
const showAppleWallet = Platform.OS === "ios" || isWeb;
const showGoogleWallet = Platform.OS === "android" || isWeb;

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
  const [walletToast, setWalletToast] = useState<boolean>(false);
  // ORCH-0790: web buyers complete checkout on Stripe's hosted page, which
  // returns them here with ?cs={CHECKOUT_SESSION_ID}. The cart context is
  // empty on this cold reload — we need to resume polling the order status
  // using the {checkoutSessionId, buyerStatusToken} we stashed in
  // sessionStorage before the redirect, then call recordResult so the
  // existing render path takes over.
  const [webResumeError, setWebResumeError] = useState<string | null>(null);
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

  // ----- ORCH-0790 + REWORK: web Stripe Checkout resume -----
  // On web, Stripe's success_url returns us here with ?cs=…, after a
  // full-page reload that wiped cart context. Read the persisted resume
  // payload from sessionStorage, restore lines + buyer (so the summary
  // card and "Sent to {email}" line render with real data), then poll
  // the order status and recordResult so the QR carousel mounts. Storage
  // is cleared only on confirmed success — failed polls leave the entry
  // in place so a refresh can retry.
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
    const payload = readCheckoutResumePayload(win.sessionStorage, eventId);
    if (payload === null) return;

    // Restore cart context BEFORE the poll so the summary + hero render
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
        const status = await pollTicketCheckoutStatus(
          payload.checkoutSessionId,
          payload.buyerStatusToken,
        );
        if (cancelled) return;
        if (status === null || status.order === null) {
          setWebResumeError(
            "Your payment is being finalised — tickets will arrive by email shortly.",
          );
          return;
        }
        recordResult({
          orderId: status.order.orderId,
          ticketIds: status.order.tickets.map((t) => t.ticketId),
          checkoutSessionId: status.checkoutSessionId,
          paidAt: new Date().toISOString(),
          paymentMethod: "card",
          total: status.order.totalCents / 100,
          totalCents: status.order.totalCents,
          currency: status.order.currency,
          paymentStatus: status.order.paymentStatus,
          notificationStatus: status.order.notificationStatus,
          tickets: status.order.tickets,
        });
        clearCheckoutResumePayload(win.sessionStorage, eventId);
      } catch (err) {
        if (cancelled) return;
        console.warn("[checkout-confirm] web resume failed", err);
        setWebResumeError(
          "Your payment is being finalised — tickets will arrive by email shortly.",
        );
      }
    })();
    return (): void => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally
    // only runs when eventId / result first allow it; lines/buyer not in deps
    // because we read them once for the empty-check then restore.
  }, [eventId, result]);

  // ----- Defensive: result missing → bounce to /checkout/{eventId} -----
  // Skip the bounce on web while a resume is in flight (?cs= present and
  // storage has a payload), so the Stripe success redirect doesn't get
  // kicked back to the cart screen before pollTicketCheckoutStatus
  // completes or the resume-error fallback renders.
  useEffect(() => {
    if (eventId === null) return;
    if (result !== null) return;
    if (Platform.OS === "web") {
      const win = (globalThis as unknown as {
        location?: { search?: string };
        sessionStorage?: Storage;
      });
      const search = win.location?.search ?? "";
      if (
        /[?&]cs=/.test(search) &&
        readCheckoutResumePayload(win.sessionStorage, eventId) !== null
      ) {
        return;
      }
      if (webResumeError !== null) return;
    }
    router.replace(`/checkout/${eventId}` as never);
  }, [result, eventId, router, webResumeError]);

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

  const handleWalletAdd = useCallback((): void => {
    setWalletToast(true);
  }, []);

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

  // ORCH-0790: web cold-start resume hasn't finished AND surfaced an error
  // (typical when the webhook is slow). Render a friendly fallback so the
  // buyer knows their payment succeeded even though tickets aren't loaded.
  if (
    Platform.OS === "web" &&
    result === null &&
    webResumeError !== null &&
    event !== null
  ) {
    return (
      <View style={styles.host}>
        <View style={[styles.hero, { paddingTop: insets.top + spacing.xl }]}>
          <View style={styles.checkBadge}>
            <Icon name="check" size={36} color={textTokens.primary} />
          </View>
          <Text style={styles.heroTitle}>Payment received</Text>
          <Text style={styles.heroEmail} numberOfLines={4}>
            {webResumeError}
          </Text>
        </View>
      </View>
    );
  }

  // Render an empty shell while the defensive useEffect redirects (or the
  // web resume is still polling).
  if (event === null || result === null) {
    return <View style={styles.host} />;
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
          {totalTickets > 0 ? (
            <TicketQrCarousel
              orderId={result.orderId}
              tickets={carouselTickets}
            />
          ) : null}
        </GlassCard>

        {/* Wallet row */}
        {showAppleWallet || showGoogleWallet ? (
          <View style={styles.walletRow}>
            {showAppleWallet ? (
              <Pressable
                onPress={handleWalletAdd}
                accessibilityRole="button"
                accessibilityLabel="Add to Apple Wallet"
                style={({ pressed }) => [
                  styles.walletBtn,
                  pressed && styles.walletBtnPressed,
                ]}
              >
                <Icon name="apple" size={18} color={textTokens.primary} />
                <Text style={styles.walletBtnLabel}>Add to Apple Wallet</Text>
              </Pressable>
            ) : null}
            {showGoogleWallet ? (
              <Pressable
                onPress={handleWalletAdd}
                accessibilityRole="button"
                accessibilityLabel="Add to Google Wallet"
                style={({ pressed }) => [
                  styles.walletBtn,
                  pressed && styles.walletBtnPressed,
                ]}
              >
                <Icon name="google" size={18} color={textTokens.primary} />
                <Text style={styles.walletBtnLabel}>Add to Google Wallet</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
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

      {/* Wallet toast — top-anchored absolute wrapper (Cycle 8a lesson) */}
      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={walletToast}
          kind="info"
          message="Coming soon — saved to your account."
          onDismiss={() => setWalletToast(false)}
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
  walletRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  walletBtn: {
    flex: 1,
    minWidth: 140,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  walletBtnPressed: {
    opacity: 0.7,
  },
  walletBtnLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: textTokens.primary,
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
  toastWrap: {
    position: "absolute",
    top: 60,
    left: 0,
    right: 0,
    zIndex: 100,
    elevation: 12,
  },
});
