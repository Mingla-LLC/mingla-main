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

import React, { useCallback, useMemo, useState } from "react";
import {
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
  canvas,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
} from "../../../../../src/constants/designSystem";
import {
  useOrderStore,
  type OrderStatus,
  type RefundRecord,
} from "../../../../../src/store/orderStore";
import type { CheckoutPaymentMethod } from "../../../../../src/components/checkout/CartContext";
import { useLiveEventStore } from "../../../../../src/store/liveEventStore";
import { formatGbp } from "../../../../../src/utils/currency";
import {
  deriveChannelFlags,
  notifyEventChanged,
} from "../../../../../src/services/eventChangeNotifier";
import { useEventEditLogStore } from "../../../../../src/store/eventEditLogStore";
import { getBrandFromCache } from "../../../../../src/hooks/useBrands";

import { Button } from "../../../../../src/components/ui/Button";
import { EmptyState } from "../../../../../src/components/ui/EmptyState";
import { GlassCard } from "../../../../../src/components/ui/GlassCard";
import { Icon } from "../../../../../src/components/ui/Icon";
import { IconChrome } from "../../../../../src/components/ui/IconChrome";
import { Toast } from "../../../../../src/components/ui/Toast";

import { CancelOrderDialog } from "../../../../../src/components/orders/CancelOrderDialog";
import {
  RefundSheet,
  type RefundMode,
} from "../../../../../src/components/orders/RefundSheet";

const RESEND_PROCESSING_MS = 800;
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const PAYMENT_METHOD_LABEL: Record<CheckoutPaymentMethod, string> = {
  card: "Card",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  free: "Free",
  // Cycle 12 door methods — defensive fallbacks. I-29 means door payments
  // never reach the online order detail surface; these labels exist only
  // for type-exhaustiveness on the Record.
  cash: "Cash",
  card_reader: "Card reader",
  nfc: "NFC tap",
  manual: "Manual",
};

