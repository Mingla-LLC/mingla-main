/**
 * ExpandedBusinessEventSheet — consumer-side sheet that renders the
 * SHARED PublicEventPage from @mingla/event-rendering.
 *
 * Per META-ORCH-0827 Pass 2 Step 10. Replaces the prior InAppBrowserModal
 * approach. The sheet now renders the EXACT same layout as the
 * mingla-business public event page and triggers native Stripe
 * PaymentSheet for paid tickets (no browser, no external link).
 *
 * Architecture:
 *   - BusinessEventCard (consumer Discover payload) → mapped to
 *     PublicEventProps for the shared component
 *   - usePublicEventTickets fetches the event's ticket types
 *   - useNativeCheckoutFlow handles Stripe PaymentSheet on Buy / Get Free
 *   - Pre-fills buyer info from authenticated profile (name, email, phone)
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Linking,
  Platform,
  StyleSheet,
  View,
  type ScrollViewProps,
} from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";

import {
  type PublicBrandProps,
  type CtaState,
  type PublicEventCallbacks,
  PublicEventPage,
  type PublicEventProps,
  type ViewerRole,
  computeOfferingVariant,
  resolveOfferingCta,
  resolveTheme,
} from "@mingla/event-rendering";

import { useQueryClient } from "@tanstack/react-query";

import type { BusinessEventCard } from "../../types/mergedDiscover";
// ORCH-0877 — centralized consumer-side date formatter.
import { formatEventDateLine } from "../../utils/eventDateDisplay";
import { useAppStore } from "../../store/appStore";
import { usePublicEventTickets } from "../../hooks/usePublicEventTickets";
import { useTripIntakeSchemas } from "../../hooks/useTripIntakeSchemas";
import { useEventTheme } from "../../hooks/useEventTheme";
import { circleKeys } from "../../hooks/queryKeys";
import {
  type NativeCheckoutOutcome,
  useNativeCheckoutFlow,
} from "../../payments/nativeCheckoutFlow";
import { toastManager } from "../ui/Toast";
// META-ORCH-0991 (sheet rework — Bug 2): import the gorhom scroll host re-export
// from the primitive (the sole permitted gorhom importer) and inject it into the
// shared PublicEventPage so the event body has a SINGLE gorhom-aware scroll host
// instead of a raw RN ScrollView nested inside the sheet's gorhom scroll (the
// fragile double-scroll structure that was the probable freeze source).
import { BaseBottomSheet, BottomSheetScrollView } from "../ui/BaseBottomSheet";
import { glass } from "../../constants/designSystem";
// ORCH-0847 Phase C — multi-tier cart sheet replaces the single-ticket
// TicketClaimConfirmModal. Mirrors public J-C1 cart screen.
import TicketCartSheet, {
  type TicketCartCheckoutPayload,
} from "./TicketCartSheet";
// ORCH-1072 — experience occurrence picker (PICK FROM UPCOMING DATES) +
// the multi-stop itinerary section rendered beneath the cover/description.
import {
  ExperienceOccurrencePicker,
  type ExperienceOccurrence,
} from "./ExperienceOccurrencePicker";
import { ExperienceItinerary } from "./ExperienceItinerary";
// ORCH-1117 — the floating Buy bar pinned at the END of the sheet's bare scroll
// (F-B scroll-sibling, NEVER stickyFooter). State from the shared
// resolveOfferingCta (one owner).
import { FloatingOfferingBar } from "../offering/FloatingOfferingBar";

interface ExpandedBusinessEventSheetProps {
  visible: boolean;
  data: BusinessEventCard;
  onClose: () => void;
  bottomContentInset?: number;
  bottomSheetInset?: number;
  /**
   * ORCH-1130 [public trip page payment-structure] / DISC-1130-A — for a plan
   * trip, the buyer's explicit pay-full vs pay-over-time choice picked on
   * ConsumerTripDetailScreen. Forwarded straight into runNativeCheckout →
   * ticket-checkout-create's `payment_plan_choice`. Undefined for non-trip
   * callers (events/experiences) and no-plan trips → request byte-identical.
   */
  paymentPlanChoice?: "full" | "installments";
}

