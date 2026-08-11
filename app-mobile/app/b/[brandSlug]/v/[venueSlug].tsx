/**
 * /b/{brandSlug}/v/{venueSlug} — the CONSUMER-app PUBLIC venue route.
 *
 * #1560 [consumer-adopts-shared], step 4 of #1550 — the step where the fork
 * dies. `src/screens/ConsumerPublicVenueScreen.tsx` (627 lines: its own
 * identity block, its own hours table, its own dead address card, its own
 * four-photo grid, its own reserve pane) is DELETED. This route is now an
 * ADAPTER over `@mingla/brand-rendering/PublicVenueScreen` — the exact module
 * `mingla-business/app/b/[brandSlug]/v/[venueSlug].tsx` mounts. After this,
 * exactly ONE file renders this page on every surface, so forking it again
 * means deliberately creating a new file, which is visible in review.
 *
 * WHAT A PERSON GAINS HERE — all of it things the buyer-web page has had all
 * along and this one never did:
 *   - THE MAP. `lat`/`lng` were already on the wire (`venue_public_view` is
 *     read with `select("*")`) and the old mapper dropped them: there were zero
 *     `lat` references in the whole 627-line screen.
 *   - A TAPPABLE ADDRESS. The old card was a plain `View` carrying the
 *     identical "WHERE YOU'LL BE" label and no `onPress` at all — a dead
 *     affordance (Constitution #1). It is now a Pressable with "Open in maps".
 *   - EVERY PHOTOGRAPH, not `.slice(0, 4)` — and drawn from the same cascade
 *     buyer web uses, so the two surfaces cannot publish different pictures.
 *   - THE BRAND FONT. The old screen resolved a palette and never applied
 *     `fontFamily` anywhere. `loadThemeFont` is a REQUIRED prop of the shared
 *     screen, so that omission does not compile.
 *   - THE PITCH with its "Read more" clamp, and the typical-spend lede.
 *   - A WAY TO BOOK. The old screen gated its reserve CTA on `!isStay`, so a
 *     hotel got nothing at all; what did render said "Find a table" — a fourth
 *     competing reserve string. The wording is now the category profile's ONE
 *     verb and the affordance is the shared sticky bar, present for a Stay too.
 *
 * WHAT STAYS HERE, and why each one is genuinely this app's:
 *   1. DATA — params → one query → one `PublicVenueViewModel`.
 *   2. THE PAYMENT RAIL — `VenueReserveSheet` (native PaymentSheet) and
 *      `ConsumerStayGuestExperience`. A payment-rail fork, not a UX fork; the
 *      buyer surface hands Stripe.js equivalents into the same two slots.
 *   3. ANALYTICS — `postHogService` + `captureVenueOrganicEvent`. The shared
 *      module has no analytics import at all (it emits through `onAnalytics`),
 *      because a direct `captureWeb` call in a package would fire nothing on
 *      native and route around the buyer-web capture policy on web.
 *   4. PLATFORM EFFECTS — the OS share sheet, native ad attribution.
 *
 * ANON-SAFE: data flows ONLY through `venue_public_view` (SECURITY DEFINER,
 * verified-only) via `publicVenueService`; this chain never reads
 * `venue_listings` (orch-1255-public-venue-anon-safe).
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
// #1560 — DEEP specifiers only, never the bare "@mingla/brand-rendering"
// barrel: the barrel re-exports PublicBrandPage, which imports
// lucide-react-native at module scope. Enforced on BOTH venue routes by
// .github/scripts/strict-grep/issue-1550-venue-page-single-owner.mjs.
import { PublicVenueScreen } from "@mingla/brand-rendering/PublicVenueScreen";
import type {
  PublicVenueAnalyticsEvent,
  PublicVenueBookingSlotContext,
  PublicVenueOrderingSlotContext,
  PublicVenueReservationSheetContext,
  PublicVenueViewModel,
} from "@mingla/brand-rendering/PublicVenueScreen";
import { useConsumerVenueOrdering } from "../../../../src/components/venueOrdering/useConsumerVenueOrdering";

import { VenueReserveSheet } from "../../../../src/components/expandedCard/VenueReserveSheet";
import { ConsumerStayGuestExperience } from "../../../../src/components/stay/ConsumerStayGuestExperience";
import { usePublicVenue } from "../../../../src/hooks/usePublicVenue";
import { usePublicStayDetail } from "../../../../src/hooks/useStayGuest";
import { postHogService } from "../../../../src/services/postHogService";
import { captureVenueOrganicEvent } from "../../../../src/services/venueOrganicCaptureService";
import { captureNativeStayRouteAttribution } from "../../../../src/services/nativeAdAttributionService";
import { shareContent } from "../../../../src/services/contentShareAdapter";
import { useConsumerThemeFont } from "../../../../src/theme/useConsumerThemeFont";
import type { ConsumerPublicVenue } from "../../../../src/services/publicVenueService";

/** This app's ONE analytics surface tag for the public venue page. */
const ANALYTICS_SURFACE = "consumer_native";

