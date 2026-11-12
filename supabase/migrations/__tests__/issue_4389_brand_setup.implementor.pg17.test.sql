-- Issue #4389 — brand setup with the minimum information
-- (20280629004389_issue_4389_brand_setup.sql and
--  20280629104389_issue_4389_ari_brand_operation.sql), on the fully replayed
-- PG17 schema.
-- MINGLA-INVARIANT: I-4389-COUNTRY-ONE-TRUTH | issue #4389 | default_currency, payment_provider and payment_country follow brands.payout_country (rail map, BG->EUR); the country locks once a payment account exists or a payments setup started in the last 15 minutes.
-- MINGLA-INVARIANT: I-4389-SETUP-DONE-IS-SERVER | issue #4389 | brand_readiness(brand_setup) is exactly brand.name, money.market, money.terms_member, money.details_submitted, routed to /brand/{id}/setup?step=.
--
--   T1  derive: DE -> EUR/stripe, BG -> EUR, NG -> NGN/paystack/payment_country NG,
--       NG -> GB clears payment_country; an unknown country is refused (22023)
--   T2  a scanner cannot set the bank country (42501)
--   T3  lock: undetached Stripe account -> PT409; Paystack subaccount -> PT409;
--       payments setup stamped < 15 min ago -> PT409; > 15 min ago -> allowed (R-3)
--   T4  biz_begin_payments_setup: country required, terms required, owner only,
--       stamps payments_setup_started_at
--   T5  biz_create_setup_brand: same id twice = one brand (R-1); an old-build
--       INSERT with no bank country still works; a second brand
--       while a draft exists -> draft_exists; free-only lifts the draft; slug taken
--   T6  readiness brand_setup: exactly 4 items in order, routes, states through
--       country -> terms -> Stripe submitted; currently_due flips it back (S-h)
--   T7  partner client mode: money items carry waiting_for
--   T8  delete guard: direct soft delete with a Stripe account -> PT409; without
--       -> allowed; finish RPC closes rows, audits, is idempotent; discard_draft
--       refuses a non-draft (not_a_draft)
--   T9  VAT: vat_country_missing for a Paystack brand with no payment_country
--   T10 Tap to Pay fallback address: US needs state + ZIP; GB normalises the
--       postcode; another country than the bank country is refused
--   T11 Ari create_brand: bank country at create, operation id = brand id,
--       re-confirm returns the same brand, unsupported country refused
--
-- FAILS-ON-REVERT: replay without 20280629004389 -> payout_country_rail is
-- missing and T1 stops. Dropping the lock block in
-- issue_4389_brand_country_derive fails T3; dropping the guard trigger fails T8;
-- dropping the brand_setup CONTINUE filter fails T6 (item count).
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

update cron.job set active = false where active;

create temp table t4389_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t4389_people values
  ('owner',   '43890000-0000-4000-a000-000000000001', 'owner.c4389@test.local'),
  ('admin',   '43890000-0000-4000-a000-000000000002', 'admin.c4389@test.local'),
  ('scanner', '43890000-0000-4000-a000-000000000003', 'scan.c4389@test.local'),
  ('host2',   '43890000-0000-4000-a000-000000000004', 'host2.c4389@test.local'),
  ('partner', '43890000-0000-4000-a000-000000000005', 'partner.c4389@test.local');
insert into auth.users (id, email) select id, email from t4389_people;
insert into public.creator_accounts (id, created_at) select id, now() from t4389_people;

create function pg_temp.uid(p_who text) returns uuid
language sql as $fn$ select id from t4389_people where who = p_who; $fn$;
create function pg_temp.act(p_who text) returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.uid(p_who)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(p_who), 'role', 'authenticated')::text, true);
end;
$fn$;
create function pg_temp.err(p_sql text) returns text
language plpgsql as $fn$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$fn$;
create function pg_temp.expect(p_label text, p_ok boolean, p_detail text default null) returns void
language plpgsql as $fn$
begin
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'FAIL %: %', p_label, COALESCE(p_detail, '');
  END IF;
  RAISE NOTICE 'PASS %', p_label;
