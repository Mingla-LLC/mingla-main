-- #4423 Wave 2 (W2.2, W2.3): the Work list, the review queue and My counts
-- build their cards set-based.
--
-- ops_work_list: one additive key, shape ("full", the default, or "board").
--   No shape returns today's response; every card is built by
--   ops_cards_json(ids, today, 'full'), which equals ops_card_json per card
--   (proved by __tests__/issue_4423_w2_ops_rpc_parity.implementor.pg17.test.sql).
--   shape "board" returns the Admin list subset. Any other shape value is
--   refused 22023 with a message that names shape, so a client can fall back
--   to no shape. Filters, counts, columns, status_columns and truncation are
--   unchanged, and BOARD_LIMIT stays 300 (decision D3).
-- ops_review_list: the same response; cards through ops_cards_json.
-- ops_my_counts: the same keys and values, counted directly; no card JSON.
--
-- Rollback: re-apply the bodies from 20280624014255_issue_4255_work_v2_functions.sql
-- (ops_work_list) and 20280427004270_issue_4270_w1_work_board_three_columns.sql
-- (ops_review_list, ops_my_counts).

BEGIN;

-- ops_work_list: shape, and one set-based pass for the page's cards.
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
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = q->>'tz') THEN v_tz := q->>'tz'; END IF;
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

