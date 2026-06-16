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
import { useQueryClient } from "@tanstack/react-query";

import {
  boldFontFamily,
  computeOfferingVariant,
  createThemePalette,
  EventCoverMedia,
  offeringSurfaceStyles,
  resolveOfferingCta,
  resolveTheme,
  ThemeEntranceAnimation,
  type CtaState,
  type PublicEventProps,
  type PublicTicketProps,
} from "@mingla/event-rendering";
import {
  OfferingChrome,
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
  ExperienceOccurrencePicker,
  type ExperienceOccurrence,
} from "../../components/expandedCard/ExperienceOccurrencePicker";
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
});

export default function ConsumerExperienceDetailScreen({
  seed = null,
  onBack,
  tabBarAware = true,
}: ConsumerExperienceDetailScreenProps): React.ReactElement {
  void tabBarAware;
  const insets = useSafeAreaInsets();
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
  const [selectedEventDateId, setSelectedEventDateId] = useState<string | null>(
    null,
  );

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

  const theme = themeQuery.data ?? resolveTheme(null, null);
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
    if (bookableOccurrences.length > 1) {
      setSelectedEventDateId(null);
      setOccurrencePickerVisible(true);
      return;
    }
    if (bookableOccurrences.length === 1) {
      setSelectedEventDateId(bookableOccurrences[0].eventDateId);
    } else {
      setSelectedEventDateId(null);
    }
    setCartVisible(true);
  }, [tickets, bookableOccurrences]);

  const handleOccurrenceSelect = useCallback((eventDateId: string): void => {
    setSelectedEventDateId(eventDateId);
    setOccurrencePickerVisible(false);
    setCartVisible(true);
  }, []);
  const handleOccurrenceCancel = useCallback((): void => {
    setOccurrencePickerVisible(false);
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
            {/* phone lead: city eyebrow + bold title */}
            <View style={styles.leadBlock}>
              {cityCountry !== null ? (
                <Text style={[styles.eyebrowLead, { color: palette.accent }]}>
                  {cityCountry}
                </Text>
              ) : null}
              <Text
                style={[styles.fndTitle, surface.primaryText, { fontFamily: boldFamily }]}
              >
                {seed.title}
              </Text>
            </View>

            {/* meta chips (real fields only — rule 9) */}
            {cityCountry !== null ? (
              <View style={styles.metaChipRow}>
                <View style={[styles.metaChip, surface.card]}>
                  <Icon name="location" size={15} color={palette.accent} />
                  <Text
                    style={[styles.metaChipText, surface.secondaryText, { fontFamily: boldFamily }]}
                  >
                    {cityCountry}
                  </Text>
                </View>
              </View>
            ) : null}

            {/* brand chip — "Presented by" (anon-safe brand cover/initial) */}
            <View style={[styles.brandRow, surface.card]}>
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
            </View>

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
                  {stops.map((stop, idx) => (
                    <View key={`${stop.placeName ?? "stop"}-${idx}`} style={styles.stop}>
                      <View style={[styles.stopDot, { backgroundColor: palette.accent }]}>
                        <Text style={[styles.stopDotText, { color: palette.accentText }]}>
                          {stop.stopNumber > 0 ? stop.stopNumber : idx + 1}
                        </Text>
                      </View>
                      <View style={[styles.stopCard, surface.card]}>
                        <Text style={[styles.stopOrd, { color: palette.accent }]}>
                          Stop {stop.stopNumber > 0 ? stop.stopNumber : idx + 1}
                        </Text>
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
                        {stop.imageUrl !== null ? (
                          <Image
                            source={{ uri: stop.imageUrl }}
                            style={styles.stopImage}
                            resizeMode="cover"
                            accessibilityLabel={`Stop ${idx + 1} photo`}
                          />
                        ) : null}
                      </View>
                    </View>
                  ))}
                </View>
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

      {/* ORCH-1072 occurrence picker — selection only; sibling root in the same
          fragment (feedback_rn_sub_sheet_must_render_inside_parent). */}
      <ExperienceOccurrencePicker
        visible={occurrencePickerVisible}
        occurrences={occurrences}
        timezone={seed.timezone}
        onCancel={handleOccurrenceCancel}
        onSelect={handleOccurrenceSelect}
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
  stopImage: {
    width: "100%",
    height: 160,
    borderRadius: 10,
    marginTop: 12,
    backgroundColor: "#000",
  },
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
