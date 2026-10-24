-- Issue #3872 R2 B1: referral/payee foundation, shared code namespace, and
-- offer-overlap invariants. Runs on the disposable fully replayed PG17 DB.
-- MINGLA-INVARIANT: I-3872-ONE-PAYEE | issue #3872 | An eligible order has at most one referral payee share; payee_shares(order_kind,order_id,payee_kind) is the enforcement authority.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id,email) values
  ('38720000-0000-4000-9000-000000000001','r2-owner@test.local'),
  ('38720000-0000-4000-9000-000000000002','r2-member@test.local')
on conflict (id) do nothing;
insert into public.creator_accounts (id) values
  ('38720000-0000-4000-9000-000000000001')
on conflict (id) do nothing;
insert into public.brands
  (id,account_id,name,slug,default_currency,pricing_currency,payment_provider,payment_country)
values
  ('38720000-0000-4000-9100-000000000001','38720000-0000-4000-9000-000000000001',
   'Issue 3872 R2 brand','issue-3872-r2-brand','USD','USD','stripe','US');
insert into public.brand_team_members (brand_id,user_id,role,accepted_at,invited_at)
values
  ('38720000-0000-4000-9100-000000000001','38720000-0000-4000-9000-000000000002',
   'marketing_manager',now(),now());

set local session_replication_role = replica;
insert into public.events (id,brand_id,created_by,title,slug,status,visibility,event_type)
values
  ('38720000-0000-4000-9200-000000000001','38720000-0000-4000-9100-000000000001',
   '38720000-0000-4000-9000-000000000001','R2 overlap event','r2-overlap-event',
   'draft','draft','event');
set local session_replication_role = origin;

do $test$
declare
  v_missing text;
  v_count integer;
  v_body text;
begin
  select string_agg(name,', ' order by name) into v_missing
  from unnest(array[
    'referral_offers','referral_offer_listings','referral_offer_tiers',
    'referral_members','host_tracking_links','attribution_touches',
    'order_attributions','payee_accounts','payee_shares',
    'payee_share_reversals','payee_payouts','payee_debts','discount_grants'
  ]) name
  where to_regclass('public.'||name) is null;
  if v_missing is not null then
    raise exception 'B1 missing tables: %',v_missing;
  end if;

  select count(*) into v_count
  from pg_class
  where oid = any(array[
    'public.referral_offers'::regclass,
    'public.referral_offer_listings'::regclass,
    'public.referral_offer_tiers'::regclass,
    'public.referral_members'::regclass,
    'public.host_tracking_links'::regclass,
    'public.attribution_touches'::regclass,
    'public.order_attributions'::regclass,
    'public.payee_accounts'::regclass,
    'public.payee_shares'::regclass,
    'public.payee_share_reversals'::regclass,
    'public.payee_payouts'::regclass,
    'public.payee_debts'::regclass,
    'public.discount_grants'::regclass
  ]) and relrowsecurity and relforcerowsecurity;
  if v_count <> 13 then
    raise exception 'B1 sensitive tables must enable and force RLS, got %',v_count;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='host_tracking_links'
      and column_name='member_id'
  ) then
    raise exception 'B1 host tracking links must never identify a payee';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='attribution_touches'
      and column_name in ('anonymous_id','buyer_email_norm')
  ) then
    raise exception 'B1 attribution touches retained raw visitor identity';
  end if;

  if (select is_enabled from public.feature_flags where flag_key='referrals_enabled')
       is distinct from false then
    raise exception 'B1 referrals global kill switch must default false';
  end if;
  insert into public.program_brand_rollouts(brand_id,program,phase)
  values('38720000-0000-4000-9100-000000000001','referrals','pilot');
  if public.issue_3872_referrals_on('38720000-0000-4000-9100-000000000001') then
    raise exception 'B1 brand rollout bypassed the global kill switch';
  end if;

  select pg_get_functiondef('public.issue_3872_code_namespace_guard()'::regprocedure)
    into v_body;
  if position('pg_advisory_xact_lock' in v_body)=0
     or position('brand_discounts' in v_body)=0
     or position('referral_members' in v_body)=0 then
    raise exception 'B1 code namespace guard lost its shared advisory lock';
  end if;
  select count(*) into v_count
  from pg_trigger
  where not tgisinternal
    and tgrelid = any(array[
      'public.brand_discounts'::regclass,
      'public.referral_members'::regclass
    ])
    and tgfoid='public.issue_3872_code_namespace_guard()'::regprocedure;
  if v_count<>2 then
    raise exception 'B1 code namespace guard must cover both writers, got %',v_count;
  end if;
