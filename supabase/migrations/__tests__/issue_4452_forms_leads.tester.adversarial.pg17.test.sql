\set ON_ERROR_STOP on
-- #4452 tester (L3) adversarial pg17 suite: angles the implementor suites do not cover.
-- Runs after the full migration replay (main + M1–M6). Every block rolls back.
--
-- ADV-1  every function the six #4452 migrations add: anon may execute only the two site reads,
--        and every SECURITY DEFINER one pins search_path.
-- ADV-2  a signed-in user with no Admin role gets 42501 from every admin_* write/read RPC.
-- ADV-3  lead dedupe: Unicode case folds to one lead; plus-addressing stays two people; an
--        email with a trailing tab is never stored as a whitespace key and is recorded, not lost.
-- ADV-4  one row whose ingest keeps failing never blocks the source write, and never stops
--        lead_reconcile() from repairing every other missing row.
-- ADV-5  consent cannot be bypassed with a crafted selection: no-consent, test, legacy
--        unsubscribe (mixed case and spaces) and an `all` suppression are never marketable;
--        another actor's or an expired selection resolves to nothing; signed-in cannot resolve.
-- ADV-6  an unsubscribe written AFTER a follow-up was scheduled (one-click shape) stops it at the
--        gate, while a marketing-only unsubscribe still lets the confirmation through.
-- ADV-7  10:00-local scheduling across DST edges and half/quarter-hour zones.
-- ADV-8  a branch on an answer the person never gave takes the "no" path ("is") and the "yes"
--        path ("is_not"); the run never stalls.
-- ADV-9  slug A -> B -> A: every slug is one hop from the current one (no redirect loop), and
--        the retired slug can never be taken by another form.
-- ADV-10 a preview token is one page only: it never carries another page's draft or a draft
--        form that is not in its own blocks, and never routing owners.
-- ADV-11 replaying an idempotency key after success returns the same body and never counts as
--        a resubmit.
--
-- FAILS-ON-REVERT (verified by the tester): REVOKE ... FROM anon on admin_* -> ADV-1; the
-- leads_can_view gate in admin_lead_selection_create -> ADV-2; the marketing_unsubscribes test in
-- lead_email_status -> ADV-5; step 5 of forms_send_gate -> ADV-6; the zone in
-- forms_next_local_time -> ADV-7; the is_current lookup in site_public_content -> ADV-9.

CREATE OR REPLACE FUNCTION pg_temp.t_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4452 tester FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;
CREATE OR REPLACE FUNCTION pg_temp.t_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
END
$a$;
CREATE OR REPLACE FUNCTION pg_temp.t_state(p_sql text)
RETURNS text LANGUAGE plpgsql AS $a$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$a$;
CREATE OR REPLACE FUNCTION pg_temp.t_creator_answers(p_email text, p_make text, p_consent boolean)
RETURNS jsonb LANGUAGE sql AS $a$
  SELECT jsonb_build_object('name', 'Ada Okafor', 'email', p_email, 'consent', p_consent,
    'phone', jsonb_build_object('country','NG','dial','+234','number','801 234 5678'), 'what_do_you_make', p_make,
    'your_main_social', jsonb_build_object('platform','instagram','value','@ada'), 'city', jsonb_build_object('label','Lagos'))
$a$;

-- ═══ ADV-1: the function grant sweep ══════════════════════════════════════════
BEGIN;
DO $t$
DECLARE r record; v_n integer := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, p.prosecdef, p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND (p.proname ~ '^(forms?_|admin_forms?_|admin_site_page|site_|lead_|leads_|admin_lead|admin_automation)'
            )
  LOOP
    v_n := v_n + 1;
    -- #4636 adds two anonymous reads for usemingla.com: one page's block list and the staff-made page index.
    IF r.proname IN ('site_public_content', 'site_public_preview', 'site_public_page', 'site_public_custom_index') THEN
      PERFORM pg_temp.t_assert(has_function_privilege('anon', r.oid, 'EXECUTE'), 'ADV-1 anon reads ' || r.proname);
    ELSE
      PERFORM pg_temp.t_assert(NOT has_function_privilege('anon', r.oid, 'EXECUTE'), 'ADV-1 anon cannot execute ' || r.proname);
    END IF;
    IF r.prosecdef THEN
      PERFORM pg_temp.t_assert(EXISTS (SELECT 1 FROM unnest(COALESCE(r.proconfig, '{}')) c WHERE c LIKE 'search_path=%'),
        'ADV-1 SECURITY DEFINER pins search_path: ' || r.proname);
    END IF;
  END LOOP;
  PERFORM pg_temp.t_assert(v_n >= 90, 'ADV-1 the sweep saw every #4452 function (' || v_n || ')');
