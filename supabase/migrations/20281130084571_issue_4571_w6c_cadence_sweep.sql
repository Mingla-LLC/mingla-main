-- Issue #4571 (Work pipeline redesign), wave W6c: the nightly Hosts cadence
-- sweep on the server, replacing ~/.mingla-agent/cadence_sweep.py on Seth's
-- Mac (Work card #3659). The rules are the Mac script's, read line by line:
--
--   * Cards: hosts, not deleted, not archived, stage Prospect or Contacted
--     only (never Replied, Demo booked, Onboarded, Live or Lost), with at
--     least one owner on the sweep's team (abimbola@, kunle@ and debra@ by
--     default; config, not code: ops_settings 'cadence_sweep'.team).
--   * Counted touches (decision 8 option 1): outbound touches since the
--     restart date (config since, default 2026-11-23, UTC midnight as the
--     script's query) whose W2 stage_at is prospect or contacted. A touch made
--     in Replied or Demo booked never counts toward 6 + 6. calls = phone
--     touches; emails = the larger of the email touches logged and, for the
--     card's busiest address, the number of distinct UTC days info@ mail went
--     to it (W6b crm_email_log, outbound, stage_at prospect or contacted).
--     has_phone = any phone identifier on the card.
--   * A round = min(calls, emails), or emails alone with no phone. Finished =
--     6 calls and 6 emails (6 emails with no phone): the card moves to Lost
--     with "No meeting after <c> calls and <e> emails (cadence from <since>)",
--     and nothing else happens to it that night.
--   * Otherwise Prospect with any counted call or email moves to Contacted
--     ("First cadence touch logged").
--   * Its last outbound touch (any channel, since the restart, Lagos day) is
--     today and its due date is empty or today or earlier: due_on = 2 working
--     days (Mon to Fri) after today and next_action = "Round n+1 of 6: call
--     from PressOne, then send email n+1. <c> calls and <e> emails so far"
--     (no phone: "Round n+1 of 6: send email n+1 and try to find a phone. <e>
--     emails so far").
--   * Else, due before today with no touch since it was due: overdue, counted
--     for the card's first owner (alphabetical; the script took the first in
--     the list it was handed).
--   * The run's line is the script's: "<today> sweep (APPLY|dry run): N active
--     cards; to Lost x; Prospect->Contacted y; next round dated z; overdue by
--     owner {...}". It is stored on the run (crm_cadence_sweep_runs) and, when
--     ops_settings 'cadence_sweep'.report_card_id names a Work card (#3659), posted
--     there as a system message. No GitHub token is used or stored.
--
-- crm_cadence_state(p_record_id) is the one rule, read by the sweep, the card
-- and get_record ("Round 3 of 6 · call done · email to send").
--
-- RUNBOOK (no .md file; this comment is it):
--   Switch-on is three steps, each in Mingla Admin › Team dashboard ›
--   Nightly cadence sweep (owner only), or with ops_setting 'cadence_sweep'.
--   1. It ships OFF: the pg_cron job issue_4571_crm_cadence_sweep runs at
--      20:00 UTC (9 PM Lagos) on weekdays and does nothing while mode is off.
--   2. Dry run for 3 nights beside the Mac script: set mode to Dry run. Each
--      night the job writes what it would do to crm_cadence_sweep_runs and
--      crm_cadence_sweep_actions and changes no card. Review: the panel lists
--      each night's moves and dates; compare with ~/.mingla-agent/
--      cadence_sweep.log (same counts, same cards) and post the diff on #4571.
--      "Run a dry run now" writes one more dry run on demand.
--   3. Switch on: the same evening, the calls chat stops the Mac script, then
--      the owner sets mode to On. From the next 9 PM Lagos the job moves and
--      dates cards (via 'system', stage history and audit complete).
--   Switch-off (rollback): set mode to Off; the job keeps running and does
--   nothing. The Mac script can be re-enabled. To remove the job:
--   SELECT cron.unschedule('issue_4571_crm_cadence_sweep').
--
-- INVARIANT crm-cadence-counts-prospect-contacted-only: gate crm_4571_cadence
-- (stage_at IN ('prospect','contacted')); test
-- supabase/migrations/__tests__/issue_4571_w6c_cadence.implementor.pg17.test.sql
--
-- ROLLBACK (no down file): SELECT cron.unschedule('issue_4571_crm_cadence_sweep');
-- drop the crm_cadence_* functions, crm_4571_cadence, crm_4571_system_move,
-- crm_4571_working_days_after and the two tables; delete ops_settings key
-- cadence_sweep and restore ops_settings_key_check without it; restore
-- crm_4571_w6_json from 20281130074571.

BEGIN;

SET LOCAL lock_timeout = '10s';

-- The sweep's switch and config, OFF by default.
ALTER TABLE public.ops_settings DROP CONSTRAINT ops_settings_key_check;
ALTER TABLE public.ops_settings ADD CONSTRAINT ops_settings_key_check
  CHECK (key IN ('auto_steps','brand_auto_cards','brand_auto_since','marketing_owner','follow_through_since','auto_promo_cards','tap_to_pay_release','auto_card_routes','native_connect_onboarding','cadence_sweep'));
INSERT INTO public.ops_settings (key, value, updated_by)
VALUES ('cadence_sweep', jsonb_build_object(
          'mode', 'off',
          'team', jsonb_build_array('abimbola@usemingla.com', 'kunle@usemingla.com', 'debra@usemingla.com'),
          'since', '2026-11-23',
          'report_card_id', NULL),
        'system@usemingla.com')
ON CONFLICT (key) DO NOTHING;

CREATE FUNCTION public.crm_4571_cadence_config() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT jsonb_build_object('mode', 'off', 'team', '[]'::jsonb, 'since', '2026-11-23', 'report_card_id', NULL)
         || COALESCE((SELECT s.value FROM public.ops_settings s WHERE s.key = 'cadence_sweep'), '{}'::jsonb)
$function$;
REVOKE ALL ON FUNCTION public.crm_4571_cadence_config() FROM PUBLIC, anon, authenticated;

-- n working days (Mon to Fri) after d: the script's plus2.
CREATE FUNCTION public.crm_4571_working_days_after(d date, n integer) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $function$
DECLARE x date := d; c integer := 0;
BEGIN
  WHILE c < n LOOP
    x := x + 1;
    IF extract(isodow FROM x) < 6 THEN c := c + 1; END IF;
  END LOOP;
  RETURN x;
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_4571_working_days_after(date, integer) FROM PUBLIC, anon, authenticated;

-- The one rule. INVARIANT crm-cadence-counts-prospect-contacted-only (test
-- issue_4571_w6c_cadence.implementor.pg17.test.sql): keep every
-- stage_at IN ('prospect', 'contacted') below.
CREATE FUNCTION public.crm_4571_cadence(r public.crm_records, p_since date) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $function$
DECLARE
  v_from timestamptz := p_since::timestamp AT TIME ZONE 'UTC';
  v_calls integer; v_logged integer; v_days integer; v_emails integer; v_phone boolean; v_last date;
  v_rounds integer; v_finished boolean; v_round integer; v_call_done boolean; v_email_done boolean;
BEGIN
  SELECT count(*) FILTER (WHERE a.channel = 'phone')::integer, count(*) FILTER (WHERE a.channel = 'email')::integer
    INTO v_calls, v_logged
    FROM public.crm_activity a
   WHERE a.record_id = r.id AND a.kind = 'touch' AND a.direction = 'outbound' AND a.occurred_at >= v_from
     AND a.stage_at IN ('prospect', 'contacted');
  SELECT COALESCE(max(x.n), 0)::integer INTO v_days FROM (
    SELECT e.matched_address, count(DISTINCT (e.sent_at AT TIME ZONE 'UTC')::date) AS n
      FROM public.crm_email_log e
     WHERE e.record_id = r.id AND e.direction = 'outbound' AND e.sent_at >= v_from
       AND e.stage_at IN ('prospect', 'contacted')
     GROUP BY e.matched_address) x;
  v_emails := GREATEST(v_logged, v_days);
  v_phone := EXISTS (SELECT 1 FROM public.crm_record_identifiers i WHERE i.record_id = r.id AND i.kind = 'phone');
  SELECT max((a.occurred_at AT TIME ZONE 'Africa/Lagos')::date) INTO v_last
    FROM public.crm_activity a
   WHERE a.record_id = r.id AND a.kind = 'touch' AND a.direction = 'outbound' AND a.occurred_at >= v_from;
  v_rounds := CASE WHEN v_phone THEN LEAST(v_calls, v_emails) ELSE v_emails END;
  v_finished := CASE WHEN v_phone THEN v_calls >= 6 AND v_emails >= 6 ELSE v_emails >= 6 END;
  v_round := LEAST(v_rounds + 1, 6);
  v_call_done := v_calls >= v_round;
  v_email_done := v_emails >= v_round;
  RETURN jsonb_build_object(
    'round', v_round, 'of', 6, 'rounds_done', v_rounds,
    'calls', v_calls, 'emails', v_emails, 'emails_logged', v_logged, 'email_days', v_days,
    'has_phone', v_phone, 'call_done', v_call_done, 'email_done', v_email_done, 'finished', v_finished,
    'last_touch_on', v_last, 'since', p_since,
    'steps', CASE WHEN v_finished THEN jsonb_build_array('cadence finished')
                  ELSE jsonb_build_array(
                         CASE WHEN NOT v_phone THEN 'no phone yet' WHEN v_call_done THEN 'call done' ELSE 'call to make' END,
                         CASE WHEN v_email_done THEN 'email done' ELSE 'email to send' END) END);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_4571_cadence(public.crm_records, date) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.crm_cadence_state(p_record_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v record; r public.crm_records;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  SELECT * INTO r FROM public.crm_records c WHERE c.id = p_record_id AND c.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: That record is no longer here. It may have been deleted.' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.crm_4571_cadence(r, (public.crm_4571_cadence_config()->>'since')::date)
    || jsonb_build_object('counts', r.pipeline = 'hosts' AND r.archived_at IS NULL AND r.stage IN ('prospect', 'contacted'),
                          'stage', r.stage);
END;
$function$;
COMMENT ON FUNCTION public.crm_cadence_state(uuid) IS
  'Issue #4571 W6c. A host card''s cadence: counted calls and emails (outbound, since the restart date, made while the card was in Prospect or Contacted: decision 8 option 1), the round (min(calls, emails) + 1, or emails + 1 with no phone, at most 6), what is done and left, and whether it is finished (6 + 6, or 6 emails with no phone). counts says whether the sweep applies to the card now. crm_ctx().';
REVOKE ALL ON FUNCTION public.crm_cadence_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_cadence_state(uuid) TO authenticated, service_role;

-- From 20281130074571 (crm_4571_w6_json). #4571 W6c: the cadence round on a
-- host card the sweep works (Prospect or Contacted, not archived).
CREATE OR REPLACE FUNCTION public.crm_4571_w6_json(r public.crm_records) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'archived_at', r.archived_at, 'archived_by', r.archived_by, 'archived_reason', r.archived_reason,
    'merged_into', CASE WHEN r.merged_into_id IS NULL THEN NULL ELSE
      (SELECT jsonb_build_object('id', m.id, 'name', m.name) FROM public.crm_records m WHERE m.id = r.merged_into_id) END,
    'suggest_replied', public.crm_4571_suggest_replied(r),
    'cadence', CASE WHEN r.pipeline = 'hosts' AND r.archived_at IS NULL AND r.deleted_at IS NULL AND r.stage IN ('prospect', 'contacted')
                    THEN public.crm_4571_cadence(r, (public.crm_4571_cadence_config()->>'since')::date) END)
$function$;

-- Every run, dry or real, and what it did or would do.
CREATE TABLE public.crm_cadence_sweep_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  today       date NOT NULL,
  dry_run     boolean NOT NULL,
  trigger     text NOT NULL,
  config      jsonb NOT NULL,
  counts      jsonb NOT NULL DEFAULT '{}'::jsonb,
  overdue     jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary     text,
  report_message_id uuid,
  report_error text,
  error       text,
  CONSTRAINT crm_cadence_sweep_runs_trigger_check CHECK (trigger IN ('cron', 'manual')),
  CONSTRAINT crm_cadence_sweep_runs_summary_check CHECK (char_length(COALESCE(summary, '')) <= 2000)
);
CREATE INDEX crm_cadence_sweep_runs_by_time ON public.crm_cadence_sweep_runs (started_at DESC);
CREATE TABLE public.crm_cadence_sweep_actions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      uuid NOT NULL REFERENCES public.crm_cadence_sweep_runs(id) ON DELETE CASCADE,
  record_id   uuid NOT NULL REFERENCES public.crm_records(id) ON DELETE CASCADE,
  record_name text NOT NULL,
  action      text NOT NULL,
  from_stage  text,
  to_stage    text,
  reason      text,
  due_on      date,
  next_action text,
  cadence     jsonb NOT NULL,
  status      text NOT NULL,
  error       text,
  CONSTRAINT crm_cadence_sweep_actions_action_check CHECK (action IN ('lost', 'contacted', 'advance')),
  CONSTRAINT crm_cadence_sweep_actions_status_check CHECK (status IN ('planned', 'applied', 'skipped', 'error'))
);
CREATE INDEX crm_cadence_sweep_actions_by_run ON public.crm_cadence_sweep_actions (run_id, action);
CREATE INDEX crm_cadence_sweep_actions_by_record ON public.crm_cadence_sweep_actions (record_id);
ALTER TABLE public.crm_cadence_sweep_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_cadence_sweep_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_cadence_sweep_runs, public.crm_cadence_sweep_actions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.crm_cadence_sweep_runs, public.crm_cadence_sweep_actions TO service_role;
COMMENT ON TABLE public.crm_cadence_sweep_runs IS
  'Issue #4571 W6c. One row per cadence sweep run (cron or manual, dry or real): the config it used, counts, overdue by owner and the Mac script''s summary line (the #3659 report). Read through crm_cadence_sweep_status.';
