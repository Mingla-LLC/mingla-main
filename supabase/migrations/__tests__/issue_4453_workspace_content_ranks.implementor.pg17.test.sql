\set ON_ERROR_STOP on
-- #4453 Website workspace (20281119014453): executable PostgreSQL 17 proof of
-- the Core ranks, the audit allow-lists and Ari's step events.
-- BEGIN ... ROLLBACK: fixtures roll back.
-- MINGLA-INVARIANT: I-4453-WORKSPACE-ACTIONS-CONTENT-MINIMUM | issue #4453 | The thirteen Website workspace content actions (workspace, page_sections, section_catalog, edit_section, move_section, remove_section, add_section, set_section_media, set_look, set_page_enabled, history, undo, redo) need brand rank 20; every earlier action keeps its rank and an unknown action has none.
-- MINGLA-INVARIANT: I-4453-SITE-STEP-EVENT-SERVICE-ONLY | issue #4453 | A site_step_* activity event with its step index (1 to 8) and label is written only by the service role through issue_4453_append_site_step_event, for the attempt's own user and attempt number; no other event kind carries a step.
--
-- T-1  each new action is rank 20.
-- T-2  earlier ranks are unchanged; an unknown action has none; grants unchanged.
-- T-3  brand_site_content_authorize lets a rank-20 member run a new action and refuses a scanner.
-- T-4  the audit row: pages and look collections, content.undone and content.redone; unknown ones still refused.
-- T-5  step events: kinds accepted, index and label stored in one insert, bounds, authority, grants.
--
-- FAILS-ON-REVERT: drop 20281119014453 -> T-1 (NULL rank), T-4a (sites_validation_failed), T-5a (check_violation).

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4453 workspace ranks FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

-- ── T-1 ────────────────────────────────────────────────────────────────────
SELECT pg_temp.p_assert(public.brand_site_content_min_rank(action) = 20, 'T-1 ' || action || ' is rank 20')
FROM unnest(ARRAY[
  'workspace','page_sections','section_catalog','edit_section','move_section',
  'remove_section','add_section','set_section_media','set_look','set_page_enabled',
  'history','undo','redo'
]) AS action;

-- ── T-2 ────────────────────────────────────────────────────────────────────
SELECT pg_temp.p_assert(public.brand_site_content_min_rank(action) IS NOT DISTINCT FROM want,
  'T-2a ' || action || ' keeps ' || COALESCE(want::text, 'no rank'))
FROM (VALUES
  ('list', 20), ('update', 20), ('delete', 20), ('media_upload_grant', 20), ('set_menu', 20),
  ('set_cover', 20), ('design_checks', 20), ('review_status', 20), ('mark_reviewed', 20),
  ('ari_page_answer', 20), ('ari_page_accept', 20), ('ari_page_remove', 20),
  ('confirm_review', 50), ('set_offering_visibility', 50),
  ('publish', NULL), ('nope', NULL), ('', NULL), ('WORKSPACE', NULL), (' undo', NULL)
) AS cases(action, want);
SELECT pg_temp.p_assert(public.brand_site_content_min_rank(NULL) IS NULL, 'T-2b a missing action has no rank');
SELECT pg_temp.p_assert(
    NOT has_function_privilege('anon', 'public.brand_site_content_min_rank(text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.brand_site_content_min_rank(text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.brand_site_content_record(uuid,uuid,text,text,text,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.brand_site_content_record(uuid,uuid,text,text,text,jsonb)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.brand_site_content_record(uuid,uuid,text,text,text,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.append_agent_activity_event(uuid,uuid,integer,text,timestamptz)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.issue_4453_append_site_step_event(uuid,uuid,integer,text,integer,text,timestamptz)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4453_append_site_step_event(uuid,uuid,integer,text,integer,text,timestamptz)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.issue_4453_append_site_step_event(uuid,uuid,integer,text,integer,text,timestamptz)', 'EXECUTE'),
  'T-2c grants: the rank read is unchanged; the audit row and the step events stay service-role only');
SELECT pg_temp.p_assert(p.prosecdef AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')
    AND p.prosrc !~* '\mEXECUTE\M',
  'T-2d the step event function is SECURITY DEFINER with a pinned search_path and static SQL')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'issue_4453_append_site_step_event';

-- ── Fixtures ───────────────────────────────────────────────────────────────
INSERT INTO auth.users(id, email) VALUES
  ('44530000-0000-4000-8000-0000000001b1', 'owner-4453r@example.test'),
  ('44530000-0000-4000-8000-0000000001b2', 'marketing-4453r@example.test'),
  ('44530000-0000-4000-8000-0000000001b3', 'scanner-4453r@example.test');