end;
$test$;

-- An active brand-wide buyer offer collides with an active `both` offer.
insert into public.referral_offers
  (id,brand_id,name,audience,scope_kind,reward_kind,share_bps,currency,status,created_by)
values
  ('38720000-0000-4000-9300-000000000001','38720000-0000-4000-9100-000000000001',
   'Every buyer','buyers','brand','cash',1000,'USD','active',
   '38720000-0000-4000-9000-000000000001');

-- The approved R2 reward contract includes voucher and host-fulfilled perk
-- offers, plus an optional voucher fallback on a cash offer.
insert into public.referral_offers
  (id,brand_id,name,audience,scope_kind,reward_kind,voucher_template,currency,status,created_by)
values
  ('38720000-0000-4000-9300-000000000004','38720000-0000-4000-9100-000000000001',
   'Next-purchase voucher','invited','brand','voucher',
   '{"value_type":"percent","value_bps":1000,"expires_days":30}'::jsonb,
   'USD','draft','38720000-0000-4000-9000-000000000001');
insert into public.referral_offers
  (id,brand_id,name,audience,scope_kind,reward_kind,perk_text,perk_threshold,currency,status,created_by)
values
  ('38720000-0000-4000-9300-000000000005','38720000-0000-4000-9100-000000000001',
   'Door perk','buyers','brand','perk','Free drink',5,'USD','draft',
   '38720000-0000-4000-9000-000000000001');
insert into public.referral_offers
  (id,brand_id,name,audience,scope_kind,reward_kind,share_bps,voucher_template,currency,status,created_by)
values
  ('38720000-0000-4000-9300-000000000006','38720000-0000-4000-9100-000000000001',
   'Cash with rail fallback','buyers','brand','cash',1200,
   '{"value_type":"amount","value_minor":500,"expires_days":30}'::jsonb,
   'USD','draft','38720000-0000-4000-9000-000000000001');
do $test$
begin
  begin
    insert into public.referral_offers
      (brand_id,name,audience,scope_kind,reward_kind,share_bps,currency,status,created_by)
    values
      ('38720000-0000-4000-9100-000000000001','Too small','buyers','brand',
       'cash',99,'USD','draft','38720000-0000-4000-9000-000000000001');
    raise exception 'B1 accepted a cash share below one percent';
  exception when check_violation then null;
  end;
end;
$test$;

do $test$
begin
  begin
    insert into public.referral_offers
      (brand_id,name,audience,scope_kind,reward_kind,share_bps,currency,status,created_by)
    values
      ('38720000-0000-4000-9100-000000000001','Everyone again','both','brand',
       'cash',1200,'USD','active','38720000-0000-4000-9000-000000000001');
    raise exception 'B1 active audience overlap was accepted';
  exception when raise_exception then
    if sqlerrm='B1 active audience overlap was accepted' then raise; end if;
    if sqlerrm<>'offer_overlap' then raise exception 'B1 wrong overlap error: %',sqlerrm; end if;
  end;
end;
$test$;

-- Pausing frees the scope. A `both` listing offer then blocks an invited offer
-- on the same listing, proving buyers/invited overlap is understood.
update public.referral_offers set status='paused',paused_reason='host'
where id='38720000-0000-4000-9300-000000000001';
insert into public.referral_offers
  (id,brand_id,name,audience,scope_kind,reward_kind,share_bps,currency,status,created_by)
values
  ('38720000-0000-4000-9300-000000000002','38720000-0000-4000-9100-000000000001',
   'Listing both','both','listings','cash',1000,'USD','active',
   '38720000-0000-4000-9000-000000000001');
