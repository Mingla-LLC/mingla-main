\set ON_ERROR_STOP on
-- #4452 M6 tool follow-ups (§6.9, SC-144): executable PostgreSQL 17 proof, after the full migration replay.
--
-- TF-1 the four system forms are seeded live (template 'tool', audience host, ads off, goal none)
--      with their automation live and on, and each flow passes forms_validate_flow
-- TF-2 both emails are follow-ups (after a wait), so the engine needs consent, suppression and unsubscribe
-- TF-3 enrolling writes one submission (placement 'inline', page_path '/tools/<tool>', answers {tool, run_id},
--      consent with the tool's box text) and starts one run; the first send is the day-2 email
-- TF-4 the same run id, or the same email on the same tool within 7 days, adds nothing
-- TF-5 SC-144: a submission without consent (defence in depth) gets no follow-up: the gate skips it
-- TF-6 a bad tool is refused; only the service role may call the enrolment
-- (#4452 B25: the fixtures use mingla-fixture.org, a real-person domain, since an example.test email now
--  enrols as an is_test submission whose waits shrink to one minute.)
--
-- FAILS-ON-REVERT: deleting the consent check (step 6) in forms_send_gate fails TF-5; dropping the 7-day
-- guard in forms_tool_followup_enroll fails TF-4; seeding the first email before the wait fails TF-2.

CREATE OR REPLACE FUNCTION pg_temp.t_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4452 tool follow-ups FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

BEGIN;
DO $t$
DECLARE
  v_f public.forms;
  v_a public.form_automations;
  v_run uuid;
  v_run2 uuid;
  v_sub public.form_submissions;
  v_s public.form_automation_sends;
  v_g jsonb;
  v_tool text;
  v_n integer;
  v_err text;
  c_run constant uuid := '44520000-0000-4000-f000-0000000000a1';
BEGIN
  -- TF-1
  FOREACH v_tool IN ARRAY ARRAY['venues','events','trips','experiences'] LOOP
    SELECT * INTO v_f FROM public.forms WHERE key = 'tool-' || v_tool || '-followups';
    PERFORM pg_temp.t_assert(FOUND AND v_f.status = 'live' AND v_f.template = 'tool' AND v_f.audience = 'host' AND v_f.live_version_id IS NOT NULL,
      'TF-1 ' || v_tool || ': the system form is live, template tool, audience host');
    PERFORM pg_temp.t_assert((v_f.draft->'ads'->>'lead_on')::boolean IS FALSE AND v_f.draft->'ads'->>'goal' = 'none',
      'TF-1 ' || v_tool || ': ads off and goal none (the tool lead never double-fires)');
    PERFORM pg_temp.t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(v_f.draft->'fields') x
                                      WHERE x->>'type' = 'consent' AND x->>'label' = 'Also send me tips for hosts. Optional.'),
      'TF-1 ' || v_tool || ': the consent field carries the tool box text');
    SELECT * INTO v_a FROM public.form_automations WHERE form_id = v_f.id;
    PERFORM pg_temp.t_assert(v_a.enabled AND v_a.live_version = 1
      AND EXISTS (SELECT 1 FROM public.form_automation_versions WHERE form_id = v_f.id AND version = 1),
      'TF-1 ' || v_tool || ': the automation is live and on');
    PERFORM pg_temp.t_assert((public.forms_validate_flow(v_a.draft, v_f.draft, false)->>'ok')::boolean,
      'TF-1 ' || v_tool || ': the flow validates');
    -- TF-2: the flow's kinds, the same walk the engine uses.
    PERFORM pg_temp.t_assert(public.forms_flow_has_follow_up(v_a.draft)
      AND (v_a.draft->'steps'->0->>'type') = 'wait' AND (v_a.draft->'steps'->1->>'subject') = 'Fix #1 in ten minutes'
      AND (v_a.draft->'steps'->2->>'type') = 'wait' AND (v_a.draft->'steps'->3->>'subject') LIKE 'Re-check your %',
      'TF-2 ' || v_tool || ': day 2 "Fix #1 in ten minutes", then the re-check, both after a wait');
  END LOOP;

  -- TF-3
  v_run := public.forms_tool_followup_enroll('venues', c_run, '  Host@Mingla-Fixture.ORG ', 'Africa/Lagos');
  PERFORM pg_temp.t_assert(v_run IS NOT NULL, 'TF-3 enrolment starts a run');
  SELECT s.* INTO v_sub FROM public.form_submissions s JOIN public.form_automation_runs r ON r.submission_id = s.id WHERE r.id = v_run;
  PERFORM pg_temp.t_assert(v_sub.placement = 'inline' AND v_sub.page_path = '/tools/venues' AND v_sub.email = 'host@mingla-fixture.org'
    AND v_sub.answers = jsonb_build_object('tool', 'venues', 'run_id', c_run) AND v_sub.lead_label = 'host'
    AND v_sub.marketing_consent AND v_sub.consent_text = 'Also send me tips for hosts. Optional.' AND NOT v_sub.ads_allowed,
    'TF-3 the submission: inline, /tools/venues, answers {tool, run_id}, consent with the box text, ads off');
  SELECT count(*) INTO v_n FROM public.form_automation_sends WHERE run_id = v_run;
  SELECT * INTO v_s FROM public.form_automation_sends WHERE run_id = v_run ORDER BY due_at LIMIT 1;
  PERFORM pg_temp.t_assert(v_n = 1 AND v_s.step_id = 'fix1' AND v_s.email_kind = 'follow_up' AND v_s.due_at > now() + interval '1 day',
    'TF-3 the first send is the day-2 follow-up, scheduled after the wait');
  v_run2 := public.forms_tool_followup_enroll('experiences', gen_random_uuid(), 'host@mingla-fixture.org', NULL);
  PERFORM pg_temp.t_assert(v_run2 IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.form_submissions WHERE page_path = '/tools/pricing' AND answers->>'tool' = 'experiences'),
    'TF-3 the pricing tool lands on /tools/pricing');

  -- TF-4
  PERFORM pg_temp.t_assert(public.forms_tool_followup_enroll('venues', c_run, 'host@mingla-fixture.org', NULL) IS NULL,
    'TF-4 the same run id adds nothing');
  PERFORM pg_temp.t_assert(public.forms_tool_followup_enroll('venues', gen_random_uuid(), 'HOST@mingla-fixture.org', NULL) IS NULL,
    'TF-4 a second run for the same email and tool within 7 days adds nothing');
  SELECT count(*) INTO v_n FROM public.form_submissions s JOIN public.forms f ON f.id = s.form_id
   WHERE f.key = 'tool-venues-followups' AND s.email = 'host@mingla-fixture.org';
  PERFORM pg_temp.t_assert(v_n = 1, 'TF-4 one submission for that person and tool');

  -- TF-5: consent is checked again at send time (a row that somehow lacks it never gets the email).
  UPDATE public.form_submissions SET marketing_consent = false, consent_at = NULL WHERE id = v_sub.id;
  UPDATE public.form_automation_sends SET due_at = now() - interval '1 second' WHERE id = v_s.id;
  PERFORM 1 FROM public.forms_claim_due_sends(50) c WHERE c.id = v_s.id;
  v_g := public.forms_send_gate(v_s.id);
  PERFORM pg_temp.t_assert(v_g->>'action' = 'skip' AND v_g->>'reason' = 'no_consent', 'TF-5 SC-144 no consent: the follow-up is skipped (' || v_g::text || ')');
  -- With consent the same gate sends it.
  v_run2 := public.forms_tool_followup_enroll('trips', gen_random_uuid(), 'yes@mingla-fixture.org', 'Europe/London');
  SELECT * INTO v_s FROM public.form_automation_sends WHERE run_id = v_run2 ORDER BY due_at LIMIT 1;
  UPDATE public.form_automation_sends SET due_at = now() - interval '1 second' WHERE id = v_s.id;
  PERFORM 1 FROM public.forms_claim_due_sends(50) c WHERE c.id = v_s.id;
  v_g := public.forms_send_gate(v_s.id);
  PERFORM pg_temp.t_assert(v_g->>'action' = 'send' AND v_g->>'email_kind' = 'follow_up', 'TF-5 with consent the follow-up sends (' || COALESCE(v_g->>'action', '?') || ')');

  -- TF-6
  BEGIN
    PERFORM public.forms_tool_followup_enroll('karaoke', gen_random_uuid(), 'a@mingla-fixture.org', NULL);
    v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE || ':' || SQLERRM;
  END;
  PERFORM pg_temp.t_assert(v_err = '22023:bad_tool', 'TF-6 an unknown tool is refused');
  PERFORM pg_temp.t_assert(NOT has_function_privilege('anon', 'public.forms_tool_followup_enroll(text, uuid, text, text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.forms_tool_followup_enroll(text, uuid, text, text)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.forms_tool_followup_enroll(text, uuid, text, text)', 'EXECUTE'),
    'TF-6 only the service role may enrol');
END
$t$;
ROLLBACK;
