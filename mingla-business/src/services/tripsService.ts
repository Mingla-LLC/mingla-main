/**
 * tripsService — CRUD operations for event_type='trip' rows + sidecar tables
 * (trip_days, trip_pricing_tiers, trip_inclusions). Tr2 (ORCH-0859).
 *
 * Pattern mirrors brandsService.ts (ORCH-0855 Tr1 precedent):
 *   - Throws on Postgrest error
 *   - SlugCollisionError on 23505 from the publish RPC
 *   - DELETE-then-INSERT upsert for sidecar tables (Tr2 design — simpler than
 *     ON CONFLICT given the wizard's small day-count + frequent reorder)
 *
 * Per I-1.2-UNIFIED-EVENT-TYPE: trips are events rows with event_type='trip'.
 * Per Tr2 §4.2 (amended 2026-05-17 Option B): publish calls
 * `business_publish_trip_draft` RPC (NOT the event publish RPC).
 *
 * Spec: Mingla_Artifacts/specs/SPEC_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP.md §4.6
 */

import { supabase } from "./supabase";
import type { BrandRole } from "../store/currentBrandStore";

// ---------------------- Types ----------------------

/**
 * ORCH-1119 [trip-day-media-gallery] — one item in a trip DAY's optional ordered
 * media gallery. Every item carries an EXPLICIT `type` so the renderer never
 * auto-detects (ORCH-1069/0978 rule). Persisted as jsonb on trip_days.media.
 */
export interface TripDayMedia {
  url: string;
  type: "image" | "video";
  provider?: string;
  width?: number;
  height?: number;
}

/**
 * ORCH-1119 — defensively coerce raw jsonb (`trip_days.media`) into a clean
 * TripDayMedia[]. Drops any item missing a string `url` or a valid
 * "image"|"video" `type` (the renderer must never be handed a typeless/malformed
 * item). Mirrors the `extractInstallmentSchedule` defensive pattern.
 */
export function coerceTripDayMedia(raw: unknown): TripDayMedia[] {
  if (!Array.isArray(raw)) return [];
  const out: TripDayMedia[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const url = o.url;
    const type = o.type;
    if (typeof url !== "string" || url.length === 0) continue;
    if (type !== "image" && type !== "video") continue;
    const next: TripDayMedia = { url, type };
    if (typeof o.provider === "string") next.provider = o.provider;
    if (typeof o.width === "number") next.width = o.width;
    if (typeof o.height === "number") next.height = o.height;
    out.push(next);
  }
  return out;
}

export interface TripDay {
  id: string;
  eventId: string;
  ordinal: number;
  title: string;
  narrative: string | null;
  date: string | null;
  stops: unknown[];
  // ORCH-1119 — optional ordered per-day media gallery (default []).
  media: TripDayMedia[];
}

export interface TripPricingTier {
  id: string;
  eventId: string;
  ticketTypeId: string;
  tierName: string;
  tierMetadata: Record<string, unknown>;
  priceCents: number;
  currency: string;
  quantityTotal: number | null;
  /**
   * ORCH-0946 — remaining bookable seats from `pg_public_ticket_types_remaining`.
   * Null when `isUnlimited` is true OR when this tier was mapped outside the
   * public-read path (e.g., admin draft loads via `mapTripPricingTier`).
   * Buyer-checkout sold-out gate + QuantityRow "+" cap consume this;
   * `quantityTotal` retains its prior meaning (total tier capacity).
   */
  ticketsRemaining: number | null;
  isUnlimited: boolean;
  /**
   * ORCH-0873 [Tr3 Stage 2 UI] — extracted from
   * tier_metadata.installments JSONB for convenient typed access by the
   * trip wizard's PaymentPlanEditor. Null when the trip has no payment
   * plan configured.
   */
  installmentSchedule: TripInstallmentScheduleData | null;
  /**
   * META-ORCH-1174 Leg B2 — optional per-package marketing description
   * (e.g. "Includes spa + private transfer"). Persisted to
   * trip_pricing_tiers.tier_metadata.description (free-form jsonb — NO
   * migration; the column already holds installments under the same object).
   * Null when the package has no description. Surfaced by the wizard's
   * per-package authoring rows; the public selector (B3) renders it under the
   * package name.
   */
  description: string | null;
  /**
   * ORCH-1147 — server fee-grossed per-tier all-in in MAJOR units
   * (`pg_public_event_tier_allin` → /100). Null = free tier or RPC miss;
   * the cart seed falls back to `priceCents`/base. NEVER recompute fees in TS.
   * Only the public buyer-read path (`getPublicTripById`) populates it; admin
   * draft loads (`mapTripPricingTier`) leave it unset → base fallback.
   */
  priceAllInGbp?: number | null;
}

/**
 * ORCH-0873 — payment plan schedule shape persisted under
 * trip_pricing_tiers.tier_metadata.installments per
 * SPEC_ORCH-0869 §3.1.
 */
export interface TripInstallmentScheduleData {
  deposit_pct: number;
  installments: Array<{
    ordinal: number;
    pct: number;
    days_after_booking?: number;
    fixed_date?: string;
  }>;
}

export interface TripInclusion {
  id: string;
  eventId: string;
  kind: "included" | "excluded";
  item: string;
  ordinal: number;
}

export interface TripBusinessTrip {
  startAt: string | null;
  endAt: string | null;
  destinationPlaceId: string | null;
  destinationLocationText: string | null;
  destinationLat: number | null;
  destinationLng: number | null;
  // ORCH-1016 — DEPARTURE/origin city. departureLocationText is sourced from the
  // canonical events.departure_text column (synced from theme.business_trip by the
  // ORCH-1016 trigger); placeId/lat/lng read from theme.business_trip.
  departurePlaceId: string | null;
  departureLocationText: string | null;
  departureLat: number | null;
  departureLng: number | null;
  capacity: number | null;
}

export interface Trip {
  id: string;
  brandId: string;
  brandSlug: string | null;
  title: string;
  description: string | null;
  slug: string;
  status: "draft" | "scheduled" | "live" | "ended" | "cancelled";
  visibility: "draft" | "public" | "private" | "hidden";
  publishedAt: string | null;
  timezone: string;
  coverMediaUrl: string | null;
  coverMediaType: string | null;
  businessTrip: TripBusinessTrip;
  days: TripDay[];
  pricingTiers: TripPricingTier[];
  inclusions: TripInclusion[];
  createdAt: string;
  updatedAt: string;
  // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline]:
  /** Cascading refund tier policy; null = no refund policy set. */
  refundPolicy: import("./refundPolicyService").RefundPolicy | null;
  /** Absolute timestamp after which bookings auto-close; null = no deadline. */
  bookingDeadline: string | null;
  bookingsClosed: boolean;
  bookingsClosedAt: string | null;
  /**
   * ORCH-0947: count of tickets occupying a seat
   * (status IN ('valid','used','transferred')) for this trip's
   * ticket_types. Mirrors the checkout RPC capacity gate.
   * Server-derived via biz_trip_tickets_sold(p_event_id).
   */
  ticketsSoldCount: number;
  /**
   * META-ORCH-1059 Pass 1 — total paid revenue (sum of orders.total_cents where
   * payment_status='paid') for this trip, in minor units of `revenueCurrency`.
   * Populated by the list query (`getTripsByBrand`) via one batched orders
   * aggregation so the Hub list-card can show a money/revenue strip with parity
   * to the events list. 0 when no paid orders exist. The detail read paths leave
   * it 0 (the dashboard derives revenue from useTripOrders).
   */
  revenueCents?: number;
  /** Currency code for `revenueCents` (defaults to the first paid order's currency). */
  revenueCurrency?: string | null;
  /**
   * ORCH-1006 — per-offering all-in pricing switches. Each NULL = inherit the
   * brand default; explicit boolean = override. Read from events.pass_*.
   * Optional: `mapTrip` (the authoring read path) always populates it; public
   * Trip constructions omit it (the public buyer surfaces don't author).
   */
  pricingSwitches?: {
    passTax: boolean | null;
    passMinglaFee: boolean | null;
    passServiceFee: boolean | null;
  };
}

