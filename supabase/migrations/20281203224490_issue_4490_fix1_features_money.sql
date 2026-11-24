-- #4490 fix round 1 (B2-B8 server parts) — features at create, presets,
-- Memberships back on, member payments, offers outside opening hours, money
-- collected today.
--
-- B2 (N20) root cause: the add-venue wizard writes its features one at a time
-- after the venue exists, in feature order, and stops at the first refusal.
-- issue_4490_set_venue_feature refused Private hire and Floor plan (and Pick a
-- table, which turns the floor plan on) with feature_requires:space because a
-- new venue has no space yet, so every feature after the first refused one
-- was silently dropped (Foundry Hall: nothing; Studio Nine / Harbour Palms /
-- Amber Room: Entry only; CLUB MERIDIAN: stopped at Floor plan). Menu read as
-- on for every non-stay venue by the backfill default.
--   * A feature that needs a space (or tables) may now be switched on before
--     the space exists; the features read says what it still needs
--     (`needs: ['space'|'table']`), the public page keeps hiding it until it is
--     sellable (unchanged rule in issue_4490_public_features).
--   * issue_4490_apply_starting_features(venue, keys[], key): one call sets a
--     new venue's starting features in dependency order and returns what was
--     applied, what was not and why, and what still needs setting up.
--   * Menu's backfill default is on only for a type whose preset has Menu, or
--     a venue that already has a menu.
-- B3: issue_4490_feature_preset matches the client table (p6 UI report).
-- B4: switching a feature off records the offers it paused; switching it back
--     on puts exactly those back on sale (nothing paused for another reason).
-- B5: the member read carries `payments` (paid months).
-- B6 (N28): Host offer list flags offers that sell outside opening hours.
-- B7 (N47): Today adds money collected that day beside "taken today".
--
-- Additive: one new table (no venue_id column: it keys on the offering), new
-- functions, CREATE OR REPLACE with the same signatures. Static SQL.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- B3. Presets (client VENUE_TYPES table, p6 UI report "Preset table").
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_feature_preset(p_category text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT CASE p_category
    WHEN 'restaurant' THEN ARRAY['table_reservations', 'waitlist', 'menu', 'table_ordering']
    WHEN 'play' THEN ARRAY['entry', 'group_packages', 'private_hire', 'menu', 'table_ordering', 'events_here']
    WHEN 'creative_and_arts' THEN ARRAY['entry', 'by_the_hour', 'private_hire', 'memberships', 'events_here']
    WHEN 'stay' THEN ARRAY['stays']
    WHEN 'bar_lounge' THEN ARRAY['table_reservations', 'min_spend_tables', 'private_hire', 'menu', 'table_ordering', 'events_here']
    WHEN 'club' THEN ARRAY['entry', 'table_reservations', 'min_spend_tables', 'menu', 'table_ordering', 'events_here']
    WHEN 'cafe' THEN ARRAY['entry', 'by_the_hour', 'menu', 'table_ordering', 'events_here']
    WHEN 'event_space' THEN ARRAY['private_hire', 'events_here']
    WHEN 'coworking' THEN ARRAY['entry', 'by_the_hour', 'private_hire', 'memberships']
    ELSE NULL
  END::text[];
$function$;

-- ---------------------------------------------------------------------------
-- B2. Feature rows: Menu's backfill default follows the type's preset.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_venue_feature_rows(p_venue_id uuid)
RETURNS TABLE(feature_key text, enabled boolean, space_ids uuid[], settings jsonb, version bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    key,
    COALESCE(feature.enabled, CASE key
      WHEN 'table_reservations' THEN COALESCE(reservation.reservations_enabled, false)
      WHEN 'waitlist' THEN COALESCE(reservation.reservations_enabled, false)
      -- #4490 fix round 1: Menu reads as on (no row yet) only for a type that
      -- starts with Menu, or a venue that already has a menu.
      WHEN 'menu' THEN venue.venue_category <> 'stay'
        AND ('menu' = ANY(COALESCE(public.issue_4490_feature_preset(venue.venue_category), '{}'::text[]))
             OR EXISTS (SELECT 1 FROM public.menus m WHERE m.venue_id = venue.id))
      WHEN 'table_ordering' THEN COALESCE(ordering.ordering_enabled, false)
      WHEN 'stays' THEN venue.venue_category = 'stay'
      ELSE false
    END),
    feature.space_ids,
    COALESCE(feature.settings, '{}'::jsonb),
    COALESCE(feature.version, 0)
  FROM public.venue_listings venue
  CROSS JOIN LATERAL unnest(public.issue_4490_feature_keys()) WITH ORDINALITY AS keys(key, ord)
  LEFT JOIN public.venue_features feature
    ON feature.venue_id = venue.id AND feature.feature_key = keys.key
  LEFT JOIN public.venue_reservation_settings reservation ON reservation.venue_id = venue.id
  LEFT JOIN public.venue_ordering_settings ordering ON ordering.venue_id = venue.id
  WHERE venue.id = p_venue_id
  ORDER BY keys.ord;
$function$;

-- What a switched-on feature still needs before guests can use it.
CREATE OR REPLACE FUNCTION public.issue_4490_feature_needs(p_venue_id uuid, p_key text)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT ARRAY(
    SELECT n FROM (VALUES
      ('space', 1, (public.issue_4490_feature_needs_space(p_key) OR p_key = 'by_the_hour')
                   AND public.issue_4490_venue_active_space_count(p_venue_id) = 0),
      ('table', 2, p_key IN ('table_reservations', 'floor_plan', 'pick_a_table', 'min_spend_tables')
                   AND NOT EXISTS (SELECT 1 FROM public.venue_tables t
                                   WHERE t.venue_id = p_venue_id AND t.is_active AND t.deleted_at IS NULL))
    ) AS x(n, ord, hit)
    WHERE x.hit ORDER BY x.ord);
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_get_venue_features(p_venue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_spaces integer;
  v_features jsonb;
  v_version bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_can_view_venue(p_venue_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_spaces := public.issue_4490_venue_active_space_count(p_venue_id);

  WITH rows AS (
    SELECT * FROM public.issue_4490_venue_feature_rows(p_venue_id)
  )
  SELECT
    jsonb_agg(jsonb_build_object(
      'key', r.feature_key,
      'enabled', r.enabled,
      'space_ids', to_jsonb(r.space_ids),
      'settings', r.settings,
      'version', r.version,
      'blocked_by', to_jsonb(
        ARRAY(
          SELECT parent FROM unnest(public.issue_4490_feature_parents(r.feature_key)) AS parent
          WHERE NOT EXISTS (SELECT 1 FROM rows p WHERE p.feature_key = parent AND p.enabled)
        )
        || CASE WHEN public.issue_4490_feature_needs_space(r.feature_key) AND v_spaces = 0
             THEN ARRAY['space']::text[] ELSE '{}'::text[] END
      ),
      -- #4490 fix round 1: what this feature still needs to work for guests
      -- (on or off): 'space' (add a space), 'table' (add a table).
      'needs', to_jsonb(public.issue_4490_feature_needs(p_venue_id, r.feature_key))
    ) ORDER BY array_position(public.issue_4490_feature_keys(), r.feature_key)),
    max(r.version)
  INTO v_features, v_version
  FROM rows r;

  RETURN jsonb_build_object(
    'venue_id', v_venue.id,
    'brand_id', v_venue.brand_id,
    'venue_category', v_venue.venue_category,
    'secondary_categories', to_jsonb(v_venue.secondary_categories),
    'version', COALESCE(v_version, 0),
    'active_space_count', v_spaces,
    'preset', to_jsonb(COALESCE(public.issue_4490_feature_preset(v_venue.venue_category), '{}'::text[])),
    'features', COALESCE(v_features, '[]'::jsonb),
    'flags', jsonb_build_object(
      'reads', COALESCE((SELECT flag.is_enabled FROM public.feature_flags flag WHERE flag.flag_key = 'VENUE_OFFERS_READS'), false),
      'writes', COALESCE((SELECT flag.is_enabled FROM public.feature_flags flag WHERE flag.flag_key = 'VENUE_OFFERS_WRITES'), false)
    )
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- B2. Switching on: a missing space is no longer a refusal (the read says
--     what is still needed). Otherwise as 20281203004490.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_set_venue_feature(p_venue_id uuid, p_key text, p_enabled boolean, p_space_ids uuid[], p_settings jsonb, p_expected_version bigint, p_idempotency_key text, p_cascade boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venue public.venue_listings%ROWTYPE;
  v_hash text;
  v_replay jsonb;
  v_current record;
  v_missing text[];
  v_dependents text[];
  v_changed text[] := '{}'::text[];
  v_other text;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_key IS NULL OR NOT (p_key = ANY(public.issue_4490_feature_keys())) THEN
    RAISE EXCEPTION 'invalid_feature_key' USING ERRCODE = '22023';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'enabled_required' USING ERRCODE = '22023';
  END IF;
  IF p_settings IS NOT NULL AND jsonb_typeof(p_settings) <> 'object' THEN
    RAISE EXCEPTION 'feature_settings_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF public.biz_brand_effective_rank_for_caller(v_venue.brand_id) < public.biz_role_rank('brand_admin') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  v_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'venue', p_venue_id, 'key', p_key, 'enabled', p_enabled, 'space_ids', to_jsonb(p_space_ids),
    'settings', p_settings, 'expected_version', p_expected_version, 'cascade', COALESCE(p_cascade, false)
  )::text, 'UTF8')), 'hex');
  v_replay := public.issue_4490_receipt_lookup('set_venue_feature:' || p_venue_id::text, p_idempotency_key, v_hash);
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
  END IF;

  IF p_key = 'stays' THEN
    RAISE EXCEPTION 'feature_managed:stays' USING ERRCODE = 'P0001';
  END IF;
  IF p_enabled AND NOT (p_key = ANY(public.issue_4490_built_features())) THEN
    RAISE EXCEPTION 'feature_not_available:%', p_key USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('issue_4490_features:' || p_venue_id::text, 4490));
  PERFORM 1 FROM public.venue_features WHERE venue_id = p_venue_id FOR UPDATE;

  SELECT * INTO v_current FROM public.issue_4490_venue_feature_rows(p_venue_id) r WHERE r.feature_key = p_key;
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_current.version THEN
    RAISE EXCEPTION 'stale_write' USING ERRCODE = 'PT409';
  END IF;

  IF p_enabled THEN
    SELECT COALESCE(array_agg(parent ORDER BY ord), '{}'::text[]) INTO v_missing
    FROM unnest(public.issue_4490_feature_ancestors(p_key)) WITH ORDINALITY AS a(parent, ord)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.issue_4490_venue_feature_rows(p_venue_id) r
      WHERE r.feature_key = a.parent AND r.enabled
    );
    IF cardinality(v_missing) > 0 AND NOT COALESCE(p_cascade, false) THEN
      RAISE EXCEPTION 'feature_requires:%', array_to_string(v_missing, ',') USING ERRCODE = 'P0001';
    END IF;
    FOREACH v_other IN ARRAY v_missing || ARRAY[p_key] LOOP
      IF NOT (v_other = ANY(public.issue_4490_built_features())) THEN
        RAISE EXCEPTION 'feature_not_available:%', v_other USING ERRCODE = 'P0001';
      END IF;
      -- (#4490 fix round 1: no space yet is not a refusal; see `needs`.)
      IF v_other = 'table_ordering' AND COALESCE(v_venue.claim_status, '') <> 'verified' THEN
        RAISE EXCEPTION 'venue_not_orderable' USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    FOREACH v_other IN ARRAY v_missing LOOP
      PERFORM public.issue_4490_write_feature_row(p_venue_id, v_other, true, NULL, NULL, true);
      PERFORM public.issue_4490_write_legacy_switch(p_venue_id, v_other, true);
      v_changed := v_changed || v_other;
    END LOOP;
  ELSE
    SELECT COALESCE(array_agg(child ORDER BY ord), '{}'::text[]) INTO v_dependents
    FROM unnest(public.issue_4490_feature_dependents(p_key)) WITH ORDINALITY AS d(child, ord)
    WHERE EXISTS (
      SELECT 1 FROM public.issue_4490_venue_feature_rows(p_venue_id) r
      WHERE r.feature_key = d.child AND r.enabled
    );
    IF cardinality(v_dependents) > 0 AND NOT COALESCE(p_cascade, false) THEN
      RAISE EXCEPTION 'feature_has_dependents:%', array_to_string(v_dependents, ',') USING ERRCODE = 'P0001';
    END IF;
    FOREACH v_other IN ARRAY v_dependents LOOP
      PERFORM public.issue_4490_write_feature_row(p_venue_id, v_other, false, NULL, NULL, true);
      PERFORM public.issue_4490_write_legacy_switch(p_venue_id, v_other, false);
      v_changed := v_changed || v_other;
    END LOOP;
  END IF;

  PERFORM public.issue_4490_write_feature_row(p_venue_id, p_key, p_enabled, p_space_ids, p_settings, false);
  PERFORM public.issue_4490_write_legacy_switch(p_venue_id, p_key, p_enabled);
  IF v_current.enabled IS DISTINCT FROM p_enabled THEN
    v_changed := v_changed || p_key;
  END IF;

  v_result := jsonb_build_object(
    'changed_keys', to_jsonb(v_changed),
    'needs', CASE WHEN p_enabled THEN to_jsonb(public.issue_4490_feature_needs(p_venue_id, p_key)) ELSE '[]'::jsonb END,
    'features', public.issue_4490_get_venue_features(p_venue_id)
  );
  PERFORM public.issue_4490_receipt_store('set_venue_feature:' || p_venue_id::text, p_idempotency_key, v_hash, v_result);
  RETURN v_result || jsonb_build_object('replayed', false);
END;
$function$;

-- Presets: a feature that needs a space is applied too (its `needs` says so).
CREATE OR REPLACE FUNCTION public.issue_4490_apply_feature_preset(p_venue_id uuid, p_category text, p_idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venue public.venue_listings%ROWTYPE;
  v_category text;
  v_preset text[];
  v_hash text;
  v_replay jsonb;
  v_key text;
  v_parent text;
  v_reason text;
  v_applied text[] := '{}'::text[];
  v_skipped jsonb := '[]'::jsonb;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF public.biz_brand_effective_rank_for_caller(v_venue.brand_id) < public.biz_role_rank('brand_admin') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_category := COALESCE(NULLIF(btrim(p_category), ''), v_venue.venue_category);
  v_preset := public.issue_4490_feature_preset(v_category);
  IF v_preset IS NULL THEN
    RAISE EXCEPTION 'invalid_venue_category' USING ERRCODE = '22023';
  END IF;

  v_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'venue', p_venue_id, 'category', v_category)::text, 'UTF8')), 'hex');
  v_replay := public.issue_4490_receipt_lookup('apply_feature_preset:' || p_venue_id::text, p_idempotency_key, v_hash);
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('issue_4490_features:' || p_venue_id::text, 4490));
  PERFORM 1 FROM public.venue_features WHERE venue_id = p_venue_id FOR UPDATE;

  FOREACH v_key IN ARRAY v_preset LOOP
    v_reason := NULL;
    IF EXISTS (
      SELECT 1 FROM public.issue_4490_venue_feature_rows(p_venue_id) r
      WHERE r.feature_key = v_key AND r.enabled
    ) THEN
      v_reason := 'already_on';
    ELSIF v_key = 'stays' THEN
      v_reason := 'managed_by_category';
    ELSIF NOT (v_key = ANY(public.issue_4490_built_features())) THEN
      v_reason := 'not_available_yet';
    ELSIF v_key = 'table_ordering' AND COALESCE(v_venue.claim_status, '') <> 'verified' THEN
      v_reason := 'venue_not_orderable';
    ELSE
      FOREACH v_parent IN ARRAY public.issue_4490_feature_parents(v_key) LOOP
        IF NOT EXISTS (
          SELECT 1 FROM public.issue_4490_venue_feature_rows(p_venue_id) r
          WHERE r.feature_key = v_parent AND r.enabled
        ) THEN
          v_reason := 'requires:' || v_parent;
          EXIT;
        END IF;
      END LOOP;
    END IF;

    IF v_reason IS NULL THEN
      PERFORM public.issue_4490_write_feature_row(p_venue_id, v_key, true, NULL, NULL, true);
      PERFORM public.issue_4490_write_legacy_switch(p_venue_id, v_key, true);
      v_applied := v_applied || v_key;
    ELSE
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('key', v_key, 'reason', v_reason));
    END IF;
  END LOOP;

  v_result := jsonb_build_object(
    'category', v_category,
    'applied', to_jsonb(v_applied),
    'skipped', v_skipped,
    'needsSetup', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', k, 'needs', to_jsonb(public.issue_4490_feature_needs(p_venue_id, k))))
                            FROM unnest(v_applied) k WHERE cardinality(public.issue_4490_feature_needs(p_venue_id, k)) > 0), '[]'::jsonb),
    'features', public.issue_4490_get_venue_features(p_venue_id)
  );
  PERFORM public.issue_4490_receipt_store('apply_feature_preset:' || p_venue_id::text, p_idempotency_key, v_hash, v_result);
  RETURN v_result || jsonb_build_object('replayed', false);
