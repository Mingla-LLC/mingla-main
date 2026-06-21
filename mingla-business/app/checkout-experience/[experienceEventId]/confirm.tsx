/**
 * Experience confirmation screen. META-ORCH-1059 Sub-D — mirror of
 * `app/checkout-trip/[tripEventId]/confirm.tsx` for experiences.
 *
 * Route: /checkout-experience/{experienceEventId}/confirm
 *
 * Reached via paid /payment success (native + web), or free /buyer reserve.
 * Native back is BLOCKED — buyer uses the explicit "Back to experience" CTA.
 *
 * Inherits the ORCH-0852 web sync-confirm + Realtime fallback verbatim. The
 * `confirmTicketCheckout` service + Realtime subscription are event_type-
 * agnostic (COMMS-0014/0016 — shared money path).
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
import { usePublicExperienceById } from "../../../src/hooks/usePublicExperience";
import { formatCurrency } from "../../../src/utils/currency";
import { formatExperienceDateSubline } from "../../../src/utils/experienceDateSubline";

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
// META-ORCH-1187 LEG 2 — buyer-web conversion capture (web-only; native no-op).
import { captureWeb, gaEvent } from "../../../src/analytics/webAnalytics";
import { phMaskProps } from "../../../src/analytics/phMask";

export default function CheckoutExperienceConfirmScreen(): React.ReactElement | null {
  const [isClient, setIsClient] = useState<boolean>(false);
  useEffect(() => {
    const id = setTimeout(() => setIsClient(true), 0);
    return (): void => {
      clearTimeout(id);
    };
  }, []);

  const clientReady = Platform.OS !== "web" || isClient;
  if (!clientReady) return null;
  return <CheckoutExperienceConfirmScreenInner isClient={clientReady} />;
}

function CheckoutExperienceConfirmScreenInner({
  isClient,
}: {
  isClient: boolean;
}): React.ReactElement | null {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ experienceEventId: string }>();
  const experienceEventId =
    typeof params.experienceEventId === "string"
      ? params.experienceEventId
      : null;

  const query = usePublicExperienceById(experienceEventId);
  const experience = query.data?.experience ?? null;
  const { lines, buyer, result, recordResult, setLineQuantity, setBuyer } =
    useCart();

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
    if (!isClient) return;
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

  // ----- ORCH-0852 web sync-confirm + Realtime fallback -----
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (!isClient) return;
    if (experienceEventId === null) return;
    if (result !== null) return;
    const win = globalThis as unknown as {
      sessionStorage?: Storage;
      location?: { search?: string };
    };
    const search = win.location?.search ?? "";
    if (!/[?&]cs=/.test(search)) return;
    let payload = readCheckoutResumePayload(
      win.sessionStorage,
      experienceEventId,
    );
    if (payload === null) {
      const sp = new URLSearchParams(search);
      const csi = sp.get("csi");
      const bst = sp.get("bst");
      if (csi !== null && csi.length > 0 && bst !== null && bst.length > 0) {
        payload = {
          checkoutSessionId: csi,
          buyerStatusToken: bst,
          lines: [],
          buyer: { name: "", email: "", phone: "", marketingOptIn: false },
        };
      }
    }
    if (payload === null) return;

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
          // META-ORCH-1187 — purchase conversion (SC-6). value in major units.
          postHogService.capture("purchase_completed", {
            event_id: experienceEventId,
            order_id: confirmResult.order.orderId,
            value: confirmResult.order.totalCents / 100,
            currency: confirmResult.order.currency,
            offering_type: "experience",
            surface: "business_app",
          });
          clearCheckoutResumePayload(win.sessionStorage, experienceEventId);
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
          "[checkout-experience-confirm] sync confirm failed, falling back to realtime",
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
  }, [experienceEventId, result, isClient]);

  // ----- Realtime safety net -----
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
      if (Platform.OS === "web" && experienceEventId !== null) {
        const win = globalThis as unknown as { sessionStorage?: Storage };
        clearCheckoutResumePayload(win.sessionStorage, experienceEventId);
      }
      setRealtimePending(false);
      setPendingSession(null);
    },
  });

  // ----- META-ORCH-1187 LEG 2 — web purchase conversion (experience) -----
  const purchaseFiredFor = useRef<string | null>(null);
  useEffect(() => {
    if (result === null) return;
    if (purchaseFiredFor.current === result.orderId) return;
    purchaseFiredFor.current = result.orderId;
    captureWeb("web_purchase_completed", {
      order_id: result.orderId,
      total: result.total,
      currency: result.currency,
      ticket_count: result.tickets.length,
      offering_type: "experience",
    });
    gaEvent("purchase", {
      transaction_id: result.orderId,
      value: result.total,
      currency: result.currency,
      items: result.tickets.length,
    });
  }, [result]);

  // ----- Defensive bounce -----
  useEffect(() => {
    if (experienceEventId === null) return;
    if (result !== null) return;
    if (Platform.OS === "web") {
      if (!isClient) return;
      const win = globalThis as unknown as {
        location?: { search?: string };
        sessionStorage?: Storage;
      };
      const search = win.location?.search ?? "";
      const hasQueryRecovery =
        /[?&]csi=[^&]+/.test(search) && /[?&]bst=[^&]+/.test(search);
      if (
        /[?&]cs=/.test(search) &&
        (readCheckoutResumePayload(win.sessionStorage, experienceEventId) !==
          null ||
          hasQueryRecovery)
      ) {
        return;
      }
      if (realtimePending) return;
    }
    router.replace(`/checkout-experience/${experienceEventId}` as never);
  }, [result, experienceEventId, router, realtimePending, isClient]);

  // ----- Handlers -----
  const handleBackToExperience = useCallback((): void => {
    exitingViaCtaRef.current = true;
    if (experience !== null) {
      router.replace(
        `/exp/${experience.brandSlug}/${experience.slug}` as never,
      );
      return;
    }
    router.replace("/(tabs)/home" as never);
  }, [router, experience]);

  // ----- Memos -----
  const carouselTickets = useMemo(() => {
    if (result === null) return [];
    return result.tickets.map((ticket) => ({
      ticketId: ticket.ticketId,
      ticketName: ticket.ticketName,
      qrPayload: ticket.qrPayload,
      qrImageDataUrl: ticket.qrImageDataUrl,
    }));
  }, [result]);

  const totalTickets = carouselTickets.length;

  if (result === null) {
    if (Platform.OS === "web") {
      const win = globalThis as unknown as { location?: { search?: string } };
      const hasCs = isClient && /[?&]cs=/.test(win.location?.search ?? "");
      if (hasCs) {
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

  const dateSubline =
    experience !== null
      ? formatExperienceDateSubline({
          venueText: experience.venueText,
          dateStartIsos: experience.dates.map((d) => d.startAt),
          whenMode: experience.whenMode,
          recurrenceRule: experience.recurrenceRule,
        })
      : "";

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
          {/* META-ORCH-1187 §4.H — mask buyer PII in session replay. */}
          <Text style={styles.heroEmail} numberOfLines={2} {...phMaskProps()}>
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
              {experience !== null && experience.title.trim().length > 0
                ? experience.title
                : "Your experience"}
            </Text>
            {dateSubline.length > 0 ? (
              <Text style={styles.summaryEventSubline} numberOfLines={1}>
                {dateSubline}
              </Text>
            ) : null}
          </View>
          <View style={styles.summaryDivider} />
          {lines.map((l) => (
            <View key={l.ticketTypeId} style={styles.summaryLine}>
              <Text style={styles.summaryQty}>{l.quantity}×</Text>
              <Text style={styles.summaryName} numberOfLines={1}>
                {l.ticketName}
              </Text>
              <Text style={styles.summaryTotal}>
                {l.isFree
                  ? "Free"
                  : formatCurrency(l.unitPrice * l.quantity, l.currency)}
              </Text>
            </View>
          ))}
          <View style={styles.summaryDivider} />
          {typeof result.tax === "number" && result.tax > 0 ? (
            <View style={styles.summaryTotalRow}>
              <Text style={styles.summaryTotalLabel}>Fees &amp; tax</Text>
              <Text style={styles.summaryTotalValue}>
                {formatCurrency(result.tax, result.currency)}
              </Text>
            </View>
          ) : null}
          <View style={styles.summaryTotalRow}>
            <Text style={styles.summaryTotalLabel}>Total</Text>
            <Text style={styles.summaryTotalValue}>
              {result.total === 0
                ? "Free"
                : formatCurrency(result.total, result.currency)}
            </Text>
          </View>
          <Text
            style={styles.orderId}
            accessibilityLabel={`Order ${result.orderId}`}
          >
            Order {result.orderId}
          </Text>
        </GlassCard>

        {/* QR carousel mounts after hydration. */}
        <GlassCard
          variant="base"
          radius="lg"
          padding={spacing.md}
          style={styles.qrCard}
        >
          {isClient && totalTickets > 0 ? (
            <TicketQrCarousel
              orderId={result.orderId}
              tickets={carouselTickets}
            />
          ) : null}
        </GlassCard>
      </ScrollView>

      {/* Sticky bottom CTA */}
      <View
        style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing.md }]}
      >
        <Button
          label="Back to experience"
          onPress={handleBackToExperience}
          variant="primary"
          size="lg"
          fullWidth
          accessibilityLabel="Back to experience page"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: "#0c0e12" },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg },
  hero: { alignItems: "center", marginBottom: spacing.xl, gap: spacing.sm },
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
  summaryTotal: { fontSize: 14, color: textTokens.primary, fontWeight: "600" },
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
  qrCard: { marginBottom: spacing.md },
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