export interface CreateTripDraftInput {
  brandId: string;
  initialTitle?: string;
}

export interface TripBasicsPatch {
  title?: string;
  description?: string | null;
  businessTrip?: Partial<TripBusinessTrip>;
  coverMediaUrl?: string | null;
  coverMediaType?: "image" | "video" | "gif" | null;
  timezone?: string;
}

export interface TripDayInput {
  ordinal: number;
  title: string;
  narrative?: string | null;
  date?: string | null;
  // ORCH-1119 — optional per-day media gallery; rides draft (upsertTripDays) +
  // published-edit (biz_update_live_trip §5b) writes.
  media?: TripDayMedia[];
}

export interface TripInclusionInput {
  kind: "included" | "excluded";
  item: string;
  ordinal: number;
}

export interface TripPricingPatch {
  /**
   * META-ORCH-1174 Leg B1 — when a trip has MULTIPLE pricing tiers (packages),
   * the caller MUST identify which tier this patch targets by its
   * `ticketTypeId`. When omitted, `updateTripPricing` falls back to the trip's
   * sole tier (deterministically the earliest-created one if, defensively, more
   * than one exists) — preserving the single-package wizard's call shape with
   * zero change. Lifting the historical `.maybeSingle()`-throws-on->1 choke is
   * what makes N packages possible at the data layer (DEC-1174-B).
   */
  ticketTypeId?: string;
  tierName: string;
  priceCents: number;
  capacity: number;
  /**
   * Optional. If provided, IGNORED. Currency is always derived from the
   * parent event (which was set at create time from brand.default_currency).
   * Kept on the type only for backwards source compatibility — callers
   * MUST NOT depend on it.
   *
   * ORCH-0859 REWORK 2: enforced server-side because the
   * tg_enforce_event_ticket_currency trigger (ORCH-0769) rejects any
   * mismatch. Letting the wizard pass a user-typed currency caused
   * `ticket_currency_must_match_event_currency` on autosave.
   */
  currency?: string;
  /**
   * ORCH-0873 [Tr3 Stage 2 UI] — payment plan schedule. Persisted to
   * trip_pricing_tiers.tier_metadata.installments JSONB key per
   * SPEC_ORCH-0869 §3.1 (Tr2-reserved location chosen over the brief's
   * superseded ticket_types.installment_schedule proposal). When null OR
   * absent, the tier_metadata.installments key is REMOVED from the
   * existing tier_metadata object (single-payment trip). The cron + Stage
   * 1b finalize key off the JSONB presence/shape.
   */
  installmentSchedule?: TripInstallmentScheduleData | null;
  /**
   * META-ORCH-1174 Leg B2 — optional per-package description. When the key is
   * PRESENT, the tier_metadata.description value is replaced (null/blank →
   * REMOVE the key). When ABSENT from the patch, the existing description is
   * preserved (mirrors the installmentSchedule "present vs absent" semantics).
   */
  description?: string | null;
}

export class SlugCollisionError extends Error {
  constructor(public attemptedSlug: string) {
    super(`Trip slug "${attemptedSlug}" is taken on this brand.`);
    this.name = "SlugCollisionError";
  }
}

export class TripPublishValidationError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "TripPublishValidationError";
  }
}

// ---------------------- Row mappers ----------------------

interface TripDayRow {
  id: string;
  event_id: string;
  ordinal: number;
  title: string;
  narrative: string | null;
  date: string | null;
  stops: unknown[];
  // ORCH-1119 — raw jsonb media gallery (coerced via coerceTripDayMedia).
  media: unknown;
}

interface TripPricingTierRow {
  id: string;
  event_id: string;
  ticket_type_id: string;
  tier_name: string;
  tier_metadata: Record<string, unknown>;
}

interface TripInclusionRow {
  id: string;
  event_id: string;
  kind: "included" | "excluded";
  item: string;
  ordinal: number;
}

interface TicketTypeRow {
  id: string;
  event_id: string;
  price_cents: number;
  currency: string;
  quantity_total: number | null;
  is_unlimited: boolean;
}

interface EventRow {
  id: string;
  brand_id: string;
  title: string;
  description: string | null;
  slug: string;
  status: "draft" | "scheduled" | "live" | "ended" | "cancelled";
  visibility: "draft" | "public" | "private" | "hidden";
  published_at: string | null;
  timezone: string;
  cover_media_url: string | null;
  cover_media_type: string | null;
  destination_text?: string | null;
  departure_text?: string | null; // ORCH-1016 canonical departure column
  theme: Record<string, unknown> | null;
  event_type: "event" | "experience" | "trip";
  created_at: string;
  updated_at: string;
  // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — new columns from
  // migration 20260612000000.
  refund_policy: unknown | null;
  booking_deadline: string | null;
  bookings_closed: boolean | null;
  bookings_closed_at: string | null;
  // ORCH-1006 — per-offering all-in pricing switches. NULL = inherit brand
  // default. Selected via getTrip's `select("*")`.
  pass_tax?: boolean | null;
  pass_mingla_fee?: boolean | null;
  pass_service_fee?: boolean | null;
}

interface EventDateRow {
  event_id: string;
  start_at: string | null;
  end_at: string | null;
  is_master: boolean;
}

function mapTripDay(row: TripDayRow): TripDay {
  return {
    id: row.id,
    eventId: row.event_id,
    ordinal: row.ordinal,
    title: row.title,
    narrative: row.narrative,
    date: row.date,
    stops: Array.isArray(row.stops) ? row.stops : [],
    // ORCH-1119 — coerce raw jsonb to a clean typed gallery (drops malformed).
    media: coerceTripDayMedia(row.media),
  };
}

function mapTripInclusion(row: TripInclusionRow): TripInclusion {
  return {
    id: row.id,
    eventId: row.event_id,
    kind: row.kind,
    item: row.item,
    ordinal: row.ordinal,
  };
}

function mapTripPricingTier(
  row: TripPricingTierRow,
  ticketType: TicketTypeRow | undefined,
): TripPricingTier {
  const metadata = (row.tier_metadata ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    eventId: row.event_id,
    ticketTypeId: row.ticket_type_id,
    tierName: row.tier_name,
    tierMetadata: metadata,
    priceCents: ticketType?.price_cents ?? 0,
    currency: ticketType?.currency ?? "",
    quantityTotal: ticketType?.quantity_total ?? null,
    // ORCH-0946 — admin/draft loads don't have a remaining-count source;
    // public-read paths overwrite this via `getPublicTripById`.
    ticketsRemaining: null,
    isUnlimited: ticketType?.is_unlimited ?? false,
    installmentSchedule: extractInstallmentSchedule(metadata),
    // META-ORCH-1174 Leg B2 — per-package description from tier_metadata.
    description: extractTierDescription(metadata),
  };
}

