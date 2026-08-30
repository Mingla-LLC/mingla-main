import {
  useQueries,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  resolveTheme,
  resolveEventAcquisitionState,
  isThemeAnimationSlug,
  isThemeColor,
  isThemeFontSlug,
  type ResolvedTheme,
  type EventTerminalSource,
  type ThemeInput,
} from "@mingla/offering-rendering";
import type {
  PublicBrand,
  PublicBrandEvent,
  PublicBrandExperience,
  PublicBrandTrip,
  PublicBrandUpcoming,
  PublicBrandVenueSummary,
  PublicMenuGroup,
} from "@mingla/brand-rendering";

import { supabase } from "../services/supabase";
import {
  isDirectEventBundlePayload,
  mapRpcPayloadToPublicEvent,
} from "./usePublicEventBySlug";

export const consumerBrandKeys = {
  all: ["consumerBrand"] as const,
  bySlug: (slug: string) => [...consumerBrandKeys.all, slug] as const,
  venuesBySlug: (slug: string) =>
    [...consumerBrandKeys.all, "venues", slug] as const,
};
export const consumerBrandEventUrl = (event: PublicBrandEvent): string =>
  `https://host.usemingla.com/e/${event.brandSlug}/${event.eventSlug}`;

interface PublicBrandRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  profile_photo_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  social_links: unknown;
  custom_links: unknown;
  address: string | null;
  cover_hue: number;
  cover_media_url: string | null;
  cover_media_type: "image" | "video" | "gif" | null;
  theme_color: string | null;
  theme_font: string | null;
  theme_animation: string | null;
}

interface PublicEventRow {
  id: string;
  brand_id: string;
  brand_slug: string;
  title: string;
  slug: string;
  event_type: "event" | "rsvp" | "trip" | "experience" | null;
  location_text: string | null;
  is_online: boolean;
  cover_media_url: string | null;
  cover_media_type: "image" | "video" | "gif" | null;
  status: "scheduled" | "live" | "ended" | "cancelled";
  public_theme: Record<string, unknown> | null;
  currency: string | null;
  master_start_at: string | null;
  master_end_at: string | null;
  master_timezone: string | null;
}

interface PublicTripRow {
  trip_id: string;
  trip_slug: string;
  brand_slug: string;
  title: string;
  destination_text: string | null;
  cover_media_url: string | null;
  cover_media_type: "image" | "video" | "gif" | null;
  status: "scheduled" | "live" | "ended" | "cancelled";
  start_at: string | null;
  end_at: string | null;
  timezone: string | null;
  bookings_closed: boolean;
  spots_left: number | null;
  min_price_cents: number | null;
  currency: string | null;
  has_free_tier: boolean;
}

interface PublicExperienceRow {
  experience_id: string;
  brand_id: string;
  brand_slug: string;
  brand_name: string;
  experience_slug: string;
  title: string;
  description: string | null;
  cover_media_url: string | null;
  // ORCH-1155 — RPC now returns the experience cover's media type so the
  // in-app brand-page Experiences card plays video/gif covers (SC-9-Native).
  cover_media_type: "image" | "video" | "gif" | null;
  theme: Record<string, unknown> | null;
  venue_text: string | null;
  next_occurrence_at: string | null;
  price_from_cents: number | null;
  currency: string | null;
  is_free: boolean;
  published_at: string;
}

interface PublicUpcomingRow {
  offering_id: string;
  brand_id: string;
  brand_slug: string;
  brand_name: string;
  offering_type: "event" | "rsvp" | "trip" | "experience";
  offering_slug: string;
  title: string;
  description: string | null;
  cover_media_url: string | null;
  cover_media_type: "image" | "video" | "gif" | null;
  theme: Record<string, unknown> | null;
  starts_at: string | null;
  price_from_cents: number | null;
  currency: string | null;
  is_free: boolean;
  published_at: string;
}

export interface ConsumerBrandDetail {
  brand: PublicBrand;
  events: PublicBrandEvent[];
  trips: PublicBrandTrip[];
  experiences: PublicBrandExperience[];
  upcoming: PublicBrandUpcoming[];
  upcomingHasMore: boolean;
  /** ORCH-1186-C — DISPLAY-ONLY menu groups (verified venues only; [] else). */
  menu: PublicMenuGroup[];
  resolvedTheme: ResolvedTheme;
}

