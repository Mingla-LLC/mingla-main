-- Issue #3872 R1 discounts: public grants stay narrow and the kill switch fails closed.
-- Runs only on the disposable fully replayed PostgreSQL 17 database.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id,email) values
  ('38721400-0000-4000-8000-000000000001','issue3872-grants@test.local')
on conflict (id) do nothing;
insert into public.creator_accounts (id) values
  ('38721400-0000-4000-8000-000000000001')
on conflict (id) do nothing;
insert into public.brands (id,account_id,name,slug,default_currency,payment_provider,payment_country)
values ('38721400-0000-4000-8100-000000000001','38721400-0000-4000-8000-000000000001',
        'Issue 3872 grant brand','issue-3872-grant-brand','USD','stripe','US');
insert into public.brand_discounts
  (id,brand_id,kind,code,name,value_type,value_bps,scope_kind,status,created_by)
values
  ('38721400-0000-4000-8300-000000000001','38721400-0000-4000-8100-000000000001',
   'code','CLOSED10','Closed code','percent',1000,'brand','active','38721400-0000-4000-8000-000000000001'),
  ('38721400-0000-4000-8300-000000000002','38721400-0000-4000-8100-000000000001',
   'automatic',null,'Closed automatic','percent',500,'brand','active','38721400-0000-4000-8000-000000000001');
insert into public.program_brand_rollouts(brand_id,program,phase)
values ('38721400-0000-4000-8100-000000000001','discounts','pilot');
update public.feature_flags set is_enabled=false where flag_key='discounts_enabled';

do $test$
declare
  v_internal regprocedure;
  v_capability_count integer;
begin
  select count(*) into v_capability_count
  from public.ari_cert_capability_requirements
  where (capability_id, evidence_mode) in (
    ('ari.discounts.list', 'read'),
    ('ari.discounts.create', 'write'),
    ('ari.discounts.pause', 'write')
  );
  if v_capability_count <> 3 then
    raise exception 'T14 Ari discount certification requirements are incomplete';
  end if;

  if not has_function_privilege('anon','public.pg_public_event_tier_pricing(uuid)','EXECUTE')
     or not has_function_privilege('anon','public.pg_public_event_display_prices(uuid[])','EXECUTE')
     or not has_function_privilege('anon','public.pg_public_menu_item_sales(uuid)','EXECUTE') then
    raise exception 'T14 expected public discount display RPC grants are missing';
  end if;

  foreach v_internal in array array[
    'public.issue_3872_discount_candidates(uuid,jsonb,text,jsonb,timestamptz)'::regprocedure,
    'public.issue_3872_discount_apply(jsonb)'::regprocedure,
    'public.issue_3872_upsert_discount(uuid,text,jsonb)'::regprocedure,
    'public.issue_3872_discount_maintenance(timestamptz)'::regprocedure,
    'public.issue_3872_mark_discount_notified(uuid,text)'::regprocedure,
    'public.brand_discount_access(uuid)'::regprocedure,
    'public.brand_discounts_list(uuid,text)'::regprocedure,
    'public.brand_prices_overview(uuid)'::regprocedure,
    'public.brand_discount_report(uuid,timestamptz,timestamptz)'::regprocedure,
    'public.brand_discount_report_buyers(uuid,timestamptz,timestamptz)'::regprocedure,
    'public.order_discount_lines_for_order(text,uuid)'::regprocedure,
    'public.admin_discount_margin_summary(timestamptz,timestamptz)'::regprocedure
  ] loop
    if has_function_privilege('anon',v_internal,'EXECUTE') then
      raise exception 'T14 anon can execute internal function %',v_internal;
    end if;
  end loop;

  if not has_function_privilege('authenticated','public.brand_discount_access(uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.brand_discounts_list(uuid,text)','EXECUTE')
     or not has_function_privilege('authenticated','public.brand_prices_overview(uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.brand_discount_report(uuid,timestamptz,timestamptz)','EXECUTE')
     or not has_function_privilege('authenticated','public.brand_discount_report_buyers(uuid,timestamptz,timestamptz)','EXECUTE')
     or not has_function_privilege('authenticated','public.order_discount_lines_for_order(text,uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.admin_discount_margin_summary(timestamptz,timestamptz)','EXECUTE') then
    raise exception 'T14 authenticated Host/admin grants are incomplete';
  end if;

  if has_function_privilege('authenticated','public.issue_3872_upsert_discount(uuid,text,jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.issue_3872_discount_maintenance(timestamptz)','EXECUTE')
     or has_function_privilege('authenticated','public.issue_3872_mark_discount_notified(uuid,text)','EXECUTE') then
    raise exception 'T14 authenticated can bypass an edge/service-only boundary';
  end if;
end;
$test$;

set local role service_role;
do $test$
declare v_result jsonb;
begin
  v_result := public.issue_3872_discount_candidates(
    '38721400-0000-4000-8100-000000000001',
    '[{"lineRef":"line-1","listingKind":"event","targetKind":"ticket_type","targetId":"38721400-0000-4000-8200-000000000001","quantity":1,"listUnitMinor":1000,"discountsAllowed":true}]'::jsonb,
    'CLOSED10',
    '{"email":"buyer@test.local"}'::jsonb,
    now()
  );
  if v_result->'automatics' <> '[]'::jsonb
     or v_result->'code' <> 'null'::jsonb
     or v_result->>'codeLookup' is distinct from 'not_found' then
    raise exception 'T14 kill switch did not fail closed: %',v_result;
  end if;
end;
$test$;
reset role;

rollback;
