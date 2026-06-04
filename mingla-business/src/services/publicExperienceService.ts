/**
 * publicExperienceService — META-ORCH-1059 Sub-C/D.
 *
 * Anon-tolerant resolvers for a SINGLE published experience, by (brandSlug,
 * experienceSlug) for the public buyer page and by event-row id for the
 * checkout chain. Mirrors the trip resolvers (`usePublicTripBySlug` +
 * `getPublicTripById`) exactly: direct table reads gated by the existing
 * anon RLS policies — NOT a new RPC. The relevant tables already carry
 * anon SELECT policies for published experiences:
 *   - events  : "Public can read published events (anon or authenticated)"
 *   - brands  : "Public can read non-deleted brands"
 *   - experience_stops : experience_stops_select_public (published + public)
 *   - ticket_types     : "Public can read ticket types for published events"
 *   - event_dates      : "Public can read event dates for published events"
 * (verified live against experience b8bd995b 2026-06-02). No migration, no
 * new edge function, no ORCH-0863 allowlist change needed (COMMS-0002 N/A).
 *
 * Anon-tolerant per feedback_anon_buyer_routes.md: no useAuth, no sign-in
 * redirect — anyone with the share link sees the page.
 *
 * COMMS-0014/0016: this service touches NO Stripe/money path. Checkout still
 * routes through the existing `ticket-checkout-create` edge fn keyed on the
 * experience's events-row id (one ticket).
 */

import { supabase } from "./supabase";
import type { RecurrenceRule } from "../store/draftEventStore";

export type PublicExperienceWhenMode = "single" | "recurring" | "multi_date";

export interface PublicExperienceStop {
  id: string;
  stopOrder: number;
  placeName: string;
  address: string;
  imageUrls: string[];
  startTime: string | null;
}

export interface PublicExperienceTicket {
  /** ticket_types.id — the line a buyer purchases through ticket-checkout-create. */
  ticketTypeId: string;
  name: string;
  priceCents: number;
  currency: string;
  quantityTotal: number | null;
  isUnlimited: boolean;
  isFree: boolean;
  /** Remaining bookable seats (null = unlimited / unknown). */
  ticketsRemaining: number | null;
}

export interface PublicExperienceDate {
  id: string;
  startAt: string;
  endAt: string;
  timezone: string;
  isMaster: boolean;
}

export interface PublicExperience {
  id: string;
  brandId: string;
  brandSlug: string;
  title: string;
  slug: string;
  description: string | null;
  status: string;
  visibility: string;
  timezone: string;
  coverMediaUrl: string | null;
  coverMediaType: "image" | "video" | "gif" | null;
  venueText: string | null;
  whenMode: PublicExperienceWhenMode;
  recurrenceRule: RecurrenceRule | null;
  stops: PublicExperienceStop[];
  ticket: PublicExperienceTicket | null;
  dates: PublicExperienceDate[];
}

export interface PublicExperienceBrand {
  id: string;
  slug: string;
  name: string;
  bio: string | null;
  coverMediaUrl: string | null;
}

export interface PublicExperiencePayload {
  experience: PublicExperience;
  brand: PublicExperienceBrand;
}

/** Published experiences are visible to anon in these lifecycle states. */
const PUBLIC_STATUSES = ["scheduled", "live", "ended", "cancelled"] as const;

function normalizeCoverType(
  value: string | null | undefined,
): "image" | "video" | "gif" | null {
  return value === "image" || value === "video" || value === "gif"
    ? value
    : null;
}

function deriveWhenMode(
  isRecurring: boolean,
  isMultiDate: boolean,
): PublicExperienceWhenMode {
  if (isRecurring) return "recurring";
  if (isMultiDate) return "multi_date";
  return "single";
}

function firstRecurrenceRule(raw: unknown): RecurrenceRule | null {
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "object") {
    return raw[0] as RecurrenceRule;
  }
  if (raw !== null && typeof raw === "object" && "preset" in (raw as object)) {
    return raw as RecurrenceRule;
  }
  return null;
}

interface MapInput {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: any;
  brand: PublicExperienceBrand;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stops: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tickets: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dates: any[];
}

function mapExperience(input: MapInput): PublicExperience {
  const { event, brand, stops, tickets, dates } = input;
  const theme = (event.theme as Record<string, unknown> | null) ?? {};
  const meta =
    (theme.experience_meta as Record<string, unknown> | undefined) ?? {};
  const venueText =
    typeof meta.venue_text === "string" && meta.venue_text.length > 0
      ? (meta.venue_text as string)
      : (stops[0]?.address ?? null);

  const tt = tickets[0];
  const ticket: PublicExperienceTicket | null =
    tt !== undefined
      ? {
          ticketTypeId: tt.id,
          name: tt.name,
          priceCents: tt.price_cents ?? 0,
          currency: tt.currency ?? "USD",
          quantityTotal: tt.quantity_total ?? null,
          isUnlimited: tt.is_unlimited === true,
          isFree: tt.is_free === true || (tt.price_cents ?? 0) === 0,
          // Sub-C preview does not gate sold-out per-occurrence; the checkout
          // chain (usePublicExperienceById) computes remaining. Set null here.
          ticketsRemaining: null,
        }
      : null;

  return {
    id: event.id,
    brandId: event.brand_id,
    brandSlug: brand.slug,
    title: event.title,
    slug: event.slug,
    description: event.description ?? null,
    status: event.status,
    visibility: event.visibility,
    timezone: event.timezone ?? "UTC",
    coverMediaUrl: event.cover_media_url ?? null,
    coverMediaType: normalizeCoverType(event.cover_media_type),
    venueText,
    whenMode: deriveWhenMode(
      event.is_recurring === true,
      event.is_multi_date === true,
    ),
    recurrenceRule: firstRecurrenceRule(event.recurrence_rules),
    stops: stops.map((s) => ({
      id: s.id,
      stopOrder: s.stop_order,
      placeName: s.place_name,
      address: s.address,
      imageUrls: Array.isArray(s.image_urls) ? s.image_urls : [],
      startTime: s.start_time ?? null,
    })),
    ticket,
    dates: dates.map((d) => ({
      id: d.id,
      startAt: d.start_at,
      endAt: d.end_at,
      timezone: d.timezone,
      isMaster: d.is_master === true,
    })),
  };
}

