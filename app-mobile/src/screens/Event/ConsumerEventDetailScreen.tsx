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
 * ORCH-1342 (D6 — supersedes the OQ-6 cold cap): the deck path passes `seed`
 * (a BusinessEventCard); the cold deep-link route passes `seed=null` and the
 * screen now RESOLVES a seed by slug (publicEventSeedService → anon
 * business_public_events_view read) so the full page renders cold, RSVP branch
 * included. The "Open from the app" cap is the terminal state for
 * unknown/private/deleted slugs only. `?landing=guest-list` (SPEC §4.8)
 * auto-opens the ORCH-1341 guest-list sheet once the page + socialProof settle.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  InteractionManager,
  Pressable,
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
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  boldFontFamily,
  buildHeroMediaAccessibleLabel,
  computeOfferingVariant,
  CoverGalleryPager,
  CoverGalleryRow,
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
  type RsvpPhoneFieldRenderer,
  type MapsAppId,
  type MapsOpenTarget,
  type RsvpSubmitResult,
  useResponsiveLayout,
} from "@mingla/offering-rendering";
// issue #2468 — the ONE host effect that opens a maps deep link.
import { openMapsTarget } from "../../utils/openMapsTarget";
import { copyAddressText } from "../../utils/copyAddressText";
import { getCountryByCode, type PhoneInputTheme } from "@mingla/phone-input";
import { resolveUserPhoneE164 } from "@mingla/card-identity/phone.mjs";

import {
  BaseBottomSheet,
  BottomSheetScrollView,
} from "../../components/ui/BaseBottomSheet";
import TicketCartSheet, {
  type TicketCartCheckoutPayload,
} from "../../components/expandedCard/TicketCartSheet";
// ORCH-1341 [guest-list-sheet-consumer] — the "Who's going" roster sheet, the
// destination of the ORCH-1340 onSeeWhosGoing affordance on BOTH branches.
import EventGuestListSheet from "../../components/EventGuestListSheet";
import { PhoneInput } from "../../components/onboarding/PhoneInput";
// ORCH-1359 (d) — detail-local peer-profile overlay opened by tapping a named
// guest's name in the sheet (D-B). Reuses the existing ViewFriendProfileScreen
// + the sanctioned in-app open-DM rail (never Linking.openURL — COMMS-0093).
import ViewFriendProfileScreen from "../../components/profile/ViewFriendProfileScreen";
import {
  hasOpenDirectMessageSink,
  openDirectMessageInApp,
} from "../../services/deepLinkService";
import {
  fetchRsvpMomentum,
  fetchRsvpPassPdf,
  submitDeckRsvp,
} from "../../services/rsvpDeckService";
import { useConsumerThemeFont } from "../../theme/useConsumerThemeFont";
import { usePublicEventTickets } from "../../hooks/usePublicEventTickets";
import {
  acceptRsvpLegacySeed,
  directEventColdReadPlan,
  usePublicEventBySlug,
  type CanonicalPublicEvent,
  type PublicEventOccurrenceLike,
} from "../../hooks/usePublicEventBySlug";
import { useTripIntakeSchemas } from "../../hooks/useTripIntakeSchemas";
import { useEventTheme } from "../../hooks/useEventTheme";
import {
  mapConsumerEventToFoundation,
  type ConsumerEventFoundationModel,
} from "../../hooks/useConsumerEventFoundation";
import { circleKeys, socialProofKeys } from "../../hooks/queryKeys";
// ORCH-1339 — cross-entity social proof (pg_public_social_proof, ORCH-1338).
import { fetchSocialProof } from "../../services/socialProofService";
// ORCH-1342 (D6) — the cold-route seed-by-slug read (anon
// business_public_events_view; COMMS-0009 — never `.from('brands')`).
import { fetchPublicEventSeedBySlug } from "../../services/publicEventSeedService";
import {
  type NativeCheckoutOutcome,
  type NativeCheckoutPhase,
  useNativeCheckoutFlow,
} from "../../payments/nativeCheckoutFlow";
// ORCH-1291 [rsvp-chip-in] — voluntary contribution hand-off (reuses the Stripe
// RN PaymentSheet + connected-account initStripe pattern; NO new native dep).
import { useStripePaymentSheet } from "@mingla/payments-native";
import { initStripe } from "@stripe/stripe-react-native";
import * as WebBrowser from "expo-web-browser";
import { supabase } from "../../services/supabase";
import { type ChipInResult } from "@mingla/offering-rendering";
import { toastManager } from "../../components/ui/Toast";
import { useAppStore } from "../../store/appStore";
// META-ORCH-1187 [Growth Analytics Hub] — purchase conversion capture (PostHog
// runs alongside the existing analytics; no Mixpanel call exists at this site).
import { postHogService } from "../../services/postHogService";
import { shareContent } from "../../services/contentShareAdapter";
import { glass } from "../../constants/designSystem";
// ORCH-1162 Bug 2 — shared static-Mapbox builder (re-exported from
// @mingla/offering-rendering) for the consumer EVENT "Where you'll be" map.
import { buildStaticMapUrl } from "../../utils/mapboxStaticImage";
import {
  formatEventDateLine,
  formatOccurrenceSummary,
} from "../../utils/eventDateDisplay";
import type { BusinessEventCard } from "../../types/mergedDiscover";

const ACCENT = "#FF6B35";
const SHEET_SNAP_POINTS = glass.bottomSheet.snapPoints as unknown as (
  | string
  | number
)[];
const SHEET_INITIAL_INDEX = 1; // open at the 90% snap (full view)

