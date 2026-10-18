-- toward #3697 Wave 6 — adversarial: insufficient credit, bad currency, kind.
-- [TEST-MOD-APPROVED #3697] v1.4 credit mutations require the brand's verified
-- settlement rail; the historical fixture must establish that authority.
\set ON_ERROR_STOP on
BEGIN;

insert into auth.users (id, email)
values
  ('36970000-0000-4000-c000-000000000101', 'issue3697w6-adv@test.local')
on conflict (id) do nothing;

insert into public.creator_accounts (id, created_at)
values ('36970000-0000-4000-c000-000000000101', now())
on conflict (id) do nothing;

insert into public.brands (
  id, account_id, name, slug, default_currency, payment_provider,
  payment_country, created_at, updated_at
)
values (
  '36970000-0000-4000-c000-000000000110',
  '36970000-0000-4000-c000-000000000101',
  'Issue 3697 Wave6 Adv',
  'issue3697wave6adv',
  'USD',
  'stripe',
  'US',
  now(),
  now()
)
on conflict (id) do nothing;

insert into public.stripe_connect_accounts (
  brand_id, stripe_account_id, charges_enabled, payouts_enabled,
  country, default_currency
) values (
  '36970000-0000-4000-c000-000000000110', 'acct_issue3697_w6_adv',
  true, true, 'US', 'USD'
);

do $$
declare
  v_brand uuid := '36970000-0000-4000-c000-000000000110';
  v_actor uuid := '36970000-0000-4000-c000-000000000101';
begin
  perform public.ad_credit_apply(
    v_brand, 'top_up', 8500, 'USD', 'w6-adv-topup',
    1500, 10000, null, null, 'pi_adv', v_actor, '{}'::jsonb
  );

  begin
    perform public.ad_credit_apply(
      v_brand, 'withdraw', 9000, 'USD', 'w6-adv-overdraw',
      0, null, null, null, null, v_actor, '{}'::jsonb
    );
    raise exception 'ISSUE-3697 W6 adv: overdraw should fail';
  exception when sqlstate 'P0001' then
    null;
  end;

  begin
    perform public.ad_credit_apply(
      v_brand, 'top_up', 8500, 'JPY', 'w6-adv-jpy',
      1500, 10000, null, null, 'pi_jpy', v_actor, '{}'::jsonb
    );
    raise exception 'ISSUE-3697 W6 adv: unsupported currency should fail';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform public.ad_credit_apply(
      v_brand, 'campaign_hold', 100, 'USD', 'w6-adv-hold',
      0, null, null, null, null, v_actor, '{}'::jsonb
    );
    raise exception 'ISSUE-3697 W6 adv: campaign_hold must be refused this wave';
  exception when sqlstate '22023' then
    null;
  end;

  if (select balance_cents from public.ad_credit_wallets where brand_id = v_brand) <> 8500 then
    raise exception 'ISSUE-3697 W6 adv: balance corrupted by refused applies';
  end if;

  raise notice 'ISSUE-3697 Wave 6 ads credit adversarial OK';
end $$;

ROLLBACK;
