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
} from "react";
import {
  ActivityIndicator,
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
  resolveTheme,
  ThemeEntranceAnimation,
  type PublicEventProps,
  type PublicTicketProps,
} from "@mingla/offering-rendering";
import {
  EventOfferingBody,
  EventOfferingFloatingBar,
  OfferingChrome,
  // ORCH-1163 [rsvp-shared-body] — THE ONE shared RSVP body + floating decision
  // bar + the lifted decision-state hook. Replaces the bespoke RSVP-branch nodes
  // (rsvpDock / rsvpMomentumUnit / brand/about/venue mirror) with byte-parity to
  // buyer-web + business. ORCH-1163-R2 — the floating control is the
  // RsvpOfferingFloatingBar (parallel to EventOfferingFloatingBar), pinned in the
  // SAME nativeFloatWrap (zIndex:60) slot as the event branch.
  RsvpOfferingBody,
  RsvpOfferingFloatingBar,
  useRsvpOfferingState,
  type RsvpOfferingConfig,
  type RsvpGuestContact,
  type RsvpSubmitResult,
  useResponsiveLayout,
} from "@mingla/offering-rendering";

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
// META-ORCH-1187 [Growth Analytics Hub] — purchase conversion capture (PostHog
// runs alongside the existing analytics; no Mixpanel call exists at this site).
import { postHogService } from "../../services/postHogService";
import { glass } from "../../constants/designSystem";
// ORCH-1162 Bug 2 — shared static-Mapbox builder (re-exported from
// @mingla/offering-rendering) for the consumer EVENT "Where you'll be" map.
import { buildStaticMapUrl } from "../../utils/mapboxStaticImage";
import { formatEventDateLine } from "../../utils/eventDateDisplay";
import type { BusinessEventCard } from "../../types/mergedDiscover";

