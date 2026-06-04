-- META-ORCH-1062 [venue onboarding → admin vetting → deck pipeline repair]
-- Phase 1 admin-vetting RPCs + Phase 1/Q2 score-override application helper.
--
-- Three SECURITY DEFINER functions, all admin-gated server-side via
-- is_admin_user() (Constitution #2/#10; I-ADMIN-WRITE-GATED). search_path is
-- pinned to 'public','pg_temp' per Supabase hardening guidance:
--   https://supabase.com/docs/guides/database/postgres/row-level-security
--   https://supabase.com/docs/guides/database/functions  (SECURITY DEFINER + search_path)
--
-- 1. admin_get_claim_review_bundle(p_brand_id) — Q4 LOCKED single-round-trip
--    read for the admin claim modal: brand identity + linked place_pool vetting
--    fields + the place_scores array, as one JSON bundle. Admin-gated inside the
--    definer fn (so RLS on place_scores/place_pool is never loosened).
--
-- 2. admin_tweak_venue_claim_fields(p_brand_id, p_patch) — Phase 1 field tweak
--    (address / venue_category / price_level / price_tiers), whitelisted keys,
--    pending_review only. Writes brands + place_pool. category→types remap only
--    for business_authored rows (never overwrite a real Google place's types).
--
-- 3. admin_apply_score_override(p_brand_id, p_signal_id, p_score, p_reason) —
--    Q2 LOCKED bidirectional admin score override. Writes BOTH the audit slice
--    on place_pool.ai_signal_scores_veto AND the deck-ranking place_scores.score
--    (clamped 0–200). place_scores.score IS the rank key, so this is a REAL
--    override that moves deck rank up OR down. Admin can raise above the
--    computed score (operator-locked: admins may bump a deserving venue UP).
--
-- All additive (CREATE OR REPLACE) — no table mutation at migration time, so no
-- abort-on-existing-rows risk; no data probe required for the DDL itself
-- (probe of fetched_via distribution recorded in the implementation report:
-- all 3 claimed rows are business_authored).
--
-- Migration version 20260831000000 is strictly greater than remote max
-- (20260829000000) and all sibling-worktree maxes (20260829000000). The Sub-F
-- migration (20260813000000) reconciled in Phase 0 is already-applied on remote.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. admin_get_claim_review_bundle — Q4 admin-gated bundle read
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_claim_review_bundle(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand   public.brands%ROWTYPE;
  v_pp      public.place_pool%ROWTYPE;
  v_scores  jsonb;
  v_has_pp  boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO v_brand
  FROM public.brands b
  WHERE b.id = p_brand_id AND b.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  IF v_brand.place_pool_id IS NOT NULL THEN
    SELECT * INTO v_pp FROM public.place_pool pp WHERE pp.id = v_brand.place_pool_id;
    v_has_pp := FOUND;
  END IF;

  IF v_has_pp THEN
    SELECT coalesce(jsonb_agg(
             jsonb_build_object(
               'signal_id', ps.signal_id,
               'score', ps.score,
               'scored_at', ps.scored_at
             ) ORDER BY ps.score DESC
           ), '[]'::jsonb)
    INTO v_scores
    FROM public.place_scores ps
    WHERE ps.place_id = v_pp.id;
  ELSE
    v_scores := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'brand', jsonb_build_object(
      'id', v_brand.id,
      'name', v_brand.name,
      'slug', v_brand.slug,
      'claim_status', v_brand.claim_status,
      'venue_category', v_brand.venue_category,
      'address', v_brand.address,
      'cover_media_url', v_brand.cover_media_url,
      'contact_email', v_brand.contact_email,
      'google_place_id', v_brand.google_place_id,
      'description', v_brand.description,
      'lat', v_brand.lat,
      'lng', v_brand.lng,
      'place_pool_id', v_brand.place_pool_id
    ),
    'place_pool', CASE WHEN v_has_pp THEN jsonb_build_object(
      'id', v_pp.id,
      'is_active', v_pp.is_active,
      'is_servable', v_pp.is_servable,
      'bouncer_reason', v_pp.bouncer_reason,
      'bouncer_validated_at', v_pp.bouncer_validated_at,
      'stored_photo_urls', to_jsonb(v_pp.stored_photo_urls),
      'business_gallery_urls', to_jsonb(v_pp.business_gallery_urls),
      'photo_aesthetic_data', v_pp.photo_aesthetic_data,
      'price_level', v_pp.price_level,
      'price_tiers', to_jsonb(v_pp.price_tiers),
      'website', v_pp.website,
      'rating', v_pp.rating,
      'review_count', v_pp.review_count,
      'ai_signal_scores', v_pp.ai_signal_scores,
      'ai_signal_scores_veto', v_pp.ai_signal_scores_veto,
      'business_authoring_status', v_pp.business_authoring_status,
      'business_authoring_inputs', v_pp.business_authoring_inputs,
      'fetched_via', v_pp.fetched_via,
      'national_phone_number', v_pp.national_phone_number,
      'google_maps_uri', v_pp.google_maps_uri,
      'serves_dinner', v_pp.serves_dinner,
      'serves_lunch', v_pp.serves_lunch,
      'serves_wine', v_pp.serves_wine,
      'serves_cocktails', v_pp.serves_cocktails,
      'outdoor_seating', v_pp.outdoor_seating,
      'good_for_groups', v_pp.good_for_groups,
      'good_for_children', v_pp.good_for_children,
      'live_music', v_pp.live_music,
      'reservable', v_pp.reservable,
      'allows_dogs', v_pp.allows_dogs
    ) ELSE NULL END,
    'scores', v_scores
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_claim_review_bundle(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_claim_review_bundle(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_get_claim_review_bundle(uuid) IS
  'META-ORCH-1062 Q4 — admin-gated (is_admin_user) single-round-trip claim-review '
  'bundle: brand identity + linked place_pool vetting fields + place_scores array.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. admin_tweak_venue_claim_fields — Phase 1 whitelisted field tweak
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_tweak_venue_claim_fields(
  p_brand_id uuid,
  p_patch    jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand        public.brands%ROWTYPE;
  v_pp_id        uuid;
  v_fetched_via  text;
  v_key          text;
  v_address      text;
  v_category     text;
  v_price_level  text;
  v_price_tiers  jsonb;
  v_applied      jsonb := '{}'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'invalid_patch';
  END IF;

  -- Whitelist EXACTLY these keys; any other key is a hard reject.
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key NOT IN ('address', 'venue_category', 'price_level', 'price_tiers') THEN
      RAISE EXCEPTION 'invalid_patch_key';
    END IF;
  END LOOP;

  SELECT * INTO v_brand
  FROM public.brands b
  WHERE b.id = p_brand_id AND b.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  -- Pending-only: never rewrite a live (verified) or rejected venue's data.
  IF v_brand.claim_status <> 'pending_review' THEN
    RAISE EXCEPTION 'brand_not_pending_review';
  END IF;

  v_pp_id := v_brand.place_pool_id;
  IF v_pp_id IS NOT NULL THEN
    SELECT fetched_via INTO v_fetched_via FROM public.place_pool WHERE id = v_pp_id;
  END IF;

  -- address → brands.address AND place_pool.address
  IF p_patch ? 'address' THEN
    v_address := nullif(trim(p_patch->>'address'), '');
    UPDATE public.brands SET address = v_address WHERE id = p_brand_id;
    IF v_pp_id IS NOT NULL THEN
      UPDATE public.place_pool SET address = v_address WHERE id = v_pp_id;
    END IF;
    v_applied := v_applied || jsonb_build_object('address', v_address);
  END IF;

  -- venue_category → brands.venue_category. types remap is deferred to the
  -- business-authored case only; we never overwrite a real Google place's
  -- types via this path (all current claimed rows are business_authored, but
  -- the guard stays for future Google-claim rows).
  IF p_patch ? 'venue_category' THEN
    v_category := nullif(trim(p_patch->>'venue_category'), '');
    UPDATE public.brands SET venue_category = v_category WHERE id = p_brand_id;
    v_applied := v_applied || jsonb_build_object('venue_category', v_category);
  END IF;

  -- price_level → place_pool.price_level
  IF p_patch ? 'price_level' THEN
    v_price_level := nullif(trim(p_patch->>'price_level'), '');
    IF v_pp_id IS NOT NULL THEN
      UPDATE public.place_pool SET price_level = v_price_level WHERE id = v_pp_id;
    END IF;
    v_applied := v_applied || jsonb_build_object('price_level', v_price_level);
  END IF;

  -- price_tiers → place_pool.price_tiers (jsonb array passthrough)
  IF p_patch ? 'price_tiers' THEN
    v_price_tiers := p_patch->'price_tiers';
    IF v_pp_id IS NOT NULL THEN
      UPDATE public.place_pool SET price_tiers = v_price_tiers WHERE id = v_pp_id;
    END IF;
    v_applied := v_applied || jsonb_build_object('price_tiers', v_price_tiers);
  END IF;

  RETURN jsonb_build_object('ok', true, 'applied', v_applied, 'fetched_via', v_fetched_via);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_tweak_venue_claim_fields(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_tweak_venue_claim_fields(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.admin_tweak_venue_claim_fields(uuid, jsonb) IS
  'META-ORCH-1062 Phase 1 — admin-gated whitelisted (address/venue_category/'
  'price_level/price_tiers) tweak of a pending_review venue claim; writes brands '
  '+ place_pool. Non-whitelisted key → invalid_patch_key; non-pending → '
  'brand_not_pending_review.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. admin_apply_score_override — Q2 bidirectional admin score override
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_apply_score_override(
  p_brand_id  uuid,
  p_signal_id text,
  p_score     numeric,
  p_reason    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand     public.brands%ROWTYPE;
  v_pp_id     uuid;
  v_original  numeric;
  v_version   uuid;
  v_now       timestamptz := now();
  v_veto      jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_signal_id IS NULL OR length(trim(p_signal_id)) = 0 THEN
    RAISE EXCEPTION 'signal_id_required';
  END IF;
  IF p_score IS NULL THEN
    RAISE EXCEPTION 'score_required';
  END IF;
  -- Clamp to the place_scores CHECK range (0–200). Reject out-of-range rather
  -- than silently clamping so the admin sees a clear error.
  IF p_score < 0 OR p_score > 200 THEN
    RAISE EXCEPTION 'score_out_of_range';
  END IF;

  SELECT * INTO v_brand FROM public.brands b
  WHERE b.id = p_brand_id AND b.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;
  v_pp_id := v_brand.place_pool_id;
  IF v_pp_id IS NULL THEN
    RAISE EXCEPTION 'no_linked_place';
  END IF;

  -- Validate signal exists + is active (so override targets a real deck signal).
  IF NOT EXISTS (SELECT 1 FROM public.signal_definitions sd
                 WHERE sd.id = p_signal_id AND sd.is_active = true) THEN
    RAISE EXCEPTION 'unknown_or_inactive_signal';
  END IF;

  -- Current computed score for this (place, signal), if any (audit "original").
  SELECT ps.score, ps.signal_version_id
  INTO v_original, v_version
  FROM public.place_scores ps
  WHERE ps.place_id = v_pp_id AND ps.signal_id = p_signal_id;

  -- Persist the audit slice on place_pool.ai_signal_scores_veto.
  v_veto := coalesce((SELECT pp.ai_signal_scores_veto FROM public.place_pool pp WHERE pp.id = v_pp_id), '{}'::jsonb);
  v_veto := v_veto || jsonb_build_object(
    p_signal_id, jsonb_build_object(
      'vetoed_score', p_score,
      'original_score', v_original,
      'reason', nullif(trim(coalesce(p_reason, '')), ''),
      'vetoed_at', v_now,
      'vetoed_by', auth.uid()
    )
  );
  UPDATE public.place_pool SET ai_signal_scores_veto = v_veto WHERE id = v_pp_id;

  -- Apply the REAL override to the deck-ranking place_scores.score. UPSERT so an
  -- override can create a deck-qualifying row even if the scorer produced none
  -- (operator-locked: admins may bump a deserving venue UP). signal_version_id
  -- falls back to the signal's current_version_id when no prior score row exists.
  IF v_version IS NULL THEN
    SELECT sd.current_version_id INTO v_version
    FROM public.signal_definitions sd WHERE sd.id = p_signal_id;
  END IF;

  INSERT INTO public.place_scores (place_id, signal_id, score, contributions, signal_version_id, scored_at)
  VALUES (
    v_pp_id, p_signal_id, p_score,
    jsonb_build_object('_admin_override', 1, '_original_score', v_original,
                       '_overridden_by', auth.uid(), '_reason', nullif(trim(coalesce(p_reason, '')), '')),
    v_version, v_now
  )
  ON CONFLICT (place_id, signal_id) DO UPDATE
    SET score = EXCLUDED.score,
        contributions = public.place_scores.contributions || EXCLUDED.contributions,
        scored_at = EXCLUDED.scored_at;

  RETURN jsonb_build_object(
    'ok', true,
    'signal_id', p_signal_id,
    'original_score', v_original,
    'new_score', p_score,
    'direction', CASE
      WHEN v_original IS NULL THEN 'created'
      WHEN p_score > v_original THEN 'raised'
      WHEN p_score < v_original THEN 'lowered'
      ELSE 'unchanged' END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_apply_score_override(uuid, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_apply_score_override(uuid, text, numeric, text) TO authenticated;

COMMENT ON FUNCTION public.admin_apply_score_override(uuid, text, numeric, text) IS
  'META-ORCH-1062 Q2 — admin-gated BIDIRECTIONAL score override. Clamps 0–200, '
  'audit-logs the prior score on place_pool.ai_signal_scores_veto, and writes the '
  'deck-ranking place_scores.score (UPSERT). Admins may raise OR lower; this '
  'affects deck rank (place_scores.score is the rank key).';
