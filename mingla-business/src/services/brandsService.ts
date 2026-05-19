/**
 * brandsService — Supabase brand CRUD service layer (Cycle 17e-A).
 *
 * Wires create + read + update + soft-delete against `public.brands` with the
 * new 6 columns (kind/address/cover_hue/cover_media_url/cover_media_type/
 * profile_photo_type) added by migration 20260506000000.
 *
 * Per SPEC §3.2 verbatim. Closes forensics F-A (root cause: phone-only CRUD)
 * + F-B (root cause: unused mapper exports). Mappers in brandMapping.ts now
 * have their first consumer.
 *
 * Error contract per Const #3 + `feedback_supabase_neq_null`:
 *   - All reads filter `.is("deleted_at", null)` (NEVER `.neq()`)
 *   - All services throw on Postgrest error
 *   - createBrand throws SlugCollisionError on 23505 unique_violation
 *   - softDeleteBrand returns SoftDeleteRejection (not throw) on workflow rejection
 *
 * Mutation pattern per Decision 10 (DEC-109):
 *   - createBrand + updateBrand: hook layer applies optimistic
 *   - softDeleteBrand: hook layer is pessimistic (avoid show-then-restore on rejection)
 */

import { supabase } from "./supabase";
import {
  mapBrandRowToUi,
  mapUiToBrandInsert,
  mapUiToBrandUpdatePatch,
  joinBrandDescription,
  type BrandRow,
} from "./brandMapping";
import type {
  Brand,
  BrandRole,
  BrandHourEntry,
  VenueCategory,
} from "../types/brand";
// ORCH-0808 — organizer-funnel instrumentation.
import { logAppsFlyerEvent } from "./appsFlyerService";
import { brandHoursToRpcPayload } from "../utils/venueBrandHours";

interface EventBrandIdRow {
  brand_id: string | null;
}

// ORCH-0810 — brand KPI aggregation (attendees + GMV).
// Const #9 fix: tiles previously rendered hardcoded zeros under an "all time"
// label. Real aggregation reads orders joined to events.brand_id, excluding
// failed / cancelled / fully-refunded payments. GMV is summed in the brand's
// defaultCurrency only; mixed-currency orders for the same brand are ignored
// in the headline tile (the brand chose one default currency at create time).
interface OrderStatsRow {
  total_cents: number | null;
  currency: string | null;
  payment_status: string | null;
  refunded_amount_cents: number | null;
  // ORCH-0816 — used to bucket orders into the last-7-day window for the
  // home-screen "Last 7 days" tile. Lifetime totals remain on `rev`.
  created_at: string | null;
  events: { brand_id: string | null } | null;
  order_line_items: { quantity: number | null }[] | null;
}

interface BrandStatsAggregate {
  attendees: number;
  revByCurrencyCents: Map<string, number>;
  // ORCH-0816 — last-7-day rolling window, computed in the same pass as the
  // lifetime total so the home tile and the brand-profile tile share one query.
  rev7dByCurrencyCents: Map<string, number>;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Thrown by `createBrand` when slug collides with an existing non-deleted brand
 * (Postgrest 23505 unique_violation on `idx_brands_slug_active`).
 *
 * Hook layer maps this to inline form error per Decision 11 (DEC-109).
 */
export class SlugCollisionError extends Error {
  constructor(public attemptedSlug: string) {
    super(`Brand slug "${attemptedSlug}" is already taken by an active brand.`);
    this.name = "SlugCollisionError";
  }
}

// ----- Inputs / Results --------------------------------------------------

export interface CreateBrandInput {
  accountId: string;
  name: string;
  slug: string;
  // ORCH-0855 (Tr1) — union widened to admit 'trip_planner'. Migration
  // 20260607000000 widened brands_kind_check at the DB level. Hook layer
  // useCreateBrand passes input.kind through verbatim; no hook change.
  kind: "physical" | "popup" | "trip_planner";
  address: string | null;
  coverHue: number;
  // Optional initial fields:
  bio?: string;
  tagline?: string;
  contact?: { email?: string; phone?: string };
  links?: Brand["links"];
}

export interface SoftDeleteRejection {
  rejected: true;
  reason: "upcoming_events";
  upcomingEventCount: number;
}
export interface SoftDeleteSuccess {
  rejected: false;
  brandId: string;
}
export type SoftDeleteResult = SoftDeleteSuccess | SoftDeleteRejection;
export const BRAND_DELETE_BLOCKING_EVENT_STATUSES = ["scheduled", "live"] as const;

// ----- createBrand -------------------------------------------------------

export async function createBrand(
  input: CreateBrandInput,
  role: BrandRole,
): Promise<Brand> {
  const insertPayload = mapUiToBrandInsert({
    accountId: input.accountId,
    brand: {
      displayName: input.name,
      slug: input.slug,
      kind: input.kind,
      address: input.address,
      coverHue: input.coverHue,
      bio: input.bio,
      tagline: input.tagline,
      contact: input.contact,
      links: input.links,
    },
  });

  const { data, error } = await supabase
    .from("brands")
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new SlugCollisionError(input.slug);
    }
    throw error;
  }
  if (data === null) {
    throw new Error("createBrand: insert returned null row");
  }

  // ORCH-0808 — organizer-funnel event. Fires once per brand insert (not per
  // user) — every brand a creator publishes is a separate funnel step.
  // Fire-and-forget; AppsFlyer service is no-op when env is missing.
  logAppsFlyerEvent("mingla_brand_created", { brand_id: data.id as string });

  return mapBrandRowToUi(data as BrandRow, { role });
}

