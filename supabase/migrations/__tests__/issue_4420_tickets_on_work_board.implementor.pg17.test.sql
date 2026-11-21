-- MINGLA-INVARIANT: I-4420-TICKETS-MADE-BY-PEOPLE | issue #4420 | a ticket is made only by a person who is Support staff or a Work board user; agents and every other account are refused (T-CREATE here).
-- MINGLA-INVARIANT: I-4420-NOTES-STAFF-ONLY | issue #4420 | conversations read through a ticket reach Support staff only, and a ticket close writes internal notes that no customer reads and that enqueue no customer notification (T-READ, T-CLOSE here).
-- MINGLA-INVARIANT: I-4420-SUPPORT-LINKS-PEOPLE-ONLY | issue #4420 | a support conversation link on any card is added or removed only by Support staff in person, never by an agent (T-LINK here; rule in ops_links_set).
-- MINGLA-INVARIANT: I-4420-ORDINARY-CARD-UNCHANGED | issue #4420 | ops_card_json and every ops_cards_json shape of a card that is not a ticket equal their output before #4420 byte for byte (T-SHAPE here).
--
-- Issue #4420 (Host polish pass, build step 1) -- implementor suite for
-- 20281121034420_issue_4420_tickets_on_work_board.sql on the fully replayed
-- PG17 schema. Everything is rolled back.
--
--   T-SHAPE   ordinary cards: card JSON (full, board, board_text and the
--             single-card builder) equals the pre-#4420 function bodies,
--             embedded below as pg_temp copies.
--   T-CREATE  Support staff create from a conversation (owner they pick,
--             creator watches); a Support-only member (no Work board) and a
--             Work board user (no conversations) can create; a Work board
--             user linking conversations, a customer, and an agent (ticket
--             create or add_work kind ticket) are refused.
--   T-AGENT   an agent updates a ticket (kind stays ticket) but cannot add a
--             support conversation link, by update_work or Link here.
--   T-LINK    Link here adds a reporter once; a Work board user who is not
--             Support staff cannot add a support conversation link.
--   T-READ    Support staff read messages, photos and internal notes; a Work
--             board user gets the count only; a customer is refused and reads
--             no ticket rows; anon executes none of the new functions.
--   T-CLOSE   closing writes one internal note per conversation from the
--             closer; the customer reads none of them; zero rows in the
--             notification tables for the customer.
--   T-MORE    similar, chips, search, type change, counts, Send to GitHub
--             signal (idempotent, operators only), roadmap notice refused.
--
-- Run from the repository root as supabase_admin.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists banned_until timestamptz;

create temp table tx_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tx_people (who, id, email) values
  ('seth', '44200000-0000-4000-a000-000000000001', 'seth.t4420@test.local'),
  ('tao',  '44200000-0000-4000-a000-000000000002', 'tao.t4420@test.local'),
  ('abi',  '44200000-0000-4000-a000-000000000003', 'abi.t4420@test.local'),
  ('sue',  '44200000-0000-4000-a000-000000000004', 'sue.t4420@test.local'),
  ('cus',  '44200000-0000-4000-a000-000000000005', 'cus.t4420@test.local'),
  ('cus2', '44200000-0000-4000-a000-000000000006', 'cus2.t4420@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tx_people;
-- seth: owner (Support staff, Work board, product operator). abi: admin.
-- tao: Work board (growth) but not Support staff. sue: Support staff with
-- no Work board (website role). cus, cus2: customers.
insert into public.admin_users (email, role, status, accepted_at) values
  ('seth.t4420@test.local', 'owner', 'active', now()), ('abi.t4420@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('tao.t4420@test.local', 'growth', 'active', now()), ('sue.t4420@test.local', 'website', 'active', now());
insert into public.support_staff (user_id, enabled, available) values ('44200000-0000-4000-a000-000000000004', true, true);

create temp table tx_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table tx_ids (k text primary key, id uuid not null) on commit drop;

create function pg_temp.as_(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  select id, email into strict v_id, v_email from tx_people where who = p_who;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', v_id::text, true);
    perform set_config('request.jwt.claim.email', v_email, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'email', v_email, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.role', '', true);
    execute p_sql into v_out;
    set constraints ops_4398_card_people_people, ops_4398_card_people_cards immediate;
    set constraints ops_4398_card_people_people, ops_4398_card_people_cards deferred;
    reset role;
    return v_out;
  exception when others then
    set constraints ops_4398_card_people_people, ops_4398_card_people_cards deferred;
    reset role;
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
end;
$fn$;
create function pg_temp.next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;
create function pg_temp.person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.next_request();
  return pg_temp.as_(p_who, p_sql);
end;
$fn$;
create function pg_temp.agent(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.next_request();
  select id, email into strict v_id, v_email from tx_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.as_(p_who, p_sql);
end;
$fn$;
create function pg_temp.chk(p_test text, p_label text, p_got text, p_want text) returns void
language sql as $fn$
  insert into tx_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 500), '<null>'), coalesce(p_want, '<null>')));
$fn$;
create function pg_temp.lk(p_test text, p_label text, p_got text, p_pattern text) returns void
language sql as $fn$
  insert into tx_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 500), '<null>'), p_pattern));
