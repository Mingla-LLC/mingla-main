-- #4130 — independent tester adversarial proof for the Admin polish server side.
--
-- The implementor suites prove the happy paths. This suite attacks the edges
-- each area's implementor test does not reach:
--   T-WORK   Work This week / This month in the caller's time zone: a card
--            closed at 23:30 on a Sunday and one closed at 00:30 on the
--            Monday after land in different weeks in Lagos but the same week
--            in UTC; "on time" follows the caller's own day; a Monday across
--            the New York clock change (8 March 2026) still starts its week.
--   T-MONEY  A sale stamped exactly at a rate snapshot's time uses that
--            snapshot (and one microsecond earlier uses the one before); a
--            currency with no stored rate has no USD figure and never a 0;
--            settling owes-back twice settles nothing the second time; a
--            Sales and marketing teammate cannot settle.
--   T-LIMIT  A raised messaging limit that ends stops applying at that
--            instant (one second either side), sends made under it still
--            count for the month, an end already passed is refused, and the
--            confirm path still takes the advisory lock.
--   T-PEOPLE Marking and unmarking staff/test moves a person in and out of
--            the segment counts; unmarking a rule-matched address keeps them
--            counted; nobody but an admin can mark; a signed-in teammate
--            cannot delete anyone's rows directly.
--   T-BRANDS Payment readiness on the boards for eight edge brands is the
--            same code the Payments rule gives (the shared table below is also
--            asserted in mingla-admin/src/__tests__/
--            issue_4130_admin_polish.tester.adversarial.test.js).
--   T-DROOM  Retention cells of a cohort whose window has not passed are NULL
--            ("too new"), never 0; every non-admin role except a founding
--            partner is refused; anon cannot execute.
--   T-SUPP   Support/Community access per role: announcements and their
--            delivery numbers are admin only; a support teammate moderates;
--            Sales and marketing and a founding partner do neither.
--
-- FAILS-ON-REVERT:
--   * Replacing `(c.closed_at AT TIME ZONE v_tz)` with UTC in
--     ops_period_summary raises lagos_week_split_wrong / lagos_on_time_wrong.
--   * Changing `s.provider_updated_at <= p_at` to `<` in fx_rate_on raises
--     fx_exact_moment_wrong.
--   * Dropping `(l.ends_at IS NULL OR l.ends_at > now())` from
--     brand_messaging_effective_limits raises expired_override_still_applies.
--   * Dropping the NOT EXISTS settlement guard in admin_settle_owes_back
--     raises settled_twice.
-- MINGLA-INVARIANT: I-4130-WORK-WEEK-IN-VIEWER-TZ | issue #4130 | Work week and on-time figures follow the caller's time zone, Monday start.
\set ON_ERROR_STOP on
BEGIN;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

create temp table ta_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into ta_people (who, id, email) values
  ('owner',   '41307777-0000-4000-a000-000000000001', 'ta-owner@mingla-fixture.org'),
  ('admin',   '41307777-0000-4000-a000-000000000002', 'ta-admin@mingla-fixture.org'),
  ('growth',  '41307777-0000-4000-a000-000000000003', 'ta-growth@mingla-fixture.org'),
  ('partner', '41307777-0000-4000-a000-000000000004', 'ta-partner@mingla-fixture.org'),
  ('support', '41307777-0000-4000-a000-000000000005', 'ta-support@mingla-fixture.org'),
  ('nobody',  '41307777-0000-4000-a000-000000000006', 'ta-nobody@mingla-fixture.org'),
  ('host',    '41307777-0000-4000-a000-000000000007', 'ta-host@mingla-fixture.org'),
  ('ruled',   '41307777-0000-4000-a000-000000000008', 'ta-ruled@example.com');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from ta_people;
insert into public.profiles (id, email, display_name, has_completed_onboarding, is_seed, created_at)
select id, email, 'TA ' || who, true, false, now() - interval '200 days' from ta_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('ta-owner@mingla-fixture.org', 'owner', 'active', now()),
  ('ta-admin@mingla-fixture.org', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('ta-growth@mingla-fixture.org', 'growth', 'active', now()),
  ('ta-partner@mingla-fixture.org', 'partner', 'active', now()),
  ('ta-support@mingla-fixture.org', 'growth', 'active', now());
insert into public.support_staff (user_id, enabled, available, display_name, role)
values ('41307777-0000-4000-a000-000000000005', true, true, 'TA support', 'staff');
insert into public.creator_accounts (id, email) values ('41307777-0000-4000-a000-000000000007', 'ta-host@mingla-fixture.org');

create temp table ta_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

create function pg_temp.ta_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  begin
    if p_who = 'anon' then
      set local role anon;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    else
      select id, email into strict v_id, v_email from ta_people where who = p_who;
      set local role authenticated;
      perform set_config('request.jwt.claim.sub', v_id::text, true);
      perform set_config('request.jwt.claim.email', v_email, true);
      perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'email', v_email, 'role', 'authenticated')::text, true);
    end if;
    execute p_sql into v_out;
    reset role;
    return v_out;
  exception when others then
    reset role;
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
end;
$fn$;

create function pg_temp.ta_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into ta_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.ta_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into ta_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

-- ───────────────────────────── T-WORK ─────────────────────────────────────
do $work$
declare
  v_a uuid; v_b uuid; v_c uuid;
  v_j jsonb;