END;
$function$;

-- ---------------------------------------------------------------------------
-- B2. A new venue's starting features in one call (the add-venue wizard).
--     Every requested feature whose parents are also requested (or already
--     on) is switched on, parents first; a feature still on only by the
--     backfill default and not requested is written off. Returns
--     applied / turnedOff / skipped [{key, reason}] / needsSetup [{key, needs}]
--     / features. Only before the venue sells anything (no offers yet).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_apply_starting_features(
  p_venue_id uuid,
  p_features text[],
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_chosen text[];
  v_hash text;
  v_replay jsonb;
  v_key text;
  v_parent text;
  v_reason text;
  v_on boolean;
  v_applied text[] := '{}'::text[];
  v_off text[] := '{}'::text[];
  v_skipped jsonb := '[]'::jsonb;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_features IS NULL OR cardinality(p_features) > 30 THEN
    RAISE EXCEPTION 'starting_features_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF public.biz_brand_effective_rank_for_caller(v_venue.brand_id) < public.biz_role_rank('brand_admin') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT btrim(k)), '{}'::text[]) INTO v_chosen
  FROM unnest(p_features) k WHERE k IS NOT NULL AND btrim(k) <> '';

  v_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'venue', p_venue_id, 'features', to_jsonb(ARRAY(SELECT x FROM unnest(v_chosen) x ORDER BY x)))::text, 'UTF8')), 'hex');
  v_replay := public.issue_4490_receipt_lookup('apply_starting_features:' || p_venue_id::text, p_idempotency_key, v_hash);
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('issue_4490_features:' || p_venue_id::text, 4490));
  PERFORM 1 FROM public.venue_features WHERE venue_id = p_venue_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.stay_offerings o WHERE o.venue_id = p_venue_id AND o.status <> 'archived') THEN
    RAISE EXCEPTION 'venue_already_selling' USING ERRCODE = 'PT409';
  END IF;

  -- Unknown keys are reported, never silently dropped.
  FOREACH v_key IN ARRAY v_chosen LOOP
    IF NOT (v_key = ANY(public.issue_4490_feature_keys())) THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('key', v_key, 'reason', 'unknown_feature'));
    END IF;
  END LOOP;

  -- Feature order puts every parent before its children.
  FOREACH v_key IN ARRAY public.issue_4490_feature_keys() LOOP
    SELECT r.enabled INTO v_on FROM public.issue_4490_venue_feature_rows(p_venue_id) r WHERE r.feature_key = v_key;
    IF v_key = ANY(v_chosen) THEN
      v_reason := NULL;
      IF v_key = 'stays' THEN
        v_reason := CASE WHEN v_on THEN NULL ELSE 'managed_by_category' END;
      ELSIF NOT (v_key = ANY(public.issue_4490_built_features())) THEN
        v_reason := 'not_available_yet';
      ELSIF v_key = 'table_ordering' AND COALESCE(v_venue.claim_status, '') <> 'verified' THEN
        v_reason := 'venue_not_orderable';
      ELSE
        FOREACH v_parent IN ARRAY public.issue_4490_feature_parents(v_key) LOOP
          IF NOT EXISTS (SELECT 1 FROM public.issue_4490_venue_feature_rows(p_venue_id) r
                         WHERE r.feature_key = v_parent AND r.enabled) THEN
            v_reason := 'requires:' || v_parent;
            EXIT;
          END IF;
        END LOOP;
      END IF;
      IF v_reason IS NOT NULL THEN
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('key', v_key, 'reason', v_reason));
      ELSIF v_key <> 'stays' THEN
        PERFORM public.issue_4490_write_feature_row(p_venue_id, v_key, true, NULL, NULL, true);
        PERFORM public.issue_4490_write_legacy_switch(p_venue_id, v_key, true);
        v_applied := v_applied || v_key;
      ELSE
        v_applied := v_applied || v_key;
      END IF;
    ELSIF v_on AND v_key <> 'stays' THEN
      -- On only by the backfill default (or a legacy switch): not chosen, so off.
      PERFORM public.issue_4490_write_feature_row(p_venue_id, v_key, false, NULL, NULL, true);
      PERFORM public.issue_4490_write_legacy_switch(p_venue_id, v_key, false);
      v_off := v_off || v_key;
    END IF;
  END LOOP;

  v_result := jsonb_build_object(
    'applied', to_jsonb(v_applied),
    'turnedOff', to_jsonb(v_off),
    'skipped', v_skipped,
    'needsSetup', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', k, 'needs', to_jsonb(public.issue_4490_feature_needs(p_venue_id, k)))
                                   ORDER BY array_position(public.issue_4490_feature_keys(), k))
                            FROM unnest(v_applied) k WHERE cardinality(public.issue_4490_feature_needs(p_venue_id, k)) > 0), '[]'::jsonb),
    'features', public.issue_4490_get_venue_features(p_venue_id)
  );
  PERFORM public.issue_4490_receipt_store('apply_starting_features:' || p_venue_id::text, p_idempotency_key, v_hash, v_result);
  RETURN v_result || jsonb_build_object('replayed', false);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4490_apply_starting_features(uuid, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4490_apply_starting_features(uuid, text[], text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.issue_4490_feature_needs(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4490_feature_needs(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- B4. Offers paused by a feature going off come back when it goes on again.
-- ---------------------------------------------------------------------------
CREATE TABLE public.venue_feature_paused_offers (
  offering_id uuid PRIMARY KEY REFERENCES public.stay_offerings(id) ON DELETE CASCADE,
  feature_key text NOT NULL CHECK (char_length(feature_key) BETWEEN 1 AND 40),
  paused_since timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.venue_feature_paused_offers IS
  '#4490: offers a feature switch-off paused (and nothing else did); switching the feature back on puts exactly these back on sale.';
ALTER TABLE public.venue_feature_paused_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_feature_paused_offers FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_feature_paused_offers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.venue_feature_paused_offers TO authenticated;
GRANT ALL ON public.venue_feature_paused_offers TO service_role;
CREATE POLICY "feature paused offers readable by venue viewers"
  ON public.venue_feature_paused_offers FOR SELECT TO authenticated
  USING (public.issue_4490_can_view_venue((SELECT o.venue_id FROM public.stay_offerings o WHERE o.id = offering_id)));

CREATE OR REPLACE FUNCTION public.issue_4490_pause_offers_on_feature_off()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF NEW.enabled = false AND (TG_OP = 'INSERT' OR OLD.enabled IS DISTINCT FROM false) THEN
    WITH paused AS (
      UPDATE public.stay_offerings offering
      SET status = 'paused', version = version + 1, updated_at = now()
      WHERE offering.venue_id = NEW.venue_id
        AND offering.status = 'live'
        AND public.issue_4490_offer_kind_feature(offering.kind) = NEW.feature_key
      RETURNING offering.id
    )
    INSERT INTO public.venue_feature_paused_offers (offering_id, feature_key)
    SELECT paused.id, NEW.feature_key FROM paused
    ON CONFLICT (offering_id) DO UPDATE SET feature_key = EXCLUDED.feature_key, paused_since = now();
  ELSIF NEW.enabled AND TG_OP = 'UPDATE' AND OLD.enabled IS DISTINCT FROM true THEN
    -- #4490 fix round 1 (B4): back on sale exactly what the switch-off paused
    -- and is still paused (an offer archived meanwhile stays archived).
    FOR v_id IN
      UPDATE public.stay_offerings offering
      SET status = 'live', version = version + 1, updated_at = now()
      FROM public.venue_feature_paused_offers marker
      WHERE marker.offering_id = offering.id AND marker.feature_key = NEW.feature_key
        AND offering.venue_id = NEW.venue_id AND offering.status = 'paused'
      RETURNING offering.id
    LOOP
      PERFORM public.issue_4490_materialize_offer_windows(v_id);
    END LOOP;
    DELETE FROM public.venue_feature_paused_offers marker
    USING public.stay_offerings offering
    WHERE marker.offering_id = offering.id AND offering.venue_id = NEW.venue_id
      AND marker.feature_key = NEW.feature_key;
  END IF;
  RETURN NEW;
END;
$function$;

-- A Host who resumes, pauses or archives an offer by hand takes over: the
-- marker goes.
CREATE OR REPLACE FUNCTION public.issue_4490_forget_feature_pause()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM 'paused' THEN
    DELETE FROM public.venue_feature_paused_offers WHERE offering_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$function$;
CREATE TRIGGER issue_4490_forget_feature_pause
  AFTER UPDATE OF status ON public.stay_offerings
  FOR EACH ROW WHEN (OLD.status = 'paused' AND NEW.status IS DISTINCT FROM 'paused')
  EXECUTE FUNCTION public.issue_4490_forget_feature_pause();

-- ---------------------------------------------------------------------------
-- B6. An offer that sells outside the venue's opening hours (read only).
--     {outsideOpeningHours: bool, outsideOpeningHoursDays: [0..6 Mon..Sun]}.
--     Rules on days the venue is closed count as outside. No hours set, a
--     one-off date, or an all-day (00:00-23:59) rule: never flagged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_offer_hours_check(p_offering_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH o AS (SELECT * FROM public.stay_offerings WHERE id = p_offering_id),
  parts AS (
    SELECT d.wd,
           public.issue_4490_window_bounds(COALESCE(r.local_start_time, r.full_day_start_time),
                                           COALESCE(r.local_end_time, r.full_day_end_time)) AS b
    FROM public.stay_place_schedule_rules r
    JOIN o ON o.id = r.offering_id
    CROSS JOIN LATERAL unnest(r.weekdays) AS d(wd)
    WHERE r.active AND r.mode IN ('repeating_windows', 'full_day', 'flexible')
      AND NOT (r.mode = 'full_day' AND r.full_day_start_time = time '00:00' AND r.full_day_end_time >= time '23:59')
  ),
  outside AS (
    SELECT DISTINCT p.wd
    FROM parts p, o
    WHERE EXISTS (SELECT 1 FROM public.brand_hours any_h WHERE any_h.venue_id = o.venue_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.brand_hours h
        CROSS JOIN LATERAL (SELECT public.issue_4490_window_bounds(h.open_time, h.close_time) AS hb) x
        WHERE h.venue_id = o.venue_id AND h.weekday = p.wd AND NOT h.is_closed
          AND h.open_time IS NOT NULL AND h.close_time IS NOT NULL
          AND x.hb[1] <= p.b[1] AND p.b[2] <= x.hb[2])
  )
  SELECT jsonb_build_object(
    'outsideOpeningHours', EXISTS (SELECT 1 FROM outside),
    'outsideOpeningHoursDays', COALESCE((SELECT jsonb_agg(wd ORDER BY wd) FROM outside), '[]'::jsonb));
$function$;
REVOKE ALL ON FUNCTION public.issue_4490_offer_hours_check(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4490_offer_hours_check(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- B7. Money collected on one service day of the venue (minor units):
--     online payments that succeeded that day, payments recorded at the venue
--     for that day, cash / transfer gate sales made that day, paid table
--     deposits taken that day, less refunds started that day.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_collected_on(p_venue_id uuid, p_local_date date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH g AS (SELECT id, payment_collection, total_minor, state, created_at FROM public.stay_reservation_groups WHERE venue_id = p_venue_id),
  online AS (
    SELECT COALESCE(sum(a.amount_minor), 0)::bigint AS v FROM public.stay_payment_attempts a JOIN g ON g.id = a.group_id
    WHERE a.state = 'succeeded' AND public.issue_4490_venue_service_date(p_venue_id, a.succeeded_at) = p_local_date),
  at_venue AS (
    SELECT (COALESCE((SELECT sum(o.amount_minor) FROM public.venue_offline_payments o JOIN g ON g.id = o.group_id
                      WHERE o.paid_on = p_local_date), 0)
          + COALESCE((SELECT sum(g.total_minor) FROM g WHERE g.payment_collection = 'property'
                        AND g.state IN ('confirmed', 'partially_cancelled')
                        AND public.issue_4490_venue_service_date(p_venue_id, g.created_at) = p_local_date), 0))::bigint AS v),
  tables AS (
    SELECT COALESCE(sum(r.fee_cents), 0)::bigint AS v FROM public.reservations r
    WHERE r.venue_id = p_venue_id AND r.payment_status = 'paid' AND COALESCE(r.fee_cents, 0) > 0
      AND public.issue_4490_venue_service_date(p_venue_id, r.created_at) = p_local_date),
  refunds AS (
    SELECT COALESCE(sum(f.amount_minor), 0)::bigint AS v FROM public.stay_refunds f JOIN g ON g.id = f.group_id
    WHERE f.state IN ('submitted', 'processing', 'succeeded', 'manual_reconciliation')
      AND public.issue_4490_venue_service_date(p_venue_id, f.created_at) = p_local_date)
  SELECT jsonb_build_object(
    'localDate', p_local_date,
    'onlineMinor', online.v, 'atVenueMinor', at_venue.v, 'tableDepositsMinor', tables.v, 'refundedMinor', refunds.v,
    'netMinor', online.v + at_venue.v + tables.v - refunds.v)
  FROM online, at_venue, tables, refunds;
$function$;
REVOKE ALL ON FUNCTION public.issue_4490_collected_on(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_collected_on(uuid, date) TO service_role;

-- ---------------------------------------------------------------------------
-- B5. Member read + paid months (from 20281203194490).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_member_projection(p_subscription_id uuid, p_view text, p_qr_pepper text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sub public.venue_membership_subscriptions%ROWTYPE;
  v_plan public.venue_membership_plans%ROWTYPE;
  v_venue record;
  v_tz text;
  v_open public.venue_membership_periods%ROWTYPE;
  v_today date;
  v_result jsonb;
  v_can_enter boolean;
BEGIN
  SELECT * INTO v_sub FROM public.venue_membership_subscriptions WHERE id = p_subscription_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_plan FROM public.venue_membership_plans WHERE id = v_sub.plan_id;
  SELECT v.id, v.name, v.slug, b.slug AS brand_slug, b.name AS brand_name INTO v_venue
  FROM public.stay_offerings o JOIN public.venue_listings v ON v.id = o.venue_id
  JOIN public.brands b ON b.id = v.brand_id WHERE o.id = v_plan.offering_id;
  v_tz := public.issue_4490_venue_timezone(v_venue.id);
  v_today := (now() AT TIME ZONE v_tz)::date;
  SELECT * INTO v_open FROM public.venue_membership_periods
  WHERE id = public.issue_4490_member_open_period(v_sub.id);
  v_can_enter := v_sub.status IN ('active', 'payment_due', 'grace') AND v_sub.start_on <= v_today;
  v_result := jsonb_build_object(
    'subscriptionId', v_sub.id,
    'status', v_sub.status,
    'memberName', v_sub.member_name,
    'plan', jsonb_build_object(
      'id', v_plan.id, 'name', v_plan.name, 'priceMinor', v_plan.price_minor, 'currencyCode', v_plan.currency_code,
      'interval', v_plan.period, 'inclusions', v_plan.inclusions, 'entryIncluded', v_plan.entry_included,
      'roomHours', v_plan.room_hours_per_period, 'guestPasses', v_plan.guest_passes_per_period,
      'discountBps', v_plan.discount_bps, 'discountKinds', to_jsonb(v_plan.discount_kinds),
      'hourOfferingIds', to_jsonb(v_plan.hour_offering_ids), 'entryOfferingId', v_plan.entry_offering_id),
    'terms', v_sub.terms,
    'venue', jsonb_build_object('id', v_venue.id, 'name', v_venue.name, 'slug', v_venue.slug,
      'brandSlug', v_venue.brand_slug, 'brandName', v_venue.brand_name, 'timezone', v_tz),
    'startOn', v_sub.start_on,
    'startedAt', v_sub.started_at,
    'activeUntil', v_sub.current_period_end,
    'currentPeriod', CASE WHEN v_sub.current_period_start IS NULL THEN NULL ELSE jsonb_build_object(
      'start', v_sub.current_period_start, 'end', v_sub.current_period_end) END,
    'renewsOn', CASE WHEN v_sub.status IN ('active', 'payment_due', 'grace', 'lapsed')
                      AND NOT v_sub.pause_at_period_end
                      AND (v_sub.cancel_at IS NULL OR v_sub.cancel_at > v_sub.current_period_end)
                     THEN v_sub.current_period_end END,
    'renewalEmailOn', CASE WHEN v_sub.status IN ('active') AND NOT v_sub.pause_at_period_end
                            AND (v_sub.cancel_at IS NULL OR v_sub.cancel_at > v_sub.current_period_end)
                           THEN v_sub.current_period_end - make_interval(days => v_plan.renewal_notice_days) END,
    'canCheckIn', v_can_enter,
    'paymentDue', CASE WHEN v_open.id IS NULL THEN NULL ELSE jsonb_build_object(
      'periodId', v_open.id, 'amountMinor', v_open.amount_minor, 'currencyCode', v_open.currency_code,
      'periodStart', v_open.period_start, 'periodEnd', v_open.period_end, 'dueAt', v_open.due_at,
      'status', v_open.status, 'graceEndsAt', v_open.due_at + make_interval(days => COALESCE((v_sub.terms->>'graceDays')::integer, 7)),
      'paying', EXISTS (SELECT 1 FROM public.stay_payment_attempts a WHERE a.group_id = v_open.group_id
                        AND a.state IN ('pending', 'ambiguous'))) END,
    'leaving', CASE WHEN v_sub.cancel_at IS NOT NULL AND v_sub.status <> 'cancelled'
                    THEN jsonb_build_object('endsAt', v_sub.cancel_at, 'by', v_sub.cancel_requested_by) END,
    'pausing', CASE WHEN v_sub.pause_at_period_end THEN jsonb_build_object('from', v_sub.current_period_end,
                    'by', v_sub.pause_requested_by) END,
    'paused', CASE WHEN v_sub.status = 'paused' THEN jsonb_build_object('since', v_sub.paused_since, 'by', v_sub.pause_reason) END,
    'endedAt', v_sub.cancelled_at,
    'endReason', v_sub.end_reason,
    'credits', jsonb_build_object(
      'roomHoursLeft', public.issue_4490_member_credit_left(v_sub.id, 'room_hours', now()),
      'roomHoursPerMonth', v_plan.room_hours_per_period,
      'guestPassesLeft', public.issue_4490_member_credit_left(v_sub.id, 'guest_passes', now()),
      'guestPassesPerMonth', v_plan.guest_passes_per_period),
    'inToday', EXISTS (SELECT 1 FROM public.venue_member_visits x WHERE x.subscription_id = v_sub.id
                       AND x.local_date = v_today AND x.undone_at IS NULL),
    'canLeave', v_sub.status IN ('pending', 'active', 'payment_due', 'grace', 'lapsed', 'paused') AND v_sub.cancel_at IS NULL,
    'canStay', v_sub.cancel_at IS NOT NULL AND v_sub.status <> 'cancelled' AND v_sub.cancel_requested_by = 'member',
    'canPause', v_sub.status IN ('active') AND NOT v_sub.pause_at_period_end AND v_sub.cancel_at IS NULL,
    'canResume', v_sub.status = 'paused' OR v_sub.pause_at_period_end,
    -- #4490 fix round 1 (B5): the months paid, newest first (the member, and
    -- staff who may see members; never a stranger: every caller checks first).
    'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'periodId', pp.id, 'start', pp.period_start, 'end', pp.period_end,
        'amountMinor', pp.amount_minor, 'currencyCode', pp.currency_code,
        'paidMinor', CASE WHEN pp.paid_via = 'online' THEN (SELECT NULLIF(sum(a.amount_minor), 0) FROM public.stay_payment_attempts a
                                                             WHERE a.group_id = pp.group_id AND a.state = 'succeeded') END,
        'paidAt', pp.paid_at, 'paidVia', pp.paid_via)
        ORDER BY pp.period_start DESC)
      FROM public.venue_membership_periods pp
      WHERE pp.subscription_id = v_sub.id AND pp.status = 'paid'), '[]'::jsonb),
    'memberPath', '/visit/plan/' || v_sub.id,
    'version', v_sub.version,
    'createdAt', v_sub.created_at);
  IF p_view = 'guest' AND p_qr_pepper IS NOT NULL AND v_sub.status <> 'cancelled' THEN
    v_result := v_result || jsonb_build_object('pass', jsonb_build_object(
      'qrPayload', public.issue_4490_member_qr_payload(v_sub.id, v_sub.qr_token_hash, p_qr_pepper),
      'valid', v_can_enter));
  END IF;
  IF p_view = 'host' THEN
    v_result := v_result || jsonb_build_object(
      'email', v_sub.member_email,
      'phone', v_sub.member_phone,
      'signedIn', v_sub.user_id IS NOT NULL,
      'periods', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'periodId', p.id, 'sequence', p.sequence, 'start', p.period_start, 'end', p.period_end,
          'amountMinor', p.amount_minor, 'currencyCode', p.currency_code, 'dueAt', p.due_at, 'status', p.status,
          'paidAt', p.paid_at, 'paidVia', p.paid_via, 'paidMethod', p.paid_method, 'remindersSent', to_jsonb(p.reminder_steps))
          ORDER BY p.period_start DESC)
        FROM public.venue_membership_periods p WHERE p.subscription_id = v_sub.id), '[]'::jsonb),
      'timeline', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'type', e.event_type, 'by', e.actor_type, 'at', e.created_at, 'periodId', e.period_id, 'detail', e.detail)
          ORDER BY e.created_at, e.id)
        FROM public.venue_membership_events e WHERE e.subscription_id = v_sub.id), '[]'::jsonb),
      'visits', COALESCE((SELECT jsonb_agg(jsonb_build_object('localDate', x.local_date, 'guests', x.guests,
          'at', x.created_at, 'undone', x.undone_at IS NOT NULL) ORDER BY x.created_at DESC)
        FROM (SELECT * FROM public.venue_member_visits WHERE subscription_id = v_sub.id ORDER BY created_at DESC LIMIT 20) x),
        '[]'::jsonb),
      'credits', (v_result->'credits') || jsonb_build_object(
        'ledger', COALESCE((SELECT jsonb_agg(jsonb_build_object('credit', l.credit, 'entry', l.entry, 'amount', l.amount,
            'at', l.created_at, 'groupId', l.group_id) ORDER BY l.created_at DESC)
          FROM (SELECT * FROM public.venue_credit_ledger WHERE subscription_id = v_sub.id ORDER BY created_at DESC LIMIT 40) l),
          '[]'::jsonb)),
      'canManage', public.issue_4490_user_can_manage_members(v_venue.id, auth.uid()),
      'canManageMoney', public.issue_4490_can_manage_money(v_venue.id, auth.uid()));
  END IF;
  RETURN v_result;
