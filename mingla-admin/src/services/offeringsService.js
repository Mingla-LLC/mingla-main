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
// ORCH-1277 [Admin Offerings console — WAVE-2 EDIT]: audited-write seam. Every
// offering/event/trip/experience/RSVP mutation routes through callAdminWriteRpc →
// a guard-first is_admin_user() SECURITY DEFINER RPC that audits + is REVOKE'd from
// anon — the console NEVER touches an offering table with a raw .update/.insert/
// .delete/.upsert (I-PROPOSED-1277-OFFERINGS-WRITE-VIA-AUDITED-RPC).
import { callAdminWriteRpc } from "./adminWriteService";

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

// ── ORCH-1277 audited writes (offering / event / trip / experience / RSVP) ────────
//
// Thin typed wrappers over the ORCH-1271 audited-write primitive: EVERY mutation
// routes through callAdminWriteRpc('<audited rpc>', {...}) → { data, error }. The
// console NEVER calls .update()/.insert()/.delete() on an offering table directly.
// Each maps camelCase args → the RPC's p_* params; callers surface { error } to the
// modal's inline error slot via mapOfferingWriteError().

/** Translate an offerings-write RPC error into human copy for the modal error slot. */
export function mapOfferingWriteError(error) {
  const msg = error?.message || "";
  if (msg.includes("not_authorized")) return "You are not authorized to do this.";
  if (msg.includes("reason_required")) return "A reason is required.";
  if (msg.includes("not_found")) return "That record no longer exists.";
  if (msg.includes("already_cancelled")) return "This offering is already cancelled.";
  if (msg.includes("invalid_visibility")) return "Invalid visibility value.";
  // #1931 — Admin keeps synchronous Public <-> Hidden, but every transition ENTERING or
  // LEAVING Private is rejected non-mutatingly: those transitions need the two-phase
  // media preparation that only Mingla Business can drive (Amendment 2 §D). Admin UI
  // composition is unchanged; this is the mapping only.
  if (msg.includes("private_transition_requires_business")) {
    return "Use Mingla Business to prepare media before changing a Private event. Nothing was changed.";
  }
  if (msg.includes("invalid_price")) return "Enter a whole number of cents (0 or more).";
  if (msg.includes("invalid_capacity")) return "Capacity must be 0 or more (blank = uncapped).";
  if (msg.includes("invalid_approval_status")) return "Invalid approval value.";
  if (msg.includes("ai_description_empty")) return "The AI description can't be empty.";
  if (msg.includes("invalid_place_name")) return "The place name can't be empty.";
  if (msg.includes("invalid_address")) return "The address can't be empty.";
  if (msg.includes("invalid_title")) return "The day title can't be empty.";
  if (msg.includes("no_editable_fields")) return "No editable fields were provided.";
  // Residual raw DB constraint codes surfaced to the modal (ORCH-1277 P3-a/P3-b):
  if (msg.includes("trip_days_ordinal_check")) return "That position isn't valid — day order must stay 1 or higher.";
  if (msg.includes("event_currency_required")) return "This offering needs a currency set before it can be published.";
  return msg || "Something went wrong. Please try again.";
}

/** #1 — unpublish / republish an offering (HIGH). visibility ∈ public|discover|private|hidden|draft. */
export function setOfferingVisibility(eventId, visibility, reason) {
  return callAdminWriteRpc("admin_set_offering_visibility", {
    p_event_id: eventId,
    p_visibility: visibility,
    p_reason: reason,
  });
}

/**
 * #2 — cancel an offering (HIGH, destructive). The RPC body still only flips
 * events.status='cancelled'; #1179 [cancel-refund-fanout] adds a best-effort kickoff
 * of the buyer auto-refund fan-out AFTER the cancel commits. The kickoff is a LATENCY
 * optimisation only — correctness is guaranteed by the backstop pg_cron — so it is
 * fire-and-forget and NEVER throws into the cancel flow.
 */
