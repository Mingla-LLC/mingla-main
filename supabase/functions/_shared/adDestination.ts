import { PRODUCTION_BUSINESS_WEB_ORIGIN } from "./businessWebOrigin.ts";

export type DestinationPageType = "event" | "brand";

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
  canonical_url: string;
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
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DESTINATION_KEYS = new Set(["page_type", "brand_slug", "entity_slug"]);

function requireDescriptor(input: unknown): DestinationDescriptor {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AdDestinationError(
      "destination_page_type_invalid",
      400,
      "Destination must name an event or brand page.",
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
  if (pageType !== "event" && pageType !== "brand") {
    throw new AdDestinationError(
      "destination_page_type_invalid",
      400,
      "Destination page_type must be event or brand.",
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
  if (pageType === "event") {
    if (!entitySlug) {
      throw new AdDestinationError(
        "destination_entity_slug_required",
        400,
        "Choose a public event destination.",
      );
    }
    if (entitySlug.length > 200 || !SLUG.test(entitySlug)) {
      throw new AdDestinationError(
        "destination_entity_slug_invalid",
        400,
        "The event slug is invalid.",
      );
    }
  } else if (entitySlug) {
    throw new AdDestinationError(
      "destination_entity_slug_forbidden",
      400,
      "A brand destination must not include an event slug.",
    );
  }
  return {
    page_type: pageType,
    brand_slug: brandSlug,
    ...(entitySlug ? { entity_slug: entitySlug } : {}),
  };
}

function businessWebOrigin(): string {
  return (Deno.env.get("BUSINESS_WEB_ORIGIN") ?? "").trim() ||
    PRODUCTION_BUSINESS_WEB_ORIGIN;
}

export async function resolveAdDestination(
  db: unknown,
  input: unknown,
): Promise<ResolvedAdDestination> {
  const client = db as AdDestinationDb;
  const descriptor = requireDescriptor(input);
  if (descriptor.page_type === "event") {
    const { data, error } = await client
      .from("business_public_events_view")
      .select("id,brand_slug,slug,status")
      .eq("brand_slug", descriptor.brand_slug)
      .eq("slug", descriptor.entity_slug as string)
      .in("status", ["scheduled", "live"])
      .maybeSingle();
    if (error) {
      throw new AdDestinationError(
        "destination_lookup_failed",
        503,
        "The public event destination could not be checked.",
      );
    }
    if (!data) {
      throw new AdDestinationError(
        "destination_not_public",
        422,
        "That event is not currently public and live.",
      );
    }
    return {
      page_type: "event",
      brand_slug: descriptor.brand_slug,
      entity_slug: descriptor.entity_slug as string,
      event_id: String(data.id),
      canonical_url:
        `${businessWebOrigin()}/e/${descriptor.brand_slug}/${descriptor
          .entity_slug as string}`,
    };
  }

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
    canonical_url: `${businessWebOrigin()}/b/${descriptor.brand_slug}`,
  };
}
