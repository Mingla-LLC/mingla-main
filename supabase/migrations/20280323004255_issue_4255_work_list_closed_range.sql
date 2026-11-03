-- Issue #4255 (Wave 2) — Work: This week and This month list what got done.
--
-- Today, This week and This month share one layout: per person, Done, Doing,
-- Blocked and Waiting on a person. "Done" means closed INSIDE the window (from
-- Monday 00:00 or the 1st of the month in the viewer's own time), which
-- ops_work_list could not say: it only takes done_days (closed in the last
-- 0 to 60 days, counted from now). And it stopped at 300 cards, so "+N more"
-- could not always list everything.
--
-- What changes (ops_work_list(jsonb), same signature, same grants):
--   closed_since  optional timestamp: done cards closed at or after it
--   closed_until  optional timestamp: done cards closed before it
--   offset        optional 0 to 100000: skip that many cards (paging)
-- With closed_since or closed_until, done cards are chosen by that range and
-- done_days is not used for them. Open cards are unchanged. Every existing
-- caller (the board, Today, My day, the team agent's list_work tool) sends
-- none of the new keys and gets exactly what it got before; `truncated` now
-- also counts the offset, and the answer says which offset it used.
--
-- Backwards compatible: CREATE OR REPLACE keeps the owner and the grants
-- (authenticated and service_role execute; anon does not). Static SQL only.
-- Do not auto-apply. Release through the governed migration lane.
-- MINGLA-INVARIANT: I-4255-WORK-DONE-IN-WINDOW | issue #4255 | Work's Done lists count only cards closed inside the window; ops_work_list without the new keys answers as before.

CREATE OR REPLACE FUNCTION public.ops_work_list(p_query jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v record; q jsonb := CASE WHEN jsonb_typeof(p_query) = 'object' THEN p_query ELSE '{}'::jsonb END; v_bad text;
  v_today date; v_status text[]; v_who text := 'all'; v_owner text; v_event uuid; v_expected uuid; v_record uuid; v_week date;
  v_q text; v_like text; v_done_days integer := 7; v_limit integer := 200; v_cards jsonb; v_total integer; v_counts jsonb; v_ids uuid[];
  v_closed_since timestamptz; v_closed_until timestamptz; v_offset integer := 0;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  SELECT k INTO v_bad FROM jsonb_object_keys(q) k
   WHERE k NOT IN ('status','who','owner','event_id','expected_id','record_id','week','q','done_days','today','limit',
                   'closed_since','closed_until','offset') ORDER BY k LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '%', format('invalid_query: The board cannot filter by "%s". It takes status, who, owner, event_id, expected_id, record_id, week, q, done_days, closed_since, closed_until, today, limit and offset.', left(v_bad, 40)) USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_today := public.ops_today(CASE WHEN jsonb_typeof(q->'today') = 'string' THEN (q->>'today')::date END);
    IF q ? 'status' AND jsonb_typeof(q->'status') <> 'null' THEN
      IF jsonb_typeof(q->'status') <> 'array' OR EXISTS (SELECT 1 FROM jsonb_array_elements(q->'status') s WHERE jsonb_typeof(s) <> 'string' OR s #>> '{}' NOT IN ('todo','doing','person','done')) THEN
        RAISE EXCEPTION 'bad' USING ERRCODE = '22023';
      END IF;
      v_status := ARRAY(SELECT s FROM jsonb_array_elements_text(q->'status') s);
    END IF;
    IF jsonb_typeof(q->'who') = 'string' THEN
      v_who := q->>'who';
      IF v_who NOT IN ('all','mine','watching') THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22023'; END IF;
    END IF;
    IF jsonb_typeof(q->'owner') = 'string' THEN
      v_owner := public.ops_team_email(q->>'owner');
      IF v_owner IS NULL THEN v_owner := lower(btrim(q->>'owner')); END IF;
    END IF;
    IF jsonb_typeof(q->'event_id') = 'string' THEN v_event := (q->>'event_id')::uuid; END IF;
    IF jsonb_typeof(q->'expected_id') = 'string' THEN v_expected := (q->>'expected_id')::uuid; END IF;
    IF jsonb_typeof(q->'record_id') = 'string' THEN v_record := (q->>'record_id')::uuid; END IF;
    IF jsonb_typeof(q->'week') = 'string' THEN v_week := public.ops_monday((q->>'week')::date); END IF;
    IF jsonb_typeof(q->'q') = 'string' THEN
      v_q := public.ops_one_line(q->>'q');
      IF char_length(COALESCE(v_q, '')) > 160 THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22023'; END IF;
      v_like := replace(replace(replace(v_q, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_');
    END IF;
    IF q ? 'done_days' AND jsonb_typeof(q->'done_days') <> 'null' THEN
      v_done_days := (q->>'done_days')::integer;
      IF v_done_days NOT BETWEEN 0 AND 60 THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22023'; END IF;
    END IF;
    IF q ? 'limit' AND jsonb_typeof(q->'limit') <> 'null' THEN
      v_limit := (q->>'limit')::integer;
      IF v_limit NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22023'; END IF;
    END IF;
    -- #4255: done cards closed inside a window, and paging.
    IF q ? 'closed_since' AND jsonb_typeof(q->'closed_since') <> 'null' THEN
      IF jsonb_typeof(q->'closed_since') <> 'string' THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22023'; END IF;
      v_closed_since := (q->>'closed_since')::timestamptz;
    END IF;
    IF q ? 'closed_until' AND jsonb_typeof(q->'closed_until') <> 'null' THEN
      IF jsonb_typeof(q->'closed_until') <> 'string' THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22023'; END IF;
      v_closed_until := (q->>'closed_until')::timestamptz;
    END IF;
    IF v_closed_since IS NOT NULL AND v_closed_until IS NOT NULL AND v_closed_until <= v_closed_since THEN
      RAISE EXCEPTION 'bad' USING ERRCODE = '22023';
    END IF;
    IF q ? 'offset' AND jsonb_typeof(q->'offset') <> 'null' THEN
      v_offset := (q->>'offset')::integer;
      IF v_offset NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22023'; END IF;
    END IF;
  EXCEPTION WHEN invalid_parameter_value OR invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'invalid_query: A filter has the wrong shape. Use status (todo, doing, person, done), who (all, mine, watching), ids from Mingla, a week date, up to 160 characters of search, done_days 0 to 60, closed_since before closed_until, limit 1 to 300 and offset 0 to 100000.' USING ERRCODE = '22023';
  END;

  WITH base AS (
    SELECT w.id, w.status, w.due_on, w.number FROM public.ops_work_cards w
     WHERE w.archived_at IS NULL
       AND (v_who = 'all'
            OR (v_who = 'mine' AND EXISTS (SELECT 1 FROM public.ops_work_people p WHERE p.card_id = w.id AND p.email = v.actor_email AND p.role = 'owner'))
            OR (v_who = 'watching' AND EXISTS (SELECT 1 FROM public.ops_work_people p WHERE p.card_id = w.id AND p.email = v.actor_email AND p.role = 'watcher')))
       AND (v_owner IS NULL OR EXISTS (SELECT 1 FROM public.ops_work_people p WHERE p.card_id = w.id AND p.email = v_owner AND p.role = 'owner'))
       AND (v_event IS NULL OR (w.anchor_kind = 'event' AND w.anchor_id = v_event)
            OR EXISTS (SELECT 1 FROM public.ops_work_links l WHERE l.card_id = w.id AND l.kind = 'event' AND l.target_id = v_event))
       AND (v_expected IS NULL OR (w.anchor_kind = 'expected' AND w.anchor_id = v_expected)
            OR EXISTS (SELECT 1 FROM public.ops_work_links l WHERE l.card_id = w.id AND l.kind = 'expected' AND l.target_id = v_expected))
       AND (v_record IS NULL OR EXISTS (SELECT 1 FROM public.ops_work_links l WHERE l.card_id = w.id AND l.kind IN ('host','creator') AND l.target_id = v_record))
       AND (v_week IS NULL OR w.sprint_id = (SELECT s.id FROM public.ops_sprints s WHERE s.starts_on = v_week))
       AND (v_like IS NULL OR w.title ILIKE '%' || v_like || '%' ESCAPE E'\\' OR w.instructions ILIKE '%' || v_like || '%' ESCAPE E'\\'
            OR ('card ' || w.number::text) = lower(v_q) OR w.number::text = v_q)
       AND (w.status <> 'done' OR v_week IS NOT NULL
            OR (CASE WHEN v_closed_since IS NOT NULL OR v_closed_until IS NOT NULL
                     THEN w.closed_at IS NOT NULL
                          AND (v_closed_since IS NULL OR w.closed_at >= v_closed_since)
                          AND (v_closed_until IS NULL OR w.closed_at < v_closed_until)
                     ELSE w.closed_at >= now() - make_interval(days => v_done_days) END)))
  SELECT jsonb_build_object('todo', count(*) FILTER (WHERE b.status = 'todo'), 'doing', count(*) FILTER (WHERE b.status = 'doing'),
                            'person', count(*) FILTER (WHERE b.status = 'person'), 'done', count(*) FILTER (WHERE b.status = 'done')),
         count(*) FILTER (WHERE v_status IS NULL OR b.status = ANY (v_status)),
         array_agg(b.id ORDER BY array_position(ARRAY['todo','doing','person','done'], b.status), b.due_on, b.number)
           FILTER (WHERE v_status IS NULL OR b.status = ANY (v_status))
    INTO v_counts, v_total, v_ids
    FROM base b;
  SELECT COALESCE(jsonb_agg(public.ops_card_json(w, v_today) ORDER BY u.ord), '[]'::jsonb) INTO v_cards
    FROM unnest(COALESCE(v_ids[v_offset + 1:v_offset + v_limit], ARRAY[]::uuid[])) WITH ORDINALITY u(id, ord)
    JOIN public.ops_work_cards w ON w.id = u.id;
  RETURN jsonb_build_object('cards', v_cards, 'total', v_total, 'truncated', v_total > v_offset + v_limit, 'counts', v_counts,
    'offset', v_offset,
    'sprint', public.ops_sprint_json(COALESCE(v_week, public.ops_monday(v_today))), 'today', v_today);
END;
$$;
