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
  Image,
  LayoutAnimation,
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
  isOpenDailyExperience,
  offeringSurfaceStyles,
  resolveOfferingCta,
  resolveTheme,
  ThemeEntranceAnimation,
  type CtaState,
  type PublicEventProps,
  type PublicTicketProps,
} from "@mingla/offering-rendering";
import {
  OfferingChrome,
  CountAwareGallery,
  normalizeCityCountry,
  useResponsiveLayout,
  type CountAwareGalleryItem,
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
  ExperienceOccurrencePicker,
  type ExperienceOccurrence,
} from "../../components/expandedCard/ExperienceOccurrencePicker";
import {
  ExperienceReservePicker,
  type ExperienceReserveSelection,
} from "../../components/expandedCard/ExperienceReservePicker";
import { buildStaticMapUrl } from "../../utils/mapboxStaticImage";
// ORCH-1153 WS2 — open-daily detection is now the SHARED rule-based predicate
// isOpenDailyExperience (@mingla/offering-rendering), the single owner across all
// surfaces. The prior occurrence-density heuristic (utils/experienceOpenDaily
// isOpenDailyModel) is retired here (kept only for its Deno test + the unused
// medianConsecutiveGapMs export); it no longer drives the consumer picker.
import { ConsumerEventReserveBar } from "../../components/offering/ConsumerEventReserveBar";
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
const ABOUT_COLLAPSE_THRESHOLD = 160;

// ORCH-1138 rework (§4.C.5) — canonical vibe-id → display label (mirrors the
// business EXPERIENCE_INTENTS labels + deckService EXPERIENCE_INTENT_LABEL).
const EXPERIENCE_INTENT_LABEL: Record<string, string> = {
  adventurous: "Adventurous",
  "first-date": "First Dates",
  romantic: "Romantic",
  "group-fun": "Group Fun",
};

// Open-daily detection — ORCH-1138 P2-2: tightened so a FIXED-start single /
// multi-date experience is NEVER misrouted into the arbitrary date→time-within-
// window picker. Single owner is utils/experienceOpenDaily.ts (pure + unit-
// tested under Deno). `isOpenDailyModel` now requires a DENSE, near-DAILY run of
// wide-window occurrences (which only the recurrence-materializer produces); a
// handful of fixed-start sessions fall through to the slot list. (Imported above.)

// "5 dates · Next: Fri 20 Jun" — derived from the real occurrences (rule 9).
const buildDatesSubline = (
  occ: ReadonlyArray<ExperienceOccurrence>,
  timezone: string,
): string | null => {
  if (occ.length === 0) return null;
  const next = occ[0];
  let nextLabel = "";
  const d = new Date(next.startAt);
  if (!Number.isNaN(d.getTime())) {
    try {
      nextLabel = new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: timezone || "UTC",
      }).format(d);
    } catch {
      nextLabel = new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
      }).format(d);
    }
  }
  if (occ.length === 1) {
    return nextLabel.length > 0 ? nextLabel : null;
  }
  return nextLabel.length > 0
    ? `${occ.length} dates · Next: ${nextLabel}`
    : `${occ.length} dates`;
};

// "3 spots left · 12 max" / "12 max" — from the soonest occurrence (rule 9).
const buildSeatsLabel = (
  occ: ReadonlyArray<ExperienceOccurrence>,
): string | null => {
  const first = occ[0];
  if (first === undefined) return null;
  const { remaining, capacity } = first;
  if (remaining === null && capacity === null) return null; // unlimited
  if (remaining !== null && capacity !== null) {
    return `${Math.max(remaining, 0)} spots left · ${capacity} max`;
  }
  if (remaining !== null) return `${Math.max(remaining, 0)} spots left`;
  if (capacity !== null) return `${capacity} max`;
  return null;
};

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

