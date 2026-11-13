-- Issue #4423 Wave 2 (W2.5) -- implementor suite for
-- 20280705034423_issue_4423_w2_team_inbox_limit_first.sql, on the fully
-- replayed PG17 schema. Everything is rolled back.
--
--   GOLDEN  team_inbox returns exactly what the body it replaces returns (kept
--           below as pg_temp.old_team_inbox) for a person with 0, 5 and 320
--           mentions: read and unread, work-card notes (mention) and status
--           changes (work update), a review ask and a send back that are still
--           open and ones that are resolved, due notices, team messages in a
--           thread the person reads, in one they left, in one they never
--           joined, and a deleted one, mentions that are not push, and support
--           alerts on resolved and open tickets; with no alert types and with
--           types, and limits 1, 7, 100, 200, 0 and NULL.
--   LIMIT   p_limit is honoured (capped at 200).
--   COST    I-TEAM-INBOX-LIMIT-BEFORE-LABEL: for 320 mentions, labels are made
--           for the returned page only: ops_actor_label is never called and
--           crm_display_name runs at most once per distinct email plus once
--           per team-message row on the page (the old body labelled every
--           mention first).
--   INDEX   team_mentions_target_push_recent exists with the right shape and
--           serves the page in order (an ordered index scan, no sort).
--
-- invariant: I-TEAM-INBOX-LIMIT-BEFORE-LABEL -- team_inbox labels only the
--   returned page (enforced by the COST block of this suite).
--
-- FAILS-ON-REVERT: on origin/main (b7b76c8a14) the index is missing (INDEX)
-- and the old body calls ops_actor_label once per mention ever received
-- (COST); GOLDEN stays green.
--
-- Run from the repository root as supabase_admin.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists banned_until timestamptz;
alter table auth.users add column if not exists deleted_at timestamptz;

create temp table tx_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create function pg_temp.chk(p_test text, p_label text, p_got text, p_want text) returns void
language sql as $fn$
  insert into tx_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 400), '<null>'), coalesce(left(p_want, 400), '<null>')));
$fn$;

