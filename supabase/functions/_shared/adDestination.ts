import { PRODUCTION_BUSINESS_WEB_ORIGIN } from "./businessWebOrigin.ts";

/** toward #3697 Wave 1 A4 + Wave 4 B1 marketing (usemingla.com). */
export type DestinationPageType =
  | "event"
  | "rsvp"
  | "trip"
  | "experience"
  | "brand"
  | "venue"
  | "reservation"
  | "site"
  | "marketing";

export const AD_DESTINATION_PAGE_TYPES: readonly DestinationPageType[] = [
  "event",
  "rsvp",
  "trip",
  "experience",
  "brand",
  "venue",
  "reservation",
  "site",
  "marketing",
] as const;

/** Canonical marketing origin — mirrors mingla-marketing/lib/site.ts SITE_ORIGIN. */
export const MARKETING_WEB_ORIGIN = "https://usemingla.com";

/**
 * Sentinel brand_slug for Mingla-owned marketing pages (not a Host brand).
 * Create/persist must keep brand_id NULL for marketing — never resolve this
 * slug through brands (hosts can own a colliding slug).
 */
export const MARKETING_BRAND_SLUG = "mingla";

/**
 * Bootstrap fallback for deployments/mocks that predate the destination
 * registry. Production resolution is database-owned so future
 * usemingla.com/* pages do not require an Edge release.
 */
export const MARKETING_ROUTES: readonly {
  slug: string;
  path: string;
  title: string;
  result_kind: "clicks" | "installs";
  id: string;
}[] = [
  {
    slug: "explorer",
    path: "/",
    title: "Mingla Explorer home",
    result_kind: "installs",
    id: "36970000-0004-4000-8000-000000000001",
  },
  {
    slug: "host",
    path: "/host",
    title: "Mingla Host home",
    result_kind: "installs",
    id: "36970000-0004-4000-8000-000000000002",
  },
  {
    slug: "download",
    path: "/download",
    title: "Explorer app download",
    result_kind: "installs",
    id: "36970000-0004-4000-8000-000000000003",
  },
  {
    slug: "host-download",
    path: "/host/download",
    title: "Host app download",
    result_kind: "installs",
    id: "36970000-0004-4000-8000-000000000004",
  },
  {
    slug: "tools",
    path: "/tools",
    title: "Free Host tools",
    result_kind: "clicks",
    id: "36970000-0004-4000-8000-000000000005",
  },
  {
    slug: "tools-events",
    path: "/tools/events",
    title: "Event turnout tool",
    result_kind: "clicks",
    id: "36970000-0004-4000-8000-000000000006",
  },
  {
    slug: "tools-venues",
    path: "/tools/venues",
    title: "Venue grader tool",
    result_kind: "clicks",
    id: "36970000-0004-4000-8000-000000000007",
  },
  {
    slug: "tools-trips",
    path: "/tools/trips",
    title: "Trip quote tool",
    result_kind: "clicks",
    id: "36970000-0004-4000-8000-000000000008",
  },
  {
    slug: "tools-pricing",
    path: "/tools/pricing",
    title: "Pricing audit tool",
    result_kind: "clicks",
    id: "36970000-0004-4000-8000-000000000009",
  },
  // #4339 round B — the seven Host landing pages and the ten city pages
  // (ids match migration 20280522004339_issue_4339_ad_marketing_destinations).
  {
    slug: "host-events",
    path: "/host/events",
    title: "Mingla Host for Event organisers",
    result_kind: "installs",
    id: "43390000-0001-4000-8000-000000000001",
  },
  {
    slug: "host-trips",
    path: "/host/trips",
    title: "Mingla Host for Trip operators",
    result_kind: "installs",
    id: "43390000-0001-4000-8000-000000000002",
  },
  {
    slug: "host-experiences",
    path: "/host/experiences",
    title: "Mingla Host for Experience hosts",
    result_kind: "installs",
    id: "43390000-0001-4000-8000-000000000003",
  },
  {
    slug: "host-restaurants",
    path: "/host/restaurants",
    title: "Mingla Host for Restaurants",
    result_kind: "installs",
    id: "43390000-0001-4000-8000-000000000004",
  },
  {
    slug: "host-hotels",
    path: "/host/hotels",
    title: "Mingla Host for Hotels & resorts",
    result_kind: "installs",
    id: "43390000-0001-4000-8000-000000000005",
  },
  {
    slug: "host-art",
    path: "/host/art",
    title: "Mingla Host for Galleries & art spaces",
    result_kind: "installs",
    id: "43390000-0001-4000-8000-000000000006",
  },
  {
    slug: "host-play",
    path: "/host/play",
    title: "Mingla Host for Play & games",
    result_kind: "installs",
    id: "43390000-0001-4000-8000-000000000007",
  },
  {
    slug: "city-lagos",
    path: "/cities/lagos",
    title: "Things to do in Lagos",
    result_kind: "installs",
    id: "43390000-0001-4000-8000-000000000008",
  },
  {
    slug: "city-durham-nc",
    path: "/cities/durham-nc",
    title: "Things to do in Durham",
    result_kind: "installs",
    id: "43390000-0001-4000-8000-000000000009",
  },
  {
    slug: "city-cary-nc",
    path: "/cities/cary-nc",
    title: "Things to do in Cary",
    result_kind: "installs",
    id: "43390000-0001-4000-8000-000000000010",
  },
  {
    slug: "city-raleigh-nc",
    path: "/cities/raleigh-nc",
    title: "Things to do in Raleigh",
    result_kind: "installs",
    id: "43390000-0001-4000-8000-000000000011",
  },
  {
    slug: "city-new-york-city",
    path: "/cities/new-york-city",
    title: "Things to do in New York City",
    result_kind: "installs",
    id: "43390000-0001-4000-8000-000000000012",
  },
  {
    slug: "city-brussels",
    path: "/cities/brussels",
    title: "Things to do in Brussels",
    result_kind: "installs",
    id: "43390000-0001-4000-8000-000000000013",
  },
  {
    slug: "city-paris",
    path: "/cities/paris",
    title: "Things to do in Paris",
    result_kind: "installs",
    id: "43390000-0001-4000-8000-000000000014",
  },
  {
    slug: "city-london",
    path: "/cities/london",
    title: "Things to do in London",
    result_kind: "installs",
    id: "43390000-0001-4000-8000-000000000015",
  },
  {
    slug: "city-fort-lauderdale",
    path: "/cities/fort-lauderdale",
    title: "Things to do in Fort Lauderdale",
    result_kind: "installs",
    id: "43390000-0001-4000-8000-000000000016",
  },
  {
    slug: "city-washington-dc",
    path: "/cities/washington-dc",
    title: "Things to do in Washington, DC",
    result_kind: "installs",
    id: "43390000-0001-4000-8000-000000000017",
  },
] as const;

