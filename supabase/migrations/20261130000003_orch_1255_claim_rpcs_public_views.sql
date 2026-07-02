-- ===========================================================================
-- META-ORCH-1255 [multi-venue first-class creation] — M4: create/review RPCs,
-- public read model, consumer resolvers, hidden-brand decommission
-- ---------------------------------------------------------------------------
-- SPEC §4.A.5 (binding, commit b236bfaf9). Seth decisions D-1 (per-venue rows
-- under ONE brand; hidden-brand creation DECOMMISSIONED), D-2 (per-venue public
-- pages under the brand slug), D-4 (admin approval state machine UNCHANGED,
-- re-keyed to the venue row).
--
-- Contents:
--   1. biz_create_venue_listing — the venue create RPC (replaces the
--      hidden-brand path; NO INSERT INTO brands, EVER —
--      I-PROPOSED-1255-NO-HIDDEN-BRAND-ON-VENUE-CREATE).
--   2. Review RPCs re-keyed p_brand_id → p_venue_id with the D-4 machine
--      byte-identical (old signatures DROPped — identical arg types force
--      DROP+CREATE; PostgREST named-arg calls would otherwise be ambiguous):
--      biz_review_venue_claim, admin_get_claim_review_bundle,
--      admin_add_venue_claim_feedback, biz_resubmit_venue_claim.
--      biz_mark_feedback_item_fixed is UNCHANGED (row-keyed; ownership already
--      via the row's brand_id rank).
--      admin_suspend_listing / admin_soft_delete_listing / admin_restore_listing
--      keep their place-keyed signatures; bodies resolve the VENUE row instead
--      of the brand row (inventory #14).
--   3. venue_public_view — SECURITY DEFINER public read model (house precedent
--      claimed_venues_public_view + the 20260731000000 definer ruling: anon
--      reads only the view's scoped public-safe output, never venue_listings
--      or brands directly). I-PROPOSED-1255-PUBLIC-VENUE-PAGE-ANON-SAFE.
--   4. Consumer resolvers re-keyed (F-7): pg_brand_experiences_for_place +
--      pg_venue_reservable_for_place (additive venue_id column).
--   5. Decommissions: biz_create_venue_brand_authoring → fail-soft stub
--      (old binaries in the field get the wizard's sanitized generic error);
--      DROP dead biz_create_venue_brand_pending_review; place_pool RLS
--      predicates re-keyed brands → venue_listings (R-2).
--
-- [TRANSITIONAL-2] claimed_venues_public_view (brands-based) is KEPT UNCHANGED
-- — it now permanently returns 0 rows (no brand will ever be
-- claim_status='verified' again: the only writer path is decommissioned) so
-- old shipped binaries' /b/{slug} overlay degrades gracefully to the plain
-- brand page. Exit condition: drop the view after the next business+consumer
-- native builds supersede shipped binaries.
--
-- Apply via the Supabase Management API from MERGED main at CLOSE.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. biz_create_venue_listing — replaces the hidden-brand path (D-1).
--    Body mirrors biz_create_venue_brand_authoring (1186-A, 20261116000000)
--    VERBATIM except the brand insert: validation, hours loop, pipeline
--    upsert, and the hours→service-periods bridge are preserved shape-for-
--    shape, re-keyed to the venue row.
--    NOTE p_description: accepted for signature parity with the old RPC; the
--    venue row intentionally carries NO description column (SPEC M1 DDL) —
--    the description flows to place_pool.generative_summary via the tier-1
--    pipeline draft, exactly as before.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_create_venue_listing (
  p_brand_id uuid,
  p_name text,
  p_slug text,
  p_description text,
  p_google_place_id text,
  p_lat double precision,
  p_lng double precision,
  p_city text,
  p_country_code text,
  p_address text,
  p_venue_category text,
  p_contact_email text,
  p_contact_phone text,
  p_cover_media_url text,
  p_cover_media_type text,
  p_hours jsonb,
  p_place_pool_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_venue_id uuid;
  v_idx int;
  v_hour jsonb;
  v_cover_url text;
  v_cover_type text;
  v_google text;
  v_pool_google text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- D-1 ownership: the venue attaches to an EXISTING brand the caller owns.
  -- A member of another brand cannot attach venues to brands they don't own.
  IF NOT EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = p_brand_id AND b.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;
  IF public.biz_brand_effective_rank_for_caller(p_brand_id)
       < public.biz_role_rank('brand_owner') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Input validation IDENTICAL to biz_create_venue_brand_authoring
  -- (1186-A lines 176–231).
  IF length(trim(coalesce(p_name, ''))) = 0 THEN
    RAISE EXCEPTION 'name_required';
  END IF;

  IF length(trim(coalesce(p_slug, ''))) = 0 THEN
    RAISE EXCEPTION 'slug_required';
  END IF;

  IF trim(p_slug) !~ '^[a-z0-9]{1,32}$' THEN
    RAISE EXCEPTION 'invalid_slug';
  END IF;

  IF p_lat IS NULL OR p_lng IS NULL THEN
    RAISE EXCEPTION 'location_required';
  END IF;

  IF p_hours IS NULL OR jsonb_typeof(p_hours) != 'array' OR jsonb_array_length(p_hours) != 7 THEN
    RAISE EXCEPTION 'hours_must_have_7_rows';
  END IF;

  IF p_venue_category IS NULL OR p_venue_category NOT IN ('restaurant', 'play', 'creative_and_arts') THEN
    RAISE EXCEPTION 'invalid_venue_category';
  END IF;

  v_google := nullif(trim(coalesce(p_google_place_id, '')), '');

  IF p_place_pool_id IS NOT NULL THEN
    SELECT p.google_place_id
    INTO v_pool_google
    FROM public.place_pool p
    WHERE p.id = p_place_pool_id
      AND p.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'place_pool_not_found';
    END IF;

    IF v_google IS NULL OR trim(v_pool_google) IS DISTINCT FROM v_google THEN
      RAISE EXCEPTION 'place_pool_google_place_id_mismatch';
    END IF;
  END IF;

  v_cover_url := nullif(trim(coalesce(p_cover_media_url, '')), '');
  v_cover_type := nullif(trim(coalesce(p_cover_media_type, '')), '');

  IF v_cover_type IS NOT NULL AND v_cover_type NOT IN ('image', 'video', 'gif') THEN
    RAISE EXCEPTION 'invalid_cover_media_type';
  END IF;

  IF v_cover_url IS NOT NULL AND v_cover_type IS NULL THEN
    RAISE EXCEPTION 'cover_media_type_required';
  END IF;

  IF v_cover_url IS NULL THEN
    v_cover_type := NULL;
  END IF;

  -- The venue row. NO brands-table insert. Ever.
  -- (I-PROPOSED-1255-NO-HIDDEN-BRAND-ON-VENUE-CREATE — the SQL test
  -- orch_1255_no_hidden_brand.test.sql asserts brands delta = 0 and that this
  -- function's body carries no brands-table insert statement.)
  -- Slug collisions surface as unique_violation on (brand_id, slug) → the
  -- client maps 23505 to SlugCollisionError; duplicate place claims are
  -- blocked by venue_listings_place_uniq (23505 → "already in our
  -- verification queue" client copy, existing shape).
  INSERT INTO public.venue_listings (
    brand_id,
    name,
    slug,
    address,
    google_place_id,
    place_pool_id,
    lat,
    lng,
    city,
    country_code,
    venue_category,
    contact_email,
    contact_phone,
    cover_media_url,
    cover_media_type,
    claim_status
  )
  VALUES (
    p_brand_id,
    trim(p_name),
    trim(p_slug),
    nullif(trim(coalesce(p_address, '')), ''),
    v_google,
    p_place_pool_id,
    p_lat,
    p_lng,
    nullif(trim(coalesce(p_city, '')), ''),
    nullif(trim(coalesce(p_country_code, '')), ''),
    p_venue_category,
    nullif(trim(coalesce(p_contact_email, '')), ''),
    nullif(trim(coalesce(p_contact_phone, '')), ''),
    v_cover_url,
    v_cover_type,
    'pending_review'
  )
  RETURNING id INTO v_venue_id;

  -- 7 hours rows, venue-keyed (1186-A loop shape verbatim).
  FOR v_idx IN 0 .. 6 LOOP
    v_hour := p_hours -> v_idx;
    IF v_hour IS NULL THEN
      RAISE EXCEPTION 'missing_hour_index_%', v_idx;
    END IF;

    INSERT INTO public.brand_hours (
      brand_id,
      venue_id,
      weekday,
      open_time,
      close_time,
      is_closed
    )
    VALUES (
      p_brand_id,
      v_venue_id,
      (v_hour ->> 'weekday')::smallint,
      CASE
        WHEN coalesce((v_hour ->> 'is_closed')::boolean, false) THEN NULL
        WHEN v_hour ->> 'open_time' IS NULL OR (v_hour ->> 'open_time') = '' THEN NULL
        ELSE (v_hour ->> 'open_time')::time
      END,
      CASE
        WHEN coalesce((v_hour ->> 'is_closed')::boolean, false) THEN NULL
        WHEN v_hour ->> 'close_time' IS NULL OR (v_hour ->> 'close_time') = '' THEN NULL
        ELSE (v_hour ->> 'close_time')::time
      END,
      coalesce((v_hour ->> 'is_closed')::boolean, false)
    );
  END LOOP;

  -- Pipeline row PER VENUE (merge shape as 1186-A lines 319–339, conflict
  -- target moved to the M2 venue-unique — R-1 structurally dead).
  INSERT INTO public.brand_place_pipeline_state (
    brand_id,
    venue_id,
    place_pool_id,
    status,
    stage_status,
    readiness,
    coaching
  )
  VALUES (
    p_brand_id,
    v_venue_id,
    p_place_pool_id,
    'draft',
    jsonb_build_object('tier1', 'created'),
    '{}'::jsonb,
    '[]'::jsonb
  )
  ON CONFLICT (venue_id) DO UPDATE
  SET place_pool_id = excluded.place_pool_id,
      status = excluded.status,
      stage_status = brand_place_pipeline_state.stage_status || excluded.stage_status,
      updated_at = now();

  -- ORCH-1186-A live bridge, venue-keyed: seed the reservation baseline
  -- service periods from the just-written hours. Non-clobber + idempotent.
  PERFORM public.biz_derive_service_periods_from_brand_hours(v_venue_id);

  RETURN v_venue_id;
END;
$$;

REVOKE ALL ON FUNCTION public.biz_create_venue_listing (uuid, text, text, text, text, double precision, double precision, text, text, text, text, text, text, text, text, jsonb, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.biz_create_venue_listing (uuid, text, text, text, text, double precision, double precision, text, text, text, text, text, text, text, text, jsonb, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_create_venue_listing (uuid, text, text, text, text, double precision, double precision, text, text, text, text, text, text, text, text, jsonb, uuid) TO authenticated;

COMMENT ON FUNCTION public.biz_create_venue_listing IS
  'META-ORCH-1255 M4 (D-1): creates a venue_listings row (pending_review) + 7 '
  'venue-keyed brand_hours rows + a per-venue pipeline row + the derived '
  'service-period baseline, under an EXISTING brand the caller owns (rank >= '
  'brand_owner). NEVER inserts a brands row '
  '(I-PROPOSED-1255-NO-HIDDEN-BRAND-ON-VENUE-CREATE).';

-- ---------------------------------------------------------------------------
-- 2a. biz_review_venue_claim — venue-keyed (re-stated from 20260729000000
--     lines 698+; D-4: mark_called/approve/reject/need_more_info transitions
--     byte-identical, on the venue row). NOTE: the venue row has no
--     verified_at/verified_by columns (SPEC M1 DDL) — those two stamps were
--     brand-row bookkeeping and are dropped; every state/stamp the machine
--     READS is preserved. Old brand-keyed signature DROPped.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.biz_review_venue_claim(uuid, text, text);

CREATE OR REPLACE FUNCTION public.biz_review_venue_claim (
  p_venue_id uuid,
  p_action text,
  p_rejection_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_dup_count integer := 0;
  v_reason text;
BEGIN
  IF auth.uid () IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.is_admin_user () THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_action NOT IN ('mark_called', 'approve', 'reject', 'need_more_info') THEN
    RAISE EXCEPTION 'invalid_action';
  END IF;

  SELECT *
  INTO v_venue
  FROM public.venue_listings v
  WHERE v.id = p_venue_id
    AND v.claim_status IN ('pending_review','verified','rejected');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found';
  END IF;

  IF p_action = 'mark_called' THEN
    IF v_venue.claim_status <> 'pending_review' THEN
      IF v_venue.marked_called_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'noop', true);
      END IF;
      RAISE EXCEPTION 'venue_not_pending_review';
    END IF;

    IF v_venue.marked_called_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'noop', true);
    END IF;

    UPDATE public.venue_listings
    SET
      marked_called_at = now(),
      marked_called_by = auth.uid()
    WHERE id = p_venue_id;

    RETURN jsonb_build_object('ok', true, 'action', 'mark_called');
  END IF;

  IF p_action = 'need_more_info' THEN
    IF v_venue.claim_status <> 'pending_review' THEN
      RAISE EXCEPTION 'venue_not_pending_review';
    END IF;

    UPDATE public.venue_listings
    SET claim_follow_up_at = now()
    WHERE id = p_venue_id;

    RETURN jsonb_build_object('ok', true, 'action', 'need_more_info');
  END IF;

  IF p_action = 'approve' THEN
    IF v_venue.claim_status = 'verified' THEN
      RETURN jsonb_build_object('ok', true, 'noop', true, 'claim_status', 'verified');
    END IF;

    IF v_venue.claim_status <> 'pending_review' THEN
      RAISE EXCEPTION 'venue_not_pending_review';
    END IF;

    IF v_venue.marked_called_at IS NULL THEN
      RAISE EXCEPTION 'must_mark_called_first';
    END IF;

    -- Duplicate-claim guard, venue-keyed: the same google place verified on
    -- ANOTHER venue row anywhere blocks the approve.
    IF v_venue.google_place_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.venue_listings v2
      WHERE v2.id <> p_venue_id
        AND v2.google_place_id = v_venue.google_place_id
        AND v2.claim_status = 'verified'
    ) THEN
      RAISE EXCEPTION 'google_place_already_verified';
    END IF;

    UPDATE public.venue_listings
    SET
      claim_status = 'verified',
      rejection_reason = NULL,
      claim_follow_up_at = NULL,
      duplicate_of_venue_id = NULL
    WHERE id = p_venue_id;

    IF v_venue.google_place_id IS NOT NULL THEN
      UPDATE public.venue_listings
      SET duplicate_of_venue_id = p_venue_id
      WHERE id <> p_venue_id
        AND google_place_id = v_venue.google_place_id
        AND claim_status = 'pending_review'
        AND duplicate_of_venue_id IS DISTINCT FROM p_venue_id;

      GET DIAGNOSTICS v_dup_count = ROW_COUNT;
    END IF;

    RETURN jsonb_build_object(
      'ok',
      true,
      'action',
      'approve',
      'claim_status',
      'verified',
      'duplicate_flagged_count',
      v_dup_count
    );
  END IF;

  IF v_venue.claim_status = 'rejected' THEN
    RETURN jsonb_build_object('ok', true, 'noop', true, 'claim_status', 'rejected');
  END IF;

  IF v_venue.claim_status <> 'pending_review' THEN
    RAISE EXCEPTION 'venue_not_pending_review';
  END IF;

  v_reason := nullif(trim(coalesce(p_rejection_reason, '')), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'rejection_reason_required';
  END IF;

  UPDATE public.venue_listings
  SET
    claim_status = 'rejected',
    rejection_reason = v_reason,
    claim_follow_up_at = NULL,
    duplicate_of_venue_id = NULL
  WHERE id = p_venue_id;

  RETURN jsonb_build_object(
    'ok',
    true,
    'action',
    'reject',
    'claim_status',
    'rejected'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.biz_review_venue_claim(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.biz_review_venue_claim(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_review_venue_claim(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2b. admin_get_claim_review_bundle — venue-keyed (re-stated from
--     20260901000000 line 297). The bundle joins venue_listings + its
--     place_pool + the venue's active feedback round. Top-level keys:
--     'venue' (the venue row + parent brand identity), 'brand' (parent brand
--     minimal), 'place_pool', 'scores', 'feedback' — Leg C's
--     adminClaimsService binds to this shape.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_get_claim_review_bundle(uuid);

CREATE OR REPLACE FUNCTION public.admin_get_claim_review_bundle(p_venue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_venue    public.venue_listings%ROWTYPE;
  v_brand    public.brands%ROWTYPE;
  v_pp       public.place_pool%ROWTYPE;
  v_scores   jsonb;
  v_feedback jsonb;
  v_has_pp   boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO v_venue
  FROM public.venue_listings v
  WHERE v.id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found';
  END IF;

  SELECT * INTO v_brand
  FROM public.brands b
  WHERE b.id = v_venue.brand_id AND b.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  IF v_venue.place_pool_id IS NOT NULL THEN
    SELECT * INTO v_pp FROM public.place_pool pp WHERE pp.id = v_venue.place_pool_id;
    v_has_pp := found;
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

  -- The active (max) round's feedback items, PER VENUE.
  SELECT coalesce(jsonb_agg(
           jsonb_build_object(
             'id', f.id,
             'round', f.round,
             'category', f.category,
             'note', f.note,
             'overall_message', f.overall_message,
             'status', f.status,
             'created_at', f.created_at,
             'resolved_at', f.resolved_at
           ) ORDER BY f.category, f.created_at
         ), '[]'::jsonb)
  INTO v_feedback
  FROM public.venue_claim_feedback f
  WHERE f.venue_id = p_venue_id
    AND f.round = (
      SELECT max(f2.round) FROM public.venue_claim_feedback f2 WHERE f2.venue_id = p_venue_id
    );

  RETURN jsonb_build_object(
    'venue', jsonb_build_object(
      'id', v_venue.id,
      'name', v_venue.name,
      'slug', v_venue.slug,
      'claim_status', v_venue.claim_status,
      'venue_category', v_venue.venue_category,
      'address', v_venue.address,
      'city', v_venue.city,
      'country_code', v_venue.country_code,
      'cover_media_url', v_venue.cover_media_url,
      'contact_email', v_venue.contact_email,
      'contact_phone', v_venue.contact_phone,
      'google_place_id', v_venue.google_place_id,
      'lat', v_venue.lat,
      'lng', v_venue.lng,
      'place_pool_id', v_venue.place_pool_id,
      'claim_follow_up_at', v_venue.claim_follow_up_at,
      'marked_called_at', v_venue.marked_called_at,
      'rejection_reason', v_venue.rejection_reason,
      'brand_id', v_brand.id,
      'brand_name', v_brand.name,
      'brand_slug', v_brand.slug
    ),
    'brand', jsonb_build_object(
      'id', v_brand.id,
      'name', v_brand.name,
      'slug', v_brand.slug,
      'description', v_brand.description
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
    'scores', v_scores,
    'feedback', v_feedback
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_claim_review_bundle(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_claim_review_bundle(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2c. admin_add_venue_claim_feedback — venue-keyed (re-stated from
--     20260901000000 line 106 / the 20260909000000 semantics). Feedback rows
--     carry (brand_id, venue_id, place_pool_id); rounds are PER VENUE; the
--     follow-up stamp lands on the VENUE row
--     (I-1064-FEEDBACK-IMPLIES-FOLLOWUP preserved).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_add_venue_claim_feedback(uuid, jsonb, text);

CREATE OR REPLACE FUNCTION public.admin_add_venue_claim_feedback(
  p_venue_id        uuid,
  p_items           jsonb,    -- [{ "category": "...", "note": "..." }, ...]
  p_overall_message text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_venue   public.venue_listings%ROWTYPE;
  v_round   integer;
  v_item    jsonb;
  v_cat     text;
  v_note    text;
  v_first   boolean := true;
  v_count   integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'items_required';
  END IF;

  SELECT * INTO v_venue FROM public.venue_listings v
   WHERE v.id = p_venue_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'venue_not_found'; END IF;
  -- Feedback is only meaningful on a claim awaiting review.
  IF v_venue.claim_status <> 'pending_review' THEN
    RAISE EXCEPTION 'venue_not_pending_review';
  END IF;

  -- Next round = max existing + 1 (1 if none), PER VENUE. Prior rounds kept.
  SELECT coalesce(max(round), 0) + 1 INTO v_round
    FROM public.venue_claim_feedback WHERE venue_id = p_venue_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_cat  := nullif(trim(v_item->>'category'), '');
    v_note := nullif(trim(v_item->>'note'), '');
    IF v_cat IS NULL OR v_cat NOT IN
       ('photos','address','hours','category','description','quality','other') THEN
      RAISE EXCEPTION 'invalid_category';
    END IF;
    IF v_note IS NULL THEN RAISE EXCEPTION 'note_required'; END IF;

    INSERT INTO public.venue_claim_feedback
      (brand_id, venue_id, place_pool_id, round, category, note, overall_message, created_by)
    VALUES
      (v_venue.brand_id, p_venue_id, v_venue.place_pool_id, v_round, v_cat, v_note,
       CASE WHEN v_first THEN nullif(trim(coalesce(p_overall_message,'')),'') ELSE NULL END,
       auth.uid());
    v_first := false;
    v_count := v_count + 1;
  END LOOP;

  -- Move the claim to need_more_info (stamps the VENUE row).
  UPDATE public.venue_listings
     SET claim_follow_up_at = now()
   WHERE id = p_venue_id;

  RETURN jsonb_build_object('ok', true, 'round', v_round, 'item_count', v_count);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_add_venue_claim_feedback(uuid, jsonb, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_add_venue_claim_feedback(uuid, jsonb, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2d. biz_resubmit_venue_claim — venue-keyed (re-stated from 20260909000000
--     line 267: the SUSPENDED-inclusive gate). Rank >= brand_owner on the
--     DERIVED brand_id; clears the stamp; back to pending_review.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.biz_resubmit_venue_claim(uuid);

CREATE OR REPLACE FUNCTION public.biz_resubmit_venue_claim(p_venue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_venue        public.venue_listings%ROWTYPE;
  v_active_round integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_venue FROM public.venue_listings v
   WHERE v.id = p_venue_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'venue_not_found'; END IF;

  IF public.biz_brand_effective_rank_for_caller(v_venue.brand_id)
       < public.biz_role_rank('brand_owner') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Awaiting business action = need-more-info (pending_review + stamp) OR suspended.
  IF v_venue.claim_status NOT IN ('pending_review','suspended')
     OR v_venue.claim_follow_up_at IS NULL THEN
    RAISE EXCEPTION 'not_awaiting_resubmit';
  END IF;

  SELECT max(round) INTO v_active_round
    FROM public.venue_claim_feedback WHERE venue_id = p_venue_id;
  IF v_active_round IS NULL THEN
    RAISE EXCEPTION 'no_feedback_to_resubmit';
  END IF;

  -- Back to a clean pending_review for re-review (history preserved).
  UPDATE public.venue_listings
     SET claim_status = 'pending_review', claim_follow_up_at = NULL
   WHERE id = p_venue_id;

  RETURN jsonb_build_object(
    'ok', true,
    'venue_id', p_venue_id,
    'resubmitted_round', v_active_round,
    'claim_status', 'pending_review'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.biz_resubmit_venue_claim(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.biz_resubmit_venue_claim(uuid) TO authenticated;

-- biz_mark_feedback_item_fixed — UNCHANGED (row-keyed by feedback id;
-- ownership already enforced via the row's brand_id rank, which survives M2).

-- ---------------------------------------------------------------------------
-- 2e. admin_suspend_listing — place-keyed signature UNCHANGED; the claimed-
--     listing resolution moves brands → venue_listings (inventory #14:
--     `brands.place_pool_id … limit 1` → the venue row; venue_listings_place_uniq
--     guarantees at most one). Suspends the VENUE row; feedback round + owner
--     notify preserved (owners resolved via the venue's brand team).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_suspend_listing(
  p_place_id        uuid,
  p_overall_message text DEFAULT NULL,
  p_items           jsonb DEFAULT '[]'::jsonb,
  p_reason          text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  v_venue    public.venue_listings%ROWTYPE;
  v_round    integer;
  v_item     jsonb;
  v_cat      text;
  v_note     text;
  v_first    boolean := true;
  v_count    integer := 0;
  v_uid      uuid;
  v_notified integer := 0;
  v_msg      text := nullif(trim(coalesce(p_overall_message,'')),'');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- Take it off the deck (is_active gate). deleted rows cannot be suspended.
  UPDATE public.place_pool SET is_active = false
   WHERE id = p_place_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'place_not_found_or_deleted'; END IF;

  -- Claimed (verified) VENUE → suspend it + drive the business banner/to-dos.
  SELECT * INTO v_venue
    FROM public.venue_listings
   WHERE place_pool_id = p_place_id AND claim_status = 'verified'
   LIMIT 1;

  IF FOUND THEN
    UPDATE public.venue_listings
       SET claim_status = 'suspended', claim_follow_up_at = now()
     WHERE id = v_venue.id;

    -- Structured to-do round (mirrors admin_add_venue_claim_feedback), PER VENUE.
    IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' AND jsonb_array_length(p_items) > 0 THEN
      SELECT coalesce(max(round),0)+1 INTO v_round
        FROM public.venue_claim_feedback WHERE venue_id = v_venue.id;
      FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_cat  := nullif(trim(v_item->>'category'),'');
        v_note := nullif(trim(v_item->>'note'),'');
        IF v_cat IS NULL OR v_cat NOT IN
           ('photos','address','hours','category','description','quality','other') THEN
          RAISE EXCEPTION 'invalid_category';
        END IF;
        IF v_note IS NULL THEN RAISE EXCEPTION 'note_required'; END IF;
        INSERT INTO public.venue_claim_feedback
          (brand_id, venue_id, place_pool_id, round, category, note, overall_message, created_by)
        VALUES
          (v_venue.brand_id, v_venue.id, p_place_id, v_round, v_cat, v_note,
           CASE WHEN v_first THEN v_msg ELSE NULL END, auth.uid());
        v_first := false;
        v_count := v_count + 1;
      END LOOP;
    ELSIF v_msg IS NOT NULL THEN
      SELECT coalesce(max(round),0)+1 INTO v_round
        FROM public.venue_claim_feedback WHERE venue_id = v_venue.id;
      INSERT INTO public.venue_claim_feedback
        (brand_id, venue_id, place_pool_id, round, category, note, overall_message, created_by)
      VALUES (v_venue.brand_id, v_venue.id, p_place_id, v_round, 'other', v_msg, v_msg, auth.uid());
      v_count := 1;
    END IF;

    -- Notify active brand members (owners resolved via the venue's brand team).
    -- Deep link carries the venue scope (kept alias route forwards, Leg B #13).
    FOR v_uid IN
      SELECT user_id FROM public.brand_team_members
       WHERE brand_id = v_venue.brand_id AND removed_at IS NULL AND accepted_at IS NOT NULL
    LOOP
      INSERT INTO public.notifications
        (user_id, type, title, body, brand_id, related_id, related_type, deep_link, data)
      VALUES
        (v_uid, 'listing_suspended', 'Your listing was suspended',
         coalesce(v_msg, 'An admin suspended your venue listing. Open it to see what to fix.'),
         v_venue.brand_id, p_place_id::text, 'place_pool',
         '/brand/' || v_venue.brand_id::text || '/listing?venue=' || v_venue.id::text,
         jsonb_build_object('place_id', p_place_id, 'brand_id', v_venue.brand_id,
                            'venue_id', v_venue.id, 'reason', p_reason));
      v_notified := v_notified + 1;
    END LOOP;
  END IF;

  INSERT INTO public.place_admin_actions (place_id, action_type, acted_by, reason, metadata)
  VALUES (p_place_id, 'suspend', auth.uid(), p_reason,
          jsonb_build_object('brand_id', v_venue.brand_id, 'venue_id', v_venue.id,
                             'todo_items', v_count, 'notified', v_notified));

  RETURN jsonb_build_object('ok', true, 'suspended', true,
                            'brand_id', v_venue.brand_id, 'venue_id', v_venue.id,
                            'todo_items', v_count, 'notified', v_notified);
END;
$$;

-- ---------------------------------------------------------------------------
-- 2f. admin_soft_delete_listing — revoke the VENUE row; place soft-delete
--     unchanged (I-1073-DELETED-PLACE-NEVER-SERVABLE trigger untouched).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_soft_delete_listing(
  p_place_id uuid,
  p_reason   text DEFAULT NULL,
  p_message  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  v_venue    public.venue_listings%ROWTYPE;
  v_uid      uuid;
  v_notified integer := 0;
  v_msg      text := nullif(trim(coalesce(p_message,'')),'');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- Soft-delete; the trigger forces is_servable=false + is_active=false.
  UPDATE public.place_pool
     SET deleted_at = now(), deleted_reason = p_reason
   WHERE id = p_place_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'place_not_found_or_already_deleted'; END IF;

  -- Revoke the claimed VENUE. Keep place_pool_id intact so RESTORE re-links.
  SELECT * INTO v_venue
    FROM public.venue_listings
   WHERE place_pool_id = p_place_id
     AND claim_status IN ('verified','suspended','pending_review')
   LIMIT 1;
  IF FOUND THEN
    UPDATE public.venue_listings
       SET claim_status = 'revoked', claim_follow_up_at = now()
     WHERE id = v_venue.id;
    FOR v_uid IN
      SELECT user_id FROM public.brand_team_members
       WHERE brand_id = v_venue.brand_id AND removed_at IS NULL AND accepted_at IS NOT NULL
    LOOP
      INSERT INTO public.notifications
        (user_id, type, title, body, brand_id, related_id, related_type, deep_link, data)
      VALUES
        (v_uid, 'listing_removed', 'Your listing was removed',
         coalesce(v_msg, 'An admin removed your venue listing from Mingla.'),
         v_venue.brand_id, p_place_id::text, 'place_pool',
         '/brand/' || v_venue.brand_id::text || '/listing?venue=' || v_venue.id::text,
         jsonb_build_object('place_id', p_place_id, 'venue_id', v_venue.id, 'reason', p_reason));
      v_notified := v_notified + 1;
    END LOOP;
  END IF;

  INSERT INTO public.place_admin_actions (place_id, action_type, acted_by, reason, metadata)
  VALUES (p_place_id, 'soft_delete', auth.uid(), p_reason,
          jsonb_build_object('brand_id', v_venue.brand_id, 'venue_id', v_venue.id,
                             'notified', v_notified));

  RETURN jsonb_build_object('ok', true, 'deleted', true,
                            'brand_id', v_venue.brand_id, 'venue_id', v_venue.id,
                            'notified', v_notified);
END;
$$;

-- ---------------------------------------------------------------------------
-- 2g. admin_restore_listing — re-verify the VENUE row we suspended/revoked.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_restore_listing(p_place_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  v_was_deleted boolean;
  v_venue_id    uuid;
  v_brand_id    uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT (deleted_at IS NOT NULL) INTO v_was_deleted
    FROM public.place_pool WHERE id = p_place_id;
  IF v_was_deleted IS NULL THEN RAISE EXCEPTION 'place_not_found'; END IF;

  -- Clear soft-delete + bring it back as active. is_servable is left to the
  -- bouncer/scorer to re-establish (a restore must not fabricate servability).
  UPDATE public.place_pool
     SET deleted_at = NULL, deleted_reason = NULL, is_active = true
   WHERE id = p_place_id;

  -- Re-verify the VENUE we suspended/revoked for this place.
  UPDATE public.venue_listings
     SET claim_status = 'verified', claim_follow_up_at = NULL
   WHERE place_pool_id = p_place_id AND claim_status IN ('suspended','revoked')
  RETURNING id, brand_id INTO v_venue_id, v_brand_id;

  INSERT INTO public.place_admin_actions (place_id, action_type, acted_by, reason, metadata)
  VALUES (p_place_id, 'restore', auth.uid(), NULL,
          jsonb_build_object('was_deleted', v_was_deleted, 'venue_id', v_venue_id,
                             'brand_id', v_brand_id));

  RETURN jsonb_build_object('ok', true, 'restored', true,
                            'was_deleted', v_was_deleted, 'venue_id', v_venue_id,
                            'brand_id', v_brand_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_suspend_listing(uuid,text,jsonb,text)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_soft_delete_listing(uuid,text,text)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_restore_listing(uuid)                  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. venue_public_view — the anon read model (D-2). SECURITY DEFINER per the
--    20260731000000 ruling: anon reads only this view's scoped public-safe
--    output, never venue_listings or brands. Column exposure mirrors
--    claimed_venues_public_view (contact fields intentionally public for
--    venues — shipped precedent; hours agg format byte-identical so the
--    PublicVenue mapping reuses).
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.venue_public_view;

CREATE VIEW public.venue_public_view AS
SELECT
  v.id, v.brand_id, b.slug AS brand_slug, b.name AS brand_name,
  v.slug, v.name, v.address, v.city, v.country_code, v.lat, v.lng,
  v.venue_category, v.google_place_id, v.contact_email, v.contact_phone,
  v.cover_media_url, v.cover_media_type, v.place_pool_id,
  b.theme_color, b.theme_font, b.theme_animation, b.cover_hue,
  b.default_currency,
  (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'weekday', bh.weekday,
      'open_time', to_char(bh.open_time::interval, 'HH24:MI'),
      'close_time', to_char(bh.close_time::interval, 'HH24:MI'),
      'is_closed', bh.is_closed) ORDER BY bh.weekday), '[]'::jsonb)
     FROM public.brand_hours bh WHERE bh.venue_id = v.id) AS hours,
  pp.stored_photo_urls AS pool_photo_urls,
  v.created_at, v.updated_at
FROM public.venue_listings v
JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
LEFT JOIN public.place_pool pp ON pp.id = v.place_pool_id
WHERE v.claim_status = 'verified';

-- security_invoker stays FALSE (definer) per the 20260731000000 ruling —
-- explicit so a future default change cannot flip it.
ALTER VIEW public.venue_public_view SET (security_invoker = false);

GRANT SELECT ON public.venue_public_view TO anon, authenticated;

COMMENT ON VIEW public.venue_public_view IS
  'META-ORCH-1255 M4 (D-2): the ONLY anon read path for venue data '
  '(I-PROPOSED-1255-PUBLIC-VENUE-PAGE-ANON-SAFE). SECURITY DEFINER (20260731000000 '
  'ruling); WHERE claim_status=''verified'' + non-deleted brand scope the rows. '
  'pending_review/rejected/suspended/revoked venues are INVISIBLE here; no '
  'Stripe/account columns cross the view. Serves /b/{brandSlug}/v/{venueSlug}.';

-- ---------------------------------------------------------------------------
-- 4a. pg_brand_experiences_for_place — re-stated from its latest live def
--     (20261009000003 ORCH-1153) changing ONLY the brand resolution:
--     brands.place_pool_id+claim → venue_listings join (F-7). Same columns out.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_brand_experiences_for_place(p_place_pool_id uuid)
RETURNS TABLE(
  experience_id uuid,
  brand_id uuid,
  brand_slug text,
  brand_name text,
  experience_slug text,
  title text,
  description text,
  cover_media_url text,
  cover_media_type text,
  theme jsonb,
  venue_text text,
  next_occurrence_at timestamp with time zone,
  price_from_cents bigint,
  currency text,
  is_free boolean,
  experience_intents text[],
  stops jsonb,
  upcoming_occurrences jsonb,
  published_at timestamp with time zone,
  is_recurring boolean,
  recurrence_rules jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    e.id AS experience_id,
    e.brand_id,
    b.slug AS brand_slug,
    b.name AS brand_name,
    e.slug AS experience_slug,
    e.title,
    e.description,
    e.cover_media_url,
    e.cover_media_type::text AS cover_media_type,
    e.theme,
    (e.theme->'experience_meta'->>'venue_text')::text AS venue_text,
    NULLIF(e.theme->'experience_meta'->>'next_occurrence_at', '')::timestamptz AS next_occurrence_at,
    (
      SELECT min(tt.price_cents)
      FROM public.ticket_types tt
      WHERE tt.event_id = e.id
        AND tt.deleted_at IS NULL
        AND tt.is_hidden IS NOT TRUE
        AND tt.is_disabled IS NOT TRUE
    ) AS price_from_cents,
    e.currency::text AS currency,
    (
      SELECT NOT EXISTS (
        SELECT 1
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.deleted_at IS NULL
          AND tt.price_cents > 0
      )
    ) AS is_free,
    e.experience_intents,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'stop_order',     s.stop_order,
          'place_id',       COALESCE(s.place_id, s.id::text),
          'place_name',     s.place_name,
          'address',        s.address,
          'city',           s.city,
          'image_urls',     to_jsonb(s.image_urls),
          'ai_description', s.ai_description,
          'lat',            s.lat,
          'lng',            s.lng,
          'start_time',     s.start_time,
          'price_cents',    s.price_cents
        )
        ORDER BY s.stop_order ASC
      )
      FROM public.experience_stops s
      WHERE s.event_id = e.id
    ), '[]'::jsonb) AS stops,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'event_date_id', occ.id,
          'start_at',      occ.start_at,
          'end_at',        occ.end_at,
          'capacity',      occ.cap,
          'sold',          occ.sold,
          'remaining',     occ.remaining
        )
        ORDER BY occ.start_at ASC
      )
      FROM (
        SELECT
          ed.id, ed.start_at, ed.end_at,
          tcap.cap, tcap.sold, tcap.remaining,
          ROW_NUMBER() OVER (ORDER BY ed.start_at ASC) AS rn
        FROM public.event_dates ed
        CROSS JOIN LATERAL (
          SELECT
            tt.quantity_total AS cap,
            COALESCE((
              SELECT COUNT(*) FROM public.tickets tk
              WHERE tk.ticket_type_id = tt.id
                AND tk.status IN ('valid','used','transferred')
            ), 0)::int AS sold,
            CASE
              WHEN tt.is_unlimited THEN NULL
              WHEN tt.quantity_total IS NULL THEN NULL
              ELSE GREATEST(tt.quantity_total - COALESCE((
                SELECT COUNT(*) FROM public.tickets tk
                WHERE tk.ticket_type_id = tt.id
                  AND tk.status IN ('valid','used','transferred')
              ), 0), 0)::int
            END AS remaining
          FROM public.ticket_types tt
          WHERE tt.event_id = e.id
            AND tt.available_online = true
            AND tt.deleted_at IS NULL
          ORDER BY tt.price_cents ASC, tt.id ASC
          LIMIT 1
        ) tcap
        WHERE ed.event_id = e.id
          AND ed.end_at > now()
      ) occ
      WHERE occ.rn <= 12
    ), '[]'::jsonb) AS upcoming_occurrences,
    e.published_at,
    e.is_recurring,
    e.recurrence_rules
  FROM public.events e
  JOIN public.brands b ON b.id = e.brand_id
  -- META-ORCH-1255 M4 (F-7): the place→brand resolution is the VENUE row now.
  JOIN public.venue_listings vl
    ON vl.brand_id = b.id
   AND vl.place_pool_id = p_place_pool_id
   AND vl.claim_status = 'verified'
  WHERE b.deleted_at IS NULL
    AND e.event_type = 'experience'
    AND e.visibility = 'public'
    AND e.published_at IS NOT NULL
    AND e.deleted_at IS NULL
    -- ORCH-1076 I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED: paid-only Stripe-readiness gate (mirror of checkout 409 + ORCH-1075 publish guard). FREE + in-person-only-paid exempt. Buyer-facing only — owners read events directly.
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.ticket_types tt
         WHERE tt.event_id = e.id
           AND tt.available_online = true
           AND tt.deleted_at IS NULL
           AND tt.price_cents > 0
      )
      OR public.pg_brand_can_charge(e.brand_id)
    )
  ORDER BY
    NULLIF(e.theme->'experience_meta'->>'next_occurrence_at', '')::timestamptz ASC NULLS LAST,
    e.published_at DESC;
$function$;

GRANT EXECUTE ON FUNCTION public.pg_brand_experiences_for_place(uuid) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4b. pg_venue_reservable_for_place — re-stated from 20261012000006 with the
--     venue-listing join swap; the settings read moves to vrs.venue_id;
--     RETURNS TABLE gains ADDITIVE venue_id (NULL when not reservable — same
--     no-dead-tap NULL discipline as brand_id;
--     I-PROPOSED-1148-RESERVABLE-RESOLVER-EXPOSES-ONLY-DISPLAY-GATE preserved:
--     still ONLY display-gate fields). DROP-before-widen (RETURNS shape grows).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.pg_venue_reservable_for_place(uuid);

CREATE OR REPLACE FUNCTION public.pg_venue_reservable_for_place(p_place_pool_id uuid)
RETURNS TABLE (
  reservable boolean,
  brand_id   uuid,
  currency   text,
  venue_id   uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    COALESCE(vrs.reservations_enabled, false) AS reservable,
    -- Only expose ids when the venue is actually reservable; otherwise NULL so
    -- the client renders no Reserve affordance (no dead tap).
    CASE WHEN COALESCE(vrs.reservations_enabled, false)
         THEN b.id ELSE NULL END                AS brand_id,
    -- Display currency (WYSIWYP, currency-aware): the configured reservation fee
    -- currency wins, else the brand's settlement/pricing currency, else default.
    CASE WHEN COALESCE(vrs.reservations_enabled, false)
         THEN UPPER(COALESCE(
                NULLIF(vrs.fee_currency, ''),
                NULLIF(b.pricing_currency, ''),
                NULLIF(b.default_currency, '')
              ))
         ELSE NULL END                          AS currency,
    -- META-ORCH-1255 (ADDITIVE): the venue key the consumer reserve flow passes
    -- to pg_venue_available_slots + venue-reservation-create.
    CASE WHEN COALESCE(vrs.reservations_enabled, false)
         THEN v.id ELSE NULL END                AS venue_id
  FROM public.venue_listings v
  JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
  LEFT JOIN public.venue_reservation_settings vrs ON vrs.venue_id = v.id
  WHERE v.place_pool_id = p_place_pool_id
    AND v.claim_status = 'verified'
  ORDER BY COALESCE(vrs.reservations_enabled, false) DESC
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.pg_venue_reservable_for_place(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_venue_reservable_for_place(uuid)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.pg_venue_reservable_for_place(uuid) IS
  'META-ORCH-1148 2.2b re-keyed by META-ORCH-1255 M4: place_pool → VERIFIED '
  'venue_listings resolver for the consumer Reserve affordance. Returns exactly '
  '{reservable, brand_id, currency, venue_id}; ids+currency NULL unless '
  'reservations_enabled. Display gate only — pg_venue_available_slots is the '
  'slot authority. I-PROPOSED-1148-RESERVABLE-RESOLVER-EXPOSES-ONLY-DISPLAY-GATE.';

-- ---------------------------------------------------------------------------
-- 5a. DECOMMISSION (D-1): biz_create_venue_brand_authoring → fail-soft stub of
--     IDENTICAL signature. Old binaries in the field get
--     'venue_creation_moved:update_app' — a non-vendor code the wizard's
--     sanitizeAuthoringError passes to its generic fallback (no vendor leak,
--     no crash). See SPEC_META-ORCH-1255_MULTI_VENUE_FIRST_CLASS.md §4.A.5.
--     I-PROPOSED-1255-NO-HIDDEN-BRAND-ON-VENUE-CREATE: any migration ≥
--     20261130000000 that re-adds a functional body to this RPC fails the
--     orch-1255-no-hidden-brand-on-venue-create.mjs CI gate + the
--     orch_1255_no_hidden_brand.test.sql probe.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_create_venue_brand_authoring (
  p_name text,
  p_slug text,
  p_description text,
  p_google_place_id text,
  p_lat double precision,
  p_lng double precision,
  p_city text,
  p_country_code text,
  p_address text,
  p_venue_category text,
  p_contact_email text,
  p_contact_phone text,
  p_cover_media_url text,
  p_cover_media_type text,
  p_hours jsonb,
  p_place_pool_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- META-ORCH-1255 M4 decommission stub (D-1). Venue creation moved to
  -- biz_create_venue_listing (per-venue rows, no hidden brand). Old shipped
  -- binaries land here; the client sanitizer renders its generic fallback.
  RAISE EXCEPTION 'venue_creation_moved:update_app';
END;
$$;

-- ---------------------------------------------------------------------------
-- 5b. DROP the dead pending_review creator (investigation D-4 discovery; the
--     live client never calls it).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.biz_create_venue_brand_pending_review(
  text, text, text, text, double precision, double precision,
  text, text, text, text, text, text, text, text, jsonb, uuid);

-- ---------------------------------------------------------------------------
-- 6. place_pool RLS predicates re-keyed brands → venue_listings (R-2).
--    (a) the anon photo/hours gate: anon reads a place ONLY when its VENUE is
--        verified (SC-5: flipping the venue to suspended removes anon access
--        on the next read).
--    (b) the owner place-write gate: the brand-pointer arm
--        (b.place_pool_id = place_pool.id) becomes the venue-listing arm with
--        the manager+ rank helper; the business_author_brand_id arm and the
--        claimed_by arm survive verbatim.
-- ---------------------------------------------------------------------------
-- LIVE-FIRE CORRECTION (local Postgres proof, 2026-07-02): the SPEC's inline
-- EXISTS-on-venue_listings predicate CANNOT run for anon — RLS policy
-- expressions execute with the QUERYING role's privileges, and anon has (by
-- SPEC design) no grant on venue_listings, so every anon place_pool read
-- errored 42501 "permission denied for table venue_listings". The predicate
-- therefore lives in a SECURITY DEFINER STABLE helper (same mechanism as
-- is_admin_user() inside policies). Semantics are IDENTICAL to the SPEC's
-- USING clause. The authenticated UPDATE policy below keeps the inline
-- predicate (authenticated has the venue_listings SELECT grant).
CREATE OR REPLACE FUNCTION public._orch1255_place_has_verified_venue(p_place_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.venue_listings v
    JOIN public.brands b ON b.id = v.brand_id
    WHERE v.place_pool_id = p_place_id
      AND v.claim_status = 'verified'
      AND b.deleted_at IS NULL
  );
$$;

REVOKE ALL ON FUNCTION public._orch1255_place_has_verified_venue(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._orch1255_place_has_verified_venue(uuid)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public._orch1255_place_has_verified_venue(uuid) IS
  'META-ORCH-1255 M4 (R-2): definer predicate for the anon place_pool read '
  'gate — a place is publicly readable IFF a VERIFIED venue_listings row (on a '
  'non-deleted brand) points at it. Definer because anon has no venue_listings '
  'grant (I-PROPOSED-1255-PUBLIC-VENUE-PAGE-ANON-SAFE). Read-only boolean — '
  'no RETURNING-OWNER-GAP surface.';

DROP POLICY IF EXISTS "Public can read place_pool for verified-claimed venues" ON public.place_pool;
CREATE POLICY "Public can read place_pool for verified-claimed venues"
  ON public.place_pool
  FOR SELECT
  TO anon, authenticated
  USING (public._orch1255_place_has_verified_venue(place_pool.id));

DROP POLICY IF EXISTS place_pool_business_owner_update ON public.place_pool;
CREATE POLICY place_pool_business_owner_update
  ON public.place_pool
  FOR UPDATE
  TO authenticated
  USING (
    claimed_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.brands b
      WHERE b.account_id = auth.uid()
        AND b.deleted_at IS NULL
        AND b.id = place_pool.business_author_brand_id
    )
    OR EXISTS (
      SELECT 1 FROM public.venue_listings v
      WHERE v.place_pool_id = place_pool.id
        AND public.biz_brand_effective_rank_for_caller(v.brand_id)
              >= public.biz_role_rank('event_manager')
    )
  )
  WITH CHECK (
    claimed_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.brands b
      WHERE b.account_id = auth.uid()
        AND b.deleted_at IS NULL
        AND b.id = place_pool.business_author_brand_id
    )
    OR EXISTS (
      SELECT 1 FROM public.venue_listings v
      WHERE v.place_pool_id = place_pool.id
        AND public.biz_brand_effective_rank_for_caller(v.brand_id)
              >= public.biz_role_rank('event_manager')
    )
  );

COMMENT ON POLICY place_pool_business_owner_update ON public.place_pool IS
  'META-ORCH-1009 Sub-E (D3) re-keyed by META-ORCH-1255 M4 (R-2): direct-'
  'predicate owner-UPDATE. The brand-pointer arm (b.place_pool_id) is replaced '
  'by the venue-listing arm (manager+ rank on the venue''s brand). brand-X '
  'members cannot UPDATE a place linked to brand-Y''s venue.';

COMMIT;

NOTIFY pgrst, 'reload schema';
