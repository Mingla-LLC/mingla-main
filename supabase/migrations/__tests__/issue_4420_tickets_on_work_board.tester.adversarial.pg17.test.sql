-- MINGLA-INVARIANT: I-4420-CLOSE-NOTE-INVISIBLE-TO-CUSTOMER | issue #4420 | closing a ticket (once, twice, after reopen, by an agent, on a resolved conversation) changes nothing a customer can see: no customer-readable message, no notification row, no status, unread or preview change on their conversation (A-CLOSE here).
--
-- Issue #4420 -- TESTER adversarial suite for
-- 20281121034420_issue_4420_tickets_on_work_board.sql. Angles the implementor
-- suite does not take:
--   A-CLOSE   close on a RESOLVED conversation; close twice; reopen and close;
--             agent-driven close; the customer's conversation, ticket and
--             participant rows never carry the note text, never change status,
--             never bump the customer's unread state; zero notification rows.
--   A-ACCESS  disabled Support staff and a removed team member cannot read,
--             chip, search or link; a Work board user reads no message text
--             through get or list, nor directly.
--   A-LINK    links to a non-support conversation id, an unknown id, a closed
--             ticket and an archived ticket are refused; nothing is written.
--   A-PROBE   a customer calls EVERY new function and reads every new table.
--   A-DUE     the 7-day default due date (absent, JSON null), an explicit date
--             kept, a malformed date refused.
--   A-ORD     ordinary card add / update / close writes no message and no
--             ticket row.
--   A-LOOKUP  the people lookup (G11): a support_staff row without active
--             team membership, an invited member, a revoked former admin and
--             a subject-less session are refused; wildcard, length, id-count
--             and result-shape bounds hold for Support staff.
-- Everything is rolled back. Run from the repository root as supabase_admin.

\set ON_ERROR_STOP on
begin;
alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists banned_until timestamptz;

