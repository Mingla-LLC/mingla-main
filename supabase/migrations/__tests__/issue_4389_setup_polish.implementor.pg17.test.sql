-- Issue #4389 — Host polish pass P1/P8 (20280808004389_issue_4389_setup_polish.sql),
-- on the fully replayed PG17 schema.
-- MINGLA-INVARIANT: I-4389-SETUP-TERMS-BRAND-LEVEL | issue #4389 | brand_setup terms are done when the brand has a brand_terms_acceptances row for 1.0 (written by trigger from any current, joined brand_owner / brand_admin acceptance, backfilled from all past ones incl. removed members) OR a current, joined owner / admin holds 1.0; no handover ('stay', 'leave', admin reassignment) or member removal reopens it; another version does not satisfy it; roles below admin and pending invites never write it.
-- MINGLA-INVARIANT: I-4389-SETUP-DETAILS-AGREES-WITH-SELL | issue #4389 | a Paystack hold-rail brand (payout_hold_cutover_at set) counts as able to take money in setup facts (details true, bank_connected false, preview "Ready to sell").
-- MINGLA-INVARIANT: I-4389-FREE-ONLY-NEVER-WITH-COLLECT | issue #4389 | setup facts never report free_only_at while details is true; a free-only brand that cannot collect keeps its stamp and its is_draft stays false.
--
--   (a) owner has no terms, an accepted admin accepted 1.0 -> terms true
--   (b) owner handover, 'stay' (old owner demoted to admin) AND 'leave' (old
--       owner removed, as #3660's default and #3622 admin reassignment do),
--       where the old owner was the only acceptor -> terms stay true
--   (c) the only acceptor is later removed -> terms stay true (brand record)
--   (d) an event_manager accepted -> false, and no brand record is written
--   (e) an admin invite not yet accepted -> false; accepting the invite later
--       writes the record -> true
--   (k) backfill: an acceptance by a member removed before the trigger existed
--       is recovered by issue_4389_backfill_brand_terms
--   (l) another terms version (0.9, or a future 2.0) does not satisfy 1.0
--   (f) Paystack + hold stamp + no bank -> details true, bank_connected false,
--       readiness preview 'Ready to sell'; with a bank -> 'Bank connected'
--   (g) Paystack, no stamp, no bank -> details false
--   (h) free-only + hold -> free_only_at NULL; free-only without collect ->
--       free_only_at = the stamp and is_draft false
--   (i) Stripe unchanged: charges_enabled -> details true, bank_connected false
--   (j) the facts body no longer reads the owner-only terms clause
--
-- FAILS-ON-REVERT: replay without 20280808004389 -> (a), (b), (f), (h) and (j)
-- fail (owner-only terms; no hold rail; stored free_only_at; no bank_connected).
-- Drop the brand_terms_acceptances arm of the terms clause -> (b-leave), (c)
-- and (k) fail; drop the trigger -> (b-leave), (c) and (e-later) fail.
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

update cron.job set active = false where active;

create temp table t4389p_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t4389p_people values
  ('own',  '43891000-0000-4000-a000-000000000001', 'own.p4389@test.local'),
  ('adm',  '43891000-0000-4000-a000-000000000002', 'adm.p4389@test.local'),
  ('mgr',  '43891000-0000-4000-a000-000000000003', 'mgr.p4389@test.local'),
  ('inv',  '43891000-0000-4000-a000-000000000004', 'inv.p4389@test.local'),
  ('new',  '43891000-0000-4000-a000-000000000005', 'new.p4389@test.local');
insert into auth.users (id, email) select id, email from t4389p_people;
insert into public.creator_accounts (id, created_at) select id, now() from t4389p_people;

create function pg_temp.uid(p_who text) returns uuid
language sql as $fn$ select id from t4389p_people where who = p_who; $fn$;
create function pg_temp.expect(p_label text, p_ok boolean, p_detail text default null) returns void
language plpgsql as $fn$
begin
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'FAIL %: %', p_label, COALESCE(p_detail, '');
  END IF;
  RAISE NOTICE 'PASS %', p_label;
end;
$fn$;
create function pg_temp.brand(p_n int) returns uuid
language sql as $fn$ select ('43891000-0000-4000-b000-' || lpad(p_n::text, 12, '0'))::uuid; $fn$;
-- A brand owned by `own` (the insert trigger writes own's brand_owner row,
-- which never accepts terms here).
create function pg_temp.mk(p_n int) returns uuid
language plpgsql as $fn$
begin
  insert into public.brands (id, account_id, name, slug)
  values (pg_temp.brand(p_n), pg_temp.uid('own'), 'Polish 4389 ' || p_n, 'polish4389-' || p_n);
  update public.brand_team_members set accepted_at = coalesce(accepted_at, now())
  where brand_id = pg_temp.brand(p_n);
  return pg_temp.brand(p_n);
end;
$fn$;
create function pg_temp.member(p_brand uuid, p_who text, p_role text, p_accepted boolean, p_terms boolean)
returns void language sql as $fn$
  insert into public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at,
    mingla_tos_accepted_at, mingla_tos_version_accepted)
  values (p_brand, pg_temp.uid(p_who), p_role, now(),
    case when p_accepted then now() end,
    case when p_terms then now() end,
    case when p_terms then '1.0' end);