COMMENT ON TABLE public.crm_cadence_sweep_actions IS
  'Issue #4571 W6c. What a sweep run did (applied, skipped, error) or would do (planned, in a dry run) to each card.';

-- A stage move by the sweep: the same writes as crm_record_move_stage, as
-- 'system' (crm_reconcile_live's pattern), so stage history, audit and the
-- watchers' notices stay complete. The W4 demo trigger still guards the row.
CREATE FUNCTION public.crm_4571_system_move(p_id uuid, p_from text, p_to text, p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_rec public.crm_records; v_now timestamptz := clock_timestamp(); v_act uuid;
BEGIN
  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = p_id AND c.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_rec.stage IS DISTINCT FROM p_from OR v_rec.archived_at IS NOT NULL THEN
    RETURN NULL;  -- moved, archived or deleted since the plan: the caller marks it skipped
  END IF;
  UPDATE public.crm_records
     SET stage = p_to, stage_reason = CASE WHEN p_to IN ('lost', 'passed') THEN p_reason END,
         updated_by = 'system', updated_at = v_now
   WHERE id = v_rec.id;
  INSERT INTO public.crm_activity (record_id, kind, actor_email, via, body, from_stage, to_stage, occurred_at, created_at)
  VALUES (v_rec.id, 'stage_move', NULL, 'system', p_reason, v_rec.stage, p_to, v_now, v_now)
  RETURNING id INTO v_act;
  PERFORM public.crm_audit('system', 'crm.stage_move', 'crm_record', v_rec.id::text,
    jsonb_build_object('via', 'system', 'source', 'cadence_sweep', 'activity_id', v_act,
      'before', jsonb_build_object('stage', v_rec.stage, 'stage_reason', v_rec.stage_reason),
      'after', jsonb_build_object('stage', p_to, 'stage_reason', CASE WHEN p_to IN ('lost', 'passed') THEN p_reason END)));
  PERFORM public.crm_notify_watchers(v_rec.id, v_act, NULL,
    format('The nightly sweep moved %s to %s', v_rec.name, public.crm_stage_def(v_rec.pipeline, p_to)->>'label'), 'status');
  RETURN v_act;
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_4571_system_move(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

-- The sweep. Server only (pg_cron, or crm_cadence_sweep_preview for a dry run).
CREATE FUNCTION public.crm_cadence_sweep(p_dry_run boolean DEFAULT true, p_trigger text DEFAULT 'manual') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_cfg jsonb := public.crm_4571_cadence_config();
  v_team text[]; v_since date; v_today date := (clock_timestamp() AT TIME ZONE 'Africa/Lagos')::date;
  v_run uuid; r public.crm_records; c jsonb; v_owner text;
  n_active integer := 0; n_lost integer := 0; n_contacted integer := 0; n_advance integer := 0; n_err integer := 0; n_skip integer := 0;
  v_overdue jsonb := '{}'::jsonb; v_reason text; v_next integer; v_due date; v_text text; v_status text; v_err text;
  v_act uuid; v_summary text; v_msg uuid; v_report_err text; v_card uuid;
BEGIN
  IF p_trigger NOT IN ('cron', 'manual') THEN
    RAISE EXCEPTION 'invalid_trigger: cron or manual.' USING ERRCODE = '22023';
  END IF;
  v_team := ARRAY(SELECT lower(btrim(e)) FROM jsonb_array_elements_text(COALESCE(v_cfg->'team', '[]')) e);
  v_since := (v_cfg->>'since')::date;
  INSERT INTO public.crm_cadence_sweep_runs (today, dry_run, trigger, config)
  VALUES (v_today, p_dry_run, p_trigger, v_cfg) RETURNING id INTO v_run;

  FOR r IN
    SELECT x.* FROM public.crm_records x
     WHERE x.pipeline = 'hosts' AND x.deleted_at IS NULL AND x.archived_at IS NULL
       AND x.stage IN ('prospect', 'contacted')
       AND EXISTS (SELECT 1 FROM public.crm_record_owners o WHERE o.record_id = x.id AND o.owner_email = ANY (v_team))
     ORDER BY x.id
  LOOP
    n_active := n_active + 1;
    c := public.crm_4571_cadence(r, v_since);

    IF (c->>'finished')::boolean THEN
      v_reason := format('No meeting after %s calls and %s emails (cadence from %s)', c->>'calls', c->>'emails',
                         to_char(v_since, 'FMDD Mon YYYY'));
      v_status := 'planned'; v_err := NULL;
      IF NOT p_dry_run THEN
        BEGIN
          v_act := public.crm_4571_system_move(r.id, r.stage, 'lost', v_reason);
          v_status := CASE WHEN v_act IS NULL THEN 'skipped' ELSE 'applied' END;
        EXCEPTION WHEN others THEN
          v_status := 'error'; v_err := SQLERRM;
        END;
      END IF;
      INSERT INTO public.crm_cadence_sweep_actions (run_id, record_id, record_name, action, from_stage, to_stage, reason, cadence, status, error)
      VALUES (v_run, r.id, r.name, 'lost', r.stage, 'lost', v_reason, c, v_status, v_err);
      n_lost := n_lost + 1;
      n_err := n_err + (v_status = 'error')::integer; n_skip := n_skip + (v_status = 'skipped')::integer;
      CONTINUE;
    END IF;

    IF ((c->>'calls')::integer > 0 OR (c->>'emails')::integer > 0) AND r.stage = 'prospect' THEN
      v_status := 'planned'; v_err := NULL;
      IF NOT p_dry_run THEN
        BEGIN
          v_act := public.crm_4571_system_move(r.id, 'prospect', 'contacted', 'First cadence touch logged');
          v_status := CASE WHEN v_act IS NULL THEN 'skipped' ELSE 'applied' END;
        EXCEPTION WHEN others THEN
          v_status := 'error'; v_err := SQLERRM;
        END;
      END IF;
      INSERT INTO public.crm_cadence_sweep_actions (run_id, record_id, record_name, action, from_stage, to_stage, reason, cadence, status, error)
      VALUES (v_run, r.id, r.name, 'contacted', 'prospect', 'contacted', 'First cadence touch logged', c, v_status, v_err);
      n_contacted := n_contacted + 1;
      n_err := n_err + (v_status = 'error')::integer; n_skip := n_skip + (v_status = 'skipped')::integer;
    END IF;

    IF (c->>'last_touch_on')::date = v_today AND (r.due_on IS NULL OR r.due_on <= v_today) THEN
      v_next := (c->>'rounds_done')::integer + 1;
      v_due := public.crm_4571_working_days_after(v_today, 2);
      v_text := CASE WHEN (c->>'has_phone')::boolean
        THEN format('Round %s of 6: call from PressOne, then send email %s. %s calls and %s emails so far', v_next, v_next, c->>'calls', c->>'emails')
        ELSE format('Round %s of 6: send email %s and try to find a phone. %s emails so far', v_next, v_next, c->>'emails') END;
      v_status := 'planned'; v_err := NULL;
      IF NOT p_dry_run THEN
        BEGIN
          UPDATE public.crm_records SET due_on = v_due, next_action = left(v_text, 200), updated_by = 'system', updated_at = clock_timestamp()
           WHERE id = r.id AND deleted_at IS NULL AND archived_at IS NULL AND stage IN ('prospect', 'contacted');
          IF FOUND THEN
            v_status := 'applied';
            PERFORM public.crm_audit('system', 'crm.update', 'crm_record', r.id::text,
              jsonb_build_object('via', 'system', 'source', 'cadence_sweep',
                'before', jsonb_build_object('due_on', r.due_on, 'next_action', r.next_action),
                'after', jsonb_build_object('due_on', v_due, 'next_action', left(v_text, 200))));
          ELSE
            v_status := 'skipped';
          END IF;
        EXCEPTION WHEN others THEN
          v_status := 'error'; v_err := SQLERRM;
        END;
      END IF;
      INSERT INTO public.crm_cadence_sweep_actions (run_id, record_id, record_name, action, due_on, next_action, cadence, status, error)
      VALUES (v_run, r.id, r.name, 'advance', v_due, left(v_text, 200), c, v_status, v_err);
      n_advance := n_advance + 1;
      n_err := n_err + (v_status = 'error')::integer; n_skip := n_skip + (v_status = 'skipped')::integer;
    ELSIF r.due_on IS NOT NULL AND r.due_on < v_today
          AND ((c->>'last_touch_on') IS NULL OR (c->>'last_touch_on')::date < r.due_on) THEN
      SELECT min(o.owner_email) INTO v_owner FROM public.crm_record_owners o WHERE o.record_id = r.id;
      v_owner := COALESCE(v_owner, '?');
      v_overdue := jsonb_set(v_overdue, ARRAY[v_owner], to_jsonb(COALESCE((v_overdue->>v_owner)::integer, 0) + 1));
    END IF;
  END LOOP;

  v_summary := format('%s sweep (%s): %s active cards; to Lost %s; Prospect->Contacted %s; next round dated %s; overdue by owner %s',
    v_today, CASE WHEN p_dry_run THEN 'dry run' ELSE 'APPLY' END, n_active, n_lost, n_contacted, n_advance, v_overdue::text)
    || CASE WHEN n_err > 0 OR n_skip > 0 THEN format('; %s skipped (moved since), %s failed', n_skip, n_err) ELSE '' END;

  -- The #3659 note, through the Work card's thread, when a card is named.
  v_card := CASE WHEN COALESCE(v_cfg->>'report_card_id', '') ~* '^[0-9a-f-]{36}$' THEN (v_cfg->>'report_card_id')::uuid END;
  IF v_card IS NOT NULL THEN
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM public.ops_work_cards w WHERE w.id = v_card AND w.archived_at IS NULL) THEN
        RAISE EXCEPTION 'The report card is not on the board.';
      END IF;
      INSERT INTO public.ops_work_messages (card_id, author_email, via, body_md, request_key)
      VALUES (v_card, 'system@usemingla.com', 'system', 'Nightly cadence sweep: ' || v_summary, 'cadence-sweep-' || v_run::text)
      RETURNING id INTO v_msg;
    EXCEPTION WHEN others THEN
      v_report_err := SQLERRM;
    END;
  END IF;

  UPDATE public.crm_cadence_sweep_runs
     SET finished_at = clock_timestamp(), summary = v_summary, overdue = v_overdue, report_message_id = v_msg, report_error = v_report_err,
         counts = jsonb_build_object('active', n_active, 'lost', n_lost, 'contacted', n_contacted, 'advanced', n_advance,
                                     'skipped', n_skip, 'errors', n_err)
   WHERE id = v_run;
  RETURN jsonb_build_object('run_id', v_run, 'dry_run', p_dry_run, 'today', v_today, 'summary', v_summary,
    'counts', jsonb_build_object('active', n_active, 'lost', n_lost, 'contacted', n_contacted, 'advanced', n_advance,
                                 'skipped', n_skip, 'errors', n_err),
    'overdue', v_overdue, 'report_error', v_report_err);
END;
$function$;
COMMENT ON FUNCTION public.crm_cadence_sweep(boolean, text) IS
  'Issue #4571 W6c. The nightly Hosts cadence sweep (the Mac script''s rules, decision 8 option 1): Prospect/Contacted hosts owned by the sweep team; finished 6 + 6 (or 6 emails, no phone) to Lost; first counted touch Prospect to Contacted; touched today and due: next round dated 2 working days on; overdue counted by first owner. A dry run (default) changes no card and writes what it would do to crm_cadence_sweep_runs/actions. Never touches Replied, Demo booked, Onboarded, Live, Lost or archived cards. Server only.';
REVOKE ALL ON FUNCTION public.crm_cadence_sweep(boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_cadence_sweep(boolean, text) TO service_role;

-- What pg_cron runs: the switch decides.
CREATE FUNCTION public.crm_cadence_sweep_cron() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_mode text := public.crm_4571_cadence_config()->>'mode';
BEGIN
  IF v_mode = 'apply' THEN RETURN public.crm_cadence_sweep(false, 'cron'); END IF;
  IF v_mode = 'dry_run' THEN RETURN public.crm_cadence_sweep(true, 'cron'); END IF;
  RETURN jsonb_build_object('mode', 'off');
END;
$function$;
COMMENT ON FUNCTION public.crm_cadence_sweep_cron() IS
  'Issue #4571 W6c. The pg_cron entry point (issue_4571_crm_cadence_sweep, weekdays 20:00 UTC = 9 PM Lagos): off does nothing (the default), dry_run writes a dry run, apply sweeps.';
REVOKE ALL ON FUNCTION public.crm_cadence_sweep_cron() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_cadence_sweep_cron() TO service_role;

-- Admin: the panel's read (owner or admin), the switch (owner, signed in), and
-- a dry run on demand (owner or admin).
CREATE FUNCTION public.crm_4571_sweep_reader() RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF v.via IS NOT NULL OR public.admin_team_role() NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'forbidden: Only the owner or an admin can see the nightly sweep.' USING ERRCODE = '42501';
  END IF;
  RETURN v.actor_email;
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_4571_sweep_reader() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.crm_cadence_sweep_status(p_run_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v record; v_who text; v_run uuid;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_who := public.crm_4571_sweep_reader();
  v_run := COALESCE(p_run_id, (SELECT x.id FROM public.crm_cadence_sweep_runs x ORDER BY x.started_at DESC LIMIT 1));
  RETURN jsonb_build_object(
    'config', public.crm_4571_cadence_config(),
    'job', CASE WHEN to_regnamespace('cron') IS NULL THEN NULL ELSE
      (SELECT jsonb_build_object('schedule', j.schedule, 'active', j.active) FROM cron.job j WHERE j.jobname = 'issue_4571_crm_cadence_sweep') END,
    'runs', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'started_at', x.started_at, 'today', x.today, 'dry_run', x.dry_run,
                                                         'trigger', x.trigger, 'counts', x.counts, 'overdue', x.overdue, 'summary', x.summary,
                                                         'report_error', x.report_error, 'error', x.error) ORDER BY x.started_at DESC)
                        FROM (SELECT * FROM public.crm_cadence_sweep_runs ORDER BY started_at DESC LIMIT 15) x), '[]'::jsonb),
    'run_id', v_run,
    'actions', COALESCE((SELECT jsonb_agg(jsonb_build_object('record_id', a.record_id, 'name', a.record_name, 'action', a.action,
                                                            'from_stage', a.from_stage, 'to_stage', a.to_stage, 'reason', a.reason,
                                                            'due_on', a.due_on, 'next_action', a.next_action, 'status', a.status, 'error', a.error,
                                                            'calls', a.cadence->'calls', 'emails', a.cadence->'emails')
                                          ORDER BY a.action, a.record_name)
                           FROM (SELECT * FROM public.crm_cadence_sweep_actions WHERE run_id = v_run ORDER BY action, record_name LIMIT 1000) a), '[]'::jsonb));
