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
import { StyleSheet, View } from "react-native";
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import * as Haptics from "expo-haptics";

import {
  PublicEventPage,
  type PublicEventCallbacks,
  type PublicEventProps,
  type PublicBrandProps,
  type ViewerRole,
} from "@mingla/event-rendering";

import type { BusinessEventCard } from "../../types/mergedDiscover";
import { useAppStore } from "../../store/appStore";
import { usePublicEventTickets } from "../../hooks/usePublicEventTickets";
import { useNativeCheckoutFlow } from "../../payments/nativeCheckoutFlow";
import { toastManager } from "../ui/Toast";

interface ExpandedBusinessEventSheetProps {
  visible: boolean;
  data: BusinessEventCard;
  onClose: () => void;
}

const SHEET_SNAP_POINTS: string[] = ["95%"];

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

  const [checkoutInFlight, setCheckoutInFlight] = useState<boolean>(false);

  const ticketsQuery = usePublicEventTickets(visible ? data.eventId : null);
  const runNativeCheckout = useNativeCheckoutFlow();

  useEffect(() => {
    if (visible) {
      sheetRef.current?.expand();
    } else {
      sheetRef.current?.close();
    }
  }, [visible]);

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

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) onClose();
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
    async (ticketId: string, _isFree: boolean) => {
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

      const result = await runNativeCheckout({
        eventId: data.eventId,
        lines: [{ ticketTypeId: ticketId, quantity: 1 }],
        buyer: {
          name: buyerName,
          email: buyerEmail,
          phone: buyerPhone,
          marketingOptIn: false,
        },
      });

      setCheckoutInFlight(false);

      if (result.outcome === "succeeded") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        toastManager.show("Ticket secured! Check your calendar.", "success");
        sheetRef.current?.close();
      } else if (result.outcome === "canceled") {
        // Silent: user dismissed PaymentSheet.
      } else {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        toastManager.show(result.message, "error");
      }
    },
    [checkoutInFlight, user, profile, runNativeCheckout, data.eventId],
  );

  const callbacks: PublicEventCallbacks = useMemo(
    () => ({
      onClose: () => {
        sheetRef.current?.close();
      },
      onShare: () => {
        // [TRANSITIONAL] Share for business events lands in a follow-up.
        toastManager.show("Share is coming soon.", "info");
      },
      onBuyTicket: (ticketId: string) => {
        void handleBuy(ticketId, false);
      },
      onClaimFreeTicket: (ticketId: string) => {
        void handleBuy(ticketId, true);
      },
      onJoinWaitlist: (_ticketId: string) => {
        toastManager.show("Waitlist coming soon.", "info");
      },
      onRequestApproval: (_ticketId: string) => {
        toastManager.show("Request-to-attend coming soon.", "info");
      },
    }),
    [handleBuy],
  );

  return (
    <BottomSheet
      ref={sheetRef}
      snapPoints={SHEET_SNAP_POINTS}
      enablePanDownToClose
      onChange={handleSheetChange}
      index={-1}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.sheetHandle}
    >
      <View style={styles.sheetContent}>
        <PublicEventPage
          event={publicEvent}
          brand={publicBrand}
          viewerRole={viewerRole}
          callbacks={callbacks}
        />
      </View>
    </BottomSheet>
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
  sheetContent: {
    flex: 1,
  },
});

export default ExpandedBusinessEventSheet;

