-- Issue #2724 implementor happy-path guard (PostgreSQL 17).
-- Runs only against the disposable CI/local database after the full migration
-- chain. One transaction, rollback, no production/existing-row mutation.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('27240000-0000-4000-8000-000000000001', 'issue2724-admin@test.local'),
  ('27240000-0000-4000-8000-000000000002', 'issue2724-member@test.local')
on conflict (id) do nothing;

insert into public.admin_users (email, role, status) values
  ('issue2724-admin@test.local', 'admin', 'active')
on conflict (email) do update set role = excluded.role, status = excluded.status;

insert into public.creator_accounts (id) values
  ('27240000-0000-4000-8000-000000000002')
on conflict (id) do nothing;

insert into public.brands (id, account_id, name, slug) values
  ('27240000-0000-4000-8000-000000000010', '27240000-0000-4000-8000-000000000002', 'Issue 2724 Brand', 'issue2724brand')
on conflict (id) do nothing;

insert into public.venue_listings
  (id, brand_id, slug, name, lat, lng, venue_category, google_place_id, claim_status,
   marked_called_at, marked_called_by)
values
  ('27240000-0000-4000-8000-000000000101', '27240000-0000-4000-8000-000000000010', 'happy', 'Unmarked happy path', 40.71, -74.00, 'restaurant', 'issue2724-happy', 'pending_review', null, null),
  ('27240000-0000-4000-8000-000000000102', '27240000-0000-4000-8000-000000000010', 'oldgate', 'Old-gate control', 40.72, -74.01, 'play', 'issue2724-old-gate', 'pending_review', null, null),
  ('27240000-0000-4000-8000-000000000103', '27240000-0000-4000-8000-000000000010', 'unrelated', 'Unrelated row', 40.73, -74.02, 'creative_and_arts', null, 'pending_review', null, null),
  ('27240000-0000-4000-8000-000000000104', '27240000-0000-4000-8000-000000000010', 'marked', 'Marked path', 40.74, -74.03, 'restaurant', 'issue2724-marked', 'pending_review', now() - interval '1 hour', '27240000-0000-4000-8000-000000000001'),
  ('27240000-0000-4000-8000-000000000105', '27240000-0000-4000-8000-000000000010', 'verifieddup', 'Verified duplicate', 40.75, -74.04, 'restaurant', 'issue2724-duplicate', 'verified', null, null),
  ('27240000-0000-4000-8000-000000000106', '27240000-0000-4000-8000-000000000010', 'pendingdup', 'Pending duplicate', 40.76, -74.05, 'restaurant', 'issue2724-duplicate', 'pending_review', null, null),
  ('27240000-0000-4000-8000-000000000107', '27240000-0000-4000-8000-000000000010', 'nonauth', 'Non-admin control', 40.77, -74.06, 'restaurant', 'issue2724-non-admin', 'pending_review', null, null);

create temp table issue2724_snapshot as
select id, to_jsonb(v) as row_before
from public.venue_listings v
where id = '27240000-0000-4000-8000-000000000103';

do $test$
declare
  v_security_definer boolean;
  v_search_path text[];
begin
  select p.prosecdef, p.proconfig
  into v_security_definer, v_search_path
  from pg_proc p
  where p.oid = 'public.biz_review_venue_claim(uuid,text,text)'::regprocedure;

  if v_security_definer is not true then
    raise exception 'ISSUE-2724 S-1 FAIL: review RPC lost SECURITY DEFINER';
  end if;
  if v_search_path is distinct from array['search_path=public, pg_temp']::text[] then
    raise exception 'ISSUE-2724 S-2 FAIL: review RPC search_path drifted: %', v_search_path;
  end if;
  if has_function_privilege('anon', 'public.biz_review_venue_claim(uuid,text,text)', 'EXECUTE') then
    raise exception 'ISSUE-2724 S-3 FAIL: anon retained EXECUTE';
  end if;
  if not has_function_privilege('authenticated', 'public.biz_review_venue_claim(uuid,text,text)', 'EXECUTE') then
    raise exception 'ISSUE-2724 S-4 FAIL: authenticated lost EXECUTE';
  end if;
end;
$test$;

-- Transaction-local pre-fix equivalent. It recreates only the removed gate,
-- then delegates every other behavior to the real current RPC.
create or replace function pg_temp.issue2724_prefixed_review(p_venue_id uuid)
returns jsonb
language plpgsql
as $function$
declare v_marker timestamptz;
begin
  select marked_called_at into v_marker
  from public.venue_listings
  where id = p_venue_id;
  if v_marker is null then
    raise exception 'must_mark_called_first';
  end if;
  return public.biz_review_venue_claim(p_venue_id, 'approve');
