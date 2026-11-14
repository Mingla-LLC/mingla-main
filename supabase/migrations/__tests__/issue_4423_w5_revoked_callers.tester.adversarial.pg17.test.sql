-- Issue #4423 Wave 5 -- independent tester suite (final gate), on the fully
-- replayed PG17 schema. Everything is rolled back.
--
-- The implementor suite checks the grant table. This suite attacks the other
-- side: what still CALLS a function that lost EXECUTE for anon and
-- authenticated, and whether those paths keep working for a real caller.
--
--   DEPS     for every function in the grants migration: no policy and no view
--            names it, every public function whose body names it is SECURITY
--            DEFINER, and that definer's owner can still execute it. A future
--            policy or SECURITY INVOKER helper that calls one of them would make
--            reads fail with 42501 for every signed-in user; this catches it.
--   MONEY    a buyer still reads their own order through the orders policy
--            (biz_can_read_order_for_caller -> biz_can_read_order), another
--            signed-in user reads nothing, and the buyer's direct call to the
--            revoked helper is refused (42501) while service_role still gets an
--            answer.
--   DIRECT   anon and authenticated are refused 42501 on a sample of the
--            revoked helpers, including the ones that answered for any order /
--            user pair before Wave 5.
--
-- FAILS-ON-REVERT: without 20280707404423_issue_4423_w5_function_grants.sql the
-- MONEY direct-call check and every DIRECT check fail (the helpers answer).
--
-- Run from the repository root as supabase_admin.

\set ON_ERROR_STOP on
begin;

create temp table tx_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create function pg_temp.chk(p_test text, p_label text, p_got text, p_want text) returns void
language sql as $fn$
  insert into tx_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 900), '<null>'), coalesce(left(p_want, 900), '<null>')));
$fn$;

-- The revoked set: the 43 functions in
-- 20280707404423_issue_4423_w5_function_grants.sql (keep in step with it).
create temp table t_revoked (name text) on commit drop;
insert into t_revoked (name) values
  ('admin_analytics_engagement'),
  ('admin_analytics_funnel'),
  ('admin_analytics_geo'),
  ('admin_analytics_growth'),
  ('admin_analytics_retention'),
  ('admin_bulk_deactivate_places'),
  ('admin_card_generation_active'),
  ('admin_card_generation_status'),
  ('admin_explorer_app_leads_list'),
  ('admin_list_stale_places'),
  ('admin_place_pool_city_list'),
  ('admin_place_pool_country_list'),
  ('admin_pool_category_health'),
  ('admin_reactivate_place'),
  ('admin_rule_detail'),
  ('admin_rule_set_diff'),
  ('admin_rule_set_versions'),
  ('admin_rules_export'),
  ('admin_rules_list'),
  ('admin_rules_overview'),
  ('admin_rules_preview_impact'),
  ('admin_rules_rollback'),
  ('admin_rules_run_affected_places'),
  ('admin_rules_run_detail'),
  ('admin_rules_run_diff'),
  ('admin_rules_runs'),
  ('admin_set_trip_place'),
  ('admin_uncategorized_places'),
  ('admin_virtual_tile_intelligence'),
  ('ari_admin_quality_cases'),
  ('ari_admin_quality_dashboard'),
  ('biz_can_manage_orders_for_event'),
  ('biz_can_read_order'),
  ('biz_guest_roster_detail'),
  ('business_move_event_date_time'),
  ('is_muted_by'),
  ('issue_3720_community_comments'),
  ('issue_3720_is_host_community_member'),
  ('issue_4382_customer_can_view_conversation'),
  ('issue_4382_source_reporter_count'),
  ('release_advisory_lock_rules_run'),
  ('rpc_force_deck_recycle'),
  ('try_advisory_lock_rules_run');
grant select on t_revoked to anon, authenticated, service_role;

-- ───────────────────────────── DEPS ─────────────────────────────
do $t$
declare v text;
begin
  perform pg_temp.chk('DEPS', 'the grants migration revokes 43 functions',
    (select count(*) from t_revoked)::text, '43');

  select string_agg(distinct r.name || ' <- ' || pp.schemaname || '.' || pp.tablename || '.' || pp.policyname, '; ')
    into v
    from t_revoked r
    join pg_policies pp on (coalesce(pp.qual, '') || ' ' || coalesce(pp.with_check, '')) ~ ('\m' || r.name || '\M');
  perform pg_temp.chk('DEPS', 'no RLS policy calls a revoked function', coalesce(v, 'none'), 'none');

  select string_agg(distinct r.name || ' <- ' || c.oid::regclass::text, '; ')
    into v
    from t_revoked r
    join pg_class c on c.relkind in ('v', 'm')
                   and c.relnamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
                   and pg_get_viewdef(c.oid) ~ ('\m' || r.name || '\M');
  perform pg_temp.chk('DEPS', 'no view calls a revoked function', coalesce(v, 'none'), 'none');

  select string_agg(distinct r.name || ' <- ' || caller.oid::regprocedure::text, '; ')
    into v
    from t_revoked r
    join pg_proc callee on callee.proname = r.name and callee.pronamespace = 'public'::regnamespace
    join pg_proc caller on caller.oid <> callee.oid
                       and caller.pronamespace = 'public'::regnamespace
                       and caller.prosrc ~ ('\m' || r.name || '\M')
   where not caller.prosecdef;
  perform pg_temp.chk('DEPS', 'every public function that calls a revoked function is SECURITY DEFINER',
    coalesce(v, 'none'), 'none');

  select string_agg(distinct r.name || ' <- ' || caller.oid::regprocedure::text, '; ')
    into v
    from t_revoked r
    join pg_proc callee on callee.proname = r.name and callee.pronamespace = 'public'::regnamespace
    join pg_proc caller on caller.oid <> callee.oid
                       and caller.pronamespace = 'public'::regnamespace
                       and caller.prosrc ~ ('\m' || r.name || '\M')
   where not has_function_privilege(caller.proowner, callee.oid, 'EXECUTE');
  perform pg_temp.chk('DEPS', 'every definer that calls a revoked function is owned by a role that can still execute it',
    coalesce(v, 'none'), 'none');
