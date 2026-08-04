/**
 * PublicVenuePage — META-ORCH-1255(C) [multi-venue first-class creation].
 *
 * The ANON per-venue public page body for `/b/{brandSlug}/v/{venueSlug}`
 * (DESIGN_META-ORCH-1255_VENUE_SURFACES.md §6, binding). Same shell + theming
 * as the public brand page: ParallaxCoverShell + createThemePalette /
 * offeringSurfaceStyles + the brand theme font.
 *
 * ANON-SAFE BY CONSTRUCTION (I-PROPOSED-1255-PUBLIC-VENUE-PAGE-ANON-SAFE):
 *   - Data arrives via props from `venue_public_view` (SECURITY DEFINER,
 *     verified-only). This component NEVER queries `venue_listings` and NEVER
 *     calls useAuth (anon buyer route — the `/b/` prefix allowlist).
 *   - The reserve affordance is display-gated by the anon-safe
 *     `pg_venue_reservable_for_place` resolver; not-reservable / error →
 *     NO bar at all (fail closed, no dead CTA).
 *
 * Real-data-only (Constitution #9): every element without data is OMITTED —
 * no fabricated placeholders, no "Address unknown" filler. The static map is
 * fetched ONLY through the vendor-neutral `static-map` server proxy
 * (buildStaticMapUrl → null ⇒ map hidden; I-PROPOSED-1162-MAP-FAILSAFE-HIDES).
 * Menu prices are currency-aware incl. zero-decimal currencies via the shared
 * PublicMenuSections renderer (one owner — the brand page's Menu composition).
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import Head from "expo-router/head";
import { useSafeAreaInsets } from "react-native-safe-area-context";
// META-ORCH-1255(R2) — DEEP import, NOT the "@mingla/brand-rendering" barrel:
// the barrel re-exports the whole PublicBrandPage module, and a barrel VALUE
// import from this (venue-chunk) file would make Metro hoist that ~27 KB
// module into the EAGER __common boot chunk (ORCH-1083 bundle-budget breach).
// The type-only barrel import below is erased at compile time (safe).
import { PublicMenuSections } from "@mingla/brand-rendering/PublicMenuSections";
import { PublicVenueTabs } from "@mingla/brand-rendering/PublicVenueTabs";
import type { PublicVenueTabsHandle } from "@mingla/brand-rendering/PublicVenueTabs";
import type { PublicMenuGroup, PublicVenueTab } from "@mingla/brand-rendering";
import type { PublicStayDetail } from "@mingla/brand-rendering/stayGuest";
// #1558 — the venue category, as DATA. DEEP specifier for the same reason as
// PublicMenuSections above; the module is pure data with one erased type import,
// so it adds no runtime dependency to any chunk it lands in.
import {
  stayClockLabel,
  typicalSpendVisible,
  venueCategoryProfile,
  venueMenuTabVisible,
  venueNotTakingReservationsCopy,
  venueShowsTradingHours,
  type VenueBookingBody,
  type VenueCategoryProfile,
  type VenueSectionId,
} from "@mingla/brand-rendering/venueCategoryProfile";
import {
  ParallaxCoverShell,
  buildStaticMapUrl,
  createThemePalette,
  offeringSurfaceStyles,
  resolveTheme,
  useResponsiveLayout,
  type ResolvedTheme,
  type ThemePalette,
} from "@mingla/offering-rendering";

import {
  brandOgImageUrl,
  brandPublicPath,
  venuePublicUrl,
} from "../../constants/publicUrls";
import type {
  PublicVenue,
  PublicVenueDiscoveryPrice,
  PublicVenueReservable,
} from "../../services/publicEventsService";
import type { BrandHourEntry } from "../../types/brand";
import { useThemeFont } from "../../theme/useThemeFont";
import { ShareModal } from "../ui/ShareModal";
import { GuestVenueReservation } from "./GuestVenueReservation";
import {
  captureVenueOrganicEvent,
  settleVenueOrganicJourneyOnConsent,
} from "../../services/venueOrganicCaptureService";
import {
  runBuyerVenueOrganicCapture,
  settleBuyerVenueOrganicCapture,
  type VenueOrganicAnalyticsSurface,
} from "../../services/venueOrganicCapturePolicy";
import { PublicVenueReservationSheet } from "./PublicVenueReservationSheet";
import {
  createPublicVenueReservationUiState,
  normalizePublicVenueReservationUiState,
  publicVenueReservationUiReducer,
} from "./publicVenueReservationUiState";
import { captureWeb } from "../../analytics/webAnalytics";
import { formatSourceRange } from "../../utils/currencyFormatter";

// #1390: Stay booking includes its own renderer and Stripe Payment Element.
// Keep that product-specific bulk off the shared buyer-web boot path and load it
// only after a verified Stay venue reaches its reservations surface.
const BuyerStayGuestExperience = React.lazy(() =>
  import("../stay/BuyerStayGuestExperience").then((module) => ({
    default: module.BuyerStayGuestExperience,
  })),
);

export interface PublicVenuePageProps {
  venue: PublicVenue;
  discoveryPrice: PublicVenueDiscoveryPrice | null;
  /** ORCH-1186-C shared shape — the BRAND's menu ([TRANSITIONAL-3]). */
  menu: PublicMenuGroup[];
  /** Anon display gate; not-reservable / unknown → NO reserve bar. */
  reservable: PublicVenueReservable | null;
  reservabilityState?: "loading" | "ready" | "error";
  initialTab?: PublicVenueTab;
  onRetryReservability?: () => void;
  stayState?: "loading" | "ready" | "unavailable" | "error";
  stayDetail?: PublicStayDetail | null;
  analyticsSurface?: VenueOrganicAnalyticsSurface;
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// META-ORCH-1290(C) §6.2 — pitch-first meta description: one line, all
// whitespace/newlines collapsed to single spaces, clamped to the ≤155-char SEO
// budget with an ellipsis when it overruns.
const META_MAX = 155;
const clampPitchForMeta = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > META_MAX
    ? `${flat.slice(0, META_MAX - 1).trimEnd()}…`
    : flat;
};

