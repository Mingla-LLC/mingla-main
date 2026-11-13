-- #4423 Wave 2 (W2.1, W2.2, W2.4): set-based card builders.
--
-- Why: ops_card_json runs about 25 nested SECURITY DEFINER calls per card,
-- ten of them ops_name (0.47 ms each in production, 13 Nov), so a 200-card
-- Work list cost about 0.9 s. These builders resolve every name ONCE per
-- distinct email for the whole request (ops_names_for) and every per-card
-- count, person list, column, parent, goal and sprint in one grouped pass.
--
-- ops_name, ops_card_json and crm_display_name are NOT changed (W2.1
-- decision): ops_name stays SECURITY DEFINER with a pinned search_path, it is
-- just no longer called per field per row.
--
-- Invariant I-OPS-LIST-NO-PER-ROW-NAME-LOOKUP is declared in
-- __tests__/issue_4423_w2_ops_rpc_parity.implementor.pg17.test.sql.
--
-- All three functions are internal: not executable by anon or authenticated.

BEGIN;

-- One name per distinct email for the whole request: exactly what
-- ops_name(email) returns. ops_name's body reads crm_display_name through a
-- subquery the planner flattens, so each ops_name call runs crm_display_name
-- four times (measured: 53 ops_name calls made 212 crm_display_name calls).
-- Here crm_display_name runs once per distinct email (OFFSET 0 keeps it from
-- being flattened) and ops_name's rule is applied to that one value. The parity
-- test pins ops_names_for(e) = ops_name(e) for every fixture email and for
-- the empty, blank and address-like cases.
CREATE OR REPLACE FUNCTION public.ops_names_for(p_emails text[])
RETURNS TABLE(email text, name text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT d.e, CASE WHEN d.n IS NULL OR btrim(d.n) = '' OR position('@' IN d.n) > 0 THEN 'A teammate' ELSE d.n END
    FROM (SELECT x.e, public.crm_display_name(x.e) AS n
            FROM (SELECT DISTINCT y.e FROM unnest(COALESCE(p_emails, ARRAY[]::text[])) y(e) WHERE y.e IS NOT NULL) x
          OFFSET 0) d
$function$;

COMMENT ON FUNCTION public.ops_names_for(text[]) IS
  '#4423 W2.1: ops_name(email) for each distinct email of a request, with crm_display_name run once per email. Internal.';

REVOKE ALL ON FUNCTION public.ops_names_for(text[]) FROM PUBLIC, anon, authenticated;

-- The cards for p_ids, in p_ids order, as one jsonb array.
--   'full'       : each element is exactly ops_card_json(card, p_today).
--   'board'      : the Admin list subset (W2.2 board contract, see the test).
--   'board_text' : 'board' plus the full instructions text (used when the
--                  list query carries q, because Admin re-filters on
--                  title + instructions only then).
CREATE OR REPLACE FUNCTION public.ops_cards_json(p_ids uuid[], p_today date, p_shape text DEFAULT 'full')
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_names jsonb; v_anon text := public.ops_name(NULL); v_out jsonb;
BEGIN
  IF p_shape IS NULL OR p_shape NOT IN ('full', 'board', 'board_text') THEN
    RAISE EXCEPTION 'invalid_query: shape must be full or board.' USING ERRCODE = '22023';
  END IF;
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Every email any card field names, resolved once.
  SELECT COALESCE(jsonb_object_agg(n.email, n.name), '{}'::jsonb) INTO v_names
    FROM public.ops_names_for(ARRAY(
      SELECT e.x FROM public.ops_work_cards w
       CROSS JOIN LATERAL unnest(ARRAY[w.closed_by, w.working_by, w.override_by, w.created_by,
                                       w.review_requested_by, w.sent_back_by, w.confirmed_by]) e(x)
       WHERE w.id = ANY (p_ids) AND e.x IS NOT NULL
      UNION
      SELECT p.email FROM public.ops_work_people p WHERE p.card_id = ANY (p_ids))) n;

  WITH ids AS (
    SELECT u.id, min(u.ord) AS ord FROM unnest(p_ids) WITH ORDINALITY u(id, ord) GROUP BY u.id
  ), ppl AS (
    SELECT p.card_id,
           jsonb_agg(jsonb_build_object('email', p.email, 'name', v_names->>p.email) ORDER BY p.added_at, p.email)
             FILTER (WHERE p.role = 'owner') AS owners,
           jsonb_agg(jsonb_build_object('email', p.email, 'name', v_names->>p.email) ORDER BY p.added_at, p.email)
             FILTER (WHERE p.role = 'watcher') AS watchers,
           min(p.email) FILTER (WHERE p.role = 'watcher') AS first_watcher
      FROM public.ops_work_people p WHERE p.card_id = ANY (p_ids) GROUP BY p.card_id
  ), lnk AS (
    SELECT l.card_id,
           -- board links carry kind, id and label; only full checks each target still exists.
           jsonb_agg(CASE WHEN p_shape = 'full'
                          THEN jsonb_build_object('kind', l.kind, 'id', l.target_id, 'label', l.label,
                                                  'exists', public.ops_link_label(l.kind, l.target_id) IS NOT NULL)
                          ELSE jsonb_build_object('kind', l.kind, 'id', l.target_id, 'label', l.label) END
                     ORDER BY l.added_at, l.kind, l.target_id) AS links
      FROM public.ops_work_links l WHERE l.card_id = ANY (p_ids) GROUP BY l.card_id
  ), gh AS (
    SELECT g.card_id,
           jsonb_agg(public.ops_github_status(g.number) || jsonb_build_object('kind', g.kind) ORDER BY g.added_at, g.number) AS github
      FROM public.ops_work_github g WHERE g.card_id = ANY (p_ids) AND p_shape = 'full' GROUP BY g.card_id
  ), kids AS (
    SELECT x.parent_id, count(*) AS total, count(*) FILTER (WHERE x.status = 'done') AS done
      FROM public.ops_work_cards x WHERE x.parent_id = ANY (p_ids) AND x.archived_at IS NULL GROUP BY x.parent_id
  ), plan AS (
    -- ops_plan_from_subtasks, for every card at once (full only).
    SELECT y.parent_id,
           jsonb_agg(jsonb_build_object(
             'n', y.rn,
             'text', left(y.title, 200),
             'tool', COALESCE(NULLIF(y.plan_step->>'tool', ''), 'person'),
             'status', CASE WHEN y.status = 'done' THEN 'done'
                            WHEN y.plan_step->>'status' IN ('failed', 'person') THEN y.plan_step->>'status'
                            ELSE 'todo' END,
             'result', CASE WHEN jsonb_typeof(y.plan_step->'result') = 'string' THEN y.plan_step->'result' END,
             'checked_at', CASE WHEN jsonb_typeof(y.plan_step->'checked_at') = 'string' THEN y.plan_step->'checked_at' END)
             ORDER BY y.rn) AS plan
      FROM (SELECT x.parent_id, x.title, x.status, x.plan_step,
                   row_number() OVER (PARTITION BY x.parent_id ORDER BY x.position, x.number)::integer AS rn
              FROM public.ops_work_cards x
             WHERE x.parent_id = ANY (p_ids) AND x.archived_at IS NULL AND p_shape = 'full') y
     WHERE y.rn <= 20
     GROUP BY y.parent_id
  ), files AS (
    SELECT f.card_id, count(*) AS n
      FROM public.ops_work_files f
     WHERE f.card_id = ANY (p_ids) AND f.archived_at IS NULL
       AND (f.kind = 'link'
            OR (f.storage_path IS NOT NULL
                AND EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'ops-work-files' AND o.name = f.storage_path)))
     GROUP BY f.card_id
  ), msgs AS (
    SELECT m.card_id, count(*) AS n
      FROM public.ops_work_messages m WHERE m.card_id = ANY (p_ids) AND m.deleted_at IS NULL GROUP BY m.card_id
  ), base AS (
    SELECT i.ord, c.id, c.number, c.title, c.instructions, c.done_means, c.status, c.blocked, c.blocked_kind, c.blocked_reason,
           c.person_reason, c.files_url, c.on_brand_plan, c.brand_plan_source, c.kind, c.kit_step, c.anchor_kind, c.anchor_id,
           c.due_on, c.due_source, c.carried_count, c.plan AS card_plan, c.result, c.proof, c.close_kind, c.close_reason,
           c.closed_at, c.closed_by, c.closed_via, c.started_at, c.working_by, c.working_via, c.working_chat, c.working_seen_at,
           c.override_at, c.override_by, c.override_reason, c.created_by, c.created_via, c.created_at, c.updated_at, c.revision,
           c.auto_key, c.archived_at, c.status_id, c.parent_id, c.depth, c.position, c.start_on, c.estimate_minutes,
           c.description_md, c.plan_step, c.goal_id, c.in_backlog, c.review_requested_at, c.review_requested_by,
           c.review_requested_via, c.review_kind, c.review_reason, c.sent_back_at, c.sent_back_by, c.sent_back_reason,
           c.confirmed_by, c.confirmed_at,
           sp.id AS sp_id, sp.starts_on AS sp_starts_on, sp.ends_on AS sp_ends_on, sp.goal AS sp_goal,
           st.id AS st_id, st.name AS st_name, st.color AS st_color, st.grp AS st_grp,
           pc.id AS pc_id, pc.number AS pc_number, pc.title AS pc_title, pc.parent_id AS pc_parent_id,
           gl.id AS gl_id, gl.title AS gl_title, gl.state AS gl_state,
           pp.owners, pp.watchers, pp.first_watcher, lk.links, gh.github, k.total AS kids_total, k.done AS kids_done,
           pl.plan AS kids_plan, fl.n AS files_n, ms.n AS msgs_n,
           CASE WHEN c.working_via IS NOT NULL AND c.working_by IS NOT NULL AND c.status <> 'done' THEN
             CASE WHEN c.working_chat IS NULL OR c.working_chat = 'default' THEN NULL
                  ELSE COALESCE(ac.label, 'chat ' || left(c.working_chat, 4)) END END AS chat_label
      FROM ids i
      JOIN public.ops_work_cards c ON c.id = i.id
      LEFT JOIN public.ops_sprints sp ON sp.id = c.sprint_id
      LEFT JOIN public.ops_work_statuses st ON st.id = c.status_id
      LEFT JOIN public.ops_work_cards pc ON pc.id = c.parent_id
      LEFT JOIN public.ops_sprint_goals gl ON gl.id = c.goal_id AND gl.archived_at IS NULL
      LEFT JOIN public.ops_agent_chats ac ON ac.owner_email = c.working_by AND ac.via = c.working_via AND ac.chat_key = c.working_chat
      LEFT JOIN ppl pp ON pp.card_id = c.id
      LEFT JOIN lnk lk ON lk.card_id = c.id
      LEFT JOIN gh ON gh.card_id = c.id
      LEFT JOIN kids k ON k.parent_id = c.id
      LEFT JOIN plan pl ON pl.parent_id = c.id
      LEFT JOIN files fl ON fl.card_id = c.id
      LEFT JOIN msgs ms ON ms.card_id = c.id
  ), parts AS (
    SELECT b.*,
           -- ops_working_json, with names from the map.
           CASE WHEN b.working_via IS NOT NULL AND b.working_by IS NOT NULL AND b.status <> 'done' THEN
             jsonb_build_object(
               'name', (v_names->>b.working_by)
                       || CASE b.working_via WHEN 'claude' THEN '''s Claude' WHEN 'codex' THEN '''s Codex'
                                                    WHEN 'system' THEN ' (Mingla)' ELSE '' END
                       || CASE WHEN b.working_via IN ('claude', 'codex') AND b.chat_label IS NOT NULL
                               THEN ' (' || b.chat_label || ')' ELSE '' END,
               'person_name', v_names->>b.working_by, 'via', b.working_via,
               'chat_label', b.chat_label,
               'since', COALESCE(b.started_at, b.working_seen_at),
               'last_update_at', COALESCE(b.working_seen_at, b.started_at),
               'quiet', COALESCE(b.working_seen_at, b.started_at) < clock_timestamp() - interval '24 hours',
               'stuck', COALESCE(b.working_seen_at, b.started_at) < clock_timestamp() - interval '7 days') END AS working,
           CASE WHEN b.anchor_id IS NOT NULL THEN public.ops_card_anchor(b.anchor_kind, b.anchor_id, p_today) END AS anchor,
           CASE WHEN b.auto_key ~ '^eng_release:pr-[0-9]+$'
                THEN public.ops_release_items(substring(b.auto_key FROM ':pr-([0-9]+)$')::integer) END AS release_items
      FROM base b
  ), j AS (
    SELECT p.ord,
      -- The fields both shapes carry, with the values ops_card_json gives them.
      jsonb_build_object(
        'id', p.id, 'number', p.number, 'title', p.title, 'status', p.status,
        'blocked', p.blocked, 'blocked_kind', p.blocked_kind,
        'person_reason', p.person_reason, 'tag', p.person_reason,
        'anchor', p.anchor,
        'due_on', p.due_on, 'overdue', (p.due_on < p_today AND p.status <> 'done'),
        'carried_count', p.carried_count,
        'owners', COALESCE(p.owners, '[]'::jsonb), 'watchers', COALESCE(p.watchers, '[]'::jsonb),
        'links', COALESCE(p.links, '[]'::jsonb),
        'proof', p.proof, 'closed_at', p.closed_at,
        'working', p.working,
        'revision', p.revision,
        'claim', CASE WHEN p.working IS NOT NULL AND NOT (p.working->>'quiet')::boolean THEN jsonb_build_object(
          'holder_name', v_names->>p.working_by, 'holder_via', p.working_via,
          'holder_chat_label', p.working->'chat_label', 'since', p.working->'since',
          'ends_at', COALESCE(p.working_seen_at, p.started_at) + interval '24 hours') END,
        'auto', p.auto_key IS NOT NULL,
        'auto_kind', CASE WHEN p.auto_key IS NOT NULL THEN split_part(p.auto_key, ':', 1) END,
        'archived', p.archived_at IS NOT NULL)
      || jsonb_build_object(
        'status_id', p.status_id,
        'parent', CASE WHEN p.parent_id IS NOT NULL AND p.pc_id IS NOT NULL THEN
                    jsonb_build_object('id', p.pc_id, 'number', p.pc_number, 'title', p.pc_title,
                                       'parent_id', p.pc_parent_id) END,
        'depth', p.depth, 'position', p.position, 'start_on', p.start_on,
        'estimate_minutes', p.estimate_minutes,
        'subtasks', jsonb_build_object('total', COALESCE(p.kids_total, 0), 'done', COALESCE(p.kids_done, 0)),
        'files_count', COALESCE(p.files_n, 0), 'thread_count', COALESCE(p.msgs_n, 0),
        'goal', CASE WHEN p.goal_id IS NOT NULL AND p.gl_id IS NOT NULL THEN
                  jsonb_build_object('id', p.gl_id, 'title', p.gl_title, 'state', p.gl_state) END,
        'in_backlog', p.in_backlog,
        'review', CASE WHEN p.review_requested_at IS NOT NULL THEN jsonb_build_object(
            'requested_at', p.review_requested_at, 'requested_by_name', v_names->>p.review_requested_by,
            'requested_via', p.review_requested_via, 'kind', p.review_kind, 'reason', p.review_reason,
            'waiting_on', CASE WHEN p.first_watcher IS NULL THEN v_anon ELSE v_names->>p.first_watcher END) END,
        'sent_back', CASE WHEN p.sent_back_at IS NOT NULL THEN jsonb_build_object('reason', p.sent_back_reason,
            'by_name', v_names->>p.sent_back_by, 'at', p.sent_back_at) END,
        'release_items', p.release_items) AS common,
      -- The fields only 'full' carries.
      CASE WHEN p_shape = 'full' THEN
        jsonb_build_object(
          'sprint', jsonb_build_object('id', p.sp_id, 'starts_on', p.sp_starts_on,
                                       'ends_on', p.sp_ends_on, 'goal', p.sp_goal),
          'column', CASE WHEN p.st_id IS NOT NULL THEN jsonb_build_object('id', p.st_id, 'name', p.st_name,
                                                                          'color', p.st_color, 'grp', p.st_grp) END,
          'updated_at', p.updated_at,
          'instructions', p.instructions, 'done_means', p.done_means,
          'blocked_reason', p.blocked_reason, 'files_url', p.files_url,
          'on_brand_plan', p.on_brand_plan, 'brand_plan_source', p.brand_plan_source,
          'kind', p.kind, 'kit_step', p.kit_step, 'due_source', p.due_source,
          'github', COALESCE(p.github, '[]'::jsonb),
          'plan', COALESCE(p.kids_plan, p.card_plan, '[]'::jsonb),
          'result', p.result, 'close_kind', p.close_kind, 'close_reason', p.close_reason,
          'closed_by_name', CASE WHEN p.closed_by IS NOT NULL THEN v_names->>p.closed_by END,
          'closed_via', p.closed_via, 'started_at', p.started_at,
          'working_by_name', CASE WHEN p.working_by IS NOT NULL THEN v_names->>p.working_by END,
          'working_via', p.working_via,
          'override', CASE WHEN p.override_at IS NOT NULL THEN jsonb_build_object('reason', p.override_reason,
                         'by_name', CASE WHEN p.override_by IS NULL THEN v_anon ELSE v_names->>p.override_by END,
                         'at', p.override_at) END,
          'created_by_name', v_names->>p.created_by, 'created_via', p.created_via, 'created_at', p.created_at,
          'description', p.description_md, 'plan_step', p.plan_step,
          'confirmed_by_name', CASE WHEN p.confirmed_by IS NOT NULL THEN v_names->>p.confirmed_by END,
          'confirmed_at', p.confirmed_at)
      WHEN p_shape = 'board_text' THEN jsonb_build_object('instructions', p.instructions)
      ELSE '{}'::jsonb END AS extra
      FROM parts p
  )
  SELECT COALESCE(jsonb_agg(j.common || j.extra ORDER BY j.ord), '[]'::jsonb) INTO v_out FROM j;
  RETURN v_out;
