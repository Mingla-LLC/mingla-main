/**
 * /b/{brandSlug}/v/{venueSlug} — the buyer-web PUBLIC venue route.
 *
 * #1559 [shared-venue-screen] — this file is now an ADAPTER. Every pixel a
 * guest sees is rendered by `@mingla/brand-rendering/PublicVenueScreen`, the
 * one module #1560 also points the consumer app at. What stays here is only
 * what is genuinely this app's:
 *
 *   1. DATA — params → the five public queries → one `PublicVenueViewModel`.
 *   2. PLATFORM EFFECTS — `<Head>` (web-only SEO), `captureWeb`,
 *      `captureAdClickIds`, and the buyer-web organic-capture policy.
 *   3. THE PAYMENT RAIL — `GuestVenueReservation` (Stripe.js) and the lazily
 *      loaded `BuyerStayGuestExperience` (Payment Element), handed to the
 *      screen through its `bookingBody` slot. The `React.lazy` boundary stays
 *      HERE on purpose (#1550 R4): it is what keeps `StayGuestBooking` and
 *      `@stripe/stripe-js` out of the eager `__common` boot chunk, and the
 *      shared module is forbidden from containing one.
 *   4. HOST CHROME — the reservation `Sheet` and `ShareModal`.
 *
 * House nested-slug pattern of app/e/[brandSlug]/[eventSlug].tsx and
 * app/b/[brandSlug]/index.tsx: params → query → loading / error / not-found /
 * page.
 *
 * ANON ROUTE — lives under the `/b/` PUBLIC_BUYER_ROUTE_PREFIXES allowlist
 * (segment-safe prefix match covers /b/{slug}/v/{slug}), so the root-layout
 * unauthenticated redirect never fires here. NEVER call useAuth from this
 * chain (I-anon-buyer-routes). Data flows ONLY through venue_public_view
 * (definer, verified-only): a pending/suspended/unknown venue is one
 * indistinguishable not-found state (no state leak).
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — anon public route; PublicVenueScreen/PublicVenueNotFound apply insets.top; state views center-anchored
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Head from "expo-router/head";
import { useSafeAreaInsets } from "react-native-safe-area-context";
// #1559 — DEEP specifier, NOT the "@mingla/brand-rendering" barrel: the barrel
// re-exports the whole PublicBrandPage module, and a barrel VALUE import from
// this (venue-chunk) file would make Metro hoist that ~27 KB module plus the
// lucide shim's module-scope icon requires into the EAGER __common boot chunk
// (ORCH-1083 bundle-budget breach). Enforced by i-1047-biz-bundle-budget-deferral.
import { PublicVenueScreen } from "@mingla/brand-rendering/PublicVenueScreen";
// #4490 — pure and import-light: what the venue sells decides the page.
import { venueTabFromParam, type VenueFeaturePlanView } from "@mingla/brand-rendering/venueFeaturePage";
import { PublicMenuSections } from "@mingla/brand-rendering/PublicMenuSections";
import {
  classifyPublicVenueRouteState,
  publicVenueRefreshErrorClass,
  PublicVenueRetryAction,
} from "@mingla/brand-rendering/publicVenueRefreshState";
import {
  publicVenueMeta,
  type PublicVenueAnalyticsEvent,
  type PublicVenueBookingSlotContext,
  type PublicVenueEntrySlotContext,
  type PublicVenueOrderingSlotContext,
  type PublicVenueReservationSheetContext,
  type PublicVenueViewModel,
} from "@mingla/brand-rendering/PublicVenueScreen";
// TYPE-ONLY off the barrel — a value import here re-hoists PublicBrandPage and
// the eager lucide shim into __common (i-1047-biz-bundle-budget-deferral).
import type { PublicMenuGroup } from "@mingla/brand-rendering";
// issue #2468 — DEEP specifier (this route never imports a package barrel);
// `import type` is erased, so it adds nothing to the bundle.
import type {
  MapsAppId,
  MapsOpenTarget,
} from "@mingla/offering-rendering/mapsDeepLink";
import { openMapsTarget } from "../../../../src/utils/openMapsTarget";
import { venuePrefill } from "../../../../src/sites/bookingPrefill";
import { recordShareDestination } from "../../../../src/analytics/shareDestination";
import {
  captureOfferingCta,
  captureOfferingPageView,
  type OfferingEngagementScope,
} from "../../../../src/services/offeringEngagementCapture";
import { copyAddressText } from "../../../../src/utils/copyAddressText";

import { color, space } from "../../../../src/constants/designSystem";
import { reportNonFatal } from "../../../../src/diagnostics/reportNonFatal";
// META-ORCH-1187 LEG 2 — buyer-web public-offering view capture (web-only).
import {
  captureAdClickIds,
  captureWeb,
} from "../../../../src/analytics/webAnalytics";
import { captureBuyerWebPublicPageViewed } from "../../../../src/analytics/publicParityWebAdapter";
import {
  usePublicBrandBySlug,
  usePublicVenueBySlug,
  usePublicVenueDiscoveryPrice,
  usePublicVenueReservable,
} from "../../../../src/hooks/usePublicEvents";
import { toVenueViewModel } from "../../../../src/components/venue/toPublicVenueViewModel";
import { usePublicVenueFeatures } from "../../../../src/hooks/usePublicVenueFeatures";
import { usePublicMenus } from "../../../../src/hooks/useMenus";
import { usePublicStayDetail } from "../../../../src/hooks/usePublicStayDetail";
import { PublicVenueNotFound } from "../../../../src/components/venue/PublicVenueNotFound";
import { PublicVenueReservationSheet } from "../../../../src/components/venue/PublicVenueReservationSheet";
import { GuestVenueReservation } from "../../../../src/components/venue/GuestVenueReservation";
import { loadVenueGuestScreens } from "../../../../src/components/venue/guest/venueGuestOwner";
import { tablesBlockChangesFlow } from "../../../../src/components/venue/offers/tablesFlow";
import { ShareModal } from "../../../../src/components/ui/ShareModal";
import { useThemeFont } from "../../../../src/theme/useThemeFont";
import { OptionalFeatureBoundary } from "../../../../src/components/brandContact/OptionalFeatureBoundary";
// #4111 D6 — Message {Brand} with this venue picked. It messages as a signed-out
// web guest (this chain never calls useAuth); the sheet itself loads lazily.
import VenueBrandMessage from "../../../../src/components/brandContact/VenueBrandMessage";
import {
  brandPublicPath,
  venueOgImageUrl,
  venuePublicUrl,
} from "../../../../src/constants/publicUrls";
import {
  isPublicVenueReservableContractError,
  type PublicVenue,
} from "../../../../src/services/publicEventsService";
import { shareCanonicalPublicPageOnWeb } from "../../../../src/utils/shareCanonicalPublicPageOnWeb";
import {
  captureVenueOrganicEvent,
  settleVenueOrganicJourneyOnConsent,
} from "../../../../src/services/venueOrganicCaptureService";
import {
  runBuyerVenueOrganicCapture,
  settleBuyerVenueOrganicCapture,
  type VenueOrganicAnalyticsSurface,
} from "../../../../src/services/venueOrganicCapturePolicy";
import { PublicGlassProvider } from "../../../../src/components/offering/PublicGlassProvider";

// #1390: Stay booking includes its own renderer and Stripe Payment Element.
// Keep that product-specific bulk off the shared buyer-web boot path and load it
// only after a verified Stay venue reaches its reservations surface.
const BuyerStayGuestExperience = React.lazy(() =>
  import("../../../../src/components/stay/BuyerStayGuestExperience").then(
    (module) => ({ default: module.BuyerStayGuestExperience }),
  ),
);

// #4490 P2 — the Entry tab's buying flow (availability, quote, checkout
// hand-off). Lazy for the same reason: only a venue that sells entry loads it.
// Every guest tab below loads from the ONE Guest venue owner
// (venueGuestOwner.ts), so what the tabs share never reaches __common.
const VenueEntryPane = React.lazy(async () => ({
  default: (await loadVenueGuestScreens()).VenueEntryPane,
}));

// #4490 P4 — the Private hire tab's flow, lazy for the same reason.
const VenueHirePane = React.lazy(async () => ({
  default: (await loadVenueGuestScreens()).VenueHirePane,
}));
// #4490 P5 — the By the hour tab's flow, lazy for the same reason.
const VenueHourPane = React.lazy(async () => ({
  default: (await loadVenueGuestScreens()).VenueHourPane,
}));
// #4490 P6 — the Plans tab (monthly plans and Join), lazy for the same reason.
const VenuePlansPane = React.lazy(async () => ({
  default: (await loadVenueGuestScreens()).VenuePlansPane,
}));
// #4490 P3 — the Groups tab's booking flow, lazy for the same reason.
const VenueGroupsPane = React.lazy(async () => ({
  default: (await loadVenueGuestScreens()).VenueGroupsPane,
}));

/**
 * #1793 (#1767 Phase 4) — the ordering renderers, behind a lazy boundary that
 * lives HERE, in the host.
 *
 * The rule `i-1047-biz-bundle-budget-deferral` enforces and #1550 wrote: the
 * shared screen may not contain `React.lazy`, because code-splitting belongs
 * where the bundle is measured. A value import of a cart, a review pane and a
 * status card at this module's scope would put all three in the venue route's
 * eager chunk for every visitor to every venue page — including the
 * overwhelming majority whose venue has ordering switched OFF, which is the
 * default and will stay the default for most venues. Each factory runs the
 * first time a guest can actually order.
 */
