-- Issue #4452 (follow-up B21, B22, B25, B26) — Forms automations fixes found in
-- production on a QA form.
--
-- B21 (P0): forms_validate_flow walked the whole flow with `strict $.**` and
-- treated every object with `id` and `type` as a step, so an email's doc
-- blocks (rich_text, divider, image, blog_post) fell to `ELSE false` and every
-- email written in the editor failed with `bad_step:<block id>`. It now walks
-- only real steps: the top-level `steps` list and each branch's `yes` / `no`
-- lists, at any depth. A real step with no type, a non-object step, or a step
-- whose check is undecidable (a missing field made it NULL) now fails instead
-- of slipping through (`IS NOT TRUE`). The token walk (forms_flow_tokens_ok)
-- stays deep on purpose. forms_flow_step_ids, forms_flow_find,
-- forms_flow_kinds_walk and forms_walk_path already walk only steps and are
-- unchanged.
-- B22 (P2): admin_form_publish check 5 ("You sent yourself a test") passes
-- when the draft automation sends the person no email (no confirmation or
-- follow-up), since "Send me a test" has nothing to send then.
-- B25 (P3): forms_tool_followup_enroll marks its form_submissions row is_test
-- when inbound_lead_is_test(email, tool run name) is true, the rule the tool's
-- own lead event uses, so the form lead event is a test too.
--
-- B26 (P3): forms_submit_core marks a public submission is_test when
-- inbound_lead_is_test(email, name) is true. The row and its lead event are
-- tests (out of Forms KPIs, Results and Submissions); no pipeline card, no
-- 24 h dedupe; the automation run still starts, so staff can test a live
-- form end to end (waits shrink to one minute, subjects start with "[Test]").
-- A caller's explicit is_test keeps its old meaning (no routing, no run).
--
-- Signatures, LANGUAGE, volatility, SECURITY DEFINER / INVOKER, search_path
-- and grants are unchanged (grants restated below exactly as first issued).
--
-- Invariant (declared in the pg17 test): I-4452-FLOW-VALIDATOR-REAL-STEPS | issue #4452 | forms_validate_flow validates only flow steps (top-level and branch yes / no), never an email's doc blocks.

BEGIN;