end;
$fn$;
create function pg_temp.accept_terms(p_brand uuid, p_user uuid) returns void
language sql as $fn$
  update public.brand_team_members
  set mingla_tos_accepted_at = now(), mingla_tos_version_accepted = '1.0'
  where brand_id = p_brand and user_id = p_user;
$fn$;

-- Fixture brand A (owner), with an admin and a scanner.
insert into public.brands (id, account_id, name, slug)
values ('43890000-0000-4000-b000-000000000001', pg_temp.uid('owner'), 'Issue 4389 A', 'issue4389a');
insert into public.brand_team_members (brand_id, user_id, role, accepted_at, invited_at) values
  ('43890000-0000-4000-b000-000000000001', pg_temp.uid('admin'), 'brand_admin', now(), now()),
  ('43890000-0000-4000-b000-000000000001', pg_temp.uid('scanner'), 'scanner', now(), now())
on conflict do nothing;
update public.brand_team_members set accepted_at = coalesce(accepted_at, now()), removed_at = null
where brand_id = '43890000-0000-4000-b000-000000000001';

-- ── T1 derive ──────────────────────────────────────────────────────────────
do $t$
declare v jsonb; b public.brands%rowtype; c text;
begin
  perform pg_temp.act('admin');
  v := public.biz_set_brand_payout_country('43890000-0000-4000-b000-000000000001', 'de');
  select * into b from public.brands where id = '43890000-0000-4000-b000-000000000001';
  perform pg_temp.expect('T1 DE->EUR/stripe', b.payout_country = 'DE' and btrim(b.default_currency) = 'EUR'
    and b.payment_provider = 'stripe' and b.payment_country is null and b.pricing_currency = 'EUR', v::text);
  perform public.biz_set_brand_payout_country('43890000-0000-4000-b000-000000000001', 'BG');
  select * into b from public.brands where id = '43890000-0000-4000-b000-000000000001';
  perform pg_temp.expect('T1 BG->EUR', btrim(b.default_currency) = 'EUR');
  perform public.biz_set_brand_payout_country('43890000-0000-4000-b000-000000000001', 'NG');
  select * into b from public.brands where id = '43890000-0000-4000-b000-000000000001';
  perform pg_temp.expect('T1 NG->NGN/paystack', btrim(b.default_currency) = 'NGN'
    and b.payment_provider = 'paystack' and b.payment_country = 'NG');
  perform public.biz_set_brand_payout_country('43890000-0000-4000-b000-000000000001', 'GB');
  select * into b from public.brands where id = '43890000-0000-4000-b000-000000000001';
  perform pg_temp.expect('T1 NG->GB clears payment_country', btrim(b.default_currency) = 'GBP'
    and b.payment_provider = 'stripe' and b.payment_country is null and b.pricing_region = 'GB');
  c := pg_temp.err($$select public.biz_set_brand_payout_country('43890000-0000-4000-b000-000000000001','ZZ')$$);
  perform pg_temp.expect('T1 unknown country refused', c like '22023 payout_country_unsupported%', c);
  -- A direct write of payout_country derives too (old builds).
  update public.brands set payout_country = 'US' where id = '43890000-0000-4000-b000-000000000001';
  select * into b from public.brands where id = '43890000-0000-4000-b000-000000000001';
  perform pg_temp.expect('T1 direct write derives', btrim(b.default_currency) = 'USD');
end;
$t$;

-- ── T2 forbidden ───────────────────────────────────────────────────────────
do $t$
declare c text;
begin
  perform pg_temp.act('scanner');
  c := pg_temp.err($$select public.biz_set_brand_payout_country('43890000-0000-4000-b000-000000000001','GB')$$);
  perform pg_temp.expect('T2 scanner forbidden', c like '42501 forbidden%', c);
