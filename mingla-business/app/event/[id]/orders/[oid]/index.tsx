/**
 * /event/[id]/orders/[oid] — J-M2 Order detail (Cycle 9c).
 *
 * Founder view of a single order with frozen financials + status banner
 * + lines table + refund ledger (when applicable) + dynamic primary
 * action button:
 *
 *   paymentMethod !== "free" && status === "paid"        → Refund (full + partial)
 *   paymentMethod !== "free" && status === "refunded_partial" → Refund again (partial)
 *   paymentMethod === "free" && status === "paid"        → Cancel order
 *   status === "refunded_full" || "cancelled"            → no primary action
 *
 * Secondary: Resend ticket (when at least one line has remaining qty).
 *
 * Per Cycle 9c spec §3.4.2 + §3.4.4 + §3.4.5.
 */

import { TAP_TO_PAY_SHORT } from "../../../../../src/constants/tapToPayName";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import {
  radius as radiusTokens,
  color,
  space,
} from "../../../../../src/constants/designSystem";
import type {
  OrderStatus,
  RefundRecord,
} from "../../../../../src/store/orderStore";
import type { CheckoutPaymentMethod } from "../../../../../src/components/checkout/CartContext";
import { useManagedEventRoute } from "../../../../../src/hooks/useManagedEventRoute";
import { formatCurrency } from "../../../../../src/utils/currency";
import { deferAfterDismiss } from "../../../../../src/utils/deferAfterDismiss";
import { useEventOrderById } from "../../../../../src/hooks/useEventOrders";
import { useTripEventBalances } from "../../../../../src/hooks/useOrderInstallments";
import { featureFlags } from "../../../../../src/config/featureFlags";
import {
  derivePlanOrderView,
  PLAN_ORDER_OPEN_MONEY_COPY,
  PLAN_ORDER_REFUND_NOTE_COPY,
} from "../../../../../src/utils/planOrderScreen";
import { useBrandPayoutScreen } from "../../../../../src/hooks/useBrandPayoutScreen";
import { PAYOUT_STATE_COPY } from "../../../../../src/utils/payoutScreen";
import { isCompOrder } from "../../../../../src/utils/compOrders";
import { formatBookedStart } from "../../../../../src/utils/bookedStart";
import { useCurrentBrandRole } from "../../../../../src/hooks/useCurrentBrandRole";
import { canPerformAction } from "../../../../../src/utils/permissionGates";
import { canViewBrandPayments } from "../../../../../src/utils/brandPaymentsPermission";

import { Button } from "../../../../../src/components/ui/Button";
import { EmptyState } from "../../../../../src/components/ui/EmptyState";
import { GlassCard } from "../../../../../src/components/ui/GlassCard";
import { Icon } from "../../../../../src/components/ui/Icon";
import { IconChrome } from "../../../../../src/components/ui/IconChrome";
import { Toast } from "../../../../../src/components/ui/Toast";

// ORCH-0787: real refund + cancel sheets (replacing stubbed onPress toasts).
import {
  RefundSheet,
  type RefundSheetRefundTerms,
} from "../../../../../src/components/orders/RefundSheet";
// issue #3284 — the offering's occurrences (same cached read the guest roster
// uses) and the rule for which start an order's refund window counts from.
import { usePublicEventById } from "../../../../../src/hooks/usePublicEvents";
import { resolveOrderRefundStartAt } from "../../../../../src/utils/refundPolicyPrefill";
import { CancelOrderDialog } from "../../../../../src/components/orders/CancelOrderDialog";
// A cash or manual door sale refunds only through the door refund RPC; the
// provider refund-order path is refused for it (door_sale_refund_path_required).
import { deriveActionFlags } from "../../../../../src/utils/orderRefundActions";
import { LazyDoorRefundSheet } from "../../../../../src/components/door/LazyDoorRefundSheet";
import { useEventDoorSales } from "../../../../../src/hooks/useEventDoorSales";
import type { DoorSaleRecord } from "../../../../../src/types/doorSales";

const loadDiscountService = () =>
  import("../../../../../src/services/discountService");

const PAYMENT_METHOD_LABEL: Record<CheckoutPaymentMethod, string> = {
  card: "Card",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  free: "Free",
  // Door methods. issue #4271 — card money taken at the door (Buyer's phone,
  // Tap to Pay) IS an online order and is refunded to the card from here.
  cash: "Cash",
  manual: "Manual",
  card_reader: "Card reader",
  pay_code: "Buyer's phone (door)",
  tap_to_pay: `${TAP_TO_PAY_SHORT} (door)`,
};