// ORCH-0828 REWORK: canonical bottomSheet snapPoints from design tokens,
// matching the TM/place path at ExpandedCardModal.tsx:1606. Two snap points
// give the user a natural 50% preview + 90% full gesture.
const SHEET_SNAP_POINTS = glass.bottomSheet.snapPoints as unknown as (
  | string
  | number
)[];
const SHEET_INITIAL_INDEX = 1; // open at the 90% snap (full view)

// ORCH-0877 — formatDateLine replaced by centralized `formatEventDateLine`
// from app-mobile/src/utils/eventDateDisplay.ts. The shared helper renders
// cross-midnight events with weekday prefix on both sides (Sat 18 May ·
// 10 PM – Sun 19 May · 2 AM) and same-day events as a single inline range.

// ORCH-0846: exported so the regression test suite can verify the mapping
// in isolation (the BottomSheet host is not mountable in Jest).
export const mapCardToPublicEvent = (
  card: BusinessEventCard,
  tickets: PublicEventProps["tickets"],
): PublicEventProps => ({
  id: card.eventId,
  name: card.title,
  brandId: card.brandId,
  brandSlug: card.brandSlug,
  eventSlug: card.eventSlug,
  description: card.description ?? "",
  dateLine: formatEventDateLine({
    masterDateUtc: card.masterDateUtc,
    masterEndAtUtc: card.masterEndAtUtc,
    timezone: card.timezone,
  }),
  dateSubline: null,
  // ORCH-1072 — for a brand experience with upcoming occurrences, render the
  // real upcoming dates in PublicEventPage's existing dates list (the consumer
  // sheet previously hardcoded []). Events/trips (no upcomingOccurrences) keep
  // the empty list → unchanged. Multi-date booking happens via the dedicated
  // occurrence picker that opens on the Book tap (operator-locked flow).
  datesList: Array.isArray(card.upcomingOccurrences)
    ? card.upcomingOccurrences
        .map((o) => {
          const d = new Date(o.startAt);
          if (Number.isNaN(d.getTime())) return null;
          try {
            return new Intl.DateTimeFormat(undefined, {
              weekday: "short",
              day: "numeric",
              month: "short",
              hour: "numeric",
              minute: "2-digit",
              timeZone: card.timezone || "UTC",
            }).format(d);
          } catch {
            return new Intl.DateTimeFormat(undefined, {
              weekday: "short",
              day: "numeric",
              month: "short",
              hour: "numeric",
              minute: "2-digit",
            }).format(d);
          }
        })
        .filter((s): s is string => s !== null)
    : [],
  status: "published",
  endedAt: null,
  // ORCH-0846: honor server-derived format instead of hardcoding "in-person".
  // Online events now render the online card at PublicEventPage.tsx:391
  // instead of an empty venue card; hybrid events render the
  // "{address} · also online" suffix.
  format: card.format,
  venueName: card.venueName,
  address: card.address,
  hideAddressUntilTicket: card.hideAddressUntilTicket,
  coverHue: card.coverHue,
  coverMediaUrl: card.coverMediaUrl,
  coverMediaType:
    card.coverMediaType === "image" ||
    card.coverMediaType === "video" ||
    card.coverMediaType === "gif"
      ? card.coverMediaType
      : null,
  coverCredit: null,
  tickets,
  currency: card.currency,
});

const mapCardToPublicBrand = (card: BusinessEventCard): PublicBrandProps => ({
  id: card.brandId,
  slug: card.brandSlug,
  displayName: card.brandName,
  photo: card.brandProfilePhotoUrl ?? undefined,
});

const openMapsForQuery = (query: string): void => {
  const encoded = encodeURIComponent(query);
  const googleUrl = `https://www.google.com/maps/search/?api=1&query=${encoded}`;
  const platformUrl =
    Platform.OS === "ios"
      ? `maps://?q=${encoded}`
      : Platform.OS === "android"
        ? `geo:0,0?q=${encoded}`
        : googleUrl;

  void Linking.openURL(platformUrl).catch(() => {
    void Linking.openURL(googleUrl).catch(() => undefined);
  });
};

export const ExpandedBusinessEventSheet: React.FC<
  ExpandedBusinessEventSheetProps
