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
  AccessibilityInfo,
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  ParallaxCoverShell,
  buildStaticMapUrl,
  StaticMapImage,
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
// issue #4420 — the shared glass bottom bar (no expo-blur).
import { OfferingGlassBar } from "@mingla/offering-rendering/OfferingGlassBar";
import {
  OFFERING_PREMIUM_HEADER_ROW,
} from "@mingla/offering-rendering/offeringFrameMetrics";
import {
  OfferingFactRows,
  type OfferingFact,
} from "@mingla/offering-rendering/OfferingFactRows";

import { PublicMenuSections } from "./PublicMenuSections";
import {
  VenueSpecialDays,
  VenueWaysToCome,
  VenueWhatsOnCard,
  VenueWhatsOnPane,
} from "./VenueFeatureSections";
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
  PublicVenueTabPill,
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
  deriveVenuePage,
  venueTypeLeadsWithTables,
  groupVenueHours,
  venueHoursDaysFromEntries,
  venueHoursText,
  venueLocalDay,
  venueLeadBarAllowedOn,
  venueMenuOrderBarOn,
  venueOpenStateRows,
  venuePageVerbs,
  venueSpecialDayRows,
  type PublicVenueFeaturesView,
  type VenueHoursDay,
  type VenuePageModel,
  type VenueSpecialDayRow,
  type VenueFeatureOfferView,
  type VenueFeaturePlanView,
  type VenueTablesGate,
} from "./venueFeaturePage";
import {
  buildVenueAnswerBar,
  venueAddressLines,
  venueCategoryChip,
  venueCoverPlaceholderLabel,
  venueFacts,
  venueHeroAspectRatio,
  venuePlaceChip,
  type VenueFactAction,
} from "./venueFirstScreen";
import {
  resolveVenueOpenState,
  venueOpenStateLine,
  VENUE_WEEKDAY_LABELS,
  type VenueOpenState,
} from "./venueOpenState";
import {
  resolveVenueStayRate,
  venueStayRateQualifier,
  venueStayRateRangeLine,
  venueStayRateValue,
  type VenueStayQuoteView,
  type VenueStayRate,
} from "./venueStayRate";
import {
  createPublicVenueReservationUiState,
  normalizePublicVenueReservationUiState,
  publicVenueReservationUiReducer,
} from "./publicVenueReservationUiState";
import { semantic } from "../offering-rendering/designTokens";
import { PublicVenueRetryAction } from "./publicVenueRefreshState";
import { accentFill, themeBoldFace } from "@mingla/offering-rendering/themeAccentStyle";
import { neutralControl } from "@mingla/offering-rendering/themePalette";
import { boldFontFamily } from "@mingla/offering-rendering/themePalette";

type WebVenueViewStyle = Omit<ViewStyle, "position"> & {
  position?: ViewStyle["position"] | "sticky";
};
const webVenueStyle = (style: WebVenueViewStyle): StyleProp<ViewStyle> =>
  style as StyleProp<ViewStyle>;

interface WebRetryAriaHost {
  removeAttribute: (name: string) => void;
  setAttribute: (name: string, value: string) => void;
}

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
  /**
   * #4334 — the venue's Google place id (`venue_public_view.google_place_id`).
   * Optional: the Google Maps link carries it as `query_place_id`.
   */
  googlePlaceId?: string | null;
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

export type PublicVenueReservabilityState =
  | "loading"
  | "ready"
  | "error"
  | "invalid";
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
/**
 * issue #4420 wave 2 (D-V3) — the live reserve bar on the Reservations tab.
 * The inline booking body reports what the guest has picked so far and the
 * one next step ("Continue", then "Confirm & pay"); the page draws it in the
 * same glass bar (phone) or flyer dock (desktop) as Reserve elsewhere.
 */
export interface PublicVenueReservationBar {
  /** The picked slot (day and time), the amount due today, or the day when nothing is open. */
  title: string;
  /** "4 guests · Date night", "Deposit · …", "No tables this day". */
  subtitle: string | null;
  ctaLabel: string;
  /** false greys the button out (no time picked, details missing, in flight). */
  enabled: boolean;
  onPress: () => void;
}

export type PublicVenueBookingSlotContext = PublicVenueThemedContext & {
  /**
   * issue #4420 wave 2 (D-V3) — set only on the Reservations tab's inline
   * body (never the sheet copy): report the live bar, or null to hand the
   * bar back. A body that never calls it keeps its own in-body button.
   */
  onReservationBarChange?: (bar: PublicVenueReservationBar | null) => void;
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

/**
 * #4347 wave 4 — a native host's OWN pinned action bar (the consumer app's
 * Explorer bar: Save · Schedule · Share · Reserve-or-Directions). When a host
 * bar renders, it replaces this page's own pinned reserve bar (the phone bar),
 * so a guest never sees two reserve bars. The desktop sticky panel is not
 * touched: no host passes a bar at desktop width (the consumer route is
 * phone-only). `canReserve` follows the same display rule as the shared bar,
 * so it is false on the Reservations tab, whose pane carries its own reserve
 * button. The sheet keeps ONE owner: `openReservation` goes through the same
 * reducer and the same fail-closed gate as the shared CTA. Buyer web passes
 * nothing and renders exactly as before.
 */
export interface PublicVenueActionBarContext extends PublicVenueThemedContext {
  /**
   * The shared reserve DISPLAY rule: the fail-closed gate (`RESERVATION_READY`
   * for this category) AND not on the Reservations tab, exactly as the page's
   * own reserve bar.
   */
  canReserve: boolean;
  /** Which booking rail this category uses ("table" or "stay"). */
  bookingKind: VenueBookingBody;
  /** The page's one reserve verb (the lead's label, else the category's). */
  reserveAction: string;
  /**
   * #4490 — the bar's button label and the tab it opens, from the venue's
   * features. `reserveAction` stays for the table/stay rails.
   */
  ctaLabel: string | null;
  ctaTab: PublicVenueTab | null;
  /** Raises the reservation sheet through the page's own reducer. */
  openReservation: () => void;
}

/** #4490 P2 — what the Entry tab's flow needs from the page. */
export interface PublicVenueEntrySlotContext extends PublicVenueThemedContext {
  /** The venue's live entry offers, in the page's order. */
  offers: readonly VenueFeatureOfferView[];
  currencyCode: string;
  exponent: number;
  /** The lead's verb ("Buy entry", "Buy a day pass", "Book a visit"). */
  verb: string;
  /** Report the live bar on this tab (or null to hand it back). */
  onBookingBarChange: (bar: PublicVenueReservationBar | null) => void;
}

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
  /**
   * issue #4420 D-V2 — the basket bar docks at the bottom of the screen like
   * every offering page's glass bar. These let the slot place it (desktop
   * docks in the flyer column; the safe area clears the home bar) and tell
   * the screen it owns that edge, so the reserve bar steps aside on the Menu
   * tab instead of two bars stacking. Optional for hosts that keep the bar
   * in the pane (Explorer, whose venue page has its own bottom bar).
   */
  isDesktop?: boolean;
  bottomInset?: number;
  onBottomBarChange?: (owned: boolean) => void;
  /**
   * #4490 W3 fix 5 (W3-N37) — a host whose menu pane sits inside the page's
   * scroll view (Explorer) cannot pin a bar itself: it reports the order bar
   * here (null when there is none) and the screen docks it at the bottom edge
   * on the Menu tab, where the venue's other bars sit. Buyer web docks its
   * own bar and never calls this.
   */
  onOrderBarChange?: (bar: PublicVenueReservationBar | null) => void;
}

