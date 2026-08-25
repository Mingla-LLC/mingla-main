/**
 * PublicVenueScreen — the ONE public venue page.
 *
 * #1559 [shared-venue-screen], step 3 of #1550. This module is
 * `mingla-business/src/components/venue/PublicVenuePage.tsx` moved here
 * VERBATIM: the shell mount, the identity block, the tab strip, every Overview
 * section, the menu pane, the reserve affordance, the reservation state copy,
 * the desktop hero and the desktop sticky panel, and the StyleSheet that sizes
 * all of it. Nothing was redesigned, reworded, reordered or re-tuned. A guest
 * sees exactly what they saw before — proven by
 * `mingla-business/src/components/venue/__tests__/publicVenueRenderParity.
 * issue1559.happy.test.tsx`, which compares seven rendered configurations
 * against trees recorded from the pre-move code.
 *
 * WHY MOVE IT BEFORE REDESIGNING IT. There were two implementations of
 * `/b/{brand}/v/{venue}` — this one and `ConsumerPublicVenueScreen.tsx` — and
 * which one a guest got depended on which app they happened to have installed.
 * #1550 Leg B counted 17 divergences, 13 of them accidental. Merging first
 * means every later step lands ONCE, on both surfaces, instead of landing on a
 * changed business page and afterwards being reconciled against an untouched
 * consumer one. #1560 points the consumer app here and deletes its fork.
 *
 * ANON-SAFE BY CONSTRUCTION (I-PROPOSED-1255-PUBLIC-VENUE-PAGE-ANON-SAFE):
 *   - data arrives as a `PublicVenueViewModel` prop, adapted by each host from
 *     `venue_public_view` (SECURITY DEFINER, verified-only). This module has no
 *     data layer at all: it cannot query `venue_listings`, cannot call
 *     `useAuth`, and cannot reach a Supabase client. That is now a structural
 *     property, not a review convention.
 *   - the reserve affordance is display-gated by the host's anon-safe
 *     `pg_venue_reservable_for_place` result; not-reservable / error → NO bar
 *     at all (fail closed, no dead CTA).
 *
 * WHAT THE HOST STILL OWNS, and why each one is genuinely app-specific:
 *   - `headSlot` — `expo-router/head`. Web-only SEO; native has nothing to
 *     emit. The strings come from `publicVenueMeta()` below so the page title a
 *     crawler reads and the title a share sheet uses have one owner.
 *   - `bookingBody` — a PAYMENT-RAIL fork, not a UX fork: Stripe.js Payment
 *     Element on web vs the native PaymentSheet. The loading / error /
 *     not-taking-reservations states around it stay HERE, because those are
 *     pixels a guest reads.
 *   - `reservationSheet` / `overlays` — modal chrome (`Sheet`, `ShareModal` on
 *     business; the OS share sheet and a different sheet on consumer).
 *   - `loadThemeFont` — font thunk registries are app-local and cannot cross
 *     the package boundary. REQUIRED, so a host cannot quietly ship an
 *     unthemed page the way the consumer screen did.
 *   - `onAnalytics` — `captureWeb` has a `.web.ts`/native-stub split and the
 *     consumer uses `postHogService`; a direct call here would fire nothing on
 *     one surface and violate the split on the other.
 *
 * DELIBERATELY NOT HERE (#1550 R4): no `React.lazy`, and no import of either
 * `*StayGuestExperience`. The host hands in an already-lazy component through
 * `bookingBody`, which is what keeps `StayGuestBooking` (988 lines) and
 * `@stripe/stripe-js` out of the eager web boot chunk.
 *
 * Real-data-only (Constitution #9): every element without data is OMITTED — no
 * fabricated placeholders, no "Address unknown" filler. The static map is
 * fetched ONLY through the vendor-neutral `static-map` server proxy
 * (buildStaticMapUrl → null ⇒ map hidden; I-PROPOSED-1162-MAP-FAILSAFE-HIDES).
 */

import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  ParallaxCoverShell,
  buildStaticMapUrl,
  createThemePalette,
  offeringSurfaceStyles,
  resolveTheme,
  useResponsiveLayout,
  // issue #2468 — the venue page holds real lat/lng (its static map is drawn
  // from them); the deep link must be anchored on that pin instead of letting a
  // provider re-geocode the address text.
  canOpenMapsTarget,
  normalizeMapsGeo,
  // issue #2508 — the shared "which map app?" chooser + copy-address button.
  // The venue page uses the SAME controls as the event/RSVP pages so the
  // public offering surfaces cannot drift.
  MapsAppChooserDialog,
  useVenueMapsActions,
  VenueCopyAddressButton,
  type MapsAppId,
  type MapsOpenTarget,
  type VenueMapsActionsState,
  type OfferingGalleryImage,
  type ResolvedTheme,
  type ThemePalette,
} from "@mingla/offering-rendering";

import { PublicMenuSections } from "./PublicMenuSections";
// The package-local React bridge (see PublicVenueTabs.tsx). Files under
// packages/ cannot discover the app's React peer, so importing "react"
// directly here would add ~50 unresolved-peer diagnostics to every consuming
// app's typecheck — the exact delta issue-1403-typecheck-delta.mjs blocks.
// StayGuestBooking.tsx (988 lines) uses the same bridge and typechecks clean.
import {
  BrandRenderingReact as React,
  useBrandRenderingMemo as useMemo,
  useBrandRenderingState as useState,
  PublicVenueTabs,
  type BrandRenderingReactElement,
  type BrandRenderingReactNode,
  type PublicVenueTabsHandle,
} from "./PublicVenueTabs";
import type { PublicMenuGroup } from "./types";
import type { PublicVenueTab } from "./publicVenueTabState";
import type { PublicStayDetail } from "./stayGuest";
import {
  stayClockLabel,
  typicalSpendVisible,
  venueCategoryProfile,
  venueMenuTabVisible,
  venueNotTakingReservationsCopy,
  venueShowsTradingHours,
  type VenueBookingBody,
  type VenueCategory,
  type VenueCategoryProfile,
  type VenueSectionId,
} from "./venueCategoryProfile";
import { formatSourceRange } from "./venueMoney";
import {
  buildVenueAnswerBar,
  venueCategoryChip,
  venueCoverPlaceholderLabel,
  venueHeroAspectRatio,
  venuePlaceChip,
  type VenueAnswerCell,
} from "./venueFirstScreen";
import {
  resolveVenueOpenState,
  venueOpenStateLine,
  VENUE_WEEKDAY_LABELS,
  type VenueOpenState,
} from "./venueOpenState";
import {
  resolveVenueStayRate,
  venueStayRateRangeLine,
  type VenueStayQuoteView,
  type VenueStayRate,
} from "./venueStayRate";
import {
  createPublicVenueReservationUiState,
  normalizePublicVenueReservationUiState,
  publicVenueReservationUiReducer,
} from "./publicVenueReservationUiState";