// Per-stop media → CountAwareGallery items (image/video). Honest passthrough.
const stopGalleryItems = (
  imageUrls: string[] | undefined,
  fallback: string | null,
): CountAwareGalleryItem[] => {
  const urls =
    Array.isArray(imageUrls) && imageUrls.length > 0
      ? imageUrls
      : fallback !== null
        ? [fallback]
        : [];
  return urls
    .filter((u) => typeof u === "string" && u.length > 0)
    .map((url) => ({
      url,
      type: /\.(mp4|mov|webm|m4v)(\?.*)?$/i.test(url)
        ? ("video" as const)
        : ("image" as const),
    }));
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
  const [aboutCollapsed, setAboutCollapsed] = useState<boolean>(true);

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
  const cityCountry =
    normalizeCityCountry(seed.city) ??
    normalizeCityCountry(seed.venueName) ??
    normalizeCityCountry(seed.address);
  const aboutText =
    seed.description !== null && seed.description.trim().length > 0
      ? seed.description
      : null;
  const canCollapseAbout =
    aboutText !== null && aboutText.length > ABOUT_COLLAPSE_THRESHOLD;
  const aboutCollapsedNow = canCollapseAbout && aboutCollapsed;
  const stops = Array.isArray(seed.experienceStops) ? seed.experienceStops : [];

  // ORCH-1138 rework (§4.C.5) — derived, real-data-gated display fields (rule 9).
  const vibeChips = (Array.isArray(seed.experienceIntents)
    ? seed.experienceIntents
    : []
  )
    .map((id) => ({ id, label: EXPERIENCE_INTENT_LABEL[id] ?? null }))
    .filter((v): v is { id: string; label: string } => v.label !== null);
  const datesSubline = buildDatesSubline(occurrences, seed.timezone);
  const seatsLabel = buildSeatsLabel(occurrences);
  const experienceStartTime = (() => {
    // master/first occurrence start time (HH:MM) → "7:00 PM start" chip.
    const first = occurrences[0];
    if (first === undefined) return null;
    const d = new Date(first.startAt);
    if (Number.isNaN(d.getTime())) return null;
    try {
      return new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        timeZone: seed.timezone || "UTC",
      }).format(d);
    } catch {
      return null;
    }
  })();
  // stop-1 coords for the "Where you'll start" map (gate on coords present).
  const startStop = stops.find(
    (s) => typeof s.lat === "number" && typeof s.lng === "number",
  );
  const startMapUrl =
    startStop?.lat != null && startStop?.lng != null
      ? buildStaticMapUrl({
          lat: startStop.lat,
          lng: startStop.lng,
          accentHex: palette.accent,
          height: 320,
        })
      : null;
  // State banner driven by the resolved CTA (one owner — resolveOfferingCta).
  // The `unavailable` variant carries the human title ("Sold out" / "Booking
  // unavailable" / "This experience has ended") + optional subline (rule 9).
  const stateBanner =
    offeringCta.kind === "unavailable"
      ? { title: offeringCta.title, subline: offeringCta.subline }
      : null;

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
    <ConsumerEventReserveBar
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
    <ConsumerEventReserveBar
      cta={offeringCta}
      palette={palette}
      kicker={barKicker}
      fontFamily={boldFamily}
      onPress={beginBooking}
      variant="floating"
      safeAreaBottom={insets.bottom}
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
            {/* phone lead: N-stop eyebrow + bold title (ORCH-1138 rework §4.C.5) */}
            <View style={styles.leadBlock}>
              {stops.length > 0 ? (
                <Text style={[styles.eyebrowLead, { color: palette.accent }]}>
                  {stops.length}-stop experience
                </Text>
              ) : null}
              <Text
                style={[styles.fndTitle, surface.primaryText, { fontFamily: boldFamily }]}
              >
                {seed.title}
              </Text>
            </View>

            {/* meta chips — City,Country · dates · seats · start-time (real fields
                only — rule 9; ORCH-1138 rework §4.C.5 SC-6) */}
            {cityCountry !== null ||
            datesSubline !== null ||
            seatsLabel !== null ||
            experienceStartTime !== null ? (
              <View
                style={styles.metaChipRow}
                testID="orch-1138-consumer-experience-meta"
              >
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
                {datesSubline !== null ? (
                  <View style={[styles.metaChip, surface.card]}>
                    <Icon name="calendar" size={15} color={palette.accent} />
                    <Text
                      style={[styles.metaChipText, surface.secondaryText, { fontFamily: boldFamily }]}
                    >
                      {datesSubline}
                    </Text>
                  </View>
                ) : null}
                {seatsLabel !== null ? (
                  <View style={[styles.metaChip, surface.card]}>
                    <Icon name="people" size={15} color={palette.accent} />
                    <Text
                      style={[styles.metaChipText, surface.secondaryText, { fontFamily: boldFamily }]}
                    >
                      {seatsLabel}
                    </Text>
                  </View>
                ) : null}
                {experienceStartTime !== null ? (
                  <View style={[styles.metaChip, surface.card]}>
                    <Icon name="time" size={15} color={palette.accent} />
                    <Text
                      style={[styles.metaChipText, surface.secondaryText, { fontFamily: boldFamily }]}
                    >
                      {experienceStartTime} start
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* vibe chips (ORCH-1138 rework §4.C.5 SC-3; rule 9 — only when present) */}
            {vibeChips.length > 0 ? (
              <View
                style={styles.vibeChipRow}
                testID="orch-1138-consumer-experience-vibes"
              >
                {vibeChips.map((v) => (
                  <View
                    key={v.id}
                    style={[styles.vibeChip, { backgroundColor: palette.accentWash }]}
                  >
                    <Icon name="sparkles" size={13} color={palette.accent} />
                    <Text
                      style={[styles.vibeChipText, { color: palette.accent, fontFamily: boldFamily }]}
                    >
                      {v.label}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* state banner (sold-out / ended / unavailable) — ORCH-1138 §4.C.5 SC-9 */}
            {stateBanner !== null ? (
              <View
                style={[styles.stateBanner, { backgroundColor: palette.accentWash, borderColor: palette.panelBorder }]}
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
            ) : null}

            {/* brand chip — "Presented by" (anon-safe brand cover/initial).
                ORCH-1155 [public-brand-page]: tap opens the brand page
                /b/{brandSlug} (no dead tap). Guard empty slug (rule 9). */}
            <Pressable
              style={[styles.brandRow, surface.card]}
              accessibilityRole="button"
              accessibilityLabel={`View ${seed.brandName}`}
              onPress={() => {
                if (
                  typeof seed.brandSlug === "string" &&
                  seed.brandSlug.length > 0
                ) {
                  router.push(`/b/${seed.brandSlug}` as never);
                }
              }}
            >
              <View
                style={[
                  styles.brandTile,
                  seed.brandProfilePhotoUrl === null
                    ? { backgroundColor: palette.accent }
                    : null,
                ]}
              >
                {seed.brandProfilePhotoUrl !== null ? (
                  <EventCoverMedia
                    mediaUrl={seed.brandProfilePhotoUrl}
                    mediaType="image"
                    hue={hueFromId(seed.brandSlug)}
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
                      {(seed.brandName.trim()[0] ?? "•").toUpperCase()}
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
                  {seed.brandName}
                </Text>
              </View>
              {/* ORCH-1155 [public-brand-page] all-surface parity — trailing
                  "View" CTA matching the trip/event consumer screens + the
                  web/business pages. */}
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

            {/* The itinerary — REAL authored stops (rule 9) */}
            {stops.length > 0 ? (
              <View style={styles.section}>
                <Text
                  style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}
                >
                  The itinerary
                </Text>
                <View style={styles.itin}>
                  <View style={[styles.itinSpine, { backgroundColor: palette.accentWash }]} />
                  {stops.map((stop, idx) => {
                    const stopLabel =
                      typeof stop.stopLabel === "string"
                        ? stop.stopLabel.toUpperCase()
                        : idx === 0
                          ? "START HERE"
                          : idx === stops.length - 1
                            ? "END WITH"
                            : "THEN";
                    const galleryItems = stopGalleryItems(
                      stop.imageUrls,
                      stop.imageUrl ?? null,
                    );
                    const timePill = formatStartTime(stop.startTime);
                    return (
                      <View key={`${stop.placeName ?? "stop"}-${idx}`} style={styles.stop}>
                        <View style={[styles.stopDot, { backgroundColor: palette.accent }]}>
                          <Text style={[styles.stopDotText, { color: palette.accentText }]}>
                            {stop.stopNumber > 0 ? stop.stopNumber : idx + 1}
                          </Text>
                        </View>
                        <View style={[styles.stopCard, surface.card]}>
                          <View style={styles.stopHead}>
                            <Text style={[styles.stopOrd, { color: palette.accent }]}>
                              {stopLabel}
                            </Text>
                            {timePill !== null ? (
                              <Text style={[styles.stopTimePill, surface.tertiaryText]}>
                                {timePill}
                              </Text>
                            ) : null}
                          </View>
                          {stop.placeName !== null ? (
                            <Text
                              style={[styles.stopTitle, surface.primaryText, { fontFamily: boldFamily }]}
                            >
                              {stop.placeName}
                            </Text>
                          ) : null}
                          {stop.address !== null ? (
                            <Text style={[styles.stopAddr, surface.tertiaryText]} numberOfLines={2}>
                              {stop.address}
                            </Text>
                          ) : null}
                          {stop.aiDescription !== null ? (
                            <Text style={[styles.stopBlurb, surface.secondaryText]}>
                              {stop.aiDescription}
                            </Text>
                          ) : null}
                          {galleryItems.length > 0 ? (
                            <View style={styles.stopGallery}>
                              <CountAwareGallery
                                items={galleryItems}
                                palette={palette}
                                variant="phone"
                                accessibilityLabelPrefix={`Stop ${idx + 1} media`}
                              />
                            </View>
                          ) : null}
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {/* "Where you'll start" map (ORCH-1138 rework §4.C.5 SC-5; rule 9 —
                only when stop-1 coords + a Mapbox token resolve) */}
            {startMapUrl !== null ? (
              <View style={styles.section} testID="orch-1138-consumer-experience-map">
                <Text
                  style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}
                >
                  Where you&apos;ll start
                </Text>
                <Image
                  source={{ uri: startMapUrl }}
                  style={[styles.startMap, { borderColor: palette.panelBorder }]}
                  resizeMode="cover"
                  accessibilityLabel="Map of the first stop"
                />
                {startStop?.placeName != null ? (
                  <Text style={[styles.mapCaption, surface.tertiaryText]}>
                    {startStop.placeName}
                    {startStop.address != null ? ` · ${startStop.address}` : ""}
                  </Text>
                ) : null}
              </View>
            ) : null}

            <Text style={[styles.reassure, { color: palette.tertiaryText }]}>
              All-in price — taxes &amp; fees included, no surprises at checkout.
            </Text>

            {/* DOCKED CTA — the LAST scroll child (float→dock language) */}
            {dockedReserve}
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
  vibeChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  vibeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  vibeChipText: { fontSize: 12, fontWeight: "800", letterSpacing: 0.2 },
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
  stopHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  stopTimePill: { fontSize: 11, fontWeight: "700" },
  stopGallery: { marginTop: 12 },
  startMap: {
    width: "100%",
    height: 180,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: "#000",
  },
  mapCaption: { fontSize: 12, lineHeight: 17, marginTop: 8 },
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
  // (parity with the trip/event consumer screens + web/business pages).
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
  // itinerary spine
  itin: { position: "relative", paddingLeft: 30, marginTop: 4 },
  itinSpine: { position: "absolute", left: 9, top: 6, bottom: 6, width: 2 },
  stop: { position: "relative", paddingBottom: 18 },
  stopDot: {
    position: "absolute",
    left: -30,
    top: 2,
    width: 20,
    height: 20,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  stopDotText: { fontSize: 10, fontWeight: "900" },
  stopCard: { borderRadius: 14, padding: 14 },
  stopOrd: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  stopTitle: { fontSize: 15, fontWeight: "800", marginTop: 4 },
  stopAddr: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  stopBlurb: { fontSize: 13, lineHeight: 20, marginTop: 8 },
  reassure: { fontSize: 12, marginTop: 20, lineHeight: 17 },
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
