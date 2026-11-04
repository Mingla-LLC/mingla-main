-- #3682 closeout — TESTER adversarial suite (auto-follow, backfill, circle
-- exits, Explorer controls). Different angles from the implementor suites:
--   T1-01..05  claim key normalisation: replay through a different argument
--              shape or a different source label never re-follows; a claim
--              can never be borrowed by another person / brand / kind.
--   T1-06..09  backfill: re-run after people unfollowed is a no-op, it skips
--              refunded orders, deleted brands and circle exits, one follow
--              per (person, brand) across several orders, and it emits
--              nothing (no notification, outbox, email, push or blast row).
--   T1-10..12  "stop invites through friends" then RSVP / booking auto-follow
--              never re-adds, an auto-follow never clears an exit, and the
--              claim keeps the guest unfollowed after they allow again.
--   T1-13..15  Explorer controls: refused for an unknown platform and for
--              the platform whose switch is off, and the table cannot be
--              written around the RPC.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id)
SELECT ('3682c100-0000-4000-8000-0000000000' || lpad(to_hex(i), 2, '0'))::uuid
  FROM generate_series(1, 16) i;
INSERT INTO public.creator_accounts(id, email)
VALUES ('3682c100-0000-4000-8000-000000000001', 'owner-3682t1@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at, deleted_at)
VALUES
  ('3682c100-0000-4000-8000-000000000100', '3682c100-0000-4000-8000-000000000001',
   'Tester Brand', 'issue-3682-t1', 'USD', now(), now(), NULL),
  ('3682c100-0000-4000-8000-000000000101', '3682c100-0000-4000-8000-000000000001',
   'Tester Other', 'issue-3682-t1-other', 'USD', now(), now(), NULL),
  ('3682c100-0000-4000-8000-000000000102', '3682c100-0000-4000-8000-000000000001',
   'Tester Deleted', 'issue-3682-t1-deleted', 'USD', now(), now(), NULL);
INSERT INTO public.profiles(id, first_name, last_name, display_name, username, active,
  has_completed_onboarding, visibility_mode)
SELECT u.id, 'T', 'One', 'Tester ' || right(u.id::text, 2), 't1-3682-' || right(u.id::text, 2),
       true, true, 'friends'
  FROM auth.users u
 WHERE u.id::text LIKE '3682c100-0000-4000-8000-0000000000%'
   AND u.id <> '3682c100-0000-4000-8000-000000000001';

INSERT INTO public.events(id, brand_id, title, slug, status, event_type, currency) VALUES
  ('3682c100-1000-4000-8000-000000000001', '3682c100-0000-4000-8000-000000000100',
   'T1 paid event', 'issue-3682-t1-paid', 'scheduled', 'event', 'USD'),
  ('3682c100-1000-4000-8000-000000000002', '3682c100-0000-4000-8000-000000000100',
   'T1 rsvp', 'issue-3682-t1-rsvp', 'scheduled', 'rsvp', 'USD'),
  ('3682c100-1000-4000-8000-000000000003', '3682c100-0000-4000-8000-000000000102',
   'T1 deleted brand event', 'issue-3682-t1-del', 'scheduled', 'event', 'USD');
-- Brand 102 is deleted after its event exists.
UPDATE public.brands SET deleted_at = now() WHERE id = '3682c100-0000-4000-8000-000000000102';
INSERT INTO public.event_rsvps(id, event_id, user_id, guest_name, rsvp_status) VALUES
  ('3682c100-3000-4000-8000-000000000002', '3682c100-1000-4000-8000-000000000002',
   '3682c100-0000-4000-8000-000000000002', 'Tester 02', 'going'),
  ('3682c100-3000-4000-8000-00000000000a', '3682c100-1000-4000-8000-000000000002',
   '3682c100-0000-4000-8000-00000000000a', 'Tester 0a', 'going');

SET LOCAL session_replication_role = replica;
INSERT INTO public.reservations(id, brand_id, venue_id, reserved_for, party_size, status, source,
  created_via, consumer_user_id) VALUES
  ('3682c100-4000-4000-8000-000000000003', '3682c100-0000-4000-8000-000000000100',
   '3682c100-5000-4000-8000-000000000001', now() + interval '2 days', 2, 'confirmed', 'mingla',
   'consumer', '3682c100-0000-4000-8000-000000000003'),
  ('3682c100-4000-4000-8000-00000000000b', '3682c100-0000-4000-8000-000000000100',
   '3682c100-5000-4000-8000-000000000001', now() + interval '3 days', 2, 'confirmed', 'mingla',
   'consumer', '3682c100-0000-4000-8000-00000000000b');
-- Orders (triggers skipped: contact ownership is not under test).
--   04: paid order, live path; 05: two paid orders same brand; 06: refunded;
--   07: deleted brand; 08: partial refund; 09: paid, then exits before backfill.
INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_phone_e164, payment_status, source,
  total_cents, currency, created_at)