// ═══════════════════════════════════════════════════════════════════════════
// The read model — ONE shape, both apps
// ═══════════════════════════════════════════════════════════════════════════

/** A single `brand_hours` row, 0 = Monday. */
export interface PublicVenueHourEntry {
  weekday: number;
  /** "HH:MM" or "HH:MM:SS"; null when closed. */
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
}

/** The stored brand/venue theme, before resolution. */
export type PublicVenueThemeInput = Parameters<typeof resolveTheme>[0];

/**
 * Everything this screen renders, and nothing else. Each host adapts its own
 * read model (`PublicVenue` on business, `ConsumerPublicVenue` on the app) into
 * this one shape — that adapter is the ONLY place the two surfaces differ about
 * what a venue is.
 */
export interface PublicVenueViewModel {
  id: string;
  brandId: string;
  brandSlug: string;
  brandName: string;
  slug: string;
  name: string;
  address: string | null;
  city: string | null;
  lat: number;
  lng: number;
  venueCategory: VenueCategory | null;
  coverMediaUrl: string | null;
  coverMediaType: "image" | "video" | "gif" | null;
  theme: PublicVenueThemeInput;
  hours: PublicVenueHourEntry[];
  /**
   * #1562 — the venue's OWN IANA zone (`venue_availability_config.
   * iana_timezone`, exposed on `venue_public_view` by this issue's migration).
   * NULL when the venue has no availability config row, or when the page is
   * served by a deployment whose view predates the migration. Null is honest
   * and safe: `resolveVenueOpenState` returns `unknown` and the page states the
   * published row without claiming to know whether the doors are open.
   */
  timezone: string | null;
  galleryPhotoUrls: string[];
  /** The owner-authored public pitch. Null/empty ⇒ the About section is omitted. */
  pitch: string | null;
}

/** The place-discovery spend band, already currency-resolved by the host. */
export interface PublicVenueDiscoveryPriceView {
  minMinor: number;
  maxMinor: number | null;
  currencyCode: string;
  minorUnitExponent: number;
}

/** The anon-safe reserve DISPLAY GATE result. Display fields only. */
export interface PublicVenueReservableView {
  reservable: boolean;
  venueId: string | null;
  currency: string | null;
}

export type PublicVenueReservabilityState = "loading" | "ready" | "error";
export type PublicVenueStayState =
  | "loading"
  | "ready"
  | "unavailable"
  | "error";

// ═══════════════════════════════════════════════════════════════════════════
// Host capabilities
// ═══════════════════════════════════════════════════════════════════════════

type VenueSurfaceStyles = ReturnType<typeof offeringSurfaceStyles>;

/** Every slot receives the ONE resolved theme, so nothing can render unthemed. */
export interface PublicVenueThemedContext {
  palette: ThemePalette;
  surface: VenueSurfaceStyles;
  theme: ResolvedTheme;
}

/**
 * The booking-body slot. Discriminated on the category profile's
 * `bookingBody`, so the host switches on DATA rather than re-deriving
 * "is this a hotel?" — the exact branch #1558 deleted.
 *
 * #1560 — every context also carries `openReservationSheet`. A host whose
 * booking rail is a MODAL rather than an inline form (the consumer app: the
 * native `VenueReserveSheet` cannot be rendered as a pane) needs a way to raise
 * the sheet from inside the Reservations pane, where the sticky CTA is
 * deliberately hidden. Routing that through this callback keeps the reducer
 * below the SINGLE owner of `reservationSheetOpen`; the alternative — the host
 * holding its own `visible` flag — is two owners of one truth (Constitution
 * #2) and is exactly how a sheet gets stuck open. The buyer-web host ignores
 * it: its body IS the form.
 */
export type PublicVenueBookingSlotContext = PublicVenueThemedContext & {
  /**
   * Raise the reservation sheet from inside the booking body. No-op when the
   * page is not reservable or the sheet is already open — the same fail-closed
   * gate the sticky CTA passes through, so this can never open a sheet the
   * page itself would refuse to open.
   */
  openReservationSheet: () => void;
  /**
   * The category's ONE reserve verb, already resolved from the profile here.
   * Handed to the slot rather than re-resolved by the host so a host-rendered
   * button and this page's sticky CTA cannot drift into two wordings — which is
   * precisely how "Find a table" survived as a fourth string.
   */
  reserveAction: string;
} & (
    | {
        kind: "stay";
        venueId: string;
        brandId: string;
        stayDetail: PublicStayDetail | null;
        stayState: PublicVenueStayState;
      }
    | {
        kind: "table";
        /** The RESOLVER's venue id — the gate's own id, never the page's. */
        venueId: string;
        brandId: string;
        currency: string | null;
      }
  );

/** The modal the Reserve CTA opens. Chrome is app-owned; its state is not. */
export interface PublicVenueReservationSheetContext
  extends PublicVenueThemedContext {
  visible: boolean;
  title: string;
  onClose: () => void;
  onDismissed: () => void;
  children: BrandRenderingReactNode;
}

/**
 * Issue #1793 (#1767 Phase 4) — the GUEST ORDERING slots.
 *
 * Three injected render slots, in the exact grammar `bookingBody` already
 * established on this screen, and for the same reason: the ordering rail forks
 * on PAYMENT (a native payment sheet on the consumer app, a hosted redirect on
 * buyer web), not on pixels. Everything a guest sees is the shared renderers
 * under `venueOrdering/`; the money step is host-owned and this file never
 * imports it.
 *
 * WHY SLOTS AND NOT AN IMPORT. This module may not contain `React.lazy` — the
 * `i-1047-biz-bundle-budget-deferral` gate asserts it, because code-splitting
 * belongs where the bundle is measured, in the host. A value import of the
 * ordering renderers HERE would hoist a cart, a review pane and a status card
 * into the eager chunk of every venue page on the web, ordering venue or not.
 * With slots this file gains exactly one type import, which is erased.
 */
export interface PublicVenueOrderingSlotContext
  extends PublicVenueThemedContext {
  /** The venue's menu, so the ordering renderer draws from the SAME payload. */
  menu: PublicMenuGroup[];
}

export interface PublicVenueOrderingSlots {
  /**
   * The ONE ordering slot. It replaces the display-only menu list when it
   * returns non-null, and hands the pane back when it returns null — which is
   * what a venue with ordering switched off gets: the page it already had.
   *
   * ONE slot rather than four, and the reason is worth keeping. The first cut
   * had separate notice / menu / sticky-bar / overlay slots so the bar could
   * own the bottom of the viewport. But the ordering STATE is a hook, a hook
   * cannot be lazily imported, and four slots meant the route calling it at
   * module scope — which on buyer web put the cart and the rules into the boot
   * payload every visitor downloads (+31 KB against a 12 KB allowance,
   * ORCH-1083) and on the consumer app dragged the NATIVE payment SDK into a
   * route the web render suites mount, so the whole page failed to load there.
   * One slot lets each host lazily mount a single component that owns its own
   * state, and costs exactly one thing: the basket's action bar rides at the top
   * of the pane instead of the bottom of the screen.
   */
  menuBody?: (
    context: PublicVenueOrderingSlotContext,
  ) => BrandRenderingReactNode | null;
}