interface PublicVenueRow {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  city: string | null;
  cover_media_url: string | null;
  pool_photo_urls: string[] | null;
  place_pool_id: string | null;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asThemeInput = (
  color: unknown,
  font: unknown,
  animation: unknown,
): ThemeInput | null => {
  const out: ThemeInput = {};
  if (isThemeColor(color)) out.color = color;
  if (isThemeFontSlug(font)) out.font = font;
  if (isThemeAnimationSlug(animation)) out.animation = animation;
  return Object.keys(out).length > 0 ? out : null;
};

const splitDescription = (
  description: string | null,
): { tagline?: string; bio?: string } => {
  if (description === null || description.trim().length === 0) return {};
  const [first, ...rest] = description.split(/\n+/).map((s) => s.trim());
  return {
    tagline: first.length > 0 ? first : undefined,
    bio: rest.join("\n").trim() || undefined,
  };
};

const formatDateLine = (
  startAt: string | null,
  timezone: string | null,
): string => {
  if (startAt === null) return "Date TBA";
  const date = new Date(startAt);
  if (Number.isNaN(date.getTime())) return "Date TBA";
  return date.toLocaleDateString("en-GB", {
    timeZone: timezone ?? "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
};

const mapBrand = (row: PublicBrandRow): PublicBrand => {
  const { tagline, bio } = splitDescription(row.description);
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.name,
    address: row.address,
    coverHue: row.cover_hue,
    coverMediaUrl: row.cover_media_url ?? undefined,
    coverMediaType: row.cover_media_type ?? undefined,
    photo: row.profile_photo_url ?? undefined,
    tagline,
    bio,
    contact: {
      ...(row.contact_email ? { email: row.contact_email } : {}),
      ...(row.contact_phone ? { phone: row.contact_phone } : {}),
    },
    theme: asThemeInput(row.theme_color, row.theme_font, row.theme_animation),
  };
};

const mapEvent = (
  row: PublicEventRow,
  tickets: PublicBrandEvent["tickets"],
  terminalSource: EventTerminalSource,
): PublicBrandEvent => {
  const theme = asRecord(row.public_theme);
  const businessEvent = asRecord(theme.business_event);
  return {
    id: row.id,
    name: row.title,
    brandSlug: row.brand_slug,
    eventSlug: row.slug,
    status: row.status,
    eventType: row.event_type === "rsvp" ? "rsvp" : "event",
    operatorEndedAtUtc: null,
    terminalSource,
    masterStartAtUtc: row.master_start_at,
    masterEndAtUtc: row.master_end_at,
    masterTimezone: row.master_timezone,
    dateLine: formatDateLine(row.master_start_at, row.master_timezone),
    venueName: row.location_text,
    format: row.is_online ? "online" : "in_person",
    coverHue:
      typeof businessEvent.coverHue === "number" ? businessEvent.coverHue : 25,
    coverMediaUrl: row.cover_media_url,
    coverMediaType: row.cover_media_type,
    currency: row.currency,
    tickets,
  };
};

const mapTrip = (row: PublicTripRow): PublicBrandTrip => ({
  id: row.trip_id,
  slug: row.trip_slug,
  brandSlug: row.brand_slug,
  title: row.title,
  destinationText: row.destination_text,
  coverMediaUrl: row.cover_media_url,
  coverMediaType: row.cover_media_type,
  status: row.status,
  startAt: row.start_at,
  endAt: row.end_at,
  timezone: row.timezone,
  bookingsClosed: row.bookings_closed,
  spotsLeft: row.spots_left,
  minPriceCents: row.min_price_cents,
  currency: row.currency,
  hasFreeTier: row.has_free_tier,
});

const mapExperience = (row: PublicExperienceRow): PublicBrandExperience => ({
  experienceId: row.experience_id,
  brandId: row.brand_id,
  brandSlug: row.brand_slug,
  brandName: row.brand_name,
  experienceSlug: row.experience_slug,
  name: row.title,
  bio: row.description,
  coverMediaUrl: row.cover_media_url,
  coverMediaType: row.cover_media_type,
  theme: row.theme,
  venueText: row.venue_text,
  nextOccurrenceAt: row.next_occurrence_at,
  priceFromMinorUnits: row.price_from_cents,
  currency: row.currency ?? "USD",
  isFree: row.is_free,
  publishedAt: row.published_at,
});

const mapUpcoming = (row: PublicUpcomingRow): PublicBrandUpcoming => ({
  offeringId: row.offering_id,
  brandId: row.brand_id,
  brandSlug: row.brand_slug,
  brandName: row.brand_name,
  offeringType: row.offering_type,
  offeringSlug: row.offering_slug,
  name: row.title,
  bio: row.description,
  coverMediaUrl: row.cover_media_url,
  coverMediaType: row.cover_media_type,
  theme: row.theme,
  startsAt: row.starts_at,
  priceFromMinorUnits: row.price_from_cents,
  currency: row.currency ?? "USD",
  isFree: row.is_free,
  publishedAt: row.published_at,
});

export const fetchConsumerBrandBySlug = async (
  slug: string,
): Promise<ConsumerBrandDetail | null> => {
  const { data: brandData, error: brandError } = await supabase
    .from("business_public_brands_view")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (brandError !== null) throw brandError;
  if (brandData === null) return null;

  const brand = mapBrand(brandData as PublicBrandRow);
  const [eventResult, tripResult, experienceResult, upcomingResult] =
    await Promise.all([
      supabase
        .from("business_public_events_view")
        .select("*")
        .eq("brand_slug", slug)
        .order("published_at", { ascending: false, nullsFirst: false }),
      supabase.rpc("pg_public_trips_by_brand", { p_brand_slug: slug }),
      supabase.rpc("pg_public_experiences_by_brand", { p_brand_slug: slug }),
      supabase.rpc("pg_public_brand_upcoming", {
        p_brand_slug: slug,
        p_limit: 30,
      }),
    ]);
  if (eventResult.error !== null) throw eventResult.error;
  if (tripResult.error !== null) throw tripResult.error;
  if (experienceResult.error !== null) throw experienceResult.error;
  if (upcomingResult.error !== null) throw upcomingResult.error;

  const nowMs = Date.now();
  const allEventRows = ((eventResult.data ?? []) as PublicEventRow[]).filter(
    (row) =>
      (row.event_type === "event" || row.event_type === "rsvp") &&
      row.status !== "cancelled" &&
      row.status !== "ended",
  );
  const MAX_PUBLIC_BRAND_EVENT_BUNDLE_CONCURRENCY = 4;
  type HydratedConsumerBrandEvent = {
    row: PublicEventRow;
    tickets: PublicBrandEvent["tickets"];
    terminalSource: EventTerminalSource;
    paidOnline: boolean;
  };
  const hydrated: Array<HydratedConsumerBrandEvent | null> = new Array(
    allEventRows.length,
  ).fill(null);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < allEventRows.length) {
      const index = cursor;
      cursor += 1;
      const row = allEventRows[index];
      if (row === undefined) continue;
      if (row.event_type === "rsvp") {
        const terminalSource: EventTerminalSource = {
          kind: "single_end",
          endAtUtc: row.master_end_at,
        };
        const state = resolveEventAcquisitionState(
          {
            operatorStatus: row.status,
            operatorEndedAtUtc: null,
            terminalSource,
          },
          nowMs,
        );
        if (state.kind === "current") {
          hydrated[index] = { row, tickets: [], terminalSource, paidOnline: false };
        }
        continue;
      }

      const { data, error } = await supabase.rpc("pg_direct_event_checkout_bundle", {
        p_event_id: row.id,
        p_brand_slug: null,
        p_event_slug: null,
      });
      if (error !== null) throw error;
      if (data === null) continue;
      if (!isDirectEventBundlePayload(data) || data.id !== row.id) {
        throw new Error("invalid_direct_event_checkout_bundle");
      }
      const canonical = mapRpcPayloadToPublicEvent(data);
      const state = resolveEventAcquisitionState(
        {
          operatorStatus: row.status,
          operatorEndedAtUtc: null,
          terminalSource: canonical.terminalSource,
        },
        nowMs,
      );
      if (state.kind !== "current") continue;
      const tickets: PublicBrandEvent["tickets"] = canonical.event.tickets.map(
        (ticket) => ({
          priceGbp: ticket.priceGbp,
          currency: ticket.currency,
          isFree: ticket.isFree,
          visibility: ticket.visibility,
        }),
      );
      hydrated[index] = {
        row,
        tickets,
        terminalSource: canonical.terminalSource,
        paidOnline: canonical.event.tickets.some(
          (ticket) =>
            (ticket.availableAt === "online" || ticket.availableAt === "both") &&
            !ticket.isFree &&
            (ticket.priceGbp ?? 0) > 0,
        ),
      };
    }
  };
  await Promise.all(
    Array.from(
      {
        length: Math.min(
          MAX_PUBLIC_BRAND_EVENT_BUNDLE_CONCURRENCY,
          allEventRows.length,
        ),
      },
      () => worker(),
    ),
  );
  const current = hydrated.filter(
    (item): item is HydratedConsumerBrandEvent => item !== null,
  );

