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
// ORCH-1147 — reuse the SINGLE owner of pg_public_event_tier_allin (no
// duplicated RPC / fee math here). The trip + event paths use the same helper.
import { fetchTierAllInCents } from "./publicEventsService";
// ORCH-1138 Leg 3 — guard the brand theme + per-experience overrides into a
// ThemeInput so the /exp/ route resolves a palette (Direction-A). Same guard the
// trip path uses (usePublicTripBySlug.asThemeInput); identical validator imports.
import {
  isThemeAnimationSlug,
  isThemeColor,
  isThemeFontSlug,
  type ThemeInput,
} from "@mingla/offering-rendering";

export type PublicExperienceWhenMode = "single" | "recurring" | "multi_date";

export interface PublicExperienceStop {
  id: string;
  stopOrder: number;
  placeName: string;
  address: string;
  imageUrls: string[];
  startTime: string | null;
  // ORCH-1138 Leg 3 — close the §F.5 read-path gaps: the stop's authored blurb
  // (experience_stops.ai_description) + its coords (lat/lng) so the page renders
  // the real per-stop description + the stop-1 map (rule 9: null → omit, never
  // a placeholder).
  description: string | null;
  lat: number | null;
  lng: number | null;
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
  /**
   * ORCH-1147 — server fee-grossed all-in in MAJOR units
   * (`pg_public_event_tier_allin` → /100). Null = free / RPC miss; cart seed
   * falls back to `priceCents`/base. NEVER recompute fees in TS.
   */
  priceAllInGbp?: number | null;
}

export interface PublicExperienceDate {
  id: string;
  startAt: string;
  endAt: string;
  timezone: string;
  isMaster: boolean;
  /**
   * ORCH-1138 Leg 3 (§4.3) — event-level remaining stamped onto every occurrence
   * (Q2: there is NO per-occurrence cap — the picker shows the SAME N per slot).
   * null = unlimited / unknown; 0 = that slot renders sold-out/disabled.
   */
  ticketsRemaining: number | null;
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
  /**
   * ORCH-1138 Leg 3 (§4.2) — the curated vibe ids (events.experience_intents).
   * `[]` when the experience picked no vibes — NEVER fabricated (rule 9). The
   * page maps these to vibe chips via the canonical vibe label map.
   */
  intents: string[];
  /**
   * ORCH-1138 Leg 3 (§4.0) — the per-experience theme overrides
   * (events.theme_*_override) guarded into a ThemeInput; null when none. The
   * /exp/ route resolves resolveTheme(brand.theme, themeOverrides).
   */
  themeOverrides: ThemeInput | null;
  /**
   * ORCH-1076 I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED — false when this is a
   * PAID experience (available_online ticket with price_cents>0) whose brand
   * cannot charge (Stripe charges_enabled=false). The deep-link page renders a
   * graceful "Booking unavailable right now" banner in place of the checkout
   * flow instead of a broken Book button (which would dead-end at the
   * ticket-checkout-create 409). FREE experiences are always bookable.
   * Defaults to true when absent (back-compat).
   */
  bookable: boolean;
}

export interface PublicExperienceBrand {
  id: string;
  slug: string;
  name: string;
  bio: string | null;
  coverMediaUrl: string | null;
  /**
   * ORCH-1138 FIX-3 (mirror trip) — the brand cover's media type + hue so the
   * "Presented by" chip renders gif/video covers via EventCoverMedia + a clean
   * themed hue fallback when there's no cover. OPTIONAL + additive.
   */
  coverMediaType?: "image" | "video" | "gif" | null;
  coverHue?: number | null;
  /**
   * ORCH-1138 Leg 3 (§4.0) — the brand's Direction-A theme (color/font/animation)
   * guarded into a ThemeInput. null when the brand set no valid theme columns.
   * The /exp/ route resolves resolveTheme(brand.theme, experience.themeOverrides).
   */
  theme: ThemeInput | null;
}

export interface PublicExperiencePayload {
  experience: PublicExperience;
  brand: PublicExperienceBrand;
}

/** Published experiences are visible to anon in these lifecycle states. */
const PUBLIC_STATUSES = ["scheduled", "live", "ended", "cancelled"] as const;

