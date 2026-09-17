/**
 * Issue #3386 — the admin queue of host change requests for LIVE venues.
 *
 * A host who changes a live venue's name, category or address sends a request;
 * the venue keeps its current details until Mingla approves. The request lives
 * in the `details_change_*` columns of the venue row (see
 * supabase/migrations/20270710013386_issue_3386_venue_details_host_edit.sql);
 * admins read it through the existing `is_admin_user()` SELECT policy.
 *
 * Deciding goes through the admin-review-venue-claim edge function
 * (`action: "review_details_change"`), which calls the audited SQL RPC and then
 * notifies the host. The admin app never writes the venue row itself.
 */

import { supabase } from "../lib/supabase";

const CHANGE_REQUEST_SELECT = `
  id,
  brand_id,
  name,
  slug,
  venue_category,
  address,
  city,
  country_code,
  lat,
  lng,
  coordinate_precision,
  claim_status,
  details_change_request_id,
  details_change_status,
  details_change_name,
  details_change_venue_category,
  details_change_address,
  details_change_city,
  details_change_country_code,
  details_change_lat,
  details_change_lng,
  details_change_coordinate_precision,
  details_change_requested_at,
  brand:brand_id (
    id,
    name,
    slug
  )
`;

/** Pending requests, oldest first. */
export async function listPendingVenueDetailsChanges() {
  const { data, error } = await supabase
    .from("venue_listings")
    .select(CHANGE_REQUEST_SELECT)
    .eq("details_change_status", "pending")
    .order("details_change_requested_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** How many requests are waiting (for the tab label). */
export async function countPendingVenueDetailsChanges() {
  const { count, error } = await supabase
    .from("venue_listings")
    .select("id", { count: "exact", head: true })
    .eq("details_change_status", "pending");
  if (error) throw error;
  return count ?? 0;
}

/**
 * The rows an admin compares: one per field the host asked to change, with the
 * live value beside the proposed one. Unchanged fields are left out.
 */
export function venueDetailsChangeRows(request, categoryLabels = {}) {
  const rows = [];
  if (request?.details_change_name != null) {
    rows.push({
      field: "Name",
      current: request.name ?? "—",
      proposed: request.details_change_name,
    });
  }
  if (request?.details_change_venue_category != null) {
    rows.push({
      field: "Category",
      current: categoryLabels[request.venue_category] ?? request.venue_category ?? "—",
      proposed:
        categoryLabels[request.details_change_venue_category] ??
        request.details_change_venue_category,
    });
  }
  if (request?.details_change_address != null) {
    rows.push({
      field: "Address",
      current: [request.address, request.city, request.country_code]
        .filter((part) => typeof part === "string" && part.length > 0)
        .join(", ") || "—",
      proposed: [
        request.details_change_address,
        request.details_change_city,
        request.details_change_country_code,
      ]
        .filter((part) => typeof part === "string" && part.length > 0)
        .join(", "),
    });
    rows.push({
      field: "Map pin",
      current: formatPin(request.lat, request.lng, request.coordinate_precision),
      proposed: formatPin(
        request.details_change_lat,
        request.details_change_lng,
        request.details_change_coordinate_precision,
      ),
    });
  }
  return rows;
}

function formatPin(lat, lng, precision) {
  if (typeof lat !== "number" || typeof lng !== "number") return "—";
  const where = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  return precision === "approximate" ? `${where} (approximate)` : where;
}

/** A Google Maps link for the proposed pin, so the admin can check the spot. */
export function proposedPinMapUrl(request) {
  const lat = request?.details_change_lat;
  const lng = request?.details_change_lng;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/**
 * Approve or reject one request. `requestId` pins the exact request the admin
 * is looking at: a withdrawn or replaced request comes back as
 * `{ ok: false, code }` instead of applying.
 *
 * @param {{ venueId: string, requestId: string, decision: "approve"|"reject", reason?: string }} input
 */
export async function reviewVenueDetailsChange({ venueId, requestId, decision, reason }) {
  const body = {
    action: "review_details_change",
    venue_id: venueId,
    request_id: requestId,
    decision,
  };
  if (decision === "reject") {
    body.rejection_reason = (reason ?? "").trim();
  }
  const { data, error } = await supabase.functions.invoke(
    "admin-review-venue-claim",
    { body },
  );
  if (error) {
    // Non-2xx: a 409 means the request moved on (withdrawn, replaced or already
    // decided); a 400 carries the RPC's refusal, e.g. venue_not_live.
    const payload = await readFunctionErrorPayload(error);
    if (payload?.ok === false && typeof payload.code === "string") {
      return { ok: false, code: payload.code };
    }
    if (typeof payload?.error === "string" && KNOWN_REFUSALS.has(payload.error)) {
      return { ok: false, code: payload.error };
    }
    if (typeof payload?.error === "string" && payload.error.length > 0) {
      throw new Error(payload.error);
    }
    throw error;
  }
  if (data?.error) throw new Error(data.error);
  if (data?.ok === false) return { ok: false, code: data.code ?? "request_not_current" };
  return { ok: true, result: data?.result ?? null, notified: data?.notified ?? 0 };
}

const KNOWN_REFUSALS = new Set([
  "request_not_current",
  "request_not_pending",
  "venue_not_live",
  "category_stay_change_not_supported",
  "rejection_reason_required",
]);

async function readFunctionErrorPayload(error) {
  const context = error?.context;
  if (!context || typeof context.json !== "function") return null;
  try {
    return await context.json();
  } catch {
    return null;
  }
}

/** What the admin reads when a decision could not be applied. */
export function venueDetailsChangeFailureCopy(code) {
  switch (code) {
    case "request_not_current":
      return "The host withdrew or replaced this request. Refresh to see the latest one.";
    case "request_not_pending":
      return "This request was already rejected.";
    case "venue_not_live":
      return "This venue isn't live any more, so the change can't be applied. Reject it instead.";
    case "category_stay_change_not_supported":
      return "Moving a venue into or out of Stay can't be done here. Reject it and handle it with the host.";
    case "rejection_reason_required":
      return "Add a reason so the host knows what to fix.";
    default:
      return "Try again. If this keeps happening, check the Admin activity log.";
  }
}
