import React, { useCallback, useMemo, useState } from "react";
import { Platform } from "react-native";
import { useRouter } from "expo-router";
import Head from "expo-router/head";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  PublicBrandPage as SharedPublicBrandPage,
  type PublicBrand,
  type PublicBrandEvent,
  type PublicBrandExperience,
  type PublicBrandTrip,
  type PublicBrandUpcoming,
  type PublicBrandVenueSummary,
  type PublicMenuGroup,
} from "@mingla/brand-rendering";
import { resolveTheme, type ResolvedTheme } from "@mingla/offering-rendering";
import { captureWeb } from "../../analytics/webAnalytics";

import {
  brandOgImageUrl,
  brandPublicUrl,
  eventPublicPath,
  tripPublicPath,
  venuePublicPath,
} from "../../constants/publicUrls";
import type {
  PublicExperienceCard,
  PublicTripCard,
  PublicUpcomingRow,
  PublicVenueDetail,
  PublicEventRecord,
} from "../../services/publicEventsService";
import type { Brand } from "../../store/currentBrandStore";
import type { LiveEvent } from "../../store/liveEventStore";
import { formatDraftDateLine } from "../../utils/eventDateDisplay";
import { shareCanonicalPublicPageOnWeb } from "../../utils/shareCanonicalPublicPageOnWeb";
import { useThemeFont } from "../../theme/useThemeFont";

import { ShareModal } from "../ui/ShareModal";

interface PublicBrandPageProps {
  brand: Brand;
  events: PublicEventRecord[];
  pastEvents?: LiveEvent[];
  trips: PublicTripCard[];
  pastTrips?: PublicTripCard[];
  experiences?: PublicExperienceCard[];
  upcoming?: PublicUpcomingRow[];
  upcomingHasMore?: boolean;
  venue?: PublicVenueDetail | null;
  /**
   * Issue #1365 — verified venues for the Reservations tab, mapped from the
   * anon-safe venue_public_view by the route.
   */
  venues?: PublicBrandVenueSummary[];
  venuesLoadState?: "loading" | "ready" | "error";
  onRetryVenues?: () => void;
  /** ORCH-1186-C — DISPLAY-ONLY menu groups (shared shape; passed through). */
  menu?: PublicMenuGroup[];
  resolvedTheme?: ResolvedTheme;
  useDirectionCIdentity?: boolean;
}

const canonicalUrl = (brand: Brand): string => brandPublicUrl(brand.slug);

const mapBrand = (brand: Brand): PublicBrand => ({
  id: brand.id,
  slug: brand.slug,
  displayName: brand.displayName,
  address: brand.address,
  coverHue: brand.coverHue,
  coverMediaUrl: brand.coverMediaUrl,
  coverMediaType: brand.coverMediaType,
  photo: brand.photo,
  bio: brand.bio,
  tagline: brand.tagline,
  links: brand.links,
  contact: brand.contact,
  theme: brand.theme,
});

const mapEvent = (event: PublicEventRecord): PublicBrandEvent => ({
  id: event.id,
  name: event.name,
  brandSlug: event.brandSlug,
  eventSlug: event.eventSlug,
  status: event.status,
  eventType: event.event_type === "rsvp" ? "rsvp" : "event",
  operatorEndedAtUtc: null,
  terminalSource: event.terminalSource,
  masterStartAtUtc: event.masterStartAtUtc ?? null,
  masterEndAtUtc: event.masterEndAtUtc ?? null,
  masterTimezone: event.timezone,
  dateLine: formatDraftDateLine(event),
  venueName: event.venueName,
  format: event.format,
  coverHue: event.coverHue,
  coverMediaUrl: event.coverMediaUrl,
  coverMediaType: event.coverMediaType,
  currency: event.currency,
  // ORCH-1006 Slice 3 — prefer server-computed all-in for "From £X".
  displayPriceCents: event.displayPriceCents ?? null,
  displayCurrency: event.displayCurrency ?? null,
  tickets: event.tickets.map((ticket) => ({
    priceGbp: ticket.priceGbp,
    currency: ticket.currency,
    isFree: ticket.isFree,
    visibility: ticket.visibility,
  })),
});

