/**
 * TicketCartSheet — consumer-app multi-tier ticket cart, mirroring the public
 * business buyer cart (J-C1 / `mingla-business/app/checkout/[eventId]/index.tsx`)
 * within 8pt visual tolerance.
 *
 * Per ORCH-0847 [Consumer ticket purchase parity with public business page]:
 *   - SPEC: `Mingla_Artifacts/specs/SPEC_ORCH-0847_CONSUMER_TICKET_PURCHASE_PARITY.md` §4.1
 *   - Design verdict: `Mingla_Artifacts/specs/DESIGN_ORCH-0847_PHASE_C_TICKET_CART_SHEET.md`
 *
 * Replaces the prior `TicketClaimConfirmModal` single-ticket confirmation.
 *
 * Layout (top → bottom, per design §3):
 *   1. Header: "Get tickets" title + close (×)
 *   2. Section label: "SELECT YOUR TICKETS"
 *   3. Tier rows (one per visible+available ticket, sorted by displayOrder),
 *      rendered via `<QuantityRow>` from `@mingla/event-rendering` with a
 *      dark-mode theme override + `ConsumerCartCard` host wrapper.
 *   4. Marketing opt-in checkbox (default unchecked, GDPR/CAN-SPAM compliance).
 *   5. Buyer recap card (read-only Name / Email / Phone, from auth profile).
 *   6. Sticky bottom bar: Subtotal label + value, primary CTA.
 *
 * 7 states handled (per design §5): loading, empty, sold_out, sales_closed,
 * populated_empty_cart, populated_cart, submitting.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import BottomSheet, {
  BottomSheetView,
  BottomSheetScrollView,
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  QuantityRow,
  type QuantityRowTheme,
  type PublicTicketProps,
} from "@mingla/event-rendering";

import { Icon } from "../ui/Icon";
import { ConsumerCartCard } from "./ConsumerCartCard";
import { useTicketCart, type CartLineSeed } from "../../hooks/useTicketCart";

// ORCH-0847 Phase C — snap to ~92% so the sheet rises just above the
// consumer app's bottom tab bar, leaving a thin backdrop strip at the
// top for visual affordance + tap-to-dismiss. Operator directive
// 2026-05-15 superseded the prior 75% snap from the design verdict.
const SHEET_SNAP_POINTS = ["92%"];

/**
 * Dark-mode theme tokens for the consumer cart sheet's QuantityRow. Mirrors
 * the design verdict §4 (white-alpha on the `#15181f` sheet canvas).
 */
const CONSUMER_TICKET_CART_THEME: QuantityRowTheme = {
  accent: "#eb7825",
  textPrimary: "rgba(255, 255, 255, 0.96)",
  textSecondary: "rgba(255, 255, 255, 0.72)",
  textTertiary: "rgba(255, 255, 255, 0.52)",
  textQuaternary: "rgba(255, 255, 255, 0.32)",
  stepperBg: "rgba(255, 255, 255, 0.06)",
  stepperBorder: "rgba(255, 255, 255, 0.12)",
  semanticWarning: "#f59e0b",
  semanticError: "#ef4444",
  saleBannerBg: "rgba(245, 158, 11, 0.12)",
  saleBannerBorder: "rgba(245, 158, 11, 0.32)",
  soldOutBg: "rgba(239, 68, 68, 0.16)",
  soldOutBorder: "rgba(239, 68, 68, 0.32)",
};

/**
 * Format a major-unit value (e.g., 12.5 for £12.50) into a currency string.
 * Used by QuantityRow's `formatCurrency` prop.
 */
const formatMajorCurrency = (value: number, currency: string): string => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "GBP",
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
};

/**
 * Format a cents value into a currency string. Used for the sticky bar
 * subtotal display.
 */
const formatCentsCurrency = (cents: number, currency: string): string => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "GBP",
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
};

const isTicketSalesEnded = (ticket: PublicTicketProps): boolean => {
  if (ticket.saleEndAt === null) return false;
  const end = new Date(ticket.saleEndAt).getTime();
  return Number.isFinite(end) && end <= Date.now();
};

/**
 * A ticket is "available for purchase" on the consumer cart if:
 *   - visibility is not "hidden" (door-only / direct-link tiers stay hidden)
 *   - availableAt !== "door" (online checkout only)
 *
 * Mirrors public J-C1 filter at `mingla-business/app/checkout/[eventId]/index.tsx:56-57`.
 */
const isVisibleForConsumer = (ticket: PublicTicketProps): boolean =>
  ticket.visibility !== "hidden" && ticket.availableAt !== "door";