create temp table tx_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tx_people (who, id, email) values
  ('seth', '44210000-0000-4000-a000-000000000001', 'seth.a4420@test.local'),
  ('tao',  '44210000-0000-4000-a000-000000000002', 'tao.a4420@test.local'),
  ('abi',  '44210000-0000-4000-a000-000000000003', 'abi.a4420@test.local'),
  ('sue',  '44210000-0000-4000-a000-000000000004', 'sue.a4420@test.local'),
  ('cus',  '44210000-0000-4000-a000-000000000005', 'cus.a4420@test.local'),
  ('cus2', '44210000-0000-4000-a000-000000000006', 'cus2.a4420@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tx_people;
-- seth: owner (Support staff, Work board, product operator). abi: admin.
-- tao: Work board (growth) but not Support staff. sue: Support staff with
-- no Work board (website role). cus, cus2: customers.
insert into public.admin_users (email, role, status, accepted_at) values
  ('seth.a4420@test.local', 'owner', 'active', now()), ('abi.a4420@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('tao.a4420@test.local', 'growth', 'active', now()), ('sue.a4420@test.local', 'website', 'active', now());
insert into public.support_staff (user_id, enabled, available) values ('44210000-0000-4000-a000-000000000004', true, true);

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
-- Two more people: dis (Support staff, disabled), gone (Support staff whose
-- team membership was removed).
insert into tx_people (who, id, email) values
  ('dis',  '44210000-0000-4000-a000-000000000007', 'dis.a4420@test.local'),
  ('gone', '44210000-0000-4000-a000-000000000008', 'gone.a4420@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tx_people where who in ('dis', 'gone');
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('dis.a4420@test.local', 'website', 'active', now()), ('gone.a4420@test.local', 'website', 'active', now());
insert into public.support_staff (user_id, enabled, available) values
  ('44210000-0000-4000-a000-000000000007', false, false), ('44210000-0000-4000-a000-000000000008', true, true);
update public.admin_team_members set status = 'revoked' where email = 'gone.a4420@test.local';

-- Everything a customer could see about their own conversation, as text.
create function pg_temp.customer_view(p_conv uuid, p_st uuid, p_uid uuid) returns text
language sql as $fn$
  select coalesce((select row_to_json(c)::text from public.conversations c where c.id = p_conv), '') || '|' ||
         coalesce((select row_to_json(s)::text from public.support_tickets s where s.id = p_st), '') || '|' ||
         coalesce((select string_agg(row_to_json(p)::text, ',') from public.conversation_participants p where p.conversation_id = p_conv and p.user_id = p_uid), '')
$fn$;

-- Fixtures: conversation 1 RESOLVED (customer cus), conversation 2 open (cus2),
-- and a plain direct conversation that is not a support conversation.
do $f$
declare v_conv uuid; v_st uuid; i integer := 0; v_who text;
begin
  foreach v_who in array array['cus', 'cus2'] loop
    i := i + 1;
    v_conv := gen_random_uuid();
    insert into public.conversations (id, type, linked_entity_type, name, created_by, created_at, updated_at, last_message_at)
    values (v_conv, 'group', 'support', 'A4420 help ' || i, pg_temp.uid(v_who), now() - interval '2 days', now() - interval '2 days', now() - interval '2 days');
    insert into public.conversation_participants (conversation_id, user_id) values (v_conv, pg_temp.uid(v_who));
    insert into public.support_tickets (requester_user_id, requester_segment, subject, conversation_id)
    values (pg_temp.uid(v_who), 'business', 'A4420 payouts look wrong ' || i, v_conv) returning id into v_st;
    perform pg_temp.keep('ST' || i, v_st);
    perform pg_temp.keep('CONV' || i, v_conv);
    insert into public.messages (conversation_id, sender_id, content, message_type)
    values (v_conv, pg_temp.uid(v_who), 'A4420 customer words: my payout is short.', 'text');
  end loop;
  update public.support_tickets set status = 'resolved' where id = pg_temp.id('ST1');
  v_conv := gen_random_uuid();
  insert into public.conversations (id, type, created_by, created_at, updated_at, last_message_at)
  values (v_conv, 'direct', pg_temp.uid('cus'), now(), now(), now());
  perform pg_temp.keep('DM', v_conv);
end;
$f$;

-- ───────────────────────────── A-DUE ─────────────────────────────
do $t$
declare v text;
begin
  v := pg_temp.person('abi', format('select public.ops_ticket_create(%L::jsonb, %L)::text',
    jsonb_build_object('type', 'bug', 'title', 'A4420 Payout total is short', 'what_is_wrong', 'Two hosts say the payout total is short by one ticket.',
      'product_area', 'Payouts', 'created_from', 'conversation', 'conversation_ids', jsonb_build_array(pg_temp.id('ST1'), pg_temp.id('ST2')),
      'owners', jsonb_build_array(pg_temp.email('tao'))), 'A4420-due-00001'));
  perform pg_temp.chk('A-DUE', 'ticket made with no due date', v::jsonb->>'status', 'added');
  perform pg_temp.keep('TK', (v::jsonb->'card'->>'id')::uuid);
  perform pg_temp.chk('A-DUE', 'no due date given: due in seven days',
    (select due_on from public.ops_work_cards where id = pg_temp.id('TK'))::text, (public.ops_today(NULL) + 7)::text);
  v := pg_temp.person('abi', format('select public.ops_ticket_create(%L::jsonb, %L)::text',
    jsonb_build_object('type', 'idea', 'title', 'A4420 Show payout breakdown', 'what_is_wrong', 'Hosts want the payout split by ticket type.',
      'product_area', 'Payouts', 'due_on', null, 'owners', jsonb_build_array(pg_temp.email('tao'))), 'A4420-due-00002'));
  perform pg_temp.chk('A-DUE', 'JSON null due date: due in seven days',
    (select due_on from public.ops_work_cards where id = (v::jsonb->'card'->>'id')::uuid)::text, (public.ops_today(NULL) + 7)::text);
  v := pg_temp.person('abi', format('select public.ops_ticket_create(%L::jsonb, %L)::text',
    jsonb_build_object('type', 'question', 'title', 'A4420 When do refunds land', 'what_is_wrong', 'A host asks when refunds reach the guest.',
      'product_area', 'Refunds', 'due_on', (public.ops_today(NULL) + 3)::text, 'owners', jsonb_build_array(pg_temp.email('tao'))), 'A4420-due-00003'));
  perform pg_temp.chk('A-DUE', 'an explicit due date is kept',
    (select due_on from public.ops_work_cards where id = (v::jsonb->'card'->>'id')::uuid)::text, (public.ops_today(NULL) + 3)::text);
  v := pg_temp.person('abi', format('select public.ops_ticket_create(%L::jsonb, %L)::text',
    jsonb_build_object('type', 'question', 'title', 'A4420 Malformed due date', 'what_is_wrong', 'A typed date that is not a date.',
      'product_area', 'Refunds', 'due_on', '31/12/2028', 'owners', jsonb_build_array(pg_temp.email('tao'))), 'A4420-due-00004'));
  perform pg_temp.chk('A-DUE', 'a malformed due date is refused, not stored',
    coalesce(v::jsonb->>'status', 'ERR') || '/' || (select count(*)::text from public.ops_work_cards where title = 'A4420 Malformed due date'), 'refused/0');
end;
$t$;

-- ───────────────────────────── A-LINK ─────────────────────────────
do $t$
declare v text; v_n bigint := (select count(*) from public.ops_work_links where kind = 'support_conversation');
begin
  v := pg_temp.person('abi', format('select public.ops_ticket_link_conversation(%L, %L, %s)::text', pg_temp.id('TK'), pg_temp.id('DM'), pg_temp.rev('TK')));
  perform pg_temp.lk('A-LINK', 'a direct (non-support) conversation id is refused', v, 'ERR:22023:invalid_card:%');
  v := pg_temp.person('abi', format('select public.ops_ticket_link_conversation(%L, %L, %s)::text', pg_temp.id('TK'), pg_temp.id('CONV2'), pg_temp.rev('TK')));
  perform pg_temp.lk('A-LINK', 'a support conversation''s conversation_id (not its ticket id) is refused', v, 'ERR:22023:invalid_card:%');
  v := pg_temp.person('abi', format('select public.ops_ticket_link_conversation(%L, %L, %s)::text', pg_temp.id('TK'), gen_random_uuid(), pg_temp.rev('TK')));
  perform pg_temp.lk('A-LINK', 'an unknown id is refused', v, 'ERR:22023:invalid_card:%');
  v := pg_temp.person('abi', format('select public.ops_ticket_create(%L::jsonb, %L)::text',
    jsonb_build_object('type', 'bug', 'title', 'A4420 Link a fake conversation', 'what_is_wrong', 'Creating with a made-up conversation id.',
      'product_area', 'Payouts', 'created_from', 'conversation', 'conversation_ids', jsonb_build_array(gen_random_uuid()),
      'owners', jsonb_build_array(pg_temp.email('tao'))), 'A4420-link-00001'));
  perform pg_temp.chk('A-LINK', 'create with an unknown conversation id is refused', coalesce(v::jsonb->>'status', v), 'refused');
  perform pg_temp.chk('A-LINK', 'no support link was written by a refused call',
    (select count(*) from public.ops_work_links where kind = 'support_conversation')::text, v_n::text);
end;
$t$;

-- ───────────────────────────── A-ACCESS ─────────────────────────────
do $t$
declare v text; w text; v_who text;
begin
  foreach v_who in array array['dis', 'gone'] loop
    v := pg_temp.person(v_who, format('select public.ops_ticket_conversations(%L)::text', pg_temp.id('TK')));
    perform pg_temp.lk('A-ACCESS', v_who || ': cannot read a ticket''s conversations', v, 'ERR:42501:%');
    v := pg_temp.person(v_who, format('select public.issue_4420_conversation_tickets(array[%L]::uuid[])::text', pg_temp.id('ST1')));
    perform pg_temp.lk('A-ACCESS', v_who || ': gets no ticket chips', v, 'ERR:42501:%');
    v := pg_temp.person(v_who, format('select public.issue_4420_conversation_search(%L)::text', 'A4420'));
    perform pg_temp.lk('A-ACCESS', v_who || ': cannot search conversations', v, 'ERR:42501:%');
    v := pg_temp.person(v_who, format('select public.ops_ticket_link_conversation(%L, %L, %s)::text', pg_temp.id('TK'), pg_temp.id('ST2'), pg_temp.rev('TK')));
    perform pg_temp.lk('A-ACCESS', v_who || ': cannot link a conversation', v, 'ERR:42501:%');
  end loop;
  -- A Work board user who is not Support staff: no customer words on any path.
  v := pg_temp.person('tao', format('select public.ops_ticket_conversations(%L)::text', pg_temp.id('TK')));
  perform pg_temp.chk('A-ACCESS', 'Work board user: count only, no conversations key',
    (v::jsonb->>'access') || '/' || (v::jsonb->>'reporter_count') || '/' || (v::jsonb ? 'conversations')::text, 'support_required/2/false');
  foreach v in array array[
      pg_temp.person('tao', format('select public.ops_work_get(%L)::text', pg_temp.id('TK'))),
      pg_temp.person('tao', format('select public.ops_work_list(%L::jsonb)::text', '{}'))] loop
    perform pg_temp.chk('A-ACCESS', 'Work board user: no customer message text in get / list',
      case when v like 'ERR:%' then left(v, 200) when position('my payout is short' in v) > 0 then 'LEAK' else 'clean' end, 'clean');
  end loop;
  v := pg_temp.person('tao', format('select count(*)::text from public.messages where conversation_id in (%L, %L)', pg_temp.id('CONV1'), pg_temp.id('CONV2')));
  perform pg_temp.chk('A-ACCESS', 'Work board user: reads no conversation message directly', v, '0');
end;
$t$;

-- ───────────────────────────── A-PROBE ─────────────────────────────
do $t$
declare v text; q text;
begin
  foreach q in array array[
    format('select public.ops_ticket_create(%L::jsonb, %L)::text', jsonb_build_object('type','bug','title','A4420 probe','what_is_wrong','probe probe probe','product_area','X','conversation_ids', jsonb_build_array(pg_temp.id('ST1'))), 'A4420-probe-0001'),
    format('select public.ops_ticket_update(%L, %L::jsonb, %s)::text', pg_temp.id('TK'), '{"type":"idea"}', pg_temp.rev('TK')),
    format('select public.ops_ticket_similar(%L, 5)::text', 'payout'),
    'select public.ops_ticket_counts()::text',
    format('select public.ops_ticket_link_conversation(%L, %L, %s)::text', pg_temp.id('TK'), pg_temp.id('ST1'), pg_temp.rev('TK')),
    format('select public.ops_ticket_conversations(%L)::text', pg_temp.id('TK')),
    format('select public.issue_4420_conversation_tickets(array[%L]::uuid[])::text', pg_temp.id('ST1')),
    format('select public.issue_4420_conversation_search(%L)::text', 'payout'),
    format('select public.issue_4420_ticket_for_signal(%L)::text', gen_random_uuid()),
    format('select public.issue_4420_ticket_signal_ensure(%L)::text', pg_temp.id('TK')),
    format('select public.issue_4420_ticket_github_mirror(%L)::text', pg_temp.id('TK')),
    'select count(*)::text from public.ops_work_tickets',
    'select count(*)::text from public.ops_work_cards where kind = ''ticket''',
    format('select count(*)::text from public.ops_work_links where target_id = %L', pg_temp.id('ST1')),
    format('select public.ops_work_get(%L)::text', pg_temp.id('TK'))
  ] loop
    v := pg_temp.person('cus', q);
    perform pg_temp.chk('A-PROBE', 'customer refused or sees nothing: ' || left(q, 70),
      (v like 'ERR:42501:%' or v = '0')::text, 'true');
  end loop;
end;
$t$;

-- ───────────────────────────── A-CLOSE ─────────────────────────────
do $t$
declare v text; v_view1 text := pg_temp.customer_view(pg_temp.id('CONV1'), pg_temp.id('ST1'), pg_temp.uid('cus'));
        v_view2 text := pg_temp.customer_view(pg_temp.id('CONV2'), pg_temp.id('ST2'), pg_temp.uid('cus2'));
        v_n1 bigint := pg_temp.notes_for(pg_temp.uid('cus')); v_n2 bigint := pg_temp.notes_for(pg_temp.uid('cus2'));
        v_msgs bigint := (select count(*) from public.messages where conversation_id in (pg_temp.id('CONV1'), pg_temp.id('CONV2')));
        v_ord uuid;
begin
  -- Close as the watcher (abi).
  v := pg_temp.person('abi', format('select public.ops_work_close(%L, %L::jsonb, %L, %s)::text', pg_temp.id('TK'),
         '[{"kind":"text","text":"Payout rounding fixed."}]', 'A4420 SECRET-NOTE payout rounding fixed.', pg_temp.rev('TK')));
  perform pg_temp.chk('A-CLOSE', 'the ticket is closed', (select status from public.ops_work_cards where id = pg_temp.id('TK')), 'done');
  perform pg_temp.chk('A-CLOSE', 'one internal note per conversation, the resolved one included',
    (select count(*) filter (where is_internal)::text || '/' || count(*)::text from public.messages
      where conversation_id in (pg_temp.id('CONV1'), pg_temp.id('CONV2')) and content like '%SECRET-NOTE%'), '2/2');
  perform pg_temp.chk('A-CLOSE', 'the resolved conversation stays resolved',
    (select status from public.support_tickets where id = pg_temp.id('ST1')), 'resolved');
  perform pg_temp.chk('A-CLOSE', 'customer rows never carry the note text (resolved conversation)',
    (position('SECRET-NOTE' in pg_temp.customer_view(pg_temp.id('CONV1'), pg_temp.id('ST1'), pg_temp.uid('cus'))) = 0)::text, 'true');
  perform pg_temp.chk('A-CLOSE', 'customer rows never carry the note text (open conversation)',
    (position('SECRET-NOTE' in pg_temp.customer_view(pg_temp.id('CONV2'), pg_temp.id('ST2'), pg_temp.uid('cus2'))) = 0)::text, 'true');
  perform pg_temp.chk('A-CLOSE', 'the customer participant rows (unread, read marks) are unchanged',
    (select coalesce(string_agg(row_to_json(p)::text, ','), '') from public.conversation_participants p
      where p.conversation_id = pg_temp.id('CONV1') and p.user_id = pg_temp.uid('cus')),
    split_part(v_view1, '|', 3));
  v := pg_temp.person('cus', format('select count(*)::text from public.messages where conversation_id = %L and content like %L', pg_temp.id('CONV1'), '%SECRET-NOTE%'));
  perform pg_temp.chk('A-CLOSE', 'the customer reads no close note (resolved conversation)', v, '0');
  v := pg_temp.person('cus2', format('select count(*)::text from public.messages where conversation_id = %L and content like %L', pg_temp.id('CONV2'), '%SECRET-NOTE%'));
  perform pg_temp.chk('A-CLOSE', 'the customer reads no close note (open conversation)', v, '0');

  -- Close twice: refused or a no-op, never a second note.
  v := pg_temp.person('abi', format('select public.ops_work_close(%L, %L::jsonb, %L, %s)::text', pg_temp.id('TK'),
         '[{"kind":"text","text":"Again."}]', 'A4420 SECRET-NOTE second close.', pg_temp.rev('TK')));
  perform pg_temp.chk('A-CLOSE', 'closing twice writes no second note',
    (select count(*)::text from public.messages where conversation_id in (pg_temp.id('CONV1'), pg_temp.id('CONV2')) and content like '%second close%'), '0');

  -- Reopen; the owner's agent closes it and the watcher confirms: one more
  -- internal note per conversation, written only when it becomes done.
  v := pg_temp.person('abi', format('select public.ops_work_reopen(%L, %L, %s)::text', pg_temp.id('TK'), 'A host wrote again.', pg_temp.rev('TK')));
  perform pg_temp.chk('A-CLOSE', 'the ticket reopens', ((select status from public.ops_work_cards where id = pg_temp.id('TK')) <> 'done')::text, 'true');
  v := pg_temp.agent('tao', format('select public.ops_work_close(%L, %L::jsonb, %L, %s)::text', pg_temp.id('TK'),
         '[{"kind":"text","text":"Closed by the agent."}]', 'A4420 SECRET-NOTE agent close.', pg_temp.rev('TK')));
  perform pg_temp.chk('A-CLOSE', 'an owner''s close (by their agent) waits for the watcher and writes no note yet',
    (select count(*)::text from public.messages where conversation_id in (pg_temp.id('CONV1'), pg_temp.id('CONV2')) and content like '%agent close%'), '0');
  v := pg_temp.person('abi', format('select public.ops_work_confirm(%L, %s)::text', pg_temp.id('TK'), pg_temp.rev('TK')));
  perform pg_temp.chk('A-CLOSE', 'the watcher confirms the agent''s close',
    (select status from public.ops_work_cards where id = pg_temp.id('TK')) || case when v like 'ERR:%' then ' ' || left(v, 120) else '' end, 'done');
  perform pg_temp.chk('A-CLOSE', 'after reopen, a close writes exactly one more internal note per conversation',
    (select count(*) filter (where is_internal)::text || '/' || count(*)::text from public.messages
      where conversation_id in (pg_temp.id('CONV1'), pg_temp.id('CONV2')) and content like '%agent close%'),
    case when (select status from public.ops_work_cards where id = pg_temp.id('TK')) = 'done' then '2/2' else '0/0' end);
  perform pg_temp.chk('A-CLOSE', 'every message added by closing is internal',
    (select count(*)::text from public.messages where conversation_id in (pg_temp.id('CONV1'), pg_temp.id('CONV2')) and not is_internal), '2');
  perform pg_temp.chk('A-CLOSE', 'statuses unchanged after every close',
    (select string_agg(status, ',' order by subject) from public.support_tickets where id in (pg_temp.id('ST1'), pg_temp.id('ST2'))), 'resolved,new');
  perform pg_temp.chk('A-CLOSE', 'zero notification rows for either customer across all closes',
    (pg_temp.notes_for(pg_temp.uid('cus')) - v_n1)::text || '/' || (pg_temp.notes_for(pg_temp.uid('cus2')) - v_n2)::text, '0/0');

  -- A-ORD: an ordinary card's add, update and close write no message and no ticket row.
  v := pg_temp.person('seth', format('select public.ops_work_add(%L::jsonb, %L)::text',
    jsonb_build_array(jsonb_build_object('title', 'A4420 ordinary launch card', 'instructions', 'Post the launch video.',
      'done_means', 'Posted.', 'owners', jsonb_build_array(pg_temp.email('seth')), 'watchers', jsonb_build_array(pg_temp.email('abi')),
      'due_on', (current_date + 4)::text)), 'A4420-ord-000001'));
  v_ord := (select id from public.ops_work_cards where title = 'A4420 ordinary launch card');
  perform pg_temp.chk('A-ORD', 'ordinary card added as a task, with no ticket row',
    (select kind from public.ops_work_cards where id = v_ord) || '/' || (select count(*)::text from public.ops_work_tickets where card_id = v_ord), 'task/0');
  v := pg_temp.person('seth', format('select public.ops_work_update(%L, %L::jsonb, %s)::text', v_ord, '{"title":"A4420 ordinary launch card v2"}', (select revision from public.ops_work_cards where id = v_ord)));
  v := pg_temp.person('abi', format('select public.ops_work_close(%L, %L::jsonb, %L, %s)::text', v_ord,
         '[{"kind":"text","text":"Posted."}]', 'Posted the video.', (select revision from public.ops_work_cards where id = v_ord)));
  perform pg_temp.chk('A-ORD', 'ordinary card updated and closed', (select title || '/' || status from public.ops_work_cards where id = v_ord), 'A4420 ordinary launch card v2/done');
  perform pg_temp.chk('A-ORD', 'no message anywhere mentions the ordinary card close',
    (select count(*)::text from public.messages where content like '%Posted the video%'), '0');
end;
$t$;

-- ───────────────────────────── A-LOOKUP ─────────────────────────────
-- QA pass 4 (G11 access change): angles the implementor's T-LOOKUP does not
-- take. An enabled support_staff row alone (no active team membership), an
-- INVITED team member with an enabled row, and a REVOKED former full admin
-- are refused; a session with no subject is refused; for Support staff,
-- wildcard characters match literally (no enumeration), a one-character
-- search returns nothing, more than 1,000 ids is refused, search is capped at
-- 8 people, and each person carries exactly the seven documented keys.
insert into tx_people (who, id, email) values
  ('cs',  '44210000-0000-4000-a000-000000000009', 'cs.a4420@test.local'),
  ('inv', '44210000-0000-4000-a000-00000000000a', 'inv.a4420@test.local'),
  ('exa', '44210000-0000-4000-a000-00000000000b', 'exa.a4420@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tx_people where who in ('cs', 'inv', 'exa');
insert into public.admin_team_members (email, role, status) values ('inv.a4420@test.local', 'website', 'invited');
insert into public.admin_users (email, role, status, accepted_at) values ('exa.a4420@test.local', 'admin', 'revoked', now());
insert into public.support_staff (user_id, enabled, available) values
  ('44210000-0000-4000-a000-000000000009', true, true), ('44210000-0000-4000-a000-00000000000a', true, true);
insert into auth.users (id, email, email_confirmed_at)
select ('44210000-0000-4000-b000-0000000000' || lpad(g::text, 2, '0'))::uuid, format('look%s.a4420@test.local', g), now() from generate_series(1, 10) g;
insert into public.profiles (id, email, display_name)
select ('44210000-0000-4000-b000-0000000000' || lpad(g::text, 2, '0'))::uuid, format('look%s.a4420@test.local', g), format('A4420Look %s', g) from generate_series(1, 10) g
on conflict (id) do update set email = excluded.email, display_name = excluded.display_name;

do $t$
declare v text; v_who text; v_ids text := format('array[%L]::uuid[]', pg_temp.uid('cus'));
begin
  foreach v_who in array array['cs', 'inv', 'exa'] loop
    v := pg_temp.as_(v_who, format('select public.admin_people_lookup(%s, null)::text', v_ids));
    perform pg_temp.lk('A-LOOKUP', v_who || ': refused by ids', v, 'ERR:P0001:not_authorized%');
    v := pg_temp.as_(v_who, $q$select public.admin_people_lookup(null, 'A4420Look')::text$q$);
    perform pg_temp.lk('A-LOOKUP', v_who || ': refused by search', v, 'ERR:P0001:not_authorized%');
  end loop;
  -- An authenticated session with no subject.
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
    v := public.admin_people_lookup(null, 'A4420Look')::text;
    reset role;
  exception when others then
    reset role;
    v := 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  perform pg_temp.lk('A-LOOKUP', 'a session with no subject is refused', v, 'ERR:P0001:not_authorized%');
  -- Support staff (sue, not a full admin): no enumeration, bounds hold.
  v := pg_temp.as_('sue', $q$select jsonb_array_length(public.admin_people_lookup(null, '%%'))::text$q$);
  perform pg_temp.chk('A-LOOKUP', 'Support staff: %% matches literally, not everyone', v, '0');
  v := pg_temp.as_('sue', $q$select jsonb_array_length(public.admin_people_lookup(null, '__'))::text$q$);
  perform pg_temp.chk('A-LOOKUP', 'Support staff: __ matches literally, not everyone', v, '0');
  v := pg_temp.as_('sue', $q$select public.admin_people_lookup(null, 'A')::text$q$);
  perform pg_temp.chk('A-LOOKUP', 'Support staff: a one-character search returns nothing', v, '[]');
  v := pg_temp.as_('sue', $q$select jsonb_array_length(public.admin_people_lookup(null, 'A4420Look'))::text$q$);
  perform pg_temp.chk('A-LOOKUP', 'Support staff: search is capped at 8 people', v, '8');
  v := pg_temp.as_('sue', $q$select public.admin_people_lookup(array(select gen_random_uuid() from generate_series(1, 1001)), null)::text$q$);
  perform pg_temp.lk('A-LOOKUP', 'Support staff: more than 1,000 ids is refused', v, 'ERR:P0001:too_many_ids%');
  v := pg_temp.as_('sue', $q$select string_agg(distinct k, ',' order by k) from jsonb_array_elements(public.admin_people_lookup(null, 'A4420Look')) e, jsonb_object_keys(e) k$q$);
  perform pg_temp.chk('A-LOOKUP', 'Support staff: each person has exactly the seven documented keys', v,
    'app_status,avatar_url,display_name,email,id,segment,username');
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
  if v_all < 40 then raise exception '#4420 tester adversarial recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4420 tester adversarial: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4420 tester adversarial: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