end;
$t$;

-- ───────────────────────────── seed (money path) ─────────────────────────────
set local session_replication_role = replica;
insert into auth.users (id, email, aud, role, instance_id, created_at, updated_at) values
  ('44230000-0000-4000-a000-0000000000b1', 'buyer.w5t@t4423.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('44230000-0000-4000-a000-0000000000b2', 'other.w5t@t4423.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
  ('44230000-0000-4000-a000-0000000000b3', 'owner.w5t@t4423.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());
insert into public.brands (id, account_id, name, slug)
  values ('44230000-0000-4000-b000-0000000000b1', '44230000-0000-4000-a000-0000000000b3', 'W5 tester brand', 'w5-tester-brand-4423');
insert into public.events (id, brand_id, title, slug)
  values ('44230000-0000-4000-c000-0000000000b1', '44230000-0000-4000-b000-0000000000b1', 'W5 tester event', 'w5-tester-event-4423');
insert into public.orders (id, event_id, buyer_user_id, source)
  values ('44230000-0000-4000-e000-0000000000b1', '44230000-0000-4000-c000-0000000000b1', '44230000-0000-4000-a000-0000000000b1', 'manual_import');
set local session_replication_role = origin;

create function pg_temp.as_user(p_id uuid) returns void language sql as $fn$
  select set_config('request.jwt.claim.sub', p_id::text, true),
         set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$fn$;

-- Runs one call as the current role and returns 'ok:<value>' or the SQLSTATE.
create function pg_temp.try(p_sql text) returns text language plpgsql as $fn$
declare v text;
begin
  execute p_sql into v;
  return 'ok:' || coalesce(v, '<null>');
exception when others then
  return sqlstate;
end;
$fn$;
grant execute on function pg_temp.try(text) to anon, authenticated, service_role;

-- ───────────────────────────── MONEY ─────────────────────────────
do $t$
declare v_read text; v_other text; v_direct text; v_svc text;
begin
  perform pg_temp.as_user('44230000-0000-4000-a000-0000000000b1');
  set local role authenticated;
  v_read := pg_temp.try($q$select count(*)::text from public.orders where id = '44230000-0000-4000-e000-0000000000b1'$q$);
  v_direct := pg_temp.try($q$select public.biz_can_read_order('44230000-0000-4000-e000-0000000000b1', '44230000-0000-4000-a000-0000000000b1')::text$q$);
  reset role;
  perform pg_temp.chk('MONEY', 'the buyer reads their own order through the orders policy', v_read, 'ok:1');
  perform pg_temp.chk('MONEY', 'the buyer''s direct call to the revoked order helper is refused', v_direct, '42501');

  perform pg_temp.as_user('44230000-0000-4000-a000-0000000000b2');
  set local role authenticated;
  v_other := pg_temp.try($q$select count(*)::text from public.orders where id = '44230000-0000-4000-e000-0000000000b1'$q$);
  reset role;
  perform pg_temp.chk('MONEY', 'another signed-in user reads no order row', v_other, 'ok:0');

  set local role service_role;
  v_svc := pg_temp.try($q$select public.biz_can_read_order('44230000-0000-4000-e000-0000000000b1', '44230000-0000-4000-a000-0000000000b1')::text$q$);
  reset role;
  perform pg_temp.chk('MONEY', 'service_role still gets an answer from the order helper', v_svc, 'ok:true');
end;
$t$;

-- ───────────────────────────── DIRECT ─────────────────────────────
do $t$
declare r record; v text;
begin
  for r in select * from (values
      ('anon', $q$select public.biz_can_read_order('44230000-0000-4000-e000-0000000000b1', '44230000-0000-4000-a000-0000000000b1')::text$q$),
      ('anon', $q$select public.biz_can_manage_orders_for_event('44230000-0000-4000-c000-0000000000b1', '44230000-0000-4000-a000-0000000000b3')::text$q$),
      ('anon', $q$select public.is_muted_by('44230000-0000-4000-a000-0000000000b1', '44230000-0000-4000-a000-0000000000b2')::text$q$),
      ('anon', $q$select public.try_advisory_lock_rules_run(4423)::text$q$),
      ('authenticated', $q$select public.is_muted_by('44230000-0000-4000-a000-0000000000b1', '44230000-0000-4000-a000-0000000000b2')::text$q$),
      ('authenticated', $q$select public.issue_4382_customer_can_view_conversation(gen_random_uuid(), '44230000-0000-4000-a000-0000000000b1')::text$q$),
      ('authenticated', $q$select public.try_advisory_lock_rules_run(4423)::text$q$)
    ) x(role_name, sql)
  loop
    perform pg_temp.as_user('44230000-0000-4000-a000-0000000000b1');
    execute format('set local role %I', r.role_name);
    v := pg_temp.try(r.sql);
    reset role;
    perform pg_temp.chk('DIRECT', format('%s is refused: %s', r.role_name, left(r.sql, 70)), v, '42501');
  end loop;
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
  if v_all < 16 then raise exception '#4423 W5 tester recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4423 W5 tester: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4423 W5 tester: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