$fn$;
create function pg_temp.facts(p_brand uuid) returns jsonb
language sql as $fn$ select public.issue_4389_brand_setup_facts(p_brand); $fn$;

-- ── Terms (P1) ─────────────────────────────────────────────────────────────
do $t$
declare b uuid;
begin
  -- (a)
  b := pg_temp.mk(1);
  perform pg_temp.member(b, 'adm', 'brand_admin', true, true);
  perform pg_temp.expect('(a) an accepted admin''s terms count',
    (pg_temp.facts(b)->>'terms')::boolean, pg_temp.facts(b)::text);

  -- Control: nobody accepted -> false.
  b := pg_temp.mk(9);
  perform pg_temp.expect('(a0) nobody accepted -> terms false',
    not (pg_temp.facts(b)->>'terms')::boolean, pg_temp.facts(b)::text);

  -- (b) owner handover: own accepted, then the brand moves to `new` (who has
  -- not accepted) and own stays as an accepted brand_admin.
  b := pg_temp.mk(2);
  update public.brand_team_members
  set mingla_tos_accepted_at = now(), mingla_tos_version_accepted = '1.0'
  where brand_id = b and user_id = pg_temp.uid('own');
  -- The handover writes (account_id, old owner's role, new owner's row) run
  -- under the same transfer bypass the admin reassignment arms.
  perform set_config('app.allow_brand_owner_transfer', 'on', true);
  update public.brands set account_id = pg_temp.uid('new') where id = b;
  update public.brand_team_members set role = 'brand_admin'
  where brand_id = b and user_id = pg_temp.uid('own');
  insert into public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at)
  values (b, pg_temp.uid('new'), 'brand_owner', now(), now())
  on conflict do nothing;
  perform set_config('app.allow_brand_owner_transfer', 'off', true);
  perform pg_temp.expect('(b-stay) a stay handover keeps terms done',
    (pg_temp.facts(b)->>'terms')::boolean
    and (select account_id from public.brands where id = b) = pg_temp.uid('new'),
    pg_temp.facts(b)::text);

  -- (b-leave) the default handover REMOVES the old owner (the only acceptor);
  -- the new owner has not accepted. Setup must stay done.
  b := pg_temp.mk(7);
  update public.brand_team_members
  set mingla_tos_accepted_at = now(), mingla_tos_version_accepted = '1.0'
  where brand_id = b and user_id = pg_temp.uid('own');
  perform set_config('app.allow_brand_owner_transfer', 'on', true);
  update public.brand_team_members set removed_at = now()
  where brand_id = b and user_id = pg_temp.uid('own');
  update public.brands set account_id = pg_temp.uid('new') where id = b;
  insert into public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at)
  values (b, pg_temp.uid('new'), 'brand_owner', now(), now())
  on conflict do nothing;
  perform set_config('app.allow_brand_owner_transfer', 'off', true);
  perform pg_temp.expect('(b-leave) a leave handover never reopens terms',
    (pg_temp.facts(b)->>'terms')::boolean
    and not exists (select 1 from public.brand_team_members m where m.brand_id = b
      and m.removed_at is null and m.mingla_tos_version_accepted = '1.0'),
    pg_temp.facts(b)::text);

  -- (c)
  b := pg_temp.mk(3);
  perform pg_temp.member(b, 'adm', 'brand_admin', true, true);
  update public.brand_team_members set removed_at = now()
  where brand_id = b and user_id = pg_temp.uid('adm');
  perform pg_temp.expect('(c) removing the only acceptor keeps terms done (brand record)',
    (pg_temp.facts(b)->>'terms')::boolean
    and exists (select 1 from public.brand_terms_acceptances where brand_id = b and version = '1.0'),
    pg_temp.facts(b)::text);

  -- (d)
  b := pg_temp.mk(4);
  perform pg_temp.member(b, 'mgr', 'event_manager', true, true);
  perform pg_temp.expect('(d) an event_manager does not count and writes no brand record',
    not (pg_temp.facts(b)->>'terms')::boolean
    and not exists (select 1 from public.brand_terms_acceptances where brand_id = b),
    pg_temp.facts(b)::text);

  -- (e)
  b := pg_temp.mk(5);
  perform pg_temp.member(b, 'inv', 'brand_admin', false, true);
  perform pg_temp.expect('(e) a pending admin invite does not count',
    not (pg_temp.facts(b)->>'terms')::boolean
    and not exists (select 1 from public.brand_terms_acceptances where brand_id = b),
    pg_temp.facts(b)::text);
  update public.brand_team_members set accepted_at = now()
  where brand_id = b and user_id = pg_temp.uid('inv');
  perform pg_temp.expect('(e-later) accepting the invite writes the brand record',
    (pg_temp.facts(b)->>'terms')::boolean
    and exists (select 1 from public.brand_terms_acceptances where brand_id = b and version = '1.0'),
    pg_temp.facts(b)::text);

  -- Old terms version does not count.
  b := pg_temp.mk(6);
  insert into public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at,
    mingla_tos_accepted_at, mingla_tos_version_accepted)
  values (b, pg_temp.uid('adm'), 'brand_admin', now(), now(), now(), '0.9');
  perform pg_temp.expect('(e2) an old terms version does not count',
    not (pg_temp.facts(b)->>'terms')::boolean, pg_temp.facts(b)::text);

  -- (l) a brand record for another version (older, or a future 2.0) does not
  -- satisfy 1.0: a new version reopens setup.
  b := pg_temp.mk(8);
  insert into public.brand_terms_acceptances (brand_id, version, first_accepted_at)
  values (b, '0.9', now()), (b, '2.0', now());
  perform pg_temp.expect('(l) only the 1.0 record counts',
    not (pg_temp.facts(b)->>'terms')::boolean, pg_temp.facts(b)::text);

  -- (k) backfill from a member removed before the trigger existed.
  b := pg_temp.mk(13);
  alter table public.brand_team_members disable trigger issue_4389_record_brand_terms;
  perform pg_temp.member(b, 'adm', 'brand_admin', true, true);
  update public.brand_team_members set removed_at = now()
  where brand_id = b and user_id = pg_temp.uid('adm');
  alter table public.brand_team_members enable trigger issue_4389_record_brand_terms;
  perform pg_temp.expect('(k) before backfill: no record, no active acceptor',
    not (pg_temp.facts(b)->>'terms')::boolean, pg_temp.facts(b)::text);
  perform public.issue_4389_backfill_brand_terms();
  perform pg_temp.expect('(k) backfill recovers a removed member''s acceptance',
    (pg_temp.facts(b)->>'terms')::boolean, pg_temp.facts(b)::text);
  perform pg_temp.expect('(k) backfill is idempotent', public.issue_4389_backfill_brand_terms() = 0);