// META-ORCH-1290(C) §6.1 — "Read more" heuristic (mirrors BrandProfileView's
// About clamp): a pitch longer than ~4 lines' worth of characters gets the
// toggle. Deterministic + cross-platform (no onTextLayout dependence).
const PITCH_CLAMP_CHARS = 160;

/** Local hue hash — same algorithm as the brand page's cover fallback. */
const hashHueFromString = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h % 360;
};

/** Today's weekday in the page's 0=Mon..6=Sun convention. */
const todayWeekday = (): number => (new Date().getDay() + 6) % 7;

const hoursLineFor = (entry: BrandHourEntry): string =>
  entry.isClosed || entry.openTime === null || entry.closeTime === null
    ? "Closed"
    : `${entry.openTime}–${entry.closeTime}`;

// ═══════════════════════════════════════════════════════════════════════════
// #1558 — the Overview pane, as a total section registry.
//
// Every block below used to be an inline `const …Block = …` in the component
// body, rendered in a hardcoded order, with `isStay ?` deciding which of them
// a guest saw. Now the ORDER AND MEMBERSHIP come from `profile.overview` and
// the lookup is `Record<VenueSectionId, React.FC<VenueSectionProps>>` — total,
// so a new section id does not compile until it has a renderer, and a listed id
// can never miss.
//
// Each section is pure: it takes one context and returns `null` when its data
// is absent (Constitution #9 — missing is hidden, never faked). A section that
// is LISTED but has no data renders nothing; a section that is NOT LISTED is
// never mounted. Those are different states and both are honest.
//
// These renderers stay in this file on purpose. #1559 lifts them into
// `packages/brand-rendering/venueSections/` so the consumer app renders the
// same pixels; doing it here would build that shared module a step early.
// ═══════════════════════════════════════════════════════════════════════════

type VenueSurfaceStyles = ReturnType<typeof offeringSurfaceStyles>;

export interface VenueSectionProps {
  venue: PublicVenue;
  discoveryPrice: PublicVenueDiscoveryPrice | null;
  stayDetail: PublicStayDetail | null;
  profile: VenueCategoryProfile;
  palette: ThemePalette;
  surface: VenueSurfaceStyles;
  theme: ResolvedTheme;
  themedFont: { fontFamily: ResolvedTheme["fontFamilyValue"] };
  isDesktop: boolean;
  todayWeekday: number;
  mapsQuery: string | null;
  onOpenMaps: () => void;
}

/** §6.1a typical-spend lede — gated by the profile's PRICING MODEL, not by
 *  `!isStay`. A Stay prices `nightlyFrom`; that rate is #1562, so until then a
 *  Stay's lede has a model and no data and renders nothing. */
const VenuePriceLedeSection: React.FC<VenueSectionProps> = ({
  discoveryPrice,
  profile,
  palette,
  themedFont,
}) => {
  if (
    discoveryPrice === null ||
    !typicalSpendVisible(profile, discoveryPrice !== null)
  ) {
    return null;
  }
  return (
    <Text style={[styles.aboutBody, themedFont, { color: palette.secondaryText }]}>
      Typical spend · {formatSourceRange({
        minMinor: discoveryPrice.minMinor,
        maxMinor: discoveryPrice.maxMinor,
        currencyCode: discoveryPrice.currencyCode,
        exponent: discoveryPrice.minorUnitExponent,
      })}
    </Text>
  );
};

