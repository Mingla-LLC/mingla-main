-- Issue #4452 M3 automations (spec Part 5 §5.2–5.6; Part 2 §1.3; A1.3).
--
--   1. form_automations (draft + stops), form_automation_versions (immutable),
--      form_automation_runs, form_automation_sends, form_funnel_events.
--   2. forms_next_local_time: the §5.3 clock (10:00 in the person's zone, skip
--      weekends, DST-safe through AT TIME ZONE). Mirror: _shared/formsSchedule.ts.
--   3. The run walker forms_plan_next, forms_start_run, the claim/gate/finish
--      trio used by forms-automation-sender, and the §5.5 stop rules (booked,
--      stage moved only with a CRM card, unsubscribed, suppressed, consent).
--   4. Admin RPCs: automation get/save/publish/enable, stop emails, results,
--      and admin_forms_list (it reads M2 and M3).
--   5. Cron: the sender every 5 minutes (vault bearer) and a daily retention job.
--
-- MINGLA-INVARIANT: I-4452-CONSENT-GATES-FOLLOWUPS | issue #4452 | a follow-up is
-- never sent without marketing_consent, nor to a suppressed or unsubscribed
-- email (forms_send_gate; issue_4452_automations pg17 + sender tests).
--
-- ROLLBACK (manual, after M5 → M4):
--   SELECT cron.unschedule('issue_4452_forms_automation_sender'); SELECT cron.unschedule('issue_4452_forms_retention');
--   DROP FUNCTION IF EXISTS public.admin_forms_list(text), public.admin_form_results(uuid,timestamptz,timestamptz),
--     public.forms_record_engagement(uuid,text), public.forms_finish_send(uuid,text,text,text,text),
--     public.forms_send_gate(uuid), public.forms_claim_due_sends(integer), public.admin_form_submission_stop_emails(uuid),
--     public.admin_automation_set_enabled(uuid,boolean), public.admin_automation_publish(uuid,integer),
--     public.admin_automation_save_draft(uuid,integer,jsonb,jsonb), public.admin_automation_get(uuid),
--     public.forms_start_run(uuid,text,text), public.forms_plan_next(uuid), public.forms_walk_path(jsonb,uuid),
--     public.forms_branch_true(jsonb,uuid), public.forms_stop_run(uuid,text), public.forms_valid_zone(text),
--     public.forms_next_local_time(timestamptz,text,integer,text,boolean,boolean), public.forms_validate_flow(jsonb,jsonb,boolean),
--     public.forms_flow_tokens_ok(jsonb,jsonb), public.forms_flow_step_ids(jsonb), public.forms_flow_find(jsonb,text);
--   DROP TABLE IF EXISTS public.form_funnel_events, public.form_automation_sends, public.form_automation_runs,
--     public.form_automation_versions, public.form_automations;

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
CREATE TABLE public.form_automations (
  form_id        uuid PRIMARY KEY REFERENCES public.forms(id) ON DELETE CASCADE,
  enabled        boolean NOT NULL DEFAULT false,
  draft          jsonb NOT NULL,          -- AutomationFlow (§5.2)
  draft_rev      integer NOT NULL DEFAULT 1,
  live_version   integer,
  stops          jsonb NOT NULL DEFAULT '{"booked":true,"replied":false,"unsub":true,"stage":true}'::jsonb
                 CHECK ((stops->>'unsub')::boolean IS TRUE AND (stops->>'replied')::boolean IS FALSE),
  updated_by     uuid NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.form_automation_versions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id    uuid NOT NULL REFERENCES public.forms(id) ON DELETE RESTRICT,
  version    integer NOT NULL,
  flow       jsonb NOT NULL,
  stops      jsonb NOT NULL,
  published_by uuid NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (form_id, version)
);
CREATE TRIGGER form_automation_versions_no_update BEFORE UPDATE OR DELETE ON public.form_automation_versions
  FOR EACH ROW EXECUTE FUNCTION public.forms_versions_immutable();

CREATE TABLE public.form_automation_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id   uuid NOT NULL UNIQUE REFERENCES public.form_submissions(id) ON DELETE CASCADE,
  form_id         uuid NOT NULL REFERENCES public.forms(id) ON DELETE RESTRICT,
  started_version integer NOT NULL,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','stopped')),
  stop_reason     text CHECK (stop_reason IS NULL OR stop_reason IN ('booked','unsubscribed','stage_moved','staff_stopped','form_archived','failed')),
  passed_step_ids text[] NOT NULL DEFAULT '{}',
  cursor_step_id  text,
  time_zone       text NOT NULL,          -- valid IANA name or 'UTC'
  time_zone_source text NOT NULL CHECK (time_zone_source IN ('browser','fallback_utc')),
  -- §5.8 test runs: every email goes to the staff member who started it, waits are 1 minute.
  test_recipient  text CHECK (test_recipient IS NULL OR (test_recipient = lower(btrim(test_recipient)) AND length(test_recipient) <= 254)),
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  CONSTRAINT runs_end_shape CHECK ((status = 'active') = (ended_at IS NULL)),
  CONSTRAINT runs_stop_reason CHECK ((status = 'stopped') = (stop_reason IS NOT NULL))
);
CREATE INDEX form_automation_runs_active_idx ON public.form_automation_runs (form_id) WHERE status = 'active';

CREATE TABLE public.form_automation_sends (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid NOT NULL REFERENCES public.form_automation_runs(id) ON DELETE CASCADE,
  step_id       text NOT NULL CHECK (step_id ~ '^[a-z0-9_-]{2,40}$'),
  email_kind    text NOT NULL CHECK (email_kind IN ('confirmation','follow_up','team_alert')),
  due_at        timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'scheduled'
                CHECK (status IN ('scheduled','sending','sent','skipped','failed','cancelled')),
  skip_reason   text CHECK (skip_reason IS NULL OR skip_reason IN
                ('no_consent','suppressed','unsubscribed','booked','stage_moved','step_removed','automation_paused','form_archived','staff_stopped','test')),
  attempts      integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  lease_until   timestamptz,
  last_error    text CHECK (last_error IS NULL OR length(last_error) <= 300),
  provider_message_id text,
  sent_at       timestamptz,
  opened_at     timestamptz,
  clicked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, step_id)
);
CREATE INDEX form_automation_sends_due_idx ON public.form_automation_sends (due_at) WHERE status = 'scheduled';
CREATE INDEX form_automation_sends_run_idx ON public.form_automation_sends (run_id, created_at);

CREATE TABLE public.form_funnel_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  form_id     uuid NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
  event       text NOT NULL CHECK (event IN ('popup_shown','form_viewed','form_started','form_step','form_error','popup_closed','success_viewed','next_step')),
  visit_id    uuid NOT NULL,
  page_path   text NOT NULL CHECK (length(page_path) <= 300),
  placement   text NOT NULL CHECK (placement IN ('inline','popup','form_page','book_call_details')),
  step        smallint,
  props       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(props) = 'object' AND pg_column_size(props) <= 2048),
  utm_campaign text CHECK (utm_campaign IS NULL OR length(utm_campaign) <= 150),
  click_source text CHECK (click_source IS NULL OR click_source IN ('meta','google','tiktok','snap','reddit')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX form_funnel_events_form_idx ON public.form_funnel_events (form_id, created_at DESC);

ALTER TABLE public.form_automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_automation_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_automation_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_funnel_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.form_automations, public.form_automation_versions, public.form_automation_runs,
  public.form_automation_sends, public.form_funnel_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.form_automations, public.form_automation_versions, public.form_automation_runs,
  public.form_automation_sends, public.form_funnel_events TO service_role;

-- ---------------------------------------------------------------------------
-- 2. The clock (§5.3). Pure: callers clamp to now().
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.forms_valid_zone(p text) RETURNS text
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT CASE WHEN p IS NOT NULL AND length(p) <= 64 AND p ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$'
                   AND EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = p)
              THEN p ELSE NULL END