export async function cancelOffering(eventId, reason) {
  const result = await callAdminWriteRpc("admin_cancel_offering", {
    p_event_id: eventId,
    p_reason: reason,
  });
  // Strictly transparent kickoff: the try/catch swallows any synchronous failure
  // (e.g. an absent functions client) and the trailing .catch() swallows any async
  // rejection, so neither a failure nor the absence of the fan-out endpoint can
  // ever reject into cancelOffering or alter its result.
  try {
    supabase.functions
      .invoke("event-cancel-refund-fanout", { body: { event_id: eventId } })
      .catch(() => {
        /* backstop cron re-drives — see supabase/functions/event-cancel-refund-fanout */
      });
  } catch {
    /* fan-out client unavailable — backstop cron re-drives */
  }
  return result;
}

/** #3 — close / reopen bookings (HIGH). */
export function setBookingsClosed(eventId, closed, reason) {
  return callAdminWriteRpc("admin_set_offering_bookings_closed", {
    p_event_id: eventId,
    p_closed: closed,
    p_reason: reason,
  });
}

/** #4 — soft-delete / restore an offering (HIGH). */
export function setOfferingDeleted(eventId, deleted, reason) {
  return callAdminWriteRpc("admin_set_offering_deleted", {
    p_event_id: eventId,
    p_deleted: deleted,
    p_reason: reason,
  });
}

/** #5 — fix a mispriced ticket / trip tier (HIGH). priceCents = integer cents. */
export function setTicketPrice(ticketTypeId, priceCents, reason) {
  return callAdminWriteRpc("admin_set_ticket_price", {
    p_ticket_type_id: ticketTypeId,
    p_price_cents: priceCents,
    p_reason: reason,
  });
}

/** #6 — edit a trip itinerary day (HIGH). patch = whitelisted { title, narrative, date }. */
export function updateTripDay(tripDayId, patch, reason) {
  return callAdminWriteRpc("admin_update_trip_day", {
    p_trip_day_id: tripDayId,
    p_patch: patch,
    p_reason: reason,
  });
}

/** #7 — reorder a trip itinerary day (AUDIT-ONLY). reason optional. */
export function reorderTripDay(tripDayId, newOrdinal, reason = null) {
  return callAdminWriteRpc("admin_reorder_trip_day", {
    p_trip_day_id: tripDayId,
    p_new_ordinal: newOrdinal,
    p_reason: reason,
  });
}

/** #8 — edit / moderate an experience stop (HIGH). patch = { ai_description, place_name, address, start_time }. */
export function updateExperienceStop(stopId, patch, reason) {
  return callAdminWriteRpc("admin_update_experience_stop", {
    p_stop_id: stopId,
    p_patch: patch,
    p_reason: reason,
  });
}

/** #9 — remove an experience stop (HIGH, destructive — hard DELETE, no deleted_at column). */
export function deleteExperienceStop(stopId, reason) {
  return callAdminWriteRpc("admin_delete_experience_stop", { p_stop_id: stopId, p_reason: reason });
}

/** #10 — reorder an experience stop (AUDIT-ONLY). reason optional. */
export function reorderExperienceStop(stopId, newOrder, reason = null) {
  return callAdminWriteRpc("admin_reorder_experience_stop", {
    p_stop_id: stopId,
    p_new_order: newOrder,
    p_reason: reason,
  });
}

/** #11 — approve / deny an RSVP guest. deny = HIGH (reason required); approve = audit-only. */
export function setRsvpApproval(rsvpId, approvalStatus, reason = null) {
  return callAdminWriteRpc("admin_set_rsvp_approval", {
    p_rsvp_id: rsvpId,
    p_approval_status: approvalStatus,
    p_reason: reason,
  });
}

/** #12 — remove an RSVP guest (HIGH, destructive — cascades event_rsvp_guests). */
export function removeRsvpGuest(rsvpId, reason) {
  return callAdminWriteRpc("admin_remove_rsvp_guest", { p_rsvp_id: rsvpId, p_reason: reason });
}

/** #13 — adjust RSVP capacity / waitlist (HIGH). capacity = null → uncapped. */
export function setRsvpCapacity(eventId, rsvpCapacity, waitlistEnabled, reason) {
  return callAdminWriteRpc("admin_set_rsvp_capacity", {
    p_event_id: eventId,
    p_rsvp_capacity: rsvpCapacity,
    p_waitlist_enabled: waitlistEnabled,
    p_reason: reason,
  });
}