// ORCH-1138 Leg 3 — guard raw theme columns into a ThemeInput (mirror of
// usePublicTripBySlug.asThemeInput exactly; only valid slugs/colors survive).
function asThemeInput(
  color: unknown,
  font: unknown,
  animation: unknown,
): ThemeInput | null {
  const out: ThemeInput = {};
  if (isThemeColor(color)) out.color = color;
  if (isThemeFontSlug(font)) out.font = font;
  if (isThemeAnimationSlug(animation)) out.animation = animation;
  return Object.keys(out).length > 0 ? out : null;
}

// ORCH-1138 Leg 3 (§4.2) — map events.experience_intents (text[]) to a string[].
// `[]` when absent — NEVER fabricated (rule 9).
function readIntents(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((v): v is string => typeof v === "string")
    : [];
}

// ORCH-1138 Leg 3 — single owner of the brands-row → PublicExperienceBrand map
// (used by both the by-slug + by-id resolvers). Guards the cover columns (all
// anon-readable on `brands`).
//
// COMMS-0009 / P0-1 REWORK: the brand THEME (theme_color/theme_font/
// theme_animation) is NOT read off the brands table — the `anon` Postgres role
// has NO column-level SELECT on those three columns (live: HTTP 401 `42501
// permission denied for table brands`), which 401'd the entire anon /exp/ page.
// The theme is sourced from the anon-safe `business_public_events_view`
// (brand_theme_*) by the resolver and passed in here, exactly as the trip/event
// legs do (publicEventsService.businessPublicEventViewRowToBrand).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapBrand(b: any, theme: ThemeInput | null): PublicExperienceBrand {
  return {
    id: b.id,
    slug: b.slug,
    name: b.name,
    bio: b.description ?? null,
    coverMediaUrl: b.cover_media_url ?? null,
    coverMediaType: normalizeCoverType(b.cover_media_type),
    coverHue: typeof b.cover_hue === "number" ? b.cover_hue : null,
    theme,
  };
}

/**
 * COMMS-0009 / P0-1 REWORK — resolve the brand theme (color/font/animation) from
 * the anon-safe `business_public_events_view` instead of the non-anon-readable
 * `brands.theme_*` columns. The view exposes `brand_theme_color` /
 * `brand_theme_font` / `brand_theme_animation` (security-definer, anon-readable —
 * verified live HTTP 200 returning `#7c3aed`/`playfair_display` for the QA
 * fixture). Filtered to this experience row (brand_slug + slug + experience type)
 * so we read the right brand's theme. Non-fatal: any view error / miss → null
 * (the page resolves the default palette, never 401s).
 */
async function fetchBrandThemeFromView(
  brandSlug: string,
  experienceSlug: string,
): Promise<ThemeInput | null> {
  const { data, error } = await supabase
    .from("business_public_events_view")
    .select("brand_theme_color, brand_theme_font, brand_theme_animation")
    .eq("brand_slug", brandSlug)
    .eq("slug", experienceSlug)
    .eq("event_type", "experience")
    .maybeSingle();
  if (error !== null || data === null) return null;
  return asThemeInput(
    data.brand_theme_color,
    data.brand_theme_font,
    data.brand_theme_animation,
  );
}

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
  /** ORCH-1076 — resolved buyer-readiness; defaults to true (back-compat). */
  bookable?: boolean;
  /** ORCH-1147 — ticket_types.id → server all-in cents (single-owner fetch). */
  allInById?: Map<string, number>;
  /**
   * ORCH-1138 Leg 3 (§4.3) — ticket_types.id → event-level remaining (from the
   * canonical pg_public_ticket_types_remaining reader). null = unlimited/unknown.
   * Stamped onto the ticket + every occurrence date (no per-occurrence cap).
   */
  remainingById?: Map<string, number | null>;
}

/**
 * ORCH-1076 — a tickets array is PAID for online checkout when ANY ticket is
 * sellable online (available_online=true) with price_cents>0. Mirrors the
 * checkout 409 + ORCH-1075 publish-guard PAID definition exactly.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ticketsArePaidOnline(tickets: any[]): boolean {
  return tickets.some(
    (t) => t?.available_online === true && (t?.price_cents ?? 0) > 0,
  );
}

/**
 * ORCH-1076 — resolve whether a PAID offering's brand can charge via the
 * canonical pg_brand_can_charge RPC (anon-granted by the Stream A migration).
 * Returns true (bookable) immediately when the offering is FREE. On RPC error
 * we fail OPEN here (render the page bookable) because the checkout 409 is still
 * the terminal guard — a graceful banner that wrongly hides a bookable listing
 * would be worse than the existing terminal 409 for the rare resolver error.
 */
