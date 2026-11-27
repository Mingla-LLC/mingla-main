\set ON_ERROR_STOP on
-- #4452 M3 automations: executable PostgreSQL 17 proof, after the full migration replay.
-- MINGLA-INVARIANT: I-4452-CONSENT-GATES-FOLLOWUPS | issue #4452 | a follow-up is never sent without marketing_consent, nor to a suppressed or unsubscribed email (forms_send_gate).
--
-- T-5.3  SC-16, SC-63  forms_next_local_time returns the four binding §5.3 vectors (Lagos, Dublin skip
--                      weekends, London DST, New York hours) and falls back to UTC for 'Not/AZone'.
-- T-1.3a SC-17  a claimed send is never claimed again while its lease runs (SKIP LOCKED + status).
-- T-1.3b SC-18  a lease-expired send on its third attempt becomes failed and is not claimed.
-- T-1.3c SC-19  the retention job exists and its SQL deletes attempts older than 7 days.
-- T-5.1/5.7 SC-62, SC-70  the walker: Welcome + team alert now, then the branch on "What do you make?":
--                      Video -> the Video guide, others -> the Day 2 nudge, scheduled at 10:00 local; then completion.
-- T-5.2  SC-64  no consent: the confirmation sends, the follow-up is skipped/no_consent.
-- T-5.4  SC-65  a marketing unsubscribe skips the follow-up (unsubscribed) and stops the run.
-- T-5.4b SC-66  a channel_suppressions bounce skips the confirmation (suppressed); the run continues.
-- T-5.5  SC-67  a booking stops the run (booked); no follow-up after it.
-- A1-T-5d A1-SC-15, SC-68  the stage stop fires only with a CRM card, never without one; a stage step is
--                      refused at save without the card (F-4).
-- T-5.6b SC-69  stops.unsub=false or replied=true is refused by the CHECK.
-- T-5.8  SC-71  a published flow that removes a scheduled step cancels it (step_removed); sent steps never resend.
-- T-5.8b SC-72  a step inserted before the cursor is never sent to that run; one after it is.
-- T-5.9  SC-73  paused: no claims; re-enabled: a send more than 72 h overdue is skipped/automation_paused.
-- T-5.10 SC-74  a retry backs off 15 min, 1 h, then fails at the third attempt.
-- T-5.14 SC-81  an unknown merge token blocks the save and names the token.
--
-- FAILS-ON-REVERT: using UTC instead of the zone in forms_next_local_time fails T-5.3; deleting the
-- consent check (step 6) in forms_send_gate fails T-5.2; deleting the unsubscribe check fails T-5.4;
-- deleting the booked check fails T-5.5; dropping the crm_record_id guard on the stage stop fails A1-T-5d.

CREATE OR REPLACE FUNCTION pg_temp.a_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4452 automations FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;
CREATE OR REPLACE FUNCTION pg_temp.a_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
END
$a$;
CREATE OR REPLACE FUNCTION pg_temp.a_state(p_sql text)
RETURNS text LANGUAGE plpgsql AS $a$
DECLARE v_d text;
BEGIN EXECUTE p_sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_d = PG_EXCEPTION_DETAIL;
  RETURN SQLSTATE || ':' || SQLERRM || ':' || COALESCE(v_d, '');
END
$a$;
-- One sender pass: make due, claim, gate, "send". Returns the outcome per step id.
CREATE OR REPLACE FUNCTION pg_temp.a_tick(p_run uuid)
RETURNS jsonb LANGUAGE plpgsql AS $a$
DECLARE v_s public.form_automation_sends; v_g jsonb; v_out jsonb := '{}'::jsonb;
BEGIN
  UPDATE public.form_automation_sends SET due_at = now() - interval '1 second' WHERE run_id = p_run AND status = 'scheduled';
  FOR v_s IN SELECT * FROM public.forms_claim_due_sends(50) c WHERE c.run_id = p_run LOOP
    v_g := public.forms_send_gate(v_s.id);
    IF v_g->>'action' = 'send' THEN
      PERFORM public.forms_finish_send(v_s.id, 'sent', NULL, NULL, 'resend-' || v_s.step_id);
      v_out := v_out || jsonb_build_object(v_s.step_id, 'sent');
    ELSE
      v_out := v_out || jsonb_build_object(v_s.step_id, (v_g->>'action') || ':' || (v_g->>'reason'));
    END IF;
  END LOOP;
  RETURN v_out;
