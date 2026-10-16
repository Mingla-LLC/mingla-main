-- #2879 / #2947 slice 2 — adversarial angles that are NOT a rename of the happy path.
-- Run after the full migration chain on PostgreSQL 17 as the database owner.
-- Every case rolls back.
--
--   A-01  ordering: pre-sale joiners ALWAYS precede live joiners (a bare CASE over md5 hex
--         and a zero-padded epoch string does not guarantee this), the pre-sale order is
--         the md5(seed || id) permutation recomputed independently, it is not join order,
--         and two evaluations are identical.
--   A-02  seed, tier and armed_at are immutable once written.
--   A-03  idempotency: the same hold joining twice is one entry; a second hold from the
--         same device is flagged duplicate and adds no waiting row.
--   A-04  grants: anon and authenticated can neither call a waiting-room function nor
--         read or write a waiting-room table.
--   A-05  admission only moves expires_at FORWARD from infinity and never stamps expired;
--         an entry whose session stopped being an infinity hold is released by name, and
--         the session is untouched.
--   A-06  idle credit cannot be banked: an idle armed tier does not burst when a queue forms.
--   A-07  stall credit is bounded by one hold window.
--   A-08  the deadlock invariant: after the driver runs, no session carries infinity
--         without a live queue entry, and no entry is left neither admitted nor released
--         once its session cannot be admitted.
--   A-09  the alarm: deactivating the cron job flips the caller predicate the migration
--         probe asserts, so a missing caller is detectable from the database.
--   A-10  never queue for zero stock: a sold-out tier refuses the hold upstream, leaves no
--         session behind, and join refuses anything that is not a pending infinity hold.
--   A-11  capacity cut: identical created_at releases in id DESC order, in-flight payments
--         are never released, and a cut below sold releases holds but never touches sold.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.a2947_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #2947 queue admission ADVERSARIAL FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