end;
$t$;

-- ── T3 lock ────────────────────────────────────────────────────────────────
do $t$
declare c text;
begin
  perform pg_temp.act('owner');
  insert into public.stripe_connect_accounts (brand_id, stripe_account_id, country, default_currency, requirements)
  values ('43890000-0000-4000-b000-000000000001', 'acct_test4389a', 'US', 'USD', '{}');
  c := pg_temp.err($$select public.biz_set_brand_payout_country('43890000-0000-4000-b000-000000000001','GB')$$);
  perform pg_temp.expect('T3 account locks country', c like 'PT409 payout_country_locked%', c);
  update public.stripe_connect_accounts set detached_at = now() where stripe_account_id = 'acct_test4389a';
  c := pg_temp.err($$select public.biz_set_brand_payout_country('43890000-0000-4000-b000-000000000001','GB')$$);
  perform pg_temp.expect('T3 detached account unlocks', c = 'ok', c);
  update public.brands set payments_setup_started_at = now() - interval '2 minutes'
  where id = '43890000-0000-4000-b000-000000000001';
  c := pg_temp.err($$select public.biz_set_brand_payout_country('43890000-0000-4000-b000-000000000001','US')$$);
  perform pg_temp.expect('T3 setup window locks (R-2)', c like 'PT409 payout_country_locked%', c);
  update public.brands set payments_setup_started_at = now() - interval '16 minutes'
  where id = '43890000-0000-4000-b000-000000000001';
  c := pg_temp.err($$select public.biz_set_brand_payout_country('43890000-0000-4000-b000-000000000001','US')$$);
  perform pg_temp.expect('T3 window expires (R-3)', c = 'ok', c);
  update public.brands set paystack_subaccount_code = 'ACCT_4389'
  where id = '43890000-0000-4000-b000-000000000001';
  c := pg_temp.err($$select public.biz_set_brand_payout_country('43890000-0000-4000-b000-000000000001','GB')$$);
  perform pg_temp.expect('T3 Paystack subaccount locks', c like 'PT409 payout_country_locked%', c);
  update public.brands set paystack_subaccount_code = null, payments_setup_started_at = null
  where id = '43890000-0000-4000-b000-000000000001';
end;
$t$;

-- ── T4 begin payments setup ────────────────────────────────────────────────
insert into public.brands (id, account_id, name, slug)
values ('43890000-0000-4000-b000-000000000002', pg_temp.uid('host2'), 'Issue 4389 B', 'issue4389b');
update public.brand_team_members set accepted_at = coalesce(accepted_at, now())
where brand_id = '43890000-0000-4000-b000-000000000002';
do $t$
declare c text; v jsonb;
begin
  perform pg_temp.act('host2');
  c := pg_temp.err($$select public.biz_begin_payments_setup('43890000-0000-4000-b000-000000000002')$$);
  perform pg_temp.expect('T4 country required', c like '22023 payout_country_required%', c);
  perform public.biz_set_brand_payout_country('43890000-0000-4000-b000-000000000002', 'NG');
  c := pg_temp.err($$select public.biz_begin_payments_setup('43890000-0000-4000-b000-000000000002')$$);
  perform pg_temp.expect('T4 terms required', c like '22023 terms_required%', c);
  perform pg_temp.accept_terms('43890000-0000-4000-b000-000000000002', pg_temp.uid('host2'));
  v := public.biz_begin_payments_setup('43890000-0000-4000-b000-000000000002');
  perform pg_temp.expect('T4 returns provider', v->>'provider' = 'paystack' and v->>'payout_country' = 'NG', v::text);
  perform pg_temp.expect('T4 stamped', (select payments_setup_started_at > now() - interval '1 minute'
    from public.brands where id = '43890000-0000-4000-b000-000000000002'));
  perform pg_temp.act('admin');
  c := pg_temp.err($$select public.biz_begin_payments_setup('43890000-0000-4000-b000-000000000001')$$);
  perform pg_temp.expect('T4 admin is not owner', c like '42501 requires_owner%', c);
