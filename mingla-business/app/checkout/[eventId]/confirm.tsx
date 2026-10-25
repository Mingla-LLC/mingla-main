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
 * Email/SMS send is queued by the checkout backend after tickets exist.
 *
 * Wallet pass buttons removed per ORCH-0852 — future ORCH-XXXX
 * [Wallet pass issuance] will reintroduce when .pkpass + Google Wallet
 * JWT infrastructure ships.
 *
 * Per Cycle 8 spec §4.10.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
// META-ORCH-1187 [Growth Analytics Hub] — purchase conversion (native; no-op on
// web — buyer-web capture is a separate leg).
import { postHogService } from "../../../src/services/postHogService";

import {
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
} from "../../../src/constants/designSystem";
import { BUYER_CLAIM_COPY } from "../../../src/constants/buyerClaimCopy";
import { eventPublicPath } from "../../../src/constants/publicUrls";
import { usePublicEventById } from "../../../src/hooks/usePublicEvents";

import { Icon } from "../../../src/components/ui/Icon";
import { useCart } from "../../../src/components/checkout/CartContext";
import { BuyerCheckoutReceipt } from "../../../src/components/checkout/BuyerCheckoutReceipt";
import {
  clearCheckoutResumePayload,
  readCheckoutResumePayload,
} from "../../../src/components/checkout/checkoutPersistence";
import { BuyerClaimCard } from "../../../src/components/checkout/DownloadMinglaCta";
import { LazyYoureInFollowCard as YoureInFollowCard } from "../../../src/components/checkout/LazyYoureInFollowCard";
import {
  TicketConfirmVerdictHero,
  type TicketConfirmEnding,
} from "../../../src/components/checkout/TicketConfirmVerdictHero";
import {
  awaitTicketConfirmation,
  confirmTicketCheckout,
} from "../../../src/services/ticketCheckoutService";
import { mintClaimLinkHandoff } from "../../../src/services/claimLinkService";
import { useOrderRealtimeSubscription } from "../../../src/hooks/useOrderRealtimeSubscription";
// META-ORCH-1187 LEG 2 — buyer-web conversion capture (web-only; native no-op).
import {
  captureWeb,
  fireAdPurchase,
  gaEvent,
  postAttributionConversion,
} from "../../../src/analytics/webAnalytics";
import { PrivacyChoicesLink } from "../../../src/analytics/PrivacyChoicesLink";

export default function CheckoutConfirmScreen(): React.ReactElement | null {
  const [isClient, setIsClient] = useState<boolean>(false);
  useEffect(() => {
    const id = setTimeout(() => setIsClient(true), 0);
    return (): void => {
      clearTimeout(id);
    };
  }, []);

  const clientReady = Platform.OS !== "web" || isClient;
  if (!clientReady) return null;
  return <CheckoutConfirmScreenInner isClient={clientReady} />;
}

