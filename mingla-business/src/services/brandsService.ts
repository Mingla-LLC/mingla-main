/**
 * brandsService — Supabase brand CRUD service layer (Cycle 17e-A).
 *
 * Wires create + read + update + soft-delete against `public.brands` with the
 * new columns (address/cover_hue/cover_media_url/cover_media_type/
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

// ----- Venue slug availability (META-ORCH-1009 Sub-E B3 + B5) -------------

/**
 * Returns true when `slug` is free for a NEW venue brand.
 *
 * ROOT-CAUSE FIX (META-ORCH-1009 Sub-E, 2026-05-31): the slug is the brand's
 * public URL (business.usemingla.com/b/<slug>) and is GLOBALLY UNIQUE — the DB
 * enforces `UNIQUE(slug) WHERE deleted_at IS NULL`. The venue-create flow ALWAYS
 * INSERTs a brand-new brand (`biz_create_venue_brand_authoring` → INSERT INTO
 * brands); it never reuses/links an existing one. Therefore a slug already held
 * by ANY live brand — INCLUDING one the caller owns — is NOT available for a new
 * venue: inserting it collides with the unique index.
 *
 * A prior change added an "own-account exemption" (return true if only the
 * caller's own brands hold the slug) to silence a false-positive from a partial
 * submit. That was wrong: it turned a false-positive into a FALSE-NEGATIVE — the
 * UI auto-selected a slug the caller already used (e.g. typing the exact same
 * venue name twice), which then failed at submit with a unique-violation. The
 * `ownAccountId` parameter is retained for signature compatibility but is now
 * intentionally ignored: availability is purely "no live brand holds this slug".
 */
export async function checkVenueSlugAvailable(
  slug: string,
  _ownAccountId?: string | null,
): Promise<boolean> {
  const normalized = slug.trim().toLowerCase();
  if (normalized.length === 0) return false;

  const { data, error } = await supabase
    .from("brands")
    .select("id")
    .eq("slug", normalized)
    .is("deleted_at", null)
    .limit(1);
  if (error !== null) throw error;

  // Available iff NO live brand (anyone's) already holds this slug.
  return (data ?? []).length === 0;
}

/**
 * Suggest up to `limit` AVAILABLE slug candidates derived from a venue name.
 *
 * B3: the operator should never hand-type a slug. The first candidate is the
 * plain kebab root; fallbacks append numeric suffixes. Only candidates that
 * pass `checkVenueSlugAvailable` are returned. If the availability check fails
 * (offline), we degrade to returning the root un-checked so the flow is never
 * fully blocked.
 */
export async function suggestVenueSlugs(
  name: string,
  limit = 3,
  ownAccountId?: string | null,
): Promise<string[]> {
  const root = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 32);
  if (root.length === 0) return [];

  const candidates = [root, `${root}1`, `${root}2`, `${root}3`];
  const available: string[] = [];
  for (const candidate of candidates) {
    if (available.length >= limit) break;
    try {
      if (await checkVenueSlugAvailable(candidate, ownAccountId)) {
        available.push(candidate);
      }
    } catch {
      if (available.length === 0) available.push(candidate);
      break;
    }
  }
  return available;
}

/**
 * Resolve a slug that is GUARANTEED available, derived from a venue name.
 *
 * Unlike `suggestVenueSlugs` (which returns up to N candidates for the UI to
 * display), this is the authoritative submit-time resolver: it always returns a
 * single slug that passed `checkVenueSlugAvailable`. It walks numeric suffixes
 * up to 50, then falls back to a base-36 timestamp suffix that cannot collide in
 * practice — so it can never "run out" of options and never returns a taken slug.
 *
 * The caller passes the slug the UI currently shows as `preferred`; if that one
 * is still available we keep it (stable URLs), otherwise we advance. The DB's
 * UNIQUE(slug) constraint remains the final backstop for the submit-time race.
 *
 * Throws only if a venue name yields an empty root (caller validates name first).
 */
export async function resolveAvailableVenueSlug(
  name: string,
  preferred: string | null,
  ownAccountId?: string | null,
): Promise<string> {
  const sanitize = (s: string): string =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 32);

  const root = sanitize(name);
  if (root.length === 0) {
    throw new Error("Venue name is required to generate a web address.");
  }

  // 1) Honor the UI's preferred slug if it's still free (keeps the shown URL).
  const pref = preferred !== null ? sanitize(preferred) : "";
  if (pref.length > 0 && (await checkVenueSlugAvailable(pref, ownAccountId))) {
    return pref;
  }

  // 2) root, root1, root2, … root50 — truncate the root so suffix fits in 32.
  for (let i = 0; i <= 50; i++) {
    const suffix = i === 0 ? "" : String(i);
    const base = root.slice(0, 32 - suffix.length);
    const candidate = `${base}${suffix}`;
    if (await checkVenueSlugAvailable(candidate, ownAccountId)) {
      return candidate;
    }
  }

  // 3) Timestamp fallback — cannot realistically collide. Base-36 of epoch-ms.
  const stamp = Date.now().toString(36);
  const base = root.slice(0, 32 - stamp.length);
  const candidate = `${base}${stamp}`;
  // One last check; if even this is taken (astronomically unlikely), surface it
  // so the DB unique constraint isn't the first line of defense.
  if (await checkVenueSlugAvailable(candidate, ownAccountId)) {
    return candidate;
  }
  // Final fallback: return it anyway — the DB UNIQUE constraint is the backstop.
  return candidate;
}

// ----- Inputs / Results --------------------------------------------------

