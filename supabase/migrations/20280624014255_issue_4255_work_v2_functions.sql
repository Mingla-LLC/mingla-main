-- Issue #4255, Work board v2, wave W1a (part 2 of 2): the functions. The
-- tables, guards and backfills are in 20280624004255_issue_4255_work_v2_schema.sql.
--
-- New (SECURITY DEFINER, team access through crm_ctx(), PT409 on a stale
-- revision, never 40001):
--   columns   ops_status_list / add / update / move / archive (writes: full
--             admins in person), ops_work_move (runs the close-with-proof
--             rules when the column is Closed, the reopen rules out of it)
--   subtasks  ops_subtask_add, ops_subtask_reorder, ops_plan_sync,
--             ops_plan_from_subtasks
--   files     ops_file_add / archive / sign
--   thread    ops_message_list / post / edit / delete / react
--   sprint    ops_sprint_plan_get, ops_sprint_goal_add / update / archive,
--             ops_sprint_capacity_set, ops_sprint_start,
--             ops_sprint_review_note_set
-- Replaced (bodies copied from their latest definitions; only the lines
-- marked #4255 change; same signatures, so owners and grants stay):
--   ops_card_json, ops_card_lite, ops_sprint_json, ops_validate_card,
--   ops_field_words, ops_work_update, ops_work_add, ops_auto_card_upsert,
--   ops_work_list, ops_work_get, ops_work_undo, ops_config, ops_agent_call,
--   ops_work_note (a note is a thread message now).
--
-- Agents: add_work takes parent and description; update_work step n marks
-- the n-th subtask; plan steps written by update_work or add_work become
-- subtasks; my_work lists subtasks with their parent; the gateway knows
-- post_message (card threads only) and add_subtask. Agents never change
-- columns, plan sprints or mention everyone.
--
-- Static SQL only (no EXECUTE of built strings). Do not auto-apply; release
-- through the governed migration lane. Enforced by
-- supabase/migrations/__tests__/issue_4255_work_v2.implementor.pg17.test.sql.

BEGIN;

SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. Small readers the rest share.
-- ---------------------------------------------------------------------------

-- The plan an agent reads, built from the card's subtasks (the first 20, in
-- order): n, the step in words, the tool, todo/done/failed/person, result and
-- check time. A card with no subtasks reads its (now always empty) plan.
CREATE FUNCTION public.ops_plan_from_subtasks(p_card_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT jsonb_agg(jsonb_build_object(
              'n', x.rn,
              'text', left(x.title, 200),
              'tool', COALESCE(NULLIF(x.plan_step->>'tool', ''), 'person'),
              'status', CASE WHEN x.status = 'done' THEN 'done'
                             WHEN x.plan_step->>'status' IN ('failed', 'person') THEN x.plan_step->>'status'
                             ELSE 'todo' END,
              'result', CASE WHEN jsonb_typeof(x.plan_step->'result') = 'string' THEN x.plan_step->'result' END,
              'checked_at', CASE WHEN jsonb_typeof(x.plan_step->'checked_at') = 'string' THEN x.plan_step->'checked_at' END)
            ORDER BY x.rn)
       FROM (SELECT c.title, c.status, c.plan_step, row_number() OVER (ORDER BY c.position, c.number)::integer AS rn
               FROM public.ops_work_cards c WHERE c.parent_id = p_card_id AND c.archived_at IS NULL) x
      WHERE x.rn <= 20),
    (SELECT w.plan FROM public.ops_work_cards w WHERE w.id = p_card_id),
    '[]'::jsonb)
$$;

-- Whether a stored file has really been uploaded.
CREATE FUNCTION public.ops_file_uploaded(p_path text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_path IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'ops-work-files' AND o.name = p_path);
END;
$$;

CREATE FUNCTION public.ops_file_json(f public.ops_work_files) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT jsonb_build_object('id', f.id, 'card_id', f.card_id, 'message_id', f.message_id, 'kind', f.kind, 'name', f.name,
    'mime', f.mime, 'size_bytes', f.size_bytes, 'url', f.url, 'from_files_url', f.from_files_url,
    'uploaded', f.kind = 'link' OR public.ops_file_uploaded(f.storage_path),
    'added_by_name', public.ops_actor_label(f.added_by, f.added_via), 'added_via', f.added_via, 'added_at', f.added_at)
$$;

-- A card's live files: links, and pictures and documents that finished
-- uploading (the Files section also lists files posted in its thread).
CREATE FUNCTION public.ops_files_json(p_card_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(public.ops_file_json(f) ORDER BY f.added_at, f.id), '[]'::jsonb)
    FROM public.ops_work_files f
   WHERE f.card_id = p_card_id AND f.archived_at IS NULL
     AND (f.kind = 'link' OR public.ops_file_uploaded(f.storage_path))
$$;

-- The breadcrumb from the top-level card down to this card's parent.
CREATE FUNCTION public.ops_card_ancestors(p_card_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  WITH RECURSIVE up AS (
    SELECT p.id, p.number, p.title, p.parent_id, 1 AS hop
      FROM public.ops_work_cards c JOIN public.ops_work_cards p ON p.id = c.parent_id WHERE c.id = p_card_id
    UNION ALL
    SELECT p.id, p.number, p.title, p.parent_id, up.hop + 1
      FROM up JOIN public.ops_work_cards p ON p.id = up.parent_id WHERE up.hop < 3)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', up.id, 'number', up.number, 'title', up.title) ORDER BY up.hop DESC), '[]'::jsonb) FROM up
$$;

-- A card's subtasks for the card panel: each with its owners, due date,
-- status, column and its own subtask count, in order.
CREATE FUNCTION public.ops_subtasks_json(p_card_id uuid, p_today date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(public.ops_card_lite(c) || jsonb_build_object(
      'owners', COALESCE((SELECT jsonb_agg(jsonb_build_object('email', p.email, 'name', public.ops_name(p.email)) ORDER BY p.added_at, p.email)
                            FROM public.ops_work_people p WHERE p.card_id = c.id AND p.role = 'owner'), '[]'::jsonb),
      'revision', c.revision, 'overdue', (c.due_on < p_today AND c.status <> 'done'), 'start_on', c.start_on,
      'plan_step', c.plan_step,
      'subtasks', (SELECT jsonb_build_object('total', count(*), 'done', count(*) FILTER (WHERE g.status = 'done'))
                     FROM public.ops_work_cards g WHERE g.parent_id = c.id AND g.archived_at IS NULL),
      'thread_count', (SELECT count(*) FROM public.ops_work_messages m WHERE m.card_id = c.id AND m.deleted_at IS NULL))
    ORDER BY c.position, c.number), '[]'::jsonb)
    FROM public.ops_work_cards c WHERE c.parent_id = p_card_id AND c.archived_at IS NULL
$$;

CREATE FUNCTION public.ops_status_json(s public.ops_work_statuses) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT jsonb_build_object('id', s.id, 'name', s.name, 'color', s.color, 'grp', s.grp,
    'group_label', CASE s.grp WHEN 'todo' THEN 'Not started' WHEN 'doing' THEN 'Active' ELSE 'Closed' END,
    'position', s.position, 'revision', s.revision, 'archived', s.archived_at IS NOT NULL,
    'cards', (SELECT count(*) FROM public.ops_work_cards w WHERE w.status_id = s.id AND w.archived_at IS NULL AND w.parent_id IS NULL))
$$;

-- The board's columns in order.
CREATE FUNCTION public.ops_status_rows(p_include_archived boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(public.ops_status_json(s) ORDER BY s.archived_at IS NOT NULL, s.position, s.created_at, s.id), '[]'::jsonb)
    FROM public.ops_work_statuses s WHERE p_include_archived OR s.archived_at IS NULL
$$;

-- Live columns numbered 0..n-1 in their current order.
CREATE FUNCTION public.ops_status_renumber() RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  UPDATE public.ops_work_statuses s SET position = x.rn
    FROM (SELECT t.id, (row_number() OVER (ORDER BY t.position, t.created_at, t.id) - 1)::integer AS rn
            FROM public.ops_work_statuses t WHERE t.archived_at IS NULL) x
   WHERE s.id = x.id AND s.position IS DISTINCT FROM x.rn
$$;

-- Plan steps written to a card become its subtasks, step n onto the n-th
-- subtask: its words (on a subtask made from the plan; a teammate's own
-- subtask keeps its title), its tool, status and result. A done step closes
-- its subtask; a step set back to todo reopens it. A step past the last
-- subtask adds one. A subtask made from the plan that the new plan no longer
-- has, and that is still open, is removed. Returns how many subtasks changed.
CREATE FUNCTION public.ops_plan_sync(p_card_id uuid, p_plan jsonb, p_actor text, p_via text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  p public.ops_work_cards; x public.ops_work_cards; n public.ops_work_cards; v_subs uuid[]; s jsonb; i integer := 0; v_title text; v_step jsonb;
  v_done boolean; v_changed integer := 0; v_owners text[]; v_id uuid; v_before jsonb; v_action text;
  v_via text := CASE WHEN p_via IN ('claude', 'codex', 'system') THEN p_via END;
  v_people_via text := CASE WHEN p_via IN ('claude', 'codex') THEN p_via END;
BEGIN
  IF p_plan IS NULL OR jsonb_typeof(p_plan) <> 'array' THEN RETURN 0; END IF;
  SELECT * INTO p FROM public.ops_work_cards w WHERE w.id = p_card_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  v_subs := ARRAY(SELECT c.id FROM public.ops_work_cards c WHERE c.parent_id = p_card_id AND c.archived_at IS NULL ORDER BY c.position, c.number);
  FOR s IN SELECT e FROM jsonb_array_elements(p_plan) e ORDER BY (e->>'n')::integer LOOP
    i := i + 1;
    v_title := btrim(left(COALESCE(public.ops_one_line(s->>'text'), ''), 160));
    IF char_length(v_title) < 3 OR public.crm_name_key(v_title) = '' THEN v_title := format('Step %s', i); END IF;
    v_step := jsonb_build_object('tool', COALESCE(NULLIF(s->>'tool', ''), 'person'), 'status', COALESCE(s->>'status', 'todo'),
                                 'result', s->'result', 'checked_at', s->'checked_at');
    v_done := COALESCE(s->>'status', 'todo') = 'done';
    IF i <= cardinality(v_subs) THEN
      SELECT * INTO x FROM public.ops_work_cards w WHERE w.id = v_subs[i] FOR UPDATE;
      IF x.plan_step IS NULL THEN v_title := x.title; END IF;
      CONTINUE WHEN x.title IS NOT DISTINCT FROM v_title AND x.plan_step IS NOT DISTINCT FROM v_step AND (x.status = 'done') = v_done;
      v_before := public.ops_card_snapshot(x.id);
      IF v_done AND x.status <> 'done' THEN
        UPDATE public.ops_work_cards w SET title = v_title, plan_step = v_step, status = 'done', person_reason = NULL,
          blocked = false, blocked_kind = NULL, blocked_reason = NULL, close_kind = 'done', close_reason = NULL,
          closed_at = clock_timestamp(), closed_by = p_actor, closed_via = v_via,
          working_by = NULL, working_via = NULL, working_chat = NULL, working_seen_at = NULL,
          revision = w.revision + 1, updated_by = p_actor, updated_via = v_via, updated_at = now()
         WHERE w.id = x.id RETURNING w.* INTO n;
        v_action := 'closed';
      ELSIF NOT v_done AND x.status = 'done' THEN
        UPDATE public.ops_work_cards w SET title = v_title, plan_step = v_step, status = 'todo',
          close_kind = NULL, close_reason = NULL, closed_at = NULL, closed_by = NULL, closed_via = NULL, proof = '[]'::jsonb,
          revision = w.revision + 1, updated_by = p_actor, updated_via = v_via, updated_at = now()
         WHERE w.id = x.id RETURNING w.* INTO n;
        v_action := 'reopened';
      ELSE
        UPDATE public.ops_work_cards w SET title = v_title, plan_step = v_step,
          revision = w.revision + 1, updated_by = p_actor, updated_via = v_via, updated_at = now()
         WHERE w.id = x.id RETURNING w.* INTO n;
        v_action := 'updated';
      END IF;
      PERFORM public.ops_card_event(x.id, p_actor, v_via, v_action, format('From the plan of Card %s.', p.number),
        v_before, public.ops_card_snapshot(x.id), x.revision, n.revision);
    ELSE
      INSERT INTO public.ops_work_cards (title, instructions, done_means, status, kind, due_on, due_source, sprint_id, plan, plan_step,
        parent_id, goal_id, close_kind, closed_at, closed_by, closed_via, created_by, created_via, updated_by, updated_via)
      VALUES (v_title, left(format('Step %s of Card %s: %s', i, p.number, COALESCE(public.ops_one_line(s->>'text'), v_title)), 4000),
        'This step is done and read back.', CASE WHEN v_done THEN 'done' ELSE 'todo' END, 'task', p.due_on, 'explicit',
        p.sprint_id, '[]'::jsonb, v_step, p.id, p.goal_id,
        CASE WHEN v_done THEN 'done' END, CASE WHEN v_done THEN clock_timestamp() END,
        CASE WHEN v_done THEN p_actor END, CASE WHEN v_done THEN v_via END,
        p_actor, v_via, p_actor, v_via)
      RETURNING id INTO v_id;
      v_owners := public.ops_4255_step_owners(s->>'text', s->>'tool', p.id);
      INSERT INTO public.ops_work_people (card_id, email, role, added_by, added_via)
      SELECT v_id, o, 'owner', p_actor, v_people_via FROM unnest(v_owners) o ON CONFLICT DO NOTHING;
      PERFORM public.ops_card_event(v_id, p_actor, v_via, 'added', format('From the plan of Card %s.', p.number),
        NULL, public.ops_card_snapshot(v_id), NULL, 1);
    END IF;
    v_changed := v_changed + 1;
  END LOOP;
  -- What the new plan no longer has.
  FOR x IN SELECT w.* FROM public.ops_work_cards w
            WHERE w.id = ANY (v_subs[i + 1:]) AND w.plan_step IS NOT NULL AND w.status <> 'done' AND w.archived_at IS NULL FOR UPDATE LOOP
    UPDATE public.ops_work_cards w SET archived_at = now(), archived_by = p_actor, archive_reason = 'Taken out of the plan.',
      working_by = NULL, working_via = NULL, working_chat = NULL, working_seen_at = NULL,
      revision = w.revision + 1, updated_by = p_actor, updated_via = v_via, updated_at = now()
     WHERE w.id = x.id;
    PERFORM public.ops_card_event(x.id, p_actor, v_via, 'archived', format('Taken out of the plan of Card %s.', p.number), NULL, NULL, x.revision, x.revision + 1);
    v_changed := v_changed + 1;
  END LOOP;
  RETURN v_changed;
END;
$$;
-- ---------------------------------------------------------------------------
-- 2. Readers re-keyed for columns, subtasks, files, the thread and goals
--    (bodies copied from their latest definitions; only the #4255 lines
--    change).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ops_card_json(c public.ops_work_cards, p_today date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_sprint public.ops_sprints; v_working jsonb := public.ops_working_json(c);
BEGIN
  SELECT * INTO v_sprint FROM public.ops_sprints s WHERE s.id = c.sprint_id;
  RETURN jsonb_build_object(
    'id', c.id, 'number', c.number, 'title', c.title, 'instructions', c.instructions, 'done_means', c.done_means,
    'status', c.status, 'blocked', c.blocked, 'blocked_kind', c.blocked_kind, 'blocked_reason', c.blocked_reason,
    'person_reason', c.person_reason, 'tag', c.person_reason, 'files_url', c.files_url,
    'on_brand_plan', c.on_brand_plan, 'brand_plan_source', c.brand_plan_source, 'kind', c.kind, 'kit_step', c.kit_step,
    'anchor', public.ops_card_anchor(c.anchor_kind, c.anchor_id, p_today),
    'due_on', c.due_on, 'due_source', c.due_source, 'overdue', (c.due_on < p_today AND c.status <> 'done'),
    'sprint', jsonb_build_object('id', v_sprint.id, 'starts_on', v_sprint.starts_on, 'ends_on', v_sprint.ends_on, 'goal', v_sprint.goal),
    'carried_count', c.carried_count,
    'owners', COALESCE((SELECT jsonb_agg(jsonb_build_object('email', p.email, 'name', public.ops_name(p.email)) ORDER BY p.added_at, p.email)
                          FROM public.ops_work_people p WHERE p.card_id = c.id AND p.role = 'owner'), '[]'::jsonb),
    'watchers', COALESCE((SELECT jsonb_agg(jsonb_build_object('email', p.email, 'name', public.ops_name(p.email)) ORDER BY p.added_at, p.email)
                            FROM public.ops_work_people p WHERE p.card_id = c.id AND p.role = 'watcher'), '[]'::jsonb),
    'links', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', l.kind, 'id', l.target_id, 'label', l.label,
                                                           'exists', public.ops_link_label(l.kind, l.target_id) IS NOT NULL) ORDER BY l.added_at, l.kind, l.target_id)
                         FROM public.ops_work_links l WHERE l.card_id = c.id), '[]'::jsonb),
    'github', COALESCE((SELECT jsonb_agg(public.ops_github_status(g.number) || jsonb_build_object('kind', g.kind) ORDER BY g.added_at, g.number)
                          FROM public.ops_work_github g WHERE g.card_id = c.id), '[]'::jsonb),
    'plan', public.ops_plan_from_subtasks(c.id), 'result', c.result, 'proof', c.proof, 'close_kind', c.close_kind, 'close_reason', c.close_reason,
    'closed_at', c.closed_at, 'closed_by_name', CASE WHEN c.closed_by IS NOT NULL THEN public.ops_name(c.closed_by) END,
    'closed_via', c.closed_via, 'started_at', c.started_at,
    'working_by_name', CASE WHEN c.working_by IS NOT NULL THEN public.ops_name(c.working_by) END, 'working_via', c.working_via,
    'working', v_working,
    'override', CASE WHEN c.override_at IS NOT NULL THEN jsonb_build_object('reason', c.override_reason, 'by_name', public.ops_name(c.override_by), 'at', c.override_at) END,
    'created_by_name', public.ops_name(c.created_by), 'created_via', c.created_via, 'created_at', c.created_at,
    'updated_at', c.updated_at, 'revision', c.revision,
    'claim', CASE WHEN v_working IS NOT NULL AND NOT (v_working->>'quiet')::boolean THEN jsonb_build_object(
      'holder_name', public.ops_name(c.working_by), 'holder_via', c.working_via,
      'holder_chat_label', v_working->'chat_label', 'since', v_working->'since',
      'ends_at', COALESCE(c.working_seen_at, c.started_at) + interval '24 hours') END,
    'auto', c.auto_key IS NOT NULL,
    'auto_kind', CASE WHEN c.auto_key IS NOT NULL THEN split_part(c.auto_key, ':', 1) END,
    'archived', c.archived_at IS NOT NULL)
    -- #4255: the column, the tree, the description, files, thread and goal.
    || jsonb_build_object(
    'status_id', c.status_id,
    'column', (SELECT jsonb_build_object('id', s.id, 'name', s.name, 'color', s.color, 'grp', s.grp)
                 FROM public.ops_work_statuses s WHERE s.id = c.status_id),
    'parent', CASE WHEN c.parent_id IS NOT NULL THEN (SELECT jsonb_build_object('id', p.id, 'number', p.number, 'title', p.title, 'parent_id', p.parent_id)
                                                        FROM public.ops_work_cards p WHERE p.id = c.parent_id) END,
    'depth', c.depth, 'position', c.position, 'start_on', c.start_on, 'estimate_minutes', c.estimate_minutes,
    'description', c.description_md, 'plan_step', c.plan_step,
    'subtasks', (SELECT jsonb_build_object('total', count(*), 'done', count(*) FILTER (WHERE x.status = 'done'))
                   FROM public.ops_work_cards x WHERE x.parent_id = c.id AND x.archived_at IS NULL),
    'files_count', (SELECT count(*) FROM public.ops_work_files f WHERE f.card_id = c.id AND f.archived_at IS NULL
                     AND (f.kind = 'link' OR public.ops_file_uploaded(f.storage_path))),
    'thread_count', (SELECT count(*) FROM public.ops_work_messages m WHERE m.card_id = c.id AND m.deleted_at IS NULL),
    'goal', CASE WHEN c.goal_id IS NOT NULL THEN (SELECT jsonb_build_object('id', g.id, 'title', g.title, 'state', g.state)
                                                   FROM public.ops_sprint_goals g WHERE g.id = c.goal_id AND g.archived_at IS NULL) END,
    'in_backlog', c.in_backlog);
END;
$$;
CREATE OR REPLACE FUNCTION public.ops_card_lite(c public.ops_work_cards) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT jsonb_build_object('id', c.id, 'number', c.number, 'title', c.title, 'status', c.status, 'blocked', c.blocked,
    'blocked_reason', c.blocked_reason, 'person_reason', c.person_reason, 'tag', c.person_reason, 'files_url', c.files_url,
    'on_brand_plan', c.on_brand_plan, 'brand_plan_source', c.brand_plan_source, 'kind', c.kind, 'kit_step', c.kit_step,
    'due_on', c.due_on, 'close_kind', c.close_kind, 'anchor_kind', c.anchor_kind, 'anchor_id', c.anchor_id)
    || jsonb_build_object('status_id', c.status_id, 'parent_id', c.parent_id, 'depth', c.depth, 'position', c.position,
                          'estimate_minutes', c.estimate_minutes, 'goal_id', c.goal_id)  -- #4255