export function marketingRouteBySlug(slug: string | null | undefined) {
  if (!slug) return null;
  const key = slug.trim().toLowerCase();
  return MARKETING_ROUTES.find((r) => r.slug === key) ?? null;
}

/** Map a browser pathname on usemingla.com to an allowlisted marketing slug. */
export function marketingSlugFromPathname(
  pathname: string | null | undefined,
): string | null {
  if (!pathname) return null;
  let path = pathname.trim();
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/+$/, "") || "/";
  const hit = MARKETING_ROUTES.find((r) => r.path === path);
  return hit?.slug ?? null;
}

export interface DestinationDescriptor {
  page_type: DestinationPageType;
  brand_slug: string;
  entity_slug?: string;
}

export interface ResolvedAdDestination {
  page_type: DestinationPageType;
  brand_slug: string;
  entity_slug: string | null;
  event_id: string | null;
  venue_id: string | null;
  canonical_url: string;
  availability?: string;
  availability_reason?: string | null;
  result_kind?: string | null;
  /**
   * #4238: dated offerings only. The next bookable date, the last moment
   * anyone can still book, how many dates are left, and the offering's own
   * time zone. An ad on a series covers every date and ends by last_bookable_at.
   */
  next_date?: string | null;
  last_bookable_at?: string | null;
  dates_remaining?: number | null;
  timezone?: string | null;
}

export class AdDestinationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "AdDestinationError";
    this.code = code;
    this.status = status;
  }
}

interface QueryResult {
  data: Record<string, unknown> | null;
  error: { message: string } | null;
}

interface QueryLike {
  eq(column: string, value: unknown): QueryLike;
  in(column: string, values: readonly unknown[]): QueryLike;
  maybeSingle(): Promise<QueryResult>;
}

