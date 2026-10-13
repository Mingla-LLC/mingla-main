-- toward #3697 Wave 7c — non-member cannot SELECT host ad_campaigns; withdraw without PI refuses.
\set ON_ERROR_STOP on
BEGIN;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

insert into auth.users (id, email, email_confirmed_at)
values
  ('3697c100-0000-4000-c000-000000000001', 'issue3697w7c-a@test.local', now()),
  ('3697c100-0000-4000-c000-000000000002', 'issue3697w7c-b@test.local', now())
on conflict (id) do nothing;

insert into public.creator_accounts (id, created_at)
values
  ('3697c100-0000-4000-c000-000000000001', now()),
  ('3697c100-0000-4000-c000-000000000002', now())
on conflict (id) do nothing;

insert into public.brands (id, account_id, name, slug, created_at, updated_at)
values (
  '3697c100-0000-4000-c000-000000000010',
  '3697c100-0000-4000-c000-000000000001',
  'Issue 3697 Wave7c Adv',
  'issue3697wave7cadv',
  now(),
  now()
)
on conflict (id) do nothing;

insert into public.brand_team_members
  (brand_id, user_id, role, accepted_at, invited_at)
values
  ('3697c100-0000-4000-c000-000000000010', '3697c100-0000-4000-c000-000000000001',
   'brand_owner', now(), now())
on conflict do nothing;

insert into public.ad_connections (
  id, platform, lane, display_name, external_account_id, auth_kind, token_env_var
)
values (
  '3697c100-0000-4000-c000-000000000020',
  'reddit',
  'business',
  'W7c Adv Reddit',
  'w7c_adv_acct',
  'refresh_token',
  'REDDIT_ADS_TOKEN_W7C_ADV'
)
on conflict (id) do nothing;

insert into public.ad_campaigns (
  id, connection_id, platform, external_campaign_id, name, objective, status,
  dest_page_type, dest_brand_slug, dest_url, dest_smart_link,
  brand_id, owner_kind, created_by
) values (
  '3697c100-0000-4000-c000-000000000030',
  '3697c100-0000-4000-c000-000000000020',
  'reddit',
  'host_adv_w7c',
  'Host Adv',
  'CLICKS',
  'PAUSED',
  'brand',
  'issue3697wave7cadv',
  'https://usemingla.com/b/issue3697wave7cadv',
  'https://usemingla.com/b/issue3697wave7cadv',
  '3697c100-0000-4000-c000-000000000010',
  'host',
  '3697c100-0000-4000-c000-000000000001'
)
on conflict (id) do nothing;

-- Owner can read host row under RLS.
set local role authenticated;
select set_config('request.jwt.claim.sub', '3697c100-0000-4000-c000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare
  v_seen int;
begin
  select count(*) into v_seen
  from public.ad_campaigns
  where id = '3697c100-0000-4000-c000-000000000030' and owner_kind = 'host';
  if v_seen < 1 then
    raise exception 'ISSUE-3697 W7c adv: owner should SELECT host campaign';
  end if;
end $$;

-- Stranger cannot see it.
select set_config('request.jwt.claim.sub', '3697c100-0000-4000-c000-000000000002', true);

do $$
declare
  v_seen int;
begin
  select count(*) into v_seen
  from public.ad_campaigns
  where id = '3697c100-0000-4000-c000-000000000030' and owner_kind = 'host';
  if v_seen <> 0 then
    raise exception 'ISSUE-3697 W7c adv: non-member must not SELECT host campaign';
  end if;
end $$;

reset role;

-- Top-up without external_ref then withdraw must fail closed (service_role RPC).
do $$
declare
  v_brand uuid := '3697c100-0000-4000-c000-000000000010';
  v_actor uuid := '3697c100-0000-4000-c000-000000000001';
begin
  perform public.ad_credit_apply(
    v_brand, 'top_up', 850, 'USD', 'w7c-adv-topup-noref',
    150, 1000, null, null, null, v_actor, '{}'::jsonb
  );
  begin
    perform public.ad_credit_apply(
      v_brand, 'withdraw', 850, 'USD', 'w7c-adv-wd-noref',
      0, null, null, null, null, v_actor, '{}'::jsonb
    );
    raise exception 'ISSUE-3697 W7c adv: withdraw without PI should fail';
  exception
    when others then
      if sqlerrm not like '%ad_credit_lot_missing_payment_ref%'
         and sqlerrm not like '%ad_credit_lot_payment_ref_unsupported%' then
        raise;
      end if;
  end;
end $$;

ROLLBACK;