begin
  -- A: due Sunday 1 March, closed Sunday 23:30 Lagos (22:30 UTC).
  -- B: due Sunday 1 March, closed Monday 00:30 Lagos (23:30 UTC on Sunday).
  -- C: due Monday 9 March, closed Monday 00:30 New York, the first Monday after
  --    the clock change (04:30 UTC).
  insert into public.ops_work_cards (title, instructions, done_means, status, due_on, due_source, sprint_id,
    created_by, created_at, updated_by, updated_at, closed_at, closed_by, close_kind)
  values ('TA Sunday close', 'Do this task carefully and say what changed.', 'It is done and checked.', 'done',
    date '2026-03-01', 'explicit', public.ops_sprint_ensure(date '2026-03-01'), 'ta-growth@mingla-fixture.org',
    timestamptz '2026-02-20 10:00+00', 'ta-growth@mingla-fixture.org', timestamptz '2026-03-01 22:30+00',
    timestamptz '2026-03-01 22:30+00', 'ta-growth@mingla-fixture.org', 'done')
  returning id into v_a;
  insert into public.ops_work_cards (title, instructions, done_means, status, due_on, due_source, sprint_id,
    created_by, created_at, updated_by, updated_at, closed_at, closed_by, close_kind)
  values ('TA Monday close', 'Do this task carefully and say what changed.', 'It is done and checked.', 'done',
    date '2026-03-01', 'explicit', public.ops_sprint_ensure(date '2026-03-01'), 'ta-growth@mingla-fixture.org',
    timestamptz '2026-02-20 10:00+00', 'ta-growth@mingla-fixture.org', timestamptz '2026-03-01 23:30+00',
    timestamptz '2026-03-01 23:30+00', 'ta-growth@mingla-fixture.org', 'done')
  returning id into v_b;
  insert into public.ops_work_cards (title, instructions, done_means, status, due_on, due_source, sprint_id,
    created_by, created_at, updated_by, updated_at, closed_at, closed_by, close_kind)
  values ('TA New York close', 'Do this task carefully and say what changed.', 'It is done and checked.', 'done',
    date '2026-03-09', 'explicit', public.ops_sprint_ensure(date '2026-03-09'), 'ta-growth@mingla-fixture.org',
    timestamptz '2026-03-03 10:00+00', 'ta-growth@mingla-fixture.org', timestamptz '2026-03-09 04:30+00',
    timestamptz '2026-03-09 04:30+00', 'ta-growth@mingla-fixture.org', 'done')
  returning id into v_c;
  insert into public.ops_work_people (card_id, email, role, added_by) values
    (v_a, 'ta-growth@mingla-fixture.org', 'owner', 'ta-growth@mingla-fixture.org'),
    (v_b, 'ta-growth@mingla-fixture.org', 'owner', 'ta-growth@mingla-fixture.org'),
    (v_c, 'ta-growth@mingla-fixture.org', 'owner', 'ta-growth@mingla-fixture.org');

  -- Lagos: Monday 23 Feb 00:00 to Monday 9 Mar 00:00 local, for the owner only.
  v_j := pg_temp.ta_as('growth', $q$select public.ops_period_summary(
      timestamptz '2026-02-23 00:00+01', timestamptz '2026-03-09 00:00+01', 'ta-growth@mingla-fixture.org', 'Africa/Lagos')::text$q$)::jsonb;
  perform pg_temp.ta_check('T-WORK', 'Lagos: both cards closed in the two weeks', v_j #>> '{totals,closed}', '2');
  perform pg_temp.ta_check('T-WORK', 'Lagos: only the Sunday close was on time (lagos_on_time_wrong)', v_j #>> '{totals,on_time}', '1');
  perform pg_temp.ta_check('T-WORK', 'Lagos: week of 23 Feb has the Sunday close (lagos_week_split_wrong)',
    (select w->>'closed' from jsonb_array_elements(v_j->'weeks') w where w->>'week' = '2026-02-23'), '1');
  perform pg_temp.ta_check('T-WORK', 'Lagos: week of 2 Mar has the Monday 00:30 close (lagos_week_split_wrong)',
    (select w->>'closed' from jsonb_array_elements(v_j->'weeks') w where w->>'week' = '2026-03-02'), '1');
  perform pg_temp.ta_check('T-WORK', 'Lagos: per-person week split matches the totals',
    (select (w->'by_person'->>'ta-growth@mingla-fixture.org') from jsonb_array_elements(v_j->'weeks') w where w->>'week' = '2026-03-02'), '1');
  perform pg_temp.ta_check('T-WORK', 'Lagos: weeks start on Mondays only',
    (select count(*)::text from jsonb_array_elements(v_j->'weeks') w where extract(isodow from (w->>'week')::date) <> 1), '0');

  -- The same moments read in UTC: both closes are Sunday, both on time, one week.
  v_j := pg_temp.ta_as('growth', $q$select public.ops_period_summary(
      timestamptz '2026-02-23 00:00+00', timestamptz '2026-03-09 00:00+00', 'ta-growth@mingla-fixture.org', 'UTC')::text$q$)::jsonb;
  perform pg_temp.ta_check('T-WORK', 'UTC: both closes on time', v_j #>> '{totals,on_time}', '2');
  perform pg_temp.ta_check('T-WORK', 'UTC: both closes in the week of 23 Feb',
    (select w->>'closed' from jsonb_array_elements(v_j->'weeks') w where w->>'week' = '2026-02-23'), '2');

  -- New York across the clock change: Monday 9 March 00:30 EDT starts the 9 March week.
  v_j := pg_temp.ta_as('growth', $q$select public.ops_period_summary(
      timestamptz '2026-03-02 00:00-05', timestamptz '2026-03-16 00:00-04', 'ta-growth@mingla-fixture.org', 'America/New_York')::text$q$)::jsonb;
  perform pg_temp.ta_check('T-WORK', 'New York: the first Monday after the clock change opens its own week',
    (select w->>'closed' from jsonb_array_elements(v_j->'weeks') w where w->>'week' = '2026-03-09'), '1');
  perform pg_temp.ta_check('T-WORK', 'New York: the week before the change has none of it',
    coalesce((select w->>'closed' from jsonb_array_elements(v_j->'weeks') w where w->>'week' = '2026-03-02'), '0'), '0');
  perform pg_temp.ta_check('T-WORK', 'New York: closed on its due day is on time', v_j #>> '{totals,on_time}', '1');

  -- Edges the gate must refuse in words, and roles it must refuse.
  perform pg_temp.ta_like('T-WORK', 'a period that ends before it starts is refused',
    pg_temp.ta_as('growth', $q$select public.ops_period_summary(timestamptz '2026-03-09 00:00+00', timestamptz '2026-03-02 00:00+00')::text$q$), 'ERR:22023:invalid_query:%');
  perform pg_temp.ta_like('T-WORK', 'an empty-period (from = to) is refused',
    pg_temp.ta_as('growth', $q$select public.ops_period_summary(timestamptz '2026-03-02 00:00+00', timestamptz '2026-03-02 00:00+00')::text$q$), 'ERR:22023:invalid_query:%');
  perform pg_temp.ta_like('T-WORK', 'a period that has not started is refused',
    pg_temp.ta_as('growth', $q$select public.ops_period_summary(now() + interval '3 days', now() + interval '10 days')::text$q$), 'ERR:22023:invalid_query:%');
  perform pg_temp.ta_like('T-WORK', 'a person with no team role is refused',
    pg_temp.ta_as('nobody', $q$select public.ops_period_summary(now() - interval '7 days', now())::text$q$), 'ERR:42501:%');
  perform pg_temp.ta_like('T-WORK', 'anon cannot run the week summary',
    pg_temp.ta_as('anon', $q$select public.ops_period_summary(now() - interval '7 days', now())::text$q$), 'ERR:42501:%');
  perform pg_temp.ta_like('T-WORK', 'anon cannot read what changed',
    pg_temp.ta_as('anon', $q$select public.ops_events_since(now() - interval '1 day')::text$q$), 'ERR:42501:%');
end;
$work$;

-- ───────────────────────────── T-MONEY ────────────────────────────────────
do $money$
declare
  v_s1 constant uuid := '41307777-0000-4000-8f00-000000000001';
  v_s2 constant uuid := '41307777-0000-4000-8f00-000000000002';
  v_brand constant uuid := '41307777-0000-4000-8b00-000000000001';
  v_ev constant uuid := '41307777-0000-4000-8c00-000000000001';
  v_o1 constant uuid := '41307777-0000-4000-8d00-000000000001';
  v_o2 constant uuid := '41307777-0000-4000-8d00-000000000002';
  v_r1 constant uuid := '41307777-0000-4000-8e00-000000000001';
  v_t  constant timestamptz := '2002-03-04 00:02:00+00';
  v_sum jsonb;
  v_res text;
begin
  insert into public.fx_rate_snapshots (id, provider, base_currency_code, provider_updated_at, provider_next_update_at,
    provider_eol_at, fetched_at, stale_after, expires_at, payload_sha256, status)
  values
    (v_s1, 'exchange_rate_api_open_v6', 'USD', v_t - interval '1 day', v_t, v_t + interval '1 day',
      v_t - interval '1 day' + interval '1 hour', v_t, v_t + interval '1 day', 'ta-4130-s1', 'superseded'),
    (v_s2, 'exchange_rate_api_open_v6', 'USD', v_t, v_t + interval '1 day', v_t + interval '2 days',
      v_t + interval '1 hour', v_t + interval '1 day', v_t + interval '2 days', 'ta-4130-s2', 'superseded');
  insert into public.fx_rates (snapshot_id, currency_code, rate_per_base) values
    (v_s1, 'NGN', 1000), (v_s2, 'NGN', 2000), (v_s1, 'USD', 1), (v_s2, 'USD', 1);

  perform pg_temp.ta_check('T-MONEY', 'a moment exactly at a snapshot uses that snapshot (fx_exact_moment_wrong)',
    (public.fx_rate_on('NGN', v_t) = 2000)::text, 'true');
  perform pg_temp.ta_check('T-MONEY', 'one microsecond earlier uses the snapshot before',
    (public.fx_rate_on('NGN', v_t - interval '1 microsecond') = 1000)::text, 'true');
  perform pg_temp.ta_check('T-MONEY', 'a currency with no stored rate has no rate (never 0 or 1)',
    coalesce(public.fx_rate_on('SEK', v_t)::text, 'null'), 'null');

  insert into public.brands (id, account_id, name, slug, default_currency, payment_provider, payment_country,
    pricing_region, pricing_currency, paystack_subaccount_code)
  values (v_brand, '41307777-0000-4000-a000-000000000007', 'TA Moment Club', 'ta-4130-moment', 'NGN', 'paystack',
    'NG', 'NG', 'NGN', 'ACCT_ta4130');
  insert into public.events (id, brand_id, title, slug, status, currency)
  values (v_ev, v_brand, 'TA Moment Night', 'ta-4130-moment-night', 'draft', 'NGN');
  insert into public.orders (id, event_id, total_cents, buyer_total_cents, net_subtotal_cents, currency, payment_status,
    payment_method, source, created_at, confirmed_at, list_subtotal_cents, discount_cents, buyer_fees_cents, tax_cents, pricing_source)
  values
    (v_o1, v_ev, 104500, 104500, 100000, 'NGN', 'paid', 'online_card', 'legacy', v_t, v_t, 100000, 0, 4500, 0, 'computed_at_checkout'),
    (v_o2, v_ev, 2000, 2000, 2000, 'SEK', 'paid', 'online_card', 'legacy', v_t, v_t, 2000, 0, 0, 0, 'computed_at_checkout');
  insert into public.brand_payout_releases (id, brand_id, occurrence_key, surface, provider, currency, anchor_end_at,
    releasable_at, gross_cents, mingla_fee_cents, provider_fee_cents, net_release_cents, organiser_cash_delivered_cents,
    status, released_at, created_at)
  values (v_r1, v_brand, 'ta-4130-r1', 'order', 'paystack', 'ngn', v_t, v_t + interval '1 day', 104500, 4500, 2000,
    100000, 100000, 'released', v_t + interval '1 day', v_t);
  insert into public.payout_release_items (release_id, source_type, source_id, gross_cents, mingla_fee_cents,
    provider_fee_cents, net_cents, source_finalized_at)
  values (v_r1, 'order', v_o1, 104500, 4500, 2000, 100000, v_t);
  insert into public.payout_ledger_adjustments (release_id, brand_id, currency, kind, amount_cents, idempotency_key)
  values (v_r1, v_brand, 'ngn', 'transfer_fee_credit', 700, 'ta-4130-credit-1');

  v_sum := pg_temp.ta_as('admin', format($q$select public.admin_mingla_money_summary(%L, %L)::text$q$,
    v_t, v_t + interval '1 hour'))::jsonb;
  -- 4,500 kobo at 2,000 per USD is 2.25 US cents -> 2 (the snapshot at the sale's own moment).
  perform pg_temp.ta_check('T-MONEY', 'the fee at the snapshot moment converts at that snapshot',
    (select l->>'usd_cents' from jsonb_array_elements(v_sum->'lines') l where l->>'kind' = 'fee' and l->>'currency' = 'NGN'), '2');
  perform pg_temp.ta_check('T-MONEY', 'a currency with no rate keeps its own figure',
    (select l->>'cents' from jsonb_array_elements(v_sum->'lines') l where l->>'kind' = 'buyers_paid' and l->>'currency' = 'SEK'), '2000');
  perform pg_temp.ta_check('T-MONEY', 'a currency with no rate has no USD figure (null, never 0)',
    (select coalesce(l->>'usd_cents', 'null') from jsonb_array_elements(v_sum->'lines') l where l->>'kind' = 'buyers_paid' and l->>'currency' = 'SEK'), 'null');
  perform pg_temp.ta_check('T-MONEY', 'no line ever mixes currencies',
    (select count(*)::text from jsonb_array_elements(v_sum->'lines') l where l->>'currency' is null), '0');

  -- Settle twice: the second finds nothing.
  perform pg_temp.ta_like('T-MONEY', 'Sales and marketing cannot settle owes-back',
    pg_temp.ta_as('growth', $q$select public.admin_settle_owes_back('ngn', 'TA-REF-1', 'Repaid by bank transfer')::text$q$), 'ERR:%not_authorized%');
  perform pg_temp.ta_like('T-MONEY', 'a one-letter reference is refused',
    pg_temp.ta_as('admin', $q$select public.admin_settle_owes_back('ngn', 'x', 'Repaid by bank transfer')::text$q$), 'ERR:%reference_required%');
  v_res := pg_temp.ta_as('admin', $q$select public.admin_settle_owes_back('NGN', 'TA-REF-1', 'Repaid by bank transfer')::text$q$);
  perform pg_temp.ta_check('T-MONEY', 'the first settle settles every open NGN credit',
    case when v_res like 'ERR:%' then v_res else ((v_res::jsonb ->> 'settled_cents')::bigint >= 700)::text end, 'true');
  perform pg_temp.ta_like('T-MONEY', 'settling again settles nothing (settled_twice)',
    pg_temp.ta_as('admin', $q$select public.admin_settle_owes_back('ngn', 'TA-REF-2', 'Repaid by bank transfer')::text$q$), 'ERR:%nothing_to_settle%');
  perform pg_temp.ta_check('T-MONEY', 'the settlement records the signed-in admin, not a client field',
    (select s.settled_by::text from public.payout_owes_back_settlements s
       join public.payout_ledger_adjustments a on a.id = s.adjustment_id where a.idempotency_key = 'ta-4130-credit-1'),
    '41307777-0000-4000-a000-000000000002');
  perform pg_temp.ta_like('T-MONEY', 'anon cannot read the money summary',
    pg_temp.ta_as('anon', $q$select public.admin_mingla_money_summary(null, null)::text$q$), 'ERR:42501:%');
end;
$money$;

-- ───────────────────────────── T-LIMIT ────────────────────────────────────
do $limits$
declare
  v_brand constant uuid := '41307777-0000-4000-8b00-000000000002';
  v_src text;
begin
  insert into public.brands (id, account_id, name, slug)
  values (v_brand, '41307777-0000-4000-a000-000000000007', 'TA Limits Room', 'ta-4130-limits');

  -- An override that already ended one second ago: the default applies.
  insert into public.brand_messaging_limits (brand_id, email_monthly, sms_monthly, push_monthly, week_warning_at, ends_at, reason)
  values (v_brand, 5000, 500, 50, 3, now() - interval '1 second', 'TA launch week');
  select source || ':' || email_monthly into v_src from public.brand_messaging_effective_limits(v_brand);
  perform pg_temp.ta_check('T-LIMIT', 'an override that ended a second ago no longer applies (expired_override_still_applies)',
    (v_src in ('default:1000', 'built_in:1000'))::text, 'true');
  perform pg_temp.ta_check('T-LIMIT', 'push falls back to no limit once the override ends',
    coalesce((select push_monthly::text from public.brand_messaging_effective_limits(v_brand)), 'null'), 'null');

  -- The same override ending one second from now still applies.
  update public.brand_messaging_limits set ends_at = now() + interval '1 second' where brand_id = v_brand;
  select source || ':' || email_monthly into v_src from public.brand_messaging_effective_limits(v_brand);
  perform pg_temp.ta_check('T-LIMIT', 'an override ending a second from now still applies', v_src, 'override:5000');

  perform pg_temp.ta_like('T-LIMIT', 'an admin cannot set an end that has already passed',
    pg_temp.ta_as('admin', format($q$select public.admin_set_brand_messaging_limits(%L, 5000, 500, null, 3, now() - interval '1 minute', 'TA')::text$q$, v_brand)),
    'ERR:%messaging_limit_end_in_past%');
  perform pg_temp.ta_like('T-LIMIT', 'Sales and marketing cannot raise a limit',
    pg_temp.ta_as('growth', format($q$select public.admin_set_brand_messaging_limits(%L, 5000, 500, null, 3, null, 'TA')::text$q$, v_brand)),
    'ERR:%not_authorized%');
  perform pg_temp.ta_like('T-LIMIT', 'a negative limit is refused',
    pg_temp.ta_as('admin', format($q$select public.admin_set_brand_messaging_limits(%L, -1, 500, null, 3, null, 'TA')::text$q$, v_brand)),
    'ERR:%messaging_limit_out_of_bounds%');
  perform pg_temp.ta_check('T-LIMIT', 'a browser session cannot read the limits table directly',
    (pg_temp.ta_as('admin', $q$select count(*)::text from public.brand_messaging_limits$q$) like 'ERR:42501:%')::text, 'true');
  perform pg_temp.ta_check('T-LIMIT', 'the confirm path still serialises brand and channel with the advisory lock',
    (pg_get_functiondef('public.biz_assert_brand_blast_allowance_v1(uuid,text,integer)'::regprocedure) like '%pg_advisory_xact_lock%')::text, 'true');
  perform pg_temp.ta_check('T-LIMIT', 'the monthly count still starts on the 1st, UTC',
    (pg_get_functiondef('public.biz_assert_brand_blast_allowance_v1(uuid,text,integer)'::regprocedure) like '%date_trunc(''month'', timezone(''utc'', now()))%')::text, 'true');
end;
$limits$;

-- ───────────────────────────── T-PEOPLE ───────────────────────────────────
do $people$
declare
  v_before int; v_after int; v_back int;
  v_host constant uuid := '41307777-0000-4000-a000-000000000007';
  v_ruled constant uuid := '41307777-0000-4000-a000-000000000008';
begin
  v_before := (pg_temp.ta_as('admin', $q$select public.admin_people_segments()::text$q$)::jsonb ->> 'internal')::int;
  perform pg_temp.ta_like('T-PEOPLE', 'marking without a reason is refused',
    pg_temp.ta_as('admin', format($q$select public.admin_set_internal_account(%L, true, '   ')::text$q$, v_host)), 'ERR:%reason_required%');
  perform pg_temp.ta_like('T-PEOPLE', 'Sales and marketing cannot mark staff/test',
    pg_temp.ta_as('growth', format($q$select public.admin_set_internal_account(%L, true, 'TA')::text$q$, v_host)), 'ERR:%not_authorized%');
  perform pg_temp.ta_like('T-PEOPLE', 'a founding partner cannot mark staff/test',
    pg_temp.ta_as('partner', format($q$select public.admin_set_internal_account(%L, true, 'TA')::text$q$, v_host)), 'ERR:%not_authorized%');
  perform pg_temp.ta_like('T-PEOPLE', 'marking someone who does not exist is refused',
    pg_temp.ta_as('admin', $q$select public.admin_set_internal_account('41307777-0000-4000-a000-0000000000ff', true, 'TA')::text$q$), 'ERR:%not_found%');

  perform pg_temp.ta_as('admin', format($q$select public.admin_set_internal_account(%L, true, 'TA test host')::text$q$, v_host));
  v_after := (pg_temp.ta_as('admin', $q$select public.admin_people_segments()::text$q$)::jsonb ->> 'internal')::int;
  perform pg_temp.ta_check('T-PEOPLE', 'marking moves the person into Staff and test', (v_after - v_before)::text, '1');
  perform pg_temp.ta_check('T-PEOPLE', 'a marked host no longer shows on the Hosts tab',
    pg_temp.ta_as('admin', format($q$select (public.admin_list_people('host', %L, null, null, 50, 0, null)->>'total')$q$, 'ta-host@')), '0');

  perform pg_temp.ta_as('admin', format($q$select public.admin_set_internal_account(%L, false, 'TA real host after all')::text$q$, v_host));
  v_back := (pg_temp.ta_as('admin', $q$select public.admin_people_segments()::text$q$)::jsonb ->> 'internal')::int;
  perform pg_temp.ta_check('T-PEOPLE', 'unmarking moves them back out', v_back::text, v_before::text);

  -- A rule-matched address (example.com) an admin says is real stays counted.
  perform pg_temp.ta_as('admin', format($q$select public.admin_set_internal_account(%L, false, 'TA a real person on example.com')::text$q$, v_ruled));
  perform pg_temp.ta_check('T-PEOPLE', 'an admin decision beats the email rule',
    pg_temp.ta_as('admin', format($q$select (public.admin_list_people('explorer', %L, null, null, 50, 0, null)->>'total')$q$, 'ta-ruled@')), '1');

  perform pg_temp.ta_check('T-PEOPLE', 'every mark and unmark is audited with the signed-in admin',
    (select count(*)::text from public.admin_audit_log a where a.target_id in (v_host::text, v_ruled::text)
       and a.action in ('person.mark_internal', 'person.unmark_internal')), '3');

  -- A refused delete: a signed-in teammate deleting rows directly removes nothing.
  perform pg_temp.ta_as('admin', format($q$with d as (delete from public.profiles where id = %L returning 1) select count(*)::text from d$q$, v_host));
  perform pg_temp.ta_check('T-PEOPLE', 'a direct profile delete from the browser removes nothing',
    (select count(*)::text from public.profiles where id = v_host), '1');
  perform pg_temp.ta_as('admin', format($q$with d as (delete from public.creator_accounts where id = %L returning 1) select count(*)::text from d$q$, v_host));
  perform pg_temp.ta_check('T-PEOPLE', 'a direct business-account delete from the browser removes nothing',
    (select count(*)::text from public.creator_accounts where id = v_host), '1');
  perform pg_temp.ta_check('T-PEOPLE', 'the staff/test table is not writable from the browser',
    (pg_temp.ta_as('admin', format($q$insert into public.admin_internal_accounts (user_id, is_internal, reason, marked_by) values (%L, true, 'x', 'x') returning 'wrote'$q$, v_host)) like 'ERR:42501:%')::text, 'true');
end;
$people$;

-- ───────────────────────────── T-BRANDS ───────────────────────────────────
-- Shared expectation table (also asserted by the JS rule test):
--   b1 paystack, active recipient, no subaccount       -> paystack_ready
--   b2 paystack, subaccount, no recipient              -> paystack_needs_action
--   b3 paystack, only an inactive recipient            -> paystack_no_setup
--   b4 stripe, charges+payouts on, overdue requirement -> stripe_needs_action
--   b5 stripe, charges+payouts on, account detached    -> stripe_needs_action
--   b6 stripe, charges on, payouts off                 -> stripe_needs_action
--   b7 stripe, nothing set up                          -> stripe_no_setup
--   b8 stripe, charges+payouts on, nothing overdue     -> stripe_ready
do $brands$
declare
  v_host constant uuid := '41307777-0000-4000-a000-000000000007';
  r record;
  v_board jsonb;
  v_pay jsonb;
begin
  insert into public.brands (id, account_id, name, slug, payment_provider, paystack_subaccount_code) values
    ('41307777-0000-4000-8b10-000000000001', v_host, 'TA RB1', 'ta-4130-rb1', 'paystack', null),
    ('41307777-0000-4000-8b10-000000000002', v_host, 'TA RB2', 'ta-4130-rb2', 'paystack', 'ACCT_ta4130rb2'),
    ('41307777-0000-4000-8b10-000000000003', v_host, 'TA RB3', 'ta-4130-rb3', 'paystack', null),
    ('41307777-0000-4000-8b10-000000000004', v_host, 'TA RB4', 'ta-4130-rb4', 'stripe', null),
    ('41307777-0000-4000-8b10-000000000005', v_host, 'TA RB5', 'ta-4130-rb5', 'stripe', null),
    ('41307777-0000-4000-8b10-000000000006', v_host, 'TA RB6', 'ta-4130-rb6', 'stripe', null),
    ('41307777-0000-4000-8b10-000000000007', v_host, 'TA RB7', 'ta-4130-rb7', 'stripe', null),
    ('41307777-0000-4000-8b10-000000000008', v_host, 'TA RB8', 'ta-4130-rb8', 'stripe', null);
  insert into public.brand_paystack_recipients (brand_id, recipient_code, bank_code, account_fingerprint, account_number_masked, account_name, is_active) values
    ('41307777-0000-4000-8b10-000000000001', 'RCP_ta4130rb1', '058', 'hmac-sha256:' || repeat('a', 64), '••••0001', 'TA One', true),
    ('41307777-0000-4000-8b10-000000000003', 'RCP_ta4130rb3', '058', 'hmac-sha256:' || repeat('b', 64), '••••0003', 'TA Three', false);
  insert into public.stripe_connect_accounts (brand_id, stripe_account_id, charges_enabled, payouts_enabled, country, default_currency, requirements, detached_at) values
    ('41307777-0000-4000-8b10-000000000004', 'acct_ta4130rb4', true, true, 'US', 'usd', '{"past_due":["individual.id_number"]}', null),
    ('41307777-0000-4000-8b10-000000000005', 'acct_ta4130rb5', true, true, 'US', 'usd', '{}', now()),
    ('41307777-0000-4000-8b10-000000000006', 'acct_ta4130rb6', true, false, 'US', 'usd', '{}', null),
    ('41307777-0000-4000-8b10-000000000008', 'acct_ta4130rb8', true, true, 'US', 'usd', '{}', null);

  create temp table ta_expect (n int primary key, code text) on commit drop;
  insert into ta_expect values (1, 'paystack_ready'), (2, 'paystack_needs_action'), (3, 'paystack_no_setup'),
    (4, 'stripe_needs_action'), (5, 'stripe_needs_action'), (6, 'stripe_needs_action'), (7, 'stripe_no_setup'), (8, 'stripe_ready');

  v_board := pg_temp.ta_as('admin', $q$select public.admin_list_brands_board('TA RB', true, null, 'created_desc', 100, 0)::text$q$)::jsonb;
  v_pay := pg_temp.ta_as('admin', $q$select public.admin_list_brand_payment_readiness(null)::text$q$)::jsonb;
  for r in select e.n, e.code, ('41307777-0000-4000-8b10-00000000000' || e.n)::uuid as id from ta_expect e order by e.n loop
    perform pg_temp.ta_check('T-BRANDS', format('board readiness of RB%s', r.n),
      (select b->>'payment_readiness' from jsonb_array_elements(v_board->'rows') b where (b->>'brand_id' = r.id::text or b->>'id' = r.id::text)), r.code);
    perform pg_temp.ta_check('T-BRANDS', format('server helper of RB%s', r.n), public.admin_brand_payment_readiness(r.id), r.code);
    -- The Payments facts the JS rule reads must carry the same deciding inputs.
    if exists (select 1 from jsonb_array_elements(v_pay->'rows') p where p->>'brand_id' = r.id::text) then
      perform pg_temp.ta_check('T-BRANDS', format('Payments facts of RB%s give the same code', r.n),
        (select case
           when coalesce(nullif(lower(p->>'payment_provider'), ''), case when (p->>'paystack_recipient_active')::boolean or p->>'paystack_subaccount_code' is not null then 'paystack' else 'stripe' end) = 'paystack'
             then case when (p->>'paystack_recipient_active')::boolean then 'paystack_ready'
                       when p->>'paystack_subaccount_code' is not null then 'paystack_needs_action' else 'paystack_no_setup' end
           else case when not (p->>'has_stripe_account')::boolean and p->>'stripe_connect_id' is null then 'stripe_no_setup'
                     when (p->>'stripe_detached')::boolean then 'stripe_needs_action'
                     when (p->>'stripe_past_due_count')::int > 0 then 'stripe_needs_action'
                     when not (p->>'stripe_charges_enabled')::boolean then 'stripe_needs_action'
                     when not (p->>'stripe_payouts_enabled')::boolean then 'stripe_needs_action'
                     else 'stripe_ready' end end
         from jsonb_array_elements(v_pay->'rows') p where p->>'brand_id' = r.id::text), r.code);
    end if;
  end loop;
  perform pg_temp.ta_check('T-BRANDS', 'the Paystack brand with nothing set up is listed on Payments',
    (select count(*)::text from jsonb_array_elements(v_pay->'rows') p where p->>'brand_id' = '41307777-0000-4000-8b10-000000000003'), '1');
end;
$brands$;

-- ───────────────────────────── T-DROOM ────────────────────────────────────
do $droom$
declare
  v_new constant uuid := '41307777-0000-4000-a000-000000000010';
  v_j jsonb;
  v_month text := to_char(date_trunc('month', now() AT TIME ZONE 'UTC'), 'YYYY-MM');
begin
  -- Nobody else may share this month's cohort: move every other profile of this
  -- month back so the cohort holds one person who signed up today.
  -- Read live, not a snapshot an earlier nightly run may have stored today.
  delete from public.analytics_daily_snapshot where snapshot_date = (now() AT TIME ZONE 'UTC')::date;
  update public.profiles set created_at = created_at - interval '400 days'
   where created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  insert into auth.users (id, email, email_confirmed_at) values (v_new, 'ta-newcomer@mingla-fixture.org', now());
  insert into public.profiles (id, email, display_name, has_completed_onboarding, is_seed, created_at)
  values (v_new, 'ta-newcomer@mingla-fixture.org', 'TA newcomer', true, false, now());

  v_j := pg_temp.ta_as('partner', $q$select public.admin_data_room_retention(null)::text$q$)::jsonb;
  perform pg_temp.ta_check('T-DROOM', 'a founding partner reads retention', (v_j ? 'data')::text, 'true');
  perform pg_temp.ta_check('T-DROOM', 'this month''s cohort D7 is too new (null), never 0',
    coalesce((select c->>'d7' from jsonb_array_elements(v_j #> '{data,cohorts,explorer}') c where c->>'month' = v_month), 'null'), 'null');
  perform pg_temp.ta_check('T-DROOM', 'this month''s cohort D30 is too new (null), never 0',
    coalesce((select c->>'d30' from jsonb_array_elements(v_j #> '{data,cohorts,explorer}') c where c->>'month' = v_month), 'null'), 'null');
  perform pg_temp.ta_check('T-DROOM', 'this month''s cohort still counts its people',
    (select c->>'people' from jsonb_array_elements(v_j #> '{data,cohorts,explorer}') c where c->>'month' = v_month), '1');

  perform pg_temp.ta_like('T-DROOM', 'Sales and marketing is refused', pg_temp.ta_as('growth', $q$select public.admin_data_room_users(null)::text$q$), 'ERR:42501:%');
  perform pg_temp.ta_like('T-DROOM', 'a support teammate is refused', pg_temp.ta_as('support', $q$select public.admin_data_room_overview(null)::text$q$), 'ERR:42501:%');
  perform pg_temp.ta_like('T-DROOM', 'a person with no role is refused', pg_temp.ta_as('nobody', $q$select public.admin_data_room_money(null)::text$q$), 'ERR:42501:%');
  perform pg_temp.ta_like('T-DROOM', 'anon is refused', pg_temp.ta_as('anon', $q$select public.admin_data_room_retention(null)::text$q$), 'ERR:42501:%');
  perform pg_temp.ta_like('T-DROOM', 'a day with no snapshot is refused, not computed live',
    pg_temp.ta_as('admin', $q$select public.admin_data_room_users((now() AT TIME ZONE 'UTC')::date - 3)::text$q$), 'ERR:P0002:%');
  perform pg_temp.ta_check('T-DROOM', 'the snapshot table is not readable from the browser',
    (pg_temp.ta_as('partner', $q$select count(*)::text from public.analytics_daily_snapshot$q$) like 'ERR:42501:%')::text, 'true');
end;
$droom$;

-- ───────────────────────────── T-SUPP ─────────────────────────────────────
do $supp$
begin
  perform pg_temp.ta_check('T-SUPP', 'admin can publish announcements',
    pg_temp.ta_as('admin', $q$select public.community_can('publish_announcement')::text$q$), 'true');
  perform pg_temp.ta_check('T-SUPP', 'a support teammate cannot publish announcements',
    pg_temp.ta_as('support', $q$select public.community_can('publish_announcement')::text$q$), 'false');
  perform pg_temp.ta_check('T-SUPP', 'a support teammate can moderate',
    pg_temp.ta_as('support', $q$select public.community_can('moderate')::text$q$), 'true');
  perform pg_temp.ta_check('T-SUPP', 'Sales and marketing cannot moderate',
    pg_temp.ta_as('growth', $q$select public.community_can('moderate')::text$q$), 'false');
  perform pg_temp.ta_check('T-SUPP', 'a founding partner cannot moderate',
    pg_temp.ta_as('partner', $q$select public.community_can('moderate')::text$q$), 'false');
  perform pg_temp.ta_like('T-SUPP', 'a support teammate cannot read announcement delivery numbers',
    pg_temp.ta_as('support', $q$select count(*)::text from public.issue_3720_admin_announcement_deliveries()$q$), 'ERR:42501:%');
  perform pg_temp.ta_like('T-SUPP', 'Sales and marketing cannot read announcement delivery numbers',
    pg_temp.ta_as('growth', $q$select count(*)::text from public.issue_3720_admin_announcement_deliveries()$q$), 'ERR:42501:%');
  perform pg_temp.ta_check('T-SUPP', 'the support teammate gets the Support and Community areas',
    pg_temp.ta_as('support', $q$select (public.admin_team_my_operational_areas() @> array['community_support_support', 'community_support_community'])::text$q$), 'true');
  perform pg_temp.ta_check('T-SUPP', 'Sales and marketing gets neither area',
    pg_temp.ta_as('growth', $q$select (public.admin_team_my_operational_areas() && array['community_support_support', 'community_support_community'])::text$q$), 'false');
  perform pg_temp.ta_check('T-SUPP', 'a founding partner gets neither area',
    pg_temp.ta_as('partner', $q$select (public.admin_team_my_operational_areas() && array['community_support_support', 'community_support_community'])::text$q$), 'false');
  perform pg_temp.ta_like('T-SUPP', 'a support teammate cannot open the admin Dashboard numbers',
    pg_temp.ta_as('support', $q$select public.admin_dashboard_summary(null)::text$q$), 'ERR:%not_authorized%');
end;
$supp$;

-- T-RULE (retest): the reserved test domains are matched on the whole last
-- label only, case-insensitively; near misses and subdomains of the Google
-- test-device domain are real people. The JS adversarial suite reads this
-- exact list and checks the browser mirror gives the same answer for each.
do $rule$
declare
  v_case record;
begin
  for v_case in
    select * from (values
      -- T-RULE-CASES-BEGIN
      ('A@Foo.TEST', true),
      ('x@my.example', true),
      ('x@a.localhost', true),
      ('x@dev.box.invalid', true),
      ('tester@foo.test', true),
      ('x@sub.cloudtestlabaccounts.com', false),
      ('x@cloudtestlabaccounts.co', false),
      ('x@foo.testing', false),
      ('x@foo.invalid.ng', false),
      ('x@foo-test.com', false),
      ('x@test', false),
      ('x@example', false),
      ('x@localhost.com', false),
      ('ade@latest.ng', false)
      -- T-RULE-CASES-END
    ) as t(email, expected)
  loop
    perform pg_temp.ta_check('T-RULE', format('email rule %L', v_case.email),
      public.admin_internal_email_rule(v_case.email)::text, v_case.expected::text);
  end loop;
end;
$rule$;

select count(*) as ta_total, count(*) filter (where not ok) as ta_failed,
       coalesce(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' order by seq) filter (where not ok), 'none') as ta_failures
  from ta_results \gset
rollback;

select (:ta_total < 60 or :ta_failed > 0) as ta_bad \gset
\if :ta_bad
  \echo 'ISSUE-4130 ADMIN POLISH TESTER ADVERSARIAL FAILED:' :ta_failed 'of' :ta_total
  \echo :ta_failures
  do $$ begin raise exception 'ISSUE-4130 ADMIN POLISH TESTER ADVERSARIAL FAIL'; end $$;
\endif
\echo 'ISSUE-4130 ADMIN POLISH TESTER ADVERSARIAL PASS:' :ta_total 'checks, 0 failed'