insert into public.referral_offer_listings(offer_id,listing_kind,listing_id)
values('38720000-0000-4000-9300-000000000002','event',
       '38720000-0000-4000-9200-000000000001');
insert into public.referral_offers
  (id,brand_id,name,audience,scope_kind,reward_kind,share_bps,currency,status,created_by)
values
  ('38720000-0000-4000-9300-000000000003','38720000-0000-4000-9100-000000000001',
   'Listing invited','invited','listings','cash',900,'USD','active',
   '38720000-0000-4000-9000-000000000001');
do $test$
begin
  begin
    insert into public.referral_offer_listings(offer_id,listing_kind,listing_id)
    values('38720000-0000-4000-9300-000000000003','event',
           '38720000-0000-4000-9200-000000000001');
    raise exception 'B1 listing overlap was accepted';
  exception when raise_exception then
    if sqlerrm='B1 listing overlap was accepted' then raise; end if;
    if sqlerrm<>'offer_overlap' then raise exception 'B1 wrong listing overlap error: %',sqlerrm; end if;
  end;
end;
$test$;

-- Cash offers accept at most five non-retroactive tiers.
insert into public.referral_offer_tiers(offer_id,min_sales,share_bps)
select '38720000-0000-4000-9300-000000000002',n,n*100
from generate_series(1,5) n;
do $test$
begin
  begin
    insert into public.referral_offer_tiers(offer_id,min_sales,share_bps)
    values('38720000-0000-4000-9300-000000000002',6,600);
    raise exception 'B1 sixth tier was accepted';
  exception when raise_exception then
    if sqlerrm='B1 sixth tier was accepted' then raise; end if;
    if sqlerrm<>'too_many_referral_tiers' then raise exception 'B1 wrong tier error: %',sqlerrm; end if;
  end;
end;
$test$;

-- Discount and member codes share one brand namespace in both directions.
insert into public.brand_discounts
  (id,brand_id,kind,code,name,value_type,value_bps,scope_kind,status,created_by)
values
  ('38720000-0000-4000-9400-000000000001','38720000-0000-4000-9100-000000000001',
   'code','SAVE10','Save ten','percent',1000,'brand','active',
   '38720000-0000-4000-9000-000000000001');
do $test$
begin
  begin
    insert into public.referral_members
      (offer_id,brand_id,role,user_id,display_name,link_slug,code,status)
    values
      ('38720000-0000-4000-9300-000000000002','38720000-0000-4000-9100-000000000001',
       'buyer','38720000-0000-4000-9000-000000000002','Member','memb0001','save10','active');
    raise exception 'B1 discount/member code collision was accepted';
  exception when raise_exception then
    if sqlerrm='B1 discount/member code collision was accepted' then raise; end if;
    if sqlerrm<>'code_taken' then raise exception 'B1 wrong code error: %',sqlerrm; end if;
  end;
end;
$test$;

insert into public.referral_members
  (id,offer_id,brand_id,role,user_id,display_name,link_slug,code,status)
values
  ('38720000-0000-4000-9500-000000000001','38720000-0000-4000-9300-000000000002',
   '38720000-0000-4000-9100-000000000001','buyer',
   '38720000-0000-4000-9000-000000000002','Member','memb0002','member1','active');
do $test$
begin
  if (select code from public.referral_members
      where id='38720000-0000-4000-9500-000000000001')<>'MEMBER1' then
    raise exception 'B1 member code was not normalized';
  end if;
  begin
    insert into public.brand_discounts
      (brand_id,kind,code,name,value_type,value_bps,scope_kind,status,created_by)
    values
      ('38720000-0000-4000-9100-000000000001','code','MEMBER1','Collision',
       'percent',1000,'brand','active','38720000-0000-4000-9000-000000000001');
    raise exception 'B1 member/discount code collision was accepted';
  exception when raise_exception then
    if sqlerrm='B1 member/discount code collision was accepted' then raise; end if;
    if sqlerrm<>'code_taken' then raise exception 'B1 wrong reverse code error: %',sqlerrm; end if;
  end;
end;
$test$;