export interface PublicVenueOrderingSlots {
  /**
   * The ONE ordering slot. When supplied for a populated menu it is TOTAL:
   * after its host-owned lazy boundary resolves, it always returns either the
   * orderable menu or the same display-only menu. A resolved child returning
   * null cannot hand control back across Suspense — React would remove the
   * fallback and leave the shared MENU heading above an empty body (#2735).
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
  ) => BrandRenderingReactElement;
}

/** The three events this page emits. The host adds its own surface tag. */
export type PublicVenueAnalyticsEvent =
  | "public_venue_overview_viewed"
  | "public_venue_menu_viewed"
  | "public_venue_reservation_started";

export type PublicVenueMenuRequestState = "loading" | "ready" | "error";

export interface PublicVenueMenuLifecycle {
  state: PublicVenueMenuRequestState;
  isFetching: boolean;
  onRetry: () => void | Promise<unknown>;
}

/** #2755 — total six-state reduction, exported so state truth is regression-testable. */
export function resolvePublicVenueMenuPresentation(
  state: PublicVenueMenuRequestState,
  isFetching: boolean,
  itemCount: number,
  categoryHasMenu: boolean,
): {
  hasMenu: boolean;
  hasStaleItems: boolean;
  showState: boolean;
  copy: string;
} {
  const hasStaleItems = itemCount > 0;
  return {
    hasMenu: categoryHasMenu && (state !== "ready" || hasStaleItems),
    hasStaleItems,
    showState: state !== "ready" || isFetching,
    copy: hasStaleItems
      ? state === "error"
        ? "Menu may be out of date."
        : "Updating menu…"
      : state === "error"
        ? "Menu couldn’t load"
        : "Loading menu…",
  };
}

export interface PublicVenueScreenProps {
  venue: PublicVenueViewModel;
  /** Business public-web #1615 identity overlay; absent preserves consumer/native hosts. */
  useDirectionCIdentity?: boolean;
  discoveryPrice: PublicVenueDiscoveryPriceView | null;
  /** ORCH-1186-C shared shape — the BRAND's menu ([TRANSITIONAL-3]). */
  menu: PublicMenuGroup[];
  /** #2755 — required transport truth; an empty array cannot impersonate failure. */
  menuLifecycle: PublicVenueMenuLifecycle;
  /** Anon display gate; not-reservable / unknown → NO reserve bar. */
  reservable: PublicVenueReservableView | null;
  reservabilityState?: PublicVenueReservabilityState;
  initialTab?: PublicVenueTab;
  onRetryReservability?: () => void;
  /** #2756 — populated query lifecycle; only `error` has visible chrome. */
  refreshState?: "ready" | "refreshing" | "error";
  /** Changes only when React Query records a distinct failed refresh. */
  refreshErrorVersion?: number;
  onRetryRefresh?: () => void | Promise<unknown>;
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
   * #4111 D6 — "Message {Brand}" beside the "By {brand}" line (and beside
   * Share on desktop), opening the host's message sheet with this venue
   * picked. Absent (enquiries off / not loaded) ⇒ nothing renders.
   */
  onMessageBrand?: () => void;
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
  /**
   * #4347 wave 4 — a host-only block in the Overview pane, drawn after the
   * About section (or first, when a category has none), in the page's palette.
   * The consumer app puts "When you'd go" and "Experiences here" here. Absent
   * (buyer web) ⇒ the Overview pane is exactly as before.
   */
  overviewSlot?: (context: PublicVenueThemedContext) => BrandRenderingReactNode;
  /**
   * [TRANSITIONAL] blocked on #4514 — a venue-level custom-form section.
   * No host passes it until the shared renderer lands, so it draws no UI now.
   */
  formSection?: (context: PublicVenueThemedContext) => BrandRenderingReactNode;
  /**
   * #4347 wave 4 — a host-owned pinned action bar that REPLACES the page's own
   * reserve bar (see `PublicVenueActionBarContext`). Absent ⇒ unchanged.
   */
  actionBar?: (context: PublicVenueActionBarContext) => BrandRenderingReactNode;
  /** The host bar's height above the safe area, so the scroll clears it. */
  actionBarHeight?: number;
  /**
   * #4490 — what the venue sells, from `pg_public_venue_page`. Null/absent =
   * today's page (category-decided tabs and button), so a failed read never
   * makes the page worse. The page's tabs, lead info row and booking bar are
   * derived from this and from nothing else.
   */
  features?: PublicVenueFeaturesView | null;
  /** Opens an event's public page (`/e/…`). Absent = event rows are plain text. */
  onOpenEvent?: (href: string) => void;
  /**
   * #4490 P2 — the Entry tab's flow (pick a day, the guests, see the total,
   * go to checkout). Host-injected because it talks to the network. Absent =
   * the Entry tab says entry is not on sale online (never a blank tab).
   */
  entryBody?: (context: PublicVenueEntrySlotContext) => BrandRenderingReactNode;
  /**
   * #4490 P3 — the Groups tab's flow (pick a package, a day and start time,
   * the group size, extras and how to pay). Host-injected like `entryBody`;
   * absent = the tab says group bookings are not taken online.
   */
  groupsBody?: (context: PublicVenueEntrySlotContext) => BrandRenderingReactNode;
  /**
   * #4490 P4 — the Private hire tab's flow (group size, day, session, space,
   * then the request). Host-injected like `entryBody`; absent = the tab says
   * private hire is booked with the venue directly.
   */
  hireBody?: (context: PublicVenueEntrySlotContext) => BrandRenderingReactNode;
  /**
   * #4490 P5 — the By the hour tab's flow (place, day, start, length, then
   * checkout). Host-injected like `entryBody`; absent = a plain line.
   */
  hourBody?: (context: PublicVenueEntrySlotContext) => BrandRenderingReactNode;
  /**
   * #4490 P6 — the Plans tab (monthly plans with price and what's included,
   * then Join). Host-injected like `entryBody`; absent = a plain line.
   */
  plansBody?: (context: PublicVenueEntrySlotContext & { plans: readonly VenueFeaturePlanView[] }) => BrandRenderingReactNode;
  /**
   * #4490 — a Host preview of a venue that is not public yet: every tab the
   * venue will have, with the booking button and event buttons disabled.
   */
  preview?: { note: string } | null;
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
  /** #4490 — what the venue sells; the legacy model on today's page. */
  page: VenuePageModel;
  /** #4490 — the week's hours, several windows a day. */
  hoursDays: VenueHoursDay[];
  /** #4490 — upcoming special days (closed, or their own windows). */
  specialDays: VenueSpecialDayRow[];
  selectTab: (tab: PublicVenueTab) => void;
  onOpenEvent: ((href: string) => void) | undefined;
  previewing: boolean;
  boldFont: { fontFamily: string; fontWeight?: "normal" };
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
        style={[styles.aboutBodyThemed, themedFont, { color: palette.secondaryText }]}
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
    <Text style={[styles.aboutBodyThemed, themedFont, { color: palette.secondaryText }]}>
      Typical spend · {formatSourceRange({
        minMinor: discoveryPrice.minMinor,
        maxMinor: discoveryPrice.maxMinor,
        currencyCode: discoveryPrice.currencyCode,
        exponent: discoveryPrice.minorUnitExponent,
        // W3 fix 4 (W3-N31): ₦ like the rest of the page, no stray code.
        display: "venue",
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
        style={[styles.aboutBodyThemed, themedFont, { color: palette.secondaryText }]}
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
      <StaticMapImage
        uri={staticMapUrl}
        style={[
          styles.mapCard,
          styles.mapImage,
          isDesktop && styles.mapImageDesktop,
          { backgroundColor: palette.card },
        ]}
        accessibilityLabel={`Map of ${venue.name}`}
        testID="venue-map"
      >
        <View style={[styles.mapPill, { backgroundColor: palette.page }]}>
          <Text
            numberOfLines={1}
            style={[styles.mapPillLabel, { color: palette.primaryText }]}
          >
            {venue.name}
          </Text>
        </View>
      </StaticMapImage>
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
        {/* #4490 N34: drawn as a button (the whole card opens maps), not a text link. */}
        <View style={[styles.addressCardButton, { borderColor: palette.panelBorder }]}>
          <Text style={[styles.addressCardHint, { color: palette.primaryText }]}>
            Open in maps
          </Text>
        </View>
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
  hoursDays,
  specialDays,
  themedFont,
  openState,
  palette,
  surface,
  todayWeekday: today,
}) => {
  const hours = hoursDays;
  if (hours.length === 0) return null;
  // #1562 — the same resolved state the answer bar and the desktop panel draw,
  // repeated at the head of the week so a guest who has scrolled to the table
  // is not made to work out for themselves whether "Fri 09:00–17:00" means the
  // doors are open at this moment. Null (unknown zone) renders nothing.
  const todayDay = hours.find((entry) => entry.weekday === today) ?? null;
  const stateLine = venueOpenStateLine(
    openState,
    todayDay === null
      ? null
      : {
          openTime: todayDay.windows[0]?.open ?? null,
          closeTime: todayDay.windows[0]?.close ?? null,
          isClosed: todayDay.isClosed,
        },
  );
  return (
    <View
      style={[styles.hoursCard, surface.card]}
      testID="issue-4420-venue-hours-card"
      nativeID="issue-4420-venue-hours-card"
    >
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
                style={[styles.todayBar, accentFill(palette)]}
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
                // #4490 — several windows a day wrap instead of pushing the
                // day label off the card. One window keeps today's exact style.
                ...(entry.windows.length > 1 ? [styles.hoursTimesWrap] : []),
              ]}
            >
              {venueHoursText(entry)}
            </Text>
          </View>
        );
      })}
      <VenueSpecialDays
        rows={specialDays}
        palette={palette}
        themedFont={themedFont}
      />
    </View>
  );
};

// ── #4490 Ways to come — what the venue sells, each row opening its tab ───
const VenueWaysToComeSection: VenueSectionRenderer = ({
  page,
  selectTab,
  palette,
  surface,
  themedFont,
  boldFont,
}) =>
  page.showWays ? (
    <VenueWaysToCome
      rows={page.ways}
      onSelectTab={selectTab}
      palette={palette}
      surface={surface}
      themedFont={themedFont}
      boldFont={boldFont}
    />
  ) : null;

