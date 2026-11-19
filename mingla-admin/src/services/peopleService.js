// Issue #4130 (Wave 3) — the People page's one data authority.
//
// Reads go through the admin-only RPCs: #4226 Phase 2's one People filter
// (admin_people_filter, admin_people_facets, admin_people_filter_counts,
// admin_person_journey), admin_get_person_activity, and the unified person
// bundle admin_get_person. Writes are the audited RPCs in
// lib/personActions.js, bound here to the app's client. Nothing in this file
// reads or writes a table directly.
import { supabase } from "../lib/supabase";
import { createPersonActions } from "../lib/personActions";
import { getPerson } from "./identityReadService";

export const personActions = createPersonActions(supabase);

export { getPerson };

/** The drawer's activity: last active, saves, friends, orders. Throws on error. */
export async function getPersonActivity(userId) {
  const { data, error } = await supabase.rpc("admin_get_person_activity", { p_user_id: userId });
  if (error) throw new Error(error.message || "Couldn't load this person's activity.");
  return data || {};
}

// ── #4226 Phase 2: the one People filter (admin_people_filter and friends) ──

// The columns the journey list shows (and the CSV exports).
const JOURNEY_COLUMNS = [
  "person_key", "user_id", "email", "name", "phone_e164", "segment", "app_status", "person_kind",
  "is_internal", "country", "country_source", "city", "city_source", "joined_at", "created_at",
  "explorer_stage", "explorer_stopped_step", "explorer_stopped_step_key", "host_next_step", "host_checklist",
  "brand_setup_furthest_step", "brand_setup_furthest_step_key", "source", "source_confidence", "source_detail",
  "last_active_at", "activity_status", "rsvp_count", "experience_count", "ticket_count", "saves_count",
  "friends_count", "brand_count", "published_count", "bank_connected", "payout_countries", "first_sale_at",
  "emails_ok", "marketing_consent", "consent_basis", "host_brands", "brands", "spent", "tickets_count",
  "first_purchase_at", "last_purchase_at", "host_contact_added_at", "sign_in_method",
].join(",");

// EntityListView sort key -> a column of admin_people_filter.
const JOURNEY_SORTS = Object.freeze({
  name: "name",
  joined_at: "joined_at",
  last_active_at: "last_active_at",
});

/**
 * One page of the people a filter matches, with the exact total. The filter
 * is the same object Email sends (lib/peopleFilter.js). Throws on error.
 */
export async function listPeopleByFilter(filter, { sortKey, sortDir, page = 0, pageSize = 25 } = {}) {
  const column = Object.hasOwn(JOURNEY_SORTS, sortKey || "") ? JOURNEY_SORTS[sortKey] : "joined_at";
  const ascending = sortKey ? sortDir === "asc" : false;
  const { data, error, count } = await supabase
    .rpc("admin_people_filter", { p_filters: filter || {} }, { count: "exact" })
    .select(JOURNEY_COLUMNS)
    .order(column, { ascending, nullsFirst: false })
    .order("person_key", { ascending: true })
    .range(page * pageSize, page * pageSize + pageSize - 1);
  if (error) throw new Error(filterErrorMessage(error, "Couldn't load people."));
  return { rows: Array.isArray(data) ? data : [], total: Number(count) || 0 };
}

/** Per filter key, the values people in this filter have, each with a count. */
export async function getPeopleFacets(filter) {
  const { data, error } = await supabase.rpc("admin_people_facets", { p_filters: filter || {} });
  if (error) throw new Error(filterErrorMessage(error, "Couldn't load the filter options."));
  return { total: Number(data?.total) || 0, facets: data?.facets && typeof data.facets === "object" ? data.facets : {} };
}

/** Many counts at once: { name: filter } -> { name: count }. */
export async function getPeopleFilterCounts(named) {
  const { data, error } = await supabase.rpc("admin_people_filter_counts", { p_named: named });
  if (error) throw new Error(filterErrorMessage(error, "Couldn't load the counts."));
  return data && typeof data === "object" ? data : {};
}

/** One person's journey row, milestones, owned brands and counts. */
export async function getPersonJourney(personKey) {
  const { data, error } = await supabase.rpc("admin_person_journey", { p_key: personKey });
  if (error) {
    const msg = error.message || "";
    throw new Error(
      msg.includes("not_found")
        ? "This person is no longer on the People list."
        : msg.includes("not_authorized")
          ? "You don't have permission to see people."
          : msg || "Couldn't load this person's journey.",
    );
  }
  return data || {};
}

/**
 * Recent app screens and sessions from PostHog (admin-person-activity).
 * { configured: false } means the read key isn't set yet. Throws on error.
 */
export async function getPersonAppActivity(userId) {
  const { data, error } = await supabase.functions.invoke("admin-person-activity", { body: { user_id: userId } });
  if (error) throw new Error("Couldn't load recent screens from PostHog. Try again in a minute.");
  if (data?.error) throw new Error("Couldn't load recent screens from PostHog. Try again in a minute.");
  return data || { configured: false };
}

function filterErrorMessage(error, fallback) {
  const msg = error?.message || "";
  if (msg.includes("invalid_filter")) return "That filter isn't valid any more. Clear filters and try again.";
  if (msg.includes("not_authorized")) return "You don't have permission to see people.";
  return msg || fallback;
}