update public.referral_offers
set buyer_discount_id='38720000-0000-4000-9400-000000000001'
where id='38720000-0000-4000-9300-000000000006';
do $test$
begin
  if (select version from public.referral_offers
      where id='38720000-0000-4000-9300-000000000006')<>2 then
    raise exception 'B1 offer version did not advance on edit';
  end if;
end;
$test$;

-- Invited promoters may reserve a link without a personal code. Email is
-- normalized before the uniqueness constraints run.
insert into public.referral_members
  (id,offer_id,brand_id,role,email_norm,display_name,link_slug,status,
   invited_by,invite_token_hash,invite_expires_at)
values
  ('38720000-0000-4000-9500-000000000002','38720000-0000-4000-9300-000000000002',
   '38720000-0000-4000-9100-000000000001','promoter','PROMOTER@EXAMPLE.TEST',
   'Promoter','invite01','invited','38720000-0000-4000-9000-000000000001',
   repeat('c',64),now()+interval '14 days');
do $test$
begin
  if (select email_norm from public.referral_members
      where id='38720000-0000-4000-9500-000000000002')<>'promoter@example.test' then
    raise exception 'B1 invited promoter email was not normalized';
  end if;
  if (select code from public.referral_members
      where id='38720000-0000-4000-9500-000000000002') is not null then
    raise exception 'B1 personal code was not optional';
  end if;
end;
$test$;

insert into public.host_tracking_links
  (id,brand_id,listing_kind,listing_id,label,slug,created_by)
values
  ('38720000-0000-4000-9550-000000000001','38720000-0000-4000-9100-000000000001',
   'event','38720000-0000-4000-9200-000000000001','Instagram bio','track001',
   '38720000-0000-4000-9000-000000000001');
insert into public.attribution_touches
  (id,kind,member_id,brand_id,listing_kind,listing_id,visitor_key,surface,expires_at)
values
  ('38720000-0000-4000-9560-000000000001','member',
   '38720000-0000-4000-9500-000000000001','38720000-0000-4000-9100-000000000001',
   'event','38720000-0000-4000-9200-000000000001',repeat('a',64),'web',
   now()+interval '30 days');
insert into public.attribution_touches
  (id,kind,tracking_id,brand_id,listing_kind,listing_id,visitor_key,surface,expires_at)
values
  ('38720000-0000-4000-9560-000000000002','tracking',
   '38720000-0000-4000-9550-000000000001','38720000-0000-4000-9100-000000000001',
   'event','38720000-0000-4000-9200-000000000001',repeat('b',64),'explorer_ios',
   now()+interval '30 days');
insert into public.order_attributions
  (order_kind,order_id,brand_id,source,tracking_id,touch_id)
values
  ('ticket','38720000-0000-4000-9600-000000000002',
   '38720000-0000-4000-9100-000000000001','tracking_link',
   '38720000-0000-4000-9550-000000000001',
   '38720000-0000-4000-9560-000000000002');
insert into public.order_attributions(order_kind,order_id,brand_id,source)
values
  ('venue_order','38720000-0000-4000-9600-000000000003',
   '38720000-0000-4000-9100-000000000001','none');

-- Payee money truth: one share per order, exact fee identity, and reversal tally.
insert into public.payee_accounts
  (user_id,stripe_account_id,stripe_status,stripe_country)
values
  ('38720000-0000-4000-9000-000000000002','acct_r2_member','onboarding','US');
update public.payee_accounts
set paystack_recipient_code='RCP_r2_member',paystack_status='verified',
    paystack_country='NG',paystack_currency='NGN',bank_name='Test Bank',
    bank_account_last4='6789'
where user_id='38720000-0000-4000-9000-000000000002';
do $test$
begin
  if (select stripe_country from public.payee_accounts
      where user_id='38720000-0000-4000-9000-000000000002')<>'US'
     or (select paystack_country from public.payee_accounts
         where user_id='38720000-0000-4000-9000-000000000002')<>'NG' then
    raise exception 'B1 payout rails overwrote one another';
  end if;
end;
$test$;
insert into public.order_attributions
  (order_kind,order_id,brand_id,source,touch_id,member_id,offer_id,
   eligible_minor,share_bps,share_minor)