END
$a$;
-- Repeat ticks until nothing is scheduled (max 10).
CREATE OR REPLACE FUNCTION pg_temp.a_drain(p_run uuid)
RETURNS jsonb LANGUAGE plpgsql AS $a$
DECLARE v jsonb := '{}'::jsonb; i integer;
BEGIN
  FOR i IN 1..10 LOOP
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.form_automation_sends WHERE run_id = p_run AND status = 'scheduled');
    v := v || pg_temp.a_tick(p_run);
  END LOOP;
  RETURN v;
END
$a$;

-- ═══ T-5.3 / T-1.3c ══════════════════════════════════════════════════════════
BEGIN;
DO $t$
BEGIN
  PERFORM pg_temp.a_assert(public.forms_next_local_time('2026-11-14 18:00+00', 'Africa/Lagos', 2, 'days', true, false) = '2026-11-16 09:00+00',
    'T-5.3 SC-63 Sat 18:00 UTC Lagos + 2 days at 10:00 -> Mon 09:00 UTC');
  PERFORM pg_temp.a_assert(public.forms_next_local_time('2026-11-13 18:00+00', 'Europe/Dublin', 2, 'days', true, true) = '2026-11-17 10:00+00',
    'T-5.3 Fri Dublin + 2 business days -> Tue 10:00');
  PERFORM pg_temp.a_assert(public.forms_next_local_time('2026-10-24 12:00+00', 'Europe/London', 1, 'days', true, false) = '2026-10-25 10:00+00',
    'T-5.3 London across the DST change -> Sun 10:00 GMT');
  PERFORM pg_temp.a_assert(public.forms_next_local_time('2026-11-09 09:30+00', 'America/New_York', 3, 'hours', true, false) = '2026-11-09 15:00+00',
    'T-5.3 New York + 3 hours -> the next 10:00 EST (15:00 UTC)');
  PERFORM pg_temp.a_assert(public.forms_next_local_time('2026-11-09 09:30+00', 'Not/AZone', 3, 'hours', true, false) = '2026-11-10 10:00+00',
    'T-5.3 an unknown zone falls back to UTC');
  PERFORM pg_temp.a_assert(public.forms_next_local_time('2026-11-13 23:30+00', 'Europe/Dublin', 1, 'hours', false, true) = '2026-11-16 00:30+00',
    'T-5.3 skip weekends from Friday 23:30 lands on Monday at the same local time');
  PERFORM pg_temp.a_assert(EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'issue_4452_forms_retention' AND schedule = '17 3 * * *'),
    'T-1.3c SC-19 the retention job exists');
  INSERT INTO public.forms_submit_attempts (ip_hash, outcome, created_at) VALUES
    (repeat('a', 64), 'accepted', now() - interval '8 days'), (repeat('b', 64), 'accepted', now() - interval '6 days');
  EXECUTE (SELECT command FROM cron.job WHERE jobname = 'issue_4452_forms_retention');
  PERFORM pg_temp.a_assert((SELECT count(*) FROM public.forms_submit_attempts WHERE ip_hash IN (repeat('a', 64), repeat('b', 64))) = 1,
    'T-1.3c SC-19 the retention SQL deletes attempts older than 7 days only');
  PERFORM pg_temp.a_assert(pg_temp.a_state($$INSERT INTO public.form_automations (form_id, draft, stops, updated_by)
      VALUES (gen_random_uuid(), '{}', '{"booked":true,"replied":false,"unsub":false,"stage":true}', gen_random_uuid())$$) LIKE '23514%',
    'T-5.6b SC-69 stops.unsub=false is refused by the CHECK');
  PERFORM pg_temp.a_assert(pg_temp.a_state($$INSERT INTO public.form_automations (form_id, draft, stops, updated_by)
      VALUES (gen_random_uuid(), '{}', '{"booked":true,"replied":true,"unsub":true,"stage":true}', gen_random_uuid())$$) LIKE '23514%',
    'T-5.6b SC-69 replied=true is refused by the CHECK');
END
$t$;
ROLLBACK;

-- ═══ The walker and the stop rules ═══════════════════════════════════════════
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
DO $t$
DECLARE
  v_web constant uuid := '44520000-0000-4000-e000-000000000001';
  v_form uuid; v_host uuid; v jsonb; v_flow jsonb; v_rev integer; v_sub jsonb; v_run uuid; v_r jsonb; v_s public.form_automation_sends;
  v_tick jsonb; v_e text;
