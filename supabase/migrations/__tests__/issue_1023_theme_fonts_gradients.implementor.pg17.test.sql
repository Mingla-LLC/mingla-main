-- MINGLA-INVARIANT: I-1023-GRADIENT-COLUMNS-CARRIED | issue #1023 | Every theme writer and public reader carries the gradient beside the colour, and the font CHECKs accept a Google family name shape while refusing anything else.
--
-- Regression for 20280430011023_issue_1023_theme_fonts_and_gradients.sql.
-- Runs after the full replay. Transactional: BEGIN … ROLLBACK.
--
--   T-1  font CHECKs (brands, events, venue_listings) accept 'Roboto Slab' and
--        'inter', refuse lower case, double space, underscore, 41 chars, ';'
--   T-2  gradient CHECKs accept '#ff8a3b,#ff2e63', refuse partial shapes
--   T-3  business_create_event_draft writes the gradient; update_event_draft
--        rewrites it and clears it when the key is omitted; duplicate copies it
--   T-4  admin_update_brand writes theme_gradient
--   T-5  ari_update_brand_context writes the pair, accepts a Google family,
--        refuses color2 without color, clears the pair when color2 is absent
--   T-6  pg_public_event_by_slug returns themeGradientOverride and
--        brand.themeGradient; the other payload RPCs carry the same keys
--   T-7  the three views end with the new columns and keep security_invoker
--   T-8  brand_context_revision ignores a NULL gradient (unchanged revision)
--        and changes when one is set
--   T-9  anon can read events.theme_gradient_override exactly like
--        theme_color_override (#2489 column-scoped grants)
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES
  ('00000000-1023-4200-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'owner-1023w2@example.test', now(), now()),
  ('00000000-1023-4200-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin-1023w2@example.test', now(), now());
INSERT INTO public.creator_accounts (id, created_at)
VALUES ('00000000-1023-4200-8000-000000000001', now());
INSERT INTO public.admin_users (email, role, status, accepted_at)
VALUES ('admin-1023w2@example.test', 'admin', 'active', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency)
VALUES ('00000000-1023-4200-8000-000000000011', '00000000-1023-4200-8000-000000000001',
        'Issue 1023 Gradient Brand', 'issue-1023-gradient-brand', 'USD');

-- T-1 ------------------------------------------------------------------------
DO $t1$
DECLARE
  v_brand uuid := '00000000-1023-4200-8000-000000000011';
  v_event uuid;
  v_ok text;
  v_bad text;
BEGIN
  INSERT INTO public.events (brand_id, title, slug)
  VALUES (v_brand, 'Font check', 'issue-1023-font-check') RETURNING id INTO v_event;

  FOREACH v_ok IN ARRAY ARRAY['Roboto Slab', 'inter', 'DM Serif Display', 'Zzzz Nope'] LOOP
    UPDATE public.brands SET theme_font = v_ok WHERE id = v_brand;
    UPDATE public.events SET theme_font_override = v_ok WHERE id = v_event;
  END LOOP;

  FOREACH v_bad IN ARRAY ARRAY['roboto slab', 'Roboto  Slab', 'Roboto_Slab',
    repeat('A', 41), 'Inter;drop', ' Inter', 'Inter '] LOOP
    BEGIN
      UPDATE public.brands SET theme_font = v_bad WHERE id = v_brand;
      RAISE EXCEPTION 'T-1 FAIL: brands accepted %', quote_literal(v_bad);
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
      UPDATE public.events SET theme_font_override = v_bad WHERE id = v_event;
      RAISE EXCEPTION 'T-1 FAIL: events accepted %', quote_literal(v_bad);
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;

  IF position('issue_1023_is_theme_font' IN (
       SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conname = 'venue_listings_theme_font_override_whitelist_chk')) = 0 THEN
    RAISE EXCEPTION 'T-1 FAIL: venue_listings font CHECK does not use the helper';
  END IF;
  IF public.issue_1023_is_theme_font('roboto slab')
     OR NOT public.issue_1023_is_theme_font('Roboto Slab') THEN
    RAISE EXCEPTION 'T-1 FAIL: helper shape is wrong';
  END IF;
  RAISE NOTICE 'T-1 PASS';
END $t1$;

-- T-2 ------------------------------------------------------------------------
DO $t2$
DECLARE
  v_brand uuid := '00000000-1023-4200-8000-000000000011';
  v_event uuid := (SELECT id FROM public.events WHERE slug = 'issue-1023-font-check');
  v_bad text;
BEGIN
  UPDATE public.brands SET theme_gradient = '#ff8a3b,#ff2e63' WHERE id = v_brand;
  UPDATE public.events SET theme_gradient_override = '#FF8A3B,#ff2e63' WHERE id = v_event;
  FOREACH v_bad IN ARRAY ARRAY['#ff8a3b', '#ff8a3b,#ff2e6', 'red,blue', '#ff8a3b, #ff2e63', ''] LOOP
    BEGIN
      UPDATE public.brands SET theme_gradient = v_bad WHERE id = v_brand;
      RAISE EXCEPTION 'T-2 FAIL: brands accepted %', quote_literal(v_bad);
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
      UPDATE public.events SET theme_gradient_override = v_bad WHERE id = v_event;
      RAISE EXCEPTION 'T-2 FAIL: events accepted %', quote_literal(v_bad);
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  UPDATE public.brands SET theme_gradient = NULL, theme_font = NULL WHERE id = v_brand;
  RAISE NOTICE 'T-2 PASS';
END $t2$;

-- T-3 ------------------------------------------------------------------------
DO $t3$
DECLARE
  v_user uuid := '00000000-1023-4200-8000-000000000001';
  v_brand uuid := '00000000-1023-4200-8000-000000000011';
  v_event uuid;
  v_copy uuid;
  v_payload jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  v_payload := jsonb_build_object(
    'title', 'Berry night', 'timezone', 'Africa/Lagos', 'currency', 'USD',
    'theme_color_override', '#e8508f', 'theme_gradient_override', '#e8508f,#7c5cff',
    'theme_font_override', 'Roboto Slab',
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'requestedVisibility', 'public', 'clientRevision', 0)));
  v_event := ((public.business_create_event_draft(v_brand, v_payload))#>>'{event,id}')::uuid;
  IF (SELECT theme_gradient_override FROM public.events WHERE id = v_event) IS DISTINCT FROM '#e8508f,#7c5cff'
     OR (SELECT theme_font_override FROM public.events WHERE id = v_event) IS DISTINCT FROM 'Roboto Slab' THEN
    RAISE EXCEPTION 'T-3 FAIL: create did not store the gradient and family';
  END IF;

  v_copy := ((public.business_duplicate_event_as_draft(v_event))#>>'{event,id}')::uuid;
  IF v_copy IS NULL THEN
    SELECT id INTO v_copy FROM public.events
    WHERE brand_id = v_brand AND id <> v_event AND title LIKE 'Berry night%'
    ORDER BY created_at DESC LIMIT 1;
  END IF;
  IF (SELECT theme_gradient_override FROM public.events WHERE id = v_copy) IS DISTINCT FROM '#e8508f,#7c5cff' THEN
    RAISE EXCEPTION 'T-3 FAIL: duplicate did not copy the gradient';
  END IF;

  v_payload := v_payload
    || jsonb_build_object('theme_color_override', '#ff8a3b', 'theme_gradient_override', '#ff8a3b,#ff2e63');
  PERFORM public.business_update_event_draft(v_event, v_payload, 0);
  IF (SELECT theme_gradient_override FROM public.events WHERE id = v_event) IS DISTINCT FROM '#ff8a3b,#ff2e63' THEN
    RAISE EXCEPTION 'T-3 FAIL: update did not rewrite the gradient';
  END IF;

  v_payload := (v_payload - 'theme_gradient_override')
    || jsonb_build_object('theme', jsonb_build_object('business_draft', jsonb_build_object(
      'requestedVisibility', 'public', 'clientRevision', 1)));
  PERFORM public.business_update_event_draft(v_event, v_payload, 1);
  IF (SELECT theme_gradient_override FROM public.events WHERE id = v_event) IS NOT NULL THEN
    RAISE EXCEPTION 'T-3 FAIL: an omitted gradient key did not clear the column (colour semantics)';
  END IF;
  RAISE NOTICE 'T-3 PASS';
END $t3$;

-- T-4 ------------------------------------------------------------------------
DO $t4$
DECLARE
  v_admin uuid := '00000000-1023-4200-8000-000000000002';
  v_brand uuid := '00000000-1023-4200-8000-000000000011';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin)::text, true);
  PERFORM public.admin_update_brand(v_brand,
    jsonb_build_object('theme_color', '#ff8a3b', 'theme_gradient', '#ff8a3b,#ff2e63'), 'issue 1023 test');
  IF (SELECT theme_gradient FROM public.brands WHERE id = v_brand) IS DISTINCT FROM '#ff8a3b,#ff2e63' THEN
    RAISE EXCEPTION 'T-4 FAIL: admin_update_brand did not write theme_gradient';
  END IF;
  BEGIN
    PERFORM public.admin_update_brand(v_brand, jsonb_build_object('theme_gradient', 'nope'), NULL);
    RAISE EXCEPTION 'T-4 FAIL: a malformed gradient was saved';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM public.admin_update_brand(v_brand, jsonb_build_object('theme_gradient', ''), NULL);
  IF (SELECT theme_gradient FROM public.brands WHERE id = v_brand) IS NOT NULL THEN
    RAISE EXCEPTION 'T-4 FAIL: a blank gradient did not clear the column';
  END IF;
  UPDATE public.brands SET theme_color = NULL WHERE id = v_brand;
  RAISE NOTICE 'T-4 PASS';