$$;

CREATE FUNCTION public.forms_next_local_time(p_from timestamptz, p_tz text, p_n integer, p_unit text,
                                             p_at10 boolean, p_skip_weekends boolean) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path = ''
AS $fn$
DECLARE
  v_tz    text := COALESCE(public.forms_valid_zone(p_tz), 'UTC');
  v_local timestamp;
  v_d     date;
  v_left  integer;
  v_t     timestamptz;
  v_cand  timestamptz;
  v_dow   integer;
BEGIN
  IF p_unit = 'hours' THEN
    v_t := p_from + make_interval(hours => p_n);
    IF p_at10 THEN
      v_local := v_t AT TIME ZONE v_tz;
      v_cand := (v_local::date + time '10:00') AT TIME ZONE v_tz;
      IF v_cand < v_t THEN v_cand := ((v_local::date + 1) + time '10:00') AT TIME ZONE v_tz; END IF;
      v_t := v_cand;
    END IF;
  ELSE
    v_local := p_from AT TIME ZONE v_tz;
    v_d := v_local::date;
    IF p_unit = 'weeks' THEN
      v_d := v_d + 7 * p_n;
    ELSIF p_skip_weekends THEN
      v_left := p_n;
      WHILE v_left > 0 LOOP
        v_d := v_d + 1;
        IF extract(isodow FROM v_d) < 6 THEN v_left := v_left - 1; END IF;
      END LOOP;
    ELSE
      v_d := v_d + p_n;
    END IF;
    v_t := (v_d + CASE WHEN p_at10 THEN time '10:00' ELSE v_local::time END) AT TIME ZONE v_tz;
  END IF;
  IF p_skip_weekends THEN
    v_local := v_t AT TIME ZONE v_tz;
    v_dow := extract(isodow FROM v_local)::integer;
    IF v_dow >= 6 THEN
      v_t := ((v_local::date + (8 - v_dow)) + v_local::time) AT TIME ZONE v_tz;
    END IF;
  END IF;
  RETURN v_t;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Flow validation (§5.2 F-1…F-12; mirror of formsContract.ts validateFlow)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.forms_flow_step_ids(p_steps jsonb) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $fn$
DECLARE
  v_out text[] := ARRAY[]::text[];
  v_s jsonb;
BEGIN
  IF jsonb_typeof(p_steps) IS DISTINCT FROM 'array' THEN RETURN v_out; END IF;
  FOR v_s IN SELECT s FROM jsonb_array_elements(p_steps) WITH ORDINALITY t(s, o) ORDER BY o LOOP
    v_out := v_out || (v_s->>'id');
    IF v_s->>'type' = 'branch' THEN
      v_out := v_out || public.forms_flow_step_ids(v_s->'yes') || public.forms_flow_step_ids(v_s->'no');
    END IF;
  END LOOP;
  RETURN v_out;
END;
$fn$;