/**
 * META-ORCH-1174 Leg B2 — extract the optional per-package description from
 * tier_metadata.description. Returns null on missing key / non-string / blank.
 */
function extractTierDescription(
  metadata: Record<string, unknown>,
): string | null {
  const raw = metadata.description;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * ORCH-0873 [Tr3 Stage 2 UI] — extract typed installment schedule from
 * tier_metadata JSONB. Returns null on missing key / malformed shape;
 * the wizard's PaymentPlanEditor treats null as "single-payment trip".
 */
function extractInstallmentSchedule(
  metadata: Record<string, unknown>,
): TripInstallmentScheduleData | null {
  const raw = metadata.installments;
  if (raw === null || raw === undefined || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const depositPct = obj.deposit_pct;
  const installments = obj.installments;
  if (typeof depositPct !== "number" || !Array.isArray(installments)) {
    return null;
  }
  const cleanInstallments = installments
    .map((inst, i) => {
      if (typeof inst !== "object" || inst === null) return null;
      const r = inst as Record<string, unknown>;
      const ordinal =
        typeof r.ordinal === "number" ? r.ordinal : i + 1;
      const pct = typeof r.pct === "number" ? r.pct : 0;
      const days =
        typeof r.days_after_booking === "number"
          ? r.days_after_booking
          : undefined;
      const fixed =
        typeof r.fixed_date === "string" ? r.fixed_date : undefined;
      if (days === undefined && fixed === undefined) return null;
      return {
        ordinal,
        pct,
        ...(days !== undefined ? { days_after_booking: days } : {}),
        ...(fixed !== undefined ? { fixed_date: fixed } : {}),
      };
    })
    .filter((x): x is TripInstallmentScheduleData["installments"][number] => x !== null);
  if (cleanInstallments.length === 0) return null;
  return { deposit_pct: depositPct, installments: cleanInstallments };
}

function readBusinessTrip(
  theme: Record<string, unknown> | null,
  ticketCapacity: number | null,
  canonicalStartAt: string | null,
  canonicalEndAt: string | null,
  canonicalDestination: string | null,
  canonicalDeparture: string | null,
): TripBusinessTrip {
  const bt = (theme?.business_trip as Record<string, unknown> | undefined) ?? {};
  return {
    startAt: canonicalStartAt,
    endAt: canonicalEndAt,
    destinationPlaceId:
      typeof bt.destinationPlaceId === "string" ? bt.destinationPlaceId : null,
    destinationLocationText: canonicalDestination,
    destinationLat:
      typeof bt.destinationLat === "number" ? bt.destinationLat : null,
    destinationLng:
      typeof bt.destinationLng === "number" ? bt.destinationLng : null,
    // ORCH-1016 — departureLocationText from the canonical column; the rest from theme.
    departurePlaceId:
      typeof bt.departurePlaceId === "string" ? bt.departurePlaceId : null,
    departureLocationText: canonicalDeparture,
    departureLat:
      typeof bt.departureLat === "number" ? bt.departureLat : null,
    departureLng:
      typeof bt.departureLng === "number" ? bt.departureLng : null,
    capacity: ticketCapacity,
  };
}

function mapTrip(
  event: EventRow,
  brandSlug: string | null,
  days: TripDayRow[],
  tiers: TripPricingTierRow[],
  inclusions: TripInclusionRow[],
  ticketTypes: TicketTypeRow[],
  ticketsSoldCount: number,
  masterDate: EventDateRow | null = null,
  revenue: { cents: number; currency: string | null } = { cents: 0, currency: null },
): Trip {
  const ticketTypesById = new Map(ticketTypes.map((tt) => [tt.id, tt]));
  return {
    id: event.id,
    brandId: event.brand_id,
    brandSlug,
    title: event.title,
    description: event.description,
    slug: event.slug,
    status: event.status,
    visibility: event.visibility,
    publishedAt: event.published_at,
    timezone: event.timezone,
    coverMediaUrl: event.cover_media_url,
    coverMediaType: event.cover_media_type,
    businessTrip: readBusinessTrip(
      event.theme,
      ticketTypes[0]?.quantity_total ?? null,
      masterDate?.start_at ?? null,
      masterDate?.end_at ?? null,
      event.destination_text ?? null,
      event.departure_text ?? null,
    ),
    days: days.map(mapTripDay),
    pricingTiers: tiers.map((t) =>
      mapTripPricingTier(t, ticketTypesById.get(t.ticket_type_id)),
    ),
    inclusions: inclusions.map(mapTripInclusion),
    createdAt: event.created_at,
    updatedAt: event.updated_at,
    // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — pass-through fields.
    // refund_policy validated DB-side via events_refund_policy_valid CHECK +
    // validate_refund_policy() function; client treats the JSONB shape as
    // RefundPolicy when present.
    refundPolicy: (event.refund_policy as
      | import("./refundPolicyService").RefundPolicy
      | null) ?? null,
    bookingDeadline: event.booking_deadline,
    bookingsClosed: event.bookings_closed === true,
    bookingsClosedAt: event.bookings_closed_at,
    ticketsSoldCount,
    // META-ORCH-1059 Pass 1 — batched list-query revenue (0 on detail reads).
    revenueCents: revenue.cents,
    revenueCurrency: revenue.currency,
    // ORCH-1006 — pricing switches from events.pass_*. NULL = inherit.
    pricingSwitches: {
      passTax: event.pass_tax ?? null,
      passMinglaFee: event.pass_mingla_fee ?? null,
      passServiceFee: event.pass_service_fee ?? null,
    },
  };
}

// ---------------------- ORCH-1006 pricing switches ----------------------

/**
 * Persist a trip's per-offering all-in pricing switches to events.pass_*.
 *
 * Direct column write (NULL = inherit the brand default) — mirrors the event
 * draft path and supports true per-column inheritance, unlike the all-or-nothing
 * `business_set_pricing_switches` RPC. Owner-scoped by the events RLS policy
 * (same policy that governs `updateTripBasics`). The CALLER must only invoke
 * this when the trip is NOT locked (no confirmed bookings) — once a ticket
 * sells the section renders read-only and no write is attempted, mirroring the
 * server-side post-sale lock.
 */
export async function setTripPricingSwitches(
  eventId: string,
  overrides: {
    passTax: boolean | null;
    passMinglaFee: boolean | null;
    passServiceFee: boolean | null;
  },
): Promise<void> {
  // I-PROPOSED-I (MUTATION-ROWCOUNT-VERIFIED): chain .select() so a 0-row write
  // (RLS denial / wrong id / not-a-trip) surfaces as an error, never a silent
  // no-op. Mirrors patchPublishedEventPricingSwitches on the event side.
  const { data, error } = await supabase
    .from("events")
    .update({
      pass_tax: overrides.passTax,
      pass_mingla_fee: overrides.passMinglaFee,
      pass_service_fee: overrides.passServiceFee,
    })
    .eq("id", eventId)
    .eq("event_type", "trip")
    .select("id");
  if (error) throw error;
  if (data === null || data.length === 0) {
    throw new Error("set_trip_pricing_switches_no_rows");
  }
}

// ---------------------- createTripDraft ----------------------

/**
 * Creates a draft event_type='trip' row + placeholder ticket_types row +
 * placeholder trip_pricing_tiers row joining the two. Returns the Trip with
 * empty days/inclusions arrays + single placeholder pricing tier.
 *
 * The placeholder ticket_types row has price_cents=0, is_unlimited=false,
 * quantity_total=1 — updated during Step 4 of the wizard via updateTripPricing.
 */
export async function createTripDraft(
  input: CreateTripDraftInput,
  _role: BrandRole,
): Promise<Trip> {
  // I-BRAND-UNIVERSAL-AUTHORING (META-ORCH-0972) — no kind gate.

  const tempTitle = input.initialTitle?.trim() || "Untitled trip";
  const tempSlug = `draft-${Date.now().toString(36)}`;

  // 1. Look up brand default_currency + slug BEFORE creating the event.
  //    The events row MUST carry a non-null currency or the
  //    tg_enforce_event_ticket_currency trigger (ORCH-0769 [no implicit GBP
  //    currency], 20260515000011_orch_0769_no_implicit_gbp_currency.sql:159)
  //    raises `event_currency_not_found` when the placeholder ticket_types
  //    row is inserted below. Mirrors `eventDrafts.fetchBrandDefaultCurrency`
  //    + `draftToServerInsert` ordering for event_type='event'.
  const brandCurrencyQuery = await supabase
    .from("brands")
    .select("default_currency, slug")
    .eq("id", input.brandId)
    .is("deleted_at", null)
    .maybeSingle();
  if (brandCurrencyQuery.error) throw brandCurrencyQuery.error;
  const defaultCurrency =
    (brandCurrencyQuery.data?.default_currency as string | null) ?? "USD";
  const brandSlug = (brandCurrencyQuery.data?.slug as string | null) ?? null;

  // 2. INSERT events row with currency populated up front.
  const { data: eventRow, error: eventError } = await supabase
    .from("events")
    .insert({
      brand_id: input.brandId,
      created_by: (await supabase.auth.getUser()).data.user?.id ?? null,
      title: tempTitle,
      slug: tempSlug,
      event_type: "trip",
      status: "draft",
      visibility: "draft",
      currency: defaultCurrency,
      theme: { business_trip: {} },
      timezone: "UTC",
    })
    .select()
    .single();

  if (eventError) {
    if (eventError.code === "23505") {
      throw new SlugCollisionError(tempSlug);
    }
    throw eventError;
  }
  if (eventRow === null) {
    throw new Error("createTripDraft: insert returned null row");
  }

  // 3. INSERT placeholder ticket_types row (price 0, capacity 1)

  const { data: ticketRow, error: ticketError } = await supabase
    .from("ticket_types")
    .insert({
      event_id: eventRow.id,
      name: "Standard",
      price_cents: 0,
      currency: defaultCurrency,
      quantity_total: 1,
      is_unlimited: false,
      is_free: true,
      min_purchase_qty: 1,
      available_online: true,
      available_in_person: false,
      display_order: 0,
    })
    .select()
    .single();

  if (ticketError) throw ticketError;
  if (ticketRow === null) {
    throw new Error("createTripDraft: ticket_types insert returned null row");
  }

  // 4. INSERT placeholder trip_pricing_tiers row
  const { error: tierError } = await supabase.from("trip_pricing_tiers").insert({
    event_id: eventRow.id,
    ticket_type_id: ticketRow.id,
    tier_name: "Standard",
    tier_metadata: {},
  });
  if (tierError) throw tierError;

  return mapTrip(
    eventRow as EventRow,
    brandSlug,
    [],
    [],
    [],
    [ticketRow as TicketTypeRow],
    0,
  );
}

// ---------------------- getTrip ----------------------

export async function getTrip(eventId: string): Promise<Trip | null> {
  // ORCH-0947: ticketsSoldCount comes from biz_trip_tickets_sold RPC and
  // mirrors the checkout-RPC capacity gate exactly. Do NOT replace with
  // orders.count, order_line_items.quantity sum, or biz_trip_sold_count_by_tier
  // -- those drift on per-ticket refunds, transfers, and voids.
  // ORCH-0859 REWORK 3 (events-type-filter audit): defensive — caller
  // knows it's a trip but pinning the filter ensures a misrouted id
  // for an event row doesn't accidentally render through trip mappers.
  const { data: eventRow, error: eventError } = await supabase
    .from("events")
    .select("*, brands(slug)")
    .eq("id", eventId)
    .eq("event_type", "trip")
    .is("deleted_at", null)
    .maybeSingle();

  if (eventError) throw eventError;
  if (eventRow === null) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const event = eventRow as any;
  const brandSlug = (event.brands?.slug as string | null) ?? null;

  const [daysResp, tiersResp, inclusionsResp, ticketsResp, datesResp, soldResp] =
    await Promise.all([
      supabase
        .from("trip_days")
        .select("*")
        .eq("event_id", eventId)
        .order("ordinal"),
      supabase.from("trip_pricing_tiers").select("*").eq("event_id", eventId),
      supabase
        .from("trip_inclusions")
        .select("*")
        .eq("event_id", eventId)
        .order("kind")
        .order("ordinal"),
      supabase
        .from("ticket_types")
        .select("*")
        .eq("event_id", eventId)
        .is("deleted_at", null),
      supabase
        .from("event_dates")
        .select("event_id,start_at,end_at,is_master")
        .eq("event_id", eventId)
        .eq("is_master", true)
        .maybeSingle(),
      // ORCH-0947: canonical tickets-sold count for the Spots KPI tile.
      supabase.rpc("biz_trip_tickets_sold", { p_event_id: eventId }),
    ]);
  if (daysResp.error) throw daysResp.error;
  if (tiersResp.error) throw tiersResp.error;
  if (inclusionsResp.error) throw inclusionsResp.error;
  if (ticketsResp.error) throw ticketsResp.error;
  if (datesResp.error) throw datesResp.error;
  if (soldResp.error) throw soldResp.error;

  return mapTrip(
    event as EventRow,
    brandSlug,
    (daysResp.data ?? []) as TripDayRow[],
    (tiersResp.data ?? []) as TripPricingTierRow[],
    (inclusionsResp.data ?? []) as TripInclusionRow[],
    (ticketsResp.data ?? []) as TicketTypeRow[],
    soldResp.data ?? 0,
    (datesResp.data as EventDateRow | null) ?? null,
  );
}

// ---------------------- getTripsByBrand ----------------------

export async function getTripsByBrand(brandId: string): Promise<Trip[]> {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("brand_id", brandId)
    .eq("event_type", "trip")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const events = (data ?? []) as EventRow[];
  if (events.length === 0) return [];

  // For list view, fetch tickets + master date only (days/inclusions/tiers shown on detail).
  // META-ORCH-1059 Pass 1: also batch-aggregate paid orders so the Hub list-card
  // can show the per-trip travelers count + revenue with parity to the events list.
  const ids = events.map((e) => e.id);
  const [ticketsResp, datesResp, ordersAgg] = await Promise.all([
    supabase
      .from("ticket_types")
      .select("*")
      .in("event_id", ids)
      .is("deleted_at", null),
    supabase
      .from("event_dates")
      .select("event_id,start_at,end_at,is_master")
      .in("event_id", ids)
      .eq("is_master", true),
    aggregatePaidOrdersByEvent(ids),
  ]);
  if (ticketsResp.error) throw ticketsResp.error;
  if (datesResp.error) throw datesResp.error;
  const tickets = (ticketsResp.data ?? []) as TicketTypeRow[];
  const dates = (datesResp.data ?? []) as EventDateRow[];
  const ticketsByEvent = new Map<string, TicketTypeRow[]>();
  for (const tt of tickets) {
    const arr = ticketsByEvent.get(tt.event_id) ?? [];
    arr.push(tt);
    ticketsByEvent.set(tt.event_id, arr);
  }
  const datesByEvent = new Map(dates.map((d) => [d.event_id, d]));

  return events.map((e) => {
    const agg = ordersAgg.get(e.id);
    return mapTrip(
      e,
      null,
      [],
      [],
      [],
      ticketsByEvent.get(e.id) ?? [],
      agg?.ticketsSold ?? 0,
      datesByEvent.get(e.id) ?? null,
      { cents: agg?.revenueCents ?? 0, currency: agg?.revenueCurrency ?? null },
    );
  });
}

/**
 * META-ORCH-1059 Pass 1 — batched paid-order aggregation for Hub list cards.
 *
 * One query over `orders` (RLS organiser-scoped) with nested
 * `order_line_items(quantity)`, filtered to the given event ids and
 * payment_status='paid'. Returns, per event id, the summed ticket quantity
 * (travelers / spots sold) and total paid revenue in minor units + currency.
 * No schema change — mirrors how the events Hub derives card metrics from
 * paid orders. Returns an empty map (never throws to the card) on read error.
 */
export interface PaidOrdersAggregate {
  ticketsSold: number;
  revenueCents: number;
  revenueCurrency: string | null;
}

export async function aggregatePaidOrdersByEvent(
  eventIds: string[],
): Promise<Map<string, PaidOrdersAggregate>> {
  const out = new Map<string, PaidOrdersAggregate>();
  if (eventIds.length === 0) return out;
  const { data, error } = await supabase
    .from("orders")
    .select("event_id, payment_status, total_cents, currency, order_line_items(quantity)")
    .in("event_id", eventIds)
    .eq("payment_status", "paid");
  if (error) {
    // List cards degrade gracefully to "no metric" rather than failing the list.
    return out;
  }
  type AggRow = {
    event_id: string;
    total_cents: number | null;
    currency: string | null;
    order_line_items: { quantity: number | null }[] | null;
  };
  for (const row of (data ?? []) as AggRow[]) {
    const prev = out.get(row.event_id) ?? {
      ticketsSold: 0,
      revenueCents: 0,
      revenueCurrency: null,
    };
    const qty = (row.order_line_items ?? []).reduce(
      (sum, li) => sum + Math.max(0, li.quantity ?? 0),
      0,
    );
    out.set(row.event_id, {
      ticketsSold: prev.ticketsSold + qty,
      revenueCents: prev.revenueCents + Math.max(0, row.total_cents ?? 0),
      revenueCurrency: prev.revenueCurrency ?? row.currency ?? null,
    });
  }
  return out;
}

// ---------------------- updateTripBasics ----------------------

export async function updateTripBasics(
  eventId: string,
  patch: TripBasicsPatch,
): Promise<Trip> {
  // Build the partial events UPDATE
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: Record<string, any> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.coverMediaUrl !== undefined) update.cover_media_url = patch.coverMediaUrl;
  if (patch.coverMediaType !== undefined) update.cover_media_type = patch.coverMediaType;
  if (patch.timezone !== undefined) update.timezone = patch.timezone;

  // theme.business_trip merge — read current, jsonb_set-style merge in JS
  if (patch.businessTrip !== undefined) {
    if ((patch.businessTrip as Record<string, unknown>).capacity !== undefined) {
      // orch-strict-grep-allow trip-capacity-defensive-throw
      throw new Error(
        "ORCH-0950: trip capacity must be routed through updateTripPricing, not updateTripBasics. " +
          "Remove `capacity` from the businessTrip patch and call updateTripPricing instead.",
      );
    }
    // ORCH-0859 REWORK 3 (events-type-filter audit): defensive — trip-only.
    const current = await supabase
      .from("events")
      .select("theme,status")
      .eq("id", eventId)
      .eq("event_type", "trip")
      .maybeSingle();
    if (current.error) throw current.error;
    const bt = patch.businessTrip as Record<string, unknown>;
    const currentStatus = current.data?.status as EventRow["status"] | undefined;
    if (
      currentStatus !== undefined &&
      currentStatus !== "draft" &&
      (bt.startAt !== undefined || bt.endAt !== undefined)
    ) {
      throw new Error(
        "ORCH-0950 expanded: trip start/end must route through updateLiveTripFields (writes event_dates), not updateTripBasics.",
      );
    }
    if (
      currentStatus !== undefined &&
      currentStatus !== "draft" &&
      bt.destinationLocationText !== undefined
    ) {
      throw new Error(
        "ORCH-0950 expanded: trip destination must route through updateLiveTripFields (writes events.destination_text), not updateTripBasics.",
      );
    }
    const currentTheme =
      (current.data?.theme as Record<string, unknown> | null) ?? {};
    const currentBusinessTrip =
      (currentTheme.business_trip as Record<string, unknown> | undefined) ?? {};
    update.theme = {
      ...currentTheme,
      business_trip: { ...currentBusinessTrip, ...patch.businessTrip },
    };
  }

  // ORCH-0859 REWORK 3: defensive UPDATE on trip rows only.
  const { error } = await supabase
    .from("events")
    // I-MUTATION-ROWCOUNT-WAIVER: ORCH-0859 — caller refreshes via getTrip() immediately after; rowcount-verify deferred to subsequent read.
    .update(update)
    .eq("id", eventId)
    .eq("event_type", "trip")
    .is("deleted_at", null);
  if (error) throw error;

  const refreshed = await getTrip(eventId);
  if (refreshed === null) {
    throw new Error("updateTripBasics: trip not found after update");
  }
  return refreshed;
}

// ---------------------- upsertTripDays (DELETE-then-INSERT) ----------------------

export async function upsertTripDays(
  eventId: string,
  days: TripDayInput[],
): Promise<TripDay[]> {
  // Delete all existing days for this event (DELETE-then-INSERT pattern).
  const deleteResp = await supabase
    .from("trip_days")
    // I-MUTATION-ROWCOUNT-WAIVER: ORCH-0859 — DELETE-then-INSERT pattern; rowcount intentionally not verified (zero rows is the valid initial-create case).
    .delete()
    .eq("event_id", eventId);
  if (deleteResp.error) throw deleteResp.error;

  if (days.length === 0) return [];

  const insertRows = days.map((d) => ({
    event_id: eventId,
    ordinal: d.ordinal,
    title: d.title,
    narrative: d.narrative ?? null,
    date: d.date ?? null,
    stops: [],
    // ORCH-1119: per-day media MUST persist on both draft (upsertTripDays, here)
    // and published-edit (biz_update_live_trip §5b) — reverting either silently
    // drops galleries (see orch1119_trip_day_media_persistence.test.ts).
    media: d.media ?? [],
  }));

  const { data, error } = await supabase
    .from("trip_days")
    .insert(insertRows)
    .select()
    .order("ordinal");
  if (error) throw error;
  return ((data ?? []) as TripDayRow[]).map(mapTripDay);
}

// ---------------------- upsertTripInclusions (DELETE-then-INSERT) ----------------------

export async function upsertTripInclusions(
  eventId: string,
  items: TripInclusionInput[],
): Promise<TripInclusion[]> {
  const deleteResp = await supabase
    .from("trip_inclusions")
    // I-MUTATION-ROWCOUNT-WAIVER: ORCH-0859 — DELETE-then-INSERT pattern; rowcount intentionally not verified (zero rows is the valid initial-create case).
    .delete()
    .eq("event_id", eventId);
  if (deleteResp.error) throw deleteResp.error;

  if (items.length === 0) return [];

  const insertRows = items.map((i) => ({
    event_id: eventId,
    kind: i.kind,
    item: i.item,
    ordinal: i.ordinal,
  }));

  const { data, error } = await supabase
    .from("trip_inclusions")
    .insert(insertRows)
    .select()
    .order("kind")
    .order("ordinal");
  if (error) throw error;
  return ((data ?? []) as TripInclusionRow[]).map(mapTripInclusion);
}

// ---------------------- updateTripPricing ----------------------

export async function updateTripPricing(
  eventId: string,
  patch: TripPricingPatch,
): Promise<TripPricingTier> {
  // ORCH-0859 REWORK 2: ALWAYS derive currency from the event row.
  // The tg_enforce_event_ticket_currency trigger rejects any mismatch.
  // The patch.currency field is accepted on the type for source
  // compatibility but IGNORED here.
  // ORCH-0859 REWORK 3 (events-type-filter audit): defensive — currency
  // probe scoped to trip rows.
  const eventCurrencyResp = await supabase
    .from("events")
    .select("currency")
    .eq("id", eventId)
    .eq("event_type", "trip")
    .maybeSingle();
  if (eventCurrencyResp.error) throw eventCurrencyResp.error;
  if (eventCurrencyResp.data === null) {
    throw new Error("updateTripPricing: event not found for id=" + eventId);
  }
  const eventCurrency = (eventCurrencyResp.data.currency as string | null) ?? "USD";

  // META-ORCH-1174 Leg B1 — lift the single-tier `.maybeSingle()` choke. A trip
  // may now carry N pricing tiers (packages). Target the tier addressed by
  // `patch.ticketTypeId` when provided; otherwise fall back to the trip's sole
  // tier (deterministically the earliest-created row if, defensively, >1 exists
  // — NEVER throw on >1 as the old `.maybeSingle()` did, which was the hard
  // single-package barrier). The per-tier validation below is unchanged.
  let tierQuery = supabase
    .from("trip_pricing_tiers")
    .select("*")
    .eq("event_id", eventId);
  if (patch.ticketTypeId !== undefined) {
    tierQuery = tierQuery.eq("ticket_type_id", patch.ticketTypeId);
  }
  const { data: tierRows, error: tierError } = await tierQuery
    .order("created_at", { ascending: true })
    .limit(1);
  if (tierError) throw tierError;
  const tierRow = (tierRows ?? [])[0] ?? null;
  if (tierRow === null) {
    throw new Error(
      "updateTripPricing: no pricing tier found for event_id=" + eventId +
        (patch.ticketTypeId !== undefined
          ? " ticketTypeId=" + patch.ticketTypeId
          : ""),
    );
  }

  // Update ticket_types row — currency comes from event, NEVER from caller.
  const { data: ticketRow, error: ticketError } = await supabase
    .from("ticket_types")
    .update({
      price_cents: patch.priceCents,
      currency: eventCurrency,
      quantity_total: patch.capacity,
      is_unlimited: false,
      is_free: patch.priceCents === 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tierRow.ticket_type_id)
    .select()
    .single();
  if (ticketError) throw ticketError;
  if (ticketRow === null) {
    throw new Error("updateTripPricing: ticket_types update returned null");
  }

  // ORCH-0873 [Tr3 Stage 2 UI]: merge installmentSchedule into
  // tier_metadata.installments JSONB key. Null → REMOVE the key
  // (single-payment trip); object → SET the key. Other tier_metadata
  // keys (any future extensions) are preserved.
  const existingMetadata =
    (tierRow.tier_metadata ?? {}) as Record<string, unknown>;
  let nextMetadata: Record<string, unknown> = existingMetadata;
  if ("installmentSchedule" in patch) {
    const { installments: _stripExistingKey, ...metadataWithoutInstallments } =
      existingMetadata as Record<string, unknown> & { installments?: unknown };
    if (patch.installmentSchedule === null || patch.installmentSchedule === undefined) {
      nextMetadata = metadataWithoutInstallments;
    } else {
      nextMetadata = {
        ...metadataWithoutInstallments,
        installments: patch.installmentSchedule,
      };
    }
  }

  // META-ORCH-1174 Leg B2 — merge per-package description (present-key
  // semantics, mirroring installments). null/blank → strip the key.
  if ("description" in patch) {
    const { description: _stripExistingDesc, ...metadataWithoutDescription } =
      nextMetadata as Record<string, unknown> & { description?: unknown };
    const desc =
      typeof patch.description === "string" ? patch.description.trim() : "";
    nextMetadata =
      desc.length > 0
        ? { ...metadataWithoutDescription, description: desc }
        : metadataWithoutDescription;
  }

  // Update tier name + metadata
  const { data: tierUpdated, error: tierUpdateError } = await supabase
    .from("trip_pricing_tiers")
    .update({ tier_name: patch.tierName, tier_metadata: nextMetadata })
    .eq("id", tierRow.id)
    .select()
    .single();
  if (tierUpdateError) throw tierUpdateError;
  if (tierUpdated === null) {
    throw new Error("updateTripPricing: tier update returned null");
  }

  return mapTripPricingTier(
    tierUpdated as TripPricingTierRow,
    ticketRow as TicketTypeRow,
  );
}

// ---------------------- META-ORCH-1174 Leg B1: N-tier data layer ----------------------
//
// The DB schema, checkout engine, per-tier remaining RPC, and public read RPC
// ALREADY support N pricing tiers per trip (only the service `.maybeSingle()`
// + the wizard UI enforced one). These functions let the data layer create,
// list, and soft-remove additional packages WITHOUT building the wizard (B2).
//
// Soft-remove = set ticket_types.deleted_at. The public read RPC
// (pg_public_trip_by_slug) and the remaining RPC (pg_public_ticket_types_remaining)
// already filter `tt.deleted_at IS NULL`, so a soft-removed package vanishes from
// every buyer surface while historical orders/tickets (FK → ticket_types.id) stay
// coherent. Callers MUST gate removal on zero sales (mirrors the published-edit
// `tier_delete_with_sales` refund-gate; enforced here for draft tiers too).

/**
 * List ALL non-deleted pricing tiers for a trip, joined to their ticket_types
 * (price / capacity / currency / installment template). Replaces any
 * `pricingTiers[0]` single-tier assumption in callers that need the full set.
 */
export async function listTripPricingTiers(
  eventId: string,
): Promise<TripPricingTier[]> {
  const { data: tierRows, error: tierError } = await supabase
    .from("trip_pricing_tiers")
    .select("*")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });
  if (tierError) throw tierError;
  const rows = (tierRows ?? []) as TripPricingTierRow[];
  if (rows.length === 0) return [];

  const ticketTypeIds = rows.map((r) => r.ticket_type_id);
  const { data: ttRows, error: ttError } = await supabase
    .from("ticket_types")
    .select("id, event_id, price_cents, currency, quantity_total, is_unlimited")
    .in("id", ticketTypeIds)
    .is("deleted_at", null);
  if (ttError) throw ttError;
  const ttById = new Map(
    ((ttRows ?? []) as TicketTypeRow[]).map((tt) => [tt.id, tt]),
  );

  // Drop tiers whose ticket_type was soft-deleted (vanished package).
  return rows
    .filter((r) => ttById.has(r.ticket_type_id))
    .map((r) => mapTripPricingTier(r, ttById.get(r.ticket_type_id)));
}