export interface TicketCartCheckoutPayload {
  lines: Array<{ ticketTypeId: string; quantity: number }>;
  marketingOptIn: boolean;
  totalCents: number;
}

export interface TicketCartSheetProps {
  visible: boolean;
  eventId: string;
  /** From `usePublicEventTickets(eventId)`. `undefined` = loading. */
  tickets: ReadonlyArray<PublicTicketProps> | undefined;
  /** Event currency fallback (used until a line is added). */
  fallbackCurrency: string;
  /** Seed the cart with this tier at quantity 1 on open. */
  initialTicketTypeId: string | null;
  /** Auth-derived pre-fill (read-only display). */
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  /** True while the upstream `runNativeCheckout` is in flight. */
  isSubmitting: boolean;
  onCancel: () => void;
  onCheckout: (payload: TicketCartCheckoutPayload) => void;
}

export const TicketCartSheet: React.FC<TicketCartSheetProps> = ({
  visible,
  eventId: _eventId,
  tickets,
  fallbackCurrency,
  initialTicketTypeId,
  buyerName,
  buyerEmail,
  buyerPhone,
  isSubmitting,
  onCancel,
  onCheckout,
}) => {
  const sheetRef = useRef<BottomSheet>(null);
  const insets = useSafeAreaInsets();
  const { lines, totals, setLineQuantity, reset } =
    useTicketCart(fallbackCurrency);
  const [marketingOptIn, setMarketingOptIn] = useState<boolean>(false);
  const lastOpenSeedRef = useRef<string | null>(null);

  // Drive the sheet via declarative `index` prop — same pattern as
  // ExpandedBusinessEventSheet + TicketClaimConfirmModal.
  const sheetIndex = visible ? 0 : -1;

  // Defensive: ensure the sheet animates on visible changes after mount.
  // Mirrors the pattern at TicketClaimConfirmModal.tsx:140-146.
  useEffect(() => {
    if (visible) {
      sheetRef.current?.snapToIndex(0);
    } else {
      sheetRef.current?.close();
    }
  }, [visible]);

  // Seed the tapped tier on open; reset cart + opt-in on close.
  useEffect(() => {
    if (visible && initialTicketTypeId !== null && tickets) {
      if (lastOpenSeedRef.current === initialTicketTypeId) return;
      lastOpenSeedRef.current = initialTicketTypeId;
      const seedTicket = tickets.find((t) => t.id === initialTicketTypeId);
      if (seedTicket === undefined) return;
      const seed: CartLineSeed = {
        ticketTypeId: seedTicket.id,
        ticketName: seedTicket.name,
        unitPriceCents: Math.round((seedTicket.priceGbp ?? 0) * 100),
        currency: seedTicket.currency ?? fallbackCurrency,
        isFree: seedTicket.isFree,
      };
      setLineQuantity(seed, 1);
    }
    if (!visible) {
      lastOpenSeedRef.current = null;
      reset();
      setMarketingOptIn(false);
    }
  }, [
    visible,
    initialTicketTypeId,
    tickets,
    fallbackCurrency,
    setLineQuantity,
    reset,
  ]);

  const handleCancel = useCallback((): void => {
    if (isSubmitting) return;
    onCancel();
  }, [isSubmitting, onCancel]);

  const handleSheetChange = useCallback(
    (index: number): void => {
      if (index === -1 && visible) {
        handleCancel();
      }
    },
    [handleCancel, visible],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
      />
    ),
    [],
  );

  const handleConfirm = useCallback((): void => {
    if (totals.isEmpty || isSubmitting) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onCheckout({
      lines: lines
        .filter((l) => l.quantity > 0)
        .map((l) => ({ ticketTypeId: l.ticketTypeId, quantity: l.quantity })),
      marketingOptIn,
      totalCents: totals.totalCents,
    });
  }, [totals, isSubmitting, lines, marketingOptIn, onCheckout]);

  // Derived render-state per design §5.
  const visibleTickets = useMemo<PublicTicketProps[]>(() => {
    if (!tickets) return [];
    return [...tickets]
      .filter(isVisibleForConsumer)
      .sort((a, b) => a.displayOrder - b.displayOrder);
  }, [tickets]);

  const allSoldOut =
    visibleTickets.length > 0 &&
    visibleTickets.every(
      (t) => !t.isUnlimited && (t.capacity ?? 0) <= 0,
    );

  const allUnavailable =
    visibleTickets.length > 0 &&
    visibleTickets.every(
      (t) =>
        t.visibility === "disabled" ||
        isTicketSalesEnded(t) ||
        (!t.isUnlimited && (t.capacity ?? 0) <= 0),
    );

  const renderState = ((): "loading" | "empty" | "sold_out" | "sales_closed" | "populated" => {
    if (tickets === undefined) return "loading";
    if (visibleTickets.length === 0) return "empty";
    if (allSoldOut) return "sold_out";
    if (allUnavailable) return "sales_closed";
    return "populated";
  })();

  const ctaLabel = totals.isEmpty
    ? "Add tickets above"
    : totals.isFree
      ? "Claim Free Ticket"
      : "Continue to Payment";
  const ctaDisabled = totals.isEmpty || isSubmitting;

  const subtotalValueText = totals.isEmpty
    ? "—"
    : totals.isFree
      ? "Free"
      : formatCentsCurrency(totals.totalCents, totals.currency);

  const stickyBarStyle = useMemo(
    () => [styles.stickyBar, { paddingBottom: insets.bottom + 16 }],
    [insets.bottom],
  );

  return (
    <BottomSheet
      ref={sheetRef}
      index={sheetIndex}
      snapPoints={SHEET_SNAP_POINTS}
      enablePanDownToClose
      onChange={handleSheetChange}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
    >
      {/* Single BottomSheetView container — column flex with header at top,
          scroll/message body taking flex:1 in the middle, sticky bar pinned
          at bottom. Mixing siblings at the BottomSheet root caused the
          sticky bar to render above content; everything must nest inside one
          flexed BottomSheetView. */}
      <BottomSheetView style={styles.content}>
        {/* Header */}
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle} numberOfLines={1} allowFontScaling>
            Get tickets
          </Text>
          <Pressable
            style={styles.closeIcon}
            accessibilityLabel="Close"
            accessibilityRole="button"
            hitSlop={12}
            onPress={handleCancel}
            disabled={isSubmitting}
          >
            <Icon name="close" size={20} color="rgba(255,255,255,0.65)" />
          </Pressable>
        </View>

        {/* Body — branches on render state, always claims flex:1 between
            header and sticky bar. */}
        {renderState === "loading" ? (
          <View style={styles.bodyMessageWrap}>
            <ActivityIndicator color="rgba(255,255,255,0.65)" />
            <Text style={styles.bodyMessage}>Loading tickets…</Text>
          </View>
        ) : renderState === "empty" ? (
          <View style={styles.bodyMessageWrap}>
            <Text style={styles.bodyMessage}>
              No tickets available for this event.
            </Text>
          </View>
        ) : renderState === "sold_out" ? (
          <View style={styles.bodyMessageWrap}>
            <Text style={styles.bodyMessage}>
              Sold out. Check back later.
            </Text>
          </View>
        ) : renderState === "sales_closed" ? (
          <View style={styles.bodyMessageWrap}>
            <Text style={styles.bodyMessage}>
              This event isn’t taking new tickets.
            </Text>
          </View>
        ) : (
          <BottomSheetScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.sectionLabel}>SELECT YOUR TICKETS</Text>
            {visibleTickets.map((ticket) => {
              const line = lines.find((l) => l.ticketTypeId === ticket.id);
              const seed: CartLineSeed = {
                ticketTypeId: ticket.id,
                ticketName: ticket.name,
                unitPriceCents: Math.round((ticket.priceGbp ?? 0) * 100),
                currency: ticket.currency ?? fallbackCurrency,
                isFree: ticket.isFree,
              };
              return (
                <QuantityRow
                  key={ticket.id}
                  ticket={ticket}
                  quantity={line?.quantity ?? 0}
                  onQuantityChange={(next) => setLineQuantity(seed, next)}
                  CardComponent={ConsumerCartCard}
                  renderPlusIcon={(iconProps) => (
                    <Icon
                      name="add"
                      size={iconProps.size}
                      color={iconProps.color}
                    />
                  )}
                  formatCurrency={formatMajorCurrency}
                  theme={CONSUMER_TICKET_CART_THEME}
                  fallbackCurrency={fallbackCurrency}
                />
              );
            })}

            {/* Marketing opt-in */}
            <Pressable
              onPress={() => setMarketingOptIn((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: marketingOptIn }}
              accessibilityLabel="Email me about this organiser’s future events"
              disabled={isSubmitting}
              style={({ pressed }) => [
                styles.checkboxRow,
                pressed && styles.checkboxRowPressed,
              ]}
            >
              <View
                style={[
                  styles.checkboxBox,
                  marketingOptIn && styles.checkboxBoxChecked,
                ]}
              >
                {marketingOptIn ? (
                  <Icon name="check" size={14} color="#ffffff" />
                ) : null}
              </View>
              <Text style={styles.checkboxLabel}>
                Email me about this organiser’s future events
              </Text>
            </Pressable>

            {/* Buyer recap */}
            <ConsumerCartCard style={styles.recapCard}>
              <Text style={styles.recapSectionLabel}>YOUR TICKET GOES TO</Text>
              <View style={styles.recapBlock}>
                <BuyerRow label="Name" value={buyerName} />
                <BuyerRow label="Email" value={buyerEmail} />
                <BuyerRow label="Phone" value={buyerPhone} />
              </View>
            </ConsumerCartCard>
          </BottomSheetScrollView>
        )}

        {/* Sticky bottom bar — pinned to bottom of BottomSheetView via
            flex column layout (body above claims flex:1). */}
        {renderState === "populated" ? (
          <View style={stickyBarStyle}>
            <View style={styles.subtotalRow}>
              <Text style={styles.subtotalLabel}>Subtotal</Text>
              <Text style={styles.subtotalValue}>{subtotalValueText}</Text>
            </View>
            <Pressable
              onPress={handleConfirm}
              disabled={ctaDisabled}
              accessibilityRole="button"
              accessibilityLabel={ctaLabel}
              style={({ pressed }) => [
                styles.ctaButton,
                ctaDisabled && styles.ctaButtonDisabled,
                pressed && !ctaDisabled && styles.ctaButtonPressed,
              ]}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.ctaLabel}>{ctaLabel}</Text>
              )}
            </Pressable>
          </View>
        ) : renderState === "empty" ||
          renderState === "sold_out" ||
          renderState === "sales_closed" ? (
          <View style={stickyBarStyle}>
            <Pressable
              onPress={handleCancel}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={({ pressed }) => [
                styles.ctaButton,
                pressed && styles.ctaButtonPressed,
              ]}
            >
              <Text style={styles.ctaLabel}>Close</Text>
            </Pressable>
          </View>
        ) : null}
      </BottomSheetView>
    </BottomSheet>
  );
};

