/**
 * ORCH-1273 [Admin Offerings console — READ-ONLY] — venues read service.
 *
 * The SINGLE data authority for the Venues console. READ-ONLY by contract: zero
 * .update / .insert / .delete / .upsert / admin_write_audit and ZERO admin write
 * RPC — every venue / reservation edit is Wave-2 (SPEC §6). Enforced by
 * I-PROPOSED-1273-OFFERINGS-READ-ONLY + the i-offerings-read-only gate (AC-4.4).
 *
 * Read paths (per ORCH-1271 §3 read-authz rule):
 *   - venue_listings + the reservation-config stack (venue_reservation_settings,
 *     venue_capacity_rules, venue_tables, venue_blackouts, venue_waitlist) →
 *     direct supabase.from(...) under is_admin_user() SELECT RLS (venue_listings
 *     reuses the pre-existing "venue_listings admin can read"; the 5 stack tables
 *     get new 1273 policies).
 *   - reservations (guest PII + payment + status counts) → the guard-first
 *     admin_list_venue_reservations definer RPC (NO admin RLS on reservations).
 *
 * NB: never selects the brand kind column (META-ORCH-0972) — brand names resolve
 * via an id+name in()-read only. venue_listings carries venue_category, no kind.
 */

import { supabase } from "../lib/supabase";
import { escapeLike } from "../lib/formatters";
// ORCH-1277 [Admin Offerings console — WAVE-2 EDIT]: audited-write seam for the venue
// reservation stack. Reservation-settings / capacity-rule / reservation-status edits
// route ONLY through callAdminWriteRpc → guard-first is_admin_user() SECURITY DEFINER
// RPCs (audited, REVOKE'd from anon); NEVER a raw .update on a venue table.
import { callAdminWriteRpc } from "./adminWriteService";

const VENUE_SORT = { name: "name", created_at: "created_at" };

/**
 * Cross-brand venue_listings list for the Venues console (RLS-direct; reuses
 * "venue_listings admin can read"). Server search / sort / filter / pagination.
 * Resolves brand_id → brand name via one id+name in()-read. Returns { rows, total };
 * throws on error.
 */
export async function listVenues({ search, sortKey, sortDir, filters = {}, page = 0, pageSize = 25 }) {
  let query = supabase.from("venue_listings").select("*", { count: "exact" });

  if (search) {
    const s = escapeLike(search.trim());
    if (s) query = query.or(`name.ilike.%${s}%,city.ilike.%${s}%,slug.ilike.%${s}%,address.ilike.%${s}%`);
  }
  if (filters.venue_category) query = query.eq("venue_category", filters.venue_category);
  if (filters.claim_status) query = query.eq("claim_status", filters.claim_status);
  if (filters.brand_id) query = query.eq("brand_id", filters.brand_id);

  query = query
    .order(VENUE_SORT[sortKey] || "created_at", { ascending: sortDir === "asc" })
    .range(page * pageSize, (page + 1) * pageSize - 1);

  const { data, count, error } = await query;
  if (error) throw new Error(error.message || "Failed to load venues.");

  const rows = data || [];
  const brandNameById = await resolveBrandNames(rows.map((r) => r.brand_id).filter(Boolean));
  return {
    rows: rows.map((r) => ({ ...r, brand_name: r.brand_id ? brandNameById[r.brand_id] || null : null })),
    total: count ?? 0,
  };
}

/** Venue core record (RLS-direct). Returns the row or null; throws on error. */
export async function getVenue(venueId) {
  const { data, error } = await supabase.from("venue_listings").select("*").eq("id", venueId).maybeSingle();
  if (error) throw new Error(error.message || "Failed to load venue.");
  return data || null;
}

/** Reservation settings (PK = venue_id). RLS-direct. Returns the row or null. */
export async function getVenueReservationSettings(venueId) {
  const { data, error } = await supabase
    .from("venue_reservation_settings")
    .select("*")
    .eq("venue_id", venueId)
    .maybeSingle();
  if (error) {
    console.warn("[venuesService] getVenueReservationSettings degraded:", error?.message || error);
    return null;
  }
  return data || null;
}

/** Venue tables (RLS-direct). */
export async function getVenueTables(venueId) {
  return pickList(
    await supabase.from("venue_tables").select("*").eq("venue_id", venueId).order("sort_order", { ascending: true }),
    "venue_tables",
  );
}

/** Venue capacity rules (RLS-direct). */
export async function getVenueCapacityRules(venueId) {
  return pickList(await supabase.from("venue_capacity_rules").select("*").eq("venue_id", venueId), "venue_capacity_rules");
}

