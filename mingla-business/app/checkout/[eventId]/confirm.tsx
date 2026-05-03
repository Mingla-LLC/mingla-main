/**
 * J-C5 — Confirmation screen.
 *
 * Route: /checkout/{eventId}/confirm
 *
 * Reached via:
 *   - Paid order → J-C3 Payment success → router.replace
 *   - Paid order → J-C3 → 3DS sheet success → router.replace
 *   - Free order → J-C2 Buyer "Reserve free ticket" → synchronous OrderResult
 *     generation → router.replace (skips Payment + 3DS entirely)
 *
 * Native back is BLOCKED — buyer must use explicit "Back to event" CTA.
 *
 * [TRANSITIONAL] Email send is a no-op in stub mode — wires to Resend in
 * B-cycle.
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
import { useLiveEventStore } from "../../../src/store/liveEventStore";
import {
  useOrderStore,
  type OrderRecord,
} from "../../../src/store/orderStore";
import { formatGbp } from "../../../src/utils/currency";
import { formatDraftDateLine } from "../../../src/utils/eventDateDisplay";
import { expandTicketIds } from "../../../src/utils/expandTicketIds";

import { Button } from "../../../src/components/ui/Button";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { Icon } from "../../../src/components/ui/Icon";
import { Toast } from "../../../src/components/ui/Toast";

import { useCart } from "../../../src/components/checkout/CartContext";
import { TicketQrCarousel } from "../../../src/components/checkout/TicketQrCarousel";

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

  const event = useLiveEventStore((s) =>
    eventId === null ? null : s.events.find((e) => e.id === eventId) ?? null,
  );
  const { lines, buyer, result } = useCart();
  const [walletToast, setWalletToast] = useState<boolean>(false);
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

  // ----- Defensive: result missing → bounce to /checkout/{eventId} -----
  useEffect(() => {
    if (eventId === null) return;
    if (result === null) {
      router.replace(`/checkout/${eventId}` as never);
    }
  }, [result, eventId, router]);

  // ----- Cycle 9c — buyer→founder order persistence (I-18) -----
  // Records the OrderRecord into useOrderStore so the operator's Orders
  // ledger reflects this purchase. Idempotent dedupe by orderId — safe
  // to fire on every mount; recordOrder returns existing if id present.
  useEffect(() => {
    if (eventId === null || result === null || event === null) return;
    const order: OrderRecord = {
      id: result.orderId,
      eventId,
      brandId: event.brandId,
      buyer: {
        name: buyer.name,
        email: buyer.email,
        phone: buyer.phone,
        marketingOptIn: buyer.marketingOptIn,
      },
      lines: lines.map((l) => ({
        ticketTypeId: l.ticketTypeId,
        ticketNameAtPurchase: l.ticketName,
        unitPriceGbpAtPurchase: l.unitPriceGbp,
        isFreeAtPurchase: l.isFree,
        quantity: l.quantity,
        refundedQuantity: 0,
        refundedAmountGbp: 0,
      })),
      totalGbpAtPurchase: result.totalGbp,
      currency: "GBP",
      paymentMethod: result.paymentMethod,
      paidAt: result.paidAt,
      status: "paid",
      refundedAmountGbp: 0,
      refunds: [],
      cancelledAt: null,
      lastSeenEventUpdatedAt: event.updatedAt,
    };
    useOrderStore.getState().recordOrder(order);
  }, [eventId, event, result, lines, buyer]);

  // ----- Handlers -----
  const handleBackToEvent = useCallback((): void => {
    // Disarm the beforeRemove + popstate guards — this is the explicit
    // sanctioned exit. Set ref BEFORE calling replace so the listener
    // sees the flag during the synchronous removal event.
    exitingViaCtaRef.current = true;
    if (event !== null) {
      router.replace(
        `/e/${event.brandSlug}/${event.eventSlug}` as never,
      );
      return;
    }
    router.replace("/(tabs)/home" as never);
  }, [router, event]);

  const handleWalletAdd = useCallback((): void => {
    setWalletToast(true);
  }, []);

  // ----- Memos -----
  // Cycle 11 J-S8 — multi-ticket QR carousel.
  // Build CarouselTicket[] inline from the cart's `lines` so each row
  // gets the operator-frozen ticketName + a deterministic ticketId.
  const carouselTickets = useMemo(() => {
    if (result === null || result.ticketIds.length === 0) return [];
    const orderLines = lines.map((l) => ({
      ticketTypeId: l.ticketTypeId,
      ticketNameAtPurchase: l.ticketName,
      unitPriceGbpAtPurchase: l.unitPriceGbp,
      isFreeAtPurchase: l.isFree,
      quantity: l.quantity,
      refundedQuantity: 0,
      refundedAmountGbp: 0,
    }));
    return expandTicketIds(result.orderId, orderLines).map((t) => ({
      ticketId: t.ticketId,
      ticketName: t.ticketName,
    }));
  }, [result, lines]);

  const totalTickets = carouselTickets.length;

  // Render an empty shell while the defensive useEffect redirects.
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
            Sent to {buyer.email} — check your spam folder if you don&apos;t see
            it in 5 min.
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
                {l.isFree ? "Free" : formatGbp(l.unitPriceGbp * l.quantity)}
              </Text>
            </View>
          ))}
          <View style={styles.summaryDivider} />
          <View style={styles.summaryTotalRow}>
            <Text style={styles.summaryTotalLabel}>Total</Text>
            <Text style={styles.summaryTotalValue}>
              {result.totalGbp === 0 ? "Free" : formatGbp(result.totalGbp)}
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