end;
$t$;

-- ── Details / free only (P8) ───────────────────────────────────────────────
do $t$
declare b uuid; f jsonb; r jsonb; stamp timestamptz := '2028-01-02 03:04:05+00';
begin
  -- (f) hold rail, no bank, terms done by an admin -> complete.
  b := pg_temp.mk(10);
  perform pg_temp.member(b, 'adm', 'brand_admin', true, true);
  update public.brands set payout_country = 'NG' where id = b;
  update public.brands set payout_hold_cutover_at = now() where id = b;
  f := pg_temp.facts(b);
  perform pg_temp.expect('(f) hold rail counts as able to take money',
    f->>'provider' = 'paystack' and (f->>'details')::boolean
    and not (f->>'bank_connected')::boolean and (f->>'complete')::boolean
    and not (f->>'is_draft')::boolean, f::text);
  r := public.brand_readiness_internal(b, 'brand_setup', pg_temp.uid('own'));
  perform pg_temp.expect('(f) preview Ready to sell, not Bank connected',
    (select i->>'value_preview' from jsonb_array_elements(r->'items') i
      where i->>'key' = 'money.details_submitted') = 'Ready to sell'
    and (r->>'can_proceed')::boolean, r::text);
  perform pg_temp.expect('(f) terms preview Accepted via the admin',
    (select i->>'state' from jsonb_array_elements(r->'items') i
      where i->>'key' = 'money.terms_member') = 'verified', r::text);
  -- With a bank -> 'Bank connected'.
  update public.brands set paystack_subaccount_code = 'ACCT_p4389' where id = b;
  f := pg_temp.facts(b);
  r := public.brand_readiness_internal(b, 'brand_setup', pg_temp.uid('own'));
  perform pg_temp.expect('(f) a bank reads Bank connected',
    (f->>'bank_connected')::boolean and (select i->>'value_preview'
      from jsonb_array_elements(r->'items') i
      where i->>'key' = 'money.details_submitted') = 'Bank connected', r::text);

  -- (g) Paystack, no stamp, no bank.
  b := pg_temp.mk(11);
  update public.brands set payout_country = 'NG' where id = b;
  update public.brands set payout_hold_cutover_at = null where id = b;
  f := pg_temp.facts(b);
  perform pg_temp.expect('(g) no stamp and no bank -> details false',
    f->>'provider' = 'paystack' and not (f->>'details')::boolean
    and not (f->>'bank_connected')::boolean, f::text);

  -- (h) free-only without collect keeps the stamp and is never a draft.
  update public.brands set setup_free_only_at = stamp where id = b;
  f := pg_temp.facts(b);
  perform pg_temp.expect('(h) free-only without collect keeps the stamp',
    (f->>'free_only_at')::timestamptz = stamp and not (f->>'is_draft')::boolean, f::text);
  -- (h) the brand can now collect (hold rail) -> free_only_at NULL.
  update public.brands set payout_hold_cutover_at = now() where id = b;
  f := pg_temp.facts(b);
  perform pg_temp.expect('(h) free-only clears once the brand can collect',
    (f->>'details')::boolean and f->'free_only_at' = 'null'::jsonb
    and not (f->>'is_draft')::boolean, f::text);
  perform pg_temp.expect('(h) the stored stamp stays as history',
    (select setup_free_only_at from public.brands where id = b) = stamp);

  -- (i) Stripe unchanged.
  b := pg_temp.mk(12);
  update public.brands set payout_country = 'US' where id = b;
  update public.brands set setup_free_only_at = stamp where id = b;
  f := pg_temp.facts(b);
  perform pg_temp.expect('(i) Stripe without an account -> details false, stamp kept',
    f->>'provider' = 'stripe' and not (f->>'details')::boolean
    and (f->>'free_only_at')::timestamptz = stamp, f::text);
  insert into public.stripe_connect_accounts (brand_id, stripe_account_id, country,
    default_currency, requirements, charges_enabled)
  values (b, 'acct_testp4389', 'US', 'USD', '{}', true);
  f := pg_temp.facts(b);
  perform pg_temp.expect('(i) Stripe charges_enabled -> details true, free-only cleared',
    (f->>'details')::boolean and not (f->>'bank_connected')::boolean
    and f->>'stripe_state' = 'submitted' and f->'free_only_at' = 'null'::jsonb, f::text);
  r := public.brand_readiness_internal(b, 'brand_setup', pg_temp.uid('own'));
  perform pg_temp.expect('(i) Stripe preview still Sent',
    (select i->>'value_preview' from jsonb_array_elements(r->'items') i
      where i->>'key' = 'money.details_submitted') = 'Sent', r::text);