VALUES
  ('3682c100-2000-4000-8000-000000000004', '3682c100-1000-4000-8000-000000000001',
   '3682c100-0000-4000-8000-000000000004', '+15553682104', 'paid', 'online_checkout', 1000, 'USD', timestamptz '2026-10-20 12:00+00'),
  ('3682c100-2000-4000-8000-000000000005', '3682c100-1000-4000-8000-000000000001',
   '3682c100-0000-4000-8000-000000000005', '+15553682105', 'paid', 'online_checkout', 1000, 'USD', timestamptz '2026-10-20 12:00+00'),
  ('3682c100-2000-4000-8000-000000000015', '3682c100-1000-4000-8000-000000000001',
   '3682c100-0000-4000-8000-000000000005', '+15553682105', 'paid', 'online_checkout', 1000, 'USD', timestamptz '2026-10-21 12:00+00'),
  ('3682c100-2000-4000-8000-000000000006', '3682c100-1000-4000-8000-000000000001',
   '3682c100-0000-4000-8000-000000000006', '+15553682106', 'refunded', 'online_checkout', 1000, 'USD', timestamptz '2026-10-20 12:00+00'),
  ('3682c100-2000-4000-8000-000000000007', '3682c100-1000-4000-8000-000000000003',
   '3682c100-0000-4000-8000-000000000007', '+15553682107', 'paid', 'online_checkout', 1000, 'USD', timestamptz '2026-10-20 12:00+00'),
  ('3682c100-2000-4000-8000-000000000008', '3682c100-1000-4000-8000-000000000001',
   '3682c100-0000-4000-8000-000000000008', '+15553682108', 'partial_refund', 'online_checkout', 1000, 'USD', timestamptz '2026-10-20 12:00+00'),
  ('3682c100-2000-4000-8000-000000000009', '3682c100-1000-4000-8000-000000000001',
   '3682c100-0000-4000-8000-000000000009', '+15553682109', 'paid', 'online_checkout', 1000, 'USD', timestamptz '2026-10-20 12:00+00'),
  ('3682c100-2000-4000-8000-00000000000c', '3682c100-1000-4000-8000-000000000001',
   '3682c100-0000-4000-8000-00000000000c', '+15553682112', 'pending', 'online_checkout', 1000, 'USD', timestamptz '2026-10-20 12:00+00');
SET LOCAL session_replication_role = origin;

-- ── T1-01..05 claim key normalisation ───────────────────────────────────────
DO $t1a$
DECLARE r jsonb;
  b uuid := '3682c100-0000-4000-8000-000000000100';
  u4 uuid := '3682c100-0000-4000-8000-000000000004';
  o4 uuid := '3682c100-2000-4000-8000-000000000004';
