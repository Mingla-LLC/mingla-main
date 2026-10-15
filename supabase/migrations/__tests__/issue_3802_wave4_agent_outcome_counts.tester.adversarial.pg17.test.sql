-- Issue #3802 PR-D — adversarial catalog/source proof for the one additive
-- crm_team_summary(date) replacement. Runs after the complete PG17 replay.
\set ON_ERROR_STOP on
\set t3802d_file `cat supabase/migrations/20271019003802_issue_3802_wave4_agent_outcome_counts.sql`
begin;
create temp table t3802da_results (label text, ok boolean, detail text) on commit drop;
create temp table t3802da_source (migration text not null) on commit drop;
insert into t3802da_source values (:'t3802d_file');
create function pg_temp.t3802da_check(p_label text, p_ok boolean, p_detail text default '') returns void language sql as $fn$
  insert into t3802da_results values (p_label, coalesce(p_ok, false), p_detail)
$fn$;

do $proof$
declare
  f record;
  source text := pg_get_functiondef('public.crm_team_summary(date)'::regprocedure);
  migration text := (select s.migration from t3802da_source s limit 1);
  original_admin text := pg_get_functiondef('public.is_admin_user()'::regprocedure);
begin
  select * into strict f from pg_proc where oid = 'public.crm_team_summary(date)'::regprocedure;
  perform pg_temp.t3802da_check('same one-date signature and default',
    f.pronargs = 1 and f.pronargdefaults = 1 and pg_get_function_arguments(f.oid) = 'p_today date DEFAULT NULL::date',
    pg_get_function_arguments(f.oid));
  perform pg_temp.t3802da_check('stable security definer with empty search path',
    f.provolatile = 's' and f.prosecdef and f.proconfig = array['search_path=""'], coalesce(f.proconfig::text, '<null>'));
  perform pg_temp.t3802da_check('client grants stay authenticated and service only',
    not exists (select 1 from aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') and
    not has_function_privilege('anon', 'public.crm_team_summary(date)', 'EXECUTE') and
    has_function_privilege('authenticated', 'public.crm_team_summary(date)', 'EXECUTE') and
    has_function_privilege('service_role', 'public.crm_team_summary(date)', 'EXECUTE'));
  perform pg_temp.t3802da_check('owner/admin gate stays is_admin_user', source like '%IF NOT public.is_admin_user() THEN%', source);
  perform pg_temp.t3802da_check('UTC week boundary stays Monday 00:00', source like '%date_trunc(''week'', now() AT TIME ZONE ''UTC'') AT TIME ZONE ''UTC''%', source);
  perform pg_temp.t3802da_check('person bucket is exactly null via', source like '%a.via IS NULL%', source);
  perform pg_temp.t3802da_check('agent buckets are exact closed values', source like '%a.via = ''claude''%' and source like '%a.via = ''codex''%', source);
  perform pg_temp.t3802da_check('three and only three bucket objects are returned',
    source like '%''touches_by''%' and source like '%''stage_moves_by''%' and source like '%''added_by''%' and
    source not like '%''system''%' and source not like '%''unknown''%', source);
  perform pg_temp.t3802da_check('summary source returns no draft, call, argument, result or key material',
    source !~* 'team_drafts|team_agent_calls|request_args|result_json|key_digest|subject|message_body', source);
  perform pg_temp.t3802da_check('migration changes no table, policy or is_admin_user body',
    migration !~* 'create[[:space:]]+(table|policy)|alter[[:space:]]+table|create[[:space:]]+or[[:space:]]+replace[[:space:]]+function[[:space:]]+public\.is_admin_user', migration);
  perform pg_temp.t3802da_check('is_admin_user still exists unchanged through the replacement',
    encode(digest(original_admin, 'sha256'), 'hex') = encode(digest(pg_get_functiondef('public.is_admin_user()'::regprocedure), 'sha256'), 'hex'));
end $proof$;

select count(*) as total, count(*) filter (where not ok) as failed,
       coalesce(string_agg(label || ': ' || detail, E'\n' order by label) filter (where not ok), 'none') as failures
from t3802da_results \gset
\if :failed
  \echo 'ISSUE-3802 PR-D OUTCOME COUNTS ADVERSARIAL FAILED:' :failures
  do $$ begin raise exception 'issue3802_pr_d_outcome_counts_adversarial_failed'; end $$;
\endif
\echo 'ISSUE-3802 PR-D OUTCOME COUNTS ADVERSARIAL PASS:' :total 'checks'
rollback;
