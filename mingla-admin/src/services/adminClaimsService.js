/**
 * Ve3 — venue claims queue data + review actions.
 */

import { supabase } from "../lib/supabase";

const CLAIM_SELECT = `
  id,
  name,
  slug,
  venue_category,
  city,
  country_code,
  address,
  created_at,
  contact_email,
  contact_phone,
  description,
  google_place_id,
  lat,
  lng,
  cover_media_url,
  place_pool_id,
  marked_called_at,
  claim_follow_up_at,
  duplicate_of_brand_id,
  place_pool:place_pool_id (
    national_phone_number,
    google_maps_uri
  )
`;

export async function listPendingClaims() {
  const { data, error } = await supabase
    .from("brands")
    .select(CLAIM_SELECT)
    .eq("claim_status", "pending_review")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function listVerifiedClaims() {
  const { data, error } = await supabase
    .from("brands")
    .select(CLAIM_SELECT)
    .eq("claim_status", "verified")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function listRejectedClaims() {
  const { data, error } = await supabase
    .from("brands")
    .select(CLAIM_SELECT)
    .eq("claim_status", "rejected")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

/**
 * @param {string} brandId
 * @param {"mark_called"|"approve"|"reject"|"need_more_info"} action
 * @param {{ rejectionReason?: string }} [opts]
 */
export async function reviewClaim(brandId, action, opts = {}) {
  const body = { brand_id: brandId, action };
  if (action === "reject") {
    body.rejection_reason = opts.rejectionReason ?? "";
  }

  const { data, error } = await supabase.functions.invoke(
    "admin-review-venue-claim",
    { body },
  );

  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * Group pending claims by google_place_id for duplicate warnings.
 * @param {Array<{ id: string, google_place_id?: string | null }>} rows
 */
export function groupClaimsByGooglePlaceId(rows) {
  /** @type {Map<string, string[]>} */
  const map = new Map();
  for (const row of rows) {
    const gid = row.google_place_id?.trim?.();
    if (!gid) continue;
    const list = map.get(gid) ?? [];
    list.push(row.id);
    map.set(gid, list);
  }
  return map;
}
