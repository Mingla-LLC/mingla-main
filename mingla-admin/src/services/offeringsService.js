/**
 * ORCH-1273 [Admin Offerings console — READ-ONLY] — offerings read service.
 *
 * The SINGLE data authority for the Offerings console. READ-ONLY by contract: it
 * exposes zero .update / .insert / .delete / .upsert / admin_write_audit and calls
 * ZERO admin write RPC — every mutation is deferred to Wave-2 via the ORCH-1271
 * audited-write primitive (SPEC §6). Enforced by I-PROPOSED-1273-OFFERINGS-READ-ONLY
 * + the i-offerings-read-only strict-grep gate (AC-4.4).
 *
 * Read paths (per ORCH-1271 §3 read-authz rule):
 *   - Cross-brand aggregation + derived lifecycle bucket + PII/money bundles →
 *     guard-first STABLE SECURITY DEFINER read-RPCs (admin_list_offerings,
 *     admin_get_offering, admin_list_event_orders, admin_list_event_rsvps,
 *     admin_offering_stats).
 *   - Whole-row type-specific display children (ticket_types, event_dates,
 *     trip_*, experience_stops) → direct supabase.from(...) under the new
 *     is_admin_user() SELECT RLS policies.
 *
 * Contract per the EntityListView shell:
 *   - listOfferings returns { rows, total } and THROWS on error (EntityListView
 *     catches and renders the error+retry state).
 *   - getOffering returns the raw jsonb bundle (or null when not found); THROWS on
 *     a non-not-found error.
 */

import { supabase } from "../lib/supabase";

// ── Unified offerings list (RPC) ──────────────────────────────────────────────

// EntityListView column key → admin_list_offerings p_sort whitelist.
const SORT_MAP = {
  master_start_at: "start_at",
  starts: "start_at",
  created_at: "created_at",
  title: "title",
  status: "status",
};

/**
 * Cross-brand unified offerings list for the Offerings console. Server search /
 * sort / filter / pagination via the guard-first admin_list_offerings RPC.
 * Returns { rows, total }; throws on error.
 */
export async function listOfferings({ search, sortKey, sortDir, filters = {}, page = 0, pageSize = 25 }) {
  const { data, error } = await supabase.rpc("admin_list_offerings", {
    p_search: search && search.trim() ? search.trim() : null,
    p_event_type: filters.event_type || null,
    p_status: filters.status || null,
    p_visibility: filters.visibility || null,
    p_lifecycle: filters.lifecycle || null,
    p_brand_id: filters.brand_id || null,
    p_include_deleted: filters.deleted === "include",
    p_sort: SORT_MAP[sortKey] || "start_at",
    p_sort_dir: sortDir === "asc" ? "asc" : "desc",
    p_limit: pageSize,
    p_offset: page * pageSize,
  });
  if (error) throw new Error(error.message || "Failed to load offerings.");
  return { rows: Array.isArray(data?.rows) ? data.rows : [], total: Number(data?.total) || 0 };
}

/** Header stat tiles (counts by type + lifecycle). Returns the raw { data, error }. */
export async function getOfferingStats() {
  return supabase.rpc("admin_offering_stats");
}

/**
 * Distinct brands for the Offerings list Brand filter (reuses the existing
 * "brands admin can read" RLS). id + name only — NEVER selects the brand kind
 * column (META-ORCH-0972). Best-effort: returns [] on error (the filter degrades
 * to a name-search fallback, never a crash).
 */
export async function listOfferingBrands() {
  const { data, error } = await supabase
    .from("brands")
    .select("id,name")
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (error) {
    console.warn("[offeringsService] listOfferingBrands degraded:", error?.message || error);
    return [];
  }
  return data || [];
}

// ── Offering detail bundle (RPC) ──────────────────────────────────────────────

/**
 * Type-aware header bundle for the offering detail view (derived lifecycle bucket
 * + brand join + child counts + type-specific header fields), via the guard-first
 * admin_get_offering RPC. Returns the jsonb bundle, or null when not found; throws
 * on a real error.
 */
export async function getOffering(eventId) {
  const { data, error } = await supabase.rpc("admin_get_offering", { p_event_id: eventId });
  if (error) throw new Error(error.message || "Failed to load this offering.");
  return data || null; // null = not found
}