$$;
CREATE OR REPLACE FUNCTION public.ops_validate_card(p_item jsonb, p_mode text, p_actor text, p_today date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c_keys constant text[] := ARRAY['title','instructions','done_means','owners','watchers','due_on','links','anchor','kit_step','kind','plan','person_reason','github','files_url','on_brand_plan',
                                  'parent','description','start_on','estimate_minutes','goal','in_backlog'];  -- #4255
  v_fixes jsonb := '[]'::jsonb; v_bad text; v_title text; v_instr text; v_done text; v_people jsonb; v_links jsonb;
  v_anchor jsonb; v_anchor_kind text; v_anchor_id uuid; v_kit integer; v_kind text; v_due date; v_due_source text;
  v_parent public.ops_work_cards; v_parent_id uuid; v_sub boolean := false; v_desc text; v_start date; v_est integer; -- #4255
  v_goal uuid; v_goal_week date; v_backlog boolean;
  v_plan jsonb; v_reason text; v_files text; v_on_plan boolean := false; v_gh jsonb := '[]'::jsonb; v_g jsonb; v_p jsonb; v_dup_id uuid; v_dup_number bigint; v_dup_title text; v_self uuid; v_dates integer;
BEGIN
  IF p_item IS NULL OR jsonb_typeof(p_item) <> 'object' THEN
    RETURN jsonb_build_object('clean', NULL, 'fixes', jsonb_build_array(jsonb_build_object('field', 'item', 'message', 'Each card must be an object.')));
  END IF;
  IF p_mode = 'update' THEN
    v_self := (p_item->>'id')::uuid;
  ELSE
    SELECT k INTO v_bad FROM jsonb_object_keys(p_item) k WHERE NOT k = ANY (c_keys) ORDER BY k LIMIT 1;
    IF v_bad IS NOT NULL THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'item', 'message',
        format('A card does not take "%s". It takes: title, instructions, done_means, owners, watchers, due_on, links, anchor, kit_step, kind, plan, person_reason, github, files_url, on_brand_plan, parent, description, start_on, estimate_minutes, goal, in_backlog.', left(v_bad, 60))));
    END IF;
  END IF;

  -- #4255: a subtask names its parent. It may come without instructions, a
  -- done-means line, an owner or a due date: those come from the parent.
  IF p_item ? 'parent' AND jsonb_typeof(p_item->'parent') <> 'null' THEN
    v_sub := true;
    IF jsonb_typeof(p_item->'parent') = 'string' AND public.ops_is_uuid(p_item->>'parent') THEN
      SELECT * INTO v_parent FROM public.ops_work_cards w WHERE w.id = (p_item->>'parent')::uuid AND w.archived_at IS NULL;
    END IF;
    IF v_parent.id IS NULL THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'parent', 'message', 'The parent card is not on the board. Use an id returned by Mingla.'));
    ELSIF v_parent.id = v_self THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'parent', 'message', 'A card cannot be its own subtask.'));
    ELSIF v_parent.depth >= 2 THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'parent', 'message', 'Subtasks go two levels deep at most (card, subtask, sub-subtask).'));
    ELSIF p_mode <> 'update' AND v_parent.status = 'done' THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'parent', 'message', 'The parent card is closed. Reopen it first.'));
    ELSE
      v_parent_id := v_parent.id;
    END IF;
  END IF;
  -- #4255: one description, in Markdown, up to 20,000 characters.
  IF p_item ? 'description' AND jsonb_typeof(p_item->'description') <> 'null' THEN
    v_desc := CASE WHEN jsonb_typeof(p_item->'description') = 'string' THEN public.ops_multi_line(p_item->>'description') END;
    IF jsonb_typeof(p_item->'description') <> 'string' OR char_length(COALESCE(v_desc, '')) > 20000 OR public.ops_has_control(v_desc) THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'description', 'message', 'Keep the description to 20,000 characters.'));
      v_desc := NULL;
    END IF;
  END IF;

  v_title := CASE WHEN jsonb_typeof(p_item->'title') = 'string' THEN public.ops_one_line(p_item->>'title') END;
  IF v_title IS NULL OR char_length(v_title) NOT BETWEEN 3 AND 160 OR public.crm_name_key(v_title) = '' OR public.ops_has_control(v_title) THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'title', 'message', 'Title is missing. Say what the work is in 3 to 160 characters.'));
    v_title := NULL;
  END IF;
  v_instr := CASE WHEN jsonb_typeof(p_item->'instructions') = 'string' THEN public.ops_multi_line(p_item->>'instructions') END;
  -- #4255: with no instructions, the description is the source (its first
  -- 4,000 characters); a subtask with neither says whose subtask it is.
  IF v_instr IS NULL AND jsonb_typeof(p_item->'instructions') IS DISTINCT FROM 'string'
     AND char_length(COALESCE(public.ops_multi_line(left(v_desc, 4000)), '')) >= 10 THEN
    v_instr := public.ops_multi_line(left(v_desc, 4000));
  END IF;
  IF v_instr IS NULL AND jsonb_typeof(p_item->'instructions') IS DISTINCT FROM 'string' AND v_parent_id IS NOT NULL AND v_title IS NOT NULL THEN
    v_instr := format('Subtask of Card %s: %s', v_parent.number, v_title);
  END IF;
  IF v_instr IS NULL OR char_length(v_instr) NOT BETWEEN 10 AND 4000 OR public.ops_has_control(v_instr) THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'instructions', 'message', 'Instructions are missing. Say what the person or their agent should do (10 to 4,000 characters).'));
  END IF;
  v_done := CASE WHEN jsonb_typeof(p_item->'done_means') = 'string' THEN public.ops_one_line(p_item->>'done_means') END;
  IF v_done IS NULL AND jsonb_typeof(p_item->'done_means') IS DISTINCT FROM 'string' AND v_sub THEN v_done := 'This subtask is done.'; END IF;  -- #4255
  IF v_done IS NULL OR char_length(v_done) NOT BETWEEN 5 AND 300 OR public.ops_has_control(v_done) THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'done_means', 'message', 'Done means is empty. Add one line the work is checked against.'));
  END IF;

  v_people := public.ops_people_check(p_item->'owners', p_item->'watchers');
  IF p_mode = 'auto' THEN
    -- A card Mingla makes by itself may wait for someone to take it.
    v_people := jsonb_set(v_people, '{fixes}', COALESCE((SELECT jsonb_agg(f) FROM jsonb_array_elements(v_people->'fixes') f
                                                         WHERE f->>'message' NOT LIKE 'No owner.%'), '[]'::jsonb));
  END IF;
  IF v_sub THEN
    -- #4255: a subtask may wait for someone to take it.
    v_people := jsonb_set(v_people, '{fixes}', COALESCE((SELECT jsonb_agg(f) FROM jsonb_array_elements(v_people->'fixes') f
                                                         WHERE f->>'message' NOT LIKE 'No owner.%'), '[]'::jsonb));
  END IF;
  v_fixes := v_fixes || (v_people->'fixes');
  -- GitHub links: issues and pull requests of this repository only.
  IF p_item ? 'github' AND jsonb_typeof(p_item->'github') <> 'null' THEN
    IF jsonb_typeof(p_item->'github') <> 'array' THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'github', 'message',
        'GitHub links must be a list, like ["#3980"].'));
    ELSIF jsonb_array_length(p_item->'github') > 10 THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'github', 'message', 'A card can link at most 10 GitHub issues or pull requests.'));
    ELSE
      FOR v_g IN SELECT e FROM jsonb_array_elements(p_item->'github') e LOOP
        IF jsonb_typeof(v_g) = 'object' AND v_g->>'kind' IN ('issue','pull') AND (v_g->>'number') ~ '^[0-9]{1,7}$' THEN
          v_p := public.ops_github_parse(v_g->>'number');
          IF v_p ? 'number' THEN v_p := jsonb_build_object('kind', v_g->>'kind', 'number', v_p->'number'); END IF;
        ELSE
          v_p := public.ops_github_parse(CASE WHEN jsonb_typeof(v_g) = 'string' THEN v_g #>> '{}' END);
        END IF;
        IF v_p ? 'error' THEN
          v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'github', 'message',
            format('GitHub link "%s": %s', left(COALESCE(CASE WHEN jsonb_typeof(v_g) = 'string' THEN v_g #>> '{}' ELSE v_g::text END, ''), 120), v_p->>'error')));
        ELSIF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_gh) x WHERE x->'number' = v_p->'number') THEN
          v_gh := v_gh || jsonb_build_array(v_p);
        END IF;
      END LOOP;
    END IF;
  END IF;
  v_links := public.ops_links_check(p_item->'links');
  v_fixes := v_fixes || (v_links->'fixes');

  -- kind
  v_kind := COALESCE(CASE WHEN jsonb_typeof(p_item->'kind') = 'string' THEN p_item->>'kind' END, 'task');
  IF v_kind NOT IN ('task','gate_live','promo') THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'kind', 'message', 'Kind must be task. Only the launch kit makes go-live gate and giveaway cards.'));
    v_kind := 'task';
  END IF;

  -- kit step
  IF p_item ? 'kit_step' AND jsonb_typeof(p_item->'kit_step') <> 'null' THEN
    IF jsonb_typeof(p_item->'kit_step') <> 'number' OR (p_item->>'kit_step') !~ '^-?\d{1,3}$'
       OR (p_item->>'kit_step')::integer NOT IN (-35,-31,-28,-26,-21,-14,-7,2) THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'kit_step', 'message', 'Kit step must be one of -35, -31, -28, -26, -21, -14, -7 or 2, and needs a linked event.'));
    ELSE
      v_kit := (p_item->>'kit_step')::integer;
    END IF;
  END IF;
  IF p_mode <> 'update' AND v_kind = 'gate_live' AND v_kit IS DISTINCT FROM -28 THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'kind', 'message', 'Only the launch kit makes go-live gate cards.'));
  END IF;
  IF p_mode <> 'update' AND v_kind = 'promo' AND v_kit IS DISTINCT FROM -21 THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'kind', 'message', 'Only the launch kit makes giveaway and ads cards.'));
  END IF;

  -- anchor: given, or the one event or expected event linked
  IF p_item ? 'anchor' AND jsonb_typeof(p_item->'anchor') <> 'null' THEN
    IF jsonb_typeof(p_item->'anchor') = 'object' AND p_item->'anchor'->>'kind' IN ('event','expected') AND public.ops_is_uuid(p_item->'anchor'->>'id') THEN
      v_anchor_kind := p_item->'anchor'->>'kind'; v_anchor_id := (p_item->'anchor'->>'id')::uuid;
      v_anchor := public.ops_anchor(v_anchor_kind, v_anchor_id, p_today);
    END IF;
    IF v_anchor IS NULL THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'anchor', 'message', 'The event this card is counted from does not exist on Mingla or is not visible to the team.'));
      v_anchor_kind := NULL; v_anchor_id := NULL;
    END IF;
  ELSE
    SELECT count(*) INTO v_dates FROM jsonb_array_elements(v_links->'links') l WHERE l->>'kind' IN ('event','expected');
    IF v_dates = 1 THEN
      SELECT l->>'kind', (l->>'id')::uuid INTO v_anchor_kind, v_anchor_id FROM jsonb_array_elements(v_links->'links') l WHERE l->>'kind' IN ('event','expected');
      v_anchor := public.ops_anchor(v_anchor_kind, v_anchor_id, p_today);
    ELSIF v_dates > 1 AND (NOT (p_item ? 'due_on') OR jsonb_typeof(p_item->'due_on') = 'null' OR v_kit IS NOT NULL OR v_kind <> 'task') THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'anchor', 'message', 'Several events are linked. Say which one this card is counted from (anchor).'));
    END IF;
  END IF;
  IF v_kit IS NOT NULL AND v_anchor IS NULL AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_fixes) f WHERE f->>'field' IN ('kit_step','anchor')) THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'kit_step', 'message', 'Kit step must be one of -35, -31, -28, -26, -21, -14, -7 or 2, and needs a linked event.'));
  END IF;
  IF v_kind <> 'task' AND v_anchor IS NULL AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_fixes) f WHERE f->>'field' = 'anchor') THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'anchor', 'message', 'The event this card is counted from does not exist on Mingla or is not visible to the team.'));
  END IF;
  -- the anchor is always also a link
  IF v_anchor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_links->'links') l WHERE l->>'kind' = v_anchor_kind AND l->>'id' = v_anchor_id::text) THEN
    v_links := jsonb_set(v_links, '{links}', (v_links->'links') || jsonb_build_array(jsonb_build_object('kind', v_anchor_kind, 'id', v_anchor_id, 'label', left(v_anchor->>'title', 160))));
    IF jsonb_array_length(v_links->'links') > 20 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_fixes) f WHERE f->>'message' = 'A card can link at most 20 records.') THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'links', 'message', 'A card can link at most 20 records.'));
    END IF;
  END IF;

  -- due date: given, else counted back from the anchor
  IF p_item ? 'due_on' AND jsonb_typeof(p_item->'due_on') <> 'null' THEN
    BEGIN
      IF jsonb_typeof(p_item->'due_on') <> 'string' OR (p_item->>'due_on') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22007'; END IF;
      v_due := (p_item->>'due_on')::date; v_due_source := COALESCE(NULLIF(p_item->>'_due_source', ''), 'explicit');
    EXCEPTION WHEN others THEN v_due := NULL; v_due_source := 'bad';
    END;
    -- Wave 3: a launch kit card sent back with the date the kit counted for
    -- it is counted from the event, even when that date has just passed.
    IF p_mode <> 'update' AND v_due IS NOT NULL AND v_kit IS NOT NULL AND v_anchor IS NOT NULL
       AND (v_anchor->>'start_on') IS NOT NULL AND v_due = (v_anchor->>'start_on')::date + v_kit THEN
      v_due_source := 'kit';
    ELSIF v_due IS NULL OR (p_mode <> 'update' AND v_due < p_today - 1) OR v_due > p_today + 730 THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'due_on', 'message', 'Due date must be a real date from today up to two years ahead.'));
      v_due := NULL;
    END IF;
  ELSIF v_anchor IS NOT NULL AND (v_anchor->>'start_on') IS NOT NULL THEN
    IF v_kit IS NOT NULL THEN v_due := (v_anchor->>'start_on')::date + v_kit; v_due_source := 'kit';
    ELSE v_due := (v_anchor->>'start_on')::date - 1; v_due_source := 'event'; END IF;
  ELSIF v_parent.id IS NOT NULL THEN
    v_due := v_parent.due_on; v_due_source := 'explicit';  -- #4255: a subtask is due when its parent is
  ELSIF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_fixes) f WHERE f->>'field' = 'anchor') THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'due_on', 'message', 'No due date. Add one, or link an event and it is counted back from the start.'));
  END IF;

  -- the Send, Spend or Publish tag (#4270: a tag, not a status)
  IF p_item ? 'person_reason' AND jsonb_typeof(p_item->'person_reason') <> 'null' THEN
    IF jsonb_typeof(p_item->'person_reason') <> 'string' OR p_item->>'person_reason' NOT IN ('send','spend','publish','other') THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'person_reason', 'message', 'A Send, Spend or Publish tag must say which: send, spend, publish or other.'));
    ELSE v_reason := p_item->>'person_reason'; END IF;
  END IF;

  -- #4270: one Files link, https only (an empty string clears it)
  IF p_item ? 'files_url' AND jsonb_typeof(p_item->'files_url') <> 'null' THEN
    v_files := CASE WHEN jsonb_typeof(p_item->'files_url') = 'string' THEN btrim(p_item->>'files_url') END;
    IF v_files = '' THEN v_files := NULL;
    ELSIF v_files IS NULL OR char_length(v_files) NOT BETWEEN 9 AND 2000 OR v_files !~ '^https://[^[:space:]]+$'
          OR v_files !~ '^https://[^/?#:@\\]' OR public.brand_plan_link_hidden(v_files) THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'files_url', 'message', 'Links start with https:// and stay under 2,000 characters.'));
      v_files := NULL;
    END IF;
  END IF;

  -- #4270 W2: "Host can see this task on their plan" (true or false).
  IF p_item ? 'on_brand_plan' AND jsonb_typeof(p_item->'on_brand_plan') <> 'null' THEN
    IF jsonb_typeof(p_item->'on_brand_plan') <> 'boolean' THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'on_brand_plan', 'message', 'Host can see this must be true or false.'));
    ELSE v_on_plan := (p_item->>'on_brand_plan')::boolean; END IF;
  END IF;

  v_plan := public.ops_plan_check(p_item->'plan');
  IF v_plan IS NULL THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'plan', 'message',
      COALESCE(public.ops_plan_problem(p_item->'plan'), 'Plan steps need a number, the step in words, and the tool that does it, or person.')));
  END IF;

  -- #4255: start date, estimate, sprint goal and backlog.
  IF p_item ? 'start_on' AND jsonb_typeof(p_item->'start_on') <> 'null' THEN
    BEGIN
      IF jsonb_typeof(p_item->'start_on') <> 'string' OR (p_item->>'start_on') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22007'; END IF;
      v_start := (p_item->>'start_on')::date;
      IF v_start NOT BETWEEN p_today - 730 AND p_today + 730 THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22007'; END IF;
    EXCEPTION WHEN others THEN
      v_start := NULL;
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'start_on', 'message', 'Start date must be a real date within two years.'));
    END;
  END IF;
  IF v_start IS NOT NULL AND v_due IS NOT NULL AND v_start > v_due THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'start_on', 'message', 'Start must be on or before the due date.'));
  END IF;
  IF p_item ? 'estimate_minutes' AND jsonb_typeof(p_item->'estimate_minutes') <> 'null' THEN
    IF jsonb_typeof(p_item->'estimate_minutes') <> 'number' OR (p_item->>'estimate_minutes') !~ '^\d{1,5}$'
       OR (p_item->>'estimate_minutes')::integer NOT BETWEEN 1 AND 60000 THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'estimate_minutes', 'message', 'An estimate is whole minutes, from 1 to 60,000.'));
    ELSE
      v_est := (p_item->>'estimate_minutes')::integer;
    END IF;
  END IF;
  IF p_item ? 'goal' AND jsonb_typeof(p_item->'goal') <> 'null' THEN
    IF jsonb_typeof(p_item->'goal') = 'string' AND public.ops_is_uuid(p_item->>'goal') THEN
      SELECT g.id, s.starts_on INTO v_goal, v_goal_week FROM public.ops_sprint_goals g JOIN public.ops_sprints s ON s.id = g.sprint_id
       WHERE g.id = (p_item->>'goal')::uuid AND g.archived_at IS NULL;
    END IF;
    IF v_goal IS NULL THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'goal', 'message', 'That sprint goal is not there any more. Pick one of the sprint''s goals.'));
    ELSIF p_mode <> 'update' AND v_goal_week IS DISTINCT FROM
          COALESCE((SELECT s.starts_on FROM public.ops_sprints s WHERE s.id = v_parent.sprint_id), public.ops_monday(p_today)) THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'goal', 'message', 'That goal belongs to another sprint. Pick one of this sprint''s goals.'));
      v_goal := NULL;
    END IF;
  END IF;
  IF p_item ? 'in_backlog' AND jsonb_typeof(p_item->'in_backlog') <> 'null' THEN
    IF jsonb_typeof(p_item->'in_backlog') <> 'boolean' THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'in_backlog', 'message', 'Backlog must be true or false.'));
    ELSE
      v_backlog := (p_item->>'in_backlog')::boolean;
    END IF;
  END IF;

  -- duplicates: an open card with the same title, or a card for the same kit step
  -- (#4255: among top-level cards; subtasks often share words)
  IF v_title IS NOT NULL AND NOT v_sub THEN
    SELECT w.id, w.number, w.title INTO v_dup_id, v_dup_number, v_dup_title FROM public.ops_work_cards w
     WHERE w.title_key = public.crm_name_key(v_title) AND w.status <> 'done' AND w.archived_at IS NULL AND w.parent_id IS NULL
       AND (v_self IS NULL OR w.id <> v_self) LIMIT 1;
  END IF;
  IF v_dup_id IS NULL AND v_kit IS NOT NULL AND v_anchor_id IS NOT NULL THEN
    SELECT w.id, w.number, w.title INTO v_dup_id, v_dup_number, v_dup_title FROM public.ops_work_cards w
     WHERE w.anchor_kind = v_anchor_kind AND w.anchor_id = v_anchor_id AND w.kit_step = v_kit AND w.archived_at IS NULL
       AND (v_self IS NULL OR w.id <> v_self) LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'clean', jsonb_build_object('title', v_title, 'instructions', v_instr, 'done_means', v_done,
      'owners', v_people->'owners', 'watchers', v_people->'watchers', 'links', v_links->'links',
      'anchor_kind', v_anchor_kind, 'anchor_id', v_anchor_id, 'anchor', v_anchor, 'kit_step', v_kit, 'kind', v_kind,
      'due_on', v_due, 'due_source', v_due_source, 'plan', COALESCE(v_plan, '[]'::jsonb), 'person_reason', v_reason, 'github', v_gh, 'files_url', v_files, 'on_brand_plan', v_on_plan)
      || jsonb_build_object('parent_id', v_parent_id, 'parent_sprint_id', v_parent.sprint_id, 'description', v_desc,  -- #4255
                            'start_on', v_start, 'estimate_minutes', v_est, 'goal_id', v_goal, 'in_backlog', v_backlog),
    'fixes', v_fixes,
    'duplicate', CASE WHEN v_dup_id IS NOT NULL THEN jsonb_build_object('id', v_dup_id, 'number', v_dup_number, 'title', v_dup_title) END);
