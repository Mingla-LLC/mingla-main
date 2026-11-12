-- Issue #4389 S-9 — BGN is switched off for new use, with a safety stop
-- (20280629304389_issue_4389_retire_bgn.sql), on the fully replayed PG17 schema.
--
-- MINGLA-INVARIANT: I-4389-BGN-RETIRED-SAFELY | issue #4389 | BGN is switched off in supported_brand_currencies only when no live brand, scheduled/live event or live ticket type uses it; otherwise issue_4389_retire_bgn raises PT409 with the counts and changes nothing.
--
--   B-DONE     after the replay BGN is inactive (no fixture data uses it).
--   B-STOP-1   a live BGN brand: PT409 with the counts, BGN stays active.
--   B-STOP-2   a live BGN event on a EUR brand: PT409, BGN stays active.
--   B-STOP-3   a live BGN ticket type is counted beside its event: PT409.
--   B-IGNORE   deleted brands, drafts and cancelled events (with their ticket
--              types) do not stop it.
--   B-GO       with nothing live on BGN it switches BGN off.
--   B-GRANT    anon and authenticated may not call it.
--
-- FAILS-ON-REVERT: dropping the count guard fails B-STOP-*; dropping the
-- UPDATE fails B-DONE and B-GO.
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

update cron.job set active = false where active;

insert into auth.users (id, email) values ('43890000-0000-4000-a000-0000000b9001', 'bgn.c4389@test.local');
insert into public.creator_accounts (id, created_at) values ('43890000-0000-4000-a000-0000000b9001', now());

create function pg_temp.expect(p_label text, p_ok boolean, p_detail text default null) returns void
language plpgsql as $fn$
begin
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'FAIL %: %', p_label, COALESCE(p_detail, '');
  END IF;
  RAISE NOTICE 'PASS %', p_label;
end;
$fn$;
create function pg_temp.retire() returns text
language plpgsql as $fn$
begin
  return public.issue_4389_retire_bgn();
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$fn$;
create function pg_temp.bgn_active() returns boolean
language sql as $fn$ select active from public.supported_brand_currencies where code = 'BGN'; $fn$;

do $$
begin
  perform pg_temp.expect('B-DONE replay leaves BGN inactive', pg_temp.bgn_active() = false);
end $$;

-- Put BGN back in use for the stop cases.
update public.supported_brand_currencies set active = true where code = 'BGN';

insert into public.brands (id, account_id, name, slug, default_currency)
values ('43890000-0000-4000-b000-0000000b9001', '43890000-0000-4000-a000-0000000b9001', 'Issue 4389 BGN', 'issue4389bgn', 'BGN');

do $$
declare r text;
begin
  r := pg_temp.retire();
  perform pg_temp.expect('B-STOP-1 live BGN brand raises PT409 with counts',
    r like 'PT409 bgn_still_in_use: 1 brand(s), 0 live event(s), 0 live ticket type(s)%', r);
  perform pg_temp.expect('B-STOP-1 BGN stays active', pg_temp.bgn_active());
end $$;

-- A deleted BGN brand does not count.
update public.brands set deleted_at = now() where id = '43890000-0000-4000-b000-0000000b9001';

insert into public.brands (id, account_id, name, slug, default_currency)
values ('43890000-0000-4000-b000-0000000b9002', '43890000-0000-4000-a000-0000000b9001', 'Issue 4389 EUR', 'issue4389eur', 'EUR');
insert into public.events (id, brand_id, title, slug, visibility, status, currency)
values ('43890000-0000-4000-e000-0000000b9001', '43890000-0000-4000-b000-0000000b9002', 'BGN night', 'issue-4389-bgn-night', 'public', 'draft', 'BGN');

do $$
declare r text;
begin
  r := pg_temp.retire();
  perform pg_temp.expect('B-IGNORE a deleted brand and a draft event do not stop it', r = 'bgn_retired', r);
  perform pg_temp.expect('B-IGNORE BGN switched off', pg_temp.bgn_active() = false);
end $$;

update public.supported_brand_currencies set active = true where code = 'BGN';
-- A scheduled BGN event on its own BGN brand, then that brand moved to EUR
-- (the event keeps its BGN prices, which is what the stop is for).
insert into public.brands (id, account_id, name, slug, default_currency)
values ('43890000-0000-4000-b000-0000000b9003', '43890000-0000-4000-a000-0000000b9001', 'Issue 4389 BGN live', 'issue4389bgnlive', 'BGN');
insert into public.events (id, brand_id, title, slug, visibility, status, currency)
values ('43890000-0000-4000-e000-0000000b9002', '43890000-0000-4000-b000-0000000b9003', 'BGN live night', 'issue-4389-bgn-live', 'public', 'scheduled', 'BGN');
update public.brands set default_currency = 'EUR' where id = '43890000-0000-4000-b000-0000000b9003';

do $$
declare r text;
begin
  r := pg_temp.retire();
  perform pg_temp.expect('B-STOP-2 live BGN event raises PT409',
    r like 'PT409 bgn_still_in_use: 0 brand(s), 1 live event(s), 0 live ticket type(s)%', r);
  perform pg_temp.expect('B-STOP-2 BGN stays active', pg_temp.bgn_active());
end $$;

insert into public.ticket_types (id, event_id, name, price_cents, currency)
values ('43890000-0000-4000-f000-0000000b9001', '43890000-0000-4000-e000-0000000b9002', 'BGN ticket', 1000, 'BGN');

do $$
declare r text;
begin
  r := pg_temp.retire();
  perform pg_temp.expect('B-STOP-3 live BGN ticket type is counted too',
    r like 'PT409 bgn_still_in_use: 0 brand(s), 1 live event(s), 1 live ticket type(s)%', r);
  perform pg_temp.expect('B-STOP-3 BGN stays active', pg_temp.bgn_active());
end $$;

-- The event is cancelled: neither it nor its ticket type is live any more.
update public.events set status = 'cancelled' where id = '43890000-0000-4000-e000-0000000b9002';

do $$
declare r text;
begin
  r := pg_temp.retire();
  perform pg_temp.expect('B-GO nothing live on BGN switches it off', r = 'bgn_retired', r);
  perform pg_temp.expect('B-GO BGN inactive', pg_temp.bgn_active() = false);
  perform pg_temp.expect('B-GO other currencies untouched',
    (select count(*) from public.supported_brand_currencies where active) = 14);
  perform pg_temp.expect('B-GRANT anon cannot call it',
    not has_function_privilege('anon', 'public.issue_4389_retire_bgn()', 'execute'));
  perform pg_temp.expect('B-GRANT authenticated cannot call it',
    not has_function_privilege('authenticated', 'public.issue_4389_retire_bgn()', 'execute'));
end $$;

\echo 'issue_4389 retire BGN: ALL PASS'
rollback;