// ── Type-specific children (RLS-direct) ───────────────────────────────────────

/** Standard-event / trip ticket tiers (RLS-direct). Incl. soft-deleted (greyed in UI). */
export async function getTicketTypes(eventId) {
  const { data, error } = await supabase
    .from("ticket_types")
    .select("*")
    .eq("event_id", eventId)
    .order("display_order", { ascending: true });
  if (error) throw new Error(error.message || "Failed to load ticket tiers.");
  return data || [];
}

/** Event schedule rows (master flagged). RLS-direct. */
export async function getEventDates(eventId) {
  const { data, error } = await supabase
    .from("event_dates")
    .select("*")
    .eq("event_id", eventId)
    .order("start_at", { ascending: true });
  if (error) throw new Error(error.message || "Failed to load schedule.");
  return data || [];
}

/** Buyer orders + money + line items (PII → definer RPC). Returns { rows, total, summary }. */
export async function listEventOrders(eventId, { page = 0, pageSize = 25 } = {}) {
  const { data, error } = await supabase.rpc("admin_list_event_orders", {
    p_event_id: eventId,
    p_limit: pageSize,
    p_offset: page * pageSize,
  });
  if (error) throw new Error(error.message || "Failed to load orders.");
  return {
    rows: Array.isArray(data?.rows) ? data.rows : [],
    total: Number(data?.total) || 0,
    summary: data?.summary || null,
  };
}

/** RSVP guest list + rollup counts (guest PII → definer RPC). Returns { rows, total, counts }. */
export async function listEventRsvps(eventId, { page = 0, pageSize = 25 } = {}) {
  const { data, error } = await supabase.rpc("admin_list_event_rsvps", {
    p_event_id: eventId,
    p_limit: pageSize,
    p_offset: page * pageSize,
  });
  if (error) throw new Error(error.message || "Failed to load RSVPs.");
  return {
    rows: Array.isArray(data?.rows) ? data.rows : [],
    total: Number(data?.total) || 0,
    counts: data?.counts || null,
  };
}

/**
 * Trip detail children (itinerary + pricing tiers + inclusions + intake schemas),
 * all RLS-direct + a ticket_types cross-ref for the tier price. Empty arrays when
 * a trip has no rows yet (panels render "none yet", never a crash). Installment
 * status is Wave-2 (SPEC §4.5 / Open Q3). Sub-read failures degrade to [] (logged),
 * never fabricated rows.
 */
export async function getTripDetail(eventId) {
  const [daysRes, tiersRes, inclusionsRes, schemasRes, ticketTypesRes] = await Promise.all([
    supabase.from("trip_days").select("*").eq("event_id", eventId).order("ordinal", { ascending: true }),
    supabase.from("trip_pricing_tiers").select("*").eq("event_id", eventId),
    supabase.from("trip_inclusions").select("*").eq("event_id", eventId).order("ordinal", { ascending: true }),
    supabase.from("trip_intake_schemas").select("*").eq("event_id", eventId),
    supabase.from("ticket_types").select("id,name,price_cents,currency").eq("event_id", eventId),
  ]);
  return {
    days: pick(daysRes, "trip_days"),
    pricingTiers: pick(tiersRes, "trip_pricing_tiers"),
    inclusions: pick(inclusionsRes, "trip_inclusions"),
    intakeSchemas: pick(schemasRes, "trip_intake_schemas"),
    ticketTypes: pick(ticketTypesRes, "ticket_types"),
  };
}

/**
 * Experience detail children — stops (RLS-direct). Feedback is Wave-2 (SPEC §4.6 /
 * Open Q4: experience_feedback keys on card_id text, not events.id — needs a
 * confirmed card_id ↔ events mapping before wiring). Returns { stops }.
 */
export async function getExperienceDetail(eventId) {
  const stopsRes = await supabase
    .from("experience_stops")
    .select("*")
    .eq("event_id", eventId)
    .order("stop_order", { ascending: true });
  return { stops: pick(stopsRes, "experience_stops") };
}

// ── Sub-read failure handling (never silent; degrade to empty, log a warning) ──

function pick(res, label) {
  if (res.error) {
    console.warn(`[offeringsService] ${label} read degraded:`, res.error?.message || res.error);
    return [];
  }
  return res.data || [];
}
