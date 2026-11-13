-- Issue #4423 Wave 3 -- implementor suite for
-- 20280705104423_issue_4423_w3_admin_request_limits.sql and
-- 20280705114423_issue_4423_w3_db_health_probe.sql, on the fully replayed
-- PG17 schema. Everything is rolled back.
--
--   PATH     An Admin-only RPC path (/rpc/ops_*, /rpc/team_*, /rpc/admin_*,
--            /rpc/crm_*) gets statement_timeout 3 s for the rest of the
--            request; a public RPC, a table read, a look-alike name
--            (/rpc/opsx_..., /rpc/teams_...), the root path and no path at
--            all keep the role's own limit.
--   ROLE     authenticator points pgrst.db_pre_request at the function and
--            closes a transaction left idle after 30 s; its existing settings
--            (safeupdate, 8 s statement and lock limits) are kept.
--   SHAPE    SECURITY INVOKER, pinned search_path, no table access in the
--            body, executable by anon, authenticated and service_role (the
--            roles PostgREST runs it as) and by nobody else through PUBLIC.
--   HEALTH   issue_4423_db_health_snapshot reports pool use and long queries
--            (no query text); issue_4423_db_health_record counts checks in a
--            row with a high pool, resets on a low one and keeps the last
--            alert time; both are service_role only; the state table has RLS
--            on; the 5-minute cron posts {"mode":"db"} to api-health-probe.
--
-- invariant: I-ADMIN-RPC-3S-PRE-REQUEST -- an Admin-only RPC request is
--   limited to 3 s before its statement starts; every other request keeps
--   its role limit (enforced by the PATH block of this suite).
--
-- The end-to-end proof (PostgREST runs the hook as its own statement, so a
-- 4 s Admin RPC is cancelled with 57014 at 3 s while a 4 s public RPC as
-- authenticated completes) needs a running PostgREST and is recorded on #4423.
--
-- FAILS-ON-REVERT: on origin/main (b7b76c8a14) public.pgrst_pre_request does
-- not exist and authenticator has no pgrst.db_pre_request.
--
-- Run from the repository root as supabase_admin.

\set ON_ERROR_STOP on
begin;

create temp table tx_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create function pg_temp.chk(p_test text, p_label text, p_got text, p_want text) returns void
language sql as $fn$
  insert into tx_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 400), '<null>'), coalesce(left(p_want, 400), '<null>')));
$fn$;
-- What statement_timeout is after the hook runs for p_path, starting from p_start.
-- The hook is run as p_role, the way PostgREST runs it after SET ROLE.
create function pg_temp.after_hook(p_path text, p_role text default 'authenticated', p_start text default '8s') returns text
language plpgsql as $fn$
declare v text;
begin
  perform set_config('statement_timeout', p_start, true);
  perform set_config('request.path', coalesce(p_path, ''), true);
  if p_path is null then perform set_config('request.path', '', true); end if;
  execute format('set local role %I', p_role);
  perform public.pgrst_pre_request();
  reset role;
  v := current_setting('statement_timeout');
  perform set_config('statement_timeout', '0', true);
  return v;
end;
$fn$;

select pg_temp.chk('PATH', 'Admin RPC paths get 3 s',
  concat_ws(',', pg_temp.after_hook('/rpc/ops_work_list'), pg_temp.after_hook('/rpc/team_inbox'), pg_temp.after_hook('/rpc/admin_team_my_access'),
            pg_temp.after_hook('/rpc/crm_record_get'), pg_temp.after_hook('/rpc/ops_sprint_plan_get', 'anon', '3s')),
  '3s,3s,3s,3s,3s');
select pg_temp.chk('PATH', 'public RPCs, table reads, look-alikes and no path keep the role limit',
  concat_ws(',', pg_temp.after_hook('/rpc/resolve_public_search_document'), pg_temp.after_hook('/events'),
            pg_temp.after_hook('/rpc/pg_direct_event_checkout_bundle', 'anon', '3s'), pg_temp.after_hook('/rpc/opsx_thing'),
            pg_temp.after_hook('/rpc/teams_list'), pg_temp.after_hook('/ops_work_cards'), pg_temp.after_hook('/'),
            pg_temp.after_hook(null), pg_temp.after_hook('/rpc/links_page_week', 'service_role', '0')),
  '8s,8s,3s,8s,8s,8s,8s,8s,0');
-- The limit persists into the NEXT statement of the same transaction, which
-- is how PostgREST's RPC statement sees it.
select set_config('request.path', '/rpc/ops_work_list', true), set_config('statement_timeout', '8s', true);
select public.pgrst_pre_request();
select pg_temp.chk('PATH', 'the limit holds for the following statement in the request', current_setting('statement_timeout'), '3s');
set local statement_timeout = 0;

select pg_temp.chk('ROLE', 'authenticator runs the hook, closes idle transactions after 30 s and keeps its other settings',
  (select string_agg(c, ',' order by c) from pg_db_role_setting s cross join lateral unnest(s.setconfig) c
    where s.setrole = 'authenticator'::regrole and s.setdatabase = 0
      and split_part(c, '=', 1) in ('pgrst.db_pre_request', 'idle_in_transaction_session_timeout', 'statement_timeout', 'lock_timeout', 'session_preload_libraries')),
  'idle_in_transaction_session_timeout=30s,lock_timeout=8s,pgrst.db_pre_request=public.pgrst_pre_request,session_preload_libraries=safeupdate,statement_timeout=8s');