/**
 * Load the experience's sidecar rows (stops + the one ticket + dates) given
 * a resolved event-row id. Throws on any RLS / network error (no silent
 * fallbacks per the error-handling contract).
 */
async function loadExperienceSidecars(eventId: string): Promise<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stops: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tickets: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dates: any[];
}> {
  const [stopsResp, ticketsResp, datesResp] = await Promise.all([
    supabase
      .from("experience_stops")
      .select("id, stop_order, place_name, address, image_urls, start_time")
      .eq("event_id", eventId)
      .order("stop_order", { ascending: true }),
    supabase
      .from("ticket_types")
      .select(
        "id, name, price_cents, currency, quantity_total, is_unlimited, is_free, display_order",
      )
      .eq("event_id", eventId)
      .is("deleted_at", null)
      .order("display_order", { ascending: true }),
    supabase
      .from("event_dates")
      .select("id, start_at, end_at, timezone, is_master")
      .eq("event_id", eventId)
      .order("start_at", { ascending: true }),
  ]);
  if (stopsResp.error) throw stopsResp.error;
  if (ticketsResp.error) throw ticketsResp.error;
  if (datesResp.error) throw datesResp.error;
  return {
    stops: stopsResp.data ?? [],
    tickets: ticketsResp.data ?? [],
    dates: datesResp.data ?? [],
  };
}

/**
 * Resolve one published experience by (brandSlug, experienceSlug). Returns
 * null when the brand/experience is missing, not an experience, or not live
 * (draft → never leaks). Mirrors getPublicTripBySlug.
 */
export async function getPublicExperienceBySlug(
  brandSlug: string,
  experienceSlug: string,
): Promise<PublicExperiencePayload | null> {
  // 1. Brand by slug (anon-readable).
  const brandResp = await supabase
    .from("brands")
    .select("id, slug, name, description, cover_media_url")
    .eq("slug", brandSlug)
    .is("deleted_at", null)
    .maybeSingle();
  if (brandResp.error) throw brandResp.error;
  if (brandResp.data === null) return null;
  const b = brandResp.data;

  // 2. Experience by (brand_id, slug, event_type='experience', published).
  const eventResp = await supabase
    .from("events")
    .select("*")
    .eq("brand_id", b.id)
    .eq("slug", experienceSlug)
    .eq("event_type", "experience")
    .in("status", PUBLIC_STATUSES as unknown as string[])
    .is("deleted_at", null)
    .maybeSingle();
  if (eventResp.error) throw eventResp.error;
  if (eventResp.data === null) return null;
  const event = eventResp.data;

  const sidecars = await loadExperienceSidecars(event.id as string);
  const brand: PublicExperienceBrand = {
    id: b.id,
    slug: b.slug,
    name: b.name,
    bio: b.description ?? null,
    coverMediaUrl: b.cover_media_url ?? null,
  };
  return {
    experience: mapExperience({ event, brand, ...sidecars }),
    brand,
  };
}

/**
 * Resolve one published experience by its event-row id (for the checkout
 * chain). Mirrors getPublicTripById. Returns null when missing / not an
 * experience / not live.
 */
export async function getPublicExperienceById(
  eventId: string,
): Promise<PublicExperiencePayload | null> {
  const eventResp = await supabase
    .from("events")
    .select("*, brands(id, slug, name, description, cover_media_url)")
    .eq("id", eventId)
    .eq("event_type", "experience")
    .in("status", PUBLIC_STATUSES as unknown as string[])
    .is("deleted_at", null)
    .maybeSingle();
  if (eventResp.error) throw eventResp.error;
  if (eventResp.data === null) return null;
  const event = eventResp.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawBrand = (event as any).brands;
  const brandRow = Array.isArray(rawBrand) ? rawBrand[0] : rawBrand;
  if (brandRow === null || brandRow === undefined) return null;
  const brand: PublicExperienceBrand = {
    id: brandRow.id,
    slug: brandRow.slug,
    name: brandRow.name,
    bio: brandRow.description ?? null,
    coverMediaUrl: brandRow.cover_media_url ?? null,
  };

  const sidecars = await loadExperienceSidecars(eventId);
  return {
    experience: mapExperience({ event, brand, ...sidecars }),
    brand,
  };
}