  // ORCH-1076 I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED — drop PAID events from a
  // brand that can't charge from the consumer brand-page flat-events feed. The
  // view (business_public_events_view) is NOT gated (it also serves keyed
  // enrich), so we filter here, buyer-only. trips/experiences/upcoming come from
  // the server RPCs (A-3/A-4/A-5) and are already gated. One batched
  // pg_brands_can_collect round-trip over the distinct paid brand ids; free
  // events are never dropped. mirrors fetchPublicBrandEvents (mingla-business).
  const paidBrandIds = Array.from(
    new Set(
      current
        .filter((item) => item.paidOnline)
        .map(({ row }) => row.brand_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  );
  let readyBrandIds = new Set<string>();
  if (paidBrandIds.length > 0) {
    const { data: readyData, error: readyError } = await supabase.rpc(
      "pg_brands_can_collect",
      { p_brand_ids: paidBrandIds },
    );
    // Fail closed for paid rows on error (empty set ⇒ all paid rows dropped).
    if (readyError === null) {
      readyBrandIds = new Set<string>(
        ((readyData ?? []) as { brand_id: string }[])
          .map((r) => r.brand_id)
          .filter((id): id is string => typeof id === "string"),
      );
    }
  }
  const rows = current.filter(
    ({ row, paidOnline }) =>
      !paidOnline || readyBrandIds.has(row.brand_id),
  );
  const events = rows.map(({ row, tickets, terminalSource }) =>
    mapEvent(row, tickets, terminalSource),
  );
  const trips = ((tripResult.data ?? []) as PublicTripRow[]).map(mapTrip);
  const experiences = (
    (experienceResult.data ?? []) as PublicExperienceRow[]
  ).map(mapExperience);
  const upcomingRows = (upcomingResult.data ?? []) as PublicUpcomingRow[];
  const upcomingHasMore = upcomingRows.length > 30;
  const upcoming = (
    upcomingHasMore ? upcomingRows.slice(0, 30) : upcomingRows
  ).map(mapUpcoming);
  return {
    brand,
    events,
    trips,
    experiences,
    upcoming,
    upcomingHasMore,
    // Issue #1365: public menus are fetched only after an exact venue resolves.
    menu: [],
    resolvedTheme: resolveTheme(brand.theme, null),
  };
};

const getPublicBrandVenues = async (
  slug: string,
): Promise<PublicBrandVenueSummary[]> => {
  const { data, error } = await supabase
    .from("venue_public_view")
    .select(
      "id, slug, name, address, city, cover_media_url, pool_photo_urls, place_pool_id",
    )
    .eq("brand_slug", slug)
    .order("created_at", { ascending: true });
  if (error !== null) throw error;

  return ((data ?? []) as PublicVenueRow[]).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    address: row.address,
    city: row.city,
    photoUrl:
      row.cover_media_url ??
      (Array.isArray(row.pool_photo_urls)
        ? (row.pool_photo_urls[0] ?? null)
        : null),
    placePoolId: row.place_pool_id,
    reservationState: row.place_pool_id === null ? "unavailable" : "loading",
  }));
};