END;
$$;
CREATE OR REPLACE FUNCTION public.ops_field_words(p_field text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE p_field
    WHEN 'title' THEN 'title' WHEN 'instructions' THEN 'instructions' WHEN 'done_means' THEN 'done means'
    WHEN 'owners' THEN 'owners' WHEN 'watchers' THEN 'watchers' WHEN 'due_on' THEN 'due date'
    WHEN 'links' THEN 'links' WHEN 'anchor' THEN 'event' WHEN 'kit_step' THEN 'launch kit step'
    WHEN 'kind' THEN 'card type' WHEN 'plan' THEN 'plan' WHEN 'person_reason' THEN 'Send, Spend or Publish tag' WHEN 'files_url' THEN 'files link' WHEN 'on_brand_plan' THEN 'Host can see this'
    WHEN 'status' THEN 'status' WHEN 'week' THEN 'sprint week' WHEN 'blocked_reason' THEN 'what blocks it'
    WHEN 'result' THEN 'result' WHEN 'blocked' THEN 'blocked' WHEN 'item' THEN 'the card'
    WHEN 'parent' THEN 'parent card' WHEN 'description' THEN 'description' WHEN 'start_on' THEN 'start date'  -- #4255
    WHEN 'estimate_minutes' THEN 'estimate' WHEN 'goal' THEN 'sprint goal' WHEN 'in_backlog' THEN 'backlog'
    ELSE 'a field' END
$$;
-- ---------------------------------------------------------------------------
-- 3. Writers: the plan is subtasks, cards take a parent, a description, a
--    start date, an estimate, a goal and the backlog flag.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ops_work_update(p_id uuid, p_changes jsonb, p_expected_revision bigint, p_request_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v record; c public.ops_work_cards; n public.ops_work_cards; v_today date := public.ops_today(NULL); v_replay jsonb; v_bad text;
  v_before jsonb; v_item jsonb; v_chk jsonb; cl jsonb; v_fixes jsonb; v_people jsonb; v_links_changed boolean := false;
  v_cats text[] := ARRAY[]::text[]; v_action text; v_event uuid; v_out jsonb; v_gate jsonb; v_week date; v_who text;
  v_status text; v_reason text; v_result text; v_breason text; v_owners text[]; v_watchers text[]; v_anchor_changed boolean := false;
  v_back boolean := false; v_back_reason text; -- Wave 2: leaving Needs a person; #4270: taking the tag off
  v_alias boolean := false; -- #4270: the old status person, read as To do with a tag
  v_removed_words text; -- #3980 rework 2: who was taken off, for the agent log
  v_gh_changed boolean := false; v_chat text;
  v_gh_list text; v_gh_wait boolean := false; -- #3980 synced, Wave 2: waiting for GitHub
  v_gh_cur text; -- #3980 W2 rework: the links a waiting card has now
  v_goal uuid; v_goal_sprint uuid; v_new_parent uuid; -- #4255
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_chat := CASE WHEN v.via IS NOT NULL THEN public.ops_ctx_chat() END;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid_changes: Send at least one field to change.' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(p_changes) k
   WHERE k NOT IN ('title','instructions','done_means','due_on','week','owners','watchers','links','anchor','plan','result',
                   'blocked','blocked_reason','status','person_reason','reason','github','blocked_on_github','files_url','on_brand_plan',
                   'description','start_on','estimate_minutes','goal','in_backlog','parent') ORDER BY k LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '%', format('unknown_field: A card change does not take "%s".', left(v_bad, 60)) USING ERRCODE = '22023';
  END IF;
  v_replay := public.ops_request_begin(v.actor_email, p_request_key, 'update',
    jsonb_build_object('id', p_id, 'changes', p_changes, 'expected_revision', p_expected_revision));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF p_expected_revision IS NULL THEN
    RAISE EXCEPTION 'stale_write: This card changed since you opened it. Reload it, then try again.' USING ERRCODE = 'PT409';
  END IF;
  c := public.ops_card_lock(p_id, p_expected_revision);
  IF c.status = 'done' THEN RAISE EXCEPTION 'card_closed: Reopen this card before changing it.' USING ERRCODE = '22023'; END IF;
  PERFORM public.ops_agent_owns(c, v.actor_email, v.via);
  PERFORM public.ops_claim_assert('work_card', c.id, v.actor_email, v.via);
  v_before := public.ops_card_snapshot(c.id);
  v_who := public.ops_actor_label(v.actor_email, v.via);
  v_anchor_changed := p_changes ? 'anchor' AND (p_changes->'anchor' IS DISTINCT FROM
    CASE WHEN c.anchor_id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object('kind', c.anchor_kind, 'id', c.anchor_id) END);

  v_item := jsonb_build_object('id', c.id,
    'title', COALESCE(p_changes->'title', to_jsonb(c.title)),
    -- #4255: a new description is the instructions too (its first 4,000 characters)
    'instructions', CASE WHEN p_changes ? 'instructions' THEN p_changes->'instructions'
                         WHEN p_changes ? 'description' AND jsonb_typeof(p_changes->'description') = 'string'
                              AND char_length(COALESCE(public.ops_multi_line(left(p_changes->>'description', 4000)), '')) >= 10 THEN 'null'::jsonb
                         ELSE to_jsonb(c.instructions) END,
    'done_means', COALESCE(p_changes->'done_means', to_jsonb(c.done_means)),
    'owners', CASE WHEN p_changes ? 'owners' THEN p_changes->'owners' ELSE to_jsonb(public.ops_card_people(c.id, 'owner')) END,
    'watchers', CASE WHEN p_changes ? 'watchers' THEN p_changes->'watchers' ELSE to_jsonb(public.ops_card_people(c.id, 'watcher')) END,
    'links', CASE WHEN p_changes ? 'links' THEN p_changes->'links'
                  ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', l.kind, 'id', l.target_id)) FROM public.ops_work_links l WHERE l.card_id = c.id), '[]'::jsonb) END,
    'anchor', CASE WHEN p_changes ? 'anchor' THEN p_changes->'anchor'
                   WHEN c.anchor_id IS NOT NULL THEN jsonb_build_object('kind', c.anchor_kind, 'id', c.anchor_id) ELSE 'null'::jsonb END,
    'kit_step', to_jsonb(c.kit_step), 'kind', to_jsonb(c.kind),
    'person_reason', CASE WHEN p_changes ? 'person_reason' THEN p_changes->'person_reason' ELSE to_jsonb(c.person_reason) END,
    'files_url', CASE WHEN p_changes ? 'files_url' THEN p_changes->'files_url' ELSE to_jsonb(c.files_url) END,
    -- #4255
    'parent', CASE WHEN p_changes ? 'parent' THEN p_changes->'parent' ELSE to_jsonb(c.parent_id) END,
    'description', CASE WHEN p_changes ? 'description' THEN p_changes->'description' ELSE to_jsonb(c.description_md) END,
    'start_on', CASE WHEN p_changes ? 'start_on' THEN p_changes->'start_on' ELSE to_jsonb(c.start_on) END,
    'estimate_minutes', CASE WHEN p_changes ? 'estimate_minutes' THEN p_changes->'estimate_minutes' ELSE to_jsonb(c.estimate_minutes) END,
    'goal', CASE WHEN p_changes ? 'goal' THEN p_changes->'goal' ELSE to_jsonb(c.goal_id) END,
    'in_backlog', CASE WHEN p_changes ? 'in_backlog' THEN p_changes->'in_backlog' ELSE to_jsonb(c.in_backlog) END,
    'on_brand_plan', CASE WHEN p_changes ? 'on_brand_plan' THEN p_changes->'on_brand_plan' ELSE to_jsonb(c.on_brand_plan) END,
    'plan', CASE WHEN p_changes ? 'plan' THEN p_changes->'plan' ELSE c.plan END,
    'github', CASE WHEN p_changes ? 'github' THEN p_changes->'github'
                   ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', g.kind, 'number', g.number) ORDER BY g.number)
                                    FROM public.ops_work_github g WHERE g.card_id = c.id), '[]'::jsonb) END,
    'due_on', CASE WHEN p_changes ? 'due_on' THEN p_changes->'due_on'
                   WHEN v_anchor_changed AND c.due_source <> 'explicit' THEN 'null'::jsonb ELSE to_jsonb(c.due_on) END,
    '_due_source', CASE WHEN p_changes ? 'due_on' THEN 'explicit' ELSE c.due_source END);
  IF p_changes ? 'links' AND NOT (p_changes ? 'anchor') AND c.anchor_id IS NOT NULL
     AND jsonb_typeof(p_changes->'links') = 'array'
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_changes->'links') l WHERE l->>'kind' = c.anchor_kind AND lower(l->>'id') = c.anchor_id::text)
     AND c.kind = 'task' AND c.kit_step IS NULL THEN
    -- removing the anchor's link frees the card from its event
    v_item := jsonb_set(v_item, '{anchor}', 'null'::jsonb);
    IF c.due_source <> 'explicit' THEN v_item := jsonb_set(v_item, '{due_on}', to_jsonb(c.due_on)); v_item := jsonb_set(v_item, '{_due_source}', '"explicit"'); END IF;
    v_anchor_changed := true;
  END IF;
  v_chk := public.ops_validate_card(v_item, 'update', v.actor_email, v_today);
  v_fixes := v_chk->'fixes';
  IF v_chk->'duplicate' IS NOT NULL AND jsonb_typeof(v_chk->'duplicate') = 'object' AND p_changes ? 'title' THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'title', 'message',
      format('An open card already does this: "%s" (Card %s). Update that card instead.', v_chk->'duplicate'->>'title', v_chk->'duplicate'->>'number')));
  END IF;
  cl := v_chk->'clean';

  -- status, the Send/Spend/Publish tag, blocked, result, week
  -- #4270: status is todo or doing. The old status person is still accepted
  -- from agents and old prompts: it means To do with a tag (person_reason),
  -- which is then required. A status change never clears the tag.
  v_status := c.status; v_reason := c.person_reason;
  IF p_changes ? 'status' THEN
    IF jsonb_typeof(p_changes->'status') <> 'string' OR p_changes->>'status' NOT IN ('todo','doing','person') THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'status', 'message', 'Status can be todo or doing. Close a card with proof, or push it back.'));
    ELSIF p_changes->>'status' = 'person' THEN v_status := 'todo'; v_alias := true;
    ELSE v_status := p_changes->>'status'; END IF;
  END IF;
  IF p_changes ? 'person_reason' THEN v_reason := cl->>'person_reason'; END IF;
  IF v_alias AND v_reason IS NULL THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'person_reason', 'message', 'A Send, Spend or Publish tag must say which: send, spend, publish or other.'));
  END IF;
  -- Wave 2 / #4270: taking the tag off a card (what leaving Needs a person
  -- was) needs a reason from an agent; the log records it and owners and
  -- watchers are told.
  -- #4270 rework (P3-2): a tag that is not one of the four words (an empty
  -- string, say) is refused as a bad tag below, not as a missing reason.
  v_back := c.person_reason IS NOT NULL AND v_reason IS NULL
            AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_fixes) f WHERE f->>'field' = 'person_reason');
  IF v_back THEN
    v_back_reason := CASE WHEN jsonb_typeof(p_changes->'reason') = 'string' THEN left(public.ops_one_line(p_changes->>'reason'), 500) END;
    IF public.ops_has_control(v_back_reason) THEN v_back_reason := NULL; END IF;
    IF v.via IS NOT NULL AND v_back_reason IS NULL THEN
      RAISE EXCEPTION 'reason_required: Say why this card no longer needs its Send, Spend or Publish tag. Your person and the card''s watchers are told.' USING ERRCODE = '22023';
    END IF;
  END IF;
  -- #3980 W2 rework 3: an agent never moves a roadmap approval card or
  -- changes what it waits for, so it cannot send it back and then close it.
  IF v.via IS NOT NULL AND c.auto_key LIKE 'roadmap\_shipped:%'
     AND (v_status IS DISTINCT FROM c.status OR v_reason IS DISTINCT FROM c.person_reason) THEN
    RAISE EXCEPTION 'people_only: A person approves what hosts are told. Only a person moves this card.' USING ERRCODE = '42501';
  END IF;
  n := c;
  -- #4270 W2 (D15): "Host can see this". A person decides what hosts see: an
  -- agent cannot switch it on.
  IF p_changes ? 'on_brand_plan' AND jsonb_typeof(p_changes->'on_brand_plan') = 'boolean' THEN
    IF v.via IS NOT NULL AND (p_changes->>'on_brand_plan')::boolean AND NOT c.on_brand_plan THEN
      RAISE EXCEPTION 'people_only: A person decides what hosts see.' USING ERRCODE = '42501';
    END IF;
    n.on_brand_plan := (p_changes->>'on_brand_plan')::boolean;
  END IF;
  -- Wave 2: the GitHub issues and pull requests the card waits for.
  SELECT string_agg('#' || (x->>'number'), ', ' ORDER BY (x->>'number')::integer) INTO v_gh_list
    FROM jsonb_array_elements(COALESCE(cl->'github', '[]'::jsonb)) x;
  SELECT string_agg('#' || g.number, ', ' ORDER BY g.number) INTO v_gh_cur FROM public.ops_work_github g WHERE g.card_id = c.id;
  -- #3980 W2 rework: an agent cannot change what a waiting card waits for
  -- (adding, removing or swapping a link would let it lift the wait); a
  -- person can, and the agent log says who did.
  IF c.blocked_kind = 'github' AND v.via IS NOT NULL AND p_changes ? 'github' AND v_gh_list IS DISTINCT FROM v_gh_cur THEN
    RAISE EXCEPTION '%', format('gate_blocked: This card waits for %s to be Live on Mingla.', COALESCE(v_gh_cur, 'its GitHub issue'))
      USING ERRCODE = '42501';
  END IF;
  IF c.blocked_kind = 'github' AND v.via IS NOT NULL
     AND ((p_changes ? 'blocked_on_github' AND jsonb_typeof(p_changes->'blocked_on_github') = 'boolean' AND NOT (p_changes->>'blocked_on_github')::boolean)
          OR (NOT (p_changes ? 'blocked_on_github') AND p_changes ? 'blocked')) THEN
    RAISE EXCEPTION '%', format('gate_blocked: This card waits for %s to be Live on Mingla.', COALESCE(v_gh_list, 'its GitHub issue'))
      USING ERRCODE = '42501';
  END IF;
  IF p_changes ? 'blocked_on_github' THEN
    v_gh_wait := true;
    IF jsonb_typeof(p_changes->'blocked_on_github') <> 'boolean' THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'blocked_on_github', 'message', 'Blocked until Live must be true or false.'));
    ELSIF (p_changes->>'blocked_on_github')::boolean THEN
      IF c.blocked_kind IN ('waiting_go_live', 'organic_only') THEN
        RAISE EXCEPTION 'gate_blocked: This card waits for the event to be public with at least 21 days left. The owner or an admin can override it with a reason.' USING ERRCODE = '42501';
      END IF;
      IF v_gh_list IS NULL THEN
        v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'github', 'message', 'Link a GitHub issue or pull request first; the card then waits for it to be Live.'));
      ELSE n.blocked := true; n.blocked_kind := 'github'; n.blocked_reason := format('Waiting for %s to be Live.', v_gh_list); END IF;
    ELSIF c.blocked_kind = 'github' THEN
      n.blocked := false; n.blocked_kind := NULL; n.blocked_reason := NULL;
    END IF;
  ELSIF p_changes ? 'blocked' THEN
    IF jsonb_typeof(p_changes->'blocked') <> 'boolean' THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'blocked', 'message', 'Blocked must be true or false.'));
    ELSIF (p_changes->>'blocked')::boolean THEN
      IF c.blocked_kind IN ('waiting_go_live', 'organic_only') THEN
        RAISE EXCEPTION 'gate_blocked: This card waits for the event to be public with at least 21 days left. The owner or an admin can override it with a reason.' USING ERRCODE = '42501';
      END IF;
      v_breason := public.ops_one_line(p_changes->>'blocked_reason');
      IF v_breason IS NULL OR char_length(v_breason) NOT BETWEEN 5 AND 300 THEN
        v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'blocked_reason', 'message', 'Say what blocks this card in 5 to 300 characters.'));
      ELSE n.blocked := true; n.blocked_kind := 'manual'; n.blocked_reason := v_breason; END IF;
    ELSE
      IF c.blocked_kind IN ('waiting_go_live', 'organic_only') THEN
        RAISE EXCEPTION 'gate_blocked: This card waits for the event to be public with at least 21 days left. The owner or an admin can override it with a reason.' USING ERRCODE = '42501';
      END IF;
      n.blocked := false; n.blocked_kind := NULL; n.blocked_reason := NULL;
    END IF;
  ELSIF p_changes ? 'blocked_reason' THEN
    v_breason := public.ops_one_line(p_changes->>'blocked_reason');
    IF c.blocked_kind = 'manual' AND v_breason IS NOT NULL AND char_length(v_breason) BETWEEN 5 AND 300 THEN n.blocked_reason := v_breason;
    ELSE v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'blocked_reason', 'message', 'Say what blocks this card in 5 to 300 characters.')); END IF;
  END IF;
  -- Wave 2: a card waiting for GitHub keeps its reason in step with its links.
  IF NOT v_gh_wait AND n.blocked_kind = 'github' AND p_changes ? 'github' THEN
    IF v_gh_list IS NULL THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'github', 'message', 'A card waiting for GitHub keeps at least one GitHub link. Lift the wait first.'));
    ELSE n.blocked_reason := format('Waiting for %s to be Live.', v_gh_list); END IF;
  END IF;
  IF p_changes ? 'result' THEN
    v_result := CASE WHEN jsonb_typeof(p_changes->'result') = 'string' THEN public.ops_multi_line(p_changes->>'result') END;
    IF char_length(COALESCE(v_result, '')) > 2000 OR public.ops_has_control(v_result) THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'result', 'message', 'Keep the result to 2,000 characters.'));
    ELSE n.result := v_result; END IF;
  END IF;
  IF p_changes ? 'week' AND jsonb_typeof(p_changes->'week') <> 'null' THEN
    BEGIN
      v_week := public.ops_monday((p_changes->>'week')::date);
      IF v_week NOT BETWEEN v_today - 730 AND v_today + 730 THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22007'; END IF;
    EXCEPTION WHEN others THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'week', 'message', 'Sprint must be a real week within two years.'));
      v_week := NULL;
    END;
  END IF;
  -- #4255: a goal belongs to one sprint, and the card must be in it. A card
  -- that moves week leaves its old sprint's goal behind.
  v_goal := (cl->>'goal_id')::uuid;
  IF v_goal IS NOT NULL THEN
    SELECT g.sprint_id INTO v_goal_sprint FROM public.ops_sprint_goals g WHERE g.id = v_goal;
    IF v_goal_sprint IS DISTINCT FROM (CASE WHEN v_week IS NOT NULL THEN (SELECT s.id FROM public.ops_sprints s WHERE s.starts_on = v_week) ELSE c.sprint_id END) THEN
      IF p_changes ? 'goal' THEN
        v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'goal', 'message', 'That goal belongs to another sprint. Move the card to that week, or pick one of its sprint''s goals.'));
      END IF;
      v_goal := NULL;
    END IF;
  END IF;
  -- #4255: an agent moves a card only under a card its person owns.
  v_new_parent := (cl->>'parent_id')::uuid;
  IF v.via IS NOT NULL AND p_changes ? 'parent' AND v_new_parent IS DISTINCT FROM c.parent_id AND v_new_parent IS NOT NULL
     AND NOT public.ops_is_person_on(v_new_parent, v.actor_email, ARRAY['owner']) THEN
    RAISE EXCEPTION 'not_your_card: Your person is not an owner of that parent card.' USING ERRCODE = '42501';
  END IF;
  IF p_changes ? 'parent' AND jsonb_typeof(p_changes->'parent') <> 'null' AND v_new_parent IS NULL
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_fixes) f WHERE f->>'field' = 'parent') THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'parent', 'message', 'The parent card is not on the board. Use an id returned by Mingla.'));
  END IF;
  IF jsonb_array_length(v_fixes) > 0 THEN
    RAISE EXCEPTION '%', 'invalid_card: ' || (SELECT string_agg(f->>'message', ' ') FROM jsonb_array_elements(v_fixes) f)
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('fixes', v_fixes)::text;
  END IF;

  n.title := cl->>'title'; n.instructions := cl->>'instructions'; n.done_means := cl->>'done_means';
  n.anchor_kind := cl->>'anchor_kind'; n.anchor_id := (cl->>'anchor_id')::uuid;
  n.due_on := (cl->>'due_on')::date; n.due_source := cl->>'due_source'; n.plan := cl->'plan';
  n.status := v_status; n.person_reason := v_reason; n.files_url := cl->>'files_url';
  -- #4255
  n.parent_id := v_new_parent; n.description_md := cl->>'description'; n.start_on := (cl->>'start_on')::date;
  n.estimate_minutes := (cl->>'estimate_minutes')::integer; n.goal_id := v_goal;
  n.in_backlog := COALESCE((cl->>'in_backlog')::boolean, c.in_backlog);
  IF v_status = 'doing' AND c.status <> 'doing' THEN n.started_at := COALESCE(c.started_at, clock_timestamp()); n.working_by := v.actor_email; n.working_via := v.via; END IF;
  -- Back to To do: nobody is working on it any more, so the mark ends.
  IF v_status = 'todo' AND c.status = 'doing' THEN n.working_by := NULL; n.working_via := NULL; END IF;
  n.sprint_id := CASE WHEN v_week IS NOT NULL THEN public.ops_sprint_ensure(v_week) ELSE c.sprint_id END;
  IF c.kind = 'promo' AND v_anchor_changed AND c.override_at IS NULL THEN
    v_gate := public.ops_promo_gate(cl->'anchor', v_today);
    n.blocked := (v_gate->>'blocked')::boolean;
    n.blocked_kind := CASE WHEN n.blocked THEN v_gate->>'kind' END;
    n.blocked_reason := CASE WHEN n.blocked THEN v_gate->>'reason' END;
  END IF;

  -- #3980 W2 rework 4: on a roadmap approval card an agent changes nothing
  -- that ties it to its draft or decides whether it is open: its links, its
  -- GitHub links, blocked or waiting, or its anchor. Its wording, plan,
  -- result and due date stay editable. (A trigger refuses the same for every
  -- other writer.)
  IF v.via IS NOT NULL AND c.auto_key LIKE 'roadmap\_shipped:%'
     AND (ROW(n.blocked, n.blocked_kind, n.blocked_reason, n.anchor_kind, n.anchor_id)
            IS DISTINCT FROM ROW(c.blocked, c.blocked_kind, c.blocked_reason, c.anchor_kind, c.anchor_id)
          OR (p_changes ? 'github' AND v_gh_list IS DISTINCT FROM v_gh_cur)
          OR (p_changes ? 'links' AND
              (SELECT string_agg(k, ',' ORDER BY k COLLATE "C") FROM (
                 SELECT DISTINCT l.kind || ':' || l.target_id::text AS k FROM public.ops_work_links l WHERE l.card_id = c.id) a)
              IS DISTINCT FROM
              (SELECT string_agg(k, ',' ORDER BY k COLLATE "C") FROM (
                 SELECT DISTINCT (x->>'kind') || ':' || lower(x->>'id') AS k FROM jsonb_array_elements(COALESCE(cl->'links', '[]'::jsonb)) x) b))) THEN
    RAISE EXCEPTION 'people_only: A person approves what hosts are told. Only a person changes what this card links to or waits for.' USING ERRCODE = '42501';
  END IF;
  -- #3980 W2 follow-up: nor who owns or watches it (the same test
  -- ops_people_set uses for "changed"; a trigger backstops every writer).
  IF v.via IS NOT NULL AND c.auto_key LIKE 'roadmap\_shipped:%'
     AND (public.ops_card_people(c.id, 'owner')
            IS DISTINCT FROM ARRAY(SELECT x FROM jsonb_array_elements_text(COALESCE(cl->'owners', '[]'::jsonb)) x ORDER BY x)
          OR public.ops_card_people(c.id, 'watcher')
            IS DISTINCT FROM ARRAY(SELECT x FROM jsonb_array_elements_text(COALESCE(cl->'watchers', '[]'::jsonb)) x
                                    WHERE NOT x = ANY (ARRAY(SELECT jsonb_array_elements_text(COALESCE(cl->'owners', '[]'::jsonb)))) ORDER BY x)) THEN
    RAISE EXCEPTION 'people_only: A person approves what hosts are told. Only a person changes who owns or watches this card.' USING ERRCODE = '42501';
  END IF;

  IF ROW(n.title, n.instructions, n.done_means, n.due_on, n.sprint_id, n.anchor_kind, n.anchor_id, n.result, n.files_url, n.on_brand_plan,
         n.parent_id, n.description_md, n.start_on, n.estimate_minutes, n.goal_id, n.in_backlog)
     IS DISTINCT FROM ROW(c.title, c.instructions, c.done_means, c.due_on, c.sprint_id, c.anchor_kind, c.anchor_id, c.result, c.files_url, c.on_brand_plan,
         c.parent_id, c.description_md, c.start_on, c.estimate_minutes, c.goal_id, c.in_backlog) THEN
    v_cats := v_cats || 'updated'::text;
  END IF;
  -- #4255: the plan is the card's subtasks.
  IF p_changes ? 'plan' AND n.plan IS DISTINCT FROM public.ops_plan_from_subtasks(c.id) THEN v_cats := v_cats || 'plan'::text; END IF;
  IF ROW(n.status, n.person_reason) IS DISTINCT FROM ROW(c.status, c.person_reason) THEN v_cats := v_cats || 'status'::text; END IF;
  IF ROW(n.blocked, n.blocked_kind, n.blocked_reason) IS DISTINCT FROM ROW(c.blocked, c.blocked_kind, c.blocked_reason) THEN
    v_cats := v_cats || CASE WHEN n.blocked THEN 'blocked' ELSE 'unblocked' END;
  END IF;

  UPDATE public.ops_work_cards SET title = n.title, instructions = n.instructions, done_means = n.done_means,
    status = n.status, person_reason = n.person_reason, files_url = n.files_url, on_brand_plan = n.on_brand_plan, blocked = n.blocked, blocked_kind = n.blocked_kind, blocked_reason = n.blocked_reason,
    anchor_kind = n.anchor_kind, anchor_id = n.anchor_id, due_on = n.due_on, due_source = n.due_source, sprint_id = n.sprint_id,
    parent_id = n.parent_id, description_md = n.description_md, start_on = n.start_on, estimate_minutes = n.estimate_minutes,  -- #4255
    goal_id = n.goal_id, in_backlog = n.in_backlog,
    plan = c.plan, result = n.result, started_at = n.started_at, working_by = n.working_by, working_via = n.working_via,
    working_chat = CASE WHEN v_status = 'doing' AND c.status <> 'doing' THEN v_chat
                        WHEN v_status = 'todo' AND c.status = 'doing' THEN NULL ELSE working_chat END,
    working_seen_at = CASE WHEN v_status = 'doing' AND c.status <> 'doing' AND v.via IS NOT NULL THEN clock_timestamp()
                           WHEN v_status = 'doing' AND c.status <> 'doing' THEN NULL
                           WHEN v_status = 'todo' AND c.status = 'doing' THEN NULL ELSE working_seen_at END
   WHERE id = c.id;
  v_owners := ARRAY(SELECT jsonb_array_elements_text(cl->'owners'));
  v_watchers := ARRAY(SELECT jsonb_array_elements_text(cl->'watchers'));
  v_people := public.ops_people_set(c.id, v_owners, v_watchers, v.actor_email, v.via);
  IF (v_people->>'changed')::boolean THEN v_cats := v_cats || 'people'::text; END IF;
  v_links_changed := public.ops_links_set(c.id, cl->'links', v.actor_email, v.via);
  IF v_links_changed THEN v_cats := v_cats || 'links'::text; END IF;
  IF 'plan' = ANY (v_cats) THEN PERFORM public.ops_plan_sync(c.id, cl->'plan', v.actor_email, v.via); END IF;  -- #4255
  IF p_changes ? 'github' THEN
    v_gh_changed := public.ops_github_set(c.id, cl->'github', v.actor_email, v.via);
    IF v_gh_changed THEN v_cats := v_cats || 'github'::text; END IF;
    -- #3980 W2 rework: a person changing what a waiting card waits for is logged by name.
    IF v_gh_changed AND c.blocked_kind = 'github' AND v.via IS NULL THEN
      PERFORM public.ops_log_write(v.actor_email, NULL, 'updated', 'info', c.id, 'work_card', c.id,
        format('%s changed what Card %s waits for: %s (was %s).', v_who, c.number, COALESCE(v_gh_list, 'nothing'), COALESCE(v_gh_cur, 'nothing')),
        jsonb_build_object('changed', '["github"]'::jsonb, 'from', v_gh_cur, 'to', v_gh_list, 'waiting', true));
    END IF;
  END IF;

  IF cardinality(v_cats) = 0 THEN
    SELECT * INTO n FROM public.ops_work_cards w WHERE w.id = c.id;
    v_out := jsonb_build_object('card', public.ops_card_json(n, v_today), 'event_id', NULL, 'changed', false);
    PERFORM public.ops_request_finish(v.actor_email, p_request_key, 'update', v_out);
    RETURN v_out;
  END IF;
  UPDATE public.ops_work_cards SET revision = revision + 1, updated_by = v.actor_email, updated_via = v.via, updated_at = now()
   WHERE id = c.id RETURNING * INTO n;
  v_action := CASE WHEN cardinality(v_cats) = 1 THEN v_cats[1] ELSE 'updated' END;
  v_event := public.ops_card_event(c.id, v.actor_email, v.via, v_action, CASE WHEN v_back THEN v_back_reason END, v_before, public.ops_card_snapshot(c.id), c.revision, n.revision);
  -- "Gia, Hal": the people taken off the card, by name, for the agent log.
  -- A name another teammate shares carries the address: "Gia <gia@...>".
  SELECT string_agg(public.ops_name(x.email)
           || CASE WHEN EXISTS (SELECT 1 FROM public.admin_team_directory() d
                                 WHERE d.status = 'active' AND d.email <> x.email
                                   AND lower(public.crm_display_name(d.email)) = lower(public.ops_name(x.email)))
                   THEN ' <' || x.email || '>' ELSE '' END, ', ' ORDER BY x.ord) INTO v_removed_words
    FROM jsonb_array_elements_text(COALESCE(v_people->'removed', '[]'::jsonb)) WITH ORDINALITY AS x(email, ord);
  PERFORM public.ops_notify_people(c.id, v_event, ARRAY(SELECT jsonb_array_elements_text(v_people->'new_owners')), v.actor_email,
    format('%s added you as owner: %s', v_who, n.title));
  PERFORM public.ops_notify_people(c.id, v_event, ARRAY(SELECT jsonb_array_elements_text(v_people->'new_watchers')), v.actor_email,
    format('%s added you as watcher: %s', v_who, n.title));
  -- An agent that takes someone off a card tells them: who, which agent, and
  -- the card (the notice links to it). Guardrail, not a bottleneck.
  IF v.via IN ('claude', 'codex') THEN
    PERFORM public.ops_notify_people(c.id, v_event, ARRAY(SELECT jsonb_array_elements_text(v_people->'removed')), v.actor_email,
      format('%s took you off this card: %s', v_who, n.title));
  END IF;
  -- #4270: a card that gets a Send, Spend or Publish tag stays in its column
  -- and waits for a person; owners and watchers are told.
  IF n.person_reason IS NOT NULL AND c.person_reason IS NULL THEN
    PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, NULL), v.actor_email,
      -- #4270 rework (P3-4): the tag's own words, never "needs a person".
      format('%s: %s · %s', v_who, n.title, CASE n.person_reason WHEN 'send' THEN 'You send' WHEN 'spend' THEN 'You spend' WHEN 'publish' THEN 'You publish' ELSE 'Needs your OK' END));
    PERFORM public.ops_log_write(v.actor_email, v.via, 'needs_person', 'info', c.id, 'work_card', c.id,
      format('Card %s is tagged %s: %s', n.number, CASE n.person_reason WHEN 'send' THEN 'Send' WHEN 'spend' THEN 'Spend' WHEN 'publish' THEN 'Publish' ELSE 'Needs your OK' END, n.title), jsonb_build_object('reason', n.person_reason));
  ELSIF v_back THEN
    -- Wave 2: told and logged when a card's tag comes off.
    PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, NULL), v.actor_email,
      format('%s took the %s tag off %s%s', v_who, CASE c.person_reason WHEN 'send' THEN 'Send' WHEN 'spend' THEN 'Spend' WHEN 'publish' THEN 'Publish' ELSE 'Needs your OK' END, n.title,
        COALESCE(': ' || v_back_reason, '')));
    PERFORM public.ops_log_write(v.actor_email, v.via, 'updated', 'info', c.id, 'work_card', c.id,
      format('Card %s no longer has its %s tag%s', n.number,
        CASE c.person_reason WHEN 'send' THEN 'Send' WHEN 'spend' THEN 'Spend' WHEN 'publish' THEN 'Publish' ELSE 'Needs your OK' END,
        COALESCE(': ' || v_back_reason, '.')),
      jsonb_build_object('changed', to_jsonb(v_cats), 'from', c.person_reason, 'to', n.status, 'reason', v_back_reason));
  ELSIF v.via IS NOT NULL THEN
    PERFORM public.ops_log_write(v.actor_email, v.via,
      CASE v_action WHEN 'plan' THEN 'step' WHEN 'blocked' THEN 'blocked' WHEN 'unblocked' THEN 'unblocked' ELSE 'updated' END, 'ok', c.id, 'work_card', c.id,
      CASE WHEN v_action = 'plan' THEN format('Plan on Card %s: %s of %s steps done.', n.number,
             (SELECT count(*) FROM jsonb_array_elements(n.plan) s WHERE s->>'status' = 'done'), jsonb_array_length(n.plan))
           WHEN v_action = 'blocked' THEN format('Card %s blocked: %s', n.number, n.blocked_reason)
           -- #3980 rework 2: a removal says who was taken off, not "Updated".
           WHEN v_action = 'people' AND v_removed_words IS NOT NULL
                AND jsonb_array_length(v_people->'new_owners') = 0 AND jsonb_array_length(v_people->'new_watchers') = 0
             THEN format('Took %s off Card %s: %s', v_removed_words, n.number, n.title)
           WHEN v_removed_words IS NOT NULL THEN format('Updated Card %s: %s. Took %s off it.', n.number, n.title, v_removed_words)
           ELSE format('Updated Card %s: %s', n.number, n.title) END, jsonb_build_object('changed', to_jsonb(v_cats)));
  END IF;
  v_out := jsonb_build_object('card', public.ops_card_json(n, v_today), 'event_id', v_event, 'changed', true);
  PERFORM public.ops_request_finish(v.actor_email, p_request_key, 'update', v_out);
  RETURN v_out;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'invalid_card: An open card already has this title. Update that card instead.' USING ERRCODE = '22023';