CREATE OR REPLACE FUNCTION public.forms_validate_flow(p_flow jsonb, p_def jsonb, p_card_on boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $fn$
DECLARE
  v_err jsonb := '[]'::jsonb;
  v_ids text[];
  v_tok text;
  v_bad jsonb;
  v_pipeline text := p_def->'routing'->'card'->>'pipeline';
BEGIN
  IF jsonb_typeof(p_flow) IS DISTINCT FROM 'object' OR jsonb_typeof(p_flow->'steps') IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object('path', '', 'code', 'bad_flow')));
  END IF;
  v_ids := public.forms_flow_step_ids(p_flow->'steps');
  IF cardinality(v_ids) > 30 THEN v_err := v_err || jsonb_build_object('path', 'steps', 'code', 'too_many_steps'); END IF; -- F-1
  IF (SELECT count(DISTINCT i) FROM unnest(v_ids) i) <> cardinality(v_ids)
     OR EXISTS (SELECT 1 FROM unnest(v_ids) i WHERE i IS NULL OR i !~ '^[a-z0-9_-]{2,40}$') THEN
    v_err := v_err || jsonb_build_object('path', 'steps', 'code', 'duplicate_id');                         -- F-2
  END IF;
  -- Per step shape (any depth).
  -- #4452 B21: only real steps (the top-level list and branch yes / no lists, any
  -- depth), never an email's doc blocks, which also carry `id` and `type`.
  FOR v_bad IN
    WITH RECURSIVE walk(s) AS (
      SELECT e FROM jsonb_array_elements(p_flow->'steps') e
      UNION ALL
      SELECT e FROM walk w, jsonb_array_elements(
        CASE WHEN jsonb_typeof(w.s) = 'object' AND w.s->>'type' = 'branch'
             THEN (CASE WHEN jsonb_typeof(w.s->'yes') = 'array' THEN w.s->'yes' ELSE '[]'::jsonb END)
               || (CASE WHEN jsonb_typeof(w.s->'no') = 'array' THEN w.s->'no' ELSE '[]'::jsonb END)
             ELSE '[]'::jsonb END) e
    )
    SELECT s FROM walk
     WHERE (jsonb_typeof(s) = 'object' AND CASE s->>'type'
         WHEN 'email' THEN public.forms_text_ok(s->'name', 1, 60) AND s->>'to' = 'person'
              AND COALESCE(s->>'from', '') IN ('creators','locals','hosts','seth')
              AND COALESCE(s->>'reply_to', '') IN ('team','owner')
              AND public.forms_text_ok(s->'subject', 1, 80)
              AND jsonb_typeof(s->'doc') = 'array'
              AND EXISTS (SELECT 1 FROM jsonb_path_query(s->'doc', 'strict $.**') t
                           WHERE jsonb_typeof(t) = 'string' AND public.forms_clean_text(t #>> '{}', true) <> '')
              AND jsonb_typeof(s->'show_answers') = 'boolean'
              AND (NOT (s ? 'action_bar') OR s->>'action_bar' IN ('auto','host','creator','local','off'))
         WHEN 'team' THEN public.forms_text_ok(s->'name', 1, 60)
              AND COALESCE(s->>'to', '') IN ('creators_inbox','locals_inbox','hosts_inbox','owner','seth')
              AND jsonb_typeof(s->'include_answers') = 'boolean'
         WHEN 'wait' THEN jsonb_typeof(s->'n') = 'number' AND (s->>'n') ~ '^[0-9]+$' AND (s->>'n')::integer BETWEEN 1 AND 60
              AND COALESCE(s->>'unit', '') IN ('hours','days','weeks')
              AND jsonb_typeof(s->'at10') = 'boolean' AND jsonb_typeof(s->'skip_weekends') = 'boolean'
         WHEN 'branch' THEN jsonb_typeof(s->'cond') = 'object'
              AND COALESCE(s->'cond'->>'on', '') IN ('answer','booked','opened_last','clicked_last','lead_label')
              AND COALESCE(s->'cond'->>'op', '') IN ('is','is_not','contains')
              AND jsonb_typeof(s->'yes') = 'array' AND jsonb_typeof(s->'no') = 'array'
              AND (s->'cond'->>'on' <> 'answer' OR EXISTS (
                     SELECT 1 FROM jsonb_array_elements(COALESCE(p_def->'fields', '[]'::jsonb)) f
                      WHERE f->>'key' = s->'cond'->>'field_key' AND f->>'type' IN ('single','multi','dropdown')
                        AND f->'source' IS DISTINCT FROM '"google_city"'::jsonb))
         WHEN 'stage' THEN p_card_on AND v_pipeline IS NOT NULL
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(public.crm_pipeline_def(v_pipeline)->'stages') st
                           WHERE st->>'id' = s->>'stage')
         ELSE false END) IS NOT TRUE
  LOOP
    v_err := v_err || jsonb_build_object('path', 'steps', 'code',
      CASE WHEN v_bad->>'type' = 'stage' AND NOT p_card_on THEN 'stage_needs_card' ELSE 'bad_step:' || COALESCE(v_bad->>'id', '?') END);
  END LOOP;
  v_tok := public.forms_flow_tokens_ok(p_flow, p_def);
  IF v_tok IS NOT NULL THEN v_err := v_err || jsonb_build_object('path', 'steps', 'code', 'unknown_token:' || v_tok); END IF; -- F-9
  IF public.forms_flow_has_follow_up(p_flow)
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_def->'fields', '[]'::jsonb)) f WHERE f->>'type' = 'consent') THEN
    v_err := v_err || jsonb_build_object('path', 'steps', 'code', 'follow_up_needs_consent');             -- F-7
  END IF;
  RETURN jsonb_build_object('ok', jsonb_array_length(v_err) = 0, 'errors', v_err);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_form_publish(p_form_id uuid, p_expected_rev integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_f public.forms;
  v_check jsonb;
  v_failed jsonb := '[]'::jsonb;
  v_version integer;
  v_vid uuid;
  v_slug text;
  v_flow jsonb;
  v_has_follow boolean := false;
BEGIN
  IF NOT public.forms_can_edit() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_f FROM public.forms WHERE id = p_form_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_f.status = 'archived' THEN RAISE EXCEPTION 'form_archived' USING ERRCODE = '22023'; END IF;
  IF v_f.draft_rev <> p_expected_rev THEN RAISE EXCEPTION 'form_draft_conflict' USING ERRCODE = 'PT409'; END IF;

  v_check := public.forms_validate_definition(v_f.draft);
  IF NOT (v_check->>'ok')::boolean THEN v_failed := v_failed || (v_check->'errors'); END IF;
  IF NOT public.forms_locked_ok(v_f.template, v_f.draft) THEN
    v_failed := v_failed || jsonb_build_object('path', 'fields', 'code', 'locked_field');
  END IF;
  -- The five design checks.
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_f.draft->'fields') f
                  WHERE f->>'type' = 'email' AND f->'required' = 'true'::jsonb) THEN
    v_failed := v_failed || jsonb_build_object('path', 'check', 'code', 'email_required');
  END IF;
  IF to_regclass('public.form_automations') IS NOT NULL THEN
    SELECT a.draft INTO v_flow FROM public.form_automations a WHERE a.form_id = p_form_id;
    v_has_follow := v_flow IS NOT NULL AND public.forms_flow_has_follow_up(v_flow);
  END IF;
  IF v_has_follow AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_f.draft->'fields') f WHERE f->>'type' = 'consent') THEN
    v_failed := v_failed || jsonb_build_object('path', 'check', 'code', 'consent_for_follow_ups');   -- R-4
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_f.draft->'fields') f WHERE f->>'type' = 'consent' AND f->'required' = 'true'::jsonb) THEN
    v_failed := v_failed || jsonb_build_object('path', 'check', 'code', 'consent_optional');
  END IF;
  IF COALESCE(v_f.draft->>'audience', '') NOT IN ('host','creator','local') THEN
    v_failed := v_failed || jsonb_build_object('path', 'check', 'code', 'lead_label_set');
  END IF;
  -- #4452 B22: "You sent yourself a test" only binds a flow that sends the person an email.
  IF v_f.tested_at IS NULL AND v_flow IS NOT NULL AND EXISTS (
       SELECT 1 FROM jsonb_each_text(public.forms_flow_kinds(v_flow)) k WHERE k.value IN ('confirmation', 'follow_up')) THEN
    v_failed := v_failed || jsonb_build_object('path', 'check', 'code', 'tested');
  END IF;
  IF jsonb_array_length(v_failed) > 0 THEN
    RAISE EXCEPTION 'publish_check_failed' USING ERRCODE = '22023', DETAIL = v_failed::text;
  END IF;

  SELECT COALESCE(max(version), 0) + 1 INTO v_version FROM public.form_versions WHERE form_id = p_form_id;
  INSERT INTO public.form_versions (form_id, version, definition, definition_sha256, published_by)
  VALUES (p_form_id, v_version, v_f.draft, encode(sha256(convert_to(v_f.draft::text, 'UTF8')), 'hex'), auth.uid())
  RETURNING id INTO v_vid;
  UPDATE public.forms SET status = 'live', live_version_id = v_vid, updated_by = auth.uid(), updated_at = now()
   WHERE id = p_form_id;

  v_slug := CASE WHEN v_f.draft->'own_page'->'on' = 'true'::jsonb THEN v_f.draft->'own_page'->>'slug' END;
  IF v_slug IS NULL THEN
    UPDATE public.form_page_slugs SET is_current = false, retired_at = now() WHERE form_id = p_form_id AND is_current;
  ELSIF NOT EXISTS (SELECT 1 FROM public.form_page_slugs WHERE slug = v_slug AND form_id = p_form_id AND is_current) THEN
    IF EXISTS (SELECT 1 FROM public.form_page_slugs WHERE slug = v_slug AND form_id <> p_form_id) THEN
      RAISE EXCEPTION 'slug_taken' USING ERRCODE = '22023';
    END IF;
    UPDATE public.form_page_slugs SET is_current = false, retired_at = now() WHERE form_id = p_form_id AND is_current;
    INSERT INTO public.form_page_slugs (slug, form_id) VALUES (v_slug, p_form_id)
    ON CONFLICT (slug) DO UPDATE SET is_current = true, retired_at = NULL
      WHERE public.form_page_slugs.form_id = EXCLUDED.form_id;
  END IF;
  RETURN jsonb_build_object('version', v_version, 'slug', v_slug);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.forms_tool_followup_enroll(p_tool text, p_run_id uuid, p_email text, p_time_zone text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_form public.forms;
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_sub uuid;
  v_name text;
  v_test boolean;
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
  -- #4452 B25: a test tool run (internal email, staff, or a test name) is a test submission,
  -- the same rule its tool_leads lead event uses, so it never counts in Forms results.
  SELECT t.input->>'name' INTO v_name FROM public.tool_leads t WHERE t.id = p_run_id;
  v_test := COALESCE(public.inbound_lead_is_test(v_email, v_name), false);
  INSERT INTO public.form_submissions (form_id, form_version_id, lead_label, idempotency_key, email, answers,
                                       time_zone, page_path, placement, ads_allowed, marketing_consent, consent_text, consent_at,
                                       is_test)
  VALUES (v_form.id, v_form.live_version_id, 'host', p_run_id, v_email,
          jsonb_build_object('tool', p_tool, 'run_id', p_run_id),
          public.forms_valid_zone(p_time_zone),
          CASE p_tool WHEN 'experiences' THEN '/tools/pricing' ELSE '/tools/' || p_tool END,
          'inline', false, true, 'Also send me tips for hosts. Optional.', now(), v_test)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_sub;
  IF v_sub IS NULL THEN RETURN NULL; END IF;
  RETURN public.forms_start_run(v_sub, p_time_zone, 'browser');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.forms_submit_core(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_key   uuid := (p->>'idempotency_key')::uuid;
  v_form  public.forms;
  v_ver   public.form_versions;
  v_email text := lower(btrim(COALESCE(p->>'email', '')));
  v_prev  public.form_submissions;
  v_sub   uuid;
  v_consent boolean := COALESCE(p->'consent' = 'true'::jsonb, false);
  -- #4452 B26: v_test is stored on the row (a caller's flag, or inbound_lead_is_test once the
  -- name is known); v_caller_test alone keeps its old meaning (no routing, no run).
  v_caller_test boolean := COALESCE(p->'is_test' = 'true'::jsonb, false);
  v_test  boolean := COALESCE(p->'is_test' = 'true'::jsonb, false);
  v_check jsonb;
  v_route jsonb := NULL;
  v_run   uuid := NULL;
  v_existing uuid;
BEGIN
  -- Step 5: idempotency (the column and the side table). #4452 rework 1 (P2-9):
  -- concurrent retries with one key serialise on a per-key lock first, so the
  -- second sees the first's committed row and replays it (no unique violation,
  -- no double-counted resubmit).
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('forms_submit_key:' || v_key::text, 0));
  SELECT id INTO v_existing FROM public.form_submissions WHERE idempotency_key = v_key;
  IF NOT FOUND THEN
    SELECT submission_id INTO v_existing FROM public.form_submission_keys WHERE idempotency_key = v_key;
  END IF;
  IF v_existing IS NOT NULL THEN
    SELECT * INTO v_prev FROM public.form_submissions WHERE id = v_existing;
    RETURN jsonb_build_object('replay', true, 'submission_id', v_prev.id, 'lead_event_id', v_prev.lead_event_id,
                              'deduped', v_prev.idempotency_key <> v_key, 'lead_label', v_prev.lead_label);
  END IF;

  SELECT * INTO v_form FROM public.forms WHERE id = (p->>'form_id')::uuid;
  IF NOT FOUND OR v_form.status <> 'live' THEN RAISE EXCEPTION 'form_closed' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_ver FROM public.form_versions WHERE id = v_form.live_version_id;
  v_check := public.forms_validate_answers(v_ver.definition, p->'answers',
               COALESCE((p->>'today')::date, (now() AT TIME ZONE 'UTC')::date));
  IF NOT (v_check->>'ok')::boolean THEN
    RAISE EXCEPTION 'validation' USING ERRCODE = '22023', DETAIL = (v_check->'errors')::text;
  END IF;
  IF v_email <> COALESCE(v_check->>'email', '') THEN RAISE EXCEPTION 'validation' USING ERRCODE = '22023'; END IF;
  v_consent := (v_check->>'consent')::boolean;
  -- #4452 B26: a test or internal email or name (the one rule every lead source uses) is a test
  -- submission: it never counts in Forms KPIs, Results or Submissions, its lead event is a test,
  -- it gets no pipeline card and no 24 h dedupe, and its run still starts so staff can test the
  -- live flow end to end (waits shrink to one minute, subjects start with "[Test]").
  v_test := v_caller_test OR COALESCE(public.inbound_lead_is_test(v_email, v_check->>'name'), false);

  -- Step 9: one row per form, email and 24 h.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('forms_submit:' || v_form.id || ':' || v_email, 0));
  SELECT * INTO v_prev FROM public.form_submissions
   WHERE form_id = v_form.id AND email = v_email AND created_at > now() - interval '24 hours' AND NOT is_test
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND AND NOT v_test THEN
    -- The key claims this resubmit exactly once (the conflict target is the key).
    INSERT INTO public.form_submission_keys (idempotency_key, submission_id) VALUES (v_key, v_prev.id)
    ON CONFLICT (idempotency_key) DO NOTHING;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('replay', true, 'submission_id', v_prev.id, 'lead_event_id', v_prev.lead_event_id,
                                'deduped', true, 'lead_label', v_prev.lead_label);
    END IF;
    UPDATE public.form_submissions SET
      answers = v_check->'values',
      name = COALESCE(v_check->>'name', name),
      phone_e164 = COALESCE(v_check->>'phone_e164', phone_e164),
      phone_country = COALESCE(v_check->>'phone_country', phone_country),
      -- consent only goes false -> true
      marketing_consent = marketing_consent OR v_consent,
      consent_text = CASE WHEN marketing_consent THEN consent_text WHEN v_consent THEN left(p->>'consent_text', 300) ELSE consent_text END,
      consent_at = CASE WHEN marketing_consent THEN consent_at WHEN v_consent THEN now() ELSE consent_at END,
      utm_source = COALESCE(left(p->'utm'->>'source', 100), utm_source),
      utm_medium = COALESCE(left(p->'utm'->>'medium', 100), utm_medium),
      utm_campaign = COALESCE(left(p->'utm'->>'campaign', 150), utm_campaign),
      utm_content = COALESCE(left(p->'utm'->>'content', 150), utm_content),
      utm_term = COALESCE(left(p->'utm'->>'term', 150), utm_term),
      utm_id = COALESCE(left(p->'utm'->>'id', 100), utm_id),
      resubmit_count = resubmit_count + 1,
      last_resubmitted_at = now(),
      updated_at = now()
     WHERE id = v_prev.id;
    IF v_prev.crm_record_id IS NOT NULL THEN
      INSERT INTO public.crm_activity (record_id, kind, actor_email, via, body, occurred_at, created_at)
      VALUES (v_prev.crm_record_id, 'note', 'forms@usemingla.com', left('form-' || v_form.key, 40),
              left(format('Sent the form again: %s (%s)', v_form.name, COALESCE(p->>'page_path', '/')), 4000), now(), now());
    END IF;
    RETURN jsonb_build_object('replay', false, 'deduped', true, 'submission_id', v_prev.id,
                              'lead_event_id', v_prev.lead_event_id, 'lead_label', v_prev.lead_label);
  END IF;

  INSERT INTO public.form_submissions (
    form_id, form_version_id, lead_label, idempotency_key, email, name, phone_e164, phone_country, answers,
    time_zone, page_path, placement, spot_key, block_id, utm_source, utm_medium, utm_campaign, utm_content,
    utm_term, utm_id, click_source, referrer_host, ads_allowed, marketing_consent, consent_text, consent_at, is_test)
  VALUES (
    v_form.id, v_ver.id, v_form.audience, v_key, v_email, v_check->>'name', v_check->>'phone_e164',
    v_check->>'phone_country', v_check->'values', left(p->>'time_zone', 64), left(COALESCE(p->>'page_path', '/'), 300),
    p->>'placement', NULLIF(p->>'spot_key', ''), NULLIF(p->>'block_id', '')::uuid,
    left(p->'utm'->>'source', 100), left(p->'utm'->>'medium', 100), left(p->'utm'->>'campaign', 150),
    left(p->'utm'->>'content', 150), left(p->'utm'->>'term', 150), left(p->'utm'->>'id', 100),
    p->>'click_source', left(p->>'referrer_host', 253), COALESCE(p->'ads_allowed' = 'true'::jsonb, false),
    v_consent, CASE WHEN v_consent THEN left(COALESCE(p->>'consent_text', ''), 300) END,
    CASE WHEN v_consent THEN now() END, v_test)
  RETURNING id INTO v_sub;

  IF NOT v_test AND p->>'placement' IS DISTINCT FROM 'book_call_details' THEN
    v_route := public.forms_route_submission(v_sub);
  ELSE
    v_route := jsonb_build_object('routing_status', 'lead_only');
  END IF;
  -- Step 13: start the automation run (M3) for a live, enabled automation.
  IF to_regprocedure('public.forms_start_run(uuid,text,text)') IS NOT NULL
     AND p->>'placement' IS DISTINCT FROM 'book_call_details' AND NOT v_caller_test THEN
    v_run := public.forms_start_run(v_sub, p->>'time_zone', COALESCE(p->>'time_zone_source', 'fallback_utc'));
  END IF;
  RETURN jsonb_build_object('replay', false, 'deduped', false, 'submission_id', v_sub, 'lead_event_id', NULL,
                            'lead_label', v_form.audience, 'routing_status', v_route->>'routing_status',
                            'run_id', v_run, 'goal', COALESCE(v_ver.definition->'ads'->>'goal', 'none'),
                            'lead_on', COALESCE(v_ver.definition->'ads'->'lead_on' = 'true'::jsonb, false),
                            'form_key', v_form.key);
END;
$fn$;

REVOKE ALL ON FUNCTION public.forms_validate_flow(jsonb, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.forms_validate_flow(jsonb, jsonb, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_form_publish(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_form_publish(uuid, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.forms_tool_followup_enroll(text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.forms_tool_followup_enroll(text, uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.forms_submit_core(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.forms_submit_core(jsonb) TO service_role;

COMMIT;