END $t4$;

-- T-5 ------------------------------------------------------------------------
DO $t5$
DECLARE
  v_owner uuid := '00000000-1023-4200-8000-000000000001';
  v_admin uuid := '00000000-1023-4200-8000-000000000002';
  v_brand uuid := '00000000-1023-4200-8000-000000000011';
  v_conversation uuid := '00000000-1023-4200-8000-000000000021';
  v_op uuid;
  v_rev text;
  v_plan integer := 1;
  v_patch jsonb;
  v_args jsonb;
  v_failed boolean;
BEGIN
  INSERT INTO public.agent_conversations (id, user_id, brand_id) VALUES (v_conversation, v_owner, v_brand);
  DELETE FROM public.brand_site_service_config;
  INSERT INTO public.brand_site_service_config (
    config_key, cms_origin, public_runtime_origin, public_host_suffix,
    configured_by, configured_at, updated_by, updated_at
  ) VALUES (
    'sites_v1', 'https://studio.sites.usemingla.com', 'https://www.sites.usemingla.com',
    'sites.usemingla.com', v_admin, now(), v_admin, now());
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.brand_site_admin_grant(v_brand, 'rollout', NULL);
  INSERT INTO public.brand_site_plans (brand_id, revision, offerings_selected, story, started_by, updated_by)
  VALUES (v_brand, 1, ARRAY[]::text[],
    '{"who":"Neighbours","why":"Owner-led nights","main_action":"Join the next event"}', v_owner, v_owner);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);

  -- (a) the pair and a Google family are written as one unit.
  v_patch := jsonb_build_object('theme', jsonb_build_object(
    'color', '#E8508F', 'color2', '#7C5CFF', 'font', 'Roboto Slab', 'animation', 'aurora'));
  v_rev := public.brand_context_completeness_internal(v_brand)->>'context_revision';
  v_op := gen_random_uuid();
  v_args := jsonb_build_object('brand_id', v_brand, 'expected_plan_revision', v_plan,
    'expected_context_revision', v_rev, 'patch', v_patch, 'exceptions', '[]'::jsonb,
    'evidence', '{"source_type":"owner"}'::jsonb);
  INSERT INTO public.agent_pending_actions (id, user_id, conversation_id, tool_name, tool_args, status,
    source, related_brand_id, server_proposed_at, execution_attested_at)
  VALUES (v_op, v_owner, v_conversation, 'update_brand_context', v_args, 'executing', 'ari', v_brand, now(), now());
  PERFORM public.ari_update_brand_context(v_op, v_brand, v_plan, v_rev, v_patch, '[]'::jsonb,
    '{"source_type":"owner"}'::jsonb);
  v_plan := v_plan + 1;
  IF (SELECT theme_gradient FROM public.brands WHERE id = v_brand) IS DISTINCT FROM '#e8508f,#7c5cff'
     OR (SELECT theme_font FROM public.brands WHERE id = v_brand) IS DISTINCT FROM 'Roboto Slab' THEN
    RAISE EXCEPTION 'T-5 FAIL: ari did not write the gradient pair and the family: %',
      (SELECT to_jsonb(b) - 'social_links' FROM public.brands b WHERE id = v_brand);
  END IF;
  IF (public.brand_context_completeness_internal(v_brand)->'fields') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(public.brand_context_completeness_internal(v_brand)->'fields') f
       WHERE f->>'field_key' = 'theme' AND (f->'value'->>'gradient') IS DISTINCT FROM '#e8508f,#7c5cff') THEN
    RAISE EXCEPTION 'T-5 FAIL: completeness evidence does not carry the gradient';
  END IF;

  -- (b) color2 without color is refused.
  v_patch := jsonb_build_object('theme', jsonb_build_object('color2', '#7c5cff'));
  v_rev := public.brand_context_completeness_internal(v_brand)->>'context_revision';
  v_op := gen_random_uuid();
  v_args := jsonb_build_object('brand_id', v_brand, 'expected_plan_revision', v_plan,
    'expected_context_revision', v_rev, 'patch', v_patch, 'exceptions', '[]'::jsonb,
    'evidence', '{"source_type":"owner"}'::jsonb);
  INSERT INTO public.agent_pending_actions (id, user_id, conversation_id, tool_name, tool_args, status,
    source, related_brand_id, server_proposed_at, execution_attested_at)
  VALUES (v_op, v_owner, v_conversation, 'update_brand_context', v_args, 'executing', 'ari', v_brand, now(), now());
  v_failed := false;
  BEGIN
    PERFORM public.ari_update_brand_context(v_op, v_brand, v_plan, v_rev, v_patch, '[]'::jsonb,
      '{"source_type":"owner"}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'invalid_theme';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'T-5 FAIL: color2 without color was not refused as invalid_theme';
  END IF;

  -- (c) a solid colour clears the stored pair.
  v_patch := jsonb_build_object('theme', jsonb_build_object('color', '#ff5a5f', 'font', 'inter'));
  v_op := gen_random_uuid();
  v_args := jsonb_build_object('brand_id', v_brand, 'expected_plan_revision', v_plan,
    'expected_context_revision', v_rev, 'patch', v_patch, 'exceptions', '[]'::jsonb,
    'evidence', '{"source_type":"owner"}'::jsonb);
  INSERT INTO public.agent_pending_actions (id, user_id, conversation_id, tool_name, tool_args, status,
    source, related_brand_id, server_proposed_at, execution_attested_at)
  VALUES (v_op, v_owner, v_conversation, 'update_brand_context', v_args, 'executing', 'ari', v_brand, now(), now());
  PERFORM public.ari_update_brand_context(v_op, v_brand, v_plan, v_rev, v_patch, '[]'::jsonb,
    '{"source_type":"owner"}'::jsonb);
  IF (SELECT theme_gradient FROM public.brands WHERE id = v_brand) IS NOT NULL
     OR (SELECT theme_color FROM public.brands WHERE id = v_brand) IS DISTINCT FROM '#ff5a5f' THEN
    RAISE EXCEPTION 'T-5 FAIL: a solid theme patch did not clear the gradient';
  END IF;
  RAISE NOTICE 'T-5 PASS';
END $t5$;

-- T-6 ------------------------------------------------------------------------
DO $t6$
DECLARE
  v_brand uuid := '00000000-1023-4200-8000-000000000011';
  v_event uuid;
  v_payload jsonb;
  v_fn text;
BEGIN
  UPDATE public.brands SET theme_color = '#e8508f', theme_gradient = '#e8508f,#7c5cff' WHERE id = v_brand;
  INSERT INTO public.events (brand_id, title, slug, visibility, status,
    theme_color_override, theme_gradient_override)
  VALUES (v_brand, 'Payload night', 'issue-1023-payload', 'public', 'scheduled',
    '#22c55e', '#22c55e,#2da8ff')
  RETURNING id INTO v_event;
  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
  VALUES (v_event, now() + interval '7 days', now() + interval '7 days 3 hours', 'UTC', true);

  v_payload := public.pg_public_event_by_slug('issue-1023-gradient-brand', 'issue-1023-payload')::jsonb;
  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'T-6 FAIL: the fixture event did not resolve';
  END IF;
  IF v_payload->>'themeGradientOverride' IS DISTINCT FROM '#22c55e,#2da8ff'
     OR v_payload#>>'{brand,themeGradient}' IS DISTINCT FROM '#e8508f,#7c5cff'
     OR v_payload->>'themeColorOverride' IS DISTINCT FROM '#22c55e'
     OR v_payload#>>'{brand,themeColor}' IS DISTINCT FROM '#e8508f' THEN
    RAISE EXCEPTION 'T-6 FAIL: event payload theme keys are wrong: %',
      jsonb_build_object('o', v_payload->'themeGradientOverride', 'b', v_payload->'brand');
  END IF;

  FOREACH v_fn IN ARRAY ARRAY['pg_public_rsvp_by_slug', 'pg_public_experience_by_slug',
    'pg_public_trip_by_slug'] LOOP
    IF position('''themeGradientOverride''' IN (SELECT prosrc FROM pg_proc WHERE proname = v_fn)) = 0
       OR position('''themeGradient'', ' IN (SELECT prosrc FROM pg_proc WHERE proname = v_fn)) = 0 THEN
      RAISE EXCEPTION 'T-6 FAIL: % does not carry the gradient keys', v_fn;
    END IF;
  END LOOP;
  IF position('THEN e.theme_gradient_override ELSE b.theme_gradient END' IN
       (SELECT prosrc FROM pg_proc WHERE proname = 'pg_ticket_link_resolve')) = 0 THEN
    RAISE EXCEPTION 'T-6 FAIL: pg_ticket_link_resolve does not pick the gradient from the colour''s level';
  END IF;
  RAISE NOTICE 'T-6 PASS';
END $t6$;

-- T-7 ------------------------------------------------------------------------
DO $t7$
DECLARE
  v_last text;
BEGIN
  -- [TEST-MOD-APPROVED #4334] 20280521004334 appends location_provider_place_id after
  -- the gradient pair; the pair keeps its positions (74, 75), now checked one deeper.
  SELECT string_agg(attname, ',' ORDER BY attnum DESC) FILTER (WHERE rn <= 3) INTO v_last
  FROM (SELECT attname, attnum, row_number() OVER (ORDER BY attnum DESC) rn
        FROM pg_attribute WHERE attrelid = 'public.business_public_events_view'::regclass
          AND attnum > 0 AND NOT attisdropped) a;
  IF v_last IS DISTINCT FROM 'location_provider_place_id,theme_gradient_override,brand_theme_gradient' THEN
    RAISE EXCEPTION 'T-7 FAIL: business_public_events_view ends with %', v_last;
  END IF;
  IF (SELECT attname FROM pg_attribute WHERE attrelid = 'public.business_public_brands_view'::regclass
        AND attnum > 0 AND NOT attisdropped ORDER BY attnum DESC LIMIT 1) <> 'theme_gradient'
     OR (SELECT attname FROM pg_attribute WHERE attrelid = 'public.business_management_events_view'::regclass
        AND attnum > 0 AND NOT attisdropped ORDER BY attnum DESC LIMIT 1) <> 'theme_gradient_override' THEN
    RAISE EXCEPTION 'T-7 FAIL: a view does not end with its gradient column';
  END IF;
  -- Re-creating a view without WITH resets its options; production has these.
  IF (SELECT reloptions FROM pg_class WHERE oid = 'public.business_management_events_view'::regclass)
       IS DISTINCT FROM ARRAY['security_invoker=true']
     OR (SELECT reloptions FROM pg_class WHERE oid = 'public.business_public_events_view'::regclass)
       IS DISTINCT FROM ARRAY['security_invoker=false'] THEN
    RAISE EXCEPTION 'T-7 FAIL: a view lost its security_invoker option';
  END IF;
  RAISE NOTICE 'T-7 PASS';
END $t7$;

-- T-8 ------------------------------------------------------------------------
DO $t8$
DECLARE
  v_brand uuid := '00000000-1023-4200-8000-000000000011';
  v_without text;
  v_with text;
BEGIN
  UPDATE public.brands SET theme_gradient = NULL WHERE id = v_brand;
  v_without := public.brand_context_revision(v_brand);
  IF position('theme_gradient' IN (SELECT prosrc FROM pg_proc WHERE proname = 'brand_context_revision')) = 0 THEN
    RAISE EXCEPTION 'T-8 FAIL: the revision does not hash the gradient';
  END IF;
  UPDATE public.brands SET theme_gradient = '#e8508f,#7c5cff' WHERE id = v_brand;
  v_with := public.brand_context_revision(v_brand);
  IF v_with = v_without THEN
    RAISE EXCEPTION 'T-8 FAIL: setting a gradient did not change the revision';
  END IF;
  UPDATE public.brands SET theme_gradient = NULL WHERE id = v_brand;
  IF public.brand_context_revision(v_brand) <> v_without THEN
    RAISE EXCEPTION 'T-8 FAIL: clearing the gradient did not restore the revision';
  END IF;
  RAISE NOTICE 'T-8 PASS';
END $t8$;

-- T-9 ------------------------------------------------------------------------
DO $t9$
BEGIN
  IF NOT has_column_privilege('anon', 'public.events', 'theme_gradient_override', 'SELECT')
     OR NOT has_column_privilege('anon', 'public.events', 'theme_color_override', 'SELECT') THEN
    RAISE EXCEPTION 'T-9 FAIL: anon cannot read the gradient override the way it reads the colour';
  END IF;
  RAISE NOTICE 'T-9 PASS';
END $t9$;

ROLLBACK;
