-- #3682 Wave 2.8b — Invite Followers / Friends of followers at creation (surface I).
-- Widens biz_replace_offering_invite_plan_v1 selection to two boolean sources that
-- resolve through issue_1777_resolve_brand_circle_members into brand_people
-- (ensuring a linked person row when missing). Muted followers are skipped.
-- business_wizard_invite_selection_v1 stays default-off (ops flip).

BEGIN;

CREATE OR REPLACE FUNCTION private.issue_3682_ensure_person_for_user(
  p_brand_id uuid,
  p_user_id uuid,
  p_display_name text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_person uuid;
  v_name text := COALESCE(NULLIF(btrim(p_display_name), ''), 'Guest');
BEGIN
  SELECT bp.id INTO v_person
    FROM public.brand_people bp
   WHERE bp.brand_id = p_brand_id
     AND bp.linked_user_id = p_user_id
     AND bp.record_status = 'active'
   ORDER BY bp.created_at ASC
   LIMIT 1;
  IF v_person IS NOT NULL THEN
    RETURN v_person;
  END IF;
  BEGIN
    INSERT INTO public.brand_people(brand_id, linked_user_id, display_name)
    VALUES (p_brand_id, p_user_id, v_name)
    RETURNING id INTO v_person;
  EXCEPTION WHEN unique_violation THEN
    SELECT bp.id INTO v_person
      FROM public.brand_people bp
     WHERE bp.brand_id = p_brand_id
       AND bp.linked_user_id = p_user_id
       AND bp.record_status = 'active'
     LIMIT 1;
  END;
  RETURN v_person;
END;
$fn$;

REVOKE ALL ON FUNCTION private.issue_3682_ensure_person_for_user(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

-- Resolve circle invite sources to brand_people ids.
-- Followers: 1777 follower ring (excludes book) UNION book-linked followers
--   (1777 subtracts book for blast partitioning; invites still want them).
-- Friends of followers: 1777 extended ring as-is.
-- Muted followers are skipped on both paths.
CREATE OR REPLACE FUNCTION private.issue_3682_circle_invite_person_ids(
  p_brand_id uuid,
  p_rings text[]
) RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_ring text;
  v_uid uuid;
  v_name text;
  v_person uuid;
BEGIN
  IF p_rings IS NULL OR cardinality(p_rings) = 0 THEN
    RETURN;
  END IF;
  FOREACH v_ring IN ARRAY p_rings LOOP
    IF v_ring NOT IN ('follower', 'extended') THEN
      RAISE EXCEPTION 'wizard_invite_selection_invalid' USING ERRCODE = '22023';
    END IF;

    FOR v_uid, v_name IN
      SELECT r.user_id,
             COALESCE(NULLIF(btrim(r.display_name), ''), 'Guest')
        FROM public.issue_1777_resolve_brand_circle_members(p_brand_id, v_ring, NULL) r
       WHERE NOT EXISTS (
         SELECT 1
           FROM public.brand_follows bf
          WHERE bf.brand_id = p_brand_id
            AND bf.user_id = r.user_id
            AND bf.muted_until IS NOT NULL
            AND bf.muted_until > now()
       )
    LOOP
      v_person := private.issue_3682_ensure_person_for_user(p_brand_id, v_uid, v_name);
      IF v_person IS NOT NULL THEN
        RETURN NEXT v_person;
      END IF;
    END LOOP;

    IF v_ring = 'follower' THEN
      FOR v_person IN
        SELECT bp.id
          FROM public.brand_follows bf
          JOIN public.brand_people bp
            ON bp.brand_id = p_brand_id
           AND bp.linked_user_id = bf.user_id
           AND bp.record_status = 'active'
         WHERE bf.brand_id = p_brand_id
           AND (bf.muted_until IS NULL OR bf.muted_until <= now())
           AND NOT EXISTS (
             SELECT 1 FROM public.brand_circle_exits bx
              WHERE bx.brand_id = p_brand_id
                AND bx.user_id = bf.user_id
                AND bx.visibility_exited_at IS NOT NULL
           )
      LOOP
        RETURN NEXT v_person;
      END LOOP;
    END IF;
  END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION private.issue_3682_circle_invite_person_ids(uuid, text[])
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.biz_replace_offering_invite_plan_v1(
  p_event_id uuid, p_selection jsonb, p_expected_revision bigint, p_client_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE
  v_actor uuid := auth.uid(); v_scope record; v_plan private.brand_offering_invite_plans%ROWTYPE;
  v_plan_id uuid;
  v_ids uuid[] := '{}'; v_explicit uuid[] := '{}'; v_excluded uuid[] := '{}';
  v_groups uuid[] := '{}'; v_everyone boolean; v_followers boolean; v_friends boolean;
  v_request_hash text; v_prior private.brand_offering_invite_mutation_receipts%ROWTYPE; v_result jsonb;
  v_rings text[] := '{}'; v_keys text[]; v_flags boolean;
BEGIN
  SELECT * INTO v_scope FROM private.issue_1780_event_scope(p_event_id, v_actor);
  IF p_client_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR jsonb_typeof(p_selection) <> 'object' THEN
    RAISE EXCEPTION 'wizard_invite_selection_invalid' USING ERRCODE = '22023';
  END IF;
  -- Accept legacy four-key Host payloads (new booleans default false) and the
  -- six-key shape; reject any other key set so unknown fields cannot sneak in.
  SELECT array_agg(k ORDER BY k) INTO v_keys FROM jsonb_object_keys(p_selection) k;
  IF v_keys = ARRAY[
       'excludedPersonIds', 'includeEveryone', 'manualGroupIds', 'personIds'
     ]::text[] THEN
    p_selection := p_selection || jsonb_build_object(
      'includeFollowers', false,
      'includeFriendsOfFollowers', false);
  ELSIF v_keys IS DISTINCT FROM ARRAY[
       'excludedPersonIds',
       'includeEveryone',
       'includeFollowers',
       'includeFriendsOfFollowers',
       'manualGroupIds',
       'personIds'
     ]::text[] THEN
    RAISE EXCEPTION 'wizard_invite_selection_invalid' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_selection -> 'manualGroupIds') <> 'array'
     OR jsonb_typeof(p_selection -> 'personIds') <> 'array'
     OR jsonb_typeof(p_selection -> 'excludedPersonIds') <> 'array'
     OR jsonb_typeof(p_selection -> 'includeEveryone') <> 'boolean'
     OR jsonb_typeof(p_selection -> 'includeFollowers') <> 'boolean'
     OR jsonb_typeof(p_selection -> 'includeFriendsOfFollowers') <> 'boolean' THEN
    RAISE EXCEPTION 'wizard_invite_selection_invalid' USING ERRCODE = '22023';
  END IF;
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT x::uuid ORDER BY x::uuid), '{}') INTO v_explicit
      FROM jsonb_array_elements_text(p_selection -> 'personIds') x;
    SELECT COALESCE(array_agg(DISTINCT x::uuid ORDER BY x::uuid), '{}') INTO v_groups
      FROM jsonb_array_elements_text(p_selection -> 'manualGroupIds') x;
    SELECT COALESCE(array_agg(DISTINCT x::uuid ORDER BY x::uuid), '{}') INTO v_excluded
      FROM jsonb_array_elements_text(p_selection -> 'excludedPersonIds') x;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'wizard_invite_selection_invalid' USING ERRCODE = '22023';
  END;
  v_everyone := (p_selection ->> 'includeEveryone')::boolean;
  v_followers := (p_selection ->> 'includeFollowers')::boolean;
  v_friends := (p_selection ->> 'includeFriendsOfFollowers')::boolean;
  IF v_followers THEN
    v_rings := array_append(v_rings, 'follower');
  END IF;
  IF v_friends THEN
    v_rings := array_append(v_rings, 'extended');
  END IF;
  v_request_hash := encode(extensions.digest(convert_to(
    jsonb_build_object('expectedRevision', p_expected_revision, 'selection', p_selection)::text, 'UTF8'), 'sha256'), 'hex');
  -- One event lock serializes both receipt replay and first-plan creation;
  -- request-scoped locks would allow two revision-0 inserts to overwrite.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text, 1780));
  SELECT * INTO v_prior FROM private.brand_offering_invite_mutation_receipts
    WHERE event_id = p_event_id AND client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_prior.actor_id <> v_actor OR v_prior.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'wizard_invite_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN v_prior.response_json || jsonb_build_object('replayed', true);
  END IF;
  IF v_scope.event_deleted OR v_scope.event_status <> 'draft' OR v_scope.event_visibility <> 'draft' THEN
    RAISE EXCEPTION 'wizard_invite_offering_not_draft' USING ERRCODE = '55000';
  END IF;
  IF NOT COALESCE((SELECT is_enabled FROM public.feature_flags
      WHERE flag_key = 'business_wizard_invite_selection_v1'), false) THEN
    RAISE EXCEPTION 'wizard_invite_feature_disabled' USING ERRCODE = '55000';
  END IF;
  -- Same rollout flags as issue_1777_brand_reach_scope_status — do not expand
  -- circle sources while that ring's reach is intentionally unavailable.
  -- Live resolve (not sealed materialization) so refresh_pending is not required.
  IF v_followers THEN
    SELECT count(*) = 1 AND bool_and(is_enabled) INTO v_flags
      FROM public.feature_flags WHERE flag_key = 'brand_circle_followers_v1';
    IF NOT COALESCE(v_flags, false) THEN
      RAISE EXCEPTION 'wizard_invite_circle_unavailable' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF v_friends THEN
    SELECT count(*) = 3 AND bool_and(is_enabled) INTO v_flags
      FROM public.feature_flags
     WHERE flag_key IN (
       'brand_circle_extended_v1',
       'brand_circle_extended_controls_ios_v1',
       'brand_circle_extended_controls_android_v1');
    IF NOT COALESCE(v_flags, false) THEN
      RAISE EXCEPTION 'wizard_invite_circle_unavailable' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(v_groups) gid LEFT JOIN public.marketing_audiences a
      ON a.id = gid AND a.brand_id = v_scope.brand_id AND a.deleted_at IS NULL
      AND NOT a.is_system_generated AND a.query_definition = '{"kind":"manual_group"}'::jsonb
      WHERE a.id IS NULL)
     OR EXISTS(SELECT 1 FROM unnest(v_explicit || v_excluded) pid LEFT JOIN public.brand_people bp
      ON bp.id = pid AND bp.brand_id = v_scope.brand_id AND bp.record_status = 'active' WHERE bp.id IS NULL) THEN
    RAISE EXCEPTION 'wizard_invite_selection_stale' USING ERRCODE = '40001';
  END IF;
  SELECT COALESCE(array_agg(id ORDER BY id), '{}') INTO v_ids FROM (
    SELECT bp.id FROM public.brand_people bp
      WHERE v_everyone AND bp.brand_id = v_scope.brand_id AND bp.record_status = 'active'
    UNION
    SELECT bp.id FROM unnest(v_explicit) requested(id)
      JOIN public.brand_people bp ON bp.id = requested.id AND bp.brand_id = v_scope.brand_id AND bp.record_status = 'active'
    UNION
    SELECT bp.id FROM public.marketing_manual_group_memberships gm
      JOIN public.brand_people bp ON bp.id = gm.brand_person_id AND bp.brand_id = gm.brand_id AND bp.record_status = 'active'
      WHERE gm.audience_id = ANY (v_groups) AND gm.brand_id = v_scope.brand_id AND gm.state = 'active'
    UNION
    SELECT person_id FROM private.issue_3682_circle_invite_person_ids(v_scope.brand_id, v_rings) person_id
  ) selected WHERE NOT (id = ANY (v_excluded));
  IF cardinality(v_ids) > 500 THEN RAISE EXCEPTION 'wizard_invite_selection_too_large' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_plan FROM private.brand_offering_invite_plans WHERE event_id = p_event_id FOR UPDATE;
  IF FOUND AND v_plan.state = 'locked' THEN RAISE EXCEPTION 'wizard_invite_plan_locked' USING ERRCODE = '55000'; END IF;
  IF COALESCE(v_plan.selection_revision, 0) <> p_expected_revision THEN
    RAISE EXCEPTION 'wizard_invite_revision_conflict' USING ERRCODE = '40001',
      DETAIL = jsonb_build_object('currentRevision', COALESCE(v_plan.selection_revision, 0))::text;
  END IF;
  INSERT INTO private.brand_offering_invite_plans(
    event_id, brand_id, event_type, selection_revision, selection_hash, created_by, updated_by)
  VALUES (p_event_id, v_scope.brand_id, v_scope.event_type, p_expected_revision + 1,
    private.issue_1780_selection_hash(v_ids), v_actor, v_actor)
  ON CONFLICT (event_id) DO UPDATE SET
    selection_revision = EXCLUDED.selection_revision,
    selection_hash = EXCLUDED.selection_hash, updated_by = EXCLUDED.updated_by, updated_at = now()
  RETURNING id INTO v_plan_id;
  DELETE FROM private.brand_offering_invite_plan_members
  WHERE plan_id = v_plan_id;
  INSERT INTO private.brand_offering_invite_plan_members(
    plan_id, brand_person_id, added_by)
  SELECT v_plan_id, id, v_actor FROM unnest(v_ids) selected(id);
  v_result := private.issue_1780_plan_response(p_event_id) || jsonb_build_object('replayed', false);
  INSERT INTO private.brand_offering_invite_mutation_receipts(event_id, client_request_id, actor_id, request_hash, response_json)
    VALUES (p_event_id, p_client_request_id, v_actor, v_request_hash, v_result);
  RETURN v_result;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.biz_clear_offering_invite_plan_v1(
  p_event_id uuid, p_expected_revision bigint, p_client_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  RETURN public.biz_replace_offering_invite_plan_v1(
    p_event_id, jsonb_build_object(
      'excludedPersonIds', '[]'::jsonb,
      'includeEveryone', false,
      'includeFollowers', false,
      'includeFriendsOfFollowers', false,
      'manualGroupIds', '[]'::jsonb,
      'personIds', '[]'::jsonb),
    p_expected_revision, p_client_request_id);
END;
$fn$;

COMMIT;