-- ops_review_list: the same response, with every card built by one
-- set-based pass (ops_cards_json 'full') instead of ops_card_json per row.
CREATE OR REPLACE FUNCTION public.ops_review_list(p_today date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v record; v_today date := public.ops_today(p_today); v_admin boolean := public.is_admin_user();
        v_ids uuid[]; v_need_ids uuid[]; v_wording_ids uuid[]; v_counts jsonb; v_cards jsonb; v_need jsonb; v_wording jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  SELECT COALESCE(array_agg(w.id ORDER BY array_position(ARRAY['spend','publish','other'], w.person_reason), w.due_on, w.number), ARRAY[]::uuid[]),
         jsonb_build_object('spend', count(*) FILTER (WHERE w.person_reason = 'spend'),
                            'publish', count(*) FILTER (WHERE w.person_reason = 'publish'),
                            'other', count(*) FILTER (WHERE w.person_reason = 'other'))
    INTO v_ids, v_counts
    FROM public.ops_work_cards w
   WHERE w.archived_at IS NULL AND w.status <> 'done' AND w.person_reason IN ('spend','publish','other')
     AND (v_admin OR EXISTS (SELECT 1 FROM public.ops_work_people p WHERE p.card_id = w.id AND p.email = v.actor_email));
  SELECT COALESCE(array_agg(w.id ORDER BY w.due_on, w.number), ARRAY[]::uuid[]) INTO v_need_ids
    FROM public.ops_work_cards w
   WHERE w.archived_at IS NULL AND w.status <> 'done' AND w.person_reason = 'send'
     AND NOT public.ops_send_draft_waiting(w.id, w.proof)
     AND (v_admin OR EXISTS (SELECT 1 FROM public.ops_work_people p WHERE p.card_id = w.id AND p.email = v.actor_email));
  -- What hosts are told: only the owner and admins see and decide it.
  SELECT COALESCE(array_agg(w.id ORDER BY w.due_on, w.number), ARRAY[]::uuid[]) INTO v_wording_ids
    FROM public.ops_work_cards w
   WHERE v_admin AND v.via IS NULL AND w.archived_at IS NULL AND w.status <> 'done' AND w.auto_key LIKE 'roadmap\_shipped:%';
  v_cards := public.ops_cards_json(v_ids, v_today, 'full');
  v_need := public.ops_cards_json(v_need_ids, v_today, 'full');
  SELECT COALESCE(jsonb_agg(e.card || jsonb_build_object('roadmap', (
           SELECT jsonb_build_object('id', rc.id, 'public_title', rc.public_title, 'public_body', rc.public_body,
                                     'internal_note', rc.internal_note, 'lane', rc.lane, 'status', rc.status)
             FROM public.community_roadmap_cards rc
            WHERE rc.id = public.ops_roadmap_shipped_draft(w.auto_key)))
           ORDER BY e.ord), '[]'::jsonb) INTO v_wording
    FROM jsonb_array_elements(public.ops_cards_json(v_wording_ids, v_today, 'full')) WITH ORDINALITY e(card, ord)
    JOIN unnest(v_wording_ids) WITH ORDINALITY u(id, ord) ON u.ord = e.ord
    JOIN public.ops_work_cards w ON w.id = u.id;
  RETURN jsonb_build_object('cards', v_cards, 'counts', v_counts)
    || jsonb_build_object('draft_needed', v_need, 'wording', v_wording,
    'counts', v_counts || jsonb_build_object('draft_needed', jsonb_array_length(v_need), 'wording', jsonb_array_length(v_wording)));
END;
$function$;

-- ops_my_counts: the same keys and values, counted directly with
-- ops_review_list's predicates. It builds no card JSON.
CREATE OR REPLACE FUNCTION public.ops_my_counts(p_today date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v record; v_today date := public.ops_today(p_today); v_admin boolean := public.is_admin_user();
        v_wording bigint; v_need_person bigint; v_draft bigint;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  -- ops_review_list's wording list.
  SELECT count(*) INTO v_wording
    FROM public.ops_work_cards w
   WHERE v_admin AND v.via IS NULL AND w.archived_at IS NULL AND w.status <> 'done' AND w.auto_key LIKE 'roadmap\_shipped:%';
  -- ops_review_list's cards (Spend, Publish, Other). A wording card is listed
  -- under Spend or publish and on What hosts are told; it is counted once, as wording.
  SELECT count(*) FILTER (WHERE w.auto_key IS NULL OR split_part(w.auto_key, ':', 1) IS DISTINCT FROM 'roadmap_shipped' OR v_wording = 0)
    INTO v_need_person
    FROM public.ops_work_cards w
   WHERE w.archived_at IS NULL AND w.status <> 'done' AND w.person_reason IN ('spend','publish','other')
     AND (v_admin OR EXISTS (SELECT 1 FROM public.ops_work_people p WHERE p.card_id = w.id AND p.email = v.actor_email));
  -- ops_review_list's draft_needed list.
  SELECT count(*) INTO v_draft
    FROM public.ops_work_cards w
   WHERE w.archived_at IS NULL AND w.status <> 'done' AND w.person_reason = 'send'
     AND NOT public.ops_send_draft_waiting(w.id, w.proof)
     AND (v_admin OR EXISTS (SELECT 1 FROM public.ops_work_people p WHERE p.card_id = w.id AND p.email = v.actor_email));
  RETURN (SELECT jsonb_build_object(
    'open_mine', count(*) FILTER (WHERE w.status <> 'done' AND p.role = 'owner'),
    -- #4270: the tag replaces the status; waiting_on_person_mine stays (= needs_ok_mine) for agents.
    'waiting_on_person_mine', count(*) FILTER (WHERE w.status <> 'done' AND w.person_reason IS NOT NULL AND p.role = 'owner'),
    'needs_ok_mine', count(*) FILTER (WHERE w.status <> 'done' AND w.person_reason IS NOT NULL AND p.role = 'owner'),
    'due_today_mine', count(*) FILTER (WHERE w.status <> 'done' AND p.role = 'owner' AND w.due_on = v_today),
    'needs_person_mine', v_need_person,
    'draft_needed_mine', v_draft,
    'wording_mine', v_wording,
    'overdue_mine', count(*) FILTER (WHERE w.status <> 'done' AND p.role = 'owner' AND w.due_on < v_today),
    'watching_open', count(*) FILTER (WHERE w.status <> 'done' AND p.role = 'watcher'))
    FROM public.ops_work_cards w JOIN public.ops_work_people p ON p.card_id = w.id AND p.email = v.actor_email
   WHERE w.archived_at IS NULL);
END;
$function$;

COMMIT;
