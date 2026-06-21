/**
 * ConsumerExperienceDetailScreen — ORCH-1138 Leg 3 (consumer EXPERIENCE detail).
 *
 * The NEW foundation-based consumer experience detail. Replaces the deck's
 * ExpandedBusinessEventSheet (EBES) hop for the EXPERIENCE flow: the deck
 * experience card + the venue "experiences here" row now open THIS screen
 * directly (ExpandedCardModal repoints), and Reserve runs the ADAPTIVE
 * occurrence flow (ORCH-1072): >1 bookable → the ExperienceOccurrencePicker →
 * TicketCartSheet; ===1 → auto-select that occurrence → cart; 0 → cart with no
 * eventDateId. Checkout is byte-identical to the prior EBES experience path
 * (the eventDateId rides ONLY when a slot is selected).
 *
 * Structurally mirrors the SHIPPED ConsumerEventDetailScreen 1:1:
 *   - Body inside the shared `BaseBottomSheet` (scrollMode="view", hidesBottomNav,
 *     the SOLE gorhom consumer) with the gorhom `BottomSheetScrollView` as a
 *     DIRECT child (the LOAD-BEARING ORCH-1016/1043 scroll structure — never
 *     re-wrap; never mount ParallaxCoverShell as the sheet host).
 *   - The Direction-A native look is COMPOSED AROUND the scroll (pinned cover +
 *     OfferingChrome + float→dock ConsumerEventReserveBar).
 *   - Adds the EXPERIENCE-specific itinerary section (real authored stops) +
 *     vibe chips (when the card carries them) beneath the brand chip.
 *
 * Anon-read constraint (🔒 COMMS-0009): theme via useEventTheme(card) reads the
 * anon-safe business_public_events_view (NEVER `.from('brands')`). NO
 * `.from('brands')`. I-MOR-0827-PACKAGE-ISOLATION: no import from
 * mingla-business/src.
 */

import React, {
  useCallback,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import {
  ActivityIndicator,
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
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import {
  boldFontFamily,
  computeOfferingVariant,
  createThemePalette,
  EventCoverMedia,
  ExperienceOfferingBody,
  isOpenDailyExperience,
  offeringSurfaceStyles,
  resolveOfferingCta,
  resolveTheme,
  ThemeEntranceAnimation,
  TripReserveBar,
  type CtaState,
  type PublicEventProps,
  type PublicTicketProps,
} from "@mingla/offering-rendering";
import {
  OfferingChrome,
  useResponsiveLayout,
} from "@mingla/offering-rendering";
import {
  buildExperienceOfferingDataFromSeed,
  buildExperienceOfferingBrandFromSeed,
} from "../../hooks/useConsumerExperienceOfferingData";

import { Icon } from "../../components/ui/Icon";
import {
  BaseBottomSheet,
  BottomSheetScrollView,
} from "../../components/ui/BaseBottomSheet";
import TicketCartSheet, {
  type TicketCartCheckoutPayload,
} from "../../components/expandedCard/TicketCartSheet";
import {
  ExperienceOccurrencePicker,
  type ExperienceOccurrence,
} from "../../components/expandedCard/ExperienceOccurrencePicker";
import {
  ExperienceReservePicker,
  type ExperienceReserveSelection,
} from "../../components/expandedCard/ExperienceReservePicker";
// ORCH-1153 WS2 — open-daily detection is now the SHARED rule-based predicate
// isOpenDailyExperience (@mingla/offering-rendering), the single owner across all
// surfaces. The prior occurrence-density heuristic (utils/experienceOpenDaily
// isOpenDailyModel) is retired here (kept only for its Deno test + the unused
// medianConsecutiveGapMs export); it no longer drives the consumer picker.
// ORCH-1183 — the experience reserve bar is CONVERGED onto the shared
// <TripReserveBar> (the single-price reserve/floating bar; no split, no
// installments) — the SAME bar the buyer-web /exp/ route uses. The prior fork
// (ConsumerEventReserveBar) is retired from the experience screen.
import { useConsumerThemeFont } from "../../theme/useConsumerThemeFont";
import { usePublicEventTickets } from "../../hooks/usePublicEventTickets";
import { useEventTheme } from "../../hooks/useEventTheme";
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

// ORCH-1157 Round-8 [cross-type time audit] — device-locale-aware per-stop time
// from an HH:MM[:SS] authored start_time (rule 9). PREVIOUSLY forced 12h AM/PM
// ("7:00 PM") regardless of the device clock — a 24h-clock device still saw
// "7:00 PM". Now matches the RSVP doors treatment: device on 12h → "7:00 PM",
// device on 24h → "19:00", always carrying minutes. The `locale` param exists
// ONLY so tests can pin a clock (undefined → device locale on Hermes / OS locale
// on buyer web). Real-data-only: malformed / out-of-range → null (never fabricate).
const formatStartTime = (
  raw: string | null | undefined,
  locale?: string,
): string | null => {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const m = raw.match(/^(\d{1,2}):(\d{2})/);
  if (m === null) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  try {
    // Decide the device 12h/24h clock the same way the RSVP doors helper does.
    const is24h =
      new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions()
        .hour12 === false;
    // Synthetic local instant at the authored clock time; no tz shift applied so
    // the displayed HH:MM equals the authored clock value (these are wall-clock
    // stop times, not tz-bearing instants).
    const d = new Date(2000, 0, 1, h, min, 0);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat(locale, {
      hour: is24h ? "2-digit" : "numeric",
      minute: "2-digit",
    })
      .format(d)
      .replace(/\bam\b/i, "AM")
      .replace(/\bpm\b/i, "PM");
  } catch {
    return null;
  }
};

const SHEET_SNAP_POINTS = glass.bottomSheet.snapPoints as unknown as (
  | string
  | number
)[];
const SHEET_INITIAL_INDEX = 1; // open at the 90% snap (full view)

interface ConsumerExperienceDetailScreenProps {
  /** The deck/venue card seed. null on a cold deep-link (capped, mirror event). */
  seed?: BusinessEventCard | null;
  onBack: () => void;
  tabBarAware?: boolean;
}

// Build the PublicEventProps the SHARED CTA machine reads (variant/CTA only).
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
  // ORCH-1157 [rsvp-public-redesign] — PublicEventProps now requires partyTypes
  // (default-safe). The experience CTA machine reads only variant/CTA, not chips,
  // so this is inert here; passed through for one consistent shape.
  partyTypes: card.partyTypes ?? [],
});