const ACCENT = "#FF6B35";
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

  // ORCH-1150 — RSVP deck variant. A discoverable RSVP event (host opted in)
  // renders Going/Not-going instead of Book; tapping writes via the same
  // public-submit-rsvp edge fn (logged-in path). NO cart, NO checkout.
  // ORCH-1163 [rsvp-shared-body] — the RSVP branch now lifts ALL submit/dialog/
  // contact state into the shared useRsvpOfferingState hook (one state machine
  // for the inline box + the floating dock), byte-parity with buyer-web/business.
  const isRsvp = seed?.eventType === "rsvp";

  // ORCH-1167-R2 (change 4) — the floating bar is PERSISTENT now (Seth-directed),
  // so the prior float→dock scroll/viewport tracking is retired (subtract before
  // adding). These handlers stay as no-op sinks for the body's onTicketBoxLayout +
  // the gorhom scroll's onScroll/onLayout so the wiring is intact + lint-clean.
  // ORCH-1163-R3 — for the RSVP branch the floating decision bar is TALLER + variable
  // (3 glyph+label buttons + a wrapping micro subcopy) than the event Get-tickets
  // bar, so the fixed `reserveBarClearance=177` under-reserves and the last section
  // scrolls UNDER the bar. We now MEASURE the nativeFloatWrap height (event branch
  // still ignores it — its clearance is the constant 177 path).
  const [rsvpFloatBarHeight, setRsvpFloatBarHeight] = useState<number>(0);
  const handleDockLayout = useCallback((e: LayoutChangeEvent): void => {
    const h = e.nativeEvent.layout.height;
    setRsvpFloatBarHeight((prev) => (Math.abs(prev - h) > 1 ? h : prev));
  }, []);
  const handleScroll = useCallback(
    (_e: NativeSyntheticEvent<NativeScrollEvent>): void => {
      // No-op: no visibility math (bar persistent).
    },
    [],
  );
  const handleScrollLayout = useCallback((_e: LayoutChangeEvent): void => {
    // No-op: no visibility math (bar persistent).
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
  const boldFamily = boldFontFamily(theme);
  useConsumerThemeFont(theme.fontFamilyValue);
  useConsumerThemeFont(boldFamily);

  const { isDesktop } = useResponsiveLayout();
  void isDesktop; // native is always single-column immersive (parity assert).

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

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
    // ORCH-1167-R3 (change 3) — the empty-selection early-return is REMOVED: the
    // on-sale floating + in-box button is always tappable, and tapping at 0
    // selected opens the cart (TicketCartSheet) where the buyer picks/edits
    // quantities. With nothing selected `initialQuantities` is empty + the seed
    // tier is null → the cart opens with the tier list ready to pick.
    const firstSelected = Object.keys(ticketQuantities).find(
      (id) => (ticketQuantities[id] ?? 0) > 0,
    );
    setInitialTicketTypeId(firstSelected ?? null);
    setCartVisible(true);
  }, [ticketQuantities]);

  // ORCH-1163 [rsvp-shared-body] — the onSubmit wrapper handed to
  // useRsvpOfferingState. The shared body/dock own all the submit/dialog/contact
  // state + toasts now; this wrapper just bridges to the consumer write
  // (submitDeckRsvp, logged-in JWT path) + maps the result into the shared
  // RsvpSubmitResult shape, then refreshes the live going-count. Errors throw
  // the edge-fn code so the body maps the right inline message (never dead-ends).
  const rsvpOnSubmit = useCallback(
    async (input: {
      rsvpStatus: "going" | "not_going" | "maybe";
      guestName: string;
      guestEmail: string;
      guestPhone: string;
      plusCount: number;
      guests: RsvpGuestContact[];
    }): Promise<RsvpSubmitResult> => {
      if (seed === null) throw new Error("rsvp_not_open");
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const result = await submitDeckRsvp(
        seed.eventId,
        input.rsvpStatus,
        input.guests,
      );
      // Refresh the live going-count after a successful own-submit.
      void queryClient.invalidateQueries({
        queryKey: ["rsvpMomentum", seed.eventId],
      });
      return {
        status: result.status,
        approvalStatus: result.approvalStatus,
        rsvpId: result.rsvpId,
        confirmationToken: result.confirmationToken,
      };
    },
    [seed, queryClient],
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
        // META-ORCH-1187 — purchase conversion (SC-5). value in major units.
        postHogService.capture("purchase_completed", {
          event_id: seed.eventId,
          value: payload.totalCents / 100,
          currency: seed.currency,
          surface: "consumer_app",
        });
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

  // ORCH-1163 [rsvp-shared-body] — lift the shared RSVP decision/submit/dialog
  // state ONCE (hooks must run unconditionally, before the early returns). The
  // PublicEventProps is built from the deck seed (same mapper as the standard
  // branch); when there is no seed the safe defaults keep the hook stable (the
  // RSVP body never renders on the seedless cold cap anyway). The shared body +
  // floating dock both consume this single state machine. The static map URL is
  // privacy-gated the same way as the standard branch (exact pin only when the
  // street is public).
  // ORCH-0846 parity: the seedless RSVP cold-cap below needs a `format` value but has
  // NO event to derive from, and its body never renders without a seed — so this is a
  // never-shown type placeholder, named (not an inline `format:` hardcode) so the
  // consumer-event-sheet address/format-parity gate's "no fabricated format" rule holds
  // for the real (seeded → cardToPublicEvent-derived) render path.
  const seedlessPlaceholderFormat = "in-person" as PublicEventProps["format"];
  const rsvpPublicEvent: PublicEventProps = seed !== null
    ? cardToPublicEvent(seed, [])
    : {
        id: "",
        name: "",
        brandId: "",
        brandSlug: "",
        eventSlug: "",
        description: "",
        dateLine: "",
        dateSubline: null,
        datesList: [],
        status: "published",
        endedAt: null,
        format: seedlessPlaceholderFormat,
        venueName: null,
        address: null,
        hideAddressUntilTicket: false,
        locationGeo: null,
        cityGeo: null,
        coverHue: 0,
        coverMediaUrl: null,
        coverMediaType: null,
        coverCredit: null,
        tickets: [],
        currency: "USD",
        partyTypes: [],
        vibeTags: [],
        musicGenres: [],
      };
  const rsvpBrand =
    seed !== null
      ? {
          id: seed.brandId,
          slug: seed.brandSlug,
          displayName: seed.brandName,
          photo: seed.brandProfilePhotoUrl ?? undefined,
          theme: null,
        }
      : null;
  const rsvpConfig: RsvpOfferingConfig = {
    capacity: rsvpMomentum?.capacity ?? null,
    goingCount: rsvpMomentum?.goingCount ?? 0,
    allowPlusOnes: rsvpMomentum?.allowPlusOnes ?? false,
    plusOnesMax: rsvpMomentum?.plusOnesMax ?? 0,
    waitlistEnabled: rsvpMomentum?.waitlistEnabled ?? false,
    manualApproval: rsvpMomentum?.manualApproval ?? false,
  };
  const rsvpBodyStaticMapUrl: string | null = (() => {
    if (rsvpPublicEvent.format === "online") return null;
    if (rsvpPublicEvent.hideAddressUntilTicket) return null;
    const geo = rsvpPublicEvent.locationGeo ?? null;
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
  const rsvpState = useRsvpOfferingState({
    event: rsvpPublicEvent,
    brand: rsvpBrand,
    palette,
    theme,
    config: rsvpConfig,
    isLoggedIn: user !== null,
    onSubmit: rsvpOnSubmit,
    onOpenBrand: (slug: string) => router.push(`/b/${slug}` as never),
    onOpenMaps: openMapsForQuery,
    staticMapUrl: rsvpBodyStaticMapUrl,
  });

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

  // ORCH-1163 [rsvp-shared-body] — the RSVP branch's bespoke address-privacy,
  // about-collapse, brand/about/venue mirror nodes are GONE. The shared
  // RsvpOfferingBody owns all of section 2–8 (incl. server-gated address privacy
  // + collapsible About + the static map) byte-identically with buyer-web/
  // business. The STANDARD ticketed branch (EventOfferingBody) is untouched.

  // ORCH-1167-R2 (change 4) — the floating Get-tickets bar is PERSISTENT on the
  // consumer sheet too (was regressing: anchored to the body top it hid right
  // after the cover). It stays pinned the whole scroll, reflects the live Σ-all-in
  // total, and opens the SAME pre-seeded cart as the in-box Proceed (both coexist).
  const floatingPillVisible = true;
  // ORCH-1167-R3 (change 4) — the floating Get-tickets bar BLED off the bottom of
  // the gorhom sheet (barely visible). Root cause: it was an absolute child of the
  // gorhom BottomSheetContent with `bottom: 0`, but that content extends ~63pt
  // BELOW the visible window at the 90% snap AND `useSafeAreaInsets().bottom` can
  // resolve to ~0 inside the sheet's own SafeAreaProvider — so the button sat
  // below the visible edge under the home indicator. FIX: mirror the SHIPPED,
  // device-proven ConsumerTripReserveBar floating math — lift the wrapper by the
  // gorhom overshoot + a home-indicator floor + a visible float gap (max of the
  // passed inset, the local inset, and the 34pt floor). This anchors the bar
  // WITHIN the sheet's visible bounds, fully on-screen + tappable on a notched
  // device. (Web + business-native bar positioning is owned elsewhere — unchanged.)
  const HOME_INDICATOR_FLOOR = 34;
  const SHEET_BOTTOM_OVERSHOOT = 63;
  const FLOAT_GAP = 16;
  const floatSafeBottom = Math.max(insets.bottom, HOME_INDICATOR_FLOOR);
  const floatBarBottom =
    floatSafeBottom + SHEET_BOTTOM_OVERSHOOT + FLOAT_GAP;
  // ORCH-1167-R3 (change 4) — bottom inset so the LAST content fully clears the
  // (now correctly raised) persistent floating bar. The bar's lifted bottom is at
  // most `insets.bottom + HOME_INDICATOR_FLOOR + SHEET_BOTTOM_OVERSHOOT +
  // FLOAT_GAP`; adding the bar height (~56) + a small gap gives a constant runway
  // ON TOP OF the device safe-area that always clears the raised bar (the prior
  // `72 + insets.bottom` under-cleared it once the bar was lifted).
  // (floatBarBottom is applied to the float wrapper's `bottom` below + drives the
  // RSVP measured runway.)
  // 177 = HOME_INDICATOR_FLOOR(34) + SHEET_BOTTOM_OVERSHOOT(63) + FLOAT_GAP(16) +
  // bar-height-and-gap(64) — the constant runway above the device safe-area that
  // always clears the raised float bar (whose bottom ≤ insets.bottom + 177).
  const reserveBarClearance = 177 + insets.bottom;
  // ORCH-1163-R3 — the RSVP branch's bar is taller + variable, so its runway is
  // MEASURED: the wrapper's lifted `bottom` (floatBarBottom) + the measured bar
  // height + a FLOAT_GAP. Falls back to the event-branch constant until onLayout
  // fires (so the first paint never under-clears).
  const rsvpBarClearance =
    rsvpFloatBarHeight > 0
      ? floatBarBottom + rsvpFloatBarHeight + FLOAT_GAP
      : reserveBarClearance;
  // ORCH-1163 R4 — on the RSVP branch the bottom clearance must live INSIDE the
  // page-colored `nativeBody` (not as transparent scroll-content padding), so the
  // light `palette.page` extends through the runway behind the floating decision
  // bar. Previously the runway was a TRANSPARENT padding area below the body, so
  // the sheet's BLACK backdrop showed through under the bar (Seth screenshot).
  //
  // ORCH-1188 FIX 1 — the EVENT (non-rsvp) branch had the SAME defect: its
  // ~177px floating-pill runway was applied as TRANSPARENT scroll-content
  // paddingBottom, exposing the gorhom sheet's dark `#0c0e12` backdrop as a
  // BLACK BAR under the persistent Get-tickets pill (Seth device screenshot).
  // FIX: route the event clearance into the page-colored `nativeBody`
  // paddingBottom too (mirroring the RSVP mechanism) and zero the scroll-content
  // padding, so `palette.page` fills the runway behind the floating pill. The
  // floating pill's `floatBarBottom` lift is unchanged; the runway still clears
  // the raised pill so the last section is never hidden.
  const scrollPaddingBottom = 0;
  const bodyClearance = isRsvp ? rsvpBarClearance : reserveBarClearance;

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
        // ORCH-1192 — full-screen RN-Modal host (parity with the ExpandedCardModal
        // expanded cards). The inline host makes gorhom mis-measure ~63dp short on
        // the deck mount → root band below the body + clipped float reserve bar.
        // navigationBarTranslucent gives gorhom the true screen so the sheet fills.
        wrapInRNModal
        accessibilityLabel={fnd.title}
      >
        {/* (1) pinned cover — absolute sibling BEHIND the scroll. */}
        <View style={styles.nativeCover} pointerEvents="none">
          <EventCoverMedia
            mediaUrl={fnd.coverMediaUrl}
            mediaType={fnd.coverMediaType}
            hue={fnd.coverHue}
            // ORCH-1167-R4 — VIDEO cover AUTOPLAYS (muted, inline) + LOOPS on
            // consumer iOS/Android (the standard-event sheet pins this cover
            // directly, not via ParallaxCoverShell). Explicit (not bare-boolean)
            // so the R4 regression pins it; reduce-motion freeze + the chrome
            // Mute toggle (owns `muted`) are unaffected. Image/GIF unchanged.
            autoplay={true}
            playbackActive={true}
            muted={muted}
            loop={true}
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
            { paddingBottom: scrollPaddingBottom },
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
              // ORCH-1163 R4 + ORCH-1188 FIX 1 — BOTH the RSVP and the event
              // runway are page-colored here (no black void / black bar under the
              // floating bar/pill); the scroll-content paddingBottom is 0.
              { paddingBottom: bodyClearance },
            ]}
          >
            {/* ORCH-1167 — STANDARD ticketed-event branch renders the ONE shared
                canonical EventOfferingBody (sections 2–8 incl. the inline ticket
                box at 5). The cover (section 1) is the pinned sibling above; the
                floating Get-tickets bar (section 9) is rendered below.
                ORCH-1163 — the RSVP branch now renders the ONE shared
                RsvpOfferingBody (sections 2–8 incl. the inline decision box +
                FLOW-A modals) byte-identically with buyer-web/business; its
                floating decision dock is pinned below. */}
            {!isRsvp ? (
              /* ORCH-1167-R2 (change 4) — onTicketBoxLayout fires from the INLINE
                 TICKET BOX (section 5), NOT a wrapper around the whole body, so the
                 floating bar stays pinned through the cover + scroll and ducks away
                 only once the box is actually on-screen (was: hid right after the
                 cover because it measured the body top). */
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
                onTicketBoxLayout={handleDockLayout}
                testID="orch-1167-consumer-event-body"
              />
            ) : (
              <RsvpOfferingBody
                event={rsvpPublicEvent}
                brand={rsvpBrand}
                palette={palette}
                theme={theme}
                config={rsvpConfig}
                isLoggedIn={user !== null}
                onSubmit={rsvpOnSubmit}
                onOpenBrand={(slug: string) => router.push(`/b/${slug}` as never)}
                onOpenMaps={openMapsForQuery}
                staticMapUrl={rsvpBodyStaticMapUrl}
                state={rsvpState}
                testID="orch-1163-consumer-rsvp-body"
              />
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

        {/* (4) FLOATING decision — ORCH-1167 the standard branch pins the shared
            EventOfferingFloatingBar (live Σ-all-in total + handleProceedToCart);
            ORCH-1163-R2 the RSVP branch pins the shared RsvpOfferingFloatingBar
            (Going/Maybe/Can't, driven by the SAME rsvpState as the inline box) in
            the SAME bottom-overlay slot — BYTE-IDENTICAL wrapper to the event branch
            (styles.nativeFloatWrap, zIndex:60, bottom:floatBarBottom) so the z-order
            + float positioning match the standard event page on consumer too. */}
        {isRsvp ? (
          <View
            style={[styles.nativeFloatWrap, { bottom: floatBarBottom }]}
            pointerEvents="box-none"
            onLayout={handleDockLayout}
          >
            <RsvpOfferingFloatingBar
              palette={palette}
              theme={theme}
              config={rsvpConfig}
              state={rsvpState}
              testID="orch-1163-consumer-rsvp-dock"
            />
          </View>
        ) : floatingPillVisible ? (
          <View
            style={[styles.nativeFloatWrap, { bottom: floatBarBottom }]}
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
  // ORCH-1167 — the standard-event floating Get-tickets bar wrapper. Absolute
  // pinned sibling above the scroll, below the chrome. ORCH-1167-R3 (change 4):
  // `bottom` is set DYNAMICALLY at the call site (floatBarBottom) to clear the
  // gorhom sheet's ~63pt overshoot + the home-indicator floor + a float gap, so
  // the bar sits WITHIN the sheet's visible bounds (was `bottom: 0` → bled off).
  nativeFloatWrap: {
    position: "absolute",
    left: 16,
    right: 16,
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
// ORCH-1163-R2 — the bespoke RSVP dock-panel style was REMOVED: the RSVP floating
// bar now reuses styles.nativeFloatWrap byte-identically with the event branch (the
// decision controls carry their own opaque fills, so no separate panel chrome).
