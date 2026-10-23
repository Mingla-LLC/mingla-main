-- Issue #3872 R1 discounts: happy-path schema, target orphaning and rank-20 reads.
-- Runs only on the disposable fully replayed PostgreSQL 17 database.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id,email) values
  ('38720000-0000-4000-8000-000000000001','issue3872-owner@test.local'),
  ('38720000-0000-4000-8000-000000000002','issue3872-marketing@test.local')
on conflict (id) do nothing;
insert into public.creator_accounts (id) values
  ('38720000-0000-4000-8000-000000000001')
on conflict (id) do nothing;
insert into public.brands (id,account_id,name,slug,default_currency,payment_provider,payment_country)
values ('38720000-0000-4000-8100-000000000001','38720000-0000-4000-8000-000000000001',
        'Issue 3872 schema brand','issue-3872-schema-brand','USD','stripe','US');
insert into public.brand_team_members (brand_id,user_id,role,accepted_at,invited_at)
values ('38720000-0000-4000-8100-000000000001','38720000-0000-4000-8000-000000000002',
        'marketing_manager',now(),now());

set local session_replication_role = replica;
insert into public.events (id,brand_id,title,slug,status,visibility,event_type)
values ('38720000-0000-4000-8200-000000000001','38720000-0000-4000-8100-000000000001',
        'Issue 3872 event','issue-3872-schema-event','draft','draft','event');
set local session_replication_role = origin;

insert into public.brand_discounts
  (id,brand_id,kind,code,name,value_type,value_bps,scope_kind,status,created_by)
values
  ('38720000-0000-4000-8300-000000000001','38720000-0000-4000-8100-000000000001',
   'code','SAVE10','Save ten','percent',1000,'listings','active','38720000-0000-4000-8000-000000000001');
insert into public.brand_discount_targets (discount_id,target_kind,target_id)
values ('38720000-0000-4000-8300-000000000001','event','38720000-0000-4000-8200-000000000001');

do $test$
declare v_missing text; v_default text; v_count integer;
begin
  select string_agg(x,', ' order by x) into v_missing
  from unnest(array[
    'brand_discounts','brand_discount_targets','discount_uses','order_discount_lines',
    'program_brand_rollouts','discount_code_attempts'
  ]) x where to_regclass('public.'||x) is null;
  if v_missing is not null then raise exception 'T1 missing tables: %',v_missing; end if;

  select column_default into v_default from information_schema.columns
  where table_schema='public' and table_name='brand_discounts' and column_name='combines_with';
  if v_default not like '%automatic_only%' then
    raise exception 'T1 database fallback is not automatic_only: %',v_default;
  end if;

  select count(*) into v_count from pg_indexes where schemaname='public'
    and indexname in ('brand_discounts_code_uq','bdt_listing_kind_uq','bdt_target_uq',
                      'du_discount_live_idx','odl_order_idx','dca_scope_idx');
  if v_count<>6 then raise exception 'T1 expected six load-bearing indexes, got %',v_count; end if;

  if not (select relrowsecurity from pg_class where oid='public.brand_discounts'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.discount_uses'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.order_discount_lines'::regclass) then
    raise exception 'T1 RLS is not enabled on discount truth tables';
  end if;

  if (select combines_with from public.brand_discounts where id='38720000-0000-4000-8300-000000000001')
       is distinct from 'automatic_only' then
    raise exception 'T1 database default changed';
  end if;
end;
$test$;

-- The real soft-delete trigger orphans the target and marks the definition.
update public.events set deleted_at=now() where id='38720000-0000-4000-8200-000000000001';
do $test$
begin
  if (select orphaned_at is null from public.brand_discount_targets
      where discount_id='38720000-0000-4000-8300-000000000001') then
    raise exception 'T1 event target was not orphaned';
  end if;
  if (select needs_attention from public.brand_discounts
      where id='38720000-0000-4000-8300-000000000001') is distinct from 'target_deleted' then
    raise exception 'T1 target deletion did not mark needs_attention';
  end if;
end;
$test$;

-- Rank 20 is the minimum Host read role.
set local role authenticated;
select set_config('request.jwt.claim.sub','38720000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"38720000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $test$
begin
  if (select count(*) from public.brand_discounts
      where id='38720000-0000-4000-8300-000000000001')<>1 then
    raise exception 'T1 rank-20 member cannot read the brand discount';
  end if;
  if (select count(*) from public.brand_discount_targets
      where discount_id='38720000-0000-4000-8300-000000000001')<>1 then
    raise exception 'T1 rank-20 member cannot read discount targets';
  end if;
end;
$test$;
reset role;

rollback;
