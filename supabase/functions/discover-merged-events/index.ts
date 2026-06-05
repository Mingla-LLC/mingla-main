/**
 * ORCH-0824 — discover-merged-events
 *
 * Server-side fan-out edge function for the consumer Discover screen.
 * Merges first-party Mingla business events (from public.events) with
 * Ticketmaster results (proxied via the existing `ticketmaster-events`
 * edge function), ranks business events first, and returns one response.
 *
 * Invariants enforced here:
 *   - I-PROPOSED-DISCOVER-MERGE-BUSINESS-FIRST — business events strictly
 *     above Ticketmaster within the same query response.
 *   - I-PROPOSED-DISCOVER-TM-SUPPRESSION — when partyTypeSlugs OR vibeTagSlugs
 *     is non-empty, Ticketmaster is NOT called at all. Mingla-only music
 *     genres (disco-funk, mixed-variety) also suppress TM IF they are the
 *     ONLY genres in the filter.
 *
 * Anon-callable; verify_jwt=false in supabase/config.toml.
 *
 * Service-role is used for the Postgres read because:
 *   1. RLS for anon already permits SELECT on public+scheduled/live events
 *      via the baseline policy (line 14450 of baseline migration).
 *   2. Service-role avoids per-row policy evaluation overhead for the merged
 *      query that joins events + brands + ticket_types aggregations.
 *   3. Defense-in-depth: the WHERE clause re-applies the public-visibility
 *      filter explicitly, so a future RLS regression cannot leak private rows
 *      through this endpoint.
 *
 * See: Mingla_Artifacts/specs/SPEC_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md §3.2
 *      Mingla_Artifacts/reports/INVESTIGATION_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  PARTY_TYPE_SLUGS,
  VIBE_TAG_SLUGS,
  MUSIC_GENRE_SLUGS,
  mapMinglaMusicGenresToTmSlugs,
  isSubsetOf,
} from "../_shared/eventTaxonomy.ts";
import { parseLocalStartEndDateTime } from "../_shared/timezone.ts";
// ORCH-0877 — populate doorsOpenLocal + endsAtLocal on BusinessEventCard so
// the consumer-mobile date-line formatter can render cross-midnight events
// correctly. masterEndAtUtc carries the full UTC timestamp for client-side
// calendar-day comparison.
import { splitTimestampInTz } from "../_shared/dateTimeSplit.ts";
import {
  extractVenueName,
  extractBusinessEventFormat,
  deriveSharedFormat,
} from "./_helpers.ts";

// ─── CORS ────────────────────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── Types (matches SPEC §3.2.2 / §3.2.3) ────────────────────────────────────

interface DiscoverMergedRequest {
  city: {
    name: string;
    stateCode?: string | null;
    countryCode?: string | null;
    fallbackLat?: number;
    fallbackLng?: number;
    fallbackRadiusKm?: number;
  };
  segmentSlug?: string;
  genreSlugs?: string[];
  localStartEndDateTime?: string;
  keywords?: string[];
  sort?: string;
  page?: number;
  size?: number;
  // ORCH-0824: Mingla-native facets
  partyTypeSlugs?: string[];
  vibeTagSlugs?: string[];
  musicGenreSlugs?: string[];
  // ORCH-0828: IANA tz identifier; required when localStartEndDateTime is set
  // so the server can convert the client's wall-clock window to UTC instants
  // for the event_dates.start_at filter. Defaults to "UTC" when omitted.
  timezone?: string;
}

interface BusinessEventCard {
  eventId: string;
  brandId: string;
  brandSlug: string;
  eventSlug: string;
  brandName: string;
  brandProfilePhotoUrl: string | null;
  title: string;
  description: string | null;
  coverMediaUrl: string | null;
  coverMediaType: "image" | "video" | "gif" | null;
  coverHue: number;
  masterDateUtc: string | null;
  // ORCH-0877 — UTC end instant for cross-midnight resolution on the
  // consumer side. Mirrors masterDateUtc shape; null when source end_at
  // is missing or invalid.
  masterEndAtUtc: string | null;
  doorsOpenLocal: string | null;
  endsAtLocal: string | null;
  timezone: string;
  venueName: string | null;
  city: string | null;
  address: string | null;
  hideAddressUntilTicket: boolean;
  // ORCH-0846: shared-component format for @mingla/event-rendering
  // PublicEventPage. Resolved from theme.business_event.format with
  // is_online fallback (see _helpers.ts:deriveSharedFormat).
  format: "in-person" | "online" | "hybrid";
  locationGeo: { lat: number; lng: number } | null;
  partyTypes: string[];
  vibeTags: string[];
  musicGenres: string[];
  priceMin: number | null;
  priceMax: number | null;
  // ORCH-1006 Slice 3 Wave 2 — all-in (tax/fee-inclusive) lowest-tier
  // price in CENTS, computed server-side in
  // business_public_events_view.display_price_cents. null when there is
  // no priced tier (free / unpriced) → clients fall back to priceMin.
  // Pure data-plumbing of an existing column; no pricing math runs here.
  displayPriceCents: number | null;
  displayCurrency: string | null;
  currency: string;
  publicBuyerUrl: string;
}

type MergedDiscoverItem =
  | { source: "business_event"; item: BusinessEventCard }
  | { source: "ticketmaster"; item: Record<string, unknown> };

interface DiscoverMergedResponse {
  items: MergedDiscoverItem[];
  meta: {
    // ORCH-0839-A F-2: businessCount/ticketmasterCount report the count of
    // items actually returned in the response (post-slice). The pre-slice
    // upstream totals (available from DB count + TM `meta.totalResults`)
    // are exposed under separate *TotalAvailable fields for informational
    // use. Invariant: I-PROPOSED-DISCOVER-META-MATCHES-ITEMS.
    businessCount: number;
    ticketmasterCount: number;
    businessTotalAvailable: number;
    ticketmasterTotalAvailable: number;
    tmCalled: boolean;
    tmError: string | null;
    page: number;
    pageSize: number;
    fromCache: boolean;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BUSINESS_BUYER_DOMAIN =
  Deno.env.get("MINGLA_BUSINESS_BUYER_DOMAIN") ?? "https://business.mingla.app";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parsePoint(point: unknown): { lat: number; lng: number } | null {
  // Postgres `point` arrives via PostgREST as "(lng,lat)" string OR
  // an object {x: lng, y: lat}. Handle both defensively.
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
  return 25; // default warm orange, matches publish RPC fallback
}

function extractHideAddressUntilTicket(theme: unknown): boolean {
  if (theme && typeof theme === "object") {
    const be = (theme as Record<string, unknown>).business_event;
    if (be && typeof be === "object") {
      const v = (be as Record<string, unknown>).hideAddressUntilTicket;
      if (typeof v === "boolean") return v;
    }
  }
  return true; // safe default
}

// ─── Server ──────────────────────────────────────────────────────────────────

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  let body: DiscoverMergedRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  // ── Validate request ─────────────────────────────────────────────────────
  const cityName = body.city?.name?.trim();
  if (!cityName) {
    return jsonResponse({ error: "city_required" }, 400);
  }

  const page = Math.max(1, body.page ?? 1);
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, body.size ?? DEFAULT_PAGE_SIZE));

  const partyTypeSlugs = (body.partyTypeSlugs ?? []).filter(Boolean);
  const vibeTagSlugs = (body.vibeTagSlugs ?? []).filter(Boolean);
  const musicGenreSlugs = (body.musicGenreSlugs ?? []).filter(Boolean);

  // Canonical-slug guard at the edge so a malformed client cannot poison
  // the SQL with arbitrary strings (defense alongside DB CHECK constraint).
  if (partyTypeSlugs.length > 0 && !isSubsetOf(partyTypeSlugs, PARTY_TYPE_SLUGS as readonly string[])) {
    return jsonResponse({ error: "party_type_slugs_not_canonical" }, 400);
  }
  if (vibeTagSlugs.length > 0 && !isSubsetOf(vibeTagSlugs, VIBE_TAG_SLUGS as readonly string[])) {
    return jsonResponse({ error: "vibe_tag_slugs_not_canonical" }, 400);
  }
  if (musicGenreSlugs.length > 0 && !isSubsetOf(musicGenreSlugs, MUSIC_GENRE_SLUGS as readonly string[])) {
    return jsonResponse({ error: "music_genre_slugs_not_canonical" }, 400);
  }

  // ORCH-0828: parse localStartEndDateTime into UTC instants for the
  // business-events date filter. The Ticketmaster branch forwards the
  // raw string (TM's API interprets it directly).
  const requestTimezone = (body.timezone ?? "UTC").trim() || "UTC";
  let dateWindowUtc: { startUtc: string; endUtc: string } | null = null;
  if (body.localStartEndDateTime && body.localStartEndDateTime.length > 0) {
    try {
      dateWindowUtc = parseLocalStartEndDateTime(
        body.localStartEndDateTime,
        requestTimezone,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Treat any tz/parse error as a bad request — Intl.DateTimeFormat
      // throws RangeError on unknown timezones, and our helper throws
      // explicit errors on malformed pairs.
      return jsonResponse(
        {
          error: msg.startsWith("invalid_local_")
            ? msg
            : "invalid_timezone",
          detail: msg,
        },
        400,
      );
    }
  }

  // ── Supabase client (service-role for read; defense-in-depth WHERE) ──────
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return jsonResponse({ error: "supabase_env_missing" }, 500);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // ── Query business events ───────────────────────────────────────────────
  // Build dynamic conditions; use array overlap (&&) for taxonomy facets.
  const businessOffset = (page - 1) * size;

  // PostgREST equivalent of:
  //   SELECT events.*, brands.slug, brands.name, ed.start_at, MIN(tt.price_cents), MAX(tt.price_cents)
  //   FROM events
  //   JOIN brands ON ...
  //   INNER JOIN event_dates ed ON ed.event_id = events.id AND ed.is_master = true AND ed.end_at >= lowerBoundUtc
  //   LEFT JOIN ticket_types tt ON tt.event_id = events.id AND tt.deleted_at IS NULL ...
  // Implemented via a nested select with the supabase-js builder.
  //
  // Discover date-window history (most-recent last):
  //   ORCH-0828 [Consumer Discover timezone + sheet bugs] — introduced the
  //     dated-chip date-window math and switched the embed to !inner when a
  //     window is present so events without any master date row are excluded.
  //   ORCH-0839-A [Discover hardening] F-5 — switched the dated-chip lower
  //     bound from `start_at >= window.start` to `end_at >= window.start` so
  //     events that have already started but not ended remain visible under
  //     dated chips (notably "Tonight"). Preserves invariant
  //     I-PROPOSED-DISCOVER-TONIGHT-INCLUDES-IN-PROGRESS.
  //   ORCH-0845 [Discover excludes ended events] — makes the master-date +
  //     `end_at >= lowerBoundUtc` floor ALWAYS-ON. Pre-0845 the floor was
  //     scoped to the dated-chip branch, so the default "All" view (and any
  //     category/vibe/music chip without a date window) returned events whose
  //     master `end_at` was already in the past. `events.status='ended'` is
  //     operator-set only — nothing auto-flips it when end_at passes — so the
  //     read-side filter is the canonical "is past" check. Establishes
  //     invariant I-PROPOSED-DISCOVER-EXCLUDES-ENDED-MASTER-DATE (enforced by
  //     `.github/scripts/strict-grep/i-discover-excludes-ended-master-date.mjs`).
  //
  // Schema reassurance: `event_dates.end_at` is NOT NULL with CHECK
  // (end_at > start_at) per the baseline squash; no COALESCE fallback needed.
  // I-PROPOSED-AX EVENT_HAS_MASTER_DATE (ORCH-0792) + trigger
  // `biz_enforce_event_has_master_date` guarantees every row with
  // status IN ('scheduled','live') has at least one master event_dates row,
  // so the !inner embed is safe — it cannot legitimately exclude any row the
  // base predicate is already permitting.
  const eventDatesEmbed =
    "event_dates!inner ( id, start_at, end_at, timezone, is_master )";

  // Single reference-time decision before query build.
  //   No-window path → "now" at request time (UTC ISO string from Edge runtime).
  //   Dated-chip path → the window's start UTC (preserves ORCH-0839-A F-5
  //     "in-progress events stay under Tonight" semantics).
  // PostgREST applies the literal lowerBoundUtc server-side as a predicate
  // against `event_dates.end_at` (timestamptz), so the comparison is exact.
  const lowerBoundUtc: string =
    dateWindowUtc !== null ? dateWindowUtc.startUtc : new Date().toISOString();

  let q = supabase
    .from("events")
    .select(
      `
        id, brand_id, title, description, slug,
        location_text, location_geo, online_url, is_online,
        cover_media_url, cover_media_type,
        theme,
        visibility, status, published_at, timezone, currency,
        city, party_types, vibe_tags, music_genres,
        brand:brands!inner ( id, slug, name, profile_photo_url, deleted_at ),
        ${eventDatesEmbed},
        ticket_types!left ( price_cents, currency, deleted_at, is_hidden, is_disabled, available_online )
      `,
      { count: "exact" },
    )
    .is("deleted_at", null)
    .eq("visibility", "public")
    // ORCH-0859 (Tr2): exclude trip rows from the consumer event feed. Trips
    // surface to consumers in C1 [Consumer Discover Trips Tab] via a
    // dedicated query; until C1 ships, leaking trips into the events feed
    // would be jarring (event UX assumes single-date single-tier party-style
    // gatherings; trips are multi-day multi-tier multi-day itineraries).
    // Pre-M0 the events table only held event_type='event' rows so this
    // filter was implicit; post-M0 we make it explicit. See
    // I-1.2-UNIFIED-EVENT-TYPE invariant + investigation DISCOVERY-3.
    .eq("event_type", "event")
    .in("status", ["scheduled", "live"])
    // ORCH-0824 hotfix-5b: tolerate legacy CityPicker values that
    // include state/country (e.g. "Raleigh, NC, USA") by ALSO matching
    // the first comma-separated token. events.city is always the
    // structured locality from Google Places (e.g. "Raleigh"), so
    // matching either the raw cityName OR its first segment closes the
    // pre-hotfix-5b symmetry gap. Using .in() avoids PostgREST .or()
    // parsing issues with commas in the value.
    .in("city", (() => {
      const trimmed = cityName.trim();
      const firstSegment = trimmed.split(",")[0]?.trim();
      const out = [trimmed];
      if (firstSegment && firstSegment !== trimmed) out.push(firstSegment);
      return out;
    })())
    // ORCH-0845: always-on master-date + end-time floor. See the comment
    // block above the eventDatesEmbed declaration for the full rationale.
    .eq("event_dates.is_master", true)
    .gte("event_dates.end_at", lowerBoundUtc);

  if (partyTypeSlugs.length > 0) {
    q = q.overlaps("party_types", partyTypeSlugs);
  }
  if (vibeTagSlugs.length > 0) {
    q = q.overlaps("vibe_tags", vibeTagSlugs);
  }
  if (musicGenreSlugs.length > 0) {
    q = q.overlaps("music_genres", musicGenreSlugs);
  }

  // ORCH-0845: dated-chip upper bound stays conditional. The lower bound
  // (.gte event_dates.end_at) has been hoisted into the unconditional query
  // construction above so it applies on every code path.
  if (dateWindowUtc !== null) {
    q = q.lte("event_dates.start_at", dateWindowUtc.endUtc);
  }

  q = q.range(businessOffset, businessOffset + size - 1);

  const { data: rawRowsUngated, error: dbError, count: businessTotal } = await q;
  if (dbError) {
    console.error("[discover-merged-events] DB error:", dbError);
    return jsonResponse({ error: "db_error", detail: dbError.message }, 500);
  }

  // Normalize business events to BusinessEventCard shape + filter brands.deleted_at.
  type RawRow = Record<string, any>;

  // ──────────────────────────────────────────────────────────────────────────
  // ORCH-1076 I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED — buyer-supply suppression.
  // A PAID business-event from a brand that cannot charge (Stripe
  // charges_enabled=false / no attached account) must never appear in the
  // consumer feed — it would only dead-end at the ticket-checkout-create 409
  // (stripe_account_not_ready). This mirrors the publish-time guard (ORCH-1075)
  // + the checkout 409 + the supply RPCs (deck / place-card / brand-page).
  //   Stripe charges_enabled = "Whether the account can process charges."
  //     https://docs.stripe.com/api/accounts/object
  //   Accounts with outstanding requirements have charges_enabled=false and must
  //     finish onboarding: https://docs.stripe.com/connect/onboarding.md
  // PAID = a ticket_types row with available_online=true AND price_cents>0 (the
  // checkout definition). FREE + in-person-only-paid events are NEVER gated.
  // Readiness is resolved in ONE batched round-trip via the pg_brands_can_charge
  // helper RPC (no per-row function call). The keyed price side-fetch below
  // (business_public_events_view) is left UNTOUCHED — it only enriches the rows
  // that survive this gate.
  const isPaidRow = (row: RawRow): boolean =>
    (row.ticket_types ?? []).some(
      (t: RawRow) =>
        t &&
        t.deleted_at == null &&
        t.is_hidden !== true &&
        t.is_disabled !== true &&
        t.available_online === true &&
        (t.price_cents ?? 0) > 0,
    );

  const allRawRows = (rawRowsUngated ?? []) as RawRow[];
  const paidBrandIds = Array.from(
    new Set(
      allRawRows
        .filter(isPaidRow)
        .map((r) => r.brand_id)
        .filter((id: unknown): id is string => typeof id === "string"),
    ),
  );

  let rawRows: RawRow[] = allRawRows;
  if (paidBrandIds.length > 0) {
    const { data: readyRows, error: readyError } = await supabase.rpc(
      "pg_brands_can_charge",
      { p_brand_ids: paidBrandIds },
    );
    if (readyError) {
      // Fail-CLOSED on a paid-supply readiness error: drop ALL paid rows rather
      // than risk surfacing a non-bookable paid listing (the checkout would 409).
      // Free events are unaffected.
      console.error(
        "[discover-merged-events] pg_brands_can_charge error (failing closed for paid rows):",
        readyError,
      );
      rawRows = allRawRows.filter((r) => !isPaidRow(r));
    } else {
      const readyBrandIds = new Set<string>(
        ((readyRows ?? []) as RawRow[])
          .map((r) => r.brand_id)
          .filter((id: unknown): id is string => typeof id === "string"),
      );
      rawRows = allRawRows.filter(
        (r) => !isPaidRow(r) || readyBrandIds.has(r.brand_id),
      );
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  // ORCH-1006 Slice 3 Wave 2 — side-fetch the server-computed all-in price
  // from business_public_events_view, keyed by event id. Kept SEPARATE from
  // the events/ticket_types query above so that query (and every field it
  // returns) is untouched: if this view fetch errors, the map stays empty →
  // displayPriceCents resolves to null → clients fall back to the base
  // priceMin. No pricing math runs here; display_price_cents is precomputed
  // server-side (the canonical all-in engine output, already on prod).
  const allInByEventId = new Map<
    string,
    { displayPriceCents: number | null; displayCurrency: string | null }
  >();
  const allInEventIds = (rawRows ?? [])
    .map((r: RawRow) => r.id)
    .filter((id: unknown): id is string => typeof id === "string");
  if (allInEventIds.length > 0) {
    const { data: allInRows, error: allInError } = await supabase
      .from("business_public_events_view")
      .select("id, display_price_cents, pricing_currency")
      .in("id", allInEventIds);
    if (allInError) {
      console.error(
        "[discover-merged-events] all-in view query error:",
        allInError,
      );
    }
    for (const r of (allInRows ?? []) as RawRow[]) {
      allInByEventId.set(r.id, {
        displayPriceCents: r.display_price_cents ?? null,
        displayCurrency: r.pricing_currency ?? null,
      });
    }
  }

  const businessItems: BusinessEventCard[] = (rawRows ?? [])
    .filter((row: RawRow) => row.brand && row.brand.deleted_at == null)
    .map((row: RawRow): BusinessEventCard => {
      const masterDate = (row.event_dates ?? []).find(
        (ed: RawRow) => ed?.is_master === true,
      );
      // ORCH-0877 — derive local time strings from the master event_dates
      // row using the event's own timezone. Cross-midnight events get a
      // non-null masterEndAtUtc that lets the client compare calendar days.
      const eventTz: string = row.timezone ?? masterDate?.timezone ?? "UTC";
      const startSplit = splitTimestampInTz(
        masterDate?.start_at ?? null,
        eventTz,
      );
      const endSplit = splitTimestampInTz(
        masterDate?.end_at ?? null,
        eventTz,
      );
      const activeTickets = (row.ticket_types ?? []).filter(
        (tt: RawRow) =>
          tt && tt.deleted_at == null && tt.is_hidden !== true && tt.is_disabled !== true,
      );
      // ORCH-0824 (QA F-5 fix): explicit null filter before Number cast.
      // `Number(null) === 0` would silently push 0 into the prices array
      // and make priceMin === 0 for a row with a null-priced ticket alongside
      // priced ones. Filter nulls first so the Number cast only runs on
      // non-null inputs, and the resulting prices array contains only
      // actual ticket prices.
      const prices = activeTickets
        .filter((tt: RawRow) => tt.price_cents != null)
        .map((tt: RawRow) => Number(tt.price_cents))
        .filter((n: number) => Number.isFinite(n));
      const priceMin = prices.length ? Math.min(...prices) / 100 : null;
      const priceMax = prices.length ? Math.max(...prices) / 100 : null;
      const hide = extractHideAddressUntilTicket(row.theme);
      return {
        eventId: row.id,
        brandId: row.brand_id,
        brandSlug: row.brand.slug,
        brandName: row.brand.name,
        brandProfilePhotoUrl: row.brand.profile_photo_url ?? null,
        eventSlug: row.slug,
        title: row.title,
        description: row.description ?? null,
        coverMediaUrl: row.cover_media_url ?? null,
        coverMediaType: row.cover_media_type ?? null,
        coverHue: extractCoverHue(row.theme),
        masterDateUtc: masterDate?.start_at ?? null,
        // ORCH-0877 — was hard-coded null pre-fix (with a TODO comment
        // saying "derivable on client"). Now populated server-side so the
        // consumer-mobile centralized formatter can render the local time
        // range directly. masterEndAtUtc carries the full UTC end-instant
        // for client-side calendar-day comparison.
        masterEndAtUtc: masterDate?.end_at ?? null,
        doorsOpenLocal: startSplit.time,
        endsAtLocal: endSplit.time,
        timezone: row.timezone ?? "UTC",
        // ORCH-0846: parity with brand-side publicEventsService.toPublicEventBySlug.
        // Resolve venueName from theme.business_event.venueName, falling
        // back to location_text. The shared PublicEventPage gates the
        // venue card render on `venueName !== null`; without this fallback
        // the card would never appear on the consumer sheet.
        venueName: extractVenueName(row.theme) ?? row.location_text ?? null,
        city: row.city ?? null,
        // ORCH-0846: pass address unconditionally and let the shared
        // component gate visibility via hideAddressUntilTicket. Mirrors
        // brand-side mechanism at publicEventsService.ts:378 and
        // PublicEventPage.tsx:380-384.
        address: row.location_text ?? null,
        hideAddressUntilTicket: hide,
        // ORCH-0846: derive shared-component format string from
        // theme.business_event.format with is_online fallback. Hardcoded
        // "in-person" in the consumer mapping previously misrepresented
        // online and hybrid events.
        format: deriveSharedFormat(
          extractBusinessEventFormat(row.theme),
          row.is_online === true,
        ),
        locationGeo: parsePoint(row.location_geo),
        partyTypes: Array.isArray(row.party_types) ? row.party_types : [],
        vibeTags: Array.isArray(row.vibe_tags) ? row.vibe_tags : [],
        musicGenres: Array.isArray(row.music_genres) ? row.music_genres : [],
        priceMin,
        priceMax,
        // ORCH-1006 Slice 3 Wave 2 — all-in lowest-tier price (cents) + its
        // currency, side-fetched from business_public_events_view above.
        // null when the row has no priced tier → clients fall back to
        // priceMin. No math here; display_price_cents is precomputed.
        displayPriceCents: allInByEventId.get(row.id)?.displayPriceCents ?? null,
        displayCurrency: allInByEventId.get(row.id)?.displayCurrency ?? null,
        currency: row.currency ?? "GBP",
        publicBuyerUrl: `${BUSINESS_BUYER_DOMAIN}/e/${row.brand.slug}/${row.slug}`,
      };
    })
    // Sort soonest-first within business partition (I-PROPOSED-DISCOVER-MERGE-BUSINESS-FIRST).
    .sort((a: BusinessEventCard, b: BusinessEventCard): number => {
      const aT = a.masterDateUtc ? Date.parse(a.masterDateUtc) : Number.POSITIVE_INFINITY;
      const bT = b.masterDateUtc ? Date.parse(b.masterDateUtc) : Number.POSITIVE_INFINITY;
      return aT - bT;
    });

  // ── Decide TM call gate ─────────────────────────────────────────────────
  let tmCalled = false;
  let tmError: string | null = null;
  let tmItems: Record<string, unknown>[] = [];
  let tmTotal = 0;

  // Suppression rule: any Party Type or Vibe filter → no TM.
  const tmSuppressedByMinglaFacet =
    partyTypeSlugs.length > 0 || vibeTagSlugs.length > 0;

  // For music genres: if filter is non-empty AND every value is Mingla-only,
  // skip TM. If at least one maps to TM, forward only the TM-mappable ones.
  const { tmMappable, minglaOnly } = mapMinglaMusicGenresToTmSlugs(musicGenreSlugs);
  const tmSuppressedByMinglaOnlyGenres =
    musicGenreSlugs.length > 0 && tmMappable.length === 0;

  const tmGate = !tmSuppressedByMinglaFacet && !tmSuppressedByMinglaOnlyGenres;

  if (tmGate) {
    tmCalled = true;
    // Forward existing TM facets + the TM-mappable music genres (if any
    // were Mingla-mapped). If the caller already passed genreSlugs (legacy
    // TM path), append the mapped Mingla genres rather than replacing.
    const mergedTmGenreSlugs = [
      ...(body.genreSlugs ?? []),
      ...tmMappable,
    ];

    const tmPayload: Record<string, unknown> = {
      city: cityName,
      stateCode: body.city.stateCode ?? null,
      countryCode: body.city.countryCode ?? null,
      latFallback: body.city.fallbackLat,
      lngFallback: body.city.fallbackLng,
      radiusFallback: body.city.fallbackRadiusKm,
      segmentSlug: body.segmentSlug,
      genreSlugs: mergedTmGenreSlugs.length > 0 ? mergedTmGenreSlugs : undefined,
      localStartEndDateTime: body.localStartEndDateTime,
      keywords: body.keywords,
      sort: body.sort,
      page,
      size,
    };

    try {
      const tmRes = await supabase.functions.invoke("ticketmaster-events", {
        body: tmPayload,
      });
      if (tmRes.error) {
        tmError = tmRes.error.message ?? "ticketmaster_invoke_failed";
        console.warn("[discover-merged-events] TM error:", tmError);
      } else if (tmRes.data && Array.isArray(tmRes.data.events)) {
        tmItems = tmRes.data.events;
        tmTotal = tmRes.data.meta?.totalResults ?? tmItems.length;

        // ORCH-0839-A F-2: when upstream reports totalResults > 0 but
        // returns events=[], treat as an upstream cache/pagination defect
        // and surface as tmError so the client banner fires. The F-1 fix
        // in ticketmaster-events should eliminate the observed case (cache
        // slice off-by-one); this defense-in-depth catches future
        // regressions in any TM-events path that drops events while
        // reporting non-zero totalResults.
        // Invariant: I-PROPOSED-DISCOVER-META-MATCHES-ITEMS.
        if (tmItems.length === 0 && tmTotal > 0) {
          console.warn(
            "[discover-merged-events] TM upstream reported totalResults=" +
              tmTotal +
              " but events=[] — flagging as tmError",
          );
          tmError = tmError ?? "ticketmaster_upstream_dropped_events";
        }
      }
    } catch (e) {
      tmError = e instanceof Error ? e.message : String(e);
      console.warn("[discover-merged-events] TM throw:", tmError);
    }

    // If the filter required at least one Mingla-only genre alongside TM-mappable
    // ones, FURTHER filter the TM results: TM cannot satisfy the Mingla-only
    // value, but we still allow TM through the TM-mappable side. This is the
    // honest behavior — see SPEC §3.4.2.
    void minglaOnly; // intentional: documented but not enforced beyond suppression gate
  }

  // ── Merge: strict partition, business first ─────────────────────────────
  // ORCH-0824 (QA F-2 fix): truncate the merged list to `size` per SPEC
  // §3.2.4 step 6 "Simple count-based — first `size` items from merged list".
  // Business events take precedence — they fill the page first, TM fills
  // any remaining slots.
  const businessSpread: MergedDiscoverItem[] = businessItems.map(
    (it): MergedDiscoverItem => ({ source: "business_event", item: it }),
  );
  const remainingForTm = Math.max(0, size - businessSpread.length);
  const tmSpread: MergedDiscoverItem[] = tmItems
    .slice(0, remainingForTm)
    .map((it): MergedDiscoverItem => ({ source: "ticketmaster", item: it }));
  const items: MergedDiscoverItem[] = [
    ...businessSpread.slice(0, size),
    ...tmSpread,
  ];

  const response: DiscoverMergedResponse = {
    items,
    meta: {
      // ORCH-0839-A F-2: post-slice counts match items[] exactly. Pre-slice
      // upstream totals exposed separately as *TotalAvailable.
      // Invariant: I-PROPOSED-DISCOVER-META-MATCHES-ITEMS.
      businessCount: businessSpread.length,
      ticketmasterCount: tmSpread.length,
      businessTotalAvailable: businessTotal ?? businessItems.length,
      ticketmasterTotalAvailable: tmTotal,
      tmCalled,
      tmError,
      page,
      pageSize: size,
      fromCache: false,
    },
  };

  return jsonResponse(response);
});
