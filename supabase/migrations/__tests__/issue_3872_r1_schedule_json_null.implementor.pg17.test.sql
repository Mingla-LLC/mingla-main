-- Issue #3872 R1 live-save regression: JSON null schedule values are stored as SQL NULL.
-- MINGLA-INVARIANT: I-3872-SCHEDULE-NULL | issue #3872 | Host create/update payloads may carry JSON null for an absent schedule; the database must normalize it to SQL NULL before discount constraints run.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id,email) values
  ('3872f000-0000-4000-8000-000000000001','issue3872-schedule-null@test.local')
on conflict (id) do nothing;
insert into public.creator_accounts (id) values
  ('3872f000-0000-4000-8000-000000000001')
on conflict (id) do nothing;
insert into public.brands (
  id,account_id,name,slug,default_currency,pricing_currency,payment_provider,payment_country
) values (
  '3872f000-0000-4000-8100-000000000001',
  '3872f000-0000-4000-8000-000000000001',
  'Issue 3872 schedule-null brand','issue-3872-schedule-null-brand','USD','USD','stripe','US'
);

do $test$
declare
  v_actor constant uuid := '3872f000-0000-4000-8000-000000000001';
  v_brand constant uuid := '3872f000-0000-4000-8100-000000000001';
  v_code jsonb;
  v_automatic jsonb;
begin
  v_code := public.issue_3872_upsert_discount(
    v_actor,
    'create',
    jsonb_build_object(
      'brandId',v_brand,
      'kind','code',
      'code','NULLSAFE10',
      'name','JSON null code',
      'valueType','percent',
      'valueBps',1000,
      'scopeKind','brand',
      'combinesWith','automatic_only',
      'startsAt','2027-01-01T00:00:00Z',
      'schedule',null,
      'targets','[]'::jsonb
    )
  );
  if not exists (
    select 1 from public.brand_discounts
    where id=(v_code->>'id')::uuid and schedule is null
  ) then
    raise exception 'R1 schedule-null create did not persist SQL NULL';
  end if;

  v_automatic := public.issue_3872_upsert_discount(
    v_actor,
    'create',
    jsonb_build_object(
      'brandId',v_brand,
      'kind','automatic',
      'name','Scheduled automatic',
      'valueType','percent',
      'valueBps',500,
      'scopeKind','brand',
      'combinesWith','any',
      'startsAt','2027-01-01T00:00:00Z',
      'schedule',jsonb_build_object('days',jsonb_build_array(1),'from','09:00','to','17:00'),
      'targets','[]'::jsonb
    )
  );
  v_automatic := public.issue_3872_upsert_discount(
    v_actor,
    'update',
    jsonb_build_object(
      'id',v_automatic->>'id',
      'version',v_automatic->>'version',
      'schedule',null,
      'targets','[]'::jsonb
    )
  );
  if not exists (
    select 1 from public.brand_discounts
    where id=(v_automatic->>'id')::uuid and schedule is null
  ) then
    raise exception 'R1 schedule-null update did not clear to SQL NULL';
  end if;
end;
$test$;

rollback;