END
$t$;
ROLLBACK;

-- ═══ ADV-2: no Admin role, no admin RPC ═══════════════════════════════════════
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
DO $t$
DECLARE
  v_user constant uuid := '44520000-0000-4000-f000-000000000001';
  v_z constant uuid := '00000000-0000-4000-8000-000000000000';
  v_call text;
BEGIN
  INSERT INTO auth.users(id, email, email_confirmed_at) VALUES (v_user, 't4452-plain@mingla-fixture.org', now());
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t_as(v_user);
  FOREACH v_call IN ARRAY ARRAY[
    format('SELECT public.admin_forms_list(NULL)'),
    format('SELECT public.admin_form_create(%L, %L, NULL)', 'X', 'host'),
    format('SELECT public.admin_form_get(%L)', v_z),
    format('SELECT public.admin_form_save_draft(%L, 1, %L::jsonb)', v_z, '{}'),
    format('SELECT public.admin_form_publish(%L, 1)', v_z),
    format('SELECT public.admin_form_archive(%L)', v_z),
    format('SELECT public.admin_form_duplicate(%L)', v_z),
    format('SELECT public.admin_form_results(%L, now() - interval %L, now())', v_z, '1 day'),
    format('SELECT public.admin_form_submission_stop_emails(%L)', v_z),
    format('SELECT public.admin_automation_get(%L)', v_z),
    format('SELECT public.admin_automation_save_draft(%L, 0, %L::jsonb, %L::jsonb)', v_z, '{"v":1,"steps":[]}', '{}'),
    format('SELECT public.admin_automation_publish(%L, 1)', v_z),
    format('SELECT public.admin_automation_set_enabled(%L, true)', v_z),
    format('SELECT public.admin_site_pages_state()'),
    format('SELECT public.admin_site_page_get(%L)', 'creators'),
    format('SELECT public.admin_site_page_save_draft(%L, 0, %L::jsonb)', 'creators', '{"blocks":[]}'),
    format('SELECT public.admin_site_page_publish(%L, 0, NULL)', 'creators'),
    format('SELECT public.admin_site_page_history(%L, 5)', 'creators'),
    format('SELECT public.admin_site_page_create_preview_token(%L, %L::jsonb)', 'creators', '{"blocks":[]}'),
    format('SELECT public.admin_leads_list(%L::jsonb, NULL, 50)', '{}'),
    format('SELECT public.admin_lead_get(%L)', v_z),
    format('SELECT public.admin_lead_selection_create(NULL, %L::jsonb)', '{}'),
    format('SELECT public.admin_leads_export(%L::jsonb)', '{}'),
    format('SELECT public.admin_lead_link_crm(%L, %L)', v_z, v_z)
  ] LOOP
    PERFORM pg_temp.t_assert(pg_temp.t_state(v_call) = '42501', 'ADV-2 a plain signed-in user is refused: ' || left(v_call, 60));
  END LOOP;
  PERFORM pg_temp.t_assert(NOT public.leads_can_view() AND NOT public.leads_can_export() AND NOT public.forms_can_edit(),
    'ADV-2 the gates say no for a plain user');
  RESET ROLE;
END
$t$;
ROLLBACK;

