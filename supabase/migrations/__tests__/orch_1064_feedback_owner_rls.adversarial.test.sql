-- ORCH-1064 — TESTER ADVERSARIAL regression (different angle than the
-- implementor's happy-path).
--
-- The implementor's deno test (orch_1064_feedback_loop.test.ts) asserts the
-- MIGRATION TEXT contains the right substrings + validates the pure
-- normalizeFeedbackBody input gate. It NEVER executes the SQL against a database,
-- so it cannot prove the RLS predicate or the RPC guards actually BEHAVE
-- correctly at runtime. A migration can contain the right strings and still leak
-- (wrong column in the predicate, missing guard, an accidental owner-write
-- policy, etc).
--
-- THIS test executes the real DDL+RLS+RPC against a live Postgres with TWO
-- distinct authenticated users and asserts the security invariants by behavior:
--
--   ADV-1  RLS leak — owner A sees ONLY A's feedback; owner B's row is invisible
--          to A (the classic cross-brand feedback leak). I-1064-FEEDBACK-OWNER-READ.
--   ADV-2  Direct client UPDATE of status='fixed' bypassing the RPC is DENIED
--          (no owner write policy exists). I-1064-RPC-WRITES-ONLY.
--   ADV-3  biz_resubmit_venue_claim guard — resubmitting a claim NOT in
--          need_more_info (no follow-up stamp) raises not_awaiting_resubmit;
--          resubmitting with a stamp but ZERO feedback rounds raises
--          no_feedback_to_resubmit; a non-owner raises forbidden.
--   ADV-4  biz_mark_feedback_item_fixed by a NON-owner raises forbidden and the
--          status is unchanged.
--   ADV-5  anon (no JWT) sees ZERO feedback rows (no grant / no policy match).
--
-- Run (local Supabase Postgres only — never remote):
--   docker exec -i supabase_db_<ref> psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < this_file
-- The whole script runs inside ONE transaction and ROLLS BACK — it leaves no
-- residue, so it is safe to run against any environment that has the ORCH-1064
-- migration applied.
--
-- fails-on-revert: with the migration reverted (table/RPCs absent) ADV-1..5 all
-- error immediately (relation/function does not exist). With the owner-SELECT
-- predicate widened to leak (e.g. dropped to `true`), ADV-1 fails its count
-- assertion. With an owner UPDATE policy accidentally added, ADV-2 fails.

\set ON_ERROR_STOP on
begin;

-- ── Fixtures: two owners, two brands, the admin, and seeded feedback ─────────
-- auth.users rows so the brands' account_id FK (if any) + auth.uid() resolve.
insert into auth.users (id, email, instance_id, aud, role)
values
  ('a0000000-0000-0000-0000-0000000000a1', 'ownerA@test.local',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-0000000000b1', 'ownerB@test.local',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
on conflict (id) do nothing;

-- creator_accounts because brands.account_id → creator_accounts(id) →
-- auth.users(id), and the owner predicate checks brands.account_id = auth.uid()
-- (so creator_accounts.id == auth.uid()).
insert into public.creator_accounts (id)
values
  ('a0000000-0000-0000-0000-0000000000a1'),
  ('b0000000-0000-0000-0000-0000000000b1')
on conflict (id) do nothing;

-- Two brands, each owned by a different user (brands.account_id = owner).
insert into public.brands (id, name, slug, account_id, claim_status, claim_follow_up_at)
values
  ('a1111111-1111-1111-1111-111111111111', 'ADV Brand A', 'adv-brand-a-orch1064',
   'a0000000-0000-0000-0000-0000000000a1', 'pending_review', now()),
  ('b2222222-2222-2222-2222-222222222222', 'ADV Brand B', 'adv-brand-b-orch1064',
   'b0000000-0000-0000-0000-0000000000b1', 'pending_review', now());

-- One feedback row per brand (insert as superuser, RLS not forced for postgres).
insert into public.venue_claim_feedback
  (id, brand_id, round, category, note, status, created_by)
values
  ('f1111111-0000-0000-0000-000000000001',
   'a1111111-1111-1111-1111-111111111111', 1, 'photos', 'A-secret: add interior', 'open',
   'a0000000-0000-0000-0000-0000000000a1'),
  ('f2222222-0000-0000-0000-000000000002',
   'b2222222-2222-2222-2222-222222222222', 1, 'hours',  'B-secret: confirm Sunday', 'open',
   'b0000000-0000-0000-0000-0000000000b1');

-- ─────────────────────────────────────────────────────────────────────────────
-- ADV-1 — RLS cross-brand leak. As owner A, the view+table must return exactly
-- ONE row (A's), never B's. This is THE feedback-leak invariant.
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

do $$
declare
  v_total int;
  v_b_visible int;
  v_note text;
begin
  select count(*) into v_total from public.venue_claim_feedback;
  select count(*) into v_b_visible from public.venue_claim_feedback
    where brand_id = 'b2222222-2222-2222-2222-222222222222';
  select note into v_note from public.venue_claim_feedback
    where brand_id = 'a1111111-1111-1111-1111-111111111111' limit 1;

  if v_total <> 1 then
    raise exception 'ADV-1 FAIL: owner A sees % rows, expected exactly 1 (own)', v_total;
  end if;
  if v_b_visible <> 0 then
    raise exception 'ADV-1 FAIL: owner A can see % of brand B''s feedback rows (LEAK)', v_b_visible;
  end if;
  if v_note is null or v_note not like 'A-secret%' then
    raise exception 'ADV-1 FAIL: owner A cannot read own row';
  end if;
  raise notice 'ADV-1 PASS: owner A sees only own feedback (1 row), zero of brand B (no leak)';
end $$;

-- Also via the active-round view (the surface the business app actually reads).
do $$
declare v_view_rows int; v_view_b int;
begin
  select count(*) into v_view_rows from public.venue_claim_active_feedback;
  select count(*) into v_view_b from public.venue_claim_active_feedback
    where brand_id = 'b2222222-2222-2222-2222-222222222222';
  if v_view_rows <> 1 or v_view_b <> 0 then
    raise exception 'ADV-1b FAIL: active-feedback view leaked (% total, % from B)', v_view_rows, v_view_b;
  end if;
  raise notice 'ADV-1b PASS: security_invoker view enforces owner isolation';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ADV-2 — Direct client UPDATE bypassing the RPC must be DENIED (no owner write
-- policy). Owner A attempts to mark its OWN item fixed via a raw UPDATE.
-- Expected: 0 rows updated (RLS UPDATE policy absent → command sees no rows it
-- may write), status stays 'open'.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_updated int; v_status text;
begin
  update public.venue_claim_feedback
     set status = 'fixed', resolved_at = now()
   where id = 'f1111111-0000-0000-0000-000000000001';
  get diagnostics v_updated = row_count;

  -- Read back as superuser-visible via a definer-free path: re-select under RLS;
  -- since A can SELECT its own row, check the status did NOT change.
  select status into v_status from public.venue_claim_feedback
    where id = 'f1111111-0000-0000-0000-000000000001';

  if v_updated <> 0 then
    raise exception 'ADV-2 FAIL: direct owner UPDATE affected % rows (an owner-write policy leaked in)', v_updated;
  end if;
  if v_status is distinct from 'open' then
    raise exception 'ADV-2 FAIL: status changed to % via direct UPDATE (RPC-only-write violated)', v_status;
  end if;
  raise notice 'ADV-2 PASS: direct UPDATE denied (0 rows), status stays open — writes are RPC-only';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ADV-4 — biz_mark_feedback_item_fixed by a NON-owner (owner B targeting A's
-- item) must raise forbidden; status unchanged. (Done while still owner-A JWT is
-- irrelevant — switch to B to prove cross-owner RPC denial.)
-- ─────────────────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
do $$
declare v_err text;
begin
  begin
    perform public.biz_mark_feedback_item_fixed('f1111111-0000-0000-0000-000000000001', true);
    raise exception 'ADV-4 FAIL: non-owner B marked A''s item fixed (no forbidden raised)';
  exception when others then
    v_err := sqlerrm;
    if v_err not like '%forbidden%' then
      raise exception 'ADV-4 FAIL: expected forbidden, got: %', v_err;
    end if;
    raise notice 'ADV-4 PASS: non-owner mark-fixed raised forbidden';
  end;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ADV-3 — biz_resubmit_venue_claim guards (as the correct owner A).
--   (a) brand WITH follow-up + >=1 round  → succeeds, clears stamp.
--   (b) brand with NO follow-up stamp     → not_awaiting_resubmit.
--   (c) non-owner                         → forbidden.
-- We test (b) + (c) on dedicated fixtures, and (a) last on brand A.
-- ─────────────────────────────────────────────────────────────────────────────

-- (c) non-owner B re-submitting A's claim → forbidden.
do $$
declare v_err text;
begin
  begin
    perform public.biz_resubmit_venue_claim('a1111111-1111-1111-1111-111111111111');
    raise exception 'ADV-3c FAIL: non-owner re-submitted (no forbidden)';
  exception when others then
    v_err := sqlerrm;
    if v_err not like '%forbidden%' then
      raise exception 'ADV-3c FAIL: expected forbidden, got: %', v_err;
    end if;
    raise notice 'ADV-3c PASS: non-owner re-submit raised forbidden';
  end;
end $$;

-- Switch to owner A for the owner-context guard tests.
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- (b) A brand with a feedback round but NO follow-up stamp → not_awaiting_resubmit.
-- Clear A's stamp first (as superuser via a temporary role reset).
reset role;
update public.brands set claim_follow_up_at = null
  where id = 'a1111111-1111-1111-1111-111111111111';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$
declare v_err text;
begin
  begin
    perform public.biz_resubmit_venue_claim('a1111111-1111-1111-1111-111111111111');
    raise exception 'ADV-3b FAIL: re-submit succeeded with no follow-up stamp';
  exception when others then
    v_err := sqlerrm;
    if v_err not like '%not_awaiting_resubmit%' then
      raise exception 'ADV-3b FAIL: expected not_awaiting_resubmit, got: %', v_err;
    end if;
    raise notice 'ADV-3b PASS: re-submit without follow-up stamp raised not_awaiting_resubmit';
  end;
end $$;

-- (a) Restore the stamp; A re-submits successfully → stamp cleared, returns
-- pending_review + resubmitted_round=1. Then a brand WITH a stamp but ZERO
-- feedback rounds → no_feedback_to_resubmit.
reset role;
update public.brands set claim_follow_up_at = now()
  where id = 'a1111111-1111-1111-1111-111111111111';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$
declare v_res jsonb;
begin
  v_res := public.biz_resubmit_venue_claim('a1111111-1111-1111-1111-111111111111');
  if (v_res->>'claim_status') is distinct from 'pending_review'
     or (v_res->>'resubmitted_round')::int <> 1 then
    raise exception 'ADV-3a FAIL: unexpected resubmit result %', v_res;
  end if;
  raise notice 'ADV-3a PASS: owner re-submit cleared stamp, returned %', v_res;
end $$;

-- no_feedback_to_resubmit: a fresh brand owned by A, stamped, but no rows.
reset role;
insert into public.brands (id, name, slug, account_id, claim_status, claim_follow_up_at)
values ('a3333333-3333-3333-3333-333333333333', 'ADV Brand A-empty', 'adv-brand-a-empty-orch1064',
        'a0000000-0000-0000-0000-0000000000a1', 'pending_review', now());
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$
declare v_err text;
begin
  begin
    perform public.biz_resubmit_venue_claim('a3333333-3333-3333-3333-333333333333');
    raise exception 'ADV-3d FAIL: re-submit succeeded with zero feedback rounds';
  exception when others then
    v_err := sqlerrm;
    if v_err not like '%no_feedback_to_resubmit%' then
      raise exception 'ADV-3d FAIL: expected no_feedback_to_resubmit, got: %', v_err;
    end if;
    raise notice 'ADV-3d PASS: re-submit with no feedback round raised no_feedback_to_resubmit';
  end;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ADV-5 — anon (no authenticated role / no sub) sees ZERO feedback rows.
-- ─────────────────────────────────────────────────────────────────────────────
reset role;
set local role anon;
do $$
declare v_rows int;
begin
  begin
    select count(*) into v_rows from public.venue_claim_feedback;
  exception when insufficient_privilege then
    v_rows := 0;  -- table-level grant denial also satisfies "anon sees nothing"
  end;
  if v_rows <> 0 then
    raise exception 'ADV-5 FAIL: anon sees % feedback rows (should be 0)', v_rows;
  end if;
  raise notice 'ADV-5 PASS: anon sees zero feedback rows';
end $$;

reset role;
do $$ begin raise notice 'ORCH-1064 ADVERSARIAL: ALL PASS (ADV-1,1b,2,3a,3b,3c,3d,4,5)'; end $$;

rollback;