values
  ('ticket','38720000-0000-4000-9600-000000000001',
   '38720000-0000-4000-9100-000000000001','member_link',
   '38720000-0000-4000-9560-000000000001',
   '38720000-0000-4000-9500-000000000001','38720000-0000-4000-9300-000000000002',
   10000,1000,1000);
insert into public.payee_shares
  (id,order_kind,order_id,payee_kind,member_id,payee_user_id,brand_id,rail,currency,
   gross_minor,mingla_fee_minor,net_minor,status,release_after)
values
  ('38720000-0000-4000-9700-000000000001','ticket',
   '38720000-0000-4000-9600-000000000001','referral',
   '38720000-0000-4000-9500-000000000001','38720000-0000-4000-9000-000000000002',
   '38720000-0000-4000-9100-000000000001','stripe','USD',1000,50,950,
   'held_until_event',now()+interval '1 day');
insert into public.payee_share_reversals(share_id,refund_ref,amount_minor)
values('38720000-0000-4000-9700-000000000001','re_test_partial',250);

insert into public.payee_payouts
  (id,payee_user_id,rail,currency,amount_minor,idempotency_key,status,attempt)
values
  ('38720000-0000-4000-9750-000000000001','38720000-0000-4000-9000-000000000002',
   'stripe','USD',700,'payee_share:test:1','in_transit',1);
insert into public.payee_debts
  (payee_user_id,origin_share_id,rail,currency,amount_minor,reason)
values
  ('38720000-0000-4000-9000-000000000002','38720000-0000-4000-9700-000000000001',
   'stripe','USD',100,'refund_after_payout');

insert into public.brand_discounts
  (id,brand_id,kind,code,name,value_type,value_bps,scope_kind,max_total_uses,
   max_uses_per_buyer,status,source,source_ref,created_by)
values
  ('38720000-0000-4000-9400-000000000002','38720000-0000-4000-9100-000000000001',
   'voucher','R2GIFT','Referral voucher','percent',1000,'brand',1,1,'active',
   'referral','38720000-0000-4000-9300-000000000004',
   '38720000-0000-4000-9000-000000000001');
insert into public.discount_grants
  (brand_id,discount_id,member_id,grantee_email_norm,origin_order_kind,
   origin_order_id,expires_at)
values
  ('38720000-0000-4000-9100-000000000001','38720000-0000-4000-9400-000000000002',
   '38720000-0000-4000-9500-000000000002','PROMOTER@EXAMPLE.TEST','venue_order',
   '38720000-0000-4000-9600-000000000003',now()+interval '30 days');

do $test$
begin
  if (select reversed_minor from public.payee_shares
      where id='38720000-0000-4000-9700-000000000001')<>250 then
    raise exception 'B1 reversal tally did not update its share';
  end if;
  if (select grantee_email_norm from public.discount_grants
      where origin_order_id='38720000-0000-4000-9600-000000000003')
      <>'promoter@example.test' then
    raise exception 'B1 voucher grantee email was not normalized';
  end if;
  begin
    insert into public.payee_shares
      (order_kind,order_id,payee_kind,member_id,payee_user_id,brand_id,rail,currency,
       gross_minor,mingla_fee_minor,net_minor,status,release_after)
    values
      ('ticket','38720000-0000-4000-9600-000000000001','referral',
       '38720000-0000-4000-9500-000000000001','38720000-0000-4000-9000-000000000002',
       '38720000-0000-4000-9100-000000000001','stripe','USD',1000,50,950,
       'held_until_event',now()+interval '1 day');
    raise exception 'B1 accepted a second payee share for one order';
  exception when unique_violation then null;
  end;
  begin
    update public.order_attributions set share_minor=0
    where order_kind='ticket' and order_id='38720000-0000-4000-9600-000000000001';
    raise exception 'B1 attribution snapshot was mutable';
  exception when raise_exception then
    if sqlerrm='B1 attribution snapshot was mutable' then raise; end if;
    if sqlerrm<>'order_attributions_immutable' then
      raise exception 'B1 wrong snapshot error: %',sqlerrm;
    end if;
  end;
end;
$test$;

rollback;