INSERT INTO public.creator_accounts(id, created_at, updated_at)
VALUES ('44530000-0000-4000-8000-0000000001b1', now(), now());
INSERT INTO public.brands(id, account_id, name, slug)
VALUES ('44530000-0000-4000-8000-0000000001e1', '44530000-0000-4000-8000-0000000001b1', 'Ranks Brand 4453', 'ranks-brand-4453');
INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at) VALUES
  ('44530000-0000-4000-8000-0000000001e1', '44530000-0000-4000-8000-0000000001b1', 'brand_owner', now()),
  ('44530000-0000-4000-8000-0000000001e1', '44530000-0000-4000-8000-0000000001b2', 'marketing_manager', now()),
  ('44530000-0000-4000-8000-0000000001e1', '44530000-0000-4000-8000-0000000001b3', 'scanner', now())
ON CONFLICT DO NOTHING;
INSERT INTO public.brand_site_entitlements(brand_id, status, source, granted_at, reason_code)
VALUES ('44530000-0000-4000-8000-0000000001e1', 'granted', 'admin', now(), 'rollout')
ON CONFLICT (brand_id) DO UPDATE SET status = 'granted', granted_at = now(), revoked_at = NULL, revoked_by = NULL;
INSERT INTO public.brand_sites(id, brand_id, created_by)
VALUES ('44530000-0000-4000-8000-0000000001f1', '44530000-0000-4000-8000-0000000001e1', '44530000-0000-4000-8000-0000000001b1');

-- ── T-3 ────────────────────────────────────────────────────────────────────
DO $t$
DECLARE
  v_action text;
  v_result jsonb;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '44530000-0000-4000-8000-0000000001b2', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"44530000-0000-4000-8000-0000000001b2","role":"authenticated"}', true);
  FOREACH v_action IN ARRAY ARRAY['workspace','edit_section','set_look','undo','redo','history'] LOOP
    v_result := public.brand_site_content_authorize('44530000-0000-4000-8000-0000000001f1', v_action);
    IF (v_result->>'rank')::int <> 20 OR (v_result->>'min_rank')::int <> 20 THEN
      RAISE EXCEPTION 'issue #4453 workspace ranks FAIL: T-3a % for a rank-20 member: %', v_action, v_result;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS  T-3a a marketing member (rank 20) may run the workspace actions';
  PERFORM set_config('request.jwt.claim.sub', '44530000-0000-4000-8000-0000000001b3', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"44530000-0000-4000-8000-0000000001b3","role":"authenticated"}', true);
  BEGIN
    PERFORM public.brand_site_content_authorize('44530000-0000-4000-8000-0000000001f1', 'edit_section');
    RAISE EXCEPTION 'issue #4453 workspace ranks FAIL: T-3b a scanner edited a section';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'sites_forbidden' THEN RAISE; END IF;
    RAISE NOTICE 'PASS  T-3b a scanner (rank 10) is refused';
  END;
  RESET ROLE;
END
$t$;

-- ── T-4 ────────────────────────────────────────────────────────────────────
DO $t$
DECLARE
  v_site constant uuid := '44530000-0000-4000-8000-0000000001f1';
  v_actor constant uuid := '44530000-0000-4000-8000-0000000001b2';
  v_case record;
BEGIN
  PERFORM public.brand_site_content_record(v_site, v_actor, 'content.updated', 'pages', 'page-1', '{}'::jsonb);
  PERFORM public.brand_site_content_record(v_site, v_actor, 'content.updated', 'look', NULL, '{}'::jsonb);
  PERFORM public.brand_site_content_record(v_site, v_actor, 'content.undone', 'pages', 'page-1', '{"count":2}'::jsonb);
  PERFORM public.brand_site_content_record(v_site, v_actor, 'content.redone', 'look', NULL, '{}'::jsonb);
  PERFORM public.brand_site_content_record(v_site, v_actor, 'content.reordered', 'navigation', NULL, '{}'::jsonb);
  IF (SELECT count(*) FROM public.brand_site_audit_log
       WHERE site_id = v_site AND actor_user_id = v_actor AND resource_kind = 'site_content') <> 5
     OR NOT EXISTS (SELECT 1 FROM public.brand_site_audit_log
       WHERE site_id = v_site AND action = 'content.undone' AND resource_id = 'pages:page-1'
         AND metadata->>'collection' = 'pages' AND (metadata->>'count')::int = 2) THEN
    RAISE EXCEPTION 'issue #4453 workspace ranks FAIL: T-4a workspace audit rows not written';
  END IF;
  RAISE NOTICE 'PASS  T-4a a workspace change, an undo and a redo are audited';
  FOR v_case IN SELECT * FROM (VALUES
    ('content.exploded', 'pages'), ('content.updated', 'secrets'), ('undo', 'pages'), ('content.undone', 'history')
  ) AS c(action, collection) LOOP
    BEGIN
      PERFORM public.brand_site_content_record(v_site, v_actor, v_case.action, v_case.collection, NULL, '{}'::jsonb);
      RAISE EXCEPTION 'issue #4453 workspace ranks FAIL: T-4b audit accepted %/%', v_case.action, v_case.collection;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'sites_validation_failed' THEN RAISE; END IF;
    END;
  END LOOP;
  RAISE NOTICE 'PASS  T-4b an unknown audit action or collection is still refused';