BEGIN
  -- Live path claims order 04 the legacy way (p_order_id only).
  r := public.biz_auto_follow_brand(u4, b, 'purchase', o4);
  IF NOT (r ->> 'followed')::boolean THEN RAISE EXCEPTION 'T1-01 FAIL: first follow %', r; END IF;
  DELETE FROM public.brand_follows WHERE user_id = u4 AND brand_id = b;
  -- T1-01 Replay with the NEW argument shape (kind + source id, no order id).
  r := public.biz_auto_follow_brand(u4, b, 'purchase', NULL, 'order', o4);
  IF r ->> 'skipped' IS DISTINCT FROM 'already_claimed'
     OR EXISTS (SELECT 1 FROM public.brand_follows WHERE user_id = u4 AND brand_id = b) THEN
    RAISE EXCEPTION 'T1-01 FAIL: order replay via (kind, source_id) re-followed: %', r;
  END IF;
  -- T1-02 Replay under a different source label still hits the same claim.
  r := public.biz_auto_follow_brand(u4, b, 'booking', o4);
  IF r ->> 'skipped' IS DISTINCT FROM 'already_claimed'
     OR EXISTS (SELECT 1 FROM public.brand_follows WHERE user_id = u4 AND brand_id = b) THEN
    RAISE EXCEPTION 'T1-02 FAIL: relabelled order replay re-followed: %', r;
  END IF;

  -- RSVP 02: follow, unfollow, replay labelled 'purchase' with kind rsvp.
  PERFORM public.biz_auto_follow_brand('3682c100-0000-4000-8000-000000000002', b,
    'rsvp', NULL, 'rsvp', '3682c100-3000-4000-8000-000000000002');
  DELETE FROM public.brand_follows WHERE user_id = '3682c100-0000-4000-8000-000000000002' AND brand_id = b;
  r := public.biz_auto_follow_brand('3682c100-0000-4000-8000-000000000002', b,
    'purchase', NULL, 'rsvp', '3682c100-3000-4000-8000-000000000002');
  IF r ->> 'skipped' IS DISTINCT FROM 'already_claimed'
     OR EXISTS (SELECT 1 FROM public.brand_follows WHERE user_id = '3682c100-0000-4000-8000-000000000002' AND brand_id = b) THEN
    RAISE EXCEPTION 'T1-02 FAIL: rsvp replay re-followed: %', r;
  END IF;

  -- Reservation 03: same for a booking.
  PERFORM public.biz_auto_follow_brand('3682c100-0000-4000-8000-000000000003', b,
    'booking', NULL, 'reservation', '3682c100-4000-4000-8000-000000000003');
  DELETE FROM public.brand_follows WHERE user_id = '3682c100-0000-4000-8000-000000000003' AND brand_id = b;
  r := public.biz_auto_follow_brand('3682c100-0000-4000-8000-000000000003', b,
    'booking', NULL, 'reservation', '3682c100-4000-4000-8000-000000000003');
  IF r ->> 'skipped' IS DISTINCT FROM 'already_claimed'
     OR EXISTS (SELECT 1 FROM public.brand_follows WHERE user_id = '3682c100-0000-4000-8000-000000000003' AND brand_id = b) THEN
    RAISE EXCEPTION 'T1-02 FAIL: reservation replay re-followed: %', r;
  END IF;

  -- T1-03 A claim cannot be borrowed by someone else: user 0a's RSVP id with
  -- user 02, and user 0b's reservation id with user 03, are refused.
  BEGIN
    PERFORM public.biz_auto_follow_brand('3682c100-0000-4000-8000-000000000002', b,
      'rsvp', NULL, 'rsvp', '3682c100-3000-4000-8000-00000000000a');
    RAISE EXCEPTION 'T1-03 FAIL: borrowed another guest''s RSVP';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.biz_auto_follow_brand('3682c100-0000-4000-8000-000000000003', b,
      'booking', NULL, 'reservation', '3682c100-4000-4000-8000-00000000000b');
    RAISE EXCEPTION 'T1-03 FAIL: borrowed another guest''s reservation';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  -- T1-04 Wrong brand for the source row, and a kind that does not match the id.
  BEGIN
    PERFORM public.biz_auto_follow_brand('3682c100-0000-4000-8000-00000000000a',
      '3682c100-0000-4000-8000-000000000101', 'rsvp', NULL, 'rsvp', '3682c100-3000-4000-8000-00000000000a');
    RAISE EXCEPTION 'T1-04 FAIL: RSVP followed a brand that does not own the event';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.biz_auto_follow_brand('3682c100-0000-4000-8000-00000000000a', b,
      'rsvp', NULL, 'reservation', '3682c100-3000-4000-8000-00000000000a');
    RAISE EXCEPTION 'T1-04 FAIL: an RSVP id accepted as a reservation';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.biz_auto_follow_brand('3682c100-0000-4000-8000-00000000000b', b,
      'booking', '3682c100-2000-4000-8000-000000000004', 'reservation', '3682c100-4000-4000-8000-00000000000b');
    RAISE EXCEPTION 'T1-04 FAIL: an order id rode along a reservation claim';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  -- T1-05 Purchase/RSVP/booking without any claim key is refused (no unsticky follow).
  BEGIN
    PERFORM public.biz_auto_follow_brand('3682c100-0000-4000-8000-00000000000a', b, 'rsvp', NULL, NULL, NULL);
    RAISE EXCEPTION 'T1-05 FAIL: claimless rsvp follow accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  IF (SELECT count(*) FROM public.brand_follow_auto_claims
       WHERE user_id::text LIKE '3682c100-%') <> 3 THEN
    RAISE EXCEPTION 'T1-05 FAIL: refused calls left claims behind';
  END IF;
