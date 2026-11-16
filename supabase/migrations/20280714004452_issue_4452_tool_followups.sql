-- #4452 §6.9 (SC-144): the free tools' follow-up emails run through the forms
-- automation engine, as one system form per tool (template 'tool').
--
-- * Four forms, `tool-<tool>-followups` (venues, events, trips, experiences):
--   audience host, ads.lead_on=false and goal none (the tool lead stays
--   lead:tool:<id>, so nothing double-fires), the consent field carrying the
--   tool's own box text. Each is live (version 1) with its automation live and
--   on: wait 2 days → "Fix #1 in ten minutes"; wait 5 more days → "Re-check
--   your <tool>". Both emails come after a wait, so both are follow-ups (F-6):
--   forms_send_gate sends them only with marketing consent, checks both
--   suppression lists and adds the unsubscribe link.
-- * forms_tool_followup_enroll(): called by growth-tools-gate only when the
--   visitor ticked "Also send me tips for hosts. Optional." It writes the
--   form_submissions row (placement 'inline', page_path '/tools/<tool>',
--   answers {tool, run_id}) and starts the run. One enrolment per run id, and
--   at most one live sequence per email per tool in 7 days.
--
-- The forms are seeded, never created through admin_form_create (which refuses
-- template 'tool'), and owned by a fixed system id. Re-running is a no-op.
BEGIN;

DO $seed$
DECLARE
  c_system constant uuid := '00000000-0000-4000-8000-000000004452';
  v_tool text;
  v_name text;
  v_path text;
  v_noun text;
  v_def jsonb;
  v_flow jsonb;
  v_form uuid;
  v_ver uuid;
  v_check jsonb;
BEGIN
  FOREACH v_tool IN ARRAY ARRAY['venues','events','trips','experiences'] LOOP
    v_name := CASE v_tool WHEN 'venues' THEN 'Venue grader' WHEN 'events' THEN 'Turnout forecast'
                          WHEN 'trips' THEN 'Trip quote' ELSE 'Pricing audit' END;
    v_path := CASE v_tool WHEN 'experiences' THEN '/tools/pricing' ELSE '/tools/' || v_tool END;
    v_noun := CASE v_tool WHEN 'venues' THEN 'venue grade' WHEN 'events' THEN 'turnout forecast'
                          WHEN 'trips' THEN 'trip quote' ELSE 'pricing' END;
    IF EXISTS (SELECT 1 FROM public.forms WHERE key = 'tool-' || v_tool || '-followups') THEN CONTINUE; END IF;

    -- The default host definition, with the tool's own consent box text.
    v_def := public.forms_default_definition('host', 'tool');
    v_def := jsonb_set(v_def, '{fields}', (
      SELECT jsonb_agg(CASE WHEN f->>'type' = 'consent'
                            THEN jsonb_set(f, '{label}', '"Also send me tips for hosts. Optional."')
                            ELSE f END ORDER BY o)
        FROM jsonb_array_elements(v_def->'fields') WITH ORDINALITY AS x(f, o)));

    v_flow := jsonb_build_object('v', 1, 'steps', jsonb_build_array(
      jsonb_build_object('id', 'w1', 'type', 'wait', 'n', 2, 'unit', 'days', 'at10', true, 'skip_weekends', false),
      jsonb_build_object('id', 'fix1', 'type', 'email', 'name', 'Fix #1 in ten minutes', 'to', 'person',
        'from', 'hosts', 'reply_to', 'team', 'subject', 'Fix #1 in ten minutes',
        'doc', jsonb_build_array(
          jsonb_build_object('type', 'paragraph', 'text',
            'Your report put one fix first because it makes the biggest difference, and most hosts finish it in about ten minutes.'),
          jsonb_build_object('type', 'paragraph', 'text',
            'Open your report from the email we sent and start with fix #1. Reply to this email if you would like a hand.')),
        'button', jsonb_build_object('text', 'Book a 20-minute call', 'to', jsonb_build_object('kind', 'schedule')),
        'show_answers', false, 'action_bar', 'host'),
      jsonb_build_object('id', 'w2', 'type', 'wait', 'n', 5, 'unit', 'days', 'at10', true, 'skip_weekends', false),
      jsonb_build_object('id', 'recheck', 'type', 'email', 'name', 'Re-check', 'to', 'person',
        'from', 'hosts', 'reply_to', 'team', 'subject', 'Re-check your ' || v_noun,
        'doc', jsonb_build_array(
          jsonb_build_object('type', 'paragraph', 'text',
            'It has been a week. Run the free ' || lower(v_name) || ' again to see what changed since your first report. It takes about a minute.')),
        'button', jsonb_build_object('text', 'Run it again', 'to', jsonb_build_object('kind', 'url', 'href', 'https://usemingla.com' || v_path)),
        'show_answers', false, 'action_bar', 'host')));

    v_check := public.forms_validate_flow(v_flow, v_def, false);
    IF NOT (v_check->>'ok')::boolean THEN
      RAISE EXCEPTION '#4452 tool follow-up flow invalid for %: %', v_tool, v_check->'errors';
    END IF;

    INSERT INTO public.forms (key, name, audience, template, status, draft, created_by, updated_by)
    VALUES ('tool-' || v_tool || '-followups', 'Free tool follow-ups: ' || v_name, 'host', 'tool', 'draft', v_def, c_system, c_system)
    RETURNING id INTO v_form;
    INSERT INTO public.form_versions (form_id, version, definition, definition_sha256, published_by)
    VALUES (v_form, 1, v_def, encode(sha256(convert_to(v_def::text, 'UTF8')), 'hex'), c_system)
    RETURNING id INTO v_ver;
    UPDATE public.forms SET status = 'live', live_version_id = v_ver, tested_at = now() WHERE id = v_form;

    INSERT INTO public.form_automations (form_id, enabled, draft, draft_rev, live_version, updated_by)
    VALUES (v_form, true, v_flow, 1, 1, c_system);
    INSERT INTO public.form_automation_versions (form_id, version, flow, stops, published_by)
    SELECT v_form, 1, a.draft, a.stops, c_system FROM public.form_automations a WHERE a.form_id = v_form;
  END LOOP;
