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

import React, { useCallback, useMemo, useRef, useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import BottomSheet, {
  BottomSheetScrollView,
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import * as Haptics from "expo-haptics";

import {
  PublicEventPage,
  type PublicEventCallbacks,
  type PublicEventProps,
  type PublicBrandProps,
  type ViewerRole,
} from "@mingla/event-rendering";

import { useQueryClient } from "@tanstack/react-query";

import type { BusinessEventCard } from "../../types/mergedDiscover";
import { useAppStore } from "../../store/appStore";
import { usePublicEventTickets } from "../../hooks/usePublicEventTickets";
import {
  useNativeCheckoutFlow,
  type NativeCheckoutOutcome,
} from "../../payments/nativeCheckoutFlow";
import { toastManager } from "../ui/Toast";
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
}

// ORCH-0828 REWORK: canonical bottomSheet snapPoints from design tokens,
// matching the TM/place path at ExpandedCardModal.tsx:1606. Two snap points
// give the user a natural 50% preview + 90% full gesture.
const SHEET_SNAP_POINTS = glass.bottomSheet.snapPoints as unknown as (string | number)[];
const SHEET_INITIAL_INDEX = 1; // open at the 90% snap (full view)

const formatDateLine = (
  masterDateUtc: string | null,
  timezone: string,
): string => {
  if (!masterDateUtc) return "Date to be announced";
  try {
    const d = new Date(masterDateUtc);
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone || "UTC",
    }).format(d).toUpperCase();
  } catch {
    return masterDateUtc;
  }
};

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
  dateLine: formatDateLine(card.masterDateUtc, card.timezone),
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
});

export const ExpandedBusinessEventSheet: React.FC<ExpandedBusinessEventSheetProps> = ({
  visible,
  data,
  onClose,
}) => {
  const sheetRef = useRef<BottomSheet>(null);
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

  // ORCH-0828 REWORK: inline `<BottomSheet>` fires `onChange(-1)` when
  // the user swipes down or backdrop-press dismisses. Forward to onClose
  // so DiscoverScreen can clear its `expansionTarget` state. The diagnostic
  // log captures every index transition for live-fire verification.
  const handleSheetChange = useCallback(
    (index: number): void => {
      console.log("[ExpandedBusinessEventSheet] onChange index=", index);
      if (index === -1) {
        onClose();
      }
    },
    [onClose],
  );

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
        profile?.display_name?.trim() ||
        user.email?.split("@")[0] ||
        "Guest";
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
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        toastManager.show("Ticket secured! Check your calendar.", "success");
        sheetRef.current?.close();

        // ORCH-0829-A: invalidate the consumer calendar query immediately.
        // ORCH-0847 Phase C — paid-vs-free branch derived from cart total
        // (totalCents > 0 == paid). Mixed carts (some free + some paid tiers,
        // totalCents > 0) correctly route to the paid-path polling.
        const userId = user.id;
        queryClient.invalidateQueries({
          queryKey: ["businessEventOrders", userId],
        });
        if (payload.totalCents > 0) {
          let attempts = 0;
          const interval = setInterval(() => {
            attempts += 1;
            queryClient.invalidateQueries({
              queryKey: ["businessEventOrders", userId],
            });
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
        sheetRef.current?.close();
      },
      onShare: () => {
        // [TRANSITIONAL] Share for business events lands in a follow-up.
        toastManager.show("Share is coming soon.", "info");
      },
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
    [ticketsQuery.data, data.currency],
  );

  // ORCH-0828 REWORK: inline `<BottomSheet>` matching the proven
  // ExpandedCardModal.tsx:1602-2066 TM/place pattern. Declarative
  // `index={visible ? 1 : -1}` drives open/close — no portal, no
  // provider, no `present()` ref dance. `BottomSheetScrollView` gives
  // the library measurable content from the first frame, avoiding the
  // collapse-to-zero failure mode that broke the prior portal-based
  // approach with `enableDynamicSizing=true`.
  return (
    <>
      <BottomSheet
        ref={sheetRef}
        index={visible ? SHEET_INITIAL_INDEX : -1}
        snapPoints={SHEET_SNAP_POINTS}
        enablePanDownToClose
        onChange={handleSheetChange}
        backdropComponent={renderBackdrop}
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.sheetHandle}
      >
        <BottomSheetScrollView
          style={styles.sheetScroll}
          contentContainerStyle={styles.sheetScrollContent}
        >
          <PublicEventPage
            event={publicEvent}
            brand={publicBrand}
            viewerRole={viewerRole}
            callbacks={callbacks}
          />
        </BottomSheetScrollView>
      </BottomSheet>
      {/* ORCH-0847 Phase C — multi-tier cart sheet. Renders as a sibling
          @gorhom/bottom-sheet so it overlays the parent sheet without
          competing for the same Modal root. */}
      <TicketCartSheet
        visible={cartSheetVisible}
        eventId={data.eventId}
        tickets={ticketsQuery.data}
        fallbackCurrency={data.currency}
        initialTicketTypeId={initialTicketTypeId}
        buyerName={
          profile?.display_name?.trim() ||
          user?.email?.split("@")[0] ||
          "Guest"
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
  sheetScroll: {
    flex: 1,
  },
  sheetScrollContent: {
    paddingBottom: 32,
  },
});

export default ExpandedBusinessEventSheet;