const mapTrip = (trip: PublicTripCard): PublicBrandTrip => ({
  id: trip.id,
  slug: trip.slug,
  brandSlug: trip.brandSlug,
  title: trip.title,
  destinationText: trip.destinationText,
  coverMediaUrl: trip.coverMediaUrl,
  coverMediaType: trip.coverMediaType,
  status: trip.status,
  startAt: trip.startAt,
  endAt: trip.endAt,
  timezone: trip.timezone,
  bookingsClosed: trip.bookingsClosed,
  spotsLeft: trip.spotsLeft,
  minPriceCents: trip.minPriceCents,
  currency: trip.currency,
  hasFreeTier: trip.hasFreeTier,
});

const mapExperience = (
  experience: PublicExperienceCard,
): PublicBrandExperience => ({
  experienceId: experience.experienceId,
  brandId: experience.brandId,
  brandSlug: experience.brandSlug,
  brandName: experience.brandName,
  experienceSlug: experience.experienceSlug,
  name: experience.name,
  bio: experience.bio,
  coverMediaUrl: experience.coverMediaUrl,
  // ORCH-1155 — thread the experience cover media type to the shared card.
  coverMediaType: experience.coverMediaType,
  theme: experience.theme,
  venueText: experience.venueText,
  nextOccurrenceAt: experience.nextOccurrenceAt,
  priceFromMinorUnits: experience.priceFromMinorUnits,
  currency: experience.currency,
  isFree: experience.isFree,
  publishedAt: experience.publishedAt,
});

const mapUpcoming = (item: PublicUpcomingRow): PublicBrandUpcoming => ({
  offeringId: item.offeringId,
  brandId: item.brandId,
  brandSlug: item.brandSlug,
  brandName: item.brandName,
  offeringType: item.offeringType,
  offeringSlug: item.offeringSlug,
  name: item.name,
  bio: item.bio,
  coverMediaUrl: item.coverMediaUrl,
  coverMediaType: item.coverMediaType,
  theme: item.theme,
  startsAt: item.startsAt,
  priceFromMinorUnits: item.priceFromMinorUnits,
  currency: item.currency,
  isFree: item.isFree,
  publishedAt: item.publishedAt,
});

