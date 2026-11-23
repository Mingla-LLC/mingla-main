-- Issue #4571 (Work pipeline redesign), wave W5: the Calendar's Week view.
--   1. ops_calendar_callbacks(p_from, p_to): hosts and creators cards that are
--      not deleted, on the phone channel, whose existing next follow-up
--      (due_on) falls in the window, and whose stage is not lost, passed or
--      live. It is the card's own next follow-up, not a new kind of record.
--      Names of owners only (ops_name), never an email address.
--   2. ops_calendar_work_due(p_from, p_to): open Work cards and subtasks whose
--      due_on is in the window, built by ops_cards_json(..., 'board') so there
--      is one card shape. Not archived, not done.
--   3. The connector's list_calendar (ops_agent_call) gains the layers calls
--      (demos from bookings: time in your person's zone, status, name or venue,
--      linked card, needs_linking; call-backs) and work_due, never an email
--      address or a phone number. Events and demos keep their existing sources
--      (ops_calendar, admin_calendar_calls); nothing here copies them.
-- Reads only. No table, no write path.
--
-- INVARIANT calendar-week-no-contact-details: gate ops_agent_call list_calendar projection; test
-- supabase/migrations/__tests__/issue_4571_w5_calendar.implementor.pg17.test.sql
--
-- ROLLBACK (no down file): drop ops_calendar_callbacks(date, date) and
-- ops_calendar_work_due(date, date); restore ops_agent_call from
-- 20280626014398_issue_4398_review_and_notices.sql:3169. The Week view is UI
-- only; revert it with the admin build.

BEGIN;

SET LOCAL lock_timeout = '10s';

CREATE FUNCTION public.ops_calendar_callbacks(p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE v record; v_rows jsonb; v_n integer;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  PERFORM public.ops_window_check(p_from, p_to);
  SELECT count(*) INTO v_n
    FROM public.crm_records c
   WHERE c.deleted_at IS NULL AND c.pipeline IN ('hosts', 'creators') AND c.channel = 'phone'
     AND c.due_on BETWEEN p_from AND p_to AND c.stage NOT IN ('lost', 'passed', 'live');
  SELECT COALESCE(jsonb_agg(r.j ORDER BY r.due_on, r.name, r.id), '[]'::jsonb) INTO v_rows FROM (
    SELECT c.id, c.name, c.due_on,
           jsonb_build_object(
             'record_id', c.id, 'name', c.name, 'pipeline', c.pipeline, 'due_on', c.due_on, 'stage', c.stage,
             'owners', COALESCE((SELECT jsonb_agg(public.ops_name(o.owner_email) ORDER BY o.owner_email)
                                   FROM public.crm_record_owners o WHERE o.record_id = c.id), '[]'::jsonb)) AS j
      FROM public.crm_records c
     WHERE c.deleted_at IS NULL AND c.pipeline IN ('hosts', 'creators') AND c.channel = 'phone'
       AND c.due_on BETWEEN p_from AND p_to AND c.stage NOT IN ('lost', 'passed', 'live')
     ORDER BY c.due_on, c.name, c.id
     LIMIT 500) r;
  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'rows', v_rows, 'total', v_n, 'truncated', v_n > 500);
END;
$function$;
COMMENT ON FUNCTION public.ops_calendar_callbacks(date, date) IS
  'Issue #4571 W5. The Calendar''s scheduled call-backs: hosts and creators cards (not deleted, channel phone, stage not lost, passed or live) whose existing next follow-up (due_on) is in the window of at most 100 days; at most 500, with the total and truncated. Owners by name, never an email address. crm_ctx(): the Hosts and Creators area, agents included.';