export interface AdDestinationDb {
  from(table: string): { select(columns: string): QueryLike };
  rpc?(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DESTINATION_KEYS = new Set(["page_type", "brand_slug", "entity_slug"]);
const ENTITY_TYPES = new Set<DestinationPageType>([
  "event",
  "rsvp",
  "trip",
  "experience",
  "venue",
  // Reservation ads land on the public venue page that accepts reservations
  // (`/b/{brand}/v/{venue}`), not `/reserve/{brandId}` (payment-cancel return).
  "reservation",
  // toward #3697 Wave 4 — entity_slug is the marketing route key.
  "marketing",
]);

/**
 * #4238: the descriptor a create call sends: page_type, brand_slug and
 * entity_slug only. A plan's canonical destination is the full resolver
 * result, which requireDescriptor refuses (destination_descriptor_unknown_field).
 */
export function destinationDescriptorOf(
  destination: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of DESTINATION_KEYS) {
    const value = destination?.[key];
    if (typeof value === "string" && value.trim()) out[key] = value;
  }
  return out;
}

function requireDescriptor(input: unknown): DestinationDescriptor {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AdDestinationError(
      "destination_page_type_invalid",
      400,
      "Destination must name a public page.",
    );
  }
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!DESTINATION_KEYS.has(key)) {
      throw new AdDestinationError(
        "destination_descriptor_unknown_field",
        400,
        `Destination field "${key}" is not accepted.`,
      );
    }
  }
  const pageType = raw.page_type;
  if (
    typeof pageType !== "string" ||
    !(AD_DESTINATION_PAGE_TYPES as readonly string[]).includes(pageType)
  ) {
    throw new AdDestinationError(
      "destination_page_type_invalid",
      400,
      "Destination page_type must be a supported Ads page type.",
    );
  }
  const typed = pageType as DestinationPageType;
  const entitySlug = typeof raw.entity_slug === "string"
    ? raw.entity_slug.trim()
    : "";

  // Marketing: brand_slug is the Mingla sentinel; entity_slug selects the route.
  if (typed === "marketing") {
    const brandSlugRaw = typeof raw.brand_slug === "string"
      ? raw.brand_slug.trim().toLowerCase()
      : "";
    const brandSlug = brandSlugRaw || MARKETING_BRAND_SLUG;
    if (brandSlug !== MARKETING_BRAND_SLUG) {
      throw new AdDestinationError(
        "destination_brand_slug_invalid",
        400,
        "Marketing destinations use the mingla brand sentinel.",
      );
    }
    if (!entitySlug || entitySlug.length > 200 || !SLUG.test(entitySlug)) {
      throw new AdDestinationError(
        "destination_entity_slug_invalid",
        400,
        "Choose a registered marketing landing page.",
      );
    }
    return {
      page_type: "marketing",
      brand_slug: MARKETING_BRAND_SLUG,
      entity_slug: entitySlug.toLowerCase(),
    };
  }

  const brandSlug = typeof raw.brand_slug === "string"
    ? raw.brand_slug.trim()
    : "";
  if (!brandSlug) {
    throw new AdDestinationError(
      "destination_brand_slug_required",
      400,
      "Choose a public brand destination.",
    );
  }
  if (brandSlug.length > 160 || !SLUG.test(brandSlug)) {
    throw new AdDestinationError(
      "destination_brand_slug_invalid",
      400,
      "The brand slug is invalid.",
    );
  }
  if (ENTITY_TYPES.has(typed)) {
    if (!entitySlug) {
      throw new AdDestinationError(
        "destination_entity_slug_required",
        400,
        "Choose a public page destination.",
      );
    }
    if (entitySlug.length > 200 || !SLUG.test(entitySlug)) {
      throw new AdDestinationError(
        "destination_entity_slug_invalid",
        400,
        "The page slug is invalid.",
      );
    }
  } else if (entitySlug) {
    throw new AdDestinationError(
      "destination_entity_slug_forbidden",
      400,
      "This destination type must not include an entity slug.",
    );
  }
  return {
    page_type: typed,
    brand_slug: brandSlug,
    ...(entitySlug ? { entity_slug: entitySlug } : {}),
  };
}

function businessWebOrigin(): string {
  return (Deno.env.get("BUSINESS_WEB_ORIGIN") ?? "").trim() ||
    PRODUCTION_BUSINESS_WEB_ORIGIN;
}

