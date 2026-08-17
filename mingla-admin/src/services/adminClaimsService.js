/**
 * Ve3 — venue claims queue data + review actions.
 */

import { supabase } from "../lib/supabase";

// META-ORCH-1255(C): the queue lists venue_listings rows (D-4 re-key). The
// parent brand rides the embedded join (RLS: venue_listings + brands both
// carry is_admin_user() SELECT policies — M1 + M6). venue_listings has no
// `description`/`deleted_at` columns; `duplicate_of_venue_id` replaces the
// brand-keyed duplicate pointer.
const CLAIM_SELECT = `
  id,
  brand_id,
  name,
  slug,
  venue_category,
  city,
  country_code,
  address,
  created_at,
  updated_at,
  contact_email,
  contact_phone,
  google_place_id,
  lat,
  lng,
  cover_media_url,
  cover_media_type,
  place_pool_id,
  claim_status,
  marked_called_at,
  claim_follow_up_at,
  duplicate_of_venue_id,
  brand:brand_id (
    id,
    name,
    slug
  ),
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
  ),
  discovery_price:place_discovery_price_ranges!venue_id (
    status,
    source_min_minor,
    source_max_minor,
    source_currency_code,
    source_type,
    version,
    updated_by,
    updated_at
  )
`;

export async function previewPendingVenueIdentityCorrection(venueId) {
  const { data, error } = await supabase.rpc(
    "preview_pending_venue_identity_correction",
    { p_venue_id: venueId },
  );
  if (error) throw error;
  return data;
}

export async function correctPendingVenueIdentity({ preview, name, slug, category, reason, requestId }) {
  const { data, error } = await supabase.rpc("correct_pending_venue_identity", {
    p_venue_id: preview.venue_id,
    p_expected_brand_id: preview.brand_id,
    p_expected_place_pool_id: preview.place_pool_id,
    p_expected_updated_at: preview.current.updated_at,
    p_expected_name: preview.current.name,
    p_expected_slug: preview.current.slug,
    p_expected_category: preview.current.category,
    p_new_name: name.trim(),
    p_new_slug: slug.trim(),
    p_new_category: category,
    p_reason: reason.trim(),
    p_request_id: requestId,
    p_expected_schema_fingerprint: preview.schema_fingerprint,
    p_expected_state_fingerprint: preview.state_fingerprint,
    // [TRANSITIONAL] forward only — see the matching note in
    // mingla-business/src/services/pendingVenueIdentityCorrectionService.web.ts.
    // The RPC supports rollback; no surface invokes it, and an Admin cannot read
    // the audit table to obtain a source audit id either (42501, by design).
    // EXIT CONDITION: Amendments 13-14 ruled the rollback leg out of §D6's
    // surface requirement and recorded it as an RPC-level operator capability
    // with a performable procedure; a user-facing rollback is a new issue, not a
    // reopening of #2099.
    p_mode: "forward",
    p_source_audit_id: null,
  });
  if (error) throw error;
  return data;
}

