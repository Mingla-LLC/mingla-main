\set ON_ERROR_STOP on
-- #4452 follow-up B21, B22, B25 (migration 20280725004452): executable PostgreSQL 17 proof, after the full migration replay.
-- MINGLA-INVARIANT: I-4452-FLOW-VALIDATOR-REAL-STEPS | issue #4452 | forms_validate_flow validates only flow steps (top-level and branch yes / no), never an email's doc blocks.
--
-- FV-1 B21  the exact payload production refused (an email whose doc holds a rich_text block with an id)
--           saves through admin_automation_save_draft and publishes.
-- FV-2 B21  an email with every EmailBodyEditor block (rich_text, divider, image, blog_post), at the top
--           level and inside both branch paths, validates.
-- FV-3 B21  malformed real steps still fail with bad_step:<id>: an email with no `to`, a step with no type,
--           a non-object step, and a bad wait nested in a branch's No path.
-- FV-4 B22  publish check 5 ("You sent yourself a test") passes when the flow sends the person no email
--           (no automation, or a team alert only) and still fails for an untested flow with an email.
-- FV-5 B25  a tool follow-up enrolment for an internal email, or a tool run with a test name, is an
--           is_test submission and its form lead event is is_test; a real person's is not.
--
-- FV-6 B26  a public submission (forms_submit_core) from an internal email, or with a test name, is an
--           is_test submission with an is_test lead event, gets no card, is never deduped, and still starts
--           its run (the welcome is due now); a real person's is real.
--
-- FAILS-ON-REVERT: restoring the `strict $.**` step walk fails FV-1 and FV-2 (bad_step:<block id>); dropping
-- `IS NOT TRUE` fails FV-3 (the email with no `to` slips through); restoring `IF v_f.tested_at IS NULL` alone
-- fails FV-4; dropping is_test from forms_tool_followup_enroll fails FV-5; dropping the
-- inbound_lead_is_test line from forms_submit_core fails FV-6.

CREATE OR REPLACE FUNCTION pg_temp.v_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4452 flow validator FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;
CREATE OR REPLACE FUNCTION pg_temp.v_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
END
$a$;
CREATE OR REPLACE FUNCTION pg_temp.v_state(p_sql text)
RETURNS text LANGUAGE plpgsql AS $a$
DECLARE v_d text;
BEGIN EXECUTE p_sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_d = PG_EXCEPTION_DETAIL;
  RETURN SQLSTATE || ':' || SQLERRM || ':' || COALESCE(v_d, '');
END
$a$;
-- The error codes forms_validate_flow returns, as a sorted text array.
CREATE OR REPLACE FUNCTION pg_temp.v_codes(p_flow jsonb, p_def jsonb)
RETURNS text[] LANGUAGE sql AS $a$
  SELECT COALESCE(array_agg(e->>'code' ORDER BY e->>'code'), ARRAY[]::text[])
    FROM jsonb_array_elements(public.forms_validate_flow(p_flow, p_def, false)->'errors') e
$a$;

-- ═══ FV-1 / FV-2 / FV-3 / FV-4 ═══════════════════════════════════════════════
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
DO $t$
DECLARE
  v_web constant uuid := '44520000-0000-4000-e000-0000000000f1';
  v_form uuid; v_bare uuid; v_team uuid; v_mail uuid;
  v jsonb; v_def jsonb; v_flow jsonb; v_e text;
  v_email jsonb;