export interface CreateBrandInput {
  accountId: string;
  name: string;
  slug: string;
  address: string | null;
  coverHue: number;
  // Optional initial fields:
  bio?: string;
  tagline?: string;
  contact?: { email?: string; phone?: string };
  links?: Brand["links"];
  // ORCH-1081 — when true, brands.partner_setup is set at insert time so the
  // brand is permanently flagged as a partner-initiated setup. Flag is one-way
  // (set at create; never edited).
  partnerSetup?: boolean;
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
// ORCH-1062 — statuses the brand HUB surfaces (mirrors
// business_management_events_view's `status IN (...)` filter). The account-page
// brand-card "N events" badge counts ONLY these so it can never claim drafts the
// hub hides. Keep in lockstep with the view definition
// (supabase/migrations/...orch_0792_events_with_master_date_view.sql).
export const HUB_VISIBLE_EVENT_STATUSES = [
  "scheduled",
  "live",
  "ended",
  "cancelled",
] as const;

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
      address: input.address,
      coverHue: input.coverHue,
      bio: input.bio,
      tagline: input.tagline,
      contact: input.contact,
      links: input.links,
    },
  });
  // ORCH-1081 — partner_setup flag is column-direct (not on the Brand UI type)
  // so we set it on the raw insert payload rather than threading it through
  // mapUiToBrandInsert / Brand. Column added in migration 20260920000000.
  if (input.partnerSetup === true) {
    // The DB column default is false; only stamp when true so the insert payload
    // shape stays minimal.
    (insertPayload as Record<string, unknown>).partner_setup = true;
  }

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
  googlePlaceId?: string | null;
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
 * Ve1/Sub-E — atomic create via venue authoring RPC + confirmation email.
 */
export async function createVenueBrandPendingReview(
  input: CreateVenueBrandPendingInput,
  role: BrandRole,
): Promise<Brand> {
  const description = joinBrandDescription(input.tagline, input.bio);
  const { data, error } = await supabase.rpc(
    "biz_create_venue_brand_authoring",
    {
      p_name: input.name,
      p_slug: input.slug,
      p_description: description,
      p_google_place_id: input.googlePlaceId ?? "",
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
        "This place is already in our verification queue. Contact support if you need help.",
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
  // ORCH-1081 hotfix: source from brand_team_members instead of
  // brands.account_id so brands you're a non-owner member of (brand_admin,
  // event_manager, finance_manager, marketing_manager, scanner) still appear
  // in the switcher. The original implementation only returned brands you
  // OWN, which silently broke the partner workflow: after a partner hands
  // off ownership of a brand they set up, they become brand_admin but lose
  // switcher access — they can no longer create events under that brand,
  // even though that's exactly the partner economics model (0.15% of every
  // ticket sold on brands they admin).
  //
  // Note: brand_team_members has 1 row per (brand_id, user_id), so a
  // brand_owner appears here too via the
  // biz_brand_owner_team_member_after_insert trigger that fires on brand
  // insert. We de-dupe defensively in case any pre-trigger brand has both
  // an `owner` row and a separate `admin` row.
  type EmbeddedRow = { role: string; brand: BrandRow | null };
  const { data, error } = await supabase
    .from("brand_team_members")
    .select("role, brand:brands!inner(*)")
    .eq("user_id", accountId)
    .is("removed_at", null)
    .is("brand.deleted_at", null);

  if (error) throw error;

  const seen = new Set<string>();
  type MembershipRow = { role: string; brand: BrandRow };
  const rows: MembershipRow[] = [];
  for (const r of ((data ?? []) as EmbeddedRow[])) {
    if (!r.brand) continue;
    if (seen.has(r.brand.id)) continue;
    seen.add(r.brand.id);
    rows.push({ role: r.role, brand: r.brand });
  }

  // Newest brand first — matches the pre-hotfix ordering.
  rows.sort((a, b) => {
    const aTime = a.brand.created_at ?? "";
    const bTime = b.brand.created_at ?? "";
    return bTime.localeCompare(aTime);
  });

  const brandIds = rows.map(({ brand }) => brand.id);
  const [eventCounts, statsAgg] = await Promise.all([
    getEventCountsByBrandIds(brandIds),
    aggregateBrandStatsByBrandIds(brandIds),
  ]);
  return rows.map(({ role: rawRole, brand: row }) => {
    // Map brand_team_members.role (6-value enum) to the UI BrandRole
    // (legacy 2-value "owner" | "admin"). brand_owner → owner; all others
    // → admin. useCurrentBrandRole resolves the precise role per brand for
    // any UI that needs the finer-grained distinction.
    const uiRole = rawRole === "brand_owner" ? "owner" : "admin";
    const brand = mapBrandRowToUi(row, { role: uiRole });
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

  // ORCH-1062 — the account-page brand badge "lied": it counted ALL non-deleted
  // events including DRAFTS, so a brand whose hub shows zero events still rendered
  // "N events" (e.g. brand "rrrr" showed "2 events" while its hub was empty —
  // both events were drafts). The hub events list
  // (businessEvents.ts → business_management_events_view) only surfaces
  // status IN ('scheduled','live','ended','cancelled') — drafts are excluded.
  // Mirror that EXACT status filter here so the badge can't claim content the hub
  // hides (verified live 2026-06-02). Stays type-agnostic (no event_type filter —
  // trips/experiences still counted; the ORCH-0859 events-vs-trips badge question
  // is unchanged, only the draft inflation is removed).
  // orch-strict-grep-allow events-type-filter — intentionally type-agnostic "any published hub content" count; no event_type filter by design (ORCH-1062 removes only draft inflation)
  const { data, error } = await supabase
    .from("events")
    .select("brand_id")
    .in("brand_id", brandIds)
    .in("status", HUB_VISIBLE_EVENT_STATUSES)
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
