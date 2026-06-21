/**
 * Trip tickets selection screen. ORCH-0876 [Trip CRUD + Purchase Flow
 * Completion] — mirror of `app/checkout/[eventId]/index.tsx` for trips.
 *
 * Route: /checkout-trip/{tripEventId}
 *
 * Buyer arrives from TripPreview's "Reserve my spot" CTA. They pick which
 * pricing tier(s) + quantities. Subtotal updates live. Continue routes to
 * /checkout-trip/{tripEventId}/buyer.
 *
 * Architecture: trips have their own buyer-checkout chain — event-side
 * `getPublicEventById` hard-rejects trips by audit-test invariant. The
 * underlying `biz_ticket_checkout_create_session` RPC stays shared (Tr3
 * branching). Trip-tier shape adapts to TicketStub for QuantityRow reuse.
 *
 * Per SPEC_ORCH-0876_V2_FULL_PARITY §8.3.
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — design-intent full-bleed checkout header mirroring /checkout/[eventId]/index.tsx; insets.bottom IS applied (bottom dock) for home-indicator clearance; the top status-bar overlap with back arrow / "Reserve your spot" header / "1 OF 3" pill is the intended banner-style buyer aesthetic. Per ORCH-0876 mirror of ORCH-0859 [Tr2] REWORK 5b operator design ruling.

import React, { useCallback, useEffect, useRef } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../../src/constants/designSystem";
import { tripPublicPath } from "../../../src/constants/publicUrls";
import { usePublicTripById } from "../../../src/hooks/usePublicTripById";
import { useTripIntakeSchemasByEvent } from "../../../src/hooks/useIntakeSchema";
import { formatCurrency } from "../../../src/utils/currency";
import { projectInstallmentSchedule } from "../../../src/utils/installmentScheduleProjection";
// ORCH-1181 — the shared per-package installment sub-line copy (business + web +
// consumer identical). The deposit-due-today still comes from the existing
// projectInstallmentSchedule; this only formats the already-computed cents.
import { formatTripTierInstallmentNote } from "@mingla/offering-rendering";
import type { TripPricingTier } from "../../../src/services/tripsService";
import type {
  TicketAvailableAt,
  TicketStub,
  TicketVisibility,
} from "../../../src/store/draftEventStore";

import { Button } from "../../../src/components/ui/Button";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { EventCoverMedia } from "../../../src/components/ui/EventCoverMedia";
import { decideAutoSkip } from "./autoSkipDecision";
import { tripFunnelTotalSteps } from "./tripFunnelSteps";
import {
  parseSeededTripLines,
  resolveSeededCartPlanChoice,
} from "../../../src/components/trip/tripCartPlanChoice";

import {
  useCart,
  useCartTotals,
  type TripPaymentPlanChoice,
} from "../../../src/components/checkout/CartContext";
import { CheckoutHeader } from "../../../src/components/checkout/CheckoutHeader";
import { QuantityRow } from "../../../src/components/checkout/QuantityRow";
// META-ORCH-1187 P2 — buyer-web funnel parity: fire `web_checkout_started` on the
// trip checkout too (the event checkout already does; trips/experiences didn't,
// undercounting started checkouts). Web-only (native no-op via the .web split).
import { captureWeb, gaEvent } from "../../../src/analytics/webAnalytics";

/**
 * Convert a TripPricingTier (DB shape) to a TicketStub (QuantityRow's
 * expected shape). Trip tiers are simpler than event tickets — no
 * visibility/door/sale-window mechanics — so we map straight defaults
 * for the buyer-checkout-irrelevant fields.
 */