end;
$t$;

-- ── T5 idempotent create + one draft ───────────────────────────────────────
do $t$
declare v jsonb; n int;
begin
  perform pg_temp.act('partner');
  v := public.biz_create_setup_brand('43890000-0000-4000-b000-000000000010', 'Night Owl', 'night-owl-4389');
  perform pg_temp.expect('T5 created', (v->>'ok')::boolean and (v->>'created')::boolean, v::text);
  v := public.biz_create_setup_brand('43890000-0000-4000-b000-000000000010', 'Night Owl', 'night-owl-4389');
  perform pg_temp.expect('T5 retry same id = same brand', (v->>'ok')::boolean and not (v->>'created')::boolean, v::text);
  select count(*) into n from public.brands where account_id = pg_temp.uid('partner');
  perform pg_temp.expect('T5 one row', n = 1, n::text);
  v := public.biz_create_setup_brand('43890000-0000-4000-b000-000000000011', 'Second', 'second-4389');
  perform pg_temp.expect('T5 draft_exists', v->>'error' = 'draft_exists'
    and v->>'brand_id' = '43890000-0000-4000-b000-000000000010', v::text);
  -- Old app builds: a plain INSERT with no payout_country still works while a
  -- draft exists (the one-draft rule is not a DB constraint).
  set local role authenticated;
  insert into public.brands (account_id, name, slug)
  values ('43890000-0000-4000-a000-000000000005', 'Old build brand', 'old-build-4389');
  reset role;
  perform pg_temp.expect('T5 old-shape INSERT allowed', exists (
    select 1 from public.brands where slug = 'old-build-4389' and payout_country is null));
  update public.brands set setup_free_only_at = now() where slug = 'old-build-4389';
  perform public.biz_mark_brand_setup_free_only('43890000-0000-4000-b000-000000000010');
  v := public.biz_create_setup_brand('43890000-0000-4000-b000-000000000011', 'Second', 'issue4389a');
  perform pg_temp.expect('T5 slug taken', v->>'error' = 'slug_taken', v::text);
  v := public.biz_create_setup_brand('43890000-0000-4000-b000-000000000011', 'Second', 'second-4389', true);
  perform pg_temp.expect('T5 free-only lifts the draft', (v->>'ok')::boolean, v::text);
end;
$t$;

