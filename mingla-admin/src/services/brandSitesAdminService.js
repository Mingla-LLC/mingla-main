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

export async function runBrandSiteAction(siteId, action, reason) {
  const operationId = globalThis.crypto?.randomUUID?.();
  if (!operationId) throw new Error("A secure operation identifier is unavailable.");
  return unwrap(
    await supabase.rpc("brand_site_admin_action", {
      p_site_id: siteId,
      p_operation_id: operationId,
      p_action: action,
      p_reason_code: safeReasonCode(reason),
    }),
    "The operation could not be completed.",
  );
}

