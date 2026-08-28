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
import { PublicMenuSections } from "@mingla/brand-rendering/PublicMenuSections";
import {
  publicVenueMeta,
  type PublicVenueAnalyticsEvent,
  type PublicVenueBookingSlotContext,
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
import { copyAddressText } from "../../../../src/utils/copyAddressText";

import {
  spacing,
  text as textTokens,
} from "../../../../src/constants/designSystem";
// META-ORCH-1187 LEG 2 — buyer-web public-offering view capture (web-only).
import {
  captureAdClickIds,
  captureWeb,
} from "../../../../src/analytics/webAnalytics";
import {
  usePublicBrandBySlug,
  usePublicVenueBySlug,
  usePublicVenueDiscoveryPrice,
  usePublicVenueReservable,
} from "../../../../src/hooks/usePublicEvents";
import { usePublicMenus } from "../../../../src/hooks/useMenus";
import { usePublicStayDetail } from "../../../../src/hooks/usePublicStayDetail";
import { reportNonFatal } from "../../../../src/diagnostics/reportNonFatal";
import { PublicVenueNotFound } from "../../../../src/components/venue/PublicVenueNotFound";
import { PublicVenueReservationSheet } from "../../../../src/components/venue/PublicVenueReservationSheet";
import { GuestVenueReservation } from "../../../../src/components/venue/GuestVenueReservation";
import { ShareModal } from "../../../../src/components/ui/ShareModal";
import { useThemeFont } from "../../../../src/theme/useThemeFont";
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

// #1390: Stay booking includes its own renderer and Stripe Payment Element.
// Keep that product-specific bulk off the shared buyer-web boot path and load it
// only after a verified Stay venue reaches its reservations surface.
const BuyerStayGuestExperience = React.lazy(() =>
  import("../../../../src/components/stay/BuyerStayGuestExperience").then(
    (module) => ({ default: module.BuyerStayGuestExperience }),
  ),
);

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

/** `PublicVenue` (this app's read model) → the shared screen's view model. */
const toVenueViewModel = (venue: PublicVenue): PublicVenueViewModel => ({
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

export default function PublicVenueRoute(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [shareModalVisible, setShareModalVisible] = React.useState(false);
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
  const stayQuery = usePublicStayDetail(
    venue?.id ?? null,
    venue?.venueCategory === "stay",
  );

  // Exact venue-owned menu — fetched only once the venue resolves (a
  // not-found page needs no menu round-trip).
  const menusQuery = usePublicMenus(
    venue !== null &&
        venue.venueCategory !== "stay" &&
        typeof brandSlug === "string"
      ? brandSlug
      : null,
    venue !== null &&
        venue.venueCategory !== "stay" &&
        typeof venueSlug === "string"
      ? venueSlug
      : null,
  );

  // §6.7 reserve display gate — place-keyed, anon-safe. Disabled without a
  // linked place; error → not reservable (fail closed, no dead CTA).
  const reservableQuery = usePublicVenueReservable(
    venue?.venueCategory === "stay" ? null : venue?.placePoolId ?? null,
  );
  const discoveryPriceQuery = usePublicVenueDiscoveryPrice(
    venue?.venueCategory === "stay" ? null : venue?.placePoolId ?? null,
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
    !venueQuery.isLoading && !venueQuery.isError && venue === null;
  const brandProbeQuery = usePublicBrandBySlug(
    venueMissing && typeof brandSlug === "string" ? brandSlug : null,
  );

  // META-ORCH-1187 LEG 2 — fire `web_public_offering_viewed` once on mount.
  // Web-only (no-op on native).
  const viewFiredRef = useRef<boolean>(false);
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
        runBuyerVenueOrganicCapture(analyticsSurface, () => {
          void captureVenueOrganicEvent(
            { brandId: settleBrandId, venueId: settleVenueId },
            "reservation_start",
          );
        });
      }
    },
    [settleBrandId, settleVenueId],
  );

  // issue #2468 — was a google TEXT search on the venue's address string, which
  // the provider re-geocoded. The shared screen now hands us the venue's stored
  // lat/lng (the same pair its static map is drawn from) and the link is
  // anchored on it.
  const handleOpenMaps = useCallback(
    (target: MapsOpenTarget, app?: MapsAppId): void => {
      // issue #2508 — `app` is the guest's choice from the shared chooser;
      // undefined means nothing was asked (the exact #2468 path).
      openMapsTarget(target, { app });
    },
    [],
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
    router.push(brandPublicPath(brandSlug) as never);
  }, [brandSlug, router]);

  const handleClose = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (typeof brandSlug !== "string") return;
    router.replace(brandPublicPath(brandSlug) as never);
  }, [brandSlug, router]);

  const handleShare = useCallback((): void => {
    if (
      Platform.OS === "web" &&
      venue !== null &&
      typeof brandSlug === "string" &&
      typeof venueSlug === "string"
    ) {
      const { pageTitle, metaDescription } = publicVenueMeta(venue);
      void shareCanonicalPublicPageOnWeb({
        url: venuePublicUrl({ brandSlug, venueSlug }),
        title: pageTitle,
        description: metaDescription,
      });
      return;
    }
    setShareModalVisible(true);
  }, [brandSlug, venue, venueSlug]);

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
        />
      ) : (
        <GuestVenueReservation
          venueId={context.venueId}
          brandId={context.brandId}
          currency={context.currency}
          analyticsSurface={analyticsSurface}
          // issue #1564 — the slot has always carried the resolved palette (the
          // Stay branch two lines up already used it); the table branch simply
          // never read it, and painted Mingla orange on every brand's page.
          palette={context.palette}
        />
      ),
    [],
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

  if (venueQuery.isLoading || venueQuery.isFetching) {
    return (
      <View style={styles.stateWrap}>
        <ActivityIndicator />
        <Text style={styles.stateText}>Loading venue...</Text>
      </View>
    );
  }

  if (venueQuery.isError) {
    return (
      <View style={styles.stateWrap}>
        <Text style={styles.stateTitle}>This venue could not load</Text>
        <Text style={styles.stateText}>
          Refresh this page or try the link again.
        </Text>
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
        requestedTab === "menu"
          ? "menu"
          : requestedTab === "reservations"
            ? "reservations"
            : "overview"
      }
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
            />
          </React.Suspense>
        ),
      }}
      overlays={
        <ShareModal
          visible={shareModalVisible}
          onClose={() => setShareModalVisible(false)}
          url={canonicalUrl}
          contentKind="venue"
          title={pageTitle}
          description={metaDescription}
        />
      }
      onAnalytics={handleAnalytics}
      onShare={handleShare}
      onClose={handleClose}
      onOpenBrand={handleOpenBrand}
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
    padding: spacing.lg,
    backgroundColor: "#0c0e12",
  },
  stateTitle: {
    color: textTokens.primary,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: spacing.xs,
  },
  stateText: {
    color: textTokens.secondary,
    fontSize: 14,
    textAlign: "center",
  },
});