// ----- Ve1 physical venue (pending review) --------------------------------

export interface CreateVenueBrandPendingInput {
  name: string;
  slug: string;
  tagline?: string;
  bio?: string;
  placePoolId?: string | null;
  googlePlaceId: string;
  lat: number;
  lng: number;
  city: string | null;
  countryCode: string | null;
  address: string;
  venueCategory: VenueCategory;
  contact: { email?: string; phone?: string };
  coverMediaUrl: string | null;
  coverMediaType: "image" | "video" | "gif" | null;
  hours: BrandHourEntry[];
}

interface BrandHourRow {
  weekday: number;
  open_time: string | null;
  close_time: string | null;
  is_closed: boolean;
}

function formatTimeForUi(t: string | null): string | null {
  if (t === null || t.length === 0) return null;
  const parts = t.split(":");
  if (parts.length >= 2) return `${parts[0]}:${parts[1]}`;
  return t;
}

export async function getBrandHours(brandId: string): Promise<BrandHourEntry[]> {
  const { data, error } = await supabase
    .from("brand_hours")
    .select("weekday,open_time,close_time,is_closed")
    .eq("brand_id", brandId)
    .order("weekday", { ascending: true });

  if (error !== null) throw error;
  return ((data ?? []) as BrandHourRow[]).map((r) => ({
    weekday: r.weekday,
    openTime: r.is_closed ? null : formatTimeForUi(r.open_time),
    closeTime: r.is_closed ? null : formatTimeForUi(r.close_time),
    isClosed: r.is_closed,
  }));
}

/**
 * Replaces all `brand_hours` rows for a brand (expects exactly 7 weekdays).
 * Callers must hold brand admin-plus; mirrors the RPC insert shape.
 */
export async function upsertBrandHours(
  brandId: string,
  hours: BrandHourEntry[],
): Promise<void> {
  if (hours.length !== 7) {
    throw new Error("upsertBrandHours: expected 7 weekday rows");
  }
  const { error } = await supabase.rpc("biz_upsert_brand_hours", {
    p_brand_id: brandId,
    p_hours: brandHoursToRpcPayload(hours),
  });
  if (error !== null) throw error;
}

async function invokeVenueClaimSubmittedEmail(brandId: string): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke(
      "venue-claim-submitted-email",
      { body: { brand_id: brandId } },
    );
    if (error !== null) {
      console.warn("[invokeVenueClaimSubmittedEmail]", error.message);
    }
  } catch (e) {
    console.warn("[invokeVenueClaimSubmittedEmail]", e);
  }
}

/**
 * Ve1 — atomic create via `biz_create_venue_brand_pending_review` + confirmation email.
 */