/** The three events this page emits. The host adds its own surface tag. */
export type PublicVenueAnalyticsEvent =
  | "public_venue_overview_viewed"
  | "public_venue_menu_viewed"
  | "public_venue_reservation_started";

export interface PublicVenueScreenProps {
  venue: PublicVenueViewModel;
  /** Business public-web #1615 identity overlay; absent preserves consumer/native hosts. */
  useDirectionCIdentity?: boolean;
  discoveryPrice: PublicVenueDiscoveryPriceView | null;
  /** ORCH-1186-C shared shape — the BRAND's menu ([TRANSITIONAL-3]). */
  menu: PublicMenuGroup[];
  /** Anon display gate; not-reservable / unknown → NO reserve bar. */
  reservable: PublicVenueReservableView | null;
  reservabilityState?: PublicVenueReservabilityState;
  initialTab?: PublicVenueTab;
  onRetryReservability?: () => void;
  stayState?: PublicVenueStayState;
  stayDetail?: PublicStayDetail | null;
  /**
   * #1562 mitigation 2 — the guest's REAL quoted total, lifted from the
   * Reservations tab's booking body so the first screen can replace the
   * from-rate with it IN THE SAME SLOT. Null until dates are chosen. The host
   * owns the quote (it owns the service call); this screen only reads it.
   */
  stayQuote?: VenueStayQuoteView | null;
  /** Runtime safe-area insets. A package stays free of the insets provider. */
  safeAreaInsets: { top: number; bottom: number };
  /** Web-only `<Head>`; native hosts pass nothing. */
  headSlot?: BrandRenderingReactNode;
  /**
   * REQUIRED and hook-shaped: called unconditionally on every render with the
   * resolved family, so `useThemeFont` / `useConsumerThemeFont` can be handed
   * straight in. Required is the point — the consumer venue page shipped for a
   * month with no brand font at all because nothing forced the decision.
   */
  loadThemeFont: (family: string | null) => void;
  bookingBody: (context: PublicVenueBookingSlotContext) => BrandRenderingReactNode;
  reservationSheet: (
    context: PublicVenueReservationSheetContext,
  ) => BrandRenderingReactNode;
  /** Issue #1793 — guest ordering. Absent ⇒ this page is exactly as it was. */
  ordering?: PublicVenueOrderingSlots;
  /** Host chrome rendered last, in the page frame (business: ShareModal). */
  overlays?: BrandRenderingReactNode;
  onAnalytics: (
    event: PublicVenueAnalyticsEvent,
    props: Record<string, unknown>,
  ) => void;
  onShare: () => void;
  onClose: () => void;
  onOpenBrand: () => void;
  /**
   * issue #2468 — carries the venue's stored coordinate, not just the address
   * text. The host builds the URL with `buildMapsDeepLink`; it must never
   * re-derive one from `target.label` alone.
   */
  onOpenMaps: (target: MapsOpenTarget, app?: MapsAppId) => void;
  /**
   * issue #2508 — writes the venue's address text to the clipboard so a guest
   * can paste it into Waze / Uber / a message. Absent ⇒ no copy button.
   */
  onCopyAddress?: (text: string) => void | Promise<void>;
}

// #1562 — the week's labels have ONE owner now (`venueOpenState.ts`), because
// the open-now line and the week table name the same days and a second array
// is how they come to disagree.
const WEEKDAY_LABELS = VENUE_WEEKDAY_LABELS;

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

/**
 * #1562 DELETED `todayWeekday()`.
 *
 * It was `(new Date().getDay() + 6) % 7` — the VISITOR's device weekday — and
 * one call at line 932 fed all three of this page's hours surfaces: the desktop
 * "Open today" claim, the week table's today bar, and the answer bar's time
 * cell. A guest in Lagos looking at a Miami restaurant at 01:00 read Saturday's
 * row on a venue for which it was still Friday evening.
 *
 * The weekday now comes from `resolveVenueOpenState(...).weekday`, resolved in
 * the venue's own IANA zone. It is `null` when that zone is unusable, and
 * `venueTodayWeekday` below turns that into `-1` — an index no `brand_hours`
 * row can carry, so NOTHING is highlighted rather than the wrong thing being
 * highlighted. Subtracting the old helper (rather than leaving it beside the
 * new one) is what makes the device clock unreachable from this file.
 */
const venueTodayWeekday = (state: VenueOpenState): number =>
  state.weekday ?? -1;

const hoursLineFor = (entry: PublicVenueHourEntry): string =>
  entry.isClosed || entry.openTime === null || entry.closeTime === null
    ? "Closed"
    : `${entry.openTime}–${entry.closeTime}`;

/**
 * The page's derived strings, with ONE owner. The web host's `<Head>` and its
 * share sheet both read these, so the title a crawler indexes and the title a
 * guest forwards can never disagree.
 */
export interface PublicVenueMeta {
  pageTitle: string;
  metaDescription: string;
  hasPitch: boolean;
  pitchText: string;
}

