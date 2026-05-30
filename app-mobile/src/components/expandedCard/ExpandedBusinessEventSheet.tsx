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
  type ScrollViewProps,
} from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";

import {
  type PublicBrandProps,
  type PublicEventCallbacks,
  PublicEventPage,
  type PublicEventProps,
  type ViewerRole,
  resolveTheme,
} from "@mingla/event-rendering";

import { useQueryClient } from "@tanstack/react-query";

import type { BusinessEventCard } from "../../types/mergedDiscover";
// ORCH-0877 — centralized consumer-side date formatter.
import { formatEventDateLine } from "../../utils/eventDateDisplay";
import { useAppStore } from "../../store/appStore";
import { usePublicEventTickets } from "../../hooks/usePublicEventTickets";
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

interface ExpandedBusinessEventSheetProps {
  visible: boolean;
  data: BusinessEventCard;
  onClose: () => void;
  bottomContentInset?: number;
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
  datesList: [],
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
> = ({ visible, data, onClose, bottomContentInset = 32 }) => {
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

  const ticketsQuery = usePublicEventTickets(visible ? data.eventId : null);
  const themeQuery = useEventTheme(visible ? data : null);
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
            address: payload.address,
          },
          taxCalculationId: payload.taxCalculationId,
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
      onBuyTicket: (ticketId: string) => {
        setInitialTicketTypeId(ticketId);
        setCartSheetVisible(true);
      },
      onClaimFreeTicket: (ticketId: string) => {
        setInitialTicketTypeId(ticketId);
        setCartSheetVisible(true);
      },
      onJoinWaitlist: (_ticketId: string) => {
        toastManager.show("Waitlist coming soon.", "info");
      },
      onRequestApproval: (_ticketId: string) => {
        toastManager.show("Request-to-attend coming soon.", "info");
      },
    }),
    [router, onClose],
  );

  // META-ORCH-0991 (sheet rework — Bug 2): inject gorhom's BottomSheetScrollView
  // as PublicEventPage's single scroll host. The wrapper appends this sheet's
  // bottom clearance (`bottomContentInset` — carries the chat-composer / tab-bar
  // clearance from MessageInterface) onto the page's own scrollContent padding so
  // the last "Buy ticket" row clears the bottom. Memoized on bottomContentInset so
  // the injected component identity is stable across re-renders (no remount).
  const SheetScrollHost = useMemo(() => {
    const bottomPad = Math.max(32, bottomContentInset);
    const Host: React.FC<ScrollViewProps> = ({
      contentContainerStyle,
      ...rest
    }) => (
      <BottomSheetScrollView
        {...rest}
        contentContainerStyle={[
          contentContainerStyle,
          { paddingBottom: bottomPad },
        ]}
      >
        {rest.children}
      </BottomSheetScrollView>
    );
    Host.displayName = "EbesSheetScrollHost";
    return Host;
  }, [bottomContentInset]);

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
  return (
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
        scrollMode="view"
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
        buyerName={
          profile?.display_name?.trim() || user?.email?.split("@")[0] || "Guest"
        }
        buyerEmail={user?.email ?? profile?.email ?? ""}
        buyerPhone={profile?.phone ?? ""}
        isSubmitting={checkoutInFlight}
        onCancel={handleCartCancel}
        onCheckout={handleCartCheckout}
      />
    </>
  );
};

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: "#0c0e12",
  },
  sheetHandle: {
    backgroundColor: "rgba(255,255,255,0.32)",
    width: 36,
  },
});

export default ExpandedBusinessEventSheet;