-- ═══ ADV-3: dedupe edges ═════════════════════════════════════════════════════
BEGIN;
DO $t$
DECLARE v_n bigint; v_tab uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.tool_leads (tool, input, email, lane) VALUES ('venues', '{"name":"Émile Bar"}', 'ÉMILE@Fixture-4452.org', 'web');
  INSERT INTO public.beta_access_leads (brand_type, brand_name, contact_name, city, email, source, consent)
  VALUES (ARRAY['restaurant'], 'Émile Bar', 'Émile', 'Paris', 'émile@fixture-4452.org', 'organiser_marketing', false);
  SELECT count(*) INTO v_n FROM public.leads WHERE email_key IN ('émile@fixture-4452.org', 'ÉMILE@fixture-4452.org');
  PERFORM pg_temp.t_assert(v_n = 1, 'ADV-3 a Unicode upper-case email folds into the same lead');
  PERFORM pg_temp.t_assert((SELECT event_count = 2 FROM public.leads WHERE email_key = 'émile@fixture-4452.org'), 'ADV-3 both events on that lead');

  INSERT INTO public.beta_access_leads (brand_type, brand_name, contact_name, city, email, source, consent)
  VALUES (ARRAY['restaurant'], 'Plus Bar', 'Plus', 'Lagos', 'ada+ads@fixture-4452.org', 'organiser_marketing', false),
         (ARRAY['restaurant'], 'Plain Bar', 'Plain', 'Lagos', 'ada@fixture-4452.org', 'organiser_marketing', false);
  PERFORM pg_temp.t_assert((SELECT count(*) FROM public.leads WHERE email_key IN ('ada+ads@fixture-4452.org', 'ada@fixture-4452.org')) = 2,
    'ADV-3 plus-addressing is a different inbox: two leads, never merged');

  INSERT INTO public.beta_access_leads (id, brand_type, brand_name, contact_name, city, email, source, consent)
  VALUES (v_tab, ARRAY['restaurant'], 'Tab Bar', 'Tab', 'Lagos', E'tab@fixture-4452.org\t', 'organiser_marketing', false);
  PERFORM pg_temp.t_assert(EXISTS (SELECT 1 FROM public.beta_access_leads WHERE id = v_tab), 'ADV-3 the source write with a stray tab commits');
  PERFORM pg_temp.t_assert(NOT EXISTS (SELECT 1 FROM public.leads WHERE email_key ~ '[[:space:]]'), 'ADV-3 no lead key ever holds whitespace');
  PERFORM pg_temp.t_assert(EXISTS (SELECT 1 FROM public.lead_ingest_failures WHERE source_id = v_tab AND reason = 'invalid_email'),
    'ADV-3 the unusable email is recorded as a failure, never silently dropped');
END
$t$;
ROLLBACK;

-- ═══ ADV-4: a poison row never blocks the rest ═══════════════════════════════
BEGIN;
DO $t$
DECLARE v_bad uuid := gen_random_uuid(); v_good uuid := gen_random_uuid(); v_state text;
BEGIN
  -- A persistent failure for one person: the lead row itself refuses this name.
  ALTER TABLE public.leads ADD CONSTRAINT t4452_poison CHECK (name IS DISTINCT FROM 'Poison Person');
  INSERT INTO public.beta_access_leads (id, brand_type, brand_name, contact_name, city, email, source, consent)
  VALUES (v_bad, ARRAY['restaurant'], 'Poison Bar', 'Poison Person', 'Lagos', 'poison@fixture-4452.org', 'organiser_marketing', false);
  PERFORM pg_temp.t_assert(EXISTS (SELECT 1 FROM public.beta_access_leads WHERE id = v_bad), 'ADV-4 the poison source write commits');
  PERFORM pg_temp.t_assert((SELECT sqlstate = '23514' AND reason = 'error' FROM public.lead_ingest_failures WHERE source_id = v_bad),
    'ADV-4 the failure carries SQLSTATE 23514');
  -- A good row that missed its trigger (a gap reconcile must repair).
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.beta_access_leads (id, brand_type, brand_name, contact_name, city, email, source, consent)
  VALUES (v_good, ARRAY['restaurant'], 'Good Bar', 'Good Person', 'Lagos', 'good@fixture-4452.org', 'organiser_marketing', false);
  SET LOCAL session_replication_role = origin;
  PERFORM pg_temp.t_assert(NOT EXISTS (SELECT 1 FROM public.leads WHERE email_key = 'good@fixture-4452.org'), 'ADV-4 the gap exists');
  v_state := pg_temp.t_state('SELECT public.lead_reconcile()');
  PERFORM pg_temp.t_assert(v_state = 'ok', 'ADV-4 lead_reconcile() survives a row that keeps failing (got ' || v_state || ')');
  PERFORM pg_temp.t_assert(EXISTS (SELECT 1 FROM public.leads WHERE email_key = 'good@fixture-4452.org'),
    'ADV-4 every other missing row is still repaired');
END
$t$;
ROLLBACK;

-- ═══ ADV-5: a crafted selection cannot reach people who said no ══════════════
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
DO $t$
DECLARE
  v_admin constant uuid := '44520000-0000-4000-f000-000000000011';
  v_other constant uuid := '44520000-0000-4000-f000-000000000012';
  v_ids uuid[]; v jsonb; v_sel uuid; v_n bigint;
