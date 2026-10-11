import { PRODUCTION_BUSINESS_WEB_ORIGIN } from "./businessWebOrigin.ts";

/** toward #3697 Wave 1 A4 — all Phase-1 advertisable page types (marketing = Wave 4). */
export type DestinationPageType =
  | "event"
  | "rsvp"
  | "trip"
  | "experience"
  | "brand"
  | "venue"
  | "reservation"
  | "site";

export const AD_DESTINATION_PAGE_TYPES: readonly DestinationPageType[] = [
  "event",
  "rsvp",
  "trip",
  "experience",
  "brand",
  "venue",
  "reservation",
  "site",
] as const;

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
]);

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
  const entitySlug = typeof raw.entity_slug === "string"
    ? raw.entity_slug.trim()
    : "";
  const typed = pageType as DestinationPageType;
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
  }
}

function mapResolveFailure(payload: Record<string, unknown>): never {
  const code = typeof payload.code === "string"
    ? payload.code
    : "destination_not_public";
  const availability = typeof payload.availability === "string"
    ? payload.availability
    : "";
  const message = availability === "ended"
    ? "That page's start is in the past or it has ended."
    : availability === "private"
    ? "That page is private."
    : availability === "not_live"
    ? "This Site isn't live at its address yet."
    : "That page is not currently advertisable.";
  throw new AdDestinationError(code, 422, message);
}

/**
 * Server gate: prefers SQL `ad_destination_resolve` (shared with the list RPC).
 * Falls back to the legacy view lookups for hermetic Deno tests that only mock
 * `.from()`.
 */
export async function resolveAdDestination(
  db: unknown,
  input: unknown,
): Promise<ResolvedAdDestination> {
  const client = db as AdDestinationDb;
  const descriptor = requireDescriptor(input);

  // Prefer SQL resolve when the client exposes a working rpc that returns the
  // contract shape (`ok` boolean). Hermetic mocks often stub `rpc` without
  // this function — fall back to the view path so create-campaign suites keep
  // exercising the same public gates.
  if (typeof client.rpc === "function") {
    try {
      const { data, error } = await client.rpc("ad_destination_resolve", {
        p_page_type: descriptor.page_type,
        p_brand_slug: descriptor.brand_slug,
        p_entity_slug: descriptor.entity_slug ?? null,
      });
      if (
        !error &&
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
        };
      }
    } catch {
      // Fall through to legacy view lookups.
    }
  }

  return resolveAdDestinationLegacy(client, descriptor);
}

async function resolveAdDestinationLegacy(
  client: AdDestinationDb,
  descriptor: DestinationDescriptor,
): Promise<ResolvedAdDestination> {
  if (
    descriptor.page_type === "event" ||
    descriptor.page_type === "rsvp" ||
    descriptor.page_type === "trip" ||
    descriptor.page_type === "experience"
  ) {
    const { data, error } = await client
      .from("business_public_events_view")
      .select("id,brand_slug,slug,status,event_type,master_start_at")
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
    const start = data.master_start_at;
    if (typeof start === "string" && Date.parse(start) <= Date.now()) {
      throw new AdDestinationError(
        "destination_not_public",
        422,
        "That page's start is in the past or it has ended.",
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
    };
  }

  if (
    descriptor.page_type === "venue" ||
    descriptor.page_type === "reservation"
  ) {
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
        descriptor.page_type === "reservation"
          ? "That reservation page is not currently public."
          : "That Stay is not currently public and reservable.",
      );
    }
    return {
      page_type: descriptor.page_type,
      brand_slug: descriptor.brand_slug,
      entity_slug: descriptor.entity_slug as string,
      event_id: null,
      venue_id: String(data.id),
      canonical_url: canonicalAdDestinationUrl(
        descriptor.page_type,
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