select pg_temp.chk('SHAPE', 'SECURITY INVOKER with a pinned search_path',
  (select p.prosecdef::text || '/' || array_to_string(p.proconfig, ';') from pg_proc p where p.oid = 'public.pgrst_pre_request()'::regprocedure),
  'false/search_path=pg_catalog, pg_temp');
select pg_temp.chk('SHAPE', 'the body reads no table (no FROM, JOIN, INSERT, UPDATE or DELETE)',
  (select (prosrc !~* '\m(from|join|insert|update|delete)\M')::text from pg_proc where oid = 'public.pgrst_pre_request()'::regprocedure), 'true');
select pg_temp.chk('SHAPE', 'anon, authenticated and service_role can run it; PUBLIC cannot',
  concat_ws(',', has_function_privilege('anon', 'public.pgrst_pre_request()', 'EXECUTE'),
            has_function_privilege('authenticated', 'public.pgrst_pre_request()', 'EXECUTE'),
            has_function_privilege('service_role', 'public.pgrst_pre_request()', 'EXECUTE'),
            (select bool_or(a.grantee = 0) from pg_proc p cross join lateral aclexplode(p.proacl) a where p.oid = 'public.pgrst_pre_request()'::regprocedure)),
  't,t,t,f');

-- ───────────────────────────── HEALTH ─────────────────────────────
select pg_temp.chk('HEALTH', 'the snapshot carries pool and long-query numbers and no query text',
  (select string_agg(k, ',' order by k) from jsonb_object_keys(public.issue_4423_db_health_snapshot()) k)
  || '|' || (public.issue_4423_db_health_snapshot()->>'pool_size')
  || '|' || ((public.issue_4423_db_health_snapshot()->>'pool_in_use')::int >= 0 and (public.issue_4423_db_health_snapshot()->>'long_running')::int >= 0)::text,
  'at,long_running,longest_app,longest_ms,pool_in_use,pool_open,pool_size|30|true');
delete from public.issue_4423_db_health_state;
select pg_temp.chk('HEALTH', 'record: high, high, low, high counts 1, 2, 0, 1; an alert keeps its time',
  concat_ws(',',
    public.issue_4423_db_health_record(true, false, '{"pool_in_use": 25}')->>'high_streak',
    public.issue_4423_db_health_record(true, false, null)->>'high_streak',
    public.issue_4423_db_health_record(false, false, null)->>'high_streak',
    public.issue_4423_db_health_record(true, false, null)->>'high_streak',
    (public.issue_4423_db_health_record(true, true, null)->>'last_alert_at' is not null)::text,
    (public.issue_4423_db_health_record(false, false, null)->>'last_alert_at' is not null)::text),
  '1,2,0,1,true,true');
select pg_temp.chk('HEALTH', 'record keeps one row and the last snapshot it was given',
  (select count(*)::text || '/' || max(last_snapshot->>'pool_in_use') from public.issue_4423_db_health_state), '1/25');
select pg_temp.chk('HEALTH', 'both functions are service_role only; the state table has RLS on and no anon or authenticated grant',
  concat_ws(',',
    has_function_privilege('service_role', 'public.issue_4423_db_health_snapshot()', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.issue_4423_db_health_snapshot()', 'EXECUTE'),
    has_function_privilege('anon', 'public.issue_4423_db_health_snapshot()', 'EXECUTE'),
    has_function_privilege('service_role', 'public.issue_4423_db_health_record(boolean, boolean, jsonb)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.issue_4423_db_health_record(boolean, boolean, jsonb)', 'EXECUTE'),
    (select relrowsecurity::text from pg_class where oid = 'public.issue_4423_db_health_state'::regclass),
    has_table_privilege('authenticated', 'public.issue_4423_db_health_state', 'SELECT'),
    has_table_privilege('anon', 'public.issue_4423_db_health_state', 'SELECT')),
  't,f,f,t,f,true,f,f');
select pg_temp.chk('HEALTH', 'the 5-minute cron posts {"mode":"db"} to api-health-probe, off the hourly :00 tick',
  (select j.schedule || '|' || (j.command like '%/functions/v1/api-health-probe%' and j.command like '%{"mode":"db"}%')::text
     from cron.job j where j.jobname = 'issue_4423_db_health_probe'),
  '2-59/5 * * * *|true');

do $r$
declare r record; v_fail integer := 0; v_all integer := 0;
begin
  for r in select * from tx_results order by seq loop
    v_all := v_all + 1;
    if r.ok then raise notice 'PASS % %', r.test, r.label;
    else v_fail := v_fail + 1; raise notice 'FAIL % % (%)', r.test, r.label, coalesce(r.detail, ''); end if;
  end loop;
  if v_all < 12 then raise exception '#4423 W3 recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4423 W3: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4423 W3: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
