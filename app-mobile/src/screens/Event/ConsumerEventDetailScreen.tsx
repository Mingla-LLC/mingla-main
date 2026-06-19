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
  Image,
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
  resolveRsvpCta,
  resolveTheme,
  ThemeEntranceAnimation,
  type PublicEventProps,
  type PublicTicketProps,
  type RsvpCtaState,
} from "@mingla/event-rendering";
import {
  EventOfferingBody,
  EventOfferingFloatingBar,
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
// ORCH-1162 Bug 2 — shared static-Mapbox builder (re-exported from
// @mingla/event-rendering) for the consumer EVENT "Where you'll be" map.
import { buildStaticMapUrl } from "../../utils/mapboxStaticImage";
import { formatEventDateLine } from "../../utils/eventDateDisplay";
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

// Build the PublicEventProps the SHARED state machine + the canonical
// EventOfferingBody read. ORCH-1167 — threads the pills (vibes/party/music) +
// the formatted date line so the consumer standard-event body renders the SAME
// canonical 9-section structure as buyer-web/business from the deck seed (warm
// path). RSVP rows still feed only the CTA machine (the RSVP body is separate).
const cardToPublicEvent = (
  card: BusinessEventCard,
  tickets: PublicTicketProps[],
): PublicEventProps => {
  const dateLine = formatEventDateLine({
    masterDateUtc: card.masterDateUtc,
    masterEndAtUtc: card.masterEndAtUtc,
    timezone: card.timezone,
  });
  return {
    id: card.eventId,
    name: card.title,
    brandId: card.brandId,
    brandSlug: card.brandSlug,
    eventSlug: card.eventSlug,
    description: card.description ?? "",
    dateLine: dateLine.length > 0 ? dateLine : "",
    dateSubline: null,
    datesList: [],
    status: "published",
    endedAt: null,
    format: card.format,
    venueName: card.venueName,
    address: card.address,
    hideAddressUntilTicket: card.hideAddressUntilTicket,
    locationGeo: card.locationGeo ?? null,
    cityGeo: null,
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
    // ORCH-1157/1167 — canonical pills threaded from the deck seed (rule 9: []).
    partyTypes: card.partyTypes ?? [],
    vibeTags: card.vibeTags ?? [],
    musicGenres: card.musicGenres ?? [],
  };
};

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
  // ORCH-1167 [event-page-canonical] — the inline ticket-box per-tier quantities
  // (the canonical EventOfferingBody owns selection on the standard-event branch).
  // onProceedToCart opens TicketCartSheet PRE-SEEDED with this multi-tier map.
  const [ticketQuantities, setTicketQuantities] = useState<Record<string, number>>(
    {},
  );
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

  // ORCH-1167 — inline ticket-box quantity setter + proceed-to-cart. The box
  // lifts its quantities here; Proceed (in-box) + the floating bar both open the
  // existing TicketCartSheet PRE-SEEDED with the full multi-tier selection (the
  // cart lands editable). Empty selection → no-op (the CTA is disabled anyway).
  const handleChangeTicketQuantity = useCallback(
    (ticketTypeId: string, qty: number): void => {
      setTicketQuantities((prev) => {
        const next = { ...prev };
        if (qty <= 0) delete next[ticketTypeId];
        else next[ticketTypeId] = qty;
        return next;
      });
    },
    [],
  );
  const handleProceedToCart = useCallback((): void => {
    const anySelected = Object.values(ticketQuantities).some((q) => q > 0);
    if (!anySelected) return;
    // Seed the cart sheet at the FIRST selected tier for back-compat with the
    // single-seed contract; initialQuantities carries the FULL selection.
    const firstSelected = Object.keys(ticketQuantities).find(
      (id) => (ticketQuantities[id] ?? 0) > 0,
    );
    setInitialTicketTypeId(firstSelected ?? null);
    setCartVisible(true);
  }, [ticketQuantities]);

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

  // ORCH-1167 [event-page-canonical] — the standard-event PublicEventProps for the
  // shared EventOfferingBody (warm path from the deck seed). RSVP rows do NOT use
  // this (their body is the separate RsvpPublicBody section sequence). The static
  // map URL is privacy-gated: exact pin when the street is public, else null on the
  // warm path (no city centroid on the deck seed) → text venue card (rule 9).
  const publicEventForBody: PublicEventProps = cardToPublicEvent(seed, tickets);
  const bodyStaticMapUrl: string | null = (() => {
    if (publicEventForBody.format === "online") return null;
    if (publicEventForBody.hideAddressUntilTicket) return null;
    const geo = publicEventForBody.locationGeo ?? null;
    if (geo === null || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lng)) {
      return null;
    }
    return buildStaticMapUrl({
      lat: geo.lat,
      lng: geo.lng,
      accentHex: palette.accent,
      height: 180,
    });
  })();

  const cityCountry =
    fnd.cityCountry ?? normalizeCityCountry(seed.city) ?? null;
  const aboutText = fnd.description;
  const canCollapseAbout =
    aboutText !== null && aboutText.length > ABOUT_COLLAPSE_THRESHOLD;
  const aboutCollapsedNow = canCollapseAbout && aboutCollapsed;
  // ORCH-1157 Issue 2 [rsvp-address-privacy] — for an RSVP event there is no
  // "ticket purchase"; the exact street is revealed once the viewer's own RSVP
  // status is GOING or MAYBE (Seth-locked), else City/Country only. The ticketed
  // path keeps its existing purchase gate. Anon / unknown → hide. The flag is the
  // anon-safe `hideAddressUntilTicket` (theme.business_event), never `.from(...)`.
  const rsvpAddressRevealed = rsvpStatus === "going" || rsvpStatus === "maybe";
  const addressHidden = isRsvp
    ? fnd.hideAddressUntilTicket && !rsvpAddressRevealed
    : fnd.hideAddressUntilTicket;
  const addressHiddenLabel = isRsvp
    ? (cityCountry ?? "Address shared after you RSVP")
    : "Address shared after ticket purchase";
  // ORCH-1157 Round-6 [rsvp-public-redesign] — when the exact street is HIDDEN,
  // show a short caption UNDER the city explaining HOW to unlock it (the city
  // alone left users guessing). Condition-aware: RSVP unlocks on going/maybe,
  // ticketed unlocks on purchase. Static helper text (not fabricated data); it
  // renders ONLY while `addressHidden` is true (suppressed once revealed).
  const addressUnlockCaption: string | null = addressHidden
    ? isRsvp
      ? "Full address shared once you're going"
      : "Full address shared after you get tickets"
    : null;
  const venueAddressLabel = addressHidden
    ? addressHiddenLabel
    : fnd.format === "hybrid" && fnd.address !== null
      ? `${fnd.address} · also online`
      : (fnd.address ?? addressHiddenLabel);
  // ORCH-1157 Round-5 [rsvp-address-privacy] — defense-in-depth for the venue
  // NAME line. The address gate only masks `venueAddressLabel`; the name line
  // renders `fnd.venueName`. If a row reaches here with the full street folded
  // into the venueName (the legacy `location_text` fallback, e.g.
  // "The Party Venue · 700 Corporate Center Drive…"), the name line would leak
  // the street even with the gate ON. When the address is hidden, never render a
  // name that still contains the street: take the portion before the canonical
  // " · " name/address separator, and if the remainder still contains the full
  // address, drop to the venue name only / null so the street can never paint.
  const venueNameDisplay: string | null = (() => {
    if (fnd.venueName === null) return null;
    if (!addressHidden) return fnd.venueName;
    const namePart = fnd.venueName.split(" · ")[0]?.trim() ?? fnd.venueName;
    if (fnd.address !== null && namePart.includes(fnd.address)) {
      // Even the leading segment carries the street — suppress it entirely.
      return null;
    }
    return namePart.length > 0 ? namePart : null;
  })();
  const venueMapsQuery =
    addressHidden || fnd.venueName === null
      ? null
      : [fnd.venueName, fnd.address].filter(Boolean).join(", ");

  const REVEAL_MARGIN = 24;
  const floatingPillVisible =
    dockTopY === null || viewportH === 0
      ? true
      : dockTopY > scrollY + viewportH - REVEAL_MARGIN;
  const reserveBarClearance = 8;

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
          showDecision={false}
          testID="orch-1157-consumer-rsvp-momentum"
        />
      </View>
    ) : null;

  // ORCH-1157 Issue 1 [rsvp-public-redesign] — structural-parity nodes. The
  // consumer body is shared by ticketed + RSVP; extracting brand / about / venue
  // into nodes lets the RSVP branch render them in the SAME section order as the
  // business/web RsvpPublicBody (brand → momentum → date+doors → venue → about),
  // while the ticketed path keeps its byte-identical order (brand → about → venue
  // → tickets). This is the "mirror the shared body" approach (dispatch option b).
  const brandNode: ReactElement = (
    <Pressable
      style={[styles.brandRow, surface.card]}
      accessibilityRole="button"
      accessibilityLabel={`View ${fnd.brandName}`}
      onPress={() => {
        if (typeof fnd.brandSlug === "string" && fnd.brandSlug.length > 0) {
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
          {isRsvp ? "Hosted by" : "Presented by"}
        </Text>
        <Text
          style={[styles.brandName, surface.primaryText, { fontFamily: boldFamily }]}
        >
          {fnd.brandName}
        </Text>
      </View>
      <Text style={[styles.brandCta, { color: palette.accent }]}>View</Text>
    </Pressable>
  );

  const aboutNode: ReactElement | null =
    aboutText !== null ? (
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
    ) : null;

  const venueNode: ReactElement | null =
    fnd.format === "online" ? (
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
              {isRsvp
                ? "Link shared with confirmed guests."
                : "Conferencing link shared with ticketed guests."}
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
        {/* ORCH-1162 Bug 2 — static-Mapbox map above the venue card (parity with
            the consumer EXPERIENCE screen + the shared event renderer). Rule-9:
            only renders when fnd.lat/lng are finite AND a Mapbox token resolves
            (buildStaticMapUrl non-null); otherwise nothing renders here and the
            tappable venue card below is the honest fallback. */}
        {(() => {
          if (!Number.isFinite(fnd.lat) || !Number.isFinite(fnd.lng)) {
            return null;
          }
          const mapUrl = buildStaticMapUrl({
            lat: fnd.lat as number,
            lng: fnd.lng as number,
            accentHex: palette.accent,
            height: 180,
          });
          if (mapUrl === null) return null;
          return (
            <Image
              source={{ uri: mapUrl }}
              style={[styles.whereMap, { borderColor: palette.panelBorder }]}
              resizeMode="cover"
              accessibilityLabel={`Map of ${venueNameDisplay ?? fnd.venueName}`}
              testID="orch-1162-consumer-event-map"
            />
          );
        })()}
        <Pressable
          onPress={() => {
            if (venueMapsQuery !== null) openMapsForQuery(venueMapsQuery);
          }}
          disabled={venueMapsQuery === null}
          accessibilityRole={venueMapsQuery !== null ? "button" : undefined}
          accessibilityLabel={
            venueMapsQuery !== null
              ? `Open ${venueNameDisplay ?? fnd.venueName} in maps`
              : (venueNameDisplay ?? addressHiddenLabel)
          }
          style={[styles.venueCard, surface.card]}
        >
          <View style={[styles.venueDisk, { backgroundColor: palette.accent }]}>
            <Text style={[styles.venueGlyph, { color: palette.accentText }]}>⌖</Text>
          </View>
          <View style={styles.venueTextCol}>
            {/* ORCH-1157 Round-5 — render the SANITIZED venue name (never the
                street-folded fallback) when the address is hidden. Falls back to
                the City/Country hidden label when the name itself is the street. */}
            <Text style={[styles.venueName, surface.primaryText, { fontFamily: boldFamily }]}>
              {venueNameDisplay ?? addressHiddenLabel}
            </Text>
            {/* Suppress the sub-line when the name fell back to the hidden label
                so the City/Country caption never paints twice. */}
            {venueNameDisplay === null && venueAddressLabel === addressHiddenLabel ? null : (
              <Text style={[styles.venueAddr, surface.secondaryText]}>
                {venueAddressLabel}
              </Text>
            )}
            {/* ORCH-1157 Round-6 — unlock caption UNDER the city, only while the
                street is hidden (condition-aware copy). */}
            {addressUnlockCaption !== null ? (
              <Text
                style={[styles.venueUnlockCaption, surface.tertiaryText]}
                testID="orch-1157-consumer-address-unlock-caption"
              >
                {addressUnlockCaption}
              </Text>
            ) : null}
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
            {/* ORCH-1167 — STANDARD ticketed-event branch renders the ONE shared
                canonical EventOfferingBody (sections 2–8 incl. the inline ticket
                box at 5). The cover (section 1) is the pinned sibling above; the
                floating Get-tickets bar (section 9) is rendered below. The RSVP
                branch is UNCHANGED (its own section sequence + dock). */}
            {!isRsvp ? (
              <View onLayout={handleDockLayout}>
              <EventOfferingBody
                event={publicEventForBody}
                brand={{
                  id: seed.brandId,
                  slug: seed.brandSlug,
                  displayName: seed.brandName,
                  photo: seed.brandProfilePhotoUrl ?? undefined,
                  theme: null,
                }}
                variant={computeOfferingVariant(publicEventForBody, false)}
                bookable
                palette={palette}
                theme={theme}
                ticketQuantities={ticketQuantities}
                onChangeTicketQuantity={handleChangeTicketQuantity}
                onProceedToCart={handleProceedToCart}
                onOpenBrand={(slug: string) => router.push(`/b/${slug}` as never)}
                onOpenMaps={openMapsForQuery}
                staticMapUrl={bodyStaticMapUrl}
                submitting={checkoutInFlight}
                testID="orch-1167-consumer-event-body"
              />
              </View>
            ) : (
              <>
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

            {/* ORCH-1157 Issue 4 [doors] / Round-7 [doors pill] — doors time in a
                PILL styled exactly like the date chip above (same metaChip +
                surface.card + clock icon), placed just beneath the date row.
                Seth-locked: reuses start_at/end_at; the time itself is now
                device-locale-aware (12h "1:00 PM" / 24h "13:00") with minutes.
                REAL-DATA-ONLY: omitted entirely when there is no start time. */}
            {fnd.doorsLine !== null ? (
              <View style={styles.doorsChipRow}>
                <View style={[styles.metaChip, surface.card]} testID="orch-1157-consumer-doors">
                  <Icon name="time-outline" size={15} color={palette.accent} />
                  <Text
                    style={[styles.metaChipText, surface.secondaryText, { fontFamily: boldFamily }]}
                  >
                    {fnd.doorsLine}
                  </Text>
                </View>
              </View>
            ) : null}

            {/* ORCH-1157 Issue 1 [rsvp-public-redesign] — section ORDER. The RSVP
                branch mirrors the business/web RsvpPublicBody section sequence
                (host/brand → momentum [kicker+chips+count+meter+faceless cluster]
                → date+doors already above → venue → about) so the consumer RSVP
                page is structurally identical to business/web. The ticketed path
                keeps its byte-identical order (brand → about → venue → tickets).
                The momentum unit omits when the anon-view count has not resolved
                (no fabricated count — rule 9); the decision lives in the dock. */}
            {/* RSVP section sequence (host/brand → momentum → venue → about),
                structurally identical to the business/web RsvpPublicBody. */}
            {brandNode}
            {rsvpMomentumUnit}
            {venueNode}
            {aboutNode}

            {/* DOCKED RSVP decision — the LAST scroll child (float→dock). */}
            {rsvpDock}
              </>
            )}
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

        {/* (4) FLOATING Get-tickets BAR — shown while the in-page ticket box is
            off-screen. ORCH-1167 — the shared EventOfferingFloatingBar reflects the
            live Σ-all-in total + calls the SAME handleProceedToCart. Suppressed for
            RSVP (its Going/Not-going dock is inline). */}
        {isRsvp ? null : floatingPillVisible ? (
          <View
            style={[styles.nativeFloatWrap, { paddingBottom: insets.bottom + 8 }]}
            pointerEvents="box-none"
          >
            <EventOfferingFloatingBar
              event={publicEventForBody}
              variant={computeOfferingVariant(publicEventForBody, false)}
              bookable
              palette={palette}
              theme={theme}
              ticketQuantities={ticketQuantities}
              onProceedToCart={handleProceedToCart}
              submitting={checkoutInFlight}
              testID="orch-1167-consumer-event-floating-bar"
            />
          </View>
        ) : null}
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
        initialQuantities={ticketQuantities}
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
  // ORCH-1167 — the standard-event floating Get-tickets bar wrapper (off-screen-
  // box only). Absolute pinned sibling above the scroll, below the chrome.
  nativeFloatWrap: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 0,
    zIndex: 60,
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
  // ORCH-1157 Round-7 [doors pill] — doors chip row beneath the meta chips.
  // Wraps the doors pill (reuses styles.metaChip) so it aligns with the date chip.
  doorsChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
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
  // ORCH-1162 Bug 2 — consumer EVENT "Where you'll be" map (parity with the
  // consumer EXPERIENCE startMap).
  whereMap: {
    width: "100%",
    height: 180,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: "#000",
    marginBottom: 12,
  },
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
  venueUnlockCaption: { fontSize: 12, marginTop: 4 },
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