END
$t$;

-- ── T-5 ────────────────────────────────────────────────────────────────────
INSERT INTO public.agent_conversations(id, user_id)
VALUES ('44530000-0000-4000-8000-0000000001c1', '44530000-0000-4000-8000-0000000001b1');
INSERT INTO public.agent_messages(id, conversation_id, user_id, role, content)
VALUES ('44530000-0000-4000-8000-0000000001c2', '44530000-0000-4000-8000-0000000001c1',
  '44530000-0000-4000-8000-0000000001b1', 'user', '{"text":"make the top warmer"}');
INSERT INTO public.agent_turn_attempts(
  id, user_id, conversation_id, user_message_id, client_turn_id, request_digest,
  manifest_digest, status, origin
) VALUES (
  '44530000-0000-4000-8000-0000000001c3', '44530000-0000-4000-8000-0000000001b1',
  '44530000-0000-4000-8000-0000000001c1', '44530000-0000-4000-8000-0000000001c2',
  '44530000-0000-4000-8000-0000000001c4', repeat('a', 64), repeat('b', 64), 'running', 'owner'
);

DO $t$
DECLARE
  v_attempt constant uuid := '44530000-0000-4000-8000-0000000001c3';
  v_user constant uuid := '44530000-0000-4000-8000-0000000001b1';
  v_number integer;
  v_event public.agent_activity_events%ROWTYPE;
  v_first integer;
  v_kind text;
