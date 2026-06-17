/**
 * ConsumerEventDetailScreen — ORCH-1138 Leg 2 (consumer EVENT detail, foundation).
 *
 * The NEW foundation-based consumer event detail. Replaces the deck's
 * ExpandedBusinessEventSheet (EBES) hop for the EVENT flow: the deck event card
 * now opens THIS screen directly (ExpandedCardModal businessEvent branch repoint),
 * and Get-tickets opens TicketCartSheet DIRECTLY → byte-identical
 * ticket-checkout-create. EBES stays for experiences + chat (N1).
 *
 * Structurally mirrors the SHIPPED ConsumerTripDetailScreen 1:1:
 *   - Body inside the shared `BaseBottomSheet` (scrollMode="view", hidesBottomNav,
 *     the SOLE gorhom consumer) with the gorhom `BottomSheetScrollView` as a
 *     DIRECT child (the LOAD-BEARING ORCH-1016/1043 scroll structure — do NOT
 *     re-wrap).
 *   - The Direction-A native look is COMPOSED AROUND the scroll (pinned
 *     EventCoverMedia absolute sibling, OfferingChrome close/share/mute absolute
 *     sibling, float→dock ConsumerEventReserveBar) — NOT by mounting
 *     ParallaxCoverShell as the sheet host (its native branch nests its ScrollView
 *     in a `nativeHost` view → re-triggers the scroll-freeze; SPEC §4.7).
 *   - Reserve → TicketCartSheet DIRECTLY (seed the sellable/selected tier), NEVER
 *     EBES. handleBuy ported from EBES (same buyer derivation, same guards, same
 *     byte-identical runNativeCheckout request — NO address, NO taxCalculationId,
 *     NO paymentPlanChoice for events — same toasts + cache invalidations).
 *
 * Anon-read constraint (🔒 COMMS-0009): theme via useEventTheme(card) reads the
 * anon-safe business_public_events_view (NEVER `.from('brands')`); tickets via
 * usePublicEventTickets (anon-safe ticket_types). NO `.from('brands')`.
 *
 * I-MOR-0827-PACKAGE-ISOLATION: no import from mingla-business/src.
 *
 * OQ-6 (cold deep-link cap): the deck path passes `seed` (a BusinessEventCard);
 * the cold deep-link route passes `seed=null`. An anon event-by-slug fetch hook is
 * outside the §11 allowlist, so the cold path renders a graceful "Open from the
 * app" state rather than adding scope (OQ-6 orchestrator-approved degradation).
 */