/**
 * Create an ADDITIONAL pricing tier (package) on a trip: inserts a ticket_types
 * row (currency derived from the event, NEVER caller-supplied — the
 * tg_enforce_event_ticket_currency trigger rejects mismatch) + the joined
 * trip_pricing_tiers row. Returns the new tier. Mirrors the createTripDraft
 * placeholder insert but is additive (the trip keeps its existing tiers).
 */
export async function createTripPricingTier(
  eventId: string,
  patch: Omit<TripPricingPatch, "ticketTypeId">,
): Promise<TripPricingTier> {
  const eventResp = await supabase
    .from("events")
    .select("currency")
    .eq("id", eventId)
    .eq("event_type", "trip")
    .maybeSingle();
  if (eventResp.error) throw eventResp.error;
  if (eventResp.data === null) {
    throw new Error("createTripPricingTier: event not found for id=" + eventId);
  }
  const eventCurrency = (eventResp.data.currency as string | null) ?? "USD";

  // Place the new package after the existing ones.
  const { data: existing, error: existingErr } = await supabase
    .from("trip_pricing_tiers")
    .select("ticket_type_id")
    .eq("event_id", eventId);
  if (existingErr) throw existingErr;
  const displayOrder = (existing ?? []).length;

  const { data: ticketRow, error: ticketError } = await supabase
    .from("ticket_types")
    .insert({
      event_id: eventId,
      name: patch.tierName,
      price_cents: patch.priceCents,
      currency: eventCurrency,
      quantity_total: patch.capacity,
      is_unlimited: false,
      is_free: patch.priceCents === 0,
      min_purchase_qty: 1,
      available_online: true,
      available_in_person: false,
      display_order: displayOrder,
    })
    .select()
    .single();
  if (ticketError) throw ticketError;
  if (ticketRow === null) {
    throw new Error("createTripPricingTier: ticket_types insert returned null");
  }

  // Build tier_metadata from the optional per-package plan + description.
  const tierMetadata: Record<string, unknown> = {};
  if (
    patch.installmentSchedule !== null &&
    patch.installmentSchedule !== undefined
  ) {
    tierMetadata.installments = patch.installmentSchedule;
  }
  // META-ORCH-1174 Leg B2 — persist the optional per-package description.
  if (typeof patch.description === "string" && patch.description.trim().length > 0) {
    tierMetadata.description = patch.description.trim();
  }

  const { data: tierRow, error: tierError } = await supabase
    .from("trip_pricing_tiers")
    .insert({
      event_id: eventId,
      ticket_type_id: (ticketRow as TicketTypeRow).id,
      tier_name: patch.tierName,
      tier_metadata: tierMetadata,
    })
    .select()
    .single();
  if (tierError) throw tierError;
  if (tierRow === null) {
    throw new Error("createTripPricingTier: tier insert returned null");
  }

  return mapTripPricingTier(
    tierRow as TripPricingTierRow,
    ticketRow as TicketTypeRow,
  );
}