const tierToTicketStub = (tier: TripPricingTier): TicketStub => ({
  id: tier.ticketTypeId,
  name: tier.tierName,
  priceGbp: tier.priceCents > 0 ? tier.priceCents / 100 : null,
  // ORCH-1147 — pass the server fee-grossed all-in through to the cart seed
  // (which reads stub.priceAllInGbp). Null → seed falls back to priceGbp/base.
  priceAllInGbp: tier.priceAllInGbp ?? null,
  currency: tier.currency,
  // ORCH-0946 — buyer-checkout sold-out gate + QuantityRow "+" cap need
  // remaining bookable seats, not total tier capacity. `quantityTotal`
  // never decreases as tickets sell, so before this fix the buyer could
  // tap "+" all the way to the payment screen on a sold-out trip and only
  // failed at the final 409 `ticket_capacity_exceeded`.
  capacity: tier.ticketsRemaining ?? tier.quantityTotal,
  isFree: tier.priceCents === 0,
  isUnlimited: tier.isUnlimited,
  visibility: "public" as TicketVisibility,
  displayOrder: 0,
  approvalRequired: false,
  passwordProtected: false,
  password: null,
  waitlistEnabled: false,
  minPurchaseQty: 1,
  maxPurchaseQty: null,
  allowTransfers: true,
  description: null,
  saleStartAt: null,
  saleEndAt: null,
  availableAt: "online" as TicketAvailableAt,
});

const isTripPast = (endAtIso: string | null): boolean => {
  if (endAtIso === null) return false;
  const end = new Date(endAtIso).getTime();
  return Number.isFinite(end) && end + 24 * 60 * 60 * 1000 < Date.now();
};

const formatTripDateLine = (
  startAtIso: string | null,
  endAtIso: string | null,
): string => {
  if (startAtIso === null) return "";
  try {
    const fmt = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    });
    const start = fmt.format(new Date(startAtIso));
    if (endAtIso !== null) {
      const end = fmt.format(new Date(endAtIso));
      return `${start} – ${end}`;
    }
    return start;
  } catch {
    return "";
  }
};

