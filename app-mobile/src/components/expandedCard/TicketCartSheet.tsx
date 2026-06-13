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
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// ORCH-1016 REWORK-4 (FIX A) — import the gorhom scroll host re-export so this
// sheet scrolls via the SAME proven ROOT-CAUSE wiring as
// ExpandedBusinessEventSheet / ConsumerTripDetailScreen: a BARE scrollMode="scroll"
// so BaseBottomSheet's own gorhom BottomSheetScrollView is the DIRECT child of
// BottomSheetContent, with {header}{body}{stickyFooter} as scroll children. Any
// wrapper prop (header/stickyFooter/bodyContainerStyle) nests the scroll one
// BottomSheetView level deeper → viewport==content → frozen (RW3.1).
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
// ORCH-1016 REWORK-4 (FIX A) — single source of truth for the floating
// GlassBottomNav footprint. The sticky CTA bar carries this clearance so the
// buy/Continue button always sits ABOVE Mingla's bottom nav (the on-device bug:
// the CTA was blocked by the nav because the footer only padded insets.bottom).
import { BOTTOM_NAV_CONTENT_HEIGHT } from "../../hooks/useAppLayout";

import {
  type PublicTicketProps,
  QuantityRow,
  type QuantityRowTheme,
} from "@mingla/event-rendering";

import { Icon } from "../ui/Icon";
// ORCH-1025 [Seamless native consumer cart] — the buyer billing-address +
// "Calculate tax" gate (CartTaxPreview) is RETIRED. Tax is computed server-side
// from the venue (ORCH-1006, ticket-checkout-create v130), and the all-in price
// is already available per tier client-side (PublicTicketProps.priceAllInGbp,
// from pg_public_event_tier_allin). The cart now shows the all-in total upfront
// and goes straight to the native PaymentSheet — no address typed.
import { ConsumerCartCard } from "./ConsumerCartCard";
import { type CartLineSeed, useTicketCart } from "../../hooks/useTicketCart";
import {
  ConsumerIntakeForm,
  tierHasUnsupportedRequired,
} from "./ConsumerIntakeForm";
import {
  buildIntakeFormData,
  type IntakeAnswerValue,
  type IntakeFormData,
  type IntakeSchema,
  validateAnswerAgainstSchema,
} from "../../services/tripIntakeSchemaService";

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
  /**
   * ORCH-1025 — the displayed all-in total (sum of per-tier server `all_in_cents`
   * × qty, in cents). Carried for the paid/free checkout branch + telemetry ONLY;
   * the authoritative charge is the PaymentIntent amount the backend computes
   * from the same `compute_all_in_cents` engine (WYSIWYP parity by construction).
   * The cart no longer sends `address` or `taxCalculationId` — tax is sourced at
   * the venue server-side, so the buyer never types an address.
   */
  totalCents: number;
  /**
   * ORCH-1016 REWORK (D2) — per-tier trip intake answers for selected tiers
   * that carry an intake schema. Empty array when no selected tier has a
   * schema (the common case) so non-intake checkouts add nothing to the body.
   */
  intakeFormData: IntakeFormData[];
}

export interface TicketCartSheetProps {
  visible: boolean;
  eventId: string;
  /** From `usePublicEventTickets(eventId)`. `undefined` = loading. */
  tickets: ReadonlyArray<PublicTicketProps> | undefined;
  /**
   * ORCH-1016 REWORK (D2) — per-tier trip intake schemas keyed by
   * ticket_type_id (from `useTripIntakeSchemas(eventId)`). Empty/undefined when
   * the trip requires no intake (the common case) → no intake step renders.
   */
  intakeSchemasByTier?: Map<string, IntakeSchema>;
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
  /**
   * True when this cart is rendered inline below Mingla's floating nav. When the
   * parent group is already hosted in an overlay carrier, the nav is behind the
   * modal window and the CTA only needs OS safe-area clearance.
   */
  clearFloatingNav?: boolean;
  /**
   * ORCH-1130 ADDENDUM (Seth-BINDING) — the deposit DUE TODAY (in cents) when
   * the buyer selected "Pay over time" on a plan trip. Provided by the trip
   * detail screen (read from the same projected schedule the toggle renders,
   * never recomputed here). When set, the sticky bar leads with the amount due
   * today ("Due today") instead of the all-in total, mirroring Path A. Omitted
   * (undefined) for events / no-plan / pay-in-full → the all-in total shows,
   * byte-identical to today.
   */
  dueTodayCents?: number;
  onCancel: () => void;
  onCheckout: (payload: TicketCartCheckoutPayload) => void;
}

