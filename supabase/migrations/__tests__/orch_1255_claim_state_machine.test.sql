-- META-ORCH-1255 Leg A — T-A7 (SC-3): the FULL D-4 claim state machine on ONE
-- venue row while a SIBLING venue of the SAME brand holds a different state.
--
-- Walk on venue A (with a linked place):
--   pending_review → need_more_info (feedback round; follow_up stamped)
--   → resubmit → pending_review (stamp cleared)
--   → mark_called → approve → verified
--   → admin_suspend_listing → suspended (+ place is_active=false)
--   → resubmit → pending_review → approve → verified.
-- After EVERY transition the sibling venue B's row must be BYTE-IDENTICAL
-- (to_jsonb compare) — per-venue isolation is the whole point of this build.
--
-- Negative arms:
--   * approve without mark_called → must_mark_called_first.
--   * admin feedback on a non-pending (verified) venue → venue_not_pending_review.
--   * resubmit by a non-owner → forbidden.
--
-- Run (LOCAL Supabase Postgres only — NEVER remote):
--   docker exec -i <db-container> psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/migrations/__tests__/orch_1255_claim_state_machine.test.sql
-- ONE transaction, ROLLS BACK — no residue.
--
-- FAILS-ON-REVERT:
--   * Re-point any review RPC at brands.claim_status (D-4 revert) → the walk
--     errors (venue row never transitions) at the first assert.
--   * Drop the sibling-isolation keying (venue_id → brand_id anywhere in the
--     review RPCs) → the sibling-unchanged asserts fail.
--   * Drop the must_mark_called_first guard → NEG-1 fails.

\set ON_ERROR_STOP on
begin;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a1255aaa-0000-4000-8000-000000000011', 'orch1255sm-owner@test.local'),
  ('a1255ddd-0000-4000-8000-000000000012', 'orch1255sm-admin@test.local'),
  ('a1255eee-0000-4000-8000-000000000013', 'orch1255sm-rando@test.local')
on conflict (id) do nothing;

insert into public.creator_accounts (id) values
  ('a1255aaa-0000-4000-8000-000000000011')
on conflict (id) do nothing;

insert into public.admin_users (email, role, status) values
  ('orch1255sm-admin@test.local', 'admin', 'active')
on conflict (email) do nothing;

insert into public.brands (id, account_id, name, slug) values
  ('b1255aaa-0000-4000-8000-000000000011','a1255aaa-0000-4000-8000-000000000011','Orch1255 SM Brand','orch1255smbrand')
on conflict (id) do nothing;

insert into public.place_pool (id, name, lat, lng, google_place_id, is_active) values
  ('e1255aaa-0000-4000-8000-000000000011','Orch1255 SM Place', 38.9, -77.0, 'gplace-orch1255-sm', true)
on conflict (id) do nothing;

create temp table t1255sm_ctx (venue_a uuid, venue_b uuid, sibling_snapshot jsonb);

-- Create venue A (place-linked) + sibling venue B via the real RPC.
do $$
declare
  v_hours jsonb := '[
    {"weekday":0,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":1,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":2,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":3,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":4,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":5,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":6,"open_time":null,"close_time":null,"is_closed":true}
  ]'::jsonb;
  v_a uuid; v_b uuid;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a1255aaa-0000-4000-8000-000000000011', true);
  v_a := public.biz_create_venue_listing(
    'b1255aaa-0000-4000-8000-000000000011',
    'SM Venue A', 'smvenuea', null, 'gplace-orch1255-sm',
    38.9, -77.0, 'Washington', 'US', 'A St',
    'restaurant', null, null, null, null, v_hours,
    'e1255aaa-0000-4000-8000-000000000011');
  v_b := public.biz_create_venue_listing(
    'b1255aaa-0000-4000-8000-000000000011',
    'SM Venue B', 'smvenueb', null, null,
    40.7, -74.0, 'New York', 'US', 'B St',
    'play', null, null, null, null, v_hours, null);
  reset role;
  insert into t1255sm_ctx values (v_a, v_b,
    (select to_jsonb(v) from public.venue_listings v where v.id = v_b));
end $$;

-- Helper: assert the sibling row has not changed at a named step.
create or replace function pg_temp.assert_sibling_unchanged(p_step text)
returns void language plpgsql as $$
declare v_now jsonb; v_snap jsonb; v_b uuid;
begin
  select venue_b, sibling_snapshot into v_b, v_snap from t1255sm_ctx;
  select to_jsonb(v) into v_now from public.venue_listings v where v.id = v_b;
  if v_now is distinct from v_snap then
    raise exception 'T-A7 FAIL [%]: sibling venue mutated: % -> %', p_step, v_snap, v_now;
  end if;
end $$;

-- ── The walk ─────────────────────────────────────────────────────────────────
do $$
declare
  v_a uuid; v_res jsonb; v_status text; v_stamp timestamptz;