const LazyOrderingSurface = React.lazy(() =>
  import("../../../../src/components/venueOrdering/BuyerVenueOrderingSlots")
    .then((module) => ({ default: module.BuyerVenueOrderingSurface })),
);

/**
 * #1421 — this route is the ONLY mount of the public venue page in this app,
 * and it is always the real buyer web. Naming the surface here (rather than
 * defaulting it inside a component that several callers might reach) is what
 * keeps organic capture fail-closed: `venueOrganicCapturePolicy` drops
 * everything that is not `buyer_web`, and the shared render module has no
 * analytics import at all, so nothing downstream can bypass that policy.
 */
const analyticsSurface: VenueOrganicAnalyticsSurface = "buyer_web";

/** #1793 — a stable empty menu, so the ordering surface's deps do not churn. */
const EMPTY_MENU_GROUPS: PublicMenuGroup[] = [];

function PublicVenueRouteBody(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [shareModalVisible, setShareModalVisible] = React.useState(false);
  const [messageOpener, setMessageOpener] = React.useState<{ open: () => void } | null>(null);
  // Mount the (lazy) message controller only after the page's first commit, so
  // its chunk never sits on the venue page's first paint.
  const [messageMountReady, setMessageMountReady] = React.useState(false);
  useEffect(() => {
    setMessageMountReady(true);
  }, []);
  const handleMessageOpener = useCallback(
    (opener: { open: () => void } | null): void => setMessageOpener(opener),
    [],
  );
  const params = useLocalSearchParams<{
    brandSlug: string | string[];
    venueSlug: string | string[];
    tab?: string | string[];
    spot?: string | string[];
    src?: string | string[];
    // #4453 milestone 5 — a Mingla website's pre-fill (re-validated; bad values ignored).
    date?: string | string[];
    time?: string | string[];
    party?: string | string[];
    checkin?: string | string[];
    checkout?: string | string[];
    guests?: string | string[];
    room?: string | string[];
  }>();
  const prefill = useMemo(() => venuePrefill(params), [params]);
  const brandSlug = Array.isArray(params.brandSlug)
    ? params.brandSlug[0]
    : params.brandSlug;
  const venueSlug = Array.isArray(params.venueSlug)
    ? params.venueSlug[0]
    : params.venueSlug;
  const requestedTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  // #1793 (SPEC #1788 P-10) — the printed QR carries
  // `?tab=menu&spot={code}&src=qr`. `spot` is WHERE they are sitting; `src` is
  // HOW they arrived. D-3a keeps the two apart on purpose: one is a recorded
  // fact about a table, the other is attribution, and conflating them is how a
  // venue's zone revenue comes to include people who were never in the zone.
  const rawSpot = Array.isArray(params.spot) ? params.spot[0] : params.spot;
  const spotCode = typeof rawSpot === "string" && rawSpot.trim() !== ""
    ? rawSpot.trim()
    : null;
  const rawSrc = Array.isArray(params.src) ? params.src[0] : params.src;
  const entrySource = typeof rawSrc === "string" && rawSrc.trim() !== ""
    ? rawSrc.trim()
    : null;

  const venueQuery = usePublicVenueBySlug(
    typeof brandSlug === "string" ? brandSlug : null,
    typeof venueSlug === "string" ? venueSlug : null,
  );
  const venue = venueQuery.data ?? null;
  const routeState = classifyPublicVenueRouteState({
    hasData: venue !== null,
    isLoading: venueQuery.isLoading,
    isFetching: venueQuery.isFetching,
    isError: venueQuery.isError,
  });
  const [coldRetryBusy, setColdRetryBusy] = React.useState(false);
  const coldRetryGuardRef = useRef(false);
  const refetchVenue = venueQuery.refetch;
  const handleRetryVenue = useCallback(async (): Promise<void> => {
    if (coldRetryGuardRef.current) return;
    coldRetryGuardRef.current = true;
    setColdRetryBusy(true);
    try {
      await refetchVenue();
    } catch {
      // TanStack Query owns the visible error state; retry rejection must not
      // escape a press handler as an unhandled promise.
    } finally {
      coldRetryGuardRef.current = false;
      setColdRetryBusy(false);
    }
  }, [refetchVenue]);
  const reportedRefreshErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      routeState !== "populated-error" ||
      venue === null ||
      typeof brandSlug !== "string" ||
      typeof venueSlug !== "string" ||
      venueQuery.errorUpdatedAt <= 0
    ) {
      return;
    }
    const transitionKey =
      `${brandSlug}:${venueSlug}:${venueQuery.errorUpdatedAt}`;
    if (reportedRefreshErrorRef.current === transitionKey) return;
    reportedRefreshErrorRef.current = transitionKey;
    reportNonFatal(
      "publicVenue.backgroundRefresh",
      venueQuery.error,
      {
        surface: analyticsSurface,
        brand_slug: brandSlug,
        venue_slug: venueSlug,
        error_class: publicVenueRefreshErrorClass(venueQuery.error),
      },
      ["publicVenue.backgroundRefresh", analyticsSurface],
    );
  }, [
    brandSlug,
    routeState,
    venue,
    venueQuery.error,
    venueQuery.errorUpdatedAt,
    venueSlug,
  ]);
  // #4490 — what the venue sells (features, hours windows, events). Anon: no
  // auth anywhere in this chain. A failed read is not an error page: the screen
  // falls back to today's tabs, so the page is never worse than before.
  const featuresQuery = usePublicVenueFeatures(
    typeof brandSlug === "string" ? brandSlug : null,
    typeof venueSlug === "string" ? venueSlug : null,
  );
  const features = featuresQuery.data ?? null;
  // The page waits for its features: showing today's "Tables through Mingla"
  // row for a moment on a venue that sells no tables would be a lie.
  const featuresPending = venue !== null && featuresQuery.isLoading;
  const stayQuery = usePublicStayDetail(
    venue?.id ?? null,
    venue?.venueCategory === "stay",
  );

  // Exact venue-owned menu — fetched only once the venue resolves (a
  // not-found page needs no menu round-trip).
  const menusQuery = usePublicMenus(
    venue !== null && typeof brandSlug === "string"
      ? brandSlug
      : null,
    venue !== null && typeof venueSlug === "string"
      ? venueSlug
      : null,
  );

  // §6.7 reserve display gate — place-keyed, anon-safe. Disabled without a
  // linked place; error → not reservable (fail closed, no dead CTA).
  const reservableQuery = usePublicVenueReservable(
    venue?.placePoolId ?? null,
  );
  const discoveryPriceQuery = usePublicVenueDiscoveryPrice(
    venue?.placePoolId ?? null,
  );

  const menuGroups = menusQuery.data ?? EMPTY_MENU_GROUPS;
  const menuDiagnosticReportedRef = useRef<boolean>(false);
  useEffect(() => {
    if (menusQuery.isFetching || !menusQuery.isError) {
      if (menusQuery.isFetching) menuDiagnosticReportedRef.current = false;
      return;
    }
    if (menuDiagnosticReportedRef.current) return;
    menuDiagnosticReportedRef.current = true;
    reportNonFatal(
      "public-venue.menu-read",
      new Error("public_menu_request_failed"),
      {
        surface: Platform.OS === "web" ? "buyer_web" : "business_native",
        brand_slug: typeof brandSlug === "string" ? brandSlug : null,
        venue_slug: typeof venueSlug === "string" ? venueSlug : null,
      },
      [
        "public-venue-menu-read",
        Platform.OS === "web" ? "buyer_web" : "business_native",
      ],
    );
  }, [brandSlug, menusQuery.isError, menusQuery.isFetching, venueSlug]);


  // §6.8 — the secondary "See {brand} →" link renders only when the PARENT
  // brand resolves publicly. Fetched ONLY on the not-found path.
  const venueMissing =
    routeState === "not-found";
  const brandProbeQuery = usePublicBrandBySlug(
    venueMissing && typeof brandSlug === "string" ? brandSlug : null,
  );

  // META-ORCH-1187 LEG 2 — fire `web_public_offering_viewed` once on mount.
  // Web-only (no-op on native).
  const viewFiredRef = useRef<boolean>(false);
  const parityViewFiredRef = useRef<boolean>(false);
  const attributionFiredRef = useRef<boolean>(false);
  useEffect(() => {
    if (viewFiredRef.current) return;
    viewFiredRef.current = true;
    captureWeb("web_public_offering_viewed", {
      offering_type: "venue",
      brand_slug: typeof brandSlug === "string" ? brandSlug : null,
      venue_slug: typeof venueSlug === "string" ? venueSlug : null,
      slug: typeof venueSlug === "string" ? venueSlug : null,
    });
  }, [brandSlug, venueSlug]);

  useEffect(() => {
    if (parityViewFiredRef.current || venue === null) return;
    parityViewFiredRef.current = true;
    void captureBuyerWebPublicPageViewed({
      target: {
        kind: "venue",
        entityId: venue.id,
        brandSlug: venue.brandSlug,
        venueSlug: venue.slug,
      },
      state: routeState === "populated-ready" ? "populated" : "stale",
    });
  }, [routeState, venue]);

  useEffect(() => {
    if (attributionFiredRef.current) return;
    if (typeof brandSlug !== "string" || typeof venueSlug !== "string") return;
    attributionFiredRef.current = true;
    captureAdClickIds({
      pageType: "venue",
      brandSlug,
      entitySlug: venueSlug,
    });
  }, [brandSlug, venueSlug]);

  useEffect(() => {
    if (venue?.venueCategory !== "stay") return;
    captureWeb("stay_viewed", {
      surface: "buyer_web",
      brand_id: venue.brandId,
      venue_id: venue.id,
    });
  }, [venue?.brandId, venue?.id, venue?.venueCategory]);

  // #1421 — settle the organic page journey once consent lands. Fail-closed for
  // the Business preview surface; a no-op until a venue actually resolves.
  const settleBrandId = venue?.brandId ?? null;
  const settleVenueId = venue?.id ?? null;
  useEffect(() => {
    if (settleBrandId === null || settleVenueId === null) return;
    return settleBuyerVenueOrganicCapture(analyticsSurface, () =>
      settleVenueOrganicJourneyOnConsent({
        brandId: settleBrandId,
        venueId: settleVenueId,
      })
    );
  }, [settleBrandId, settleVenueId]);

  const venueViewModel = useMemo<PublicVenueViewModel | null>(
    () => (venue === null ? null : toVenueViewModel(venue)),
    [venue],
  );
  const engagementScope = useMemo<OfferingEngagementScope | null>(
    () =>
      venue === null
        ? null
        : { brandId: venue.brandId, entityType: "venue", entityId: venue.id },
    [venue],
  );
  useEffect(() => {
    if (engagementScope !== null) {
      void captureOfferingPageView(engagementScope);
    }
  }, [engagementScope]);

  const handleAnalytics = useCallback(
    (
      event: PublicVenueAnalyticsEvent,
      props: Record<string, unknown>,
    ): void => {
      captureWeb(event, { surface: analyticsSurface, ...props });
      if (settleBrandId === null || settleVenueId === null) return;
      if (event === "public_venue_menu_viewed") {
        runBuyerVenueOrganicCapture(analyticsSurface, () => {
          void captureVenueOrganicEvent(
            { brandId: settleBrandId, venueId: settleVenueId },
            "menu_open",
          );
        });
      } else if (event === "public_venue_reservation_started") {
        if (engagementScope !== null) {
          void captureOfferingCta(engagementScope, "book");
        }
        runBuyerVenueOrganicCapture(analyticsSurface, () => {
          void captureVenueOrganicEvent(
            { brandId: settleBrandId, venueId: settleVenueId },
            "reservation_start",
          );
        });
      }
    },
    [engagementScope, settleBrandId, settleVenueId],
  );

  // issue #2468 — was a google TEXT search on the venue's address string, which
  // the provider re-geocoded. The shared screen now hands us the venue's stored
  // lat/lng (the same pair its static map is drawn from) and the link is
  // anchored on it.
  const handleOpenMaps = useCallback(
    (target: MapsOpenTarget, app?: MapsAppId): void => {
      // issue #2508 — `app` is the guest's choice from the shared chooser;
      // undefined means nothing was asked (the exact #2468 path).
      // #3187 P2-1 — a share recipient's directions tap (no-op off a shared link).
      recordShareDestination("directions");
      if (engagementScope !== null) {
        void captureOfferingCta(engagementScope, "directions");
      }
      openMapsTarget(target, { app });
    },
    [engagementScope],
  );

  // issue #2508 — the copy-address host effect. The text has already cleared
  // the SAME gate as the maps link, so this is never reachable with a withheld
  // address.
  const handleCopyAddress = useCallback(
    (text: string): Promise<void> => copyAddressText(text),
    [],
  );

  const handleOpenBrand = useCallback((): void => {
    if (typeof brandSlug !== "string") return;
    recordShareDestination("view_brand");
    // #4037 decision 5 — opening the brand is engagement on this page.
    if (engagementScope !== null) {
      void captureOfferingCta(engagementScope, "view_brand");
    }
    router.push(brandPublicPath(brandSlug) as never);
  }, [brandSlug, engagementScope, router]);

  const handleClose = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (typeof brandSlug !== "string") return;
    router.replace(brandPublicPath(brandSlug) as never);
  }, [brandSlug, router]);

  // #3187 — the canonical URL needs only the route params, so web never falls
  // through to the native sheet while the venue query is unresolved. Title and
  // description degrade; the URL does not.
  const handleShare = useCallback((): void => {
    // #4037 decision 5 — a share tap is engagement on this page.
    if (engagementScope !== null) {
      void captureOfferingCta(engagementScope, "share");
    }
    if (
      Platform.OS === "web" &&
      typeof brandSlug === "string" &&
      typeof venueSlug === "string"
    ) {
      const meta = venue !== null ? publicVenueMeta(venue) : null;
      void shareCanonicalPublicPageOnWeb({
        url: venuePublicUrl({ brandSlug, venueSlug }),
        title: meta?.pageTitle ?? "Mingla",
        description: meta?.metaDescription,
      });
      return;
    }
    setShareModalVisible(true);
  }, [brandSlug, engagementScope, venue, venueSlug]);

  // issue #1562 mitigation 2 — the guest's live quoted total, reported up from
  // the Reservations tab's booking body. It replaces the "from" rate in the
  // answer bar's SAME price slot, at the same size, the moment dates are
  // chosen; `null` (no quote, expired, consumed) restores the from-rate.
  const [stayQuote, setStayQuote] = React.useState<
    { totalMinor: string; currencyCode: string } | null
  >(null);

  const renderBookingBody = useCallback(
    (context: PublicVenueBookingSlotContext): React.ReactNode =>
      context.kind === "stay" ? (
        <BuyerStayGuestExperience
          venueId={context.venueId}
          brandId={context.brandId}
          detail={context.stayDetail}
          state={context.stayState}
          palette={context.palette}
          surface={context.surface}
          theme={context.theme}
          onQuoteChange={setStayQuote}
          // #4453 — pre-fill props only when the site sent them, so a plain
          // visit renders byte-identically to before (#1559 render parity).
          {...(prefill.checkin && prefill.checkout ? { initialRange: { checkIn: prefill.checkin, checkOut: prefill.checkout } } : {})}
          {...(prefill.guests != null ? { initialAdults: prefill.guests } : {})}
          {...(prefill.room != null ? { initialRoomId: prefill.room } : {})}
        />
      ) : (
        <GuestVenueReservation
          venueId={context.venueId}
          brandId={context.brandId}
          currency={context.currency}
          analyticsSurface={analyticsSurface}
          {...(prefill.date != null ? { initialDate: prefill.date } : {})}
          {...(prefill.time != null ? { initialTime: prefill.time } : {})}
          {...(prefill.party != null ? { initialPartySize: prefill.party } : {})}
          // issue #1564 — the slot has always carried the resolved palette (the
          // Stay branch two lines up already used it); the table branch simply
          // never read it, and painted Mingla orange on every brand's page.
          palette={context.palette}
          // issue #4420 wave 2 (D-V3) — the Reservations tab's live bar.
          onReservationBarChange={context.onReservationBarChange}
          // #4490 P5 — the venue's tables block (party cap, pick a table,
          // waitlist). Sent only when the venue has one, so a venue without
          // it renders byte-for-byte as before (#1559 parity).
          {...(features?.tables != null && tablesBlockChangesFlow(features.tables)
            ? {
                tables: features.tables,
                brandSlug: typeof brandSlug === "string" ? brandSlug : null,
                venueSlug: typeof venueSlug === "string" ? venueSlug : null,
                venueName: venue?.name ?? null,
              }
            : {})}
        />
      ),
    [prefill.date, prefill.time, prefill.party, prefill.checkin, prefill.checkout, prefill.guests, prefill.room, features?.tables, brandSlug, venueSlug, venue?.name],
  );

  // #4490 P2 — the Entry tab: pick a day and guests, then checkout.
  const renderEntryBody = useCallback(
    (context: PublicVenueEntrySlotContext): React.ReactNode =>
      typeof brandSlug === "string" && typeof venueSlug === "string" ? (
        <React.Suspense
          fallback={
            <View style={styles.stateWrap}>
              <ActivityIndicator />
            </View>
          }
        >
          <VenueEntryPane
            brandSlug={brandSlug}
            venueSlug={venueSlug}
            offers={context.offers}
            currencyCode={context.currencyCode}
            exponent={context.exponent}
            palette={context.palette}
            theme={context.theme}
            verb={context.verb}
            onBookingBarChange={context.onBookingBarChange}
          />
        </React.Suspense>
      ) : null,
    [brandSlug, venueSlug],
  );

  // #4490 P3 — the Groups tab: pick a package, a day and time, the group, then checkout.
  const renderGroupsBody = useCallback(
    (context: PublicVenueEntrySlotContext): React.ReactNode =>
      typeof brandSlug === "string" && typeof venueSlug === "string" ? (
        <React.Suspense
          fallback={
            <View style={styles.stateWrap}>
              <ActivityIndicator />
            </View>
          }
        >
          <VenueGroupsPane
            brandSlug={brandSlug}
            venueSlug={venueSlug}
            offers={context.offers}
            currencyCode={context.currencyCode}
            exponent={context.exponent}
            palette={context.palette}
            theme={context.theme}
            onBookingBarChange={context.onBookingBarChange}
          />
        </React.Suspense>
      ) : null,
    [brandSlug, venueSlug],
  );

  // #4490 P4 — the Private hire tab: group size, day, session, space, then the request.
  const renderHireBody = useCallback(
    (context: PublicVenueEntrySlotContext): React.ReactNode =>
      typeof brandSlug === "string" && typeof venueSlug === "string" ? (
        <React.Suspense
          fallback={
            <View style={styles.stateWrap}>
              <ActivityIndicator />
            </View>
          }
        >
          <VenueHirePane
            brandSlug={brandSlug}
            venueSlug={venueSlug}
            offers={context.offers}
            currencyCode={context.currencyCode}
            exponent={context.exponent}
            palette={context.palette}
            theme={context.theme}
            onBookingBarChange={context.onBookingBarChange}
          />
        </React.Suspense>
      ) : null,
    [brandSlug, venueSlug],
  );

  // #4490 P5 — the By the hour tab: place, day, start, length, then checkout.
  const renderHourBody = useCallback(
    (context: PublicVenueEntrySlotContext): React.ReactNode =>
      typeof brandSlug === "string" && typeof venueSlug === "string" ? (
        <React.Suspense
          fallback={
            <View style={styles.stateWrap}>
              <ActivityIndicator />
            </View>
          }
        >
          <VenueHourPane
            brandSlug={brandSlug}
            venueSlug={venueSlug}
            offers={context.offers}
            currencyCode={context.currencyCode}
            exponent={context.exponent}
            palette={context.palette}
            theme={context.theme}
            onBookingBarChange={context.onBookingBarChange}
          />
        </React.Suspense>
      ) : null,
    [brandSlug, venueSlug],
  );

  // #4490 P6 — the Plans tab: monthly plans, then Join.
  const renderPlansBody = useCallback(
    (context: PublicVenueEntrySlotContext & { plans: readonly VenueFeaturePlanView[] }): React.ReactNode =>
      typeof brandSlug === "string" && typeof venueSlug === "string" ? (
        <React.Suspense
          fallback={
            <View style={styles.stateWrap}>
              <ActivityIndicator />
            </View>
          }
        >
          <VenuePlansPane
            brandSlug={brandSlug}
            venueSlug={venueSlug}
            plans={context.plans}
            currencyCode={context.currencyCode}
            exponent={context.exponent}
            palette={context.palette}
            theme={context.theme}
            onBookingBarChange={context.onBookingBarChange}
          />
        </React.Suspense>
      ) : null,
    [brandSlug, venueSlug],
  );

  // #4490 — "What's on": events held at the venue open their public page.
  const handleOpenEvent = useCallback(
    (href: string): void => {
      if (engagementScope !== null) {
        void captureOfferingCta(engagementScope, "view_offering");
      }
      router.push(href as never);
    },
    [engagementScope, router],
  );

  const renderReservationSheet = useCallback(
    (context: PublicVenueReservationSheetContext): React.ReactNode => (
      <PublicVenueReservationSheet
        visible={context.visible}
        onClose={context.onClose}
        onDismissed={context.onDismissed}
        title={context.title}
      >
        {context.children}
      </PublicVenueReservationSheet>
    ),
    [],
  );

  if (routeState === "cold-loading" || featuresPending) {
    return (
      <View style={styles.stateWrap}>
        <ActivityIndicator />
        <Text style={styles.stateText}>Loading venue...</Text>
      </View>
    );
  }

  if (routeState === "cold-error") {
    return (
      <View style={styles.stateWrap}>
        <Text style={styles.stateTitle}>This venue could not load</Text>
        <Text style={styles.stateBody}>
          {Platform.OS === "web"
            ? "Refresh this page or try the link again."
            : "Try the link again in a moment."}
        </Text>
        <View style={styles.coldRetryWrap}>
          <PublicVenueRetryAction
            busy={coldRetryBusy}
            accessibleLabel="Try loading the venue again"
            backgroundColor={color.accent}
            textColor={color.paper}
            focusColor={color.paper}
            focusOffset={3}
            fontWeight="700"
            onPress={handleRetryVenue}
          />
        </View>
      </View>
    );
  }

  if (venue === null || venueViewModel === null) {
    return (
      <PublicVenueNotFound
        brandSlug={typeof brandSlug === "string" ? brandSlug : null}
        brandDisplayName={brandProbeQuery.data?.brand.displayName ?? null}
      />
    );
  }

  const { pageTitle, metaDescription } = publicVenueMeta(venue);
  const canonicalUrl = venuePublicUrl({
    brandSlug: venue.brandSlug,
    venueSlug: venue.slug,
  });

  return (
    <PublicVenueScreen
      venue={venueViewModel}
      discoveryPrice={discoveryPriceQuery.data ?? null}
      menu={menuGroups}
      menuLifecycle={{
        state: menusQuery.isError
          ? "error"
          : menusQuery.isLoading
            ? "loading"
            : "ready",
        isFetching: menusQuery.isFetching,
        onRetry: () => menusQuery.refetch(),
      }}
      reservable={
        reservableQuery.isError || reservableQuery.isLoading
          ? null
          : reservableQuery.data ?? null
      }
      reservabilityState={
        isPublicVenueReservableContractError(reservableQuery.error)
          ? "invalid"
          : reservableQuery.isError
            ? "error"
          : reservableQuery.isLoading
            ? "loading"
            : "ready"
      }
      // #1789 (SPEC #1788 P-46) — a scanned table/room QR carries
      // `?tab=menu&spot={code}&src=qr`. Before this, the ternary accepted ONE
      // value and every scan landed on Overview. `PublicVenueTabs` already
      // falls back to "overview" when the Menu tab is not visible for this
      // venue (`tabs.includes(initialTab)`), so a scan never lands on an empty
      // tab.
      initialTab={
        venueTabFromParam(requestedTab) ??
        (prefill.tab === "reservations" ? "reservations" : "overview")
      }
      features={features}
      onOpenEvent={handleOpenEvent}
      entryBody={renderEntryBody}
      groupsBody={renderGroupsBody}
      hireBody={renderHireBody}
      hourBody={renderHourBody}
      plansBody={renderPlansBody}
      refreshState={
        routeState === "populated-error"
          ? "error"
          : routeState === "populated-refreshing"
            ? "refreshing"
            : "ready"
      }
      refreshErrorVersion={venueQuery.errorUpdatedAt}
      onRetryRefresh={handleRetryVenue}
      onRetryReservability={() => {
        void reservableQuery.refetch();
      }}
      stayState={
        venue.venueCategory !== "stay"
          ? undefined
          : stayQuery.isLoading
            ? "loading"
            : stayQuery.isError
              ? "error"
              : stayQuery.data === null
                ? "unavailable"
                : "ready"
      }
      stayDetail={stayQuery.data ?? null}
      stayQuote={stayQuote}
      safeAreaInsets={insets}
      loadThemeFont={useThemeFont}
      headSlot={
        Platform.OS === "web" ? (
          <Head>
            <title>{pageTitle}</title>
            <meta name="description" content={metaDescription} />
            <meta property="og:title" content={pageTitle} />
            <meta property="og:description" content={metaDescription} />
            <meta property="og:url" content={canonicalUrl} />
            <meta
              property="og:image"
              content={
                venueOgImageUrl({
                  brandSlug: venue.brandSlug,
                  venueSlug: venue.slug,
                  coverMediaUrl:
                    venue.coverMediaType !== "video" ? venue.coverMediaUrl : null,
                })
              }
            />
            <meta property="og:type" content="place" />
            <meta name="twitter:card" content="summary_large_image" />
            <meta name="twitter:title" content={pageTitle} />
            <meta name="twitter:description" content={metaDescription} />
            <link rel="canonical" href={canonicalUrl} />
          </Head>
        ) : null
      }
      bookingBody={renderBookingBody}
      reservationSheet={renderReservationSheet}
      // #1793 — ONE ordering slot, one lazy chunk. The surface owns its own
      // state, so this route imports nothing of ordering at module scope and a
      // visitor to a venue that has never switched ordering on downloads none
      // of it (ORCH-1083: the boot payload is measured, and it is measured for
      // everyone).
      ordering={{
        menuBody: (context: PublicVenueOrderingSlotContext) => (
          <React.Suspense
            fallback={
              /* Never a blank menu pane while the ordering chunk loads —
                 the display-only list IS the honest thing to show. */
              <PublicMenuSections
                groups={context.menu}
                palette={context.palette}
                surface={context.surface}
                theme={context.theme}
              />
            }
          >
            <LazyOrderingSurface
              palette={context.palette}
              surface={context.surface}
              theme={context.theme}
              brandSlug={typeof brandSlug === "string" ? brandSlug : ""}
              venueSlug={typeof venueSlug === "string" ? venueSlug : ""}
              spotCode={spotCode}
              entrySource={entrySource}
              menu={context.menu}
              timezone={venue.timezone}
              // issue #3380 — "Who's ordering?" starts on the venue's country.
              countryCode={venue.countryCode}
              // issue #4420 D-V2 — the basket bar docks at the screen's foot.
              isDesktop={context.isDesktop ?? false}
              bottomInset={context.bottomInset ?? 0}
              onBottomBarChange={context.onBottomBarChange}
            />
          </React.Suspense>
        ),
      }}
      overlays={
        <>
          <ShareModal
            visible={shareModalVisible}
            onClose={() => setShareModalVisible(false)}
            url={canonicalUrl}
            contentKind="venue"
            title={pageTitle}
            description={metaDescription}
          />
          {messageMountReady ? (
          <OptionalFeatureBoundary name="venue-brand-message">
            <VenueBrandMessage
              brandId={venue.brandId}
              brandName={venue.brandName}
              brandSlug={venue.brandSlug}
              venueId={venue.id}
              venueName={venue.name}
              venueSlug={venue.slug}
              theme={venue.theme}
              countryIso={venue.countryCode ?? null}
              onOpener={handleMessageOpener}
            />
          
          </OptionalFeatureBoundary>
          ) : null}
        </>
      }
      onAnalytics={handleAnalytics}
      onShare={handleShare}
      onClose={handleClose}
      onOpenBrand={handleOpenBrand}
      onMessageBrand={messageOpener === null ? undefined : messageOpener.open}
      onOpenMaps={handleOpenMaps}
      onCopyAddress={handleCopyAddress}
    />
  );
}

const styles = StyleSheet.create({
  stateWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space[6],
    backgroundColor: color.canvas,
  },
  stateTitle: {
    color: color.text1,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: space[1],
  },
  stateText: {
    color: color.text2,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  stateBody: {
    color: color.text2,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  coldRetryWrap: {
    marginTop: 16,
  },
});

// issue #4420 — the Host app's real glass for the shared public page.
export default function PublicVenueRoute(): React.ReactElement {
  return (
    <PublicGlassProvider>
      <PublicVenueRouteBody />
    </PublicGlassProvider>
  );
}

/**
 * #4490 — the Host's preview (`app/venue/[venueId]/preview.tsx`) mounts the
 * SAME shared screen and takes it from this route's chunk (a lazy import of
 * this module), so the public venue page is never bundled into a second chunk
 * (which would hoist it into the eager web `__common` chunk). Not a route
 * export: Expo Router reads only the default.
 */
export { PublicVenueScreen };
