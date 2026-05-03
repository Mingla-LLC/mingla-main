/**
 * /o/[orderId] — Buyer order detail page (Cycle 9c J-M7).
 *
 * ANON-TOLERANT — outside (tabs)/ group; MUST NOT call useAuth or
 * redirect to sign-in. Shareable URL. Reads only from client-side
 * persisted stores (useOrderStore + useLiveEventStore +
 * useCurrentBrandStore + useEventEditLogStore).
 *
 * Renders:
 *   - Material-change banner (when material/destructive edits since
 *     buyer's last lastSeenEventUpdatedAt)
 *   - Event hero (cover + name + date — LIVE from LiveEvent)
 *   - Order summary (FROZEN snapshot fields)
 *   - Status banner per status
 *   - QR code (when status preserves a valid ticket)
 *   - Wallet add row (TRANSITIONAL — same stub as confirm.tsx)
 *   - Refund ledger (when refunds exist)
 *
 * Per Cycle 9c spec §3.5.1 + I-21 (anon-tolerant route).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
} from "../../src/constants/designSystem";
import {
  useOrderStore,
  type OrderStatus,
  type RefundRecord,
} from "../../src/store/orderStore";
import { useLiveEventStore } from "../../src/store/liveEventStore";
import {
  useEventEditLogStore,
  type EventEditEntry,
} from "../../src/store/eventEditLogStore";
import { useCurrentBrandStore } from "../../src/store/currentBrandStore";
import { formatGbp } from "../../src/utils/currency";
import { formatDraftDateLine } from "../../src/utils/eventDateDisplay";
import { expandTicketIds } from "../../src/utils/expandTicketIds";
import type { CheckoutPaymentMethod } from "../../src/components/checkout/CartContext";

import { EmptyState } from "../../src/components/ui/EmptyState";
import { EventCover } from "../../src/components/ui/EventCover";
import { GlassCard } from "../../src/components/ui/GlassCard";
import { Icon } from "../../src/components/ui/Icon";
import { Toast } from "../../src/components/ui/Toast";

// Cycle 11 J-S8 — multi-ticket QR carousel; SUBTRACTS local ticketIdFromOrder
// helper per Const #8.
import { TicketQrCarousel } from "../../src/components/checkout/TicketQrCarousel";

import { MaterialChangeBanner } from "../../src/components/orders/MaterialChangeBanner";

const PAYMENT_METHOD_LABEL: Record<CheckoutPaymentMethod, string> = {
  card: "Card",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  free: "Free",
  // Cycle 12 door methods — defensive fallbacks. I-29 means door payments
  // never reach the buyer-side order detail surface; these labels exist only
  // for type-exhaustiveness on the Record.
  cash: "Cash",
  card_reader: "Card reader",
  nfc: "NFC tap",
  manual: "Manual",
};

const isWeb = Platform.OS === "web";
const showAppleWallet = Platform.OS === "ios" || isWeb;
const showGoogleWallet = Platform.OS === "android" || isWeb;

interface StatusBannerSpec {
  bgColor: string;
  borderColor: string;
  iconName: "check" | "refund" | "close";
  iconColor: string;
  copy: string;
  hideQr: boolean;
}

const statusBannerSpec = (
  status: OrderStatus,
  refundedAmountGbp: number,
): StatusBannerSpec => {
  switch (status) {
    case "paid":
      return {
        bgColor: "rgba(34, 197, 94, 0.12)",
        borderColor: "rgba(34, 197, 94, 0.32)",
        iconName: "check",
        iconColor: "#34c759",
        copy: "You're in. Show the QR at the door.",
        hideQr: false,
      };
    case "refunded_full":
      return {
        bgColor: "rgba(239, 68, 68, 0.12)",
        borderColor: "rgba(239, 68, 68, 0.32)",
        iconName: "refund",
        iconColor: semantic.error,
        copy: `Order refunded — ${formatGbp(refundedAmountGbp)} returned to your card. Ticket no longer valid.`,
        hideQr: true,
      };
    case "refunded_partial":
      return {
        bgColor: accent.tint,
        borderColor: accent.border,
        iconName: "refund",
        iconColor: accent.warm,
        copy: `Partial refund — ${formatGbp(refundedAmountGbp)} returned. Remaining tickets still valid.`,
        hideQr: false,
      };
    case "cancelled":
      return {
        bgColor: "rgba(120, 120, 120, 0.12)",
        borderColor: "rgba(120, 120, 120, 0.32)",
        iconName: "close",
        iconColor: textTokens.tertiary,
        copy: "Order cancelled by the organiser. Ticket no longer valid.",
        hideQr: true,
      };
    default: {
      const _exhaust: never = status;
      return _exhaust;
    }
  }
};

const formatDay = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

export default function BuyerOrderDetailRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ orderId: string | string[] }>();
  const orderId = Array.isArray(params.orderId)
    ? params.orderId[0]
    : params.orderId;

  // ---- Lookups (NO useAuth — anon-tolerant per I-21) ----
  const order = useOrderStore((s) =>
    typeof orderId === "string" ? s.getOrderById(orderId) : null,
  );
  const event = useLiveEventStore((s) =>
    order !== null ? s.events.find((e) => e.id === order.eventId) ?? null : null,
  );
  const brand = useCurrentBrandStore((s) =>
    order !== null ? s.brands.find((b) => b.id === order.brandId) ?? null : null,
  );
  // Material-change banner data — pre-filtered (severity !== "additive").
  // Cycle 9c rework v2 — select raw entries + filter in useMemo so the
  // selector returns a stable reference (was inline filter, infinite-looped).
  const editLogEntries = useEventEditLogStore((s) => s.entries);
  const materialEdits = useMemo<EventEditEntry[]>(() => {
    if (order === null) return [];
    return editLogEntries.filter(
      (e) =>
        e.eventId === order.eventId &&
        e.editedAt > order.lastSeenEventUpdatedAt &&
        e.severity !== "additive",
    );
  }, [editLogEntries, order]);

  const updateLastSeenEventUpdatedAt = useOrderStore(
    (s) => s.updateLastSeenEventUpdatedAt,
  );

  const [walletToast, setWalletToast] = useState<boolean>(false);

  const handleAcknowledge = useCallback((): void => {
    if (order === null || materialEdits.length === 0) return;
    updateLastSeenEventUpdatedAt(order.id, materialEdits[0].editedAt);
  }, [order, materialEdits, updateLastSeenEventUpdatedAt]);

  const handleClose = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/" as never);
    }
  }, [router]);

  const handleWalletAdd = useCallback((): void => {
    setWalletToast(true);
  }, []);

  // Bounce browser-back history on web so Close has stable behavior
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const win = (
      globalThis as unknown as {
        window?: {
          history?: {
            pushState?: (state: unknown, title: string, url?: string) => void;
          };
        };
      }
    ).window;
    win?.history?.pushState?.(null, "", "");
  }, []);

  // Cycle 11 J-S8 — re-derive ALL ticketIds for the multi-QR carousel.
  const carouselTickets = useMemo(() => {
    if (order === null) return [];
    return expandTicketIds(order.id, order.lines).map((t) => ({
      ticketId: t.ticketId,
      ticketName: t.ticketName,
    }));
  }, [order]);

  // ---- Empty / not-found states ----
  if (typeof orderId !== "string" || order === null) {
    return (
      <View
        style={[
          styles.host,
          { paddingTop: insets.top, backgroundColor: "#0c0e12" },
        ]}
      >
        <View style={styles.chromeRow}>
          <Pressable
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={styles.closeBtn}
          >
            <Icon name="close" size={20} color={textTokens.primary} />
          </Pressable>
          <Text style={styles.chromeTitle}>Order</Text>
          <View style={styles.chromeRightSlot} />
        </View>
        <View style={styles.emptyHost}>
          <EmptyState
            illustration="ticket"
            title="Order not found"
            description="If you have your confirmation email, the link there is the canonical reference. Contact the organiser if needed."
          />
        </View>
      </View>
    );
  }

  const banner = statusBannerSpec(order.status, order.refundedAmountGbp);
  const subtotal = order.lines.reduce(
    (sum, l) => sum + l.quantity * l.unitPriceGbpAtPurchase,
    0,
  );
  const totalTickets = order.lines.reduce((sum, l) => sum + l.quantity, 0);
  const eventName = event !== null ? event.name : "Event";
  const eventDateLine = event !== null ? formatDraftDateLine(event) : "";
  const brandName = brand?.displayName ?? "the organiser";

  return (
    <View
      style={[
        styles.host,
        { paddingTop: insets.top, backgroundColor: "#0c0e12" },
      ]}
    >
      <View style={styles.chromeRow}>
        <Pressable
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={styles.closeBtn}
        >
          <Icon name="close" size={20} color={textTokens.primary} />
        </Pressable>
        <Text style={styles.chromeTitle}>Order</Text>
        <View style={styles.chromeRightSlot} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Material-change banner (live read from edit log) */}
        <MaterialChangeBanner
          materialEdits={materialEdits}
          brandName={brandName}
          onAcknowledge={handleAcknowledge}
        />

        {/* Event hero — LIVE values from LiveEvent */}
        {event !== null ? (
          <View style={styles.eventHero}>
            <EventCover
              hue={event.coverHue}
              radius={radiusTokens.lg}
              label="cover · 16:9"
              height={140}
            />
            <Text style={styles.eventName} numberOfLines={2}>
              {eventName.trim().length > 0 ? eventName : "Untitled event"}
            </Text>
            <Text style={styles.eventDate} numberOfLines={2}>
              {eventDateLine}
            </Text>
          </View>
        ) : (
          <GlassCard
            variant="base"
            padding={spacing.md}
            style={styles.eventDeleted}
          >
            <Text style={styles.eventDeletedText}>
              This event was removed by the organiser. Your order details are
              below.
            </Text>
          </GlassCard>
        )}

        {/* Status banner */}
        <View
          style={[
            styles.statusBanner,
            {
              backgroundColor: banner.bgColor,
              borderColor: banner.borderColor,
            },
          ]}
        >
          <Icon name={banner.iconName} size={16} color={banner.iconColor} />
          <Text style={styles.statusCopy} numberOfLines={3}>
            {banner.copy}
          </Text>
        </View>

        {/* Order summary — FROZEN snapshot fields */}
        <GlassCard
          variant="base"
          padding={spacing.md}
          style={styles.summary}
        >
          <DetailRow label="Order" value={order.id} mono />
          {order.lines.map((line) => (
            <DetailRow
              key={line.ticketTypeId}
              label={`${line.quantity}× ${line.ticketNameAtPurchase}`}
              value={
                line.isFreeAtPurchase
                  ? "Free"
                  : formatGbp(line.unitPriceGbpAtPurchase * line.quantity)
              }
              mono={!line.isFreeAtPurchase}
            />
          ))}
          <DetailRow label="Subtotal" value={formatGbp(subtotal)} mono />
          <DetailRow
            label="Total"
            value={
              order.totalGbpAtPurchase === 0
                ? "Free"
                : formatGbp(order.totalGbpAtPurchase)
            }
            mono
            bold
          />
          <DetailRow
            label="Method"
            value={PAYMENT_METHOD_LABEL[order.paymentMethod]}
          />
          <DetailRow
            label="Paid"
            value={formatDay(order.paidAt)}
            last
          />
        </GlassCard>

        {/* QR carousel — Cycle 11 J-S8 (one QR per seat). Hidden when
            ticket no longer valid (refunded / cancelled). */}
        {!banner.hideQr && carouselTickets.length > 0 ? (
          <GlassCard
            variant="base"
            padding={spacing.md}
            style={styles.qrCard}
          >
            <TicketQrCarousel
              orderId={order.id}
              tickets={carouselTickets}
            />
          </GlassCard>
        ) : null}

        {/* Wallet row — hidden when ticket no longer valid */}
        {!banner.hideQr && (showAppleWallet || showGoogleWallet) ? (
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

        {/* Refund ledger */}
        {order.refunds.length > 0 ? (
          <GlassCard
            variant="base"
            padding={spacing.md}
            style={styles.refundLedger}
          >
            <Text style={styles.sectionLabel}>Refund history</Text>
            {order.refunds.map((r) => (
              <RefundLedgerRow key={r.id} refund={r} />
            ))}
          </GlassCard>
        ) : null}

        {/* "Need help?" footer */}
        {brand !== null ? (
          <View style={styles.helpFooter}>
            <Text style={styles.helpFooterTitle}>Need help?</Text>
            <Text style={styles.helpFooterCopy}>
              Contact {brandName} if you have questions about your order.
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Wallet toast — self-positions via Modal portal */}
      <Toast
        visible={walletToast}
        kind="info"
        message="Coming soon — saved to your account."
        onDismiss={() => setWalletToast(false)}
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
}

const DetailRow: React.FC<DetailRowProps> = ({
  label,
  value,
  mono = false,
  bold = false,
  last = false,
}) => (
  <View style={[styles.detailRow, last && styles.detailRowLast]}>
    <Text style={styles.detailLabel} numberOfLines={1}>
      {label}
    </Text>
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
);

// ---- RefundLedgerRow ------------------------------------------------

interface RefundLedgerRowProps {
  refund: RefundRecord;
}

const RefundLedgerRow: React.FC<RefundLedgerRowProps> = ({ refund }) => (
  <View style={styles.refundLedgerRow}>
    <View style={styles.refundLedgerHeader}>
      <Text style={styles.refundLedgerAmount}>
        {formatGbp(refund.amountGbp)}
      </Text>
      <Text style={styles.refundLedgerDate}>
        {formatDay(refund.refundedAt)}
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
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  chromeTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: textTokens.primary,
    letterSpacing: -0.2,
    textAlign: "center",
  },
  chromeRightSlot: {
    width: 36,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md + 4,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  eventHero: {
    gap: spacing.sm,
  },
  eventName: {
    fontSize: 22,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.3,
  },
  eventDate: {
    fontSize: 14,
    color: textTokens.secondary,
  },
  eventDeleted: {
    marginBottom: 0,
  },
  eventDeletedText: {
    fontSize: 13,
    color: textTokens.secondary,
    lineHeight: 18,
  },
  statusBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
    padding: spacing.sm + 4,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
  },
  statusCopy: {
    flex: 1,
    fontSize: 13,
    color: textTokens.primary,
    lineHeight: 18,
  },
  summary: {
    marginBottom: 0,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255, 255, 255, 0.04)",
  },
  detailRowLast: {
    borderBottomWidth: 0,
  },
  detailLabel: {
    fontSize: 14,
    color: textTokens.secondary,
    flex: 1,
    marginRight: spacing.sm,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: "500",
    color: textTokens.primary,
    textAlign: "right",
  },
  detailValueMono: {
    fontVariant: ["tabular-nums"],
  },
  detailValueBold: {
    fontWeight: "700",
  },
  qrCard: {
    alignItems: "center",
    marginBottom: 0,
  },
  walletRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
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
  refundLedger: {
    marginBottom: 0,
  },
  refundLedgerRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255, 255, 255, 0.04)",
  },
  refundLedgerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  refundLedgerAmount: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.primary,
    fontVariant: ["tabular-nums"],
  },
  refundLedgerDate: {
    fontSize: 12,
    color: textTokens.tertiary,
  },
  refundLedgerReason: {
    fontSize: 13,
    color: textTokens.secondary,
    marginTop: 4,
    lineHeight: 18,
    fontStyle: "italic",
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: accent.warm,
    marginBottom: spacing.xs,
  },
  helpFooter: {
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: 4,
  },
  helpFooterTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: textTokens.primary,
  },
  helpFooterCopy: {
    fontSize: 13,
    color: textTokens.secondary,
    lineHeight: 18,
  },
  emptyHost: {
    paddingTop: spacing.xl,
  },
});