/** Canonical URL shapes (A4-5): trips `/t/`, experiences `/exp/`, never `/e/`. */
export function canonicalAdDestinationUrl(
  pageType: DestinationPageType,
  brandSlug: string,
  entitySlug: string | null,
  opts?: { brandId?: string | null; siteHostname?: string | null },
): string {
  const origin = businessWebOrigin();
  switch (pageType) {
    case "trip":
      return `${origin}/t/${brandSlug}/${entitySlug as string}`;
    case "experience":
      return `${origin}/exp/${brandSlug}/${entitySlug as string}`;
    case "event":
    case "rsvp":
      return `${origin}/e/${brandSlug}/${entitySlug as string}`;
    case "venue":
      return `${origin}/b/${brandSlug}/v/${entitySlug as string}`;
    case "brand":
      return `${origin}/b/${brandSlug}`;
    case "reservation":
      // Same public venue URL as Stay; result_kind differs (sign-ups).
      return `${origin}/b/${brandSlug}/v/${entitySlug as string}`;
    case "site":
      return `https://${opts?.siteHostname as string}`;
    case "marketing": {
      const route = marketingRouteBySlug(entitySlug);
      if (!route) {
        throw new AdDestinationError(
          "destination_entity_slug_invalid",
          400,
          "Choose an allowlisted marketing landing page.",
        );
      }
      return route.path === "/"
        ? `${MARKETING_WEB_ORIGIN}/`
        : `${MARKETING_WEB_ORIGIN}${route.path}`;
    }
  }
}

function resolveMarketingDestination(
  descriptor: DestinationDescriptor,
): ResolvedAdDestination {
  const route = marketingRouteBySlug(descriptor.entity_slug);
  if (!route) {
    throw new AdDestinationError(
      "destination_not_public",
      422,
      "That marketing page is not advertisable.",
    );
  }
  return {
    page_type: "marketing",
    brand_slug: MARKETING_BRAND_SLUG,
    entity_slug: route.slug,
    event_id: null,
    venue_id: null,
    canonical_url: canonicalAdDestinationUrl(
      "marketing",
      MARKETING_BRAND_SLUG,
      route.slug,
    ),
    availability: "available",
    availability_reason: null,
    result_kind: route.result_kind,
  };
}

function mapResolveFailure(payload: Record<string, unknown>): never {
  const code = typeof payload.code === "string"
    ? payload.code
    : "destination_not_public";
  const availability = typeof payload.availability === "string"
    ? payload.availability
    : "";
  const message = availability === "ended"
    ? "All of that page's dates have passed."
    : availability === "private"
    ? "That page is private."
    : availability === "unlisted"
    ? "Unlisted trips and experiences can't be promoted."
    : availability === "nothing_on_sale"
    ? "Nothing is on sale for that page right now."
    : availability === "bookings_closed"
    ? "Bookings are closed for that trip."
    : availability === "not_live"
    ? "This Site isn't live at its address yet."
    : "That page is not currently advertisable.";
  throw new AdDestinationError(code, 422, message);
}

/** True when PostgREST/hermetic mocks report the SQL function is not wired. */
function isMissingDestinationRpcError(
  error: { message?: string } | null | undefined,
): boolean {
  const msg = (error?.message ?? "").toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("unmocked path") ||
    msg.includes("could not find the function") ||
    msg.includes("pgrst202") ||
    msg.includes("function public.ad_destination_resolve") ||
    msg.includes("does not exist")
  );
}

/**
 * Server gate: prefers SQL `ad_destination_resolve` (shared with the list RPC).
 * Falls back to the legacy view lookups only when `rpc` is absent or the
 * function is not deployed/mocked — never after a deliberate `ok: false`.
 */