END;
$t1a$;

-- ── T1-06..09 backfill ──────────────────────────────────────────────────────
-- 09 left the brand's circle before the backfill runs (no follow row).
INSERT INTO public.brand_circle_exits(brand_id, user_id, visibility_exited_at, delivery_exited_at)
VALUES ('3682c100-0000-4000-8000-000000000100', '3682c100-0000-4000-8000-000000000009', now(), now());

CREATE TEMP TABLE t1_side_effects AS
SELECT 'net.http_request_queue' AS t, (SELECT count(*) FROM net.http_request_queue) AS n
UNION ALL SELECT 'notifications', (SELECT count(*) FROM public.notifications)
UNION ALL SELECT 'notification_outbox', (SELECT count(*) FROM public.notification_outbox)
UNION ALL SELECT 'notification_deliveries', (SELECT count(*) FROM public.notification_deliveries)
UNION ALL SELECT 'marketing_messages', (SELECT count(*) FROM public.marketing_messages)
UNION ALL SELECT 'marketing_push_messages', (SELECT count(*) FROM public.marketing_push_messages)
UNION ALL SELECT 'marketing_book_send_executions', (SELECT count(*) FROM public.marketing_book_send_executions)
UNION ALL SELECT 'marketing_book_send_targets', (SELECT count(*) FROM public.marketing_book_send_targets)
UNION ALL SELECT 'brand_follow_email_pending', (SELECT count(*) FROM public.brand_follow_email_pending)
UNION ALL SELECT 'ticket_order_notifications', (SELECT count(*) FROM public.ticket_order_notifications)
UNION ALL SELECT 'rsvp_notifications', (SELECT count(*) FROM public.rsvp_notifications)
UNION ALL SELECT 'invite_outbox', (SELECT count(*) FROM private.brand_offering_invite_outbox)
UNION ALL SELECT 'account_invites', (SELECT count(*) FROM private.brand_offering_account_invite_deliveries);

DO $t1b$
DECLARE r1 jsonb; r2 jsonb; b uuid := '3682c100-0000-4000-8000-000000000100';
  v_follows uuid[];