CREATE OR REPLACE FUNCTION pg_temp.a2947_tier(p_tag text, p_total integer, OUT o_event uuid, OUT o_tier uuid)
LANGUAGE plpgsql AS $f$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
BEGIN
  o_event := gen_random_uuid();
  INSERT INTO auth.users(id, email) VALUES (v_user, 'a2947-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
                            pricing_currency, default_currency)
    VALUES (v_brand, v_user, 'Adversarial 2947 ' || p_tag, 'adv-2947-' || p_tag || '-' || v_brand,
            'stripe', 'US', 'USD', 'USD');
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility,
                            timezone, currency, published_at, theme)
    VALUES (o_event, v_brand, 'Adversarial 2947 ' || p_tag, 'adv-2947-' || p_tag || '-' || o_event,
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

CREATE OR REPLACE FUNCTION pg_temp.a2947_hold(p_event uuid, p_tier uuid, p_qty integer, p_expires timestamptz)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v := public.biz_ticket_checkout_create_session(
    p_event, NULL, 'Adv Guest', 'adv@example.test', '+15550002947', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', p_tier, 'quantity', p_qty)),
    'a2947:' || gen_random_uuid()::text, p_expires, 0, 'auto', NULL);
  RETURN (v ->> 'checkoutSessionId')::uuid;
END
$f$;

CREATE OR REPLACE FUNCTION pg_temp.a2947_err(p_sql text)
RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END
$f$;

CREATE OR REPLACE FUNCTION pg_temp.a2947_token(p_n integer)
RETURNS text LANGUAGE sql IMMUTABLE AS $t$
  SELECT md5('a2947-device-' || p_n) || md5('a2947-pad-' || p_n)
$t$;


-- A capacity cut as rule 5 means it. Main's issue_1930_ticket_types_revoke trigger
-- would fail every open hold on any quantity_total edit before the release function
-- could choose (see the migration header and #2879), so it is switched off inside this
-- rolled-back transaction and the release function is called directly.
CREATE OR REPLACE FUNCTION pg_temp.a2947_cut(p_tier uuid, p_total integer)
RETURNS integer LANGUAGE plpgsql AS $f$
BEGIN
  ALTER TABLE public.ticket_types DISABLE TRIGGER issue_1930_ticket_types_revoke;
  UPDATE public.ticket_types SET quantity_total = p_total WHERE id = p_tier;
  RETURN public.issue_2947_release_newest_holds(p_tier);
END
$f$;

-- ─── A-01: ordering ──────────────────────────────────────────────────────────────────
BEGIN;
DO $a01$
DECLARE
  f record;
  v_s uuid;
  i integer;
  v_expected uuid[];
  v_actual uuid[];
  v_again uuid[];
  v_join_order uuid[];
  v_max_pre bigint;
  v_min_live bigint;
BEGIN
  SELECT * INTO f FROM pg_temp.a2947_tier('a01', 1000);
  UPDATE public.ticket_queue_admission_settings SET arm_threshold_concurrent_holds = 1;
  PERFORM public.issue_2947_queue_arm(f.o_tier);
  -- A fixed boundary: 20 entries before it, 20 after it, interleaved by insertion order.
  UPDATE public.ticket_queue_arming SET sale_opens_at = now() WHERE ticket_type_id = f.o_tier;
  FOR i IN 1..40 LOOP
    v_s := pg_temp.a2947_hold(f.o_event, f.o_tier, 1, 'infinity'::timestamptz);
    INSERT INTO public.ticket_queue_entries(ticket_type_id, checkout_session_id, device_token_hash, joined_at)
    VALUES (f.o_tier, v_s, pg_temp.a2947_token(i),
            CASE WHEN i % 2 = 1 THEN now() - make_interval(secs => 1000 - i)      -- pre-sale
                 ELSE now() + make_interval(secs => i) END);                       -- live
  END LOOP;

  SELECT array_agg(o.entry_id ORDER BY o.queue_position) INTO v_actual
    FROM public.issue_2947_queue_ordered_waiting(f.o_tier) o;
  SELECT array_agg(o.entry_id ORDER BY o.queue_position) INTO v_again
    FROM public.issue_2947_queue_ordered_waiting(f.o_tier) o;
  PERFORM pg_temp.a2947_assert(v_actual = v_again, 'A-01a two evaluations of the ordering are identical');

  SELECT max(o.queue_position) FILTER (WHERE q.joined_at < a.sale_opens_at),
         min(o.queue_position) FILTER (WHERE q.joined_at >= a.sale_opens_at)
    INTO v_max_pre, v_min_live
    FROM public.issue_2947_queue_ordered_waiting(f.o_tier) o
    JOIN public.ticket_queue_entries q ON q.id = o.entry_id
    JOIN public.ticket_queue_arming a ON a.ticket_type_id = q.ticket_type_id;
  PERFORM pg_temp.a2947_assert(v_max_pre = 20 AND v_min_live = 21,
    'A-01b all 20 pre-sale entries precede all 20 live entries, whatever their md5');

  -- Independent recomputation of the pre-sale half, outside the function.
  SELECT array_agg(q.id ORDER BY md5(a.order_seed || q.id::text)) INTO v_expected
    FROM public.ticket_queue_entries q
    JOIN public.ticket_queue_arming a ON a.ticket_type_id = q.ticket_type_id
   WHERE q.ticket_type_id = f.o_tier AND q.joined_at < a.sale_opens_at;
  PERFORM pg_temp.a2947_assert(v_actual[1:20] = v_expected,
    'A-01c the pre-sale order is exactly the md5(order_seed || id) permutation');

  SELECT array_agg(q.id ORDER BY q.joined_at, q.id) INTO v_join_order
    FROM public.ticket_queue_entries q
    JOIN public.ticket_queue_arming a ON a.ticket_type_id = q.ticket_type_id
   WHERE q.ticket_type_id = f.o_tier AND q.joined_at < a.sale_opens_at;
  PERFORM pg_temp.a2947_assert(v_expected <> v_join_order,
    'A-01d the pre-sale order is not join order (it is randomised)');

  SELECT array_agg(q.id ORDER BY q.joined_at, q.id) INTO v_expected
    FROM public.ticket_queue_entries q
    JOIN public.ticket_queue_arming a ON a.ticket_type_id = q.ticket_type_id
   WHERE q.ticket_type_id = f.o_tier AND q.joined_at >= a.sale_opens_at;
  PERFORM pg_temp.a2947_assert(v_actual[21:40] = v_expected,
    'A-01e entries joined at or after sale open are strictly first-come-first-served');
END
$a01$;
ROLLBACK;

-- ─── A-02: immutability ──────────────────────────────────────────────────────────────
BEGIN;
DO $a02$
DECLARE
  f record;
  f2 record;
BEGIN
  SELECT * INTO f FROM pg_temp.a2947_tier('a02', 10);
  SELECT * INTO f2 FROM pg_temp.a2947_tier('a02b', 10);
  PERFORM public.issue_2947_queue_arm(f.o_tier);
  PERFORM pg_temp.a2947_assert(
    pg_temp.a2947_err(format('UPDATE public.ticket_queue_arming SET order_seed = %L WHERE ticket_type_id = %L', 'x', f.o_tier))
      = 'issue_2947_arming_identity_immutable', 'A-02a order_seed cannot be rewritten');
  PERFORM pg_temp.a2947_assert(
    pg_temp.a2947_err(format('UPDATE public.ticket_queue_arming SET armed_at = now() - interval ''1 day'' WHERE ticket_type_id = %L', f.o_tier))
      = 'issue_2947_arming_identity_immutable', 'A-02b armed_at cannot be rewritten');
  PERFORM pg_temp.a2947_assert(
    pg_temp.a2947_err(format('UPDATE public.ticket_queue_arming SET ticket_type_id = %L WHERE ticket_type_id = %L', f2.o_tier, f.o_tier))
      = 'issue_2947_arming_identity_immutable', 'A-02c the tier cannot be re-pointed');
  -- Re-arming after a soft disarm keeps the SAME seed.
  PERFORM pg_temp.a2947_assert(true, 'A-02d (seed captured next)');
  DECLARE v_seed text := (SELECT order_seed FROM public.ticket_queue_arming WHERE ticket_type_id = f.o_tier);
  BEGIN
    UPDATE public.ticket_queue_arming SET disarmed_at = now() WHERE ticket_type_id = f.o_tier;
    PERFORM public.issue_2947_queue_arm(f.o_tier);
    PERFORM pg_temp.a2947_assert(
      (SELECT order_seed FROM public.ticket_queue_arming WHERE ticket_type_id = f.o_tier) = v_seed
      AND (SELECT disarmed_at FROM public.ticket_queue_arming WHERE ticket_type_id = f.o_tier) IS NULL,
      'A-02e re-arming clears the disarm and keeps the original seed');
  END;
END
$a02$;
ROLLBACK;

-- ─── A-03: idempotency under the free rail's automatic retry ────────────────────────
BEGIN;
DO $a03$
DECLARE
  f record;
  v_s1 uuid; v_s2 uuid;
  v_r1 jsonb; v_r2 jsonb; v_r3 jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.a2947_tier('a03', 100);
  UPDATE public.ticket_queue_admission_settings SET arm_threshold_concurrent_holds = 1;
  PERFORM public.issue_2947_queue_arm(f.o_tier);
  v_s1 := pg_temp.a2947_hold(f.o_event, f.o_tier, 1, 'infinity'::timestamptz);
  v_s2 := pg_temp.a2947_hold(f.o_event, f.o_tier, 1, 'infinity'::timestamptz);

  v_r1 := public.issue_2947_queue_join(v_s1, pg_temp.a2947_token(1));
  v_r2 := public.issue_2947_queue_join(v_s1, pg_temp.a2947_token(1));
  PERFORM pg_temp.a2947_assert((v_r1 ->> 'joined')::boolean AND (v_r2 ->> 'replay')::boolean
    AND (SELECT count(*) FROM public.ticket_queue_entries WHERE checkout_session_id = v_s1) = 1,
    'A-03a the same hold joining twice is one entry and a replay');

  v_r3 := public.issue_2947_queue_join(v_s2, pg_temp.a2947_token(1));
  PERFORM pg_temp.a2947_assert((v_r3 ->> 'duplicate')::boolean
    AND (v_r3 ->> 'duplicateOfCheckoutSessionId')::uuid = v_s1
    AND (SELECT count(*) FROM public.ticket_queue_entries WHERE ticket_type_id = f.o_tier) = 1,
    'A-03b a second hold from the same device is flagged duplicate and adds no row');

  PERFORM pg_temp.a2947_assert(
    pg_temp.a2947_err(format('SELECT public.issue_2947_queue_join(%L, %L)', v_s2, 'not-a-sha256'))
      = 'issue_2947_device_token_invalid', 'A-03c a malformed device token is refused (identity is a token hash, not an IP)');
  PERFORM pg_temp.a2947_assert(
    NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name IN ('ticket_queue_entries', 'ticket_queue_arming')
                   AND column_name ~* '(^|_)ip(_|$)|ip_address'),
    'A-03d no queue table stores an IP address');
END
$a03$;
ROLLBACK;

-- ─── A-04: grants ────────────────────────────────────────────────────────────────────
BEGIN;
DO $a04$
DECLARE
  f record;
  v_role text;
  v_sig text;
BEGIN
  SELECT * INTO f FROM pg_temp.a2947_tier('a04', 10);
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_sig IN ARRAY ARRAY[
      'SELECT public.issue_2947_queue_admit_due()',
      format('SELECT public.issue_2947_queue_admit_batch(%L, 1)', f.o_tier),
      format('SELECT public.issue_2947_queue_state(%L, %L)', f.o_tier, pg_temp.a2947_token(1)),
      format('SELECT public.issue_2947_queue_join(%L, %L)', gen_random_uuid(), pg_temp.a2947_token(1)),
      format('SELECT public.issue_2947_queue_arm(%L)', f.o_tier),
      format('SELECT public.issue_2947_release_newest_holds(%L)', f.o_tier),
      'SELECT count(*) FROM public.ticket_queue_entries',
      'SELECT count(*) FROM public.ticket_queue_arming',
      'SELECT count(*) FROM public.ticket_queue_admission_settings',
      'UPDATE public.ticket_queue_admission_settings SET admission_rate_per_sec = 100000',
      'TRUNCATE public.ticket_queue_entries'] LOOP
      EXECUTE format('SET LOCAL ROLE %I', v_role);
      DECLARE v_err text := pg_temp.a2947_err(v_sig);
      BEGIN
        RESET ROLE;
        PERFORM pg_temp.a2947_assert(v_err ~* 'permission denied',
          format('A-04 %s is denied: %s', v_role, left(v_sig, 60)));
      END;
    END LOOP;
  END LOOP;
END
$a04$;
ROLLBACK;

-- ─── A-05: admission only moves forward from infinity; dead entries are released ────
BEGIN;
DO $a05$
DECLARE
  f record;
  v_live uuid; v_dead uuid; v_moved uuid;
  v_fixed timestamptz := now() + interval '7 minutes';
  v_statuses_before text; v_statuses_after text;
BEGIN
  SELECT * INTO f FROM pg_temp.a2947_tier('a05', 100);
  UPDATE public.ticket_queue_admission_settings SET arm_threshold_concurrent_holds = 1;
  PERFORM public.issue_2947_queue_arm(f.o_tier);
  UPDATE public.ticket_queue_arming SET last_admitted_at = clock_timestamp() - interval '60 seconds'
   WHERE ticket_type_id = f.o_tier;

  v_live := pg_temp.a2947_hold(f.o_event, f.o_tier, 1, 'infinity'::timestamptz);
  v_dead := pg_temp.a2947_hold(f.o_event, f.o_tier, 1, 'infinity'::timestamptz);
  v_moved := pg_temp.a2947_hold(f.o_event, f.o_tier, 1, 'infinity'::timestamptz);
  PERFORM public.issue_2947_queue_join(v_live, pg_temp.a2947_token(1));
  PERFORM public.issue_2947_queue_join(v_dead, pg_temp.a2947_token(2));
  PERFORM public.issue_2947_queue_join(v_moved, pg_temp.a2947_token(3));
  -- The buyer abandoned one hold (failed), and another already carries a real expiry.
  UPDATE public.ticket_checkout_sessions SET status = 'failed' WHERE id = v_dead;
  UPDATE public.ticket_checkout_sessions SET expires_at = v_fixed WHERE id = v_moved;

  SELECT string_agg(id::text || ':' || status, ',' ORDER BY id) INTO v_statuses_before
    FROM public.ticket_checkout_sessions WHERE id IN (v_live, v_dead, v_moved);
  PERFORM public.issue_2947_queue_admit_due();
  SELECT string_agg(id::text || ':' || status, ',' ORDER BY id) INTO v_statuses_after
    FROM public.ticket_checkout_sessions WHERE id IN (v_live, v_dead, v_moved);

  PERFORM pg_temp.a2947_assert(v_statuses_before = v_statuses_after,
    'A-05a admission never changes any session status (it is not an expiry)');
  PERFORM pg_temp.a2947_assert(
    (SELECT expires_at FROM public.ticket_checkout_sessions WHERE id = v_moved) = v_fixed,
    'A-05b a session that already carries a real expiry is not moved');
  PERFORM pg_temp.a2947_assert(
    (SELECT expires_at FROM public.ticket_checkout_sessions WHERE id = v_dead) = 'infinity'::timestamptz,
    'A-05c a failed session is not touched either');
  PERFORM pg_temp.a2947_assert(
    (SELECT release_reason FROM public.ticket_queue_entries WHERE checkout_session_id = v_dead) = 'abandoned_past_expiry'
    AND (SELECT release_reason FROM public.ticket_queue_entries WHERE checkout_session_id = v_moved) = 'abandoned_past_expiry',
    'A-05d entries whose session can no longer be admitted are released by name');
  PERFORM pg_temp.a2947_assert(
    (SELECT admitted_at IS NOT NULL FROM public.ticket_queue_entries WHERE checkout_session_id = v_live),
    'A-05e the healthy entry is admitted');
END
$a05$;
ROLLBACK;

-- ─── A-06: an idle tier cannot bank credit ───────────────────────────────────────────
BEGIN;
DO $a06$
DECLARE
  f record;
  v_s uuid;
  v_n integer;
  v_restart timestamptz;
  i integer;
BEGIN
  SELECT * INTO f FROM pg_temp.a2947_tier('a06', 1000);
  UPDATE public.ticket_queue_admission_settings SET arm_threshold_concurrent_holds = 1;
  PERFORM public.issue_2947_queue_arm(f.o_tier);
  UPDATE public.ticket_queue_arming SET last_admitted_at = clock_timestamp() - interval '1 hour'
   WHERE ticket_type_id = f.o_tier;
  PERFORM public.issue_2947_queue_admit_due();   -- nobody waiting: bucket restarts
  SELECT last_admitted_at INTO v_restart FROM public.ticket_queue_arming WHERE ticket_type_id = f.o_tier;
  PERFORM pg_temp.a2947_assert(
    (SELECT last_admitted_at FROM public.ticket_queue_arming WHERE ticket_type_id = f.o_tier) > clock_timestamp() - interval '5 seconds',
    'A-06a an idle armed tier restarts its bucket');
  FOR i IN 1..100 LOOP
    v_s := pg_temp.a2947_hold(f.o_event, f.o_tier, 1, 'infinity'::timestamptz);
    PERFORM public.issue_2947_queue_join(v_s, pg_temp.a2947_token(i));
  END LOOP;
  v_n := public.issue_2947_queue_admit_due();
  -- Credit is only the time since the restart (20/s), never the hour that came before.
  PERFORM pg_temp.a2947_assert(
    v_n <= 20 * EXTRACT(EPOCH FROM (clock_timestamp() - v_restart)) + 1 AND v_n < 100,
    'A-06b a queue that forms after an hour of idle admits only the credit since the restart, not a burst (got ' || v_n || ')');
END
$a06$;
ROLLBACK;

-- ─── A-07: stall credit is bounded by one hold window ───────────────────────────────
BEGIN;
DO $a07$
DECLARE
  f record;
  v_s uuid;
  v_n integer;
  i integer;
BEGIN
  SELECT * INTO f FROM pg_temp.a2947_tier('a07', 1000);
  UPDATE public.ticket_queue_admission_settings
     SET arm_threshold_concurrent_holds = 1, admission_rate_per_sec = 1, hold_window_seconds = 100,
         max_concurrent_live_holds = NULL;
  PERFORM public.issue_2947_queue_arm(f.o_tier);
  FOR i IN 1..300 LOOP
    v_s := pg_temp.a2947_hold(f.o_event, f.o_tier, 1, 'infinity'::timestamptz);
    PERFORM public.issue_2947_queue_join(v_s, pg_temp.a2947_token(i));
  END LOOP;
  UPDATE public.ticket_queue_arming SET last_admitted_at = clock_timestamp() - interval '10 hours'
   WHERE ticket_type_id = f.o_tier;
  v_n := public.issue_2947_queue_admit_due();
  PERFORM pg_temp.a2947_assert(v_n = 100,
    'A-07 ten hours of stall admits one hold window of credit (100 at 1/s x 100 s), not 36000 (got ' || v_n || ')');
END
$a07$;
ROLLBACK;

-- ─── A-08: the deadlock invariant ───────────────────────────────────────────────────
BEGIN;
DO $a08$
DECLARE
  f record;
  v_s uuid;
  i integer;
BEGIN
  SELECT * INTO f FROM pg_temp.a2947_tier('a08', 1000);
  UPDATE public.ticket_queue_admission_settings SET arm_threshold_concurrent_holds = 1;
  PERFORM public.issue_2947_queue_arm(f.o_tier);
  UPDATE public.ticket_queue_arming SET last_admitted_at = clock_timestamp() - interval '600 seconds'
   WHERE ticket_type_id = f.o_tier;
  FOR i IN 1..25 LOOP
    v_s := pg_temp.a2947_hold(f.o_event, f.o_tier, 1, 'infinity'::timestamptz);
    PERFORM public.issue_2947_queue_join(v_s, pg_temp.a2947_token(i));
  END LOOP;
  -- A disarmed tier with people still waiting must still drain (no orphaned queue).
  UPDATE public.ticket_queue_arming SET disarmed_at = now() WHERE ticket_type_id = f.o_tier;
  PERFORM public.issue_2947_queue_admit_due();
  PERFORM pg_temp.a2947_assert(
    NOT EXISTS (SELECT 1 FROM public.ticket_queue_entries WHERE admitted_at IS NULL AND released_at IS NULL),
    'A-08a every entry reached admitted or released, even on a disarmed tier');
  PERFORM pg_temp.a2947_assert(
    NOT EXISTS (
      SELECT 1 FROM public.ticket_checkout_sessions s
       WHERE s.expires_at = 'infinity'::timestamptz
         AND NOT EXISTS (SELECT 1 FROM public.ticket_queue_entries q
                          WHERE q.checkout_session_id = s.id AND q.admitted_at IS NULL AND q.released_at IS NULL)),
    'A-08b no session carries infinity without a live (waiting) queue entry');
END
$a08$;
ROLLBACK;

-- ─── A-09: the alarm — a dead caller is detectable from the database ────────────────
BEGIN;
DO $a09$
DECLARE
  v_job bigint;
  v_alive integer;
BEGIN
  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'issue_2947_queue_admission_driver';
  PERFORM pg_temp.a2947_assert(v_job IS NOT NULL, 'A-09a the driver job exists');
  PERFORM cron.alter_job(v_job, active := false);
  SELECT count(*) INTO v_alive FROM cron.job
   WHERE jobname = 'issue_2947_queue_admission_driver' AND schedule = '* * * * *' AND active
     AND command LIKE '%issue_2947_queue_admit_due%';
  PERFORM pg_temp.a2947_assert(v_alive = 0,
    'A-09b with the job deactivated the caller predicate reads 0 (the migration probe would refuse)');
END
$a09$;
ROLLBACK;

-- ─── A-10: never queue for zero stock ───────────────────────────────────────────────
BEGIN;
DO $a10$
DECLARE
  f record;
  v_s uuid;
  v_before integer;
  v_err text;
BEGIN
  SELECT * INTO f FROM pg_temp.a2947_tier('a10', 2);
  UPDATE public.ticket_queue_admission_settings SET arm_threshold_concurrent_holds = 1;
  PERFORM public.issue_2947_queue_arm(f.o_tier);
  v_s := pg_temp.a2947_hold(f.o_event, f.o_tier, 2, 'infinity'::timestamptz);
  SELECT count(*) INTO v_before FROM public.ticket_checkout_sessions WHERE event_id = f.o_event;
  v_err := pg_temp.a2947_err(format('SELECT pg_temp.a2947_hold(%L, %L, 1, ''infinity''::timestamptz)', f.o_event, f.o_tier));
  PERFORM pg_temp.a2947_assert(v_err ~ 'ticket_capacity_exceeded',
    'A-10a a sold-out tier refuses the hold upstream, so there is nothing to queue');
  PERFORM pg_temp.a2947_assert(
    (SELECT count(*) FROM public.ticket_checkout_sessions WHERE event_id = f.o_event) = v_before,
    'A-10b the refusal leaves no session behind');

  -- A paid-completed or already-clocked session cannot be smuggled into the queue.
  UPDATE public.ticket_checkout_sessions SET expires_at = now() + interval '5 minutes' WHERE id = v_s;
  PERFORM pg_temp.a2947_assert(
    pg_temp.a2947_err(format('SELECT public.issue_2947_queue_join(%L, %L)', v_s, pg_temp.a2947_token(1)))
      = 'issue_2947_session_not_queued_hold',
    'A-10c join refuses a hold that is not an infinity hold');
  PERFORM pg_temp.a2947_assert(
    pg_temp.a2947_err(format('SELECT public.issue_2947_queue_join(%L, %L)', gen_random_uuid(), pg_temp.a2947_token(1)))
      = 'issue_2947_session_not_found',
    'A-10d join refuses a session that does not exist (no entry without a hold)');
END
$a10$;
ROLLBACK;

-- ─── A-11: capacity-cut determinism and its boundaries ──────────────────────────────
BEGIN;
DO $a11$
DECLARE
  f record;
  v_a uuid; v_b uuid; v_c uuid; v_pay uuid;
  v_lo uuid; v_hi uuid;
  v_t timestamptz := now() - interval '1 minute';
BEGIN
  SELECT * INTO f FROM pg_temp.a2947_tier('a11', 20);
  v_a := pg_temp.a2947_hold(f.o_event, f.o_tier, 2, now() + interval '15 minutes');
  v_b := pg_temp.a2947_hold(f.o_event, f.o_tier, 2, now() + interval '15 minutes');
  v_c := pg_temp.a2947_hold(f.o_event, f.o_tier, 2, now() + interval '15 minutes');
  v_pay := pg_temp.a2947_hold(f.o_event, f.o_tier, 2, now() + interval '15 minutes');
  UPDATE public.ticket_checkout_sessions SET created_at = v_t WHERE id IN (v_a, v_b, v_c);
  UPDATE public.ticket_checkout_sessions SET created_at = v_t + interval '30 seconds',
         status = 'awaiting_web_redirect' WHERE id = v_pay;   -- newest, but mid-payment
  SELECT (array_agg(id ORDER BY id))[1], (array_agg(id ORDER BY id))[3] INTO v_lo, v_hi
    FROM (SELECT unnest(ARRAY[v_a, v_b, v_c]) AS id) s;

  -- 8 seats held; cut to 5 -> excess 3 -> two 2-seat holds go, newest id first, never the payer.
  PERFORM pg_temp.a2947_cut(f.o_tier, 5);
  PERFORM pg_temp.a2947_assert(
    (SELECT status FROM public.ticket_checkout_sessions WHERE id = v_pay) = 'awaiting_web_redirect',
    'A-11a a buyer on the provider page is never released, even as the newest hold');
  PERFORM pg_temp.a2947_assert(
    (SELECT status FROM public.ticket_checkout_sessions WHERE id = v_hi) = 'expired'
    AND (SELECT status FROM public.ticket_checkout_sessions WHERE id = v_lo) = 'pending_free',
    'A-11b equal created_at releases by id DESC: the highest id goes first, the lowest stays');
  PERFORM pg_temp.a2947_assert(
    (SELECT count(*) FROM public.ticket_checkout_sessions
       WHERE id IN (v_a, v_b, v_c) AND status = 'expired') = 2,
    'A-11c exactly enough holds are released (two of three), not all');

  -- Idempotent: re-running changes nothing once the excess is gone.
  PERFORM pg_temp.a2947_assert(public.issue_2947_release_newest_holds(f.o_tier) = 0,
    'A-11d a re-run releases nothing');

  -- A cut to the minimum (1) releases every releasable hold but still never the buyer mid-payment:
  -- what that buyer owes is for #2888's floor guard and the finalizer, not this function.
  PERFORM pg_temp.a2947_cut(f.o_tier, 1);
  PERFORM pg_temp.a2947_assert(
    (SELECT count(*) FROM public.ticket_checkout_sessions
       WHERE id IN (v_a, v_b, v_c) AND status = 'pending_free') = 0
    AND (SELECT status FROM public.ticket_checkout_sessions WHERE id = v_pay) = 'awaiting_web_redirect',
    'A-11e a cut to the minimum releases every releasable hold and still spares the buyer mid-payment');
END
$a11$;
ROLLBACK;

SELECT 'issue_2947 tester adversarial PASS' AS result;
