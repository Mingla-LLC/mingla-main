-- toward #3697 Wave 7c — withdraw lot_takes + campaign_spend + brand SELECT host rows.
\set ON_ERROR_STOP on
BEGIN;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

insert into auth.users (id, email, email_confirmed_at)
values
  ('3697c000-0000-4000-c000-000000000001', 'issue3697w7c-owner@test.local', now())
on conflict (id) do nothing;

insert into public.creator_accounts (id, created_at)
values ('3697c000-0000-4000-c000-000000000001', now())
on conflict (id) do nothing;

insert into public.brands (id, account_id, name, slug, created_at, updated_at)
values (
  '3697c000-0000-4000-c000-000000000010',
  '3697c000-0000-4000-c000-000000000001',
  'Issue 3697 Wave7c',
  'issue3697wave7cads',
  now(),
  now()
)
on conflict (id) do nothing;

insert into public.brand_team_members
  (brand_id, user_id, role, accepted_at, invited_at)
values
  ('3697c000-0000-4000-c000-000000000010', '3697c000-0000-4000-c000-000000000001',
   'brand_owner', now(), now())
on conflict do nothing;

do $$
declare
  v_brand uuid := '3697c000-0000-4000-c000-000000000010';
  v_actor uuid := '3697c000-0000-4000-c000-000000000001';
  v_top jsonb;
  v_wd jsonb;
  v_spend jsonb;
  v_takes jsonb;
  v_take_count int;
begin
  if to_regclass('public.ad_credit_provider_refunds') is null then
    raise exception 'ISSUE-3697 W7c: ad_credit_provider_refunds missing';
  end if;

  v_top := public.ad_credit_apply(
    v_brand, 'top_up', 2125, 'USD', 'w7c-topup-unique',
    375, 2500, null, null, 'pi_w7c_test', v_actor, '{}'::jsonb
  );
  if (v_top->>'balance_after_cents')::bigint <> 2125 then
    raise exception 'ISSUE-3697 W7c: top-up balance %', v_top;
  end if;

  v_wd := public.ad_credit_apply(
    v_brand, 'withdraw', 1000, 'USD', 'w7c-withdraw-partial',
    0, null, null, null, null, v_actor, '{}'::jsonb
  );
  v_takes := v_wd->'lot_takes';
  if v_takes is null or jsonb_typeof(v_takes) <> 'array' then
    raise exception 'ISSUE-3697 W7c: lot_takes missing %', v_wd;
  end if;
  v_take_count := jsonb_array_length(v_takes);
  if v_take_count < 1 then
    raise exception 'ISSUE-3697 W7c: expected lot_takes, got %', v_takes;
  end if;
  if (v_takes->0->>'payment_ref') is distinct from 'pi_w7c_test' then
    raise exception 'ISSUE-3697 W7c: payment_ref %', v_takes;
  end if;
  if (v_takes->0->>'provider') is distinct from 'stripe' then
    raise exception 'ISSUE-3697 W7c: provider %', v_takes;
  end if;
  if jsonb_array_length(COALESCE(v_wd->'provider_refunds', '[]'::jsonb)) < 1 then
    raise exception 'ISSUE-3697 W7c: provider_refunds pending rows missing';
  end if;

  -- campaign_spend debit (no lot_takes)
  v_spend := public.ad_credit_apply(
    v_brand, 'campaign_spend', 500, 'USD', 'w7c-campaign-spend',
    0, null, null, null, null, v_actor, '{"source":"test"}'::jsonb
  );
  if (v_spend->>'entry_kind') is distinct from 'campaign_spend' then
    raise exception 'ISSUE-3697 W7c: campaign_spend kind %', v_spend;
  end if;
end $$;

ROLLBACK;