BEGIN
  INSERT INTO auth.users(id, email, email_confirmed_at) VALUES (v_web, 'fv4452-web@mingla-fixture.org', now());
  INSERT INTO public.admin_team_members(email, role, status, accepted_at) VALUES ('fv4452-web@mingla-fixture.org', 'website', 'active', now());
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.v_as(v_web);

  -- FV-1: the exact production payload.
  v := public.admin_form_create('QA flow validator', 'creator', 'creators');
  v_form := (v->>'id')::uuid;
  v_flow := '{"v":1,"steps":[{"id":"emktrwbj","type":"email","name":"New email","to":"person","from":"creators","reply_to":"team","subject":"Hi {first_name}","doc":[{"id":"emktrwbjb","type":"rich_text","html":"<p>Hi {first_name},</p><p>Write your note here.</p>"}],"show_answers":false,"action_bar":"auto"}]}'::jsonb;
  v_e := pg_temp.v_state(format($$SELECT public.admin_automation_save_draft(%L, 0, %L::jsonb, '{}'::jsonb)$$, v_form, v_flow));
  PERFORM pg_temp.v_assert(v_e = 'ok', 'FV-1 B21 the production payload saves (' || v_e || ')');
  v_e := pg_temp.v_state(format($$SELECT public.admin_automation_publish(%L, 1)$$, v_form));
  PERFORM pg_temp.v_assert(v_e = 'ok', 'FV-1 B21 and its Save changes publish succeeds (' || v_e || ')');
  RESET ROLE;
  SELECT draft INTO v_def FROM public.forms WHERE id = v_form;
  PERFORM pg_temp.v_assert((SELECT draft = v_flow FROM public.form_automations WHERE form_id = v_form), 'FV-1 the saved draft is the payload');

  -- FV-2: every EmailBodyEditor block type, top level and in both branch paths.
  v_email := '{"id":"em_all","type":"email","name":"All blocks","to":"person","from":"creators","reply_to":"team","subject":"Hi {first_name}","doc":[
      {"id":"b-text","type":"rich_text","html":"<p>Hi {first_name}</p>"},
      {"id":"b-div","type":"divider"},
      {"id":"b-img","type":"image","url":"https://example.org/a.png","alt":"A photo","link":""},
      {"id":"b-gif","type":"image","url":"https://example.org/a.gif","alt":"A GIF","link":"https://usemingla.com"},
      {"id":"b-blog","type":"blog_post","postId":"p1","style":"card","buttonText":"Read on the blog",
       "snapshot":{"slug":"hello","title":"Hello","summary":"","categoryLabel":"Mingla","readMinutes":1,"coverUrl":null,"coverAlt":"","versionId":"v1"}},
      {"id":"b-blog-text","type":"rich_text","html":"<p><br></p>"}],
    "button":{"text":"Book a call","to":{"kind":"schedule"}},"show_answers":true,"action_bar":"creator"}'::jsonb;
  v_flow := jsonb_build_object('v', 1, 'steps', jsonb_build_array(
    v_email,
    '{"id":"t1","type":"team","name":"Team alert","to":"creators_inbox","include_answers":true}'::jsonb,
    jsonb_build_object('id', 'br1', 'type', 'branch', 'cond', '{"on":"booked","op":"is","value":"yes"}'::jsonb,
      'yes', jsonb_build_array(jsonb_set(v_email, '{id}', '"em_yes"')),
      'no', jsonb_build_array(jsonb_set(jsonb_set(v_email, '{id}', '"em_no"'), '{doc,0,id}', '"b-no-text"')))));
  PERFORM pg_temp.v_assert(pg_temp.v_codes(v_flow, v_def) = ARRAY[]::text[],
    'FV-2 B21 rich_text, divider, image, GIF and blog_post blocks validate at every depth (' || array_to_string(pg_temp.v_codes(v_flow, v_def), ',') || ')');
  PERFORM pg_temp.v_assert(array_length(public.forms_flow_step_ids(v_flow->'steps'), 1) = 5,
    'FV-2 forms_flow_step_ids counts the five steps, never a doc block');
  PERFORM pg_temp.v_assert(public.forms_flow_find(v_flow->'steps', 'b-text') IS NULL AND public.forms_flow_find(v_flow->'steps', 'em_no') IS NOT NULL,
    'FV-2 forms_flow_find finds steps, never doc blocks');
  PERFORM pg_temp.v_assert(public.forms_flow_kinds(v_flow) = '{"em_all":"confirmation","t1":"team_alert","em_yes":"confirmation","em_no":"confirmation"}',
    'FV-2 forms_flow_kinds lists steps only');

  -- FV-3: malformed real steps still fail.
  PERFORM pg_temp.v_assert(pg_temp.v_codes(jsonb_build_object('v', 1, 'steps', jsonb_build_array(v_email - 'to')), v_def) = ARRAY['bad_step:em_all'],
    'FV-3 an email with no `to` fails as bad_step:em_all');
  PERFORM pg_temp.v_assert(pg_temp.v_codes('{"v":1,"steps":[{"id":"nt1","name":"No type"}]}', v_def) = ARRAY['bad_step:nt1'],
    'FV-3 a step with no type fails');
  PERFORM pg_temp.v_assert('bad_step:?' = ANY (pg_temp.v_codes('{"v":1,"steps":["just text"]}', v_def)),
    'FV-3 a non-object step fails');
  PERFORM pg_temp.v_assert(pg_temp.v_codes(jsonb_build_object('v', 1, 'steps', jsonb_build_array(
      jsonb_build_object('id', 'br2', 'type', 'branch', 'cond', '{"on":"booked","op":"is","value":"yes"}'::jsonb,
        'yes', '[]'::jsonb, 'no', '[{"id":"w9","type":"wait","n":0,"unit":"days","at10":true,"skip_weekends":false}]'::jsonb))), v_def)
      = ARRAY['bad_step:w9'],
    'FV-3 a bad wait nested in a branch No path fails as bad_step:w9');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.v_as(v_web);
  v_e := pg_temp.v_state(format($$SELECT public.admin_automation_save_draft(%L, 1, %L::jsonb, '{}'::jsonb)$$, v_form,
           jsonb_build_object('v', 1, 'steps', jsonb_build_array(v_email - 'to'))));
  PERFORM pg_temp.v_assert(v_e LIKE '22023:invalid_flow:%bad_step:em_all%', 'FV-3 the save refuses it with invalid_flow naming the step (' || v_e || ')');

  -- FV-4: publish check 5.
  v_bare := (public.admin_form_create('QA no automation', 'creator', 'creators')->>'id')::uuid;
  v_e := pg_temp.v_state(format($$SELECT public.admin_form_publish(%L, 1)$$, v_bare));
  PERFORM pg_temp.v_assert(v_e = 'ok', 'FV-4 B22 an untested form with no automation publishes (' || v_e || ')');
  v_team := (public.admin_form_create('QA team alert only', 'creator', 'creators')->>'id')::uuid;
  PERFORM public.admin_automation_save_draft(v_team, 0,
    '{"v":1,"steps":[{"id":"t1","type":"team","name":"Team alert","to":"creators_inbox","include_answers":true}]}', '{}');
  v_e := pg_temp.v_state(format($$SELECT public.admin_form_publish(%L, 1)$$, v_team));
  PERFORM pg_temp.v_assert(v_e = 'ok', 'FV-4 B22 an untested form whose flow is a team alert only publishes (' || v_e || ')');
  v_mail := (public.admin_form_create('QA with email', 'creator', 'creators')->>'id')::uuid;
  PERFORM public.admin_automation_save_draft(v_mail, 0, jsonb_build_object('v', 1, 'steps', jsonb_build_array(v_email)), '{}');
  v_e := pg_temp.v_state(format($$SELECT public.admin_form_publish(%L, 1)$$, v_mail));
  PERFORM pg_temp.v_assert(v_e LIKE '22023:publish_check_failed:%"tested"%', 'FV-4 an untested form with an email step still fails check 5 (' || v_e || ')');
  PERFORM public.admin_form_mark_tested(v_mail);
  v_e := pg_temp.v_state(format($$SELECT public.admin_form_publish(%L, 1)$$, v_mail));
  PERFORM pg_temp.v_assert(v_e = 'ok', 'FV-4 after a test it publishes (' || v_e || ')');
  RESET ROLE;

  PERFORM pg_temp.v_assert(has_function_privilege('authenticated', 'public.forms_validate_flow(jsonb, jsonb, boolean)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.forms_validate_flow(jsonb, jsonb, boolean)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.admin_form_publish(uuid, integer)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.admin_form_publish(uuid, integer)', 'EXECUTE'),
    'grants unchanged: validate and publish for authenticated, never anon');
  PERFORM pg_temp.v_assert((SELECT prosecdef FROM pg_proc WHERE oid = 'public.admin_form_publish(uuid, integer)'::regprocedure)
    AND NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.forms_validate_flow(jsonb, jsonb, boolean)'::regprocedure)
    AND (SELECT prosecdef FROM pg_proc WHERE oid = 'public.forms_tool_followup_enroll(text, uuid, text, text)'::regprocedure),
    'SECURITY settings unchanged');
