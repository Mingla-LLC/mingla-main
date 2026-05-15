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
import TicketClaimConfirmModal from "./TicketClaimConfirmModal";

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

const mapCardToPublicEvent = (
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
  format: "in-person",
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
  // ORCH-0829-A: pending claim state drives the confirmation modal.
  // Set on Buy/Get Free tap; cleared on Cancel or after Confirm fires
  // handleBuy. The modal sits as a sibling fragment alongside the
  // BottomSheet so RN Modal correctly overlays the sheet.
  const [pendingClaim, setPendingClaim] = useState<{
    ticketId: string;
    isFreeTicket: boolean;
    ticketName: string;
    ticketPriceCents: number | null;
    ticketCurrency: string;
  } | null>(null);

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

  const handleBuy = useCallback(
    async (ticketId: string, isFreeTicket: boolean) => {
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
          lines: [{ ticketTypeId: ticketId, quantity: 1 }],
          buyer: {
            name: buyerName,
            email: buyerEmail,
            phone: buyerPhone,
            marketingOptIn: false,
          },
        });
      } catch (err) {
        // ORCH-0829-B D-1 H-2: runNativeCheckout's contract is to return a
        // NativeCheckoutOutcome, but if the underlying useStripePaymentSheet
        // wrapper rejects (e.g., the H-3 timeout race fires), the await
        // throws. Convert to the failed outcome so the existing failed-
        // branch UX runs (toast + haptic) instead of leaking the rejection.
        const message = err instanceof Error ? err.message : "Payment failed.";
        result = { outcome: "failed", message };
      } finally {
        // ORCH-0829-B D-1 H-2: always clear the in-flight flag so a
        // subsequent Buy tap can re-fire the flow. Without this finally,
        // a hung or thrown runNativeCheckout leaves checkoutInFlight=true
        // forever, silently no-op'ing all subsequent Buy taps for the
        // rest of the session.
        setCheckoutInFlight(false);
      }

      if (result.outcome === "succeeded") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        toastManager.show("Ticket secured! Check your calendar.", "success");
        sheetRef.current?.close();

        // ORCH-0829-A: invalidate the consumer calendar query immediately
        // so the just-claimed ticket appears. Free orders are finalized
        // synchronously by `ticket-checkout-create`; paid orders rely on
        // the Stripe webhook → `biz_ticket_checkout_finalize` RPC, which
        // typically takes 1-3s. Defensive short-poll (3 × 1s) on paid
        // orders to catch the webhook completion. Query key
        // `["businessEventOrders", userId]` matches the new hook in
        // `useCalendarEntries.ts`.
        const userId = user.id;
        queryClient.invalidateQueries({
          queryKey: ["businessEventOrders", userId],
        });
        if (!isFreeTicket) {
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

  // ORCH-0829-A: confirmation modal handlers. Buy/Get Free taps stage
  // the claim in `pendingClaim`; Confirm fires `handleBuy`; Cancel
  // dismisses without side effects.
  const handleConfirmClaim = useCallback((): void => {
    if (pendingClaim === null) return;
    const { ticketId, isFreeTicket } = pendingClaim;
    setPendingClaim(null);
    void handleBuy(ticketId, isFreeTicket);
  }, [pendingClaim, handleBuy]);

  const handleCancelClaim = useCallback((): void => {
    setPendingClaim(null);
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
      // ORCH-0829-A: stage the claim in `pendingClaim` instead of firing
      // `handleBuy` directly. The TicketClaimConfirmModal then renders
      // for user review; Confirm calls `handleConfirmClaim` which fires
      // `handleBuy`. New invariant: I-PROPOSED-TICKET-CLAIM-CONFIRMATION-REQUIRED.
      onBuyTicket: (ticketId: string) => {
        const tt = (ticketsQuery.data ?? []).find((t) => t.id === ticketId);
        setPendingClaim({
          ticketId,
          isFreeTicket: false,
          ticketName: tt?.name ?? "Ticket",
          ticketPriceCents:
            tt?.priceGbp !== undefined && tt.priceGbp !== null
              ? Math.round(tt.priceGbp * 100)
              : null,
          ticketCurrency: tt?.currency ?? data.currency,
        });
      },
      onClaimFreeTicket: (ticketId: string) => {
        const tt = (ticketsQuery.data ?? []).find((t) => t.id === ticketId);
        setPendingClaim({
          ticketId,
          isFreeTicket: true,
          ticketName: tt?.name ?? "Ticket",
          ticketPriceCents: null,
          ticketCurrency: tt?.currency ?? data.currency,
        });
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
      {/* ORCH-0829-A: confirmation modal renders as a sibling so RN Modal
          correctly overlays the BottomSheet. */}
      <TicketClaimConfirmModal
        visible={pendingClaim !== null}
        ticketName={pendingClaim?.ticketName ?? ""}
        ticketPriceCents={pendingClaim?.ticketPriceCents ?? null}
        ticketCurrency={pendingClaim?.ticketCurrency ?? data.currency}
        buyerName={
          profile?.display_name?.trim() ||
          user?.email?.split("@")[0] ||
          "Guest"
        }
        buyerEmail={user?.email ?? profile?.email ?? ""}
        buyerPhone={profile?.phone ?? ""}
        isFreeTicket={pendingClaim?.isFreeTicket ?? true}
        isSubmitting={checkoutInFlight}
        onCancel={handleCancelClaim}
        onConfirm={handleConfirmClaim}
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