export const useBrandBySlug = (
  slug: string | null,
): UseQueryResult<ConsumerBrandDetail | null> => {
  const enabled = slug !== null && slug.trim().length > 0;
  return useQuery({
    queryKey: enabled ? consumerBrandKeys.bySlug(slug) : consumerBrandKeys.all,
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!enabled || slug === null) return null;
      return fetchConsumerBrandBySlug(slug);
    },
  });
};

interface PublicBrandVenuesQuery {
  data: PublicBrandVenueSummary[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  refetch: () => void;
}

export const usePublicBrandVenues = (
  slug: string | null,
): PublicBrandVenuesQuery => {
  const enabled = slug !== null && slug.trim().length > 0;
  const venuesQuery = useQuery({
    queryKey: enabled
      ? consumerBrandKeys.venuesBySlug(slug)
      : consumerBrandKeys.all,
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!enabled || slug === null) return [];
      return getPublicBrandVenues(slug);
    },
  });
  const venues = venuesQuery.data ?? [];
  const reservabilityQueries = useQueries({
    queries: venues.map((venue) => ({
      queryKey: [
        ...consumerBrandKeys.venuesBySlug(slug ?? "none"),
        "reservability",
        venue.id,
        venue.placePoolId,
      ],
      enabled: typeof venue.placePoolId === "string",
      staleTime: 60 * 1000,
      queryFn: async (): Promise<
        PublicBrandVenueSummary["reservationState"]
      > => {
        if (typeof venue.placePoolId !== "string") return "unavailable";
        const result = await supabase.rpc("pg_venue_reservable_for_place", {
          p_place_pool_id: venue.placePoolId,
        });
        if (result.error !== null) return "error";
        const resolved = (
          Array.isArray(result.data) ? result.data[0] : result.data
        ) as { reservable?: boolean } | undefined;
        return resolved?.reservable === true ? "available" : "unavailable";
      },
    })),
  });
  const data: PublicBrandVenueSummary[] = venues.map((venue, index) => ({
    ...venue,
    reservationState:
      typeof venue.placePoolId !== "string"
        ? "unavailable"
        : (reservabilityQueries[index]?.data ?? "loading"),
  }));

  return {
    data,
    isLoading: venuesQuery.isLoading,
    isFetching:
      venuesQuery.isFetching ||
      reservabilityQueries.some((query) => query.isFetching),
    isError: venuesQuery.isError,
    refetch: () => {
      void venuesQuery.refetch();
      for (const query of reservabilityQueries) void query.refetch();
    },
  };
};