END;
$function$;

COMMENT ON FUNCTION public.ops_cards_json(uuid[], date, text) IS
  '#4423 W2.2: the cards for p_ids in p_ids order. full = exactly ops_card_json per card; board / board_text = the Admin list subset. Internal.';

REVOKE ALL ON FUNCTION public.ops_cards_json(uuid[], date, text) FROM PUBLIC, anon, authenticated;

-- The plan cards for p_ids, in p_ids order: exactly ops_plan_card_json per
-- card, with owners and subtask totals resolved for the whole set.
CREATE OR REPLACE FUNCTION public.ops_plan_cards_json(p_ids uuid[], p_baseline jsonb, p_planned boolean)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE v_names jsonb; v_base text[]; v_out jsonb;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;
  SELECT COALESCE(jsonb_object_agg(n.email, n.name), '{}'::jsonb) INTO v_names
    FROM public.ops_names_for(ARRAY(SELECT p.email FROM public.ops_work_people p WHERE p.card_id = ANY (p_ids) AND p.role = 'owner')) n;
  v_base := ARRAY(SELECT b->>'id' FROM jsonb_array_elements(COALESCE(p_baseline, '[]'::jsonb)) b WHERE b->>'id' IS NOT NULL);

  WITH ids AS (
    SELECT u.id, min(u.ord) AS ord FROM unnest(p_ids) WITH ORDINALITY u(id, ord) GROUP BY u.id
  ), own AS (
    SELECT p.card_id, jsonb_agg(jsonb_build_object('email', p.email, 'name', v_names->>p.email) ORDER BY p.added_at, p.email) AS owners
      FROM public.ops_work_people p WHERE p.card_id = ANY (p_ids) AND p.role = 'owner' GROUP BY p.card_id
  ), kids AS (
    SELECT x.parent_id, count(*) AS total, count(*) FILTER (WHERE x.status = 'done') AS done,
           COALESCE(sum(x.estimate_minutes), 0) AS minutes
      FROM public.ops_work_cards x WHERE x.parent_id = ANY (p_ids) AND x.archived_at IS NULL GROUP BY x.parent_id
  )
  SELECT COALESCE(jsonb_agg(
           -- ops_card_lite(w), field for field.
           jsonb_build_object('id', w.id, 'number', w.number, 'title', w.title, 'status', w.status, 'blocked', w.blocked,
             'blocked_reason', w.blocked_reason, 'person_reason', w.person_reason, 'tag', w.person_reason, 'files_url', w.files_url,
             'on_brand_plan', w.on_brand_plan, 'brand_plan_source', w.brand_plan_source, 'kind', w.kind, 'kit_step', w.kit_step,
             'due_on', w.due_on, 'close_kind', w.close_kind, 'anchor_kind', w.anchor_kind, 'anchor_id', w.anchor_id)
           || jsonb_build_object('status_id', w.status_id, 'parent_id', w.parent_id, 'depth', w.depth, 'position', w.position,
                                 'estimate_minutes', w.estimate_minutes, 'goal_id', w.goal_id)
           || jsonb_build_object(
             'owners', COALESCE(o.owners, '[]'::jsonb),
             'revision', w.revision, 'carried_count', w.carried_count, 'in_backlog', w.in_backlog, 'sprint_id', w.sprint_id,
             'added_mid_sprint', p_planned AND NOT (w.id::text = ANY (v_base)),
             'subtasks', jsonb_build_object('total', COALESCE(k.total, 0), 'done', COALESCE(k.done, 0), 'minutes', COALESCE(k.minutes, 0)))
           ORDER BY i.ord), '[]'::jsonb) INTO v_out
    FROM ids i
    JOIN public.ops_work_cards w ON w.id = i.id
    LEFT JOIN own o ON o.card_id = w.id
    LEFT JOIN kids k ON k.parent_id = w.id;
  RETURN v_out;
END;
$function$;

COMMENT ON FUNCTION public.ops_plan_cards_json(uuid[], jsonb, boolean) IS
  '#4423 W2.4: exactly ops_plan_card_json per card for p_ids, in p_ids order, resolved set-based. Internal.';

REVOKE ALL ON FUNCTION public.ops_plan_cards_json(uuid[], jsonb, boolean) FROM PUBLIC, anon, authenticated;

COMMIT;
