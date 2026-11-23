-- #4580 — ops_work_list validates the viewer's time zone through a cached
-- list of zone names.
--
-- The Work board's list call spent ~56 ms of every call (about two thirds of
-- a warm call) on its first check, a lookup in pg_catalog.pg_timezone_names
-- (a set-returning function that builds all 1,194 zones each time).
--
-- B1. public.ops_timezone_names: the zone names, cached in a small table.
-- B2. public.ops_timezone_valid(text): true when the cache holds the name;
--     otherwise the exact old check, so the answer equals a pg_timezone_names
--     lookup for every input (a zone a later tzdata adds still counts).
-- B3. ops_work_list: the 4423 body with that one line changed.
--
-- Rollback (B4): re-apply public.ops_work_list(jsonb) from
-- 20280707014423_issue_4423_w2_ops_work_list_review_counts.sql, then
--   DROP FUNCTION public.ops_timezone_valid(text);
--   DROP TABLE public.ops_timezone_names;

BEGIN;

-- B0. Drift preflight: the body replaced below is the one from
-- 20280707014423_issue_4423_w2_ops_work_list_review_counts.sql.
DO $preflight$
DECLARE
  v_definition text;
  v_old constant text := 'IF EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = q->>''tz'') THEN v_tz := q->>''tz''; END IF;';
  v_n integer;
BEGIN
  SELECT pg_get_functiondef('public.ops_work_list(jsonb)'::regprocedure) INTO v_definition;
  v_n := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'issue4580_work_list_contract_drift:%', v_n;
  END IF;
END;
$preflight$;

-- B1. The cached zone names. Only SECURITY DEFINER functions read it.
CREATE TABLE IF NOT EXISTS public.ops_timezone_names (name text PRIMARY KEY);
INSERT INTO public.ops_timezone_names (name)
SELECT z.name FROM pg_catalog.pg_timezone_names z
ON CONFLICT DO NOTHING;
ALTER TABLE public.ops_timezone_names ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ops_timezone_names FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.ops_timezone_names IS
  'Issue #4580. A cache of pg_catalog.pg_timezone_names(name), read by ops_timezone_valid(). A miss falls back to pg_timezone_names, so a stale cache only costs time.';

-- B2. Is this a time zone name? Same answer as a pg_timezone_names lookup
-- (NULL is not a zone).
CREATE OR REPLACE FUNCTION public.ops_timezone_valid(p_tz text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF p_tz IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.ops_timezone_names WHERE name = p_tz) THEN RETURN true; END IF;
  RETURN EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = p_tz);