-- ── T6 readiness brand_setup ───────────────────────────────────────────────
do $t$
declare v jsonb; keys text;
begin
  perform pg_temp.act('host2');
  insert into public.brands (id, account_id, name, slug)
  values ('43890000-0000-4000-b000-000000000020', pg_temp.uid('owner'), 'Issue 4389 C', 'issue4389c');
  update public.brand_team_members set accepted_at = coalesce(accepted_at, now())
  where brand_id = '43890000-0000-4000-b000-000000000020';
  perform pg_temp.act('owner');
  v := public.brand_readiness('43890000-0000-4000-b000-000000000020', 'brand_setup');
  select string_agg(i->>'key', ',' order by o) into keys
  from jsonb_array_elements(v->'items') with ordinality t(i, o);
  perform pg_temp.expect('T6 exactly 4 items in order',
    keys = 'brand.name,money.market,money.terms_member,money.details_submitted', keys);
  perform pg_temp.expect('T6 routes', v->'items'->1->'fix'->>'route'
    = '/brand/43890000-0000-4000-b000-000000000020/setup?step=country'
    and v->'items'->0->'fix'->>'route' like '%/setup?step=name'
    and v->'items'->3->'fix'->>'route' like '%/setup?step=pay', v::text);
  perform pg_temp.expect('T6 fresh: 1 done, 3 blocking', (v->'counts'->>'done')::int = 1
    and (v->'counts'->>'blocking')::int = 3 and not (v->>'can_proceed')::boolean, v->>'counts');
  perform public.biz_set_brand_payout_country('43890000-0000-4000-b000-000000000020', 'US');
  perform pg_temp.accept_terms('43890000-0000-4000-b000-000000000020', pg_temp.uid('owner'));
  insert into public.stripe_connect_accounts (brand_id, stripe_account_id, country, default_currency, requirements)
  values ('43890000-0000-4000-b000-000000000020', 'acct_test4389c', 'US', 'USD', '{}');
  v := public.brand_readiness('43890000-0000-4000-b000-000000000020', 'brand_setup');
  perform pg_temp.expect('T6 fresh account is only started', v->'items'->3->>'state' = 'missing'
    and v->'setup'->>'stripe_state' = 'started', v->>'setup');
  update public.stripe_connect_accounts
  set requirements = '{"currently_due":[],"past_due":[],"pending_verification":["individual.id_number"]}'
  where stripe_account_id = 'acct_test4389c';
  v := public.brand_readiness('43890000-0000-4000-b000-000000000020', 'brand_setup');
  perform pg_temp.expect('T6 pending verification = done', (v->>'can_proceed')::boolean
    and (v->'counts'->>'done')::int = 4, v->>'counts');
  perform pg_temp.expect('T6 setup facts complete', (v->'setup'->>'complete')::boolean
    and not (v->'setup'->>'is_draft')::boolean);
  update public.stripe_connect_accounts
  set requirements = '{"currently_due":["individual.verification.document"],"past_due":[]}'
  where stripe_account_id = 'acct_test4389c';
  v := public.brand_readiness('43890000-0000-4000-b000-000000000020', 'brand_setup');
  perform pg_temp.expect('T6 more asked later flips back (S-h)', not (v->>'can_proceed')::boolean
    and v->'setup'->>'stripe_state' = 'action_needed'
    and v->'setup'->'due' ? 'individual.verification.document', v->>'setup');
  -- Other actions keep their old item list (no brand.name / details row).
  v := public.brand_readiness('43890000-0000-4000-b000-000000000020', 'publish_paid');
  perform pg_temp.expect('T6 other actions unchanged', not exists (
    select 1 from jsonb_array_elements(v->'items') i
    where i->>'key' in ('brand.name','money.details_submitted')));
end;
$t$;

-- ── T7 partner client mode ─────────────────────────────────────────────────
do $t$
declare v jsonb;
begin
  insert into public.partner_brand_links (partner_account_id, brand_id, invited_owner_email)
  values (pg_temp.uid('partner'), '43890000-0000-4000-b000-000000000011', 'client@test.local');
  perform pg_temp.act('partner');
  v := public.brand_readiness('43890000-0000-4000-b000-000000000011', 'brand_setup');
  perform pg_temp.expect('T7 waiting for client', v->'items'->2->>'waiting_for' = 'client@test.local'
    and v->'items'->3->>'waiting_for' = 'client@test.local'
    and v->'items'->1->'waiting_for' = 'null'::jsonb, v::text);
end;
$t$;