END;

$function$
;
CREATE OR REPLACE FUNCTION public.ops_work_add(p_items jsonb, p_request_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v record; v_today date := public.ops_today(NULL); v_replay jsonb; v_item jsonb; v_idx integer := 0; v_rows jsonb := '[]'::jsonb;
  v_chk jsonb; cl jsonb; c public.ops_work_cards; v_event uuid; v_gate jsonb; v_added integer := 0; v_refused integer := 0;
  v_dups integer := 0; v_out jsonb; v_fields text; v_owners text[]; v_watchers text[]; v_ex_id uuid; v_ex_number bigint; v_ex_title text; v_who text;
  v_quick boolean; v_host_name text; v_source text; -- #4270 W2: a quick add from a host card
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9_-]{8,80}$' THEN
    RAISE EXCEPTION 'request_key_required: Send a request key of 8 to 80 letters, digits, - or _, new for a new request and unchanged for a repeat.' USING ERRCODE = '22023';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invalid_cards: Send a list of 1 to 50 cards.' USING ERRCODE = '22023';
  END IF;
  v_replay := public.ops_request_begin(v.actor_email, p_request_key || '-add', 'add', p_items);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_who := public.ops_actor_label(v.actor_email, v.via);
  -- #4270 W2 (D15): a person decides what hosts see. An agent never adds a
  -- card the host can see on their plan.
  IF v.via IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e
                                    WHERE jsonb_typeof(e) = 'object' AND e->'on_brand_plan' = 'true'::jsonb) THEN
    RAISE EXCEPTION 'people_only: A person decides what hosts see.' USING ERRCODE = '42501';
  END IF;

  FOR v_item IN SELECT e.value FROM jsonb_array_elements(p_items) WITH ORDINALITY e(value, ord) ORDER BY e.ord LOOP
    -- #4270 W2 (C-6): a quick add from a host card says what, who and when;
    -- Mingla writes the instructions and done means, and staff can edit them.
    v_quick := jsonb_typeof(v_item) = 'object' AND v_item->'quick' = 'true'::jsonb;
    v_source := NULL;
    IF jsonb_typeof(v_item) = 'object' AND v_item ? 'quick' THEN
      v_item := v_item - 'quick';
    END IF;
    IF v_quick THEN
      v_source := 'host_card';
      SELECT r.name INTO v_host_name FROM public.crm_records r
       WHERE r.deleted_at IS NULL AND r.pipeline = 'hosts'
         AND r.id = (SELECT CASE WHEN public.ops_is_uuid(l->>'id') THEN (l->>'id')::uuid END
                       FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_item->'links') = 'array' THEN v_item->'links' ELSE '[]'::jsonb END) l
                      WHERE l->>'kind' = 'host' LIMIT 1);
      IF NOT (v_item ? 'instructions') OR jsonb_typeof(v_item->'instructions') <> 'string' OR btrim(v_item->>'instructions') = '' THEN
        v_item := v_item || jsonb_build_object('instructions',
          format('Added by %s from %s''s host card.', v_who, COALESCE(v_host_name, 'a host')));
      END IF;
      IF NOT (v_item ? 'done_means') OR jsonb_typeof(v_item->'done_means') <> 'string' OR btrim(v_item->>'done_means') = '' THEN
        v_item := v_item || jsonb_build_object('done_means',
          CASE WHEN v_item->'on_brand_plan' = 'true'::jsonb THEN 'Done and the host is told in the Brand group.' ELSE 'Done with proof on this card.' END);
      END IF;
    END IF;
    v_chk := public.ops_validate_card(v_item, 'add', v.actor_email, v_today);
    IF jsonb_array_length(v_chk->'fixes') > 0 THEN
      SELECT string_agg(DISTINCT public.ops_field_words(f->>'field'), ', ') INTO v_fields FROM jsonb_array_elements(v_chk->'fixes') f;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('index', v_idx, 'status', 'refused', 'fixes', v_chk->'fixes',
        'title', v_chk->'clean'->'title'));
      PERFORM public.ops_log_write(v.actor_email, v.via, 'card_refused', 'stopped', NULL, NULL, NULL,
        format('Card not added (%s): %s to fix.', COALESCE(v_chk->'clean'->>'title', 'no title'), v_fields),
        jsonb_build_object('fields', (SELECT jsonb_agg(DISTINCT f->>'field') FROM jsonb_array_elements(v_chk->'fixes') f)));
      v_refused := v_refused + 1;
    ELSIF v_chk->'duplicate' IS NOT NULL AND jsonb_typeof(v_chk->'duplicate') = 'object' THEN
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('index', v_idx, 'status', 'duplicate', 'existing', v_chk->'duplicate',
        'message', format('An open card already does this: "%s" (Card %s). Update that card instead.', v_chk->'duplicate'->>'title', v_chk->'duplicate'->>'number')));
      PERFORM public.ops_log_write(v.actor_email, v.via, 'card_refused', 'stopped', (v_chk->'duplicate'->>'id')::uuid, 'work_card', (v_chk->'duplicate'->>'id')::uuid,
        format('Card not added: it repeats Card %s.', v_chk->'duplicate'->>'number'), '{}'::jsonb);
      v_dups := v_dups + 1;
    ELSIF v.via IS NOT NULL AND v_chk->'clean'->>'parent_id' IS NOT NULL
          AND NOT public.ops_is_person_on((v_chk->'clean'->>'parent_id')::uuid, v.actor_email, ARRAY['owner']) THEN
      -- #4255: an agent adds subtasks only under a card its person owns.
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('index', v_idx, 'status', 'refused',
        'fixes', jsonb_build_array(jsonb_build_object('field', 'parent', 'message', 'Your person is not an owner of the parent card. Add a note there instead, or ask an owner.')),
        'title', v_chk->'clean'->'title'));
      v_refused := v_refused + 1;
    ELSE
      cl := v_chk->'clean';
      v_owners := ARRAY(SELECT jsonb_array_elements_text(cl->'owners'));
      v_watchers := ARRAY(SELECT jsonb_array_elements_text(cl->'watchers'));
      v_gate := CASE WHEN cl->>'kind' = 'promo' THEN public.ops_promo_gate(cl->'anchor', v_today) END;
      BEGIN
        INSERT INTO public.ops_work_cards (title, instructions, done_means, status, blocked, blocked_kind, blocked_reason, person_reason, files_url,
          on_brand_plan, brand_plan_source, kind, kit_step, anchor_kind, anchor_id, due_on, due_source, sprint_id, plan, created_by, created_via, updated_by, updated_via, request_key,
          parent_id, description_md, start_on, estimate_minutes, goal_id, in_backlog)  -- #4255
        VALUES (cl->>'title', cl->>'instructions', cl->>'done_means',
          'todo', -- #4270: a tagged card waits in To do; the tag is person_reason
          COALESCE((v_gate->>'blocked')::boolean, false),
          CASE WHEN COALESCE((v_gate->>'blocked')::boolean, false) THEN v_gate->>'kind' END,
          CASE WHEN COALESCE((v_gate->>'blocked')::boolean, false) THEN v_gate->>'reason' END,
          cl->>'person_reason', cl->>'files_url', COALESCE((cl->>'on_brand_plan')::boolean, false), v_source, cl->>'kind', (cl->>'kit_step')::integer, cl->>'anchor_kind', (cl->>'anchor_id')::uuid,
          -- #4255: a subtask is in its parent's sprint; the plan is subtasks
          (cl->>'due_on')::date, cl->>'due_source', COALESCE((cl->>'parent_sprint_id')::uuid, public.ops_sprint_for((cl->>'due_on')::date, v_today)), '[]'::jsonb,
          v.actor_email, v.via, v.actor_email, v.via, p_request_key || '-i' || v_idx,
          (cl->>'parent_id')::uuid, cl->>'description', (cl->>'start_on')::date, (cl->>'estimate_minutes')::integer,
          (cl->>'goal_id')::uuid, COALESCE((cl->>'in_backlog')::boolean, false))
        RETURNING * INTO c;
        PERFORM public.ops_people_set(c.id, v_owners, v_watchers, v.actor_email, v.via);
        PERFORM public.ops_links_set(c.id, cl->'links', v.actor_email, v.via);
        PERFORM public.ops_plan_sync(c.id, cl->'plan', v.actor_email, v.via);  -- #4255
        v_event := public.ops_card_event(c.id, v.actor_email, v.via, 'added', NULL, NULL, public.ops_card_snapshot(c.id), NULL, c.revision);
        IF public.ops_github_set(c.id, cl->'github', v.actor_email, v.via) THEN
          PERFORM public.ops_card_event(c.id, v.actor_email, v.via, 'github',
            'GitHub: ' || (SELECT string_agg('#' || (g->>'number'), ', ') FROM jsonb_array_elements(cl->'github') g), NULL, NULL, c.revision, c.revision);
        END IF;
        PERFORM public.ops_notify_people(c.id, v_event, v_owners, v.actor_email, format('%s added you as owner: %s', v_who, c.title));
        PERFORM public.ops_notify_people(c.id, v_event, v_watchers, v.actor_email, format('%s added you as watcher: %s', v_who, c.title));
        PERFORM public.ops_log_write(v.actor_email, v.via, 'card_added', 'ok', c.id, 'work_card', c.id,
          format('Added Card %s: %s', c.number, c.title), jsonb_build_object('owners', cardinality(v_owners), 'watchers', cardinality(v_watchers)));
        IF c.person_reason IS NOT NULL THEN
          PERFORM public.ops_log_write(v.actor_email, v.via, 'needs_person', 'info', c.id, 'work_card', c.id,
            format('Card %s is tagged %s: %s', c.number, CASE c.person_reason WHEN 'send' THEN 'Send' WHEN 'spend' THEN 'Spend' WHEN 'publish' THEN 'Publish' ELSE 'Needs your OK' END, c.title), jsonb_build_object('reason', c.person_reason));
        END IF;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object('index', v_idx, 'status', 'added', 'card', public.ops_card_json(c, v_today)));
        v_added := v_added + 1;
      EXCEPTION WHEN unique_violation THEN
        SELECT w.id, w.number, w.title INTO v_ex_id, v_ex_number, v_ex_title FROM public.ops_work_cards w
         WHERE w.archived_at IS NULL AND ((w.title_key = public.crm_name_key(cl->>'title') AND w.status <> 'done')
            OR (w.anchor_kind = cl->>'anchor_kind' AND w.anchor_id = (cl->>'anchor_id')::uuid AND w.kit_step = (cl->>'kit_step')::integer))
         LIMIT 1;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object('index', v_idx, 'status', 'duplicate',
          'existing', jsonb_build_object('id', v_ex_id, 'number', v_ex_number, 'title', v_ex_title),
          'message', format('An open card already does this: "%s" (Card %s). Update that card instead.', v_ex_title, v_ex_number)));
        v_dups := v_dups + 1;
      END;
    END IF;
    v_idx := v_idx + 1;
  END LOOP;
  v_out := jsonb_build_object('results', v_rows, 'added', v_added, 'refused', v_refused, 'duplicate', v_dups, 'replayed', false);
  PERFORM public.ops_request_finish(v.actor_email, p_request_key || '-add', 'add', v_out);
  RETURN v_out;
