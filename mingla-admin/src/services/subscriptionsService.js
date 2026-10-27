// Issue #4130 (Wave 2b) — the one caller of the Subscriptions reads.
//
// The browser cannot read subscriptions or admin_subscription_overrides
// (RPC-only, per #1272), so every number on the page comes from an admin RPC.
// Grant and revoke go through the audited RPCs in adminMoneyActService.js,
// which record the signed-in admin on the server.
import { supabase } from "../lib/supabase";
import { fetchAllRows } from "../lib/listAll";

/**
 * One page of people. filter: null | "plus" | "free" | "admin". Staff and test
 * accounts are left out unless showInternal (#4130); internalHidden says how many.
 */
export async function listSubscriptions({ search = "", filter = null, sort = "joined", desc = true, page = 0, pageSize = 20, showInternal = false } = {}) {
  const { data, error } = await supabase.rpc("admin_list_subscriptions_v2", {
    p_search: search || null,
    p_filter: filter,
    p_sort: sort,
    p_desc: desc,
    p_limit: pageSize,
    p_offset: page * pageSize,
    p_show_internal: showInternal === true,
  });
  if (error) throw new Error(error.message || "subscriptions_load_failed");
  return {
    rows: Array.isArray(data?.rows) ? data.rows : [],
    total: Number.isFinite(data?.total) ? data.total : 0,
    globalPlus: data?.global_plus === true,
    internalHidden: Number.isFinite(data?.internal_hidden) ? data.internal_hidden : 0,
  };
}

/** Every row for the current search, filter and sort, up to the export cap. */
export async function listAllSubscriptions(query) {
  return fetchAllRows(
    ({ page, pageSize }) => listSubscriptions({ ...query, page, pageSize }),
    {},
  );
}

/**
 * Counts: people, real Mingla+ and free, paid, given by an admin, ending in 3 days, Global Plus.
 * #4130: staff and test accounts are left out unless showInternal, exactly as
 * the list; internal_hidden says how many.
 */
export async function getSubscriptionOverview({ showInternal = false } = {}) {
  const { data, error } = await supabase.rpc("admin_subscription_overview", { p_show_internal: showInternal === true });
  if (error) throw new Error(error.message || "subscription_overview_failed");
  return data ?? null;
}

/** Overrides ending within `days` (default 3). */
export async function listExpiringOverrides(days = 3) {
  const { data, error } = await supabase.rpc("admin_subscription_overrides_expiring", { p_within_days: days });
  if (error) throw new Error(error.message || "expiring_overrides_failed");
  return { count: Number(data?.count ?? 0), rows: Array.isArray(data?.rows) ? data.rows : [] };
}

export async function getOverrideHistory(userId) {
  const { data, error } = await supabase.rpc("admin_get_override_history", { p_user_id: userId });
  if (error) throw new Error(error.message || "override_history_failed");
  return Array.isArray(data) ? data : [];
}

export async function getGlobalPlus() {
  const { data, error } = await supabase
    .from("app_config")
    .select("config_value")
    .eq("config_key", "global_plus_access")
    .maybeSingle();
  if (error) throw new Error(error.message || "global_plus_load_failed");
  return data?.config_value === "true";
}

/**
 * #4130: Global Plus switches only through the audited admin RPC. It needs a
 * reason, writes admin_audit_log, and errors when nothing changed (so the page
 * never reports a switch that did not happen).
 */
export async function setGlobalPlus(on, reason) {
  const { data, error } = await supabase.rpc("admin_set_global_plus", { p_on: on === true, p_reason: reason ?? null });
  if (error) throw new Error(error.message || "global_plus_save_failed");
  if (data?.ok !== true) throw new Error("global_plus_save_failed");
  return data;
}