END
$t$;
ROLLBACK;

-- ═══ FV-5 ════════════════════════════════════════════════════════════════════
BEGIN;
DO $t$
DECLARE
  v_run uuid; v_tl uuid := gen_random_uuid(); v_sub public.form_submissions;
BEGIN
  -- An internal email (the live QA address shape).
  v_run := public.forms_tool_followup_enroll('venues', gen_random_uuid(), 'Seth+QA4452@usemingla.com', 'Africa/Lagos');
  SELECT s.* INTO v_sub FROM public.form_submissions s JOIN public.form_automation_runs r ON r.submission_id = s.id WHERE r.id = v_run;
  PERFORM pg_temp.v_assert(v_sub.is_test, 'FV-5 B25 an internal email enrols as a test submission');
  PERFORM pg_temp.v_assert((SELECT bool_and(e.is_test) AND count(*) = 1 FROM public.lead_events e
                             WHERE e.source_table = 'form_submissions' AND e.source_id = v_sub.id),
    'FV-5 B25 and its form lead event is is_test');
  -- A real email, but the tool run's name says test.
  INSERT INTO public.tool_leads (id, tool, input, email, lane) VALUES (v_tl, 'events', '{"name":"Test venue","city":"Lagos"}', 'ada@mingla-fixture.org', 'web');
  v_run := public.forms_tool_followup_enroll('events', v_tl, 'ada@mingla-fixture.org', NULL);
  SELECT s.* INTO v_sub FROM public.form_submissions s JOIN public.form_automation_runs r ON r.submission_id = s.id WHERE r.id = v_run;
  PERFORM pg_temp.v_assert(v_sub.is_test, 'FV-5 B25 a tool run named "Test venue" enrols as a test submission');
  -- A real person.
  v_run := public.forms_tool_followup_enroll('trips', gen_random_uuid(), 'bola@mingla-fixture.org', NULL);
  SELECT s.* INTO v_sub FROM public.form_submissions s JOIN public.form_automation_runs r ON r.submission_id = s.id WHERE r.id = v_run;
  PERFORM pg_temp.v_assert(NOT v_sub.is_test, 'FV-5 a real person enrols as a real submission');
  PERFORM pg_temp.v_assert((SELECT NOT bool_or(e.is_test) FROM public.lead_events e
                             WHERE e.source_table = 'form_submissions' AND e.source_id = v_sub.id),
    'FV-5 and its form lead event is real');