export const PublicBrandPage: React.FC<PublicBrandPageProps> = ({
  brand,
  events,
  pastEvents = [],
  trips,
  pastTrips = [],
  experiences = [],
  upcoming = [],
  upcomingHasMore = false,
  venue = null,
  venues = [],
  venuesLoadState = "ready",
  onRetryVenues,
  menu = [],
  resolvedTheme,
  useDirectionCIdentity = false,
}) => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const theme = useMemo(
    () => resolvedTheme ?? resolveTheme(brand.theme, null),
    [brand.theme, resolvedTheme],
  );
  // ORCH-1083: load this brand's theme font on demand (no longer eager at root).
  useThemeFont(theme.fontFamilyValue);
  const sharedBrand = useMemo(() => mapBrand(brand), [brand]);
  const sharedEvents = useMemo(() => events.map(mapEvent), [events]);
  void pastEvents;
  const sharedTrips = useMemo(() => trips.map(mapTrip), [trips]);
  const sharedPastTrips = useMemo(() => pastTrips.map(mapTrip), [pastTrips]);
  const sharedExperiences = useMemo(
    () => experiences.map(mapExperience),
    [experiences],
  );
  const sharedUpcoming = useMemo(() => upcoming.map(mapUpcoming), [upcoming]);

  const handleClose = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/" as never);
    }
  }, [router]);

  const handleShare = useCallback((): void => {
    if (Platform.OS === "web") {
      void shareCanonicalPublicPageOnWeb({
        url: canonicalUrl(brand),
        title: `${brand.displayName} on Mingla`,
        description: brand.bio?.slice(0, 200) ?? brand.tagline ?? undefined,
      });
      return;
    }
    setShareModalVisible(true);
  }, [brand]);

  const handleOpenEvent = useCallback(
    (event: PublicBrandEvent): void => {
      router.push(
        eventPublicPath({
          brandSlug: event.brandSlug,
          eventSlug: event.eventSlug,
        }) as never,
      );
    },
    [router],
  );

  const handleOpenTrip = useCallback(
    (trip: PublicBrandTrip): void => {
      router.push(
        tripPublicPath({
          brandSlug: trip.brandSlug,
          tripSlug: trip.slug,
        }) as never,
      );
    },
    [router],
  );

  const handleOpenExperience = useCallback(
    (experience: PublicBrandExperience): void => {
      router.push(
        `/exp/${experience.brandSlug}/${experience.experienceSlug}` as never,
      );
    },
    [router],
  );

  // Issue #1365 — Reservations card tap → the per-venue public page.
  const handleOpenVenue = useCallback(
    (item: PublicBrandVenueSummary): void => {
      captureWeb("brand_venue_selected", {
        surface: Platform.OS === "web" ? "buyer_web" : "business_preview",
        brand_id: brand.id,
        venue_id: item.id,
        reservable_state: item.reservationState ?? "error",
        source_tab: "reservations",
      });
      const path = venuePublicPath({
        brandSlug: brand.slug,
        venueSlug: item.slug,
      });
      router.push(
        `${path}${item.reservationState === "available" ? "?tab=reservations" : ""}` as never,
      );
    },
    [brand.id, brand.slug, router],
  );

  const handleOpenUpcoming = useCallback(
    (item: PublicBrandUpcoming): void => {
      if (item.offeringType === "trip") {
        router.push(
          tripPublicPath({
            brandSlug: item.brandSlug,
            tripSlug: item.offeringSlug,
          }) as never,
        );
        return;
      }
      if (item.offeringType === "experience") {
        router.push(`/exp/${item.brandSlug}/${item.offeringSlug}` as never);
        return;
      }
      router.push(
        eventPublicPath({
          brandSlug: item.brandSlug,
          eventSlug: item.offeringSlug,
        }) as never,
      );
    },
    [router],
  );

  const pageTitle =
    venue?.isVerifiedVenue === true && venue.city !== null
      ? `${brand.displayName} · ${venue.city} on Mingla`
      : `${brand.displayName} on Mingla`;
  const metaDescription =
    brand.bio?.slice(0, 160) ??
    brand.tagline ??
    (venue?.isVerifiedVenue === true && venue.city !== null
      ? `${brand.displayName} in ${venue.city}`
      : brand.displayName);

  return (
    <>
      {Platform.OS === "web" ? (
        <Head>
          <title>{pageTitle}</title>
          <meta name="description" content={metaDescription} />
          <meta property="og:title" content={pageTitle} />
          <meta
            property="og:description"
            content={
              brand.bio?.slice(0, 200) ?? brand.tagline ?? metaDescription
            }
          />
          <meta property="og:url" content={canonicalUrl(brand)} />
          <meta
            property="og:image"
            content={brandOgImageUrl({
              brandSlug: brand.slug,
              profilePhotoUrl: brand.photo,
            })}
          />
          <meta property="og:type" content="profile" />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={brand.displayName} />
          <meta
            name="twitter:description"
            content={
              brand.bio?.slice(0, 200) ?? brand.tagline ?? brand.displayName
            }
          />
          <meta
            name="twitter:image"
            content={brandOgImageUrl({
              brandSlug: brand.slug,
              profilePhotoUrl: brand.photo,
            })}
          />
          <link rel="canonical" href={canonicalUrl(brand)} />
        </Head>
      ) : null}
      <SharedPublicBrandPage
        brand={sharedBrand}
        useDirectionCIdentity={useDirectionCIdentity}
        events={sharedEvents}
        trips={sharedTrips}
        pastTrips={sharedPastTrips}
        experiences={sharedExperiences}
        upcoming={sharedUpcoming}
        upcomingHasMore={upcomingHasMore}
        menu={menu}
        venues={venues}
        venuesLoadState={venuesLoadState}
        venue={
          venue === null
            ? null
            : {
                isVerifiedVenue: true,
                city: venue.city,
                venueCategory: venue.venueCategory,
              }
        }
        theme={theme}
        chromeTopOffset={insets.top + 8}
        contentBottomInset={insets.bottom + 24}
        callbacks={{
          onClose: handleClose,
          onShare: handleShare,
          onOpenEvent: handleOpenEvent,
          onOpenTrip: handleOpenTrip,
          onOpenExperience: handleOpenExperience,
          onOpenUpcoming: handleOpenUpcoming,
          onOpenVenue: handleOpenVenue,
          onRetryVenues,
          onReservationsTabViewed: () => {
            captureWeb("brand_reservations_tab_viewed", {
              surface: Platform.OS === "web" ? "buyer_web" : "business_preview",
              brand_id: brand.id,
              venue_count: venues.length,
            });
          },
        }}
      />
      <ShareModal
        visible={shareModalVisible}
        onClose={() => setShareModalVisible(false)}
        url={canonicalUrl(brand)}
        contentKind="brand"
        title={`${brand.displayName} on Mingla`}
        description={brand.bio?.slice(0, 200) ?? brand.tagline}
      />
    </>
  );
};