BEGIN
  INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
    (v_admin, 't4452-admin@mingla-fixture.org', now()), (v_other, 't4452-admin2@mingla-fixture.org', now());
  INSERT INTO public.admin_users(email, role, status) VALUES
    ('t4452-admin@mingla-fixture.org', 'admin', 'active'), ('t4452-admin2@mingla-fixture.org', 'admin', 'active')
  ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status;
  -- Five people, all from consented bookings except one.
  INSERT INTO public.book_call_leads (booking_key, name, email, venue, icp, social_platform, social_url, call_at, audience, marketing_consent, consent_text, consent_at)
  VALUES ('gcal:t4452-ok', 'Okay Person', 'ok@fixture-4452.org', 'Okay Bar', 'restaurants', 'instagram', 'https://instagram.com/x', now() + interval '2 days', 'host', true, 'Send me emails', now()),
         ('gcal:t4452-no', 'No Consent', 'nocon@fixture-4452.org', 'No Bar', 'restaurants', 'instagram', 'https://instagram.com/x', now() + interval '2 days', 'host', false, NULL, NULL),
         ('gcal:t4452-un', 'Legacy Unsub', 'unsub@fixture-4452.org', 'Unsub Bar', 'restaurants', 'instagram', 'https://instagram.com/x', now() + interval '2 days', 'host', true, 'Send me emails', now()),
         ('gcal:t4452-al', 'All Suppressed', 'allsup@fixture-4452.org', 'All Bar', 'restaurants', 'instagram', 'https://instagram.com/x', now() + interval '2 days', 'host', true, 'Send me emails', now()),
         ('gcal:t4452-te', 'Test Person', 'test+qa@mingla.com', 'Test Bar', 'restaurants', 'instagram', 'https://instagram.com/x', now() + interval '2 days', 'host', true, 'Send me emails', now());
  INSERT INTO public.marketing_unsubscribes (contact_email, channel, scope, reason) VALUES ('  UNSUB@Fixture-4452.org ', 'email', 'global', 'unsubscribe');
  INSERT INTO public.channel_suppressions (contact, channel, scope, reason) VALUES ('AllSup@fixture-4452.org', 'email', 'all', 'manual');
  SELECT array_agg(id) INTO v_ids FROM public.leads
   WHERE email_key IN ('ok@fixture-4452.org','nocon@fixture-4452.org','unsub@fixture-4452.org','allsup@fixture-4452.org','test+qa@mingla.com');
  PERFORM pg_temp.t_assert(cardinality(v_ids) = 5, 'ADV-5 five fixture leads');

  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t_as(v_admin);
  v := public.admin_lead_selection_create(v_ids || ARRAY[gen_random_uuid()], NULL);   -- plus a lead id that does not exist
  v_sel := (v->>'selection_id')::uuid;
  PERFORM pg_temp.t_assert((v->>'selected')::int = 5, 'ADV-5 an unknown lead id in the selection is ignored');
  PERFORM pg_temp.t_assert((v->>'marketable')::int = 1, 'ADV-5 exactly one of five is marketable (' || (v->>'marketable') || ')');
  PERFORM pg_temp.t_assert((v->>'test')::int = 1 AND (v->>'unsubscribed')::int = 2 AND (v->>'no_consent')::int = 1,
    'ADV-5 each refusal is counted under its own reason: ' || v::text);
  PERFORM pg_temp.t_assert(pg_temp.t_state(format('SELECT * FROM public.leads_audience_resolve(%L, %L)', v_sel, v_admin)) = '42501',
    'ADV-5 a signed-in caller cannot run the service resolver');
  PERFORM pg_temp.t_assert(pg_temp.t_state(format('SELECT public.admin_lead_selection_create(%L::uuid[], NULL)',
      (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 5001)))) = '22023', 'ADV-5 more than 5,000 ids is refused');
  RESET ROLE;

  SET LOCAL ROLE service_role;
  SELECT count(*) INTO v_n FROM public.leads_audience_resolve(v_sel, v_admin) r WHERE r.marketing_consent = 'yes' AND NOT r.is_internal;
  PERFORM pg_temp.t_assert(v_n = 1, 'ADV-5 the resolver hands the sender one yes-and-not-internal row');
  PERFORM pg_temp.t_assert((SELECT bool_and(marketing_consent = 'unsubscribed') FROM public.leads_audience_resolve(v_sel, v_admin) r
      WHERE r.email IN ('unsub@fixture-4452.org','allsup@fixture-4452.org')), 'ADV-5 both opt-outs resolve as unsubscribed, even when consented');
  PERFORM pg_temp.t_assert(pg_temp.t_state(format('SELECT * FROM public.leads_audience_resolve(%L, %L)', v_sel, v_other)) = '22023',
    'ADV-5 another admin cannot spend this selection');
  UPDATE public.lead_audience_selections SET expires_at = now() - interval '1 second' WHERE id = v_sel;
  PERFORM pg_temp.t_assert(pg_temp.t_state(format('SELECT * FROM public.leads_audience_resolve(%L, %L)', v_sel, v_admin)) = '22023',
    'ADV-5 an expired selection resolves to nothing');
  RESET ROLE;