const hashStringToHue = (s: string): number => {
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
};

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter((p) => p.length > 0);
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
): StatusBannerSpec => {
  switch (status) {
    case "paid":
      return {
        bgColor: "rgba(34, 197, 94, 0.12)",
        borderColor: "rgba(34, 197, 94, 0.32)",
        iconName: "check",
        iconColor: "#34c759",
        copy: "Paid · Stripe will settle in 3–5 days",
      };
    case "refunded_full":
      return {
        bgColor: "rgba(239, 68, 68, 0.12)",
        borderColor: "rgba(239, 68, 68, 0.32)",
        iconName: "refund",
        iconColor: semantic.error,
        copy: `Refunded ${formatGbp(refundedAmountGbp)} · buyer will see in 3–5 days`,
      };
    case "refunded_partial":
      return {
        bgColor: accent.tint,
        borderColor: accent.border,
        iconName: "refund",
        iconColor: accent.warm,
        copy: `Partially refunded ${formatGbp(refundedAmountGbp)}`,
      };
    case "cancelled":
      return {
        bgColor: "rgba(120, 120, 120, 0.12)",
        borderColor: "rgba(120, 120, 120, 0.32)",
        iconName: "close",
        iconColor: textTokens.tertiary,
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

export default function OrderDetailRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    id: string | string[];
    oid: string | string[];
  }>();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;
  const orderId = Array.isArray(params.oid) ? params.oid[0] : params.oid;

  const order = useOrderStore((s) =>
    typeof orderId === "string" ? s.getOrderById(orderId) : null,
  );
  const event = useLiveEventStore((s) =>
    order !== null
      ? s.events.find((e) => e.id === order.eventId) ?? null
      : null,
  );

  const [refundSheet, setRefundSheet] = useState<{
    visible: boolean;
    mode: RefundMode;
  }>({ visible: false, mode: "full" });
  const [cancelDialogVisible, setCancelDialogVisible] = useState<boolean>(false);
  const [resendSubmitting, setResendSubmitting] = useState<boolean>(false);
  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
  }>({ visible: false, message: "" });

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

  // ---- canResend (J-M6 visibility) ----
  const canResend = useMemo<boolean>(() => {
    if (order === null) return false;
    if (order.status !== "paid" && order.status !== "refunded_partial") {
      return false;
    }
    return order.lines.some(
      (l) => l.quantity - l.refundedQuantity > 0,
    );
  }, [order]);

  const handleResend = useCallback(async (): Promise<void> => {
    if (order === null || event === null || resendSubmitting) return;
    setResendSubmitting(true);
    await sleep(RESEND_PROCESSING_MS);
    // Cycle 2 / ORCH-0742: read the live Brand record from the React Query
    // cache by ID. Falls back to empty when cache miss — best-effort copy.
    const cachedBrand = getBrandFromCache(order.brandId);
    const brandName = cachedBrand?.displayName ?? "";
    const occurredAt = new Date().toISOString();
    const reason = "Resent ticket";

    // Audit log entry — additive severity (no buyer-fatigue spam)
    useEventEditLogStore.getState().recordEdit({
      eventId: order.eventId,
      brandId: order.brandId,
      reason,
      severity: "additive",
      changedFieldKeys: ["__resend__"],
      diffSummary: ["Ticket resent"],
      affectedOrderIds: [order.id],
      orderId: order.id,
    });

    // Notification — email-only (banner=false, sms=false, push=false).
    // Direct one-off send rather than the standard deriveChannelFlags
    // path because resend is buyer-targeted, not event-broadcast.
    void notifyEventChanged(
      {
        eventId: order.eventId,
        eventName: event.name,
        brandName,
        brandSlug: event.brandSlug,
        eventSlug: event.eventSlug,
        reason,
        diffSummary: ["Ticket resent"],
        severity: "additive",
        affectedOrderIds: [order.id],
        occurredAt,
      },
      { banner: false, email: true, sms: false, push: false },
    );

    setResendSubmitting(false);
    showToast(`Sent to ${order.buyer.email}`);
  }, [order, event, resendSubmitting, showToast]);

  // ---- Empty / not-found states ----
  if (typeof orderId !== "string" || order === null) {
    return (
      <View
        style={[
          styles.host,
          { paddingTop: insets.top, backgroundColor: canvas.discover },
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

  const banner = statusBannerSpec(order.status, order.refundedAmountGbp);
  const hue = hashStringToHue(order.id);
  const initials = getInitials(order.buyer.name);

  // ---- Primary action button derivation (HF-9c-1 deterministic) ----
  const showRefundFull =
    order.paymentMethod !== "free" && order.status === "paid";
  const showRefundPartialAgain =
    order.paymentMethod !== "free" && order.status === "refunded_partial";
  const showCancelOrder =
    order.paymentMethod === "free" && order.status === "paid";
  const showSecondaryPartialFromFull = showRefundFull;

  const subtotal = order.lines.reduce(
    (sum, l) => sum + l.quantity * l.unitPriceGbpAtPurchase,
    0,
  );

  return (
    <View
      style={[
        styles.host,
        { paddingTop: insets.top, backgroundColor: canvas.discover },
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
        <GlassCard
          variant="elevated"
          padding={spacing.lg}
          style={styles.hero}
        >
          <View style={styles.heroRow}>
            <View
              style={[
                styles.avatar,
                { backgroundColor: `hsl(${hue}, 60%, 45%)` },
              ]}
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
          <View
            style={[
              styles.statusBanner,
              {
                backgroundColor: banner.bgColor,
                borderColor: banner.borderColor,
              },
            ]}
          >
            <Icon
              name={banner.iconName}
              size={16}
              color={banner.iconColor}
            />
            <Text style={styles.statusCopy} numberOfLines={2}>
              {banner.copy}
            </Text>
          </View>
        </GlassCard>

        {/* Lines table */}
        <GlassCard variant="base" padding={spacing.md} style={styles.lines}>
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
            last
          />
        </GlassCard>

        {/* Refund ledger — only when refunds exist */}
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

        {/* Cancelled banner — when cancelled */}
        {order.status === "cancelled" && order.cancelledAt !== null ? (
          <GlassCard
            variant="base"
            padding={spacing.md}
            style={styles.cancelLedger}
          >
            <Text style={styles.sectionLabel}>Cancelled</Text>
            <Text style={styles.cancelLedgerCopy}>
              {formatRelativeDay(order.cancelledAt)}
            </Text>
          </GlassCard>
        ) : null}

        {/* Primary actions */}
        <View style={styles.actionsCol}>
          {showRefundFull ? (
            <>
              <Button
                label="Refund order"
                onPress={() =>
                  setRefundSheet({ visible: true, mode: "full" })
                }
                variant="destructive"
                size="lg"
                fullWidth
                accessibilityLabel="Refund order"
              />
              {showSecondaryPartialFromFull ? (
                <Pressable
                  onPress={() =>
                    setRefundSheet({ visible: true, mode: "partial" })
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Partial refund"
                  style={styles.partialLink}
                >
                  <Text style={styles.partialLinkText}>Partial refund</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}

          {showRefundPartialAgain ? (
            <Button
              label="Refund again"
              onPress={() => setRefundSheet({ visible: true, mode: "partial" })}
              variant="destructive"
              size="lg"
              fullWidth
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

          {canResend ? (
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

      {/* Refund sheet */}
      <RefundSheet
        visible={refundSheet.visible}
        mode={refundSheet.mode}
        order={order}
        onClose={() => setRefundSheet({ ...refundSheet, visible: false })}
        onSuccess={(amountGbp) => {
          setRefundSheet({ ...refundSheet, visible: false });
          showToast(
            amountGbp > 0
              ? `Refunded ${formatGbp(amountGbp)}`
              : "Couldn't refund — try again",
          );
        }}
      />

      {/* Cancel order dialog */}
      <CancelOrderDialog
        visible={cancelDialogVisible}
        orderId={order.id}
        buyerName={order.buyer.name}
        onClose={() => setCancelDialogVisible(false)}
        onSuccess={() => {
          setCancelDialogVisible(false);
          showToast("Order cancelled");
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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md + 4,
    paddingTop: spacing.sm,
    gap: spacing.sm + 4,
  },
  hero: {
    marginBottom: 0,
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 4,
    marginBottom: spacing.md,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 18,
    fontWeight: "700",
    color: textTokens.primary,
  },
  heroCol: {
    flex: 1,
    minWidth: 0,
  },
  heroName: {
    fontSize: 18,
    fontWeight: "700",
    color: textTokens.primary,
  },
  heroEmail: {
    fontSize: 13,
    color: textTokens.secondary,
    marginTop: 2,
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
  lines: {
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
  refundLedger: {
    marginBottom: 0,
  },
  cancelLedger: {
    marginBottom: 0,
  },
  cancelLedgerCopy: {
    fontSize: 13,
    color: textTokens.secondary,
    marginTop: 4,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: accent.warm,
    marginBottom: spacing.xs,
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
  actionsCol: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  partialLink: {
    alignSelf: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  partialLinkText: {
    fontSize: 14,
    fontWeight: "500",
    color: textTokens.secondary,
    textDecorationLine: "underline",
  },
  emptyHost: {
    paddingTop: spacing.xl,
  },
});
