-- #2879 / #2947 slice 2 — implementor happy path. Run after the full migration chain
-- on PostgreSQL 17 as the database owner. Every case rolls back.
--
-- WHAT IS PROVED
--   C-01  'infinity' HOLDS in every held reader, executed (not grepped): derived_held,
--         ticket_types.held_count, the capacity guard (a real create-session call that
--         must refuse), and the public bundle's `remaining`. Zero reader re-emitted.
--         Control: the same session pushed past expiry stops holding, so the readers do
--         react to expires_at (the carrier is not vacuously true).
--   C-02  admission starts the clock: queued -> admitted, expires_at becomes a real
--         timestamp ~15 min out and is no longer 'infinity', held_count is unchanged.
--         A second run with no elapsed time admits nothing (token bucket).
--   C-03  governor: n = LEAST(bucket, max_concurrent_live_holds - live holds).
--   C-04  quiet path: unarmed tier is not engaged, cannot join, driver admits nothing;
--         armed-but-below-threshold is still invisible.
--   C-05  the cron caller exists in cron.job, from the database.
--   C-06  capacity cut releases the NEWEST holds first and spares in-flight payments.
--   C-07  queue_state never carries a raw expires_at and holdSecondsRemaining is
--         NULL until admission.
--
-- FAILS-ON-REVERT: drop the migrations -> every case fails at its first call.
-- Replace the cron.schedule with nothing -> C-05 fails. Change the admit call out of
-- the driver -> C-02 admits 0 and expires_at stays 'infinity'.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.i2947_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #2947 queue admission FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

-- A published free event with one tier of p_total seats. Returns event + tier.
CREATE OR REPLACE FUNCTION pg_temp.i2947_tier(p_tag text, p_total integer, OUT o_event uuid, OUT o_tier uuid)
LANGUAGE plpgsql AS $f$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
BEGIN
  o_event := gen_random_uuid();
  INSERT INTO auth.users(id, email) VALUES (v_user, 'i2947-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
                            pricing_currency, default_currency)
    VALUES (v_brand, v_user, 'Issue 2947 ' || p_tag, 'issue-2947-' || p_tag || '-' || v_brand,
            'stripe', 'US', 'USD', 'USD');
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility,
                            timezone, currency, published_at, theme)
    VALUES (o_event, v_brand, 'Issue 2947 ' || p_tag, 'issue-2947-' || p_tag || '-' || o_event,
            'event', 'scheduled', 'public', 'UTC', 'USD', now(),
            jsonb_build_object('business_event', jsonb_build_object(
              'format', 'in_person', 'hideAddressUntilTicket', false,
              'settings', jsonb_build_object('privateGuestList', false))));
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (o_event, now() + interval '20 days', now() + interval '20 days 4 hours', 'UTC', true);
  INSERT INTO public.ticket_types(event_id, name, price_cents, quantity_total, currency)
    VALUES (o_event, 'GA', 0, p_total, 'USD') RETURNING id INTO o_tier;
END
$f$;

-- A real hold through the real guard. p_expires may be 'infinity'.
CREATE OR REPLACE FUNCTION pg_temp.i2947_hold(p_event uuid, p_tier uuid, p_qty integer, p_expires timestamptz)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v := public.biz_ticket_checkout_create_session(
    p_event, NULL, 'Queue Guest', 'queue@example.test', '+15550002947', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', p_tier, 'quantity', p_qty)),
    'i2947:' || gen_random_uuid()::text, p_expires, 0, 'auto', NULL);
  RETURN (v ->> 'checkoutSessionId')::uuid;
END
$f$;

CREATE OR REPLACE FUNCTION pg_temp.i2947_hold_err(p_event uuid, p_tier uuid, p_qty integer, p_expires timestamptz)
RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_temp.i2947_hold(p_event, p_tier, p_qty, p_expires);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END
$f$;