export async function createVenueBrandPendingReview(
  input: CreateVenueBrandPendingInput,
  role: BrandRole,
): Promise<Brand> {
  const description = joinBrandDescription(input.tagline, input.bio);
  const { data, error } = await supabase.rpc(
    "biz_create_venue_brand_pending_review",
    {
      p_name: input.name,
      p_slug: input.slug,
      p_description: description,
      p_google_place_id: input.googlePlaceId,
      p_lat: input.lat,
      p_lng: input.lng,
      p_city: input.city ?? "",
      p_country_code: input.countryCode ?? "",
      p_address: input.address,
      p_venue_category: input.venueCategory,
      p_contact_email: input.contact.email ?? "",
      p_contact_phone: input.contact.phone ?? "",
      p_cover_media_url: input.coverMediaUrl ?? "",
      p_cover_media_type: input.coverMediaType ?? "",
      p_hours: brandHoursToRpcPayload(input.hours),
      p_place_pool_id: input.placePoolId ?? null,
    },
  );

  if (error !== null) {
    const msg = error.message ?? "";
    if (error.code === "23505") {
      if (msg.includes("slug") || msg.includes("idx_brands_slug")) {
        throw new SlugCollisionError(input.slug);
      }
      throw new Error(
        "This place is already in our verification queue with the same Google location. Contact support if you need help.",
      );
    }
    throw error;
  }
  if (data === null || typeof data !== "string") {
    throw new Error("createVenueBrandPendingReview: RPC returned no brand id");
  }

  const brandId = data;
  logAppsFlyerEvent("mingla_venue_brand_submitted", { brand_id: brandId });
  await invokeVenueClaimSubmittedEmail(brandId);

  const brand = await getBrand(brandId);
  if (brand === null) {
    throw new Error("createVenueBrandPendingReview: brand missing after insert");
  }
  return { ...brand, role };
}

// ----- getBrands (list) --------------------------------------------------