END
$t$;
ROLLBACK;

-- ═══ ADV-6, ADV-8, ADV-11: unsubscribe after scheduling; a missing answer; replay ═══
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
DO $t$
DECLARE
  v_web constant uuid := '44520000-0000-4000-f000-000000000021';
  v_form uuid; v jsonb; v_flow jsonb; v_sub jsonb; v_run uuid; v_g jsonb; v_s public.form_automation_sends;
  v_key uuid := gen_random_uuid(); v_again jsonb;
BEGIN
  INSERT INTO auth.users(id, email, email_confirmed_at) VALUES (v_web, 't4452-web@mingla-fixture.org', now());
  INSERT INTO public.admin_team_members(email, role, status, accepted_at) VALUES ('t4452-web@mingla-fixture.org', 'website', 'active', now());
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t_as(v_web);
  v := public.admin_form_create('Creators: adversarial', 'creator', 'creators');
  v_form := (v->>'id')::uuid;
  v := public.admin_form_get(v_form);
  -- An optional multi-choice field the person may skip.
  PERFORM public.admin_form_save_draft(v_form, (v->>'draft_rev')::integer, jsonb_set(v->'draft', '{fields}',
    (v->'draft'->'fields') || '[{"key":"format","type":"multi","label":"Which formats?","required":false,"options":["Reels","Stories"]}]'::jsonb));
  PERFORM public.admin_form_mark_tested(v_form);
  PERFORM public.admin_form_publish(v_form, (v->>'draft_rev')::integer + 1);
  v_flow := '{"v":1,"steps":[
    {"id":"c0","type":"email","name":"Welcome","to":"person","from":"creators","reply_to":"team","subject":"Hi {first_name}","doc":[{"type":"paragraph","text":"Thanks."}],"show_answers":false,"action_bar":"auto"},
    {"id":"w1","type":"wait","n":1,"unit":"days","at10":true,"skip_weekends":false},
    {"id":"b1","type":"branch","cond":{"on":"answer","field_key":"format","op":"is","value":"Reels"},
     "yes":[{"id":"fy","type":"email","name":"Reels tips","to":"person","from":"creators","reply_to":"team","subject":"Reels","doc":[{"type":"paragraph","text":"Reels."}],"show_answers":false}],
     "no":[{"id":"fn","type":"email","name":"General tips","to":"person","from":"creators","reply_to":"team","subject":"Tips","doc":[{"type":"paragraph","text":"Tips."}],"show_answers":false}]}]}'::jsonb;
  PERFORM public.admin_automation_save_draft(v_form, 0, v_flow, '{"booked":true,"stage":true}');
  PERFORM public.admin_automation_publish(v_form, 1);
  PERFORM public.admin_automation_set_enabled(v_form, true);
  RESET ROLE;

  -- ADV-11: a replayed idempotency key.
  SET LOCAL ROLE service_role;
  v_sub := public.forms_submit_core(jsonb_build_object('idempotency_key', v_key, 'form_id', v_form, 'email', 'late-unsub@fixture-4452.org',
    'answers', pg_temp.t_creator_answers('late-unsub@fixture-4452.org', 'Photo', true), 'consent_text', 'tips',
    'time_zone', 'Africa/Lagos', 'time_zone_source', 'browser', 'page_path', '/creators', 'placement', 'inline', 'ads_allowed', false));
  v_again := public.forms_submit_core(jsonb_build_object('idempotency_key', v_key, 'form_id', v_form, 'email', 'late-unsub@fixture-4452.org',
    'answers', pg_temp.t_creator_answers('late-unsub@fixture-4452.org', 'Photo', true),
    'time_zone', 'Africa/Lagos', 'page_path', '/creators', 'placement', 'inline', 'ads_allowed', false));
  RESET ROLE;
  PERFORM pg_temp.t_assert(v_again->>'replay' = 'true' AND v_again->>'submission_id' = v_sub->>'submission_id' AND v_again->>'deduped' = 'false',
    'ADV-11 a replayed key returns the same submission, not a dedupe');
  PERFORM pg_temp.t_assert((SELECT resubmit_count = 0 FROM public.form_submissions WHERE id = (v_sub->>'submission_id')::uuid),
    'ADV-11 a replay is never counted as a resubmit');
  PERFORM pg_temp.t_assert((SELECT count(*) FROM public.form_automation_runs WHERE submission_id = (v_sub->>'submission_id')::uuid) = 1,
    'ADV-11 a replay starts no second run');

  -- ADV-6: send the welcome, then the person unsubscribes from a link before the follow-up is due.
  v_run := (v_sub->>'run_id')::uuid;
  UPDATE public.form_automation_sends SET due_at = now() - interval '1 second' WHERE run_id = v_run AND status = 'scheduled';
  FOR v_s IN SELECT * FROM public.forms_claim_due_sends(50) c WHERE c.run_id = v_run LOOP
    v_g := public.forms_send_gate(v_s.id);
    PERFORM pg_temp.t_assert(v_g->>'action' = 'send', 'ADV-6 the welcome is allowed');
    PERFORM public.forms_finish_send(v_s.id, 'sent', NULL, NULL, 'resend-x');
  END LOOP;
  PERFORM pg_temp.t_assert((SELECT step_id = 'fn' AND status = 'scheduled' FROM public.form_automation_sends WHERE run_id = v_run AND status = 'scheduled'),
    'ADV-8 a skipped optional answer takes the "no" branch (the follow-up is scheduled)');
  PERFORM pg_temp.t_assert((SELECT extract(hour FROM due_at AT TIME ZONE 'Africa/Lagos') = 10 FROM public.form_automation_sends WHERE run_id = v_run AND step_id = 'fn'),
    'ADV-7 the follow-up is due at 10:00 Lagos time');
  -- The one-click unsubscribe shape (channel_suppressions, marketing scope), in another case.
  INSERT INTO public.channel_suppressions (contact, channel, scope, reason) VALUES ('Late-Unsub@Fixture-4452.org', 'email', 'marketing', 'unsubscribe');
  UPDATE public.form_automation_sends SET due_at = now() - interval '1 second' WHERE run_id = v_run AND status = 'scheduled';
  SELECT * INTO v_s FROM public.forms_claim_due_sends(50) c WHERE c.run_id = v_run;
  v_g := public.forms_send_gate(v_s.id);
  PERFORM pg_temp.t_assert(v_g->>'action' = 'skip' AND v_g->>'reason' = 'unsubscribed', 'ADV-6 an unsubscribe after scheduling stops the follow-up: ' || v_g::text);
  PERFORM pg_temp.t_assert((SELECT status = 'stopped' AND stop_reason = 'unsubscribed' FROM public.form_automation_runs WHERE id = v_run),
    'ADV-6 the run stops as unsubscribed');

  -- ADV-6b: a marketing-only unsubscribe never blocks a confirmation for a new submission.
  SET LOCAL ROLE service_role;
  v_sub := public.forms_submit_core(jsonb_build_object('idempotency_key', gen_random_uuid(), 'form_id', v_form, 'email', 'late-unsub@fixture-4452.org',
    'answers', pg_temp.t_creator_answers('late-unsub@fixture-4452.org', 'Video', false) || '{"format":["Reels"]}'::jsonb,
    'time_zone', 'Africa/Lagos', 'page_path', '/creators', 'placement', 'inline', 'ads_allowed', false));
  RESET ROLE;
  PERFORM pg_temp.t_assert(v_sub->>'deduped' = 'true', 'ADV-6b the same email within 24 h is a dedupe (no second welcome)');

  SET LOCAL ROLE service_role;
  v_sub := public.forms_submit_core(jsonb_build_object('idempotency_key', gen_random_uuid(), 'form_id', v_form, 'email', 'reels@fixture-4452.org',
    'answers', pg_temp.t_creator_answers('reels@fixture-4452.org', 'Video', true) || '{"format":["Reels","Stories"]}'::jsonb, 'consent_text', 'tips',
    'time_zone', 'Not/AZone', 'page_path', '/creators', 'placement', 'inline', 'ads_allowed', false));
  RESET ROLE;
  INSERT INTO public.channel_suppressions (contact, channel, scope, reason) VALUES ('reels@fixture-4452.org', 'email', 'marketing', 'unsubscribe');
  v_run := (v_sub->>'run_id')::uuid;
  PERFORM pg_temp.t_assert((SELECT time_zone = 'UTC' AND time_zone_source = 'fallback_utc' FROM public.form_automation_runs WHERE id = v_run),
    'ADV-7 a made-up zone falls back to UTC and says so');
  SELECT * INTO v_s FROM public.forms_claim_due_sends(50) c WHERE c.run_id = v_run;
  v_g := public.forms_send_gate(v_s.id);
  PERFORM pg_temp.t_assert(v_g->>'action' = 'send', 'ADV-6b a marketing-only unsubscribe still lets the confirmation through');
  PERFORM public.forms_finish_send(v_s.id, 'sent', NULL, NULL, 'resend-y');
  PERFORM pg_temp.t_assert((SELECT step_id = 'fy' FROM public.form_automation_sends WHERE run_id = v_run AND status = 'scheduled'),
    'ADV-8 a multi answer containing the value takes the "yes" branch');