BEGIN
  INSERT INTO auth.users(id, email, email_confirmed_at) VALUES (v_web, 'a4452-web@mingla-fixture.org', now());
  INSERT INTO public.admin_team_members(email, role, status, accepted_at) VALUES ('a4452-web@mingla-fixture.org', 'website', 'active', now());
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.a_as(v_web);
  v := public.admin_form_create('Creators: join', 'creator', 'creators');
  v_form := (v->>'id')::uuid;
  PERFORM public.admin_form_mark_tested(v_form);
  PERFORM public.admin_form_publish(v_form, 1);
  v_flow := '{"v":1,"steps":[
    {"id":"s0","type":"email","name":"Welcome","to":"person","from":"creators","reply_to":"team","subject":"You''re on the list, {first_name}","doc":[{"type":"paragraph","text":"Hi {first_name}, thanks for applying in {answers.city}."}],"show_answers":false,"action_bar":"auto"},
    {"id":"s1","type":"team","name":"Team alert","to":"creators_inbox","include_answers":true},
    {"id":"w1","type":"wait","n":2,"unit":"days","at10":true,"skip_weekends":false},
    {"id":"b1","type":"branch","cond":{"on":"answer","field_key":"what_do_you_make","op":"is","value":"Video"},
     "yes":[{"id":"s2v","type":"email","name":"Video guide","to":"person","from":"creators","reply_to":"team","subject":"Your video guide","doc":[{"type":"paragraph","text":"Video tips."}],"show_answers":false}],
     "no":[{"id":"s2","type":"email","name":"Day 2 nudge","to":"person","from":"creators","reply_to":"team","subject":"Your first gig","doc":[{"type":"paragraph","text":"Book a 20-minute call."}],"show_answers":false}]},
    {"id":"w2","type":"wait","n":3,"unit":"days","at10":true,"skip_weekends":false},
    {"id":"s3","type":"email","name":"Day 5","to":"person","from":"creators","reply_to":"team","subject":"Last note","doc":[{"type":"paragraph","text":"We will stop here."}],"show_answers":false}]}'::jsonb;
  -- T-5.14: an unknown token blocks the save and names it.
  v_e := pg_temp.a_state(format($$SELECT public.admin_automation_save_draft(%L, 0, %L::jsonb, '{}'::jsonb)$$, v_form,
           jsonb_set(v_flow, '{steps,0,subject}', '"Hi {nickname}"')));
  PERFORM pg_temp.a_assert(v_e LIKE '22023%unknown_token:nickname%', 'T-5.14 SC-81 an unknown merge token blocks and is named');
  -- F-4: a stage step without a card is refused.
  v_e := pg_temp.a_state(format($$SELECT public.admin_automation_save_draft(%L, 0, %L::jsonb, '{}'::jsonb)$$, v_form,
           jsonb_set(v_flow, '{steps}', (v_flow->'steps') || '[{"id":"st1","type":"stage","stage":"contacted"}]'::jsonb)));
  PERFORM pg_temp.a_assert(v_e LIKE '22023%stage_needs_card%', 'A1-T-5d F-4 a stage step is refused unless the card is on');
  v := public.admin_automation_save_draft(v_form, 0, v_flow, '{"booked":true,"stage":true}');
  v := public.admin_automation_publish(v_form, 1);
  PERFORM public.admin_automation_set_enabled(v_form, true);
  RESET ROLE;
  PERFORM pg_temp.a_assert(public.forms_flow_kinds(v_flow) = '{"s0":"confirmation","s1":"team_alert","s2":"follow_up","s2v":"follow_up","s3":"follow_up"}',
    'F-6 the email kinds are computed from the waits');

  -- ── T-5.1 / T-5.7: a Video maker with consent ──
  SET LOCAL ROLE service_role;
  v_sub := public.forms_submit_core(jsonb_build_object('idempotency_key', gen_random_uuid(), 'form_id', v_form, 'email', 'vid@mingla-fixture.org',
    'answers', jsonb_build_object('name', 'Ada Okafor', 'email', 'vid@mingla-fixture.org', 'consent', true,
       'phone', jsonb_build_object('country','NG','dial','+234','number','801 234 5678'), 'what_do_you_make', 'Video',
       'your_main_social', jsonb_build_object('platform','instagram','value','@ada'), 'city', jsonb_build_object('label','Lagos')),
    'consent_text', 'Send me creator tips', 'time_zone', 'Africa/Lagos', 'time_zone_source', 'browser', 'page_path', '/creators',
    'placement', 'inline', 'ads_allowed', true));
  RESET ROLE;
  v_run := (v_sub->>'run_id')::uuid;
  PERFORM pg_temp.a_assert(v_run IS NOT NULL, 'T-5.1 a new submission starts a run');
  PERFORM pg_temp.a_assert((SELECT step_id = 's0' AND email_kind = 'confirmation' AND due_at <= now() FROM public.form_automation_sends WHERE run_id = v_run),
    'T-5.1 SC-62 the Welcome is due now');
  v_tick := pg_temp.a_tick(v_run);
  PERFORM pg_temp.a_assert(v_tick = '{"s0":"sent"}', 'T-5.1 SC-62 the Welcome is sent');
  PERFORM pg_temp.a_assert((SELECT email_kind = 'team_alert' FROM public.form_automation_sends WHERE run_id = v_run AND step_id = 's1'), 'T-5.1 SC-62 the team alert follows');
  v_r := public.forms_send_gate((SELECT id FROM public.form_automation_sends WHERE run_id = v_run AND step_id = 's1'));
  PERFORM pg_temp.a_assert(v_r->>'to' = 'vid@mingla-fixture.org' AND v_r->'step'->>'to' = 'creators_inbox', 'T-5.1 the gate hands the sender the step (the sender maps the inbox)');
  v_tick := pg_temp.a_tick(v_run);
  PERFORM pg_temp.a_assert((SELECT step_id FROM public.form_automation_sends WHERE run_id = v_run AND status = 'scheduled') = 's2v',
    'T-5.7 SC-70 the Video branch picks the Video guide');
  PERFORM pg_temp.a_assert((SELECT extract(hour FROM due_at AT TIME ZONE 'Africa/Lagos') = 10 FROM public.form_automation_sends WHERE run_id = v_run AND step_id = 's2v'),
    'T-5.3 SC-63 the follow-up is scheduled for 10:00 in Lagos');
  v_tick := pg_temp.a_drain(v_run);
  PERFORM pg_temp.a_assert(v_tick = '{"s2v":"sent","s3":"sent"}', 'T-5.7 the rest of the flow sends in order');
  PERFORM pg_temp.a_assert((SELECT status = 'completed' AND passed_step_ids = ARRAY['s0','s1','w1','s2v','w2','s3'] FROM public.form_automation_runs WHERE id = v_run),
    'T-5.7 the run completes with every passed step');
  PERFORM pg_temp.a_assert(NOT EXISTS (SELECT 1 FROM public.form_automation_sends WHERE run_id = v_run AND step_id = 's2'), 'T-5.7 the other branch never sends');

  -- ── T-5.2: no consent ──
  SET LOCAL ROLE service_role;
  v_sub := public.forms_submit_core(jsonb_build_object('idempotency_key', gen_random_uuid(), 'form_id', v_form, 'email', 'nocon@mingla-fixture.org',
    'answers', jsonb_build_object('name', 'Ben Eze', 'email', 'nocon@mingla-fixture.org', 'consent', false,
       'phone', jsonb_build_object('country','NG','dial','+234','number','801 234 5678'), 'what_do_you_make', 'Photo',
       'your_main_social', jsonb_build_object('platform','instagram','value','@ben'), 'city', jsonb_build_object('label','Lagos')),
    'time_zone', 'Africa/Lagos', 'page_path', '/creators', 'placement', 'popup', 'ads_allowed', false));
  RESET ROLE;
  v_run := (v_sub->>'run_id')::uuid;
  v_tick := pg_temp.a_drain(v_run);
  PERFORM pg_temp.a_assert(v_tick->>'s0' = 'sent' AND v_tick->>'s1' = 'sent' AND v_tick->>'s2' = 'skip:no_consent' AND v_tick->>'s3' = 'skip:no_consent',
    'T-5.2 SC-64 no consent: the Welcome sends, the follow-ups are skipped/no_consent');

  -- ── T-5.4: unsubscribe stops the run ──
  SET LOCAL ROLE service_role;
  v_sub := public.forms_submit_core(jsonb_build_object('idempotency_key', gen_random_uuid(), 'form_id', v_form, 'email', 'unsub@mingla-fixture.org',
    'answers', jsonb_build_object('name', 'Cara Obi', 'email', 'unsub@mingla-fixture.org', 'consent', true,
       'phone', jsonb_build_object('country','NG','dial','+234','number','801 234 5678'), 'what_do_you_make', 'Photo',
       'your_main_social', jsonb_build_object('platform','instagram','value','@cara'), 'city', jsonb_build_object('label','Lagos')),
    'consent_text', 'x', 'time_zone', 'Africa/Lagos', 'page_path', '/creators', 'placement', 'inline', 'ads_allowed', true));
  RESET ROLE;
  v_run := (v_sub->>'run_id')::uuid;
  PERFORM pg_temp.a_tick(v_run); PERFORM pg_temp.a_tick(v_run);
  INSERT INTO public.marketing_unsubscribes (contact_email, channel, scope) VALUES ('unsub@mingla-fixture.org', 'email', 'global');
  v_tick := pg_temp.a_tick(v_run);
  PERFORM pg_temp.a_assert(v_tick = '{"s2":"skip:unsubscribed"}', 'T-5.4 SC-65 the follow-up is skipped/unsubscribed');
  PERFORM pg_temp.a_assert((SELECT status = 'stopped' AND stop_reason = 'unsubscribed' FROM public.form_automation_runs WHERE id = v_run), 'T-5.4 SC-65 the run stops');

  -- ── T-5.4b: a bounce skips the confirmation, the run continues ──
  INSERT INTO public.channel_suppressions (contact, channel, scope, reason) VALUES ('bounce@mingla-fixture.org', 'email', 'marketing', 'bounce');
  SET LOCAL ROLE service_role;
  v_sub := public.forms_submit_core(jsonb_build_object('idempotency_key', gen_random_uuid(), 'form_id', v_form, 'email', 'bounce@mingla-fixture.org',
    'answers', jsonb_build_object('name', 'Dayo Ade', 'email', 'bounce@mingla-fixture.org', 'consent', false,
       'phone', jsonb_build_object('country','NG','dial','+234','number','801 234 5678'), 'what_do_you_make', 'Photo',
       'your_main_social', jsonb_build_object('platform','instagram','value','@dayo'), 'city', jsonb_build_object('label','Lagos')),
    'time_zone', 'Africa/Lagos', 'page_path', '/creators', 'placement', 'inline', 'ads_allowed', true));
  RESET ROLE;
  v_run := (v_sub->>'run_id')::uuid;
  v_tick := pg_temp.a_tick(v_run);
  PERFORM pg_temp.a_assert(v_tick = '{"s0":"skip:suppressed"}', 'T-5.4b SC-66 a bounce skips the confirmation (suppressed)');
  PERFORM pg_temp.a_assert((SELECT status = 'active' FROM public.form_automation_runs WHERE id = v_run)
                       AND EXISTS (SELECT 1 FROM public.form_automation_sends WHERE run_id = v_run AND step_id = 's1' AND status = 'scheduled'),
    'T-5.4b the run continues (the team alert is next)');

  -- ── T-5.5: a booking stops the run ──
  SET LOCAL ROLE service_role;
  v_sub := public.forms_submit_core(jsonb_build_object('idempotency_key', gen_random_uuid(), 'form_id', v_form, 'email', 'book@mingla-fixture.org',
    'answers', jsonb_build_object('name', 'Efe Ojo', 'email', 'book@mingla-fixture.org', 'consent', true,
       'phone', jsonb_build_object('country','NG','dial','+234','number','801 234 5678'), 'what_do_you_make', 'Photo',
       'your_main_social', jsonb_build_object('platform','instagram','value','@efe'), 'city', jsonb_build_object('label','Lagos')),
    'consent_text', 'x', 'time_zone', 'Africa/Lagos', 'page_path', '/creators', 'placement', 'inline', 'ads_allowed', true));
  RESET ROLE;
  v_run := (v_sub->>'run_id')::uuid;
  PERFORM pg_temp.a_tick(v_run); PERFORM pg_temp.a_tick(v_run);
  INSERT INTO public.book_call_leads (booking_key, name, email, city, creator_makes, social_platform, social_url, call_at, audience)
  VALUES ('gcal:a4452-book', 'Efe Ojo', 'Book@Mingla-Fixture.org', 'Lagos', 'photo', 'instagram', 'https://instagram.com/efe', now() + interval '1 day', 'creator');
  v_tick := pg_temp.a_drain(v_run);
  PERFORM pg_temp.a_assert(v_tick = '{"s2":"skip:booked"}', 'T-5.5 SC-67 booking stops the follow-ups (skipped/booked)');
  PERFORM pg_temp.a_assert((SELECT stop_reason = 'booked' FROM public.form_automation_runs WHERE id = v_run)
                       AND NOT EXISTS (SELECT 1 FROM public.form_automation_sends WHERE run_id = v_run AND step_id = 's3'),
    'T-5.5 SC-67 the run stops booked and nothing is sent after it');

  -- ── T-5.8 / 5.8b: editing a live flow ──
  SET LOCAL ROLE service_role;
  v_sub := public.forms_submit_core(jsonb_build_object('idempotency_key', gen_random_uuid(), 'form_id', v_form, 'email', 'edit@mingla-fixture.org',
    'answers', jsonb_build_object('name', 'Funmi Lade', 'email', 'edit@mingla-fixture.org', 'consent', true,
       'phone', jsonb_build_object('country','NG','dial','+234','number','801 234 5678'), 'what_do_you_make', 'Photo',
       'your_main_social', jsonb_build_object('platform','instagram','value','@funmi'), 'city', jsonb_build_object('label','Lagos')),
    'consent_text', 'x', 'time_zone', 'Africa/Lagos', 'page_path', '/creators', 'placement', 'inline', 'ads_allowed', true));
  RESET ROLE;
  v_run := (v_sub->>'run_id')::uuid;
  PERFORM pg_temp.a_tick(v_run); PERFORM pg_temp.a_tick(v_run);     -- s0, s1 sent; s2 scheduled
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.a_as(v_web);
  -- New version: s2 removed from the "no" path; a new step "pre" before the cursor; "s4" after s3.
  v_flow := jsonb_set(v_flow, '{steps,3,no}', '[]');
  v_flow := jsonb_set(v_flow, '{steps}', jsonb_build_array(
      '{"id":"pre","type":"email","name":"Pre","to":"person","from":"creators","reply_to":"team","subject":"Pre","doc":[{"type":"paragraph","text":"x"}],"show_answers":false}'::jsonb)
    || (v_flow->'steps')
    || '[{"id":"s4","type":"email","name":"After","to":"person","from":"creators","reply_to":"team","subject":"After","doc":[{"type":"paragraph","text":"x"}],"show_answers":false}]'::jsonb);
  v := public.admin_automation_get(v_form);
  PERFORM public.admin_automation_save_draft(v_form, (v->>'draft_rev')::integer, v_flow, '{}'::jsonb);
  v := public.admin_automation_publish(v_form, (v->>'draft_rev')::integer + 1);
  RESET ROLE;
  v_tick := pg_temp.a_drain(v_run);
  PERFORM pg_temp.a_assert(v_tick->>'s2' = 'cancel:step_removed', 'T-5.8 SC-71 the removed scheduled step is cancelled (step_removed)');
  PERFORM pg_temp.a_assert(NOT (v_tick ? 'pre') AND NOT EXISTS (SELECT 1 FROM public.form_automation_sends WHERE run_id = v_run AND step_id = 'pre'),
    'T-5.8b SC-72 a step inserted before the cursor is never sent');
  PERFORM pg_temp.a_assert(v_tick->>'s3' = 'sent' AND v_tick->>'s4' = 'sent', 'T-5.8b SC-72 a step added after the cursor is sent');
  PERFORM pg_temp.a_assert((SELECT count(*) FROM public.form_automation_sends WHERE run_id = v_run AND step_id = 's0') = 1, 'T-5.8 SC-71 a sent step is never resent');

  -- ── T-5.9: pause and the 72 h rule ──
  SET LOCAL ROLE service_role;
  v_sub := public.forms_submit_core(jsonb_build_object('idempotency_key', gen_random_uuid(), 'form_id', v_form, 'email', 'pause@mingla-fixture.org',
    'answers', jsonb_build_object('name', 'Gbenga Oke', 'email', 'pause@mingla-fixture.org', 'consent', true,
       'phone', jsonb_build_object('country','NG','dial','+234','number','801 234 5678'), 'what_do_you_make', 'Photo',
       'your_main_social', jsonb_build_object('platform','instagram','value','@gb'), 'city', jsonb_build_object('label','Lagos')),
    'consent_text', 'x', 'time_zone', 'Africa/Lagos', 'page_path', '/creators', 'placement', 'inline', 'ads_allowed', true));
  RESET ROLE;
  v_run := (v_sub->>'run_id')::uuid;
  SET LOCAL ROLE authenticated; PERFORM pg_temp.a_as(v_web);
  PERFORM public.admin_automation_set_enabled(v_form, false);
  RESET ROLE;
  UPDATE public.form_automation_sends SET due_at = now() - interval '73 hours' WHERE run_id = v_run;
  PERFORM pg_temp.a_assert(NOT EXISTS (SELECT 1 FROM public.forms_claim_due_sends(50) c WHERE c.run_id = v_run), 'T-5.9 SC-73 paused: nothing is claimed');
  PERFORM pg_temp.a_assert((SELECT status = 'scheduled' FROM public.form_automation_sends WHERE run_id = v_run AND step_id = 'pre'), 'T-5.9 SC-73 scheduled sends wait (not cancelled)');
  SET LOCAL ROLE authenticated; PERFORM pg_temp.a_as(v_web);
  PERFORM public.admin_automation_set_enabled(v_form, true);
  RESET ROLE;
  SELECT * INTO v_s FROM public.forms_claim_due_sends(50) c WHERE c.run_id = v_run;
  v_r := public.forms_send_gate(v_s.id);
  PERFORM pg_temp.a_assert(v_r->>'reason' = 'automation_paused', 'T-5.9 SC-73 re-enabled: a send 72 h+ overdue is skipped/automation_paused');

  -- ── T-1.3a / 1.3b / T-5.10: claims and retries ──
  SELECT * INTO v_s FROM public.form_automation_sends WHERE run_id = v_run AND status = 'scheduled' LIMIT 1;
  UPDATE public.form_automation_sends SET due_at = now() - interval '1 minute' WHERE id = v_s.id;
  PERFORM pg_temp.a_assert(EXISTS (SELECT 1 FROM public.forms_claim_due_sends(50) c WHERE c.id = v_s.id), 'T-1.3a the first claim takes it');
  PERFORM pg_temp.a_assert(NOT EXISTS (SELECT 1 FROM public.forms_claim_due_sends(50) c WHERE c.id = v_s.id), 'T-1.3a SC-17 a second claim never returns the same send');
  PERFORM public.forms_finish_send(v_s.id, 'retry', NULL, 'resend 500', NULL);
  PERFORM pg_temp.a_assert((SELECT status = 'scheduled' AND due_at BETWEEN now() + interval '14 minutes' AND now() + interval '16 minutes'
                              FROM public.form_automation_sends WHERE id = v_s.id), 'T-5.10 SC-74 the first retry is in 15 minutes');
  UPDATE public.form_automation_sends SET due_at = now() - interval '1 second' WHERE id = v_s.id;
  PERFORM 1 FROM public.forms_claim_due_sends(50) c WHERE c.id = v_s.id;
  PERFORM public.forms_finish_send(v_s.id, 'retry', NULL, 'resend 503', NULL);
  PERFORM pg_temp.a_assert((SELECT due_at BETWEEN now() + interval '59 minutes' AND now() + interval '61 minutes' FROM public.form_automation_sends WHERE id = v_s.id),
    'T-5.10 SC-74 the second retry is in 1 hour');
  UPDATE public.form_automation_sends SET due_at = now() - interval '1 second' WHERE id = v_s.id;
  PERFORM 1 FROM public.forms_claim_due_sends(50) c WHERE c.id = v_s.id;
  PERFORM public.forms_finish_send(v_s.id, 'retry', NULL, 'resend 503', NULL);
  PERFORM pg_temp.a_assert((SELECT status = 'failed' AND attempts = 3 FROM public.form_automation_sends WHERE id = v_s.id), 'T-5.10 SC-74 after 3 attempts it fails');
  -- T-1.3b: a lease that expired on the third attempt.
  SELECT * INTO v_s FROM public.form_automation_sends WHERE run_id = v_run AND status = 'scheduled' LIMIT 1;
  IF v_s.id IS NOT NULL THEN
    UPDATE public.form_automation_sends SET status = 'sending', attempts = 3, lease_until = now() - interval '1 minute' WHERE id = v_s.id;
    PERFORM pg_temp.a_assert(NOT EXISTS (SELECT 1 FROM public.forms_claim_due_sends(50) c WHERE c.id = v_s.id),
      'T-1.3b SC-18 a lease-expired third attempt is not claimed');
    PERFORM pg_temp.a_assert((SELECT status FROM public.form_automation_sends WHERE id = v_s.id) = 'failed',
      'T-1.3b SC-18 it becomes failed');
  END IF;

  -- ── A1-T-5d: the stage stop needs a CRM card ──
  SET LOCAL ROLE authenticated; PERFORM pg_temp.a_as(v_web);
  v := public.admin_form_create('Hosts: card', 'host', NULL);
  v_host := (v->>'id')::uuid;
  v := public.admin_form_get(v_host);
  PERFORM public.admin_form_save_draft(v_host, 1, jsonb_set(v->'draft', '{routing}', '{"card":{"on":true,"pipeline":"hosts"},"owner":{"mode":"unassigned"}}'));
  PERFORM public.admin_form_mark_tested(v_host);
  PERFORM public.admin_form_publish(v_host, 2);
  PERFORM public.admin_automation_save_draft(v_host, 0, '{"v":1,"steps":[
     {"id":"h0","type":"email","name":"Welcome","to":"person","from":"hosts","reply_to":"team","subject":"Hi","doc":[{"type":"paragraph","text":"x"}],"show_answers":false},
     {"id":"hw","type":"wait","n":1,"unit":"days","at10":false,"skip_weekends":false},
     {"id":"h1","type":"email","name":"Nudge","to":"person","from":"hosts","reply_to":"team","subject":"Hi","doc":[{"type":"paragraph","text":"x"}],"show_answers":false}]}'::jsonb, '{}'::jsonb);
  PERFORM public.admin_automation_publish(v_host, 1);
  PERFORM public.admin_automation_set_enabled(v_host, true);
  RESET ROLE;
  SET LOCAL ROLE service_role;
  v_sub := public.forms_submit_core(jsonb_build_object('idempotency_key', gen_random_uuid(), 'form_id', v_host, 'email', 'stage@mingla-fixture.org',
    'answers', jsonb_build_object(
      'name', 'Stage Host Venue',
      'email', 'stage@mingla-fixture.org',
      'phone', jsonb_build_object('country', 'NG', 'dial', '+234', 'number', '801 234 5678'),
      'venue', 'Stage Host Venue',
      'icp', 'Events',
      'social', jsonb_build_object('platform', 'instagram', 'value', '@stage.host'),
      'consent', true), 'consent_text', 'x',
    'time_zone', 'UTC', 'page_path', '/host/restaurants', 'placement', 'inline', 'ads_allowed', true));
  RESET ROLE;
  v_run := (v_sub->>'run_id')::uuid;
  PERFORM pg_temp.a_tick(v_run);
  -- staff move the card past its first stage
  UPDATE public.crm_records SET stage = 'contacted' WHERE id = (SELECT crm_record_id FROM public.form_submissions WHERE id = (v_sub->>'submission_id')::uuid);
  INSERT INTO public.crm_activity (record_id, kind, actor_email, from_stage, to_stage, occurred_at, created_at)
  SELECT crm_record_id, 'stage_move', 'staff@mingla-fixture.org', 'prospect', 'contacted', now(), now() FROM public.form_submissions WHERE id = (v_sub->>'submission_id')::uuid;
  v_tick := pg_temp.a_tick(v_run);
  PERFORM pg_temp.a_assert(v_tick = '{"h1":"skip:stage_moved"}', 'A1-T-5d A1-SC-15 SC-68 with a card, a staff stage move stops the follow-ups');
  -- Without a card (the creators form above): nothing about stages ever stops a run.
  PERFORM pg_temp.a_assert(NOT EXISTS (SELECT 1 FROM public.form_automation_runs r JOIN public.form_submissions s ON s.id = r.submission_id
                                         WHERE s.form_id = v_form AND r.stop_reason = 'stage_moved'),
    'A1-T-5d A1-SC-15 with no card the stage rule never fires');
END
$t$;
ROLLBACK;