create temp table tx_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tx_people values
  ('heavy', '44238000-0000-4000-a000-000000000001', 'heavy.inbox4423@test.local'),
  ('light', '44238000-0000-4000-a000-000000000002', 'light.inbox4423@test.local'),
  ('empty', '44238000-0000-4000-a000-000000000003', 'empty.inbox4423@test.local'),
  ('peer',  '44238000-0000-4000-a000-000000000004', 'peer.inbox4423@test.local'),
  ('bot',   '44238000-0000-4000-a000-000000000005', 'bot.inbox4423@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tx_people;
insert into public.admin_users (email, role, status, accepted_at) values ('heavy.inbox4423@test.local', 'owner', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at)
  select email, 'growth', 'active', now() from tx_people where who <> 'heavy';
insert into public.ops_team_profiles (email, display_name, updated_by) values
  ('peer.inbox4423@test.local', 'Peer Person', 'system@usemingla.com');

create function pg_temp.login(p_who text) returns void
language plpgsql as $fn$
declare v_id uuid;
begin
  select id into strict v_id from tx_people where who = p_who;
  perform set_config('request.jwt.claim.sub', v_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
end;
$fn$;
create function pg_temp.uid(p_who text) returns uuid language sql as $fn$ select id from tx_people where who = p_who $fn$;
create function pg_temp.email(p_who text) returns text language sql as $fn$ select email from tx_people where who = p_who $fn$;

-- ───────────────────────────── fixture ─────────────────────────────
do $f$
declare v_sprint uuid := (select public.ops_sprint_ensure((now() at time zone 'UTC')::date)); v_card uuid; v_review uuid; v_back uuid;
        v_kid uuid; t_in uuid := gen_random_uuid(); t_left uuid := gen_random_uuid(); t_never uuid := gen_random_uuid(); g integer;
        v_tkt_done uuid := gen_random_uuid(); v_tkt_open uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  -- three cards: an open one with a subtask, one waiting in review, one sent back and then closed
  insert into public.ops_work_cards (id, title, instructions, done_means, status, status_id, due_on, due_source, sprint_id, created_by, updated_by)
  values (gen_random_uuid(), 'Inbox card open', 'Open card for the inbox suite.', 'It is done and checked.', 'todo',
          'a4255000-0000-4000-8000-000000000001', current_date, 'explicit', v_sprint, pg_temp.email('heavy'), pg_temp.email('heavy'))
  returning id into v_card;
  insert into public.ops_work_cards (id, title, instructions, done_means, status, status_id, due_on, due_source, sprint_id, created_by, updated_by,
                                     parent_id, depth, position)
  values (gen_random_uuid(), 'Inbox subtask', 'A subtask for the inbox suite.', 'It is done and checked.', 'todo',
          'a4255000-0000-4000-8000-000000000001', current_date, 'explicit', v_sprint, pg_temp.email('heavy'), pg_temp.email('heavy'), v_card, 1, 0)
  returning id into v_kid;
  insert into public.ops_work_cards (id, title, instructions, done_means, status, status_id, due_on, due_source, sprint_id, created_by, updated_by,
                                     review_requested_at, review_requested_by, review_kind)
  values (gen_random_uuid(), 'Inbox card in review', 'Review card for the inbox suite.', 'It is done and checked.', 'doing',
          public.ops_review_status_id(), current_date, 'explicit', v_sprint, pg_temp.email('peer'), pg_temp.email('peer'), now(), pg_temp.email('peer'), 'done')
  returning id into v_review;
  insert into public.ops_work_cards (id, title, instructions, done_means, status, status_id, due_on, due_source, sprint_id, created_by, updated_by,
                                     closed_at, closed_by, close_kind)
  values (gen_random_uuid(), 'Inbox card closed', 'Closed card for the inbox suite.', 'It is done and checked.', 'done',
          'a4255000-0000-4000-8000-000000000003', current_date, 'explicit', v_sprint, pg_temp.email('peer'), pg_temp.email('peer'), now(), pg_temp.email('peer'), 'done')
  returning id into v_back;
  insert into public.ops_work_people (card_id, email, role, added_by) values
    (v_card, pg_temp.email('peer'), 'owner', 'system@usemingla.com'), (v_card, pg_temp.email('heavy'), 'watcher', 'system@usemingla.com'),
    (v_review, pg_temp.email('peer'), 'owner', 'system@usemingla.com'), (v_review, pg_temp.email('light'), 'watcher', 'system@usemingla.com'),
    (v_kid, pg_temp.email('bot'), 'owner', 'system@usemingla.com');

  -- threads: heavy reads t_in, left t_left, never joined t_never
  insert into public.team_threads (id, kind, title, created_by) values
    (t_in, 'group', 'Inbox room', pg_temp.uid('peer')), (t_left, 'group', 'Left room', pg_temp.uid('peer')), (t_never, 'group', 'Other room', pg_temp.uid('peer'));
  insert into public.team_thread_members (thread_id, user_id, role, left_at) values
    (t_in, pg_temp.uid('heavy'), 'member', null), (t_left, pg_temp.uid('heavy'), 'member', now()),
    (t_in, pg_temp.uid('light'), 'member', null), (t_in, pg_temp.uid('peer'), 'owner', null);

  -- heavy: 300 work-card events of every kind, 20 team messages, 15 not-push rows
  for g in 1..300 loop
    with e as (
      insert into public.ops_work_events (id, card_id, actor_email, via, action, at, chat)
      values (gen_random_uuid(), case g % 4 when 0 then v_card when 1 then v_review when 2 then v_back else v_kid end,
              case g % 5 when 0 then pg_temp.email('peer') when 1 then pg_temp.email('bot') when 2 then pg_temp.email('heavy')
                         when 3 then 'gone.person@test.local' else pg_temp.email('light') end,
              case g % 6 when 0 then 'claude' when 1 then 'codex' when 2 then 'system' end,
              case g % 3 when 0 then 'note' when 1 then 'status' else 'updated' end, now() - make_interval(mins => g), null)
      returning id, card_id, at)
    insert into public.team_mentions (source_kind, source_id, actor_user_id, target_user_id, body_excerpt, deep_link, created_at, read_at, decision, event_kind, push)
    select case when g % 37 = 0 then 'work_due' else 'work_card' end, e.id, null, pg_temp.uid('heavy'), 'Excerpt ' || g, '#/work/' || e.card_id, e.at,
           case when g % 7 = 0 then null else e.at + interval '5 minutes' end, g % 11 = 0,
           (array['mention', 'review', 'sent_back', 'status', 'assigned'])[1 + g % 5], g % 20 <> 0
      from e;
  end loop;
  for g in 1..20 loop
    insert into public.team_messages (id, thread_id, author_id, body_md, created_at, deleted_at)
    values (('44238100-0000-4000-a000-' || lpad(g::text, 12, '0'))::uuid,
            case g % 4 when 0 then t_in when 1 then t_left when 2 then t_never else t_in end,
            case when g % 2 = 0 then pg_temp.uid('peer') else pg_temp.uid('bot') end,
            case when g = 3 then '' else 'Hello ' || g end, now() - make_interval(mins => g * 7), case when g = 3 then now() end);
    insert into public.team_mentions (source_kind, source_id, actor_user_id, target_user_id, body_excerpt, deep_link, created_at, read_at, event_kind, push)
    values ('team_message', ('44238100-0000-4000-a000-' || lpad(g::text, 12, '0'))::uuid,
            case when g = 5 then null when g % 2 = 0 then pg_temp.uid('peer') else pg_temp.uid('bot') end,
            pg_temp.uid('heavy'), 'Chat ' || g, '#/messages', now() - make_interval(mins => g * 7),
            case when g % 3 = 0 then null else now() end, 'mention', true);
  end loop;
  -- light: 5 mentions (two the same minute, so the id breaks the tie)
  insert into public.team_mentions (source_kind, source_id, actor_user_id, target_user_id, body_excerpt, deep_link, created_at, read_at, event_kind, push, decision)
  select 'work_card', e.id, null, pg_temp.uid('light'), 'Light ' || row_number() over (), '#/work', date_trunc('minute', e.at), null, 'review', true, true
    from (select * from public.ops_work_events where card_id = v_review order by at desc limit 5) e;
  -- support alerts for heavy: resolved and open tickets, read and unread, deleted and suppressed
  insert into public.support_tickets (id, subject, status, conversation_id, requester_segment, origin, visibility) values
    (v_tkt_done, 'Resolved ticket', 'resolved', gen_random_uuid(), 'business', 'staff', 'internal'),
    (v_tkt_open, 'Open ticket', 'open', gen_random_uuid(), 'business', 'staff', 'internal');
  insert into public.notifications (user_id, type, title, body, data, created_at, read_at, deleted_at, in_app_suppressed_at)
  select pg_temp.uid('heavy'), case when n.g % 5 = 0 then 'admin.product_signal_new' else 'admin.support_ticket_message' end, 'Alert ' || n.g, 'Body',
         case n.g % 3 when 0 then jsonb_build_object('ticket_id', v_tkt_done) when 1 then jsonb_build_object('ticketId', v_tkt_open) else '{}'::jsonb end,
         now() - make_interval(mins => n.g * 3), case when n.g % 4 = 0 then null else now() end,
         case when n.g = 7 then now() end, case when n.g = 8 then now() end
    from generate_series(1, 230) n(g);
  insert into public.notifications (user_id, type, title, body, created_at)
  select pg_temp.uid('heavy'), 'business.order_paid', 'Not an alert type', 'Body', now() from generate_series(1, 5) n(k);
  set local session_replication_role = origin;
end;
$f$;
analyze public.team_mentions;

-- ───────────────────────────── the body this wave replaces ─────────────────────────────
-- Verbatim copy (origin/main b7b76c8a14, identical to production on 13 Nov), renamed into pg_temp.
CREATE FUNCTION pg_temp.old_team_inbox(p_alert_types text[] DEFAULT NULL::text[], p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_me    uuid := auth.uid();
  v_types text[];
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
BEGIN
  IF NOT public.issue_3720_active_team_member(v_me) THEN
    RAISE EXCEPTION 'team_access_required' USING ERRCODE = '42501';
  END IF;
  v_types := public.team_inbox_alert_types(p_alert_types);

  RETURN (
    WITH m AS MATERIALIZED (
      SELECT tm.id, tm.source_kind, tm.created_at, tm.read_at, tm.body_excerpt, tm.deep_link,
             e.card_id, e.action,
             -- #4398 retest (P3): a decision or an ask stands only while it is still open: a review ask
             -- while the card waits In review, a send back until the card is asked again or closed, any
             -- other decision until the card closes. Resolved, it stops asking, read or not.
             tm.decision AND wc.status IS DISTINCT FROM 'done'
               AND (tm.event_kind IS DISTINCT FROM 'review' OR wc.review_requested_at IS NOT NULL) AS decision,
             CASE WHEN tm.event_kind = 'review' THEN wc.status IS DISTINCT FROM 'done' AND wc.review_requested_at IS NOT NULL
                  WHEN tm.event_kind = 'sent_back' THEN wc.status IS DISTINCT FROM 'done' AND wc.review_requested_at IS NULL
                  ELSE false END AS needs_you,
             tm.event_kind, -- #4398
             tmsg.thread_id, tmsg.id AS message_id, -- #4255 W1b
             public.team_inbox_kind(tm.source_kind, e.action) AS kind,
             COALESCE(
               CASE WHEN tm.source_kind = 'work_due' THEN 'Mingla' END, -- #4255 rework F
               CASE WHEN e.id IS NOT NULL THEN public.ops_actor_label(e.actor_email, e.via) END,
               public.crm_display_name(lower(btrim(u.email))),
               'A teammate') AS actor
        FROM public.team_mentions tm
        LEFT JOIN public.ops_work_events e ON tm.source_kind = 'work_card' AND e.id = tm.source_id
        LEFT JOIN public.ops_work_cards wc ON wc.id = e.card_id  -- #4398 retest (P3)
        LEFT JOIN public.team_messages tmsg ON tm.source_kind = 'team_message' AND tmsg.id = tm.source_id -- #4255 W1b
        LEFT JOIN auth.users u ON u.id = tm.actor_user_id
       WHERE tm.target_user_id = v_me
         AND tm.push  -- #4398 (S3): the Host app and Messages list carry push notices only; the rest is Admin > Activity
         AND (tm.source_kind <> 'team_message'
              OR (tmsg.deleted_at IS NULL AND public.team_chat_can_read(tmsg.thread_id))) -- #4255 W1b
    ), a AS MATERIALIZED (
      SELECT n.id, n.type, n.title, n.body, n.deep_link, n.data, n.created_at, n.read_at,
             public.team_inbox_ticket_resolved(n.data) AS ticket_resolved
        FROM public.notifications n
       WHERE n.user_id = v_me AND n.type = ANY (v_types)
         AND n.deleted_at IS NULL AND n.in_app_suppressed_at IS NULL
    )
    SELECT jsonb_build_object(
      'mentions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', x.id, 'kind', x.kind, 'source_kind', x.source_kind, 'card_id', x.card_id, 'action', x.action,
          'thread_id', x.thread_id, 'message_id', x.message_id, -- #4255 W1b
          'decision', x.decision, -- #4255 Retest 2 (P3b): the one decision flag
          -- #4398: what happened, whether it needs you, and the card as it is now (the Host app's read-only sheet)
          'event_kind', x.event_kind, 'needs_you', x.needs_you,
          'card', (SELECT jsonb_build_object('number', w.number, 'title', w.title, 'status', w.status, 'due_on', w.due_on,
                     'closed_at', w.closed_at, 'column', s.name, 'in_review', w.review_requested_at IS NOT NULL,
                     'owner', public.ops_name((public.ops_card_people(w.id, 'owner'))[1]),
                     'watcher', public.ops_name((public.ops_card_people(w.id, 'watcher'))[1]),
                     'owner_email', (public.ops_card_people(w.id, 'owner'))[1],
                     'watcher_email', (public.ops_card_people(w.id, 'watcher'))[1],
                     'parent', (SELECT jsonb_build_object('number', p.number, 'title', p.title) FROM public.ops_work_cards p WHERE p.id = w.parent_id))
                     FROM public.ops_work_cards w LEFT JOIN public.ops_work_statuses s ON s.id = w.status_id WHERE w.id = x.card_id),
          'actor_name', x.actor, 'body_excerpt', x.body_excerpt, 'deep_link', x.deep_link,
          'created_at', x.created_at, 'read_at', x.read_at) ORDER BY x.created_at DESC, x.id DESC)
        FROM (SELECT * FROM m ORDER BY created_at DESC, id DESC LIMIT v_limit) x), '[]'::jsonb),
      'alerts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', x.id, 'type', x.type, 'title', x.title, 'body', x.body, 'deep_link', x.deep_link,
          'data', x.data, 'created_at', x.created_at, 'read_at', x.read_at,
          'ticket_resolved', x.ticket_resolved) ORDER BY x.created_at DESC, x.id DESC)
        FROM (SELECT * FROM a ORDER BY created_at DESC, id DESC LIMIT v_limit) x), '[]'::jsonb),
      'unread', jsonb_build_object(
        'mentions', (SELECT count(*) FROM m WHERE kind = 'mention' AND read_at IS NULL),
        'work_updates', (SELECT count(*) FROM m WHERE kind = 'work_update' AND read_at IS NULL),
        'support', (SELECT count(*) FROM a WHERE read_at IS NULL AND NOT ticket_resolved))
    )
  );