-- ── T8 delete ──────────────────────────────────────────────────────────────
do $t$
declare c text; v jsonb;
begin
  -- Brand C has an undetached Stripe account (T6).
  perform pg_temp.act('owner');
  set local role authenticated;
  c := pg_temp.err($$update public.brands set deleted_at = now() where id = '43890000-0000-4000-b000-000000000020'$$);
  reset role;
  perform pg_temp.expect('T8 direct delete with account refused', c like 'PT409 delete_requires_provider_close%', c);
  v := public.biz_brand_deletion_blockers('43890000-0000-4000-b000-000000000020');
  perform pg_temp.expect('T8 preview names providers, not ids', (v->'providers'->>'stripe')::boolean
    and position('acct_' in v::text) = 0, v::text);
  -- Setup finished again -> no longer a draft.
  update public.stripe_connect_accounts set requirements = '{"currently_due":[],"past_due":[]}'
  where stripe_account_id = 'acct_test4389c';
  c := pg_temp.err($$select public.issue_4389_finish_brand_delete('43890000-0000-4000-b000-000000000020','43890000-0000-4000-a000-000000000001','discard_draft')$$);
  perform pg_temp.expect('T8 discard refuses a non-draft', c like 'PT409 not_a_draft%', c);
  v := public.issue_4389_finish_brand_delete('43890000-0000-4000-b000-000000000020', pg_temp.uid('owner'));
  perform pg_temp.expect('T8 finish closes', v->>'stripe' = 'closed' and exists (
    select 1 from public.brands where id = '43890000-0000-4000-b000-000000000020' and deleted_at is not null)
    and not exists (select 1 from public.stripe_connect_accounts
      where brand_id = '43890000-0000-4000-b000-000000000020' and detached_at is null)
    and exists (select 1 from public.audit_log where brand_id = '43890000-0000-4000-b000-000000000020'
      and action = 'brand.deleted_with_providers'), v::text);
  v := public.issue_4389_finish_brand_delete('43890000-0000-4000-b000-000000000020', pg_temp.uid('owner'));
  perform pg_temp.expect('T8 idempotent (R-11)', (v->>'already_deleted')::boolean, v::text);
  -- No payment account: today's direct delete still works (old builds).
  perform pg_temp.act('partner');
  set local role authenticated;
  c := pg_temp.err($$update public.brands set deleted_at = now() where id = '43890000-0000-4000-b000-000000000010'$$);
  reset role;
  perform pg_temp.expect('T8 no account: direct delete allowed', c = 'ok', c);
  -- Draft discard path.
  v := public.issue_4389_finish_brand_delete('43890000-0000-4000-b000-000000000011', pg_temp.uid('partner'), 'discard_draft');
  perform pg_temp.expect('T8 discard a draft', (v->>'ok')::boolean and v->>'stripe' = 'none', v::text);
end;
$t$;

-- ── T9 VAT fail-closed ─────────────────────────────────────────────────────
do $t$
declare r record;
begin
  insert into public.events (id, brand_id, title, slug)
  values ('43890000-0000-4000-e000-000000000001', '43890000-0000-4000-b000-000000000002', 'NG night', 'ng-night-4389');
  update public.brands set payment_country = null where id = '43890000-0000-4000-b000-000000000002';
  select * into r from public.resolve_event_pricing_inputs('43890000-0000-4000-e000-000000000001');
  perform pg_temp.expect('T9 vat_country_missing', r.payment_provider = 'paystack' and r.vat_country_missing);
  update public.brands set payment_country = 'NG' where id = '43890000-0000-4000-b000-000000000002';
  select * into r from public.resolve_event_pricing_inputs('43890000-0000-4000-e000-000000000001');
  perform pg_temp.expect('T9 NG has VAT country', not r.vat_country_missing);
end;
$t$;

-- ── T10 Tap to Pay fallback address ────────────────────────────────────────
do $t$
declare c text; v jsonb;
begin
  perform pg_temp.act('owner');
  c := pg_temp.err($$select public.biz_set_tap_location_address('43890000-0000-4000-b000-000000000001',
    '{"line1":"1520 N Milwaukee Ave","city":"Chicago","country":"US","postal_code":"60622"}')$$);
  perform pg_temp.expect('T10 US needs a state', c like '22023 invalid_address%', c);
  c := pg_temp.err($$select public.biz_set_tap_location_address('43890000-0000-4000-b000-000000000001',
    '{"line1":"N Milwaukee Ave","city":"Chicago","state":"IL","country":"US","postal_code":"60622"}')$$);
  perform pg_temp.expect('T10 needs a building number', c like '22023 invalid_address%', c);
  v := public.biz_set_tap_location_address('43890000-0000-4000-b000-000000000001',
    '{"line1":"1520 N Milwaukee Ave","city":"Chicago","state":"il","country":"US","postal_code":"60622"}');
  perform pg_temp.expect('T10 US saved', v->'tap_location_address'->>'state' = 'IL', v::text);
  c := pg_temp.err($$select public.biz_set_tap_location_address('43890000-0000-4000-b000-000000000001',
    '{"line1":"14 Redchurch Street","city":"London","country":"GB","postal_code":"e27dj"}')$$);
  perform pg_temp.expect('T10 other country refused', c like '22023 address_country_mismatch%', c);
