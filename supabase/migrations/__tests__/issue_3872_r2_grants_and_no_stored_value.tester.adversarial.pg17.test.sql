-- Issue #3872 R2 B1: least privilege and I-3872-NO-STORED-VALUE.
-- MINGLA-INVARIANT: I-3872-NO-STORED-VALUE | issue #3872 | Referral rewards are automatic payout obligations, vouchers or perks; no user balance, cash-out or withdrawal rail exists.
\set ON_ERROR_STOP on
begin;

do $test$
declare
  v_table text;
  v_bad text;
begin
  foreach v_table in array array[
    'referral_offers','referral_offer_listings','referral_offer_tiers',
    'referral_members','host_tracking_links','attribution_touches',
    'order_attributions','payee_accounts','payee_shares',
    'payee_share_reversals','payee_payouts','payee_debts','discount_grants'
  ] loop
    if to_regclass('public.'||v_table) is null then
      raise exception 'B1 missing table for privilege proof: %',v_table;
    end if;
    if has_table_privilege('anon',format('public.%I',v_table),'SELECT')
       or has_table_privilege('anon',format('public.%I',v_table),'INSERT') then
      raise exception 'B1 anon privilege leak on %',v_table;
    end if;
    if has_table_privilege('authenticated',format('public.%I',v_table),'INSERT')
       or has_table_privilege('authenticated',format('public.%I',v_table),'UPDATE')
       or has_table_privilege('authenticated',format('public.%I',v_table),'DELETE') then
      raise exception 'B1 authenticated mutation privilege leak on %',v_table;
    end if;
    if not has_table_privilege('service_role',format('public.%I',v_table),'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'B1 service role missing table authority on %',v_table;
    end if;
  end loop;

  if has_function_privilege('anon','public.issue_3872_referrals_on(uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.issue_3872_referrals_on(uuid)','EXECUTE')
     or not has_function_privilege('service_role','public.issue_3872_referrals_on(uuid)','EXECUTE') then
    raise exception 'B1 referrals-on function grants widened';
  end if;
  if has_function_privilege('authenticated','public.issue_3872_code_namespace_guard()','EXECUTE')
     or has_function_privilege('anon','public.issue_3872_code_namespace_guard()','EXECUTE') then
    raise exception 'B1 internal code guard is directly executable';
  end if;

  -- I-3872-NO-STORED-VALUE: automatic payouts may have transfer amounts and
  -- debts, but no user balance, stored credit, or withdrawal surface exists.
  select string_agg(table_name||'.'||column_name,', ' order by table_name,column_name)
    into v_bad
  from information_schema.columns
  where table_schema='public'
    and table_name in (
      'payee_accounts','payee_shares','payee_share_reversals','payee_payouts',
      'payee_debts','discount_grants'
    )
    and column_name ~ '(^|_)(balance|stored_value|withdraw|withdrawal|withdrawable)($|_)';
  if v_bad is not null then
    raise exception 'I-3872-NO-STORED-VALUE forbidden columns: %',v_bad;
  end if;
  select string_agg(p.proname,', ' order by p.proname) into v_bad
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname ~ '(withdraw|cashout)'
    and (p.proname like '%payee%' or p.proname like '%referral%');
  if v_bad is not null then
    raise exception 'I-3872-NO-STORED-VALUE forbidden functions: %',v_bad;
  end if;
end;
$test$;

insert into auth.users(id,email) values
  ('38720000-0000-4000-9800-000000000001','r2-payee@test.local'),
  ('38720000-0000-4000-9800-000000000002','r2-other@test.local')
on conflict(id) do nothing;
insert into public.payee_accounts(user_id,stripe_account_id,stripe_status,stripe_country)
values('38720000-0000-4000-9800-000000000001','acct_r2_rls','onboarding','US');

set local role authenticated;
select set_config('request.jwt.claim.sub','38720000-0000-4000-9800-000000000001',true);
select set_config('request.jwt.claims','{"sub":"38720000-0000-4000-9800-000000000001","role":"authenticated"}',true);
do $test$
begin
  if (select count(*) from public.payee_accounts)<>1 then
    raise exception 'B1 payout-account owner cannot read own row';
  end if;
  begin
    update public.payee_accounts set stripe_country='GB'
    where user_id='38720000-0000-4000-9800-000000000001';
    raise exception 'B1 owner directly mutated provider truth';
  exception when insufficient_privilege then null;
  end;
end;
$test$;

select set_config('request.jwt.claim.sub','38720000-0000-4000-9800-000000000002',true);
select set_config('request.jwt.claims','{"sub":"38720000-0000-4000-9800-000000000002","role":"authenticated"}',true);
do $test$
begin
  if (select count(*) from public.payee_accounts)<>0 then
    raise exception 'B1 another user read payout-account provider truth';
  end if;
end;
$test$;
reset role;

rollback;
