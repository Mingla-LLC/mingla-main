-- Issue #3872 R1 discounts: independent adversarial schema and authorization suite.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id,email) values
  ('3872a000-0000-4000-8000-000000000001','issue3872a-owner@test.local'),
  ('3872a000-0000-4000-8000-000000000002','issue3872a-scanner@test.local')
on conflict (id) do nothing;
insert into public.creator_accounts (id) values ('3872a000-0000-4000-8000-000000000001')
on conflict (id) do nothing;
insert into public.brands (id,account_id,name,slug,default_currency,payment_provider,payment_country)
values ('3872a000-0000-4000-8100-000000000001','3872a000-0000-4000-8000-000000000001',
        'Issue 3872 adversarial brand','issue-3872-adversarial-brand','USD','stripe','US');
insert into public.brand_team_members (brand_id,user_id,role,accepted_at,invited_at)
values ('3872a000-0000-4000-8100-000000000001','3872a000-0000-4000-8000-000000000002',
        'scanner',now(),now());
set local session_replication_role=replica;
insert into public.events (id,brand_id,title,slug,status,visibility,event_type)
values ('3872a000-0000-4000-8200-000000000001','3872a000-0000-4000-8100-000000000001',
        'Issue 3872 adversarial event','issue-3872-adversarial-event','draft','draft','event');
set local session_replication_role=origin;
insert into public.brand_discounts
  (id,brand_id,kind,code,name,value_type,value_bps,scope_kind,status,created_by)
values ('3872a000-0000-4000-8300-000000000001','3872a000-0000-4000-8100-000000000001',
        'code','TEST10','Test ten','percent',1000,'listing_kinds','active',
        '3872a000-0000-4000-8000-000000000001');
insert into public.brand_discount_targets (discount_id,target_kind,listing_kind)
values ('3872a000-0000-4000-8300-000000000001','listing_kind','event');

do $test$
begin
  begin
    insert into public.brand_discount_targets (discount_id,target_kind,listing_kind)
    values ('3872a000-0000-4000-8300-000000000001','listing_kind','event');
    raise exception 'T2 duplicate listing_kind target was accepted';
  exception when unique_violation then null; end;

  begin
    update public.events set discounts_allowed=false
    where id='3872a000-0000-4000-8200-000000000001';
    raise exception 'T2 direct discounts_allowed update was accepted';
  exception when others then
    if sqlerrm not like '%discounts_allowed_writer_required%' then
      raise exception 'T2 wrong direct-update refusal: %',sqlerrm;
    end if;
  end;
end;
$test$;

insert into public.order_discount_lines
  (id,order_kind,order_id,line_ref,discount_id,brand_id,kind,code_snapshot,name_snapshot,
   value_type,value_bps,units,amount_minor,applied_seq,currency)
values
  ('3872a000-0000-4000-8400-000000000001','ticket','3872a000-0000-4000-8500-000000000001',
   'line-1','3872a000-0000-4000-8300-000000000001','3872a000-0000-4000-8100-000000000001',
   'code','TEST10','Test ten','percent',1000,1,100,1,'USD');

do $test$
begin
  begin
    update public.order_discount_lines set amount_minor=101
    where id='3872a000-0000-4000-8400-000000000001';
    raise exception 'T2 immutable line update was accepted';
  exception when others then
    if sqlerrm not like '%order_discount_lines_immutable%' then
      raise exception 'T2 wrong update refusal: %',sqlerrm;
    end if;
  end;
  begin
    delete from public.order_discount_lines where id='3872a000-0000-4000-8400-000000000001';
    raise exception 'T2 immutable line delete was accepted';
  exception when others then
    if sqlerrm not like '%order_discount_lines_immutable%' then
      raise exception 'T2 wrong delete refusal: %',sqlerrm;
    end if;
  end;
end;
$test$;

set local role authenticated;
select set_config('request.jwt.claim.sub','3872a000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"3872a000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $test$
begin
  if (select count(*) from public.brand_discounts
      where id='3872a000-0000-4000-8300-000000000001')<>0 then
    raise exception 'T2 rank-10 member crossed the rank-20 read boundary';
  end if;
end;
$test$;
reset role;

rollback;