end;
$t$;

-- ── T11 Ari create_brand ───────────────────────────────────────────────────
do $t$
declare v jsonb; c text; args jsonb := '{"name":"Lekki Lights","payout_country":"NG"}';
begin
  insert into public.agent_pending_actions (id, user_id, tool_name, tool_args, source, status,
    server_proposed_at, execution_attested_at)
  values ('43890000-0000-4000-c000-000000000001', pg_temp.uid('admin'), 'create_brand', args,
    'hub_experience', 'executing', now(), now());
  perform pg_temp.act('admin');
  v := public.ari_execute_brand_operation('43890000-0000-4000-c000-000000000001', 'create_brand', args);
  perform pg_temp.expect('T11 brand id = operation id, NG rail', v->'brand'->>'id' = '43890000-0000-4000-c000-000000000001'
    and v->'brand'->>'payout_country' = 'NG' and v->'brand'->>'payment_provider' = 'paystack', v::text);
  v := public.ari_execute_brand_operation('43890000-0000-4000-c000-000000000001', 'create_brand', args);
  perform pg_temp.expect('T11 re-confirm = same brand', v->'brand'->>'id' = '43890000-0000-4000-c000-000000000001'
    and (select count(*) from public.brands where account_id = pg_temp.uid('admin')) = 1, v::text);
  insert into public.agent_pending_actions (id, user_id, tool_name, tool_args, source, status,
    server_proposed_at, execution_attested_at)
  values ('43890000-0000-4000-c000-000000000002', pg_temp.uid('admin'), 'create_brand',
    '{"name":"Lekki Lights"}', 'hub_experience', 'executing', now(), now());
  c := pg_temp.err($$select public.ari_execute_brand_operation('43890000-0000-4000-c000-000000000002','create_brand','{"name":"Lekki Lights"}')$$);
  perform pg_temp.expect('T11 duplicate in-progress name', c like 'PT409 existing_incomplete_brand:43890000-0000-4000-c000-000000000001%', c);
  insert into public.agent_pending_actions (id, user_id, tool_name, tool_args, source, status,
    server_proposed_at, execution_attested_at)
  values ('43890000-0000-4000-c000-000000000003', pg_temp.uid('admin'), 'create_brand',
    '{"name":"Other","payout_country":"ZZ"}', 'hub_experience', 'executing', now(), now());
  c := pg_temp.err($$select public.ari_execute_brand_operation('43890000-0000-4000-c000-000000000003','create_brand','{"name":"Other","payout_country":"ZZ"}')$$);
  perform pg_temp.expect('T11 unsupported country', c like '22023 payout_country_unsupported%', c);
  insert into public.agent_pending_actions (id, user_id, tool_name, tool_args, source, status,
    server_proposed_at, execution_attested_at)
  values ('43890000-0000-4000-c000-000000000004', pg_temp.uid('admin'), 'create_brand',
    '{"name":"Third"}', 'hub_experience', 'executing', now(), now());
  c := pg_temp.err($$select public.ari_execute_brand_operation('43890000-0000-4000-c000-000000000004','create_brand','{"name":"Third"}')$$);
  perform pg_temp.expect('T11 draft_exists', c like 'PT409 draft_exists:43890000-0000-4000-c000-000000000001%', c);
end;
$t$;

\echo 'issue_4389 brand setup: ALL PASS'
rollback;