END;
$function$;

-- ───────────────────────────── GOLDEN and LIMIT ─────────────────────────────
do $t$
declare u text; l integer; k integer; t text[]; a jsonb; b jsonb; v_cases integer := 0; v_diff text;
begin
  foreach u in array array['heavy', 'light', 'empty', 'peer'] loop
    perform pg_temp.login(u);
    foreach l in array array[1, 7, 100, 200, 0, 500, null] loop
      for k in 1..4 loop
        t := case k when 1 then null::text[] when 2 then array['admin.support_ticket_message', 'admin.product_signal_new']
                    when 3 then array['admin.support_ticket_message'] else array['business.order_paid'] end;
        a := pg_temp.old_team_inbox(t, l); b := public.team_inbox(t, l);
        v_cases := v_cases + 1;
        if a is distinct from b then
          v_diff := coalesce(v_diff || '; ', '') || format('%s limit %s types %s: mentions %s alerts %s unread %s vs %s', u, l, t,
            (a->'mentions' = b->'mentions'), (a->'alerts' = b->'alerts'), a->'unread', b->'unread');
        end if;
      end loop;
    end loop;
  end loop;
  perform pg_temp.chk('GOLDEN', format('team_inbox equals the old body in %s cases (4 people x 7 limits x 4 alert sets)', v_cases), coalesce(v_diff, 'all same'), 'all same');
  perform pg_temp.login('heavy');
  b := public.team_inbox(array['admin.support_ticket_message', 'admin.product_signal_new'], 100);
  perform pg_temp.chk('GOLDEN', 'the fixture is what it claims: 100 mentions and 100 alerts on the page, unread of every kind',
    jsonb_array_length(b->'mentions') || '/' || jsonb_array_length(b->'alerts') || '/' ||
    ((b->'unread'->>'mentions')::int > 0 and (b->'unread'->>'work_updates')::int > 0 and (b->'unread'->>'support')::int > 0)::text,
    '100/100/true');
  perform pg_temp.chk('GOLDEN', 'team messages from a left or never-joined thread, or deleted, never show',
    (select count(*)::text from jsonb_array_elements(public.team_inbox(null, 200)->'mentions') m
      where m->>'source_kind' = 'team_message'
        and (m->>'thread_id' is null or (m->>'thread_id')::uuid not in (select thread_id from public.team_thread_members where user_id = pg_temp.uid('heavy') and left_at is null)
             or (m->>'message_id')::uuid = '44238100-0000-4000-a000-000000000003')),
    '0');
  perform pg_temp.chk('LIMIT', 'p_limit is honoured and capped at 200 (1, 7, 200, 500)',
    concat_ws(',', jsonb_array_length(public.team_inbox(null, 1)->'mentions'), jsonb_array_length(public.team_inbox(null, 7)->'mentions'),
              jsonb_array_length(public.team_inbox(null, 200)->'mentions'), jsonb_array_length(public.team_inbox(null, 500)->'mentions')),
    '1,7,200,200');
  perform pg_temp.login('empty');
  perform pg_temp.chk('LIMIT', 'a person with nothing gets empty lists and zero counts',
    public.team_inbox(null, 100)::text, '{"alerts": [], "unread": {"support": 0, "mentions": 0, "work_updates": 0}, "mentions": []}');