export const TicketCartSheet: React.FC<TicketCartSheetProps> = ({
  visible,
  eventId: _eventId,
  tickets,
  fallbackCurrency,
  initialTicketTypeId,
  intakeSchemasByTier,
  buyerName,
  buyerEmail,
  buyerPhone,
  isSubmitting,
  clearFloatingNav = true,
  dueTodayCents,
  onCancel,
  onCheckout,
}) => {
  const insets = useSafeAreaInsets();
  const { lines, totals, setLineQuantity, reset } = useTicketCart(
    fallbackCurrency,
  );
  const [marketingOptIn, setMarketingOptIn] = useState<boolean>(false);
  // ORCH-1025 — "What's included" breakdown panel expand/collapse.
  const [breakdownOpen, setBreakdownOpen] = useState<boolean>(false);
  // ORCH-1016 REWORK (D2) — per-tier intake answers + per-tier per-question
  // validation errors. Keyed by ticket_type_id → { [questionId]: value/error }.
  const [intakeAnswers, setIntakeAnswers] = useState<
    Record<string, Record<string, IntakeAnswerValue>>
  >({});
  const [intakeErrors, setIntakeErrors] = useState<
    Record<string, Record<string, string>>
  >({});
  const lastOpenSeedRef = React.useRef<string | null>(null);

  // Tiers in the cart (qty > 0) that carry an intake schema.
  const selectedSchemaTiers = useMemo<
    Array<{ tierId: string; tierName: string; schema: IntakeSchema }>
  >(() => {
    if (intakeSchemasByTier === undefined || intakeSchemasByTier.size === 0) {
      return [];
    }
    return lines
      .filter((l) => l.quantity > 0)
      .map((l) => {
        const schema = intakeSchemasByTier.get(l.ticketTypeId);
        if (schema === undefined) return null;
        return {
          tierId: l.ticketTypeId,
          tierName: l.ticketName,
          schema,
        };
      })
      .filter(
        (
          t,
        ): t is { tierId: string; tierName: string; schema: IntakeSchema } =>
          t !== null,
      );
  }, [lines, intakeSchemasByTier]);

  // True when a selected tier requires something this surface can't collect
  // (a required file_upload) — keeps the CTA disabled with a clear message
  // instead of letting the buyer hit a server-side 400.
  const hasUnsupportedRequired = useMemo<boolean>(
    () => selectedSchemaTiers.some((t) => tierHasUnsupportedRequired(t.schema)),
    [selectedSchemaTiers],
  );

  // ORCH-1025 — all-in pricing, derived ONLY from server data (G-1 WYSIWYP / G-3
  // no fabricated numbers). For each cart line we read the tier's server-computed
  // all-in major-unit price (`priceAllInGbp`, = compute_all_in_cents / 100 from
  // pg_public_event_tier_allin) and its base price (`priceGbp`). The ONLY client
  // arithmetic is sum + (× quantity) + ×100/÷100 — NO inline tax/fee math.
  //   - baseCents  : Σ base price_cents × qty  (the "Tickets" subtotal — the
  //                  Mingla fee is folded into the all-in, not split out here)
  //   - allInCents : Σ all-in cents × qty  (the amount the buyer pays; the
  //                  authoritative charge is the PI built from the same engine)
  //   - feesTaxCents = allInCents − baseCents  (the ONE truthful derived figure;
  //                  the public RPC exposes no VAT/fee SPLIT, so we never
  //                  fabricate separate VAT vs service-fee numbers — see report)
  // When a tier has no server all-in (RPC miss → priceAllInGbp falls back to
  // priceGbp in the service), its all-in == base, contributing 0 to feesTax and
  // dropping the "includes VAT & fees" affordance for that tier automatically.
  const pricing = useMemo<{
    baseCents: number;
    allInCents: number;
    feesTaxCents: number;
    hasAllInDelta: boolean;
  }>(() => {
    let baseCents = 0;
    let allInCents = 0;
    for (const line of lines) {
      if (line.quantity <= 0) continue;
      const ticket = tickets?.find((t) => t.id === line.ticketTypeId);
      // Base from the cart line (authoritative price_cents seed).
      const lineBaseCents = line.unitPriceCents * line.quantity;
      // All-in from the tier's server priceAllInGbp; fall back to base when the
      // RPC produced no figure for this tier (never invent a number).
      const allInMajor =
        ticket?.priceAllInGbp != null ? ticket.priceAllInGbp : null;
      const lineAllInCents =
        allInMajor != null
          ? Math.round(allInMajor * 100) * line.quantity
          : lineBaseCents;
      baseCents += lineBaseCents;
      allInCents += lineAllInCents;
    }
    const feesTaxCents = Math.max(0, allInCents - baseCents);
    return {
      baseCents,
      allInCents,
      feesTaxCents,
      hasAllInDelta: feesTaxCents > 0,
    };
  }, [lines, tickets]);

  // META-ORCH-0991 Wave A — open/close is owned by BaseBottomSheet
  // (declarative `visible`). The prior sheetRef + snapToIndex/close effect is
  // removed; the primitive replicates that exact open/close pattern internally.

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
      setIntakeAnswers({});
      setIntakeErrors({});
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

  const setTierAnswers = useCallback(
    (tierId: string, next: Record<string, IntakeAnswerValue>): void => {
      setIntakeAnswers((prev) => ({ ...prev, [tierId]: next }));
      // Clear the tier's surfaced errors as the buyer edits.
      setIntakeErrors((prev) => {
        if (prev[tierId] === undefined) return prev;
        const copy = { ...prev };
        delete copy[tierId];
        return copy;
      });
    },
    [],
  );

  const handleConfirm = useCallback((): void => {
    // ORCH-1025 — no taxPreview gate: the buyer can pay immediately. The cart is
    // unblocked the moment it has lines (and any required intake is valid).
    if (totals.isEmpty || isSubmitting) return;
    if (hasUnsupportedRequired) return;

    // ORCH-1016 REWORK (D2) — required-field validation BEFORE payment.
    // Mirrors the business validator AND the edge fn's required gate so the
    // buyer never reaches the PaymentSheet (or a server 400) with a required
    // intake question unanswered.
    if (selectedSchemaTiers.length > 0) {
      const nextErrors: Record<string, Record<string, string>> = {};
      for (const tier of selectedSchemaTiers) {
        const tierAnswers = intakeAnswers[tier.tierId] ?? {};
        const errs = validateAnswerAgainstSchema(tier.schema, tierAnswers);
        if (errs.length > 0) {
          nextErrors[tier.tierId] = errs.reduce<Record<string, string>>(
            (acc, e) => {
              acc[e.question_id] = e.error;
              return acc;
            },
            {},
          );
        }
      }
      if (Object.keys(nextErrors).length > 0) {
        setIntakeErrors(nextErrors);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
    }

    const intakeFormData = buildIntakeFormData(
      selectedSchemaTiers.map((t) => t.tierId),
      intakeSchemasByTier ?? new Map<string, IntakeSchema>(),
      intakeAnswers,
    );

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // ORCH-1025 — payload omits `address` and `taxCalculationId` (G-2). The
    // all-in total (derived only from server all_in_cents) rides as `totalCents`
    // for the paid/free branch + telemetry; the charge is the PI amount.
    onCheckout({
      lines: lines
        .filter((l) => l.quantity > 0)
        .map((l) => ({ ticketTypeId: l.ticketTypeId, quantity: l.quantity })),
      marketingOptIn,
      totalCents: pricing.allInCents,
      intakeFormData,
    });
  }, [
    totals.isEmpty,
    isSubmitting,
    hasUnsupportedRequired,
    selectedSchemaTiers,
    intakeAnswers,
    intakeSchemasByTier,
    lines,
    marketingOptIn,
    pricing.allInCents,
    onCheckout,
  ]);

  // Derived render-state per design §5.
  const visibleTickets = useMemo<PublicTicketProps[]>(() => {
    if (!tickets) return [];
    return [...tickets]
      .filter(isVisibleForConsumer)
      .sort((a, b) => a.displayOrder - b.displayOrder);
  }, [tickets]);

  const allSoldOut = visibleTickets.length > 0 &&
    visibleTickets.every(
      (t) => !t.isUnlimited && (t.capacity ?? 0) <= 0,
    );

  const allUnavailable = visibleTickets.length > 0 &&
    visibleTickets.every(
      (t) =>
        t.visibility === "disabled" ||
        isTicketSalesEnded(t) ||
        (!t.isUnlimited && (t.capacity ?? 0) <= 0),
    );

  const renderState =
    ((): "loading" | "empty" | "sold_out" | "sales_closed" | "populated" => {
      if (tickets === undefined) return "loading";
      if (visibleTickets.length === 0) return "empty";
      if (allSoldOut) return "sold_out";
      if (allUnavailable) return "sales_closed";
      return "populated";
    })();

  const ctaLabel = totals.isEmpty
    ? "Add tickets above"
    : hasUnsupportedRequired
    ? "Reserve on web to continue"
    : totals.isFree
    ? "Claim Free Ticket"
    : "Continue to Payment";
  const ctaDisabled =
    totals.isEmpty || isSubmitting || hasUnsupportedRequired;

  // ORCH-1025 — the sticky bar shows the ALL-IN total (sum of server all_in_cents),
  // not the base subtotal, so the buyer sees the exact amount they'll pay upfront.
  //
  // ORCH-1130 ADDENDUM (Seth-BINDING) — when the buyer selected "Pay over time"
  // on a plan trip, the parent passes `dueTodayCents` (the deposit due today from
  // the projected schedule). The sticky bar then leads with that amount under a
  // "Due today" label, mirroring Path A's deposit-led CTA. Falls back to the
  // all-in total for events / no-plan / pay-in-full (dueTodayCents undefined).
  const showsDueToday =
    dueTodayCents !== undefined &&
    dueTodayCents > 0 &&
    !totals.isEmpty &&
    !totals.isFree;
  const subtotalValueText = totals.isEmpty
    ? "—"
    : totals.isFree
    ? "Free"
    : showsDueToday
    ? formatCentsCurrency(dueTodayCents as number, totals.currency)
    : formatCentsCurrency(pricing.allInCents, totals.currency);
  const subtotalLabelText = showsDueToday ? "Due today" : "Subtotal";

  // ORCH-1016 REWORK-4 (FIX A) — the CTA bar must clear BOTH the OS home
  // indicator AND Mingla's floating GlassBottomNav. This sheet renders BELOW the
  // visible nav (no wrapInRNModal), so the nav height is additive on top of the
  // safe-area inset for inline uses. Overlay-carried uses skip the nav height
  // because the whole sheet group already renders above the app nav. Previously
  // only `insets.bottom + 16`, so the buy/Continue button was blocked by the nav
  // on-device.
  const stickyBarStyle = useMemo(
    () => [
      styles.stickyBar,
      {
        paddingBottom:
          (clearFloatingNav ? BOTTOM_NAV_CONTENT_HEIGHT : 0) +
          Math.max(insets.bottom, 16),
      },
    ],
    [clearFloatingNav, insets.bottom],
  );

  // META-ORCH-0991 Wave A — migrated onto BaseBottomSheet. Header is the fixed
  // `header` slot; the scroll/message body is `children`; the sticky CTA bar is
  // `stickyFooter`. scrollMode='scroll' only for the populated state (gorhom
  // BottomSheetScrollView owns the pan-safe scroll); other states use 'view'.
  // The dark #15181f background + rgba(255,255,255,0.35)/width-44 handle are
  // preserved via per-consumer backgroundStyle/handleStyle. The sticky bar keeps
  // its own paddingBottom: insets.bottom+16 (parity floor, SPEC §7.2).
  const header = (
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
  );

  const body =
    renderState === "loading" ? (
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
        <Text style={styles.bodyMessage}>Sold out. Check back later.</Text>
      </View>
    ) : renderState === "sales_closed" ? (
      <View style={styles.bodyMessageWrap}>
        <Text style={styles.bodyMessage}>
          This event isn’t taking new tickets.
        </Text>
      </View>
    ) : (
      <>
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
              onQuantityChange={(next: number) => setLineQuantity(seed, next)}
              CardComponent={ConsumerCartCard}
              renderPlusIcon={(iconProps: { size: number; color: string }) => (
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

        {/* ORCH-1016 REWORK (D2) — per-tier trip intake forms. Only renders for
            selected tiers that carry an intake schema; the no-schema path shows
            nothing here. */}
        {selectedSchemaTiers.length > 0 ? (
          <View style={styles.intakeSection}>
            <Text style={styles.sectionLabel}>BEFORE YOU GO</Text>
            {selectedSchemaTiers.map((tier) => (
              <ConsumerIntakeForm
                key={tier.tierId}
                schema={tier.schema}
                tierName={tier.tierName}
                answers={intakeAnswers[tier.tierId] ?? {}}
                onAnswersChange={(next) => setTierAnswers(tier.tierId, next)}
                validationErrors={intakeErrors[tier.tierId]}
                disabled={isSubmitting}
              />
            ))}
          </View>
        ) : null}

        {/* ORCH-1025 — "What's included" breakdown. Replaces the retired
            billing-address + Calculate-tax form (CartTaxPreview). Shows the
            all-in total upfront with a tappable breakdown. Only the truthful,
            server-derived figures are shown: the base "Tickets" subtotal, the
            combined "Fees & tax" delta (all-in − base), and the all-in total.
            The public RPC exposes no VAT/service-fee SPLIT, so we never fabricate
            separate numbers — when an all-in delta exists we add the qualitative
            "Includes VAT & fees" note (G-3). Hidden for free-only carts. */}
        {!totals.isEmpty && !totals.isFree ? (
          <View style={styles.breakdownWrap}>
            <Pressable
              onPress={() => setBreakdownOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: breakdownOpen }}
              accessibilityLabel="What's included"
              disabled={isSubmitting}
              style={({ pressed }) => [
                styles.breakdownHeader,
                pressed && styles.breakdownHeaderPressed,
              ]}
            >
              <Text style={styles.breakdownTitle}>What’s included</Text>
              <Icon
                name={breakdownOpen ? "chevron-up" : "chevron-down"}
                size={18}
                color="rgba(255,255,255,0.55)"
              />
            </Pressable>
            {breakdownOpen ? (
              <View style={styles.breakdownBody}>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Tickets</Text>
                  <Text style={styles.breakdownValue}>
                    {formatCentsCurrency(pricing.baseCents, totals.currency)}
                  </Text>
                </View>
                {pricing.hasAllInDelta ? (
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>Fees &amp; tax</Text>
                    <Text style={styles.breakdownValue}>
                      {formatCentsCurrency(
                        pricing.feesTaxCents,
                        totals.currency,
                      )}
                    </Text>
                  </View>
                ) : null}
                <View style={[styles.breakdownRow, styles.breakdownTotalRow]}>
                  <Text style={styles.breakdownTotalLabel}>Total</Text>
                  <Text style={styles.breakdownTotalValue}>
                    {formatCentsCurrency(pricing.allInCents, totals.currency)}
                  </Text>
                </View>
                {pricing.hasAllInDelta ? (
                  <Text style={styles.breakdownNote}>Includes VAT &amp; fees</Text>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}
      </>
    );

  const stickyFooter =
    renderState === "populated" ? (
      <View style={stickyBarStyle}>
        <View style={styles.subtotalRow}>
          <Text style={styles.subtotalLabel}>{subtotalLabelText}</Text>
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
    ) : undefined;

  // ORCH-1016 REWORK-4 (FIX A) — mirror ExpandedBusinessEventSheet /
  // ConsumerTripDetailScreen's PROVEN scroll wiring (RW3.2):
  //   scrollMode="view"  → BaseBottomSheet passes children straight into
  //                        BottomSheetContent (no extra nesting),
  //   <BottomSheetScrollView flex:1>  → the gorhom scroll host as a flex:1
  //                        DIRECT child of BottomSheetContent (so a tall cart +
  //                        intake form physically scrolls at runtime),
  //   {stickyFooter}     → the CTA bar as a SIBLING View BELOW the scroll host
  //                        (NOT BaseBottomSheet's `stickyFooter` prop, which
  //                        routed the sheet into the frozen nested branch).
  // The CTA bar (stickyBarStyle) carries the needed bottom clearance for its
  // host mode. The non-populated states (loading/empty/sold-out) render their
  // centered message body inside the same scroll host — nothing to scroll there,
  // but the wiring stays uniform.
  // ORCH-1016 ROOT-CAUSE FIX: BARE scrollMode="scroll" so the gorhom
  // BottomSheetScrollView is the DIRECT child of BottomSheetContent (the only
  // structure gorhom constrains to the snap height). The header + body + Pay CTA
  // are scroll children — the long billing form now scrolls to reach Pay. The nav
  // is hidden (`hidesBottomNav`) so the CTA isn't covered. (Was scrollMode="view"
  // + header + bodyContainerStyle + injected scroll → wrapped scroll → viewport ==
  // content → frozen, so the form never reached Pay.)
  return (
    <BaseBottomSheet
      visible={visible}
      onClose={handleCancel}
      theme="dark"
      snapPoints={SHEET_SNAP_POINTS}
      backgroundStyle={styles.sheetBackground}
      handleStyle={styles.handleIndicator}
      accessibilityLabel="Get tickets"
      scrollMode="scroll"
      hidesBottomNav
      scrollProps={{
        contentContainerStyle: styles.scrollContent,
        showsVerticalScrollIndicator: false,
      }}
    >
      {header}
      {body}
      {stickyFooter}
    </BaseBottomSheet>
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
  scrollContent: {
    paddingHorizontal: 24,
    // Breathing room above the (separately nav-cleared) sticky CTA footer.
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
  // ORCH-1016 REWORK (D2) — intake section
  intakeSection: {
    marginTop: 16,
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
  // ORCH-1025 — "What's included" breakdown panel
  breakdownWrap: {
    marginTop: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.10)",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    overflow: "hidden",
  },
  breakdownHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  breakdownHeaderPressed: {
    opacity: 0.7,
  },
  breakdownTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.88)",
  },
  breakdownBody: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    gap: 8,
  },
  breakdownRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  breakdownLabel: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.62)",
  },
  breakdownValue: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.88)",
  },
  breakdownTotalRow: {
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.10)",
  },
  breakdownTotalLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: "rgba(255, 255, 255, 0.96)",
  },
  breakdownTotalValue: {
    fontSize: 15,
    fontWeight: "700",
    color: "rgba(255, 255, 255, 0.96)",
  },
  breakdownNote: {
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.45)",
    marginTop: 2,
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
