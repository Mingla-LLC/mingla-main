/**
 * experienceDetailService — META-ORCH-1059 Sub-B.
 *
 * Loads a SINGLE experience (event_type='experience') events-row plus its
 * stops, the single ticket, and any materialised dates, for the operator
 * dashboard + edit screens. Mirrors tripsService.getTrip's shape but adapted
 * to the experience model (stops + one-ticket + date model).
 *
 * Defensive `event_type='experience'` filter (mirrors the tr2 audit contract):
 * a non-experience row resolves to null so the experience dashboard never
 * renders an event/trip row.
 */

import { supabase } from "./supabase";
import type { RecurrenceRule } from "../store/draftEventStore";

export interface ExperienceStopRow {
  id: string;
  stopOrder: number;
  placeId: string | null;
  placeName: string;
  address: string;
  city: string | null;
  region: string | null;
  countryCode: string | null;
  lat: number | null;
  lng: number | null;
  imageUrls: string[];
  startTime: string | null;
  priceCents: number;
}

export interface ExperienceTicketRow {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
  quantityTotal: number | null;
  isUnlimited: boolean;
  isFree: boolean;
}

export interface ExperienceDateRow {
  id: string;
  startAt: string;
  endAt: string;
  timezone: string;
  isMaster: boolean;
}

export type ExperienceWhenMode = "single" | "recurring" | "multi_date";

export interface ExperienceDetail {
  id: string;
  brandId: string;
  brandSlug: string | null;
  title: string;
  slug: string;
  description: string | null;
  status: "draft" | "scheduled" | "live" | "ended" | "cancelled";
  visibility: string;
  currency: string;
  timezone: string;
  coverMediaUrl: string | null;
  coverMediaType: "image" | "video" | "gif" | null;
  locationMode: "single" | "per_stop" | null;
  pricingMode: "whole" | "per_stop" | null;
  wholePriceCents: number | null;
  isRecurring: boolean;
  isMultiDate: boolean;
  recurrenceRule: RecurrenceRule | null;
  whenMode: ExperienceWhenMode;
  venueText: string | null;
  stops: ExperienceStopRow[];
  ticket: ExperienceTicketRow | null;
  dates: ExperienceDateRow[];
}

interface RawEventRow {
  id: string;
  brand_id: string;
  title: string;
  slug: string;
  description: string | null;
  status: string;
  visibility: string;
  currency: string | null;
  timezone: string | null;
  cover_media_url: string | null;
  cover_media_type: string | null;
  location_mode: string | null;
  pricing_mode: string | null;
  whole_price_cents: number | null;
  is_recurring: boolean | null;
  is_multi_date: boolean | null;
  recurrence_rules: unknown;
  event_type: string;
  theme: Record<string, unknown> | null;
  brands: { slug: string | null } | { slug: string | null }[] | null;
}

function normalizeCoverType(value: string | null): "image" | "video" | "gif" | null {
  return value === "image" || value === "video" || value === "gif" ? value : null;
}

function normalizeStatus(value: string): ExperienceDetail["status"] {
  switch (value) {
    case "draft":
    case "scheduled":
    case "live":
    case "ended":
    case "cancelled":
      return value;
    default:
      return "draft";
  }
}

function firstRecurrenceRule(raw: unknown): RecurrenceRule | null {
  // events.recurrence_rules is a jsonb array of rules; experiences use one.
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "object") {
    return raw[0] as RecurrenceRule;
  }
  if (raw !== null && typeof raw === "object" && "preset" in (raw as object)) {
    return raw as RecurrenceRule;
  }
  return null;
}

function deriveWhenMode(isRecurring: boolean, isMultiDate: boolean): ExperienceWhenMode {
  if (isRecurring) return "recurring";
  if (isMultiDate) return "multi_date";
  return "single";
}

function brandSlugOf(brands: RawEventRow["brands"]): string | null {
  if (brands === null) return null;
  if (Array.isArray(brands)) return brands[0]?.slug ?? null;
  return brands.slug ?? null;
}

/**
 * Loads one experience (events-row + stops + single ticket + dates). Returns
 * null when the id is missing, the row is not an experience, or it's deleted.
 */