interface ConsumerEventDetailScreenProps {
  /**
   * The deck card seed. null on the cold deep-link route — ORCH-1342 (D6):
   * the screen now RESOLVES a seed by slug (publicEventSeedService) instead of
   * capping; the "open from the app" cap is the terminal state for
   * unknown/private/deleted slugs only.
   */
  seed?: BusinessEventCard | null;
  /** Present on the cold deep-link route (re-export). Unused on the deck path. */
  brandSlug?: string;
  eventSlug?: string;
  /**
   * ORCH-1342 (SPEC §4.8) — the OneLink deferred-funnel landing. Exactly
   * 'guest-list' (route-validated) auto-opens the ORCH-1341 guest-list sheet
   * ONCE after the page settles, iff the guest list is public and non-empty.
   */
  landing?: "guest-list";
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

const canonicalToTransientCard = (
  canonical: CanonicalPublicEvent,
): BusinessEventCard => {
  const { event, brand } = canonical;
  const paid = event.tickets
    .filter((ticket) => !ticket.isFree && ticket.priceGbp !== null)
    .map((ticket) => ticket.priceGbp as number);
  return {
    eventId: event.id,
    brandId: event.brandId,
    brandSlug: event.brandSlug,
    brandName: brand?.displayName ?? "",
    brandProfilePhotoUrl: brand?.photo ?? null,
    eventSlug: event.eventSlug,
    title: event.name,
    description: event.description,
    coverMediaUrl: event.coverMediaUrl,
    coverMediaType: event.coverMediaType,
    coverGallery: canonical.coverGallery,
    coverHue: event.coverHue,
    masterDateUtc: canonical.masterStartAt,
    masterEndAtUtc: canonical.masterEndAt,
    doorsOpenLocal: null,
    endsAtLocal: null,
    timezone: canonical.timezone,
    venueName: event.venueName,
    city: canonical.city,
    address: event.address,
    hideAddressUntilTicket: event.hideAddressUntilTicket,
    format: event.format,
    locationGeo: event.locationGeo ?? null,
    partyTypes: event.partyTypes,
    vibeTags: event.vibeTags ?? [],
    musicGenres: event.musicGenres ?? [],
    priceMin: paid.length === 0 ? null : Math.min(...paid),
    priceMax: paid.length === 0 ? null : Math.max(...paid),
    displayPriceCents: null,
    displayCurrency: event.currency,
    currency: event.currency ?? "USD",
    publicBuyerUrl: `/e/${event.brandSlug}/${event.eventSlug}`,
    eventType: "event",
    brandTheme: brand?.theme
      ? {
          color: brand.theme.color ?? null,
          font: brand.theme.font ?? null,
          animation: brand.theme.animation ?? null,
          color_override: null,
          font_override: null,
          animation_override: null,
        }
      : null,
  };
};

// issue #2468 — was a FREE-TEXT `maps://?q=<venue, address>` that Apple
// re-geocoded against the device's location and last Maps search; the same link
// resolved to a different place on a different phone. The renderer now supplies
// the stored coordinate and `openMapsTarget` anchors the link on it.
const openMapsForTarget = (
  target: MapsOpenTarget,
  app?: MapsAppId,
): void => {
  // issue #2508 — `app` is the map app the guest picked in the shared chooser;
  // undefined means nothing was asked and this is the exact #2468 path.
  openMapsTarget(target, { app });
};

// issue #2508 — the copy-address host effect, beside the maps one. The shared
// renderer owns the BUTTON; writing the clipboard is the app's job. The text it
// receives has already cleared the SAME privacy gate as the maps link
// (`selectVenueMapsTarget`), so a hide-address-until-ticket offering never
// reaches here — it renders no copy button at all.
const copyAddressForTarget = (text: string): Promise<void> =>
  copyAddressText(text);

export default function ConsumerEventDetailScreen({
  seed: seedProp = null,
  brandSlug,
  eventSlug,
  landing,
  onBack,
  tabBarAware = true,
}: ConsumerEventDetailScreenProps): React.ReactElement {
  void tabBarAware; // the sheet hides the nav; kept for prop parity with trip.
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAppStore((s) => s.user);
  const profile = useAppStore((s) => s.profile);

  // ORCH-1342 (D6, SPEC §4.7) — the cold /e/ route passes seed=null; resolve a
  // seed by slug from the anon public view so the FULL page (RSVP branch
  // included) renders cold. #2230 also runs the bundle on a warm deck open so
  // it can supplement occurrence truth only after matching the event id.
  const canonicalQuery = usePublicEventBySlug(
    seedProp?.brandSlug ?? brandSlug ?? null,
    seedProp?.eventSlug ?? eventSlug ?? null,
  );
  // #2230: directEventColdReadPlan is deliberately unchanged. A warm bundle
  // supplements day truth only; it must never take over seed or ticket authority.
  const coldReadPlan = directEventColdReadPlan(
    seedProp !== null,
    canonicalQuery,
    !!brandSlug && !!eventSlug,
  );
  const coldSeedQuery = useQuery({
    queryKey: ["publicEventSeed", brandSlug, eventSlug],
    enabled:
      coldReadPlan.allowLegacySeedRead,
    staleTime: 60_000,
    queryFn: async () => {
      const candidate = await fetchPublicEventSeedBySlug(
        brandSlug as string,
        eventSlug as string,
      );
      return acceptRsvpLegacySeed(candidate);
    },
  });
  // THE seed every read below consumes — deck seed first, cold-resolved second
  // (all existing `seed?.…` reads, both branches, both mounts now work cold).
  const canonical = coldReadPlan.canonical;
  const canonicalSeed = canonical === null ? null : canonicalToTransientCard(canonical);
  const seed = seedProp ?? canonicalSeed ?? coldSeedQuery.data ?? null;

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
  const [selectedEventDateIds, setSelectedEventDateIds] = useState<string[]>([]);
  const [dayTruthStale, setDayTruthStale] = useState<boolean>(false);
  const priorDayTruthRef = useRef<{ eventId: string; signature: string } | null>(null);
  const [checkoutInFlight, setCheckoutInFlight] = useState<boolean>(false);
  // issue #2265 — what the in-flight checkout is doing, driven by the flow's
  // `onPhase` callback and rendered by the cart sheet's CTA.
  const [checkoutPhase, setCheckoutPhase] = useState<NativeCheckoutPhase | null>(
    null,
  );
  // issue #868 [cover-gallery], M.1b — single owner of the shown hero item
  // (0 = cover, i = gallery[i-1]) shared by the cover pager + the row. Placed with
  // the other hooks (before the loading early-returns) to preserve hook order.
  const [coverIndex, setCoverIndex] = useState<number>(0);
  const [muted, setMuted] = useState<boolean>(true);

  // ORCH-1341 — "Who's going" guest-list sheet visibility. Both branches share
  // the ONE sheet mount below; the momentum cluster/link opens it.
  const [guestSheetVisible, setGuestSheetVisible] = useState<boolean>(false);
  // ORCH-1359 (d) — the guest whose profile is open as a detail-local overlay
  // (null ⇒ none). Set by the sheet's onOpenProfile (named-name tap); cleared
  // by the overlay's Back → returns to THIS event detail, never the app shell.
  const [guestProfileUserId, setGuestProfileUserId] = useState<string | null>(
    null,
  );
  const handleSeeWhosGoing = useCallback(
    (): void => {
      postHogService.capture("guest_list_gate_opened", {
        surface: "event_detail",
      });
      setGuestSheetVisible(true);
    },
    [],
  );
  const handleGuestSheetClose = useCallback(
    (): void => setGuestSheetVisible(false),
    [],
  );

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
  const [ticketBoxY, setTicketBoxY] = useState<number>(0);
  const detailScrollRef = useRef<React.ElementRef<typeof BottomSheetScrollView>>(null);
  const handleDockLayout = useCallback((e: LayoutChangeEvent): void => {
    const h = e.nativeEvent.layout.height;
    setTicketBoxY(e.nativeEvent.layout.y);
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
  const ticketsQuery = usePublicEventTickets(
    coldReadPlan.allowLegacyTicketRead ? eventId : null,
  );
  const intakeSchemasQuery = useTripIntakeSchemas(eventId);
  const themeQuery = useEventTheme(canonical === null ? seed : null);
  const runNativeCheckout = useNativeCheckoutFlow();

  const validatedDayCanonical =
    canonicalQuery.data !== null &&
    canonicalQuery.data !== undefined &&
    eventId !== null &&
    canonicalQuery.data.event.id === eventId
      ? canonicalQuery.data
      : null;
  const validOccurrences = useMemo<readonly PublicEventOccurrenceLike[]>(
    () => validatedDayCanonical?.occurrences ?? [],
    [validatedDayCanonical],
  );

  useEffect(() => {
    setSelectedEventDateIds([]);
    setDayTruthStale(false);
    priorDayTruthRef.current = null;
  }, [eventId]);

  useEffect(() => {
    if (eventId === null || validatedDayCanonical === null) return;
    const signature = validOccurrences
      .map((day) => `${day.id}:${day.startAt}:${day.endAt}`)
      .join("|");
    const previous = priorDayTruthRef.current;
    priorDayTruthRef.current = { eventId, signature };
    if (
      previous === null ||
      previous.eventId !== eventId ||
      previous.signature === signature
    ) return;
    const validIds = new Set(validOccurrences.map((day) => day.id));
    setSelectedEventDateIds((selected) => selected.filter((id) => validIds.has(id)));
    setDayTruthStale(true);
    AccessibilityInfo.announceForAccessibility(
      "Those dates just changed. Refresh and choose again.",
    );
  }, [eventId, validOccurrences, validatedDayCanonical]);

  const toggleEventDay = useCallback((eventDateId: string): void => {
    setSelectedEventDateIds((selected) => {
      const next = new Set(selected);
      if (next.has(eventDateId)) next.delete(eventDateId);
      else next.add(eventDateId);
      return validOccurrences.filter((day) => next.has(day.id)).map((day) => day.id);
    });
  }, [validOccurrences]);

  const retryEventDays = useCallback((): void => {
    void canonicalQuery.refetch().then((result) => {
      if (!result.isError) setDayTruthStale(false);
    });
  }, [canonicalQuery]);

  const multiDaySelection = useMemo(() => {
    if (isRsvp || eventId === null) return null;
    if (
      validatedDayCanonical !== null &&
      !validatedDayCanonical.isMultiDate &&
      validOccurrences.length <= 1
    ) return null;
    if (canonicalQuery.fetchStatus === "paused") {
      return {
        status: "offline" as const,
        occurrences: validOccurrences,
        selectedEventDateIds,
        pricingMode: validatedDayCanonical?.multiDatePricingMode ?? "per_day" as const,
        timezone: validatedDayCanonical?.timezone ?? seed?.timezone ?? "UTC",
        onToggle: toggleEventDay,
        onRetry: retryEventDays,
      };
    }
    if (canonicalQuery.isLoading || canonicalQuery.isPending) {
      return {
        status: "loading" as const,
        occurrences: [] as readonly PublicEventOccurrenceLike[],
        selectedEventDateIds,
        pricingMode: "per_day" as const,
        timezone: seed?.timezone ?? "UTC",
        onToggle: toggleEventDay,
        onRetry: retryEventDays,
      };
    }
    if (canonicalQuery.isError || validatedDayCanonical === null) {
      return {
        status: "error" as const,
        occurrences: validOccurrences,
        selectedEventDateIds,
        pricingMode: "per_day" as const,
        timezone: seed?.timezone ?? "UTC",
        onToggle: toggleEventDay,
        onRetry: retryEventDays,
      };
    }
    const shapeIsValid =
      validatedDayCanonical.isMultiDate === (validOccurrences.length > 1);
    if (!shapeIsValid) {
      return {
        status: "error" as const,
        occurrences: validOccurrences,
        selectedEventDateIds,
        pricingMode: validatedDayCanonical.multiDatePricingMode,
        timezone: validatedDayCanonical.timezone,
        onToggle: toggleEventDay,
        onRetry: retryEventDays,
      };
    }
    if (!validatedDayCanonical.isMultiDate) return null;
    return {
      status: dayTruthStale ? "stale" as const : "ready" as const,
      occurrences: validOccurrences,
      selectedEventDateIds,
      pricingMode: validatedDayCanonical.multiDatePricingMode,
      timezone: validatedDayCanonical.timezone,
      onToggle: toggleEventDay,
      onRetry: retryEventDays,
    };
  }, [
    canonicalQuery.fetchStatus,
    canonicalQuery.isError,
    canonicalQuery.isLoading,
    canonicalQuery.isPending,
    dayTruthStale,
    eventId,
    isRsvp,
    retryEventDays,
    seed?.timezone,
    selectedEventDateIds,
    toggleEventDay,
    validOccurrences,
    validatedDayCanonical,
  ]);

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

  // ORCH-1339 — cross-entity social proof (pg_public_social_proof, ORCH-1338).
  // Enabled for BOTH branches: the standard branch feeds the shared body's
  // momentum unit; the RSVP branch reads the two D2 gates into rsvpConfig.
  // Error/missing → data stays undefined → the unit is omitted (page as today).
  const socialProofQuery = useQuery({
    queryKey: socialProofKeys.summary(eventId ?? ""),
    enabled: eventId !== null,
    staleTime: 60 * 1000,
    queryFn: () => fetchSocialProof(eventId as string),
  });
  const socialProofImpressionRef = useRef<boolean>(false);
  useEffect(() => {
    const proof = socialProofQuery.data;
    if (socialProofImpressionRef.current || !proof ||
      proof.privateGuestList || proof.goingCount <= 0) return;
    socialProofImpressionRef.current = true;
    postHogService.capture("social_proof_teaser_impression", {
      surface: "event_detail",
    });
  }, [socialProofQuery.data]);

  // ORCH-1342 (SPEC §4.8) — landing auto-open: `?landing=guest-list` opens the
  // ORCH-1341 sheet ONCE after the page settles, via the SAME handler the
  // card's onSeeWhosGoing invokes (never a parallel path). Conditions are
  // evaluated REACTIVELY (no timers, no nav retries): the effect simply waits
  // for the seed + the 1339 socialProof query. Auto-open fires ONLY under the
  // exact conditions the card shows the affordance (D9/D2; DESIGN §1.5):
  // socialProof settled with data, privateGuestList === false, goingCount > 0
  // — a privateGuestList=true event NEVER auto-opens (T-A4; defense-in-depth:
  // 1338's Function B raises guest_list_private if a race ever force-opens).
  // The ref flips on ANY terminal outcome (opened OR disqualified OR query
  // error) so the sheet never pops later on a refetch; a null cold seed means
  // the graceful cap renders and the landing intent dies silently with it.
  const landingHandledRef = useRef<boolean>(false);
  useEffect(() => {
    if (landing !== "guest-list" || landingHandledRef.current) return;
    if (seed === null) return; // not resolved yet (or cap — intent dies there)
    const settled = socialProofQuery.isSuccess || socialProofQuery.isError;
    if (!settled) return;
    landingHandledRef.current = true; // terminal — one-shot, refetch-proof
    const sp = socialProofQuery.data ?? null;
    if (
      socialProofQuery.isSuccess &&
      sp !== null &&
      sp.privateGuestList === false &&
      sp.goingCount > 0
    ) {
      handleSeeWhosGoing();
    }
  }, [
    landing,
    seed,
    socialProofQuery.isSuccess,
    socialProofQuery.isError,
    socialProofQuery.data,
    handleSeeWhosGoing,
  ]);

  const theme =
    canonical?.brand?.theme !== undefined
      ? resolveTheme(canonical.brand.theme, null)
      : (themeQuery.data ?? resolveTheme(null, null));
  const palette = useMemo(() => createThemePalette(theme), [theme]);
  const rsvpPhoneTheme = useMemo<PhoneInputTheme>(() => ({
    backgroundPrimary: palette.page,
    textPrimary: palette.primaryText,
    textTertiary: palette.tertiaryText,
    borderDefault: palette.panelBorder,
    borderFocused: palette.accent,
    borderError: "#ef4444",
    searchBackground: palette.card,
    rowPressedBackground: palette.accentWash,
    divider: palette.panelBorder,
    accessoryBackground: palette.page,
    accessoryBorder: palette.panelBorder,
    accent: palette.accent,
    errorText: theme.foregroundColor === "#ffffff" ? "#f87171" : "#b91c1c",
  }), [palette, theme.foregroundColor]);
  const renderRsvpPhoneField = useCallback<RsvpPhoneFieldRenderer>((args) => (
    <View style={styles.issue1857PhoneField}>
      <Text style={[styles.issue1857PhoneLabel, { color: palette.tertiaryText }]}>
        {args.label}
      </Text>
      <PhoneInput
        pickerPresentation="overlay"
        value={args.rawValue}
        countryCode={args.countryCode}
        onChangePhone={(raw: string) =>
          args.onChangeRawValue(raw, resolveUserPhoneE164(raw, args.countryCode))}
        onChangeCountry={(iso: string) =>
          args.onChangeCountry(iso, resolveUserPhoneE164(args.rawValue, iso))}
        error={args.emptyRequired
          ? "Required"
          : args.invalid
            ? "Select a country and enter a valid phone number."
            : null}
        disabled={args.disabled}
        theme={rsvpPhoneTheme}
        required={args.required}
        maxLength={40}
        testID={args.testID}
        countryButtonAccessibilityLabel={args.countryCode === null
          ? "Select country"
          : `${args.label} country, ${getCountryByCode(args.countryCode)?.name ?? args.countryCode}, tap to change`}
        phoneInputAccessibilityLabel={`${args.label} phone number`}
        onBlur={args.onBlur}
      />
    </View>
  ), [palette.tertiaryText, rsvpPhoneTheme]);
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
      void shareContent(isRsvp ? "rsvp_event" : "event", { brandSlug:slug, eventSlug:evSlug });
    }
  }, [seed?.brandSlug, seed?.eventSlug, brandSlug, eventSlug, isRsvp]);