EXCEPTION WHEN others THEN
  IF SQLERRM ~ '^[a-z_]+: ' THEN RAISE; END IF;
  RAISE WARNING 'ops_work_add: request stopped (% %)', SQLSTATE, SQLERRM;
  RAISE EXCEPTION 'try_again: Something went wrong on our side, so nothing in this request was added. Send the same request again.' USING ERRCODE = 'PT409';
END;
$function$
;
CREATE OR REPLACE FUNCTION public.ops_auto_card_upsert(p_auto_key text, p_item jsonb, p_kind text, p_anchor jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c_actor constant text := 'system@usemingla.com'; v_today date := public.ops_today(NULL); v_item jsonb; v_chk jsonb; cl jsonb;
  c public.ops_work_cards; v_event uuid; v_owners text[]; v_watchers text[]; v_existing uuid;
BEGIN
  IF p_auto_key IS NULL OR p_auto_key !~ '^[a-z_]+:[A-Za-z0-9:_-]{1,120}$' THEN
    RAISE EXCEPTION 'invalid_auto_key: An automatic card needs a key like eng_no_issue:pr-12.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ops_auto_card:' || p_auto_key, 0));
  SELECT w.id INTO v_existing FROM public.ops_work_cards w
   WHERE w.auto_key = p_auto_key AND w.archived_at IS NULL AND w.status <> 'done' LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('status', 'kept', 'id', v_existing); END IF;
  IF EXISTS (SELECT 1 FROM public.ops_work_cards w WHERE w.auto_key = p_auto_key AND w.status = 'done'
              AND w.close_kind IN ('done','already_done','declined') AND w.closed_at > now() - interval '14 days') THEN
    RETURN jsonb_build_object('status', 'kept', 'id', NULL);
  END IF;
  v_item := COALESCE(p_item, '{}'::jsonb) || jsonb_build_object('kind', COALESCE(p_kind, 'task'));
  IF p_anchor IS NOT NULL AND jsonb_typeof(p_anchor) = 'object' THEN v_item := v_item || jsonb_build_object('anchor', p_anchor); END IF;
  v_chk := public.ops_validate_card(v_item, 'auto', c_actor, v_today);
  IF jsonb_array_length(v_chk->'fixes') > 0 THEN
    RAISE WARNING 'ops_auto_card_upsert: % refused (%)', p_auto_key, (SELECT string_agg(f->>'message', ' ') FROM jsonb_array_elements(v_chk->'fixes') f);
    RETURN jsonb_build_object('status', 'refused', 'fixes', v_chk->'fixes');
  END IF;
  IF v_chk->'duplicate' IS NOT NULL AND jsonb_typeof(v_chk->'duplicate') = 'object' THEN
    RETURN jsonb_build_object('status', 'duplicate', 'existing', v_chk->'duplicate');
  END IF;
  cl := v_chk->'clean';
  v_owners := ARRAY(SELECT jsonb_array_elements_text(cl->'owners'));
  v_watchers := ARRAY(SELECT jsonb_array_elements_text(cl->'watchers'));
  INSERT INTO public.ops_work_cards (title, instructions, done_means, status, person_reason, kind, kit_step, anchor_kind, anchor_id, due_on, due_source,
    sprint_id, plan, created_by, created_via, updated_by, updated_via, auto_key)
  VALUES (cl->>'title', cl->>'instructions', cl->>'done_means',
    'todo', cl->>'person_reason', cl->>'kind', (cl->>'kit_step')::integer,
    cl->>'anchor_kind', (cl->>'anchor_id')::uuid, (cl->>'due_on')::date, cl->>'due_source',
    public.ops_sprint_ensure(v_today), '[]'::jsonb, c_actor, 'system', c_actor, 'system', p_auto_key)
  RETURNING * INTO c;
  PERFORM public.ops_people_set(c.id, v_owners, v_watchers, c_actor, NULL);
  PERFORM public.ops_links_set(c.id, cl->'links', c_actor, NULL);
  PERFORM public.ops_github_set(c.id, cl->'github', c_actor, NULL);
  PERFORM public.ops_plan_sync(c.id, cl->'plan', c_actor, 'system');  -- #4255: the plan is subtasks
  v_event := public.ops_card_event(c.id, c_actor, 'system', 'added', NULL, NULL, public.ops_card_snapshot(c.id), NULL, c.revision);
  PERFORM public.ops_log_write(c_actor, 'system', 'auto_added', 'info', c.id, 'work_card', c.id,
    format('Mingla added Card %s: %s', c.number, c.title), jsonb_build_object('auto_key', p_auto_key, 'owners', cardinality(v_owners)));
  PERFORM public.ops_notify_people(c.id, v_event, v_owners || v_watchers, c_actor, format('Mingla added: %s', c.title));
  RETURN jsonb_build_object('status', 'added', 'id', c.id, 'number', c.number);
END;
$$;
CREATE OR REPLACE FUNCTION public.ops_work_list(p_query jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
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
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  SELECT k INTO v_bad FROM jsonb_object_keys(q) k
   WHERE k NOT IN ('status','who','owner','event_id','expected_id','record_id','week','q','done_days','today','limit',
                   'closed_since','closed_until','offset','per_status','tz','subtasks','parent_id','status_id','goal_id','backlog') ORDER BY k LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '%', format('invalid_query: The board cannot filter by "%s". It takes status, who, owner, event_id, expected_id, record_id, week, q, done_days, closed_since, closed_until, today, limit, offset, per_status, tz, subtasks, parent_id, status_id, goal_id and backlog.', left(v_bad, 40)) USING ERRCODE = '22023';
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
  SELECT COALESCE(jsonb_agg(public.ops_card_json(w, v_today) ORDER BY u.ord), '[]'::jsonb) INTO v_cards
    FROM unnest(v_pick) WITH ORDINALITY u(id, ord)
    JOIN public.ops_work_cards w ON w.id = u.id;
  RETURN jsonb_build_object('cards', v_cards, 'total', v_total, 'truncated', v_cut, 'counts', v_counts,
    'columns', v_columns, 'status_columns', v_status_columns, 'subtasks', v_subtasks, 'per_status', v_per_status, 'limit', v_limit,
    'offset', v_offset, 'done_since', CASE WHEN v_done_default AND v_week IS NULL AND v_closed_since IS NULL AND v_closed_until IS NULL THEN v_week_start END,
    'sprint', public.ops_sprint_json(COALESCE(v_week, public.ops_monday(v_today))), 'today', v_today);
END;
$$;
CREATE OR REPLACE FUNCTION public.ops_work_get(p_id uuid, p_today date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; c public.ops_work_cards; v_today date := public.ops_today(p_today);
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  SELECT * INTO c FROM public.ops_work_cards w WHERE w.id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That card is not here.' USING ERRCODE = 'P0002'; END IF;
  -- #4255: the card's subtasks, files and breadcrumb come with it.
  RETURN jsonb_build_object('subtasks', public.ops_subtasks_json(c.id, v_today), 'files', public.ops_files_json(c.id),
                            'ancestors', public.ops_card_ancestors(c.id)) || jsonb_build_object(
    'card', public.ops_card_json(c, v_today),
    'events', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'at', e.at, 'actor_name', public.ops_name(e.actor_email),
        'via', e.via, 'action', e.action, 'body', e.body, 'undone', e.undone_at IS NOT NULL,
        'undoable', (v.via IS NULL AND e.actor_email = v.actor_email AND e.at > clock_timestamp() - interval '60 seconds'
                     AND e.undone_at IS NULL AND c.revision = e.to_revision AND c.archived_at IS NULL
                     AND e.action IN ('updated','started','status','closed','pushed_back','reopened','people','links','plan','blocked','unblocked')))
        ORDER BY e.at DESC)
      FROM (SELECT * FROM public.ops_work_events x WHERE x.card_id = c.id ORDER BY x.at DESC LIMIT 100) e), '[]'::jsonb),
    'log', COALESCE((SELECT jsonb_agg(public.ops_log_entry_json(l) ORDER BY l.id DESC)
      FROM (SELECT * FROM public.ops_agent_log x WHERE x.card_id = c.id ORDER BY x.id DESC LIMIT 50) l), '[]'::jsonb),
    'claims', COALESCE((SELECT jsonb_agg(public.ops_claim_json(k) ORDER BY k.claimed_at)
      FROM public.ops_claims k
     WHERE k.released_at IS NULL AND k.last_seen_at >= clock_timestamp() - interval '30 minutes'
       AND (k.card_id = c.id OR (k.target_kind = 'work_card' AND k.target_id = c.id)
            OR EXISTS (SELECT 1 FROM public.ops_work_links l WHERE l.card_id = c.id AND l.target_id = k.target_id
                         AND k.target_kind = CASE l.kind WHEN 'host' THEN 'crm_record' WHEN 'creator' THEN 'crm_record'
                                                         WHEN 'card' THEN 'work_card' ELSE l.kind END))), '[]'::jsonb));