export async function getBrands(accountId: string): Promise<Brand[]> {
  const { data, error } = await supabase
    .from("brands")
    .select("*")
    .eq("account_id", accountId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw error;
  const rows = data as BrandRow[];
  const brandIds = rows.map((row) => row.id);
  const [eventCounts, statsAgg] = await Promise.all([
    getEventCountsByBrandIds(brandIds),
    aggregateBrandStatsByBrandIds(brandIds),
  ]);
  return rows.map((row) => {
    // Default role "owner" — useCurrentBrandRole resolves real role per brand.
    // Service layer cannot know caller's role per-brand without a join.
    const brand = mapBrandRowToUi(row, { role: "owner" });
    const agg = statsAgg.get(row.id);
    return {
      ...brand,
      stats: {
        ...brand.stats,
        events: eventCounts.get(row.id) ?? 0,
        attendees: agg?.attendees ?? 0,
        rev: pickRevForCurrency(agg, brand.defaultCurrency),
        rev7d: pickRev7dForCurrency(agg, brand.defaultCurrency),
      },
    };
  });
}

async function getEventCountsByBrandIds(
  brandIds: string[],
): Promise<Map<string, number>> {
  if (brandIds.length === 0) return new Map();

  // orch-strict-grep-allow events-type-filter — getEventCountsByBrandIds is intentionally type-agnostic ("does this brand have ANY content"); operator decision pending per ORCH-0859 REWORK 3 dispatch (whether trips should count as "events" for brand-card badges or get their own count)
  const { data, error } = await supabase
    .from("events")
    .select("brand_id")
    .in("brand_id", brandIds)
    .is("deleted_at", null);

  if (error) throw error;

  const counts = new Map<string, number>();
  for (const row of data as EventBrandIdRow[]) {
    if (row.brand_id === null) continue;
    counts.set(row.brand_id, (counts.get(row.brand_id) ?? 0) + 1);
  }
  return counts;
}

// ORCH-0810 — aggregate attendees + GMV across all orders for a set of brands.
// Excludes orders with payment_status in (failed, cancelled, refunded) so
// fully-refunded and cancelled orders do not inflate the headline tiles.
// partial_refund orders are included with refunded_amount_cents netted out.
export async function aggregateBrandStatsByBrandIds(
  brandIds: string[],
): Promise<Map<string, BrandStatsAggregate>> {
  const result = new Map<string, BrandStatsAggregate>();
  for (const id of brandIds) {
    result.set(id, {
      attendees: 0,
      revByCurrencyCents: new Map(),
      rev7dByCurrencyCents: new Map(),
    });
  }
  if (brandIds.length === 0) return result;

  // ORCH-0816 — single round-trip computes BOTH lifetime and 7-day buckets.
  // Client-side window filtering keeps the query identical to the prior shape
  // and avoids two network calls per brand list refresh.
  const sinceIso = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();

  const { data, error } = await supabase
    .from("orders")
    .select(`
      total_cents,
      currency,
      payment_status,
      refunded_amount_cents,
      created_at,
      events!inner ( brand_id ),
      order_line_items ( quantity )
    `)
    .in("events.brand_id", brandIds)
    .not("payment_status", "in", "(failed,cancelled,refunded)");

  if (error) throw error;

  for (const row of (data ?? []) as unknown as OrderStatsRow[]) {
    const brandId = row.events?.brand_id ?? null;
    if (brandId === null) continue;
    const bucket = result.get(brandId);
    if (bucket === undefined) continue;

    const qty = (row.order_line_items ?? []).reduce(
      (sum, line) => sum + (line.quantity ?? 0),
      0,
    );
    bucket.attendees += qty;

    const net = (row.total_cents ?? 0) - (row.refunded_amount_cents ?? 0);
    const currency = (row.currency ?? "").trim().toUpperCase();
    if (currency.length === 0) continue;
    bucket.revByCurrencyCents.set(
      currency,
      (bucket.revByCurrencyCents.get(currency) ?? 0) + net,
    );

    if (row.created_at !== null && row.created_at >= sinceIso) {
      bucket.rev7dByCurrencyCents.set(
        currency,
        (bucket.rev7dByCurrencyCents.get(currency) ?? 0) + net,
      );
    }
  }

  return result;
}

function pickRevForCurrency(
  agg: BrandStatsAggregate | undefined,
  defaultCurrency: string | undefined,
): number {
  if (agg === undefined) return 0;
  if (defaultCurrency === undefined || defaultCurrency.trim().length === 0) {
    return 0;
  }
  const cents = agg.revByCurrencyCents.get(defaultCurrency.trim().toUpperCase());
  if (cents === undefined || cents <= 0) return 0;
  return cents / 100;
}

// ORCH-0816 — mirror of pickRevForCurrency for the 7-day window. Same mixed-
// currency exclusion rules apply: only orders in the brand's default currency
// surface on the headline tile.
function pickRev7dForCurrency(
  agg: BrandStatsAggregate | undefined,
  defaultCurrency: string | undefined,
): number {
  if (agg === undefined) return 0;
  if (defaultCurrency === undefined || defaultCurrency.trim().length === 0) {
    return 0;
  }
  const cents = agg.rev7dByCurrencyCents.get(
    defaultCurrency.trim().toUpperCase(),
  );
  if (cents === undefined || cents <= 0) return 0;
  return cents / 100;
}

// ----- getBrand (single) -------------------------------------------------

export async function getBrand(brandId: string): Promise<Brand | null> {
  const { data, error } = await supabase
    .from("brands")
    .select("*")
    .eq("id", brandId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  if (data === null) return null;
  const brand = mapBrandRowToUi(data as BrandRow, { role: "owner" });
  const [eventCounts, statsAgg] = await Promise.all([
    getEventCountsByBrandIds([brand.id]),
    aggregateBrandStatsByBrandIds([brand.id]),
  ]);
  const agg = statsAgg.get(brand.id);
  return {
    ...brand,
    stats: {
      ...brand.stats,
      events: eventCounts.get(brand.id) ?? 0,
      attendees: agg?.attendees ?? 0,
      rev: pickRevForCurrency(agg, brand.defaultCurrency),
      rev7d: pickRev7dForCurrency(agg, brand.defaultCurrency),
    },
  };
}

// ----- updateBrand -------------------------------------------------------

export async function updateBrand(
  brandId: string,
  patch: Partial<Brand>,
  existingDescription: string | null,
): Promise<Brand> {
  const updatePayload = mapUiToBrandUpdatePatch(patch, { existingDescription });

  // Defensive: empty patch is no-op — return existing row instead of UPDATE
  // with empty SET (which Postgres rejects with syntax error)
  if (Object.keys(updatePayload).length === 0) {
    const existing = await getBrand(brandId);
    if (existing === null) {
      throw new Error("updateBrand: brand not found or soft-deleted");
    }
    return existing;
  }

  const { data, error } = await supabase
    .from("brands")
    .update(updatePayload)
    .eq("id", brandId)
    .is("deleted_at", null) // defensive — RLS already prevents update of soft-deleted
    .select()
    .single();

  if (error) throw error;
  if (data === null) {
    throw new Error(
      "updateBrand: update returned null row (possibly soft-deleted concurrently)",
    );
  }
  return mapBrandRowToUi(data as BrandRow, { role: "owner" });
}

// ----- softDeleteBrand ---------------------------------------------------

/**
 * Soft-deletes a brand via `UPDATE brands SET deleted_at = now()`.
 *
 * Three-step workflow:
 *   1. Count scheduled + live events for this brand. If > 0, return rejection
 *      (workflow rejection, NOT thrown — UI handles via reject-modal per
 *      Decision 11).
 *   2. UPDATE brands SET deleted_at = <now>. Idempotent — `.is("deleted_at", null)`
 *      makes re-deletes no-ops at the SQL layer.
 *   3. Clear `creator_accounts.default_brand_id` if matches (R-3 / F-H mitigation
 *      per I-PROPOSED-B). Failure here is non-fatal — soft-delete itself succeeded.
 *
 * Per SPEC §3.2.7. NEVER swallows error per Const #3.
 */
export async function softDeleteBrand(brandId: string): Promise<SoftDeleteResult> {
  // Step 1 — count scheduled OR live events whose end_at is in the future.
  // DB enum is draft/scheduled/live/ended/cancelled; "upcoming" is a UI bucket.
  //
  // ORCH-0862 / DISCOVERY-7 — date-aware filter. Past-dated rows that still
  // carry status='scheduled' (because nothing auto-flips them to 'ended') were
  // wrongly blocking delete on brands whose home screen showed "0 events".
  // Aligns with the ORCH-0850 [End-not-start parity systemic] canonical
  // lifecycle helper which uses effective end_at, not start_at.
  //
  // The event_dates!inner join is safe because scheduled/live events always
  // have at least one event_dates row per the publish-flow validation —
  // verified via MCP probe 2026-05-17: zero scheduled/live events are
  // orphan-without-dates (only cancelled + draft orphans exist, neither
  // blocks delete).
  const nowIso = new Date().toISOString();
  // orch-strict-grep-allow events-type-filter — brand-delete blocker count is intentionally type-agnostic (a brand with scheduled trips should also block delete); operator-pending decision per ORCH-0859 REWORK 3 dispatch on whether to split into separate event + trip blocker counts
  const { count, error: countError } = await supabase
    .from("events")
    .select("id, event_dates!inner(end_at)", { count: "exact", head: true })
    .eq("brand_id", brandId)
    .in("status", BRAND_DELETE_BLOCKING_EVENT_STATUSES)
    .is("deleted_at", null)
    .gt("event_dates.end_at", nowIso);

  if (countError) throw countError;

  if (count !== null && count > 0) {
    // Workflow rejection — NOT thrown; UI handles via modal
    return {
      rejected: true,
      reason: "upcoming_events",
      upcomingEventCount: count,
    };
  }

  // Step 2 — soft-delete via UPDATE with rowcount verification.
  // Chains .select("id") to verify exactly 1 row was updated. Without this
  // verification, supabase-js silently returns success when 0 rows match
  // (RLS denial, wrong brandId, already-soft-deleted) — the bug closed by
  // ORCH-0734 REWORK. The .select() chain is safe post-ORCH-0734-v1: the
  // "Account owner can select own brands" policy admits the post-update
  // row regardless of deleted_at state.
  // ORCH-0862 — reuses Step 1's `nowIso` (captured a few ms earlier);
  // sub-second drift is acceptable for the `deleted_at` audit timestamp.
  const { data, error: updateError } = await supabase
    .from("brands")
    .update({ deleted_at: nowIso })
    .eq("id", brandId)
    .is("deleted_at", null) // defensive idempotency
    .select("id");

  if (updateError) throw updateError;
  if (data === null || data.length === 0) {
    throw new Error(
      "softDeleteBrand: 0 rows updated — brand may not exist, may already be soft-deleted, or RLS denied. brandId=" +
        brandId,
    );
  }

  // Step 3 — clear default_brand_id pointer if matches (I-PROPOSED-B per SPEC §5.2).
  // ORCH-0734 fire-and-forget cleanup — idempotent by design. If 0 rows match
  // (user didn't have this brand as default), that's the expected NORMAL case.
  // Step 2 already verified the brand soft-delete; step 3 is non-fatal cleanup.
  const { error: clearDefaultError } = await supabase
    .from("creator_accounts")
    // I-MUTATION-ROWCOUNT-WAIVER: ORCH-0734 fire-and-forget cleanup, idempotent
    .update({ default_brand_id: null })
    .eq("default_brand_id", brandId);

  if (clearDefaultError) {
    // Soft-delete already succeeded — log + continue (non-fatal)
    // Const #3: don't swallow silently — surface to console
    console.warn(
      "[softDeleteBrand] clear default_brand_id failed:",
      clearDefaultError.message,
    );
  }

  return { rejected: false, brandId };
}

// ----- Helper re-export --------------------------------------------------

// Re-export for hook-layer convenience when computing existingDescription
// for updateBrand calls.
export { joinBrandDescription };