BEGIN
  SELECT attempt_number INTO v_number FROM public.agent_turn_attempts WHERE id = v_attempt;

  v_event := public.issue_4453_append_site_step_event(
    v_attempt, v_user, v_number, 'site_step_started', 1, E'  Rewrite the\n heading  ');
  v_first := v_event.sequence;
  IF v_event.event_type <> 'site_step_started' OR v_event.step_index <> 1
     OR v_event.step_label <> 'Rewrite the heading' OR v_event.user_id <> v_user
     OR v_event.conversation_id <> '44530000-0000-4000-8000-0000000001c1' THEN
    RAISE EXCEPTION 'issue #4453 workspace ranks FAIL: T-5a step event shape: %', to_jsonb(v_event);
  END IF;
  RAISE NOTICE 'PASS  T-5a a started step carries its index and a one-line label';

  v_event := public.issue_4453_append_site_step_event(v_attempt, v_user, v_number, 'site_step_done', 1, 'Rewrite the heading');
  IF v_event.sequence <> v_first + 1 THEN
    RAISE EXCEPTION 'issue #4453 workspace ranks FAIL: T-5b sequence % after %', v_event.sequence, v_first;
  END IF;
  v_event := public.issue_4453_append_site_step_event(v_attempt, v_user, v_number, 'site_step_failed', 8, repeat('x', 300));
  IF v_event.sequence <> v_first + 2 OR char_length(v_event.step_label) <> 120 OR v_event.step_index <> 8 THEN
    RAISE EXCEPTION 'issue #4453 workspace ranks FAIL: T-5b failed step shape: %', to_jsonb(v_event);
  END IF;
  v_event := public.issue_4453_append_site_step_event(v_attempt, v_user, v_number, 'site_step_started', 2, NULL);
  IF v_event.step_label IS NOT NULL OR v_event.step_index <> 2 THEN
    RAISE EXCEPTION 'issue #4453 workspace ranks FAIL: T-5b empty label: %', to_jsonb(v_event);
  END IF;
  RAISE NOTICE 'PASS  T-5b done and failed follow in sequence; a long label is cut to 120; an empty one is stored empty';

  -- The shared append knows the three kinds too, and still writes the others.
  FOREACH v_kind IN ARRAY ARRAY['site_step_started','site_step_done','site_step_failed','finalizing_started'] LOOP
    v_event := public.append_agent_activity_event(v_attempt, v_user, v_number, v_kind);
    IF v_event.event_type <> v_kind OR v_event.step_index IS NOT NULL THEN
      RAISE EXCEPTION 'issue #4453 workspace ranks FAIL: T-5c shared append %', v_kind;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS  T-5c the shared append accepts the step kinds and the earlier kinds';

  -- Refusals.
  BEGIN
    PERFORM public.issue_4453_append_site_step_event(v_attempt, v_user, v_number, 'response_ready', 1, 'x');
    RAISE EXCEPTION 'issue #4453 workspace ranks FAIL: T-5d a non-step kind took a step';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.issue_4453_append_site_step_event(v_attempt, v_user, v_number, NULL, 1, 'x');
    RAISE EXCEPTION 'issue #4453 workspace ranks FAIL: T-5d a missing kind was accepted';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.issue_4453_append_site_step_event(v_attempt, v_user, v_number, 'site_step_started', 0, 'x');
    RAISE EXCEPTION 'issue #4453 workspace ranks FAIL: T-5d step 0 was accepted';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.issue_4453_append_site_step_event(v_attempt, v_user, v_number, 'site_step_started', 9, 'x');
    RAISE EXCEPTION 'issue #4453 workspace ranks FAIL: T-5d step 9 was accepted';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.issue_4453_append_site_step_event(v_attempt, v_user, v_number, 'site_step_started', NULL, 'x');
    RAISE EXCEPTION 'issue #4453 workspace ranks FAIL: T-5d a missing step was accepted';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;
  RAISE NOTICE 'PASS  T-5d other kinds and steps outside 1 to 8 are refused';
  BEGIN
    PERFORM public.issue_4453_append_site_step_event(
      v_attempt, '44530000-0000-4000-8000-0000000001b2', v_number, 'site_step_started', 1, 'x');
    RAISE EXCEPTION 'issue #4453 workspace ranks FAIL: T-5e another user wrote to the attempt';
  EXCEPTION WHEN sqlstate '42501' THEN NULL;
  END;
  BEGIN
    PERFORM public.issue_4453_append_site_step_event(v_attempt, v_user, v_number + 1, 'site_step_started', 1, 'x');
    RAISE EXCEPTION 'issue #4453 workspace ranks FAIL: T-5e a stale attempt number was accepted';
  EXCEPTION WHEN sqlstate '42501' THEN NULL;
  END;
  BEGIN
    PERFORM public.append_agent_activity_event(v_attempt, v_user, v_number, 'site_step_exploded');
    RAISE EXCEPTION 'issue #4453 workspace ranks FAIL: T-5e an unknown kind was accepted';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;
  RAISE NOTICE 'PASS  T-5e only the attempt''s own user and attempt number write a step; unknown kinds are refused';

  -- The table itself refuses a step on any other kind of event.
  BEGIN
    UPDATE public.agent_activity_events SET step_index = 3
     WHERE attempt_id = v_attempt AND event_type = 'finalizing_started';
    RAISE EXCEPTION 'issue #4453 workspace ranks FAIL: T-5f a non-step event carried a step';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.agent_activity_events SET step_index = 12
     WHERE attempt_id = v_attempt AND event_type = 'site_step_done' AND step_index = 1;
    RAISE EXCEPTION 'issue #4453 workspace ranks FAIL: T-5f step 12 was stored';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'PASS  T-5f the table refuses a step on another kind of event and a step outside 1 to 8';
END
$t$;

-- The owner reads their own step events (with the step); nobody else does.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '44530000-0000-4000-8000-0000000001b1', true);
SELECT set_config('request.jwt.claims', '{"sub":"44530000-0000-4000-8000-0000000001b1","role":"authenticated"}', true);
SELECT pg_temp.p_assert(
    (SELECT count(*) FROM public.agent_activity_events
      WHERE attempt_id = '44530000-0000-4000-8000-0000000001c3' AND step_index IS NOT NULL) = 4
    AND (SELECT step_label FROM public.agent_activity_events
      WHERE attempt_id = '44530000-0000-4000-8000-0000000001c3' AND event_type = 'site_step_started' AND step_index = 1) = 'Rewrite the heading',
  'T-5g the owner reads their step events with index and label');
SELECT set_config('request.jwt.claim.sub', '44530000-0000-4000-8000-0000000001b2', true);
SELECT set_config('request.jwt.claims', '{"sub":"44530000-0000-4000-8000-0000000001b2","role":"authenticated"}', true);
SELECT pg_temp.p_assert(
    (SELECT count(*) FROM public.agent_activity_events WHERE attempt_id = '44530000-0000-4000-8000-0000000001c3') = 0,
  'T-5h a teammate does not read another person''s step events');
RESET ROLE;

ROLLBACK;