  const tickets = canonical?.event.tickets ?? ticketsQuery.data ?? [];

  // #2242 [cold-link-cart] — THE CART'S TICKET SOURCE. Four things are load-bearing
  // here; none of them is style.
  //   1. On the cold `/e/{brandSlug}/{eventSlug}` route the canonical checkout bundle
  //      is the cart's source, because :439-441 disables `ticketsQuery` the moment
  //      `canonical !== null` (`allowLegacyTicketRead` — usePublicEventBySlug.ts:72).
  //      The disabled hook subscribes to the key ["publicEventTickets", null], which
  //      nothing can ever populate, so reading `ticketsQuery.data` here handed the
  //      sheet a permanent `undefined` and a spinner that never resolved.
  //   2. There is deliberately NO `?? []`. `undefined` must survive so the sheet's
  //      genuine in-flight `Loading tickets…` stays honest on the deck and chat
  //      routes; collapsing it to `[]` would render a false "No tickets available
  //      for this event." on the app's highest-traffic path.
  //   3. The source is `canonical` (i.e. `coldReadPlan.canonical`), NEVER
  //      `canonicalQuery.data`. A seed suppresses the bundle outright
  //      (usePublicEventBySlug.ts:64), so once #2230 enables the bundle query on the
  //      deck path too, those two diverge and binding to `canonicalQuery.data` would
  //      silently switch the DECK cart's capacity semantics.
  //   4. It is a named local rather than the inline expression on purpose: the inline
  //      form is a prefix substring of line 586, so a `String.includes()` guard
  //      written against it is satisfied by line 586 alone and passes on a fully
  //      reverted cart. That is exactly how the four-of-five migration in 96cbd78ba
  //      (#1936) shipped past a green gate named "cold tickets not bundle-owned".
  //      Renaming this local re-opens that hole — the name is part of the contract.
  const cartTickets = canonical?.event.tickets ?? ticketsQuery.data;

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
    if (validatedDayCanonical === null || canonicalQuery.isError) return;
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
  }, [canonicalQuery.isError, ticketQuantities, validatedDayCanonical]);
  const handleGuestSignIn = useCallback((): void => {
    setGuestSheetVisible(false);
    router.replace("/");
  }, [router]);
  const handleGuestAttendanceAction = useCallback((): void => {
    setGuestSheetVisible(false);
    InteractionManager.runAfterInteractions(() => {
      if (isRsvp) {
        AccessibilityInfo.announceForAccessibility("RSVP options are ready.");
      } else {
        detailScrollRef.current?.scrollTo({ y: Math.max(ticketBoxY - 24, 0), animated: true });
        AccessibilityInfo.announceForAccessibility("Ticket options are ready.");
      }
    });
  }, [isRsvp, ticketBoxY]);

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
      guestPhoneCountryIso?: string | null;
      plusCount: number;
      guests: RsvpGuestContact[];
    }): Promise<RsvpSubmitResult> => {
      if (seed === null) throw new Error("rsvp_not_open");
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const result = await submitDeckRsvp(
        seed.eventId,
        input.rsvpStatus,
        input.guests,
        {
          name: input.guestName,
          email: input.guestEmail,
          phone: input.guestPhone,
          phoneCountryIso: input.guestPhoneCountryIso,
        },
      );
      // Refresh the live going-count after a successful own-submit.
      void queryClient.invalidateQueries({
        queryKey: ["rsvpMomentum", seed.eventId],
      });
      postHogService.capture("rsvp_acknowledgement_viewed", {
        surface: "explorer_event",
        status: result.status,
        approval: result.approvalStatus,
      });
      if (result.credentials.length > 0) {
        postHogService.capture("rsvp_pass_viewed", { surface: "explorer_success" });
      }
      return {
        status: result.status,
        approvalStatus: result.approvalStatus,
        rsvpId: result.rsvpId,
        confirmationToken: result.confirmationToken,
        credentials: result.credentials,
        anonymousRecovery: result.anonymousRecovery,
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
    async (
      payload: TicketCartCheckoutPayload,
    ): Promise<NativeCheckoutOutcome> => {
      // issue #2265 — handleBuy now RETURNS its outcome so the cart sheet's
      // lifetime can be conditioned on it (dismiss on success, stay open on
      // failure so the recovery affordance lands where the buyer was buying).
      // Every early return is `canceled`, which all callers treat as silent.
      if (checkoutInFlight) return { outcome: "canceled" };
      if (seed === null) return { outcome: "canceled" };
      if (user === null) {
        toastManager.show("Please sign in to get tickets.", "warning");
        return { outcome: "canceled" };
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
        return { outcome: "canceled" };
      }
      if (buyerPhone.length === 0) {
        toastManager.show(
          "Add a phone number to your profile to get tickets.",
          "warning",
        );
        return { outcome: "canceled" };
      }

      // ORCH-1192 — fire `checkout_started` BEFORE the payment sheet opens
      // (mirrors web `web_checkout_started`; precedes the `purchase_completed`
      // success capture below). The `checkoutInFlight` early-return at the top
      // of handleBuy guards against a re-render / double-tap double-fire, so
      // this fires once per checkout attempt. Props mirror purchase_completed.
      postHogService.capture("checkout_started", {
        event_id: seed.eventId,
        offering_type: "event",
        value: payload.totalCents / 100,
        currency: seed.currency,
        surface: "consumer_app",
      });

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
          // ORCH-1244 (Apple 4.9) — the on-screen event title becomes the Apple
          // Pay summary line label (not the bare merchant name "Mingla").
          displayTitle: seed.title,
          // ORCH-1025 — NO taxCalculationId, NO address: tax computed server-side
          // from the venue. Per-tier intake answers ride intakeFormData; empty
          // array omitted (byte-identical). NO paymentPlanChoice for events (no
          // installment plan) — request byte-identical to the EBES event path.
          ...(payload.intakeFormData.length > 0
            ? { intakeFormData: payload.intakeFormData }
            : {}),
          ...(payload.eventDateIds !== undefined && payload.eventDateIds.length > 0
            ? { eventDateIds: payload.eventDateIds }
            : {}),
          // issue #2265 — feed the cart sheet's pending copy.
          onPhase: setCheckoutPhase,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Payment failed.";
        result = { outcome: "failed", message };
      } finally {
        setCheckoutInFlight(false);
        setCheckoutPhase(null);
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
        // issue #2265 — `onBack()` MOVED to handleCartCheckout, so navigation
        // happens strictly AFTER the sheet is dismissed. Navigating out from
        // under a still-visible sheet is the failure mode this ordering exists
        // to prevent (SC-11).
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
      return result;
    },
    [checkoutInFlight, seed, user, profile, runNativeCheckout, queryClient],
  );

  /**
   * issue #2265 — the cart sheet OWNS the wait.
   *
   * This used to be `setCartVisible(false); void handleBuy(payload);`, which
   * dismissed the sheet synchronously one line BEFORE any work started. The
   * sheet's whole pending treatment — spinner, disabled controls, refused close
   * — was unmounted before it could render a single frame, and the buyer was
   * left on the event screen with a greyed-out button and no explanation.
   *
   * Now: await the outcome with the sheet up, then dismiss ONLY on success, and
   * navigate strictly after the dismissal. On failure the sheet stays open so
   * the mapped copy and the buyer's next action land in the buying context they
   * are about to use.
   *
   * Invariant: I-PROPOSED-CHECKOUT-PENDING-SURFACE-SURVIVES.
   */
  const handleCartCheckout = useCallback(
    async (payload: TicketCartCheckoutPayload): Promise<void> => {
      const result = await handleBuy(payload);
      if (result.outcome === "succeeded") {
        setCartVisible(false);
        onBack();
      }
    },
    [handleBuy, onBack],
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
  // ORCH-1291 [rsvp-chip-in] — the momentum read now surfaces the 3 chip-in
  // config columns from business_public_events_view (report §10.A CLOSED), so the
  // shared RsvpOfferingBody's guest panel lights up when the host enabled it. Free
  // RSVPs keep enabled=false → no panel.
  const rsvpConfig: RsvpOfferingConfig = {
    capacity: rsvpMomentum?.capacity ?? null,
    goingCount: rsvpMomentum?.goingCount ?? 0,
    allowPlusOnes: rsvpMomentum?.allowPlusOnes ?? false,
    plusOnesMax: rsvpMomentum?.plusOnesMax ?? 0,
    waitlistEnabled: rsvpMomentum?.waitlistEnabled ?? false,
    manualApproval: rsvpMomentum?.manualApproval ?? false,
    rsvp_contribution_enabled: rsvpMomentum?.rsvpContributionEnabled ?? false,
    rsvp_contribution_suggested_cents: rsvpMomentum?.rsvpContributionSuggestedCents ?? null,
    rsvp_contribution_min_cents: rsvpMomentum?.rsvpContributionMinCents ?? null,
    settlementCurrency: rsvpPublicEvent.currency ?? "USD",
    hostShortName: rsvpBrand?.displayName ?? undefined,
    // ORCH-1339 (D2) — the two SERVER-authoritative display gates, read from
    // the social-proof payload (`?? false` until it resolves). Both the inline
    // RsvpOfferingBody and the RsvpOfferingFloatingBar read this SAME config
    // object, so the two mounts gate together.
    privateGuestList: socialProofQuery.data?.privateGuestList ?? false,
    hideRemainingCount: socialProofQuery.data?.hideRemainingCount ?? false,
    // ORCH-1340 — the server-filtered avatar sample rides the SAME payload;
    // photos fill the leading cluster disks ([] until it resolves — glyphs).
    guestSample: socialProofQuery.data?.sample ?? [],
    // ORCH-1341 — the cluster/link tap opens the guest-list sheet. Belt-and-
    // braces double gate (SPEC §4.6): the card already suppresses the
    // affordance for privateGuestList/zero-going; gating the handler too
    // survives package regressions. Absent handler ⇒ inert cluster (1340).
    onSeeWhosGoing:
      socialProofQuery.data?.privateGuestList !== true &&
      (rsvpMomentum?.goingCount ?? 0) > 0
        ? handleSeeWhosGoing
        : undefined,
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
  // ORCH-1291 [rsvp-chip-in] — voluntary-gift hand-off. Reuses the Stripe RN
  // PaymentSheet (connected-account initStripe, mirroring nativeCheckoutFlow) for
  // native; opens the Paystack/hosted page in the in-app browser for redirects.
  const chipSheet = useStripePaymentSheet();
  const chipInIdempotencyRef = useRef<string | null>(null);
  const handleChipIn = useCallback(
    async ({ amountCents }: { amountCents: number }): Promise<ChipInResult> => {
      chipInIdempotencyRef.current ??=
        `${eventId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const { data, error } = await supabase.functions.invoke("rsvp-contribution-create", {
        body: {
          eventId,
          amountCents,
          surface: "native",
          rsvpId: null,
          returnContract: "host_v1",
          callerIdempotencyKey: chipInIdempotencyRef.current,
        },
      });
      if (error) {
        throw new Error(String((error as { message?: string }).message ?? "contribution_failed"));
      }
      const res = (data ?? {}) as {
        kind?: string;
        clientSecret?: string;
        stripeAccountId?: string;
        publishableKey?: string | null;
        authorizationUrl?: string;
        hostedCheckoutUrl?: string;
      };
      if (res.kind === "requires_native_payment") {
        if (res.publishableKey && res.stripeAccountId) {
          // Re-init the SDK for THIS PI's connected account (ORCH-0844 pattern);
          // otherwise the confirm hits Stripe under the platform context → 404.
          await initStripe({
            publishableKey: res.publishableKey,
            stripeAccountId: res.stripeAccountId,
            merchantIdentifier: "merchant.com.mingla.app.v2",
            urlScheme: "com.mingla.app.v2",
          });
        }
        const init = await chipSheet.initPaymentSheet({
          merchantDisplayName: "Mingla",
          paymentIntentClientSecret: res.clientSecret ?? "",
          returnURL: "com.mingla.app.v2://stripe-redirect",
        });
        if (init.error) throw new Error(init.error.message);
        const present = await chipSheet.presentPaymentSheet();
        if (present.error) {
          throw new Error(present.error.code === "Canceled" ? "cancelled" : present.error.message);
        }
        chipInIdempotencyRef.current = null;
        return { kind: "paid" };
      }
      if (res.kind === "requires_paystack_redirect" && res.authorizationUrl) {
        await WebBrowser.openBrowserAsync(res.authorizationUrl);
        return { kind: "redirecting" };
      }
      if (res.kind === "requires_web_redirect" && res.hostedCheckoutUrl) {
        await WebBrowser.openBrowserAsync(res.hostedCheckoutUrl);
        return { kind: "redirecting" };
      }
      throw new Error("contribution_create_failed");
    },
    [eventId, chipSheet],
  );

  const handleDownloadRsvpPass = useCallback(async (
    credential: { entityId: string; entityType: "primary" | "guest" },
    recovery: { recoveryToken: string | null } | null,
  ): Promise<void> => {
    const surface = "explorer_success";
    postHogService.capture("rsvp_pass_pdf_requested", { surface });
    try {
      const result = await fetchRsvpPassPdf(
        credential.entityId,
        recovery?.recoveryToken ?? null,
        credential.entityType,
      );
      const safeName = result.pdf.filename.replace(/[^a-zA-Z0-9._-]/g, "-");
      const uri = `${FileSystem.cacheDirectory ?? ""}${safeName}`;
      await FileSystem.writeAsStringAsync(uri, result.pdf.contentBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (!(await Sharing.isAvailableAsync())) {
        throw new Error("sharing_unavailable");
      }
      await Sharing.shareAsync(uri, {
        mimeType: "application/pdf",
        dialogTitle: "Save RSVP invite",
        UTI: "com.adobe.pdf",
      });
      postHogService.capture("rsvp_pass_pdf_result", { surface, outcome: "success" });
    } catch (error) {
      postHogService.capture("rsvp_pass_pdf_result", { surface, outcome: "failure" });
      throw error;
    }
  }, []);

  const rsvpState = useRsvpOfferingState({
    event: rsvpPublicEvent,
    brand: rsvpBrand,
    palette,
    theme,
    config: rsvpConfig,
    isLoggedIn: user !== null,
    initialGuestName: profile?.display_name?.trim() || user?.email?.split("@")[0] || "",
    initialGuestEmail: user?.email ?? profile?.email ?? "",
    initialGuestPhone: profile?.phone ?? "",
    requirePrimaryContact: user !== null,
    renderPhoneField: renderRsvpPhoneField,
    onDownloadPass: handleDownloadRsvpPass,
    onSubmit: rsvpOnSubmit,
    onChipIn: handleChipIn,
    onOpenBrand: (slug: string) => router.push(`/b/${slug}` as never),
    onOpenMaps: openMapsForTarget,
    onCopyAddress: copyAddressForTarget,
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

  // ── ORCH-1342 (D6) — cold seed resolving: the EXISTING loading sheet while
  //    the by-slug read is in flight (never a blank screen, never the cap). ──
  if (
    seedProp == null &&
    (canonicalQuery.isLoading ||
      (canonicalQuery.isSuccess && canonicalQuery.data === null && coldSeedQuery.isLoading))
  ) {
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

  // ── Cold cap — ORCH-1342 (D6): now the honest TERMINAL state for
  //    unknown/private/deleted slugs only (the seed fetch settled null/error);
  //    the OQ-6 "every cold open" cap is superseded. Copy kept as-is (§10-3). ──
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
  if (canonical === null && ticketsQuery.isLoading) {
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
  // issue #868 [cover-gallery], M.1b — the ADDITIONAL image/GIF items (plain const,
  // not a hook, since fnd resolves AFTER the loading early-returns). Empty ⇒ the
  // single cover renders byte-identically (no pager, no row).
  const coverGallery = (fnd.coverGallery ?? []).filter(
    (g) => typeof g?.url === "string" && g.url.length > 0,
  );
  const galleryActive = coverGallery.length >= 1;
  const primaryHeroAccessibleLabel = buildHeroMediaAccessibleLabel({
    subject: fnd.name,
    mediaType: fnd.coverMediaType,
    position: 1,
    total: coverGallery.length + 1,
    description: fnd.coverMediaAlt,
  });
  // issue #868 Pass 3 — the pager OWNS scrolling (it drives scrollTo from
  // activeIndex with a settle-guard, BUG 1). The row just sets the shown index.
  const selectCoverIndex = (index: number): void => {
    setCoverIndex(index);
  };
  // The screen's EXISTING cover node — UNCHANGED (video-capable). Reused as page 0
  // of the pager in gallery mode, or rendered alone when the gallery is empty.
  const coverMediaNode = (
    <EventCoverMedia
      accessibleLabel={primaryHeroAccessibleLabel}
      mediaUrl={fnd.coverMediaUrl}
      mediaType={fnd.coverMediaType}
      hue={fnd.coverHue}
      autoplay={true}
      playbackActive={true}
      muted={muted}
      loop={true}
      height="100%"
      width="100%"
    />
  );
  const galleryRow = galleryActive ? (
    <CoverGalleryRow
      cover={{ url: fnd.coverMediaUrl, type: fnd.coverMediaType }}
      gallery={coverGallery}
      activeIndex={coverIndex}
      onSelect={selectCoverIndex}
      palette={palette}
      variant="phone"
    />
  ) : null;

  // ORCH-1167 [event-page-canonical] — the standard-event PublicEventProps for the
  // shared EventOfferingBody (warm path from the deck seed). RSVP rows do NOT use
  // this (their body is the separate RsvpPublicBody section sequence). The static
  // map URL is privacy-gated: exact pin when the street is public, else null on the
  // warm path (no city centroid on the deck seed) → text venue card (rule 9).
  const seededPublicEvent = cardToPublicEvent(seed, tickets);
  const occurrenceSummary = validOccurrences.length > 1
    ? formatOccurrenceSummary(
        validOccurrences,
        validatedDayCanonical?.timezone ?? seed.timezone,
      )
    : null;
  const publicEventForBody: PublicEventProps =
    canonical === null
      ? {
          ...seededPublicEvent,
          dateSubline: occurrenceSummary,
          ...(validatedDayCanonical?.event.acquisitionState === undefined
            ? {}
            : {
                acquisitionState:
                  validatedDayCanonical.event.acquisitionState,
              }),
        }
      : {
          ...canonical.event,
          dateLine: seededPublicEvent.dateLine,
          dateSubline: occurrenceSummary,
        };
  const canonicalLifecycleReady =
    validatedDayCanonical !== null && !canonicalQuery.isError;
  const canonicalLifecycleBlockedLabel = canonicalQuery.isError
    ? "We couldn’t load the event days."
    : "Loading tickets...";
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
        // ORCH-1194 — INLINE host (the #600 wrapInRNModal is reverted). The event
        // already renders correctly in the ExpandedCardModal deck mount via its
        // ORCH-1188 page-colored bottom runway; the RN-Modal wrap was unnecessary and
        // broke its in-sheet reserve taps. Back to the proven inline path.
        accessibilityLabel={fnd.title}
      >
        {/* (1) pinned cover — absolute sibling BEHIND the scroll. issue #868 — in
            gallery mode it becomes a swipeable pager over [cover] ++ gallery
            (page 0 = the EXISTING cover node, video-capable, UNCHANGED); the
            nativeCover becomes pointerEvents:"auto" so the pager receives swipes.
            Empty gallery ⇒ the single cover, byte-identical (pointerEvents:"none").
            ORCH-1167-R4 video-cover autoplay+loop is preserved via coverMediaNode. */}
        <View
          style={styles.nativeCover}
          pointerEvents={galleryActive ? "auto" : "none"}
        >
          {galleryActive ? (
            <CoverGalleryPager
              coverNode={coverMediaNode}
              gallery={coverGallery}
              activeIndex={coverIndex}
              onActiveIndexChange={setCoverIndex}
              heroAccessibilitySubject={fnd.name}
              coverMediaAlt={fnd.coverMediaAlt}
              coverMediaType={fnd.coverMediaType}
            />
          ) : (
            coverMediaNode
          )}
          <View style={styles.coverScrim} pointerEvents="none" />
          <ThemeEntranceAnimation theme={theme} sessionKey={`event:${seed.eventId}`} />
        </View>

        {/* (2) the gorhom scroll host — DIRECT child of <BaseBottomSheet>. */}
        <BottomSheetScrollView
          ref={detailScrollRef}
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
          {/* issue #868 — spacer is pointerEvents:"none" in gallery mode so a
              horizontal swipe over the cover region reaches the pinned pager
              behind the body; default otherwise (byte-identical). */}
          <View
            style={styles.coverSpacer}
            pointerEvents={galleryActive ? "none" : undefined}
          />
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
            {/* issue #868 [cover-gallery] — the beneath-cover card row is the body's
                FIRST child (shared by the event AND RSVP branches below). Null when
                the gallery is empty. */}
            {galleryRow}
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
                onOpenMaps={openMapsForTarget}
                onCopyAddress={copyAddressForTarget}
                staticMapUrl={bodyStaticMapUrl}
                submitting={checkoutInFlight || !canonicalLifecycleReady}
                purchaseReady={canonicalLifecycleReady}
                purchaseBlockedLabel={canonicalLifecycleBlockedLabel}
                pricingNote={
                  validOccurrences.length > 1 &&
                  tickets.some((ticket) => !ticket.isFree) &&
                  validatedDayCanonical?.multiDatePricingMode === "per_day"
                    ? "per day"
                    : validOccurrences.length > 1 &&
                        tickets.some((ticket) => !ticket.isFree) &&
                        validatedDayCanonical?.multiDatePricingMode === "all_days"
                      ? "for all days"
                      : null
                }
                onTicketBoxLayout={handleDockLayout}
                // ORCH-1339 — cross-entity social proof (server-gated payload).
                socialProof={socialProofQuery.data ?? null}
                // ORCH-1341 — cluster/link tap opens the guest-list sheet
                // (double-gated per SPEC §4.6; absent ⇒ inert, no dead tap).
                onSeeWhosGoing={
                  socialProofQuery.data?.privateGuestList !== true &&
                  (socialProofQuery.data?.goingCount ?? 0) > 0
                    ? handleSeeWhosGoing
                    : undefined
                }
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
                onOpenMaps={openMapsForTarget}
                onCopyAddress={copyAddressForTarget}
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
              submitting={checkoutInFlight || !canonicalLifecycleReady}
              purchaseReady={canonicalLifecycleReady}
              purchaseBlockedLabel={canonicalLifecycleBlockedLabel}
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
        tickets={cartTickets}
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
        pendingPhase={checkoutPhase}
        multiDaySelection={multiDaySelection}
        clearFloatingNav={false}
        onCancel={handleCartCancel}
        onCheckout={handleCartCheckout}
      />

      {/* ORCH-1341 — the "Who's going" guest-list sheet. Sibling root in the
          same fragment; wrapInRNModal z-stacks it above this INLINE detail
          sheet + the floating bar (the ONLY RN-Modal window in this context —
          SPEC §2). Mounted UNCONDITIONALLY with `visible` driving it
          (exemplar posture — never `{visible ? <Sheet/> : null}`). */}
      <EventGuestListSheet
        visible={guestSheetVisible}
        onClose={handleGuestSheetClose}
        eventId={isRsvp ? rsvpPublicEvent.id : seed.eventId}
        goingCount={
          isRsvp
            ? (rsvpMomentum?.goingCount ?? 0)
            : (socialProofQuery.data?.goingCount ?? 0)
        }
        onOpenProfile={setGuestProfileUserId}
        gateKind={isRsvp ? "rsvp" : "ticket"}
        onSignIn={handleGuestSignIn}
        onAttendanceAction={handleGuestAttendanceAction}
        attendanceActionAvailable
      />

      {/* ORCH-1359 (d) — detail-local peer-profile overlay (D-B). The sheet
          closes BEFORE this mounts (close-before-navigate), so this is NOT a
          modal-over-modal — it renders in the detail tree, absolute-fill above
          the chrome (zIndex 100). Back clears it → the user is right back on
          this event detail, never the home shell. */}
      {guestProfileUserId !== null ? (
        <View style={styles.guestProfileOverlay}>
          <ViewFriendProfileScreen
            userId={guestProfileUserId}
            onBack={() => setGuestProfileUserId(null)}
            onMessage={(userId) => {
              setGuestProfileUserId(null);
              if (hasOpenDirectMessageSink()) openDirectMessageInApp(userId);
            }}
          />
        </View>
      ) : null}
    </>
  );
}

const SEAM = 28;

const styles = StyleSheet.create({
  issue1857PhoneField: { marginBottom: 12 },
  issue1857PhoneLabel: { fontSize: 12, fontWeight: "700", marginBottom: 5 },
  // ORCH-1359 (d) — the detail-local peer-profile overlay wrapper: absolute-fill
  // above the detail chrome (zIndex 100 > chrome 70) so the profile fully covers
  // the event detail while it is open. Opaque so nothing bleeds through.
  guestProfileOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    backgroundColor: "#ffffff",
  },
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