export default function ConsumerExperienceDetailScreen({
  seed = null,
  onBack,
  tabBarAware = true,
}: ConsumerExperienceDetailScreenProps): React.ReactElement {
  void tabBarAware;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAppStore((s) => s.user);
  const profile = useAppStore((s) => s.profile);

  const [cartVisible, setCartVisible] = useState<boolean>(false);
  const [initialTicketTypeId, setInitialTicketTypeId] = useState<string | null>(
    null,
  );
  const [checkoutInFlight, setCheckoutInFlight] = useState<boolean>(false);
  const [muted, setMuted] = useState<boolean>(true);

  // ORCH-1072 adaptive occurrence state (ported from EBES).
  const [occurrencePickerVisible, setOccurrencePickerVisible] =
    useState<boolean>(false);
  // ORCH-1138 rework (§4.C.6) — the open-daily restaurant picker (date → time →
  // party-size). Distinct from the flat ORCH-1072 slot picker.
  const [reservePickerVisible, setReservePickerVisible] =
    useState<boolean>(false);
  const [selectedEventDateId, setSelectedEventDateId] = useState<string | null>(
    null,
  );
  const [selectedQuantity, setSelectedQuantity] = useState<number>(1);

  // float→dock CTA visibility tracking (mirror the event screen 1:1).
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
  const themeQuery = useEventTheme(seed);
  const runNativeCheckout = useNativeCheckoutFlow();

  // ORCH-1138 rework (§4.C.5) — the seed's anon-safe brandTheme (COMMS-0009) is
  // the SYNCHRONOUS fallback so the page renders themed immediately and never
  // flashes the default palette before useEventTheme settles. resolveTheme reads
  // {color, font, animation} from the brand input + {*_override} as the override.
  const seedTheme = useMemo(() => {
    const bt = seed?.brandTheme ?? null;
    if (bt === null) return resolveTheme(null, null);
    return resolveTheme(
      { color: bt.color ?? undefined, font: bt.font ?? undefined, animation: bt.animation ?? undefined },
      {
        color: bt.color_override ?? undefined,
        font: bt.font_override ?? undefined,
        animation: bt.animation_override ?? undefined,
      },
    );
  }, [seed?.brandTheme]);
  const theme = themeQuery.data ?? seedTheme;
  const palette = useMemo(() => createThemePalette(theme), [theme]);
  const surface = useMemo(() => offeringSurfaceStyles(palette), [palette]);
  const boldFamily = boldFontFamily(theme);
  useConsumerThemeFont(theme.fontFamilyValue);
  useConsumerThemeFont(boldFamily);

  const { isDesktop } = useResponsiveLayout();
  void isDesktop;

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  // ORCH-1155 [public-brand-page] — brand chip "View" opens /b/{brandSlug}.
  const handleViewBrand = useCallback((): void => {
    if (typeof seed?.brandSlug === "string" && seed.brandSlug.length > 0) {
      router.push(`/b/${seed.brandSlug}` as never);
    }
  }, [router, seed?.brandSlug]);

  const handleShare = useCallback((): void => {
    const slug = seed?.brandSlug;
    const evSlug = seed?.eventSlug;
    if (slug !== undefined && evSlug !== undefined) {
      void Share.share({
        url: `https://business.usemingla.com/exp/${slug}/${evSlug}`,
      });
    }
  }, [seed?.brandSlug, seed?.eventSlug]);

  const tickets = ticketsQuery.data ?? [];

  // ORCH-1072 — the experience's bookable upcoming occurrences. Sold-out ones
  // (remaining === 0) are excluded from the auto-select / single-occurrence
  // logic but still shown disabled in the picker.
  const occurrences: ExperienceOccurrence[] = useMemo(
    () =>
      Array.isArray(seed?.upcomingOccurrences) ? seed.upcomingOccurrences : [],
    [seed?.upcomingOccurrences],
  );
  const bookableOccurrences = useMemo(
    () => occurrences.filter((o) => o.remaining === null || o.remaining > 0),
    [occurrences],
  );
  // ORCH-1153 WS2 — open-daily (restaurant) vs flat slots, from the SHARED
  // rule-based detector (same owner the buyer-web /exp/ page uses) so the SAME
  // experience classifies IDENTICALLY across surfaces. The recurrence fields
  // arrive on the seed via the deck-supply RPC + the seed mappers (deck +
  // venue). undefined isRecurring/recurrenceRule (cold deep-link / pre-OTA
  // payload) → false → flat slot list (safe default, no fabrication).
  const openDaily = useMemo(
    () =>
      isOpenDailyExperience({
        isRecurring: seed?.isRecurring === true,
        recurrenceRule: seed?.recurrenceRule ?? null,
      }),
    [seed?.isRecurring, seed?.recurrenceRule],
  );
  // The event-level remaining caps the open-daily party stepper (soonest slot).
  const eventRemaining = useMemo<number | null>(() => {
    const first = bookableOccurrences[0] ?? occurrences[0];
    return first?.remaining ?? null;
  }, [bookableOccurrences, occurrences]);

  // The SINGLE buy-state (resolveOfferingCta — one owner).
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
    return resolveOfferingCta({
      variant: computeOfferingVariant(publicEvent, false),
      bookable: true,
      tickets,
      currency: seed.currency,
      // ORCH-1153 WS2 (I-PROPOSED-1153-RESERVE-VERB) — experiences read "Reserve"
      // on EVERY surface (paid + free), matching buyer-web/business. Without
      // these the consumer rendered the generic "Buy ticket" / "Get free ticket".
      buyVerb: "Reserve",
      freeVerb: "Reserve",
    });
  }, [seed, tickets]);

  // Reserve seeds the sellable tier + runs the adaptive occurrence step
  // (ORCH-1072 beginBooking, ported from EBES).
  const beginBooking = useCallback((): void => {
    if (tickets.length === 0) return;
    const sellable =
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
    setSelectedQuantity(1);
    if (bookableOccurrences.length > 1) {
      setSelectedEventDateId(null);
      // ORCH-1138 rework — open-daily → restaurant flow (date → time → party);
      // discrete recurring/multi → the flat slot list.
      if (openDaily) {
        setReservePickerVisible(true);
      } else {
        setOccurrencePickerVisible(true);
      }
      return;
    }
    if (bookableOccurrences.length === 1) {
      setSelectedEventDateId(bookableOccurrences[0].eventDateId);
    } else {
      setSelectedEventDateId(null);
    }
    setCartVisible(true);
  }, [tickets, bookableOccurrences, openDaily]);

  const handleOccurrenceSelect = useCallback((eventDateId: string): void => {
    setSelectedEventDateId(eventDateId);
    setSelectedQuantity(1);
    setOccurrencePickerVisible(false);
    setCartVisible(true);
  }, []);
  const handleOccurrenceCancel = useCallback((): void => {
    setOccurrencePickerVisible(false);
  }, []);

  // ORCH-1138 rework (§4.C.6) — the open-daily picker confirms with the chosen
  // occurrence + party size; party-size = cart quantity (I-1), NO new line item.
  const handleReserveConfirm = useCallback(
    (sel: ExperienceReserveSelection): void => {
      setSelectedEventDateId(sel.eventDateId);
      setSelectedQuantity(sel.quantity >= 1 ? Math.floor(sel.quantity) : 1);
      setReservePickerVisible(false);
      setCartVisible(true);
    },
    [],
  );
  const handleReserveCancel = useCallback((): void => {
    setReservePickerVisible(false);
  }, []);

  // handleBuy — same byte-identical runNativeCheckout request as the EBES
  // experience path: NO address, NO taxCalculationId, NO paymentPlanChoice;
  // the eventDateId rides ONLY when a slot is selected.
  const handleBuy = useCallback(
    async (payload: TicketCartCheckoutPayload): Promise<void> => {
      if (checkoutInFlight) return;
      if (seed === null) return;
      if (user === null) {
        toastManager.show("Please sign in to reserve.", "warning");
        return;
      }
      const buyerName =
        profile?.display_name?.trim() || user.email?.split("@")[0] || "Guest";
      const buyerEmail = user.email ?? profile?.email ?? "";
      const buyerPhone = profile?.phone ?? "";
      if (buyerEmail.length === 0) {
        toastManager.show(
          "We need an email on your profile to reserve.",
          "warning",
        );
        return;
      }
      if (buyerPhone.length === 0) {
        toastManager.show(
          "Add a phone number to your profile to reserve.",
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
          ...(payload.intakeFormData.length > 0
            ? { intakeFormData: payload.intakeFormData }
            : {}),
          // ORCH-1072 — thread the chosen occurrence; omitted on the null path →
          // request byte-identical to a one-off / no-date experience.
          ...(selectedEventDateId !== null
            ? { eventDateId: selectedEventDateId }
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
        toastManager.show("Reserved! Check your calendar.", "success");
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
      selectedEventDateId,
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
        testID="orch-1138-consumer-experience-chrome"
      />
    </View>
  );

  // ── Cold deep-link cap (mirror event) — no seed ──
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
        accessibilityLabel="Experience detail"
      >
        <View style={[styles.stateBody, { paddingBottom: insets.bottom + 48 }]}>
          {chrome}
          <Text style={styles.stateTitle}>Open this experience from the app</Text>
          <Text style={styles.stateSub}>
            Find it on your Discover deck to see details and reserve.
          </Text>
          <Pressable style={styles.retryBtn} onPress={onBack}>
            <Text style={styles.retryText}>Back</Text>
          </Pressable>
        </View>
      </BaseBottomSheet>
    );
  }

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
        accessibilityLabel="Experience detail"
      >
        <View style={[styles.stateBody, { paddingBottom: insets.bottom + 48 }]}>
          {chrome}
          <ActivityIndicator color={ACCENT} />
        </View>
      </BaseBottomSheet>
    );
  }

  const coverMediaType =
    seed.coverMediaType === "image" ||
    seed.coverMediaType === "video" ||
    seed.coverMediaType === "gif"
      ? seed.coverMediaType
      : null;
  const showMute = coverMediaType === "video";

  // ORCH-1183 — build the SHARED ExperienceOfferingBody contract from the deck/venue
  // SEED (the existing discover→experience open). The ONE ticket's server all-in
  // (priceAllInCents from usePublicEventTickets) → the body's combined all-in price.
  const sellableTicket = tickets.find(
    (t) => t.visibility !== "hidden" && t.availableAt !== "door",
  );
  // usePublicEventTickets / PublicTicketProps carry MAJOR-unit price + all-in
  // (priceGbp / priceAllInGbp); the shared body works in CENTS → ×100. Free → null.
  const sellablePriceCents =
    sellableTicket !== undefined && typeof sellableTicket.priceGbp === "number"
      ? Math.round(sellableTicket.priceGbp * 100)
      : 0;
  const sellableAllInCents =
    sellableTicket !== undefined &&
    typeof sellableTicket.priceAllInGbp === "number" &&
    sellableTicket.priceAllInGbp > 0
      ? Math.round(sellableTicket.priceAllInGbp * 100)
      : null;
  const offeringData = buildExperienceOfferingDataFromSeed(seed, {
    ticket:
      sellableTicket !== undefined
        ? {
            ticketTypeId: sellableTicket.id,
            name: sellableTicket.name,
            priceCents: sellablePriceCents,
            priceAllInCents: sellableTicket.isFree ? null : sellableAllInCents,
            currency: sellableTicket.currency ?? seed.currency,
            isFree: sellableTicket.isFree || sellablePriceCents === 0,
            isUnlimited: sellableTicket.isUnlimited === true,
            ticketsRemaining: sellableTicket.capacity,
            quantityTotal: sellableTicket.capacity,
          }
        : null,
    occurrences: occurrences.map((o) => ({
      eventDateId: o.eventDateId,
      startAt: o.startAt,
      endAt: o.endAt,
      remaining: o.remaining,
      capacity: o.capacity,
    })),
    bookable: offeringCta.tappable || offeringCta.kind !== "unavailable",
  });
  const offeringBrand = buildExperienceOfferingBrandFromSeed(seed);

  // State banner driven by the resolved CTA (one owner — resolveOfferingCta).
  const stateBanner =
    offeringCta.kind === "unavailable"
      ? { title: offeringCta.title, subline: offeringCta.subline }
      : null;
  const stateBannerNode: ReactElement | null =
    stateBanner !== null ? (
      <View
        style={[
          styles.stateBanner,
          { backgroundColor: palette.accentWash, borderColor: palette.panelBorder },
        ]}
        testID="orch-1138-consumer-experience-state-banner"
      >
        <Icon name="alert-circle" size={16} color={palette.accent} />
        <View style={styles.stateBannerTextCol}>
          <Text
            style={[styles.stateBannerTitle, { color: palette.primaryText, fontFamily: boldFamily }]}
          >
            {stateBanner.title}
          </Text>
          {stateBanner.subline !== null ? (
            <Text style={[styles.stateBannerSub, { color: palette.tertiaryText }]}>
              {stateBanner.subline}
            </Text>
          ) : null}
        </View>
      </View>
    ) : null;

  const barKicker = offeringCta.kind === "buy" ? "All-in, taxes included" : null;
  const REVEAL_MARGIN = 24;
  const floatingPillVisible =
    dockTopY === null || viewportH === 0
      ? true
      : dockTopY > scrollY + viewportH - REVEAL_MARGIN;
  // ORCH-1153 BUG-1 (Seth device, experience reserve bar cut off): the gorhom
  // BaseBottomSheet content extends ~63pt BELOW the visible window at the 90%
  // snap (SHEET_BOTTOM_OVERSHOOT in ConsumerEventReserveBar). A flat 8pt scroll
  // clearance let the DOCKED bar (last scroll child, in normal flow) land in
  // that overshoot region on short-content experiences, so its price block +
  // "Reserve →" were clipped at the home-indicator edge and the bar never read
  // as "floating". Pad the scroll content past the overshoot so the docked bar
  // rests ABOVE the clipped region; the bar itself already pads its own bottom
  // safe-area (safeBottom + 8), so do NOT re-add the inset here (would double-
  // pad). The trip page rarely hit this — trips have long itinerary/payment
  // content that fills the viewport, pushing the docked bar up naturally.
  const SHEET_BOTTOM_OVERSHOOT = 63;
  const reserveBarClearance = SHEET_BOTTOM_OVERSHOOT + 8;

  const dockedReserve: ReactElement = (
    <TripReserveBar
      cta={offeringCta}
      palette={palette}
      kicker={barKicker}
      fontFamily={boldFamily}
      onPress={beginBooking}
      variant="docked"
      safeAreaBottom={insets.bottom}
      onDockLayout={handleDockLayout}
      testID="orch-1138-consumer-experience-reserve"
    />
  );
  const floatingReserve: ReactElement | null = floatingPillVisible ? (
    <TripReserveBar
      cta={offeringCta}
      palette={palette}
      kicker={barKicker}
      fontFamily={boldFamily}
      onPress={beginBooking}
      variant="floating"
      safeAreaBottom={insets.bottom}
      sheetBottomOvershoot={SHEET_BOTTOM_OVERSHOOT}
      testID="orch-1138-consumer-experience-reserve"
    />
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
        accessibilityLabel={seed.title}
      >
        {/* (1) pinned cover — absolute sibling BEHIND the scroll. */}
        <View style={styles.nativeCover} pointerEvents="none">
          <EventCoverMedia
            mediaUrl={seed.coverMediaUrl}
            mediaType={coverMediaType}
            hue={seed.coverHue}
            autoplay
            playbackActive
            muted={muted}
            loop
            height="100%"
            width="100%"
          />
          <View style={styles.coverScrim} pointerEvents="none" />
          <ThemeEntranceAnimation
            theme={theme}
            sessionKey={`experience:${seed.eventId}`}
          />
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
          testID="orch-1138-consumer-experience-scroll"
        >
          <View style={styles.coverSpacer} />
          <View
            style={[
              styles.nativeBody,
              { backgroundColor: palette.page, borderColor: palette.panelBorder },
            ]}
          >
            {/* ORCH-1183 — the ONE shared, shell-agnostic body. The deck/venue SEED
                is mapped into the ExperienceOfferingData contract above; the body
                renders the SAME sections on every surface (lead/meta/vibes/brand/
                about/itinerary[shared StopSpine — per-stop VIDEO preserved]/map/
                price). The DOCKED reserve bar rides as the LAST body child. */}
            <ExperienceOfferingBody
              data={offeringData}
              brand={offeringBrand}
              palette={palette}
              theme={theme}
              callbacks={{ onReserve: beginBooking, onViewBrand: handleViewBrand }}
              variant="phone"
              formatStopTime={(iso: string | null) => formatStartTime(iso)}
              stateBanner={stateBannerNode}
              dockedReserve={dockedReserve}
              testID="orch-1183-consumer-experience-body"
            />
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
            testID="orch-1138-consumer-experience-chrome"
          />
        </View>

        {/* (4) FLOATING reserve PILL — shown while the docked CTA is off-screen */}
        {floatingReserve}
      </BaseBottomSheet>

      {/* ORCH-1072 occurrence picker (DISCRETE recurring/multi) — selection only;
          sibling root in the same fragment
          (feedback_rn_sub_sheet_must_render_inside_parent). */}
      <ExperienceOccurrencePicker
        visible={occurrencePickerVisible}
        occurrences={occurrences}
        timezone={seed.timezone}
        onCancel={handleOccurrenceCancel}
        onSelect={handleOccurrenceSelect}
      />

      {/* ORCH-1138 rework (§4.C.6) — OPEN-DAILY restaurant picker (date → time →
          party-size). Party-size → cart quantity (I-1); byte-identical checkout. */}
      <ExperienceReservePicker
        visible={reservePickerVisible}
        mode="open-daily"
        occurrences={occurrences}
        timezone={seed.timezone}
        palette={palette}
        fontFamily={boldFamily}
        eventRemaining={eventRemaining}
        onCancel={handleReserveCancel}
        onConfirm={handleReserveConfirm}
      />

      {/* Reserve opens the cart DIRECTLY (NEVER EBES). Byte-identical request
          to the prior EBES experience path; the eventDateId rides only when a
          slot was selected (selectedEventDateId). */}
      <TicketCartSheet
        visible={cartVisible}
        eventId={seed.eventId}
        tickets={ticketsQuery.data}
        fallbackCurrency={seed.currency}
        initialTicketTypeId={initialTicketTypeId}
        initialQuantity={selectedQuantity}
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
  // ORCH-1183 — the screen now owns ONLY the gorhom scaffold (cover/scroll/body/
  // chrome) + the state banner node + the cold-deep-link state body. All section
  // visuals (lead/meta/vibes/brand/about/itinerary[StopSpine]/map/price) moved to
  // the shared <ExperienceOfferingBody>; their styles were retired with the body.
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
  nativeChrome: { position: "absolute", left: 16, right: 16, zIndex: 70 },
  stateBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 16,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  stateBannerTextCol: { flexShrink: 1 },
  stateBannerTitle: { fontSize: 14, fontWeight: "800" },
  stateBannerSub: { fontSize: 12, marginTop: 1 },
  stateBody: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 64,
    paddingHorizontal: 24,
    gap: 12,
  },
  stateTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#FFFFFF",
    marginTop: 12,
    textAlign: "center",
  },
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