-- A step by id anywhere in the tree, or NULL.
CREATE FUNCTION public.forms_flow_find(p_steps jsonb, p_id text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $fn$
DECLARE
  v_s jsonb;
  v_hit jsonb;
BEGIN
  IF jsonb_typeof(p_steps) IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
  FOR v_s IN SELECT s FROM jsonb_array_elements(p_steps) s LOOP
    IF v_s->>'id' = p_id THEN RETURN v_s; END IF;
    IF v_s->>'type' = 'branch' THEN
      v_hit := COALESCE(public.forms_flow_find(v_s->'yes', p_id), public.forms_flow_find(v_s->'no', p_id));
      IF v_hit IS NOT NULL THEN RETURN v_hit; END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$fn$;

-- F-9: every {token} in subjects and document text is offered by the form. Returns the first unknown token or NULL.
CREATE FUNCTION public.forms_flow_tokens_ok(p_flow jsonb, p_def jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  WITH allowed AS (
    SELECT unnest(ARRAY['first_name','name','page','spot','utm_source','utm_campaign','form_name']) t
    UNION SELECT 'answers.' || (f->>'key') FROM jsonb_array_elements(COALESCE(p_def->'fields', '[]'::jsonb)) f
     WHERE f->>'type' <> 'consent'
  ), texts AS (
    SELECT j #>> '{}' AS s FROM jsonb_path_query(p_flow, 'strict $.**') j WHERE jsonb_typeof(j) = 'string'
  ), used AS (
    SELECT DISTINCT m[1] AS t FROM texts, regexp_matches(texts.s, '\{([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?)\}', 'g') m
  )
  SELECT min(u.t) FROM used u WHERE u.t NOT IN (SELECT t FROM allowed)
$$;

CREATE FUNCTION public.forms_validate_flow(p_flow jsonb, p_def jsonb, p_card_on boolean) RETURNS jsonb
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
  FOR v_bad IN
    SELECT s FROM jsonb_path_query(p_flow, 'strict $.**') s
     WHERE jsonb_typeof(s) = 'object' AND s ? 'type' AND s ? 'id'
       AND NOT CASE s->>'type'
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
         ELSE false END
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

-- ---------------------------------------------------------------------------
-- 4. Runs: start, walk, plan
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.forms_stop_run(p_run_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  UPDATE public.form_automation_runs SET status = 'stopped', stop_reason = p_reason, ended_at = now()
   WHERE id = p_run_id AND status = 'active';
  UPDATE public.form_automation_sends SET status = 'cancelled',
         skip_reason = CASE WHEN p_reason IN ('booked','stage_moved','staff_stopped','form_archived') THEN p_reason
                            WHEN p_reason = 'unsubscribed' THEN 'unsubscribed' END,
         lease_until = NULL
   WHERE run_id = p_run_id AND status IN ('scheduled','sending');
END;
$fn$;

-- Branch condition (§5.4): answers from the submission, booked from §5.5,
-- opened/clicked from this run's last email.
CREATE FUNCTION public.forms_branch_true(p_cond jsonb, p_run_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_run public.form_automation_runs;
  v_sub public.form_submissions;
  v_val jsonb;
  v_has boolean;
  v_last public.form_automation_sends;
BEGIN
  SELECT * INTO v_run FROM public.form_automation_runs WHERE id = p_run_id;
  SELECT * INTO v_sub FROM public.form_submissions WHERE id = v_run.submission_id;
  CASE p_cond->>'on'
    WHEN 'answer' THEN
      v_val := v_sub.answers->(p_cond->>'field_key');
      v_has := CASE WHEN jsonb_typeof(v_val) = 'array' THEN v_val @> jsonb_build_array(p_cond->'value')
                    ELSE COALESCE(v_val = p_cond->'value', false) END;
    WHEN 'lead_label' THEN
      v_has := v_sub.lead_label = p_cond->>'value';
    WHEN 'booked' THEN
      v_has := EXISTS (SELECT 1 FROM public.book_call_leads k
                        WHERE lower(btrim(k.email)) = v_sub.email AND k.created_at >= v_run.started_at);
    ELSE
      SELECT * INTO v_last FROM public.form_automation_sends s
       WHERE s.run_id = p_run_id AND s.status = 'sent' AND s.email_kind <> 'team_alert'
       ORDER BY s.sent_at DESC NULLS LAST LIMIT 1;
      v_has := CASE WHEN p_cond->>'on' = 'opened_last' THEN v_last.opened_at IS NOT NULL
                    ELSE v_last.clicked_at IS NOT NULL END;
  END CASE;
  IF p_cond->>'op' = 'is_not' THEN RETURN NOT COALESCE(v_has, false); END IF;
  RETURN COALESCE(v_has, false);
END;
$fn$;

-- The run's path through the live flow, in order (branches evaluated now).
CREATE FUNCTION public.forms_walk_path(p_steps jsonb, p_run_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_out jsonb := '[]'::jsonb;
  v_s jsonb;
BEGIN
  IF jsonb_typeof(p_steps) IS DISTINCT FROM 'array' THEN RETURN v_out; END IF;
  FOR v_s IN SELECT s FROM jsonb_array_elements(p_steps) WITH ORDINALITY t(s, o) ORDER BY o LOOP
    IF v_s->>'type' = 'branch' THEN
      v_out := v_out || public.forms_walk_path(
        CASE WHEN public.forms_branch_true(v_s->'cond', p_run_id) THEN v_s->'yes' ELSE v_s->'no' END, p_run_id);
    ELSE
      v_out := v_out || jsonb_build_array(v_s);
    END IF;
  END LOOP;
  RETURN v_out;
END;
$fn$;

-- §5.4: schedule at most one send (UNIQUE run_id, step_id), or complete the run.
CREATE FUNCTION public.forms_plan_next(p_run_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_run   public.form_automation_runs;
  v_sub   public.form_submissions;
  v_flow  jsonb;
  v_path  jsonb;
  v_kinds jsonb;
  v_i     integer;
  v_last  integer := -1;
  v_s     jsonb;
  v_due   timestamptz := now();
  v_form  public.forms;
  v_pipe  text;
BEGIN
  SELECT * INTO v_run FROM public.form_automation_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.status <> 'active' THEN RETURN jsonb_build_object('planned', false); END IF;
  -- Something already waiting: nothing to plan.
  IF EXISTS (SELECT 1 FROM public.form_automation_sends WHERE run_id = p_run_id AND status IN ('scheduled','sending')) THEN
    RETURN jsonb_build_object('planned', false, 'pending', true);
  END IF;
  SELECT * INTO v_sub FROM public.form_submissions WHERE id = v_run.submission_id;
  SELECT * INTO v_form FROM public.forms WHERE id = v_run.form_id;
  SELECT v.flow INTO v_flow FROM public.form_automations a
    JOIN public.form_automation_versions v ON v.form_id = a.form_id AND v.version = a.live_version
   WHERE a.form_id = v_run.form_id;
  IF v_flow IS NULL THEN RETURN jsonb_build_object('planned', false); END IF;
  v_kinds := public.forms_flow_kinds(v_flow);
  v_path := public.forms_walk_path(v_flow->'steps', p_run_id);
  -- The last passed step that still exists on this path.
  FOR v_i IN 0 .. jsonb_array_length(v_path) - 1 LOOP
    IF (v_path->v_i->>'id') = ANY (v_run.passed_step_ids) THEN v_last := v_i; END IF;
  END LOOP;
  FOR v_i IN v_last + 1 .. jsonb_array_length(v_path) - 1 LOOP
    v_s := v_path->v_i;
    CONTINUE WHEN (v_s->>'id') = ANY (v_run.passed_step_ids);
    IF v_s->>'type' = 'wait' THEN
      v_due := CASE WHEN v_sub.is_test THEN v_due + interval '1 minute'
                    ELSE public.forms_next_local_time(v_due, v_run.time_zone, (v_s->>'n')::integer, v_s->>'unit',
                                                      (v_s->>'at10')::boolean, (v_s->>'skip_weekends')::boolean) END;
      v_run.passed_step_ids := v_run.passed_step_ids || (v_s->>'id');
      v_run.cursor_step_id := v_s->>'id';
    ELSIF v_s->>'type' = 'stage' THEN
      v_pipe := v_form.draft->'routing'->'card'->>'pipeline';
      IF v_sub.crm_record_id IS NOT NULL AND NOT v_sub.is_test THEN
        BEGIN
          PERFORM public.forms_move_stage(v_sub.crm_record_id, v_s->>'stage', 'form-' || v_form.key);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING '[forms_plan_next] stage move failed run=% sqlstate=%', p_run_id, SQLSTATE;
        END;
      END IF;
      v_run.passed_step_ids := v_run.passed_step_ids || (v_s->>'id');
      v_run.cursor_step_id := v_s->>'id';
    ELSE
      UPDATE public.form_automation_runs SET passed_step_ids = v_run.passed_step_ids, cursor_step_id = v_run.cursor_step_id
       WHERE id = p_run_id;
      INSERT INTO public.form_automation_sends (run_id, step_id, email_kind, due_at)
      VALUES (p_run_id, v_s->>'id', COALESCE(v_kinds->>(v_s->>'id'), 'confirmation'), GREATEST(v_due, now()))
      ON CONFLICT (run_id, step_id) DO NOTHING;
      RETURN jsonb_build_object('planned', true, 'step_id', v_s->>'id', 'due_at', GREATEST(v_due, now()));
    END IF;
  END LOOP;
  UPDATE public.form_automation_runs SET passed_step_ids = v_run.passed_step_ids, cursor_step_id = v_run.cursor_step_id,
         status = 'completed', ended_at = now()
   WHERE id = p_run_id;
  RETURN jsonb_build_object('planned', false, 'completed', true);
END;
$fn$;

-- A flow's own stage move, recorded with via form-<key> so the stage stop rule ignores it.
CREATE FUNCTION public.forms_move_stage(p_record uuid, p_stage text, p_via text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_rec public.crm_records;
  v_to  jsonb;
  v_act uuid;
BEGIN
  SELECT * INTO v_rec FROM public.crm_records WHERE id = p_record AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_rec.stage = p_stage THEN RETURN; END IF;
  -- The same guards crm_record_move_stage applies; a move it would refuse is skipped, never forced.
  v_to := public.crm_stage_def(v_rec.pipeline, p_stage);
  IF v_to IS NULL OR COALESCE((v_to->>'auto')::boolean, false) OR COALESCE((v_to->>'terminal')::boolean, false)
     OR v_rec.stage = 'live' THEN
    RETURN;
  END IF;
  IF v_rec.pipeline = 'creators'
     AND (v_to->>'pos')::integer >= (public.crm_stage_def('creators', 'booked')->>'pos')::integer
     AND v_rec.agreement IS DISTINCT FROM 'signed' THEN
    RETURN;
  END IF;
  UPDATE public.crm_records SET stage = p_stage, stage_reason = NULL, updated_by = 'forms@usemingla.com', updated_at = now()
   WHERE id = p_record;
  INSERT INTO public.crm_activity (record_id, kind, actor_email, via, from_stage, to_stage, body, occurred_at, created_at)
  VALUES (p_record, 'stage_move', 'forms@usemingla.com', left(p_via, 40), v_rec.stage, p_stage, NULL, now(), now())
  RETURNING id INTO v_act;
  PERFORM public.crm_audit('forms@usemingla.com', 'crm.stage_move', 'crm_record', p_record::text,
    jsonb_build_object('via', left(p_via, 40), 'activity_id', v_act,
                       'before', jsonb_build_object('stage', v_rec.stage), 'after', jsonb_build_object('stage', p_stage)));
END;
$fn$;

-- §3.2 step 13: a new (not deduped, not test) submission enters a live, enabled automation.
CREATE FUNCTION public.forms_start_run(p_submission_id uuid, p_time_zone text, p_tz_source text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_sub public.form_submissions;
  v_a public.form_automations;
  v_zone text := public.forms_valid_zone(p_time_zone);
  v_run uuid;
BEGIN
  SELECT * INTO v_sub FROM public.form_submissions WHERE id = p_submission_id;
  SELECT * INTO v_a FROM public.form_automations WHERE form_id = v_sub.form_id;
  IF NOT FOUND OR NOT v_a.enabled OR v_a.live_version IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.form_automation_runs (submission_id, form_id, started_version, time_zone, time_zone_source)
  VALUES (p_submission_id, v_sub.form_id, v_a.live_version, COALESCE(v_zone, 'UTC'),
          CASE WHEN v_zone IS NULL THEN 'fallback_utc' WHEN p_tz_source = 'browser' THEN 'browser' ELSE 'browser' END)
  ON CONFLICT (submission_id) DO NOTHING
  RETURNING id INTO v_run;
  IF v_run IS NOT NULL THEN PERFORM public.forms_plan_next(v_run); END IF;
  RETURN v_run;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Sender: claim, gate (§5.5), finish
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.forms_claim_due_sends(p_limit integer) RETURNS SETOF public.form_automation_sends
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  -- A lease that expired on its third attempt is a failure, not a fourth try.
  UPDATE public.form_automation_sends SET status = 'failed', lease_until = NULL,
         last_error = COALESCE(last_error, 'lease_expired')
   WHERE status = 'sending' AND lease_until < now() AND attempts >= 3;
  RETURN QUERY
  UPDATE public.form_automation_sends s SET status = 'sending', lease_until = now() + interval '10 minutes',
         attempts = s.attempts + 1
   WHERE s.id IN (
     SELECT x.id FROM public.form_automation_sends x
       JOIN public.form_automation_runs r ON r.id = x.run_id
       JOIN public.form_automations a ON a.form_id = r.form_id
      WHERE ((x.status = 'scheduled' AND x.due_at <= now()) OR (x.status = 'sending' AND x.lease_until < now()))
        AND x.attempts < 3
        AND (a.enabled OR r.test_recipient IS NOT NULL)       -- paused: wait, do not cancel
      ORDER BY x.due_at
      LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
      FOR UPDATE OF x SKIP LOCKED)
  RETURNING s.*;
END;
$fn$;

-- The §5.5 checks, in order. Returns {action:'send', …render context} or
-- {action:'skip'|'cancel', reason}. Applies a stop/skip itself.
CREATE FUNCTION public.forms_send_gate(p_send_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_send public.form_automation_sends;
  v_run  public.form_automation_runs;
  v_sub  public.form_submissions;
  v_form public.forms;
  v_a    public.form_automations;
  v_flow jsonb;
  v_step jsonb;
  v_def  jsonb;
  v_first text;
  v_rec  public.crm_records;
  v_follow boolean;
  v_reason text;
BEGIN
  SELECT * INTO v_send FROM public.form_automation_sends WHERE id = p_send_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('action', 'cancel', 'reason', 'missing'); END IF;
  SELECT * INTO v_run FROM public.form_automation_runs WHERE id = v_send.run_id;
  SELECT * INTO v_sub FROM public.form_submissions WHERE id = v_run.submission_id;
  SELECT * INTO v_form FROM public.forms WHERE id = v_run.form_id;
  SELECT * INTO v_a FROM public.form_automations WHERE form_id = v_run.form_id;
  v_follow := v_send.email_kind = 'follow_up';

  -- 1. Run already over.
  IF v_run.status <> 'active' THEN
    UPDATE public.form_automation_sends SET status = 'cancelled', lease_until = NULL WHERE id = p_send_id;
    RETURN jsonb_build_object('action', 'cancel', 'reason', 'run_ended');
  END IF;
  -- 2. Form archived.
  IF v_form.status = 'archived' THEN
    PERFORM public.forms_stop_run(v_run.id, 'form_archived');
    RETURN jsonb_build_object('action', 'cancel', 'reason', 'form_archived');
  END IF;
  -- Editing a live flow: a step gone from the live version is cancelled.
  SELECT v.flow INTO v_flow FROM public.form_automation_versions v WHERE v.form_id = v_run.form_id AND v.version = v_a.live_version;
  v_step := public.forms_flow_find(v_flow->'steps', v_send.step_id);
  IF v_step IS NULL THEN
    UPDATE public.form_automation_sends SET status = 'cancelled', skip_reason = 'step_removed', lease_until = NULL WHERE id = p_send_id;
    PERFORM public.forms_plan_next(v_run.id);
    RETURN jsonb_build_object('action', 'cancel', 'reason', 'step_removed');
  END IF;
  -- No stale burst after a pause or an outage.
  IF v_send.due_at < now() - interval '72 hours' AND v_run.test_recipient IS NULL THEN
    UPDATE public.form_automation_sends SET status = 'skipped', skip_reason = 'automation_paused', lease_until = NULL WHERE id = p_send_id;
    UPDATE public.form_automation_runs SET passed_step_ids = passed_step_ids || v_send.step_id, cursor_step_id = v_send.step_id WHERE id = v_run.id;
    PERFORM public.forms_plan_next(v_run.id);
    RETURN jsonb_build_object('action', 'skip', 'reason', 'automation_paused');
  END IF;
  -- 3. Booked (follow-ups only).
  IF v_follow AND COALESCE((v_a.stops->>'booked')::boolean, true) AND EXISTS (
       SELECT 1 FROM public.book_call_leads k
        WHERE (lower(btrim(k.email)) = v_sub.email AND k.created_at >= v_run.started_at)
           OR k.form_submission_id = v_sub.id) THEN
    UPDATE public.form_automation_sends SET status = 'skipped', skip_reason = 'booked', lease_until = NULL WHERE id = p_send_id;
    PERFORM public.forms_stop_run(v_run.id, 'booked');
    RETURN jsonb_build_object('action', 'skip', 'reason', 'booked');
  END IF;
  -- 4. Stage moved past the first stage (A1: only with a CRM card; a move by this flow does not count).
  IF v_follow AND COALESCE((v_a.stops->>'stage')::boolean, true) AND v_sub.crm_record_id IS NOT NULL THEN
    SELECT * INTO v_rec FROM public.crm_records WHERE id = v_sub.crm_record_id;
    IF FOUND THEN
      v_first := public.crm_pipeline_def(v_rec.pipeline)->'stages'->0->>'id';
      IF v_rec.stage IS DISTINCT FROM v_first AND EXISTS (
           SELECT 1 FROM public.crm_activity ca
            WHERE ca.record_id = v_rec.id AND ca.kind = 'stage_move'
              AND ca.via IS DISTINCT FROM left('form-' || v_form.key, 40)) THEN
        UPDATE public.form_automation_sends SET status = 'skipped', skip_reason = 'stage_moved', lease_until = NULL WHERE id = p_send_id;
        PERFORM public.forms_stop_run(v_run.id, 'stage_moved');
        RETURN jsonb_build_object('action', 'skip', 'reason', 'stage_moved');
      END IF;
    END IF;
  END IF;
  -- 5. Unsubscribed or suppressed (always on; team alerts are not checked against the person).
  IF v_send.email_kind <> 'team_alert' AND v_run.test_recipient IS NULL THEN
    IF v_follow AND (
         EXISTS (SELECT 1 FROM public.marketing_unsubscribes u
                  WHERE lower(btrim(u.contact_email)) = v_sub.email AND u.channel IN ('email','all')
                    AND u.scope IN ('global','account'))
      OR EXISTS (SELECT 1 FROM public.channel_suppressions c
                  WHERE lower(btrim(c.contact)) = v_sub.email AND c.channel = 'email' AND c.scope IN ('marketing','all'))) THEN
      UPDATE public.form_automation_sends SET status = 'skipped', skip_reason = 'unsubscribed', lease_until = NULL WHERE id = p_send_id;
      PERFORM public.forms_stop_run(v_run.id, 'unsubscribed');
      RETURN jsonb_build_object('action', 'skip', 'reason', 'unsubscribed');
    END IF;
    IF NOT v_follow AND EXISTS (
         SELECT 1 FROM public.channel_suppressions c
          WHERE lower(btrim(c.contact)) = v_sub.email AND c.channel = 'email'
            AND (c.scope = 'all' OR c.reason IN ('bounce','complaint'))) THEN
      UPDATE public.form_automation_sends SET status = 'skipped', skip_reason = 'suppressed', lease_until = NULL WHERE id = p_send_id;
      UPDATE public.form_automation_runs SET passed_step_ids = passed_step_ids || v_send.step_id, cursor_step_id = v_send.step_id WHERE id = v_run.id;
      PERFORM public.forms_plan_next(v_run.id);
      RETURN jsonb_build_object('action', 'skip', 'reason', 'suppressed');
    END IF;
  END IF;
  -- 6. Consent (follow-ups only; the run continues for its confirmations).
  IF v_follow AND NOT v_sub.marketing_consent THEN
    UPDATE public.form_automation_sends SET status = 'skipped', skip_reason = 'no_consent', lease_until = NULL WHERE id = p_send_id;
    UPDATE public.form_automation_runs SET passed_step_ids = passed_step_ids || v_send.step_id, cursor_step_id = v_send.step_id WHERE id = v_run.id;
    PERFORM public.forms_plan_next(v_run.id);
    RETURN jsonb_build_object('action', 'skip', 'reason', 'no_consent');
  END IF;

  SELECT definition INTO v_def FROM public.form_versions WHERE id = v_sub.form_version_id;
  RETURN jsonb_build_object(
    'action', 'send',
    'send_id', v_send.id, 'run_id', v_run.id, 'attempts', v_send.attempts, 'email_kind', v_send.email_kind,
    'step', v_step,
    -- §5.8: a test run goes only to the staff member who started it.
    'to', COALESCE(v_run.test_recipient, v_sub.email),
    'is_test', v_sub.is_test,
    'person', jsonb_build_object('email', v_sub.email, 'name', v_sub.name, 'answers', v_sub.answers,
                                 'page', v_sub.page_path, 'spot', v_sub.spot_key, 'utm_source', v_sub.utm_source,
                                 'utm_campaign', v_sub.utm_campaign, 'label', v_sub.lead_label,
                                 'ads_allowed', v_sub.ads_allowed, 'click_source', v_sub.click_source,
                                 'time_zone', v_run.time_zone),
    'form', jsonb_build_object('id', v_form.id, 'key', v_form.key, 'name', v_form.name, 'audience', v_form.audience,
                               'fields', v_def->'fields', 'icp', v_def->'design'->>'icp'));
END;
$fn$;

-- Terminal write (or a retry). p_status: sent | failed | retry.
CREATE FUNCTION public.forms_finish_send(p_send_id uuid, p_status text, p_skip_reason text, p_error text, p_provider_id text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_send public.form_automation_sends;
BEGIN
  SELECT * INTO v_send FROM public.form_automation_sends WHERE id = p_send_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'send_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_send.status <> 'sending' THEN RETURN jsonb_build_object('status', v_send.status, 'ignored', true); END IF;
  IF p_status = 'retry' AND v_send.attempts < 3 THEN
    -- 429, 5xx or network: back off 15 min, 1 h, 6 h.
    UPDATE public.form_automation_sends SET status = 'scheduled', lease_until = NULL, last_error = left(p_error, 300),
           due_at = now() + CASE v_send.attempts WHEN 1 THEN interval '15 minutes' WHEN 2 THEN interval '1 hour' ELSE interval '6 hours' END
     WHERE id = p_send_id;
    RETURN jsonb_build_object('status', 'scheduled');
  END IF;
  IF p_status = 'sent' THEN
    UPDATE public.form_automation_sends SET status = 'sent', sent_at = now(), lease_until = NULL,
           provider_message_id = left(p_provider_id, 200), last_error = NULL
     WHERE id = p_send_id;
  ELSE
    UPDATE public.form_automation_sends SET status = 'failed', lease_until = NULL, last_error = left(COALESCE(p_error, 'failed'), 300)
     WHERE id = p_send_id;
  END IF;
  UPDATE public.form_automation_runs SET passed_step_ids = passed_step_ids || v_send.step_id, cursor_step_id = v_send.step_id
   WHERE id = v_send.run_id AND NOT (v_send.step_id = ANY (passed_step_ids));
  PERFORM public.forms_plan_next(v_send.run_id);
  RETURN jsonb_build_object('status', CASE WHEN p_status = 'sent' THEN 'sent' ELSE 'failed' END);
END;
$fn$;

CREATE FUNCTION public.forms_record_engagement(p_send_id uuid, p_kind text) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE public.form_automation_sends
     SET opened_at = CASE WHEN p_kind IN ('open','click') THEN COALESCE(opened_at, now()) ELSE opened_at END,
         clicked_at = CASE WHEN p_kind = 'click' THEN COALESCE(clicked_at, now()) ELSE clicked_at END
   WHERE id = p_send_id AND status = 'sent'
$$;

-- Funnel events from forms-submit {action:"track"} (only with analytics on).
CREATE FUNCTION public.forms_track_event(p jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.forms WHERE id = (p->>'form_id')::uuid AND status = 'live') THEN RETURN; END IF;
  INSERT INTO public.form_funnel_events (form_id, event, visit_id, page_path, placement, step, props, utm_campaign, click_source)
  VALUES ((p->>'form_id')::uuid, p->>'event', (p->>'visit_id')::uuid, left(COALESCE(p->>'page_path', '/'), 300),
          p->>'placement', NULLIF(p->>'step', '')::smallint, COALESCE(p->'props', '{}'::jsonb),
          left(p->>'utm_campaign', 150), p->>'click_source');
END;
$fn$;

REVOKE ALL ON FUNCTION public.forms_valid_zone(text), public.forms_next_local_time(timestamptz, text, integer, text, boolean, boolean),
  public.forms_flow_step_ids(jsonb), public.forms_flow_find(jsonb, text), public.forms_flow_tokens_ok(jsonb, jsonb),
  public.forms_validate_flow(jsonb, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.forms_valid_zone(text), public.forms_next_local_time(timestamptz, text, integer, text, boolean, boolean),
  public.forms_flow_step_ids(jsonb), public.forms_flow_find(jsonb, text), public.forms_flow_tokens_ok(jsonb, jsonb),
  public.forms_validate_flow(jsonb, jsonb, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.forms_stop_run(uuid, text), public.forms_branch_true(jsonb, uuid), public.forms_walk_path(jsonb, uuid),
  public.forms_plan_next(uuid), public.forms_move_stage(uuid, text, text), public.forms_start_run(uuid, text, text),
  public.forms_claim_due_sends(integer), public.forms_send_gate(uuid),
  public.forms_finish_send(uuid, text, text, text, text), public.forms_record_engagement(uuid, text),
  public.forms_track_event(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.forms_stop_run(uuid, text), public.forms_branch_true(jsonb, uuid), public.forms_walk_path(jsonb, uuid),
  public.forms_plan_next(uuid), public.forms_move_stage(uuid, text, text), public.forms_start_run(uuid, text, text),
  public.forms_claim_due_sends(integer), public.forms_send_gate(uuid),
  public.forms_finish_send(uuid, text, text, text, text), public.forms_record_engagement(uuid, text),
  public.forms_track_event(jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Admin RPCs
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.admin_automation_get(p_form_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_a public.form_automations;
BEGIN
  IF NOT public.forms_can_view() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_a FROM public.form_automations WHERE form_id = p_form_id;
  RETURN jsonb_build_object(
    'draft', COALESCE(v_a.draft, '{"v":1,"steps":[]}'::jsonb),
    'draft_rev', COALESCE(v_a.draft_rev, 0),
    'enabled', COALESCE(v_a.enabled, false),
    'stops', COALESCE(v_a.stops, '{"booked":true,"replied":false,"unsub":true,"stage":true}'::jsonb),
    'live_version', v_a.live_version,
    'kinds', public.forms_flow_kinds(COALESCE(v_a.draft, '{"v":1,"steps":[]}'::jsonb)),
    'steps', COALESCE((SELECT jsonb_object_agg(x.step_id, jsonb_build_object('sent', x.sent, 'opened', x.opened, 'clicked', x.clicked))
               FROM (SELECT s.step_id, count(*) FILTER (WHERE s.status = 'sent') sent,
                            count(*) FILTER (WHERE s.opened_at IS NOT NULL) opened,
                            count(*) FILTER (WHERE s.clicked_at IS NOT NULL) clicked
                       FROM public.form_automation_sends s JOIN public.form_automation_runs r ON r.id = s.run_id
                       JOIN public.form_submissions sub ON sub.id = r.submission_id
                      WHERE r.form_id = p_form_id AND s.created_at > now() - interval '30 days' AND NOT sub.is_test
                      GROUP BY s.step_id) x), '{}'::jsonb),
    'kpis', (SELECT jsonb_build_object(
               'in_flow', count(*) FILTER (WHERE r.status = 'active'),
               'sent', (SELECT count(*) FROM public.form_automation_sends s JOIN public.form_automation_runs r2 ON r2.id = s.run_id
                         WHERE r2.form_id = p_form_id AND s.status = 'sent' AND s.sent_at > now() - interval '30 days'),
               'opened_pct', (SELECT CASE WHEN count(*) FILTER (WHERE s.status = 'sent') = 0 THEN NULL
                                 ELSE round(100.0 * count(*) FILTER (WHERE s.opened_at IS NOT NULL) / count(*) FILTER (WHERE s.status = 'sent')) END
                                FROM public.form_automation_sends s JOIN public.form_automation_runs r2 ON r2.id = s.run_id
                               WHERE r2.form_id = p_form_id AND s.email_kind <> 'team_alert' AND s.created_at > now() - interval '30 days'),
               'stopped_booked', count(*) FILTER (WHERE r.stop_reason = 'booked'))
             FROM public.form_automation_runs r JOIN public.form_submissions sub ON sub.id = r.submission_id
            WHERE r.form_id = p_form_id AND r.started_at > now() - interval '30 days' AND NOT sub.is_test),
    'can_edit', public.forms_can_edit());
END;
$fn$;

CREATE FUNCTION public.admin_automation_save_draft(p_form_id uuid, p_expected_rev integer, p_flow jsonb, p_stops jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_f public.forms;
  v_rev integer;
  v_check jsonb;
  v_stops jsonb;
BEGIN
  IF NOT public.forms_can_edit() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_f FROM public.forms WHERE id = p_form_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_f.template = 'book_call_extra' THEN RAISE EXCEPTION 'uses_book_a_call_emails' USING ERRCODE = '22023'; END IF;
  v_check := public.forms_validate_flow(p_flow, v_f.draft, COALESCE(v_f.draft->'routing'->'card'->'on' = 'true'::jsonb, false));
  IF NOT (v_check->>'ok')::boolean THEN
    RAISE EXCEPTION 'invalid_flow' USING ERRCODE = '22023', DETAIL = (v_check->'errors')::text;
  END IF;
  -- Unsubscribe is always on; "replied" is Coming soon (the table CHECK refuses anything else).
  v_stops := jsonb_build_object('booked', COALESCE(p_stops->'booked' = 'true'::jsonb, true),
                                'replied', false, 'unsub', true,
                                'stage', COALESCE(p_stops->'stage' = 'true'::jsonb, true));
  IF p_stops ? 'unsub' AND p_stops->'unsub' <> 'true'::jsonb THEN RAISE EXCEPTION 'unsub_always_on' USING ERRCODE = '22023'; END IF;
  IF p_stops ? 'replied' AND p_stops->'replied' <> 'false'::jsonb THEN RAISE EXCEPTION 'replied_coming_soon' USING ERRCODE = '22023'; END IF;
  SELECT draft_rev INTO v_rev FROM public.form_automations WHERE form_id = p_form_id FOR UPDATE;
  IF NOT FOUND THEN
    IF COALESCE(p_expected_rev, 0) <> 0 THEN RAISE EXCEPTION 'automation_draft_conflict' USING ERRCODE = 'PT409'; END IF;
    INSERT INTO public.form_automations (form_id, draft, stops, updated_by) VALUES (p_form_id, p_flow, v_stops, auth.uid());
    RETURN jsonb_build_object('draft_rev', 1);
  END IF;
  IF v_rev <> p_expected_rev THEN RAISE EXCEPTION 'automation_draft_conflict' USING ERRCODE = 'PT409'; END IF;
  UPDATE public.form_automations SET draft = p_flow, stops = v_stops, draft_rev = draft_rev + 1,
         updated_by = auth.uid(), updated_at = now()
   WHERE form_id = p_form_id;
  RETURN jsonb_build_object('draft_rev', v_rev + 1);
END;
$fn$;

CREATE FUNCTION public.admin_automation_publish(p_form_id uuid, p_expected_rev integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_a public.form_automations;
  v_f public.forms;
  v_live jsonb;
  v_check jsonb;
  v_ver integer;
BEGIN
  IF NOT public.forms_can_edit() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_a FROM public.form_automations WHERE form_id = p_form_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_automation' USING ERRCODE = '22023'; END IF;
  IF v_a.draft_rev <> p_expected_rev THEN RAISE EXCEPTION 'automation_draft_conflict' USING ERRCODE = 'PT409'; END IF;
  SELECT * INTO v_f FROM public.forms WHERE id = p_form_id;
  -- F-3: re-checked against the live form.
  SELECT v.definition INTO v_live FROM public.form_versions v WHERE v.id = v_f.live_version_id;
  v_check := public.forms_validate_flow(v_a.draft, COALESCE(v_live, v_f.draft),
               COALESCE(COALESCE(v_live, v_f.draft)->'routing'->'card'->'on' = 'true'::jsonb, false));
  IF NOT (v_check->>'ok')::boolean THEN
    RAISE EXCEPTION 'invalid_flow' USING ERRCODE = '22023', DETAIL = (v_check->'errors')::text;
  END IF;
  SELECT COALESCE(max(version), 0) + 1 INTO v_ver FROM public.form_automation_versions WHERE form_id = p_form_id;
  INSERT INTO public.form_automation_versions (form_id, version, flow, stops, published_by)
  VALUES (p_form_id, v_ver, v_a.draft, v_a.stops, auth.uid());
  UPDATE public.form_automations SET live_version = v_ver, updated_by = auth.uid(), updated_at = now() WHERE form_id = p_form_id;
  RETURN jsonb_build_object('version', v_ver,
    'active_runs', (SELECT count(*) FROM public.form_automation_runs WHERE form_id = p_form_id AND status = 'active'));
END;
$fn$;

CREATE FUNCTION public.admin_automation_set_enabled(p_form_id uuid, p_enabled boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF NOT public.forms_can_edit() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  IF p_enabled AND NOT EXISTS (SELECT 1 FROM public.form_automations WHERE form_id = p_form_id AND live_version IS NOT NULL) THEN
    RAISE EXCEPTION 'publish_automation_first' USING ERRCODE = '22023';
  END IF;
  IF p_enabled AND EXISTS (SELECT 1 FROM public.forms WHERE id = p_form_id AND status = 'archived') THEN
    RAISE EXCEPTION 'form_archived' USING ERRCODE = '22023';
  END IF;
  UPDATE public.form_automations SET enabled = p_enabled, updated_by = auth.uid(), updated_at = now() WHERE form_id = p_form_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_automation' USING ERRCODE = '22023'; END IF;
  RETURN jsonb_build_object('enabled', p_enabled);
END;
$fn$;

CREATE FUNCTION public.admin_form_submission_stop_emails(p_submission_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_run uuid;
BEGIN
  IF NOT public.forms_can_edit() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_run FROM public.form_automation_runs WHERE submission_id = p_submission_id;
  IF v_run IS NULL THEN RETURN jsonb_build_object('stopped', false); END IF;
  PERFORM public.forms_stop_run(v_run, 'staff_stopped');
  RETURN jsonb_build_object('stopped', true);
END;
$fn$;

-- §7.5 Results: the funnel and by-campaign rows. Real counts only.
CREATE FUNCTION public.admin_form_results(p_form_id uuid, p_from timestamptz, p_to timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_f public.forms;
  v_from timestamptz := COALESCE(p_from, '-infinity'::timestamptz);
  v_to timestamptz := COALESCE(p_to, 'infinity'::timestamptz);
  v_pipe text;
BEGIN
  IF NOT public.forms_can_view() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_f FROM public.forms WHERE id = p_form_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN (
    WITH subs AS (
      SELECT s.* FROM public.form_submissions s
       WHERE s.form_id = p_form_id AND NOT s.is_test AND s.created_at >= v_from AND s.created_at < v_to
    ), booked AS (
      SELECT DISTINCT s.id FROM subs s JOIN public.book_call_leads k
        ON k.form_submission_id = s.id
        OR (lower(btrim(k.email)) = s.email AND k.created_at >= s.created_at AND k.created_at < s.created_at + interval '30 days')
    ), approved AS (
      SELECT DISTINCT s.id FROM subs s JOIN public.crm_records r ON r.id = s.crm_record_id
       WHERE (r.pipeline = 'hosts' AND r.stage IN ('onboarded','live')) OR (r.pipeline = 'creators' AND r.stage IN ('booked','posted'))
    ), ev AS (
      SELECT e.* FROM public.form_funnel_events e
       WHERE e.form_id = p_form_id AND e.created_at >= v_from AND e.created_at < v_to
    ), camp AS (
      SELECT lower(COALESCE(s.utm_campaign, '')) AS key, max(s.utm_campaign) AS campaign, max(s.utm_id) AS utm_id,
             count(*) AS leads, count(*) FILTER (WHERE s.id IN (SELECT id FROM booked)) AS calls
        FROM subs s WHERE s.utm_campaign IS NOT NULL GROUP BY 1
    ), spend AS (
      SELECT c.key, sum(d.spend_cents) AS spend_cents, sum(d.clicks) AS clicks, max(d.currency) AS currency
        FROM camp c JOIN public.ad_campaigns a
          ON lower(a.name) = c.key OR (c.utm_id IS NOT NULL AND a.external_campaign_id = c.utm_id)
        JOIN public.ad_spend_daily d ON d.campaign_id = a.id
         AND d.spend_date >= (v_from AT TIME ZONE 'UTC')::date AND d.spend_date <= LEAST((v_to AT TIME ZONE 'UTC')::date, current_date)
       GROUP BY c.key
    )
    SELECT jsonb_build_object(
      'label', v_f.audience,
      'goal', COALESCE((SELECT v.definition->'ads'->>'goal' FROM public.form_versions v WHERE v.id = v_f.live_version_id), 'none'),
      'funnel', jsonb_build_object(
        'ad_clicks', (SELECT sum(clicks) FROM spend),
        'shown', (SELECT count(DISTINCT visit_id) FROM ev WHERE event IN ('form_viewed','popup_shown')),
        'started', (SELECT count(DISTINCT visit_id) FROM ev WHERE event = 'form_started'),
        'sent', (SELECT count(*) FROM subs),
        'calls_booked', (SELECT count(*) FROM booked),
        'approved', (SELECT count(*) FROM approved)),
      'spend', CASE WHEN (SELECT count(*) FROM spend) = 0 THEN NULL ELSE jsonb_build_object(
        'cents', (SELECT sum(spend_cents) FROM spend), 'currency', (SELECT max(currency) FROM spend)) END,
      'by_campaign', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'campaign', c.campaign, 'leads', c.leads, 'calls_booked', c.calls,
          'spend_cents', sp.spend_cents, 'clicks', sp.clicks, 'currency', sp.currency,
          'matched', sp.key IS NOT NULL) ORDER BY c.leads DESC)
        FROM camp c LEFT JOIN spend sp ON sp.key = c.key), '[]'::jsonb),
      'as_of', now()));
END;
$fn$;

-- Forms list (§7.3): no email addresses.
CREATE FUNCTION public.admin_forms_list(p_status text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF NOT public.forms_can_view() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('draft','live','archived') THEN RAISE EXCEPTION 'bad_status' USING ERRCODE = '22023'; END IF;
  RETURN jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(x.row ORDER BY x.updated_at DESC) FROM (
      SELECT f.updated_at, jsonb_build_object(
        'id', f.id, 'key', f.key, 'name', f.name, 'status', f.status, 'audience', f.audience, 'template', f.template,
        'live_version', (SELECT v.version FROM public.form_versions v WHERE v.id = f.live_version_id),
        'fields', jsonb_array_length(COALESCE(f.draft->'fields', '[]'::jsonb)),
        'placements', COALESCE((SELECT jsonb_agg(jsonb_build_object('page_key', l.page_key, 'spot', b->>'spot', 'type', b->>'type'))
                                  FROM public.site_page_live l JOIN public.site_page_versions pv ON pv.id = l.version_id,
                                       jsonb_array_elements(COALESCE(pv.content->'blocks', '[]'::jsonb)) b
                                 WHERE b->>'form_id' = f.id::text), '[]'::jsonb),
        'own_page', (SELECT s.slug FROM public.form_page_slugs s WHERE s.form_id = f.id AND s.is_current),
        'subs_7d', (SELECT count(*) FROM public.form_submissions s WHERE s.form_id = f.id AND NOT s.is_test AND s.created_at > now() - interval '7 days'),
        'subs_prev_7d', (SELECT count(*) FROM public.form_submissions s WHERE s.form_id = f.id AND NOT s.is_test
                          AND s.created_at > now() - interval '14 days' AND s.created_at <= now() - interval '7 days'),
        'emails_waiting', (SELECT count(*) FROM public.form_automation_sends se JOIN public.form_automation_runs r ON r.id = se.run_id
                            WHERE r.form_id = f.id AND se.status = 'scheduled'),
        'booked_after_pct', (SELECT CASE WHEN count(*) = 0 THEN NULL ELSE round(100.0 * count(*) FILTER (WHERE EXISTS (
                                SELECT 1 FROM public.book_call_leads k WHERE k.form_submission_id = s.id
                                   OR (lower(btrim(k.email)) = s.email AND k.created_at >= s.created_at))) / count(*)) END
                               FROM public.form_submissions s WHERE s.form_id = f.id AND NOT s.is_test),
        'goes_to', CASE WHEN f.draft->'routing'->'card'->'on' = 'true'::jsonb
                        THEN 'Leads + ' || initcap(f.draft->'routing'->'card'->>'pipeline') ELSE 'Leads' END,
        'automation', (SELECT jsonb_build_object('enabled', a.enabled, 'live_version', a.live_version,
                                                 'emails', (SELECT count(*) FROM jsonb_each_text(public.forms_flow_kinds(a.draft)) k
                                                             WHERE k.value <> 'team_alert'))
                         FROM public.form_automations a WHERE a.form_id = f.id)) AS row
      FROM public.forms f WHERE p_status IS NULL OR f.status = p_status) x), '[]'::jsonb),
    'kpis', jsonb_build_object(
      'subs_7d', (SELECT count(*) FROM public.form_submissions s WHERE NOT s.is_test AND s.created_at > now() - interval '7 days'),
      'subs_prev_7d', (SELECT count(*) FROM public.form_submissions s WHERE NOT s.is_test
                        AND s.created_at > now() - interval '14 days' AND s.created_at <= now() - interval '7 days'),
      'live', (SELECT count(*) FROM public.forms WHERE status = 'live'),
      'emails_waiting', (SELECT count(*) FROM public.form_automation_sends WHERE status = 'scheduled')),
    'can_edit', public.forms_can_edit(),
    'is_admin', public.is_admin_user());
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_automation_get(uuid), public.admin_automation_save_draft(uuid, integer, jsonb, jsonb),
  public.admin_automation_publish(uuid, integer), public.admin_automation_set_enabled(uuid, boolean),
  public.admin_form_submission_stop_emails(uuid), public.admin_form_results(uuid, timestamptz, timestamptz),
  public.admin_forms_list(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_automation_get(uuid), public.admin_automation_save_draft(uuid, integer, jsonb, jsonb),
  public.admin_automation_publish(uuid, integer), public.admin_automation_set_enabled(uuid, boolean),
  public.admin_form_submission_stop_emails(uuid), public.admin_form_results(uuid, timestamptz, timestamptz),
  public.admin_forms_list(text) TO authenticated, service_role;

-- §5.8 "Test the whole flow": an is_test submission whose run sends to the staff member only.
CREATE FUNCTION public.forms_start_test_run(p_form_id uuid, p_email text, p_answers jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_f public.forms;
  v_a public.form_automations;
  v_sub uuid;
  v_run uuid;
  v_email text := lower(btrim(p_email));
BEGIN
  SELECT * INTO v_f FROM public.forms WHERE id = p_form_id;
  SELECT * INTO v_a FROM public.form_automations WHERE form_id = p_form_id;
  IF v_f.live_version_id IS NULL OR v_a.live_version IS NULL THEN RAISE EXCEPTION 'publish_first' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.form_submissions (form_id, form_version_id, lead_label, idempotency_key, email, name, answers, page_path,
                                       placement, ads_allowed, marketing_consent, consent_text, consent_at, is_test)
  VALUES (p_form_id, v_f.live_version_id, v_f.audience, gen_random_uuid(), v_email, 'Ada Okafor',
          COALESCE(p_answers, '{}'::jsonb) || jsonb_build_object('email', v_email), '/creators', 'inline', false,
          true, '[test]', now(), true)
  RETURNING id INTO v_sub;
  INSERT INTO public.form_automation_runs (submission_id, form_id, started_version, time_zone, time_zone_source, test_recipient)
  VALUES (v_sub, p_form_id, v_a.live_version, 'UTC', 'fallback_utc', v_email)
  RETURNING id INTO v_run;
  PERFORM public.forms_plan_next(v_run);
  RETURN v_run;
END;
$fn$;
REVOKE ALL ON FUNCTION public.forms_start_test_run(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.forms_start_test_run(uuid, text, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Cron (the house pattern; skipped loudly where pg_cron, pg_net or the vault rows are missing)
-- ---------------------------------------------------------------------------
DO $cron$
DECLARE
  v_job bigint;
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE '#4452: pg_cron unavailable; forms cron jobs not scheduled'; RETURN;
  END IF;
  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'issue_4452_forms_retention';
  IF v_job IS NOT NULL THEN PERFORM cron.unschedule(v_job); END IF;
  PERFORM cron.schedule('issue_4452_forms_retention', '17 3 * * *', $job$
    DELETE FROM public.forms_submit_attempts WHERE created_at < now() - interval '7 days';
    DELETE FROM public.form_funnel_events WHERE created_at < now() - interval '400 days';
    DELETE FROM public.site_preview_tokens WHERE expires_at < now() - interval '1 day';
  $job$);
  IF to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
    RAISE NOTICE '#4452: pg_net unavailable; forms automation sender not scheduled'; RETURN;
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL
    OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'supabase_url')
    OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key') THEN
    RAISE NOTICE '#4452: runtime vault rows unavailable; forms automation sender not scheduled'; RETURN;
  END IF;
  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'issue_4452_forms_automation_sender';
  IF v_job IS NOT NULL THEN PERFORM cron.unschedule(v_job); END IF;
  PERFORM cron.schedule('issue_4452_forms_automation_sender', '*/5 * * * *', $job$SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/forms-automation-sender',
    headers := jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000)$job$);
END;
$cron$;

COMMIT;