async function resolveBookable(
  brandId: string,
  isPaid: boolean,
): Promise<boolean> {
  if (!isPaid) return true;
  const { data, error } = await supabase.rpc("pg_brand_can_charge", {
    p_brand_id: brandId,
  });
  if (error !== null) {
    // Non-fatal: keep the page bookable; the checkout 409 remains the backstop.
    return true;
  }
  return data === true;
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
  // ORCH-1147 — server fee-grossed all-in (MAJOR units) from the single-owner
  // fetch; free tier / RPC miss → null; the cart seed owns the base fallback.
  const allInCents = tt !== undefined ? input.allInById?.get(tt.id) : undefined;
  // ORCH-1138 Leg 3 (§4.3) — the ONE sellable ticket's event-level remaining from
  // the canonical reader (pg_public_ticket_types_remaining). null = unlimited /
  // unknown (RPC miss). Stamped onto the ticket + every occurrence date below.
  const eventRemaining: number | null =
    tt !== undefined && input.remainingById?.has(tt.id)
      ? (input.remainingById.get(tt.id) ?? null)
      : null;
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
          // ORCH-1138 Leg 3 (§4.3) — event-level remaining from the canonical
          // reader (was hardcoded null). Drives the page sold-out gate + the
          // per-slot "N left" in the picker. null = unlimited / RPC miss.
          ticketsRemaining: eventRemaining,
          priceAllInGbp:
            tt.is_free === true || (tt.price_cents ?? 0) === 0
              ? null
              : typeof allInCents === "number"
                ? allInCents / 100
                : null,
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
      // ORCH-1138 Leg 3 (§4.2) — real authored blurb + coords (null → omit).
      description:
        typeof s.ai_description === "string" && s.ai_description.length > 0
          ? s.ai_description
          : null,
      lat: typeof s.lat === "number" ? s.lat : null,
      lng: typeof s.lng === "number" ? s.lng : null,
    })),
    ticket,
    dates: dates.map((d) => ({
      id: d.id,
      startAt: d.start_at,
      endAt: d.end_at,
      timezone: d.timezone,
      isMaster: d.is_master === true,
      // ORCH-1138 Leg 3 (§4.3) — same event-level remaining on every slot (Q2 —
      // no per-occurrence cap). 0 ⇒ that slot renders sold-out/disabled.
      ticketsRemaining: eventRemaining,
    })),
    // ORCH-1138 Leg 3 (§4.2) — real curated vibe ids ([] when none, rule 9).
    intents: readIntents(event.experience_intents),
    // ORCH-1138 Leg 3 (§4.0) — per-experience theme overrides (events row carries
    // theme_*_override; the brand theme is on the brand object).
    themeOverrides: asThemeInput(
      event.theme_color_override,
      event.theme_font_override,
      event.theme_animation_override,
    ),
    // ORCH-1076 — default true when the caller did not resolve readiness.
    bookable: input.bookable !== false,
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
  /** ORCH-1147 — ticket_types.id → server all-in cents (single-owner fetch). */
  allInById: Map<string, number>;
  /** ORCH-1138 Leg 3 (§4.3) — ticket_types.id → event-level remaining. */
  remainingById: Map<string, number | null>;
}> {
  // ORCH-1147 — fold the per-tier all-in fetch into the existing parallel load.
  // fetchTierAllInCents never throws (RPC failure → empty map → base fallback
  // downstream); keep the throw-on-RLS guards on the three Supabase reads.
  // ORCH-1138 Leg 3 — also fold the canonical remaining reader in parallel.
  const [stopsResp, ticketsResp, datesResp, allInById, remainingResp] =
    await Promise.all([
      supabase
        .from("experience_stops")
        // ORCH-1138 Leg 3 (§4.2) — add ai_description, lat, lng (real authored
        // columns on already-anon-readable experience_stops; no RLS change).
        .select(
          "id, stop_order, place_name, address, image_urls, start_time, ai_description, lat, lng",
        )
        .eq("event_id", eventId)
        .order("stop_order", { ascending: true }),
      supabase
        .from("ticket_types")
        .select(
          "id, name, price_cents, currency, quantity_total, is_unlimited, is_free, display_order, available_online",
        )
        .eq("event_id", eventId)
        .is("deleted_at", null)
        .order("display_order", { ascending: true }),
      supabase
        .from("event_dates")
        .select("id, start_at, end_at, timezone, is_master")
        .eq("event_id", eventId)
        .order("start_at", { ascending: true }),
      fetchTierAllInCents(eventId),
      // ORCH-1138 Leg 3 (§4.3) — canonical anon-callable remaining reader
      // (ORCH-0946). Non-fatal: an RPC error leaves remaining unknown (the page
      // simply omits the sold-out gate; the checkout 409 remains the backstop).
      supabase.rpc("pg_public_ticket_types_remaining", { p_event_id: eventId }),
    ]);
  if (stopsResp.error) throw stopsResp.error;
  if (ticketsResp.error) throw ticketsResp.error;
  if (datesResp.error) throw datesResp.error;
  // Build the ticket_types.id → remaining map (RPC error → empty map, gracefully
  // degrades to "no remaining gate", never throws — rule 9 / no fabrication).
  const remainingById = new Map<string, number | null>();
  if (remainingResp.error === null && Array.isArray(remainingResp.data)) {
    for (const r of remainingResp.data as Array<{
      ticket_type_id: string;
      remaining: number | null;
    }>) {
      remainingById.set(
        r.ticket_type_id,
        typeof r.remaining === "number" ? r.remaining : null,
      );
    }
  }
  return {
    stops: stopsResp.data ?? [],
    tickets: ticketsResp.data ?? [],
    dates: datesResp.data ?? [],
    allInById,
    remainingById,
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
  // 1. Brand by slug. ORCH-1138 Leg 3 — cover_* columns for the "Presented by"
  // chip (all anon-readable on `brands`). COMMS-0009 / P0-1: the theme_* columns
  // are NOT selected here — anon cannot read them (HTTP 401 `42501`); the brand
  // theme is sourced from the anon-safe `business_public_events_view` below.
  const brandResp = await supabase
    .from("brands")
    .select(
      "id, slug, name, description, cover_media_url, cover_media_type, cover_hue",
    )
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

  // COMMS-0009 / P0-1 — brand theme from the anon-safe view (keyed by this
  // experience row), never from the non-anon-readable brands.theme_* columns.
  const brandTheme = await fetchBrandThemeFromView(brandSlug, experienceSlug);
  const sidecars = await loadExperienceSidecars(event.id as string);
  const brand: PublicExperienceBrand = mapBrand(b, brandTheme);
  // ORCH-1076 — resolve buyer-readiness for PAID experiences.
  const isPaid = ticketsArePaidOnline(sidecars.tickets);
  const bookable = await resolveBookable(b.id as string, isPaid);
  return {
    experience: mapExperience({ event, brand, ...sidecars, bookable }),
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
  // COMMS-0009 / P0-1: the embedded brands(...) select carries only anon-readable
  // cover columns — NOT theme_* (anon 401 `42501`). The brand theme is sourced
  // from the anon-safe `business_public_events_view` below.
  const eventResp = await supabase
    .from("events")
    .select(
      "*, brands(id, slug, name, description, cover_media_url, cover_media_type, cover_hue)",
    )
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
  // COMMS-0009 / P0-1 — brand theme from the anon-safe view, keyed by this
  // experience row (brand_slug + slug), never from brands.theme_*.
  const brandTheme = await fetchBrandThemeFromView(
    brandRow.slug as string,
    event.slug as string,
  );
  const brand: PublicExperienceBrand = mapBrand(brandRow, brandTheme);

  const sidecars = await loadExperienceSidecars(eventId);
  // ORCH-1076 — resolve buyer-readiness for PAID experiences.
  const isPaid = ticketsArePaidOnline(sidecars.tickets);
  const bookable = await resolveBookable(brand.id, isPaid);
  return {
    experience: mapExperience({ event, brand, ...sidecars, bookable }),
    brand,
  };
}