export async function getExperienceDetail(
  eventId: string,
): Promise<ExperienceDetail | null> {
  const { data: row, error } = await supabase
    .from("events")
    .select(
      "id, brand_id, title, slug, description, status, visibility, currency, timezone, cover_media_url, cover_media_type, location_mode, pricing_mode, whole_price_cents, is_recurring, is_multi_date, recurrence_rules, event_type, theme, brands(slug)",
    )
    .eq("id", eventId)
    .eq("event_type", "experience")
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  if (row === null) return null;

  const raw = row as RawEventRow;

  const [{ data: stopRows, error: stopsErr }, { data: ticketRows, error: ticketsErr }, { data: dateRows, error: datesErr }] =
    await Promise.all([
      supabase
        .from("experience_stops")
        .select(
          "id, stop_order, place_id, place_name, address, city, region, country_code, lat, lng, image_urls, start_time, price_cents",
        )
        .eq("event_id", eventId)
        .order("stop_order", { ascending: true }),
      supabase
        .from("ticket_types")
        .select("id, name, price_cents, currency, quantity_total, is_unlimited, is_free")
        .eq("event_id", eventId)
        .is("deleted_at", null)
        .order("display_order", { ascending: true }),
      supabase
        .from("event_dates")
        .select("id, start_at, end_at, timezone, is_master")
        .eq("event_id", eventId)
        .order("start_at", { ascending: true }),
    ]);

  if (stopsErr) throw stopsErr;
  if (ticketsErr) throw ticketsErr;
  if (datesErr) throw datesErr;

  const theme = raw.theme ?? {};
  const meta = (theme.experience_meta as Record<string, unknown> | undefined) ?? {};
  const venueText = typeof meta.venue_text === "string" && meta.venue_text.length > 0
    ? meta.venue_text
    : (stopRows ?? [])[0]?.address ?? null;

  const isRecurring = raw.is_recurring === true;
  const isMultiDate = raw.is_multi_date === true;

  const ticket = (ticketRows ?? [])[0];

  return {
    id: raw.id,
    brandId: raw.brand_id,
    brandSlug: brandSlugOf(raw.brands),
    title: raw.title,
    slug: raw.slug,
    description: raw.description,
    status: normalizeStatus(raw.status),
    visibility: raw.visibility,
    currency: raw.currency ?? "USD",
    timezone: raw.timezone ?? "UTC",
    coverMediaUrl: raw.cover_media_url,
    coverMediaType: normalizeCoverType(raw.cover_media_type),
    locationMode:
      raw.location_mode === "single" || raw.location_mode === "per_stop"
        ? raw.location_mode
        : null,
    pricingMode:
      raw.pricing_mode === "whole" || raw.pricing_mode === "per_stop"
        ? raw.pricing_mode
        : null,
    wholePriceCents: raw.whole_price_cents,
    isRecurring,
    isMultiDate,
    recurrenceRule: firstRecurrenceRule(raw.recurrence_rules),
    whenMode: deriveWhenMode(isRecurring, isMultiDate),
    venueText,
    stops: (stopRows ?? []).map((s) => ({
      id: s.id,
      stopOrder: s.stop_order,
      placeId: s.place_id,
      placeName: s.place_name,
      address: s.address,
      city: s.city,
      region: s.region,
      countryCode: s.country_code,
      lat: s.lat,
      lng: s.lng,
      imageUrls: Array.isArray(s.image_urls) ? s.image_urls : [],
      startTime: s.start_time,
      priceCents: s.price_cents,
    })),
    ticket:
      ticket !== undefined
        ? {
            id: ticket.id,
            name: ticket.name,
            priceCents: ticket.price_cents,
            currency: ticket.currency,
            quantityTotal: ticket.quantity_total,
            isUnlimited: ticket.is_unlimited === true,
            isFree: ticket.is_free === true,
          }
        : null,
    dates: (dateRows ?? []).map((d) => ({
      id: d.id,
      startAt: d.start_at,
      endAt: d.end_at,
      timezone: d.timezone,
      isMaster: d.is_master === true,
    })),
  };
}