END;
$function$;
REVOKE ALL ON FUNCTION public.ops_timezone_valid(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_timezone_valid(text) TO authenticated, service_role;
COMMENT ON FUNCTION public.ops_timezone_valid(text) IS
  'Issue #4580. True when p_tz is a pg_timezone_names name: the cached table first, then the catalog itself.';

-- B3. From its latest definition (#4423); only the tz check changes. #4580.
CREATE OR REPLACE FUNCTION public.ops_work_list(p_query jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v record; q jsonb := CASE WHEN jsonb_typeof(p_query) = 'object' THEN p_query ELSE '{}'::jsonb END; v_bad text;
  v_today date; v_status text[]; v_who text := 'all'; v_owner text; v_event uuid; v_expected uuid; v_record uuid; v_week date;
  v_q text; v_like text; v_done_days integer := 7; v_limit integer := 200; v_cards jsonb; v_total integer; v_counts jsonb; v_ids uuid[];
  v_closed_since timestamptz; v_closed_until timestamptz; v_offset integer := 0;
  -- #4270 rework: a page per column, and one meaning of "this week".
  v_per_status boolean := false; v_tz text := 'UTC'; v_done_default boolean := true; v_week_start timestamptz;
  v_sts text[]; v_rns integer[]; v_pick uuid[]; v_columns jsonb; v_cut boolean;
  -- #4255: subtasks, custom columns, goals and the backlog.
  v_subtasks boolean := false; v_parent uuid; v_status_ids uuid[]; v_goal uuid; v_backlog boolean; v_sids uuid[]; v_status_columns jsonb;
  -- #4423 W2.2: the card shape. full (the default) is ops_card_json per card; board is the Admin list subset.
  v_shape text := 'full';
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  SELECT k INTO v_bad FROM jsonb_object_keys(q) k
   WHERE k NOT IN ('status','who','owner','event_id','expected_id','record_id','week','q','done_days','today','limit',
                   'closed_since','closed_until','offset','per_status','tz','subtasks','parent_id','status_id','goal_id','backlog','shape') ORDER BY k LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '%', format('invalid_query: The board cannot filter by "%s". It takes status, who, owner, event_id, expected_id, record_id, week, q, done_days, closed_since, closed_until, today, limit, offset, per_status, tz, subtasks, parent_id, status_id, goal_id, backlog and shape.', left(v_bad, 40)) USING ERRCODE = '22023';
  END IF;
  -- #4423 W2.2: shape is full or board. Any other value names shape, so a client
  -- can fall back to no shape.
  IF q ? 'shape' AND jsonb_typeof(q->'shape') <> 'null' THEN
    IF jsonb_typeof(q->'shape') <> 'string' OR q->>'shape' NOT IN ('full', 'board') THEN
      RAISE EXCEPTION 'invalid_query: The board takes shape full or board.' USING ERRCODE = '22023';
    END IF;
    v_shape := q->>'shape';
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
      v_done_default := false;
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
    -- #4270 rework (P2-1): per_status puts the limit on each column, so a
    -- long To do never pushes In progress or Done off the page.
    IF q ? 'per_status' AND jsonb_typeof(q->'per_status') <> 'null' THEN
      IF jsonb_typeof(q->'per_status') <> 'boolean' THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22023'; END IF;
      v_per_status := (q->>'per_status')::boolean;
      IF v_per_status AND v_offset > 0 THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22023'; END IF;
    END IF;
    -- #4270 rework (P3-3): the viewer's time zone. Done "this week" starts
    -- at 00:00 on the Monday of the sprint (the Monday of today) there. An
    -- unknown zone counts as UTC, so a browser with a newer zone name still
    -- loads the board.
    IF q ? 'tz' AND jsonb_typeof(q->'tz') <> 'null' THEN
      IF jsonb_typeof(q->'tz') <> 'string' OR char_length(q->>'tz') > 64 THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22023'; END IF;
      -- #4580: the cached zone check (the same answer as the catalog lookup).
      IF public.ops_timezone_valid(q->>'tz') THEN v_tz := q->>'tz'; END IF;
    END IF;
    -- #4255: subtasks (top-level cards only unless asked), one card's
    -- subtasks, columns, a goal and the backlog.
    IF q ? 'subtasks' AND jsonb_typeof(q->'subtasks') <> 'null' THEN
      IF jsonb_typeof(q->'subtasks') <> 'boolean' THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22023'; END IF;
      v_subtasks := (q->>'subtasks')::boolean;
    END IF;
    IF jsonb_typeof(q->'parent_id') = 'string' THEN v_parent := (q->>'parent_id')::uuid; END IF;
    IF q ? 'status_id' AND jsonb_typeof(q->'status_id') <> 'null' THEN
      IF jsonb_typeof(q->'status_id') <> 'array' OR jsonb_array_length(q->'status_id') > 50 THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22023'; END IF;
      v_status_ids := ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(q->'status_id') x);
    END IF;
    IF jsonb_typeof(q->'goal_id') = 'string' THEN v_goal := (q->>'goal_id')::uuid; END IF;
    IF q ? 'backlog' AND jsonb_typeof(q->'backlog') <> 'null' THEN
      IF jsonb_typeof(q->'backlog') <> 'boolean' THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22023'; END IF;
      v_backlog := (q->>'backlog')::boolean;
    END IF;
  EXCEPTION WHEN invalid_parameter_value OR invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'invalid_query: A filter has the wrong shape. Use status (todo, doing, done; person lists open cards with a Send, Spend or Publish tag), who (all, mine, watching), ids from Mingla, a week date, up to 160 characters of search, done_days 0 to 60, closed_since before closed_until, limit 1 to 300, offset 0 to 100000 (not with per_status), per_status true or false and tz as a time zone name.' USING ERRCODE = '22023';
  END;
  -- Done with no window given: closed since Monday 00:00 of this sprint, in tz.
  v_week_start := (public.ops_monday(v_today)::timestamp AT TIME ZONE v_tz);

  WITH base AS (
    SELECT w.id, w.status, w.due_on, w.number, w.person_reason, w.closed_at, w.status_id FROM public.ops_work_cards w
     WHERE w.archived_at IS NULL
       AND (CASE WHEN v_parent IS NOT NULL THEN w.parent_id = v_parent ELSE v_subtasks OR w.parent_id IS NULL END)  -- #4255
       AND (v_goal IS NULL OR w.goal_id = v_goal)
       AND (v_backlog IS NULL OR w.in_backlog = v_backlog)
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
                     WHEN v_done_default THEN w.closed_at >= v_week_start
                     ELSE w.closed_at >= now() - make_interval(days => v_done_days) END))),
  picked AS (
    -- #4255: the board's own column order, then each card's place in its column.
    SELECT b.id, b.status, b.status_id, (SELECT s.position FROM public.ops_work_statuses s WHERE s.id = b.status_id) AS col,
           row_number() OVER (PARTITION BY b.status_id
                              ORDER BY CASE WHEN b.status <> 'done' THEN b.due_on END ASC,
                                       CASE WHEN b.status = 'done' THEN b.due_on END DESC,
                                       CASE WHEN b.status = 'done' THEN b.closed_at END DESC, b.number)::integer AS rn
      FROM base b
     WHERE (v_status IS NULL OR b.status = ANY (v_status)
            OR ('person' = ANY (v_status) AND b.status <> 'done' AND b.person_reason IS NOT NULL))
       AND (v_status_ids IS NULL OR b.status_id = ANY (v_status_ids)))
  -- #4270: three columns. Open cards earliest due first (late on top); Done
  -- latest due first. "person" in a filter means open cards with a tag; the
  -- person count stays (= tagged) for one release so older agents still read it.
  SELECT jsonb_build_object('todo', count(*) FILTER (WHERE b.status = 'todo'), 'doing', count(*) FILTER (WHERE b.status = 'doing'),
                            'done', count(*) FILTER (WHERE b.status = 'done'),
                            'tagged', count(*) FILTER (WHERE b.status <> 'done' AND b.person_reason IS NOT NULL),
                            'person', count(*) FILTER (WHERE b.status <> 'done' AND b.person_reason IS NOT NULL),
                            'due_today', count(*) FILTER (WHERE b.status <> 'done' AND b.due_on = v_today),
                            'overdue', count(*) FILTER (WHERE b.status <> 'done' AND b.due_on < v_today)),
         (SELECT count(*) FROM picked),
         (SELECT array_agg(p.id ORDER BY p.col, p.status_id, p.rn) FROM picked p),
         (SELECT array_agg(p.status ORDER BY p.col, p.status_id, p.rn) FROM picked p),
         (SELECT array_agg(p.rn ORDER BY p.col, p.status_id, p.rn) FROM picked p),
         (SELECT array_agg(p.status_id ORDER BY p.col, p.status_id, p.rn) FROM picked p)
    INTO v_counts, v_total, v_ids, v_sts, v_rns, v_sids
    FROM base b;
  -- (picked is the filtered list with each card's place in its own column.)
  IF v_per_status THEN
    v_pick := ARRAY(SELECT u.id FROM unnest(COALESCE(v_ids, ARRAY[]::uuid[]), COALESCE(v_rns, ARRAY[]::integer[])) WITH ORDINALITY u(id, rn, ord)
                     WHERE u.rn <= v_limit ORDER BY u.ord);
  ELSE
    v_pick := COALESCE(v_ids[v_offset + 1:v_offset + v_limit], ARRAY[]::uuid[]);
  END IF;
  -- Each column: how many cards it has in all, how many came back, and
  -- whether it is cut. The board's tabs and headers read these.
  SELECT jsonb_object_agg(k.st, jsonb_build_object('total', COALESCE(t.total, 0), 'shown', COALESCE(t.shown, 0),
                                                   'truncated', COALESCE(t.shown, 0) < COALESCE(t.total, 0)))
    INTO v_columns
    FROM unnest(ARRAY['todo','doing','done']) k(st)
    LEFT JOIN (SELECT u.st, count(*) AS total, count(*) FILTER (WHERE u.id = ANY (v_pick)) AS shown
                 FROM unnest(COALESCE(v_ids, ARRAY[]::uuid[]), COALESCE(v_sts, ARRAY[]::text[])) u(id, st) GROUP BY u.st) t ON t.st = k.st;
  -- #4255: the same for every column of the board.
  SELECT COALESCE(jsonb_object_agg(t.sid, jsonb_build_object('total', t.total, 'shown', t.shown, 'truncated', t.shown < t.total)), '{}'::jsonb)
    INTO v_status_columns
    FROM (SELECT u.sid, count(*) AS total, count(*) FILTER (WHERE u.id = ANY (v_pick)) AS shown
            FROM unnest(COALESCE(v_ids, ARRAY[]::uuid[]), COALESCE(v_sids, ARRAY[]::uuid[])) u(id, sid) GROUP BY u.sid) t;
  v_cut := CASE WHEN v_per_status THEN EXISTS (SELECT 1 FROM jsonb_each(v_columns) e WHERE (e.value->>'truncated')::boolean)
                ELSE v_total > v_offset + v_limit END;
  -- #4423 W2.2: one set-based pass for the whole page (names once per email).
  -- board with a search also carries instructions, which Admin re-filters on.
  v_cards := public.ops_cards_json(v_pick, v_today,
    CASE WHEN v_shape = 'board' AND v_q IS NOT NULL THEN 'board_text' ELSE v_shape END);
  RETURN jsonb_build_object('cards', v_cards, 'total', v_total, 'truncated', v_cut, 'counts', v_counts,
    'columns', v_columns, 'status_columns', v_status_columns, 'subtasks', v_subtasks, 'per_status', v_per_status, 'limit', v_limit,
    'offset', v_offset, 'done_since', CASE WHEN v_done_default AND v_week IS NULL AND v_closed_since IS NULL AND v_closed_until IS NULL THEN v_week_start END,
    'sprint', public.ops_sprint_json(COALESCE(v_week, public.ops_monday(v_today))), 'today', v_today);
END;
$function$;

COMMIT;