export async function resolveAdDestination(
  db: unknown,
  input: unknown,
): Promise<ResolvedAdDestination> {
  const client = db as AdDestinationDb;
  const descriptor = requireDescriptor(input);

  if (typeof client.rpc !== "function") {
    return resolveAdDestinationLegacy(client, descriptor);
  }

  let data: unknown;
  let error: { message: string } | null;
  try {
    ({ data, error } = await client.rpc("ad_destination_resolve", {
      p_page_type: descriptor.page_type,
      p_brand_slug: descriptor.brand_slug,
      p_entity_slug: descriptor.entity_slug ?? null,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isMissingDestinationRpcError({ message })) {
      return resolveAdDestinationLegacy(client, descriptor);
    }
    throw new AdDestinationError(
      "destination_lookup_failed",
      503,
      "The public destination could not be checked.",
    );
  }

  if (error) {
    if (isMissingDestinationRpcError(error)) {
      return resolveAdDestinationLegacy(client, descriptor);
    }
    throw new AdDestinationError(
      "destination_lookup_failed",
      503,
      "The public destination could not be checked.",
    );
  }

  if (
    data &&
    typeof data === "object" &&
    typeof (data as Record<string, unknown>).ok === "boolean"
  ) {
    const payload = data as Record<string, unknown>;
    if (payload.ok !== true) mapResolveFailure(payload);
    return {
      page_type: payload.page_type as DestinationPageType,
      brand_slug: String(payload.brand_slug),
      entity_slug: payload.entity_slug == null
        ? null
        : String(payload.entity_slug),
      event_id: payload.event_id == null ? null : String(payload.event_id),
      venue_id: payload.venue_id == null ? null : String(payload.venue_id),
      canonical_url: String(payload.canonical_url),
      availability: typeof payload.availability === "string"
        ? payload.availability
        : undefined,
      availability_reason: payload.availability_reason == null
        ? null
        : String(payload.availability_reason),
      result_kind: payload.result_kind == null
        ? null
        : String(payload.result_kind),
      next_date: typeof payload.next_date === "string"
        ? payload.next_date
        : null,
      last_bookable_at: typeof payload.last_bookable_at === "string"
        ? payload.last_bookable_at
        : null,
      dates_remaining: typeof payload.dates_remaining === "number"
        ? payload.dates_remaining
        : null,
      timezone: typeof payload.timezone === "string" ? payload.timezone : null,
    };
  }

  // Empty/non-contract body with no error — hermetic PostgREST often 200s {}.
  return resolveAdDestinationLegacy(client, descriptor);
}

async function resolveAdDestinationLegacy(
  client: AdDestinationDb,
  descriptor: DestinationDescriptor,
): Promise<ResolvedAdDestination> {
  if (descriptor.page_type === "marketing") {
    return resolveMarketingDestination(descriptor);
  }
  if (
    descriptor.page_type === "event" ||
    descriptor.page_type === "rsvp" ||
    descriptor.page_type === "trip" ||
    descriptor.page_type === "experience"
  ) {
    // #4238: fallback only when the SQL resolver is not deployed or mocked.
    // It cannot check sales or a trip's booking deadline, and it fails closed
    // on Unlisted pages (this view lists public pages only). The FIRST date
    // never ends a series: only "no bookable date left" does.
    const { data, error } = await client
      .from("business_public_events_view")
      .select(
        "id,brand_slug,slug,status,event_type,next_start_at,next_end_at,upcoming_count",
      )
      .eq("brand_slug", descriptor.brand_slug)
      .eq("slug", descriptor.entity_slug as string)
      .eq("event_type", descriptor.page_type)
      .in("status", ["scheduled", "live"])
      .maybeSingle();
    if (error) {
      throw new AdDestinationError(
        "destination_lookup_failed",
        503,
        "The public destination could not be checked.",
      );
    }
    if (!data) {
      throw new AdDestinationError(
        "destination_not_public",
        422,
        "That page is not currently public and live.",
      );
    }
    const upcoming = Number(data.upcoming_count);
    const nextStart = typeof data.next_start_at === "string"
      ? Date.parse(data.next_start_at)
      : Number.NaN;
    const ended = !Number.isFinite(upcoming) || upcoming <= 0 ||
      (descriptor.page_type === "trip" &&
        (!Number.isFinite(nextStart) || nextStart <= Date.now()));
    if (ended) {
      throw new AdDestinationError(
        "destination_ended",
        422,
        "All of that page's dates have passed.",
      );
    }
    return {
      page_type: descriptor.page_type,
      brand_slug: descriptor.brand_slug,
      entity_slug: descriptor.entity_slug as string,
      event_id: String(data.id),
      venue_id: null,
      canonical_url: canonicalAdDestinationUrl(
        descriptor.page_type,
        descriptor.brand_slug,
        descriptor.entity_slug as string,
      ),
      next_date: typeof data.next_start_at === "string"
        ? data.next_start_at
        : null,
      dates_remaining: upcoming,
    };
  }

  if (descriptor.page_type === "venue") {
    const { data, error } = await client
      .from("ad_public_stay_destinations_view")
      .select("id,brand_slug,slug")
      .eq("brand_slug", descriptor.brand_slug)
      .eq("slug", descriptor.entity_slug as string)
      .maybeSingle();
    if (error) {
      throw new AdDestinationError(
        "destination_lookup_failed",
        503,
        "The public Stay destination could not be checked.",
      );
    }
    if (!data) {
      throw new AdDestinationError(
        "destination_not_public",
        422,
        "That Stay is not currently public and reservable.",
      );
    }
    return {
      page_type: "venue",
      brand_slug: descriptor.brand_slug,
      entity_slug: descriptor.entity_slug as string,
      event_id: null,
      venue_id: String(data.id),
      canonical_url: canonicalAdDestinationUrl(
        "venue",
        descriptor.brand_slug,
        descriptor.entity_slug as string,
      ),
    };
  }

  if (descriptor.page_type === "reservation") {
    const { data, error } = await client
      .from("ad_public_stay_destinations_view")
      .select("id,brand_slug,slug")
      .eq("brand_slug", descriptor.brand_slug)
      .eq("slug", descriptor.entity_slug as string)
      .maybeSingle();
    if (error) {
      throw new AdDestinationError(
        "destination_lookup_failed",
        503,
        "The public Stay destination could not be checked.",
      );
    }
    if (!data) {
      throw new AdDestinationError(
        "destination_not_public",
        422,
        "That reservation page is not currently public.",
      );
    }
    const settings = await client
      .from("venue_reservation_settings")
      .select("reservations_enabled")
      .eq("venue_id", String(data.id))
      .maybeSingle();
    if (settings.error) {
      throw new AdDestinationError(
        "destination_lookup_failed",
        503,
        "The public destination could not be checked.",
      );
    }
    const enabled = (settings.data as { reservations_enabled?: unknown } | null)
      ?.reservations_enabled === true;
    if (!enabled) {
      throw new AdDestinationError(
        "destination_not_public",
        422,
        "That reservation page is not currently public.",
      );
    }
    return {
      page_type: "reservation",
      brand_slug: descriptor.brand_slug,
      entity_slug: descriptor.entity_slug as string,
      event_id: null,
      venue_id: String(data.id),
      canonical_url: canonicalAdDestinationUrl(
        "reservation",
        descriptor.brand_slug,
        descriptor.entity_slug as string,
      ),
    };
  }

  if (descriptor.page_type === "brand") {
    const { data, error } = await client
      .from("business_public_brands_view")
      .select("id,slug")
      .eq("slug", descriptor.brand_slug)
      .maybeSingle();
    if (error) {
      throw new AdDestinationError(
        "destination_lookup_failed",
        503,
        "The public brand destination could not be checked.",
      );
    }
    if (!data) {
      throw new AdDestinationError(
        "destination_not_public",
        422,
        "That brand is not currently public.",
      );
    }
    return {
      page_type: "brand",
      brand_slug: descriptor.brand_slug,
      entity_slug: null,
      event_id: null,
      venue_id: null,
      canonical_url: canonicalAdDestinationUrl(
        "brand",
        descriptor.brand_slug,
        null,
      ),
    };
  }

  if (descriptor.page_type === "site") {
    const { data, error } = await client
      .from("ad_public_site_destinations_view")
      .select("id,brand_slug,hostname")
      .eq("brand_slug", descriptor.brand_slug)
      .maybeSingle();
    if (error) {
      throw new AdDestinationError(
        "destination_lookup_failed",
        503,
        "The public Site destination could not be checked.",
      );
    }
    if (!data || typeof data.hostname !== "string" || !data.hostname) {
      throw new AdDestinationError(
        "destination_not_public",
        422,
        "This Site isn't live at its address yet.",
      );
    }
    return {
      page_type: "site",
      brand_slug: descriptor.brand_slug,
      entity_slug: null,
      event_id: null,
      venue_id: null,
      canonical_url: canonicalAdDestinationUrl(
        "site",
        descriptor.brand_slug,
        null,
        { siteHostname: data.hostname },
      ),
    };
  }

  throw new AdDestinationError(
    "destination_page_type_invalid",
    400,
    "Destination page_type must be a supported Ads page type.",
  );
}