$fn$;
create function pg_temp.keep(p_k text, p_id uuid) returns uuid
language sql as $fn$ insert into tx_ids (k, id) values (p_k, p_id) on conflict (k) do update set id = excluded.id returning id $fn$;
create function pg_temp.id(p_k text) returns uuid language sql as $fn$ select id from tx_ids where k = p_k $fn$;
create function pg_temp.uid(p_who text) returns uuid language sql as $fn$ select id from tx_people where who = p_who $fn$;
create function pg_temp.email(p_who text) returns text language sql as $fn$ select email from tx_people where who = p_who $fn$;
create function pg_temp.rev(p_k text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = pg_temp.id(p_k) $fn$;
-- Notification rows that name a user, across the tables the message
-- triggers and the notification pipeline write.
create function pg_temp.notes_for(p_uid uuid) returns bigint
language plpgsql as $fn$
declare v bigint := 0; r record; n bigint;
begin
  for r in select c.table_name, c.column_name from information_schema.columns c
            where c.table_schema = 'public'
              and c.table_name in ('notification_outbox', 'notification_deliveries', 'notifications')
              and c.column_name in ('user_id', 'recipient_user_id', 'recipient_id') loop
    execute format('select count(*) from public.%I where %I = $1', r.table_name, r.column_name) into n using p_uid;
    v := v + n;
  end loop;
  return v;
end;
$fn$;

-- The pre-#4420 bodies, copied verbatim from 20280626014398_issue_4398_review_and_notices.sql (ops_card_json)
-- and 20280707004423_issue_4423_w2_ops_set_based_card_builders.sql (ops_cards_json), as pg_temp functions.
CREATE FUNCTION pg_temp.before_card_json(c public.ops_work_cards, p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
    'in_backlog', c.in_backlog)
    -- #4398: review, send back, confirm, and a release card's live checklist.
    || jsonb_build_object(
    'review', CASE WHEN c.review_requested_at IS NOT NULL THEN jsonb_build_object(
        'requested_at', c.review_requested_at, 'requested_by_name', public.ops_name(c.review_requested_by),
        'requested_via', c.review_requested_via, 'kind', c.review_kind, 'reason', c.review_reason,
        'waiting_on', public.ops_name((public.ops_card_people(c.id, 'watcher'))[1])) END,
    'sent_back', CASE WHEN c.sent_back_at IS NOT NULL THEN jsonb_build_object('reason', c.sent_back_reason,
        'by_name', public.ops_name(c.sent_back_by), 'at', c.sent_back_at) END,
    'confirmed_by_name', CASE WHEN c.confirmed_by IS NOT NULL THEN public.ops_name(c.confirmed_by) END,
    'confirmed_at', c.confirmed_at,
    'release_items', CASE WHEN c.auto_key ~ '^eng_release:pr-[0-9]+$'
        THEN public.ops_release_items(substring(c.auto_key FROM ':pr-([0-9]+)$')::integer) END);
END;
$function$;

CREATE FUNCTION pg_temp.before_cards_json(p_ids uuid[], p_today date, p_shape text DEFAULT 'full')
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_names jsonb; v_anon text := public.ops_name(NULL); v_out jsonb; v_full boolean := p_shape = 'full';
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
           -- board links carry kind and id (the linked filter and the draft split);
           -- only full carries the label and checks each target still exists.
           jsonb_agg(CASE WHEN p_shape = 'full'
                          THEN jsonb_build_object('kind', l.kind, 'id', l.target_id, 'label', l.label,
                                                  'exists', public.ops_link_label(l.kind, l.target_id) IS NOT NULL)
                          ELSE jsonb_build_object('kind', l.kind, 'id', l.target_id) END
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
      -- The fields both shapes carry: exactly ops_card_json's values for full,
      -- trimmed to what the Admin list reads for board (rework 1, P3-2).
      jsonb_build_object(
        'id', p.id, 'number', p.number, 'title', p.title, 'status', p.status,
        'blocked', p.blocked,
        'person_reason', p.person_reason, 'tag', p.person_reason,
        'anchor', CASE WHEN NOT v_full AND jsonb_typeof(p.anchor) = 'object' THEN jsonb_build_object('kind', p.anchor->'kind') ELSE p.anchor END,
        'due_on', p.due_on, 'overdue', (p.due_on < p_today AND p.status <> 'done'),
        'owners', COALESCE(p.owners, '[]'::jsonb), 'watchers', COALESCE(p.watchers, '[]'::jsonb),
        'links', COALESCE(p.links, '[]'::jsonb),
        'proof', CASE WHEN v_full OR jsonb_typeof(p.proof) IS DISTINCT FROM 'array' THEN p.proof
                      ELSE (SELECT COALESCE(jsonb_agg(CASE WHEN jsonb_typeof(x.e) = 'object'
                                                            THEN jsonb_build_object('kind', x.e->'kind', 'id', x.e->'id') ELSE x.e END
                                                       ORDER BY x.o), '[]'::jsonb)
                              FROM jsonb_array_elements(p.proof) WITH ORDINALITY x(e, o)) END,
        'closed_at', p.closed_at,
        'working', CASE WHEN v_full OR p.working IS NULL THEN p.working
                        ELSE jsonb_build_object('name', p.working->'name', 'quiet', p.working->'quiet',
                                                'last_update_at', p.working->'last_update_at') END,
        'revision', p.revision,
        'auto', p.auto_key IS NOT NULL,
        'auto_kind', CASE WHEN p.auto_key IS NOT NULL THEN split_part(p.auto_key, ':', 1) END,
        'archived', p.archived_at IS NOT NULL)
      || jsonb_build_object(
        'status_id', p.status_id,
        'parent', CASE WHEN p.parent_id IS NOT NULL AND p.pc_id IS NOT NULL THEN
                    CASE WHEN v_full THEN jsonb_build_object('id', p.pc_id, 'number', p.pc_number, 'title', p.pc_title,
                                                             'parent_id', p.pc_parent_id)
                         ELSE jsonb_build_object('id', p.pc_id, 'number', p.pc_number, 'title', p.pc_title) END END,
        'depth', p.depth, 'position', p.position,
        'estimate_minutes', p.estimate_minutes,
        'subtasks', jsonb_build_object('total', COALESCE(p.kids_total, 0), 'done', COALESCE(p.kids_done, 0)),
        'files_count', COALESCE(p.files_n, 0), 'thread_count', COALESCE(p.msgs_n, 0),
        'goal', CASE WHEN p.goal_id IS NOT NULL AND p.gl_id IS NOT NULL THEN
                  CASE WHEN v_full THEN jsonb_build_object('id', p.gl_id, 'title', p.gl_title, 'state', p.gl_state)
                       ELSE jsonb_build_object('id', p.gl_id, 'title', p.gl_title) END END,
        'review', CASE WHEN p.review_requested_at IS NULL THEN NULL
          WHEN v_full THEN jsonb_build_object(
            'requested_at', p.review_requested_at, 'requested_by_name', v_names->>p.review_requested_by,
            'requested_via', p.review_requested_via, 'kind', p.review_kind, 'reason', p.review_reason,
            'waiting_on', CASE WHEN p.first_watcher IS NULL THEN v_anon ELSE v_names->>p.first_watcher END)
          ELSE jsonb_build_object('requested_at', p.review_requested_at,
            'waiting_on', CASE WHEN p.first_watcher IS NULL THEN v_anon ELSE v_names->>p.first_watcher END) END,
        'sent_back', CASE WHEN p.sent_back_at IS NULL THEN NULL
          WHEN v_full THEN jsonb_build_object('reason', p.sent_back_reason, 'by_name', v_names->>p.sent_back_by, 'at', p.sent_back_at)
          ELSE jsonb_build_object('reason', p.sent_back_reason) END,
        'release_items', p.release_items) AS common,
      -- The fields only 'full' carries.
      CASE WHEN p_shape = 'full' THEN
        -- Read by no Admin list (rework 1, P3-2), so full only.
        jsonb_build_object(
          'blocked_kind', p.blocked_kind, 'carried_count', p.carried_count, 'start_on', p.start_on, 'in_backlog', p.in_backlog,
          'claim', CASE WHEN p.working IS NOT NULL AND NOT (p.working->>'quiet')::boolean THEN jsonb_build_object(
            'holder_name', v_names->>p.working_by, 'holder_via', p.working_via,
            'holder_chat_label', p.working->'chat_label', 'since', p.working->'since',
            'ends_at', COALESCE(p.working_seen_at, p.started_at) + interval '24 hours') END)
        || jsonb_build_object(
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

-- Fixtures: two customer conversations with a message, a photo and a
-- staff internal note.
do $f$
declare v_conv uuid; v_st uuid; v_msg uuid; v_who text; i integer := 0;
begin
  foreach v_who in array array['cus', 'cus2'] loop
    i := i + 1;
    v_conv := gen_random_uuid();
    insert into public.conversations (id, type, linked_entity_type, name, created_by, created_at, updated_at, last_message_at)
    values (v_conv, 'group', 'support', 'T4420 help ' || i, pg_temp.uid(v_who), now(), now(), now());
    insert into public.conversation_participants (conversation_id, user_id) values (v_conv, pg_temp.uid(v_who));
    insert into public.support_tickets (requester_user_id, requester_segment, subject, conversation_id)
    values (pg_temp.uid(v_who), 'business', 'T4420 the guest list will not export ' || i, v_conv) returning id into v_st;
    perform pg_temp.keep('ST' || i, v_st);
    perform pg_temp.keep('CONV' || i, v_conv);
    insert into public.messages (conversation_id, sender_id, content, message_type)
    values (v_conv, pg_temp.uid(v_who), 'My guest list will not export, here is a photo.', 'text') returning id into v_msg;
    insert into public.support_attachments (ticket_id, message_id, storage_path, kind, mime, bytes, uploaded_by)
    values (v_st, v_msg, v_st::text || '/' || gen_random_uuid()::text || '.jpg', 'image', 'image/jpeg', 1000, pg_temp.uid(v_who));
    insert into public.messages (conversation_id, sender_id, content, message_type, is_internal)
    values (v_conv, pg_temp.uid('seth'), 'T4420 staff-only: checked the export logs.', 'text', true);
  end loop;
end;
$f$;

-- ───────────────────────────── T-SHAPE ─────────────────────────────
do $t$
declare v text; c public.ops_work_cards; v_ids uuid[];
begin
  v := pg_temp.person('seth', format('select public.ops_work_add(%L::jsonb, %L)::text',
    jsonb_build_array(
      jsonb_build_object('title', 'T4420 ordinary card one', 'instructions', 'Post the two videos for the launch.',
        'done_means', 'Both videos are posted.', 'owners', jsonb_build_array(pg_temp.email('tao')), 'watchers', jsonb_build_array(pg_temp.email('seth')),
        'github', jsonb_build_array('#4420'), 'due_on', (current_date + 5)::text),
      jsonb_build_object('title', 'T4420 ordinary card two', 'instructions', 'Write the host email for the launch.',
        'done_means', 'The email is drafted.', 'owners', jsonb_build_array(pg_temp.email('seth')), 'watchers', jsonb_build_array(pg_temp.email('abi')), 'due_on', (current_date + 6)::text)),
    'T4420-shape-0001'));
  perform pg_temp.lk('T-SHAPE', 'two ordinary cards added', v, '%"added": 2%');
  v_ids := array(select w.id from public.ops_work_cards w where w.title like 'T4420 ordinary card %' order by w.number);
  perform pg_temp.keep('ORD1', v_ids[1]);
  for c in select * from public.ops_work_cards w where w.id = any (v_ids) loop
    perform pg_temp.chk('T-SHAPE', 'ops_card_json equals the pre-#4420 body: ' || c.title,
      public.ops_card_json(c, current_date)::text, pg_temp.before_card_json(c, current_date)::text);
  end loop;
  perform pg_temp.chk('T-SHAPE', 'ops_cards_json full equals the pre-#4420 body',
    public.ops_cards_json(v_ids, current_date, 'full')::text, pg_temp.before_cards_json(v_ids, current_date, 'full')::text);
  perform pg_temp.chk('T-SHAPE', 'ops_cards_json board equals the pre-#4420 body',
    public.ops_cards_json(v_ids, current_date, 'board')::text, pg_temp.before_cards_json(v_ids, current_date, 'board')::text);
  perform pg_temp.chk('T-SHAPE', 'ops_cards_json board_text equals the pre-#4420 body',
    public.ops_cards_json(v_ids, current_date, 'board_text')::text, pg_temp.before_cards_json(v_ids, current_date, 'board_text')::text);
  perform pg_temp.chk('T-SHAPE', 'an ordinary card has no ticket key',
    (public.ops_cards_json(v_ids, current_date, 'full')->0 ? 'ticket')::text, 'false');
end;
$t$;

-- ───────────────────────────── T-CREATE ─────────────────────────────
do $t$
declare v text; j jsonb; j_brand uuid;
begin
  -- Support staff (abi, also on the Work board) from a conversation; picks tao as owner.
  v := pg_temp.person('abi', format('select public.ops_ticket_create(%L::jsonb, %L)::text',
    jsonb_build_object('type', 'bug', 'title', 'T4420 Guest list export fails', 'what_is_wrong', 'The guest list export button does nothing for this host.',
      'product_area', 'Guests', 'created_from', 'conversation', 'conversation_ids', jsonb_build_array(pg_temp.id('ST1')),
      'owners', jsonb_build_array(pg_temp.email('tao'))), 'T4420-create-0001'));
  j := v::jsonb;
  perform pg_temp.chk('T-CREATE', 'Support staff create a ticket', j->>'status', 'added');
  perform pg_temp.keep('TK', (j->'card'->>'id')::uuid);
  perform pg_temp.chk('T-CREATE', 'the card is kind ticket in To do', (select kind || '/' || status from public.ops_work_cards where id = pg_temp.id('TK')), 'ticket/todo');
  perform pg_temp.chk('T-CREATE', 'the owner is the one the creator picked', array_to_string(public.ops_card_people(pg_temp.id('TK'), 'owner'), ','), pg_temp.email('tao'));
  perform pg_temp.chk('T-CREATE', 'the creator watches', array_to_string(public.ops_card_people(pg_temp.id('TK'), 'watcher'), ','), pg_temp.email('abi'));
  perform pg_temp.chk('T-CREATE', 'the conversation is linked with a neutral label',
    (select l.label from public.ops_work_links l where l.card_id = pg_temp.id('TK') and l.kind = 'support_conversation'),
    'Conversation ' || (select ticket_number from public.support_tickets where id = pg_temp.id('ST1')));
  perform pg_temp.chk('T-CREATE', 'the card JSON carries the ticket object',
    (j->'card'->'ticket')::text, jsonb_build_object('type', 'bug', 'product_area', 'Guests', 'created_from', 'conversation', 'reporter_count', 1, 'source_signal_id', null)::text);
  perform pg_temp.chk('T-CREATE', 'list_work shape carries the ticket object',
    (public.ops_cards_json(array[pg_temp.id('TK')], current_date, 'full')->0->'ticket'->>'type'), 'bug');
  perform pg_temp.chk('T-CREATE', 'a repeat of the same request replays',
    (pg_temp.person('abi', format('select public.ops_ticket_create(%L::jsonb, %L)::text',
      jsonb_build_object('type', 'bug', 'title', 'T4420 Guest list export fails', 'what_is_wrong', 'The guest list export button does nothing for this host.',
        'product_area', 'Guests', 'created_from', 'conversation', 'conversation_ids', jsonb_build_array(pg_temp.id('ST1')),
        'owners', jsonb_build_array(pg_temp.email('tao'))), 'T4420-create-0001'))::jsonb->>'replayed'), 'true');
  -- Owner = creator and no watcher named: refused like any card.
  v := pg_temp.person('abi', format('select public.ops_ticket_create(%L::jsonb, %L)::text',
    jsonb_build_object('type', 'idea', 'title', 'T4420 Self owned idea', 'what_is_wrong', 'An idea with nobody to watch it at all.',
      'product_area', 'Home', 'owners', jsonb_build_array(pg_temp.email('abi'))), 'T4420-create-0002'));
  perform pg_temp.chk('T-CREATE', 'a ticket needs a watcher, as any card', (v::jsonb->>'status') || '/' || (v::jsonb->'fixes' @> '[{"field":"watchers"}]')::text, 'refused/true');
  perform pg_temp.chk('T-CREATE', 'the refusal says the card rule in its words',
    (v::jsonb->'fixes' @> '[{"field":"watchers","message":"A card has one watcher, who is not the owner."}]')::text, 'true');
  -- Rework 2 (P1-A): the form's default is the creator as owner; with the
  -- watcher picked in the form's Watcher field the ticket is made.
  v := pg_temp.person('abi', format('select public.ops_ticket_create(%L::jsonb, %L)::text',
    jsonb_build_object('type', 'bug', 'title', 'T4420 Self owned bug with a watcher', 'what_is_wrong', 'The creator owns it and picked a watcher.',
      'product_area', 'Home', 'created_from', 'board', 'owners', jsonb_build_array(pg_temp.email('abi')), 'watchers', jsonb_build_array(pg_temp.email('tao'))), 'T4420-create-0012'));
  perform pg_temp.chk('T-CREATE', 'creator = owner with a watcher picked: made', v::jsonb->>'status', 'added');
  perform pg_temp.chk('T-CREATE', 'creator = owner: owner and watcher are the ones sent',
    array_to_string(public.ops_card_people((v::jsonb->'card'->>'id')::uuid, 'owner'), ',') || '/' || array_to_string(public.ops_card_people((v::jsonb->'card'->>'id')::uuid, 'watcher'), ','),
    pg_temp.email('abi') || '/' || pg_temp.email('tao'));
  -- The watcher is the owner: refused with the card rule's words, nothing made.
  v := pg_temp.person('abi', format('select public.ops_ticket_create(%L::jsonb, %L)::text',
    jsonb_build_object('type', 'bug', 'title', 'T4420 Owner watches own ticket', 'what_is_wrong', 'The owner was also named as the watcher.',
      'product_area', 'Home', 'owners', jsonb_build_array(pg_temp.email('abi')), 'watchers', jsonb_build_array(pg_temp.email('abi'))), 'T4420-create-0013'));
  perform pg_temp.chk('T-CREATE', 'watcher = owner is refused like any card',
    (v::jsonb->>'status') || '/' || (v::jsonb->'fixes' @> '[{"field":"watchers","message":"A card has one watcher, who is not the owner."}]')::text
      || '/' || (select count(*)::text from public.ops_work_cards where title = 'T4420 Owner watches own ticket'), 'refused/true/0');
  -- Creator not the owner, no watcher sent: the creator watches.
  v := pg_temp.person('abi', format('select public.ops_ticket_create(%L::jsonb, %L)::text',
    jsonb_build_object('type', 'task', 'title', 'T4420 Owned by someone else', 'what_is_wrong', 'The creator gives it to another person.',
      'product_area', 'Home', 'owners', jsonb_build_array(pg_temp.email('seth'))), 'T4420-create-0014'));
  perform pg_temp.chk('T-CREATE', 'creator not owner: made and the creator watches',
    (v::jsonb->>'status') || '/' || array_to_string(public.ops_card_people((v::jsonb->'card'->>'id')::uuid, 'watcher'), ','), 'added/' || pg_temp.email('abi'));
  -- The same rule from a conversation (Support Create ticket) and from a Brand group.
  v := pg_temp.person('abi', format('select public.ops_ticket_create(%L::jsonb, %L)::text',
    jsonb_build_object('type', 'bug', 'title', 'T4420 Self owned from a conversation', 'what_is_wrong', 'Support staff own it and picked a watcher.',
      'product_area', 'Guests', 'created_from', 'conversation', 'conversation_ids', jsonb_build_array(pg_temp.id('ST2')),
      'owners', jsonb_build_array(pg_temp.email('abi')), 'watchers', jsonb_build_array(pg_temp.email('seth'))), 'T4420-create-0015'));
  perform pg_temp.chk('T-CREATE', 'from a conversation, creator = owner with a watcher: made', v::jsonb->>'status', 'added');
  v := pg_temp.person('abi', format('select public.ops_ticket_create(%L::jsonb, %L)::text',
    jsonb_build_object('type', 'bug', 'title', 'T4420 Self owned from a conversation, no watcher', 'what_is_wrong', 'Support staff own it and picked nobody.',
      'product_area', 'Guests', 'created_from', 'conversation', 'conversation_ids', jsonb_build_array(pg_temp.id('ST2')),
      'owners', jsonb_build_array(pg_temp.email('abi'))), 'T4420-create-0016'));
  perform pg_temp.chk('T-CREATE', 'from a conversation, creator = owner and no watcher: refused',
    (v::jsonb->>'status') || '/' || (v::jsonb->'fixes' @> '[{"field":"watchers"}]')::text, 'refused/true');
  insert into public.creator_accounts (id) values (pg_temp.uid('seth')) on conflict (id) do nothing;
  insert into public.brands (id, account_id, name, slug, payment_provider, pricing_region, pricing_currency, default_currency, contact_email)
  values (gen_random_uuid(), pg_temp.uid('seth'), 'T4420 Brand', 't4420-brand-' || substr(md5(random()::text), 1, 8), 'stripe', 'US', 'USD', 'USD', 't4420-brand@example.test')
  returning id into j_brand;
  v := pg_temp.person('abi', format('select public.ops_ticket_create(%L::jsonb, %L)::text',
    jsonb_build_object('type', 'idea', 'title', 'T4420 Self owned from a Brand group', 'what_is_wrong', 'A brand group asked for this; the creator owns it.',
      'product_area', 'Brand groups', 'created_from', 'brand_group', 'brand_id', j_brand,
      'owners', jsonb_build_array(pg_temp.email('abi')), 'watchers', jsonb_build_array(pg_temp.email('tao'))), 'T4420-create-0017'));
  perform pg_temp.chk('T-CREATE', 'from a Brand group, creator = owner with a watcher: made', v::jsonb->>'status', 'added');
  v := pg_temp.person('abi', format('select public.ops_ticket_create(%L::jsonb, %L)::text',
    jsonb_build_object('type', 'idea', 'title', 'T4420 Self owned from a Brand group, no watcher', 'what_is_wrong', 'A brand group asked; nobody was picked to watch.',
      'product_area', 'Brand groups', 'created_from', 'brand_group', 'brand_id', j_brand,
      'owners', jsonb_build_array(pg_temp.email('abi'))), 'T4420-create-0018'));
  perform pg_temp.chk('T-CREATE', 'from a Brand group, creator = owner and no watcher: refused',
    (v::jsonb->>'status') || '/' || (v::jsonb->'fixes' @> '[{"field":"watchers"}]')::text, 'refused/true');
  -- Support-only member (no Work board).
  v := pg_temp.person('sue', format('select public.ops_ticket_create(%L::jsonb, %L)::text',
    jsonb_build_object('type', 'question', 'title', 'T4420 Payout question from a host', 'what_is_wrong', 'The host asks when the payout arrives.',
      'product_area', 'Payouts', 'created_from', 'conversation', 'conversation_ids', jsonb_build_array(pg_temp.id('ST2')),
      'owners', jsonb_build_array(pg_temp.email('seth'))), 'T4420-create-0003'));
  perform pg_temp.chk('T-CREATE', 'Support staff without the Work board create from a conversation', v::jsonb->>'status', 'added');
  perform pg_temp.keep('TK2', (v::jsonb->'card'->>'id')::uuid);
  -- Work board user, not Support staff: from the board, yes; with a conversation, no.
  v := pg_temp.person('tao', format('select public.ops_ticket_create(%L::jsonb, %L)::text',
    jsonb_build_object('type', 'task', 'title', 'T4420 Board made task ticket', 'what_is_wrong', 'Tidy the guest list export copy.',
      'product_area', 'Guests', 'owners', jsonb_build_array(pg_temp.email('tao')), 'watchers', jsonb_build_array(pg_temp.email('seth'))), 'T4420-create-0004'));
  perform pg_temp.chk('T-CREATE', 'a Work board user creates from the board', v::jsonb->>'status', 'added');
  perform pg_temp.keep('TK3', (v::jsonb->'card'->>'id')::uuid);
  v := pg_temp.person('tao', format('select public.ops_ticket_create(%L::jsonb, %L)::text',
    jsonb_build_object('type', 'bug', 'title', 'T4420 Board user links a conversation', 'what_is_wrong', 'Trying to link a customer conversation.',
      'product_area', 'Guests', 'conversation_ids', jsonb_build_array(pg_temp.id('ST2')), 'owners', jsonb_build_array(pg_temp.email('tao'))), 'T4420-create-0005'));
  perform pg_temp.lk('T-CREATE', 'a Work board user who is not Support staff cannot link a conversation', v, 'ERR:42501:support_required:%');
  -- A customer.
  v := pg_temp.person('cus', format('select public.ops_ticket_create(%L::jsonb, %L)::text',
    jsonb_build_object('type', 'bug', 'title', 'T4420 Customer makes a ticket', 'what_is_wrong', 'A customer should never make one.',
      'product_area', 'Guests', 'owners', jsonb_build_array(pg_temp.email('seth'))), 'T4420-create-0006'));
  perform pg_temp.lk('T-CREATE', 'a customer cannot create a ticket', v, 'ERR:42501:forbidden:%');
  -- An agent: by the ticket function, and by add_work with kind ticket.
  v := pg_temp.agent('seth', format('select public.ops_ticket_create(%L::jsonb, %L)::text',
    jsonb_build_object('type', 'bug', 'title', 'T4420 Agent makes a ticket', 'what_is_wrong', 'An agent should never make one.',
      'product_area', 'Guests', 'owners', jsonb_build_array(pg_temp.email('seth'))), 'T4420-create-0007'));
  perform pg_temp.lk('T-CREATE', 'an agent cannot create a ticket', v, 'ERR:42501:people_only:%');
  v := pg_temp.agent('seth', format('select public.ops_work_add(%L::jsonb, %L)::text',
    jsonb_build_array(jsonb_build_object('title', 'T4420 Agent add_work ticket', 'instructions', 'An agent should never make one.',
      'done_means', 'Never made.', 'kind', 'ticket', 'due_on', (current_date + 5)::text, 'owners', jsonb_build_array(pg_temp.email('seth')), 'watchers', jsonb_build_array(pg_temp.email('abi')))),
    'T4420-create-0008'));
  perform pg_temp.lk('T-CREATE', 'add_work with kind ticket is refused with the ticket message', v, '%Tickets are made with Create ticket in Admin.%');
  perform pg_temp.chk('T-CREATE', 'no card came from the refused agent calls',
    (select count(*)::text from public.ops_work_cards where title like 'T4420 Agent %'), '0');
end;
$t$;

-- ───────────────────────────── T-AGENT / T-LINK ─────────────────────────────
do $t$
declare v text; j jsonb;
begin
  v := pg_temp.agent('tao', format('select public.ops_work_update(%L, %L::jsonb, %s)::text', pg_temp.id('TK'),
         jsonb_build_object('title', 'T4420 Guest list export fails on Safari'), pg_temp.rev('TK')));
  perform pg_temp.chk('T-AGENT', 'an agent updates a ticket and it stays a ticket',
    (select kind || '/' || title from public.ops_work_cards where id = pg_temp.id('TK')), 'ticket/T4420 Guest list export fails on Safari');
  v := pg_temp.agent('tao', format('select public.ops_work_update(%L, %L::jsonb, %s)::text', pg_temp.id('TK'),
         jsonb_build_object('links', jsonb_build_array(jsonb_build_object('kind', 'support_conversation', 'id', pg_temp.id('ST1')),
                                                       jsonb_build_object('kind', 'support_conversation', 'id', pg_temp.id('ST2')))), pg_temp.rev('TK')));
  perform pg_temp.lk('T-AGENT', 'an agent cannot add a support conversation link by update_work', v, 'ERR:42501:people_only:%');
  v := pg_temp.agent('seth', format('select public.ops_ticket_link_conversation(%L, %L, %s)::text', pg_temp.id('TK'), pg_temp.id('ST2'), pg_temp.rev('TK')));
  perform pg_temp.lk('T-AGENT', 'an agent cannot use Link here', v, 'ERR:42501:people_only:%');
  v := pg_temp.agent('tao', format('select public.ops_work_update(%L, %L::jsonb, %s)::text', pg_temp.id('ORD1'),
         jsonb_build_object('links', jsonb_build_array(jsonb_build_object('kind', 'support_conversation', 'id', pg_temp.id('ST2')))), pg_temp.rev('ORD1')));
  perform pg_temp.lk('T-AGENT', 'an agent cannot link a conversation to an ordinary card', v, 'ERR:42501:people_only:%');
  v := pg_temp.person('tao', format('select public.ops_work_update(%L, %L::jsonb, %s)::text', pg_temp.id('ORD1'),
         jsonb_build_object('links', jsonb_build_array(jsonb_build_object('kind', 'support_conversation', 'id', pg_temp.id('ST2')))), pg_temp.rev('ORD1')));
  perform pg_temp.lk('T-LINK', 'a Work board user who is not Support staff cannot link a conversation', v, 'ERR:42501:support_required:%');
  perform pg_temp.chk('T-LINK', 'the ticket still has one reporter',
    (select count(*)::text from public.ops_work_links where card_id = pg_temp.id('TK') and kind = 'support_conversation'), '1');
  v := pg_temp.person('abi', format('select public.ops_ticket_link_conversation(%L, %L, %s)::text', pg_temp.id('TK'), pg_temp.id('ST2'), pg_temp.rev('TK')));
  perform pg_temp.chk('T-LINK', 'Link here adds a reporter', (v::jsonb->>'changed') || '/' || (v::jsonb->'card'->'ticket'->>'reporter_count'), 'true/2');
  v := pg_temp.person('abi', format('select public.ops_ticket_link_conversation(%L, %L, %s)::text', pg_temp.id('TK'), pg_temp.id('ST2'), pg_temp.rev('TK')));
  perform pg_temp.chk('T-LINK', 'Link here twice changes nothing', v::jsonb->>'changed', 'false');
end;
$t$;

-- ───────────────────────────── T-READ ─────────────────────────────
do $t$
declare v text; j jsonb; p record;
begin
  v := pg_temp.person('sue', format('select public.ops_ticket_conversations(%L)::text', pg_temp.id('TK')));
  j := v::jsonb;
  perform pg_temp.chk('T-READ', 'Support staff read both conversations', (j->>'access') || '/' || jsonb_array_length(j->'conversations'), 'support/2');
  perform pg_temp.chk('T-READ', 'with the customer message, the photo and the internal note',
    ((j->'conversations'->0->'messages') @> '[{"sender_kind":"customer"}]'
     and (j->'conversations'->0->'messages') @> '[{"is_internal":true}]'
     and (select count(*) from jsonb_array_elements(j->'conversations'->0->'messages') m
           where jsonb_array_length(m->'attachments') = 1 and m->>'sender_kind' = 'customer') = 1)::text, 'true');
  v := pg_temp.person('tao', format('select public.ops_ticket_conversations(%L)::text', pg_temp.id('TK')));
  perform pg_temp.chk('T-READ', 'a Work board user without Support access gets the count only', v,
    jsonb_build_object('access', 'support_required', 'reporter_count', 2)::text);
  v := pg_temp.person('cus', format('select public.ops_ticket_conversations(%L)::text', pg_temp.id('TK')));
  perform pg_temp.lk('T-READ', 'the customer cannot read a ticket''s conversations', v, 'ERR:42501:forbidden:%');
  v := pg_temp.person('cus', 'select count(*)::text from public.ops_work_tickets');
  perform pg_temp.lk('T-READ', 'the customer reads no ticket rows', v, 'ERR:42501:%');
  v := pg_temp.person('cus', format('select count(*)::text from public.ops_work_links where card_id = %L', pg_temp.id('TK')));
  perform pg_temp.chk('T-READ', 'the customer reads no ticket links (refused or zero rows)', (v = '0' or v like 'ERR:42501:%')::text, 'true');
  v := pg_temp.person('cus', format('select public.issue_4420_conversation_tickets(array[%L]::uuid[])::text', pg_temp.id('ST1')));
  perform pg_temp.lk('T-READ', 'the customer gets no ticket chips', v, 'ERR:42501:%');
  for p in select pr.oid::regprocedure::text AS sig, pr.oid from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
            where n.nspname = 'public' and (pr.proname like 'ops\_ticket\_%' or pr.proname like 'ops\_4420\_%'
              or pr.proname in ('issue_4420_conversation_tickets', 'issue_4420_conversation_search', 'issue_4420_ticket_for_signal',
                                'issue_4420_ticket_signal_ensure', 'issue_4420_ticket_github_mirror')) loop
    perform pg_temp.chk('T-READ', 'anon cannot execute ' || p.sig, has_function_privilege('anon', p.oid, 'EXECUTE')::text, 'false');
  end loop;
  perform pg_temp.chk('T-READ', 'internal helpers are not callable by signed-in users',
    (has_function_privilege('authenticated', 'public.ops_4420_ticket_ctx()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.ops_ticket_json(uuid)', 'EXECUTE'))::text, 'false');
end;
$t$;

-- ───────────────────────────── T-CLOSE ─────────────────────────────
do $t$
declare v text; v_before1 bigint := pg_temp.notes_for(pg_temp.uid('cus')); v_before2 bigint := pg_temp.notes_for(pg_temp.uid('cus2'));
        v_msgs_before bigint := (select count(*) from public.messages where conversation_id in (pg_temp.id('CONV1'), pg_temp.id('CONV2')));
begin
  -- The watcher's own close is Done (#4398).
  v := pg_temp.person('abi', format('select public.ops_work_close(%L, %L::jsonb, %L, %s)::text', pg_temp.id('TK'),
         '[{"kind":"text","text":"Fixed in the export service."}]', 'Fixed: the export works on Safari.', pg_temp.rev('TK')));
  perform pg_temp.chk('T-CLOSE', 'the ticket is closed', (select status from public.ops_work_cards where id = pg_temp.id('TK')), 'done');
  perform pg_temp.chk('T-CLOSE', 'one note per linked conversation',
    (select count(*) - v_msgs_before from public.messages where conversation_id in (pg_temp.id('CONV1'), pg_temp.id('CONV2')))::text, '2');
  perform pg_temp.chk('T-CLOSE', 'each note is internal, from the closer, and says the result',
    (select count(*)::text from public.messages where conversation_id in (pg_temp.id('CONV1'), pg_temp.id('CONV2'))
      and is_internal and sender_id = pg_temp.uid('abi') and message_type = 'text'
      and content = format('Ticket %s closed: Fixed: the export works on Safari.', (select number from public.ops_work_cards where id = pg_temp.id('TK')))), '2');
  v := pg_temp.person('cus', format('select count(*)::text from public.messages where conversation_id = %L and (is_internal or content like %L)',
         pg_temp.id('CONV1'), 'Ticket %'));
  perform pg_temp.chk('T-CLOSE', 'the customer reads no internal note and no close note', v, '0');
  v := pg_temp.person('cus', format('select count(*)::text from public.messages where conversation_id = %L', pg_temp.id('CONV1')));
  perform pg_temp.chk('T-CLOSE', 'the customer still reads their own message', v, '1');
  perform pg_temp.chk('T-CLOSE', 'zero notification rows for either customer',
    (pg_temp.notes_for(pg_temp.uid('cus')) - v_before1)::text || '/' || (pg_temp.notes_for(pg_temp.uid('cus2')) - v_before2)::text, '0/0');
  perform pg_temp.chk('T-CLOSE', 'the notification tables exist to be checked',
    ((select count(*) from information_schema.columns c where c.table_schema = 'public'
       and c.table_name in ('notification_outbox', 'notification_deliveries', 'notifications')
       and c.column_name in ('user_id', 'recipient_user_id', 'recipient_id')) >= 1)::text, 'true');
end;
$t$;

-- ───────────────────────────── T-MORE ─────────────────────────────
do $t$
declare v text; j jsonb; v_sig uuid;
begin
  v := pg_temp.person('sue', 'select public.ops_ticket_similar(''payout arrives late'', 5)::text');
  perform pg_temp.chk('T-MORE', 'similar open tickets by title words', v::jsonb->0->>'title', 'T4420 Payout question from a host');
  perform pg_temp.chk('T-MORE', 'similar gives titles and counts only', (select string_agg(k, ',' order by k) from jsonb_object_keys(v::jsonb->0) k), 'id,number,reporter_count,title,type');
  v := pg_temp.person('sue', format('select public.issue_4420_conversation_tickets(array[%L, %L]::uuid[])::text', pg_temp.id('ST1'), pg_temp.id('ST2')));
  -- 4: TK on ST1 and ST2, TK2 on ST2, and the rework 2 self-owned ticket on ST2.
  perform pg_temp.chk('T-MORE', 'inbox chips: one per ticket per conversation', jsonb_array_length(v::jsonb)::text, '4');
  v := pg_temp.person('sue', format('select public.issue_4420_conversation_search(%L)::text', (select ticket_number::text from public.support_tickets where id = pg_temp.id('ST2'))));
  perform pg_temp.chk('T-MORE', 'search by conversation number', v::jsonb->0->>'id', pg_temp.id('ST2')::text);
  v := pg_temp.person('seth', format('select public.issue_4420_ticket_signal_ensure(%L)::text', pg_temp.id('TK3')));
  perform pg_temp.lk('T-MORE', 'a task ticket does not get a signal', v, 'ERR:22023:not_for_github:%');
  v := pg_temp.agent('tao', format('select public.ops_ticket_update(%L, %L::jsonb, %s)::text', pg_temp.id('TK3'),
         '{"type":"question","product_area":"Guest list"}', pg_temp.rev('TK3')));
  perform pg_temp.chk('T-MORE', 'type and product area change (agents update tickets)', v::jsonb->'card'->'ticket'->>'type' || '/' || (v::jsonb->'card'->'ticket'->>'product_area'), 'question/Guest list');
  v := pg_temp.person('tao', 'select public.ops_ticket_counts()::text');
  perform pg_temp.chk('T-MORE', 'tickets_new_mine counts open To do tickets I own', v::jsonb->>'tickets_new_mine', '1');
  -- Send to GitHub: a signal on first use, the same one after.
  v := pg_temp.person('tao', format('select public.issue_4420_ticket_signal_ensure(%L)::text', pg_temp.id('TK2')));
  perform pg_temp.lk('T-MORE', 'only product operators make the signal', v, 'ERR:42501:forbidden:%');
  v := pg_temp.person('seth', format('select public.issue_4420_ticket_signal_ensure(%L)::text', pg_temp.id('TK2')));
  v_sig := v::uuid;
  perform pg_temp.chk('T-MORE', 'the second call returns the same signal',
    pg_temp.person('seth', format('select public.issue_4420_ticket_signal_ensure(%L)::text', pg_temp.id('TK2'))), v_sig::text);
  perform pg_temp.chk('T-MORE', 'the signal is triaged, a question, with the conversation as source',
    (select s.state || '/' || s.signal_kind || '/' || (select count(*) from public.support_product_signal_sources x where x.signal_id = s.id)
       from public.support_product_signals s where s.id = v_sig), 'triaged/question/1');
  perform pg_temp.chk('T-MORE', 'the old Product board link finds the ticket',
    pg_temp.person('sue', format('select public.issue_4420_ticket_for_signal(%L)::text', v_sig)), pg_temp.id('TK2')::text);
  -- Roadmap notice retired; the bridge drafts no Recently shipped card.
  v := pg_temp.person('seth', format('select public.community_notify_roadmap_change(%L)::text', gen_random_uuid()));
  perform pg_temp.lk('T-MORE', 'the roadmap updated notice is refused', v, 'ERR:22023:retired:%');
  v := pg_temp.person('seth', 'select public.issue_4383_roadmap_schedule_notice(now() + interval ''1 day'', ''UTC'')::text');
  perform pg_temp.lk('T-MORE', 'scheduling a roadmap notice is refused', v, 'ERR:22023:retired:%');
  -- The shipped-wording pipeline stays (#4420 keeps it): Bridge D still
  -- drafts and opens approval cards, and an approved draft closes its card.
  perform pg_temp.chk('T-MORE', 'Bridge D still drafts Recently shipped cards and opens approval cards',
    (pg_get_functiondef('public.ops_github_bridges()'::regprocedure) like '%ops_roadmap_draft_add(v_title, v_body, v_issue)%'
     and pg_get_functiondef('public.ops_github_bridges()'::regprocedure) like '%roadmap_shipped:issue-%')::text, 'true');
  perform pg_temp.chk('T-MORE', 'no scheduled roadmap notice is left waiting',
    (select count(*)::text from public.community_roadmap_notices_scheduled where status = 'scheduled'), '0');
end;
$t$;

-- ───────────────────────────── T-WORDING ─────────────────────────────
-- An approval card is still made the way Bridge D makes it, and a person
-- approving (publishing) the draft still closes it on the next bridge run.
do $t$
declare v_draft uuid; v_res jsonb; v_card uuid; v_main uuid;
begin
  -- Automatic cards go under a main task (#4398 routes); this suite's fallback.
  insert into public.ops_work_cards (title, instructions, done_means, due_on, due_source, sprint_id, created_by, updated_by)
  values ('T4420 Main task for automatic cards', 'Where this suite''s automatic cards go.', 'Never closed.', current_date + 60, 'explicit',
          public.ops_sprint_ensure(current_date), 'system@usemingla.com', 'system@usemingla.com') returning id into v_main;
  insert into public.ops_work_people (card_id, email, role, added_by) values
    (v_main, pg_temp.email('seth'), 'owner', 'system@usemingla.com'), (v_main, pg_temp.email('abi'), 'watcher', 'system@usemingla.com');
  update public.ops_settings set value = jsonb_build_object('routes', '{}'::jsonb, 'fallback', v_main) where key = 'auto_card_routes';
  v_draft := public.ops_roadmap_draft_add('T4420 Guest list export on Safari', 'Now live: the guest list exports on Safari.', 944201);
  v_res := public.ops_auto_card_upsert('roadmap_shipped:issue-944201', jsonb_build_object(
    'title', 'Approve "Recently shipped": T4420 Guest list export on Safari',
    'instructions', 'Check the wording of the drafted Recently shipped card and publish it, or say it is not needed. Nothing reaches hosts until you publish it. You can also write an announcement from it.',
    'done_means', 'The card is published or marked not needed.',
    'due_on', public.ops_today(NULL) + 2, 'person_reason', 'publish',
    'links', jsonb_build_array(jsonb_build_object('kind', 'roadmap_card', 'id', v_draft)),
    'github', jsonb_build_array('#944201')), 'task', NULL);
  select w.id into v_card from public.ops_work_cards w where w.auto_key = 'roadmap_shipped:issue-944201' and w.archived_at is null;
  perform pg_temp.chk('T-WORDING', 'an approval card can still be created', (v_card is not null and (select status from public.ops_work_cards where id = v_card) <> 'done')::text, 'true');
  perform pg_temp.chk('T-WORDING', 'the draft is found for the card', (public.ops_roadmap_shipped_draft('roadmap_shipped:issue-944201') = v_draft)::text, 'true');
  update public.community_roadmap_cards set status = 'published' where id = v_draft;
  perform public.ops_github_bridges();
  perform pg_temp.chk('T-WORDING', 'approving the wording closes the approval card',
    (select status || '/' || close_kind from public.ops_work_cards where id = v_card), 'done/system');
  perform pg_temp.chk('T-WORDING', 'the approved wording stays stored and readable',
    (select public_title from public.community_roadmap_cards where id = v_draft), 'T4420 Guest list export on Safari');
end;
$t$;

-- ───────────────────────────── report ─────────────────────────────
do $r$
declare r record; v_fail integer := 0; v_all integer := 0;
begin
  for r in select * from tx_results order by seq loop
    v_all := v_all + 1;
    if r.ok then raise notice 'PASS % %', r.test, r.label;
    else v_fail := v_fail + 1; raise notice 'FAIL % % (%)', r.test, r.label, coalesce(r.detail, ''); end if;
  end loop;
  if v_all < 40 then raise exception '#4420 implementor recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4420 implementor: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4420 implementor: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
