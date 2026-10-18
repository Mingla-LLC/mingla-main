-- toward #3697 Wave 6 — Ads credit apply, FIFO withdraw, idempotency, immutability.
-- [TEST-MOD-APPROVED #3697] v1.4 credit mutations require the brand's verified
-- settlement rail; the historical fixture must establish that authority.
\set ON_ERROR_STOP on
BEGIN;

insert into auth.users (id, email)
values
  ('36970000-0000-4000-c000-000000000001', 'issue3697w6-owner@test.local')
on conflict (id) do nothing;

insert into public.creator_accounts (id, created_at)
values ('36970000-0000-4000-c000-000000000001', now())
on conflict (id) do nothing;

insert into public.brands (
  id, account_id, name, slug, default_currency, payment_provider,
  payment_country, created_at, updated_at
)
values (
  '36970000-0000-4000-c000-000000000010',
  '36970000-0000-4000-c000-000000000001',
  'Issue 3697 Wave6',
  'issue3697wave6credit',
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
  '36970000-0000-4000-c000-000000000010', 'acct_issue3697_w6',
  true, true, 'US', 'USD'
);

insert into public.brand_team_members
  (brand_id, user_id, role, accepted_at, invited_at)
values
  ('36970000-0000-4000-c000-000000000010', '36970000-0000-4000-c000-000000000001',
   'brand_owner', now(), now())
on conflict do nothing;

do $$
declare
  v_brand uuid := '36970000-0000-4000-c000-000000000010';
  v_actor uuid := '36970000-0000-4000-c000-000000000001';
  v_first jsonb;
  v_replay jsonb;
  v_withdraw jsonb;
  v_bal bigint;
  v_refund bigint;
begin
  if to_regprocedure('public.ad_credit_apply(uuid,text,bigint,text,text,bigint,bigint,bigint,uuid,text,uuid,jsonb)') is null then
    raise exception 'ISSUE-3697 W6: ad_credit_apply missing';
  end if;

  -- Odd top-up: floor(2501*0.85)=2125 credit, 376 fee.
  v_first := public.ad_credit_apply(
    v_brand, 'top_up', 2125, 'USD', 'w6-topup-2501-unique',
    376, 2501, null, null, 'pi_test_2501', v_actor, '{}'::jsonb
  );
  if (v_first->>'replayed')::boolean then
    raise exception 'ISSUE-3697 W6: first top-up should not replay';
  end if;
  if (v_first->>'balance_after_cents')::bigint <> 2125 then
    raise exception 'ISSUE-3697 W6: balance after top-up %', v_first;
  end if;

  v_replay := public.ad_credit_apply(
    v_brand, 'top_up', 2125, 'USD', 'w6-topup-2501-unique',
    376, 2501, null, null, 'pi_test_2501', v_actor, '{}'::jsonb
  );
  if not (v_replay->>'replayed')::boolean then
    raise exception 'ISSUE-3697 W6: idempotent replay required';
  end if;
  if (select count(*) from public.ad_credit_ledger where brand_id = v_brand) <> 1 then
    raise exception 'ISSUE-3697 W6: replay must not insert a second ledger row';
  end if;

  v_withdraw := public.ad_credit_apply(
    v_brand, 'withdraw', 2125, 'USD', 'w6-withdraw-all-unique',
    0, null, null, null, null, v_actor, '{}'::jsonb
  );
  v_refund := (v_withdraw->>'refund_cents')::bigint;
  if v_refund <> 2501 then
    raise exception 'ISSUE-3697 W6: FIFO refund must be 2501, got %', v_refund;
  end if;
  select balance_cents into v_bal from public.ad_credit_wallets where brand_id = v_brand;
  if v_bal <> 0 then
    raise exception 'ISSUE-3697 W6: wallet should be empty after full withdraw';
  end if;

  begin
    update public.ad_credit_ledger set fee_cents = 0 where brand_id = v_brand;
    raise exception 'ISSUE-3697 W6: ledger UPDATE should have been rejected';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    delete from public.ad_credit_ledger where brand_id = v_brand;
    raise exception 'ISSUE-3697 W6: ledger DELETE should have been rejected';
  exception when sqlstate '55000' then
    null;
  end;

  raise notice 'ISSUE-3697 Wave 6 ads credit happy OK';
end $$;

ROLLBACK;