BEGIN
  r1 := private.issue_3682_backfill_auto_follows(timestamptz '2026-10-08 00:00+00');
  SELECT array_agg(user_id ORDER BY user_id) INTO v_follows
    FROM public.brand_follows WHERE user_id::text LIKE '3682c100-%';
  -- T1-06 Followed: 05 (once, two orders) and 08 (partial refund). Not 04
  -- (already claimed and unfollowed), 06 (refunded), 07 (deleted brand),
  -- 09 (left the circle), 0c (pending).
  IF v_follows IS DISTINCT FROM ARRAY['3682c100-0000-4000-8000-000000000005',
       '3682c100-0000-4000-8000-000000000008']::uuid[] THEN
    RAISE EXCEPTION 'T1-06 FAIL: backfill followed % (result %)', v_follows, r1;
  END IF;
  IF (SELECT count(*) FROM public.brand_follow_auto_claims
       WHERE order_id IN ('3682c100-2000-4000-8000-000000000005', '3682c100-2000-4000-8000-000000000015')) <> 2
     OR NOT EXISTS (SELECT 1 FROM public.brand_follow_auto_claims
       WHERE order_id = '3682c100-2000-4000-8000-000000000009') THEN
    RAISE EXCEPTION 'T1-06 FAIL: every processed order needs its claim (incl. the exited guest)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.brand_follow_auto_claims
       WHERE order_id IN ('3682c100-2000-4000-8000-000000000006', '3682c100-2000-4000-8000-000000000007',
                          '3682c100-2000-4000-8000-00000000000c')) THEN
    RAISE EXCEPTION 'T1-06 FAIL: a refunded / deleted-brand / unpaid order was claimed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brand_circle_exits
       WHERE brand_id = b AND user_id = '3682c100-0000-4000-8000-000000000009') THEN
    RAISE EXCEPTION 'T1-06 FAIL: the backfill cleared a circle exit';
  END IF;
  -- T1-07 Both backfilled people unfollow; a re-run is a no-op and re-follows nobody.
  DELETE FROM public.brand_follows WHERE brand_id = b AND user_id::text LIKE '3682c100-%';
  r2 := private.issue_3682_backfill_auto_follows(timestamptz '2026-10-08 00:00+00');
  IF (r2 ->> 'orders')::int <> 0 OR (r2 ->> 'follows')::int <> 0 OR (r2 ->> 'claims')::int <> 0
     OR EXISTS (SELECT 1 FROM public.brand_follows WHERE brand_id = b AND user_id::text LIKE '3682c100-%') THEN
    RAISE EXCEPTION 'T1-07 FAIL: re-run after unfollow re-followed: %', r2;
  END IF;
  -- T1-08 The live path also respects backfill claims.
  r2 := public.biz_auto_follow_brand('3682c100-0000-4000-8000-000000000005', b,
    'purchase', '3682c100-2000-4000-8000-000000000015');
  IF r2 ->> 'skipped' IS DISTINCT FROM 'already_claimed' THEN
    RAISE EXCEPTION 'T1-08 FAIL: webhook replay after backfill: %', r2;
  END IF;
END;
$t1b$;