REVOKE ALL ON FUNCTION public.ops_calendar_callbacks(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_calendar_callbacks(date, date) TO authenticated, service_role;

CREATE FUNCTION public.ops_calendar_work_due(p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE v record; v_today date := public.ops_today(NULL); v_ids uuid[]; v_n integer;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  PERFORM public.ops_window_check(p_from, p_to);
  SELECT count(*) INTO v_n FROM public.ops_work_cards w
   WHERE w.archived_at IS NULL AND w.status <> 'done' AND w.due_on BETWEEN p_from AND p_to;
  SELECT COALESCE(array_agg(x.id ORDER BY x.due_on, x.number), ARRAY[]::uuid[]) INTO v_ids FROM (
    SELECT w.id, w.due_on, w.number FROM public.ops_work_cards w
     WHERE w.archived_at IS NULL AND w.status <> 'done' AND w.due_on BETWEEN p_from AND p_to
     ORDER BY w.due_on, w.number
     LIMIT 500) x;
  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'today', v_today,
    'cards', public.ops_cards_json(v_ids, v_today, 'board'), 'total', v_n, 'truncated', v_n > 500);
END;
$function$;
COMMENT ON FUNCTION public.ops_calendar_work_due(date, date) IS
  'Issue #4571 W5. The Calendar''s Work due layer: open (not done, not archived) Work cards and subtasks due in the window of at most 100 days, earliest first, at most 500, with the total and truncated, through ops_cards_json board so there is one card shape. crm_ctx(): the Hosts and Creators area, agents included.';
REVOKE ALL ON FUNCTION public.ops_calendar_work_due(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_calendar_work_due(date, date) TO authenticated, service_role;

-- From 20280626014398_issue_4398_review_and_notices.sql:3169. #4571 W5: list_calendar gains the calls and work_due layers.
CREATE OR REPLACE FUNCTION public.ops_agent_call(p_key_hash text, p_tool text, p_args jsonb, p_client text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '25s'
AS $function$
DECLARE
  c_tools constant text[] := ARRAY['read_log','claim','release','plan_work','add_work','start_work','update_work','close_work',
                                   'push_back','list_work','my_work','list_calendar','runway_report','set_expected_event',
                                   'post_message','add_subtask'];
  c_writes constant text[] := ARRAY['claim','release','add_work','start_work','update_work','close_work','push_back','set_expected_event',
                                    'post_message','add_subtask'];
  c_rules constant jsonb := $rules$[
    "Before any work, call read_log for the records you will touch and check the open claims.",
    "Claim every record you will change or message with claim. A claim ends after 30 minutes without an update. Cards are not claimed: start_work marks you as working on a card for as long as it takes; post each step with update_work.",
    "Write the plan on the card: each step names the connector tool that does it, or person when no tool can.",
    "After each step, read the record back and mark the step done only if the change is really there.",
    "Never report a step done that you could not do. Leave it to a person with exact instructions.",
    "Close a card only with close_work and proof that names what you read back. Your close sends the card to In review: its watcher confirms it in Mingla Admin or sends it back. If it was already done, use push_back with already_done and the proof; if it should not be done, push_back with declined and the reason.",
    "You never send, spend money or publish. Tag the card with the reason (status person with send, spend, publish or other) and stop. The card stays in To do for your person.",
    "A message to someone Mingla messaged in the last 3 days is refused. Tell your person; only they can allow one more.",
    "close_work and push_back release your claims. Release any other claim with release when you stop.",
    "Name this chat once with the chat argument on your first work tool, for example chat: \"Hosts sweep\", so claims and the log show which chat did what. Two chats on one key are told apart and never write over each other.",
    "Log this chat's operations work on the Work board: open a card with add_work at the start, post each step with update_work, and close it with close_work and proof, including PR and merge links for code. Code work itself is logged on its GitHub issue."
  ]$rules$::jsonb;
  v_auth jsonb; v_key uuid; v_owner text; v_uid uuid; v_agent text; v_me jsonb; v_args jsonb;
  v_started timestamptz := clock_timestamp(); v_day timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_lim jsonb := public.team_agent_limits(); v_n bigint; v_oldest timestamptz; v_retry integer; v_call uuid; v_tool text;
  v_token text; v_words text; v_match text[]; v_lock_before text; v_ok boolean := false; v_result jsonb; v_summary jsonb := '{}'::jsonb;
  v_items integer := 0; v_want integer := 0; v_q jsonb; v_date date; v_utc date := (now() AT TIME ZONE 'UTC')::date;
  v_changes jsonb; v_plan jsonb; v_found boolean; v_id uuid; v_rev bigint; v_note jsonb; v_rk text;
  -- Wave 2: calendar layers by the name an agent asks for
  c_layers constant jsonb := '{"live":"events","expected":"expected","deadlines":"deadlines","promotions":"promotions","content":"content","calls":"calls","work_due":"work_due"}'::jsonb;  -- #4571 W5: calls, work_due
  -- #3980 synced: the chat's own name, and the key the connector derived
  v_chat_arg jsonb; v_chat_label text; v_chat_key text; v_chat_old text;
  -- #4571 W5: the calls and Work due layers of list_calendar
  v_tzname text; v_lo timestamptz; v_hi timestamptz; v_cut timestamptz; v_demos jsonb; v_part jsonb; v_demo_note text;
BEGIN
  v_auth := public.team_agent_resolve(p_key_hash);
  IF v_auth->>'auth' IS DISTINCT FROM 'ok' THEN RETURN '{"auth":"invalid"}'::jsonb; END IF;
  v_key := (v_auth->>'key_id')::uuid; v_owner := v_auth->>'owner_email'; v_uid := (v_auth->>'uid')::uuid;
  v_agent := v_auth->>'agent'; v_me := jsonb_build_object('role', v_auth->>'role', 'agent', v_agent);
  v_args := CASE WHEN jsonb_typeof(p_args) = 'object' THEN p_args ELSE '{}'::jsonb END;
  -- "chat" names this chat; it is never handed on to a tool.
  v_chat_arg := v_args->'chat';
  v_args := v_args - 'chat';
  v_tool := CASE WHEN p_tool = ANY (c_tools) THEN p_tool ELSE 'unknown' END;

  v_lock_before := current_setting('lock_timeout');
  BEGIN
    PERFORM set_config('lock_timeout', (v_lim->>'key_wait_ms') || 'ms', true);
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('team_agent_limit:' || v_key::text, 0));
    PERFORM set_config('lock_timeout', v_lock_before, true);
  EXCEPTION WHEN lock_not_available THEN
    PERFORM set_config('lock_timeout', v_lock_before, true);
    INSERT INTO public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at, duration_ms, outcome)
      VALUES (v_key, v_owner, v_uid, v_agent, v_tool, pg_current_xact_id(), v_started, 0, 'limited');
    RETURN jsonb_build_object('limited', jsonb_build_object('retry_after_s', 2, 'token', 'busy',
      'message', 'Another request from your agent is still running. Wait 2 seconds, then send this one again. Nothing was lost.'), 'me', v_me);
  END;
  SELECT count(*), min(c.started_at) INTO v_n, v_oldest FROM public.team_agent_calls c
   WHERE c.key_id = v_key AND c.started_at > v_started - interval '60 seconds' AND c.outcome <> 'limited';
  IF v_n >= (v_lim->>'requests_per_minute')::integer THEN
    v_retry := GREATEST(1, LEAST(60, ceil(60 - extract(epoch FROM (v_started - v_oldest)))::integer));
    v_token := 'rate_limited';
    v_words := format('Your agent has made a lot of requests in the last minute. Wait %s seconds, then carry on. Nothing was lost.', v_retry);
  ELSE
    SELECT count(*) INTO v_n FROM public.team_agent_calls c
     WHERE c.key_id = v_key AND c.started_at >= v_day AND c.outcome <> 'limited' AND c.tool NOT LIKE 'mcp:%';
    IF v_n >= (v_lim->>'tool_calls_per_day')::integer THEN
      v_retry := GREATEST(1, ceil(extract(epoch FROM (v_day + interval '1 day' - v_started)))::integer);
      v_token := 'daily_limit';
      v_words := format('Your agent reached today''s limit of %s requests. It resets at midnight UTC. Ask the owner if you need more.', v_lim->>'tool_calls_per_day');
    ELSIF v_tool = ANY (c_writes) THEN
      SELECT COALESCE(sum(c.items), 0) INTO v_n FROM public.team_agent_calls c
       WHERE c.key_id = v_key AND c.started_at >= v_day AND c.outcome <> 'limited';
      v_want := CASE WHEN v_tool = 'add_work' AND jsonb_typeof(v_args->'cards') = 'array' THEN jsonb_array_length(v_args->'cards') ELSE 1 END;
      IF v_n + v_want > (v_lim->>'records_written_per_day')::integer THEN
        v_retry := GREATEST(1, ceil(extract(epoch FROM (v_day + interval '1 day' - v_started)))::integer);
        v_token := 'daily_limit';
        v_words := 'This request would pass your daily write limit. Send fewer cards, or wait until midnight UTC.';
      END IF;
    END IF;
  END IF;
  IF v_token IS NOT NULL THEN
    INSERT INTO public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at, duration_ms, outcome)
      VALUES (v_key, v_owner, v_uid, v_agent, v_tool, pg_current_xact_id(), v_started, 0, 'limited');
    RETURN jsonb_build_object('limited', jsonb_build_object('retry_after_s', v_retry, 'token', v_token, 'message', v_words), 'me', v_me);
  END IF;

  -- The request row. From here on, crm_ctx() answers "via" this agent for
  -- this person, in this transaction only.
  INSERT INTO public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
    VALUES (v_key, v_owner, v_uid, v_agent, v_tool, pg_current_xact_id(), v_started) RETURNING id INTO v_call;
  UPDATE public.team_agent_keys SET last_used_at = v_started,
         last_used_client = NULLIF(left(regexp_replace(COALESCE(p_client, ''), '[[:cntrl:]]', '', 'g'), 120), '')
   WHERE id = v_key AND (last_used_at IS NULL OR last_used_at < v_started - interval '60 seconds');

  BEGIN
    PERFORM 1 FROM public.crm_ctx();
    IF v_chat_arg IS NOT NULL AND jsonb_typeof(v_chat_arg) IS DISTINCT FROM 'null' THEN
      v_chat_label := CASE WHEN jsonb_typeof(v_chat_arg) = 'string' THEN btrim(v_chat_arg #>> '{}') END;
      IF v_chat_label IS NULL OR v_chat_label !~ '^[^[:cntrl:]]{1,40}$' THEN
        RAISE EXCEPTION 'invalid_arguments: "chat" is a short name for this chat, 1 to 40 characters.' USING ERRCODE = '22023';
      END IF;
      v_chat_key := public.ops_ctx_chat();
      IF v_chat_key <> 'default' THEN
        SELECT c.label INTO v_chat_old FROM public.ops_agent_chats c
         WHERE c.owner_email = lower(btrim(v_owner)) AND c.via = v_agent AND c.chat_key = v_chat_key;
        INSERT INTO public.ops_agent_chats (owner_email, via, chat_key, label)
        VALUES (lower(btrim(v_owner)), v_agent, v_chat_key, v_chat_label)
        ON CONFLICT (owner_email, via, chat_key) DO UPDATE SET label = EXCLUDED.label, last_seen_at = now();
        IF v_chat_old IS DISTINCT FROM v_chat_label THEN
          PERFORM public.ops_log_write(lower(btrim(v_owner)), v_agent, 'chat_named', 'info', NULL, NULL, NULL,
            format('This chat is now named "%s".', v_chat_label), jsonb_build_object('chat_key', left(v_chat_key, 4)));
        END IF;
      END IF;
    END IF;
    IF v_tool IN ('add_work', 'set_expected_event', 'post_message', 'add_subtask') OR (v_tool = 'update_work' AND v_args ? 'note') THEN
      IF jsonb_typeof(v_args->'request_key') IS DISTINCT FROM 'string' OR (v_args->>'request_key') !~ '^[A-Za-z0-9_-]{8,70}$' THEN
        RAISE EXCEPTION 'request_key_required: Send a request_key (8 to 70 letters, digits, - or _) with this request, and the same one if you repeat it, so a repeat changes nothing.' USING ERRCODE = '22023';
      END IF;
    END IF;
    v_rk := v_args->>'request_key';
    -- "Today": the date the request names (within a day of UTC), else today
    -- in the zone the key remembers, else UTC.
    IF v_tool IN ('list_work', 'my_work', 'list_calendar', 'runway_report', 'plan_work') THEN
      BEGIN
        v_date := (clock_timestamp() AT TIME ZONE COALESCE(v_auth->>'time_zone', 'UTC'))::date;
      EXCEPTION WHEN others THEN v_date := v_utc;
      END;
      IF v_args ? 'today' AND jsonb_typeof(v_args->'today') <> 'null' THEN
        BEGIN
          IF jsonb_typeof(v_args->'today') <> 'string' OR (v_args->>'today') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22007'; END IF;
          v_date := (v_args->>'today')::date;
        EXCEPTION WHEN others THEN
          RAISE EXCEPTION 'invalid_arguments: "today" is the wrong kind. Send your person''s own date, such as 2026-10-13.' USING ERRCODE = '22023';
        END;
        IF v_date NOT BETWEEN v_utc - 1 AND v_utc + 1 THEN
          RAISE EXCEPTION 'invalid_arguments: "today" must be your person''s own date today (within a day of the date in UTC), or leave it out.' USING ERRCODE = '22023';
        END IF;
      END IF;
    END IF;

    CASE v_tool
      WHEN 'read_log' THEN
        v_q := jsonb_strip_nulls(jsonb_build_object(
          'who', CASE WHEN jsonb_typeof(v_args->'mine') = 'boolean' AND (v_args->>'mine')::boolean THEN 'mine' END,
          'card_id', v_args->'card_id',
          'target_kind', COALESCE(v_args->'target_kind', CASE WHEN v_args ? 'record_id' THEN '"crm_record"'::jsonb END),
          'target_id', v_args->'record_id', 'since', v_args->'since', 'limit', v_args->'limit'));
        v_result := public.ops_log_list(v_q) || jsonb_build_object('rules', c_rules);
        v_summary := jsonb_build_object('entries', jsonb_array_length(v_result->'entries'));
      WHEN 'claim' THEN
        v_result := public.ops_claim((v_args->>'card_id')::uuid, v_args->'targets');
        v_items := jsonb_array_length(v_result->'claims');
        v_summary := jsonb_build_object('claimed', jsonb_array_length(v_result->'claims'), 'held', jsonb_array_length(v_result->'held'));
      WHEN 'release' THEN
        v_result := public.ops_release((v_args->>'card_id')::uuid,
          CASE WHEN jsonb_typeof(v_args->'claim_ids') = 'array' THEN ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(v_args->'claim_ids') x) END);
        v_items := (v_result->>'released')::integer;
        v_summary := jsonb_build_object('released', (v_result->>'released')::integer);
      WHEN 'add_work' THEN
        v_result := public.ops_work_add(v_args->'cards', v_rk);
        v_items := COALESCE((v_result->>'added')::integer, 0);
        v_summary := jsonb_build_object('added', COALESCE((v_result->>'added')::integer, 0), 'refused', COALESCE((v_result->>'refused')::integer, 0),
                                        'duplicate', COALESCE((v_result->>'duplicate')::integer, 0));
      WHEN 'start_work' THEN
        v_result := public.ops_work_start((v_args->>'id')::uuid, (v_args->>'expected_revision')::bigint);
        v_items := 1; v_summary := '{"started":1}'::jsonb;
      WHEN 'update_work' THEN
        v_id := (v_args->>'id')::uuid; v_rev := (v_args->>'expected_revision')::bigint;
        v_changes := CASE WHEN jsonb_typeof(v_args->'changes') = 'object' THEN v_args->'changes' ELSE '{}'::jsonb END;
        IF jsonb_typeof(v_args->'step') = 'object' THEN
          -- #4255: the plan is read from the card's subtasks; step n is the n-th.
          SELECT public.ops_plan_from_subtasks(w.id) INTO v_plan FROM public.ops_work_cards w WHERE w.id = v_id AND w.archived_at IS NULL;
          IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That card is no longer here.' USING ERRCODE = 'P0002'; END IF;
          v_plan := COALESCE(v_changes->'plan', v_plan);
          SELECT COALESCE(jsonb_agg(CASE WHEN s->>'n' = v_args->'step'->>'n'
                   THEN s || jsonb_strip_nulls(jsonb_build_object('status', v_args->'step'->'status', 'result', v_args->'step'->'result'))
                          || jsonb_build_object('checked_at', clock_timestamp())
                   ELSE s END ORDER BY (s->>'n')::integer), '[]'::jsonb),
                 COALESCE(bool_or(s->>'n' = v_args->'step'->>'n'), false)
            INTO v_plan, v_found FROM jsonb_array_elements(v_plan) s;
          IF NOT v_found THEN
            RAISE EXCEPTION '%', format('invalid_arguments: There is no step %s on this card. Read the plan with list_work.', left(COALESCE(v_args->'step'->>'n', ''), 4)) USING ERRCODE = '22023';
          END IF;
          v_changes := v_changes || jsonb_build_object('plan', v_plan);
        END IF;
        IF v_changes = '{}'::jsonb AND NOT (v_args ? 'note') THEN
          RAISE EXCEPTION 'invalid_arguments: Send changes, a step or a note.' USING ERRCODE = '22023';
        END IF;
        IF v_changes <> '{}'::jsonb THEN
          v_result := public.ops_work_update(v_id, v_changes, v_rev, CASE WHEN v_rk IS NOT NULL THEN v_rk || '_u' END);
        END IF;
        IF v_args ? 'note' THEN
          v_note := public.ops_work_note(v_id, v_args->>'note', ARRAY[]::text[], v_rk || '_n');
          v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object('note', v_note);
        END IF;
        v_items := 1; v_summary := '{"updated":1}'::jsonb;
      WHEN 'close_work' THEN
        v_result := public.ops_work_close((v_args->>'id')::uuid, v_args->'proof', v_args->>'result', (v_args->>'expected_revision')::bigint);
        -- #4398 (C): an agent's close goes to In review; the answer says so.
        v_items := 1; v_summary := CASE WHEN v_result ? 'review' THEN '{"in_review":1}'::jsonb ELSE '{"closed":1}'::jsonb END;
      WHEN 'push_back' THEN
        v_result := public.ops_work_push_back((v_args->>'id')::uuid, v_args->>'kind', v_args->>'reason',
          COALESCE(v_args->'proof', '[]'::jsonb), (v_args->>'expected_revision')::bigint);
        v_items := 1; v_summary := CASE WHEN v_result ? 'review' THEN '{"in_review":1}'::jsonb ELSE '{"pushed_back":1}'::jsonb END;
      WHEN 'list_work' THEN
        -- #4270 rework: Done means closed since Monday in your person's time zone.
        v_result := public.ops_work_list((v_args - 'today' - 'tz' - 'per_status') || jsonb_build_object('today', v_date, 'tz', COALESCE(v_auth->>'time_zone', 'UTC')));
        v_summary := jsonb_build_object('cards', jsonb_array_length(v_result->'cards'));
      WHEN 'my_work' THEN
        v_result := jsonb_build_object('today', v_date,
          -- #4255: subtasks too; each names its parent.
          'mine', public.ops_work_list(jsonb_build_object('who', 'mine', 'today', v_date, 'done_days', 0, 'subtasks', true))->'cards',
          'watching', public.ops_work_list(jsonb_build_object('who', 'watching', 'today', v_date, 'done_days', 0, 'subtasks', true))->'cards',
          'claims', public.ops_log_list('{"who":"mine","limit":1}'::jsonb)->'claims',
          'working', public.ops_log_list('{"who":"mine","limit":1}'::jsonb)->'working');
        v_summary := jsonb_build_object('mine', jsonb_array_length(v_result->'mine'), 'watching', jsonb_array_length(v_result->'watching'));
      WHEN 'list_calendar' THEN
        IF jsonb_typeof(v_args->'from') IS DISTINCT FROM 'string' OR jsonb_typeof(v_args->'to') IS DISTINCT FROM 'string'
           OR (v_args->>'from') !~ '^\d{4}-\d{2}-\d{2}$' OR (v_args->>'to') !~ '^\d{4}-\d{2}-\d{2}$' THEN
          RAISE EXCEPTION 'invalid_arguments: Send from and to as dates, such as 2026-11-01, at most 100 days apart.' USING ERRCODE = '22023';
        END IF;
        v_result := public.ops_calendar((v_args->>'from')::date, (v_args->>'to')::date, v_date);
        -- #4571 W5: booked demos (never an email or a phone number), call-backs
        -- and Work due, for the same days. Demos are read in your person's own
        -- zone, in chunks of at most 90 days (admin_calendar_calls takes 93).
        v_tzname := COALESCE(NULLIF(v_auth->>'time_zone', ''), 'UTC');
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = v_tzname) THEN v_tzname := 'UTC'; END IF;
        v_demos := '[]'::jsonb; v_demo_note := NULL;
        IF public.is_admin_user() OR COALESCE(public.admin_team_can('beta_leads'), false) THEN
          v_lo := ((v_args->>'from')::date)::timestamp AT TIME ZONE v_tzname;
          v_hi := (((v_args->>'to')::date) + 1)::timestamp AT TIME ZONE v_tzname;
          WHILE v_lo < v_hi LOOP
            v_cut := LEAST(v_hi, v_lo + interval '90 days');
            v_part := public.admin_calendar_calls(v_lo, v_cut, false)->'rows';
            v_demos := v_demos || COALESCE(v_part, '[]'::jsonb);
            v_lo := v_cut;
          END LOOP;
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'id', d->'id', 'audience', d->'audience',
                   'name', regexp_replace(COALESCE(d->>'name', ''), '\S*@\S*', '[email hidden]', 'g'),
                   'venue', regexp_replace(COALESCE(d->>'venue', ''), '\S*@\S*', '[email hidden]', 'g'),
                   'call_at', d->'call_at',
                   'call_at_local', to_char(((d->>'call_at')::timestamptz) AT TIME ZONE v_tzname, 'YYYY-MM-DD HH24:MI'),
                   'status', d->'status', 'record', CASE WHEN jsonb_typeof(d->'record') = 'object'
                                  THEN jsonb_build_object('id', d->'record'->'id', 'name', regexp_replace(COALESCE(d->'record'->>'name', ''), '\S*@\S*', '[email hidden]', 'g')) END,
                   'needs_linking', d->'needs_linking')
                 ORDER BY d->>'call_at', d->>'id'), '[]'::jsonb)
            INTO v_demos FROM jsonb_array_elements(v_demos) d;
        ELSE
          v_demo_note := 'Your person''s team access does not include booked calls, so demos are not listed.';
        END IF;
        v_result := v_result || jsonb_build_object(
          'calls', jsonb_strip_nulls(jsonb_build_object(
            'time_zone', v_tzname, 'demos', v_demos, 'demos_note', v_demo_note,
            'callbacks', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                           'record_id', b->'record_id', 'pipeline', b->'pipeline', 'due_on', b->'due_on', 'stage', b->'stage', 'owners', b->'owners',
                           'name', regexp_replace(COALESCE(b->>'name', ''), '\S*@\S*', '[email hidden]', 'g')) ORDER BY b->>'due_on', b->>'name'), '[]'::jsonb)
                         FROM jsonb_array_elements(COALESCE(public.ops_calendar_callbacks((v_args->>'from')::date, (v_args->>'to')::date)->'rows', '[]'::jsonb)) b))),
          'work_due', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                         'id', c->'id', 'number', c->'number',
                         'title', regexp_replace(COALESCE(c->>'title', ''), '\S*@\S*', '[email hidden]', 'g'), 'status', c->'status',
                         'due_on', c->'due_on', 'overdue', c->'overdue',
                         'owners', COALESCE((SELECT jsonb_agg(o->'name') FROM jsonb_array_elements(COALESCE(c->'owners', '[]'::jsonb)) o), '[]'::jsonb),
                         'parent', CASE WHEN jsonb_typeof(c->'parent') = 'object'
                                        THEN jsonb_build_object('number', c->'parent'->'number',
                                               'title', regexp_replace(COALESCE(c->'parent'->>'title', ''), '\S*@\S*', '[email hidden]', 'g')) END) ORDER BY c->>'due_on', (c->>'number')::integer), '[]'::jsonb)
                       FROM jsonb_array_elements(public.ops_calendar_work_due((v_args->>'from')::date, (v_args->>'to')::date)->'cards') c));
        IF jsonb_typeof(v_args->'layers') = 'array' THEN
          v_result := v_result - ARRAY(SELECT m.value FROM jsonb_each_text(c_layers) m
                                        WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_args->'layers') l WHERE l = m.key));
        END IF;
        v_summary := jsonb_build_object('events', jsonb_array_length(COALESCE(v_result->'events', '[]'::jsonb)),
                                        'expected', jsonb_array_length(COALESCE(v_result->'expected', '[]'::jsonb)),
                                        'demos', jsonb_array_length(COALESCE(v_result->'calls'->'demos', '[]'::jsonb)),
                                        'callbacks', jsonb_array_length(COALESCE(v_result->'calls'->'callbacks', '[]'::jsonb)),
                                        'work_due', jsonb_array_length(COALESCE(v_result->'work_due', '[]'::jsonb)));
      WHEN 'runway_report' THEN
        IF (v_args ? 'from' AND (jsonb_typeof(v_args->'from') <> 'string' OR (v_args->>'from') !~ '^\d{4}-\d{2}-\d{2}$'))
           OR (v_args ? 'to' AND (jsonb_typeof(v_args->'to') <> 'string' OR (v_args->>'to') !~ '^\d{4}-\d{2}-\d{2}$')) THEN
          RAISE EXCEPTION 'invalid_arguments: Send from and to as dates, such as 2026-11-01, or leave them out for the next 90 days.' USING ERRCODE = '22023';
        END IF;
        v_result := public.ops_runway_report((v_args->>'from')::date, (v_args->>'to')::date, v_date);
        v_summary := jsonb_build_object('rows', jsonb_array_length(v_result->'rows'), 'at_risk', jsonb_array_length(v_result->'at_risk'));
      WHEN 'set_expected_event' THEN
        v_result := public.ops_expected_event_set(v_args - 'request_key', v_rk);
        v_items := 1;
        v_summary := jsonb_build_object('expected', v_result->>'status');
      WHEN 'plan_work' THEN
        IF (CASE WHEN jsonb_typeof(v_args->'event_id') = 'string' THEN 1 ELSE 0 END)
           + (CASE WHEN jsonb_typeof(v_args->'expected_event_id') = 'string' THEN 1 ELSE 0 END) <> 1 THEN
          RAISE EXCEPTION 'invalid_arguments: Send event_id or expected_event_id, one of them, as Mingla gave it.' USING ERRCODE = '22023';
        END IF;
        v_result := public.ops_launch_kit_preview(
          CASE WHEN jsonb_typeof(v_args->'event_id') = 'string' THEN 'event' ELSE 'expected' END,
          (COALESCE(v_args->>'event_id', v_args->>'expected_event_id'))::uuid,
          jsonb_strip_nulls(jsonb_build_object('host_owner_emails', v_args->'host_owner_emails',
            'marketing_owner_emails', v_args->'marketing_owner_emails', 'watcher_emails', v_args->'watcher_emails')),
          v_date);
        v_summary := jsonb_build_object('cards', jsonb_array_length(v_result->'cards'), 'skipped', jsonb_array_length(v_result->'skipped'));
      WHEN 'post_message' THEN
        -- #4255: a message in a card's thread (never a team chat).
        IF jsonb_typeof(v_args->'mentions') IS NOT NULL AND jsonb_typeof(v_args->'mentions') NOT IN ('array', 'null') THEN
          RAISE EXCEPTION 'invalid_arguments: "mentions" is a list of teammates.' USING ERRCODE = '22023';
        END IF;
        v_result := public.ops_message_post((v_args->>'card_id')::uuid, v_args->>'body',
          CASE WHEN jsonb_typeof(v_args->'mentions') = 'array' THEN ARRAY(SELECT x FROM jsonb_array_elements_text(v_args->'mentions') x) ELSE ARRAY[]::text[] END,
          CASE WHEN jsonb_typeof(v_args->'reply_to') = 'string' THEN (v_args->>'reply_to')::uuid END, NULL, false, v_rk);
        v_items := 1; v_summary := '{"posted":1}'::jsonb;
      WHEN 'add_subtask' THEN
        v_result := public.ops_subtask_add((v_args->>'parent_id')::uuid, v_args - 'parent_id' - 'request_key', v_rk);
        v_items := CASE WHEN v_result->>'status' = 'added' THEN 1 ELSE 0 END;
        v_summary := jsonb_build_object('subtask', v_result->>'status');
      ELSE
        RAISE EXCEPTION 'unknown_tool: That tool does not exist. Call tools/list to see what is available.' USING ERRCODE = '22023';
    END CASE;
    v_ok := true;
  EXCEPTION WHEN others THEN
    v_items := 0; v_summary := '{}'::jsonb;
    v_match := regexp_match(SQLERRM, '^([a-z_]+): (.+)$');
    v_token := CASE WHEN v_match IS NULL THEN NULL ELSE v_match[1] END;
    v_words := CASE WHEN v_token IS NULL THEN 'Something went wrong on our side. Nothing was saved. Send the same request again.' ELSE v_match[2] END;
    IF v_token IS NULL AND SQLSTATE IN ('22P02', '22007', '22008', '22003') THEN
      v_token := 'invalid_arguments';
      v_words := 'An id, a date or a number has the wrong shape. Read it again from Mingla and send it as it was given.';
    END IF;
    IF v_token IS NULL THEN
      v_token := 'server_error';
      RAISE WARNING 'ops_agent_call: tool % ended with an unexpected error (% %)', v_tool, SQLSTATE, SQLERRM;
    END IF;
  END;
  UPDATE public.team_agent_calls SET outcome = CASE WHEN v_ok THEN 'ok' ELSE left(v_token, 60) END, items = v_items, summary = v_summary,
         duration_ms = LEAST(2147483647, GREATEST(0, round(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)))::integer
   WHERE id = v_call;
  IF v_ok THEN RETURN jsonb_build_object('ok', true, 'result', v_result, 'me', v_me); END IF;
  RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('token', v_token, 'message', v_words), 'me', v_me);
END;
$function$;

COMMIT;