interface BuyerRowProps {
  label: string;
  value: string;
}

const BuyerRow: React.FC<BuyerRowProps> = ({ label, value }) => (
  <View style={styles.buyerRow}>
    <Text style={styles.buyerLabel}>{label}</Text>
    <Text style={styles.buyerValue} numberOfLines={1}>
      {value.length > 0 ? value : "—"}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: "#15181f",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  handleIndicator: {
    backgroundColor: "rgba(255, 255, 255, 0.35)",
    width: 44,
  },
  content: {
    flex: 1,
    paddingTop: 12,
    // No horizontal padding here — each section applies its own so the
    // sticky bar can span edge-to-edge with its own internal padding.
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 16,
    paddingHorizontal: 24,
  },
  headerTitle: {
    flex: 1,
    color: "rgba(255, 255, 255, 0.96)",
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 26,
  },
  closeIcon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  // Body — error/loading/empty/sold_out/sales_closed
  bodyMessageWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 24,
    gap: 12,
  },
  bodyMessage: {
    fontSize: 15,
    color: "rgba(255, 255, 255, 0.65)",
    textAlign: "center",
    lineHeight: 22,
  },
  // Scroll body — populated state
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.52)",
    letterSpacing: 1.4,
    marginBottom: 8,
  },
  // Marketing opt-in
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 12,
    marginTop: 4,
  },
  checkboxRowPressed: {
    opacity: 0.7,
  },
  checkboxBox: {
    width: 22,
    height: 22,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.12)",
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxBoxChecked: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.72)",
    lineHeight: 20,
  },
  // Buyer recap
  recapCard: {
    marginTop: 12,
  },
  recapSectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.55)",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  recapBlock: {
    gap: 8,
  },
  buyerRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
  },
  buyerLabel: {
    color: "rgba(255, 255, 255, 0.45)",
    fontSize: 13,
  },
  buyerValue: {
    flex: 1,
    color: "rgba(255, 255, 255, 0.96)",
    fontSize: 14,
    textAlign: "right",
  },
  // Sticky bottom bar
  stickyBar: {
    paddingTop: 12,
    paddingHorizontal: 24,
    backgroundColor: "rgba(21, 24, 31, 0.94)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.06)",
  },
  subtotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 8,
  },
  subtotalLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: "rgba(255, 255, 255, 0.55)",
  },
  subtotalValue: {
    fontSize: 20,
    fontWeight: "700",
    color: "rgba(255, 255, 255, 0.96)",
    letterSpacing: -0.3,
  },
  ctaButton: {
    height: 52,
    borderRadius: 14,
    backgroundColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
  },
  ctaButtonDisabled: {
    opacity: 0.5,
  },
  ctaButtonPressed: {
    opacity: 0.85,
  },
  ctaLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: "#ffffff",
  },
});

export default TicketCartSheet;

// Suppress unused-platform-import warning if Platform stays unused after edits.
void Platform;