import React, {
  useCallback,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import {
  ActivityIndicator,
  LayoutAnimation,
  Linking,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  boldFontFamily,
  computeOfferingVariant,
  createThemePalette,
  EventCoverMedia,
  offeringSurfaceStyles,
  resolveOfferingCta,
  resolveRsvpCta,
  resolveTheme,
  ThemeEntranceAnimation,
  type CtaState,
  type PublicEventProps,
  type PublicTicketProps,
  type RsvpCtaState,
} from "@mingla/event-rendering";
import {
  OfferingChrome,
  RsvpMomentumDecision,
  normalizeCityCountry,
  useResponsiveLayout,
} from "@mingla/offering-rendering";

import { Icon } from "../../components/ui/Icon";
import {
  BaseBottomSheet,
  BottomSheetScrollView,
} from "../../components/ui/BaseBottomSheet";
import TicketCartSheet, {
  type TicketCartCheckoutPayload,
} from "../../components/expandedCard/TicketCartSheet";
import { ConsumerEventReserveBar } from "../../components/offering/ConsumerEventReserveBar";
import {
  fetchRsvpMomentum,
  submitDeckRsvp,
} from "../../services/rsvpDeckService";
import { useConsumerThemeFont } from "../../theme/useConsumerThemeFont";
import { usePublicEventTickets } from "../../hooks/usePublicEventTickets";
import { useTripIntakeSchemas } from "../../hooks/useTripIntakeSchemas";
import { useEventTheme } from "../../hooks/useEventTheme";
import {
  mapConsumerEventToFoundation,
  type ConsumerEventFoundationModel,
} from "../../hooks/useConsumerEventFoundation";
import { circleKeys } from "../../hooks/queryKeys";
import {
  type NativeCheckoutOutcome,
  useNativeCheckoutFlow,
} from "../../payments/nativeCheckoutFlow";
import { toastManager } from "../../components/ui/Toast";
import { useAppStore } from "../../store/appStore";
import { glass } from "../../constants/designSystem";
import { hueFromId } from "../../utils/hueFromId";
import type { BusinessEventCard } from "../../types/mergedDiscover";

const ACCENT = "#FF6B35";
const ABOUT_COLLAPSE_THRESHOLD = 160;
const SHEET_SNAP_POINTS = glass.bottomSheet.snapPoints as unknown as (
  | string
  | number
)[];
const SHEET_INITIAL_INDEX = 1; // open at the 90% snap (full view)

interface ConsumerEventDetailScreenProps {
  /** The deck card seed. null on the cold deep-link route (OQ-6 capped). */
  seed?: BusinessEventCard | null;
  /** Present on the cold deep-link route (re-export). Unused on the deck path. */
  brandSlug?: string;
  eventSlug?: string;
  onBack: () => void;
  tabBarAware?: boolean;
}

// Build the PublicEventProps the SHARED state machine reads (mirror EBES
// mapCardToPublicEvent — for variant/CTA computation only; the foundation body
// renders from the foundation model, not this).
const cardToPublicEvent = (
  card: BusinessEventCard,
  tickets: PublicTicketProps[],
): PublicEventProps => ({
  id: card.eventId,
  name: card.title,
  brandId: card.brandId,
  brandSlug: card.brandSlug,
  eventSlug: card.eventSlug,
  description: card.description ?? "",
  dateLine: "",
  dateSubline: null,
  datesList: [],
  status: "published",
  endedAt: null,
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
  // ORCH-1157 [rsvp-public-redesign] — the deck seed carries canonical party
  // types; pass them so the RSVP momentum unit + the CTA machine see one shape.
  partyTypes: card.partyTypes ?? [],
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

export default function ConsumerEventDetailScreen({
  seed = null,
  brandSlug,
  eventSlug,
  onBack,
  tabBarAware = true,
}: ConsumerEventDetailScreenProps): React.ReactElement {
  void tabBarAware; // the sheet hides the nav; kept for prop parity with trip.
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAppStore((s) => s.user);
  const profile = useAppStore((s) => s.profile);

  const [cartVisible, setCartVisible] = useState<boolean>(false);
  const [initialTicketTypeId, setInitialTicketTypeId] = useState<string | null>(
    null,
  );
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [checkoutInFlight, setCheckoutInFlight] = useState<boolean>(false);
  const [muted, setMuted] = useState<boolean>(true);
  const [aboutCollapsed, setAboutCollapsed] = useState<boolean>(true);

  // ORCH-1150 — RSVP deck variant. A discoverable RSVP event (host opted in)
  // renders Going/Not-going instead of Book; tapping writes via the same
  // public-submit-rsvp edge fn (logged-in path). NO cart, NO checkout.
  const isRsvp = seed?.eventType === "rsvp";
  const [rsvpInFlight, setRsvpInFlight] = useState<boolean>(false);
  // ORCH-1157 [rsvp-public-redesign] — the guest's resolved own RSVP state, kept
  // in the shape the shared RsvpMomentumDecision reads (status + approval).
  const [rsvpStatus, setRsvpStatus] = useState<
    "going" | "not_going" | "waitlisted" | "maybe" | null
  >(null);
  const [rsvpApproval, setRsvpApproval] = useState<
    "pending" | "approved" | null
  >(null);

  // float→dock CTA visibility tracking (mirror the trip screen 1:1).
  const [dockTopY, setDockTopY] = useState<number | null>(null);
  const [scrollY, setScrollY] = useState<number>(0);
  const [viewportH, setViewportH] = useState<number>(0);
  const handleDockLayout = useCallback((e: LayoutChangeEvent): void => {
    setDockTopY(e.nativeEvent.layout.y);
  }, []);
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
      setScrollY(e.nativeEvent.contentOffset.y);
    },
    [],
  );
  const handleScrollLayout = useCallback((e: LayoutChangeEvent): void => {
    setViewportH(e.nativeEvent.layout.height);
  }, []);

  const eventId = seed?.eventId ?? null;
  const ticketsQuery = usePublicEventTickets(eventId);
  const intakeSchemasQuery = useTripIntakeSchemas(eventId);
  const themeQuery = useEventTheme(seed);
  const runNativeCheckout = useNativeCheckoutFlow();

  // ORCH-1157 [rsvp-public-redesign] OQ-1 (option a) — fetch the live RSVP
  // momentum (going-count + capacity + waitlist/approval) from the SAME anon-safe
  // business_public_events_view the buyer-web page reads, since the deck seed does
  // not carry these (F-6). NO migration / RPC widen (avoids COMMS-0002). Only
  // enabled for an RSVP card. On a missing row the momentum unit is omitted (the
  // decision + chips still render — honest, no fabricated count).
  const rsvpMomentumQuery = useQuery({
    queryKey: ["rsvpMomentum", eventId],
    enabled: isRsvp && eventId !== null,
    staleTime: 60 * 1000,
    queryFn: () => fetchRsvpMomentum(eventId as string),
  });
  const rsvpMomentum = rsvpMomentumQuery.data ?? null;

  const theme = themeQuery.data ?? resolveTheme(null, null);
  const palette = useMemo(() => createThemePalette(theme), [theme]);
  const surface = useMemo(() => offeringSurfaceStyles(palette), [palette]);
  const boldFamily = boldFontFamily(theme);
  useConsumerThemeFont(theme.fontFamilyValue);
  useConsumerThemeFont(boldFamily);

  const { isDesktop } = useResponsiveLayout();
  void isDesktop; // native is always single-column immersive (parity assert).

  const toggleMute = useCallback(() => setMuted((m) => !m), []);
  const toggleAbout = useCallback((): void => {
    LayoutAnimation.configureNext(
      LayoutAnimation.create(
        200,
        LayoutAnimation.Types.easeInEaseOut,
        LayoutAnimation.Properties.opacity,
      ),
    );
    setAboutCollapsed((c) => !c);
  }, []);

  const handleShare = useCallback((): void => {
    const slug = seed?.brandSlug ?? brandSlug;
    const evSlug = seed?.eventSlug ?? eventSlug;
    if (slug !== undefined && evSlug !== undefined) {
      void Share.share({
        url: `https://business.usemingla.com/e/${slug}/${evSlug}`,
      });
    }
  }, [seed?.brandSlug, seed?.eventSlug, brandSlug, eventSlug]);

  const tickets = ticketsQuery.data ?? [];

  // The SINGLE buy-state (resolveOfferingCta — one owner). The selected tier
  // narrows the considered set; the page-level state drives the bar + tier rows.
  const offeringCta: CtaState = useMemo(() => {
    if (seed === null) {
      return {
        kind: "unavailable",
        title: "Open from the app",
        subline: null,
        tappable: false,
      };
    }
    const publicEvent = cardToPublicEvent(seed, tickets);
    const selected = tickets.find(
      (t) => t.id === selectedTicketId && t.visibility !== "hidden",
    );
    const considered = selected !== undefined ? [selected] : tickets;
    return resolveOfferingCta({
      variant: computeOfferingVariant(publicEvent, false),
      // OQ-B parity: the deck card has no `bookable`; pass true and rely on the
      // checkout 409 → cart-toast backstop (mirrors EBES + the trip screen v1).
      bookable: true,
      tickets: considered,
      currency: seed.currency,
    });
  }, [seed, tickets, selectedTicketId]);

  const handleSelectTicket = useCallback((ticketId: string): void => {
    setSelectedTicketId((prev) => (prev === ticketId ? null : ticketId));
  }, []);

  // Reserve opens the cart DIRECTLY, seeded at the selected/first sellable tier.
  const openCart = useCallback((): void => {
    if (tickets.length === 0) return;
    const explicit =
      selectedTicketId !== null
        ? tickets.find((t) => t.id === selectedTicketId)
        : undefined;
    const sellable =
      explicit ??
      tickets.find(
        (t) =>
          t.visibility !== "hidden" &&
          t.availableAt !== "door" &&
          (t.isUnlimited || (t.capacity ?? 0) > 0),
      ) ??
      tickets.find((t) => t.visibility !== "hidden") ??
      tickets[0];
    if (sellable === undefined) return;
    setInitialTicketTypeId(sellable.id);
    setCartVisible(true);
  }, [tickets, selectedTicketId]);

  // ORCH-1150 — Going / Not-going write for a discoverable RSVP deck card. The
  // signed-in user's JWT rides the supabase client → the edge fn resolves
  // user_id (no contact form needed). Reflects the resolved state + toasts; on
  // error never dead-ends.
  // ORCH-1157 — Going / Maybe / Not-going write. "maybe" is NEW on consumer
  // (parity with the shared RsvpPublicBody since ORCH-1150 R2). The signed-in
  // user's JWT rides the supabase client → the edge fn resolves user_id (no
  // contact form). Reflects the resolved state + toasts; never dead-ends.
  const handleRsvp = useCallback(
    async (next: "going" | "not_going" | "maybe"): Promise<void> => {
      if (rsvpInFlight || seed === null) return;
      if (user === null) {
        toastManager.show("Sign in to RSVP.", "warning");
        return;
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setRsvpInFlight(true);
      try {
        const result = await submitDeckRsvp(seed.eventId, next);
        setRsvpStatus(result.status);
        setRsvpApproval(result.approvalStatus);
        toastManager.show(
          result.approvalStatus === "pending"
            ? "RSVP sent — awaiting host approval."
            : result.status === "going"
              ? "You're going!"
              : result.status === "waitlisted"
                ? "You're on the waitlist — we'll let you know if a spot opens."
                : result.status === "maybe"
                  ? "Marked as Maybe — we'll keep you posted."
                  : "Got it — you're marked as not going.",
          "success",
        );
        // Refresh the live going-count after a successful own-submit.
        void queryClient.invalidateQueries({
          queryKey: ["rsvpMomentum", seed.eventId],
        });
      } catch (err) {
        const code = err instanceof Error ? err.message : "";
        toastManager.show(
          code.includes("rsvp_full")
            ? "This event just filled up."
            : code.includes("rsvp_not_open")
              ? "RSVPs are closed for this event."
              : "Couldn't save your RSVP. Try again.",
          "warning",
        );
      } finally {
        setRsvpInFlight(false);
      }
    },
    [rsvpInFlight, seed, user, queryClient],
  );

  // handleBuy ported VERBATIM (behavior) from EBES handleBuy — same buyer
  // derivation, same guards, same byte-identical runNativeCheckout request (NO
  // address, NO taxCalculationId, NO paymentPlanChoice for events), same toasts +
  // post-success cache invalidations (businessEventOrders + circle keys + the 3×
  // polling loop for paid checkouts).
  const handleBuy = useCallback(
    async (payload: TicketCartCheckoutPayload): Promise<void> => {
      if (checkoutInFlight) return;
      if (seed === null) return;
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
          eventId: seed.eventId,
          lines: payload.lines,
          buyer: {
            name: buyerName,
            email: buyerEmail,
            phone: buyerPhone,
            marketingOptIn: payload.marketingOptIn,
          },
          // ORCH-1025 — NO taxCalculationId, NO address: tax computed server-side
          // from the venue. Per-tier intake answers ride intakeFormData; empty
          // array omitted (byte-identical). NO paymentPlanChoice for events (no
          // installment plan) — request byte-identical to the EBES event path.
          ...(payload.intakeFormData.length > 0
            ? { intakeFormData: payload.intakeFormData }
            : {}),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Payment failed.";
        result = { outcome: "failed", message };
      } finally {
        setCheckoutInFlight(false);
      }

      if (result.outcome === "succeeded") {
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );
        toastManager.show("Ticket secured! Check your calendar.", "success");
        onBack();
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
      seed,
      user,
      profile,
      runNativeCheckout,
      queryClient,
      onBack,
    ],
  );

  const handleCartCheckout = useCallback(
    (payload: TicketCartCheckoutPayload): void => {
      setCartVisible(false);
      void handleBuy(payload);
    },
    [handleBuy],
  );
  const handleCartCancel = useCallback((): void => {
    setCartVisible(false);
    setInitialTicketTypeId(null);
  }, []);

  const chrome = (
    <View
      style={[styles.nativeChrome, { top: insets.top + 12 }]}
      pointerEvents="box-none"
    >
      <OfferingChrome
        palette={palette}
        showMute={false}
        muted={muted}
        onClose={onBack}
        onShare={handleShare}
        onToggleMute={toggleMute}
        closeAccessibilityLabel="Close"
        testID="orch-1138-consumer-event-chrome"
      />
    </View>
  );

  // ── Cold deep-link cap (OQ-6) — no seed, no anon-by-slug fetch in scope ──
  if (seed === null) {
    return (
      <BaseBottomSheet
        visible
        onClose={onBack}
        theme="dark"
        snapPoints={SHEET_SNAP_POINTS}
        initialIndex={SHEET_INITIAL_INDEX}
        scrollMode="view"
        hidesBottomNav
        accessibilityLabel="Event detail"
      >
        <View style={[styles.stateBody, { paddingBottom: insets.bottom + 48 }]}>
          {chrome}
          <Text style={styles.stateTitle}>Open this event from the app</Text>
          <Text style={styles.stateSub}>
            Find it on your Discover deck to see details and get tickets.
          </Text>
          <Pressable style={styles.retryBtn} onPress={onBack}>
            <Text style={styles.retryText}>Back</Text>
          </Pressable>
        </View>
      </BaseBottomSheet>
    );
  }

  // ── Loading tickets ──
  if (ticketsQuery.isLoading) {
    return (
      <BaseBottomSheet
        visible
        onClose={onBack}
        theme="dark"
        snapPoints={SHEET_SNAP_POINTS}
        initialIndex={SHEET_INITIAL_INDEX}
        scrollMode="view"
        hidesBottomNav
        accessibilityLabel="Event detail"
      >
        <View style={[styles.stateBody, { paddingBottom: insets.bottom + 48 }]}>
          {chrome}
          <ActivityIndicator color={ACCENT} />
        </View>
      </BaseBottomSheet>
    );
  }

  const fnd: ConsumerEventFoundationModel = mapConsumerEventToFoundation(
    seed,
    tickets,
    palette,
  );
  const showMute = fnd.coverMediaType === "video";

  const cityCountry =
    fnd.cityCountry ?? normalizeCityCountry(seed.city) ?? null;
  const aboutText = fnd.description;
  const canCollapseAbout =
    aboutText !== null && aboutText.length > ABOUT_COLLAPSE_THRESHOLD;
  const aboutCollapsedNow = canCollapseAbout && aboutCollapsed;
  const venueAddressLabel = fnd.hideAddressUntilTicket
    ? "Address shared after ticket purchase"
    : fnd.format === "hybrid" && fnd.address !== null
      ? `${fnd.address} · also online`
      : (fnd.address ?? "Address shared after ticket purchase");
  const venueMapsQuery =
    fnd.hideAddressUntilTicket || fnd.venueName === null
      ? null
      : [fnd.venueName, fnd.address].filter(Boolean).join(", ");

  const barKicker = offeringCta.kind === "buy" ? "All-in, taxes included" : null;
  const REVEAL_MARGIN = 24;
  const floatingPillVisible =
    dockTopY === null || viewportH === 0
      ? true
      : dockTopY > scrollY + viewportH - REVEAL_MARGIN;
  const reserveBarClearance = 8;

  const dockedReserve: ReactElement = (
    <ConsumerEventReserveBar
      cta={offeringCta}
      palette={palette}
      kicker={barKicker}
      fontFamily={boldFamily}
      onPress={openCart}
      variant="docked"
      safeAreaBottom={insets.bottom}
      onDockLayout={handleDockLayout}
      testID="orch-1138-consumer-event-reserve"
    />
  );
  const floatingReserve: ReactElement | null = floatingPillVisible ? (
    <ConsumerEventReserveBar
      cta={offeringCta}
      palette={palette}
      kicker={barKicker}
      fontFamily={boldFamily}
      onPress={openCart}
      variant="floating"
      safeAreaBottom={insets.bottom}
      testID="orch-1138-consumer-event-reserve"
    />
  ) : null;

  // ORCH-1157 [rsvp-public-redesign] — the Direction-C Going / Maybe / Can't
  // decision dock (replaces the old 2-button hand-rolled dock; Maybe is NEW on
  // consumer). Built on the SHARED RsvpMomentumDecision in floating-dock mode so
  // it stays byte-parity with the buyer-web / business RsvpPublicBody. No price,
  // no cart, no checkout — writes via handleRsvp → submitDeckRsvp. The momentum
  // unit + chips render INLINE in the body (rsvpMomentumUnit below); the dock is
  // the decision only. testIDs preserve the ORCH-1150 deck contract.
  const rsvpCtaState: RsvpCtaState = resolveRsvpCta({
    capacityFull:
      rsvpMomentum !== null &&
      rsvpMomentum.capacity !== null &&
      rsvpMomentum.goingCount >= rsvpMomentum.capacity,
    waitlistEnabled: rsvpMomentum?.waitlistEnabled ?? false,
    manualApproval: rsvpMomentum?.manualApproval ?? false,
    guestStatus: rsvpStatus,
    guestApproval: rsvpApproval,
  }).state;

  const rsvpDock: ReactElement = (
    <View
      style={[rsvpStyles.dock, { paddingBottom: insets.bottom + 8 }]}
      onLayout={handleDockLayout}
    >
      <RsvpMomentumDecision
        palette={palette}
        theme={theme}
        goingCount={rsvpMomentum?.goingCount ?? 0}
        capacity={rsvpMomentum?.capacity ?? null}
        ctaState={rsvpCtaState}
        guestStatus={rsvpStatus}
        guestApproval={rsvpApproval}
        partyTypes={[]}
        allowPlusOnes={false}
        plusOnesMax={0}
        plusCount={0}
        onPlusChange={() => undefined}
        waitlistEnabled={rsvpMomentum?.waitlistEnabled ?? false}
        submitting={rsvpInFlight}
        contactReady={user !== null}
        onGoing={() => void handleRsvp("going")}
        onMaybe={() => void handleRsvp("maybe")}
        onNotGoing={() => void handleRsvp("not_going")}
        variant="floating-dock"
        showMomentum={false}
        goingTestID="orch-1150-deck-rsvp-going"
        maybeTestID="orch-1157-deck-rsvp-maybe"
        notGoingTestID="orch-1150-deck-rsvp-not-going"
      />
    </View>
  );

  // ORCH-1157 — the momentum unit + kicker + party chips, rendered inline in the
  // body (the dock above carries only the decision). Omitted entirely when the
  // anon-view momentum has not resolved (no fabricated count — rule 9).
  const rsvpMomentumUnit: ReactElement | null =
    rsvpMomentum !== null ? (
      <View style={styles.section}>
        <RsvpMomentumDecision
          palette={palette}
          theme={theme}
          goingCount={rsvpMomentum.goingCount}
          capacity={rsvpMomentum.capacity}
          ctaState={rsvpCtaState}
          guestStatus={rsvpStatus}
          guestApproval={rsvpApproval}
          partyTypes={seed.partyTypes ?? []}
          allowPlusOnes={false}
          plusOnesMax={0}
          plusCount={0}
          onPlusChange={() => undefined}
          waitlistEnabled={rsvpMomentum.waitlistEnabled}
          submitting={rsvpInFlight}
          contactReady={user !== null}
          onGoing={() => undefined}
          onMaybe={() => undefined}
          onNotGoing={() => undefined}
          variant="inline"
          showMomentum
          testID="orch-1157-consumer-rsvp-momentum"
        />
      </View>
    ) : null;

  return (
    <>
      <BaseBottomSheet
        visible
        onClose={onBack}
        theme="dark"
        snapPoints={SHEET_SNAP_POINTS}
        initialIndex={SHEET_INITIAL_INDEX}
        scrollMode="view"
        hidesBottomNav
        accessibilityLabel={fnd.title}
      >
        {/* (1) pinned cover — absolute sibling BEHIND the scroll. */}
        <View style={styles.nativeCover} pointerEvents="none">
          <EventCoverMedia
            mediaUrl={fnd.coverMediaUrl}
            mediaType={fnd.coverMediaType}
            hue={fnd.coverHue}
            autoplay
            playbackActive
            muted={muted}
            loop
            height="100%"
            width="100%"
          />
          <View style={styles.coverScrim} pointerEvents="none" />
          <ThemeEntranceAnimation theme={theme} sessionKey={`event:${seed.eventId}`} />
        </View>

        {/* (2) the gorhom scroll host — DIRECT child of <BaseBottomSheet>. */}
        <BottomSheetScrollView
          style={styles.nativeScroll}
          contentContainerStyle={[
            styles.nativeScrollContent,
            { paddingBottom: reserveBarClearance },
          ]}
          showsVerticalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          onLayout={handleScrollLayout}
          testID="orch-1138-consumer-event-scroll"
        >
          <View style={styles.coverSpacer} />
          <View
            style={[
              styles.nativeBody,
              { backgroundColor: palette.page, borderColor: palette.panelBorder },
            ]}
          >
            {/* phone lead: date eyebrow + bold title */}
            <View style={styles.leadBlock}>
              {fnd.dateLine !== null ? (
                <Text style={[styles.eyebrowLead, { color: palette.accent }]}>
                  {fnd.dateLine}
                </Text>
              ) : null}
              <Text
                style={[styles.fndTitle, surface.primaryText, { fontFamily: boldFamily }]}
              >
                {fnd.title}
              </Text>
            </View>

            {/* meta chips (real columns only — rule 9) */}
            <View style={styles.metaChipRow}>
              {fnd.dateLine !== null ? (
                <View style={[styles.metaChip, surface.card]}>
                  <Icon name="calendar" size={15} color={palette.accent} />
                  <Text
                    style={[styles.metaChipText, surface.secondaryText, { fontFamily: boldFamily }]}
                  >
                    {fnd.dateLine}
                  </Text>
                </View>
              ) : null}
              {fnd.capacityLabel !== null ? (
                <View style={[styles.metaChip, surface.card]}>
                  <Icon name="people-outline" size={15} color={palette.accent} />
                  <Text
                    style={[styles.metaChipText, surface.secondaryText, { fontFamily: boldFamily }]}
                  >
                    {fnd.capacityLabel}
                  </Text>
                </View>
              ) : null}
              {cityCountry !== null ? (
                <View style={[styles.metaChip, surface.card]}>
                  <Icon name="location" size={15} color={palette.accent} />
                  <Text
                    style={[styles.metaChipText, surface.secondaryText, { fontFamily: boldFamily }]}
                  >
                    {cityCountry}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* ORCH-1157 — Direction-C RSVP momentum unit (kicker + party chips +
                going-count + meter + faceless anonymous cluster), inline in the
                body. Renders only for an RSVP card once the anon-view momentum
                resolves (no fabricated count). The decision lives in the dock. */}
            {isRsvp ? rsvpMomentumUnit : null}

            {/* brand chip — "Presented by" (anon-safe brand cover/initial).
                ORCH-1155 [public-brand-page] all-surface parity: tappable
                Pressable opens the brand page /b/{brandSlug} with a trailing
                "View" CTA — parity with the web/business event page (onOpenBrand
                → /b/{slug}) and the trip/experience consumer screens. Guard empty
                slug (rule 9; no dead tap, Constitution rule 1). */}
            <Pressable
              style={[styles.brandRow, surface.card]}
              accessibilityRole="button"
              accessibilityLabel={`View ${fnd.brandName}`}
              onPress={() => {
                if (
                  typeof fnd.brandSlug === "string" &&
                  fnd.brandSlug.length > 0
                ) {
                  router.push(`/b/${fnd.brandSlug}` as never);
                }
              }}
            >
              <View
                style={[
                  styles.brandTile,
                  fnd.brandCoverMediaUrl === null
                    ? { backgroundColor: palette.accent }
                    : null,
                ]}
              >
                {fnd.brandCoverMediaUrl !== null ? (
                  <EventCoverMedia
                    mediaUrl={fnd.brandCoverMediaUrl}
                    mediaType="image"
                    hue={hueFromId(fnd.brandSlug)}
                    label=""
                    radius={999}
                    autoplay
                    playbackActive
                    muted
                    loop
                    height="100%"
                    width="100%"
                  />
                ) : (
                  <View style={styles.brandInitialWrap}>
                    <Text
                      style={[
                        styles.brandInitial,
                        { color: palette.accentText, fontFamily: boldFamily },
                      ]}
                    >
                      {(fnd.brandName.trim()[0] ?? "•").toUpperCase()}
                    </Text>
                  </View>
                )}
              </View>
              <View style={styles.brandTextCol}>
                <Text style={[styles.brandKicker, surface.tertiaryText]}>
                  Presented by
                </Text>
                <Text
                  style={[styles.brandName, surface.primaryText, { fontFamily: boldFamily }]}
                >
                  {fnd.brandName}
                </Text>
              </View>
              <Text style={[styles.brandCta, { color: palette.accent }]}>
                View
              </Text>
            </Pressable>

            {/* About — collapsible (rule 9: only when present) */}
            {aboutText !== null ? (
              <View style={styles.section}>
                <Text
                  style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}
                >
                  About
                </Text>
                <Text
                  style={[styles.aboutText, surface.secondaryText]}
                  numberOfLines={aboutCollapsedNow ? 3 : undefined}
                  ellipsizeMode="tail"
                >
                  {aboutText}
                </Text>
                {canCollapseAbout ? (
                  <Pressable
                    onPress={toggleAbout}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: !aboutCollapsedNow }}
                    accessibilityLabel={aboutCollapsedNow ? "Read more" : "Show less"}
                    style={styles.aboutToggleRow}
                  >
                    <Text style={[styles.aboutToggleText, { color: palette.accent }]}>
                      {aboutCollapsedNow ? "Read more" : "Show less"}
                    </Text>
                    <Icon
                      name={aboutCollapsedNow ? "chevron-down" : "chevron-up"}
                      size={16}
                      color={palette.accent}
                    />
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {/* Where you'll be — venue card (map OMITTED on consumer, OQ-5) */}
            {fnd.format === "online" ? (
              <View style={styles.section}>
                <Text
                  style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}
                >
                  Where you&apos;ll be
                </Text>
                <View style={[styles.venueCard, surface.card]}>
                  <View style={[styles.venueDisk, { backgroundColor: palette.accent }]}>
                    <Text style={[styles.venueGlyph, { color: palette.accentText }]}>◯</Text>
                  </View>
                  <View style={styles.venueTextCol}>
                    <Text style={[styles.venueName, surface.primaryText, { fontFamily: boldFamily }]}>
                      Online
                    </Text>
                    <Text style={[styles.venueAddr, surface.secondaryText]}>
                      Conferencing link shared with ticketed guests.
                    </Text>
                  </View>
                </View>
              </View>
            ) : fnd.venueName !== null ? (
              <View style={styles.section}>
                <Text
                  style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}
                >
                  Where you&apos;ll be
                </Text>
                <Pressable
                  onPress={() => {
                    if (venueMapsQuery !== null) openMapsForQuery(venueMapsQuery);
                  }}
                  disabled={venueMapsQuery === null}
                  accessibilityRole={venueMapsQuery !== null ? "button" : undefined}
                  accessibilityLabel={
                    venueMapsQuery !== null
                      ? `Open ${fnd.venueName} in maps`
                      : fnd.venueName
                  }
                  style={[styles.venueCard, surface.card]}
                >
                  <View style={[styles.venueDisk, { backgroundColor: palette.accent }]}>
                    <Text style={[styles.venueGlyph, { color: palette.accentText }]}>⌖</Text>
                  </View>
                  <View style={styles.venueTextCol}>
                    <Text style={[styles.venueName, surface.primaryText, { fontFamily: boldFamily }]}>
                      {fnd.venueName}
                    </Text>
                    <Text style={[styles.venueAddr, surface.secondaryText]}>
                      {venueAddressLabel}
                    </Text>
                  </View>
                  {venueMapsQuery !== null ? (
                    <View style={[styles.venuePill, { backgroundColor: palette.accent }]}>
                      <Text style={[styles.venuePillText, { color: palette.accentText }]}>
                        Open maps
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              </View>
            ) : null}

            {/* Tickets — the selectable tier radiogroup */}
            <View style={styles.section}>
              <Text
                style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}
              >
                Choose your ticket
              </Text>
              {tickets.filter((t) => t.visibility !== "hidden").length === 0 ? (
                <View style={[styles.venueCard, surface.card]}>
                  <Text style={[styles.aboutText, surface.secondaryText]}>
                    No tickets available yet.
                  </Text>
                </View>
              ) : (
                <View accessibilityRole="radiogroup" style={styles.tierCol}>
                  {tickets
                    .filter((t) => t.visibility !== "hidden")
                    .sort((a, b) => a.displayOrder - b.displayOrder)
                    .map((t) => (
                      <ConsumerTierRow
                        key={t.id}
                        ticket={t}
                        fallbackCurrency={seed.currency}
                        palette={palette}
                        surface={surface}
                        boldFamily={boldFamily}
                        selected={selectedTicketId === t.id}
                        onSelect={handleSelectTicket}
                      />
                    ))}
                </View>
              )}
              <Text style={[styles.reassure, { color: palette.tertiaryText }]}>
                All-in price — taxes &amp; fees included, no surprises at checkout.
              </Text>
            </View>

            {/* DOCKED CTA — the LAST scroll child (float→dock language).
                ORCH-1150 — RSVP cards dock Going/Not-going instead of the cart bar. */}
            {isRsvp ? rsvpDock : dockedReserve}
          </View>
        </BottomSheetScrollView>

        {/* (3) chrome — absolute sibling above the cover + scroll */}
        <View style={[styles.nativeChrome, { top: insets.top + 12 }]} pointerEvents="box-none">
          <OfferingChrome
            palette={palette}
            showMute={showMute}
            muted={muted}
            onClose={onBack}
            onShare={handleShare}
            onToggleMute={toggleMute}
            closeAccessibilityLabel="Close"
            testID="orch-1138-consumer-event-chrome"
          />
        </View>

        {/* (4) FLOATING reserve PILL — shown while the docked CTA is off-screen.
            ORCH-1150 — suppressed for RSVP (the Going/Not-going dock is inline). */}
        {isRsvp ? null : floatingReserve}
      </BaseBottomSheet>

      {/* Reserve opens the cart DIRECTLY (NEVER EBES). Sibling BaseBottomSheet
          root in the same fragment. The checkout request is byte-identical to the
          prior EBES event path (handleBuy ported): same lines/buyer, NO address /
          taxCalculationId, NO paymentPlanChoice (events have no plan). */}
      <TicketCartSheet
        visible={cartVisible}
        eventId={seed.eventId}
        tickets={ticketsQuery.data}
        intakeSchemasByTier={intakeSchemasQuery.data}
        fallbackCurrency={seed.currency}
        initialTicketTypeId={initialTicketTypeId}
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
    </>
  );
}

// ---- ConsumerTierRow — one selectable tier in the radiogroup ----
const ConsumerTierRow: React.FC<{
  ticket: PublicTicketProps;
  fallbackCurrency: string;
  palette: ReturnType<typeof createThemePalette>;
  surface: ReturnType<typeof offeringSurfaceStyles>;
  boldFamily: string;
  selected: boolean;
  onSelect: (ticketId: string) => void;
}> = ({ ticket, fallbackCurrency, palette, surface, boldFamily, selected, onSelect }) => {
  const isDisabled = ticket.visibility === "disabled";
  const isSoldOut = !ticket.isUnlimited && (ticket.capacity ?? 0) === 0;
  const isDoorOnly = ticket.availableAt === "door";
  const saleEnded =
    ticket.saleEndAt !== null &&
    Number.isFinite(new Date(ticket.saleEndAt).getTime()) &&
    new Date(ticket.saleEndAt).getTime() <= Date.now();

  const stateWord: string | null = saleEnded
    ? "Sales ended"
    : isDisabled
      ? "Sales paused"
      : isDoorOnly
        ? "Pay at the door"
        : isSoldOut
          ? "Sold out"
          : null;
  const selectable = stateWord === null;

  const priceLabel = ticket.isFree
    ? "Free"
    : (() => {
        const price = ticket.priceAllInGbp ?? ticket.priceGbp;
        if (price === null || price === undefined) return "—";
        const currency = ticket.currency ?? fallbackCurrency;
        try {
          return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency,
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          }).format(price);
        } catch {
          return `${currency} ${price.toFixed(2)}`;
        }
      })();

  const capacityLabel = ticket.isUnlimited
    ? "Unlimited"
    : ticket.capacity !== null
      ? ticket.capacity <= 0
        ? "Sold out"
        : `${ticket.capacity} available`
      : "Available";

  return (
    <Pressable
      onPress={selectable ? () => onSelect(ticket.id) : undefined}
      disabled={!selectable}
      accessibilityRole={selectable ? "radio" : "text"}
      accessibilityState={selectable ? { checked: selected } : undefined}
      accessibilityLabel={
        ticket.name +
        (priceLabel !== "—" ? `, ${priceLabel}` : "") +
        (stateWord !== null ? `, ${stateWord}` : "")
      }
      style={[
        styles.tierRow,
        surface.card,
        selected
          ? { borderColor: palette.accent, backgroundColor: palette.accentWash }
          : null,
        isDisabled || isSoldOut || saleEnded ? styles.tierRowMuted : null,
      ]}
    >
      {selected ? (
        <View
          pointerEvents="none"
          style={[styles.tierRail, { backgroundColor: palette.accent }]}
        />
      ) : null}
      <View
        style={[
          styles.radio,
          { borderColor: selected ? palette.accent : palette.cutoutBorder },
        ]}
      >
        {selected ? (
          <View style={[styles.radioDot, { backgroundColor: palette.accent }]} />
        ) : null}
      </View>
      <View style={styles.tierTextCol}>
        <Text
          style={[
            styles.tierName,
            surface.primaryText,
            selected ? { fontFamily: boldFamily } : null,
          ]}
        >
          {ticket.name}
        </Text>
        {ticket.description !== null && ticket.description.length > 0 ? (
          <Text style={[styles.tierDesc, surface.secondaryText]}>
            {ticket.description}
          </Text>
        ) : null}
        <Text style={[styles.tierCap, surface.tertiaryText]}>
          {stateWord ?? capacityLabel}
        </Text>
      </View>
      <View
        style={[
          styles.tierPricePill,
          { backgroundColor: palette.accentWash, borderColor: palette.panelBorder },
        ]}
      >
        <Text style={[styles.tierPrice, surface.primaryText, { fontFamily: boldFamily }]}>
          {priceLabel}
        </Text>
      </View>
    </Pressable>
  );
};

