// Issue #4130 (Wave 4b) — the server calls behind Place pool, Feature flags,
// Settings' danger zone and Team and roles' "last active". Each throws an Error
// carrying the server's message and code; pages show it, never a 0.
import { supabase } from "../lib/supabase";

async function call(name, params) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) {
    const err = new Error(error.message || "The server did not answer.");
    err.code = error.code;
    throw err;
  }
  return data;
}

/** The place funnel (active, checked, visible, with_photos, cities[]). */
export function fetchPlaceFunnel({ countryCode = null, cityId = null } = {}) {
  return call("admin_place_pool_funnel", { p_country_code: countryCode, p_city_id: cityId });
}

/** Every feature flag with its issue, last change, who and why. */
export async function fetchFeatureFlagsBoard() {
  const rows = await call("admin_feature_flags_board");
  return Array.isArray(rows) ? rows : [];
}

/** Turns a flag on or off; the server needs a reason and logs the change. */
export function setFeatureFlag(flagKey, enabled, reason) {
  return call("admin_set_feature_flag", { p_flag_key: flagKey, p_enabled: enabled, p_reason: reason });
}

/** Owner only: restarts the welcome tour for every account. */
export function restartTourForEveryone(typed, reason) {
  return call("admin_restart_tour_for_everyone", { p_confirm: typed, p_reason: reason });
}

/** Owner only: { email -> last_active_at }. */
export async function fetchTeamLastActive() {
  const rows = await call("admin_team_last_active");
  const out = {};
  for (const row of Array.isArray(rows) ? rows : []) out[row.email] = row.last_active_at;
  return out;
}

/** Friendly words for the server's refusals. */
export function systemErrorWords(error) {
  const msg = String(error?.message || "");
  if (/reason_required/.test(msg)) return "Add a reason first.";
  if (/confirmation_required/.test(msg)) return "Type RESTART exactly to confirm.";
  if (/owner_only/.test(msg)) return "Only the owner can do this.";
  if (/not_authorized/.test(msg)) return "You don't have access to this.";
  if (/not_found/.test(msg)) return "That flag no longer exists. Refresh the list.";
  return msg || "Something went wrong. Try again.";
}

/** Re-counts the admin place view now (it also refreshes every 10 minutes). */
export function refreshPlacePoolStats() {
  return call("admin_refresh_place_pool_mv");
}

/** The Intelligence Trial's last 200 runs, read-only (the trial is retired). */
export async function fetchTrialRunHistory() {
  const { data, error } = await supabase
    .from("place_intelligence_trial_runs")
    .select("*, place:place_pool!place_pool_id(id, name, primary_type)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    const err = new Error(error.message || "Couldn't load the trial history.");
    err.code = error.code;
    throw err;
  }
  return data || [];
}