END;
$function$;
COMMENT ON FUNCTION public.crm_cadence_sweep_status(uuid) IS
  'Issue #4571 W6c. The Team dashboard''s Nightly cadence sweep panel: the switch and config, the pg_cron job, the last 15 runs and the actions of one run (the latest by default). Owner or admin, signed in.';
REVOKE ALL ON FUNCTION public.crm_cadence_sweep_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_cadence_sweep_status(uuid) TO authenticated, service_role;

CREATE FUNCTION public.crm_cadence_sweep_preview() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v record; v_who text;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_who := public.crm_4571_sweep_reader();
  RETURN public.crm_cadence_sweep(true, 'manual');
END;
$function$;
COMMENT ON FUNCTION public.crm_cadence_sweep_preview() IS
  'Issue #4571 W6c. A dry run now (changes no card; writes the run and what it would do). Owner or admin, signed in.';
REVOKE ALL ON FUNCTION public.crm_cadence_sweep_preview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_cadence_sweep_preview() TO authenticated, service_role;

CREATE FUNCTION public.crm_cadence_sweep_configure(p_mode text, p_report_card_id uuid DEFAULT NULL,
                                                   p_team text[] DEFAULT NULL, p_since date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v record; v_before jsonb := public.crm_4571_cadence_config(); v_after jsonb; v_team jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  PERFORM public.ops_owner_person_only('Only the owner can switch the nightly sweep.');
  IF p_mode IS NULL OR p_mode NOT IN ('off', 'dry_run', 'apply') THEN
    RAISE EXCEPTION 'invalid_setting: Use off, dry_run or apply.' USING ERRCODE = '22023';
  END IF;
  IF p_report_card_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.ops_work_cards w WHERE w.id = p_report_card_id AND w.archived_at IS NULL) THEN
    RAISE EXCEPTION 'invalid_setting: The report card must be a Work card on the board.' USING ERRCODE = '22023';
  END IF;
  IF p_team IS NOT NULL THEN
    IF cardinality(p_team) NOT BETWEEN 1 AND 20 OR EXISTS (SELECT 1 FROM unnest(p_team) e WHERE e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
      RAISE EXCEPTION 'invalid_setting: The sweep team is 1 to 20 email addresses.' USING ERRCODE = '22023';
    END IF;
    v_team := (SELECT jsonb_agg(DISTINCT lower(btrim(e))) FROM unnest(p_team) e);
  END IF;
  IF p_since IS NOT NULL AND (p_since < date '2026-01-01' OR p_since > (clock_timestamp() AT TIME ZONE 'Africa/Lagos')::date) THEN
    RAISE EXCEPTION 'invalid_setting: The restart date is a past day in 2026 or later.' USING ERRCODE = '22023';
  END IF;
  v_after := v_before || jsonb_build_object('mode', p_mode, 'report_card_id', p_report_card_id)
             || CASE WHEN v_team IS NOT NULL THEN jsonb_build_object('team', v_team) ELSE '{}'::jsonb END
             || CASE WHEN p_since IS NOT NULL THEN jsonb_build_object('since', p_since) ELSE '{}'::jsonb END;
  INSERT INTO public.ops_settings (key, value, updated_by) VALUES ('cadence_sweep', v_after, v.actor_email)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now();
  PERFORM public.ops_log_write(v.actor_email, NULL, 'setting_changed', 'info', NULL, NULL, NULL,
    format('%s set the nightly cadence sweep to %s.', public.ops_name(v.actor_email),
           CASE p_mode WHEN 'apply' THEN 'on' WHEN 'dry_run' THEN 'dry run' ELSE 'off' END),
    jsonb_build_object('key', 'cadence_sweep', 'before', v_before, 'after', v_after));
  RETURN public.crm_4571_cadence_config();
END;
$function$;
COMMENT ON FUNCTION public.crm_cadence_sweep_configure(text, uuid, text[], date) IS
  'Issue #4571 W6c. The sweep''s switch (off, dry_run, apply), the Work card its nightly report is posted on (#3659, optional), its team and its restart date. Owner only, signed in; logged.';
REVOKE ALL ON FUNCTION public.crm_cadence_sweep_configure(text, uuid, text[], date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_cadence_sweep_configure(text, uuid, text[], date) TO authenticated, service_role;

-- Weekdays 20:00 UTC = 9 PM Lagos. The switch above keeps it doing nothing
-- until the owner chooses Dry run, then On.
DO $cron$
DECLARE v_job bigint;
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE '#4571: pg_cron unavailable; issue_4571_crm_cadence_sweep not scheduled'; RETURN;
  END IF;
  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'issue_4571_crm_cadence_sweep';
  IF v_job IS NOT NULL THEN PERFORM cron.unschedule(v_job); END IF;
  PERFORM cron.schedule('issue_4571_crm_cadence_sweep', '0 20 * * 1-5', $job$SELECT public.crm_cadence_sweep_cron()$job$);
END;
$cron$;

COMMIT;