const SEAM = 28;

const styles = StyleSheet.create({
  nativeCover: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    aspectRatio: 4 / 5,
    zIndex: 1,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  coverScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.22)",
  },
  nativeScroll: { zIndex: 2 },
  nativeScrollContent: { flexGrow: 1 },
  coverSpacer: { width: "100%", aspectRatio: 4 / 5 },
  nativeBody: {
    zIndex: 2,
    marginTop: -SEAM,
    borderTopLeftRadius: SEAM,
    borderTopRightRadius: SEAM,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingTop: 24,
    paddingHorizontal: 20,
  },
  nativeChrome: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 70,
  },
  leadBlock: { marginBottom: 4 },
  eyebrowLead: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  fndTitle: { fontSize: 32, lineHeight: 35, fontWeight: "900", letterSpacing: -0.5 },
  metaChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  metaChipText: { fontSize: 13, fontWeight: "600" },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 18,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  brandTile: {
    width: 42,
    height: 42,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "#1a1c20",
  },
  brandInitialWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  brandInitial: { fontSize: 18, fontWeight: "900" },
  brandTextCol: { flexShrink: 1 },
  // ORCH-1155 [public-brand-page] — trailing "View" CTA on the brand chip
  // (parity with the web/business event page + trip/experience consumer screens).
  brandCta: { marginLeft: "auto", fontSize: 12, fontWeight: "800" },
  brandKicker: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  brandName: { fontSize: 15, fontWeight: "800", marginTop: 1 },
  section: { marginTop: 24 },
  secTitle: { fontSize: 20, fontWeight: "900", letterSpacing: -0.3, marginBottom: 12 },
  aboutText: { fontSize: 16, lineHeight: 23 },
  aboutToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 44,
  },
  aboutToggleText: { fontSize: 14, fontWeight: "600" },
  venueCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    padding: 14,
  },
  venueDisk: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  venueGlyph: { fontSize: 18, fontWeight: "900" },
  venueTextCol: { flex: 1, minWidth: 0 },
  venueName: { fontSize: 15, fontWeight: "800" },
  venueAddr: { fontSize: 13, marginTop: 2 },
  venuePill: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  venuePillText: { fontSize: 12, fontWeight: "800" },
  reassure: { fontSize: 12, marginTop: 12, lineHeight: 17 },
  tierCol: { gap: 10 },
  tierRow: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    overflow: "hidden",
  },
  tierRowMuted: { opacity: 0.7 },
  tierRail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: { width: 10, height: 10, borderRadius: 999 },
  tierTextCol: { flex: 1, minWidth: 0 },
  tierName: { fontSize: 15, fontWeight: "800" },
  tierDesc: { fontSize: 13, marginTop: 3, lineHeight: 18 },
  tierCap: { fontSize: 12, fontWeight: "700", marginTop: 4 },
  tierPricePill: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tierPrice: { fontSize: 15, fontWeight: "900" },
  stateBody: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 64,
    paddingHorizontal: 24,
    gap: 12,
  },
  stateTitle: { fontSize: 17, fontWeight: "600", color: "#FFFFFF", marginTop: 12, textAlign: "center" },
  stateSub: { fontSize: 14, color: "rgba(255,255,255,0.7)", textAlign: "center" },
  retryBtn: {
    marginTop: 16,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 22,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  retryText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
});

// ORCH-1157 — RSVP decision dock wrapper. The Going/Maybe/Can't buttons + their
// opaque-Android fills now live in the shared RsvpMomentumDecision; this is just
// the dock padding (matches the float→dock pattern of the reserve bar).
const rsvpStyles = StyleSheet.create({
  dock: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
});