begin
  select venue_a into v_a from t1255sm_ctx;

  -- Step 1: admin leaves feedback → need_more_info (pending_review + stamp).
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a1255ddd-0000-4000-8000-000000000012', true);
  v_res := public.admin_add_venue_claim_feedback(
    v_a, '[{"category":"photos","note":"need brighter photos"}]'::jsonb, 'fix these');
  if (v_res->>'round')::int <> 1 then
    raise exception 'T-A7 FAIL: expected feedback round 1, got %', v_res;
  end if;
  reset role;
  select claim_status, claim_follow_up_at into v_status, v_stamp
    from public.venue_listings where id = v_a;
  if v_status <> 'pending_review' or v_stamp is null then
    raise exception 'T-A7 FAIL: need_more_info shape wrong (status=%, stamp=%)', v_status, v_stamp;
  end if;
  perform pg_temp.assert_sibling_unchanged('need_more_info');

  -- NEG: a non-owner cannot resubmit.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a1255eee-0000-4000-8000-000000000013', true);
  begin
    perform public.biz_resubmit_venue_claim(v_a);
    raise exception 'T-A7 FAIL: non-owner resubmit was allowed';
  exception when others then
    if sqlerrm not like '%forbidden%' then
      raise exception 'T-A7 FAIL: expected forbidden on non-owner resubmit, got %', sqlerrm;
    end if;
  end;

  -- Step 2: the OWNER resubmits → clean pending_review.
  perform set_config('request.jwt.claim.sub','a1255aaa-0000-4000-8000-000000000011', true);
  v_res := public.biz_resubmit_venue_claim(v_a);
  reset role;
  select claim_status, claim_follow_up_at into v_status, v_stamp
    from public.venue_listings where id = v_a;
  if v_status <> 'pending_review' or v_stamp is not null then
    raise exception 'T-A7 FAIL: resubmit shape wrong (status=%, stamp=%)', v_status, v_stamp;
  end if;
  perform pg_temp.assert_sibling_unchanged('resubmit-1');

  -- NEG-1: approve BEFORE mark_called → must_mark_called_first.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a1255ddd-0000-4000-8000-000000000012', true);
  begin
    perform public.biz_review_venue_claim(v_a, 'approve');
    raise exception 'T-A7 FAIL: approve without mark_called was allowed';
  exception when others then
    if sqlerrm not like '%must_mark_called_first%' then
      raise exception 'T-A7 FAIL: expected must_mark_called_first, got %', sqlerrm;
    end if;
  end;

  -- Step 3: mark_called, then approve → verified.
  v_res := public.biz_review_venue_claim(v_a, 'mark_called');
  v_res := public.biz_review_venue_claim(v_a, 'approve');
  if v_res->>'claim_status' <> 'verified' then
    raise exception 'T-A7 FAIL: approve did not verify (%)', v_res;
  end if;

  -- NEG: feedback on a VERIFIED venue → venue_not_pending_review.
  begin
    perform public.admin_add_venue_claim_feedback(
      v_a, '[{"category":"other","note":"nope"}]'::jsonb, null);
    raise exception 'T-A7 FAIL: feedback on verified venue was allowed';
  exception when others then
    if sqlerrm not like '%venue_not_pending_review%' then
      raise exception 'T-A7 FAIL: expected venue_not_pending_review, got %', sqlerrm;
    end if;
  end;
  reset role;
  perform pg_temp.assert_sibling_unchanged('approve-1');

  -- Step 4: admin suspends the listing (place-keyed) → suspended + stamp;
  -- the place is pulled off the deck (is_active=false).
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a1255ddd-0000-4000-8000-000000000012', true);
  v_res := public.admin_suspend_listing(
    'e1255aaa-0000-4000-8000-000000000011', 'tighten the photos',
    '[{"category":"photos","note":"photo 2 is a stock image"}]'::jsonb, 'qa');
  reset role;
  if (v_res->>'venue_id')::uuid is distinct from v_a then
    raise exception 'T-A7 FAIL: suspend resolved the wrong venue (%)', v_res;
  end if;
  select claim_status, claim_follow_up_at into v_status, v_stamp
    from public.venue_listings where id = v_a;
  if v_status <> 'suspended' or v_stamp is null then
    raise exception 'T-A7 FAIL: suspend shape wrong (status=%, stamp=%)', v_status, v_stamp;
  end if;
  if (select is_active from public.place_pool where id = 'e1255aaa-0000-4000-8000-000000000011') then
    raise exception 'T-A7 FAIL: suspended place still is_active';
  end if;
  perform pg_temp.assert_sibling_unchanged('suspend');

  -- Step 5: owner resubmits from SUSPENDED → pending_review.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a1255aaa-0000-4000-8000-000000000011', true);
  v_res := public.biz_resubmit_venue_claim(v_a);
  reset role;
  select claim_status into v_status from public.venue_listings where id = v_a;
  if v_status <> 'pending_review' then
    raise exception 'T-A7 FAIL: resubmit-from-suspended → %, expected pending_review', v_status;
  end if;
  perform pg_temp.assert_sibling_unchanged('resubmit-2');

  -- Step 6: approve again → verified (marked_called_at persists from step 3).
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a1255ddd-0000-4000-8000-000000000012', true);
  v_res := public.biz_review_venue_claim(v_a, 'approve');
  reset role;
  if v_res->>'claim_status' <> 'verified' then
    raise exception 'T-A7 FAIL: re-approve did not verify (%)', v_res;
  end if;
  perform pg_temp.assert_sibling_unchanged('approve-2');

  raise notice 'T-A7 PASS: full D-4 walk (need_more_info→resubmit→approve→suspend→resubmit→approve) with sibling byte-identical at every step';
end $$;

rollback;
