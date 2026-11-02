/**
 * J-C1 — Tickets selection screen.
 *
 * Route: /checkout/{eventId}
 *
 * Buyer arrives from PublicEventPage's "Get tickets" CTA. They pick
 * which ticket types + quantities. Subtotal updates live. Continue
 * routes to /checkout/{eventId}/buyer.
 *
 * Hidden tickets (visibility="hidden") are filtered out at this surface
 * (Cycle 5 contract — direct-link only). Disabled / pre-sale / sales-
 * ended tickets render greyed (handled inside QuantityRow).
 *
 * Per Cycle 8 spec §4.4.
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — design-intent full-bleed checkout header: insets.bottom IS applied (line 230 + 283) for home-indicator clearance; the top status-bar overlap with back arrow / "Get tickets" header / "1 OF 3" pill is the intended banner-style buyer aesthetic. Per ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 5b operator design ruling 2026-05-17 (QA report §1) + pixel verification on iPhone 17 Pro Max sim (screenshot 18-CHECKOUT-INDEX.png).

import {
  dayLimitedLine,
  perDateLine,
  quantityPerDate,
  ticketCoversAnyDate,
} from "../../../src/components/checkout/byDateQuantities";
import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../../src/constants/designSystem";
import {
  decodeCartSeed,
  eventPublicPath,
} from "../../../src/constants/publicUrls";
import type { LiveEvent } from "../../../src/store/liveEventStore";
import type { TicketStub } from "../../../src/store/draftEventStore";
import { usePublicEventById } from "../../../src/hooks/usePublicEvents";
import { useTicketLinkUnlock } from "../../../src/hooks/useTicketLinkUnlock";
// issue #3314 — the organiser's "Hide remaining count" rule, and the query cache
// the public event page filled with the social-proof payload that carries it.
import { QueryClientContext } from "@tanstack/react-query";
import { resolveHideRemainingCount } from "@mingla/offering-rendering/remainingCountVisibility";
// issue #2160 / #2161 — occurrences ride the event payload; there is no
// occurrence query here any more.
import type { PublicEventOccurrence } from "../../../src/services/publicEventOccurrencesService";
import { formatCurrency } from "../../../src/utils/currency";
import { resolveChosenDaysLine } from "../../../src/utils/eventDateDisplay";
// ORCH-1162 Bug 3 — brand-accent for the checkout CTA, matching the public page.
import { resolveCheckoutBrandAccent } from "../../../src/utils/checkoutBrandAccent";

import { Button } from "../../../src/components/ui/Button";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { EventCoverMedia } from "../../../src/components/ui/EventCoverMedia";

import {
  useCart,
  useCartQuoteTotals,
} from "../../../src/components/checkout/CartContext";
import { CheckoutHeader } from "../../../src/components/checkout/CheckoutHeader";
import { QuantityRow } from "../../../src/components/checkout/QuantityRow";
import { JoinWaitlistSheet } from "../../../src/components/waitlist/JoinWaitlistSheet";
// ORCH-0850 [End-not-start parity systemic]: route the past gate through the
// canonical helper. Pre-0850 local `computeIsPast` used `new Date(event.date)
// + 24h < Date.now()` which fired at 8pm EDT on the start day for any
// US-Eastern event — blocking ticket purchases on still-live events (S0).
import { resolveEventCheckoutLifecycleGate } from "../../../src/utils/eventLifecycle";
import { eventAcquisitionNoticeCopy } from "@mingla/offering-rendering";
// META-ORCH-1187 LEG 2 — buyer-web funnel capture (web-only; native no-op).
import { captureWeb, gaEvent } from "../../../src/analytics/webAnalytics";
import { PrivacyChoicesLink } from "../../../src/analytics/PrivacyChoicesLink";

const CheckoutDiscountCodeField = React.lazy(() =>
  import("../../../src/components/checkout/DiscountCodeField").then(
    (module) => ({ default: module.CheckoutDiscountCodeField }),
  ),
);

const sortByDisplayOrder = (a: TicketStub, b: TicketStub): number =>
  a.displayOrder - b.displayOrder;

// Cycle 12 I-30 — door-only tiers excluded from online checkout. SUBTRACT
// before adding pattern: this filter MUST stay in place forever; door-only
// tiers exist for J-D3 (operator door sale flow) only.
const isVisibleForBuyer = (t: TicketStub): boolean =>
  t.visibility !== "hidden" && t.availableAt !== "door";

const ticketSalesEnded = (ticket: TicketStub): boolean => {
  if (ticket.saleEndAt === null) return false;
  const end = new Date(ticket.saleEndAt).getTime();
  return Number.isFinite(end) && end <= Date.now();
};

// issue #2160 — stable empty reference so a checkout with no occurrences never
// produces a new array identity per render.
const EMPTY_OCCURRENCES: readonly PublicEventOccurrence[] = [];

export default function CheckoutTicketsScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    eventId: string;
    seed?: string;
    // issue #2135 [multi-date public day picker] — the occurrence the guest
    // chose on the public page. Absent on every single-date checkout.
    eventDateId?: string;
    // issue #2160 — the DAY SET, comma-joined. The legacy single param above is
    // still read and treated as a one-element set: links minted between the
    // #2135 and #2160 deploys are live in the wild.
    eventDateIds?: string;
    ticketLink?: string;
  }>();
  const eventId = typeof params.eventId === "string" ? params.eventId : null;
  const ticketLinkToken =
    typeof params.ticketLink === "string" && params.ticketLink.length > 0
      ? params.ticketLink
      : null;
  // issue #2135 — mirrors the checkout-experience index's seed-from-route-param
  // contract exactly. null → cart.eventDateId stays null → the downstream
  // ticket-checkout-create request is byte-identical to today.
  const seedEventDateId =
    typeof params.eventDateId === "string" && params.eventDateId.length > 0
      ? params.eventDateId
      : Array.isArray(params.eventDateId) &&
          typeof params.eventDateId[0] === "string" &&
          params.eventDateId[0].length > 0
        ? params.eventDateId[0]
        : null;
  // issue #2160 — the chosen day SET, with the #2135 single param as the
  // documented legacy fallback (SC-14). Memoised so the seeding effect below
  // does not re-run on every render with a fresh array identity.
  const seedEventDateIdsRaw =
    typeof params.eventDateIds === "string"
      ? params.eventDateIds
      : Array.isArray(params.eventDateIds)
        ? (params.eventDateIds[0] ?? "")
        : "";
  const seedEventDateIds = useMemo<readonly string[]>(() => {
    const fromSet = seedEventDateIdsRaw
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    if (fromSet.length > 0) return fromSet;
    return seedEventDateId !== null ? [seedEventDateId] : [];
  }, [seedEventDateIdsRaw, seedEventDateId]);
  // ORCH-1167 [event-page-canonical] — the inline-ticket-box selection carried
  // from the public event page (`seed=id:qty,id:qty`). Seeds the cart ONCE on mount
  // so this cart step (i) lands PRE-POPULATED + editable (replaces the empty
  // tier-PICKER). Decode is null-safe (empty seed → empty map → unchanged path).
  const seedParam =
    typeof params.seed === "string"
      ? params.seed
      : Array.isArray(params.seed)
        ? params.seed[0]
        : undefined;

  const publicEventQuery = usePublicEventById(eventId);
  const ticketLink = useTicketLinkUnlock(ticketLinkToken, eventId);
  const event = publicEventQuery.data?.event ?? null;
  const brand = publicEventQuery.data?.brand ?? null;
  // issue #3314 — the bundle behind this step does not carry the organiser's
  // settings. The event page a guest arrives from has already read the
  // social-proof payload that does, under `socialProofKeys.summary(eventId)`
  // (= ["socialProof", eventId]); read that cache entry rather than issue a
  // second request. A deep link straight here has no entry: fail-closed, no
  // "N left" caption. `useContext` tolerates a missing provider, like the
  // Recent writer does.
  const queryClient = useContext(QueryClientContext);
  const cachedSocialProof =
    eventId === null
      ? undefined
      : queryClient?.getQueryData<{ hideRemainingCount: boolean } | null>([
          "socialProof",
          eventId,
        ]);
  // Follow-up (migration 20270704003314): the bundle behind this step now carries
  // the setting itself, public or unlisted, so a deep link straight here can show
  // an allowed count without the event page's cache. The cached social proof is
  // the fallback for a payload from before the migration.
  const hideRemainingCount = resolveHideRemainingCount({
    organiserSetting: event?.hideRemainingCount === true ? true : null,
    bundleSetting: publicEventQuery.data?.hideRemainingCount ?? null,
    socialProof: cachedSocialProof,
  });
  // ORCH-1162 Bug 3 — the CTA brand accent (same source/derivation as the public
  // page button: brand theme_color + event theme_color_override). undefined while
  // loading → Button keeps the default Mingla orange (no flash of wrong color).
  const ctaAccent =
    event !== null
      ? (resolveCheckoutBrandAccent({
          brandTheme: brand?.theme ?? null,
          eventThemeOverrides: event.themeOverrides ?? null,
        }) ?? undefined)
      : undefined;

  const {
    lines,
    quoteStatus,
    eventDateIds,
    setLineQuantity,
    setEventDateId,
    setEventDateIds,
  } = useCart();
  const totals = useCartQuoteTotals();
  const [waitlistTicketId, setWaitlistTicketId] = useState<string | null>(null);
  // #3281 / #4204 — this choice belongs only to the deferred ticket-selection
  // route. Keeping it out of the root CartProvider prevents host-only UI state
  // from inflating every Business web boot. Cart lines remain the cross-step
  // authority: a byDate map means uneven quantities; no map means uniform.
  const [sameTicketsForEveryDate, setSameTicketsForEveryDate] = useState(
    () => lines.every((line) => line.byDate === undefined),
  );

  const handleSameTicketsForEveryDate = useCallback(
    (on: boolean): void => {
      setSameTicketsForEveryDate(on);
      for (const line of lines) {
        const validIds = publicEventQuery.data?.event?.tickets.find(
          (ticket) => ticket.id === line.ticketTypeId,
        )?.validOccurrenceIds;
        const perDate = quantityPerDate(line);
        setLineQuantity({
          ticketTypeId: line.ticketTypeId,
          ticketName: line.ticketName,
          unitPrice: line.unitPrice,
          unitPriceGbp: line.unitPriceGbp,
          unitPriceAllIn: line.unitPriceAllIn,
          currency: line.currency,
          isFree: line.isFree,
          paymentPlanChoice: line.paymentPlanChoice,
          ...(on
            ? dayLimitedLine(
                validIds,
                perDate,
                eventDateIds,
                publicEventQuery.data?.multiDatePricingMode !== "all_days",
              )
            : perDateLine(validIds, perDate, eventDateIds)),
        });
      }
    },
    [eventDateIds, lines, publicEventQuery.data, setLineQuantity],
  );

  // issue #2135 — seed the chosen occurrence into the cart (the SAME pattern the
  // experience cart uses). From here the existing chain owns it:
  // CartContext.eventDateId → createTicketCheckout({ eventDateId }) →
  // orders.event_date_id (#1188). No new plumbing was added.
  useEffect(() => {
    setEventDateId(seedEventDateId);
  }, [seedEventDateId, setEventDateId]);

  // issue #2160 — seed the chosen day SET. From here the existing chain owns
  // it: CartContext.eventDateIds -> createTicketCheckout({ eventDateIds }) ->
  // ticket_checkout_session_event_dates -> ticket_event_dates.
  useEffect(() => {
    setEventDateIds(seedEventDateIds);
  }, [seedEventDateIds, setEventDateIds]);

  // issue #2135 — resolve the chosen occurrence so step 1 of 3 shows the day the
  // guest actually picked instead of repeating the master date. `enabled` is
  // false whenever no occurrence was chosen, so a single-date checkout issues
  // ZERO extra network and renders the unchanged master date line.
  // issue #2160 / #2161 — the occurrences ride the event payload now (same
  // reader that served the event), so this step issues NO extra query at all
  // and an UNLISTED event's day label resolves exactly like a public one's.
  const occurrences = publicEventQuery.data?.occurrences ?? EMPTY_OCCURRENCES;
  const chosenOccurrences = useMemo(
    () =>
      occurrences
        .filter((o) => seedEventDateIds.includes(o.id))
        .slice()
        .sort((a, b) => a.startAt.localeCompare(b.startAt)),
    [occurrences, seedEventDateIds],
  );
  // issue #2160 — the mini-card subtitle names the day(s) the guest actually
  // chose. One day -> today's single label; two -> "Sat 22 Aug + Sun 23 Aug";
  // three or more -> "3 days · Sat 22 Aug – Mon 24 Aug".
  //
  // issue #2338 — that wording used to be a PRIVATE useMemo right here, which
  // is why the confirmation screen two steps later could not reuse it and
  // printed "Date TBD" over a guest's own two-day order. It now lives in
  // `eventDateDisplay.ts`, the I-14 single owner of event date display, and
  // BOTH steps call `resolveChosenDaysLine`. The string this renders is
  // unchanged; only its address moved.
  //
  // The fallback also stopped being `formatDraftDateLine(event)` alone: on a
  // multi-date event reached WITHOUT a chosen day (a bare `/checkout/{id}`
  // link) that returned "Date TBD" on this step too, because the public reader
  // strips the organiser's draft `multiDates`. It now falls through to the
  // event's REAL first day — the same line the public page shows — and only
  // reaches "Date TBD" when the event genuinely has no readable date.
  const dayLine =
    event !== null
      ? resolveChosenDaysLine(event, occurrences, seedEventDateIds)
      : "";
  // issue #2160 §7(c) — say the multiplier in words BEFORE the total. The
  // floating bar must never be the first place the guest learns the price
  // doubled.
  const pricingMode = publicEventQuery.data?.multiDatePricingMode ?? "per_day";
  const dayCount = chosenOccurrences.length;
  const cartHasPaidLine = lines.some((l) => (l.unitPriceAllIn ?? 0) > 0);
  const multiDayNote = useMemo<string | null>(() => {
    if (dayCount < 2) return null;
    if (cartHasPaidLine) {
      return pricingMode === "all_days"
        ? `You're attending ${dayCount} days. One price covers all of them.`
        : `You're attending ${dayCount} days. Tickets are priced per day.`;
    }
    return pricingMode === "all_days"
      ? `You're attending ${dayCount} days. You'll get 1 pass that works on all of them.`
      : `You're attending ${dayCount} days. You'll get ${dayCount} passes, one per day.`;
  }, [dayCount, cartHasPaidLine, pricingMode]);

  // META-ORCH-1187 LEG 2 — fire `web_checkout_started` once the buyer lands on
  // the cart and the event resolves (begin of the web purchase funnel). PostHog
  // + GA4 `begin_checkout` for the Ads link. Web-only (no-op on native).
  const checkoutStartedRef = useRef<boolean>(false);
  useEffect(() => {
    if (checkoutStartedRef.current) return;
    if (eventId === null) return;
    checkoutStartedRef.current = true;
    captureWeb("web_checkout_started", {
      event_id: eventId,
      offering_type: "event",
    });
    gaEvent("begin_checkout", { event_id: eventId });
  }, [eventId]);

  // ORCH-1167 [event-page-canonical] — seed the cart from the inline-box selection
  // carried in the `seed` param, ONCE, after the event (and its tickets) resolve.
  // Quantities remain fully editable here (the QuantityRows below own them). The
  // all-in (priceAllInGbp) is seeded as the headline-Total basis (WYSIWYP), exactly
  // like the QuantityRow onChange path — never fabricated.
  const seededRef = useRef<boolean>(false);
  useEffect(() => {
    if (seededRef.current) return;
    const ev = publicEventQuery.data?.event ?? null;
    if (ev === null) return;
    const seedMap = decodeCartSeed(seedParam);
    seededRef.current = true; // mark even on empty seed so re-renders don't re-seed.
    if (Object.keys(seedMap).length === 0) return;
    const seedTickets =
      ticketLinkToken === null
        ? ev.tickets
        : ticketLink.ticket === null
          ? []
          : [ticketLink.ticket];
    if (ticketLinkToken !== null && ticketLink.loading) return;
    for (const ticket of seedTickets) {
      const qty = seedMap[ticket.id];
      if (qty === undefined || qty <= 0) continue;
      if (ticket.availableAt === "door") continue;
      // issue #3281 — a ticket that no longer covers the chosen dates has no row.
      if (!ticketCoversAnyDate(ticket.validOccurrenceIds, seedEventDateIds)) continue;
      setLineQuantity({
        ticketTypeId: ticket.id,
        ticketName: ticket.name,
        unitPrice: ticket.priceGbp ?? 0,
        unitPriceAllIn: ticket.priceAllInGbp ?? ticket.priceGbp ?? 0,
        currency: ticket.currency ?? ev.currency ?? "GBP",
        isFree: ticket.isFree,
        ...dayLimitedLine(
          ticket.validOccurrenceIds,
          qty,
          seedEventDateIds,
          publicEventQuery.data?.multiDatePricingMode !== "all_days",
        ),
      });
    }
  }, [
    publicEventQuery.data,
    seedEventDateIds,
    seedParam,
    setLineQuantity,
    ticketLink.loading,
    ticketLink.ticket,
    ticketLinkToken,
  ]);

  // ORCH-1147R2 — the selection bottom bar leads with the server fee-grossed
  // all-in (totals.allInTotal), NOT the bare base subtotal (totals.total), so
  // the lead number matches the public page. The combined "Fees & tax" line
  // renders only on a real pass-fee delta (never split service-fee + VAT;
  // feedback_cart_combined_fees_tax_line). I-PROPOSED-1147R2-SELECTION-SHOWS-ALLIN.
  // ORCH-1152 — guard the empty cart: on mount the cart is empty and
  // useCartQuoteTotals() returns currency "", which crashed formatCurrency
  // (RangeError: Currency is invalid). Pass a safe code on the empty cart so the
  // computation never feeds "" into Intl. headlineAllIn is only DISPLAYED when
  // !isEmpty anyway. (formatCurrency is ALSO hardened against blank codes —
  // defense in depth; the explicit guard here does not rely on it.)
  const headlineAllIn = formatCurrency(
    totals.allInTotal,
    totals.isEmpty ? "GBP" : totals.currency,
  );
  const showFeesTaxLine =
    !totals.isEmpty && !totals.isFree && totals.hasFeesTaxDelta;

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
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

  const handleContinue = useCallback((): void => {
    if (eventId === null || totals.isEmpty) return;
    const tokenParam =
      ticketLinkToken === null
        ? ""
        : `?ticketLink=${encodeURIComponent(ticketLinkToken)}`;
    router.push(`/checkout/${eventId}/buyer${tokenParam}` as never);
  }, [router, eventId, ticketLinkToken, totals.isEmpty]);

  // ----- Event-not-found / past / cancelled empty state -----
  if (
    publicEventQuery.isLoading ||
    publicEventQuery.isFetching ||
    ticketLink.loading
  ) {
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={0}
          totalSteps={3}
          title="Get tickets"
          onBack={handleBack}
        />
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Loading tickets...</Text>
        </View>
      </View>
    );
  }

  if (publicEventQuery.isError) {
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={0}
          totalSteps={3}
          title="Get tickets"
          onBack={handleBack}
        />
        <View style={styles.emptyWrap}>
          <EmptyState
            illustration="ticket"
            title="Tickets could not load"
            description="Refresh this page or try the event link again."
            cta={{ label: "Back", onPress: handleBack }}
          />
        </View>
      </View>
    );
  }

  if (event === null) {
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={0}
          totalSteps={3}
          title="Get tickets"
          onBack={handleBack}
        />
        <View style={styles.emptyWrap}>
          <EmptyState
            illustration="ticket"
            title="Event not found"
            description="This link may be expired or moved."
            cta={{ label: "Back", onPress: handleBack }}
          />
        </View>
      </View>
    );
  }

  const visibleTickets =
    ticketLinkToken === null
      ? event.tickets.filter(isVisibleForBuyer).slice().sort(sortByDisplayOrder)
      : ticketLink.ticket === null
        ? []
        : [ticketLink.ticket];

  const checkoutLifecycle = resolveEventCheckoutLifecycleGate(
    event,
    publicEventQuery.data?.terminalSource ?? {
      kind: "occurrences",
      value: null,
    },
  );
  const unavailableCopy =
    checkoutLifecycle.kind === "unavailable"
      ? eventAcquisitionNoticeCopy(
          checkoutLifecycle.acquisitionState,
          "event",
          brand?.displayName ?? "Mingla",
        )
      : null;
  const allSoldOut =
    visibleTickets.length > 0 &&
    visibleTickets.every((t) => !t.isUnlimited && (t.capacity ?? 0) <= 0);
  const hasWaitlistSoldOut = visibleTickets.some(
    (t) => !t.isUnlimited && (t.capacity ?? 0) <= 0 && t.waitlistEnabled,
  );
  const allUnavailable =
    visibleTickets.length > 0 &&
    visibleTickets.every(
      (t) =>
        t.visibility === "disabled" ||
        ticketSalesEnded(t) ||
        (!t.isUnlimited && (t.capacity ?? 0) <= 0),
    );
  const waitlistTicket =
    visibleTickets.find((ticket) => ticket.id === waitlistTicketId) ?? null;

  if (checkoutLifecycle.kind === "unavailable" && unavailableCopy !== null) {
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={0}
          totalSteps={3}
          title="Get tickets"
          onBack={handleBack}
        />
        <View style={styles.emptyWrap}>
          <EmptyState
            illustration="ticket"
            title={unavailableCopy.heading}
            description={unavailableCopy.body}
            cta={{ label: "Back to event", onPress: handleBack }}
          />
        </View>
      </View>
    );
  }

  if (
    checkoutLifecycle.kind === "closed" ||
    visibleTickets.length === 0 ||
    (allSoldOut && !hasWaitlistSoldOut) ||
    (allUnavailable && !hasWaitlistSoldOut)
  ) {
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={0}
          totalSteps={3}
          title="Get tickets"
          onBack={handleBack}
        />
        <View style={styles.emptyWrap}>
          <EmptyState
            illustration="ticket"
            title={
              checkoutLifecycle.kind === "closed" || allUnavailable
                ? "This event isn't taking new tickets"
                : "Sold out"
            }
            description={
              checkoutLifecycle.kind === "closed" || allUnavailable
                ? "Sales are closed for this event."
                : "All tickets for this event are gone."
            }
            cta={{ label: "Back to event", onPress: handleBack }}
          />
        </View>
      </View>
    );
  }

  const continueLabel = totals.isFree ? "Reserve free ticket" : "Continue";
  const saleNameByLineRef = Object.fromEntries(
    visibleTickets.map((ticket) => [ticket.id, ticket.saleName ?? "sale"]),
  );

  return (
    <View style={styles.host}>
      <CheckoutHeader
        stepIndex={0}
        totalSteps={3}
        title="Get tickets"
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
        {/* Event mini-card: cover hue band + name + date line */}
        <View style={styles.miniCard}>
          <EventCoverMedia
            hue={event.coverHue}
            mediaUrl={event.coverMediaUrl}
            mediaType={event.coverMediaType}
            radius={0}
            label=""
            style={styles.miniCover}
          />
          <Text style={styles.miniTitle} numberOfLines={2}>
            {event.name.trim().length > 0 ? event.name : "Untitled event"}
          </Text>
          {/* issue #2135 — when the guest picked a day on the public page, step 1
              of 3 names THAT day instead of repeating the master date.
              issue #2338 — and when they did NOT pick one, this now names the
              event's REAL first day rather than "Date TBD": the public reader
              strips the organiser's draft days, so the old fallback was blind on
              exactly the events that have more than one. Still never a
              fabricated day — an event with no readable date says "Date TBD". */}
          <Text
            testID="issue-2338-cart-date-line"
            style={styles.miniSubtitle}
            numberOfLines={1}
          >
            {brand?.displayName ?? "Mingla"}
            {" · "}
            {dayLine}
          </Text>
        </View>

        <Text style={styles.sectionLabel}>Select your tickets</Text>

        {eventDateIds.length >= 2 ? (
          <View
            style={styles.sameTicketsRow}
            testID="issue-3281-same-tickets-switch"
          >
            <Text style={styles.sameTicketsLabel}>
              Same tickets for every date
            </Text>
            <Switch
              value={sameTicketsForEveryDate}
              onValueChange={handleSameTicketsForEveryDate}
              accessibilityLabel="Same tickets for every date"
            />
          </View>
        ) : null}

        {eventDateIds.length >= 2 && !sameTicketsForEveryDate
          ? eventDateIds.map((dateId) => {
              const occ = occurrences.find((o) => o.id === dateId);
              const dateLabel =
                occ != null
                  ? new Date(occ.startAt).toLocaleDateString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })
                  : "This date";
              return (
                <View key={dateId} style={styles.perDateBlock}>
                  <Text style={styles.perDateHeading}>{dateLabel}</Text>
                  {visibleTickets
                    .filter((ticket) =>
                      ticketCoversAnyDate(ticket.validOccurrenceIds, [dateId]),
                    )
                    .map((ticket) => {
                    const line = lines.find((l) => l.ticketTypeId === ticket.id);
                    const qty = line?.byDate?.[dateId] ?? 0;
                    const maxHint =
                      ticket.maxPurchaseQty != null && ticket.maxPurchaseQty > 0
                        ? `Up to ${ticket.maxPurchaseQty} per date`
                        : null;
                    return (
                      <View key={`${dateId}-${ticket.id}`}>
                        {maxHint != null ? (
                          <Text style={styles.perDateHint}>{maxHint}</Text>
                        ) : null}
                        <QuantityRow
                          ticket={ticket}
                          quantity={qty}
                          hideRemainingCount={hideRemainingCount}
                          onJoinWaitlist={setWaitlistTicketId}
                          onQuantityChange={(next): void => {
                            const nextByDate = {
                              ...(line?.byDate ?? {}),
                              [dateId]: next,
                            };
                            if (next <= 0) delete nextByDate[dateId];
                            const sum = Object.values(nextByDate).reduce(
                              (a, b) => a + (Number(b) || 0),
                              0,
                            );
                            setLineQuantity({
                              ticketTypeId: ticket.id,
                              ticketName: ticket.name,
                              unitPrice: ticket.priceGbp ?? 0,
                              unitPriceAllIn:
                                ticket.priceAllInGbp ?? ticket.priceGbp ?? 0,
                              currency:
                                ticket.currency ?? event.currency ?? "GBP",
                              isFree: ticket.isFree,
                              quantity: sum,
                              byDate: nextByDate,
                            });
                          }}
                        />
                      </View>
                    );
                  })}
                </View>
              );
            })
          : visibleTickets
              .filter((ticket) =>
                ticketCoversAnyDate(ticket.validOccurrenceIds, eventDateIds),
              )
              .map((ticket) => {
              const line = lines.find((l) => l.ticketTypeId === ticket.id);
              const qty = line === undefined ? 0 : quantityPerDate(line);
              const maxHint =
                eventDateIds.length >= 2 &&
                ticket.maxPurchaseQty != null &&
                ticket.maxPurchaseQty > 0
                  ? `Up to ${ticket.maxPurchaseQty} per date`
                  : null;
              return (
                <View key={ticket.id}>
                  {maxHint != null ? (
                    <Text style={styles.perDateHint}>{maxHint}</Text>
                  ) : null}
                  <QuantityRow
                    ticket={ticket}
                    quantity={qty}
                    hideRemainingCount={hideRemainingCount}
                    onJoinWaitlist={setWaitlistTicketId}
                    onQuantityChange={(next): void =>
                      setLineQuantity({
                        ticketTypeId: ticket.id,
                        ticketName: ticket.name,
                        unitPrice: ticket.priceGbp ?? 0,
                        // ORCH-1147 — seed the server fee-grossed all-in
                        // (priceAllInGbp, from pg_public_event_tier_allin) as the
                        // headline-Total basis; fall back to base when the tier has
                        // no all-in (free / RPC miss — never fabricate).
                        unitPriceAllIn:
                          ticket.priceAllInGbp ?? ticket.priceGbp ?? 0,
                        currency: ticket.currency ?? event.currency ?? "GBP",
                        isFree: ticket.isFree,
                        ...dayLimitedLine(
                          ticket.validOccurrenceIds,
                          next,
                          eventDateIds,
                          pricingMode === "per_day",
                        ),
                      })
                    }
                  />
                </View>
              );
            })}
        {/* #2331 — end of content: reopens the privacy bar. */}
        <PrivacyChoicesLink />
      </ScrollView>

      {/* Sticky bottom bar — subtotal + Continue */}
      <View
        style={[
          styles.bottomBar,
          { paddingBottom: insets.bottom + spacing.md },
        ]}
      >
        <React.Suspense fallback={null}>
          <CheckoutDiscountCodeField
            surface="web_event"
            disabled={totals.isEmpty}
            saleNameByLineRef={saleNameByLineRef}
          />
        </React.Suspense>
        {showFeesTaxLine ? (
          <View style={styles.feesTaxRow}>
            <Text style={styles.feesTaxLabel}>Fees &amp; tax</Text>
            <Text style={styles.feesTaxValue}>
              {formatCurrency(totals.feesTaxCents, totals.currency, true)}
            </Text>
          </View>
        ) : null}
        <View style={styles.subtotalRow}>
          <Text style={styles.subtotalLabel}>Total</Text>
          <Text style={styles.subtotalValue}>
            {totals.isEmpty ? "—" : totals.isFree ? "Free" : headlineAllIn}
          </Text>
        </View>
        <Button
          label={continueLabel}
          onPress={handleContinue}
          variant="primary"
          accentColor={ctaAccent}
          size="lg"
          fullWidth
          disabled={totals.isEmpty || quoteStatus !== "ready"}
          accessibilityLabel={
            totals.isEmpty
              ? "Add tickets above"
              : quoteStatus !== "ready"
                ? "Waiting for your latest total"
                : totals.isFree
                  ? "Reserve free ticket"
                  : `Continue to buyer details, total ${headlineAllIn}`
          }
        />
      </View>

      <JoinWaitlistSheet
        visible={waitlistTicket !== null}
        eventId={event.id}
        ticket={waitlistTicket}
        onClose={() => setWaitlistTicketId(null)}
        currency={event.currency ?? null}
      />
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
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: textTokens.tertiary,
    letterSpacing: 1.4,
    marginBottom: spacing.sm,
  },
  sameTicketsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
    paddingVertical: spacing.xs,
  },
  sameTicketsLabel: {
    flex: 1,
    paddingRight: spacing.md,
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.primary,
  },
  perDateBlock: {
    marginBottom: spacing.md,
  },
  perDateHeading: {
    fontSize: 14,
    fontWeight: "700",
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  perDateHint: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginBottom: 4,
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
  // ORCH-1147R2 — quiet combined "Fees & tax" line above the prominent Total.
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