/**
 * Soft-remove a pricing tier (package) by its ticketTypeId. Refuses to remove a
 * package that has sold tickets (mirrors the published-edit `tier_delete_with_sales`
 * refund-gate — applies to draft tiers too so historical inventory is never
 * orphaned). Sets ticket_types.deleted_at; the read + remaining RPCs filter it
 * out, so the package disappears from every buyer surface.
 */
export async function removeTripPricingTier(
  eventId: string,
  ticketTypeId: string,
): Promise<void> {
  const soldByTier = await readTripSoldCountsByTier(eventId);
  if ((soldByTier.get(ticketTypeId) ?? 0) > 0) {
    throw new Error("tier_delete_with_sales");
  }

  // I-PROPOSED-I (MUTATION-ROWCOUNT-VERIFIED): chain .select() so a 0-row write
  // surfaces as an error rather than a silent no-op.
  const { data, error } = await supabase
    .from("ticket_types")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", ticketTypeId)
    .eq("event_id", eventId)
    .is("deleted_at", null)
    .select("id");
  if (error) throw error;
  if (data === null || data.length === 0) {
    throw new Error("removeTripPricingTier: no rows updated (already removed?)");
  }
}

export async function readTripSoldCountsByTier(
  eventId: string,
): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc("biz_trip_tickets_sold_by_tier", {
    p_event_id: eventId,
  });
  if (error) throw error;

  const map = new Map<string, number>();
  for (const [ticketTypeId, value] of Object.entries(
    (data ?? {}) as Record<string, unknown>,
  )) {
    const count = Number(value);
    map.set(ticketTypeId, Number.isFinite(count) ? count : 0);
  }
  return map;
}