END;
$seed$;

-- The tool's email step, with the tips box ticked: one submission and one run.
CREATE FUNCTION public.forms_tool_followup_enroll(p_tool text, p_run_id uuid, p_email text, p_time_zone text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_form public.forms;
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_sub uuid;
BEGIN
  IF p_tool IS NULL OR p_tool NOT IN ('venues','events','trips','experiences') THEN
    RAISE EXCEPTION 'bad_tool' USING ERRCODE = '22023';
  END IF;
  IF p_run_id IS NULL OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR length(v_email) > 254 THEN
    RAISE EXCEPTION 'bad_input' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_form FROM public.forms WHERE key = 'tool-' || p_tool || '-followups' AND status = 'live';
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- One live sequence per person per tool: a second run inside 7 days adds nothing.
  IF EXISTS (SELECT 1 FROM public.form_submissions s
              WHERE s.form_id = v_form.id AND s.email = v_email AND s.created_at > now() - interval '7 days') THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.form_submissions (form_id, form_version_id, lead_label, idempotency_key, email, answers,
                                       time_zone, page_path, placement, ads_allowed, marketing_consent, consent_text, consent_at)
  VALUES (v_form.id, v_form.live_version_id, 'host', p_run_id, v_email,
          jsonb_build_object('tool', p_tool, 'run_id', p_run_id),
          public.forms_valid_zone(p_time_zone),
          CASE p_tool WHEN 'experiences' THEN '/tools/pricing' ELSE '/tools/' || p_tool END,
          'inline', false, true, 'Also send me tips for hosts. Optional.', now())
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_sub;
  IF v_sub IS NULL THEN RETURN NULL; END IF;
  RETURN public.forms_start_run(v_sub, p_time_zone, 'browser');
END;
$fn$;
REVOKE ALL ON FUNCTION public.forms_tool_followup_enroll(text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.forms_tool_followup_enroll(text, uuid, text, text) TO service_role;
COMMENT ON FUNCTION public.forms_tool_followup_enroll(text, uuid, text, text) IS
  '#4452 §6.9: growth-tools-gate calls this only when "Also send me tips for hosts" was ticked. Writes the tool-<tool>-followups submission (answers {tool, run_id}) and starts its automation run; the follow-ups still pass forms_send_gate (consent, suppression, unsubscribe).';

COMMIT;