END;
$function$;

-- B6. Host offer list with the opening-hours flag (from 20281203194490).
CREATE OR REPLACE FUNCTION public.issue_4490_list_offers(p_venue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.issue_4490_can_view_venue(p_venue_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'venueId', p_venue_id,
    'canCollectOnline', (SELECT public.issue_4490_can_collect_online(v.brand_id, v.id)
                         FROM public.venue_listings v WHERE v.id = p_venue_id),
    'flags', jsonb_build_object(
      'reads', public.issue_4490_flag_on('VENUE_OFFERS_READS'),
      'writes', public.issue_4490_flag_on('VENUE_OFFERS_WRITES')),
    'settings', (
      SELECT jsonb_build_object(
        'timezone', s.timezone, 'vatMode', s.vat_mode,
        'vatRateBps', (SELECT c.vat_rate_bps FROM public.venue_listings v
                       JOIN public.country_vat_config c ON c.country = upper(v.country_code)
                       WHERE v.id = p_venue_id),
        'instantPaymentHoldMinutes', s.instant_payment_hold_minutes,
        'bookingHorizonDays', s.booking_horizon_days,
        'bookingState', s.booking_state, 'version', s.version)
      FROM public.venue_booking_settings s WHERE s.venue_id = p_venue_id),
    'pools', COALESCE((
      SELECT jsonb_agg(public.issue_4490_pool_projection(p.id) ORDER BY p.created_at)
      FROM public.venue_capacity_pools p
      WHERE p.venue_id = p_venue_id AND p.archived_at IS NULL), '[]'::jsonb),
    'offers', COALESCE((
      -- #4490 fix round 1 (B6, N28): a read flag when the offer sells outside
      -- the venue's opening hours (the offer itself is never changed).
      SELECT jsonb_agg(public.issue_4490_offer_projection(o.id) || public.issue_4490_offer_hours_check(o.id)
                       ORDER BY o.sort_order, o.created_at)
      FROM public.stay_offerings o
      WHERE o.venue_id = p_venue_id AND o.kind NOT IN ('room', 'place', 'membership') AND o.status <> 'archived'), '[]'::jsonb)
  );
END;
$function$;

-- B7. Today with money collected (from 20281203214490).
CREATE OR REPLACE FUNCTION public.issue_4490_venue_day(p_venue_id uuid, p_local_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_tz text;
  v_date date;
BEGIN
  IF auth.uid() IS NULL OR NOT public.issue_4490_can_view_venue(p_venue_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_tz := public.issue_4490_venue_timezone(p_venue_id);
  -- #4490 fix round 1: "today" is the venue's service day (01:30 after a
  -- Friday that closes at 02:00 is still Friday).
  v_date := COALESCE(p_local_date, public.issue_4490_venue_local_date(p_venue_id));
  RETURN jsonb_build_object(
    'venueId', p_venue_id,
    'localDate', v_date,
    'timezone', v_tz,
    'closed', public.issue_4490_day_closed(p_venue_id, v_date),
    'pools', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'poolId', p.id, 'name', p.name,
          'dailyLimit', u.limit_effective, 'keptForWalkIns', u.kept,
          'used', u.used, 'soldOnline', u.used_online, 'soldAtGate', u.used_gate,
          'onlineLeft', u.online_left, 'walkInLeft', u.kept_left, 'gateLeft', u.gate_left,
          'closed', u.closed,
          'override', (SELECT jsonb_build_object('dailyLimit', ov.daily_limit, 'keptForWalkIns', ov.kept_for_walk_ins,
                         'closed', ov.closed, 'version', ov.version)
                       FROM public.venue_capacity_overrides ov WHERE ov.pool_id = p.id AND ov.local_date = v_date))
        ORDER BY p.created_at)
      FROM public.venue_capacity_pools p
      CROSS JOIN LATERAL public.issue_4490_pool_day_usage(p.id, v_date) u
      WHERE p.venue_id = p_venue_id AND p.archived_at IS NULL), '[]'::jsonb),
    'offers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'offerId', o.id, 'name', o.name, 'kind', o.kind, 'entryStyle', o.entry_style, 'status', o.status,
          'poolId', o.capacity_pool_id,
          'sold', COALESCE((
            SELECT sum(c.quantity) FROM public.stay_inventory_commitments c
            JOIN public.stay_place_windows w ON w.id = c.place_window_id
            WHERE c.offering_id = o.id AND c.state = 'active' AND w.local_date = v_date), 0),
          'held', COALESCE((
            SELECT sum(s.quantity) FROM public.stay_inventory_hold_slices s
            JOIN public.stay_inventory_holds h ON h.id = s.hold_id
            JOIN public.stay_place_windows w ON w.id = s.place_window_id
            WHERE s.offering_id = o.id AND w.local_date = v_date
              AND h.state = 'active' AND h.expires_at > now()), 0))
        ORDER BY o.sort_order, o.created_at)
      FROM public.stay_offerings o
      WHERE o.venue_id = p_venue_id AND o.kind NOT IN ('room', 'place', 'membership') AND o.status IN ('live', 'paused')), '[]'::jsonb),
    -- #4490 P6: members checked in that day.
    'membersIn', (SELECT count(*) FROM public.venue_member_visits x
                  JOIN public.venue_membership_subscriptions s ON s.id = x.subscription_id
                  JOIN public.venue_membership_plans p ON p.id = s.plan_id
                  JOIN public.stay_offerings o ON o.id = p.offering_id
                  WHERE o.venue_id = p_venue_id AND x.local_date = v_date AND x.undone_at IS NULL),
    'checkIn', (
      SELECT jsonb_build_object(
        'passes', count(*),
        'expected', COALESCE(sum(p.admits) FILTER (WHERE p.status = 'valid'), 0),
        'admitted', COALESCE(sum(p.admitted_count), 0))
      FROM public.venue_passes p WHERE p.venue_id = p_venue_id AND p.valid_local_date = v_date),
    -- #4490 fix round 1 (B7, N47): money that came in on this service day,
    -- whatever day it is for (deposits for later dates and membership months
    -- included, refunds made that day taken off). "Taken today" on the Host
    -- is the value of the bookings FOR this day; both are shown.
    'collectedToday', public.issue_4490_collected_on(p_venue_id, v_date),
    'collectedTodayMinor', (public.issue_4490_collected_on(p_venue_id, v_date)->>'netMinor')::bigint,
    'bookings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'groupId', g.id, 'reference', g.public_reference, 'state', g.state,
          'guestName', g.guest_snapshot->>'name', 'guests', (SELECT sum(public.issue_4490_line_guests(l.id))
            FROM public.stay_reservation_lines l WHERE l.group_id = g.id),
          'offerKind', g.offer_kind,
          'startsAt', (SELECT w.starts_at FROM public.stay_place_windows w WHERE w.id = public.issue_4490_group_window_id(g.id)),
          'balanceDueMinor', (SELECT m.balance FROM public.issue_4490_booking_money(g.id) m),
          'balanceDueAt', g.balance_due_at,
          'totalMinor', g.total_minor, 'currencyCode', g.currency_code,
          'source', g.booking_source, 'paymentCollection', g.payment_collection,
          'admittedCount', (SELECT p.admitted_count FROM public.venue_passes p WHERE p.group_id = g.id),
          'createdAt', g.created_at)
        ORDER BY g.created_at DESC)
      FROM public.stay_reservation_groups g
      WHERE g.venue_id = p_venue_id AND g.offer_kind IS NOT NULL AND g.offer_kind <> 'membership'
        AND g.state IN ('confirmed', 'partially_cancelled', 'cancelled', 'reconciliation_required', 'instant_payment_pending')
        AND (SELECT w.local_date FROM public.stay_place_windows w
             WHERE w.id = public.issue_4490_group_window_id(g.id)) = v_date), '[]'::jsonb)
  );
END;
$function$;

COMMIT;