END
$t$;
ROLLBACK;

-- ═══ FV-6 ════════════════════════════════════════════════════════════════════
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
DO $t$
DECLARE
  v_web constant uuid := '44520000-0000-4000-e000-0000000000f6';
  v_form uuid; v jsonb; v_sub public.form_submissions; v_r jsonb; v_r2 jsonb;
BEGIN
  INSERT INTO auth.users(id, email, email_confirmed_at) VALUES (v_web, 'fv6-4452-web@mingla-fixture.org', now());
  INSERT INTO public.admin_team_members(email, role, status, accepted_at) VALUES ('fv6-4452-web@mingla-fixture.org', 'website', 'active', now());
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.v_as(v_web);
  v_form := (public.admin_form_create('QA public test submit', 'creator', 'creators')->>'id')::uuid;
  PERFORM public.admin_form_mark_tested(v_form);
  PERFORM public.admin_form_publish(v_form, 1);
  PERFORM public.admin_automation_save_draft(v_form, 0,
    '{"v":1,"steps":[{"id":"e1","type":"email","name":"Welcome","to":"person","from":"creators","reply_to":"team","subject":"Thanks","doc":[{"id":"e1b","type":"rich_text","html":"<p>Thanks.</p>"}],"show_answers":false}]}', '{}');
  PERFORM public.admin_automation_publish(v_form, 1);
  PERFORM public.admin_automation_set_enabled(v_form, true);
  RESET ROLE;

  SET LOCAL ROLE service_role;
  v_r := public.forms_submit_core(jsonb_build_object('idempotency_key', gen_random_uuid(), 'form_id', v_form, 'email', 'seth+qa4452@usemingla.com',
    'answers', jsonb_build_object('name', 'Seth QA', 'email', 'seth+qa4452@usemingla.com', 'consent', true,
       'phone', jsonb_build_object('country','NG','dial','+234','number','801 234 5678'), 'what_do_you_make', 'Video',
       'your_main_social', jsonb_build_object('platform','instagram','value','@qa'), 'city', jsonb_build_object('label','Lagos')),
    'consent_text', 'Send me creator tips', 'time_zone', 'Africa/Lagos', 'page_path', '/creators', 'placement', 'inline', 'ads_allowed', true));
  v_r2 := public.forms_submit_core(jsonb_build_object('idempotency_key', gen_random_uuid(), 'form_id', v_form, 'email', 'seth+qa4452@usemingla.com',
    'answers', jsonb_build_object('name', 'Seth QA', 'email', 'seth+qa4452@usemingla.com', 'consent', true,
       'phone', jsonb_build_object('country','NG','dial','+234','number','801 234 5678'), 'what_do_you_make', 'Video',
       'your_main_social', jsonb_build_object('platform','instagram','value','@qa'), 'city', jsonb_build_object('label','Lagos')),
    'time_zone', 'Africa/Lagos', 'page_path', '/creators', 'placement', 'inline', 'ads_allowed', true));
  RESET ROLE;
  SELECT * INTO v_sub FROM public.form_submissions WHERE id = (v_r->>'submission_id')::uuid;
  PERFORM pg_temp.v_assert(v_sub.is_test, 'FV-6 B26 an internal email submits as a test submission');
  PERFORM pg_temp.v_assert((SELECT bool_and(e.is_test) AND count(*) = 1 FROM public.lead_events e
                             WHERE e.source_table = 'form_submissions' AND e.source_id = v_sub.id),
    'FV-6 B26 and its form lead event is is_test');
  PERFORM pg_temp.v_assert(v_r->>'routing_status' = 'lead_only' AND v_sub.crm_record_id IS NULL, 'FV-6 a test submission gets no pipeline card');
  PERFORM pg_temp.v_assert(v_r->>'run_id' IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.form_automation_sends WHERE run_id = (v_r->>'run_id')::uuid AND step_id = 'e1' AND due_at <= now()),
    'FV-6 B26 its run still starts and the welcome is due now (staff test end to end)');
  PERFORM pg_temp.v_assert(NOT (v_r2->>'deduped')::boolean AND v_r2->>'submission_id' <> v_r->>'submission_id' AND v_r2->>'run_id' IS NOT NULL,
    'FV-6 a second test within 24 h is a new test run, not a dedupe');

  SET LOCAL ROLE service_role;
  v_r := public.forms_submit_core(jsonb_build_object('idempotency_key', gen_random_uuid(), 'form_id', v_form, 'email', 'bola@mingla-fixture.org',
    'answers', jsonb_build_object('name', 'Test Person', 'email', 'bola@mingla-fixture.org', 'consent', false,
       'phone', jsonb_build_object('country','NG','dial','+234','number','801 234 5678'), 'what_do_you_make', 'Photo',
       'your_main_social', jsonb_build_object('platform','instagram','value','@bola'), 'city', jsonb_build_object('label','Lagos')),
    'time_zone', 'Africa/Lagos', 'page_path', '/creators', 'placement', 'popup', 'ads_allowed', false));
  v_r2 := public.forms_submit_core(jsonb_build_object('idempotency_key', gen_random_uuid(), 'form_id', v_form, 'email', 'ada@mingla-fixture.org',
    'answers', jsonb_build_object('name', 'Ada Okafor', 'email', 'ada@mingla-fixture.org', 'consent', false,
       'phone', jsonb_build_object('country','NG','dial','+234','number','801 234 5678'), 'what_do_you_make', 'Photo',
       'your_main_social', jsonb_build_object('platform','instagram','value','@ada'), 'city', jsonb_build_object('label','Lagos')),
    'time_zone', 'Africa/Lagos', 'page_path', '/creators', 'placement', 'popup', 'ads_allowed', false));
  RESET ROLE;
  PERFORM pg_temp.v_assert((SELECT is_test FROM public.form_submissions WHERE id = (v_r->>'submission_id')::uuid),
    'FV-6 B26 a test name ("Test Person") submits as a test submission');
  PERFORM pg_temp.v_assert(NOT (SELECT is_test FROM public.form_submissions WHERE id = (v_r2->>'submission_id')::uuid)
    AND NOT (SELECT bool_or(e.is_test) FROM public.lead_events e WHERE e.source_table = 'form_submissions' AND e.source_id = (v_r2->>'submission_id')::uuid)
    AND v_r2->>'run_id' IS NOT NULL,
    'FV-6 a real person submits as real, with a real lead event and a run');
END
$t$;
ROLLBACK;