// ---------------------- publishTrip ----------------------

export async function publishTrip(
  eventId: string,
  draftPayload: Record<string, unknown>,
): Promise<Trip> {
  const { data, error } = await supabase.rpc("business_publish_trip_draft", {
    p_event_id: eventId,
    p_draft_payload: draftPayload,
    p_client_revision: null,
  });

  if (error) {
    // RPC raised — surface code so wizard can show inline error pointing to failing step
    throw new TripPublishValidationError(error.code ?? "publish_failed", error.message);
  }
  if (data === null) {
    throw new Error("publishTrip: RPC returned null");
  }

  // Re-fetch full trip after publish (RPC returns composite payload but
  // getTrip gives us the canonical mapper-shaped view).
  const refreshed = await getTrip(eventId);
  if (refreshed === null) {
    throw new Error("publishTrip: trip not found after publish");
  }
  return refreshed;
}

// ---------------------- softDeleteTrip ----------------------

export interface SoftDeleteResult {
  rejected: boolean;
  reason?: "has_confirmed_orders";
}

// ============================================================
// ORCH-0876 — updateLiveTripFields + LiveTripPatch + TripCoverPatch
// ============================================================
//
// Server-side atomic patch writer for published trips. Calls the
// `biz_update_live_trip(p_event_id, p_patch, p_reason)` RPC which validates
// auth + reason length + event_type + status + permission, runs an 8-path
// refund-gate, applies the patch across `events` + `trip_days` +
// `trip_inclusions` + `trip_pricing_tiers` + `ticket_types` in a single
// transaction, and inserts a `trip_edit_log` row.
//
// F-17 architecture LEAPFROG: events use a client-side Zustand store for
// most published-edit writes (`useLiveEventStore.updateLiveEventFields`).
// Trips skip that tech debt entirely — every write here goes to the DB.
//
// Audit-test invariant: `updateLiveTripFields` MUST route through the
// `biz_update_live_trip` RPC (event_type='trip' enforced server-side).