function CheckoutConfirmScreenInner({
  isClient,
}: {
  isClient: boolean;
}): React.ReactElement | null {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ eventId: string }>();
  const eventId = typeof params.eventId === "string" ? params.eventId : null;

  const publicEventQuery = usePublicEventById(eventId);
  const event = publicEventQuery.data?.event ?? null;
  const brand = publicEventQuery.data?.brand ?? null;
  const purchaseBrandId = event?.brandId ?? brand?.id ?? null;
  const { lines, buyer, result, recordResult, setLineQuantity, setBuyer } =
    useCart();
  // ORCH-0852: bulletproof web confirmation. On `?cs=…` arrival we call the
  // new `ticket-checkout-confirm` edge function. It synchronously
  // verifies the Stripe PaymentIntent and idempotently finalizes the order,
  // so the buyer's screen does NOT depend on Stripe webhook arrival timing.
  // While the answer is still open (pending, transport failure, 5xx) the
  // confirm is asked again with backoff for up to 60 s, and
  // `useOrderRealtimeSubscription` below listens alongside it — whichever sees
  // the order first finalizes the screen. The calm "Confirming your tickets…"
  // state has no controls. Three endings do: a checkout that ran out of time
  // ("Checkout expired", provably unpaid, safe to retry), a sale the server
  // refused whose payment is unsettled ("Tickets not issued", no retry offered)
  // and a spent budget ("Still confirming your tickets", Realtime listening).
  const [realtimePending, setRealtimePending] = useState<boolean>(false);
  // issue #2198 — a terminal payment outcome from the return leg. Before this,
  // `ticket-checkout-confirm` could not tell a Paystack failure from a slow
  // one, so EVERY non-paid answer became the "Confirming your tickets…"
  // spinner and a guest whose card was declined sat there forever. The server
  // now returns a bounded reason; this renders it through #2188's mapper.
  const [terminalFailure, setTerminalFailure] = useState<string | null>(null);
  // The endings without an order: an expired checkout (nothing charged), a
  // refused sale whose payment is unsettled, or a spent 60 s budget. Decided by
  // `awaitTicketConfirmation` alone; this screen only renders it.
  const [confirmEnding, setConfirmEnding] =
    useState<TicketConfirmEnding | null>(null);
  const [pendingSession, setPendingSession] = useState<{
    checkoutSessionId: string;
    buyerStatusToken: string;
  } | null>(null);
  const exitingViaCtaRef = useRef<boolean>(false);

  // #4063 keeps the established confirmation guard: incidental back gestures
  // cannot strand a paid buyer, while the explicit CTA disarms the guard.
  useEffect(() => {
    const sub = navigation.addListener(
      "beforeRemove" as never,
      ((e: { preventDefault: () => void }) => {
        if (exitingViaCtaRef.current) return;
        e.preventDefault();
      }) as never,
    );
    return (): void => sub();
  }, [navigation]);

  useEffect(() => {
    if (Platform.OS !== "web" || !isClient) return;
    const win = (
      globalThis as unknown as {
        window?: {
          addEventListener?: (
            type: string,
            listener: (e: BeforeUnloadEvent) => void,
          ) => void;
          removeEventListener?: (
            type: string,
            listener: (e: BeforeUnloadEvent) => void,
          ) => void;
          history?: {
            pushState?: (state: unknown, title: string, url?: string) => void;
          };
        };
      }
    ).window;
    if (win === undefined) return;
    win.history?.pushState?.(null, "", "");
    const handler = (): void => {
      if (exitingViaCtaRef.current) return;
      win.history?.pushState?.(null, "", "");
    };
    win.addEventListener?.(
      "popstate",
      handler as unknown as (e: BeforeUnloadEvent) => void,
    );
    return (): void => {
      win.removeEventListener?.(
        "popstate",
        handler as unknown as (e: BeforeUnloadEvent) => void,
      );
    };
  }, [isClient]);

  // ----- ORCH-0852: web Stripe Checkout sync confirm + Realtime fallback -----
  // On web, Stripe's success_url returns us here with ?cs=…, after a
  // full-page reload that wiped cart context. Read the persisted resume
  // payload from sessionStorage, restore lines + buyer (so the summary
  // card and "Sent to {email}" line render with real data), then call
  // `ticket-checkout-confirm` synchronously. That edge function calls
  // Stripe's API directly + invokes the idempotent finalize RPC, so the
  // buyer is NOT dependent on Stripe webhook arrival timing. On success,
  // recordResult fires and the QR carousel mounts. While the answer is still
  // open we set `realtimePending` + `pendingSession` so the Realtime hook below
  // can pick up the order the moment the webhook lands, and keep asking.
  // Storage is cleared only on confirmed success — pending/failed paths
  // leave the entry in place so a refresh can retry.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (!isClient) return;
    if (eventId === null) return;
    if (result !== null) return;
    const win = globalThis as unknown as {
      sessionStorage?: Storage;
      location?: { search?: string };
    };
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
    // Arms the Realtime safety net below. It runs ALONGSIDE the confirm poll
    // (never instead of it), so whichever path sees the order first wins.
    const armRealtime = (): void => {
      setPendingSession({
        checkoutSessionId: payload.checkoutSessionId,
        buyerStatusToken: payload.buyerStatusToken,
      });
      setRealtimePending(true);
    };
    (async (): Promise<void> => {
      // ONE owner decides what each confirm answer means and how long to keep
      // asking (60 s, with backoff). A thrown 409 `checkout_unavailable` is a
      // definitive refusal, not a network blip.
      const verdict = await awaitTicketConfirmation({
        checkoutSessionId: payload.checkoutSessionId,
        buyerStatusToken: payload.buyerStatusToken,
        confirm: confirmTicketCheckout,
        isCancelled: () => cancelled,
        onWaiting: armRealtime,
      });
      if (cancelled || verdict.kind === "cancelled") return;
      if (verdict.kind === "paid") {
        const confirmResult = verdict.result;
        const order = verdict.order;
        // ORCH-0804 — pass Stripe Tax data into the order result so the
        // confirmation can render a tax line. taxAmountCents defaults to 0
        // when missing (free order / brand not registered in buyer
        // jurisdiction).
        const taxCents = Number(order.taxAmountCents ?? 0);
        recordResult({
          orderId: order.orderId,
          ticketIds: order.tickets.map((t) => t.ticketId),
          checkoutSessionId: confirmResult.checkoutSessionId,
          // issue #2323 — carry the possession proof onto the order so
          // `useAttendanceClaimArm` can mint from the RESULT. Reading it back
          // out of sessionStorage here is not an option: the resume payload
          // is cleared a few lines below, before this render commits.
          buyerStatusToken: payload.buyerStatusToken,
          paidAt: new Date().toISOString(),
          paymentMethod: "card",
          total: order.totalCents / 100,
          totalCents: order.totalCents,
          currency: order.currency,
          tax: taxCents > 0 ? taxCents / 100 : 0,
          taxAmountCents: taxCents,
          paymentStatus: order.paymentStatus,
          notificationStatus: order.notificationStatus,
          buyerContact: order.buyerContact,
          receipt: order.receipt,
          claim: order.claim,
          attachedToAccount: order.attachedToAccount,
          boughtForSomeoneElse: order.boughtForSomeoneElse,
          tickets: order.tickets,
        });
        // META-ORCH-1187 — purchase conversion (SC-6). value in major units.
        postHogService.capture("purchase_completed", {
          event_id: eventId,
          order_id: order.orderId,
          value: order.totalCents / 100,
          currency: order.currency,
          offering_type: "event",
          surface: "business_app",
        });
        clearCheckoutResumePayload(win.sessionStorage, eventId);
        return;
      }
      // issue #2198 — a TERMINAL payment outcome (Paystack said failed /
      // abandoned, or the verified amount did not match), already mapped to
      // its #2188 copy by the owner.
      if (verdict.kind === "payment_failed") {
        setRealtimePending(false);
        setTerminalFailure(verdict.message);
        return;
      }
      // No order is coming, so the Realtime wait is released too. The two
      // refusals stay APART all the way to the screen: `expired` proves nothing
      // was charged, `not_issued` proves nothing about the money either way.
      if (verdict.kind === "expired" || verdict.kind === "not_issued") {
        setRealtimePending(false);
        setConfirmEnding(verdict.kind);
        return;
      }
      // Budget spent with no answer either way. Keep Realtime listening: a
      // late order still replaces this state.
      armRealtime();
      setConfirmEnding("still_confirming");
    })();
    return (): void => {
      cancelled = true;
    };
    // only runs when eventId / result first allow it; lines/buyer not in deps
    // because we read them once for the empty-check then restore.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally
  }, [eventId, result, isClient]);

  // ORCH-0852: Realtime safety net. Subscribes to ticket_checkout_sessions
  // UPDATE events filtered to the active session. When session.order_id
  // transitions from NULL to a finalized UUID (via either path: a follow-up
  // sync confirm OR the webhook backup), `onOrderReady` fires and we
  // populate `result` so the screen transitions to the full order view.
  useOrderRealtimeSubscription({
    checkoutSessionId: realtimePending
      ? (pendingSession?.checkoutSessionId ?? null)
      : null,
    buyerStatusToken: realtimePending
      ? (pendingSession?.buyerStatusToken ?? null)
      : null,
    onOrderReady: (order) => {
      const taxCents = Number(order.taxAmountCents ?? 0);
      recordResult({
        orderId: order.orderId,
        ticketIds: order.tickets.map((t) => t.ticketId),
        checkoutSessionId: order.checkoutSessionId,
        // issue #2323 — the realtime webhook-backup leg carries the same
        // possession proof onto the order for `useAttendanceClaimArm`.
        ...(pendingSession !== null
          ? { buyerStatusToken: pendingSession.buyerStatusToken }
          : {}),
        paidAt: new Date().toISOString(),
        paymentMethod: "card",
        total: order.totalCents / 100,
        totalCents: order.totalCents,
        currency: order.currency,
        tax: taxCents > 0 ? taxCents / 100 : 0,
        taxAmountCents: taxCents,
        paymentStatus: order.paymentStatus,
        notificationStatus: order.notificationStatus,
        buyerContact: order.buyerContact,
        receipt: order.receipt,
        claim: order.claim,
        attachedToAccount: order.attachedToAccount,
        boughtForSomeoneElse: order.boughtForSomeoneElse,
        tickets: order.tickets,
      });
      if (Platform.OS === "web" && eventId !== null) {
        const win = globalThis as unknown as { sessionStorage?: Storage };
        clearCheckoutResumePayload(win.sessionStorage, eventId);
      }
      if (pendingSession !== null) {
      }
      setRealtimePending(false);
      setPendingSession(null);
      // A late order outranks "still confirming".
      setConfirmEnding(null);
    },
  });

  // ----- META-ORCH-1187 LEG 2 — web purchase conversion -----
  // Fire once when the order first finalizes (covers BOTH the sync-confirm and
  // the realtime paths, since both populate `result`). Keyed on orderId via a
  // ref so it never double-fires. PostHog `web_purchase_completed` +
  // GA4 `purchase` (value+currency) for the Google Ads conversion link.
  // Web-only: captureWeb/gaEvent are no-ops on native.
  const purchaseFiredFor = useRef<string | null>(null);
  useEffect(() => {
    if (result === null || eventId === null || purchaseBrandId === null) return;
    if (purchaseFiredFor.current === result.orderId) return;
    purchaseFiredFor.current = result.orderId;
    captureWeb("web_purchase_completed", {
      order_id: result.orderId,
      total: result.total,
      currency: result.currency,
      ticket_count: result.tickets.length,
      offering_type: "event",
    });
    gaEvent("purchase", {
      transaction_id: result.orderId,
      value: result.total,
      currency: result.currency,
      items: result.tickets.length,
    });
    // ISSUE-865 WP-C — the DEDUP fire: the browser Purchase pixel + an early
    // attribution-capture conversion record, both keyed on the SHARED event_id
    // (= result.orderId) so the server CAPI (WP-B) dedups the exact pair (SC-15).
    // No-op until consent; NO email/phone leaves the browser; never blocks render.
    fireAdPurchase(result.orderId, {
      value: result.total,
      currency: result.currency,
      contentId: eventId,
      brandId: purchaseBrandId,
    });
    postAttributionConversion({
      eventId: result.orderId,
      valueCents: Math.round(result.total * 100),
      currency: result.currency,
    });
  }, [eventId, purchaseBrandId, result]);

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
      if (!isClient) return;
      const win = globalThis as unknown as {
        location?: { search?: string };
        sessionStorage?: Storage;
      };
      const search = win.location?.search ?? "";
      // ORCH-0928 v2 (2026-05-23) — see parallel patch in
      // checkout-trip/[tripEventId]/confirm.tsx. Query-string recovery
      // (v1 used URL fragment which Expo Router silently reformatted).
      const hasQueryRecovery =
        /[?&]csi=[^&]+/.test(search) && /[?&]bst=[^&]+/.test(search);
      if (
        /[?&]cs=/.test(search) &&
        (readCheckoutResumePayload(win.sessionStorage, eventId) !== null ||
          hasQueryRecovery)
      ) {
        return;
      }
      if (realtimePending) return;
      // issue #2198 — keep the guest on /confirm to read the failure reason
      // instead of bouncing them silently back to the cart.
      if (terminalFailure !== null) return;
      // Same for a refused sale or a spent confirmation budget.
      if (confirmEnding !== null) return;
    }
    router.replace(`/checkout/${eventId}` as never);
  }, [
    result,
    eventId,
    router,
    realtimePending,
    isClient,
    terminalFailure,
    confirmEnding,
  ]);

  // ----- Handlers -----
  const handleBackToEvent = useCallback((): void => {
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

  const claimCode = result?.claim?.code ?? null;
  const claimHandoff = useMemo(
    () =>
      claimCode !== null && claimCode.trim().length > 0
        ? { mint: () => mintClaimLinkHandoff(claimCode) }
        : null,
    [claimCode],
  );

  if (result === null) {
    // issue #2198 — a verified terminal outcome outranks the calm spinner.
    if (terminalFailure !== null) {
      return (
        <View style={styles.host}>
          <View style={[styles.hero, { paddingTop: insets.top + spacing.xl }]}>
            <View style={styles.checkBadge}>
              <Icon name="flag" size={36} color={textTokens.primary} />
            </View>
            <Text style={styles.heroTitle}>Payment not completed</Text>
            <Text style={styles.heroEmail} numberOfLines={6}>
              {terminalFailure}
            </Text>
          </View>
        </View>
      );
    }
    // A refused sale or a spent confirmation budget also outranks the spinner.
    if (confirmEnding !== null) {
      return (
        <TicketConfirmVerdictHero
          ending={confirmEnding}
          topInset={insets.top}
          backLabel="Back to event"
          onBack={handleBackToEvent}
        />
      );
    }
    if (Platform.OS === "web") {
      const win = globalThis as unknown as { location?: { search?: string } };
      const hasCs = isClient && /[?&]cs=/.test(win.location?.search ?? "");
      if (hasCs) {
        // ORCH-0911: render from first paint on ?cs= arrival, independent
        // of event/realtimePending state. ORCH-0852 auto-resolution remains.
        return (
          <View style={styles.host}>
            <View
              style={[styles.hero, { paddingTop: insets.top + spacing.xl }]}
            >
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
            paddingBottom: insets.bottom + spacing.xl,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.checkBadge}>
            <Icon name="check" size={36} color={textTokens.primary} />
          </View>
          <Text style={styles.heroTitle}>{BUYER_CLAIM_COPY.youreIn}</Text>
        </View>

        <BuyerClaimCard
          kind="ticket"
          email={result.buyerContact?.email ?? null}
          phoneLast4={result.buyerContact?.phoneLast4 ?? null}
          shortUrl={result.claim?.shortUrl ?? null}
          handoff={claimHandoff}
          textSent={
            result.buyerContact?.phoneLast4 !== null &&
            result.buyerContact?.phoneLast4 !== undefined &&
            result.notificationStatus !== "failed"
          }
          analyticsSurface="checkout_confirm_event"
          fallbackEntity={{
            entityType: "event",
            brandSlug: event.brandSlug,
            entitySlug: event.eventSlug,
          }}
        />
        <YoureInFollowCard
          brandId={brand?.id ?? null}
          brandName={brand?.displayName ?? "this brand"}
          brandSlug={brand?.slug ?? event.brandSlug ?? null}
        />
        <BuyerCheckoutReceipt
          eventName={
            event.name.trim().length > 0 ? event.name : "Untitled event"
          }
          brandName={brand?.displayName ?? null}
          orderId={result.orderId}
          receipt={result.receipt}
        />
        {/* #2331 — end of content: reopens the privacy bar. */}
        <PrivacyChoicesLink />
      </ScrollView>
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
