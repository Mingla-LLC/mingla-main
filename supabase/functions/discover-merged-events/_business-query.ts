/**
 * ORCH-426 G1 — pg_discover_business_events RPC client + card mapping.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { splitTimestampInTz } from "../_shared/dateTimeSplit.ts";
import {
  extractVenueName,
  extractBusinessEventFormat,
  deriveSharedFormat,
} from "./_helpers.ts";
import type { BusinessEventCard } from "./_types.ts";

const BUSINESS_BUYER_DOMAIN =
  Deno.env.get("MINGLA_BUSINESS_BUYER_DOMAIN") ?? "https://business.mingla.app";

export interface DiscoverBusinessQueryParams {
  cities: string[];
  lowerBoundUtc: string;
  upperStartUtc: string | null;
  partyTypeSlugs: string[];
  vibeTagSlugs: string[];
  musicGenreSlugs: string[];
  offset: number;
  limit: number;
}

type RpcRow = Record<string, unknown>;

function parsePoint(point: unknown): { lat: number; lng: number } | null {
  if (point == null) return null;
  if (typeof point === "string") {
    const m = point.match(/^\(([-\d.]+),([-\d.]+)\)$/);
    if (!m) return null;
    return { lng: Number(m[1]), lat: Number(m[2]) };
  }
  if (typeof point === "object") {
    const p = point as Record<string, unknown>;
    if (typeof p.x === "number" && typeof p.y === "number") {
      return { lng: p.x, lat: p.y };
    }
  }
  return null;
}

function extractCoverHue(theme: unknown): number {
  if (theme && typeof theme === "object") {
    const raw = (theme as Record<string, unknown>).coverHue;
    if (typeof raw === "number") return raw;
    if (typeof raw === "string") {
      const n = Number(raw);
      if (!Number.isNaN(n)) return n;
    }
  }
  return 25;
}

function extractHideAddressUntilTicket(theme: unknown): boolean {
  if (theme && typeof theme === "object") {
    const be = (theme as Record<string, unknown>).business_event;
    if (be && typeof be === "object") {
      const v = (be as Record<string, unknown>).hideAddressUntilTicket;
      if (typeof v === "boolean") return v;
    }
  }
  return true;
}

export function cityMatchValues(cityName: string): string[] {
  const trimmed = cityName.trim();
  const firstSegment = trimmed.split(",")[0]?.trim();
  const out = [trimmed];
  if (firstSegment && firstSegment !== trimmed) out.push(firstSegment);
  return out;
}

export function mapRpcRowToCard(row: RpcRow): BusinessEventCard {
  const eventTz = String(row.timezone ?? row.master_timezone ?? "UTC");
  const startSplit = splitTimestampInTz(
    (row.master_start_at as string | null) ?? null,
    eventTz,
  );
  const endSplit = splitTimestampInTz(
    (row.master_end_at as string | null) ?? null,
    eventTz,
  );
  const priceMinCents = row.price_min_cents as number | null;
  const priceMaxCents = row.price_max_cents as number | null;
  const priceMin = priceMinCents != null ? priceMinCents / 100 : null;
  const priceMax = priceMaxCents != null ? priceMaxCents / 100 : null;
  const theme = row.theme;
  const hide = extractHideAddressUntilTicket(theme);
  const brandSlug = String(row.brand_slug ?? "");
  const eventSlug = String(row.slug ?? "");

  return {
    eventId: String(row.id),
    brandId: String(row.brand_id),
    brandSlug,
    brandName: String(row.brand_name ?? ""),
    brandProfilePhotoUrl: (row.brand_profile_photo_url as string | null) ?? null,
    eventSlug,
    title: String(row.title ?? ""),
    description: (row.description as string | null) ?? null,
    coverMediaUrl: (row.cover_media_url as string | null) ?? null,
    coverMediaType: (row.cover_media_type as BusinessEventCard["coverMediaType"]) ?? null,
    coverHue: extractCoverHue(theme),
    masterDateUtc: (row.master_start_at as string | null) ?? null,
    masterEndAtUtc: (row.master_end_at as string | null) ?? null,
    doorsOpenLocal: startSplit.time,
    endsAtLocal: endSplit.time,
    timezone: String(row.timezone ?? "UTC"),
    venueName: extractVenueName(theme) ?? (row.location_text as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    address: (row.location_text as string | null) ?? null,
    hideAddressUntilTicket: hide,
    format: deriveSharedFormat(
      extractBusinessEventFormat(theme),
      row.is_online === true,
    ),
    locationGeo: parsePoint(row.location_geo),
    partyTypes: Array.isArray(row.party_types) ? row.party_types as string[] : [],
    vibeTags: Array.isArray(row.vibe_tags) ? row.vibe_tags as string[] : [],
    musicGenres: Array.isArray(row.music_genres) ? row.music_genres as string[] : [],
    priceMin,
    priceMax,
    displayPriceCents: (row.display_price_cents as number | null) ?? null,
    displayCurrency: (row.pricing_currency as string | null) ?? null,
    currency: String(row.currency ?? "GBP"),
    publicBuyerUrl: `${BUSINESS_BUYER_DOMAIN}/e/${brandSlug}/${eventSlug}`,
  };
}

export async function fetchDiscoverBusinessEvents(
  supabase: SupabaseClient,
  params: DiscoverBusinessQueryParams,
): Promise<{ businessItems: BusinessEventCard[]; businessTotal: number }> {
  const { data, error } = await supabase.rpc("pg_discover_business_events", {
    p_cities: params.cities,
    p_lower_bound: params.lowerBoundUtc,
    p_upper_start: params.upperStartUtc,
    p_party_types: params.partyTypeSlugs.length > 0 ? params.partyTypeSlugs : null,
    p_vibe_tags: params.vibeTagSlugs.length > 0 ? params.vibeTagSlugs : null,
    p_music_genres: params.musicGenreSlugs.length > 0 ? params.musicGenreSlugs : null,
    p_offset: params.offset,
    p_limit: params.limit,
  });

  if (error) {
    throw new Error(`db_error:${error.message}`);
  }

  const payload = (data ?? { total: 0, rows: [] }) as { total?: number; rows?: RpcRow[] };
  const rows = payload.rows ?? [];
  const businessItems = rows.map(mapRpcRowToCard);
  return {
    businessItems,
    businessTotal: Number(payload.total ?? businessItems.length),
  };
}