const getInitials = (name: string): string => {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

interface StatusBannerSpec {
  bgColor: string;
  borderColor: string;
  iconName: "check" | "refund" | "close";
  iconColor: string;
  copy: string;
}

const statusBannerSpec = (
  status: OrderStatus,
  refundedAmountGbp: number,
  currency: string | null,
): StatusBannerSpec => {
  switch (status) {
    case "paid":
      return {
        bgColor: color.successTint,
        borderColor: color.successText,
        iconName: "check",
        iconColor: color.successText,
        copy:
          currency === null
            ? "Free order · confirmed"
            : "Paid · payout scheduled about a day after payment",
      };
    case "refunded_full":
      return {
        bgColor: color.errorTint,
        borderColor: color.errorLine,
        iconName: "refund",
        iconColor: color.danger,
        copy: `Refunded ${currency === null ? "—" : formatCurrency(refundedAmountGbp, currency)} · buyer will see in 3–5 days`,
      };
    case "refunded_partial":
      return {
        bgColor: color.fill.tabOn,
        borderColor: color.lineStrong,
        iconName: "refund",
        iconColor: color.text1,
        copy: `Partially refunded ${currency === null ? "—" : formatCurrency(refundedAmountGbp, currency)}`,
      };
    case "cancelled":
      return {
        bgColor: color.fill.tile,
        borderColor: color.lineStrong,
        iconName: "close",
        iconColor: color.text3,
        copy: "Cancelled · buyer's ticket is no longer valid",
      };
    default: {
      const _exhaust: never = status;
      return _exhaust;
    }
  }
};

const formatRelativeDay = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

// issue #3827 — the guest-list client loads on first use, so it stays out of
// the business-web boot chunk (__common ceiling, orch-1083).
const loadGuestList = () =>
  import("../../../../../src/services/guestListService");
// #4541 R1.9 — the order's answers load through the one lazy forms owner.
const GuestAnswersCard = React.lazy(() =>
  import("../../../../../src/components/forms/formsOwner").then((m) => ({
    default: m.GuestAnswersCard,
  })),
);
const FALLBACK_COPY =
  "Something went wrong. Nothing was charged. Try again. Guests already added won't be added twice.";
const guestListMessage = (
  error: unknown,
  fallback: string = FALLBACK_COPY,
): string =>
  error instanceof Error && error.name === "GuestListError"
    ? error.message
    : fallback;

const newResendRequestId = (): string => {
  const cryptoLike = (globalThis as { crypto?: { randomUUID?: () => string } })
    .crypto;
  if (cryptoLike?.randomUUID) return cryptoLike.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
};

export default function OrderDetailRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    id: string | string[];
    oid: string | string[];
  }>();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;
  const orderId = Array.isArray(params.oid) ? params.oid[0] : params.oid;

  const orderQuery = useEventOrderById(
    typeof eventId === "string" ? eventId : null,
    typeof orderId === "string" ? orderId : null,
  );
  const order = orderQuery.data ?? null;
  // A cash or manual door sale is read from the door sales list (the same
  // record the door sale screen refunds), and only when the order is one.
  const isDoorSaleOrder = order?.source === "door_sale";
  const doorSalesQuery = useEventDoorSales(
    isDoorSaleOrder && typeof eventId === "string" ? eventId : null,
  );
  const doorSale: DoorSaleRecord | null =
    isDoorSaleOrder && order !== null
      ? (doorSalesQuery.data?.find((sale) => sale.id === order.id) ?? null)
      : null;
  const [doorRefundOpen, setDoorRefundOpen] = useState<boolean>(false);
  const paymentRole = useCurrentBrandRole(order?.brandId ?? null);
  const payoutScreen = useBrandPayoutScreen(
    canViewBrandPayments({
      role: paymentRole.role,
      accepted: paymentRole.accepted,
    })
      ? (order?.brandId ?? null)
      : null,
  );
  const linkedPayout =
    payoutScreen.data?.releases.find((release) =>
      release.items.some(
        (item) => item.sourceType === "order" && item.sourceId === orderId,
      ),
    ) ?? null;
  const linkedSale =
    linkedPayout?.items.find(
      (item) => item.sourceType === "order" && item.sourceId === orderId,
    ) ?? null;
  const routeEvent = useManagedEventRoute(
    typeof eventId === "string" ? eventId : null,
  );
  const event = routeEvent.event;
  // issue #4522 G-7 — a trip order bought on a payment plan (an older plan or
  // the new one) is one the server's balance reader lists. Asked for trips
  // only (the reader refuses any other offering); an event, or a server that
  // has no reader yet, keeps this screen exactly as it was.
  const planBalancesQuery = useTripEventBalances(
    event?.event_type === "trip" && typeof eventId === "string" ? eventId : null,
    featureFlags.tripPlanV2,
  );
  const planBalance =
    order === null
      ? null
      : (planBalancesQuery.data?.find((b) => b.orderId === order.id) ?? null);
  // While the reader answers, a trip order shows no refund buttons rather than
  // flashing ones that do not apply to it.
  const planBalancePending =
    event?.event_type === "trip" && featureFlags.tripPlanV2 && planBalancesQuery.isPending;
  // issue #3284 — occurrences for the refund-terms caption (per-day orders count
  // from their earliest day). Keyed like every other public read of this event.
  const publicEventQuery = usePublicEventById(
    typeof eventId === "string" ? eventId : null,
  );

  const [resendSubmitting, setResendSubmitting] = useState<boolean>(false);
  // ORCH-0787: real sheet/dialog state replacing the hardcoded `false` action flags.
  const [refundSheetMode, setRefundSheetMode] = useState<
    "full" | "partial" | null
  >(null);
  const [cancelDialogVisible, setCancelDialogVisible] =
    useState<boolean>(false);
  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
  }>({ visible: false, message: "" });

  // ORCH-0787: caller permission must be derived BEFORE any early returns to satisfy
  // Rules of Hooks. brandId may be empty while order is loading; canPerformAction
  // returns false on null/empty rank which gates the buttons off until order resolves.
  const callerRank = paymentRole.rank;
  const canRefund = canPerformAction(callerRank, "REFUND_ORDER");
  const discountLinesQuery = useQuery({
    queryKey: [
      "brand-discounts",
      "order-lines",
      "ticket",
      order?.id ?? "disabled",
    ],
    enabled: order !== null && callerRank >= 30,
    queryFn: async () => {
      if (order === null) throw new Error("order_missing");
      return (await loadDiscountService()).fetchOrderDiscountLines(
        "ticket",
        order.id,
      );
    },
  });
  // issue #3827 Q10 — resend runs through guest-list `resend`, whose server
  // gate is event manager and above.
  const canResendRole = canPerformAction(callerRank, "EDIT_EVENT");

  // issue #3827 — a guest-list ticket is not a sale: it lives on the guest
  // page, never behind refund or cancel controls.
  const isGuestListOrder = order !== null && isCompOrder(order);
  useEffect(() => {
    if (
      isGuestListOrder &&
      typeof eventId === "string" &&
      typeof orderId === "string"
    ) {
      router.replace(`/event/${eventId}/guests/order-${orderId}` as never);
    }
  }, [isGuestListOrder, eventId, orderId, router]);

  const showToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (typeof eventId === "string") {
      router.replace(`/event/${eventId}/orders` as never);
    }
  }, [router, eventId]);

  // issue #3284 — what the refund sheet needs to caption the published refund
  // terms. Events and experiences only (trips keep their own cancellation flow);
  // an event whose terms were never read stays `undefined` → no caption.
  const refundTerms = useMemo<RefundSheetRefundTerms | undefined>(() => {
    if (order === null || event === null) return undefined;
    const eventType = event.event_type ?? "event";
    if (eventType !== "event" && eventType !== "experience") return undefined;
    return {
      policy: event.refundPolicy,
      offeringType: eventType,
      startsAt: resolveOrderRefundStartAt({
        orderDayIds: (order.ticketDays ?? []).flatMap((t) => t.eventDateIds),
        occurrences: publicEventQuery.data?.occurrences ?? [],
        fallbackStartAt: event.masterStartAtUtc ?? null,
      }),
    };
  }, [order, event, publicEventQuery.data?.occurrences]);

  // ---- canResend (J-M6 visibility) ----
  const canResend = useMemo<boolean>(() => {
    if (order === null || !canResendRole) return false;
    if (order.buyer.email.trim().length === 0) return false;
    if (order.status !== "paid" && order.status !== "refunded_partial") {
      return false;
    }
    return order.lines.some((l) => l.quantity - l.refundedQuantity > 0);
  }, [order, canResendRole]);

  const handleResend = useCallback(async (): Promise<void> => {
    if (order === null || event === null || resendSubmitting) return;
    setResendSubmitting(true);
    try {
      // issue #3827 D-1 — was a direct call to ticket-confirmation-dispatch
      // with the host's token, which that function always refuses (403).
      await (
        await loadGuestList()
      ).resendGuestListTicket({
        orderId: order.id,
        clientRequestId: newResendRequestId(),
      });
      showToast(`Ticket resent to ${order.buyer.email}.`);
    } catch (error) {
      showToast(guestListMessage(error));
    } finally {
      setResendSubmitting(false);
    }
  }, [order, event, resendSubmitting, showToast]);

  useEffect(() => {
    if (routeEvent.replacementEventId !== null && typeof orderId === "string") {
      router.replace(
        `/event/${routeEvent.replacementEventId}/orders/${orderId}` as never,
      );
    }
  }, [routeEvent.replacementEventId, router, orderId]);

  // issue #3827 — never render refund/cancel controls for a guest-list ticket,
  // not even for the frame before the redirect lands.
  if (isGuestListOrder) {
    return (
      <View
        style={[
          styles.host,
          { paddingTop: insets.top, backgroundColor: color.canvas },
        ]}
      >
        <View style={styles.emptyHost} accessibilityRole="progressbar">
          <Text style={styles.emptyLoadingText}>
            Opening guest-list ticket…
          </Text>
        </View>
      </View>
    );
  }

  if (event === null && routeEvent.isLoading && typeof eventId === "string") {
    return (
      <View
        style={[
          styles.host,
          { paddingTop: insets.top, backgroundColor: color.canvas },
        ]}
      >
        <View style={styles.chromeRow}>
          <IconChrome
            icon="close"
            size={36}
            onPress={handleBack}
            accessibilityLabel="Back"
          />
          <Text style={styles.chromeTitle}>Order</Text>
          <View style={styles.chromeRightSlot} />
        </View>
        <View style={styles.emptyHost}>
          <Text style={styles.emptyLoadingText}>Loading event...</Text>
        </View>
      </View>
    );
  }

  if (orderQuery.status === "loading" || orderQuery.status === "disabled") {
    return (
      <View
        style={[
          styles.host,
          { paddingTop: insets.top, backgroundColor: color.canvas },
        ]}
      >
        <View style={styles.chromeRow}>
          <IconChrome
            icon="close"
            size={36}
            onPress={handleBack}
            accessibilityLabel="Back"
          />
          <Text style={styles.chromeTitle}>Order</Text>
          <View style={styles.chromeRightSlot} />
        </View>
        <View style={styles.emptyHost} accessibilityRole="progressbar">
          <Text style={styles.emptyLoadingText}>Loading order…</Text>
        </View>
      </View>
    );
  }

  if (orderQuery.status === "error") {
    return (
      <View
        style={[
          styles.host,
          { paddingTop: insets.top, backgroundColor: color.canvas },
        ]}
      >
        <View style={styles.chromeRow}>
          <IconChrome
            icon="close"
            size={36}
            onPress={handleBack}
            accessibilityLabel="Back"
          />
          <Text style={styles.chromeTitle}>Order</Text>
          <View style={styles.chromeRightSlot} />
        </View>
        <View style={styles.emptyHost}>
          <EmptyState
            illustration="ticket"
            title="Couldn't load order"
            description="No order details are shown until this order loads."
            cta={{
              label: "Try again",
              onPress: () => {
                void orderQuery.refetch();
              },
              variant: "primary",
            }}
          />
        </View>
      </View>
    );
  }

  // issue #3281 — the guest-chosen start, in the offering's own zone.
  const bookedTime = formatBookedStart(order?.bookedStartAt, event?.timezone);

  // ---- Empty / not-found states ----
  if (typeof orderId !== "string" || order === null) {
    return (
      <View
        style={[
          styles.host,
          { paddingTop: insets.top, backgroundColor: color.canvas },
        ]}
      >
        <View style={styles.chromeRow}>
          <IconChrome
            icon="close"
            size={36}
            onPress={handleBack}
            accessibilityLabel="Back"
          />
          <Text style={styles.chromeTitle}>Order</Text>
          <View style={styles.chromeRightSlot} />
        </View>
        <View style={styles.emptyHost}>
          <EmptyState
            illustration="ticket"
            title="Order not found"
            description="It may have been deleted, or the link is incorrect."
          />
        </View>
      </View>
    );
  }

  const baseBanner = statusBannerSpec(
    order.status,
    order.refundedAmountGbp,
    order.currency,
  );
  const payoutBannerCopy =
    linkedPayout === null || order.status !== "paid"
      ? null
      : linkedPayout.hostState === "paid" && linkedPayout.releasedAt !== null
        ? `Paid · in your payout of ${new Date(linkedPayout.releasedAt).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}`
        : linkedPayout.hostState === "scheduled"
          ? `Paid · payout scheduled for ${new Date(linkedPayout.dueAt).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}`
          : `Paid · payout: ${PAYOUT_STATE_COPY[linkedPayout.hostState].label.toLowerCase()}`;
  const planView =
    planBalance === null ? null : derivePlanOrderView(order, planBalance);
  const planBanner: StatusBannerSpec | null =
    planView === null
      ? null
      : planView.banner.tone === "cancelled"
        ? {
            bgColor: color.fill.tile,
            borderColor: color.lineStrong,
            iconName: "close",
            iconColor: color.text3,
            copy: planView.banner.copy,
          }
        : { ...baseBanner, copy: planView.banner.copy };
  const banner =
    planBanner !== null
      ? planBanner
      : payoutBannerCopy === null
        ? baseBanner
        : { ...baseBanner, copy: payoutBannerCopy };
  const initials = getInitials(order.buyer.name);

  // ---- Primary action button derivation (ORCH-0787) ----
  // Replaces the Cycle-9c-era hardcoded `false` flags. callerRank + canRefund are
  // computed at the top of the component before any early returns. Free orders use
  // the cancel path; paid orders use the refund path (Q-1 collapse).
  const {
    refundRail,
    showRefundFull,
    showRefundPartialAgain,
    showCancelOrder,
    showSecondaryPartialFromFull,
  } = deriveActionFlags(order, canRefund);
  // issue #4522 G-7 — the single-order refund sheet cannot size a plan order;
  // its refunds are made from the trip's money screen (Cancel & refund).
  const offerRefundFull = showRefundFull && planBalance === null && !planBalancePending;
  const offerRefundAgain =
    showRefundPartialAgain && planBalance === null && !planBalancePending;
  const offerPartialFromFull = showSecondaryPartialFromFull && planBalance === null;
  const showPlanRefundNote =
    planBalance !== null && canRefund && planView !== null && !planView.cancelled;
  // A door sale opens the door refund sheet (it picks the seats itself);
  // every other paid order opens the provider refund sheet.
  const doorRefundLoading =
    refundRail === "door_sale" && doorSale === null && doorSalesQuery.isPending;
  const openRefund = (mode: "full" | "partial"): void => {
    if (refundRail === "door_sale") {
      if (doorSale !== null) {
        setDoorRefundOpen(true);
      } else {
        // The door list could not be read here: the door sale screen reads it
        // again and offers the same refund.
        router.push(`/event/${order.eventId}/door/${order.id}` as never);
      }
      return;
    }
    setRefundSheetMode(mode);
  };

  const feesAndTaxCents = (order.buyerFeesCents ?? 0) + (order.taxCents ?? 0);
  const buyerTotalCents =
    order.buyerTotalCents ??
    order.totalCents ??
    Math.round(order.totalGbpAtPurchase * 100);

  return (
    <View
      style={[
        styles.host,
        { paddingTop: insets.top, backgroundColor: color.canvas },
      ]}
    >
      <View style={styles.chromeRow}>
        <IconChrome
          icon="close"
          size={36}
          onPress={handleBack}
          accessibilityLabel="Back"
        />
        <Text style={styles.chromeTitle}>Order</Text>
        <View style={styles.chromeRightSlot} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 120 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero card — buyer + status banner */}
        <GlassCard variant="elevated" padding={space[6]} style={styles.hero}>
          <View style={styles.heroRow}>
            <View
              style={styles.avatar}
            >
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <View style={styles.heroCol}>
              <Text style={styles.heroName} numberOfLines={1}>
                {order.buyer.name.trim().length > 0
                  ? order.buyer.name
                  : "Anonymous"}
              </Text>
              <Text style={styles.heroEmail} numberOfLines={1}>
                {order.buyer.email}
              </Text>
            </View>
          </View>
          <Pressable
            disabled={linkedPayout === null}
            onPress={() =>
              linkedPayout === null
                ? undefined
                : router.push(
                    `/brand/${order.brandId}/payments/${linkedPayout.id}` as never,
                  )
            }
            accessibilityRole={linkedPayout === null ? undefined : "button"}
            accessibilityLabel={
              linkedPayout === null
                ? banner.copy
                : `${banner.copy}. Open payout`
            }
            accessibilityHint={
              linkedPayout === null
                ? undefined
                : "Opens the payout containing this order"
            }
            style={[
              styles.statusBanner,
              {
                backgroundColor: banner.bgColor,
                borderColor: banner.borderColor,
              },
            ]}
          >
            <Icon name={banner.iconName} size={16} color={banner.iconColor} />
            <Text style={styles.statusCopy} numberOfLines={2}>
              {banner.copy}
            </Text>
          </Pressable>
        </GlassCard>

        {/* Lines table */}
        <GlassCard variant="base" padding={space[4]} style={styles.lines}>
          <DetailRow label="Order" value={order.id} mono />
          {bookedTime !== null ? (
            <DetailRow label="Booked time" value={bookedTime} />
          ) : null}
          {order.lines.map((line) => (
            <DetailRow
              key={line.ticketTypeId}
              label={`${line.quantity}× ${line.ticketNameAtPurchase}`}
              value={
                line.isFreeAtPurchase
                  ? "Free"
                  : order.currency === null
                    ? "—"
                    : formatCurrency(
                        line.unitPriceGbpAtPurchase * line.quantity,
                        order.currency,
                      )
              }
              previousValue={
                !line.isFreeAtPurchase &&
                line.listUnitPriceGbpAtPurchase !== undefined &&
                line.listUnitPriceGbpAtPurchase > line.unitPriceGbpAtPurchase &&
                order.currency !== null
                  ? formatCurrency(
                      line.listUnitPriceGbpAtPurchase * line.quantity,
                      order.currency,
                    )
                  : undefined
              }
              mono={!line.isFreeAtPurchase}
            />
          ))}
          {(discountLinesQuery.data ?? []).map((line) => (
            <DetailRow
              key={line.id}
              label={line.name}
              value={
                order.currency === null
                  ? "—"
                  : `−${formatCurrency(line.amountMinor, order.currency, true)}`
              }
              mono
            />
          ))}
          {(order.discountCents ?? 0) > 0 && discountLinesQuery.isError ? (
            <View style={styles.discountError}>
              <Text style={styles.discountErrorText}>
                Couldn&apos;t load discount details.
              </Text>
              <Pressable
                onPress={() => void discountLinesQuery.refetch()}
                accessibilityRole="button"
              >
                <Text style={styles.discountRetry}>Try again</Text>
              </Pressable>
            </View>
          ) : null}
          {planView !== null ? (
            <>
              <DetailRow label="Paid" value={planView.paid} mono bold />
              {planView.left !== null ? (
                <DetailRow label="Left to pay" value={planView.left} mono />
              ) : null}
              {planView.tripTotal !== null ? (
                <DetailRow label="Trip total" value={planView.tripTotal} mono />
              ) : null}
            </>
          ) : (
            <>
              <DetailRow
                label="Fees & tax"
                value={
                  order.currency === null
                    ? "—"
                    : formatCurrency(feesAndTaxCents, order.currency, true)
                }
                mono
              />
              <DetailRow
                label="Total"
                value={
                  buyerTotalCents === 0
                    ? "Free"
                    : order.currency === null
                      ? "—"
                      : formatCurrency(buyerTotalCents, order.currency, true)
                }
                mono
                bold
              />
            </>
          )}
          <DetailRow
            label="Method"
            value={PAYMENT_METHOD_LABEL[order.paymentMethod]}
            last
          />
        </GlassCard>

        {linkedPayout !== null && linkedSale !== null ? (
          <Pressable
            onPress={() =>
              router.push(
                `/brand/${order.brandId}/payments/${linkedPayout.id}` as never,
              )
            }
            accessibilityRole="button"
            accessibilityLabel="Open payout money breakdown"
          >
            <GlassCard variant="base" padding={space[4]} style={styles.lines}>
              <Text style={styles.sectionLabel}>Money</Text>
              <DetailRow
                label="Buyers paid"
                value={formatCurrency(
                  linkedSale.grossCents,
                  linkedPayout.currency,
                  true,
                )}
              />
              <DetailRow
                label="Mingla fee"
                value={`−${formatCurrency(linkedSale.minglaFeeCents, linkedPayout.currency, true)}`}
              />
              <DetailRow label="Card processing" value="Mingla pays" />
              <DetailRow
                label="You get"
                value={formatCurrency(
                  linkedSale.netCents,
                  linkedPayout.currency,
                  true,
                )}
                bold
                last
              />
              <Text style={styles.cancelLedgerCopy}>See its payout →</Text>
            </GlassCard>
          </Pressable>
        ) : null}

        {/* Refund ledger — only when refunds exist */}
        {order.refunds.length > 0 ? (
          <GlassCard
            variant="base"
            padding={space[4]}
            style={styles.refundLedger}
          >
            <Text style={styles.sectionLabel}>Refund history</Text>
            {order.refunds.map((r) => (
              <RefundLedgerRow
                key={r.id}
                refund={r}
                currency={order.currency}
              />
            ))}
          </GlassCard>
        ) : null}

        {/* Cancelled banner — when cancelled */}
        {order.status === "cancelled" && order.cancelledAt !== null ? (
          <GlassCard
            variant="base"
            padding={space[4]}
            style={styles.cancelLedger}
          >
            <Text style={styles.sectionLabel}>Cancelled</Text>
            <Text style={styles.cancelLedgerCopy}>
              {formatRelativeDay(order.cancelledAt)}
            </Text>
          </GlassCard>
        ) : null}

        {/* #4541 R1.9 — the buyer's one answer for this order */}
        {typeof eventId === "string" ? (
          <React.Suspense fallback={null}>
            <GuestAnswersCard
              brandId={order.brandId}
              eventId={eventId}
              subject={{ kind: "order", id: order.id }}
            />
          </React.Suspense>
        ) : null}

        {/* Primary actions */}
        <View style={styles.actionsCol}>
          {offerRefundFull ? (
            <>
              <Button
                label="Refund order"
                onPress={() => openRefund("full")}
                variant="destructive"
                size="lg"
                fullWidth
                loading={doorRefundLoading}
                disabled={doorRefundLoading}
                accessibilityLabel="Refund order"
              />
              {offerPartialFromFull ? (
                <Pressable
                  onPress={() => setRefundSheetMode("partial")}
                  accessibilityRole="button"
                  accessibilityLabel="Partial refund"
                  style={styles.partialLink}
                >
                  <Text style={styles.partialLinkText}>Partial refund</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}

          {offerRefundAgain ? (
            <Button
              label="Refund again"
              onPress={() => openRefund("partial")}
              variant="destructive"
              size="lg"
              fullWidth
              loading={doorRefundLoading}
              disabled={doorRefundLoading}
              accessibilityLabel="Refund again"
            />
          ) : null}

          {showCancelOrder ? (
            <Button
              label="Cancel order"
              onPress={() => setCancelDialogVisible(true)}
              variant="destructive"
              size="lg"
              fullWidth
              accessibilityLabel="Cancel order"
            />
          ) : null}

          {showPlanRefundNote ? (
            <View testID="plan-order-refund-note" style={styles.planRefundNote}>
              <Text style={styles.cancelLedgerCopy}>
                {PLAN_ORDER_REFUND_NOTE_COPY}
              </Text>
              <Button
                label={PLAN_ORDER_OPEN_MONEY_COPY}
                onPress={() =>
                  router.push(`/trip/${order.eventId}/money` as never)
                }
                variant="secondary"
                size="md"
                fullWidth
                accessibilityLabel={PLAN_ORDER_OPEN_MONEY_COPY}
              />
            </View>
          ) : null}

          {canResend && !(planView !== null && planView.cancelled) ? (
            <Button
              label="Resend ticket"
              onPress={handleResend}
              variant="secondary"
              size="md"
              fullWidth
              loading={resendSubmitting}
              disabled={resendSubmitting}
              accessibilityLabel="Resend ticket to buyer"
            />
          ) : null}
        </View>
      </ScrollView>

      {/* ORCH-0787: Refund + Cancel sheets render inside the parent View
          (per feedback_rn_sub_sheet_must_render_inside_parent — sibling
          Modal mounts compete at the OS root layer). */}
      {refundSheetMode !== null ? (
        <RefundSheet
          visible={refundSheetMode !== null}
          mode={refundSheetMode}
          order={order}
          refundTerms={refundTerms}
          payoutImpact={
            linkedSale === null || linkedPayout === null
              ? undefined
              : {
                  grossCents: linkedSale.grossCents,
                  hostNetCents: linkedSale.netCents,
                  currency: linkedPayout.currency,
                }
          }
          onClose={() => setRefundSheetMode(null)}
          onSuccess={(amountGbp) => {
            // #1360: close the sheet FIRST, then defer the confirmation toast
            // past the sheet's unmount window so it isn't dropped by iOS's
            // one-modal-at-a-time refusal (I-PROPOSED-1360-PAYMENT-CONFIRM-
            // DEFERRED-PAST-DISMISSAL).
            setRefundSheetMode(null);
            deferAfterDismiss(() =>
              showToast(
                `Refunded ${order.currency === null ? "—" : formatCurrency(amountGbp, order.currency)}`,
              ),
            );
          }}
        />
      ) : null}

      {doorSale !== null ? (
        <LazyDoorRefundSheet
          visible={doorRefundOpen}
          sale={doorSale}
          onClose={() => setDoorRefundOpen(false)}
          onSuccess={(updated) => {
            setDoorRefundOpen(false);
            const refunded =
              updated.refunds[updated.refunds.length - 1]?.amountGbp ?? 0;
            deferAfterDismiss(() =>
              showToast(
                `Refunded ${formatCurrency(refunded, updated.currency)}. Buyer stays checked in.`,
              ),
            );
          }}
        />
      ) : null}

      <CancelOrderDialog
        visible={cancelDialogVisible}
        orderId={order.id}
        eventId={order.eventId}
        buyerName={order.buyer.name}
        onClose={() => setCancelDialogVisible(false)}
        onSuccess={() => {
          // #1360: close the dialog FIRST, then defer the confirmation toast
          // past the Modal's unmount window (I-PROPOSED-1360-PAYMENT-CONFIRM-
          // DEFERRED-PAST-DISMISSAL).
          setCancelDialogVisible(false);
          deferAfterDismiss(() => showToast("Order cancelled"));
        }}
      />

      {/* Toast (self-positions via Modal portal) */}
      <Toast
        visible={toast.visible}
        kind="info"
        message={toast.message}
        onDismiss={() => setToast({ visible: false, message: "" })}
      />
    </View>
  );
}

// ---- DetailRow ------------------------------------------------------

interface DetailRowProps {
  label: string;
  value: string;
  mono?: boolean;
  bold?: boolean;
  last?: boolean;
  previousValue?: string;
}

const DetailRow: React.FC<DetailRowProps> = ({
  label,
  value,
  mono = false,
  bold = false,
  last = false,
  previousValue,
}) => (
  <View style={[styles.detailRow, last && styles.detailRowLast]}>
    <Text style={styles.detailLabel} numberOfLines={1}>
      {label}
    </Text>
    <View style={styles.detailValueGroup}>
      {previousValue !== undefined ? (
        <Text style={styles.detailPreviousValue} numberOfLines={1}>
          {previousValue}
        </Text>
      ) : null}
      <Text
        style={[
          styles.detailValue,
          mono && styles.detailValueMono,
          bold && styles.detailValueBold,
        ]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  </View>
);

// ---- RefundLedgerRow ------------------------------------------------

interface RefundLedgerRowProps {
  refund: RefundRecord;
  currency: string | null;
}

const RefundLedgerRow: React.FC<RefundLedgerRowProps> = ({
  refund,
  currency,
}) => (
  <View style={styles.refundLedgerRow}>
    <View style={styles.refundLedgerHeader}>
      <Text style={styles.refundLedgerAmount}>
        {currency === null ? "—" : formatCurrency(refund.amountGbp, currency)}
      </Text>
      <Text style={styles.refundLedgerDate}>
        {formatRelativeDay(refund.refundedAt)}
      </Text>
    </View>
    <Text style={styles.refundLedgerReason} numberOfLines={3}>
      {refund.reason}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  chromeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space[4],
    paddingTop: space[2],
    paddingBottom: space[4],
    gap: space[2],
  },
  chromeTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: color.text1,
    letterSpacing: -0.2,
    textAlign: "center",
  },
  chromeRightSlot: {
    width: 36,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: space[4] + 4,
    paddingTop: space[2],
    gap: space[2] + 4,
  },
  hero: {
    marginBottom: 0,
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2] + 4,
    marginBottom: space[4],
  },
  avatar: {
    backgroundColor: color.fill.step,
    width: 56,
    height: 56,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 18,
    fontWeight: "700",
    color: color.text1,
  },
  heroCol: {
    flex: 1,
    minWidth: 0,
  },
  heroName: {
    fontSize: 18,
    fontWeight: "700",
    color: color.text1,
  },
  heroEmail: {
    fontSize: 13,
    color: color.text2,
    marginTop: 2,
  },
  statusBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2] + 2,
    padding: space[2] + 4,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
  },
  statusCopy: {
    flex: 1,
    fontSize: 13,
    color: color.text1,
    lineHeight: 18,
  },
  lines: {
    marginBottom: 0,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  detailRowLast: {
    borderBottomWidth: 0,
  },
  detailLabel: {
    fontSize: 14,
    color: color.text2,
    flex: 1,
    marginRight: space[2],
  },
  detailValue: {
    fontSize: 14,
    fontWeight: "500",
    color: color.text1,
    textAlign: "right",
  },
  detailValueGroup: {
    alignItems: "flex-end",
  },
  detailPreviousValue: {
    fontSize: 12,
    color: color.text3,
    textDecorationLine: "line-through",
  },
  discountError: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: space[2],
  },
  discountErrorText: {
    color: color.danger,
    fontSize: 12,
  },
  discountRetry: {
    color: color.text1,
    fontSize: 12,
    fontWeight: "700",
  },
  detailValueMono: {
    fontVariant: ["tabular-nums"],
  },
  detailValueBold: {
    fontWeight: "700",
  },
  refundLedger: {
    marginBottom: 0,
  },
  cancelLedger: {
    marginBottom: 0,
  },
  planRefundNote: {
    gap: space[3],
  },
  cancelLedgerCopy: {
    fontSize: 13,
    color: color.text2,
    marginTop: 4,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: color.text1,
    marginBottom: space[1],
  },
  refundLedgerRow: {
    paddingVertical: space[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  refundLedgerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  refundLedgerAmount: {
    fontSize: 14,
    fontWeight: "600",
    color: color.text1,
    fontVariant: ["tabular-nums"],
  },
  refundLedgerDate: {
    fontSize: 12,
    color: color.text3,
  },
  refundLedgerReason: {
    fontSize: 13,
    color: color.text2,
    marginTop: 4,
    lineHeight: 18,
    fontStyle: "italic",
  },
  actionsCol: {
    gap: space[2],
    marginTop: space[2],
  },
  partialLink: {
    alignSelf: "center",
    paddingVertical: space[2],
    paddingHorizontal: space[4],
  },
  partialLinkText: {
    fontSize: 14,
    fontWeight: "500",
    color: color.text2,
    textDecorationLine: "underline",
  },
  emptyHost: {
    paddingTop: space[7],
  },
  emptyLoadingText: {
    fontSize: 14,
    color: color.text2,
    textAlign: "center",
  },
});