end;
$t$;

-- ── (j) structural guard ───────────────────────────────────────────────────
do $t$
declare d text;
begin
  d := pg_get_functiondef('public.issue_4389_brand_setup_facts(uuid)'::regprocedure);
  perform pg_temp.expect('(j) facts body has no owner-only terms clause',
    position('= v_brand.account_id' in d) = 0
    and position($$m.role IN ('brand_owner','brand_admin')$$ in d) > 0);
  perform pg_temp.expect('(j) facts stay service_role only',
    not has_function_privilege('authenticated', 'public.issue_4389_brand_setup_facts(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.issue_4389_brand_setup_facts(uuid)', 'EXECUTE'));
  perform pg_temp.expect('(j) brand terms record and backfill are service_role only',
    not has_table_privilege('authenticated', 'public.brand_terms_acceptances', 'SELECT')
    and not has_table_privilege('anon', 'public.brand_terms_acceptances', 'SELECT')
    and not has_function_privilege('authenticated', 'public.issue_4389_backfill_brand_terms()', 'EXECUTE'));
  perform pg_temp.expect('(j) brand_setup still has exactly 4 items',
    (select count(*) from public.brand_readiness_catalog where 'brand_setup' = any(blocking_for)) = 4);
end;
$t$;

\echo 'issue_4389 setup polish: ALL PASS'
rollback;
