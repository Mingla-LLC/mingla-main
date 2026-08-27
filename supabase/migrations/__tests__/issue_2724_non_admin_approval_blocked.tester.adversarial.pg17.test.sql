-- Issue #2724 independent tester adversarial guard (PostgreSQL 17).
-- Security angle: the same unmarked pending row is denied byte-identically to
-- unauthenticated, authenticated non-admin, and anonymous callers, then is
-- approvable by an authorized admin. Transaction-contained; never production.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('27240000-0000-4000-8000-000000000201', 'issue2724-tester-admin@test.local'),
  ('27240000-0000-4000-8000-000000000202', 'issue2724-tester-member@test.local')
on conflict (id) do nothing;

insert into public.admin_users (email, role, status) values
  ('issue2724-tester-admin@test.local', 'admin', 'active')
on conflict (email) do update set role = excluded.role, status = excluded.status;

insert into public.creator_accounts (id) values
  ('27240000-0000-4000-8000-000000000202')
on conflict (id) do nothing;

insert into public.brands (id, account_id, name, slug) values
  ('27240000-0000-4000-8000-000000000210', '27240000-0000-4000-8000-000000000202', 'Issue 2724 Tester Brand', 'issue2724testerbrand')
on conflict (id) do nothing;

insert into public.venue_listings
  (id, brand_id, slug, name, lat, lng, venue_category, google_place_id, claim_status,
   marked_called_at, marked_called_by)
values
  ('27240000-0000-4000-8000-000000000211', '27240000-0000-4000-8000-000000000210', 'securityboundary', 'Unmarked security boundary', 40.78, -74.07, 'restaurant', 'issue2724-security-boundary', 'pending_review', null, null);

create temp table issue2724_tester_snapshot as
select to_jsonb(v) as row_before
from public.venue_listings v
where id = '27240000-0000-4000-8000-000000000211';

do $test$
declare
  v_result jsonb;
  v_before jsonb;
  v_after jsonb;
begin
  select row_before into v_before from issue2724_tester_snapshot;

  -- A-1: an authenticated principal who owns the fixture brand but is not an
  -- active admin is still forbidden. This is the load-bearing mutant check:
  -- removing is_admin_user from the canonical RPC makes this call mutate.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '27240000-0000-4000-8000-000000000202', true);
  begin
    perform public.biz_review_venue_claim(
      '27240000-0000-4000-8000-000000000211',
      'approve'
    );
    raise exception 'ISSUE-2724 A-1 FAIL: authenticated non-admin approved the claim';
  exception when others then
    if sqlerrm not like '%forbidden%' then
      raise exception 'ISSUE-2724 A-1 FAIL: expected forbidden, got %', sqlerrm;
    end if;
  end;
  reset role;

  select to_jsonb(v) into v_after
  from public.venue_listings v
  where id = '27240000-0000-4000-8000-000000000211';
  if v_after is distinct from v_before then
    raise exception 'ISSUE-2724 A-2 FAIL: row changed after non-admin denial';
  end if;

  -- A-3: authenticated role without a caller identity is rejected before any
  -- transition. This exercises auth independently from the admin membership.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.biz_review_venue_claim(
      '27240000-0000-4000-8000-000000000211',
      'approve'
    );
    raise exception 'ISSUE-2724 A-3 FAIL: unauthenticated caller approved the claim';
  exception when others then
    if sqlerrm not like '%not_authenticated%' then
      raise exception 'ISSUE-2724 A-3 FAIL: expected not_authenticated, got %', sqlerrm;
    end if;
  end;
  reset role;

  select to_jsonb(v) into v_after
  from public.venue_listings v
  where id = '27240000-0000-4000-8000-000000000211';
  if v_after is distinct from v_before then
    raise exception 'ISSUE-2724 A-4 FAIL: row changed after unauthenticated denial';
  end if;

  -- A-5: anon is blocked by the function ACL even with a spoofed admin sub.
  set local role anon;
  perform set_config('request.jwt.claim.sub', '27240000-0000-4000-8000-000000000201', true);
  begin
    perform public.biz_review_venue_claim(
      '27240000-0000-4000-8000-000000000211',
      'approve'
    );
    raise exception 'ISSUE-2724 A-5 FAIL: anonymous caller approved the claim';
  exception when insufficient_privilege then
    null;
  end;
  reset role;

  select to_jsonb(v) into v_after
  from public.venue_listings v
  where id = '27240000-0000-4000-8000-000000000211';
  if v_after is distinct from v_before then
    raise exception 'ISSUE-2724 A-6 FAIL: row changed after anonymous denial';
  end if;

  -- A-7/A-8: authorization, not call metadata or fixture shape, is the only
  -- difference. The active admin approves the exact same still-unmarked row.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '27240000-0000-4000-8000-000000000201', true);
  v_result := public.biz_review_venue_claim(
    '27240000-0000-4000-8000-000000000211',
    'approve'
  );
  if v_result->>'action' <> 'approve' or v_result->>'claim_status' <> 'verified' then
    raise exception 'ISSUE-2724 A-7 FAIL: authorized approval receipt drifted %', v_result;
  end if;
  if not exists (
    select 1 from public.venue_listings
    where id = '27240000-0000-4000-8000-000000000211'
      and claim_status = 'verified'
      and marked_called_at is null
      and marked_called_by is null
  ) then
    raise exception 'ISSUE-2724 A-8 FAIL: admin approval failed or changed call audit';
  end if;
  reset role;

  raise notice 'ISSUE-2724 TESTER PASS: 8 adversarial assertions; three denied caller classes were byte-identical and authorized unmarked approval passed';
end;
$test$;

rollback;
