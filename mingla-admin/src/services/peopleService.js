// Issue #4130 (Wave 3) — the People page's one data authority.
//
// Reads go through the admin-only aggregate RPCs (admin_people_segments,
// admin_list_people, admin_get_person_activity); the unified person bundle is
// the existing admin_get_person. Writes are the audited RPCs in
// lib/personActions.js, bound here to the app's client. Nothing in this file
// reads or writes a table directly.
import { supabase } from "../lib/supabase";
import { createPersonActions } from "../lib/personActions";
import { getPerson } from "./identityReadService";

export const personActions = createPersonActions(supabase);

export { getPerson };

/**
 * Counts per segment (including #4226 ticket_buyer_no_app, which is a view,
 * not part of `people`), plus the countries people live in. Throws on error.
 */
export async function getPeopleSegments() {
  const { data, error } = await supabase.rpc("admin_people_segments");
  if (error) throw new Error(error.message || "Couldn't load the people counts.");
  return data || {};
}

// EntityListView sort key + direction -> admin_list_people p_sort.
const SORTS = Object.freeze({
  joined_at: { asc: "joined_asc", desc: "joined_desc" },
  name: { asc: "name_asc", desc: "name_desc" },
  last_active_at: { asc: "last_active_asc", desc: "last_active_desc" },
  // #4226: on the ticket-buyer tab the server reads "last active" as the
  // latest ticket.
  last_purchase_at: { asc: "last_active_asc", desc: "last_active_desc" },
});

export function peopleSortParam(sortKey, sortDir) {
  const entry = Object.hasOwn(SORTS, sortKey || "") ? SORTS[sortKey] : null;
  if (!entry) return "joined_desc";
  return sortDir === "asc" ? entry.asc : entry.desc;
}

const JOINED_WINDOWS = Object.freeze({ "7d": 7, "30d": 30, "90d": 90 });

export function joinedSince(value, now = Date.now()) {
  const days = Object.hasOwn(JOINED_WINDOWS, value || "") ? JOINED_WINDOWS[value] : null;
  return days ? new Date(now - days * 24 * 60 * 60 * 1000).toISOString() : null;
}

/** One page of a segment. EntityListView contract: { rows, total }; throws on error. */
export async function listPeople(segment, { search, sortKey, sortDir, filters = {}, page = 0, pageSize = 25 }) {
  const { data, error } = await supabase.rpc("admin_list_people", {
    p_segment: segment,
    p_search: search && search.trim() ? search.trim() : null,
    p_country: filters.country || null,
    p_joined_since: joinedSince(filters.joined),
    p_limit: pageSize,
    p_offset: page * pageSize,
    p_sort: peopleSortParam(sortKey, sortDir),
  });
  if (error) throw new Error(error.message || "Couldn't load people.");
  return { rows: Array.isArray(data?.rows) ? data.rows : [], total: Number(data?.total) || 0 };
}

/** The drawer's activity: last active, saves, friends, orders. Throws on error. */
export async function getPersonActivity(userId) {
  const { data, error } = await supabase.rpc("admin_get_person_activity", { p_user_id: userId });
  if (error) throw new Error(error.message || "Couldn't load this person's activity.");
  return data || {};
}
