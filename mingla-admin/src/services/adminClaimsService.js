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
    google_maps_uri,
    website,
    generative_summary,
    stored_photo_urls,
    business_gallery_urls,
    price_tiers,
    price_level,
    ai_signal_scores,
    ai_signal_scores_veto,
    business_authoring_inputs,
    business_recommend_edit_count
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
 * META-ORCH-1062 Q4 — fetch the full claim-review bundle (brand identity +
 * linked place_pool vetting fields + place_scores array) via the admin-gated
 * SECURITY DEFINER RPC. The RPC enforces is_admin_user() server-side; this is
 * the single round-trip the modal uses for photos + scores + missing fields.
 * @param {string} brandId
 */
export async function getClaimReviewBundle(brandId) {
  const { data, error } = await supabase.rpc("admin_get_claim_review_bundle", {
    p_brand_id: brandId,
  });
  if (error) throw error;
  return data ?? null;
}

/**
 * META-ORCH-1062 Phase 1 — tweak whitelisted submitted fields (address /
 * venue_category / price_level / price_tiers) on a pending_review claim. Routed
 * through the admin-review edge wrapper as action:"tweak_fields" so the admin
 * gate + admin_audit_log path is shared with reviews.
 * @param {string} brandId
 * @param {{ address?: string, venue_category?: string, price_level?: string, price_tiers?: unknown }} patch
 */
export async function tweakClaimFields(brandId, patch) {
  const { data, error } = await supabase.functions.invoke(
    "admin-review-venue-claim",
    { body: { brand_id: brandId, action: "tweak_fields", patch } },
  );
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * META-ORCH-1062 Q2 — bidirectional admin score override. Writes the deck-
 * ranking place_scores.score (UPSERT, clamped 0–200) + the audit slice. Routed
 * through the edge wrapper as action:"score_override".
 * @param {string} brandId
 * @param {string} signalId
 * @param {number} score 0–200
 * @param {string} [reason]
 */
export async function overrideClaimScore(brandId, signalId, score, reason) {
  const { data, error } = await supabase.functions.invoke(
    "admin-review-venue-claim",
    {
      body: {
        brand_id: brandId,
        action: "score_override",
        signal_id: signalId,
        score,
        reason: reason ?? null,
      },
    },
  );
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * @param {string} brandId
 * @param {"mark_called"|"approve"|"reject"|"need_more_info"} action
 * @param {{ rejectionReason?: string, scoreVetoes?: Record<string, unknown> }} [opts]
 *   NOTE (META-ORCH-1062 / #299 merge): `scoreVetoes` is the legacy #299 WS7
 *   reduce-only channel. The admin UI no longer sends it on approve (score
 *   editing is now the bidirectional `overrideClaimScore` path, go-live is the
 *   Phase 4 servable→scorer path). The pass-through below is retained ONLY for
 *   backward-compat: admin-review-venue-claim still accepts `score_vetoes`.
 */
export async function reviewClaim(brandId, action, opts = {}) {
  const body = { brand_id: brandId, action };
  if (action === "reject") {
    body.rejection_reason = opts.rejectionReason ?? "";
  }
  // Backward-compat (#299 WS7): if a caller still supplies non-empty scoreVetoes
  // on approve, pass them through to the edge wrapper's score_vetoes channel. The
  // current admin UI does NOT send these (see overrideClaimScore + Phase 4 go-live),
  // but admin-review-venue-claim still accepts the field, so we keep the channel.
  if (action === "approve" && opts.scoreVetoes && Object.keys(opts.scoreVetoes).length > 0) {
    body.score_vetoes = opts.scoreVetoes;
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