/** #1793 — a stable empty menu, so the ordering hook's deps do not churn. */
const EMPTY_MENU: ConsumerPublicVenue["menu"] = [];

/**
 * [TRANSITIONAL] The buyer-web origin, hand-built here as every other consumer
 * share surface does (ConsumerBrandProfileScreen, ConsumerTripDetailScreen,
 * ConsumerEventDetailScreen, SwipeableCards …). #1550 Step 1 was to move the
 * canonical builder into the package; it did not ship, and inventing a
 * one-venue exception here would leave the app with two answers instead of
 * one. Exit condition: the shared `publicVenueUrls` module lands and every
 * consumer share surface adopts it together.
 */
const BUYER_WEB_ORIGIN = "https://business.usemingla.com";

/**
 * Issue #1793 (#1767 Phase 4) — the ordering RENDERERS, behind a lazy boundary
 * that lives HERE, in the host.
 *
 * The rule is the one #1550 wrote and #1791 paid for twice: code-splitting
 * belongs where the bundle is measured, never inside the shared screen. A value
 * import of a cart, a review pane and a status card at this module's scope would
 * put all three in front of every visitor to every venue page — including the
 * overwhelming majority whose venue has ordering switched off, which is the
 * default and will be for most venues most of the time. The factory below runs
 * the first time a guest can actually order.
 */
const LazyOrderingNotice = React.lazy(async () => {
  const mod = await import(
    "../../../../src/components/venueOrdering/ConsumerVenueOrderingSlots"
  );
  return { default: mod.ConsumerVenueOrderingNotice };
});
const LazyOrderingMenu = React.lazy(async () => {
  const mod = await import(
    "../../../../src/components/venueOrdering/ConsumerVenueOrderingSlots"
  );
  return { default: mod.ConsumerVenueOrderingMenu };
});
const LazyOrderingBar = React.lazy(async () => {
  const mod = await import(
    "../../../../src/components/venueOrdering/ConsumerVenueOrderingSlots"
  );
  return { default: mod.ConsumerVenueOrderingBar };
});
const LazyOrderingSheet = React.lazy(async () => {
  const mod = await import(
    "../../../../src/components/venueOrdering/ConsumerVenueOrderingSlots"
  );
  return { default: mod.ConsumerVenueOrderingSheet };
});

/** `ConsumerPublicVenue` (this app's read model) → the shared view model. */
const toVenueViewModel = (
  venue: ConsumerPublicVenue,
): PublicVenueViewModel => ({
  id: venue.id,
  brandId: venue.brandId,
  brandSlug: venue.brandSlug,
  brandName: venue.brandName,
  slug: venue.slug,
  name: venue.name,
  address: venue.address,
  city: venue.city,
  lat: venue.lat,
  lng: venue.lng,
  venueCategory: venue.venueCategory,
  coverMediaUrl: venue.coverMediaUrl,
  coverMediaType: venue.coverMediaType,
  theme: venue.theme,
  hours: venue.hours,
  // issue #1562 — the venue's OWN clock, so "open now" is resolved where the
  // venue is rather than where the visitor happens to be standing.
  timezone: venue.timezone,
  galleryPhotoUrls: venue.galleryPhotoUrls,
  pitch: venue.pitch,
});