/** Venue blackout windows (RLS-direct). */
export async function getVenueBlackouts(venueId) {
  return pickList(
    await supabase.from("venue_blackouts").select("*").eq("venue_id", venueId).order("date_start", { ascending: true }),
    "venue_blackouts",
  );
}

/** Venue waitlist (RLS-direct). */
export async function getVenueWaitlist(venueId) {
  return pickList(await supabase.from("venue_waitlist").select("*").eq("venue_id", venueId), "venue_waitlist");
}

/**
 * Reservations for a venue (guest PII + payment + status counts) via the
 * guard-first admin_list_venue_reservations definer RPC. Returns { rows, total,
 * counts }; throws on error.
 */
export async function listVenueReservations(venueId, { status = null, page = 0, pageSize = 25 } = {}) {
  const { data, error } = await supabase.rpc("admin_list_venue_reservations", {
    p_venue_id: venueId,
    p_status: status || null,
    p_limit: pageSize,
    p_offset: page * pageSize,
  });
  if (error) throw new Error(error.message || "Failed to load reservations.");
  return {
    rows: Array.isArray(data?.rows) ? data.rows : [],
    total: Number(data?.total) || 0,
    counts: data?.counts || {},
  };
}

/**
 * Distinct brands for the Venues list Brand filter (reuses "brands admin can
 * read"). id + name only — NEVER the brand kind column (META-ORCH-0972). → [].
 */
export async function listVenueBrands() {
  const { data, error } = await supabase.from("brands").select("id,name").is("deleted_at", null).order("name");
  if (error) {
    console.warn("[venuesService] listVenueBrands degraded:", error?.message || error);
    return [];
  }
  return data || [];
}

// ── Helpers (never silent; degrade to empty, log a warning) ───────────────────

async function resolveBrandNames(ids) {
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return {};
  const { data, error } = await supabase.from("brands").select("id,name").in("id", uniq);
  if (error) {
    console.warn("[venuesService] resolveBrandNames degraded:", error?.message || error);
    return {};
  }
  const map = {};
  for (const b of data || []) map[b.id] = b.name;
  return map;
}

function pickList(res, label) {
  if (res.error) {
    console.warn(`[venuesService] ${label} read degraded:`, res.error?.message || res.error);
    return [];
  }
  return res.data || [];
}

// ── ORCH-1277 audited writes (venue reservation stack) ────────────────────────
//
// Every mutation routes through callAdminWriteRpc('<audited rpc>', {...}) → { data,
// error }. The console NEVER calls .update()/.insert()/.delete() on a venue table
// directly. Callers surface { error } via mapVenueWriteError().

/** Translate a venue-write RPC error into human copy for the modal error slot. */
export function mapVenueWriteError(error) {
  const msg = error?.message || "";
  if (msg.includes("not_authorized")) return "You are not authorized to do this.";
  if (msg.includes("reason_required")) return "A reason is required.";
  if (msg.includes("not_found")) return "That record no longer exists.";
  if (msg.includes("invalid_no_show_policy")) return "No-show policy must be “forfeit” or “none”.";
  if (msg.includes("invalid_fee")) return "The fee must be 0 or more (in cents).";
  if (msg.includes("invalid_cutoff")) return "The cancellation cutoff must be 0 or more hours.";
  if (msg.includes("invalid_zone")) return "Invalid zone value.";
  if (msg.includes("invalid_status")) return "Invalid reservation status.";
  if (msg.includes("no_editable_fields")) return "No editable fields were provided.";
  return msg || "Something went wrong. Please try again.";
}

/** #14 — edit venue reservation settings (HIGH). patch = whitelisted jsonb (incl. the enabled toggle). */
export function updateVenueReservationSettings(venueId, patch, reason) {
  return callAdminWriteRpc("admin_update_venue_reservation_settings", {
    p_venue_id: venueId,
    p_patch: patch,
    p_reason: reason,
  });
}

/** #15 — edit a venue capacity rule (HIGH). patch = whitelisted { params, is_active, zone } (kind immutable). */
export function updateVenueCapacityRule(ruleId, patch, reason) {
  return callAdminWriteRpc("admin_update_venue_capacity_rule", {
    p_rule_id: ruleId,
    p_patch: patch,
    p_reason: reason,
  });
}

/** #16 — override a reservation status (HIGH). Fires the guest-notify trigger (modal warns). */
export function setReservationStatus(reservationId, status, reason) {
  return callAdminWriteRpc("admin_set_reservation_status", {
    p_reservation_id: reservationId,
    p_status: status,
    p_reason: reason,
  });
}
