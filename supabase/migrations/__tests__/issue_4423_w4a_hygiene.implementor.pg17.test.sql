-- Issue #4423 Wave 4a -- implementor suite for
-- 20280705204423_issue_4423_w4a_indexes_and_cron.sql, on the fully replayed
-- PG17 schema. Everything is rolled back.
--
--   INDEX    every one of the 22 hot-table foreign keys now has an index whose
--            leading columns are exactly the key, and no foreign key on those
--            tables is left without one.
--   DUP      collaboration_sessions keeps exactly one partial unique index on
--            board_id, and it still refuses a second session for one board.
--   CRON     cron_refresh_admin_place_pool_mv runs with work_mem 64MB and
--            keeps its 15 min statement and lock limits; the existing
--            cron.job_run_details purge job is scheduled, and running the
--            purge twice is safe (the second run deletes nothing new).
--
-- FAILS-ON-REVERT: on origin/main (b7b76c8a14) the 22 indexes are missing,
-- both board_id indexes exist and the refresh function has no work_mem.
--
-- Run from the repository root as supabase_admin.

\set ON_ERROR_STOP on
begin;

create temp table tx_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create function pg_temp.chk(p_test text, p_label text, p_got text, p_want text) returns void
language sql as $fn$
  insert into tx_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(left(p_want, 600), '<null>')));
$fn$;

-- foreign keys on the hot tables with no index whose leading columns are the key
create temp view tx_unindexed as
select c.conrelid::regclass::text || '(' || (select string_agg(a.attname, ',' order by k.ord)
         from unnest(c.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) || ')' as fk
  from pg_constraint c join pg_class r on r.oid = c.conrelid
 where c.contype = 'f' and r.relnamespace = 'public'::regnamespace
   and r.relname ~ '^(messages|conversations|conversation_|notifications|team_|ops_work_|ops_sprint|orders|order_|message_)'
   and not exists (select 1 from pg_index i where i.indrelid = c.conrelid
                    and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
                    and c.conkey @> (i.indkey::int2[])[0:cardinality(c.conkey) - 1]);

select pg_temp.chk('INDEX', 'no foreign key on the hot tables is left without an index', (select coalesce(string_agg(fk, ', ' order by fk), 'none') from tx_unindexed), 'none');
select pg_temp.chk('INDEX', 'the 22 Wave 4a indexes exist, each a plain btree on exactly its key',
  (select count(*)::text from pg_indexes where schemaname = 'public' and indexname like '%\_fk4423\_idx'
      and indexdef ~ '^CREATE INDEX \S+ ON public\.\S+ USING btree \(\w+\)$'), '22');
select pg_temp.chk('INDEX', 'spot check: orders(purchased_by_user_id), team_mentions(actor_user_id), notifications(actor_id)',
  (select string_agg(indexdef, ' | ' order by indexname) from pg_indexes where schemaname = 'public'
      and indexname in ('orders_purchased_by_user_id_fk4423_idx', 'team_mentions_actor_user_id_fk4423_idx', 'notifications_actor_id_fk4423_idx')),
  'CREATE INDEX notifications_actor_id_fk4423_idx ON public.notifications USING btree (actor_id) | CREATE INDEX orders_purchased_by_user_id_fk4423_idx ON public.orders USING btree (purchased_by_user_id) | CREATE INDEX team_mentions_actor_user_id_fk4423_idx ON public.team_mentions USING btree (actor_user_id)');

select pg_temp.chk('DUP', 'collaboration_sessions keeps one partial unique index on board_id',
  (select string_agg(indexname, ',') from pg_indexes where schemaname = 'public' and tablename = 'collaboration_sessions'
      and indexdef like '%UNIQUE%(board_id) WHERE (board_id IS NOT NULL)%'), 'idx_collaboration_sessions_board_id_unique');
do $t$
declare v_board uuid := gen_random_uuid(); v_err text;
begin
  set local session_replication_role = replica;
  insert into public.collaboration_sessions (id, board_id, name, created_by) values (gen_random_uuid(), v_board, 'W4a one', gen_random_uuid());
  begin
    insert into public.collaboration_sessions (id, board_id, name, created_by) values (gen_random_uuid(), v_board, 'W4a two', gen_random_uuid());
    v_err := 'no error';
  exception when unique_violation then v_err := 'unique_violation';
  end;
  set local session_replication_role = origin;
  perform pg_temp.chk('DUP', 'a second session for the same board is still refused', v_err, 'unique_violation');
end;
$t$;

select pg_temp.chk('CRON', 'the place pool refresh runs with work_mem 64MB and keeps its limits',
  (select array_to_string(array(select x from unnest(proconfig) x order by x), ';') from pg_proc where oid = 'public.cron_refresh_admin_place_pool_mv()'::regprocedure),
  'lock_timeout=15min;search_path=public;statement_timeout=15min;work_mem=64MB');
select pg_temp.chk('CRON', 'the cron.job_run_details purge (issue_1647_cron_log_retention) is scheduled every 20 minutes with a 14-day window',
  (select schedule || '|' || command from cron.job where jobname = 'issue_1647_cron_log_retention'),
  '*/20 * * * *|SELECT public.issue_1647_purge_cron_run_details(14, 25000)');
do $t$
declare v_first bigint; v_second bigint; v_job bigint := (select jobid from cron.job where jobname = 'issue_1647_cron_log_retention');
begin
  insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
  select v_job, 990000000 + g, 1, 'postgres', 'postgres', 'select 1', 'succeeded', '1 row', now() - interval '30 days', now() - interval '30 days'
    from generate_series(1, 5) g;
  v_first := public.issue_1647_purge_cron_run_details(14, 25000);
  v_second := public.issue_1647_purge_cron_run_details(14, 25000);
  perform pg_temp.chk('CRON', 'the purge removes rows older than 14 days, and a second run removes nothing more',
    (v_first >= 5)::text || '/' || v_second::text || '/' || (select count(*)::text from cron.job_run_details where runid between 990000001 and 990000005),
    'true/0/0');
end;
$t$;

do $r$
declare r record; v_fail integer := 0; v_all integer := 0;
begin
  for r in select * from tx_results order by seq loop
    v_all := v_all + 1;
    if r.ok then raise notice 'PASS % %', r.test, r.label;
    else v_fail := v_fail + 1; raise notice 'FAIL % % (%)', r.test, r.label, coalesce(r.detail, ''); end if;
  end loop;
  if v_all < 8 then raise exception '#4423 W4a recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4423 W4a: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4423 W4a: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