export interface TripCoverPatch {
  cover_media_url: string | null;
  cover_media_type: "image" | "video" | "gif" | null;
  cover_media_provider: string | null;
  cover_media_source_url: string | null;
  cover_media_credit: string | null;
  cover_media_credit_url: string | null;
  cover_media_alt: string | null;
}

export interface TripPricingTierInput {
  ticket_type_id: string;
  tier_name?: string;
  tier_metadata?: Record<string, unknown>;
  price_cents?: number;
}

/**
 * Patch shape consumed by `biz_update_live_trip` RPC. Every key is
 * optional — only present keys are applied. JSONB keys use snake_case to
 * match SQL conventions; TS callers serialize via `JSON.stringify(patch)`
 * implicitly via supabase.rpc.
 */
export interface LiveTripPatch {
  title?: string;
  description?: string | null;
  theme?: {
    business_trip?: Partial<TripBusinessTrip>;
  };
  days?: TripDayInput[];
  inclusions?: TripInclusionInput[];
  pricing_tiers?: TripPricingTierInput[];
  cover_media_url?: string | null;
  cover_media_type?: "image" | "video" | "gif" | null;
  cover_media_provider?: string | null;
  cover_media_source_url?: string | null;
  cover_media_credit?: string | null;
  cover_media_credit_url?: string | null;
  cover_media_alt?: string | null;
  // ORCH-1120 — published-trip Settings tab: refund policy / booking deadline /
  // bookings-closed, sales-gated by the biz_update_live_trip RPC. Only present
  // keys are evaluated; omit unchanged keys so the RPC's favorable/unfavorable
  // classifier sees only what changed. `null` for refund_policy/booking_deadline
  // serializes to JSON null (RPC detects via jsonb_typeof = 'null').
  refund_policy?: import("./refundPolicyService").RefundPolicy | null;
  booking_deadline?: string | null; // ISO timestamptz, or null to clear
  bookings_closed?: boolean;
}