export async function listPendingClaims() {
  const { data, error } = await supabase
    .from("venue_listings")
    .select(CLAIM_SELECT)
    .eq("claim_status", "pending_review")
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function listVerifiedClaims() {
  const { data, error } = await supabase
    .from("venue_listings")
    .select(CLAIM_SELECT)
    .eq("claim_status", "verified")
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function listRejectedClaims() {
  const { data, error } = await supabase
    .from("venue_listings")
    .select(CLAIM_SELECT)
    .eq("claim_status", "rejected")
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

/**
 * META-ORCH-1062 Q4 — fetch the full claim-review bundle (brand identity +
 * linked place_pool vetting fields + place_scores array) via the admin-gated
 * SECURITY DEFINER RPC. The RPC enforces is_admin_user() server-side; this is
 * the single round-trip the modal uses for photos + scores + missing fields.
 * META-ORCH-1255(C): venue-keyed (the bundle joins the venue_listings row).
 * @param {string} venueId
 */
export async function getClaimReviewBundle(venueId) {
  const { data, error } = await supabase.rpc("admin_get_claim_review_bundle", {
    p_venue_id: venueId,
  });
  if (error) throw error;
  return data ?? null;
}

/**
 * META-ORCH-1062 Phase 1 — tweak whitelisted submitted fields (address /
 * venue_category / price_level / price_tiers) on a pending_review claim. Routed
 * through the admin-review edge wrapper as action:"tweak_fields" so the admin
 * gate + admin_audit_log path is shared with reviews.
 * META-ORCH-1255(C): venue-keyed end-to-end (edge body + RPC).
 * @param {string} venueId
 * @param {{ address?: string, venue_category?: string, price_level?: string, price_tiers?: unknown }} patch
 */
export async function tweakClaimFields(venueId, patch) {
  const { data, error } = await supabase.functions.invoke(
    "admin-review-venue-claim",
    { body: { venue_id: venueId, action: "tweak_fields", patch } },
  );
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * META-ORCH-1062 Q2 — bidirectional admin score override. Writes the deck-
 * ranking place_scores.score (UPSERT, clamped 0–200) + the audit slice. Routed
 * through the edge wrapper as action:"score_override".
 * META-ORCH-1255(C): venue-keyed end-to-end (edge body + RPC).
 * @param {string} venueId
 * @param {string} signalId
 * @param {number} score 0–200
 * @param {string} [reason]
 */
export async function overrideClaimScore(venueId, signalId, score, reason) {
  const { data, error } = await supabase.functions.invoke(
    "admin-review-venue-claim",
    {
      body: {
        venue_id: venueId,
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
 * META-ORCH-1255(C): venue-keyed (D-4 — same states, same transitions, venue row).
 * @param {string} venueId
 * @param {"mark_called"|"approve"|"reject"|"need_more_info"} action
 * @param {{ rejectionReason?: string, scoreVetoes?: Record<string, unknown> }} [opts]
 *   NOTE (META-ORCH-1062 / #299 merge): `scoreVetoes` is the legacy #299 WS7
 *   reduce-only channel. The admin UI no longer sends it on approve (score
 *   editing is now the bidirectional `overrideClaimScore` path, go-live is the
 *   Phase 4 servable→scorer path). The pass-through below is retained ONLY for
 *   backward-compat: admin-review-venue-claim still accepts `score_vetoes`.
 */
export async function reviewClaim(venueId, action, opts = {}) {
  const body = { venue_id: venueId, action };
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
 * ORCH-1064 — admin sends a feedback round on a pending claim. Routed through
 * the admin-review edge wrapper (action:"add_feedback") so the business push +
 * admin_audit_log fire server-side. Each call opens a fresh round and moves the
 * claim to need_more_info (pending_review + claim_follow_up_at stamp).
 * META-ORCH-1255(C): venue-keyed (the stamp lives on the venue row) — the
 * param name is pinned by the append-only ORCH-1064 suite; pass the VENUE id.
 * @param {string} brandId — the venue_listings row id (legacy pinned name)
 * @param {Array<{ category: string, note: string }>} items
 * @param {string|null} [overallMessage]
 * @returns {Promise<{ ok: boolean, round: number, item_count: number, push_sent: boolean }>}
 */
// NOTE (META-ORCH-1255(C)): the first param KEEPS the legacy name `brandId`
// because the append-only ORCH-1064 test pins this exact signature — but the
// VALUE is the venue_listings row id (the queue row id), sent as venue_id.
export async function addClaimFeedback(brandId, items, overallMessage) {
  const venueId = brandId;
  const { data, error } = await supabase.functions.invoke(
    "admin-review-venue-claim",
    {
      body: {
        venue_id: venueId,
        action: "add_feedback",
        items,
        overall_message: overallMessage ?? null,
      },
    },
  );
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * ORCH-1066 — seed all 16 active signals at neutral 100 for a place so an admin
 * can tune a non-servable pending venue from zero ("Score this venue now").
 * Idempotent (ON CONFLICT DO NOTHING server-side). Routed through the edge
 * wrapper (action:"score_place_preview") so the seed is admin-gated + audit-logged.
 * @param {string} placePoolId
 * @returns {Promise<{ ok: boolean, result: { seeded_count: number, existing_count: number, total_signals: number } }>}
 */
export async function scorePlacePreview(placePoolId) {
  const { data, error } = await supabase.functions.invoke(
    "admin-review-venue-claim",
    { body: { action: "score_place_preview", place_pool_id: placePoolId } },
  );
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * ORCH-1066 — place-keyed manual score dial (works for ANY place_pool row,
 * servable or pending). UPSERTs place_scores with the _admin_set sticky marker.
 * @param {string} placePoolId
 * @param {string} signalId
 * @param {number} score 0–200
 * @param {string|null} [reason]
 */
export async function setPlaceSignalScore(placePoolId, signalId, score, reason) {
  const { data, error } = await supabase.functions.invoke(
    "admin-review-venue-claim",
    {
      body: {
        action: "set_place_score",
        place_pool_id: placePoolId,
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
 * ORCH-1066 — pin a place's signal score just above the current local #1 within
 * radius (computed LEAST(200, local_max+1); 200 if the radius is empty). Stamps
 * the _admin_pin sticky marker.
 * @param {string} placePoolId
 * @param {string} signalId
 * @param {number} [radiusM] default 16000
 */
export async function pinPlaceToTop(placePoolId, signalId, radiusM = 16000) {
  const { data, error } = await supabase.functions.invoke(
    "admin-review-venue-claim",
    {
      body: {
        action: "pin_place_score",
        place_pool_id: placePoolId,
        signal_id: signalId,
        radius_m: radiusM,
      },
    },
  );
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * ORCH-1066 — read-only projected deck rank for a (place, signal, radius). Direct
 * SECURITY DEFINER RPC (read-only, no audit needed). Returns
 * { rank, total, score, top_score, is_servable, is_active, projected, gated_reason }.
 * @param {string} placePoolId
 * @param {string} signalId
 * @param {number} [radiusM] default 16000
 */
export async function getPlaceDeckRank(placePoolId, signalId, radiusM = 16000) {
  const { data, error } = await supabase.rpc("admin_place_deck_rank", {
    p_place_pool_id: placePoolId,
    p_signal_id: signalId,
    p_radius_m: radiusM,
  });
  if (error) throw error;
  return data ?? null;
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