end;
$t$;

-- ───────────────────────────── COST (I-TEAM-INBOX-LIMIT-BEFORE-LABEL) ─────────────────────────────
do $t$
declare v jsonb; v_actor bigint; v_display bigint; v_names_rows integer; v_chat_rows integer;
begin
  perform pg_temp.login('heavy');
  set local track_functions = 'all';
  v := public.team_inbox(array['admin.support_ticket_message'], 20);
  select coalesce(sum(calls) filter (where funcname = 'ops_actor_label'), 0), coalesce(sum(calls) filter (where funcname = 'crm_display_name'), 0)
    into v_actor, v_display from pg_stat_xact_user_functions where schemaname = 'public';
  select count(*) filter (where m->>'source_kind' = 'team_message') into v_chat_rows from jsonb_array_elements(v->'mentions') m;
  perform pg_temp.chk('COST', format('320 mentions, page of 20: ops_actor_label calls %s (want 0); crm_display_name calls %s (at most 8 emails + %s chat rows + 1)',
    v_actor, v_display, v_chat_rows), (v_actor = 0 and v_display <= 8 + v_chat_rows + 1)::text, 'true');
end;
$t$;

-- ───────────────────────────── INDEX ─────────────────────────────
select pg_temp.chk('INDEX', 'team_mentions_target_push_recent is (target_user_id, created_at DESC, id DESC) WHERE push',
  (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'team_mentions_target_push_recent'),
  'CREATE INDEX team_mentions_target_push_recent ON public.team_mentions USING btree (target_user_id, created_at DESC, id DESC) WHERE push');
do $t$
declare v_plan text; r record;
begin
  set local enable_seqscan = off;
  set local enable_bitmapscan = off;
  v_plan := '';
  for r in execute format($q$explain (costs off)
    select tm.id from public.team_mentions tm
      left join public.team_messages tmsg on tm.source_kind = 'team_message' and tmsg.id = tm.source_id
     where tm.target_user_id = %L and tm.push
       and (tm.source_kind <> 'team_message' or (tmsg.deleted_at is null and tmsg.thread_id = any (%L::uuid[])))
     order by tm.created_at desc, tm.id desc limit 100$q$, pg_temp.uid('heavy'), array[]::uuid[]) loop
    v_plan := v_plan || r."QUERY PLAN" || E'\n';
  end loop;
  perform pg_temp.chk('INDEX', 'the page query reads team_mentions_target_push_recent in order (no sort node)',
    (v_plan like '%team_mentions_target_push_recent%' and v_plan not like '%Sort%')::text, 'true');
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
  if v_all < 8 then raise exception '#4423 W2 team_inbox recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4423 W2 team_inbox: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4423 W2 team_inbox: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