CREATE OR REPLACE FUNCTION pg_temp.i2947_token(p_n integer)
RETURNS text LANGUAGE sql IMMUTABLE AS $t$
  SELECT md5('i2947-device-' || p_n) || md5('i2947-device-pad-' || p_n)
$t$;

-- Arm, make the threshold trivial, and back-date the bucket so credit exists.
CREATE OR REPLACE FUNCTION pg_temp.i2947_arm(p_tier uuid, p_threshold integer, p_idle_seconds integer)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  UPDATE public.ticket_queue_admission_settings SET arm_threshold_concurrent_holds = p_threshold;
  PERFORM public.issue_2947_queue_arm(p_tier);
  UPDATE public.ticket_queue_arming
     SET last_admitted_at = clock_timestamp() - make_interval(secs => p_idle_seconds)
   WHERE ticket_type_id = p_tier;
END
$f$;


-- A capacity cut as rule 5 means it. Main's issue_1930_ticket_types_revoke trigger
-- would fail every open hold on any quantity_total edit before the release function
-- could choose (see the migration header and #2879), so it is switched off inside this
-- rolled-back transaction and the release function is called directly.
CREATE OR REPLACE FUNCTION pg_temp.i2947_cut(p_tier uuid, p_total integer)
RETURNS integer LANGUAGE plpgsql AS $f$
BEGIN
  ALTER TABLE public.ticket_types DISABLE TRIGGER issue_1930_ticket_types_revoke;
  UPDATE public.ticket_types SET quantity_total = p_total WHERE id = p_tier;
  RETURN public.issue_2947_release_newest_holds(p_tier);
END
$f$;


-- Every join in one test transaction shares now(), so give each entry a distinct,
-- explicit joined_at; real joins are separate transactions and need no such help.
CREATE OR REPLACE FUNCTION pg_temp.i2947_join_aged(p_session uuid, p_token text, p_age_seconds integer)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM public.issue_2947_queue_join(p_session, p_token);
  UPDATE public.ticket_queue_entries SET joined_at = clock_timestamp() - make_interval(secs => p_age_seconds)
   WHERE checkout_session_id = p_session;
END
$f$;

-- ─── C-01: infinity holds in every held reader ─────────────────────────────────────
BEGIN;
DO $c01$
DECLARE
  f record;
  v_s uuid;
  v_s2 uuid;
  v_b jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.i2947_tier('c01', 10);
  v_s := pg_temp.i2947_hold(f.o_event, f.o_tier, 3, 'infinity'::timestamptz);

  PERFORM pg_temp.i2947_assert(
    (SELECT expires_at FROM public.ticket_checkout_sessions WHERE id = v_s) = 'infinity'::timestamptz,
    'C-01a the real create-session path stores expires_at = infinity untouched');
  PERFORM pg_temp.i2947_assert(public.issue_2491_derived_held(f.o_tier) = 3,
    'C-01b issue_2491_derived_held counts the infinity hold (3)');
  PERFORM pg_temp.i2947_assert(
    (SELECT held_count FROM public.ticket_types WHERE id = f.o_tier) = 3,
    'C-01c ticket_types.held_count counts the infinity hold (3)');
  v_b := public.pg_direct_event_checkout_bundle(f.o_event, NULL, NULL)::jsonb;
  PERFORM pg_temp.i2947_assert((v_b #>> '{tickets,0,remaining}')::int = 7,
    'C-01d the public bundle remaining moved 10 -> 7');
  PERFORM pg_temp.i2947_assert(
    pg_temp.i2947_hold_err(f.o_event, f.o_tier, 8, now() + interval '15 minutes') ~ 'ticket_capacity_exceeded',
    'C-01e the capacity guard (v_reserved) refuses 8 against the 7 left, so it counts infinity');
  PERFORM pg_temp.i2947_assert(
    pg_temp.i2947_hold_err(f.o_event, f.o_tier, 7, now() + interval '15 minutes') IS NULL,
    'C-01f the guard still admits exactly the 7 that remain');

  -- Control: an expired hold stops holding, so the readers do react to expires_at.
  SELECT * INTO f FROM pg_temp.i2947_tier('c01ctl', 10);
  v_s2 := pg_temp.i2947_hold(f.o_event, f.o_tier, 4, 'infinity'::timestamptz);
  UPDATE public.ticket_checkout_sessions SET expires_at = now() - interval '1 minute' WHERE id = v_s2;
  PERFORM pg_temp.i2947_assert(public.issue_2491_derived_held(f.o_tier) = 0,
    'C-01g control: the same hold past expiry holds nothing');
  PERFORM pg_temp.i2947_assert(
    ((public.pg_direct_event_checkout_bundle(f.o_event, NULL, NULL)::jsonb) #>> '{tickets,0,remaining}')::int = 10,
    'C-01h control: the bundle gives the stock back past expiry');

  -- NULL is not a carrier: the column refuses it, so a NULL hold cannot exist.
  BEGIN
    UPDATE public.ticket_checkout_sessions SET expires_at = NULL WHERE id = v_s;
    RAISE EXCEPTION 'C-01i NULL expiry was accepted';
  EXCEPTION WHEN not_null_violation THEN
    PERFORM pg_temp.i2947_assert(true, 'C-01i expires_at is NOT NULL, so NULL can never carry a hold');
  END;
END
$c01$;
ROLLBACK;

-- ─── C-02: admission starts the clock; bucket makes a double fire a no-op ───────────
BEGIN;
DO $c02$
DECLARE
  f record;
  v_ids uuid[] := '{}';
  v_s uuid;
  v_held_before integer;
  v_n integer;
  i integer;
BEGIN
  SELECT * INTO f FROM pg_temp.i2947_tier('c02', 100);
  PERFORM pg_temp.i2947_arm(f.o_tier, 1, 10);   -- threshold 1, 10 s of bucket credit at 20/s = 200
  FOR i IN 1..5 LOOP
    v_s := pg_temp.i2947_hold(f.o_event, f.o_tier, 2, 'infinity'::timestamptz);
    v_ids := v_ids || v_s;
    PERFORM public.issue_2947_queue_join(v_s, pg_temp.i2947_token(i));
  END LOOP;
  v_held_before := (SELECT held_count FROM public.ticket_types WHERE id = f.o_tier);
  PERFORM pg_temp.i2947_assert(v_held_before = 10, 'C-02a five queued holds of 2 hold 10 seats');
  PERFORM pg_temp.i2947_assert(
    (SELECT count(*) FROM public.ticket_queue_entries WHERE ticket_type_id = f.o_tier AND admitted_at IS NULL) = 5,
    'C-02b five waiting entries before the driver runs');

  v_n := public.issue_2947_queue_admit_due();
  PERFORM pg_temp.i2947_assert(v_n = 5, 'C-02c the driver admits all 5 (got ' || v_n || ')');
  PERFORM pg_temp.i2947_assert(
    (SELECT count(*) FROM public.ticket_queue_entries WHERE ticket_type_id = f.o_tier AND admitted_at IS NOT NULL) = 5,
    'C-02d five entries carry admitted_at');
  PERFORM pg_temp.i2947_assert(
    (SELECT bool_and(expires_at <> 'infinity'::timestamptz
                     AND expires_at BETWEEN now() + interval '14 minutes' AND now() + interval '16 minutes')
       FROM public.ticket_checkout_sessions WHERE id = ANY (v_ids)),
    'C-02e every session expires_at is a real timestamp about 15 minutes out');
  PERFORM pg_temp.i2947_assert(
    (SELECT held_count FROM public.ticket_types WHERE id = f.o_tier) = v_held_before,
    'C-02f held_count is unchanged: admission starts a clock, it does not change what is held');
  PERFORM pg_temp.i2947_assert(
    (SELECT count(*) FROM public.ticket_checkout_sessions WHERE id = ANY (v_ids) AND status = 'pending_free') = 5,
    'C-02g admission never changes a session status');

  v_n := public.issue_2947_queue_admit_due();
  PERFORM pg_temp.i2947_assert(v_n = 0, 'C-02h a second run with no elapsed time admits nothing');
END
$c02$;
ROLLBACK;

-- ─── C-03: LEAST(token bucket, max_concurrent_live_holds - live) ────────────────────
BEGIN;
DO $c03$
DECLARE
  f record;
  v_s uuid;
  v_first uuid;
  i integer;
BEGIN
  SELECT * INTO f FROM pg_temp.i2947_tier('c03', 100);
  PERFORM pg_temp.i2947_arm(f.o_tier, 1, 600);   -- bucket credit 12000, far above the ceiling
  UPDATE public.ticket_queue_arming SET max_concurrent_live_holds = 3 WHERE ticket_type_id = f.o_tier;
  FOR i IN 1..8 LOOP
    v_s := pg_temp.i2947_hold(f.o_event, f.o_tier, 1, 'infinity'::timestamptz);
    IF i = 1 THEN v_first := v_s; END IF;
    PERFORM public.issue_2947_queue_join(v_s, pg_temp.i2947_token(i));
  END LOOP;

  PERFORM pg_temp.i2947_assert(public.issue_2947_queue_admit_due() = 3,
    'C-03a the ceiling (3) wins over a 12000-token bucket');
  UPDATE public.ticket_queue_arming SET last_admitted_at = clock_timestamp() - interval '600 seconds'
   WHERE ticket_type_id = f.o_tier;
  PERFORM pg_temp.i2947_assert(public.issue_2947_queue_admit_due() = 0,
    'C-03b with 3 live holds against a ceiling of 3, nothing more is admitted');

  SELECT q.checkout_session_id INTO v_first FROM public.ticket_queue_entries q
   WHERE q.ticket_type_id = f.o_tier AND q.admitted_at IS NOT NULL LIMIT 1;
  UPDATE public.ticket_checkout_sessions SET expires_at = now() - interval '1 minute'
   WHERE id = v_first;
  PERFORM pg_temp.i2947_assert(public.issue_2947_queue_admit_due() = 1,
    'C-03c one live hold lapses, so exactly one more is admitted');

  -- Bucket wins when it is the smaller number: 1 s of credit at 2/s = 2.
  UPDATE public.ticket_queue_arming
     SET max_concurrent_live_holds = 1000, admission_rate_per_sec = 2,
         last_admitted_at = clock_timestamp() - interval '1 second'
   WHERE ticket_type_id = f.o_tier;
  PERFORM pg_temp.i2947_assert(public.issue_2947_queue_admit_due() = 2,
    'C-03d the bucket (2) wins when it is below the ceiling');
END
$c03$;
ROLLBACK;

-- ─── C-04: the quiet path is invisible ──────────────────────────────────────────────
BEGIN;
DO $c04$
DECLARE
  f record;
  v_s uuid;
BEGIN
  SELECT * INTO f FROM pg_temp.i2947_tier('c04', 100);
  PERFORM pg_temp.i2947_assert(NOT public.issue_2947_queue_engaged(f.o_tier),
    'C-04a an unarmed tier is not engaged');
  PERFORM pg_temp.i2947_assert(public.issue_2947_queue_admit_due() = 0,
    'C-04b the driver with nothing armed admits nothing');
  PERFORM pg_temp.i2947_assert((SELECT count(*) FROM public.ticket_queue_arming) = 0,
    'C-04c the driver wrote no arming row');

  v_s := pg_temp.i2947_hold(f.o_event, f.o_tier, 1, 'infinity'::timestamptz);
  BEGIN
    PERFORM public.issue_2947_queue_join(v_s, pg_temp.i2947_token(1));
    RAISE EXCEPTION 'join on an unarmed tier succeeded';
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.i2947_assert(SQLERRM = 'issue_2947_queue_not_armed',
      'C-04d joining an unarmed tier is refused (' || SQLERRM || ')');
  END;

  -- Armed, but the default placeholder threshold (250) is far above one hold.
  UPDATE public.ticket_queue_admission_settings SET arm_threshold_concurrent_holds = 250;
  PERFORM public.issue_2947_queue_arm(f.o_tier);
  PERFORM pg_temp.i2947_assert(NOT public.issue_2947_queue_engaged(f.o_tier),
    'C-04e armed but below the 250 placeholder threshold stays invisible');
  BEGIN
    PERFORM public.issue_2947_queue_join(v_s, pg_temp.i2947_token(1));
    RAISE EXCEPTION 'join below the threshold succeeded';
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.i2947_assert(SQLERRM = 'issue_2947_queue_not_engaged',
      'C-04f joining below the threshold is refused (' || SQLERRM || ')');
  END;
  PERFORM pg_temp.i2947_assert(public.issue_2947_queue_admit_due() = 0,
    'C-04g armed with nobody waiting admits nothing');

  UPDATE public.ticket_queue_admission_settings SET arm_threshold_concurrent_holds = 1;
  PERFORM pg_temp.i2947_assert(public.issue_2947_queue_engaged(f.o_tier),
    'C-04h the same tier engages once holds reach the threshold');
END
$c04$;
ROLLBACK;

-- ─── C-05: the caller exists, from the database ─────────────────────────────────────
DO $c05$
DECLARE r record;
BEGIN
  SELECT count(*) AS n, bool_and(schedule = '* * * * *') AS every_minute, bool_and(active) AS active,
         bool_and(command LIKE '%public.issue_2947_queue_admit_due()%') AS names_driver
    INTO r FROM cron.job WHERE jobname = 'issue_2947_queue_admission_driver';
  PERFORM pg_temp.i2947_assert(r.n = 1 AND r.every_minute AND r.active AND r.names_driver,
    'C-05 cron.job issue_2947_queue_admission_driver: one row, * * * * *, active, calls issue_2947_queue_admit_due');
  PERFORM pg_temp.i2947_assert(
    NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname <> 'issue_2947_queue_admission_driver'
                  AND command ~* 'ticket_checkout_sessions' AND command ~* $re$status\s*=\s*'expired'$re$),
    'C-05b no other cron job performs a time-based expiry of ticket_checkout_sessions');
END
$c05$;

-- ─── C-06: a capacity cut releases the newest holds first ───────────────────────────
BEGIN;
DO $c06$
DECLARE
  f record;
  v_old uuid; v_mid uuid; v_new uuid; v_pay uuid;
BEGIN
  SELECT * INTO f FROM pg_temp.i2947_tier('c06', 12);
  v_old := pg_temp.i2947_hold(f.o_event, f.o_tier, 3, now() + interval '15 minutes');
  v_mid := pg_temp.i2947_hold(f.o_event, f.o_tier, 3, now() + interval '15 minutes');
  v_new := pg_temp.i2947_hold(f.o_event, f.o_tier, 3, 'infinity'::timestamptz);
  UPDATE public.ticket_checkout_sessions SET created_at = now() - interval '3 minutes' WHERE id = v_old;
  UPDATE public.ticket_checkout_sessions SET created_at = now() - interval '2 minutes' WHERE id = v_mid;
  UPDATE public.ticket_checkout_sessions SET created_at = now() - interval '1 minute'  WHERE id = v_new;
  PERFORM pg_temp.i2947_arm(f.o_tier, 1, 1);
  PERFORM public.issue_2947_queue_join(v_new, pg_temp.i2947_token(9));

  -- Exactly sold + held: nothing is released (off-by-one guard).
  PERFORM pg_temp.i2947_cut(f.o_tier, 9);
  PERFORM pg_temp.i2947_assert(
    (SELECT count(*) FROM public.ticket_checkout_sessions
       WHERE id IN (v_old, v_mid, v_new) AND status = 'pending_free') = 3,
    'C-06a a cut to exactly sold+held releases nothing');

  -- Cut by 2 seats: the newest hold (3 seats) frees enough; the older two stay.
  PERFORM pg_temp.i2947_cut(f.o_tier, 7);
  PERFORM pg_temp.i2947_assert(
    (SELECT status FROM public.ticket_checkout_sessions WHERE id = v_new) = 'expired'
    AND (SELECT failure_reason FROM public.ticket_checkout_sessions WHERE id = v_new) = 'capacity_reduced_by_organiser',
    'C-06b the NEWEST hold is released with its own failure_reason');
  PERFORM pg_temp.i2947_assert(
    (SELECT count(*) FROM public.ticket_checkout_sessions
       WHERE id IN (v_old, v_mid) AND status = 'pending_free') = 2,
    'C-06c the two older holds keep their place');
  PERFORM pg_temp.i2947_assert(
    (SELECT release_reason FROM public.ticket_queue_entries WHERE checkout_session_id = v_new)
      = 'capacity_reduced_by_organiser',
    'C-06d the queued hold''s entry is released with the same reason');
  PERFORM pg_temp.i2947_assert(public.issue_2491_derived_held(f.o_tier) = 6,
    'C-06e the freed seats leave the held count (9 -> 6)');
END
$c06$;
ROLLBACK;

-- ─── C-07: the queue read never leaks the sentinel ──────────────────────────────────
BEGIN;
DO $c07$
DECLARE
  f record;
  v_s1 uuid; v_s2 uuid;
  v_state jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.i2947_tier('c07', 100);
  PERFORM pg_temp.i2947_arm(f.o_tier, 1, 10);
  v_s1 := pg_temp.i2947_hold(f.o_event, f.o_tier, 1, 'infinity'::timestamptz);
  v_s2 := pg_temp.i2947_hold(f.o_event, f.o_tier, 1, 'infinity'::timestamptz);
  UPDATE public.ticket_queue_arming SET max_concurrent_live_holds = 1 WHERE ticket_type_id = f.o_tier;
  PERFORM pg_temp.i2947_join_aged(v_s1, pg_temp.i2947_token(1), 20);
  PERFORM pg_temp.i2947_join_aged(v_s2, pg_temp.i2947_token(2), 10);

  v_state := public.issue_2947_queue_state(f.o_tier, pg_temp.i2947_token(2));
  PERFORM pg_temp.i2947_assert((v_state ->> 'queuePosition')::int = 2 AND (v_state ->> 'aheadOfYou')::int = 1
    AND (v_state ->> 'gettingOne')::boolean AND v_state -> 'holdSecondsRemaining' = 'null'::jsonb,
    'C-07a second in line: position 2, one ahead, getting one, clock not started');
  PERFORM pg_temp.i2947_assert(position('expires' IN v_state::text) = 0 AND position('infinity' IN v_state::text) = 0,
    'C-07b the queued state carries no expires_at and no infinity');

  PERFORM public.issue_2947_queue_admit_due();
  v_state := public.issue_2947_queue_state(f.o_tier, pg_temp.i2947_token(1));
  PERFORM pg_temp.i2947_assert((v_state ->> 'admitted')::boolean
    AND (v_state ->> 'holdSecondsRemaining')::int BETWEEN 880 AND 910
    AND position('expires' IN v_state::text) = 0,
    'C-07c admitted: holdSecondsRemaining is whole seconds near 900, still no raw timestamp');
  v_state := public.issue_2947_queue_state(f.o_tier, pg_temp.i2947_token(2));
  PERFORM pg_temp.i2947_assert((v_state ->> 'queuePosition')::int = 1,
    'C-07d the one behind moves up to position 1');
  PERFORM pg_temp.i2947_assert(
    public.issue_2947_queue_state(f.o_tier, pg_temp.i2947_token(77)) = '{"queued": false, "admitted": false, "released": false}'::jsonb,
    'C-07e an unknown device token learns nothing');
END
$c07$;
ROLLBACK;

SELECT 'issue_2947 implementor happy PASS' AS result;