export type UpdateLiveTripRejectReason =
  | "missing_edit_reason"
  | "invalid_edit_reason"
  | "trip_not_found"
  | "trip_not_editable_status"
  | "capacity_below_sold"
  | "tier_delete_with_sales"
  | "tier_price_change_with_sales"
  | "dates_shifted_with_sales"
  | "days_dropped_with_sales"
  | "inclusions_removed_with_sales"
  // ORCH-1075 — paid-edit integrity guards.
  | "stripe_charges_disabled"
  | "offering_date_past"
  // ORCH-1120 — published-trip Settings buyer-protection gate. Buyer-unfavorable
  // refund/deadline/bookings-closed edits hard-block when paid orders exist.
  | "refund_policy_downgrade_with_sales"
  // RESERVED: the realized-% classifier surfaces tier removal AS a downgrade,
  // so the RPC emits refund_policy_downgrade_with_sales for it (Q-1 default).
  // Kept in the union + buildRejectDialog for an exhaustive type + the design
  // table; the RPC does not emit it unless Q-1 flips to a literal-tier branch.
  | "refund_tier_removed_with_sales"
  | "booking_deadline_earlier_with_sales"
  | "bookings_closed_harms_active";

export type UpdateLiveTripResult =
  | {
      ok: true;
      editLogEntryId: string;
      severity: "additive" | "material";
      changedKeys: string[];
      affectedOrderCount: number;
    }
  | {
      ok: false;
      reason: UpdateLiveTripRejectReason;
      affectedOrderCount?: number;
      droppedDates?: string[];
      droppedInclusions?: string[];
    };

export class UpdateLiveTripPermissionError extends Error {
  constructor(public code: "event_not_a_trip" | "insufficient_event_permission" | "authentication_required") {
    super(code);
    this.name = "UpdateLiveTripPermissionError";
  }
}

/**
 * Calls the server-side `biz_update_live_trip` RPC. Server enforces
 * event_type='trip'; client receives:
 *   - {ok: true, editLogEntryId, severity, changedKeys, affectedOrderCount}
 *     on successful patch
 *   - {ok: false, reason, affectedOrderCount?, droppedDates?, droppedInclusions?}
 *     on validation reject (8 refund-gate reasons + missing/invalid reason +
 *     trip_not_found + trip_not_editable_status)
 *
 * Throws UpdateLiveTripPermissionError for auth/type/permission failures
 * (which the RPC raises as SQL exceptions, not result rows).
 */
export async function updateLiveTripFields(
  eventId: string,
  patch: LiveTripPatch,
  reason: string,
): Promise<UpdateLiveTripResult> {
  // ORCH-0876: route through biz_update_live_trip RPC (audit-test enforced).
  const { data, error } = await supabase.rpc("biz_update_live_trip", {
    p_event_id: eventId,
    p_patch: patch as Record<string, unknown>,
    p_reason: reason,
  });

  if (error !== null) {
    // Server-side exceptions (auth/type/permission) come back as SQL errors.
    // RPC body raises:
    //   - 'authentication_required'
    //   - 'event_not_a_trip'
    //   - 'insufficient_event_permission'
    const code = error.message;
    if (
      code === "event_not_a_trip" ||
      code === "insufficient_event_permission" ||
      code === "authentication_required"
    ) {
      throw new UpdateLiveTripPermissionError(code);
    }
    throw error;
  }

  if (data === null || typeof data !== "object") {
    throw new Error("updateLiveTripFields: RPC returned null/non-object");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = data as Record<string, any>;
  if (raw.ok === true) {
    return {
      ok: true,
      editLogEntryId: String(raw.edit_log_entry_id),
      severity: raw.severity as "additive" | "material",
      changedKeys: Array.isArray(raw.changed_keys)
        ? (raw.changed_keys as string[])
        : [],
      affectedOrderCount:
        typeof raw.affected_order_count === "number"
          ? raw.affected_order_count
          : 0,
    };
  }
  return {
    ok: false,
    reason: raw.reason as UpdateLiveTripRejectReason,
    affectedOrderCount:
      typeof raw.affected_order_count === "number"
        ? raw.affected_order_count
        : undefined,
    droppedDates: Array.isArray(raw.dropped_dates)
      ? (raw.dropped_dates as string[])
      : undefined,
    droppedInclusions: Array.isArray(raw.dropped_inclusions)
      ? (raw.dropped_inclusions as string[])
      : undefined,
  };
}

// ---------------------- softDeleteTrip ----------------------

export async function softDeleteTrip(eventId: string): Promise<SoftDeleteResult> {
  // Reject if confirmed orders exist (mirror softDeleteBrand pattern)
  const { count, error: countError } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .not("payment_status", "in", "(failed,cancelled)");
  if (countError) throw countError;
  if (count !== null && count > 0) {
    return { rejected: true, reason: "has_confirmed_orders" };
  }

  // Soft-delete trip; idempotent via .is("deleted_at", null) defensive filter.
  const { error } = await supabase
    .from("events")
    // I-MUTATION-ROWCOUNT-WAIVER: ORCH-0859 — soft-delete trip; mirrors ORCH-0734 softDeleteBrand pattern; result type doesn't expose rowcount.
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", eventId)
    .eq("event_type", "trip")
    .is("deleted_at", null);
  if (error) throw error;
  return { rejected: false };
}