> = ({
  visible,
  data,
  onClose,
  bottomContentInset = 32,
  bottomSheetInset = 0,
  paymentPlanChoice,
}) => {
  const router = useRouter();
  const user = useAppStore((s) => s.user);
  const profile = useAppStore((s) => s.profile);
  const queryClient = useQueryClient();

  const [checkoutInFlight, setCheckoutInFlight] = useState<boolean>(false);
  // ORCH-0847 Phase C — multi-tier cart sheet visibility + seed.
  // On Buy/Get Free tap, the tier id seeds the cart sheet at quantity 1 and
  // opens it. The sheet renders as a sibling fragment alongside the parent
  // BottomSheet (per memory feedback_rn_sub_sheet_must_render_inside_parent
  // — same return fragment, separate <BottomSheet> roots).
  const [cartSheetVisible, setCartSheetVisible] = useState<boolean>(false);
  const [initialTicketTypeId, setInitialTicketTypeId] = useState<string | null>(
    null,
  );
  // ORCH-1072 — occurrence-picker state. For a brand experience with >1 upcoming
  // occurrence, the Book tap opens the date picker; the chosen event_date_id is
  // threaded into ticket-checkout-create. A one-off experience auto-selects its
  // single date and skips the picker. Events/trips (no upcomingOccurrences)
  // never touch this state → unchanged path.
  const [occurrencePickerVisible, setOccurrencePickerVisible] =
    useState<boolean>(false);
  const [selectedEventDateId, setSelectedEventDateId] = useState<string | null>(
    null,
  );

  // ORCH-1072 — the experience's bookable upcoming occurrences (undefined for
  // events/trips). Sold-out occurrences (remaining === 0) are excluded from the
  // auto-select / "single occurrence" logic but still shown disabled in the
  // picker so the buyer sees them.
  const occurrences: ExperienceOccurrence[] = useMemo(
    () =>
      Array.isArray(data.upcomingOccurrences) ? data.upcomingOccurrences : [],
    [data.upcomingOccurrences],
  );
  const bookableOccurrences = useMemo(
    () => occurrences.filter((o) => o.remaining === null || o.remaining > 0),
    [occurrences],
  );

  const ticketsQuery = usePublicEventTickets(visible ? data.eventId : null);
  const themeQuery = useEventTheme(visible ? data : null);
  // ORCH-1016 REWORK (D2) — per-tier trip intake schemas. Empty Map when the
  // trip requires no intake (the common case → no intake step renders).
  const intakeSchemasQuery = useTripIntakeSchemas(
    visible ? data.eventId : null,
  );
  const runNativeCheckout = useNativeCheckoutFlow();

  // ORCH-0828 REWORK: diagnostic log only. Sheet open/close is driven by
  // the declarative `index={visible ? SHEET_INITIAL_INDEX : -1}` prop on
  // the inline `<BottomSheet>` JSX below — no `present()` / `dismiss()`
  // ref dance needed. Matches the proven TM/place sheet pattern at
  // ExpandedCardModal.tsx:1602-2066.
  useEffect(() => {
    console.log(
      "[ExpandedBusinessEventSheet] visible=",
      visible,
      "eventId=",
      data.eventId,
    );
  }, [visible, data.eventId]);

  // META-ORCH-0991 Wave A — diagnostic-only onChange passthrough. BaseBottomSheet
  // already routes index===-1 → onClose internally (and then calls this), so this
  // MUST NOT call onClose again or it double-fires (SPEC §3.1 / §9 blast #4).
  // The log keeps the ORCH-0828 index-transition trace for live-fire.
  const handleSheetChange = useCallback((index: number): void => {
    console.log("[ExpandedBusinessEventSheet] onChange index=", index);
  }, []);

  const publicEvent = useMemo(
    () => mapCardToPublicEvent(data, ticketsQuery.data ?? []),
    [data, ticketsQuery.data],
  );
  const publicBrand = useMemo(() => mapCardToPublicBrand(data), [data]);

  // Consumer is a buyer, never the organizer of a business event.
  const viewerRole: ViewerRole = "anonymous";

  // ORCH-0847 Phase C — multi-tier checkout. The cart sheet emits a
  // `TicketCartCheckoutPayload` with all lines + marketingOptIn + totalCents.
  // We compose the buyer info from auth profile (pre-fill, read-only on the
  // sheet) and hand the lines + marketing-opt-in directly to
  // `runNativeCheckout` which forwards them to `ticket-checkout-create`.
  const handleBuy = useCallback(
    async (payload: TicketCartCheckoutPayload) => {
      if (checkoutInFlight) return;
      if (user === null) {
        toastManager.show("Please sign in to get tickets.", "warning");
        return;
      }
      const buyerName =
        profile?.display_name?.trim() || user.email?.split("@")[0] || "Guest";
      const buyerEmail = user.email ?? profile?.email ?? "";
      const buyerPhone = profile?.phone ?? "";

      if (buyerEmail.length === 0) {
        toastManager.show(
          "We need an email on your profile to issue tickets.",
          "warning",
        );
        return;
      }
      if (buyerPhone.length === 0) {
        toastManager.show(
          "Add a phone number to your profile to get tickets.",
          "warning",
        );
        return;
      }

      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setCheckoutInFlight(true);

      let result: NativeCheckoutOutcome;
      try {
        result = await runNativeCheckout({
          eventId: data.eventId,
          lines: payload.lines,
          buyer: {
            name: buyerName,
            email: buyerEmail,
            phone: buyerPhone,
            marketingOptIn: payload.marketingOptIn,
          },
          // ORCH-1025 [Seamless native cart] — no `taxCalculationId` and no
          // `address` are sent: tax is computed server-side from the venue
          // (ticket-checkout-create v130). nativeCheckoutFlow already accepts the
          // address-less / taxCalculationId-less path (the field is optional and
          // omitted from the request body when absent).
          // ORCH-1016 REWORK (D2) — forward per-tier trip intake answers →
          // orders.intake_form_data via the existing ticket-checkout-create
          // body key. Empty array (no-schema trips) is omitted by
          // nativeCheckoutFlow so the request shape stays byte-identical.
          ...(payload.intakeFormData.length > 0
            ? { intakeFormData: payload.intakeFormData }
            : {}),
          // ORCH-1072 — thread the chosen occurrence into ticket-checkout-create
          // so a recurring/multi-date experience books the right date. Omitted
          // for events/trips/one-off-with-no-id → byte-identical to today.
          ...(selectedEventDateId !== null
            ? { eventDateId: selectedEventDateId }
            : {}),
          // ORCH-1130 / DISC-1130-A — for a plan trip, forward the buyer's
          // explicit pay-full vs pay-over-time choice so the server NEVER
          // resolves to a silent 'auto' deposit-only charge. Omitted for
          // events/experiences/no-plan trips → request byte-identical.
          ...(paymentPlanChoice ? { paymentPlanChoice } : {}),
        });
      } catch (err) {
        // ORCH-0829-B D-1 H-2: runNativeCheckout's contract is to return a
        // NativeCheckoutOutcome, but if the underlying useStripePaymentSheet
        // wrapper rejects, the await throws. Convert to the failed outcome
        // so the existing failed-branch UX runs (toast + haptic) instead of
        // leaking the rejection.
        const message = err instanceof Error ? err.message : "Payment failed.";
        result = { outcome: "failed", message };
      } finally {
        // ORCH-0829-B D-1 H-2: always clear the in-flight flag so a
        // subsequent Buy tap can re-fire the flow.
        setCheckoutInFlight(false);
      }

      if (result.outcome === "succeeded") {
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );
        toastManager.show("Ticket secured! Check your calendar.", "success");
        // META-ORCH-0991 Wave A — close via the declarative onClose prop
        // (BaseBottomSheet owns the sheet ref); DiscoverScreen flips visible.
        onClose();

        // ORCH-0829-A: invalidate the consumer calendar query immediately.
        // ORCH-0847 Phase C — paid-vs-free branch derived from cart total
        // (totalCents > 0 == paid). Mixed carts (some free + some paid tiers,
        // totalCents > 0) correctly route to the paid-path polling.
        const userId = user.id;
        queryClient.invalidateQueries({
          queryKey: ["businessEventOrders", userId],
        });
        queryClient.invalidateQueries({ queryKey: circleKeys.all });
        if (payload.totalCents > 0) {
          let attempts = 0;
          const interval = setInterval(() => {
            attempts += 1;
            queryClient.invalidateQueries({
              queryKey: ["businessEventOrders", userId],
            });
            queryClient.invalidateQueries({ queryKey: circleKeys.all });
            if (attempts >= 3) clearInterval(interval);
          }, 1000);
        }
      } else if (result.outcome === "canceled") {
        // Silent: user dismissed PaymentSheet.
      } else {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        toastManager.show(result.message, "error");
      }
    },
    [
      checkoutInFlight,
      user,
      profile,
      runNativeCheckout,
      data.eventId,
      selectedEventDateId,
      paymentPlanChoice,
      queryClient,
      onClose,
    ],
  );

  // ORCH-0847 Phase C — cart sheet handlers. Buy/Get Free taps open the
  // sheet seeded at the tapped tier; Confirm fires handleBuy with the
  // assembled cart; Cancel dismisses the sheet without side effects.
  const handleCartCheckout = useCallback(
    (payload: TicketCartCheckoutPayload): void => {
      setCartSheetVisible(false);
      void handleBuy(payload);
    },
    [handleBuy],
  );

  const handleCartCancel = useCallback((): void => {
    setCartSheetVisible(false);
    setInitialTicketTypeId(null);
  }, []);

  // ORCH-1072 — Book tap entry point. Decides the occurrence step:
  //   • >1 bookable occurrence → open the date picker (buyer picks, then cart).
  //   • exactly 1 occurrence    → auto-select it, skip straight to the cart
  //                               (one-off experience — operator-locked).
  //   • 0 occurrences (event/trip, or experience the supply didn't carry dates
  //     for) → open the cart with no event_date_id (byte-identical to today).
  const beginBooking = useCallback(
    (ticketId: string): void => {
      setInitialTicketTypeId(ticketId);
      if (bookableOccurrences.length > 1) {
        setSelectedEventDateId(null);
        setOccurrencePickerVisible(true);
        return;
      }
      if (bookableOccurrences.length === 1) {
        setSelectedEventDateId(bookableOccurrences[0].eventDateId);
      } else {
        setSelectedEventDateId(null);
      }
      setCartSheetVisible(true);
    },
    [bookableOccurrences],
  );

  // ORCH-1117 — floating Buy bar state. PURE projection of resolveOfferingCta
  // (same machine the inline rows read). OQ-B: the BusinessEventCard supply has
  // no `bookable`, so v1 passes bookable=true and relies on the existing
  // checkout 409 → cart toast for the not-ready case (never dead-ends). The bar's
  // tappable Buy opens the cart at the first sellable ticket via beginBooking;
  // the inline per-tier rows stay for multi-tier picking.
  const floatingCta: CtaState = useMemo(() => {
    const tickets = ticketsQuery.data ?? [];
    return resolveOfferingCta({
      variant: computeOfferingVariant(publicEvent, false),
      bookable: true,
      tickets,
      currency: publicEvent.currency,
    });
  }, [ticketsQuery.data, publicEvent]);
  const handleFloatingBarPress = useCallback((): void => {
    const tickets = ticketsQuery.data ?? [];
    // Open the cart at the first sellable, non-hidden ticket (the inline rows
    // remain for explicit per-tier selection).
    const sellable = tickets.find(
      (t) =>
        t.visibility !== "hidden" &&
        !(t.availableAt === "door") &&
        (t.isUnlimited || (t.capacity ?? 0) > 0),
    );
    const target = sellable ?? tickets.find((t) => t.visibility !== "hidden");
    if (target !== undefined) beginBooking(target.id);
  }, [ticketsQuery.data, beginBooking]);

  // ORCH-1072 — the picker chose a date → carry it + open the cart for qty/pay.
  const handleOccurrenceSelect = useCallback((eventDateId: string): void => {
    setSelectedEventDateId(eventDateId);
    setOccurrencePickerVisible(false);
    setCartSheetVisible(true);
  }, []);

  const handleOccurrenceCancel = useCallback((): void => {
    setOccurrencePickerVisible(false);
    setInitialTicketTypeId(null);
    setSelectedEventDateId(null);
  }, []);

  const callbacks: PublicEventCallbacks = useMemo(
    () => ({
      onClose: () => {
        // META-ORCH-0991 Wave A — close via declarative onClose prop.
        onClose();
      },
      onShare: () => {
        // [TRANSITIONAL] Share for business events lands in a follow-up.
        toastManager.show("Share is coming soon.", "info");
      },
      onOpenBrand: (brandSlug: string) => {
        router.push(`/brand/${encodeURIComponent(brandSlug)}`);
      },
      onOpenMaps: openMapsForQuery,
      // ORCH-0847 Phase C — open the multi-tier cart sheet seeded at the
      // tapped tier. The TicketCartSheet manages the cart, opt-in, buyer
      // recap, and primary CTA; on Continue/Claim it calls handleBuy with
      // the assembled cart payload. I-PROPOSED-TICKET-CLAIM-CONFIRMATION-REQUIRED
      // is preserved — the sheet IS the confirmation step (richer surface
      // than the prior single-ticket modal).
      // ORCH-1072 — route through beginBooking so a multi-date experience opens
      // the occurrence picker first; one-off + events/trips go straight to cart.
      onBuyTicket: (ticketId: string) => {
        beginBooking(ticketId);
      },
      onClaimFreeTicket: (ticketId: string) => {
        beginBooking(ticketId);
      },
      onJoinWaitlist: (_ticketId: string) => {
        toastManager.show("Waitlist coming soon.", "info");
      },
      onRequestApproval: (_ticketId: string) => {
        toastManager.show("Request-to-attend coming soon.", "info");
      },
    }),
    [router, onClose, beginBooking],
  );

  // META-ORCH-0991 (sheet rework — Bug 2): inject gorhom's BottomSheetScrollView
  // as PublicEventPage's single scroll host. The wrapper appends this sheet's
  // bottom clearance (`bottomContentInset` — carries the chat-composer / tab-bar
  // clearance from MessageInterface) plus any explicit sheet-overlay footprint
  // onto the page's own scrollContent so the last "Buy ticket" row can scroll
  // above the floating nav. Memoized on the clearance scalars so the injected
  // component identity is stable across re-renders (no remount).
  // ORCH-1016 ROOT-CAUSE FIX: PublicEventPage's injected scroll only PARTIALLY
  // bound (its viewport tracked content, so the last row stayed below the screen).
  // Instead, BaseBottomSheet OWNS the scroll (scrollMode="scroll" below) — the only
  // structure that binds the viewport to the visible sheet height — and this
  // ScrollComponent is now a NON-scroll passthrough (a plain View carrying
  // PublicEventPage's contentContainerStyle + a home-indicator spacer). The page
  // content thus renders directly inside the primitive's bare scroll.
  // ORCH-1072 — the experience's multi-stop itinerary, rendered beneath
  // PublicEventPage's content inside the same scroll host. Empty for events/trips
  // (experienceStops undefined) → nothing renders → unchanged layout.
  const itineraryStops = useMemo(
    () => (Array.isArray(data.experienceStops) ? data.experienceStops : []),
    [data.experienceStops],
  );
  const SheetScrollHost = useMemo(() => {
    const bottomPad =
      Math.max(8, bottomContentInset) + Math.max(0, bottomSheetInset);
    const Host: React.FC<ScrollViewProps> = ({
      contentContainerStyle,
      children,
    }) => (
      <View style={contentContainerStyle}>
        {children}
        {/* ORCH-1072 — itinerary section (experience-only). */}
        <ExperienceItinerary stops={itineraryStops} />
        {/* ORCH-1117 — floating Buy bar pinned at the END of the bare scroll
            (F-B scroll-sibling; NEVER stickyFooter). It carries its own bottom
            inset, so it replaces the old spacer as the last in-flow element. */}
        <FloatingOfferingBar
          cta={floatingCta}
          onPress={handleFloatingBarPress}
          bottomInset={bottomPad}
          testID="orch-1117-brand-event-floating-bar"
        />
      </View>
    );
    Host.displayName = "EbesPassthroughHost";
    return Host;
  }, [
    bottomContentInset,
    bottomSheetInset,
    itineraryStops,
    floatingCta,
    handleFloatingBarPress,
  ]);

  // META-ORCH-0991 Wave A — migrated onto BaseBottomSheet. Declarative
  // `visible` + initialIndex=1 (90% snap) replicate the proven inline
  // <BottomSheet> open/close. onChange passthrough keeps the ORCH-0828
  // diagnostic log. Dark #0c0e12 background (NO top radius — preserved exactly
  // via the per-consumer backgroundStyle) + rgba(255,255,255,0.32)/width-36
  // handle. The TicketCartSheet stays a SIBLING root in the same fragment
  // (feedback_rn_sub_sheet_must_render_inside_parent) — itself a BaseBottomSheet.
  //
  // META-ORCH-0991 (sheet rework — Bug 2): scrollMode is now "view" so the
  // primitive does NOT wrap PublicEventPage in its OWN gorhom scroll. Instead
  // PublicEventPage owns the SINGLE scroll host via the injected
  // ScrollComponent (gorhom BottomSheetScrollView) — collapsing the prior
  // double-scroll (raw RN ScrollView nested in the sheet's gorhom scroll).
  const sheetGroup = (
    <>
      <BaseBottomSheet
        visible={visible}
        onClose={onClose}
        onChange={handleSheetChange}
        theme="dark"
        snapPoints={SHEET_SNAP_POINTS}
        initialIndex={SHEET_INITIAL_INDEX}
        backgroundStyle={styles.sheetBackground}
        handleStyle={styles.sheetHandle}
        scrollMode="scroll"
        hidesBottomNav
        bottomSheetInset={bottomSheetInset}
        scrollProps={{
          showsVerticalScrollIndicator: false,
        }}
        accessibilityLabel={data.title}
      >
        <PublicEventPage
          event={publicEvent}
          brand={publicBrand}
          viewerRole={viewerRole}
          theme={
            themeQuery.data ?? resolveTheme(null, publicEvent.themeOverrides)
          }
          callbacks={callbacks}
          ScrollComponent={SheetScrollHost}
        />
      </BaseBottomSheet>
      {/* ORCH-0847 Phase C — multi-tier cart sheet. Renders as a sibling
          BaseBottomSheet so it overlays the parent sheet without
          competing for the same Modal root. */}
      <TicketCartSheet
        visible={cartSheetVisible}
        eventId={data.eventId}
        tickets={ticketsQuery.data}
        fallbackCurrency={data.currency}
        initialTicketTypeId={initialTicketTypeId}
        intakeSchemasByTier={intakeSchemasQuery.data}
        buyerName={
          profile?.display_name?.trim() || user?.email?.split("@")[0] || "Guest"
        }
        buyerEmail={user?.email ?? profile?.email ?? ""}
        buyerPhone={profile?.phone ?? ""}
        isSubmitting={checkoutInFlight}
        clearFloatingNav={false}
        onCancel={handleCartCancel}
        onCheckout={handleCartCheckout}
      />
      {/* ORCH-1072 — occurrence picker (PICK FROM UPCOMING DATES). Renders as a
          sibling BaseBottomSheet; only opened for an experience with >1 bookable
          occurrence. One-off experiences + events/trips never open it. */}
      <ExperienceOccurrencePicker
        visible={occurrencePickerVisible}
        occurrences={occurrences}
        timezone={data.timezone}
        onCancel={handleOccurrenceCancel}
        onSelect={handleOccurrenceSelect}
      />
    </>
  );

  // ORCH-1016 — the SheetOverlayCarrier (RN Modal) is gone: it broke Android
  // scroll gestures and didn't fix the z-order. Nav coverage is now solved by
  // `hidesBottomNav` on the sheets themselves.
  return sheetGroup;
};

const styles = StyleSheet.create({
  sheetBody: {
    flex: 1,
  },
  sheetBackground: {
    backgroundColor: "#0c0e12",
  },
  sheetHandle: {
    backgroundColor: "rgba(255,255,255,0.32)",
    width: 36,
  },
});

export default ExpandedBusinessEventSheet;
