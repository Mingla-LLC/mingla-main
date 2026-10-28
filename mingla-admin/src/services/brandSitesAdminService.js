import { supabase } from "../lib/supabase";

function unwrap(result, fallback) {
  if (result.error) throw new Error(result.error.message || fallback);
  return result.data;
}

export async function listBrandSites({ search = "", page = 0, pageSize = 25 } = {}) {
  const data = unwrap(
    await supabase.rpc("brand_site_admin_list", {
      p_search: search.trim() || null,
      p_limit: pageSize,
      p_offset: page * pageSize,
    }),
    "Failed to load brand sites.",
  );
  return { rows: data?.rows || [], total: data?.total || 0 };
}

export async function getBrandSiteDetail(siteId) {
  return unwrap(
    await supabase.rpc("brand_site_admin_detail", { p_site_id: siteId }),
    "Failed to load the brand site.",
  );
}

function safeReasonCode(reason) {
  const normalized = reason
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return normalized.length >= 3 ? normalized : "ADMIN_REQUEST";
}

export async function runBrandSiteAction(siteId, action, reason, targetOperationId = null, hostname = null) {
  const operationId = globalThis.crypto?.randomUUID?.();
  if (!operationId) throw new Error("A secure operation identifier is unavailable.");
  return unwrap(
    await supabase.rpc("brand_site_admin_action", {
      p_site_id: siteId,
      p_operation_id: operationId,
      p_action: action,
      p_reason_code: safeReasonCode(reason),
      p_target_operation_id: targetOperationId,
      p_hostname: hostname,
    }),
    "The operation could not be completed.",
  );
}

// #2829 W8 — "Recheck" one of a site's own domains now (DNS, certificate,
// site probe). Same Core check the 6-hourly sweep runs; Core allows it for
// Mingla admins.
export async function recheckBrandSiteDomain(siteId, hostId) {
  const { data, error } = await supabase.functions.invoke("brand-site-domains", {
    body: { route: `/v1/sites/${siteId}/domains/${hostId}/check`, method: "POST" },
  });
  if (error || !data?.ok) {
    throw new Error(data?.error?.message || "The address could not be rechecked. Try again.");
  }
  return data.data;
}