export function publicVenueMeta(venue: {
  name: string;
  city: string | null;
  brandName: string;
  pitch: string | null;
}): PublicVenueMeta {
  // META-ORCH-1290(C) §6.1/§6.2 — the owner-authored pitch. Empty/whitespace →
  // treated as absent so the About section, desktop clamp, and pitch-first meta
  // all fall back honestly (no fabricated prose anywhere).
  const pitchText = venue.pitch !== null ? venue.pitch.trim() : "";
  const hasPitch = pitchText.length > 0;
  return {
    pitchText,
    hasPitch,
    metaDescription: hasPitch
      ? clampPitchForMeta(pitchText)
      : `${venue.name} — ${venue.brandName} on Mingla`,
    pageTitle:
      venue.city !== null
        ? `${venue.name} · ${venue.city} on Mingla`
        : `${venue.name} on Mingla`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// #1558 — the Overview pane, as a total section registry.
//
// The ORDER AND MEMBERSHIP come from `profile.overview` and the lookup is
// `Record<VenueSectionId, VenueSectionRenderer>` — total, so a new
// section id does not compile until it has a renderer, and a listed id can
// never miss.
//
// Each section is pure: it takes one context and returns `null` when its data
// is absent (Constitution #9 — missing is hidden, never faked). A section that
// is LISTED but has no data renders nothing; a section that is NOT LISTED is
// never mounted. Those are different states and both are honest.
//
// #1559 moved these renderers out of the business app and into this package
// unchanged, which is what lets #1560 delete the consumer's reduced copies of
// the same blocks rather than bring them up to parity by hand.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * One Overview section. Declared as an explicit function type rather than
 * `React.FC` because the bridged React is untyped from inside `packages/`;
 * naming the props concretely here is what keeps every renderer below fully
 * type-checked instead of silently widening to `any`.
 */
export type VenueSectionRenderer = (
  props: VenueSectionProps,
) => BrandRenderingReactElement | null;

export interface VenueSectionProps {
  venue: PublicVenueViewModel;
  discoveryPrice: PublicVenueDiscoveryPriceView | null;
  stayDetail: PublicStayDetail | null;
  profile: VenueCategoryProfile;
  palette: ThemePalette;
  surface: VenueSurfaceStyles;
  theme: ResolvedTheme;
  themedFont: { fontFamily: ResolvedTheme["fontFamilyValue"] };
  isDesktop: boolean;
  /**
   * #1562 — the VENUE's weekday, not the device's. `-1` when the venue's zone
   * is unusable, which highlights no row rather than the wrong one.
   */
  todayWeekday: number;
  /** #1562 — resolved once per render, shared by every hours surface. */
  openState: VenueOpenState;
  /** #1562 — the Stay nightly rate, or null when there is no honest one. */
  stayRate: VenueStayRate | null;
  /** issue #2468 — null ⇔ nothing openable ⇔ the address card is not rendered. */
  mapsTarget: MapsOpenTarget | null;
  onOpenMaps: () => void;
  /**
   * issue #2508 — the chooser + copy controller, built from the SAME
   * `mapsTarget` above. Null target ⇒ no choices and no copy text, so both
   * controls disappear with the address card rather than needing their own
   * gate.
   */
  mapsActions: VenueMapsActionsState;
}

/** §6.1a the price lede — gated by the profile's PRICING MODEL, not by
 *  `!isStay`.
 *
 *  #1562 gave the `nightlyFrom` model its data. A Stay's lede now carries the
 *  full nightly RANGE, which the one-number answer cell above cannot: "Rooms
 *  $275–$350 · per night · before taxes and fees". The range answers #1550's
 *  named pain point #1 ("a hotel with a range of rooms gives a guest no way to
 *  narrow by what they can afford") at the only place on the first screen where
 *  a second number fits, and it carries the SAME qualifier as the answer cell
 *  because both call `venueStayRateQualifier` — they cannot drift. */
const VenuePriceLedeSection: VenueSectionRenderer = ({
  discoveryPrice,
  profile,
  palette,
  stayRate,
  themedFont,
}) => {
  if (profile.pricing === "nightlyFrom") {
    if (stayRate === null) return null;
    return (
      <Text
        style={[styles.aboutBody, themedFont, { color: palette.secondaryText }]}
        testID="issue-1562-stay-rate-lede"
      >
        {venueStayRateRangeLine(stayRate)}
      </Text>
    );
  }
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
const VenueAboutSection: VenueSectionRenderer = ({
  venue,
  palette,
  themedFont,
}) => {
  const [aboutExpanded, setAboutExpanded] = useState<boolean>(false);
  const toggleAboutExpanded = React.useCallback((): void => {
    setAboutExpanded((v: boolean) => !v);
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
const VenueLocationSection: VenueSectionRenderer = ({
  venue,
  palette,
  isDesktop,
  mapsTarget,
  onOpenMaps,
  mapsActions,
  themedFont,
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
    mapsTarget !== null ? (
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
      {/* issue #2508 — SIBLINGS of the address card, never children: the card
          is itself a Pressable and nesting one inside it would flatten the
          accessibility subtree into a single announced control. Both self-hide
          when `mapsTarget` is null, i.e. under the same gate as the card. */}
      <VenueCopyAddressButton
        actions={mapsActions}
        palette={palette}
        font={themedFont.fontFamily}
      />
      <MapsAppChooserDialog
        actions={mapsActions}
        palette={palette}
        placeLabel={venue.name}
        font={themedFont.fontFamily}
      />
    </>
  );
};

// ── §6.5 hours card ───────────────────────────────────────────────────────
// Only ever mounted for a category whose profile says `timekeeping:
// "tradingHours"`. A hotel's profile lists `stayPolicy` here instead, which is
// why a Stay can no longer publish "Mon–Sat 09:00–17:00" one tap away from its
// own "Check-in 15:00".
const VenueHoursSection: VenueSectionRenderer = ({
  venue,
  openState,
  palette,
  surface,
  todayWeekday: today,
}) => {
  const hours = venue.hours;
  if (hours.length === 0) return null;
  // #1562 — the same resolved state the answer bar and the desktop panel draw,
  // repeated at the head of the week so a guest who has scrolled to the table
  // is not made to work out for themselves whether "Fri 09:00–17:00" means the
  // doors are open at this moment. Null (unknown zone) renders nothing.
  const stateLine = venueOpenStateLine(
    openState,
    hours.find((entry) => entry.weekday === today) ?? null,
  );
  return (
    <View style={[styles.hoursCard, surface.card]}>
      <Text style={[styles.sectionLabel, { color: palette.tertiaryText }]}>
        HOURS
      </Text>
      {stateLine !== null ? (
        <Text
          style={[
            styles.hoursStateLine,
            {
              color:
                openState.status === "open"
                  ? palette.accent
                  : palette.secondaryText,
            },
          ]}
          testID="issue-1562-hours-state"
        >
          {stateLine}
        </Text>
      ) : null}
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
const VenueStayPolicySection: VenueSectionRenderer = ({
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

// ── §6.6b gallery strip — DELETED by #1561 ────────────────────────────────
//
// It was the last element of the Overview pane, and in the normal case it held
// exactly ONE 240x180 tile that was a shrunken duplicate of the hero, under a
// heading reading `PHOTOS` — plural — with the page ending underneath it.
// #1550 Leg C measured that tile at 240x180 at EVERY width from 360 to 2560:
// it never responded to anything, and at 1440 it sat left-aligned in an 800pt
// column with ~560pt of empty page beside it.
//
// It is REMOVED, not repaired. Two reasons, both structural:
//
//   1. Even repaired, a second gallery at the foot of the page argues with the
//      hero at the top of it. `ParallaxCoverShell` has had a first-class cover
//      pager since #868 (`galleryImages`, the `CoverGalleryRow` beneath it),
//      and EVERY sibling public page already passes it — `ExperiencePreview`,
//      `TripPreview`, `FoundationEventPreview`, `FoundationRsvpPreview`. The
//      venue page was the only caller with photographs that did not.
//   2. It rendered `venue.galleryPhotoUrls` straight into `<Image>` tiles with
//      NO media-type check, and index 0 of that list is `coverMediaUrl` — so a
//      venue with a VIDEO cover put a video URL in an `<Image>`. On the hero
//      path that cannot happen: index 0 goes through `EventCoverMedia` WITH the
//      venue's `coverMediaType`, and only non-cover photographs are handed to
//      `galleryImages` (whose type excludes video by construction).
//
// `gallery` is gone from `VenueSectionId` too, so this is not a listed section
// with no renderer — the registry below stays total and the vacuity guards in
// `venueCategoryProfile.issue1558.happy.test.ts` stay meaningful.

/**
 * THE SECOND TOTAL RECORD. Every `VenueSectionId` resolves here; adding an id
 * to the union without a renderer does not compile, and `profile.overview` can
 * therefore never name a section that is not drawable.
 */
const VENUE_SECTIONS: Record<VenueSectionId, VenueSectionRenderer> = {
  priceLede: VenuePriceLedeSection,
  about: VenueAboutSection,
  location: VenueLocationSection,
  hours: VenueHoursSection,
  stayPolicy: VenueStayPolicySection,
};

interface ReserveGateInput {
  stayState: PublicVenueStayState | undefined;
  reservabilityState: PublicVenueReservabilityState;
  reservable: PublicVenueReservableView | null;
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

export const PublicVenueScreen = ({
  venue,
  useDirectionCIdentity = false,
  discoveryPrice,
  menu,
  reservable,
  reservabilityState = "ready",
  initialTab = "overview",
  onRetryReservability,
  stayState,
  stayDetail = null,
  stayQuote = null,
  safeAreaInsets,
  headSlot,
  loadThemeFont,
  bookingBody,
  reservationSheet,
  ordering,
  overlays,
  onAnalytics,
  onShare,
  onClose,
  onOpenBrand,
  onOpenMaps,
  onCopyAddress,
}: PublicVenueScreenProps): BrandRenderingReactElement => {
  const insets = safeAreaInsets;
  const { isDesktop, width: viewportWidth } = useResponsiveLayout();
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
  const [reservationUiState, dispatchReservationUi] = React.useReducer(
    publicVenueReservationUiReducer,
    initialTab,
    (tab: PublicVenueTab) =>
      createPublicVenueReservationUiState(tab, reservationUiContext),
  );
  const normalizedReservationUiState =
    normalizePublicVenueReservationUiState(
      reservationUiState,
      reservationUiContext,
    );
  const publicVenueTabsRef = React.useRef<PublicVenueTabsHandle | null>(null);
  React.useEffect(() => {
    dispatchReservationUi({
      type: "INITIAL_TAB_CHANGED",
      tab: initialTab,
      context: reservationUiContext,
    });
    // Reservability changes normalize through ENVIRONMENT_CHANGED below; they
    // must not replay the route's initial tab over a user's current selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMenu, initialTab]);

  React.useEffect(() => {
    dispatchReservationUi({
      type: "ENVIRONMENT_CHANGED",
      context: reservationUiContext,
    });
  }, [reservationUiContext]);

  const resolvedTheme = useMemo<ResolvedTheme>(
    () => resolveTheme(venue.theme, null),
    [venue.theme],
  );
  const palette = useMemo<ThemePalette>(
    () => createThemePalette(resolvedTheme),
    [resolvedTheme],
  );
  const surface = useMemo(() => offeringSurfaceStyles(palette), [palette]);
  // Hook-shaped host capability — called unconditionally, once, every render,
  // so `useThemeFont` can be passed straight in without breaking hook order.
  loadThemeFont(resolvedTheme.fontFamilyValue);
  // Memoised because it is threaded to every Overview section through
  // `sectionProps`; a fresh object each render would defeat that memo.
  const themedFont = useMemo(
    () => ({ fontFamily: resolvedTheme.fontFamilyValue }),
    [resolvedTheme.fontFamilyValue],
  );

  // §6.4 — the static map itself lives in VenueLocationSection (it is that
  // section's data, not the page's). The page keeps only the maps QUERY, which
  // the section receives, because the "Open in maps" handler is a host effect.
  /*
    issue #2468 — the venue page ALWAYS had real coordinates (the static map
    above is drawn from them) and still sent Apple/Google the address STRING,
    which they re-geocoded. The target now carries the coordinate; the address
    survives only as the pin's label and as the fallback for the rare venue
    whose lat/lng is missing or sentinel.
  */
  const mapsTarget = React.useMemo<MapsOpenTarget | null>(() => {
    const geo = normalizeMapsGeo({ lat: venue.lat, lng: venue.lng });
    const label =
      venue.address !== null && venue.address.trim().length > 0
        ? venue.address
        : venue.name;
    const candidate: MapsOpenTarget = { label, geo };
    return canOpenMapsTarget(candidate) ? candidate : null;
  }, [venue.address, venue.lat, venue.lng, venue.name]);

  /*
    issue #2508 — one controller owns "ask which app, then open" and "copy the
    address, then confirm". `requestOpenMaps` replaces the old direct call: it
    opens the chooser when more than one map app can honestly open the pin, and
    falls straight through to the #2468 path when only one can (Android).
  */
  const mapsActions = useVenueMapsActions({
    target: mapsTarget,
    onOpenMaps,
    onCopyAddress,
  });
  const handleOpenMaps = mapsActions.requestOpenMaps;

  const handleReserve = React.useCallback((): void => {
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
    onAnalytics("public_venue_reservation_started", {
      brand_id: venue.brandId,
      venue_id: venue.id,
      source_tab: "sticky_cta",
    });
  }, [
    canOpenReservationSheet,
    normalizedReservationUiState.activeTab,
    normalizedReservationUiState.reservationSheetOpen,
    onAnalytics,
    reservationUiContext,
    venue.brandId,
    venue.id,
  ]);

  /**
   * #1560 — the booking BODY's request to raise the sheet. Same fail-closed
   * gate as `handleReserve`, minus its `activeTab === "reservations"` clause:
   * that clause exists because on buyer web the Reservations pane already
   * contains the whole form, so re-opening it over itself would be noise. On a
   * host whose rail is modal-only, the pane is a prompt and this IS the tap
   * that books. The reducer stays the one owner of `reservationSheetOpen`.
   */
  const handleOpenReservationSheetFromBody = React.useCallback((): void => {
    if (
      !canOpenReservationSheet ||
      normalizedReservationUiState.reservationSheetOpen
    ) {
      return;
    }
    dispatchReservationUi({
      type: "RESERVE_CTA_PRESSED",
      context: reservationUiContext,
    });
    onAnalytics("public_venue_reservation_started", {
      brand_id: venue.brandId,
      venue_id: venue.id,
      source_tab: "reservations_pane",
    });
  }, [
    canOpenReservationSheet,
    normalizedReservationUiState.reservationSheetOpen,
    onAnalytics,
    reservationUiContext,
    venue.brandId,
    venue.id,
  ]);

  const handleReservationSheetClose = React.useCallback((): void => {
    dispatchReservationUi({
      type: "RESERVATION_SHEET_CLOSED",
      context: reservationUiContext,
    });
  }, [reservationUiContext]);

  const handleReservationSheetDismissed = React.useCallback((): void => {
    publicVenueTabsRef.current?.focusTab("reservations");
  }, []);

  const handleVenueTabChange = React.useCallback(
    (tab: PublicVenueTab): void => {
      dispatchReservationUi({
        type: "TAB_SELECTED",
        tab,
        context: reservationUiContext,
      });
    },
    [reservationUiContext],
  );

  // ── Issue #1793 — the guest-ordering slot, resolved ONCE. ────────────────
  const orderingSlotContext: PublicVenueOrderingSlotContext = {
    palette,
    surface,
    theme: resolvedTheme,
    menu,
  };
  const orderingMenuBody = ordering?.menuBody?.(orderingSlotContext) ?? null;

  // ── §6.7 reserve display gate — fail closed. ─────────────────────────────
  const showReserveCta =
    canOpenReservationSheet &&
    normalizedReservationUiState.activeTab !== "reservations";

  // ── #1562 §6.5 the venue's own clock, resolved ONCE ──────────────────────
  //
  // ONE OWNER for three surfaces. The desktop sticky line, the week table's
  // today bar and the answer bar's time cell all read THIS object. Before this
  // step each derived its own answer from `new Date()` on the visitor's device,
  // which is how the panel could claim "Open today" at 03:00 on a venue whose
  // own date had not yet rolled over.
  //
  // `nowTick` re-resolves the state on a schedule rather than only on mount:
  // "Open now" is a claim about a moment, and a tab left open across 17:00 that
  // still says Open is the same lie in slower motion. The interval is a whole
  // minute (the finest granularity the copy can express), and it is torn down
  // on unmount so a backgrounded page holds no timer.
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const ticksForOpenNow = venueShowsTradingHours(profile);
  React.useEffect((): (() => void) => {
    // Only a category that TRADES HOURS has an answer that can go stale. A
    // hotel's cell is check-in/check-out, which is the same at 03:00 as at
    // 15:00 — so ticking a hotel page would re-render the whole venue screen
    // every minute to recompute a value that cannot move. Gating here rather
    // than inside the memo is what keeps the timer off those pages entirely.
    if (!ticksForOpenNow) return () => undefined;
    const handle = setInterval(() => setNowTick(Date.now()), 60_000);
    // `unref()` — Node only, and load-bearing there. Under Node this timer is a
    // handle on the event loop, so a jest suite that mounts this screen and
    // then throws before unmounting (an assertion failure, which is the NORMAL
    // way a test ends) leaves the interval live and the RUNNER NEVER EXITS: one
    // red assertion becomes a hung CI job with no output at all. Measured on
    // this very file. `unref` says "never be the reason a process stays alive"
    // without changing what the timer does while the page is mounted.
    //
    // React Native and browsers return a number from `setInterval` and have no
    // `unref`, hence the shape check rather than a platform check — the
    // teardown below is what disposes of it on every surface.
    const unrefable = handle as unknown as { unref?: () => void };
    if (typeof unrefable.unref === "function") unrefable.unref();
    return () => clearInterval(handle);
  }, [ticksForOpenNow]);
  const openState = useMemo<VenueOpenState>(
    () =>
      // A Stay does not trade hours; asking whether a hotel is "open" is the
      // category confusion #1558 removed. The resolver is still called with an
      // empty week so the venue's weekday is available to anything that wants
      // it, and it returns `unknown`, which claims nothing.
      resolveVenueOpenState({
        hours: venueShowsTradingHours(profile) ? venue.hours : [],
        timeZone: venue.timezone,
        now: new Date(nowTick),
      }),
    [profile, venue.hours, venue.timezone, nowTick],
  );
  const today = venueTodayWeekday(openState);
  const todayEntry = venue.hours.find((h) => h.weekday === today) ?? null;
  // #1558 gated this on the profile's timekeeping model (it was the SECOND
  // place a hotel advertised a closing time). #1562 replaces the string itself:
  // "Open today · 09:00–17:00" was a weekday match dressed as an open-now
  // claim; `venueOpenStateLine` states what is actually true at this minute in
  // the venue's own zone, and returns null when nothing can be claimed.
  const todayLine = venueShowsTradingHours(profile)
    ? venueOpenStateLine(openState, todayEntry)
    : null;

  // ── #1562 §6.1 the Stay's nightly rate ───────────────────────────────────
  // A pure reduction over offerings ALREADY loaded by `usePublicStayDetail` —
  // no query, no column, no RPC. Null whenever there is no honest single answer
  // (no room-night offering, or offerings that disagree on currency).
  const stayRate = useMemo<VenueStayRate | null>(
    () =>
      stayDetail === null ? null : resolveVenueStayRate(stayDetail.offerings),
    [stayDetail],
  );

  const { hasPitch, pitchText } = publicVenueMeta(venue);

  // ── #1561 §6.2 the first screen: chips → name → brand → answer bar ────────
  //
  // THE MEASUREMENT THIS EXISTS TO MOVE. #1550 Leg C scored the live page on
  // the first viewport only, at 360 / 390 / 820 / 1440 / 2560, on three real
  // venues: **0 of 4**. Price was unanswerable at every width on every venue on
  // every surface, and on a hotel "what is this place" failed too — the only
  // descriptor above the fold was `VERIFIED VENUE`, which describes Mingla's
  // process, not the venue.
  //
  // So the eyebrow is DELETED and the category chip takes its position. The
  // view only ever serves `claim_status='verified'` rows, so 100% of pages
  // carried that badge and it distinguished nothing; "Hotel" distinguishes a
  // great deal. The separate address LINE is deleted with it: the place chip
  // already answers "where", and Leg C counted the location stated three times
  // in a row (this line, the static map, and the WHERE YOU'LL BE card).
  const categoryChip = venueCategoryChip(profile);
  const placeChip = venuePlaceChip(venue);
  const answerCells = buildVenueAnswerBar({
    profile,
    discoveryPrice,
    stay:
      stayDetail === null
        ? null
        : {
            checkInTime: stayDetail.checkInTime,
            checkOutTime: stayDetail.checkOutTime,
          },
    todayHours: todayEntry,
    openState,
    stayRate,
    stayQuote,
    canBook: canOpenReservationSheet,
  });

  const renderAnswerCell = (cell: VenueAnswerCell): BrandRenderingReactElement => (
    <View
      key={cell.id}
      style={[styles.answerCell, { borderColor: palette.cutoutBorder }]}
      accessibilityRole="text"
      accessibilityLabel={
        cell.note === null
          ? `${cell.label}: ${cell.value}`
          : `${cell.label}: ${cell.value}, ${cell.note}`
      }
    >
      <Text
        numberOfLines={1}
        style={[styles.answerLabel, { color: palette.tertiaryText }]}
      >
        {cell.label}
      </Text>
      <Text
        numberOfLines={1}
        style={[styles.answerValue, themedFont, { color: palette.primaryText }]}
      >
        {cell.value}
      </Text>
      {cell.note !== null ? (
        <Text
          numberOfLines={2}
          style={[styles.answerNote, { color: palette.secondaryText }]}
        >
          {cell.note}
        </Text>
      ) : null}
    </View>
  );

  const identityBlock = (
    <View style={styles.identityWrap}>
      <View style={styles.chipRow}>
        {categoryChip.length > 0 ? (
          <View
            style={[styles.chip, { backgroundColor: palette.card }]}
            testID="issue-1561-category-chip"
          >
            <Text style={[styles.chipText, { color: palette.accent }]}>
              {categoryChip}
            </Text>
          </View>
        ) : null}
        {placeChip !== null ? (
          <View
            style={[styles.chip, { backgroundColor: palette.card }]}
            testID="issue-1561-place-chip"
          >
            <Text
              numberOfLines={1}
              style={[styles.chipText, { color: palette.secondaryText }]}
            >
              {placeChip}
            </Text>
          </View>
        ) : null}
      </View>
      <Text
        style={[styles.venueName, themedFont, { color: palette.primaryText }]}
      >
        {venue.name}
      </Text>
      <Pressable
        onPress={onOpenBrand}
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
      {answerCells.length > 0 ? (
        <View style={styles.answerBar} testID="issue-1561-answer-bar">
          {answerCells.map(renderAnswerCell)}
        </View>
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
      openState,
      stayRate,
      mapsTarget,
      onOpenMaps: handleOpenMaps,
      mapsActions,
    }),
    [
      discoveryPrice,
      handleOpenMaps,
      isDesktop,
      mapsActions,
      mapsTarget,
      openState,
      palette,
      profile,
      resolvedTheme,
      stayDetail,
      stayRate,
      surface,
      themedFont,
      today,
      venue,
    ],
  );

  // ── §6.6 menu (shared renderer) ───────────────────────────────────────────
  //
  // Issue #1793 — the pane now has an ordering half. The two menu renderers are
  // ALTERNATIVES: `PublicMenuSections` is the display-only list whose rows carry
  // no press target at all (pinned by publicMenu.render.test.tsx, because a
  // venue with ordering off — which is every venue by default — must never grow
  // a tappable-looking dead row), and `ordering.menuBody` is the same data with
  // a way to buy it. The notice renders above whichever one mounts, so a guest
  // who scanned a code at a paused venue reads the honest reason FIRST and the
  // menu underneath it.
  // The label is OUTSIDE the branch on purpose. A slot that returns a
  // `<Suspense>` wrapper is non-null even while its lazy child has resolved to
  // nothing, so a screen that chose its branch on the slot's nullness would drop
  // the section heading — and, at a venue with ordering off, the menu with it.
  // The slot renders the LIST (orderable or display-only); the heading is the
  // page's, always.
  const menuBlock = menuItemCount === 0 ? null : (
    <View style={styles.menuWrap}>
      <Text style={[styles.sectionLabel, { color: palette.tertiaryText }]}>
        MENU
      </Text>
      {orderingMenuBody !== null ? orderingMenuBody : (
        <PublicMenuSections
          groups={menu}
          palette={palette}
          surface={surface}
          theme={resolvedTheme}
        />
      )}
    </View>
  );

  // #1558 — which booking body the Reservations tab mounts is DATA
  // (`profile.bookingBody`), resolved through a total record. #1559 turns the
  // body itself into the injected `bookingBody` slot, because the fork is a
  // PAYMENT RAIL (Stripe.js Payment Element on web vs the native PaymentSheet),
  // not a UX fork. Every state AROUND the body stays here: those are pixels.
  const themedSlotContext: PublicVenueThemedContext = {
    palette,
    surface,
    theme: resolvedTheme,
  };
  // #1560 — the modal-rail escape hatch + the one reserve verb, threaded into
  // every booking context.
  const bookingSlotBase = {
    ...themedSlotContext,
    openReservationSheet: handleOpenReservationSheetFromBody,
    reserveAction: profile.reserveAction,
  };
  const reservationBodies: Record<VenueBookingBody, () => BrandRenderingReactNode> = {
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
        {bookingBody({
          ...bookingSlotBase,
          kind: "stay",
          venueId: venue.id,
          brandId: venue.brandId,
          stayDetail,
          stayState: stayState ?? "unavailable",
        })}
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
        bookingBody({
          ...bookingSlotBase,
          kind: "table",
          venueId: reservable.venueId,
          brandId: venue.brandId,
          currency: reservable.currency,
        })
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

  const reserveBarClearance = showReserveCta && !isDesktop
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
          onPress={onOpenBrand}
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
          onPress={onShare}
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

  // ── #1561 the gallery becomes the hero ────────────────────────────────────
  //
  // `ParallaxCoverShell` treats hero index 0 as the COVER and `galleryImages`
  // as indices 1..N, so the operator's cover stays first and their photographs
  // follow in their own stored order — which is exactly the order
  // `buildVenueGalleryPhotoUrls` already returns now that its early return is
  // gone. Duplicates were collapsed by that builder, so the cover never appears
  // twice; the filter below is belt-and-braces against an untrimmed cover URL.
  //
  // A venue with NO operator cover but WITH pool photographs promotes its first
  // photograph to the hero rather than showing a placeholder over a page that
  // has pictures. A venue with neither keeps the striped placeholder — but
  // labelled with what it IS, never the word `COVER` (see below).
  const heroCover = useMemo<{
    url: string | null;
    type: "image" | "video" | "gif" | null;
    additional: OfferingGalleryImage[];
  }>(() => {
    const photos = venue.galleryPhotoUrls.filter(
      (url) => typeof url === "string" && url.trim().length > 0,
    );
    const cover =
      venue.coverMediaUrl !== null && venue.coverMediaUrl.trim().length > 0
        ? venue.coverMediaUrl.trim()
        : null;
    if (cover !== null) {
      return {
        url: venue.coverMediaUrl,
        type: venue.coverMediaType,
        additional: photos
          .filter((url) => url.trim() !== cover)
          .map((url) => ({ url, type: "image" as const })),
      };
    }
    if (photos.length > 0) {
      return {
        url: photos[0],
        // No operator cover ⇒ this is a place-pool PHOTOGRAPH, never a video.
        type: "image",
        additional: photos
          .slice(1)
          .map((url) => ({ url, type: "image" as const })),
      };
    }
    return { url: null, type: null, additional: [] };
  }, [venue.coverMediaType, venue.coverMediaUrl, venue.galleryPhotoUrls]);

  // #1550 R9 — the hero stops eating the page. No ratio was passed before, so
  // the shell's 4/5 portrait default held from 0-1023px: 57.8% of an iPhone
  // and **86.9%** of an 820pt tablet, both measured on live production.
  const heroAspectRatio = venueHeroAspectRatio(viewportWidth);

  const bodyContent = (
    <View style={styles.body}>
      {/* #1561 — the identity + answer block now renders at EVERY width. On
          desktop it replaces the hero caption (which printed the name a second
          time over the photograph); the name is now printed once, at the top of
          the reading column, where the answer bar can sit directly under it. */}
      {identityBlock}
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
            onAnalytics("public_venue_overview_viewed", {
              brand_id: venue.brandId,
              venue_id: venue.id,
            });
          } else if (tab === "menu") {
            onAnalytics("public_venue_menu_viewed", {
              brand_id: venue.brandId,
              venue_id: venue.id,
            });
          }
        }}
      />
    </View>
  );

  return (
    // #1595 [venue-host-palette] — the host wears `palette.page` through the
    // canonical `offeringSurfaceStyles` helper, not a hex. `styles.host` used to
    // hardcode `#0c0e12`, which the #1550 SPEC named for cleanup by line and
    // which the theming step (#1564) then moved here unchanged. It is the LAST
    // raw page colour in this file.
    //
    // WHY THIS IS NOT COSMETIC. `createThemePalette` resolves a NEAR-WHITE page
    // whenever the brand's accent is too dark to clear 3:1 on black — a deep
    // navy or charcoal, which is an ordinary choice for a hotel. On such a venue
    // the themed page floated inside a near-black frame that nobody chose. The
    // trigger is a DARK brand colour, not a light one, which is why "no brand
    // uses a light palette today" was never the right test.
    //
    // `surface.page` is the same `{ backgroundColor: palette.page }` every other
    // themed surface in the offering system reads (ORCH-1138 A2: "every
    // primitive reads from ONE resolved palette and never a raw hex").
    <View style={[styles.host, surface.page]}>
      {headSlot}
      <ParallaxCoverShell
        palette={palette}
        theme={resolvedTheme}
        coverMediaUrl={heroCover.url}
        coverMediaType={heroCover.type}
        coverHue={hashHueFromString(venue.slug)}
        entranceAnimationKey={`venue:${venue.brandSlug}:${venue.slug}:${resolvedTheme.color}`}
        muted={muted}
        onToggleMute={() => setMuted((v: boolean) => !v)}
        showMute={heroCover.type === "video"}
        onClose={onClose}
        onShare={onShare}
        hideCloseOnWeb
        directionCIdentity={useDirectionCIdentity ? {
          title: venue.name,
          meta: [profile.noun, venue.city].filter(Boolean).join(" · "),
        } : undefined}
        // #1561 — the venue's actual photographs, as the shell's first-class
        // cover pager. Empty ⇒ single cover, byte-identical to the old mount.
        galleryImages={heroCover.additional}
        coverAspectRatio={heroAspectRatio}
        // #1561 — a coverless PUBLIC page printed the literal word `COVER` at
        // full hero size (#1550 Leg C, plate P12). It now reads as what the
        // place is: "Hotel · Lagos".
        coverPlaceholderLabel={venueCoverPlaceholderLabel(profile, venue)}
        // #1561 — no hero caption: `heroEyebrow`/`heroTitle` printed
        // "VERIFIED VENUE" and the venue name OVER the photograph on desktop,
        // which is the second of the two places the name appeared and the only
        // place the redundant badge did. Both now live in `identityBlock`.
        stickyPanel={stickyPanel}
        safeAreaTop={insets.top + 8}
        contentBottomInset={reserveBarClearance}
        testID="orch-1255-public-venue"
      >
        {bodyContent}
      </ParallaxCoverShell>
      {reserveBar}
      {reservationSheet({
        ...themedSlotContext,
        visible: normalizedReservationUiState.reservationSheetOpen,
        onClose: handleReservationSheetClose,
        onDismissed: handleReservationSheetDismissed,
        // #1532 defect 1 / #1558 — the heading comes from the SAME profile
        // field as the CTA above, so a Stay guest can no longer tap "Reserve
        // this Stay" and land on a sheet headed "Reserve a table".
        title: profile.reserveAction,
        children: reservationsBlock,
      })}
      {overlays}
    </View>
  );
};

const styles = StyleSheet.create({
  // #1595 — NO `backgroundColor` here. The host's colour is themed and is
  // supplied at the call site from `surface.page`. A constant reinstated here
  // would win on any render where the palette resolves light, which is the
  // exact defect this removed.
  host: {
    flex: 1,
  },
  body: {
    gap: 20,
  },
  tabPane: {
    gap: 20,
  },
  // ---- identity + the answer bar (§6.2, rebuilt by #1561) ----
  identityWrap: {
    marginBottom: 4,
  },
  // I-AXIS-SCOPED-FLEX: `chipRow` is the ONLY flexDirection:"row" context these
  // three objects are used in. `chip` is a row CHILD (it never sets a direction
  // of its own); `chipText` is a leaf. No object below is shared across two
  // axes, so none can be released by an axis change somewhere else.
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: "70%",
  },
  chipText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  venueName: {
    fontSize: 30,
    lineHeight: 33,
    fontWeight: "900",
    letterSpacing: -0.5,
    marginTop: 6,
  },
  // I-AXIS-SCOPED-FLEX: `answerBar` is a row; `answerCell` is only ever its
  // child, so its `flex: 1` is scoped to that one direction. The cell's own
  // three lines stack on the default column axis and carry no flex key at all.
  answerBar: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 8,
    marginTop: 4,
  },
  answerCell: {
    flex: 1,
    minWidth: 0,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  answerLabel: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  answerValue: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
    marginTop: 2,
  },
  answerNote: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
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
  // #1562 — the open-now line at the head of the week table. Heavier than the
  // rows beneath it because it is the answer; the table is the evidence.
  hoursStateLine: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700",
    marginBottom: 6,
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
  // ---- menu (§6.6) ----
  // #1561 deleted `galleryWrap` / `galleryContent` / `galleryTile` with the
  // bottom photo strip they sized. `galleryTile`'s literal `width: 240,
  // height: 180` is the "240x180 at every width" Leg C measured.
  menuWrap: {
    gap: 0,
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
  // ---- desktop panel (§6.10) ----
  // #1561 deleted `heroEyebrow` / `heroTitle` / `heroAddr`: the desktop hero no
  // longer carries a caption, so the venue name is printed once, in the reading
  // column, instead of once over the photograph and once in the panel.
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

export default PublicVenueScreen;