export default function ConsumerPublicVenueRoute(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    brandSlug: string | string[];
    venueSlug: string | string[];
    tab?: string | string[];
    spot?: string | string[];
    src?: string | string[];
  }>();
  const brandSlug = Array.isArray(params.brandSlug)
    ? params.brandSlug[0]
    : params.brandSlug;
  const venueSlug = Array.isArray(params.venueSlug)
    ? params.venueSlug[0]
    : params.venueSlug;
  const requestedTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  // #1793 (SPEC #1788 P-10) — the printed QR carries
  // `?tab=menu&spot={code}&src=qr`. `spot` is WHERE they are sitting; `src` is
  // HOW they arrived. D-3a keeps them apart on purpose: one is a recorded fact
  // about a table, the other is attribution, and conflating them is how a
  // venue's zone revenue comes to include people who were never in the zone.
  const rawSpot = Array.isArray(params.spot) ? params.spot[0] : params.spot;
  const spotCode = typeof rawSpot === "string" && rawSpot.trim() !== ""
    ? rawSpot.trim()
    : null;
  const rawSrc = Array.isArray(params.src) ? params.src[0] : params.src;
  const entrySource = typeof rawSrc === "string" && rawSrc.trim() !== ""
    ? rawSrc.trim()
    : null;

  const query = usePublicVenue(
    typeof brandSlug === "string" ? brandSlug : null,
    typeof venueSlug === "string" ? venueSlug : null,
  );
  const venue = query.data ?? null;
  // The Stay branch is DATA off `venue_public_view`, not a re-derived guess;
  // which booking body actually mounts is decided by the category profile
  // inside the shared screen (#1558), never by this compare.
  const isStayVenue = venue?.venueCategory === "stay";
  // Same query key the Stay booking body already uses (`stayGuestKeys.detail`),
  // so React Query serves the Overview's check-in times and the Reservations
  // pane from ONE fetch; disabled for every other category.
  const stayQuery = usePublicStayDetail(venue?.id ?? null, isStayVenue);

  const [reserved, setReserved] = useState(false);
  // issue #1562 mitigation 2 — the guest's live quoted total, reported up from
  // the Reservations tab's booking body. It replaces the "from" rate in the
  // answer bar's SAME price slot, at the same size, the moment dates are
  // chosen; `null` (no quote, expired, consumed) restores the from-rate.
  const [stayQuote, setStayQuote] = useState<
    { totalMinor: string; currencyCode: string } | null
  >(null);
  const stayViewFired = useRef(false);
  const attributionFired = useRef(false);

  useEffect(() => {
    if (attributionFired.current) return;
    if (typeof brandSlug !== "string" || typeof venueSlug !== "string") return;
    attributionFired.current = true;
    void captureNativeStayRouteAttribution({ brandSlug, venueSlug, params });
  }, [brandSlug, params, venueSlug]);

  const brandId = venue?.brandId ?? null;
  const venueId = venue?.id ?? null;
  useEffect(() => {
    if (!isStayVenue || brandId === null || venueId === null) return;
    if (stayViewFired.current) return;
    stayViewFired.current = true;
    postHogService.capture("stay_viewed", {
      surface: ANALYTICS_SURFACE,
      brand_id: brandId,
      venue_id: venueId,
    });
  }, [brandId, isStayVenue, venueId]);

  const venueViewModel = useMemo<PublicVenueViewModel | null>(
    () => (venue === null ? null : toVenueViewModel(venue)),
    [venue],
  );

  /**
   * The shared screen emits three events; this app tags them with its own
   * surface and mirrors each into the organic-engagement capture — exactly the
   * "page_view" / "menu_open" / "reservation_start" wiring the deleted screen
   * carried, now at the one seam that survives.
   */
  const handleAnalytics = useCallback(
    (event: PublicVenueAnalyticsEvent, props: Record<string, unknown>): void => {
      if (brandId === null || venueId === null) return;
      postHogService.capture(event, {
        surface: ANALYTICS_SURFACE,
        brand_id: brandId,
        venue_id: venueId,
        ...props,
      });
      const organic =
        event === "public_venue_menu_viewed"
          ? "menu_open"
          : event === "public_venue_overview_viewed"
            ? "page_view"
            : "reservation_start";
      void captureVenueOrganicEvent({ brandId, venueId }, organic);
    },
    [brandId, venueId],
  );

  const captureVenueFunnel = useCallback(
    (
      event:
        | "venue_availability_result_viewed"
        | "venue_reservation_slot_selected"
        | "venue_reservation_failed",
      resultClass?: "phone_invalid" | "create_failed",
    ): void => {
      if (brandId === null || venueId === null) return;
      postHogService.capture(event, {
        surface: ANALYTICS_SURFACE,
        brand_id: brandId,
        venue_id: venueId,
        ...(resultClass === undefined ? {} : { result_class: resultClass }),
      });
    },
    [brandId, venueId],
  );

  const onAvailabilityResultViewed = useCallback((): void => {
    captureVenueFunnel("venue_availability_result_viewed");
    if (brandId === null || venueId === null) return;
    void captureVenueOrganicEvent({ brandId, venueId }, "availability_shown");
  }, [brandId, captureVenueFunnel, venueId]);

  const onSlotSelected = useCallback(
    (): void => captureVenueFunnel("venue_reservation_slot_selected"),
    [captureVenueFunnel],
  );
  const onReservationFailed = useCallback(
    (resultClass: "phone_invalid" | "create_failed"): void =>
      captureVenueFunnel("venue_reservation_failed", resultClass),
    [captureVenueFunnel],
  );

  const handleOpenMaps = useCallback((mapsQuery: string): void => {
    void Linking.openURL(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`,
    ).catch(() => undefined);
  }, []);

  const handleClose = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (typeof brandSlug !== "string") return;
    router.replace(`/b/${brandSlug}` as never);
  }, [brandSlug, router]);

  const handleOpenBrand = useCallback((): void => {
    if (typeof brandSlug !== "string") return;
    router.push(`/b/${brandSlug}` as never);
  }, [brandSlug, router]);

  const shareUrl =
    venue === null
      ? null
      : `${BUYER_WEB_ORIGIN}/b/${venue.brandSlug}/v/${venue.slug}`;
  const handleShare = useCallback((): void => {
    if (shareUrl === null) return;
    if (venue !== null) void shareContent("venue", { brandSlug:venue.brandSlug, venueSlug:venue.slug });
  }, [shareUrl, venue]);

  const venueName = venue?.name ?? "";

  /**
   * The Reservations pane body. The Stay body is the native PaymentSheet
   * experience. The table body is a themed prompt whose button raises
   * `VenueReserveSheet` through the SHARED screen's own reducer
   * (`openReservationSheet`) — the sheet's visibility therefore has exactly one
   * owner, and the button reads the same `reserveAction` string as the sticky
   * CTA above it.
   */
  const renderBookingBody = useCallback(
    (context: PublicVenueBookingSlotContext): React.ReactNode => {
      if (context.kind === "stay") {
        return (
          <ConsumerStayGuestExperience
            venueId={context.venueId}
            venueName={venueName}
            brandId={context.brandId}
            palette={context.palette}
            surface={context.surface}
            theme={context.theme}
            onQuoteChange={setStayQuote}
          />
        );
      }
      if (reserved) {
        return (
          <Text
            style={[
              styles.reservedTitle,
              { color: context.palette.primaryText },
            ]}
          >
            Your table is reserved
          </Text>
        );
      }
      return (
        <View style={styles.bookingPrompt}>
          <Text
            style={[styles.promptBody, { color: context.palette.secondaryText }]}
          >
            Choose your party, date, and a real available time.
          </Text>
          <Pressable
            onPress={context.openReservationSheet}
            accessibilityRole="button"
            accessibilityLabel={context.reserveAction}
            style={[styles.promptCta, { backgroundColor: context.palette.accent }]}
          >
            <Text
              style={[styles.promptCtaLabel, { color: context.palette.accentText }]}
            >
              {context.reserveAction}
            </Text>
          </Pressable>
        </View>
      );
    },
    [reserved, venueName],
  );

  /**
   * The reservation-sheet slot. On this surface the modal chrome IS the booking
   * rail: `VenueReserveSheet` is a three-step `BaseBottomSheet` flow and cannot
   * be rendered as an inline pane, so `context.children` is deliberately unused
   * here (the buyer-web host, whose body is an inline form, wraps its children
   * instead). `context.visible` stays the single source of truth.
   */
  const renderReservationSheet = useCallback(
    (context: PublicVenueReservationSheetContext): React.ReactNode => {
      if (venue === null || venue.reservability.state !== "available") {
        return null;
      }
      const reservableVenueId = venue.reservability.venueId;
      return (
        <VenueReserveSheet
          visible={context.visible}
          onClose={context.onClose}
          venueId={reservableVenueId}
          brandId={venue.brandId}
          venueName={venue.name}
          currency={venue.reservability.currency}
          onAvailabilityResultViewed={onAvailabilityResultViewed}
          onSlotSelected={onSlotSelected}
          onReservationFailed={onReservationFailed}
          onReserved={() => {
            setReserved(true);
            context.onClose();
            postHogService.capture("venue_reservation_completed", {
              surface: ANALYTICS_SURFACE,
              brand_id: venue.brandId,
              venue_id: venue.id,
            });
          }}
        />
      );
    },
    [onAvailabilityResultViewed, onReservationFailed, onSlotSelected, venue],
  );

  /**
   * #1793 — guest ordering. The hook is unconditional (hooks are), and it is
   * INERT until the venue's own state says otherwise: with no menu, no slugs or
   * ordering switched off it fires one cached read and renders nothing at all.
   */
  const ordering = useConsumerVenueOrdering({
    brandSlug: typeof brandSlug === "string" ? brandSlug : "",
    venueSlug: typeof venueSlug === "string" ? venueSlug : "",
    spotCode,
    entrySource,
    menu: venue?.menu ?? EMPTY_MENU,
    // Someone who scanned the card on their table is owed an explanation when
    // they cannot order. Someone reading the menu out of curiosity is not, so
    // the honest-state banner is shown to the first and never to the second.
    scanned: spotCode !== null || entrySource === "qr",
  });
  /**
   * #1793 — the ordering chunk loads only when there is ordering to do.
   *
   * `React.lazy` fires on MOUNT, so a slot that always renders its lazy child
   * downloads the cart, the review pane and the status card for every visitor to
   * every venue page — and ordering is switched OFF for every venue by default.
   * These two flags keep the whole surface unmounted until the venue's own state
   * says otherwise: `off`/`unavailable` mounts nothing at all, and a guest who
   * scanned a code at a paused venue mounts only the one card that tells them so.
   */
  const orderingState = ordering.config.state;
  const orderingActive = orderingState === "on";
  const orderingNoticeActive = orderingActive ||
    ((spotCode !== null || entrySource === "qr") &&
      (orderingState === "paused" || orderingState === "off"));

  const notesAllowedByItemId = useMemo<Record<string, boolean | undefined>>(
    () => {
      const map: Record<string, boolean | undefined> = {};
      for (const group of venue?.menu ?? []) {
        for (const item of group.items) map[item.id] = item.allowsNotes === true;
      }
      return map;
    },
    [venue?.menu],
  );

  if (query.isLoading || query.isFetching) {
    return <StateView title="Loading venue…" loading />;
  }
  if (query.isError) {
    return (
      <StateView
        title="This venue could not load"
        body="Try the link again in a moment."
      />
    );
  }
  if (venue === null || venueViewModel === null) {
    return (
      <StateView title="Venue not found" body="This venue is not public." />
    );
  }

  return (
    <PublicVenueScreen
      venue={venueViewModel}
      discoveryPrice={venue.discoveryPrice}
      menu={venue.menu}
      reservable={
        venue.reservability.state === "available"
          ? {
              reservable: true,
              venueId: venue.reservability.venueId,
              currency: venue.reservability.currency,
            }
          : null
      }
      reservabilityState={
        venue.reservability.state === "error" ? "error" : "ready"
      }
      // #1789 (SPEC #1788 P-46) — a scanned table/room QR carries
      // `?tab=menu&spot={code}&src=qr`. Before this, the ternary accepted ONE
      // value and every scan landed on Overview. `PublicVenueTabs` already
      // falls back to "overview" when the Menu tab is not visible for this
      // venue (`tabs.includes(initialTab)`), so a scan never lands on an empty
      // tab.
      initialTab={
        requestedTab === "menu"
          ? "menu"
          : requestedTab === "reservations"
            ? "reservations"
            : "overview"
      }
      onRetryReservability={() => {
        void query.refetch();
      }}
      stayState={
        !isStayVenue
          ? undefined
          : stayQuery.isLoading
            ? "loading"
            : stayQuery.isError
              ? "error"
              : stayQuery.data === null || stayQuery.data === undefined
                ? "unavailable"
                : "ready"
      }
      stayDetail={stayQuery.data ?? null}
      stayQuote={stayQuote}
      safeAreaInsets={insets}
      loadThemeFont={useConsumerThemeFont}
      bookingBody={renderBookingBody}
      reservationSheet={renderReservationSheet}
      // #1793 — the three ordering slots. Each renders nothing at all unless
      // this venue can actually take an order from this guest right now, so a
      // venue with ordering off is byte-for-byte the page it was before.
      ordering={{
        notice: (context: PublicVenueOrderingSlotContext) =>
          !orderingNoticeActive ? null : (
          <React.Suspense fallback={null}>
            <LazyOrderingNotice
              ordering={ordering}
              palette={context.palette}
              surface={context.surface}
              theme={context.theme}
            />
          </React.Suspense>
        ),
        menuBody: (context: PublicVenueOrderingSlotContext) =>
          !orderingActive ? null : (
          <React.Suspense fallback={<ActivityIndicator />}>
            <LazyOrderingMenu
              ordering={ordering}
              palette={context.palette}
              surface={context.surface}
              theme={context.theme}
              menu={context.menu}
              menuWindows={venue.menuWindows}
              timezone={venue.timezone}
            />
          </React.Suspense>
        ),
        stickyBar: (context: PublicVenueOrderingSlotContext) =>
          !orderingActive ? null : (
          <React.Suspense fallback={null}>
            <LazyOrderingBar
              ordering={ordering}
              palette={context.palette}
              surface={context.surface}
              theme={context.theme}
            />
          </React.Suspense>
        ),
        overlay: (context: PublicVenueOrderingSlotContext) =>
          !orderingActive ? null : (
          <React.Suspense fallback={null}>
            <LazyOrderingSheet
              ordering={ordering}
              palette={context.palette}
              surface={context.surface}
              theme={context.theme}
              notesAllowedByItemId={notesAllowedByItemId}
            />
          </React.Suspense>
        ),
      }}
      onAnalytics={handleAnalytics}
      onShare={handleShare}
      onClose={handleClose}
      onOpenBrand={handleOpenBrand}
      onOpenMaps={handleOpenMaps}
    />
  );
}

function StateView({
  title,
  body,
  loading = false,
}: {
  title: string;
  body?: string;
  loading?: boolean;
}): React.ReactElement {
  return (
    <View style={styles.state}>
      {loading ? <ActivityIndicator /> : null}
      <Text style={styles.stateTitle}>{title}</Text>
      {body !== undefined ? <Text style={styles.stateBody}>{body}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bookingPrompt: { gap: 16 },
  promptBody: { fontSize: 14, lineHeight: 21 },
  promptCta: {
    minHeight: 52,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 999,
  },
  promptCtaLabel: { fontSize: 16, fontWeight: "900" },
  reservedTitle: { fontSize: 28, lineHeight: 34, fontWeight: "900" },
  state: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 24,
    backgroundColor: "#0c0e12",
  },
  stateTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  stateBody: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 14,
    textAlign: "center",
  },
});