end;
$function$;

do $test$
declare
  v_result jsonb;
  v_before timestamptz;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '27240000-0000-4000-8000-000000000001', true);

  -- H-1/H-2: the real successor approves an unmarked row and preserves both
  -- marker columns as NULL.
  v_result := public.biz_review_venue_claim('27240000-0000-4000-8000-000000000101', 'approve');
  if v_result->>'action' <> 'approve' or v_result->>'claim_status' <> 'verified' then
    raise exception 'ISSUE-2724 H-1 FAIL: unexpected unmarked approval receipt %', v_result;
  end if;
  if not exists (
    select 1 from public.venue_listings
    where id = '27240000-0000-4000-8000-000000000101'
      and claim_status = 'verified'
      and marked_called_at is null
      and marked_called_by is null
  ) then
    raise exception 'ISSUE-2724 H-2 FAIL: approval changed call audit metadata';
  end if;

  -- H-3: repeat retains the existing verified noop contract.
  v_result := public.biz_review_venue_claim('27240000-0000-4000-8000-000000000101', 'approve');
  if coalesce((v_result->>'noop')::boolean, false) is not true
     or v_result->>'claim_status' <> 'verified' then
    raise exception 'ISSUE-2724 H-3 FAIL: repeat approval was not verified noop %', v_result;
  end if;

  -- R-1: true fail-on-revert. The exact pre-fix marker gate rejects the same
  -- otherwise-eligible unmarked shape with its historical reason.
  begin
    perform pg_temp.issue2724_prefixed_review('27240000-0000-4000-8000-000000000102');
    raise exception 'ISSUE-2724 R-1 FAIL: pre-fix guard accepted unmarked approval';
  exception when others then
    if sqlerrm not like '%must_mark_called_first%' then
      raise exception 'ISSUE-2724 R-1 FAIL: expected must_mark_called_first, got %', sqlerrm;
    end if;
  end;

  -- R-2: pass-on-restore through the real successor, same row and caller.
  v_result := public.biz_review_venue_claim('27240000-0000-4000-8000-000000000102', 'approve');
  if v_result->>'claim_status' <> 'verified' then
    raise exception 'ISSUE-2724 R-2 FAIL: restored successor did not approve %', v_result;
  end if;

  -- H-4: the already-marked path still works and preserves its original stamp.
  select marked_called_at into v_before from public.venue_listings
  where id = '27240000-0000-4000-8000-000000000104';
  v_result := public.biz_review_venue_claim('27240000-0000-4000-8000-000000000104', 'approve');
  if v_result->>'claim_status' <> 'verified' or
     (select marked_called_at from public.venue_listings where id = '27240000-0000-4000-8000-000000000104') is distinct from v_before then
    raise exception 'ISSUE-2724 H-4 FAIL: marked approval failed or changed marker %', v_result;
  end if;

  -- H-5: duplicate-place protection remains unchanged.
  begin
    perform public.biz_review_venue_claim('27240000-0000-4000-8000-000000000106', 'approve');
    raise exception 'ISSUE-2724 H-5 FAIL: duplicate Google place was approved';
  exception when others then
    if sqlerrm not like '%google_place_already_verified%' then
      raise exception 'ISSUE-2724 H-5 FAIL: expected duplicate guard, got %', sqlerrm;
    end if;
  end;

  reset role;

  -- H-6: the restoration did not admit an authenticated non-admin.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '27240000-0000-4000-8000-000000000002', true);
  begin
    perform public.biz_review_venue_claim('27240000-0000-4000-8000-000000000107', 'approve');
    raise exception 'ISSUE-2724 H-6 FAIL: authenticated non-admin was admitted';
  exception when others then
    if sqlerrm not like '%forbidden%' then
      raise exception 'ISSUE-2724 H-6 FAIL: expected forbidden, got %', sqlerrm;
    end if;
  end;
  reset role;

  -- H-7: exact-row targeting; unrelated fixture remains byte-identical.
  if exists (
    select 1
    from issue2724_snapshot s
    join public.venue_listings v using (id)
    where to_jsonb(v) is distinct from s.row_before
  ) then
    raise exception 'ISSUE-2724 H-7 FAIL: unrelated venue row changed';
  end if;

  raise notice 'ISSUE-2724 PASS: 13 assertions; pre-fix R-1 failed with must_mark_called_first and restored approval passed';
end;
$test$;

rollback;