export default function CheckoutTripTicketsScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    tripEventId: string;
    plan?: string;
    lines?: string;
  }>();
  const tripEventId =
    typeof params.tripEventId === "string" ? params.tripEventId : null;
  // ORCH-1130 — the public-page pay-full vs pay-over-time choice arrives as a
  // route param. Seed CartContext from it once on mount (default "full").
  const planParam: TripPaymentPlanChoice =
    params.plan === "installments" ? "installments" : "full";

  // META-ORCH-1174 Leg B3 — the §10 multi-package SELECTION arrives as a JSON
  // `lines` param `[{ticketTypeId, quantity, paymentPlanChoice?}]` (DEC-B). When
  // present we seed the cart with ALL selected packages (skipping tier-select),
  // mirroring ORCH-1138 "Reserve opens the cart directly". Parsed once (stable
  // string); malformed → empty (the auto-skip / tier-select path takes over).
  // ORCH-1180 — each row may also carry the per-package `paymentPlanChoice`
  // ("full" | "installments"). It is the AUTHORITATIVE pay-over-time signal (the
  // scalar `plan` param can lag the §10 box toggle); the seed effect below uses it
  // to set the cart-level choice so the cart is installment-aware. Absent/unknown
  // values are dropped (the line stays a plain full-price line).
  const seededLinesParam = React.useMemo(
    () => parseSeededTripLines(params.lines),
    [params.lines],
  );

  const publicTripQuery = usePublicTripById(tripEventId);
  const trip = publicTripQuery.data?.trip ?? null;
  const brand = publicTripQuery.data?.brand ?? null;

  const { lines, paymentPlanChoice, setLineQuantity, setPaymentPlanChoice } =
    useCart();
  const totals = useCartTotals();

  // META-ORCH-1187 P2 — fire `web_checkout_started` once the buyer lands on the
  // trip cart and the trip event id resolves (begin of the web purchase funnel),
  // matching app/checkout/[eventId]/index.tsx. PostHog + GA4 `begin_checkout` for
  // the Ads link. Web-only (no-op on native). offering_type: "trip".
  const checkoutStartedRef = useRef<boolean>(false);
  useEffect(() => {
    if (checkoutStartedRef.current) return;
    if (tripEventId === null) return;
    checkoutStartedRef.current = true;
    captureWeb("web_checkout_started", {
      event_id: tripEventId,
      offering_type: "trip",
    });
    gaEvent("begin_checkout", { event_id: tripEventId });
  }, [tripEventId]);

  // ORCH-1178 — the cart step always shows, so the trip funnel is index → buyer
  // → [intake] → payment. Derive the visible total (3 without intake, 4 with) so
  // the "1 OF N" pill reads correctly. The cart is empty on first mount (the
  // buyer hasn't picked a tier yet), so the intake-presence probe keys off ANY
  // of the trip's tiers having a schema with ≥1 question — a stable answer that
  // matches what buyer/payment derive once a selection is committed. Same
  // anon-tolerant by-event query the buyer step uses.
  const intakeSchemasQuery = useTripIntakeSchemasByEvent(tripEventId ?? "", {
    enabled: tripEventId !== null,
  });
  const hasAnyIntakeSchema = React.useMemo<boolean>(() => {
    if (intakeSchemasQuery.data === undefined || trip === null) return false;
    for (const tier of trip.pricingTiers) {
      const schema = intakeSchemasQuery.data.get(tier.ticketTypeId);
      if (schema !== undefined && schema.questions.length > 0) return true;
    }
    return false;
  }, [intakeSchemasQuery.data, trip]);
  const totalSteps = tripFunnelTotalSteps(hasAnyIntakeSchema);

  // ORCH-1130 ADDENDUM (Seth-BINDING) — the price shown beside the Continue CTA
  // (the Subtotal) follows the current pay-full vs pay-over-time selection
  // (seeded from the public-page route param). When pay-over-time is selected
  // and the cart holds a plan-active tier, the Subtotal reads the DEPOSIT DUE
  // TODAY (read from the same projected schedule the toggle renders, never
  // recomputed); otherwise it reads the full cart total. No-plan / pay-in-full
  // → full total, unchanged.
  const dueTodayCents = React.useMemo<number | null>(() => {
    if (paymentPlanChoice !== "installments" || trip === null) return null;
    for (const line of lines) {
      const sourceTier = trip.pricingTiers.find(
        (t) => t.ticketTypeId === line.ticketTypeId,
      );
      if (
        sourceTier !== undefined &&
        sourceTier.installmentSchedule !== null &&
        line.quantity >= 1
      ) {
        const projected = projectInstallmentSchedule(
          sourceTier,
          new Date(),
          line.quantity,
        );
        if (projected !== null) return projected.depositCents;
      }
    }
    return null;
  }, [paymentPlanChoice, trip, lines]);

  // ORCH-1147R2 — the FULL-TOTAL (non-deposit) branch leads with the server
  // fee-grossed all-in (totals.allInTotal), NOT the bare base subtotal
  // (totals.total), so the lead number matches the public page. The combined
  // "Fees & tax" line renders ONLY on the full-total path with a real pass-fee
  // delta — never on the installments "Due today" deposit branch (a partial
  // figure with its own semantics), and never split service-fee + VAT
  // (feedback_cart_combined_fees_tax_line). The deposit branch (dueTodayCents)
  // is unchanged. I-PROPOSED-1147R2-SELECTION-SHOWS-ALLIN.
  // ORCH-1152 — guard the empty cart: on mount the cart is empty and
  // useCartTotals() returns currency "", which crashed formatCurrency
  // (RangeError: Currency is invalid). Pass a safe code on the empty cart so the
  // computation never feeds "" into Intl. headlineAllIn is only DISPLAYED when
  // !isEmpty anyway. (formatCurrency is ALSO hardened against blank codes —
  // defense in depth; the explicit guard here does not rely on it.)
  const headlineAllIn = formatCurrency(
    totals.allInTotal,
    totals.isEmpty ? "GBP" : totals.currency,
  );
  const showFeesTaxLine =
    !totals.isEmpty &&
    !totals.isFree &&
    totals.hasFeesTaxDelta &&
    dueTodayCents === null;

  // ORCH-1130 — seed the cart's payment-plan choice from the public-page param.
  // ORCH-1180 — the `lines` JSON is the AUTHORITATIVE pay-over-time source: if ANY
  // seeded package carries paymentPlanChoice="installments", the whole cart leads
  // with the deposit (mirrors the consumer session-wide choice + Fix A's collapse),
  // overriding a possibly-stale scalar `plan` param. No installments line → honor
  // the scalar param (default "full"), so the pay-in-full opt-out is preserved.
  useEffect(() => {
    setPaymentPlanChoice(
      resolveSeededCartPlanChoice(seededLinesParam, planParam),
    );
    // Run once per mount with the inbound params; the Review step is the
    // last-chance editor thereafter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (trip !== null && trip.brandSlug !== null) {
      router.replace(
        tripPublicPath({
          brandSlug: trip.brandSlug,
          tripSlug: trip.slug,
        }) as never,
      );
      return;
    }
    router.replace("/(tabs)/home" as never);
  }, [router, trip]);

  const handleContinue = useCallback((): void => {
    if (tripEventId === null || totals.isEmpty) return;
    router.push(`/checkout-trip/${tripEventId}/buyer` as never);
  }, [router, tripEventId, totals.isEmpty]);

  // ORCH-1130 — single-tier auto-skip (the prod-universal 45/45 case). When the
  // trip has exactly ONE bookable tier and is bookable (not past / closed /
  // sold-out / empty), the tier-select step adds nothing: auto-add the sole
  // tier (qty 1) and replace into "Your details" so the funnel reads 2 steps.
  // All bookability guards run BEFORE the auto-skip — a sold-out / closed /
  // past single-tier trip still shows its EmptyState below, never auto-advances.
  // A >1-tier trip (no prod data) falls through to the legacy tier-select.
  //
  // ORCH-1130 Fix #2 — break the index⇄buyer ping-pong ("Maximum update depth").
  // The old effect dispatched setLineQuantity AND router.replace('/buyer') in the
  // SAME synchronous body. On a warm-cache 2nd entry the navigation raced the
  // cart write: /buyer mounted, read an EMPTY cart, and its empty-cart guard
  // bounced back to index → the auto-skip re-fired → infinite loop. The fix
  // is two-fold: (a) a useRef latch that flips true once we navigate, so the
  // effect never fires its navigation more than once per mount; and (b) gating
  // router.replace('/buyer') on the cart write having LANDED — we only navigate
  // on the commit where `lines` actually contains the sole tier (qty>=1), never
  // in the same body as the dispatch. This removes the empty-cart window the
  // pre-existing buyer.tsx guard ping-ponged against.
  // META-ORCH-1174 Leg B3 — seed the cart with the public-page MULTI-PACKAGE
  // selection (DEC-B), then advance to /buyer. Takes precedence over the single-
  // tier auto-skip below (which is gated off when seeded lines are present). Same
  // two-phase pattern as the auto-skip: dispatch the cart writes, and navigate only
  // on a later commit once the cart actually holds them (no ping-pong with the
  // /buyer empty-cart guard). Latched so it fires once per mount.
  const multiSeedNavigatedRef = useRef(false);
  useEffect(() => {
    if (tripEventId === null || trip === null) return;
    if (seededLinesParam.length === 0) return;
    if (multiSeedNavigatedRef.current) return;
    // Resolve each requested line against the trip's real tiers (drop unknown ids,
    // clamp to remaining/unlimited). The cart already enforces capacity at commit;
    // this keeps the seed honest (DEC-D per-package capacity).
    const stubById = new Map(
      trip.pricingTiers.map((t) => [t.ticketTypeId, tierToTicketStub(t)] as const),
    );
    const resolved = seededLinesParam.flatMap((line) => {
      const stub = stubById.get(line.ticketTypeId);
      if (stub === undefined) return [];
      const cap =
        stub.isUnlimited || stub.capacity === null
          ? line.quantity
          : Math.max(0, stub.capacity);
      const qty = Math.min(line.quantity, cap);
      if (qty <= 0) return [];
      return [{ stub, qty }];
    });
    if (resolved.length === 0) return;

    // Are all resolved lines already in the cart at the requested qty? If not,
    // dispatch the writes and WAIT for the next commit (do NOT navigate here).
    const allLanded = resolved.every(({ stub, qty }) =>
      lines.some((l) => l.ticketTypeId === stub.id && l.quantity === qty),
    );
    if (!allLanded) {
      for (const { stub, qty } of resolved) {
        setLineQuantity({
          ticketTypeId: stub.id,
          ticketName: stub.name,
          unitPrice: stub.priceGbp ?? 0,
          unitPriceAllIn: stub.priceAllInGbp ?? stub.priceGbp ?? 0,
          currency: stub.currency ?? trip.pricingTiers[0]?.currency ?? "USD",
          isFree: stub.isFree,
          quantity: qty,
        });
      }
      return;
    }
    // ORCH-1178 — the cart/quantity step ALWAYS shows and STAYS for every trip
    // (single AND multi tier). The public-page `lines` selection pre-seeds the
    // cart so the buyer sees their picks, but we NO LONGER auto-advance to /buyer
    // (the old single-tier `router.replace` is removed — it briefly showed the
    // cart then yanked the buyer to "Your details" with no chance to edit qty).
    // Just latch so we stop re-seeding; the buyer taps Continue to advance.
    multiSeedNavigatedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripEventId, trip, seededLinesParam, lines]);

  const autoSkipNavigatedRef = useRef(false);
  useEffect(() => {
    if (tripEventId === null || trip === null) return;
    // META-ORCH-1174 Leg B3 — when the public page passed an explicit multi-package
    // selection, the seeding effect above owns the funnel entry; the single-tier
    // auto-skip must NOT also fire (it would add tier[0] over the real selection).
    if (seededLinesParam.length > 0) return;
    const skipTickets = trip.pricingTiers.map(tierToTicketStub);
    const sole = skipTickets[0];
    const outcome = decideAutoSkip({
      alreadyNavigated: autoSkipNavigatedRef.current,
      tripPresent: true,
      bookingsClosed: trip.bookingsClosed,
      isPast: isTripPast(trip.businessTrip.endAt),
      tiers: skipTickets.map((t) => ({
        id: t.id,
        isUnlimited: t.isUnlimited,
        capacity: t.capacity,
      })),
      lines: lines.map((l) => ({
        ticketTypeId: l.ticketTypeId,
        quantity: l.quantity,
      })),
    });
    if (outcome === "noop") return;
    if (outcome === "addLine" && sole !== undefined) {
      // Cart write hasn't landed yet — dispatch and WAIT. We do NOT navigate in
      // this body; the next commit (with `lines` containing the tier) re-runs
      // the effect and yields "navigate". Idempotent: setLineQuantity sets.
      setLineQuantity({
        ticketTypeId: sole.id,
        ticketName: sole.name,
        unitPrice: sole.priceGbp ?? 0,
        // ORCH-1147 — seed the server fee-grossed all-in (priceAllInGbp) as the
        // headline-Total basis; falls back to base until the trip source plumbs
        // the per-tier all-in (never fabricate).
        unitPriceAllIn: sole.priceAllInGbp ?? sole.priceGbp ?? 0,
        currency: sole.currency ?? trip.pricingTiers[0]?.currency ?? "USD",
        isFree: sole.isFree,
        quantity: 1,
      });
      return;
    }
    // ORCH-1178 — outcome === "navigate": the sole tier's line is present
    // (qty>=1). We PRE-SEED the sole tier (the "addLine" branch above) so it's
    // editable at qty 1, but we NO LONGER auto-`router.replace` to /buyer — the
    // cart/quantity step ALWAYS stays so the buyer can edit quantity and tap
    // Continue. Just latch so the effect goes quiet (the sole tier is seeded,
    // no ping-pong). This supersedes the ORCH-1130 single-tier auto-skip
    // behaviorally (decideAutoSkip the pure fn is intentionally unchanged).
    autoSkipNavigatedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripEventId, trip, lines]);

  // ----- Trip-not-found / past / closed empty states -----
  if (publicTripQuery.isLoading || publicTripQuery.isFetching) {
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={0}
          totalSteps={totalSteps}
          title="Reserve your spot"
          onBack={handleBack}
        />
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Loading trip…</Text>
        </View>
      </View>
    );
  }

  if (publicTripQuery.isError) {
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={0}
          totalSteps={totalSteps}
          title="Reserve your spot"
          onBack={handleBack}
        />
        <View style={styles.emptyWrap}>
          <EmptyState
            illustration="ticket"
            title="Trip couldn't load"
            description="Refresh this page or try the trip link again."
            cta={{ label: "Back", onPress: handleBack }}
          />
        </View>
      </View>
    );
  }

  if (trip === null) {
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={0}
          totalSteps={totalSteps}
          title="Reserve your spot"
          onBack={handleBack}
        />
        <View style={styles.emptyWrap}>
          <EmptyState
            illustration="ticket"
            title="Trip not found"
            description="This trip link may be expired or moved."
            cta={{ label: "Back", onPress: handleBack }}
          />
        </View>
      </View>
    );
  }

  // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline]: respect bookings_closed
  // gate. Tr4 SPEC §3.5.8 amendment will replace this branch with a richer
  // "Bookings closed on <date>" banner.
  if (trip.bookingsClosed) {
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={0}
          totalSteps={totalSteps}
          title="Reserve your spot"
          onBack={handleBack}
        />
        <View style={styles.emptyWrap}>
          <EmptyState
            illustration="ticket"
            title="Bookings closed"
            description="This trip stopped accepting new reservations."
            cta={{ label: "Back", onPress: handleBack }}
          />
        </View>
      </View>
    );
  }

  // Map pricing tiers → TicketStub for QuantityRow reuse.
  const tickets = trip.pricingTiers.map(tierToTicketStub);
  const isPast = isTripPast(trip.businessTrip.endAt);
  const allSoldOut =
    tickets.length > 0 &&
    tickets.every((t) => !t.isUnlimited && (t.capacity ?? 0) <= 0);

  if (isPast || tickets.length === 0 || allSoldOut) {
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={0}
          totalSteps={totalSteps}
          title="Reserve your spot"
          onBack={handleBack}
        />
        <View style={styles.emptyWrap}>
          <EmptyState
            illustration="ticket"
            title={
              isPast
                ? "This trip has ended"
                : tickets.length === 0
                  ? "Pricing isn't ready yet"
                  : "Sold out"
            }
            description={
              isPast
                ? "Reservations are closed for this trip."
                : tickets.length === 0
                  ? "The trip planner hasn't set pricing tiers yet."
                  : "All spots on this trip are gone."
            }
            cta={{ label: "Back to trip", onPress: handleBack }}
          />
        </View>
      </View>
    );
  }

  const continueLabel = totals.isFree ? "Reserve free spot" : "Continue";
  const dateLine = formatTripDateLine(
    trip.businessTrip.startAt,
    trip.businessTrip.endAt,
  );

  return (
    <View style={styles.host}>
      <CheckoutHeader
        stepIndex={0}
        totalSteps={totalSteps}
        title="Reserve your spot"
        onBack={handleBack}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 140 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Trip mini-card: cover + title + brand/date line */}
        <View style={styles.miniCard}>
          <EventCoverMedia
            hue={0}
            mediaUrl={trip.coverMediaUrl}
            mediaType={
              trip.coverMediaType as "image" | "video" | "gif" | null
            }
            radius={0}
            label=""
            style={styles.miniCover}
          />
          <Text style={styles.miniTitle} numberOfLines={2}>
            {trip.title.trim().length > 0 ? trip.title : "Untitled trip"}
          </Text>
          <Text style={styles.miniSubtitle} numberOfLines={1}>
            {brand?.name ?? "Mingla"}
            {dateLine.length > 0 ? ` · ${dateLine}` : ""}
          </Text>
          {trip.businessTrip.destinationLocationText !== null ? (
            <Text style={styles.miniDestination} numberOfLines={1}>
              {trip.businessTrip.destinationLocationText}
            </Text>
          ) : null}
        </View>

        <Text style={styles.sectionLabel}>Select your tier</Text>

        {/* ORCH-1130 — the passive per-tier installment projection is REMOVED.
            The pay-full vs pay-over-time schedule now lives behind the selector
            on the public page + Review step. This legacy multi-tier picker only
            renders for >1-tier trips (no prod data); single-tier auto-skips. */}
        {tickets.map((ticket) => {
          const line = lines.find((l) => l.ticketTypeId === ticket.id);
          const qty = line?.quantity ?? 0;
          // ORCH-1181 — per-package installment sub-line on the tile. Shown ONLY
          // when pay-over-time is the active cart choice AND this tier is on a
          // plan AND it has ≥1 selected. The deposit comes from the SAME
          // projectInstallmentSchedule the cart-level "Due today" reads (lines
          // 195-215) — never recomputed/fabricated. No-plan / pay-in-full / cart
          // "full" → null (events untouched: trip-only tiers carry a schedule).
          const sourceTier =
            paymentPlanChoice === "installments"
              ? trip.pricingTiers.find((t) => t.ticketTypeId === ticket.id)
              : undefined;
          const tierDeposit =
            sourceTier !== undefined &&
            sourceTier.installmentSchedule !== null &&
            qty >= 1
              ? (projectInstallmentSchedule(sourceTier, new Date(), qty)
                  ?.depositCents ?? null)
              : null;
          const installmentNote = formatTripTierInstallmentNote(
            tierDeposit,
            ticket.currency ?? trip.pricingTiers[0]?.currency ?? "USD",
            (value, currency) => formatCurrency(value, currency),
          );
          return (
            <View key={ticket.id} style={styles.tierWrap}>
              <QuantityRow
                ticket={ticket}
                quantity={qty}
                installmentNote={installmentNote}
                onQuantityChange={(next): void =>
                  setLineQuantity({
                    ticketTypeId: ticket.id,
                    ticketName: ticket.name,
                    unitPrice: ticket.priceGbp ?? 0,
                    // ORCH-1147 — server fee-grossed all-in (priceAllInGbp) as
                    // the headline-Total basis; base fallback (never fabricate).
                    unitPriceAllIn:
                      ticket.priceAllInGbp ?? ticket.priceGbp ?? 0,
                    currency:
                      ticket.currency ??
                      trip.pricingTiers[0]?.currency ??
                      "USD",
                    isFree: ticket.isFree,
                    quantity: next,
                  })
                }
              />
            </View>
          );
        })}
      </ScrollView>

      {/* Sticky bottom bar — subtotal + Continue */}
      <View
        style={[
          styles.bottomBar,
          { paddingBottom: insets.bottom + spacing.md },
        ]}
      >
        {showFeesTaxLine ? (
          <View style={styles.feesTaxRow}>
            <Text style={styles.feesTaxLabel}>Fees &amp; tax</Text>
            <Text style={styles.feesTaxValue}>
              {formatCurrency(totals.feesTaxCents, totals.currency, true)}
            </Text>
          </View>
        ) : null}
        <View style={styles.subtotalRow}>
          <Text style={styles.subtotalLabel}>
            {dueTodayCents !== null && !totals.isEmpty && !totals.isFree
              ? "Due today"
              : "Total"}
          </Text>
          <Text style={styles.subtotalValue}>
            {totals.isEmpty
              ? "—"
              : totals.isFree
                ? "Free"
                : dueTodayCents !== null
                  ? formatCurrency(dueTodayCents, totals.currency, true)
                  : headlineAllIn}
          </Text>
        </View>
        <Button
          label={continueLabel}
          onPress={handleContinue}
          variant="primary"
          size="lg"
          fullWidth
          disabled={totals.isEmpty}
          accessibilityLabel={
            totals.isEmpty
              ? "Add a tier above"
              : totals.isFree
                ? "Reserve free spot"
                : dueTodayCents !== null
                  ? `Continue to buyer details, due today ${formatCurrency(dueTodayCents, totals.currency, true)}`
                  : `Continue to buyer details, total ${headlineAllIn}`
          }
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
    paddingTop: spacing.md,
  },
  miniCard: {
    marginBottom: spacing.lg,
  },
  miniCover: {
    height: 64,
    borderRadius: radiusTokens.md,
    marginBottom: spacing.sm,
  },
  miniTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.3,
  },
  miniSubtitle: {
    fontSize: 13,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  miniDestination: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: textTokens.tertiary,
    letterSpacing: 1.4,
    marginBottom: spacing.sm,
  },
  // Wrap each QuantityRow so spacing between tier rows stays consistent.
  // (ORCH-1130 — the per-tier passive plan card was removed.)
  tierWrap: {
    width: "100%",
  },
  emptyWrap: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  emptyTitle: {
    color: textTokens.secondary,
    fontSize: 14,
    textAlign: "center",
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
  subtotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: spacing.sm,
  },
  // ORCH-1147R2 — quiet combined "Fees & tax" line above the prominent Total
  // (full-total path only; never on the installments deposit branch).
  feesTaxRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: spacing.xs,
  },
  feesTaxLabel: {
    fontSize: 12,
    color: textTokens.tertiary,
    fontWeight: "500",
  },
  feesTaxValue: {
    fontSize: 13,
    color: textTokens.tertiary,
    fontWeight: "600",
  },
  subtotalLabel: {
    fontSize: 13,
    color: textTokens.tertiary,
    fontWeight: "500",
  },
  subtotalValue: {
    fontSize: 20,
    color: textTokens.primary,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
});