END;
$$;
CREATE OR REPLACE FUNCTION public.ops_work_undo(p_event_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; e public.ops_work_events; c public.ops_work_cards; r public.ops_work_cards; n public.ops_work_cards; v_now_snap jsonb;
        v_today date := public.ops_today(NULL);
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF v.via IS NOT NULL THEN RAISE EXCEPTION 'people_only: Only a person can undo a change.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO e FROM public.ops_work_events x WHERE x.id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'undo_expired: That change can no longer be undone.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO c FROM public.ops_work_cards w WHERE w.id = e.card_id AND w.archived_at IS NULL FOR UPDATE;
  IF NOT FOUND OR e.actor_email <> v.actor_email OR e.via IS NOT NULL OR e.undone_at IS NOT NULL
     OR e.at <= clock_timestamp() - interval '60 seconds' OR c.revision IS DISTINCT FROM e.to_revision OR e.before IS NULL
     OR e.action NOT IN ('updated','started','status','closed','pushed_back','reopened','people','links','plan','blocked','unblocked') THEN
    RAISE EXCEPTION 'undo_expired: That change can no longer be undone.' USING ERRCODE = '22023';
  END IF;
  v_now_snap := public.ops_card_snapshot(c.id);
  r := jsonb_populate_record(c, e.before->'fields');
  BEGIN
    UPDATE public.ops_work_cards SET title = r.title, instructions = r.instructions, done_means = r.done_means,
      -- #4270: a snapshot from before the move reads person as To do (the move also bumped every revision).
      status = CASE WHEN r.status = 'person' THEN 'todo' ELSE r.status END, files_url = r.files_url,
      -- #4270 W2 rework (P3-5): Undo puts back Host can see this. Undo is a
      -- person's (an agent never undoes), so D15 still holds.
      on_brand_plan = r.on_brand_plan,
      -- The words hosts saw go back with the stored title (W4 retest P3 4).
      plan_title = r.plan_title,
      blocked = r.blocked, blocked_kind = r.blocked_kind, blocked_reason = r.blocked_reason, person_reason = r.person_reason,
      anchor_kind = r.anchor_kind, anchor_id = r.anchor_id, due_on = r.due_on, due_source = r.due_source, sprint_id = r.sprint_id,
      plan = r.plan, result = r.result, proof = r.proof, close_kind = r.close_kind, close_reason = r.close_reason,
      closed_at = r.closed_at, closed_by = r.closed_by, closed_via = r.closed_via, started_at = r.started_at,
      working_by = r.working_by, working_via = r.working_via, override_reason = r.override_reason, override_by = r.override_by,
      override_at = r.override_at,
      -- #4255: the column (a snapshot from before columns reads its group's first column), the tree and the new fields
      status_id = CASE WHEN e.before->'fields' ? 'status_id' THEN r.status_id
                       ELSE public.ops_status_default(CASE WHEN r.status = 'person' THEN 'todo' ELSE r.status END) END,
      parent_id = r.parent_id, description_md = r.description_md, start_on = r.start_on, estimate_minutes = r.estimate_minutes,
      goal_id = r.goal_id, in_backlog = r.in_backlog,
      revision = revision + 1, updated_by = v.actor_email, updated_via = NULL, updated_at = now()
     WHERE id = c.id RETURNING * INTO n;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'undo_expired: That change can no longer be undone: another open card now has this title.' USING ERRCODE = '22023';
  WHEN sqlstate '22023' OR sqlstate 'P0002' THEN
    RAISE EXCEPTION 'undo_expired: That change can no longer be undone: the board changed since (a column, a parent card or its subtasks).' USING ERRCODE = '22023';
  END;
  DELETE FROM public.ops_work_people p WHERE p.card_id = c.id;
  INSERT INTO public.ops_work_people (card_id, email, role, added_by, added_via, added_at)
  SELECT c.id, x->>'email', x->>'role', x->>'added_by', x->>'added_via', (x->>'added_at')::timestamptz FROM jsonb_array_elements(e.before->'people') x;
  DELETE FROM public.ops_work_links l WHERE l.card_id = c.id;
  INSERT INTO public.ops_work_links (card_id, kind, target_id, label, added_by, added_via, added_at)
  SELECT c.id, x->>'kind', (x->>'id')::uuid, x->>'label', x->>'added_by', x->>'added_via', (x->>'added_at')::timestamptz FROM jsonb_array_elements(e.before->'links') x;
  UPDATE public.ops_work_events SET undone_at = clock_timestamp(), undone_by = v.actor_email WHERE id = e.id;
  PERFORM public.ops_card_event(c.id, v.actor_email, NULL, 'undone', NULL, v_now_snap, public.ops_card_snapshot(c.id), c.revision, n.revision);
  RETURN jsonb_build_object('card', public.ops_card_json(n, v_today));
END;
$$;
CREATE OR REPLACE FUNCTION public.ops_config(p_today date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; v_today date := public.ops_today(p_today); v_mon date := public.ops_monday(public.ops_today(p_today));
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  RETURN jsonb_build_object(
    'today', v_today,
    'team', COALESCE((SELECT jsonb_agg(jsonb_build_object('email', d.email, 'name', public.ops_name(d.email), 'role', d.role,
        'role_label', CASE d.role WHEN 'owner' THEN 'Owner' WHEN 'admin' THEN 'Admin' WHEN 'growth' THEN 'Sales and marketing'
                                  WHEN 'partner' THEN 'Founding partner' ELSE d.role END,
        'open_cards', (SELECT count(*) FROM public.ops_work_people p JOIN public.ops_work_cards w ON w.id = p.card_id
                        WHERE p.email = d.email AND p.role = 'owner' AND w.status <> 'done' AND w.archived_at IS NULL))
        ORDER BY (d.role = 'owner') DESC, d.email) FROM public.admin_team_directory() d WHERE d.status = 'active'), '[]'::jsonb),
    'statuses', '[{"id":"todo","label":"To do"},{"id":"doing","label":"In progress"},{"id":"done","label":"Done"}]'::jsonb,
    'columns', public.ops_status_rows(false),  -- #4255
    'person_reasons', '[{"id":"send","label":"You send"},{"id":"spend","label":"You spend"},{"id":"publish","label":"You publish"},{"id":"other","label":"Needs your OK"}]'::jsonb,
    'kit', public.ops_kit_template(),
    'limits', public.ops_limits(),
    'sprint', jsonb_build_object('current', public.ops_sprint_json(v_mon), 'next', public.ops_sprint_json(v_mon + 7)),
    'settings', public.ops_settings_get(),
    'me', jsonb_build_object('email', v.actor_email, 'name', public.ops_name(v.actor_email), 'role', public.admin_team_role(),
      'can_archive', public.is_admin_user(), 'can_override', public.is_admin_user(),
      'can_columns', COALESCE(v.via IS NULL AND public.is_admin_user(), false),  -- #4255
      'can_convert', COALESCE(public.admin_team_role() = 'owner', false),
      'can_profiles', COALESCE(v.via IS NULL AND public.admin_team_role() = 'owner', false)));
END;
$$;
-- ---------------------------------------------------------------------------
-- 4. Moving a card between columns, and subtasks.
-- ---------------------------------------------------------------------------

-- Drop a card in a column. Into a Closed column it runs the close-with-proof
-- rules of ops_work_close (proof and result as there; close_children closes
-- the open subtasks too). Out of a Closed column it runs the reopen rules.
-- Between Not started and Active it runs ops_work_update's status rules.
-- Between two columns of one group it only changes the column. Always the
-- card's revision: a stale one is refused with PT409.
CREATE FUNCTION public.ops_work_move(p_id uuid, p_status_id uuid, p_expected_revision bigint, p_proof jsonb DEFAULT NULL,
                                     p_result text DEFAULT NULL, p_close_children boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; c public.ops_work_cards; n public.ops_work_cards; s public.ops_work_statuses; v_out jsonb; v_rev bigint;
        v_today date := public.ops_today(NULL); v_before jsonb; v_event uuid;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  SELECT * INTO s FROM public.ops_work_statuses x WHERE x.id = p_status_id;
  IF NOT FOUND OR s.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'not_found: That column is no longer on the board. Reload it, then try again.' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_revision IS NULL THEN
    RAISE EXCEPTION 'stale_write: This card changed since you opened it. Reload it, then try again.' USING ERRCODE = 'PT409';
  END IF;
  c := public.ops_card_lock(p_id, p_expected_revision);
  IF c.status_id = s.id THEN
    RETURN jsonb_build_object('card', public.ops_card_json(c, v_today), 'event_id', NULL, 'changed', false);
  END IF;
  IF s.grp = 'done' THEN
    IF COALESCE(p_close_children, false) THEN PERFORM set_config('ops.close_children', 'on', true); END IF;
    v_out := public.ops_work_close(p_id, COALESCE(p_proof, '[]'::jsonb), p_result, p_expected_revision);
    PERFORM set_config('ops.close_children', '', true);
  ELSIF c.status = 'done' THEN
    v_out := public.ops_work_reopen(p_id, NULL, p_expected_revision);
    IF s.grp = 'doing' THEN
      v_rev := (v_out->'card'->>'revision')::bigint;
      v_out := public.ops_work_update(p_id, '{"status":"doing"}'::jsonb, v_rev, NULL);
    END IF;
  ELSIF s.grp <> c.status THEN
    v_out := public.ops_work_update(p_id, jsonb_build_object('status', s.grp), p_expected_revision, NULL);
  ELSE
    -- Another column of the same group.
    PERFORM public.ops_agent_owns(c, v.actor_email, v.via);
    PERFORM public.ops_claim_assert('work_card', c.id, v.actor_email, v.via);
    IF v.via IS NOT NULL AND c.auto_key LIKE 'roadmap\_shipped:%' THEN
      RAISE EXCEPTION 'people_only: A person approves what hosts are told. Only a person moves this card.' USING ERRCODE = '42501';
    END IF;
    v_before := public.ops_card_snapshot(c.id);
    UPDATE public.ops_work_cards w SET status_id = s.id, revision = w.revision + 1, updated_by = v.actor_email, updated_via = v.via, updated_at = now()
     WHERE w.id = c.id RETURNING w.* INTO n;
    v_event := public.ops_card_event(c.id, v.actor_email, v.via, 'status', format('Moved to %s.', s.name), v_before, public.ops_card_snapshot(c.id), c.revision, n.revision);
    IF v.via IS NOT NULL THEN
      PERFORM public.ops_log_write(v.actor_email, v.via, 'updated', 'ok', c.id, 'work_card', c.id,
        format('Moved Card %s to %s: %s', n.number, s.name, n.title), jsonb_build_object('changed', '["status"]'::jsonb));
    END IF;
    v_out := jsonb_build_object('event_id', v_event);
  END IF;
  -- The group's rules put the card in the group's first column: now the one chosen.
  UPDATE public.ops_work_cards w SET status_id = s.id WHERE w.id = p_id AND w.status_id <> s.id AND w.status = s.grp;
  SELECT * INTO n FROM public.ops_work_cards w WHERE w.id = p_id;
  RETURN jsonb_build_object('card', public.ops_card_json(n, v_today), 'event_id', v_out->'event_id', 'changed', true);
END;
$$;

-- Add one subtask under a card. It is an add_work card with a parent: the
-- same checks, notices and request key; owners, instructions, a done-means
-- line and a due date may be left out (the parent's due date is used).
CREATE FUNCTION public.ops_subtask_add(p_parent_id uuid, p_item jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_item jsonb := CASE WHEN jsonb_typeof(p_item) = 'object' THEN p_item ELSE '{}'::jsonb END; v_out jsonb; v_row jsonb;
BEGIN
  IF p_parent_id IS NULL THEN
    RAISE EXCEPTION 'invalid_parent: Say which card this subtask belongs to.' USING ERRCODE = '22023';
  END IF;
  v_out := public.ops_work_add(jsonb_build_array((v_item - 'parent') || jsonb_build_object('parent', p_parent_id)), p_request_key);
  v_row := v_out->'results'->0;
  RETURN jsonb_build_object('status', v_row->>'status', 'subtask', v_row->'card', 'fixes', v_row->'fixes', 'existing', v_row->'existing',
                            'replayed', COALESCE((v_out->>'replayed')::boolean, false));
END;
$$;

-- Put a card's subtasks in a new order (all of them, once each). The
-- parent's revision is checked and goes up.
CREATE FUNCTION public.ops_subtask_reorder(p_parent_id uuid, p_ids uuid[], p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; c public.ops_work_cards; n public.ops_work_cards; v_live uuid[]; v_today date := public.ops_today(NULL); v_event uuid;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_expected_revision IS NULL THEN
    RAISE EXCEPTION 'stale_write: This card changed since you opened it. Reload it, then try again.' USING ERRCODE = 'PT409';
  END IF;
  c := public.ops_card_lock(p_parent_id, p_expected_revision);
  PERFORM public.ops_agent_owns(c, v.actor_email, v.via);
  v_live := ARRAY(SELECT w.id FROM public.ops_work_cards w WHERE w.parent_id = c.id AND w.archived_at IS NULL ORDER BY w.id);
  IF p_ids IS NULL OR cardinality(p_ids) <> cardinality(v_live)
     OR ARRAY(SELECT DISTINCT x FROM unnest(p_ids) x ORDER BY x) IS DISTINCT FROM v_live THEN
    RAISE EXCEPTION 'stale_write: The subtasks changed since you opened this card. Reload it, then try again.' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.ops_work_cards w SET position = (u.ord - 1)::integer
    FROM unnest(p_ids) WITH ORDINALITY u(id, ord) WHERE w.id = u.id AND w.position IS DISTINCT FROM (u.ord - 1)::integer;
  UPDATE public.ops_work_cards w SET revision = w.revision + 1, updated_by = v.actor_email, updated_via = v.via, updated_at = now()
   WHERE w.id = c.id RETURNING w.* INTO n;
  v_event := public.ops_card_event(c.id, v.actor_email, v.via, 'plan', 'Subtasks reordered.', NULL, NULL, c.revision, n.revision);
  RETURN jsonb_build_object('card', public.ops_card_json(n, v_today), 'subtasks', public.ops_subtasks_json(c.id, v_today), 'event_id', v_event);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Columns. Reading is for the whole team; changing is for full admins in
--    person (never an agent).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.ops_status_admin(p_actor_via text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_actor_via IS NOT NULL OR NOT COALESCE(public.is_admin_user(), false) THEN
    RAISE EXCEPTION 'forbidden: Only the owner or an admin can change the board''s columns.' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE FUNCTION public.ops_status_list(p_include_archived boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  RETURN jsonb_build_object('columns', public.ops_status_rows(COALESCE(p_include_archived, false)),
                            'can_change', COALESCE(v.via IS NULL AND public.is_admin_user(), false));
END;
$$;

CREATE FUNCTION public.ops_status_check_name(p_name text, p_self uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_name text := public.ops_one_line(p_name);
BEGIN
  IF v_name IS NULL OR char_length(v_name) NOT BETWEEN 1 AND 30 OR public.ops_has_control(v_name) THEN
    RAISE EXCEPTION 'invalid_column: Name the column in 1 to 30 characters.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ops_work_statuses s WHERE s.archived_at IS NULL AND lower(s.name) = lower(v_name) AND s.id IS DISTINCT FROM p_self) THEN
    RAISE EXCEPTION '%', format('duplicate_column: A column called "%s" is already on the board.', v_name) USING ERRCODE = '22023';
  END IF;
  RETURN v_name;
END;
$$;

CREATE FUNCTION public.ops_status_check_color(p_color text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_color IS NULL OR lower(btrim(p_color)) !~ '^#[0-9a-f]{6}$' THEN
    RAISE EXCEPTION 'invalid_column: A colour is # and six hex digits, such as #2f6fd6.' USING ERRCODE = '22023';
  END IF;
  RETURN lower(btrim(p_color));
END;
$$;

CREATE FUNCTION public.ops_status_add(p_name text, p_color text, p_grp text, p_position integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; s public.ops_work_statuses; v_name text; v_color text; v_pos integer; v_live integer;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  PERFORM public.ops_status_admin(v.via);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ops_work_statuses', 0));
  IF p_grp IS NULL OR p_grp NOT IN ('todo', 'doing', 'done') THEN
    RAISE EXCEPTION 'invalid_column: A column is Not started (todo), Active (doing) or Closed (done).' USING ERRCODE = '22023';
  END IF;
  v_name := public.ops_status_check_name(p_name, NULL);
  v_color := public.ops_status_check_color(p_color);
  SELECT count(*) INTO v_live FROM public.ops_work_statuses x WHERE x.archived_at IS NULL;
  IF v_live >= 20 THEN
    RAISE EXCEPTION 'too_many_columns: The board has 20 columns. Archive one first.' USING ERRCODE = '22023';
  END IF;
  -- Unless placed, a new column goes after the last column of its group.
  v_pos := COALESCE(p_position, (SELECT max(x.position) + 1 FROM public.ops_work_statuses x WHERE x.archived_at IS NULL AND x.grp = p_grp), v_live);
  v_pos := LEAST(GREATEST(v_pos, 0), v_live);
  UPDATE public.ops_work_statuses x SET position = x.position + 1 WHERE x.archived_at IS NULL AND x.position >= v_pos;
  INSERT INTO public.ops_work_statuses (name, color, grp, position, created_by, updated_by)
  VALUES (v_name, v_color, p_grp, v_pos, v.actor_email, v.actor_email) RETURNING * INTO s;
  PERFORM public.ops_status_renumber();
  SELECT * INTO s FROM public.ops_work_statuses x WHERE x.id = s.id;
  PERFORM public.ops_log_write(v.actor_email, NULL, 'updated', 'info', NULL, NULL, NULL,
    format('%s added the column %s.', public.ops_name(v.actor_email), v_name), jsonb_build_object('column', s.id));
  RETURN jsonb_build_object('column', public.ops_status_json(s), 'columns', public.ops_status_rows(false));
END;
$$;

CREATE FUNCTION public.ops_status_update(p_id uuid, p_changes jsonb, p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; s public.ops_work_statuses; v_bad text; v_name text; v_color text;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  PERFORM public.ops_status_admin(v.via);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ops_work_statuses', 0));
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid_changes: Send a new name or colour.' USING ERRCODE = '22023';
  END IF;
  IF p_changes ? 'grp' OR p_changes ? 'group' THEN
    RAISE EXCEPTION 'invalid_changes: A column keeps its group. Add a new column instead, then archive this one.' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(p_changes) k WHERE k NOT IN ('name', 'color') LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '%', format('unknown_field: A column change takes name and color, not "%s".', left(v_bad, 40)) USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM public.ops_work_statuses x WHERE x.id = p_id AND x.archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That column is no longer on the board.' USING ERRCODE = 'P0002'; END IF;
  IF p_expected_revision IS NULL OR s.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale_write: This column changed since you opened it. Reload it, then try again.' USING ERRCODE = 'PT409';
  END IF;
  v_name := CASE WHEN p_changes ? 'name' THEN public.ops_status_check_name(p_changes->>'name', s.id) ELSE s.name END;
  v_color := CASE WHEN p_changes ? 'color' THEN public.ops_status_check_color(p_changes->>'color') ELSE s.color END;
  IF v_name = s.name AND v_color = s.color THEN
    RETURN jsonb_build_object('column', public.ops_status_json(s), 'changed', false);
  END IF;
  UPDATE public.ops_work_statuses x SET name = v_name, color = v_color, revision = x.revision + 1, updated_by = v.actor_email, updated_at = now()
   WHERE x.id = s.id RETURNING * INTO s;
  RETURN jsonb_build_object('column', public.ops_status_json(s), 'changed', true);
END;
$$;

CREATE FUNCTION public.ops_status_move(p_id uuid, p_position integer, p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; s public.ops_work_statuses; v_live integer; v_pos integer;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  PERFORM public.ops_status_admin(v.via);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ops_work_statuses', 0));
  SELECT * INTO s FROM public.ops_work_statuses x WHERE x.id = p_id AND x.archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That column is no longer on the board.' USING ERRCODE = 'P0002'; END IF;
  IF p_expected_revision IS NULL OR s.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale_write: This column changed since you opened it. Reload it, then try again.' USING ERRCODE = 'PT409';
  END IF;
  IF p_position IS NULL THEN
    RAISE EXCEPTION 'invalid_column: Say where the column goes (0 is first).' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_live FROM public.ops_work_statuses x WHERE x.archived_at IS NULL;
  v_pos := LEAST(GREATEST(p_position, 0), v_live - 1);
  -- Take it out, close the gap, open the new place, put it there.
  UPDATE public.ops_work_statuses x SET position = x.position - 1 WHERE x.archived_at IS NULL AND x.position > s.position;
  UPDATE public.ops_work_statuses x SET position = x.position + 1 WHERE x.archived_at IS NULL AND x.id <> s.id AND x.position >= v_pos;
  UPDATE public.ops_work_statuses x SET position = v_pos, revision = x.revision + 1, updated_by = v.actor_email, updated_at = now()
   WHERE x.id = s.id;
  PERFORM public.ops_status_renumber();
  SELECT * INTO s FROM public.ops_work_statuses x WHERE x.id = p_id;
  RETURN jsonb_build_object('column', public.ops_status_json(s), 'columns', public.ops_status_rows(false));
END;
$$;

-- Archive a column. Its cards move to another live column of the same group
-- first (so no card changes group, and every group keeps a column).
CREATE FUNCTION public.ops_status_archive(p_id uuid, p_move_to uuid, p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; s public.ops_work_statuses; t public.ops_work_statuses; r record; n public.ops_work_cards; v_before jsonb; v_moved integer := 0;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  PERFORM public.ops_status_admin(v.via);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ops_work_statuses', 0));
  SELECT * INTO s FROM public.ops_work_statuses x WHERE x.id = p_id AND x.archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That column is no longer on the board.' USING ERRCODE = 'P0002'; END IF;
  IF p_expected_revision IS NULL OR s.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale_write: This column changed since you opened it. Reload it, then try again.' USING ERRCODE = 'PT409';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ops_work_statuses x WHERE x.archived_at IS NULL AND x.grp = s.grp AND x.id <> s.id) THEN
    RAISE EXCEPTION '%', format('last_column: %s is the only %s column. Add another %s column first.', s.name,
      CASE s.grp WHEN 'todo' THEN 'Not started' WHEN 'doing' THEN 'Active' ELSE 'Closed' END,
      CASE s.grp WHEN 'todo' THEN 'Not started' WHEN 'doing' THEN 'Active' ELSE 'Closed' END) USING ERRCODE = '22023';
  END IF;
  SELECT * INTO t FROM public.ops_work_statuses x WHERE x.id = p_move_to AND x.archived_at IS NULL;
  IF NOT FOUND OR t.id = s.id THEN
    RAISE EXCEPTION 'invalid_column: Pick the column this column''s cards move to.' USING ERRCODE = '22023';
  END IF;
  IF t.grp <> s.grp THEN
    RAISE EXCEPTION '%', format('invalid_column: Cards move to another %s column, so none of them changes group.',
      CASE s.grp WHEN 'todo' THEN 'Not started' WHEN 'doing' THEN 'Active' ELSE 'Closed' END) USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT w.id, w.revision FROM public.ops_work_cards w WHERE w.status_id = s.id AND w.archived_at IS NULL ORDER BY w.number FOR UPDATE LOOP
    v_before := public.ops_card_snapshot(r.id);
    UPDATE public.ops_work_cards w SET status_id = t.id, revision = w.revision + 1, updated_by = v.actor_email, updated_via = NULL, updated_at = now()
     WHERE w.id = r.id RETURNING w.* INTO n;
    PERFORM public.ops_card_event(r.id, v.actor_email, NULL, 'status', format('The column %s was archived: moved to %s.', s.name, t.name),
      v_before, public.ops_card_snapshot(r.id), r.revision, n.revision);
    v_moved := v_moved + 1;
  END LOOP;
  UPDATE public.ops_work_statuses x SET archived_at = now(), archived_by = v.actor_email, revision = x.revision + 1,
    updated_by = v.actor_email, updated_at = now() WHERE x.id = s.id RETURNING * INTO s;
  PERFORM public.ops_status_renumber();
  PERFORM public.ops_log_write(v.actor_email, NULL, 'updated', 'info', NULL, NULL, NULL,
    format('%s archived the column %s; %s cards moved to %s.', public.ops_name(v.actor_email), s.name, v_moved, t.name),
    jsonb_build_object('column', s.id, 'moved_to', t.id, 'moved', v_moved));
  RETURN jsonb_build_object('column', public.ops_status_json(s), 'moved', v_moved, 'columns', public.ops_status_rows(false));
END;
$$;
-- ---------------------------------------------------------------------------
-- 6. Files.
-- ---------------------------------------------------------------------------

-- The file types a card takes.
CREATE FUNCTION public.ops_file_mime_ok(p_kind text, p_mime text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE p_kind
    WHEN 'image' THEN p_mime IN ('image/jpeg','image/png','image/webp','image/gif','image/heic')
    WHEN 'document' THEN p_mime IN ('application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain','text/csv','application/vnd.apple.keynote','application/vnd.apple.numbers','application/vnd.apple.pages')
    ELSE false END
$$;

-- Add a file or a link to a card. A picture or document comes back with the
-- path to upload it to (the bucket only takes that path, from that person,
-- for 24 hours); it shows on the card once the upload is there. 25 MB per
-- file and 50 files per card.
CREATE FUNCTION public.ops_file_add(p_card_id uuid, p_file jsonb, p_request_key text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; c public.ops_work_cards; f public.ops_work_files; v_replay jsonb; v_kind text; v_name text; v_mime text; v_size bigint;
        v_url text; v_id uuid := gen_random_uuid(); v_safe text; v_out jsonb; v_bad text;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_file IS NULL OR jsonb_typeof(p_file) <> 'object' THEN
    RAISE EXCEPTION 'invalid_file: Send the file''s kind, name, type and size, or a link.' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(p_file) k WHERE k NOT IN ('kind','name','mime','size_bytes','url') LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '%', format('unknown_field: A file takes kind, name, mime, size_bytes and url, not "%s".', left(v_bad, 40)) USING ERRCODE = '22023';
  END IF;
  v_replay := public.ops_request_begin(v.actor_email, p_request_key, 'file', jsonb_build_object('card', p_card_id, 'file', p_file));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO c FROM public.ops_work_cards w WHERE w.id = p_card_id AND w.archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That card is no longer here.' USING ERRCODE = 'P0002'; END IF;
  IF v.via IS NOT NULL AND NOT public.ops_is_person_on(c.id, v.actor_email, ARRAY['owner','watcher']) THEN
    RAISE EXCEPTION 'not_your_card: Your person is not an owner or watcher of this card. Ask an owner to add them.' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM public.ops_work_files x WHERE x.card_id = c.id AND x.archived_at IS NULL) >= 50 THEN
    RAISE EXCEPTION 'too_many_files: A card holds 50 files. Remove one first, or share a folder link.' USING ERRCODE = '22023';
  END IF;
  v_kind := p_file->>'kind';
  IF v_kind IS NULL OR v_kind NOT IN ('image','document','link') THEN
    RAISE EXCEPTION 'invalid_file: A file is an image, a document or a link.' USING ERRCODE = '22023';
  END IF;
  IF v_kind = 'link' THEN
    v_url := btrim(COALESCE(p_file->>'url', ''));
    IF char_length(v_url) NOT BETWEEN 9 AND 2000 OR v_url !~ '^https://[^[:space:]]+$' OR public.ops_has_control(v_url) THEN
      RAISE EXCEPTION 'invalid_file: Links start with https:// and stay under 2,000 characters.' USING ERRCODE = '22023';
    END IF;
    v_name := COALESCE(public.ops_one_line(p_file->>'name'), substring(v_url FROM '^https://([^/?#]+)'), 'Link');
  ELSE
    v_name := public.ops_one_line(p_file->>'name');
    v_mime := lower(btrim(COALESCE(p_file->>'mime', '')));
    IF jsonb_typeof(p_file->'size_bytes') <> 'number' OR (p_file->>'size_bytes') !~ '^\d{1,12}$' THEN
      RAISE EXCEPTION 'invalid_file: Send the file''s size in bytes.' USING ERRCODE = '22023';
    END IF;
    v_size := (p_file->>'size_bytes')::bigint;
    IF v_size > 26214400 THEN
      RAISE EXCEPTION '%', format('file_too_big: %s is over 25 MB. Share it as a link instead.', COALESCE(left(v_name, 120), 'This file')) USING ERRCODE = '22023';
    END IF;
    IF v_size < 1 THEN RAISE EXCEPTION 'invalid_file: That file is empty.' USING ERRCODE = '22023'; END IF;
    IF NOT public.ops_file_mime_ok(v_kind, v_mime) THEN
      RAISE EXCEPTION '%', CASE WHEN v_kind = 'image' THEN 'invalid_file: Pictures can be JPEG, PNG, WebP, GIF or HEIC.'
        ELSE 'invalid_file: Documents can be PDF, Word, Excel, PowerPoint, text, CSV, Keynote, Numbers or Pages.' END USING ERRCODE = '22023';
    END IF;
    v_safe := left(btrim(regexp_replace(COALESCE(v_name, ''), '[^A-Za-z0-9._-]+', '_', 'g'), '_.'), 120);
    IF v_safe IS NULL OR v_safe = '' THEN v_safe := 'file'; END IF;
  END IF;
  IF v_name IS NULL OR char_length(v_name) > 200 OR public.ops_has_control(v_name) THEN
    RAISE EXCEPTION 'invalid_file: Name the file in 1 to 200 characters.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.ops_work_files (id, card_id, kind, name, mime, size_bytes, storage_path, url, added_by, added_via)
  VALUES (v_id, c.id, v_kind, v_name, CASE WHEN v_kind <> 'link' THEN v_mime END, v_size,
          CASE WHEN v_kind <> 'link' THEN c.id::text || '/' || v_id::text || '/' || v_safe END, v_url, v.actor_email, v.via)
  RETURNING * INTO f;
  v_out := jsonb_build_object('file', public.ops_file_json(f),
    'upload', CASE WHEN f.storage_path IS NOT NULL THEN jsonb_build_object('bucket', 'ops-work-files', 'path', f.storage_path,
                                                                         'max_bytes', 26214400, 'expires_in_hours', 24) END);
  PERFORM public.ops_request_finish(v.actor_email, p_request_key, 'file', v_out);
  RETURN v_out;
END;
$$;

-- Take a file off a card: the person who added it, an owner of the card,
-- or an admin (an agent: only what its person added). It stops being served
-- at once.
CREATE FUNCTION public.ops_file_archive(p_file_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; f public.ops_work_files;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  SELECT * INTO f FROM public.ops_work_files x WHERE x.id = p_file_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That file is no longer here.' USING ERRCODE = 'P0002'; END IF;
  IF f.archived_at IS NOT NULL THEN RETURN jsonb_build_object('file', public.ops_file_json(f), 'changed', false); END IF;
  IF NOT ((f.added_by = v.actor_email AND f.added_via IS NOT DISTINCT FROM v.via)
          OR (v.via IS NULL AND (public.ops_is_person_on(f.card_id, v.actor_email, ARRAY['owner']) OR COALESCE(public.is_admin_user(), false)))) THEN
    RAISE EXCEPTION 'forbidden: Only the person who added this file, an owner of the card or an admin can remove it.' USING ERRCODE = '42501';
  END IF;
  IF f.from_files_url THEN
    RAISE EXCEPTION 'invalid_file: This is the card''s Files link. Clear the Files link on the card instead.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ops_work_files x SET archived_at = now(), archived_by = v.actor_email WHERE x.id = f.id RETURNING * INTO f;
  RETURN jsonb_build_object('file', public.ops_file_json(f), 'changed', true);
END;
$$;

-- What the browser needs to open a file: a link's address, or the bucket and
-- path to ask storage for a short-lived signed link (storage itself checks
-- ops_file_can_read again). Only live files on live cards.
CREATE FUNCTION public.ops_file_sign(p_file_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; f public.ops_work_files;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  SELECT x.* INTO f FROM public.ops_work_files x JOIN public.ops_work_cards w ON w.id = x.card_id
   WHERE x.id = p_file_id AND x.archived_at IS NULL AND w.archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That file is no longer here.' USING ERRCODE = 'P0002'; END IF;
  IF f.kind = 'link' THEN
    RETURN jsonb_build_object('kind', 'link', 'url', f.url, 'name', f.name);
  END IF;
  IF NOT public.ops_file_uploaded(f.storage_path) THEN
    RAISE EXCEPTION 'not_uploaded: This file has not finished uploading. Try again in a moment.' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('kind', f.kind, 'bucket', 'ops-work-files', 'path', f.storage_path, 'expires_in', 300,
                            'name', f.name, 'mime', f.mime, 'size_bytes', f.size_bytes);
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Thread.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.ops_message_json(m public.ops_work_messages, p_actor text, p_via text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT jsonb_build_object('id', m.id, 'card_id', m.card_id, 'parent_message_id', m.parent_message_id,
    'author_email', m.author_email, 'author_name', public.ops_actor_label(m.author_email, m.via, m.chat), 'via', m.via,
    'agent', m.via IN ('claude', 'codex'),
    'body', CASE WHEN m.deleted_at IS NULL THEN m.body_md END,
    'mentions', CASE WHEN m.deleted_at IS NULL THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('email', x, 'name', public.ops_name(x)) ORDER BY x) FROM unnest(m.mentions) x), '[]'::jsonb) ELSE '[]'::jsonb END,
    'everyone', m.mention_everyone AND m.deleted_at IS NULL,
    'created_at', m.created_at, 'edited_at', m.edited_at, 'deleted', m.deleted_at IS NOT NULL, 'revision', m.revision,
    'mine', m.author_email = p_actor AND m.via IS NOT DISTINCT FROM p_via,
    'reactions', CASE WHEN m.deleted_at IS NULL THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('emoji', r.emoji, 'count', r.n, 'mine', r.mine, 'names', r.names) ORDER BY r.first_at)
       FROM (SELECT x.emoji, count(*) AS n, bool_or(x.email = p_actor) AS mine, min(x.created_at) AS first_at,
                    jsonb_agg(public.ops_name(x.email) ORDER BY x.created_at) AS names
               FROM public.ops_work_message_reactions x WHERE x.message_id = m.id GROUP BY x.emoji) r), '[]'::jsonb) ELSE '[]'::jsonb END,
    'files', CASE WHEN m.deleted_at IS NULL THEN COALESCE((SELECT jsonb_agg(public.ops_file_json(f) ORDER BY f.added_at, f.id)
       FROM public.ops_work_files f WHERE f.message_id = m.id AND f.archived_at IS NULL), '[]'::jsonb) ELSE '[]'::jsonb END)
$$;

-- A card's thread, oldest first, each message with its replies under it.
-- Deleted messages stay as a stub (no words, no files) only while they have
-- replies.
CREATE FUNCTION public.ops_message_list(p_card_id uuid, p_limit integer DEFAULT 200, p_before timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500); v_rows jsonb; v_total integer;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF NOT EXISTS (SELECT 1 FROM public.ops_work_cards w WHERE w.id = p_card_id) THEN
    RAISE EXCEPTION 'not_found: That card is not here.' USING ERRCODE = 'P0002';
  END IF;
  SELECT count(*) INTO v_total FROM public.ops_work_messages m WHERE m.card_id = p_card_id AND m.parent_message_id IS NULL AND m.deleted_at IS NULL;
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.created_at, x.id), '[]'::jsonb) INTO v_rows
    FROM (SELECT t.id, t.created_at, public.ops_message_json(t, v.actor_email, v.via) || jsonb_build_object(
                   'replies', COALESCE((SELECT jsonb_agg(public.ops_message_json(r, v.actor_email, v.via) ORDER BY r.created_at, r.id)
                                          FROM public.ops_work_messages r WHERE r.parent_message_id = t.id AND r.deleted_at IS NULL), '[]'::jsonb)) AS j
            FROM (SELECT m.* FROM public.ops_work_messages m
                   WHERE m.card_id = p_card_id AND m.parent_message_id IS NULL
                     AND (m.deleted_at IS NULL OR EXISTS (SELECT 1 FROM public.ops_work_messages r WHERE r.parent_message_id = m.id AND r.deleted_at IS NULL))
                     AND (p_before IS NULL OR m.created_at < p_before)
                   ORDER BY m.created_at DESC, m.id DESC LIMIT v_limit) t) x;
  RETURN jsonb_build_object('messages', v_rows, 'total', v_total, 'limit', v_limit);
END;
$$;

-- Post in a card's thread: words (Markdown, up to 10,000 characters), files
-- already added to the card (up to 10), or both. A reply goes under a
-- top-level message. Mentions (teammates by address or name, or everyone:
-- admins in person, once every 10 minutes) and the author of the message
-- replied to are told through ops_notify_people, under the message's note
-- event, so the #4255 email rules hold unchanged. An agent posts only on a
-- card its person owns or watches, and never to everyone.
CREATE FUNCTION public.ops_message_post(p_card_id uuid, p_body text, p_mentions text[] DEFAULT '{}'::text[], p_parent_message_id uuid DEFAULT NULL,
                                        p_file_ids uuid[] DEFAULT NULL, p_everyone boolean DEFAULT false, p_request_key text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v record; c public.ops_work_cards; m public.ops_work_messages; pm public.ops_work_messages; v_body text := COALESCE(public.ops_multi_line(p_body), '');
  v_replay jsonb; v_m text; v_email text; v_emails text[] := ARRAY[]::text[]; v_tell text[]; v_event uuid; v_told integer; v_out jsonb;
  v_files uuid[] := ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(p_file_ids, ARRAY[]::uuid[])) x WHERE x IS NOT NULL); v_ok integer;
  v_chat text; v_words text;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_replay := public.ops_request_begin(v.actor_email, p_request_key, 'message',
    jsonb_build_object('id', p_card_id, 'body', p_body, 'mentions', to_jsonb(COALESCE(p_mentions, ARRAY[]::text[])),
                       'parent', p_parent_message_id, 'files', to_jsonb(v_files), 'everyone', COALESCE(p_everyone, false)));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO c FROM public.ops_work_cards w WHERE w.id = p_card_id AND w.archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That card is no longer here.' USING ERRCODE = 'P0002'; END IF;
  IF v.via IS NOT NULL AND NOT public.ops_is_person_on(c.id, v.actor_email, ARRAY['owner','watcher']) THEN
    RAISE EXCEPTION 'not_your_card: Your person is not an owner or watcher of this card. Ask an owner to add them.' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_body) > 10000 OR public.ops_has_control(v_body) THEN
    RAISE EXCEPTION 'invalid_message: A message is up to 10,000 characters.' USING ERRCODE = '22023';
  END IF;
  IF v_body = '' AND cardinality(v_files) = 0 THEN
    RAISE EXCEPTION 'invalid_message: Write something or attach a file.' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_files) > 10 THEN
    RAISE EXCEPTION 'too_many_files: A message carries up to 10 files.' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_ok FROM public.ops_work_files f
   WHERE f.id = ANY (v_files) AND f.card_id = c.id AND f.message_id IS NULL AND f.archived_at IS NULL
     AND f.added_by = v.actor_email AND (f.kind = 'link' OR public.ops_file_uploaded(f.storage_path));
  IF v_ok <> cardinality(v_files) THEN
    RAISE EXCEPTION 'invalid_message: A file is not on this card, is already in a message, or has not finished uploading.' USING ERRCODE = '22023';
  END IF;
  IF p_parent_message_id IS NOT NULL THEN
    SELECT * INTO pm FROM public.ops_work_messages x WHERE x.id = p_parent_message_id;
    IF NOT FOUND OR pm.card_id <> c.id OR pm.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'not_found: That message is no longer in this thread.' USING ERRCODE = 'P0002';
    END IF;
    -- Replies are one level: a reply to a reply joins the same message.
    IF pm.parent_message_id IS NOT NULL THEN
      SELECT * INTO pm FROM public.ops_work_messages x WHERE x.id = pm.parent_message_id;
    END IF;
  END IF;
  IF COALESCE(p_everyone, false) THEN
    IF v.via IS NOT NULL OR NOT COALESCE(public.is_admin_user(), false) THEN
      RAISE EXCEPTION 'forbidden: Only the owner or an admin can mention everyone.' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.ops_work_messages x WHERE x.author_email = v.actor_email AND x.mention_everyone
                AND x.created_at > clock_timestamp() - interval '10 minutes') THEN
      RAISE EXCEPTION 'too_soon: You mentioned everyone in the last 10 minutes. Mention the people who need it.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF cardinality(COALESCE(p_mentions, ARRAY[]::text[])) > 20 THEN
    RAISE EXCEPTION 'too_many_mentions: Mention at most 20 teammates in one message.' USING ERRCODE = '22023';
  END IF;
  FOREACH v_m IN ARRAY COALESCE(p_mentions, ARRAY[]::text[]) LOOP
    v_email := public.ops_team_email(v_m);
    IF v_email IS NULL THEN
      RAISE EXCEPTION '%', format('invalid_mention_recipient: %s is not on the team.', left(COALESCE(v_m, ''), 80)) USING ERRCODE = '22023';
    END IF;
    IF NOT v_email = ANY (v_emails) THEN v_emails := v_emails || v_email; END IF;
  END LOOP;
  v_chat := CASE WHEN v.via IN ('claude', 'codex') THEN public.ops_ctx_chat() END;
  v_words := CASE WHEN v_body <> '' THEN v_body
                  WHEN cardinality(v_files) = 1 THEN 'sent a file'
                  ELSE format('sent %s files', cardinality(v_files)) END;
  -- The note event: the history line and the source every notice points at.
  v_event := public.ops_card_event(c.id, v.actor_email, v.via, 'note', left(v_words, 2000), NULL, NULL, NULL, NULL);
  INSERT INTO public.ops_work_messages (card_id, parent_message_id, author_email, via, chat, body_md, mentions, mention_everyone, event_id, request_key)
  VALUES (c.id, pm.id, v.actor_email, v.via, v_chat, v_body, v_emails, COALESCE(p_everyone, false), v_event, p_request_key)
  RETURNING * INTO m;
  UPDATE public.ops_work_files f SET message_id = m.id WHERE f.id = ANY (v_files);
  IF v.via IS NOT NULL AND c.working_via IS NOT NULL AND c.status <> 'done'
     AND public.ops_same_agent(c.working_by, c.working_via, c.working_chat, v.actor_email, v.via, public.ops_ctx_chat()) THEN
    UPDATE public.ops_work_cards SET working_seen_at = clock_timestamp() WHERE id = c.id;
  END IF;
  v_tell := v_emails
    || CASE WHEN COALESCE(p_everyone, false) THEN ARRAY(SELECT d.email FROM public.admin_team_directory() d WHERE d.status = 'active') ELSE ARRAY[]::text[] END
    || CASE WHEN pm.id IS NOT NULL THEN ARRAY[pm.author_email] ELSE ARRAY[]::text[] END;
  v_told := public.ops_notify_people(c.id, v_event, v_tell, v.actor_email,
    format('%s on %s: %s', public.ops_actor_label(v.actor_email, v.via, public.ops_ctx_chat()), c.title, v_words));
  v_out := jsonb_build_object('message', public.ops_message_json(m, v.actor_email, v.via), 'event_id', v_event, 'told', v_told);
  PERFORM public.ops_request_finish(v.actor_email, p_request_key, 'message', v_out);
  RETURN v_out;
END;
$$;

CREATE FUNCTION public.ops_message_mine(p_message_id uuid, p_expected_revision bigint) RETURNS public.ops_work_messages
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; m public.ops_work_messages;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  SELECT * INTO m FROM public.ops_work_messages x WHERE x.id = p_message_id FOR UPDATE;
  IF NOT FOUND OR m.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'not_found: That message is no longer in this thread.' USING ERRCODE = 'P0002'; END IF;
  IF m.author_email <> v.actor_email OR m.via IS DISTINCT FROM v.via THEN
    RAISE EXCEPTION 'forbidden: You can change only your own messages.' USING ERRCODE = '42501';
  END IF;
  IF p_expected_revision IS NULL OR m.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale_write: This message changed since you opened it. Reload it, then try again.' USING ERRCODE = 'PT409';
  END IF;
  RETURN m;
END;
$$;

CREATE FUNCTION public.ops_message_edit(p_message_id uuid, p_body text, p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; m public.ops_work_messages; v_body text := COALESCE(public.ops_multi_line(p_body), '');
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  m := public.ops_message_mine(p_message_id, p_expected_revision);
  IF char_length(v_body) > 10000 OR public.ops_has_control(v_body) THEN
    RAISE EXCEPTION 'invalid_message: A message is up to 10,000 characters.' USING ERRCODE = '22023';
  END IF;
  IF v_body = '' AND NOT EXISTS (SELECT 1 FROM public.ops_work_files f WHERE f.message_id = m.id AND f.archived_at IS NULL) THEN
    RAISE EXCEPTION 'invalid_message: Write something, or delete the message.' USING ERRCODE = '22023';
  END IF;
  IF v_body = m.body_md THEN
    RETURN jsonb_build_object('message', public.ops_message_json(m, v.actor_email, v.via), 'changed', false);
  END IF;
  UPDATE public.ops_work_messages x SET body_md = v_body, edited_at = clock_timestamp(), revision = x.revision + 1
   WHERE x.id = m.id RETURNING * INTO m;
  UPDATE public.ops_work_events e SET body = left(NULLIF(v_body, ''), 2000) WHERE e.id = m.event_id;
  RETURN jsonb_build_object('message', public.ops_message_json(m, v.actor_email, v.via), 'changed', true);
END;
$$;

CREATE FUNCTION public.ops_message_delete(p_message_id uuid, p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; m public.ops_work_messages;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  m := public.ops_message_mine(p_message_id, p_expected_revision);
  UPDATE public.ops_work_messages x SET deleted_at = clock_timestamp(), deleted_by = v.actor_email, body_md = '', mentions = ARRAY[]::text[],
    revision = x.revision + 1 WHERE x.id = m.id RETURNING * INTO m;
  -- Its files stop being served at once; its words leave the history too.
  UPDATE public.ops_work_files f SET archived_at = now(), archived_by = v.actor_email WHERE f.message_id = m.id AND f.archived_at IS NULL;
  UPDATE public.ops_work_events e SET body = NULL WHERE e.id = m.event_id;
  DELETE FROM public.ops_work_message_reactions r WHERE r.message_id = m.id;
  RETURN jsonb_build_object('message', public.ops_message_json(m, v.actor_email, v.via), 'changed', true);
END;
$$;

-- Add (p_on true) or take back (false) a reaction.
CREATE FUNCTION public.ops_message_react(p_message_id uuid, p_emoji text, p_on boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; m public.ops_work_messages; v_emoji text := btrim(COALESCE(p_emoji, ''));
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  SELECT * INTO m FROM public.ops_work_messages x WHERE x.id = p_message_id;
  IF NOT FOUND OR m.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'not_found: That message is no longer in this thread.' USING ERRCODE = 'P0002'; END IF;
  IF char_length(v_emoji) NOT BETWEEN 1 AND 16 OR v_emoji ~ '[[:space:][:cntrl:]]' THEN
    RAISE EXCEPTION 'invalid_reaction: React with one emoji.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_on, true) THEN
    INSERT INTO public.ops_work_message_reactions (message_id, email, emoji) VALUES (m.id, v.actor_email, v_emoji) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.ops_work_message_reactions r WHERE r.message_id = m.id AND r.email = v.actor_email AND r.emoji = v_emoji;
  END IF;
  RETURN jsonb_build_object('message', public.ops_message_json(m, v.actor_email, v.via));
END;
$$;

-- A note is a thread message now (#4255). Same arguments and answer as
-- before: the note event's id and how many teammates were told.
CREATE OR REPLACE FUNCTION public.ops_work_note(p_id uuid, p_body text, p_mention_emails text[] DEFAULT '{}'::text[], p_request_key text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_out jsonb;
BEGIN
  IF char_length(COALESCE(public.ops_multi_line(p_body), '')) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'invalid_note: A note must be 1 to 2,000 characters.' USING ERRCODE = '22023';
  END IF;
  v_out := public.ops_message_post(p_id, p_body, COALESCE(p_mention_emails, ARRAY[]::text[]), NULL, NULL, false, p_request_key);
  RETURN jsonb_build_object('event_id', v_out->'event_id', 'message_id', v_out->'message'->'id', 'told', v_out->'told',
                            'replayed', COALESCE((v_out->>'replayed')::boolean, false));
END;
$$;
-- ---------------------------------------------------------------------------
-- 8. Sprint goals, capacity and the planner. People plan; agents read.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.ops_people_only(p_via text) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_via IS NOT NULL THEN
    RAISE EXCEPTION 'people_only: A person plans the sprint.' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Hours a teammate has in a sprint: that sprint's number, else the previous
-- sprint's, else none.
CREATE FUNCTION public.ops_capacity_hours(p_sprint_id uuid, p_email text) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT k.hours FROM public.ops_sprint_capacity k WHERE k.sprint_id = p_sprint_id AND k.email = p_email),
    (SELECT k.hours FROM public.ops_sprint_capacity k JOIN public.ops_sprints s ON s.id = k.sprint_id
       JOIN public.ops_sprints me ON me.id = p_sprint_id
      WHERE k.email = p_email AND s.starts_on = me.starts_on - 7))
$$;

-- A goal's cards, progress and verdicts. auto is what the numbers say:
-- done when it has cards and all are closed; after the sprint, missed when
-- any is open; otherwise at_risk when the estimated hours on its open cards
-- are more than the hours its owners have left this week (capacity times the
-- share of the week left), else on_track. state is what to show: a person's
-- state holds while auto is still what it was when they set it.
CREATE FUNCTION public.ops_goal_json(g public.ops_sprint_goals, p_today date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE s public.ops_sprints; v_cards integer; v_done integer; v_open_min bigint; v_left numeric; v_days integer; v_auto text; v_state text;
BEGIN
  SELECT * INTO s FROM public.ops_sprints x WHERE x.id = g.sprint_id;
  SELECT count(*), count(*) FILTER (WHERE w.status = 'done'), COALESCE(sum(w.estimate_minutes) FILTER (WHERE w.status <> 'done'), 0)
    INTO v_cards, v_done, v_open_min
    FROM public.ops_work_cards w WHERE w.goal_id = g.id AND w.sprint_id = g.sprint_id AND w.archived_at IS NULL;
  v_days := LEAST(7, GREATEST(0, s.starts_on + 6 - p_today + 1));
  SELECT sum(public.ops_capacity_hours(g.sprint_id, o.email)) * v_days / 7.0 INTO v_left
    FROM (SELECT DISTINCT p.email FROM public.ops_work_people p JOIN public.ops_work_cards w ON w.id = p.card_id
           WHERE w.goal_id = g.id AND w.sprint_id = g.sprint_id AND w.archived_at IS NULL AND w.status <> 'done' AND p.role = 'owner') o;
  v_auto := CASE WHEN v_cards > 0 AND v_done = v_cards THEN 'done'
                 WHEN p_today > s.starts_on + 6 AND v_cards > v_done THEN 'missed'
                 WHEN v_left IS NOT NULL AND v_open_min / 60.0 > v_left THEN 'at_risk'
                 ELSE 'on_track' END;
  v_state := CASE WHEN g.state_source = 'manual' AND g.manual_basis IS NOT DISTINCT FROM v_auto THEN g.state ELSE v_auto END;
  RETURN jsonb_build_object('id', g.id, 'sprint_id', g.sprint_id, 'title', g.title, 'owner_email', g.owner_email,
    'owner_name', CASE WHEN g.owner_email IS NOT NULL THEN public.ops_name(g.owner_email) END,
    'state', v_state, 'auto_state', v_auto, 'set_by_hand', g.state_source = 'manual' AND g.manual_basis IS NOT DISTINCT FROM v_auto,
    'position', g.position, 'revision', g.revision, 'archived', g.archived_at IS NOT NULL,
    'cards', v_cards, 'done', v_done, 'open_minutes', v_open_min,
    'hours_left', CASE WHEN v_left IS NOT NULL THEN round(v_left, 1) END);
END;
$$;

CREATE FUNCTION public.ops_sprint_row(p_sprint_id uuid) RETURNS public.ops_sprints
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE s public.ops_sprints;
BEGIN
  SELECT * INTO s FROM public.ops_sprints x WHERE x.id = p_sprint_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That sprint is not here.' USING ERRCODE = 'P0002'; END IF;
  RETURN s;
END;
$$;

-- A card row for the planner.
CREATE FUNCTION public.ops_plan_card_json(w public.ops_work_cards, p_baseline jsonb, p_planned boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT public.ops_card_lite(w) || jsonb_build_object(
    'owners', COALESCE((SELECT jsonb_agg(jsonb_build_object('email', p.email, 'name', public.ops_name(p.email)) ORDER BY p.added_at, p.email)
                          FROM public.ops_work_people p WHERE p.card_id = w.id AND p.role = 'owner'), '[]'::jsonb),
    'revision', w.revision, 'carried_count', w.carried_count, 'in_backlog', w.in_backlog, 'sprint_id', w.sprint_id,
    'added_mid_sprint', p_planned AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_baseline, '[]'::jsonb)) b WHERE b->>'id' = w.id::text),
    'subtasks', (SELECT jsonb_build_object('total', count(*), 'done', count(*) FILTER (WHERE x.status = 'done'),
                                           'minutes', COALESCE(sum(x.estimate_minutes), 0))
                   FROM public.ops_work_cards x WHERE x.parent_id = w.id AND x.archived_at IS NULL))
$$;

-- Everything the sprint planner shows: the last sprint's review, this
-- sprint's goals, everyone's capacity against their estimates, the cards in
-- the sprint and the backlog (carried cards first).
CREATE FUNCTION public.ops_sprint_plan_get(p_sprint_id uuid DEFAULT NULL, p_today date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; v_today date := public.ops_today(p_today); s public.ops_sprints; prev public.ops_sprints; v_planned boolean;
        v_review jsonb; v_goals jsonb; v_capacity jsonb; v_in jsonb; v_backlog jsonb; v_cap_min numeric; v_est_min numeric;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_sprint_id IS NULL THEN
    SELECT * INTO s FROM public.ops_sprints x WHERE x.id = public.ops_sprint_ensure(v_today);
  ELSE
    SELECT * INTO s FROM public.ops_sprints x WHERE x.id = p_sprint_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That sprint is not here.' USING ERRCODE = 'P0002'; END IF;
  END IF;
  v_planned := s.planned_at IS NOT NULL;
  SELECT * INTO prev FROM public.ops_sprints x WHERE x.starts_on = s.starts_on - 7;
  IF prev.id IS NOT NULL THEN
    SELECT COALESCE(sum(public.ops_capacity_hours(prev.id, d.email)), 0) * 60 INTO v_cap_min
      FROM public.admin_team_directory() d WHERE d.status = 'active';
    SELECT COALESCE(sum(w.estimate_minutes), 0) INTO v_est_min
      FROM public.ops_work_cards w WHERE w.sprint_id = prev.id AND w.archived_at IS NULL;
    v_review := jsonb_build_object('sprint', public.ops_sprint_json(prev.starts_on),
      'planned', CASE WHEN prev.plan_baseline IS NOT NULL THEN jsonb_array_length(prev.plan_baseline)
                      ELSE (SELECT count(*) FROM public.ops_work_cards w WHERE w.sprint_id = prev.id AND w.archived_at IS NULL AND w.parent_id IS NULL) END,
      'done', (SELECT count(*) FROM public.ops_work_cards w WHERE w.sprint_id = prev.id AND w.archived_at IS NULL AND w.parent_id IS NULL AND w.status = 'done'),
      'carried', (SELECT count(*) FROM public.ops_work_cards w WHERE w.sprint_id = s.id AND w.archived_at IS NULL AND w.parent_id IS NULL AND w.carried_count > 0),
      'goals', (SELECT count(*) FROM public.ops_sprint_goals g WHERE g.sprint_id = prev.id AND g.archived_at IS NULL),
      'goals_hit', (SELECT count(*) FROM public.ops_sprint_goals g WHERE g.sprint_id = prev.id AND g.archived_at IS NULL
                     AND public.ops_goal_json(g, v_today)->>'state' = 'done'),
      'capacity_used_pct', CASE WHEN v_cap_min > 0 THEN round(100 * v_est_min / v_cap_min) END,
      'note', prev.review_note, 'revision', prev.revision);
  END IF;
  SELECT COALESCE(jsonb_agg(public.ops_goal_json(g, v_today) ORDER BY g.position, g.created_at), '[]'::jsonb) INTO v_goals
    FROM public.ops_sprint_goals g WHERE g.sprint_id = s.id AND g.archived_at IS NULL;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('email', d.email, 'name', public.ops_name(d.email),
           'hours', k.hours, 'hours_default', CASE WHEN k.hours IS NULL THEN public.ops_capacity_hours(s.id, d.email) END,
           'planned_minutes', pl.minutes,
           'over', COALESCE(pl.minutes > COALESCE(k.hours, public.ops_capacity_hours(s.id, d.email)) * 60, false))
         ORDER BY (d.role = 'owner') DESC, d.email), '[]'::jsonb) INTO v_capacity
    FROM public.admin_team_directory() d
    LEFT JOIN public.ops_sprint_capacity k ON k.sprint_id = s.id AND k.email = d.email
    CROSS JOIN LATERAL (SELECT COALESCE(sum(w.estimate_minutes), 0) AS minutes
                          FROM public.ops_work_cards w JOIN public.ops_work_people p ON p.card_id = w.id AND p.role = 'owner' AND p.email = d.email
                         WHERE w.sprint_id = s.id AND w.archived_at IS NULL AND w.status <> 'done' AND NOT w.in_backlog) pl
   WHERE d.status = 'active';
  SELECT COALESCE(jsonb_agg(public.ops_plan_card_json(w, s.plan_baseline, v_planned) ORDER BY w.carried_count DESC, w.due_on, w.number), '[]'::jsonb) INTO v_in
    FROM public.ops_work_cards w WHERE w.sprint_id = s.id AND w.archived_at IS NULL AND w.parent_id IS NULL AND NOT w.in_backlog;
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.carried DESC, x.due_on, x.number), '[]'::jsonb) INTO v_backlog
    FROM (SELECT public.ops_plan_card_json(w, s.plan_baseline, false) AS j, w.carried_count AS carried, w.due_on, w.number
            FROM public.ops_work_cards w JOIN public.ops_sprints ws ON ws.id = w.sprint_id
           WHERE w.archived_at IS NULL AND w.parent_id IS NULL AND w.status <> 'done'
             AND (w.in_backlog OR ws.starts_on > s.starts_on)
           ORDER BY w.carried_count DESC, w.due_on, w.number LIMIT 300) x;
  RETURN jsonb_build_object('sprint', public.ops_sprint_json(s.starts_on), 'planned', v_planned, 'planned_at', s.planned_at,
    'planned_by_name', CASE WHEN s.planned_by IS NOT NULL THEN public.ops_name(s.planned_by) END,
    'revision', s.revision, 'review', v_review, 'goals', v_goals, 'capacity', v_capacity, 'in_sprint', v_in, 'backlog', v_backlog,
    'today', v_today, 'can_plan', v.via IS NULL);
END;
$$;

CREATE FUNCTION public.ops_sprint_goal_add(p_sprint_id uuid, p_title text, p_owner_email text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; s public.ops_sprints; g public.ops_sprint_goals; v_title text := public.ops_one_line(p_title); v_owner text; v_live integer;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  PERFORM public.ops_people_only(v.via);
  s := public.ops_sprint_row(p_sprint_id);  -- locks the sprint: the five-goal count cannot race
  IF v_title IS NULL OR char_length(v_title) NOT BETWEEN 3 AND 80 OR public.ops_has_control(v_title) THEN
    RAISE EXCEPTION 'invalid_goal: Say the goal in 3 to 80 characters.' USING ERRCODE = '22023';
  END IF;
  IF p_owner_email IS NOT NULL AND btrim(p_owner_email) <> '' THEN
    v_owner := public.ops_team_email(p_owner_email);
    IF v_owner IS NULL THEN
      RAISE EXCEPTION '%', format('invalid_goal: %s is not on the team.', left(p_owner_email, 80)) USING ERRCODE = '22023';
    END IF;
  END IF;
  SELECT count(*) INTO v_live FROM public.ops_sprint_goals x WHERE x.sprint_id = s.id AND x.archived_at IS NULL;
  IF v_live >= 5 THEN
    RAISE EXCEPTION 'too_many_goals: A sprint has at most five goals. Archive one first.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.ops_sprint_goals (sprint_id, title, owner_email, position, created_by, updated_by)
  VALUES (s.id, v_title, v_owner, v_live, v.actor_email, v.actor_email) RETURNING * INTO g;
  RETURN jsonb_build_object('goal', public.ops_goal_json(g, public.ops_today(NULL)));
END;
$$;

-- Change a goal's title, owner, state or place. A state set here is a
-- person's; state null hands it back to the numbers.
CREATE FUNCTION public.ops_sprint_goal_update(p_goal_id uuid, p_changes jsonb, p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; g public.ops_sprint_goals; v_bad text; v_title text; v_owner text; v_state text; v_source text; v_basis text; v_pos integer;
        v_today date := public.ops_today(NULL); v_live integer;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  PERFORM public.ops_people_only(v.via);
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid_changes: Send what changes: title, owner, state or position.' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(p_changes) k WHERE k NOT IN ('title', 'owner', 'state', 'position') LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '%', format('unknown_field: A goal change takes title, owner, state and position, not "%s".', left(v_bad, 40)) USING ERRCODE = '22023';
  END IF;
  SELECT * INTO g FROM public.ops_sprint_goals x WHERE x.id = p_goal_id AND x.archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That goal is no longer in the sprint.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.ops_sprint_row(g.sprint_id);
  SELECT * INTO g FROM public.ops_sprint_goals x WHERE x.id = p_goal_id FOR UPDATE;
  IF p_expected_revision IS NULL OR g.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale_write: This goal changed since you opened it. Reload it, then try again.' USING ERRCODE = 'PT409';
  END IF;
  v_title := g.title; v_owner := g.owner_email; v_state := g.state; v_source := g.state_source; v_basis := g.manual_basis; v_pos := g.position;
  IF p_changes ? 'title' THEN
    v_title := public.ops_one_line(p_changes->>'title');
    IF v_title IS NULL OR char_length(v_title) NOT BETWEEN 3 AND 80 OR public.ops_has_control(v_title) THEN
      RAISE EXCEPTION 'invalid_goal: Say the goal in 3 to 80 characters.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_changes ? 'owner' THEN
    IF jsonb_typeof(p_changes->'owner') = 'null' OR btrim(COALESCE(p_changes->>'owner', '')) = '' THEN v_owner := NULL;
    ELSE
      v_owner := public.ops_team_email(p_changes->>'owner');
      IF v_owner IS NULL THEN
        RAISE EXCEPTION '%', format('invalid_goal: %s is not on the team.', left(p_changes->>'owner', 80)) USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;
  IF p_changes ? 'state' THEN
    IF jsonb_typeof(p_changes->'state') = 'null' THEN
      v_source := 'auto'; v_basis := NULL; v_state := public.ops_goal_json(g, v_today)->>'auto_state';
    ELSIF p_changes->>'state' IN ('on_track', 'at_risk', 'done', 'missed') THEN
      v_state := p_changes->>'state'; v_source := 'manual'; v_basis := public.ops_goal_json(g, v_today)->>'auto_state';
    ELSE
      RAISE EXCEPTION 'invalid_goal: A goal is on_track, at_risk, done or missed.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_changes ? 'position' THEN
    IF jsonb_typeof(p_changes->'position') <> 'number' OR (p_changes->>'position') !~ '^\d{1,2}$' THEN
      RAISE EXCEPTION 'invalid_goal: Say where the goal goes (0 is first).' USING ERRCODE = '22023';
    END IF;
    SELECT count(*) INTO v_live FROM public.ops_sprint_goals x WHERE x.sprint_id = g.sprint_id AND x.archived_at IS NULL;
    v_pos := LEAST((p_changes->>'position')::integer, v_live - 1);
    UPDATE public.ops_sprint_goals x SET position = x.position - 1 WHERE x.sprint_id = g.sprint_id AND x.archived_at IS NULL AND x.position > g.position;
    UPDATE public.ops_sprint_goals x SET position = x.position + 1 WHERE x.sprint_id = g.sprint_id AND x.archived_at IS NULL AND x.id <> g.id AND x.position >= v_pos;
  END IF;
  UPDATE public.ops_sprint_goals x SET title = v_title, owner_email = v_owner, state = v_state, state_source = v_source, manual_basis = v_basis,
    position = v_pos, revision = x.revision + 1, updated_by = v.actor_email, updated_at = now()
   WHERE x.id = g.id RETURNING * INTO g;
  RETURN jsonb_build_object('goal', public.ops_goal_json(g, v_today));
END;
$$;

-- Archive a goal; its cards keep their place in the sprint and lose the goal.
CREATE FUNCTION public.ops_sprint_goal_archive(p_goal_id uuid, p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; g public.ops_sprint_goals; r record; n public.ops_work_cards; v_before jsonb; v_cards integer := 0;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  PERFORM public.ops_people_only(v.via);
  SELECT * INTO g FROM public.ops_sprint_goals x WHERE x.id = p_goal_id AND x.archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That goal is no longer in the sprint.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.ops_sprint_row(g.sprint_id);
  SELECT * INTO g FROM public.ops_sprint_goals x WHERE x.id = p_goal_id FOR UPDATE;
  IF p_expected_revision IS NULL OR g.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale_write: This goal changed since you opened it. Reload it, then try again.' USING ERRCODE = 'PT409';
  END IF;
  FOR r IN SELECT w.id, w.revision FROM public.ops_work_cards w WHERE w.goal_id = g.id ORDER BY w.number FOR UPDATE LOOP
    v_before := public.ops_card_snapshot(r.id);
    UPDATE public.ops_work_cards w SET goal_id = NULL, revision = w.revision + 1, updated_by = v.actor_email, updated_via = NULL, updated_at = now()
     WHERE w.id = r.id RETURNING w.* INTO n;
    PERFORM public.ops_card_event(r.id, v.actor_email, NULL, 'updated', format('The sprint goal "%s" was archived.', g.title),
      v_before, public.ops_card_snapshot(r.id), r.revision, n.revision);
    v_cards := v_cards + 1;
  END LOOP;
  UPDATE public.ops_sprint_goals x SET archived_at = now(), archived_by = v.actor_email, revision = x.revision + 1, updated_by = v.actor_email, updated_at = now()
   WHERE x.id = g.id RETURNING * INTO g;
  UPDATE public.ops_sprint_goals x SET position = y.rn
    FROM (SELECT t.id, (row_number() OVER (ORDER BY t.position, t.created_at) - 1)::integer AS rn
            FROM public.ops_sprint_goals t WHERE t.sprint_id = g.sprint_id AND t.archived_at IS NULL) y
   WHERE x.id = y.id AND x.position IS DISTINCT FROM y.rn;
  RETURN jsonb_build_object('goal', public.ops_goal_json(g, public.ops_today(NULL)), 'cards', v_cards);
END;
$$;

-- Hours a teammate has this sprint (0 to 80); null takes the number off.
CREATE FUNCTION public.ops_sprint_capacity_set(p_sprint_id uuid, p_email text, p_hours numeric) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; s public.ops_sprints; v_email text := public.ops_team_email(p_email);
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  PERFORM public.ops_people_only(v.via);
  s := public.ops_sprint_row(p_sprint_id);
  IF v_email IS NULL THEN
    RAISE EXCEPTION '%', format('invalid_capacity: %s is not on the team.', left(COALESCE(p_email, ''), 80)) USING ERRCODE = '22023';
  END IF;
  IF p_hours IS NULL THEN
    DELETE FROM public.ops_sprint_capacity k WHERE k.sprint_id = s.id AND k.email = v_email;
  ELSIF p_hours < 0 OR p_hours > 80 OR round(p_hours, 1) <> p_hours THEN
    RAISE EXCEPTION 'invalid_capacity: Hours are 0 to 80, in steps of 0.1.' USING ERRCODE = '22023';
  ELSE
    INSERT INTO public.ops_sprint_capacity (sprint_id, email, hours, set_by) VALUES (s.id, v_email, p_hours, v.actor_email)
    ON CONFLICT (sprint_id, email) DO UPDATE SET hours = EXCLUDED.hours, set_by = EXCLUDED.set_by, set_at = now();
  END IF;
  RETURN jsonb_build_object('sprint_id', s.id, 'email', v_email, 'name', public.ops_name(v_email),
    'hours', (SELECT k.hours FROM public.ops_sprint_capacity k WHERE k.sprint_id = s.id AND k.email = v_email),
    'hours_default', public.ops_capacity_hours(s.id, v_email));
END;
$$;

-- Start the sprint: the cards in it now, with their estimates and goals,
-- become the plan's baseline. A card added after shows "added mid-sprint".
CREATE FUNCTION public.ops_sprint_start(p_sprint_id uuid, p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; s public.ops_sprints; v_base jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  PERFORM public.ops_people_only(v.via);
  s := public.ops_sprint_row(p_sprint_id);
  IF p_expected_revision IS NULL OR s.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale_write: This sprint changed since you opened it. Reload it, then try again.' USING ERRCODE = 'PT409';
  END IF;
  IF s.planned_at IS NOT NULL THEN
    RAISE EXCEPTION 'already_started: This sprint was started already. Cards added now show as added mid-sprint.' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', w.id, 'number', w.number, 'estimate_minutes', w.estimate_minutes, 'goal_id', w.goal_id,
                                               'owners', to_jsonb(public.ops_card_people(w.id, 'owner'))) ORDER BY w.number), '[]'::jsonb)
    INTO v_base
    FROM public.ops_work_cards w WHERE w.sprint_id = s.id AND w.archived_at IS NULL AND w.parent_id IS NULL AND NOT w.in_backlog;
  UPDATE public.ops_sprints x SET planned_at = now(), planned_by = v.actor_email, plan_baseline = v_base, revision = x.revision + 1,
    updated_by = v.actor_email, updated_at = now() WHERE x.id = s.id RETURNING * INTO s;
  PERFORM public.ops_log_write(v.actor_email, NULL, 'updated', 'info', NULL, NULL, NULL,
    format('%s started the sprint of %s with %s cards.', public.ops_name(v.actor_email), to_char(s.starts_on, 'FMDD Mon'), jsonb_array_length(v_base)),
    jsonb_build_object('sprint', s.id, 'cards', jsonb_array_length(v_base)));
  RETURN jsonb_build_object('sprint', public.ops_sprint_json(s.starts_on), 'planned_at', s.planned_at, 'revision', s.revision,
                            'cards', jsonb_array_length(v_base));
END;
$$;

CREATE FUNCTION public.ops_sprint_review_note_set(p_sprint_id uuid, p_note text, p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; s public.ops_sprints; v_note text := public.ops_one_line(p_note);
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  PERFORM public.ops_people_only(v.via);
  s := public.ops_sprint_row(p_sprint_id);
  IF p_expected_revision IS NULL OR s.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale_write: This sprint changed since you opened it. Reload it, then try again.' USING ERRCODE = 'PT409';
  END IF;
  IF char_length(COALESCE(v_note, '')) > 200 OR public.ops_has_control(v_note) THEN
    RAISE EXCEPTION 'invalid_note: Keep the team note to 200 characters.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ops_sprints x SET review_note = v_note, revision = x.revision + 1, updated_by = v.actor_email, updated_at = now()
   WHERE x.id = s.id RETURNING * INTO s;
  RETURN jsonb_build_object('sprint_id', s.id, 'note', s.review_note, 'revision', s.revision);
END;
$$;
-- The sprint's own JSON now carries its goals and plan (copied from its
-- latest definition; only the #4255 lines change).
CREATE OR REPLACE FUNCTION public.ops_sprint_json(p_monday date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT jsonb_build_object('id', s.id, 'starts_on', p_monday, 'ends_on', p_monday + 6, 'goal', s.goal,
                            'carried_in', COALESCE(s.carried_in, 0))
         -- #4255: the sprint's goals and its plan
         || jsonb_build_object('goals', COALESCE((SELECT jsonb_agg(public.ops_goal_json(g, public.ops_today(NULL)) ORDER BY g.position, g.created_at)
                                                    FROM public.ops_sprint_goals g WHERE g.sprint_id = s.id AND g.archived_at IS NULL), '[]'::jsonb),
                               'planned_at', s.planned_at, 'review_note', s.review_note, 'revision', s.revision)
  FROM (SELECT p_monday AS m) x LEFT JOIN public.ops_sprints s ON s.starts_on = x.m
$$;
-- ---------------------------------------------------------------------------
-- 9. The agent gateway: post_message and add_subtask; update_work step n is
--    the n-th subtask; my_work lists subtasks under their parent (copied from
--    the latest definition; only the #4255 lines change).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ops_agent_call(p_key_hash text, p_tool text, p_args jsonb, p_client text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' SET statement_timeout = '25s'
AS $$
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
    "Close a card only with close_work and proof that names what you read back. If it was already done, use push_back with already_done and the proof; if it should not be done, push_back with declined and the reason.",
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
  c_layers constant jsonb := '{"live":"events","expected":"expected","deadlines":"deadlines","promotions":"promotions","content":"content"}'::jsonb;
  -- #3980 synced: the chat's own name, and the key the connector derived
  v_chat_arg jsonb; v_chat_label text; v_chat_key text; v_chat_old text;
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
        v_items := 1; v_summary := '{"closed":1}'::jsonb;
      WHEN 'push_back' THEN
        v_result := public.ops_work_push_back((v_args->>'id')::uuid, v_args->>'kind', v_args->>'reason',
          COALESCE(v_args->'proof', '[]'::jsonb), (v_args->>'expected_revision')::bigint);
        v_items := 1; v_summary := '{"pushed_back":1}'::jsonb;
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
        IF jsonb_typeof(v_args->'layers') = 'array' THEN
          v_result := v_result - ARRAY(SELECT m.value FROM jsonb_each_text(c_layers) m
                                        WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_args->'layers') l WHERE l = m.key));
        END IF;
        v_summary := jsonb_build_object('events', jsonb_array_length(COALESCE(v_result->'events', '[]'::jsonb)),
                                        'expected', jsonb_array_length(COALESCE(v_result->'expected', '[]'::jsonb)));
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
$$;
-- ---------------------------------------------------------------------------
-- 10. Who can call what. Helpers are internal; the board's calls are for
--     signed-in teammates (each one checks crm_ctx()).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.ops_plan_from_subtasks(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_file_uploaded(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_file_json(public.ops_work_files) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_files_json(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_card_ancestors(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_subtasks_json(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_status_json(public.ops_work_statuses) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_status_rows(boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_status_renumber() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_plan_sync(uuid, jsonb, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_status_admin(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_status_check_name(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_status_check_color(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_file_mime_ok(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_message_json(public.ops_work_messages, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_message_mine(uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_people_only(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_capacity_hours(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_goal_json(public.ops_sprint_goals, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_sprint_row(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_plan_card_json(public.ops_work_cards, jsonb, boolean) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.ops_work_move(uuid, uuid, bigint, jsonb, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_subtask_add(uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_subtask_reorder(uuid, uuid[], bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_status_list(boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_status_add(text, text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_status_update(uuid, jsonb, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_status_move(uuid, integer, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_status_archive(uuid, uuid, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_file_add(uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_file_archive(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_file_sign(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_message_list(uuid, integer, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_message_post(uuid, text, text[], uuid, uuid[], boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_message_edit(uuid, text, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_message_delete(uuid, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_message_react(uuid, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_sprint_plan_get(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_sprint_goal_add(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_sprint_goal_update(uuid, jsonb, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_sprint_goal_archive(uuid, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_sprint_capacity_set(uuid, text, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_sprint_start(uuid, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_sprint_review_note_set(uuid, text, bigint) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.ops_work_move(uuid, uuid, bigint, jsonb, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_subtask_add(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_subtask_reorder(uuid, uuid[], bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_status_list(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_status_add(text, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_status_update(uuid, jsonb, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_status_move(uuid, integer, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_status_archive(uuid, uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_file_add(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_file_archive(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_file_sign(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_message_list(uuid, integer, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_message_post(uuid, text, text[], uuid, uuid[], boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_message_edit(uuid, text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_message_delete(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_message_react(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_sprint_plan_get(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_sprint_goal_add(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_sprint_goal_update(uuid, jsonb, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_sprint_goal_archive(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_sprint_capacity_set(uuid, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_sprint_start(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_sprint_review_note_set(uuid, text, bigint) TO authenticated;

COMMENT ON FUNCTION public.ops_work_move(uuid, uuid, bigint, jsonb, text, boolean) IS
  'Issue #4255. Drop a card in a board column with its revision (PT409 when stale). Into a Closed column: the ops_work_close rules (proof); close_children also closes its open subtasks. Out of Closed: the reopen rules. Between groups: ops_work_update''s status rules.';
COMMENT ON FUNCTION public.ops_message_post(uuid, text, text[], uuid, uuid[], boolean, text) IS
  'Issue #4255. Post in a card''s thread. Each message has a note event; mentions (and the replied-to author) are told through ops_notify_people, so the #4255 email rules are unchanged.';
COMMENT ON FUNCTION public.ops_plan_sync(uuid, jsonb, text, text) IS
  'Issue #4255. Plan steps written to a card become its subtasks (step n onto the n-th subtask). Internal.';

COMMIT;