// ── §6.1 About / pitch — the venue's voice, right under the identity ──────
// Themed prose (palette + brand font), 4-line clamp + Read more. Hidden
// entirely when the owner wrote no pitch (real-data-only, Constitution #9).
const VenueAboutSection: React.FC<VenueSectionProps> = ({
  venue,
  palette,
  themedFont,
}) => {
  const [aboutExpanded, setAboutExpanded] = useState<boolean>(false);
  const toggleAboutExpanded = useCallback((): void => {
    setAboutExpanded((v) => !v);
  }, []);
  const pitchText = venue.pitch !== null ? venue.pitch.trim() : "";
  const hasPitch = pitchText.length > 0;
  const pitchIsLong = hasPitch && pitchText.length > PITCH_CLAMP_CHARS;

  const aboutBlock = hasPitch ? (
    <View>
      <Text
        style={[styles.aboutBody, themedFont, { color: palette.secondaryText }]}
        numberOfLines={aboutExpanded ? undefined : 4}
      >
        {pitchText}
      </Text>
      {pitchIsLong ? (
        <Pressable
          onPress={toggleAboutExpanded}
          accessibilityRole="button"
          accessibilityLabel={aboutExpanded ? "Show less" : "Read more"}
          hitSlop={8}
          style={({ pressed }) => [
            styles.aboutToggle,
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.aboutToggleText, { color: palette.accent }]}>
            {aboutExpanded ? "Show less" : "Read more"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  ) : null;

  return aboutBlock;
};

// ── §6.4 map + address card ───────────────────────────────────────────────
const VenueLocationSection: React.FC<VenueSectionProps> = ({
  venue,
  palette,
  isDesktop,
  mapsQuery,
  onOpenMaps,
}) => {
  // §6.4 static map — server proxy ONLY; null → map hidden (fail-safe).
  const staticMapUrl = useMemo<string | null>(
    () =>
      buildStaticMapUrl({
        lat: venue.lat,
        lng: venue.lng,
        accentHex: palette.accent,
        height: 300,
      }),
    [palette.accent, venue.lat, venue.lng],
  );

  const mapBlock =
    staticMapUrl !== null ? (
      <View style={[styles.mapCard, { backgroundColor: palette.card }]}>
        <Image
          source={{ uri: staticMapUrl }}
          resizeMode="cover"
          style={[styles.mapImage, isDesktop && styles.mapImageDesktop]}
          accessibilityLabel={`Map of ${venue.name}`}
          accessibilityIgnoresInvertColors
        />
        <View style={[styles.mapPill, { backgroundColor: palette.page }]}>
          <Text
            numberOfLines={1}
            style={[styles.mapPillLabel, { color: palette.primaryText }]}
          >
            {venue.name}
          </Text>
        </View>
      </View>
    ) : null;

  const addressCard =
    mapsQuery !== null ? (
      <Pressable
        onPress={onOpenMaps}
        accessibilityRole="button"
        accessibilityLabel={`Open ${venue.name} in maps`}
        style={({ pressed }) => [
          styles.addressCard,
          {
            backgroundColor: palette.card,
            borderColor: palette.cutoutBorder,
          },
          pressed && styles.pressed,
        ]}
      >
        <Text
          style={[styles.addressCardLabel, { color: palette.tertiaryText }]}
        >
          WHERE YOU&apos;LL BE
        </Text>
        <Text style={[styles.addressCardValue, { color: palette.primaryText }]}>
          {venue.address ?? `${venue.lat}, ${venue.lng}`}
        </Text>
        <Text style={[styles.addressCardHint, { color: palette.accent }]}>
          Open in maps →
        </Text>
      </Pressable>
    ) : null;

  if (mapBlock === null && addressCard === null) return null;
  return (
    <>
      {mapBlock}
      {addressCard}
    </>
  );
};

// ── §6.5 hours card ───────────────────────────────────────────────────────
// Only ever mounted for a category whose profile says `timekeeping:
// "tradingHours"`. A hotel's profile lists `stayPolicy` here instead, which is
// why a Stay can no longer publish "Mon–Sat 09:00–17:00" one tap away from its
// own "Check-in 15:00".
const VenueHoursSection: React.FC<VenueSectionProps> = ({
  venue,
  palette,
  surface,
  todayWeekday: today,
}) => {
  const hours = venue.hours;
  if (hours.length === 0) return null;
  return (
    <View style={[styles.hoursCard, surface.card]}>
      <Text style={[styles.sectionLabel, { color: palette.tertiaryText }]}>
        HOURS
      </Text>
      {hours.map((entry) => {
        const isToday = entry.weekday === today;
        return (
          <View key={entry.weekday} style={styles.hoursRow}>
            {isToday ? (
              <View
                style={[styles.todayBar, { backgroundColor: palette.accent }]}
              />
            ) : null}
            <Text
              style={[
                styles.hoursDay,
                { color: palette.secondaryText },
                isToday && styles.hoursToday,
              ]}
            >
              {WEEKDAY_LABELS[entry.weekday] ?? String(entry.weekday)}
            </Text>
            <Text
              style={[
                styles.hoursTimes,
                {
                  color: entry.isClosed
                    ? palette.tertiaryText
                    : palette.primaryText,
                },
                isToday && styles.hoursToday,
              ]}
            >
              {hoursLineFor(entry)}
            </Text>
          </View>
        );
      })}
    </View>
  );
};

// ── #1558 §6.5b check-in / check-out — what a Stay has INSTEAD of hours ───
// The times are already on the wire: `PublicStayDetail.checkInTime` /
// `.checkOutTime` (`packages/brand-rendering/stayGuest.ts`), the same detail the
// Reservations tab renders. Null detail → the block is omitted, never faked.
const VenueStayPolicySection: React.FC<VenueSectionProps> = ({
  stayDetail,
  palette,
  surface,
}) => {
  if (stayDetail === null) return null;
  const houseRules =
    stayDetail.houseRules !== null && stayDetail.houseRules.trim().length > 0
      ? stayDetail.houseRules.trim()
      : null;
  return (
    <View style={[styles.hoursCard, surface.card]}>
      <Text style={[styles.sectionLabel, { color: palette.tertiaryText }]}>
        CHECK-IN &amp; CHECK-OUT
      </Text>
      <View style={styles.hoursRow}>
        <Text style={[styles.hoursDay, { color: palette.secondaryText }]}>
          Check-in
        </Text>
        <Text style={[styles.hoursTimes, { color: palette.primaryText }]}>
          {stayClockLabel(stayDetail.checkInTime)}
        </Text>
      </View>
      <View style={styles.hoursRow}>
        <Text style={[styles.hoursDay, { color: palette.secondaryText }]}>
          Check-out
        </Text>
        <Text style={[styles.hoursTimes, { color: palette.primaryText }]}>
          {stayClockLabel(stayDetail.checkOutTime)}
        </Text>
      </View>
      {houseRules !== null ? (
        <Text
          style={[styles.aboutBody, { color: palette.secondaryText }]}
        >
          {houseRules}
        </Text>
      ) : null}
    </View>
  );
};

// ── §6.6b gallery strip ───────────────────────────────────────────────────
const VenueGallerySection: React.FC<VenueSectionProps> = ({
  venue,
  palette,
}) => {
  const gallery = venue.galleryPhotoUrls;
  if (gallery.length === 0) return null;
  return (
    <View style={styles.galleryWrap}>
      <Text style={[styles.sectionLabel, { color: palette.tertiaryText }]}>
        PHOTOS
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={248}
        decelerationRate="fast"
        contentContainerStyle={styles.galleryContent}
      >
        {gallery.map((url, i) => (
          <Image
            key={url}
            source={{ uri: url }}
            resizeMode="cover"
            style={styles.galleryTile}
            accessibilityLabel={`${venue.name} photo ${i + 1} of ${gallery.length}`}
            accessibilityIgnoresInvertColors
          />
        ))}
      </ScrollView>
    </View>
  );
};

/**
 * THE SECOND TOTAL RECORD. Every `VenueSectionId` resolves here; adding an id
 * to the union without a renderer does not compile, and `profile.overview` can
 * therefore never name a section that is not drawable.
 */
const VENUE_SECTIONS: Record<VenueSectionId, React.FC<VenueSectionProps>> = {
  priceLede: VenuePriceLedeSection,
  about: VenueAboutSection,
  location: VenueLocationSection,
  hours: VenueHoursSection,
  stayPolicy: VenueStayPolicySection,
  gallery: VenueGallerySection,
};

interface ReserveGateInput {
  stayState: "loading" | "ready" | "unavailable" | "error" | undefined;
  reservabilityState: "loading" | "ready" | "error";
  reservable: PublicVenueReservable | null;
}

/**
 * §6.7 reserve display gate — fail closed, keyed on the profile's booking body
 * rather than on `isStay ? … : …`. A fifth category picks a body and inherits
 * its gate; it cannot silently inherit the restaurant's.
 */
const RESERVATION_READY: Record<
  VenueBookingBody,
  (input: ReserveGateInput) => boolean
> = {
  stay: ({ stayState }) => stayState === "ready",
  table: ({ reservabilityState, reservable }) =>
    reservabilityState === "ready" &&
    reservable !== null &&
    reservable.reservable === true &&
    reservable.venueId !== null,
};

export const PublicVenuePage: React.FC<PublicVenuePageProps> = ({
  venue,
  discoveryPrice,
  menu,
  reservable,
  reservabilityState = "ready",
  initialTab = "overview",
  onRetryReservability,
  stayState,
  stayDetail = null,
  analyticsSurface = "business_preview",
}) => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isDesktop } = useResponsiveLayout();
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [muted, setMuted] = useState<boolean>(true);
  // #1558 — the ONE category read on this page. Everything that used to branch
  // on `isStay` now reads a field of this profile, so `play`, `creative_and_arts`
  // and a NULL category stop inheriting the restaurant's page by accident.
  const profile = venueCategoryProfile(venue.venueCategory);
  const menuItemCount = menu.reduce((sum, group) => sum + group.items.length, 0);
  // #1536 flips this by editing `tabs` in VENUE_CATEGORY_PROFILES — one array
  // element, one file, all five surfaces.
  const hasMenu = venueMenuTabVisible(profile, menuItemCount);
  const canOpenReservationSheet = RESERVATION_READY[profile.bookingBody]({
    stayState,
    reservabilityState,
    reservable,
  });
  const reservationUiContext = useMemo(
    () => ({ hasMenu, canOpenReservationSheet }),
    [canOpenReservationSheet, hasMenu],
  );
  const [reservationUiState, dispatchReservationUi] = useReducer(
    publicVenueReservationUiReducer,
    initialTab,
    (tab) =>
      createPublicVenueReservationUiState(tab, reservationUiContext),
  );
  const normalizedReservationUiState =
    normalizePublicVenueReservationUiState(
      reservationUiState,
      reservationUiContext,
    );
  const publicVenueTabsRef = useRef<PublicVenueTabsHandle | null>(null);
  useEffect(() => {
    dispatchReservationUi({
      type: "INITIAL_TAB_CHANGED",
      tab: initialTab,
      context: reservationUiContext,
    });
    // Reservability changes normalize through ENVIRONMENT_CHANGED below; they
    // must not replay the route's initial tab over a user's current selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMenu, initialTab]);

  useEffect(() => {
    dispatchReservationUi({
      type: "ENVIRONMENT_CHANGED",
      context: reservationUiContext,
    });
  }, [reservationUiContext]);

  useEffect(() => {
    return settleBuyerVenueOrganicCapture(analyticsSurface, () =>
      settleVenueOrganicJourneyOnConsent({
        brandId: venue.brandId,
        venueId: venue.id,
      })
    );
  }, [analyticsSurface, venue.brandId, venue.id]);

  const resolvedTheme = useMemo<ResolvedTheme>(
    () => resolveTheme(venue.theme, null),
    [venue.theme],
  );
  const palette = useMemo<ThemePalette>(
    () => createThemePalette(resolvedTheme),
    [resolvedTheme],
  );
  const surface = useMemo(() => offeringSurfaceStyles(palette), [palette]);
  useThemeFont(resolvedTheme.fontFamilyValue);
  // Memoised because it is now threaded to every Overview section through
  // `sectionProps`; a fresh object each render would defeat that memo.
  const themedFont = useMemo(
    () => ({ fontFamily: resolvedTheme.fontFamilyValue }),
    [resolvedTheme.fontFamilyValue],
  );

  const canonicalUrl = venuePublicUrl({
    brandSlug: venue.brandSlug,
    venueSlug: venue.slug,
  });

  // §6.4 — the static map itself now lives in VenueLocationSection (it is that
  // section's data, not the page's). The page keeps only the maps QUERY, which
  // the section receives, because the "Open in maps" handler is a host effect.
  const hasCoords = Number.isFinite(venue.lat) && Number.isFinite(venue.lng);
  const mapsQuery =
    venue.address !== null && venue.address.trim().length > 0
      ? venue.address
      : hasCoords
        ? `${venue.lat},${venue.lng}`
        : null;

  const handleOpenMaps = useCallback((): void => {
    if (mapsQuery === null) return;
    void Linking.openURL(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`,
    ).catch(() => undefined);
  }, [mapsQuery]);

  const handleOpenBrand = useCallback((): void => {
    router.push(brandPublicPath(venue.brandSlug) as never);
  }, [router, venue.brandSlug]);

  const handleClose = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(brandPublicPath(venue.brandSlug) as never);
    }
  }, [router, venue.brandSlug]);

  const handleReserve = useCallback((): void => {
    if (
      !canOpenReservationSheet ||
      normalizedReservationUiState.reservationSheetOpen ||
      normalizedReservationUiState.activeTab === "reservations"
    ) {
      return;
    }
    dispatchReservationUi({
      type: "RESERVE_CTA_PRESSED",
      context: reservationUiContext,
    });
    captureWeb("public_venue_reservation_started", {
      surface: analyticsSurface,
      brand_id: venue.brandId,
      venue_id: venue.id,
      source_tab: "sticky_cta",
    });
    runBuyerVenueOrganicCapture(analyticsSurface, () => {
      void captureVenueOrganicEvent(
        { brandId: venue.brandId, venueId: venue.id },
        "reservation_start",
      );
    });
  }, [
    analyticsSurface,
    canOpenReservationSheet,
    normalizedReservationUiState.activeTab,
    normalizedReservationUiState.reservationSheetOpen,
    reservationUiContext,
    venue.brandId,
    venue.id,
  ]);

  const handleReservationSheetClose = useCallback((): void => {
    dispatchReservationUi({
      type: "RESERVATION_SHEET_CLOSED",
      context: reservationUiContext,
    });
  }, [reservationUiContext]);

  const handleReservationSheetDismissed = useCallback((): void => {
    publicVenueTabsRef.current?.focusTab("reservations");
  }, []);

  const handleVenueTabChange = useCallback(
    (tab: PublicVenueTab): void => {
      dispatchReservationUi({
        type: "TAB_SELECTED",
        tab,
        context: reservationUiContext,
      });
    },
    [reservationUiContext],
  );

  // ── §6.7 reserve display gate — fail closed. ─────────────────────────────
  const showReserveCta =
    canOpenReservationSheet &&
    normalizedReservationUiState.activeTab !== "reservations";

  const today = todayWeekday();
  const todayEntry = venue.hours.find((h) => h.weekday === today) ?? null;
  // #1558 — the desktop panel's "Open today · …" line had NO category guard, so
  // it was the SECOND place a hotel advertised a closing time. It is now gated
  // on the profile's timekeeping model, exactly like the hours section.
  const todayLine =
    venueShowsTradingHours(profile) &&
    todayEntry !== null &&
    !todayEntry.isClosed &&
    todayEntry.openTime !== null
      ? `Open today · ${todayEntry.openTime}–${todayEntry.closeTime ?? ""}`
      : null;

  // META-ORCH-1290(C) §6.1/§6.2 — the owner-authored pitch. Empty/whitespace →
  // treated as absent so the About section, desktop clamp, and pitch-first meta
  // all fall back honestly (no fabricated prose anywhere).
  const pitchText = venue.pitch !== null ? venue.pitch.trim() : "";
  const hasPitch = pitchText.length > 0;

  const metaDescription = hasPitch
    ? clampPitchForMeta(pitchText)
    : `${venue.name} — ${venue.brandName} on Mingla`;
  const pageTitle =
    venue.city !== null
      ? `${venue.name} · ${venue.city} on Mingla`
      : `${venue.name} on Mingla`;

  // ── §6.2 identity block ───────────────────────────────────────────────────
  const identityBlock = (
    <View style={styles.identityWrap}>
      <Text style={[styles.eyebrow, { color: palette.accent }]}>
        VERIFIED VENUE
      </Text>
      <Text
        style={[styles.venueName, themedFont, { color: palette.primaryText }]}
      >
        {venue.name}
      </Text>
      <Pressable
        onPress={handleOpenBrand}
        accessibilityRole="link"
        accessibilityLabel={`View ${venue.brandName} on Mingla`}
        style={styles.byBrandRow}
      >
        <Text style={[styles.byBrandBy, { color: palette.tertiaryText }]}>
          By{" "}
          <Text style={[styles.byBrandName, { color: palette.accent }]}>
            {venue.brandName}
          </Text>
        </Text>
      </Pressable>
      {venue.address !== null ? (
        <Text style={[styles.addrLine, { color: palette.tertiaryText }]}>
          {venue.address}
        </Text>
      ) : null}
    </View>
  );
  // ── #1558 the Overview pane, resolved from data ───────────────────────────
  // `profile.overview` IS the layout: an ordered list of section ids, each
  // resolved through the total VENUE_SECTIONS registry above. A restaurant
  // lists `hours`; a hotel lists `stayPolicy`. Reordering the page, or giving a
  // new category its own order, is an edit to that array — not a new branch.
  const sectionProps = useMemo<VenueSectionProps>(
    () => ({
      venue,
      discoveryPrice,
      stayDetail,
      profile,
      palette,
      surface,
      theme: resolvedTheme,
      themedFont,
      isDesktop,
      todayWeekday: today,
      mapsQuery,
      onOpenMaps: handleOpenMaps,
    }),
    [
      discoveryPrice,
      handleOpenMaps,
      isDesktop,
      mapsQuery,
      palette,
      profile,
      resolvedTheme,
      stayDetail,
      surface,
      themedFont,
      today,
      venue,
    ],
  );

  // ── §6.6 menu (shared renderer) ───────────────────────────────────────────
  const menuBlock =
    menuItemCount > 0 ? (
      <View style={styles.menuWrap}>
        <Text style={[styles.sectionLabel, { color: palette.tertiaryText }]}>
          MENU
        </Text>
        <PublicMenuSections
          groups={menu}
          palette={palette}
          surface={surface}
          theme={resolvedTheme}
        />
      </View>
    ) : null;

  // #1558 — which booking body the Reservations tab mounts is DATA
  // (`profile.bookingBody`), resolved through a total record. The bodies stay
  // app-side because the fork is a PAYMENT RAIL (Stripe.js Payment Element on
  // web vs the native PaymentSheet), not a UX fork; #1559 turns this into the
  // shared module's injected slot.
  const reservationBodies: Record<VenueBookingBody, () => React.ReactNode> = {
    stay: () => (
      <React.Suspense
        fallback={
          <View style={styles.reservationState}>
            <Text style={[styles.aboutBody, { color: palette.secondaryText }]}>
              Loading Stay availability…
            </Text>
          </View>
        }
      >
        <BuyerStayGuestExperience
          venueId={venue.id}
          brandId={venue.brandId}
          detail={stayDetail}
          state={stayState ?? "unavailable"}
          palette={palette}
          surface={surface}
          theme={resolvedTheme}
        />
      </React.Suspense>
    ),
    table: () =>
      reservabilityState === "loading" ? (
        <View style={styles.reservationState}>
          <Text style={[styles.aboutBody, { color: palette.secondaryText }]}>
            Finding open tables…
          </Text>
        </View>
      ) : reservabilityState === "error" ? (
        <View style={styles.reservationState}>
          <Text style={[styles.aboutBody, { color: palette.secondaryText }]}>
            We couldn’t check reservations right now.
          </Text>
          <Pressable
            onPress={onRetryReservability}
            accessibilityRole="button"
            accessibilityLabel="Try checking reservations again"
            style={[styles.stateRetry, { backgroundColor: palette.accent }]}
          >
            <Text style={[styles.stateRetryText, { color: palette.accentText }]}>
              Try again
            </Text>
          </Pressable>
        </View>
      ) : reservable?.reservable === true && reservable.venueId !== null ? (
        <GuestVenueReservation
          venueId={reservable.venueId}
          brandId={venue.brandId}
          currency={reservable.currency}
          analyticsSurface={analyticsSurface}
        />
      ) : (
        <View style={styles.reservationState}>
          <Text style={[styles.aboutBody, { color: palette.secondaryText }]}>
            {venueNotTakingReservationsCopy(profile)}
          </Text>
        </View>
      ),
  };
  const reservationsBlock = reservationBodies[profile.bookingBody]();

  // ── §6.7 sticky reserve bar (phone) / §6.10 panel CTA (desktop) ──────────
  const reserveCta = (
    <Pressable
      onPress={handleReserve}
      accessibilityRole="button"
      // #1532 D7 / #1558 — the CTA, the accessibility label and the sheet
      // heading all read ONE string off the category profile, so the three can
      // no longer disagree, and a gallery or a gym is never offered a table.
      accessibilityLabel={profile.reserveAction}
      style={({ pressed }) => [
        styles.reserveCta,
        { backgroundColor: palette.accent },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.reserveCtaLabel, { color: palette.accentText }]}>
        {profile.reserveAction}
      </Text>
    </Pressable>
  );

  const reserveBar =
    showReserveCta && !isDesktop ? (
      <View
        style={[
          styles.reserveBarWrap,
          {
            backgroundColor: palette.page,
            paddingBottom: insets.bottom + 8,
          },
        ]}
      >
        {reserveCta}
      </View>
    ) : null;

  const reserveBarClearance =
    showReserveCta && !isDesktop
      ? 52 + 16 + insets.bottom + 8
      : insets.bottom + 24;

  // ── §6.10 desktop sticky panel ────────────────────────────────────────────
  const stickyPanel = isDesktop ? (
    <View style={[styles.deskPanel, surface.cardStrong]}>
      <View style={[styles.deskAccent, { backgroundColor: palette.accent }]} />
      <View style={styles.deskInner}>
        <Text
          style={[styles.deskName, themedFont, { color: palette.primaryText }]}
        >
          {venue.name}
        </Text>
        {venue.address !== null ? (
          <Text style={[styles.addrLine, { color: palette.tertiaryText }]}>
            {venue.address}
          </Text>
        ) : null}
        {/* META-ORCH-1290(C) §6.3 — desktop viewers see the venue's voice
            (2-line clamp) without scrolling; the full pitch stays in the
            in-body aboutBlock on the left column. Hidden when empty. */}
        {hasPitch ? (
          <Text
            style={[
              styles.deskPitch,
              themedFont,
              { color: palette.secondaryText },
            ]}
            numberOfLines={2}
          >
            {pitchText}
          </Text>
        ) : null}
        {todayLine !== null ? (
          <Text style={[styles.deskToday, { color: palette.secondaryText }]}>
            {todayLine}
          </Text>
        ) : null}
        <Pressable
          onPress={handleOpenBrand}
          accessibilityRole="link"
          accessibilityLabel={`View ${venue.brandName} on Mingla`}
          style={styles.byBrandRow}
        >
          <Text style={[styles.byBrandBy, { color: palette.tertiaryText }]}>
            By{" "}
            <Text style={[styles.byBrandName, { color: palette.accent }]}>
              {venue.brandName}
            </Text>
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setShareModalVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="Share this venue"
          style={({ pressed }) => [
            styles.deskShareBtn,
            { backgroundColor: palette.accent },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.deskShareLabel, { color: palette.accentText }]}>
            Share
          </Text>
        </Pressable>
        {showReserveCta ? reserveCta : null}
      </View>
    </View>
  ) : null;

  const heroEyebrow = <Text style={styles.heroEyebrow}>Verified venue</Text>;
  const heroTitle = isDesktop ? (
    <>
      <Text style={[styles.heroTitle, themedFont]}>{venue.name}</Text>
      {venue.address !== null ? (
        <Text style={styles.heroAddr}>{venue.address}</Text>
      ) : null}
    </>
  ) : undefined;

  const bodyContent = (
    <View style={styles.body}>
      {!isDesktop ? identityBlock : null}
      <PublicVenueTabs
        ref={publicVenueTabsRef}
        initialTab={initialTab}
        activeTab={normalizedReservationUiState.activeTab}
        hasMenu={hasMenu}
        palette={palette}
        surface={surface}
        theme={resolvedTheme}
        overview={
          <View style={styles.tabPane}>
            {profile.overview.map((sectionId) => {
              const Section = VENUE_SECTIONS[sectionId];
              return <Section key={sectionId} {...sectionProps} />;
            })}
          </View>
        }
        menu={menuBlock}
        reservations={
          normalizedReservationUiState.reservationSheetOpen
            ? null
            : reservationsBlock
        }
        onTabChange={handleVenueTabChange}
        onTabViewed={(tab: PublicVenueTab) => {
          if (tab === "overview") {
            captureWeb("public_venue_overview_viewed", {
              surface: analyticsSurface,
              brand_id: venue.brandId,
              venue_id: venue.id,
            });
          } else if (tab === "menu") {
            captureWeb("public_venue_menu_viewed", {
              surface: analyticsSurface,
              brand_id: venue.brandId,
              venue_id: venue.id,
            });
            runBuyerVenueOrganicCapture(analyticsSurface, () => {
              void captureVenueOrganicEvent(
                { brandId: venue.brandId, venueId: venue.id },
                "menu_open",
              );
            });
          }
        }}
      />
    </View>
  );

  return (
    <View style={styles.host}>
      {Platform.OS === "web" ? (
        <Head>
          <title>{pageTitle}</title>
          <meta name="description" content={metaDescription} />
          <meta property="og:title" content={pageTitle} />
          <meta property="og:description" content={metaDescription} />
          <meta property="og:url" content={canonicalUrl} />
          <meta
            property="og:image"
            content={
              venue.coverMediaUrl !== null && venue.coverMediaType !== "video"
                ? venue.coverMediaUrl
                : brandOgImageUrl({ brandSlug: venue.brandSlug })
            }
          />
          <meta property="og:type" content="place" />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={pageTitle} />
          <meta name="twitter:description" content={metaDescription} />
          <link rel="canonical" href={canonicalUrl} />
        </Head>
      ) : null}
      <ParallaxCoverShell
        palette={palette}
        theme={resolvedTheme}
        coverMediaUrl={venue.coverMediaUrl}
        coverMediaType={venue.coverMediaType}
        coverHue={hashHueFromString(venue.slug)}
        entranceAnimationKey={`venue:${venue.brandSlug}:${venue.slug}:${resolvedTheme.color}`}
        muted={muted}
        onToggleMute={() => setMuted((v) => !v)}
        showMute={venue.coverMediaType === "video"}
        onClose={handleClose}
        onShare={() => setShareModalVisible(true)}
        hideCloseOnWeb
        heroEyebrow={heroEyebrow}
        heroTitle={heroTitle}
        stickyPanel={stickyPanel}
        safeAreaTop={insets.top + 8}
        contentBottomInset={reserveBarClearance}
        testID="orch-1255-public-venue"
      >
        {bodyContent}
      </ParallaxCoverShell>
      {reserveBar}
      <PublicVenueReservationSheet
        visible={normalizedReservationUiState.reservationSheetOpen}
        onClose={handleReservationSheetClose}
        onDismissed={handleReservationSheetDismissed}
        // #1532 defect 1 / #1558 — the heading now comes from the SAME profile
        // field as the CTA above, so a Stay guest can no longer tap "Reserve
        // this Stay" and land on a sheet headed "Reserve a table".
        title={profile.reserveAction}
      >
        {reservationsBlock}
      </PublicVenueReservationSheet>
      <ShareModal
        visible={shareModalVisible}
        onClose={() => setShareModalVisible(false)}
        url={canonicalUrl}
        title={pageTitle}
        description={metaDescription}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: "#0c0e12",
  },
  body: {
    gap: 20,
  },
  tabPane: {
    gap: 20,
  },
  // ---- identity (§6.2) ----
  identityWrap: {
    marginBottom: 4,
  },
  eyebrow: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  venueName: {
    fontSize: 30,
    lineHeight: 33,
    fontWeight: "900",
    letterSpacing: -0.5,
    marginTop: 6,
  },
  byBrandRow: {
    paddingVertical: 12,
    alignSelf: "flex-start",
  },
  byBrandBy: {
    fontSize: 14,
    lineHeight: 20,
  },
  byBrandName: {
    fontWeight: "600",
  },
  addrLine: {
    fontSize: 13,
    lineHeight: 18,
  },
  // ---- about / pitch (§6.1) ----
  // The block groups the prose + `Read more` in a bare View; the toggle carries
  // its own paddingVertical, and the parent `body` gap (20) spaces the block.
  aboutBody: {
    fontSize: 15,
    lineHeight: 23,
  },
  aboutToggle: {
    paddingVertical: 8,
    alignSelf: "flex-start",
  },
  aboutToggleText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  // ---- map + address (§6.4) ----
  mapCard: {
    borderRadius: 16,
    overflow: "hidden",
  },
  mapImage: {
    width: "100%",
    height: 220,
  },
  mapImageDesktop: {
    height: 300,
  },
  mapPill: {
    position: "absolute",
    left: 12,
    bottom: 12,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    maxWidth: "80%",
  },
  mapPillLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  addressCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 4,
  },
  addressCardLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    letterSpacing: 1.4,
  },
  addressCardValue: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "600",
  },
  addressCardHint: {
    fontSize: 13,
    fontWeight: "600",
    marginTop: 4,
  },
  // ---- hours (§6.5) ----
  hoursCard: {
    borderRadius: 16,
    padding: 16,
  },
  sectionLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    letterSpacing: 1.4,
    marginBottom: 8,
  },
  hoursRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  todayBar: {
    width: 3,
    alignSelf: "stretch",
    borderRadius: 999,
    marginRight: 9,
  },
  hoursDay: {
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },
  hoursTimes: {
    fontSize: 14,
    lineHeight: 20,
    fontVariant: ["tabular-nums"],
  },
  hoursToday: {
    fontWeight: "700",
  },
  // ---- menu + gallery (§6.6) ----
  menuWrap: {
    gap: 0,
  },
  galleryWrap: {
    gap: 0,
  },
  galleryContent: {
    gap: 8,
    paddingRight: 16,
  },
  galleryTile: {
    width: 240,
    height: 180,
    borderRadius: 12,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  // ---- reserve (§6.7) ----
  reserveBarWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
    zIndex: 6,
  },
  reserveCta: {
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    paddingHorizontal: 26,
    paddingVertical: 15,
    minHeight: 52,
    ...Platform.select({
      android: { elevation: 0, shadowOpacity: 0 },
      default: {
        shadowColor: "#000000",
        shadowOpacity: 0.28,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 8 },
      },
    }),
  },
  reserveCtaLabel: {
    fontSize: 16,
    fontWeight: "900",
  },
  pressed: {
    opacity: 0.85,
  },
  reservationState: {
    gap: 14,
    paddingVertical: 20,
  },
  stateRetry: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
    borderRadius: 12,
    paddingHorizontal: 18,
  },
  stateRetryText: {
    fontSize: 14,
    fontWeight: "800",
  },
  // ---- desktop hero + panel (§6.10) ----
  heroEyebrow: {
    color: "rgba(255, 255, 255, 0.92)",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  heroTitle: {
    color: "#ffffff",
    fontSize: 44,
    lineHeight: 48,
    fontWeight: "900",
    letterSpacing: -0.8,
  },
  heroAddr: {
    color: "rgba(255, 255, 255, 0.82)",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  deskPanel: {
    borderRadius: 22,
    overflow: "hidden",
  },
  deskAccent: {
    height: 3,
  },
  deskInner: {
    padding: 20,
    gap: 8,
  },
  deskName: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "700",
  },
  deskToday: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
  },
  // META-ORCH-1290(C) §6.3 — desktop sticky-panel pitch (2-line clamp).
  deskPitch: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  deskShareBtn: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    paddingVertical: 12,
    marginTop: 4,
  },
  deskShareLabel: {
    fontSize: 15,
    fontWeight: "700",
  },
});

export default PublicVenuePage;