END
$t$;
ROLLBACK;

-- ═══ ADV-7: DST and odd-offset zones (forms_next_local_time) ══════════════════
BEGIN;
DO $t$
BEGIN
  -- New York springs forward on Sun 2026-03-08: 10:00 EDT is 14:00 UTC (the day before it was 15:00 UTC).
  PERFORM pg_temp.t_assert(public.forms_next_local_time('2026-03-07 20:00+00', 'America/New_York', 1, 'days', true, false) = '2026-03-08 14:00+00',
    'ADV-7 New York spring-forward day: 10:00 EDT');
  -- London springs forward on Sun 2026-03-29: 10:00 BST is 09:00 UTC.
  PERFORM pg_temp.t_assert(public.forms_next_local_time('2026-03-28 12:00+00', 'Europe/London', 1, 'days', true, false) = '2026-03-29 09:00+00',
    'ADV-7 London spring-forward day: 10:00 BST');
  -- Skip weekends across the Dublin change: Fri 2026-03-27 + 1 working day = Mon 03-30 10:00 IST = 09:00 UTC.
  PERFORM pg_temp.t_assert(public.forms_next_local_time('2026-03-27 15:00+00', 'Europe/Dublin', 1, 'days', true, true) = '2026-03-30 09:00+00',
    'ADV-7 skip weekends across a DST change lands Monday 10:00 local');
  -- Half-hour and quarter-hour zones.
  PERFORM pg_temp.t_assert(public.forms_next_local_time('2026-11-16 12:00+00', 'Asia/Kolkata', 2, 'days', true, false) = '2026-11-18 04:30+00',
    'ADV-7 Kolkata (+05:30): 10:00 IST is 04:30 UTC');
  PERFORM pg_temp.t_assert(public.forms_next_local_time('2026-11-16 12:00+00', 'Asia/Kathmandu', 1, 'days', true, false) = '2026-11-17 04:15+00',
    'ADV-7 Kathmandu (+05:45): 10:00 is 04:15 UTC');
  -- Lord Howe moves by 30 minutes (+11 in summer from 2026-10-04): 12:00 UTC 11-15 is 23:00 local; next day 10:00 local = 23:00 UTC 11-15.
  PERFORM pg_temp.t_assert(public.forms_next_local_time('2026-11-15 12:00+00', 'Australia/Lord_Howe', 1, 'days', true, false) = '2026-11-15 23:00+00',
    'ADV-7 Lord Howe summer (+11)');
  -- An hours wait across New York's fall-back (Sun 2026-11-01 06:00 UTC): 01:30 EDT + 1 h = 01:30 EST (06:30 UTC), no at10.
  PERFORM pg_temp.t_assert(public.forms_next_local_time('2026-11-01 05:30+00', 'America/New_York', 1, 'hours', false, false) = '2026-11-01 06:30+00',
    'ADV-7 an hours wait is real elapsed time across fall-back');
  -- A week wait across a change keeps 10:00 local (London: 10-21 BST -> 10-28 GMT).
  PERFORM pg_temp.t_assert(public.forms_next_local_time('2026-10-21 09:00+00', 'Europe/London', 1, 'weeks', true, false) = '2026-10-28 10:00+00',
    'ADV-7 a weekly wait keeps 10:00 local after the clocks change');
  -- Injection-shaped zone strings fall back to UTC (never reach AT TIME ZONE).
  PERFORM pg_temp.t_assert(public.forms_valid_zone($$UTC'; DROP TABLE x; --$$) IS NULL AND public.forms_valid_zone('../../etc/passwd') IS NULL,
    'ADV-7 an injection-shaped zone is refused');
END
$t$;
ROLLBACK;

-- ═══ ADV-9 / ADV-10: slugs and preview scope ═════════════════════════════════
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
DO $t$
DECLARE
  v_web constant uuid := '44520000-0000-4000-f000-000000000031';
  v_form uuid; v_form2 uuid; v_draftform uuid; v_other uuid; v jsonb; v_rev integer; v_pages jsonb; v_tok text; v_p jsonb; k text;
BEGIN
  INSERT INTO auth.users(id, email, email_confirmed_at) VALUES (v_web, 't4452-web3@mingla-fixture.org', now());
  INSERT INTO public.admin_team_members(email, role, status, accepted_at) VALUES ('t4452-web3@mingla-fixture.org', 'website', 'active', now());
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t_as(v_web);
  v := public.admin_form_create('Loop form', 'creator', 'creators');
  v_form := (v->>'id')::uuid;
  PERFORM public.admin_form_mark_tested(v_form);
  FOREACH k IN ARRAY ARRAY['loop-a', 'loop-b', 'loop-a'] LOOP
    v := public.admin_form_get(v_form);
    v_rev := (v->>'draft_rev')::integer;
    PERFORM public.admin_form_save_draft(v_form, v_rev, jsonb_set(v->'draft', '{own_page}', jsonb_build_object('on', true, 'slug', k, 'bg', 'night', 'index', false)));
    PERFORM public.admin_form_publish(v_form, v_rev + 1);
  END LOOP;
  v := public.admin_form_create('Thief form', 'creator', 'creators');
  v_form2 := (v->>'id')::uuid;
  v := public.admin_form_get(v_form2);
  PERFORM pg_temp.t_assert(pg_temp.t_state(format('SELECT public.admin_form_save_draft(%L, %s, %L::jsonb)', v_form2, (v->>'draft_rev')::integer,
      jsonb_set(v->'draft', '{own_page}', '{"on":true,"slug":"loop-b","bg":"night","index":false}'))) = '22023',
    'ADV-9 a retired slug can never be taken by another form (slug_taken)');

  -- ADV-10 fixtures: a draft form (never live) with a secret owner, used in the preview; another draft form not used.
  v := public.admin_form_create('Draft in preview', 'creator', 'creators');
  v_draftform := (v->>'id')::uuid;
  v := public.admin_form_get(v_draftform);
  PERFORM public.admin_form_save_draft(v_draftform, (v->>'draft_rev')::integer,
    jsonb_set(v->'draft', '{routing}', '{"card":{"on":true,"pipeline":"creators"},"owner":{"mode":"person","emails":["owner-secret@usemingla.com"]}}'));
  v := public.admin_form_create('Draft not in preview', 'creator', 'creators');
  v_other := (v->>'id')::uuid;
  -- Another page's draft that must not leak into a creators preview.
  PERFORM public.admin_site_page_save_draft('locals', 0, jsonb_build_object('blocks', jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'type', 'form', 'spot', 'after-steps', 'form_id', v_other, 'head', 'LOCALS DRAFT SECRET'))));
  v := public.admin_site_page_create_preview_token('creators', jsonb_build_object('blocks', jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'type', 'form', 'spot', 'after-steps', 'form_id', v_draftform, 'head', 'Join the', 'em', 'list.'))));
  v_tok := v->>'token';
  RESET ROLE;

  SET LOCAL ROLE anon;
  v_pages := public.site_public_content()->'form_pages';
  PERFORM pg_temp.t_assert(v_pages->'loop-a'->>'current_slug' = 'loop-a' AND v_pages->'loop-b'->>'current_slug' = 'loop-a',
    'ADV-9 A -> B -> A: both slugs point at the current one: ' || v_pages::text);
  PERFORM pg_temp.t_assert(NOT EXISTS (SELECT 1 FROM jsonb_each(v_pages) e
      WHERE e.value->>'current_slug' <> e.key AND (v_pages->(e.value->>'current_slug')->>'current_slug') IS DISTINCT FROM e.value->>'current_slug'),
    'ADV-9 every redirect is one hop to a slug that renders (no loop)');
  v_p := public.site_public_preview(v_tok);
  PERFORM pg_temp.t_assert(v_p->>'page_key' = 'creators', 'ADV-10 the token is for its own page');
  PERFORM pg_temp.t_assert(position('LOCALS DRAFT SECRET' IN v_p::text) = 0, 'ADV-10 another page''s draft never rides along');
  PERFORM pg_temp.t_assert(v_p->'forms' ? v_draftform::text AND NOT (v_p->'forms' ? v_other::text),
    'ADV-10 only the draft form in its own blocks is included');
  PERFORM pg_temp.t_assert(position('owner-secret' IN v_p::text) = 0 AND position('routing' IN v_p::text) = 0,
    'ADV-10 a draft form in a preview never carries routing owners');
  PERFORM pg_temp.t_assert(position('owner-secret' IN public.site_public_content()::text) = 0, 'ADV-10 nor does the public content');
  RESET ROLE;
END
$t$;
ROLLBACK;