-- T1-09 Nothing was sent, queued or counted.
DO $t1c$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(s.t || ' ' || s.n || '->' || c.n, ', ') INTO v_bad
  FROM t1_side_effects s
  JOIN (
    SELECT 'net.http_request_queue' AS t, (SELECT count(*) FROM net.http_request_queue) AS n
    UNION ALL SELECT 'notifications', (SELECT count(*) FROM public.notifications)
    UNION ALL SELECT 'notification_outbox', (SELECT count(*) FROM public.notification_outbox)
    UNION ALL SELECT 'notification_deliveries', (SELECT count(*) FROM public.notification_deliveries)
    UNION ALL SELECT 'marketing_messages', (SELECT count(*) FROM public.marketing_messages)
    UNION ALL SELECT 'marketing_push_messages', (SELECT count(*) FROM public.marketing_push_messages)
    UNION ALL SELECT 'marketing_book_send_executions', (SELECT count(*) FROM public.marketing_book_send_executions)
    UNION ALL SELECT 'marketing_book_send_targets', (SELECT count(*) FROM public.marketing_book_send_targets)
    UNION ALL SELECT 'brand_follow_email_pending', (SELECT count(*) FROM public.brand_follow_email_pending)
    UNION ALL SELECT 'ticket_order_notifications', (SELECT count(*) FROM public.ticket_order_notifications)
    UNION ALL SELECT 'rsvp_notifications', (SELECT count(*) FROM public.rsvp_notifications)
    UNION ALL SELECT 'invite_outbox', (SELECT count(*) FROM private.brand_offering_invite_outbox)
    UNION ALL SELECT 'account_invites', (SELECT count(*) FROM private.brand_offering_account_invite_deliveries)
  ) c ON c.t = s.t
  WHERE c.n <> s.n;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'T1-09 FAIL: the quiet backfill produced side effects: %', v_bad;
  END IF;
  IF has_function_privilege('service_role', 'private.issue_3682_backfill_auto_follows(timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.issue_3682_backfill_auto_follows(timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T1-09 FAIL: the backfill is callable by an API role';
  END IF;
END;
$t1c$;

-- ── T1-10..12 circle exits vs RSVP / booking auto-follow ────────────────────
-- 0a and 0b follow, then "stop invites through friends" without unfollowing
-- (0a) and with unfollow (0b).
INSERT INTO public.brand_follows(user_id, brand_id, source) VALUES
  ('3682c100-0000-4000-8000-00000000000a', '3682c100-0000-4000-8000-000000000100', 'brand_page'),
  ('3682c100-0000-4000-8000-00000000000b', '3682c100-0000-4000-8000-000000000100', 'brand_page');
SELECT set_config('request.jwt.claim.sub', '3682c100-0000-4000-8000-00000000000a', true);
SELECT set_config('request.jwt.claims', '{"sub":"3682c100-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT public.issue_3682_set_brand_circle_exit_v1('3682c100-0000-4000-8000-000000000100', true, false);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '3682c100-0000-4000-8000-00000000000b', true);
SELECT set_config('request.jwt.claims', '{"sub":"3682c100-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT public.issue_3682_set_brand_circle_exit_v1('3682c100-0000-4000-8000-000000000100', true, true);
RESET ROLE;

DO $t1d$
DECLARE r jsonb; b uuid := '3682c100-0000-4000-8000-000000000100';
BEGIN
  -- T1-10 A booking after "unfollow and stop" never re-adds 0b.
  r := public.biz_auto_follow_brand('3682c100-0000-4000-8000-00000000000b', b,
    'booking', NULL, 'reservation', '3682c100-4000-4000-8000-00000000000b');
  IF EXISTS (SELECT 1 FROM public.brand_follows WHERE user_id = '3682c100-0000-4000-8000-00000000000b' AND brand_id = b) THEN
    RAISE EXCEPTION 'T1-10 FAIL: a booking re-followed a guest who left the circle: %', r;
  END IF;
  -- T1-11 An RSVP auto-follow for 0a (still following, exit set) must not clear the exit.
  PERFORM public.biz_auto_follow_brand('3682c100-0000-4000-8000-00000000000a', b,
    'rsvp', NULL, 'rsvp', '3682c100-3000-4000-8000-00000000000a');
  IF NOT EXISTS (SELECT 1 FROM public.brand_circle_exits WHERE brand_id = b
                  AND user_id = '3682c100-0000-4000-8000-00000000000a') THEN
    RAISE EXCEPTION 'T1-11 FAIL: an automatic follow cleared "stop invites through friends"';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brand_circle_exits WHERE brand_id = b
                  AND user_id = '3682c100-0000-4000-8000-00000000000b') THEN
    RAISE EXCEPTION 'T1-10 FAIL: the blocked booking still cleared the exit';
  END IF;
END;
$t1d$;

-- T1-12 0b allows the brand again (exit removed) but does not follow: the
-- booking replay stays a no-op because the claim was recorded while blocked.
SET LOCAL ROLE authenticated;
SELECT public.issue_3682_set_brand_circle_exit_v1('3682c100-0000-4000-8000-000000000100', false, false);
RESET ROLE;
DO $t1e$
DECLARE r jsonb;
BEGIN
  r := public.biz_auto_follow_brand('3682c100-0000-4000-8000-00000000000b',
    '3682c100-0000-4000-8000-000000000100', 'booking', NULL, 'reservation', '3682c100-4000-4000-8000-00000000000b');
  IF r ->> 'skipped' IS DISTINCT FROM 'already_claimed'
     OR EXISTS (SELECT 1 FROM public.brand_follows WHERE user_id = '3682c100-0000-4000-8000-00000000000b') THEN
    RAISE EXCEPTION 'T1-12 FAIL: allowing again let a stale booking re-follow: %', r;
  END IF;
END;
$t1e$;

-- ── T1-13..15 Explorer controls ─────────────────────────────────────────────
UPDATE public.feature_flags SET is_enabled = (flag_key = 'brand_circle_extended_controls_ios_v1')
 WHERE flag_key IN ('brand_circle_extended_controls_ios_v1', 'brand_circle_extended_controls_android_v1');
SELECT set_config('request.jwt.claim.sub', '3682c100-0000-4000-8000-00000000000d', true);
SELECT set_config('request.jwt.claims', '{"sub":"3682c100-0000-4000-8000-00000000000d","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t1f$
DECLARE r jsonb;
BEGIN
  -- T1-13 Unknown / missing platform never inherits another platform's switch.
  BEGIN
    PERFORM public.issue_3682_set_friends_reach_v1('web', true);
    RAISE EXCEPTION 'T1-13 FAIL: web wrote the preference';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    PERFORM public.issue_3682_set_friends_reach_v1(NULL, true);
    RAISE EXCEPTION 'T1-13 FAIL: a NULL platform wrote the preference';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    PERFORM public.issue_3682_set_friends_reach_v1('IOS', true);
    RAISE EXCEPTION 'T1-13 FAIL: platform match is case-folded into a live switch';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  -- T1-14 Android is off: refused; iOS is on: allowed. Read reports per platform.
  BEGIN
    PERFORM public.issue_3682_set_friends_reach_v1('android', true);
    RAISE EXCEPTION 'T1-14 FAIL: android wrote while its switch is off';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  r := public.issue_3682_explorer_friends_reach_v1('android');
  IF (r ->> 'controlsLive')::boolean OR (r ->> 'extendedEnabled')::boolean THEN
    RAISE EXCEPTION 'T1-14 FAIL: android read %', r;
  END IF;
  r := public.issue_3682_set_friends_reach_v1('ios', true);
  IF NOT (r ->> 'extendedEnabled')::boolean THEN RAISE EXCEPTION 'T1-14 FAIL: ios opt-in %', r; END IF;
  -- T1-15 The table cannot be written around the RPC.
  BEGIN
    UPDATE public.brand_circle_preferences SET extended_brand_reach_enabled = false
     WHERE user_id = '3682c100-0000-4000-8000-00000000000d';
    RAISE EXCEPTION 'T1-15 FAIL: direct UPDATE allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.brand_circle_exits(brand_id, user_id, visibility_exited_at, delivery_exited_at)
    VALUES ('3682c100-0000-4000-8000-000000000101', '3682c100-0000-4000-8000-00000000000d', now(), now());
    RAISE EXCEPTION 'T1-15 FAIL: direct exit INSERT allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.brand_follow_auto_claims(order_id, user_id, brand_id, source, source_kind, source_id)
    VALUES (NULL, '3682c100-0000-4000-8000-00000000000d', '3682c100-0000-4000-8000-000000000100',
      'rsvp', 'rsvp', gen_random_uuid());
    RAISE EXCEPTION 'T1-15 FAIL: a guest can forge a claim';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.biz_auto_follow_brand('3682c100-0000-4000-8000-00000000000d',
      '3682c100-0000-4000-8000-000000000100', 'brand_page', NULL, NULL, NULL);
    RAISE EXCEPTION 'T1-15 FAIL: authenticated reached biz_auto_follow_brand';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$t1f$;
RESET ROLE;

ROLLBACK;
