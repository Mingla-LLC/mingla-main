-- Issue #4389 — tester adversarial suite for 20280808004389_issue_4389_setup_polish.sql,
-- on the fully replayed PG17 schema. Different angles from the implementor suite:
--   (A1) owner handover with the DEFAULT "leave" disposition (#3660) or an admin
--        reassignment (#3622): the old owner is REMOVED, not demoted. Even when
--        they were the only acceptor, terms stay done (Seth 2026-11-18: a
--        handover never reopens setup; supersedes Q2) via the brand-level record.
--        [updated by the implementor, rework 2 — was: terms reopen]
--   (A2) "stay" handover keeps it done; later removing the demoted ex-owner also
--        keeps it done (brand-level record). [rework 2 — was: reopens]
--   (A3) the brand owner's own acceptance (the trigger-written owner row) still
--        counts under the new accepted_at/role clause (no regression).
--   (A4) a Stripe brand carrying a hold-rail stamp never counts as able to take
--        money; its free-only stamp is kept.
--   (A5) a true draft stays a draft: a hold-rail brand with no terms is is_draft and
--        is the host's one draft; once an admin accepts it completes and stops
--        being the draft (one-draft rule follows).
--   (A6) Paystack with a bank but an old ToS only -> details true, terms false,
--        not complete, and the preview still says "Bank connected".
-- MINGLA-INVARIANT: I-4389-SETUP-TERMS-NEVER-REOPENED-BY-HANDOVER | issue #4389 | once an owner or admin of the brand accepted ToS 1.0, brand_setup terms stay done through any handover ('leave', 'stay', admin reassignment) or member removal; a hold-rail stamp counts only for Paystack brands; a brand with is_draft true is the one issue_4389_user_draft_brand returns for its host.
--
-- FAILS-ON-REVERT: replay without 20280808004389 -> (A1), (A2-stay), (A5-complete)
-- fail (owner-only terms ignore the demoted acceptor and the admin; no brand
-- record keeps a removed acceptor's acceptance).
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

update cron.job set active = false where active;

create temp table t4389t_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t4389t_people values
  ('own',  '43892000-0000-4000-a000-000000000001', 'own.t4389@test.local'),
  ('adm',  '43892000-0000-4000-a000-000000000002', 'adm.t4389@test.local'),
  ('new',  '43892000-0000-4000-a000-000000000003', 'new.t4389@test.local');
insert into auth.users (id, email) select id, email from t4389t_people;
insert into public.creator_accounts (id, created_at) select id, now() from t4389t_people;

create function pg_temp.uid(p_who text) returns uuid
language sql as $fn$ select id from t4389t_people where who = p_who; $fn$;
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
language sql as $fn$ select ('43892000-0000-4000-b000-' || lpad(p_n::text, 12, '0'))::uuid; $fn$;
create function pg_temp.mk(p_n int) returns uuid
language plpgsql as $fn$
begin
  insert into public.brands (id, account_id, name, slug)
  values (pg_temp.brand(p_n), pg_temp.uid('own'), 'Tester 4389 ' || p_n, 'tester4389-' || p_n);
  return pg_temp.brand(p_n);
end;
$fn$;
create function pg_temp.accept_terms(p_brand uuid, p_who text) returns void
language sql as $fn$
  update public.brand_team_members
  set mingla_tos_accepted_at = now(), mingla_tos_version_accepted = '1.0'
  where brand_id = p_brand and user_id = pg_temp.uid(p_who) and removed_at is null;
$fn$;
-- Handover as #3660 accept-invite does it: account_id moves, the incoming owner
-- gets an accepted brand_owner row, and the outgoing owner is soft-removed
-- ('leave', the default; #3622 admin reassignment does the same) or demoted
-- to brand_admin ('stay').
create function pg_temp.handover(p_brand uuid, p_disposition text) returns void
language plpgsql as $fn$
begin
  perform set_config('app.allow_brand_owner_transfer', 'on', true);
  if p_disposition = 'stay' then
    update public.brand_team_members set role = 'brand_admin'
    where brand_id = p_brand and user_id = pg_temp.uid('own') and removed_at is null;
  else
    update public.brand_team_members set removed_at = now()
    where brand_id = p_brand and user_id = pg_temp.uid('own') and removed_at is null;
  end if;
  update public.brands set account_id = pg_temp.uid('new') where id = p_brand;
  insert into public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at)
  values (p_brand, pg_temp.uid('new'), 'brand_owner', now(), now());
  perform set_config('app.allow_brand_owner_transfer', 'off', true);
end;
$fn$;
create function pg_temp.facts(p_brand uuid) returns jsonb
language sql as $fn$ select public.issue_4389_brand_setup_facts(p_brand); $fn$;

do $t$
declare b uuid; f jsonb; r jsonb; d record; stamp timestamptz := '2028-01-02 03:04:05+00';
begin
  -- (A3) the trigger-written owner row counts when the owner accepts.
  b := pg_temp.mk(1);
  perform pg_temp.expect('(A3) owner row from the insert trigger is accepted',
    (select accepted_at is not null and role = 'brand_owner' from public.brand_team_members
      where brand_id = b and user_id = pg_temp.uid('own')));
  perform pg_temp.accept_terms(b, 'own');
  perform pg_temp.expect('(A3) the owner''s own acceptance still counts',
    (pg_temp.facts(b)->>'terms')::boolean, pg_temp.facts(b)::text);

  -- (A1) default "leave" handover with the old owner as the only acceptor.
  perform pg_temp.handover(b, 'leave');
  perform pg_temp.expect('(A1) leave handover, sole acceptor removed -> terms stay done',
    (pg_temp.facts(b)->>'terms')::boolean, pg_temp.facts(b)::text);
  perform pg_temp.accept_terms(b, 'new');
  perform pg_temp.expect('(A1) new owner accepts -> terms still done',
    (pg_temp.facts(b)->>'terms')::boolean, pg_temp.facts(b)::text);

  -- (A2) "stay" handover keeps it done; removing the demoted acceptor reopens it.
  b := pg_temp.mk(2);
  perform pg_temp.accept_terms(b, 'own');
  perform pg_temp.handover(b, 'stay');
  perform pg_temp.expect('(A2) stay handover keeps terms done',
    (pg_temp.facts(b)->>'terms')::boolean, pg_temp.facts(b)::text);
  update public.brand_team_members set removed_at = now()
  where brand_id = b and user_id = pg_temp.uid('own');
  perform pg_temp.expect('(A2) demoted acceptor removed -> terms stay done',
    (pg_temp.facts(b)->>'terms')::boolean, pg_temp.facts(b)::text);

  -- (A4) Stripe brand with a hold-rail stamp: not able to take money.
  b := pg_temp.mk(3);
  update public.brands set payout_country = 'US' where id = b;
  update public.brands set payment_provider = 'stripe', payout_hold_cutover_at = now(),
    setup_free_only_at = stamp where id = b;
  f := pg_temp.facts(b);
  perform pg_temp.expect('(A4) Stripe + hold stamp -> details false, free-only kept',
    f->>'provider' = 'stripe' and not (f->>'details')::boolean
    and not (f->>'bank_connected')::boolean
    and (f->>'free_only_at')::timestamptz = stamp and not (f->>'is_draft')::boolean, f::text);

  -- (A5) a true draft stays the host's one draft until it completes.
  b := pg_temp.mk(4);
  update public.brands set payout_country = 'NG' where id = b;
  update public.brands set payout_hold_cutover_at = coalesce(payout_hold_cutover_at, now()) where id = b;
  f := pg_temp.facts(b);
  perform pg_temp.expect('(A5) hold rail, no terms -> details true but still a draft',
    f->>'provider' = 'paystack' and (f->>'details')::boolean and not (f->>'terms')::boolean
    and not (f->>'complete')::boolean and (f->>'is_draft')::boolean, f::text);
  select * into d from public.issue_4389_user_draft_brand(pg_temp.uid('own'), null);
  perform pg_temp.expect('(A5) it is the host''s one draft', d.brand_id = b, coalesce(d.brand_id::text, 'none'));
  insert into public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at,
    mingla_tos_accepted_at, mingla_tos_version_accepted)
  values (b, pg_temp.uid('adm'), 'brand_admin', now(), now(), now(), '1.0');
  f := pg_temp.facts(b);
  perform pg_temp.expect('(A5) admin accepts -> complete, no longer a draft',
    (f->>'complete')::boolean and not (f->>'is_draft')::boolean, f::text);
  select * into d from public.issue_4389_user_draft_brand(pg_temp.uid('own'), null);
  perform pg_temp.expect('(A5) one-draft rule no longer sees it', d.brand_id is distinct from b,
    coalesce(d.brand_id::text, 'none'));

  -- (A6) Paystack with a bank, old ToS only.
  b := pg_temp.mk(5);
  update public.brands set payout_country = 'NG' where id = b;
  update public.brands set paystack_subaccount_code = 'ACCT_t4389' where id = b;
  update public.brand_team_members set mingla_tos_accepted_at = now(), mingla_tos_version_accepted = '0.9'
  where brand_id = b and user_id = pg_temp.uid('own');
  f := pg_temp.facts(b);
  r := public.brand_readiness_internal(b, 'brand_setup', pg_temp.uid('own'));
  perform pg_temp.expect('(A6) bank + old ToS -> details, bank, not terms, not complete',
    (f->>'details')::boolean and (f->>'bank_connected')::boolean
    and not (f->>'terms')::boolean and not (f->>'complete')::boolean
    and (select i->>'value_preview' from jsonb_array_elements(r->'items') i
      where i->>'key' = 'money.details_submitted') = 'Bank connected', f::text);
end;
$t$;

-- ── Retest 1 (brand-level record, f3e8511206) ──────────────────────────────
--   (A7) role-change paths: an event_manager's acceptance writes no record; a
--        later promotion to brand_admin writes it; demoting that admin keeps it.
--   (A8) re-accepting the same version never moves first_accepted_at; the
--        backfill re-run inserts 0 rows (idempotent).
--   (A9) clients cannot read or write the record (anon / authenticated).
--   (A10) hard-deleting the brand removes its record (FK cascade, no orphan).
do $t$
declare b uuid; first_at timestamptz; n int; denied boolean;
begin
  -- (A7)
  b := pg_temp.mk(7);
  insert into public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at,
    mingla_tos_accepted_at, mingla_tos_version_accepted)
  values (b, pg_temp.uid('adm'), 'event_manager', now(), now(), now() - interval '1 day', '1.0');
  perform pg_temp.expect('(A7) an event_manager acceptance writes no record',
    not exists (select 1 from public.brand_terms_acceptances where brand_id = b)
    and not (pg_temp.facts(b)->>'terms')::boolean, pg_temp.facts(b)::text);
  update public.brand_team_members set role = 'brand_admin'
  where brand_id = b and user_id = pg_temp.uid('adm');
  perform pg_temp.expect('(A7) promotion to brand_admin writes the record',
    exists (select 1 from public.brand_terms_acceptances where brand_id = b and version = '1.0'));
  update public.brand_team_members set role = 'event_manager'
  where brand_id = b and user_id = pg_temp.uid('adm');
  perform pg_temp.expect('(A7) demoting that admin keeps terms done',
    (pg_temp.facts(b)->>'terms')::boolean, pg_temp.facts(b)::text);

  -- (A8)
  select first_accepted_at into first_at from public.brand_terms_acceptances where brand_id = b and version = '1.0';
  update public.brand_team_members set role = 'brand_admin', mingla_tos_accepted_at = now() + interval '1 hour'
  where brand_id = b and user_id = pg_temp.uid('adm');
  perform pg_temp.expect('(A8) re-accepting keeps first_accepted_at',
    (select first_accepted_at from public.brand_terms_acceptances where brand_id = b and version = '1.0') = first_at);
  n := public.issue_4389_backfill_brand_terms();
  perform pg_temp.expect('(A8) backfill re-run inserts nothing', n = 0, n::text);

  -- (A9)
  denied := false;
  begin
    set local role authenticated;
    perform 1 from public.brand_terms_acceptances limit 1;
  exception when insufficient_privilege then denied := true;
  end;
  reset role;
  perform pg_temp.expect('(A9) authenticated cannot read the record', denied);
  denied := false;
  begin
    set local role anon;
    insert into public.brand_terms_acceptances (brand_id, version, first_accepted_at) values (b, '9.9', now());
  exception when insufficient_privilege then denied := true;
  end;
  reset role;
  perform pg_temp.expect('(A9) anon cannot write the record', denied);
  perform pg_temp.expect('(A9) the trigger function is SECURITY DEFINER with a pinned search_path',
    (select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc
      where oid = 'public.issue_4389_record_brand_terms()'::regprocedure),
    (select proconfig::text from pg_proc where oid = 'public.issue_4389_record_brand_terms()'::regprocedure));

  -- (A10)
  denied := false;
  begin
    delete from public.brands where id = b;
  exception when others then
    denied := true;
    raise notice 'SKIP (A10) brand hard delete blocked here: %', sqlerrm;
  end;
  if not denied then
    perform pg_temp.expect('(A10) brand hard delete cascades the record',
      not exists (select 1 from public.brand_terms_acceptances where brand_id = b));
  end if;
end;
$t$;

\echo 'issue_4389 setup polish tester adversarial: ALL PASS'
rollback;