// ── #4490 What's on — events held at the venue ────────────────────────────
const VenueWhatsOnSection: VenueSectionRenderer = ({
  page,
  venue,
  selectTab,
  onOpenEvent,
  previewing,
  palette,
  surface,
  themedFont,
  boldFont,
}) =>
  page.events.length === 0 || page.currency === null ? null : (
    <VenueWhatsOnCard
      events={page.events}
      timeZone={venue.timezone}
      currencyCode={page.currency.code}
      exponent={page.currency.exponent}
      onOpenEvent={onOpenEvent}
      disabled={previewing}
      onSeeAll={page.tabs.includes("whats_on") ? () => selectTab("whats_on") : null}
      palette={palette}
      surface={surface}
      themedFont={themedFont}
      boldFont={boldFont}
    />
  );

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
  waysToCome: VenueWaysToComeSection,
  whatsOn: VenueWhatsOnSection,
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
  menuLifecycle,
  reservable,
  reservabilityState = "ready",
  initialTab = "overview",
  onRetryReservability,
  refreshState = "ready",
  refreshErrorVersion = 0,
  onRetryRefresh,
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
  onMessageBrand,
  onOpenMaps,
  onCopyAddress,
  overviewSlot,
  formSection,
  actionBar,
  actionBarHeight = 0,
  features = null,
  onOpenEvent,
  entryBody,
  groupsBody,
  hireBody,
  hourBody,
  plansBody,
  preview = null,
}: PublicVenueScreenProps): BrandRenderingReactElement => {
  const insets = safeAreaInsets;
  const { isDesktop, width: viewportWidth } = useResponsiveLayout();
  const [muted, setMuted] = useState<boolean>(true);
  // #1558 — the ONE category read on this page. Everything that used to branch
  // on `isStay` now reads a field of this profile, so `play`, `creative_and_arts`
  // and a NULL category stop inheriting the restaurant's page by accident.
  const profile = venueCategoryProfile(venue.venueCategory);
  const menuItemCount = menu.reduce((sum, group) => sum + group.items.length, 0);
  // #4490 — with a features payload the MENU FEATURE decides (a venue type no
  // longer does); without one it is today's category rule. Either way the tab
  // still needs real menu items (below).
  const featuresView = features ?? null;
  const previewing = preview !== null;
  const categoryHasMenu =
    featuresView === null
      ? venueMenuTabVisible(profile, 1)
      : featuresView.features.includes("menu");
  // #2755: an unconfirmed request is not an empty menu. Only a successful
  // empty response may remove the tab.
  const menuPresentation = resolvePublicVenueMenuPresentation(
    menuLifecycle.state,
    menuLifecycle.isFetching,
    menuItemCount,
    categoryHasMenu,
  );
  const hasMenu = menuPresentation.hasMenu;
  // #4490 — the table gate as the page model reads it: still checking (or the
  // check failed: the tab stays, with its retry state), reservable, or checked
  // and not reservable (no tab, no button).
  const tablesGate: VenueTablesGate =
    reservabilityState !== "ready"
      ? "pending"
      : reservable !== null &&
          reservable.reservable === true &&
          reservable.venueId !== null
        ? "ready"
        : "blocked";
  const page = useMemo<VenuePageModel>(
    () =>
      deriveVenuePage(featuresView, {
        menuTabVisible: hasMenu,
        tablesGate,
        preview: previewing,
        tablesFirst: venueTypeLeadsWithTables(venue.venueCategory),
      }),
    [featuresView, hasMenu, previewing, tablesGate, venue.venueCategory],
  );
  // Which booking body the Reservations tab mounts. Today it is the category's;
  // with features it is "stay" only for a venue whose one bookable tab is its
  // rooms, and "table" otherwise.
  const reservationsKind: VenueBookingBody = page.legacy
    ? profile.bookingBody
    : page.tabs.includes("rooms")
      ? "table"
      : page.has.stays
        ? "stay"
        : "table";
  const canOpenReservationSheet = previewing
    ? false
    : RESERVATION_READY[reservationsKind]({
        stayState,
        reservabilityState,
        reservable,
      }) &&
      (page.legacy || reservationsKind === "stay" || page.has.tables);
  const reservationUiContext = useMemo(
    () => ({
      hasMenu,
      canOpenReservationSheet,
      ...(page.legacy ? {} : { availableTabs: page.tabs }),
    }),
    [canOpenReservationSheet, hasMenu, page],
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
  const retryWebHostRef = React.useRef<React.ElementRef<typeof Pressable> | null>(
    null,
  );
  const retryInFlightRef = React.useRef<boolean>(false);
  const retryOwnsFocusRef = React.useRef<boolean>(false);
  const retryHadFocusRef = React.useRef<boolean>(false);
  const retryRequestedRef = React.useRef<boolean>(false);
  const retryStartedOnMenuRef = React.useRef<boolean>(false);
  const retryPresentationStateRef = React.useRef<PublicVenueMenuRequestState | null>(
    null,
  );
  const previousMenuStateRef = React.useRef<PublicVenueMenuRequestState | null>(
    null,
  );
  const previousMenuFetchingRef = React.useRef<boolean>(false);
  const [retryLocallyBusy, setRetryLocallyBusy] = useState<boolean>(false);
  const [retryFocusVisible, setRetryFocusVisible] = useState<boolean>(false);
  const [retryHovered, setRetryHovered] = useState<boolean>(false);
  const refreshRetryGuardRef = React.useRef<boolean>(false);
  const refreshRetryFocusedRef = React.useRef<boolean>(false);
  const [refreshRetryBusy, setRefreshRetryBusy] = useState<boolean>(false);
  const refreshNoticeVisible =
    refreshState === "error" || refreshRetryBusy;
  const previousRefreshNoticeVisibleRef = React.useRef<boolean>(false);

  const handleRetryRefresh = React.useCallback((): void => {
    if (refreshRetryGuardRef.current || onRetryRefresh === undefined) return;
    refreshRetryGuardRef.current = true;
    setRefreshRetryBusy(true);
    void Promise.resolve(onRetryRefresh()).finally(() => {
      refreshRetryGuardRef.current = false;
      setRefreshRetryBusy(false);
    });
  }, [onRetryRefresh]);

  React.useEffect(() => {
    if (
      previousRefreshNoticeVisibleRef.current &&
      !refreshNoticeVisible &&
      refreshRetryFocusedRef.current
    ) {
      publicVenueTabsRef.current?.focusTab(
        normalizedReservationUiState.activeTab,
      );
    }
    if (!refreshNoticeVisible) refreshRetryFocusedRef.current = false;
    previousRefreshNoticeVisibleRef.current = refreshNoticeVisible;
  }, [normalizedReservationUiState.activeTab, refreshNoticeVisible]);
  React.useEffect(() => {
    dispatchReservationUi({
      type: "INITIAL_TAB_CHANGED",
      tab: initialTab,
      context: reservationUiContext,
    });
    // Reservability changes normalize through ENVIRONMENT_CHANGED below; they
    // must not replay the route's initial tab over a user's current selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

  React.useEffect(() => {
    dispatchReservationUi({
      type: "ENVIRONMENT_CHANGED",
      context: reservationUiContext,
    });
  }, [reservationUiContext]);

  // #2755 — one announcement owner. The visible state container is NOT also
  // a live region, so first failure, repeat failure, and recovery each speak
  // exactly once while passive rerenders speak nothing.
  React.useEffect(() => {
    const stateChanged = previousMenuStateRef.current !== menuLifecycle.state;
    const fetchingChanged =
      previousMenuFetchingRef.current !== menuLifecycle.isFetching;
    if (stateChanged || fetchingChanged) {
      if (menuLifecycle.isFetching) {
        if (
          !retryRequestedRef.current &&
          menuLifecycle.state !== "error"
        ) {
          AccessibilityInfo.announceForAccessibility(menuPresentation.copy);
        }
      } else if (menuLifecycle.state === "error") {
        AccessibilityInfo.announceForAccessibility(menuPresentation.copy);
      } else if (retryRequestedRef.current) {
        AccessibilityInfo.announceForAccessibility("Menu loaded.");
        if (
          retryHadFocusRef.current &&
          retryStartedOnMenuRef.current &&
          (normalizedReservationUiState.activeTab === "menu" || !hasMenu)
        ) {
          publicVenueTabsRef.current?.focusTab(hasMenu ? "menu" : "overview");
        }
      }
    }
    if (!menuLifecycle.isFetching) {
      retryRequestedRef.current = false;
      retryHadFocusRef.current = false;
      retryStartedOnMenuRef.current = false;
      retryPresentationStateRef.current = null;
      retryInFlightRef.current = false;
      setRetryLocallyBusy(false);
    }
    previousMenuStateRef.current = menuLifecycle.state;
    previousMenuFetchingRef.current = menuLifecycle.isFetching;
  }, [
    hasMenu,
    menuLifecycle.isFetching,
    menuLifecycle.state,
    menuPresentation.copy,
    normalizedReservationUiState.activeTab,
  ]);

  const handleRetryMenu = React.useCallback((): void => {
    if (retryInFlightRef.current || menuLifecycle.isFetching) return;
    retryInFlightRef.current = true;
    retryRequestedRef.current = true;
    retryHadFocusRef.current = retryOwnsFocusRef.current;
    retryStartedOnMenuRef.current =
      normalizedReservationUiState.activeTab === "menu";
    retryPresentationStateRef.current = menuLifecycle.state;
    setRetryLocallyBusy(true);
    try {
      const result = menuLifecycle.onRetry();
      void Promise.resolve(result).finally(() => {
        retryInFlightRef.current = false;
        setRetryLocallyBusy(false);
      });
    } catch {
      retryInFlightRef.current = false;
      setRetryLocallyBusy(false);
    }
  }, [menuLifecycle, normalizedReservationUiState.activeTab]);

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
  // issue #1023 — the bold face for the venue name, answers and tab labels.
  loadThemeFont(boldFontFamily(resolvedTheme));
  // Memoised because it is threaded to every Overview section through
  // `sectionProps`; a fresh object each render would defeat that memo.
  const themedFont = useMemo(
    () => ({ fontFamily: resolvedTheme.fontFamilyValue }),
    [resolvedTheme.fontFamilyValue],
  );
  const themedBoldFont = themeBoldFace(resolvedTheme);

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
    const candidate: MapsOpenTarget = { label, geo, googlePlaceId: venue.googlePlaceId ?? null };
    return canOpenMapsTarget(candidate) ? candidate : null;
  }, [venue.address, venue.googlePlaceId, venue.lat, venue.lng, venue.name]);

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

  // #4347 wave 4 — the host action bar's Reserve. Same gate and reducer as
  // the body's request; only the analytics source differs.
  const handleOpenReservationFromActionBar = React.useCallback((): void => {
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
      source_tab: "host_action_bar",
    });
  }, [
    canOpenReservationSheet,
    normalizedReservationUiState.reservationSheetOpen,
    onAnalytics,
    reservationUiContext,
    venue.brandId,
    venue.id,
  ]);

  /**
   * #4490 — the bar's button and the lead row's action. On the table tab it is
   * today's Reserve exactly (tab plus sheet); on any other tab it selects the
   * tab with no sheet and brings the tab strip into view. A preview does
   * nothing (its button is disabled).
   */
  const handlePrimaryCta = React.useCallback((): void => {
    if (previewing) return;
    if (page.legacy || page.lead === null || page.lead.tab === "reservations") {
      handleReserve();
      return;
    }
    const tab = page.lead.tab;
    if (normalizedReservationUiState.activeTab === tab) return;
    dispatchReservationUi({
      type: "PRIMARY_CTA_PRESSED",
      tab,
      context: reservationUiContext,
    });
    if (Platform.OS === "web" && typeof document !== "undefined") {
      requestAnimationFrame(() => {
        document
          .querySelector('[data-testid="issue-4420-venue-tab-pill"]')
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [
    handleReserve,
    normalizedReservationUiState.activeTab,
    page,
    previewing,
    reservationUiContext,
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
  const [orderingOwnsBar, setOrderingOwnsBar] = useState<boolean>(false);
  // #4490 W3 fix 5 (W3-N37) — the order bar a host reported (Explorer).
  const [menuOrderBar, setMenuOrderBar] =
    useState<PublicVenueReservationBar | null>(null);
  // #4420 D-V3 — the inline booking body's live bar (Reservations tab only).
  // #4490 N29: each tab's bar is tagged with the tab that reported it, so a
  // tab never shows the bar another tab left behind ("Buy entry" on Groups).
  const [liveBar, setLiveBar] = useState<{
    tab: string;
    bar: PublicVenueReservationBar;
  } | null>(null);
  const barReporters = React.useMemo(() => {
    const make =
      (tab: string) =>
      (bar: PublicVenueReservationBar | null): void =>
        setLiveBar((prev) =>
          bar === null ? (prev !== null && prev.tab === tab ? null : prev) : { tab, bar },
        );
    return {
      inline: make("inline"),
      entry: make("entry"),
      groups: make("groups"),
      hire: make("hire"),
      by_the_hour: make("by_the_hour"),
      plans: make("plans"),
    };
  }, []);
  const orderingSlotContext: PublicVenueOrderingSlotContext = {
    palette,
    surface,
    theme: resolvedTheme,
    menu,
    isDesktop,
    bottomInset: insets.bottom,
    onBottomBarChange: setOrderingOwnsBar,
    onOrderBarChange: setMenuOrderBar,
  };
  const orderingMenuBody = ordering?.menuBody?.(orderingSlotContext) ?? null;

  // ── §6.7 reserve display gate — fail closed. ─────────────────────────────
  // #4490 — the bar sells the page's LEAD (what the venue's features sell) and
  // opens the lead's tab. On today's page the lead is the table/stay rail.
  const lead = page.legacy ? null : page.lead;
  const leadTab: PublicVenueTab | null = page.legacy
    ? "reservations"
    : lead === null
      ? null
      : lead.tab;
  const leadActionable = page.legacy
    ? canOpenReservationSheet
    : lead !== null &&
      (previewing ||
        (lead.tab === "reservations" || lead.tab === "rooms"
          ? canOpenReservationSheet
          : true));
  // W3 fix 4 (W3-N36): no docked bar is drawn over an open sheet. The order
  // sheet's case is the ordering slot owning the Menu tab's edge (below).
  const showReserveCta =
    leadActionable &&
    leadTab !== null &&
    normalizedReservationUiState.activeTab !== leadTab &&
    !normalizedReservationUiState.reservationSheetOpen;
  // Today the category names the one verb. With features the lead names it, and
  // when there is no lead (nothing to sell, so no sheet will ever open) the
  // flow's own name: a venue's type never leaks into a button it does not have.
  // W3 fix 3 (W3-N22): the lead's verb for the docked bar, and the table /
  // stay rail's OWN action for the Tables tab's button, its sheet title and
  // the host bar's reserve words (one owner: venuePageVerbs). A venue that
  // leads with entry said "Buy entry" on a button that opened "Reserve a table".
  const pageVerbs = venuePageVerbs(page, {
    reservationsKind,
    legacyReserveAction: profile.reserveAction,
  });
  const reserveVerb = pageVerbs.lead;
  const railVerb = pageVerbs.rail;
  // #2331 — the buyer-web privacy bar no longer competes for this edge: the
  // app root ends above it (I-PRIVACY-BAR-NEVER-OCCLUDES), so the reserve bar
  // always shows.
  // #4420 D-V2 — on the Menu tab an open ordering basket owns the bottom edge.
  // #4490 fix 2 (N87): on another booking tab (By the hour, Groups, Hire,
  // Plans, Entry) the bar speaks for that tab only; until its pane has a
  // choice to show, the lead's words ("Buy a day pass") are not borrowed.
  // W3 fix 3 (W3-N22): the bar follows the ACTIVE tab: on a tab that sells
  // something of its own the lead's bar is not drawn over it (venueLeadBarAllowedOn);
  // that tab's live bar, when its body reports one, still shows.
  const activeIsOtherBookingTab = !venueLeadBarAllowedOn(
    page,
    normalizedReservationUiState.activeTab,
  );
  const showPersistentReserveCta =
    showReserveCta &&
    !activeIsOtherBookingTab &&
    !(orderingOwnsBar && normalizedReservationUiState.activeTab === "menu");
  // #4420 D-V3 — on the Reservations tab the bar stays, reading the guest's
  // live pick and walking Continue → Confirm & pay.
  // #4490 P2 — the Entry tab reports the same live bar.
  // #4490 W3 fix 5 (W3-N37) — on the Menu tab a reported order bar is the
  // tab's live bar ("1 item · ₦7,000 · View order"), docked like the others.
  const menuTabOrderBar = venueMenuOrderBarOn(
    normalizedReservationUiState.activeTab,
    menuOrderBar,
    normalizedReservationUiState.reservationSheetOpen,
  );
  const tabLiveBar =
    (normalizedReservationUiState.activeTab === "reservations" ||
      normalizedReservationUiState.activeTab === "rooms" ||
      normalizedReservationUiState.activeTab === "entry" ||
      normalizedReservationUiState.activeTab === "groups" ||
      normalizedReservationUiState.activeTab === "hire" ||
      // #4490 P5 — the By the hour tab too.
      normalizedReservationUiState.activeTab === "by_the_hour" ||
      // #4490 P6 — and the Plans tab (Join the cheapest open plan).
      normalizedReservationUiState.activeTab === "plans") &&
    !normalizedReservationUiState.reservationSheetOpen &&
    liveBar !== null &&
    (liveBar.tab === normalizedReservationUiState.activeTab ||
      (liveBar.tab === "inline" &&
        (normalizedReservationUiState.activeTab === "reservations" ||
          normalizedReservationUiState.activeTab === "rooms")))
      ? liveBar.bar
      : null;
  const reservationTabBar = menuTabOrderBar ?? tabLiveBar;
  const showReserveBar = showPersistentReserveCta || reservationTabBar !== null;

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
  // #4490 — several windows a day and special days come from the features
  // payload; without it (or with no weekly rows) it is the published row.
  const weeklyWindows =
    featuresView !== null && featuresView.hours.weekly.length > 0
      ? featuresView.hours.weekly
      : null;
  const hoursDays = useMemo<VenueHoursDay[]>(
    () =>
      weeklyWindows !== null
        ? groupVenueHours(weeklyWindows)
        : venueHoursDaysFromEntries(venue.hours),
    [weeklyWindows, venue.hours],
  );
  const specialDayRows = useMemo<VenueSpecialDayRow[]>(
    () =>
      featuresView === null
        ? []
        : venueSpecialDayRows(
            featuresView.hours.specialDays,
            venueLocalDay(new Date(nowTick), venue.timezone)?.date ?? null,
          ),
    [featuresView, nowTick, venue.timezone],
  );
  const openStateRows = useMemo(
    () =>
      weeklyWindows !== null && featuresView !== null
        ? venueOpenStateRows(
            weeklyWindows,
            featuresView.hours.specialDays,
            new Date(nowTick),
            venue.timezone,
          )
        : venue.hours,
    [weeklyWindows, featuresView, nowTick, venue.hours, venue.timezone],
  );
  const openState = useMemo<VenueOpenState>(
    () =>
      // A Stay does not trade hours; asking whether a hotel is "open" is the
      // category confusion #1558 removed. The resolver is still called with an
      // empty week so the venue's weekday is available to anything that wants
      // it, and it returns `unknown`, which claims nothing.
      resolveVenueOpenState({
        hours: venueShowsTradingHours(profile) ? openStateRows : [],
        timeZone: venue.timezone,
        now: new Date(nowTick),
      }),
    [profile, openStateRows, venue.timezone, nowTick],
  );
  const today = venueTodayWeekday(openState);
  const todayDay = hoursDays.find((d) => d.weekday === today) ?? null;
  const todayEntry: PublicVenueHourEntry | null =
    weeklyWindows === null
      ? venue.hours.find((h) => h.weekday === today) ?? null
      : todayDay === null
        ? null
        : {
            weekday: todayDay.weekday,
            openTime: todayDay.windows[0]?.open ?? null,
            closeTime: todayDay.windows[0]?.close ?? null,
            isClosed: todayDay.isClosed,
          };
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

  // #4420 D-V1 — the answer bar's cells, read as the shared fact rows (the
  // same component under every offering title). Each row has at most ONE
  // action: Hours (Overview's hours card), Map (the maps chooser), Reserve.
  const venueFactViews = venueFacts({
    cells: answerCells,
    profile: page.legacy
      ? profile
      : { timekeeping: profile.timekeeping, bookingBody: reservationsKind },
    place: venueAddressLines(venue),
    todayHoursLine:
      todayEntry === null
        ? null
        : weeklyWindows !== null && todayDay !== null
          ? `${VENUE_WEEKDAY_LABELS[todayDay.weekday] ?? ""} · ${venueHoursText(todayDay)}`
          : `${VENUE_WEEKDAY_LABELS[todayEntry.weekday] ?? ""} · ${hoursLineFor(todayEntry)}`,
    hasHoursCard: profile.overview.includes("hours") && hoursDays.length > 0,
    ...(page.legacy
      ? {}
      : {
          featureLead:
            page.lead === null
              ? null
              : {
                  row: page.lead.row,
                  tab: page.lead.tab,
                  keepPriceRow: page.lead.keepPriceRow,
                },
        }),
    hasMap: mapsTarget !== null,
    roomTypeCount:
      // Explorer's adapter may hand a detail before its offerings load.
      stayDetail === null || !Array.isArray(stayDetail.offerings)
        ? null
        : stayDetail.offerings.filter((o) => o.kind === "room").length,
  });
  const runFactAction = (action: VenueFactAction): void => {
    switch (action) {
      case "hours":
        publicVenueTabsRef.current?.selectTab("overview");
        if (Platform.OS === "web" && typeof document !== "undefined") {
          // The Overview pane mounts on the frame after the switch.
          requestAnimationFrame(() => {
            document
              .getElementById("issue-4420-venue-hours-card")
              ?.scrollIntoView({ behavior: "smooth", block: "center" });
          });
        }
        return;
      case "map":
        handleOpenMaps();
        return;
      case "reserve":
        handleReserve();
        return;
      case "lead":
        handlePrimaryCta();
        return;
      default: {
        const never: never = action;
        return never;
      }
    }
  };
  const venueFactRows: OfferingFact[] = venueFactViews.map((fact) => {
    // On the tab the lead row leads to, the guest is already there and the
    // handler is a no-op: no action rather than a dead tap. A preview shows the
    // row with no button (nothing can be bought yet).
    const isLeadAction = fact.action === "reserve" || fact.action === "lead";
    const action =
      isLeadAction &&
      (previewing ||
        (fact.actionTab ?? "reservations") ===
          normalizedReservationUiState.activeTab)
        ? null
        : fact.action;
    return {
      key: fact.key,
      icon: fact.icon,
      value: fact.value,
      detail: fact.detail,
      action:
        action === null
          ? null
          : {
              label:
                action === "hours"
                  ? "Hours"
                  : action === "map"
                    ? "Map"
                    : fact.actionLabel ?? "Reserve",
              accessibilityLabel:
                action === "reserve"
                  ? railVerb
                  : action === "lead"
                  ? reserveVerb
                  : action === "map"
                    ? `Open ${venue.name} in maps`
                    : `See ${venue.name}'s opening hours`,
              onPress: () => runFactAction(action),
            },
    };
  });

  // issue #4420 — the premium frame prints the category, the place and the
  // name on the cover (phone) and at the top of the right column (desktop),
  // so the body opens on the host row and the fact rows (D-V1).
  const brandInitial = venue.brandName.trim().charAt(0).toUpperCase();
  const identityBlock = (
    <View style={styles.identityWrap}>
      <View style={styles.hostRow} testID="issue-4420-venue-host-row">
        <View
          style={[styles.hostAvatar, { backgroundColor: palette.accentWash }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text style={[styles.hostAvatarText, themedBoldFont, { color: palette.primaryText }]}>
            {brandInitial}
          </Text>
        </View>
        <Pressable
          onPress={onOpenBrand}
          accessibilityRole="link"
          accessibilityLabel={`View ${venue.brandName} on Mingla`}
          style={[styles.byBrandRow, styles.byBrandShrink]}
        >
          <Text style={[styles.byBrandBy, { color: palette.secondaryText }]}>
            By{" "}
            <Text style={[styles.byBrandName, { color: palette.primaryText }]}>
              {venue.brandName}
            </Text>
          </Text>
        </Pressable>
        {/* #4111 — Message only when enquiries are on (unchanged logic). */}
        {onMessageBrand !== undefined ? (
          <Pressable
            onPress={onMessageBrand}
            accessibilityRole="button"
            accessibilityLabel={`Message ${venue.brandName}`}
            testID="issue-4111-venue-message"
            style={({ pressed }) => [
              styles.messageBrandBtn,
              { borderColor: neutralControl(palette) },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.messageBrandLabel, { color: palette.primaryText }]}>
              Message
            </Text>
          </Pressable>
        ) : null}
      </View>
      {venueFactRows.length > 0 ? (
        <OfferingFactRows
          facts={venueFactRows}
          palette={palette}
          theme={resolvedTheme}
          testID="issue-4420-venue-facts"
        />
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
      page,
      hoursDays,
      specialDays: specialDayRows,
      selectTab: (tab: PublicVenueTab) => {
        publicVenueTabsRef.current?.selectTab(tab);
      },
      onOpenEvent,
      previewing,
      boldFont: themedBoldFont,
    }),
    [
      discoveryPrice,
      handleOpenMaps,
      hoursDays,
      isDesktop,
      mapsActions,
      mapsTarget,
      onOpenEvent,
      openState,
      page,
      palette,
      previewing,
      profile,
      resolvedTheme,
      specialDayRows,
      stayDetail,
      stayRate,
      surface,
      themedBoldFont,
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
  const menuBusy = menuLifecycle.isFetching || retryLocallyBusy;
  // A manual retry is a busy version of the error the guest chose to retry,
  // not a new cold load. Freeze that presentation until the request settles so
  // the focused retry control and its explanation stay mounted in place.
  const retryPresentationState =
    retryRequestedRef.current &&
    (menuLifecycle.isFetching ||
      (retryLocallyBusy && menuLifecycle.state === "error"))
      ? retryPresentationStateRef.current
      : null;
  const visibleMenuState = retryPresentationState ?? menuLifecycle.state;
  const visibleMenuPresentation = resolvePublicVenueMenuPresentation(
    visibleMenuState,
    menuBusy,
    menuItemCount,
    categoryHasMenu,
  );
  React.useLayoutEffect(() => {
    const retryWebHost = retryWebHostRef.current as unknown as
      | WebRetryAriaHost
      | null;
    if (Platform.OS !== "web" || retryWebHost === null) {
      return;
    }
    // RN Web's Pressable writes aria-disabled from its native `disabled` prop
    // after spreading direct ARIA props. Reassert both busy semantics on the
    // committed host without setting HTML `disabled`, which would evict this
    // same control from keyboard focus during a retry.
    if (menuBusy) {
      retryWebHost.setAttribute("aria-disabled", "true");
      retryWebHost.setAttribute("aria-busy", "true");
      return;
    }
    retryWebHost.removeAttribute("aria-disabled");
    retryWebHost.removeAttribute("aria-busy");
  }, [menuBusy, visibleMenuState]);
  const menuHasStaleItems = visibleMenuPresentation.hasStaleItems;
  const showMenuState = visibleMenuPresentation.showState;
  const menuStateCopy = visibleMenuPresentation.copy;
  const menuBlock = !hasMenu ? null : (
    <View style={styles.menuWrap}>
      <Text
        accessibilityRole="header"
        style={[styles.sectionLabel, { color: palette.tertiaryText }]}
      >
        MENU
      </Text>
      {showMenuState ? (
        <View
          style={[
            menuHasStaleItems ? styles.menuStaleState : styles.menuColdState,
            { backgroundColor: palette.page, borderColor: palette.panelBorder },
          ]}
          testID={menuHasStaleItems ? "menu-stale-state" : "menu-cold-state"}
        >
          <View style={styles.menuStateCopy}>
            {visibleMenuState === "loading" || menuBusy ? (
              <ActivityIndicator
                accessible={false}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                color={palette.accent}
                size="small"
              />
            ) : null}
            <View style={styles.menuStateTextWrap}>
              <Text
                accessibilityRole={
                  !menuHasStaleItems && visibleMenuState === "error"
                    ? "header"
                    : undefined
                }
                style={[
                  !menuHasStaleItems && visibleMenuState === "error"
                    ? styles.menuColdErrorTitle
                    : menuHasStaleItems
                      ? styles.menuStaleText
                      : styles.menuColdLoadingText,
                  {
                    color:
                      !menuHasStaleItems && visibleMenuState === "error"
                        ? palette.primaryText
                        : palette.secondaryText,
                  },
                ]}
              >
                {menuStateCopy}
              </Text>
              {!menuHasStaleItems && visibleMenuState === "error" ? (
                <Text
                  style={[
                    styles.menuColdErrorBody,
                    { color: palette.secondaryText },
                  ]}
                >
                  Try again in a moment.
                </Text>
              ) : null}
            </View>
          </View>
          {visibleMenuState === "error" ? (
            <Pressable
              ref={Platform.OS === "web" ? retryWebHostRef : undefined}
              accessibilityRole="button"
              accessibilityLabel="Try loading the menu again"
              accessibilityState={{ disabled: menuBusy, busy: menuBusy }}
              aria-disabled={Platform.OS === "web" ? menuBusy : undefined}
              aria-busy={Platform.OS === "web" ? menuBusy : undefined}
              disabled={Platform.OS === "web" ? undefined : menuBusy}
              onFocus={(event) => {
                retryOwnsFocusRef.current = true;
                if (Platform.OS !== "web") {
                  setRetryFocusVisible(false);
                  return;
                }
                const target = event.currentTarget as unknown as {
                  matches?: (selector: string) => boolean;
                };
                setRetryFocusVisible(
                  target.matches?.(":focus-visible") === true,
                );
              }}
              onBlur={() => {
                retryOwnsFocusRef.current = false;
                setRetryFocusVisible(false);
              }}
              onHoverIn={() => setRetryHovered(true)}
              onHoverOut={() => setRetryHovered(false)}
              onPress={handleRetryMenu}
              style={({ pressed }) => [
                styles.menuRetry,
                accentFill(palette),
                retryHovered && !pressed && !menuBusy
                  ? styles.menuRetryHovered
                  : null,
                pressed && !menuBusy ? styles.menuRetryPressed : null,
                menuBusy ? styles.menuRetryDisabled : null,
                Platform.OS === "web" && retryFocusVisible
                  ? ({
                      outlineColor: palette.accent,
                      outlineOffset: -4,
                      outlineStyle: "solid",
                      outlineWidth: 3,
                    } as never)
                  : null,
              ]}
            >
              <Text
                style={[styles.menuRetryText, { color: palette.accentText }]}
              >
                Try again
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {menuHasStaleItems ? (
        <View key="menu-content">
          {orderingMenuBody !== null ? (
            orderingMenuBody
          ) : (
            <PublicMenuSections
              groups={menu}
              palette={palette}
              surface={surface}
              theme={resolvedTheme}
            />
          )}
        </View>
      ) : null}
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
    reserveAction: railVerb,
  };
  const reservationBodies: Record<
    VenueBookingBody,
    (inline: boolean) => BrandRenderingReactNode
  > = {
    stay: (inline: boolean) => (
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
          // W3 fix 3 (W3-N22): the stay body names its own flow (a Rooms tab
          // beside Tables reads "Reserve this Stay", never the table verb).
          reserveAction: pageVerbs.stay,
          ...(inline ? { onReservationBarChange: barReporters.inline } : {}),
          kind: "stay",
          venueId: venue.id,
          brandId: venue.brandId,
          stayDetail,
          stayState: stayState ?? "unavailable",
        })}
      </React.Suspense>
    ),
    table: (inline: boolean) =>
      reservabilityState === "loading" ? (
        <View style={styles.reservationState} accessibilityLiveRegion="polite">
          <Text style={[styles.aboutBody, { color: palette.secondaryText }]}>
            Finding open tables…
          </Text>
        </View>
      ) : reservabilityState === "error" || reservabilityState === "invalid" ? (
        <View style={styles.reservationState} accessibilityLiveRegion="polite">
          <Text style={[styles.aboutBody, { color: palette.secondaryText }]}>
            We couldn’t check reservations right now.
          </Text>
          <Pressable
            onPress={onRetryReservability}
            accessibilityRole="button"
            accessibilityLabel="Try checking reservations again"
            style={[styles.stateRetry, accentFill(palette)]}
          >
            <Text style={[styles.stateRetryText, { color: palette.accentText }]}>
              Try again
            </Text>
          </Pressable>
        </View>
      ) : reservable?.reservable === true && reservable.venueId !== null ? (
        bookingBody({
          ...bookingSlotBase,
          reserveAction: pageVerbs.table,
          ...(inline ? { onReservationBarChange: barReporters.inline } : {}),
          kind: "table",
          venueId: reservable.venueId,
          brandId: venue.brandId,
          currency: reservable.currency,
        })
      ) : (
        <View style={styles.reservationState} accessibilityLiveRegion="polite">
          <Text style={[styles.aboutBody, { color: palette.secondaryText }]}>
            {venueNotTakingReservationsCopy(profile)}
          </Text>
        </View>
      ),
  };
  // #4490 — a preview has no booking to show: say so instead of a body that
  // would try to read availability for a venue that is not public yet.
  const previewBookingNote = previewing ? (
    <View style={styles.reservationState} testID="issue-4490-preview-booking">
      <Text style={[styles.aboutBody, { color: palette.secondaryText }]}>
        Guests can&apos;t book from this preview. Booking opens when{" "}
        {venue.name} is live.
      </Text>
    </View>
  ) : null;
  const reservationsBlock = previewing
    ? previewBookingNote
    : reservationBodies[reservationsKind](true);
  // The sheet's copy never drives the page bar (it sits under the sheet).
  const reservationsSheetBlock = previewing
    ? null
    : reservationBodies[reservationsKind](false);
  const roomsBlock = page.tabs.includes("rooms")
    ? previewing
      ? previewBookingNote
      : reservationBodies.stay(true)
    : null;
  // #4490 P2 — the Entry tab: the host's flow, or (in a preview / without a
  // host flow) a plain line, never an empty pane.
  const entryOffers = (featuresView?.offers ?? []).filter((o) => o.kind === "entry");
  const entryBlock = page.tabs.includes("entry")
    ? previewing
      ? previewBookingNote
      : entryBody !== undefined && page.currency !== null
        ? entryBody({
            ...themedSlotContext,
            offers: entryOffers,
            currencyCode: page.currency.code,
            exponent: page.currency.exponent,
            // W3 fix 3 (W3-N27): the entry tab's own verb ("Buy a day pass"
            // for day passes) even when another feature leads the page.
            verb: page.tabVerbs.entry ?? "Buy entry",
            onBookingBarChange: barReporters.entry,
          })
        : (
            <View style={styles.reservationState} testID="issue-4490-entry-not-online">
              <Text style={[styles.aboutBody, { color: palette.secondaryText }]}>
                Entry isn&apos;t on sale online here yet. You can buy at the gate.
              </Text>
            </View>
          )
    : null;
  // #4490 P3 — the Groups tab ("Groups & parties"), same rules as Entry.
  const groupOffers = (featuresView?.offers ?? []).filter((o) => o.kind === "group_package");
  const groupsBlock = page.tabs.includes("groups")
    ? previewing
      ? previewBookingNote
      : groupsBody !== undefined && page.currency !== null
        ? groupsBody({
            ...themedSlotContext,
            offers: groupOffers,
            currencyCode: page.currency.code,
            exponent: page.currency.exponent,
            verb: page.tabVerbs.groups ?? "Book for a group",
            onBookingBarChange: barReporters.groups,
          })
        : (
            <View style={styles.reservationState} testID="issue-4490-groups-not-online">
              <Text style={[styles.aboutBody, { color: palette.secondaryText }]}>
                Group bookings aren&apos;t taken online here yet. Contact the venue to book.
              </Text>
            </View>
          )
    : null;
  // #4490 P4 — the Private hire tab, same rules as Entry.
  const hireOffers = (featuresView?.offers ?? []).filter((o) => o.kind === "private_hire");
  const hireBlock = page.tabs.includes("hire")
    ? previewing
      ? previewBookingNote
      : hireBody !== undefined && page.currency !== null
        ? hireBody({
            ...themedSlotContext,
            offers: hireOffers,
            currencyCode: page.currency.code,
            exponent: page.currency.exponent,
            verb: page.tabVerbs.hire ?? "Ask about a date",
            onBookingBarChange: barReporters.hire,
          })
        : (
            <View style={styles.reservationState} testID="issue-4490-hire-not-online">
              <Text style={[styles.aboutBody, { color: palette.secondaryText }]}>
                Private hire is booked with the venue directly. Message them to ask for a date.
              </Text>
            </View>
          )
    : null;
  // #4490 P5 — the By the hour tab, same rules as Entry.
  const hourOffers = (featuresView?.offers ?? []).filter((o) => o.kind === "by_the_hour");
  const hourBlock = page.tabs.includes("by_the_hour")
    ? previewing
      ? previewBookingNote
      : hourBody !== undefined && page.currency !== null
        ? hourBody({
            ...themedSlotContext,
            offers: hourOffers,
            currencyCode: page.currency.code,
            exponent: page.currency.exponent,
            verb: page.tabVerbs.by_the_hour ?? "Book",
            onBookingBarChange: barReporters.by_the_hour,
          })
        : (
            <View style={styles.reservationState} testID="issue-4490-hour-not-online">
              <Text style={[styles.aboutBody, { color: palette.secondaryText }]}>
                Booking by the hour isn&apos;t open online here yet. Contact the venue to book.
              </Text>
            </View>
          )
    : null;
  // #4490 P6 — the Plans tab, same rules as Entry.
  const plansBlock = page.tabs.includes("plans")
    ? previewing
      ? previewBookingNote
      : plansBody !== undefined && page.currency !== null
        ? plansBody({
            ...themedSlotContext,
            offers: [],
            plans: featuresView?.memberships?.plans ?? [],
            currencyCode: page.currency.code,
            exponent: page.currency.exponent,
            verb: page.tabVerbs.plans ?? "Join",
            onBookingBarChange: barReporters.plans,
          })
        : (
            <View style={styles.reservationState} testID="issue-4490-plans-not-online">
              <Text style={[styles.aboutBody, { color: palette.secondaryText }]}>
                Memberships aren&apos;t sold online here yet. Ask the venue how to join.
              </Text>
            </View>
          )
    : null;
  const whatsOnBlock =
    page.events.length > 0 && page.currency !== null ? (
      <VenueWhatsOnPane
        events={page.events}
        timeZone={venue.timezone}
        currencyCode={page.currency.code}
        exponent={page.currency.exponent}
        onOpenEvent={onOpenEvent}
        disabled={previewing}
        palette={palette}
        surface={surface}
        themedFont={themedFont}
        boldFont={themedBoldFont}
      />
    ) : null;

  // issue #4420 — the phone reserve bar is the shared glass bar (design
  // file → venueDef.bar): the venue on the left with what is true right now
  // (the open-state line, or a Stay's real nightly rate), the category's own
  // action on the right ("Reserve a table", "Book a visit", "Reserve this
  // Stay"). Same handler, same display gate, same testID anchors.
  const venueKindLine = [categoryChip, placeChip]
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .join(" · ");
  const stayBarRate =
    profile.bookingBody === "stay" && stayRate !== null ? stayRate : null;
  const reserveBarTitle =
    stayBarRate !== null
      ? `From ${venueStayRateValue(stayBarRate)}`
      : todayLine ?? (venueKindLine.length > 0 ? venueKindLine : venue.name);
  const reserveBarSubtitle =
    stayBarRate !== null
      ? venueStayRateQualifier(stayBarRate)
      : reserveBarTitle === venueKindLine || reserveBarTitle === venue.name
        ? null
        : venueKindLine.length > 0
          ? venueKindLine
          : null;
  // #4420 — desktop has no boxed panel: Reserve lives in the same glass bar,
  // docked in the left flyer column so it never covers the reading column.
  const reserveBar =
    showReserveBar ? (
      <View
        testID="issue-2729-reserve-bar"
        style={
          isDesktop
            ? // #4490 H1: in the flyer column, under Share and Directions. A
              // `position: fixed` dock sat inside the scroll container's transform,
              // so it scrolled with the page and ended up over the cover photo.
              styles.flyerBar
            : [
                styles.reserveBarWrap,
                Platform.OS === "web"
                  ? webVenueStyle({ position: "sticky", marginTop: 8 })
                  : null,
                { paddingBottom: insets.bottom + 12 },
              ]
        }
        pointerEvents="box-none"
      >
        <OfferingGlassBar
          palette={palette}
          theme={resolvedTheme}
          title={reservationTabBar?.title ?? reserveBarTitle}
          subtitle={
            reservationTabBar !== null
              ? reservationTabBar.subtitle
              : previewing
                ? preview.note
                : reserveBarSubtitle
          }
          ctaLabel={reservationTabBar?.ctaLabel ?? reserveVerb}
          onPress={reservationTabBar?.onPress ?? handlePrimaryCta}
          enabled={previewing ? false : reservationTabBar?.enabled ?? true}
          ctaAccessibilityLabel={reservationTabBar?.ctaLabel ?? reserveVerb}
          testID="issue-4420-venue-glass-bar"
          actionTestID="issue-2729-reserve-cta"
        />
      </View>
    ) : null;

  const reserveBarClearance =
    // #4420 D-V2 — the docked basket bar is fixed, not in flow: clear it.
    // #4490 W3 fix 6 (W3-N41): the Menu pane now stays mounted (hidden) on
    // other tabs, so its report counts only while Menu is the open tab.
    orderingOwnsBar &&
    normalizedReservationUiState.activeTab === "menu" &&
    Platform.OS === "web" &&
    !isDesktop
      ? 68 + 12 + insets.bottom + 16
      : showReserveBar && !isDesktop
        ? Platform.OS === "web"
          ? 0
          : 68 + 8 + insets.bottom + 12 + 8
        : insets.bottom + 24;

  // #4347 wave 4 — a host bar replaces the shared reserve bar at every width.
  // #4490 W3 fix 5 (W3-N37): ordering owns the Menu tab's edge, so while the
  // order bar is docked there the host's bar (the deck's) steps aside: one bar.
  const hostActionBar =
    actionBar === undefined || menuTabOrderBar !== null
      ? null
      : actionBar({
          ...themedSlotContext,
          // #4347 rework (A-4) — the same display rule as the shared bar: on
          // the Reservations tab the pane carries the reserve button.
          canReserve: showReserveCta,
          bookingKind: reservationsKind,
          reserveAction: railVerb,
          ctaLabel: page.legacy ? null : lead?.ctaLabel ?? null,
          ctaTab: page.legacy ? null : lead?.tab ?? null,
          openReservation: handleOpenReservationFromActionBar,
        });
  const hasHostActionBar = hostActionBar !== null;
  const contentBottomInset = hasHostActionBar
    ? actionBarHeight + insets.bottom + 8
    : reserveBarClearance;

  // ── #4420 desktop flyer actions (the boxed panel is gone) ─────────────────
  // Share and Directions as ghost pills under the flyer; the identity, the
  // host row and the facts read in the right column; Reserve is the bar.
  const desktopFlyerActions = isDesktop ? (
    <>
    <View style={styles.flyerActions} testID="issue-4420-venue-flyer-actions">
      <Pressable
        onPress={onShare}
        accessibilityRole="button"
        accessibilityLabel="Share this venue"
        style={({ pressed }) => [
          styles.flyerPill,
          { borderColor: neutralControl(palette) },
          pressed && styles.pressed,
        ]}
      >
        <Text style={[styles.flyerPillLabel, { color: palette.primaryText }]}>Share</Text>
      </Pressable>
      {mapsTarget !== null ? (
        <Pressable
          onPress={handleOpenMaps}
          accessibilityRole="button"
          accessibilityLabel={`Directions to ${venue.name}`}
          testID="issue-4420-venue-directions"
          style={({ pressed }) => [
            styles.flyerPill,
            { borderColor: neutralControl(palette) },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.flyerPillLabel, { color: palette.primaryText }]}>
            Directions
          </Text>
        </Pressable>
      ) : null}
    </View>
    {!hasHostActionBar ? reserveBar : null}
    </>
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

  // #4347 wave 4 — the host's Overview block sits after "about" (the
  // venue's own voice first), or first when the category has no About.
  const overviewSlotNode =
    overviewSlot === undefined ? null : overviewSlot(themedSlotContext);
  const formSectionNode =
    formSection === undefined ? null : formSection(themedSlotContext);
  const overviewHasAbout = profile.overview.includes("about");
  const formSectionAfter = profile.overview.reduce(
    (last, sectionId, index) =>
      sectionId === "about" || sectionId === "location" || sectionId === "hours"
        ? index
        : last,
    -1,
  );

  // issue #4420 — native has no CSS sticky, so once the in-flow tab strip
  // scrolls under the glass header a pinned copy shows there (web keeps the
  // strip's own position: sticky). The strip's content offset is measured
  // once it lays out; the shell's scroll drives the switch.
  const pinnedTabsTop = insets.top + 8 + OFFERING_PREMIUM_HEADER_ROW + 4;
  const pinnedTabsBackingTop = insets.top + OFFERING_PREMIUM_HEADER_ROW;
  const scrollYRef = React.useRef(0);
  const tabsAnchorRef = React.useRef<View | null>(null);
  const tabsContentYRef = React.useRef<number | null>(null);
  const [tabsPinned, setTabsPinned] = useState<boolean>(false);
  const measureTabsAnchor = (): void => {
    if (Platform.OS === "web") return;
    const node = tabsAnchorRef.current as unknown as {
      measureInWindow?: (cb: (x: number, y: number) => void) => void;
    } | null;
    node?.measureInWindow?.((_x: number, y: number) => {
      tabsContentYRef.current = y + scrollYRef.current;
    });
  };
  const handleShellScroll = (event: {
    nativeEvent: { contentOffset: { y: number } };
  }): void => {
    const y = event.nativeEvent.contentOffset.y;
    scrollYRef.current = y;
    const top = tabsContentYRef.current;
    const next = top !== null && y + pinnedTabsTop >= top;
    if (next !== tabsPinned) setTabsPinned(next);
  };

  const bodyContent = (
    <View style={styles.body}>
      {/* #1561 — the identity + answer block now renders at EVERY width. On
          desktop it replaces the hero caption (which printed the name a second
          time over the photograph); the name is now printed once, at the top of
          the reading column, where the answer bar can sit directly under it. */}
      {identityBlock}
      {refreshNoticeVisible ? (
        <View
          style={[
            styles.refreshNotice,
            isDesktop && styles.refreshNoticeDesktop,
            {
              backgroundColor: semantic.warningTint,
              borderColor: palette.panelBorder,
            },
          ]}
          testID="issue-2756-stale-refresh-notice"
        >
          <Text
            key={`public-venue-refresh-error-${refreshErrorVersion}`}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[
              styles.refreshMessage,
              themedFont,
              isDesktop && styles.refreshMessageDesktop,
              { color: palette.secondaryText },
            ]}
          >
            Couldn’t refresh venue. Showing the last update.
          </Text>
          <PublicVenueRetryAction
            busy={refreshRetryBusy}
            accessibleLabel="Try refreshing venue again"
            backgroundColor={palette.accent}
            fillStyle={accentFill(palette)}
            textColor={palette.accentText}
            focusColor={palette.accentText}
            focusOffset={-4}
            fontFamily={resolvedTheme.fontFamilyValue}
            onPress={handleRetryRefresh}
            onFocusChange={(focused: boolean) => {
              refreshRetryFocusedRef.current = focused;
            }}
          />
        </View>
      ) : null}
      {Platform.OS === "web" ? null : (
        <View
          ref={tabsAnchorRef}
          onLayout={measureTabsAnchor}
          collapsable={false}
          testID="issue-4420-venue-tabs-anchor"
        />
      )}
      <PublicVenueTabs
        ref={publicVenueTabsRef}
        initialTab={initialTab}
        activeTab={normalizedReservationUiState.activeTab}
        hasMenu={hasMenu}
        {...(page.legacy
          ? {}
          : {
              tabs: page.tabs,
              labels: page.labels,
              panes: { whats_on: whatsOnBlock, rooms: roomsBlock, entry: entryBlock, groups: groupsBlock, hire: hireBlock, by_the_hour: hourBlock, plans: plansBlock },
            })}
        palette={palette}
        surface={surface}
        theme={resolvedTheme}
        overview={
          <View style={styles.tabPane}>
            {overviewSlotNode !== null && !overviewHasAbout ? (
              <React.Fragment key="host-overview-slot">
                {overviewSlotNode}
              </React.Fragment>
            ) : null}
            {profile.overview.map((sectionId, index) => {
              const Section = VENUE_SECTIONS[sectionId];
              return (
                <React.Fragment key={sectionId}>
                  <Section {...sectionProps} />
                  {overviewSlotNode !== null && sectionId === "about"
                    ? overviewSlotNode
                    : null}
                  {formSectionNode !== null && index === formSectionAfter
                    ? formSectionNode
                    : null}
                </React.Fragment>
              );
            })}
            {formSectionNode !== null && formSectionAfter < 0 ? formSectionNode : null}
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
        // issue #4420 — the premium public frame (design file → venueDef):
        // the category, place and name on the cover over the scrim, the live
        // "Open now" pill under them, the glass header with the title once the
        // cover scrolls away; desktop is the photo column + the content.
        frame="premium"
        coverIdentity={{
          // The category and place read in the body's chips right under the
          // cover; the cover carries the name and the live pill.
          // #4420 — "Restaurant · NoHo": what it is and where, above the name.
          eyebrow: [categoryChip.length > 0 ? categoryChip : null, placeChip],
          title: venue.name,
          // Only when the venue's own clock says it is open right now
          // (Constitution 9: "unknown" claims nothing, so no pill).
          live: openState.status === "open" ? "Open now" : null,
        }}
        directionCIdentity={useDirectionCIdentity ? {
          title: venue.name,
          meta: [profile.noun, venue.city].filter(Boolean).join(" · "),
        } : undefined}
        // #1561 — the venue's actual photographs, as the shell's first-class
        // cover pager. Empty ⇒ single cover, byte-identical to the old mount.
        galleryImages={heroCover.additional}
        heroAccessibilitySubject={venue.name}
        coverMediaAlt={null}
        coverAspectRatio={heroAspectRatio}
        // #1561 — a coverless PUBLIC page printed the literal word `COVER` at
        // full hero size (#1550 Leg C, plate P12). It now reads as what the
        // place is: "Hotel · Lagos".
        coverPlaceholderLabel={venueCoverPlaceholderLabel(profile, venue)}
        // #1561 — no hero caption: `heroEyebrow`/`heroTitle` printed
        // "VERIFIED VENUE" and the venue name OVER the photograph on desktop,
        // which is the second of the two places the name appeared and the only
        // place the redundant badge did. Both now live in `identityBlock`.
        desktopFlyerActions={desktopFlyerActions}
        {...(Platform.OS === "web" ? {} : { onScroll: handleShellScroll })}
        safeAreaTop={insets.top + 8}
        contentBottomInset={contentBottomInset}
        testID="orch-1255-public-venue"
      >
        {bodyContent}
        {Platform.OS === "web" && !isDesktop && !hasHostActionBar && reserveBar !== null ? (
          <React.Fragment key="issue-2729-web-phone-action">
            {reserveBar}
          </React.Fragment>
        ) : null}
      </ParallaxCoverShell>
      {Platform.OS !== "web" && tabsPinned && (page.legacy || page.tabs.length > 1) ? (
        <View
          // W3 fix 4 (W3-N34): the pinned strip sits on an opaque page-colour
          // backing from the header's foot to below the pill (full width), so
          // nothing scrolling under it (the Menu tab's section headings) reads
          // through the gap under the header or beside the pill.
          style={[
            styles.pinnedTabs,
            {
              top: pinnedTabsBackingTop,
              paddingTop: pinnedTabsTop - pinnedTabsBackingTop,
              backgroundColor: palette.page,
              borderBottomColor: palette.panelBorder,
            },
          ]}
          pointerEvents="box-none"
          testID="issue-4490-venue-tab-pill-pinned-backing"
        >
          <PublicVenueTabPill
            hasMenu={hasMenu}
            {...(page.legacy ? {} : { tabs: page.tabs, labels: page.labels })}
            activeTab={normalizedReservationUiState.activeTab}
            palette={palette}
            theme={resolvedTheme}
            onSelect={(tab: PublicVenueTab) => {
              publicVenueTabsRef.current?.selectTab(tab);
            }}
          />
        </View>
      ) : null}
      {/* issue #2729 — web owns the same bar INSIDE ParallaxCoverShell's sole
          scroll ancestry. Native retains the pre-existing absolute sibling
          byte-for-byte, and desktop has no phone bar. */}
      {hasHostActionBar
        ? hostActionBar
        : Platform.OS !== "web"
          ? reserveBar
          : null}
      {reservationSheet({
        ...themedSlotContext,
        visible: normalizedReservationUiState.reservationSheetOpen,
        onClose: handleReservationSheetClose,
        onDismissed: handleReservationSheetDismissed,
        // #1532 defect 1 / #1558 — the heading comes from the SAME profile
        // field as the CTA above, so a Stay guest can no longer tap "Reserve
        // this Stay" and land on a sheet headed "Reserve a table".
        title: railVerb,
        children: reservationsSheetBlock,
      })}
      {overlays}
    </View>
  );
};

const styles = StyleSheet.create({
  // #4420 — the host row (36 avatar, "By {brand}", Message ghost pill).
  hostRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  hostAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  hostAvatarText: { fontSize: 15, fontWeight: "700" },
  // #4420 — Share and Directions under the desktop flyer, 50% each.
  flyerActions: { flexDirection: "row", gap: 10 },
  flyerBar: { width: "100%" },
  flyerPill: {
    flex: 1,
    minHeight: 44,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  flyerPillLabel: { fontSize: 14, fontWeight: "700" },
  // issue #4420 — the pinned tab pill (native), under the glass header.
  pinnedTabs: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 60,
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
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
  byBrandRow: {
    paddingVertical: 12,
    alignSelf: "flex-start",
  },
  byBrandShrink: {
    flex: 1,
    minWidth: 0,
  },
  messageBrandBtn: {
    // #4490: 44 touch floor (a phone browser has no hitSlop).
    minHeight: 44,
    borderRadius: 999,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  messageBrandLabel: {
    fontSize: 13,
    fontWeight: "700",
  },
  byBrandBy: {
    fontSize: 14,
    lineHeight: 20,
  },
  byBrandName: {
    fontWeight: "600",
  },
  refreshNotice: {
    width: "100%",
    minHeight: 128,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1,
    borderRadius: 16,
    gap: 12,
  },
  refreshNoticeDesktop: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  refreshMessage: {
    fontSize: 14,
    fontWeight: "600",
  },
  refreshMessageDesktop: {
    flex: 1,
    minWidth: 0,
    maxWidth: 520,
  },
  // ---- about / pitch (§6.1) ----
  // The block groups the prose + `Read more` in a bare View; the toggle carries
  // its own paddingVertical, and the parent `body` gap (20) spaces the block.
  aboutBody: {
    fontSize: 15,
    lineHeight: 23,
  },
  aboutBodyThemed: {
    fontSize: 15,
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
  // #4334 F-1 — top-left: Google's logo and attribution own the bottom corners.
  mapPill: {
    position: "absolute",
    left: 12,
    top: 12,
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
  },
  addressCardButton: {
    alignSelf: "flex-start",
    marginTop: 8,
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
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
  // #4490 — several windows in one day.
  hoursTimesWrap: {
    flexShrink: 1,
    textAlign: "right",
  },
  // ---- menu (§6.6) ----
  // #1561 deleted `galleryWrap` / `galleryContent` / `galleryTile` with the
  // bottom photo strip they sized. `galleryTile`'s literal `width: 240,
  // height: 180` is the "240x180 at every width" Leg C measured.
  menuWrap: {
    gap: 0,
  },
  menuColdState: {
    minHeight: 132,
    width: "100%",
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    justifyContent: "center",
    alignItems: "flex-start",
  },
  menuStaleState: {
    minHeight: 52,
    width: "100%",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 16,
    gap: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
  },
  menuStateCopy: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexShrink: 1,
  },
  menuStateTextWrap: {
    gap: 2,
    flexShrink: 1,
  },
  menuColdLoadingText: {
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "400",
  },
  menuColdErrorTitle: {
    fontSize: 17,
    lineHeight: 21,
    fontWeight: "800",
  },
  menuColdErrorBody: {
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "400",
  },
  menuStaleText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "400",
  },
  menuRetry: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: 12,
    paddingHorizontal: 18,
  },
  menuRetryHovered: {
    opacity: 0.92,
  },
  menuRetryPressed: {
    opacity: 0.85,
  },
  menuRetryDisabled: {
    opacity: 0.55,
  },
  menuRetryText: {
    fontSize: 14,
    fontWeight: "800",
  },
  // ---- reserve (§6.7) ----
  reserveBarWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingTop: 8,
    zIndex: 6,
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
});

export default PublicVenueScreen;
