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
} from "@mingla/brand-rendering";
import { resolveTheme, type ResolvedTheme } from "@mingla/event-rendering";

import {
  brandOgImageUrl,
  brandPublicUrl,
  eventPublicPath,
  tripPublicPath,
} from "../../constants/publicUrls";
import type {
  PublicExperienceCard,
  PublicTripCard,
  PublicUpcomingRow,
  PublicVenueDetail,
} from "../../services/publicEventsService";
import type { Brand } from "../../store/currentBrandStore";
import type { LiveEvent } from "../../store/liveEventStore";
import { formatDraftDateLine } from "../../utils/eventDateDisplay";

import { ShareModal } from "../ui/ShareModal";

interface PublicBrandPageProps {
  brand: Brand;
  events: LiveEvent[];
  pastEvents?: LiveEvent[];
  trips: PublicTripCard[];
  pastTrips?: PublicTripCard[];
  experiences?: PublicExperienceCard[];
  upcoming?: PublicUpcomingRow[];
  upcomingHasMore?: boolean;
  venue?: PublicVenueDetail | null;
  resolvedTheme?: ResolvedTheme;
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

const mapEvent = (event: LiveEvent): PublicBrandEvent => ({
  id: event.id,
  name: event.name,
  brandSlug: event.brandSlug,
  eventSlug: event.eventSlug,
  status: event.status,
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
  resolvedTheme,
}) => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const theme = useMemo(
    () => resolvedTheme ?? resolveTheme(brand.theme, null),
    [brand.theme, resolvedTheme],
  );
  const sharedBrand = useMemo(() => mapBrand(brand), [brand]);
  const sharedEvents = useMemo(() => events.map(mapEvent), [events]);
  const sharedPastEvents = useMemo(() => pastEvents.map(mapEvent), [pastEvents]);
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
            content={brand.bio?.slice(0, 200) ?? brand.tagline ?? metaDescription}
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
            content={brand.bio?.slice(0, 200) ?? brand.tagline ?? brand.displayName}
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
        events={sharedEvents}
        pastEvents={sharedPastEvents}
        trips={sharedTrips}
        pastTrips={sharedPastTrips}
        experiences={sharedExperiences}
        upcoming={sharedUpcoming}
        upcomingHasMore={upcomingHasMore}
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
        callbacks={{
          onClose: handleClose,
          onShare: () => setShareModalVisible(true),
          onOpenEvent: handleOpenEvent,
          onOpenTrip: handleOpenTrip,
          onOpenExperience: handleOpenExperience,
          onOpenUpcoming: handleOpenUpcoming,
        }}
      />
      <ShareModal
        visible={shareModalVisible}
        onClose={() => setShareModalVisible(false)}
        url={canonicalUrl(brand)}
        title={`${brand.displayName} on Mingla`}
        description={brand.bio?.slice(0, 200) ?? brand.tagline}
      />
    </>
  );
};
