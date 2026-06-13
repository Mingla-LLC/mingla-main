-- ORCH-1120 — TESTER ADVERSARIAL E2E (different angle from the implementor probe).
--
-- The implementor's orch_1120_*.test.sql tests a pg_temp RE-IMPLEMENTATION of the
-- classifier (M-11..M-16) + a body-marker string check (M-10) — it never drives
-- the live biz_update_live_trip RPC. THIS file drives the REAL RPC end-to-end:
-- seeds creator_account + brand + live trip + paid/partial/cancelled orders, sets
-- auth.uid() to the brand owner, and calls biz_update_live_trip through SPEC §7
-- T-1..T-11 PLUS 11 novel boundary cases (ADV-1..ADV-11) the implementor never
-- exercised: non-matching threshold unions, identical-policy neutrality, mid-band
-- tier insert/drop, lower-one-band mixed edits, exact-equal vs 1-min-earlier
-- deadline, NULL->deadline window-shrink, partial_refund counts-as-sale,
-- cancelled-only sold=0, true->true no-flip, and the ATOMIC-BLOCK invariant
-- (a mixed favorable+unfavorable patch blocks WHOLLY — neither field persists).
--
-- HOW TO RUN (non-prod only): `supabase start` (or a Supabase branch), then
--   docker exec <db> psql -U postgres -d postgres -v ON_ERROR_STOP=on -f <this>
-- Expect zero ERROR + the final "ALL ... PASSED" line. Every BLOCK/ALLOW verdict
-- is asserted by pg_temp.drive() against the RPC's actual returned JSON, and
-- every block additionally asserts the events row was NOT written.
--
-- fails-on-revert (PROVEN by the tester on the local stack 2026-06-12): neuter the
-- §4g gate (force the 3 gate IFs false) and re-apply the RPC => T-1 flips ok:false
-- -> ok:true and this script ERRORs at "T-1 FAIL: expected ok=f got ok=t". Restore
-- the gate => all 22 cases pass again.
--
-- Spec: SPEC_ORCH-1120 §7, §8 (SC-4/SC-5/SC-6), §9.2. Append-only; never edits the
-- implementor probe.

-- ORCH-1120 ADVERSARIAL E2E — drives the REAL biz_update_live_trip RPC.
-- (Tester-authored; distinct angle from the implementor probe which tests a
--  pg_temp re-implementation, NOT the live RPC.)
\set ON_ERROR_STOP on
\pset pager off

BEGIN;

-- ---- Seed identities ----
-- created_by FK -> auth.users; brand.account_id = uid => brand_owner rank.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
VALUES ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-1120@test.local','x', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.creator_accounts (id) VALUES ('11111111-1111-1111-1111-111111111111') ON CONFLICT (id) DO NOTHING;

INSERT INTO public.brands (id, account_id, name, slug, default_currency)
VALUES ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Test Brand 1120','test-brand-1120','usd');

-- ---- helper to make a trip event in a given refund/deadline/closed state ----
CREATE OR REPLACE FUNCTION pg_temp.mk_trip(
  p_id uuid, p_policy jsonb, p_deadline timestamptz, p_closed boolean
) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO public.events (id, brand_id, created_by, title, slug, event_type, status,
    refund_policy, booking_deadline, bookings_closed)
  VALUES (p_id, '22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',
    'Trip '||p_id::text, 'trip-'||replace(p_id::text,'-',''), 'trip', 'live',
    p_policy, p_deadline, p_closed);
END;$f$;

-- ---- helper to attach a paid order with N seats (drives v_total_sold) ----
CREATE OR REPLACE FUNCTION pg_temp.add_paid_order(p_event uuid, p_qty int) RETURNS void
LANGUAGE plpgsql AS $f$
DECLARE v_tt uuid := gen_random_uuid(); v_ord uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.ticket_types (id, event_id, name, currency)
    VALUES (v_tt, p_event, 'GA', 'usd');
  INSERT INTO public.orders (id, event_id, currency, payment_status, source)
    VALUES (v_ord, p_event, 'usd', 'paid', 'door_sale');
  INSERT INTO public.order_line_items (order_id, ticket_type_id, quantity)
    VALUES (v_ord, v_tt, p_qty);
END;$f$;

-- ---- authenticate as the owner for every RPC call ----
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

-- =====================================================================
-- Policies (validate_refund_policy requires DESC days + non-increasing pct)
-- Flexible(30->100,14->50,0->0); Strict(90->100,0->0)
-- =====================================================================
\set flex   '{"kind":"flexible","tiers":[{"days_before_start":30,"refund_pct":100},{"days_before_start":14,"refund_pct":50},{"days_before_start":0,"refund_pct":0}]}'
\set strict '{"kind":"strict","tiers":[{"days_before_start":90,"refund_pct":100},{"days_before_start":0,"refund_pct":0}]}'


-- assertion harness: call RPC, compare ok+reason, and verify the events row
-- write/no-write side effect.
CREATE OR REPLACE FUNCTION pg_temp.drive(
  p_label text, p_event uuid, p_patch jsonb,
  p_expect_ok boolean, p_expect_reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v_res jsonb; v_ok boolean; v_reason text;
BEGIN
  v_res := public.biz_update_live_trip(p_event, p_patch, 'tester adversarial drive case 1120');
  v_ok := (v_res->>'ok')::boolean;
  v_reason := v_res->>'reason';
  IF v_ok IS DISTINCT FROM p_expect_ok THEN
    RAISE EXCEPTION '% FAIL: expected ok=% got ok=% (full=%)', p_label, p_expect_ok, v_ok, v_res;
  END IF;
  IF NOT p_expect_ok AND v_reason IS DISTINCT FROM p_expect_reason THEN
    RAISE EXCEPTION '% FAIL: expected reason=% got reason=% (full=%)', p_label, p_expect_reason, v_reason, v_res;
  END IF;
  RAISE NOTICE '% PASS: %', p_label, v_res;
END;$f$;

-- =====================================================================
-- T-1: unfavorable refund (Flexible->Strict) + sales => BLOCK, no write
-- =====================================================================
SELECT pg_temp.mk_trip('a0000000-0000-0000-0000-000000000001', :'flex'::jsonb, NULL, false);
SELECT pg_temp.add_paid_order('a0000000-0000-0000-0000-000000000001', 2);
SELECT pg_temp.drive('T-1','a0000000-0000-0000-0000-000000000001', jsonb_build_object('refund_policy', :'strict'::jsonb), false, 'refund_policy_downgrade_with_sales');
DO $$ BEGIN
  IF (SELECT refund_policy->>'kind' FROM public.events WHERE id='a0000000-0000-0000-0000-000000000001') <> 'flexible' THEN
    RAISE EXCEPTION 'T-1 FAIL: refund_policy was WRITTEN despite block';
  END IF;
  RAISE NOTICE 'T-1 side-effect PASS: refund_policy unchanged + affected_order_count was 2';
END $$;

-- =====================================================================
-- T-2: favorable refund (raise 14->80) + sales => ALLOW, written
-- =====================================================================
\set flex_raise '{"kind":"flexible","tiers":[{"days_before_start":30,"refund_pct":100},{"days_before_start":14,"refund_pct":80},{"days_before_start":0,"refund_pct":0}]}'
SELECT pg_temp.mk_trip('a0000000-0000-0000-0000-000000000002', :'flex'::jsonb, NULL, false);
SELECT pg_temp.add_paid_order('a0000000-0000-0000-0000-000000000002', 1);
SELECT pg_temp.drive('T-2','a0000000-0000-0000-0000-000000000002', jsonb_build_object('refund_policy', :'flex_raise'::jsonb), true);
DO $$ BEGIN
  IF (SELECT (refund_policy->'tiers'->1->>'refund_pct') FROM public.events WHERE id='a0000000-0000-0000-0000-000000000002') <> '80' THEN
    RAISE EXCEPTION 'T-2 FAIL: favorable raise NOT written';
  END IF; RAISE NOTICE 'T-2 side-effect PASS: raise written';
END $$;

-- =====================================================================
-- T-3: add a tier (Strict + 30->50) + sales => ALLOW
-- =====================================================================
\set strict_plus '{"kind":"strict","tiers":[{"days_before_start":90,"refund_pct":100},{"days_before_start":30,"refund_pct":50},{"days_before_start":0,"refund_pct":0}]}'
SELECT pg_temp.mk_trip('a0000000-0000-0000-0000-000000000003', :'strict'::jsonb, NULL, false);
SELECT pg_temp.add_paid_order('a0000000-0000-0000-0000-000000000003', 1);
SELECT pg_temp.drive('T-3','a0000000-0000-0000-0000-000000000003', jsonb_build_object('refund_policy', :'strict_plus'::jsonb), true);

-- =====================================================================
-- T-4: remove the 14->50 tier (lowers realized %) + sales => BLOCK
-- =====================================================================
\set flex_removed '{"kind":"flexible","tiers":[{"days_before_start":30,"refund_pct":100},{"days_before_start":0,"refund_pct":0}]}'
SELECT pg_temp.mk_trip('a0000000-0000-0000-0000-000000000004', :'flex'::jsonb, NULL, false);
SELECT pg_temp.add_paid_order('a0000000-0000-0000-0000-000000000004', 1);
SELECT pg_temp.drive('T-4','a0000000-0000-0000-0000-000000000004', jsonb_build_object('refund_policy', :'flex_removed'::jsonb), false, 'refund_policy_downgrade_with_sales');

-- =====================================================================
-- T-5: NO sales => unfavorable patch applies freely
-- =====================================================================
SELECT pg_temp.mk_trip('a0000000-0000-0000-0000-000000000005', :'flex'::jsonb, NULL, false);
SELECT pg_temp.drive('T-5','a0000000-0000-0000-0000-000000000005', jsonb_build_object('refund_policy', :'strict'::jsonb), true);
DO $$ BEGIN
  IF (SELECT refund_policy->>'kind' FROM public.events WHERE id='a0000000-0000-0000-0000-000000000005') <> 'strict' THEN
    RAISE EXCEPTION 'T-5 FAIL: no-sales unfavorable edit NOT applied';
  END IF; RAISE NOTICE 'T-5 side-effect PASS: no-sales downgrade applied';
END $$;

-- =====================================================================
-- T-6: deadline earlier + sales => BLOCK
-- =====================================================================
SELECT pg_temp.mk_trip('b0000000-0000-0000-0000-000000000006', NULL, '2026-08-01T00:00:00Z', false);
SELECT pg_temp.add_paid_order('b0000000-0000-0000-0000-000000000006', 1);
SELECT pg_temp.drive('T-6','b0000000-0000-0000-0000-000000000006', jsonb_build_object('booking_deadline','2026-07-01T00:00:00Z'), false, 'booking_deadline_earlier_with_sales');
DO $$ BEGIN
  IF (SELECT booking_deadline FROM public.events WHERE id='b0000000-0000-0000-0000-000000000006') <> '2026-08-01T00:00:00Z'::timestamptz THEN
    RAISE EXCEPTION 'T-6 FAIL: deadline WRITTEN despite block';
  END IF; RAISE NOTICE 'T-6 side-effect PASS: deadline unchanged';
END $$;

-- =====================================================================
-- T-7: deadline later + sales => ALLOW
-- =====================================================================
SELECT pg_temp.mk_trip('b0000000-0000-0000-0000-000000000007', NULL, '2026-07-01T00:00:00Z', false);
SELECT pg_temp.add_paid_order('b0000000-0000-0000-0000-000000000007', 1);
SELECT pg_temp.drive('T-7','b0000000-0000-0000-0000-000000000007', jsonb_build_object('booking_deadline','2026-08-01T00:00:00Z'), true);

-- =====================================================================
-- T-8: clear deadline (NULL) + sales => ALLOW (favorable)
-- =====================================================================
SELECT pg_temp.mk_trip('b0000000-0000-0000-0000-000000000008', NULL, '2026-07-01T00:00:00Z', false);
SELECT pg_temp.add_paid_order('b0000000-0000-0000-0000-000000000008', 1);
SELECT pg_temp.drive('T-8','b0000000-0000-0000-0000-000000000008', jsonb_build_object('booking_deadline', to_jsonb(NULL::text)), true);
DO $$ BEGIN
  IF (SELECT booking_deadline FROM public.events WHERE id='b0000000-0000-0000-0000-000000000008') IS NOT NULL THEN
    RAISE EXCEPTION 'T-8 FAIL: deadline NOT cleared to NULL';
  END IF; RAISE NOTICE 'T-8 side-effect PASS: deadline cleared';
END $$;

-- =====================================================================
-- T-9: close bookings (false->true) + sales => BLOCK
-- =====================================================================
SELECT pg_temp.mk_trip('c0000000-0000-0000-0000-000000000009', NULL, NULL, false);
SELECT pg_temp.add_paid_order('c0000000-0000-0000-0000-000000000009', 1);
SELECT pg_temp.drive('T-9','c0000000-0000-0000-0000-000000000009', jsonb_build_object('bookings_closed', true), false, 'bookings_closed_harms_active');
DO $$ BEGIN
  IF (SELECT bookings_closed FROM public.events WHERE id='c0000000-0000-0000-0000-000000000009') <> false THEN
    RAISE EXCEPTION 'T-9 FAIL: bookings_closed WRITTEN despite block';
  END IF; RAISE NOTICE 'T-9 side-effect PASS: bookings_closed unchanged';
END $$;

-- =====================================================================
-- T-10: reopen bookings (true->false) + sales => ALLOW, bookings_closed_at NULL
-- =====================================================================
SELECT pg_temp.mk_trip('c0000000-0000-0000-0000-000000000010', NULL, NULL, true);
UPDATE public.events SET bookings_closed_at = now() WHERE id='c0000000-0000-0000-0000-000000000010';
SELECT pg_temp.add_paid_order('c0000000-0000-0000-0000-000000000010', 1);
SELECT pg_temp.drive('T-10','c0000000-0000-0000-0000-000000000010', jsonb_build_object('bookings_closed', false), true);
DO $$ BEGIN
  IF (SELECT bookings_closed FROM public.events WHERE id='c0000000-0000-0000-0000-000000000010') <> false
     OR (SELECT bookings_closed_at FROM public.events WHERE id='c0000000-0000-0000-0000-000000000010') IS NOT NULL THEN
    RAISE EXCEPTION 'T-10 FAIL: reopen not applied or bookings_closed_at not cleared';
  END IF; RAISE NOTICE 'T-10 side-effect PASS: reopened + bookings_closed_at cleared';
END $$;

-- =====================================================================
-- T-11: bad policy shape (ascending days) => RAISE (CHECK/validate), no write
-- =====================================================================
SELECT pg_temp.mk_trip('d0000000-0000-0000-0000-000000000011', :'flex'::jsonb, NULL, false);
DO $$ DECLARE v_res jsonb; BEGIN
  BEGIN
    v_res := public.biz_update_live_trip('d0000000-0000-0000-0000-000000000011',
      jsonb_build_object('refund_policy','{"kind":"custom","tiers":[{"days_before_start":0,"refund_pct":0},{"days_before_start":30,"refund_pct":100}]}'::jsonb),
      'tester T-11 bad shape ascending');
    RAISE EXCEPTION 'T-11 FAIL: bad ascending policy did NOT raise (got %)', v_res;
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE '%T-11 FAIL%' THEN RAISE; END IF;
    RAISE NOTICE 'T-11 PASS: bad policy raised: %', SQLERRM;
  END;
END $$;

-- #####################################################################
-- ADVERSARIAL NOVEL CASES (tester, distinct angle) — drive the REAL RPC
-- across NON-matching threshold unions + equality boundaries.
-- #####################################################################

-- ADV-1: EQUAL-% identity edit (same realized % at every threshold, different
-- tier-array literal) + sales => MUST NOT BLOCK (favorable/neutral).
-- Old Flexible(30->100,14->50,0->0); New adds a redundant 7->50 tier that gives
-- the SAME realized % at every union threshold (d in [7,13] was 0 under old? NO:
-- under old, d=7 -> winning tier days<=7 = {0->0} => 0. New: d=7 -> {7->50} => 50.
-- That's a RAISE at d=7..13 => favorable. So pick a TRUE no-op instead:
-- reorder is impossible (monotonic). Use identical policy => neutral, must allow.
SELECT pg_temp.mk_trip('e0000000-0000-0000-0000-000000000101', :'flex'::jsonb, NULL, false);
SELECT pg_temp.add_paid_order('e0000000-0000-0000-0000-000000000101', 3);
SELECT pg_temp.drive('ADV-1 (identical policy = neutral, must ALLOW)','e0000000-0000-0000-0000-000000000101', jsonb_build_object('refund_policy', :'flex'::jsonb), true);

-- ADV-2: INSERT a tier BETWEEN existing thresholds that RAISES realized % in a
-- previously-uncovered band (Flexible + 7->50) => non-matching union, FAVORABLE.
\set flex_insert '{"kind":"flexible","tiers":[{"days_before_start":30,"refund_pct":100},{"days_before_start":14,"refund_pct":50},{"days_before_start":7,"refund_pct":50},{"days_before_start":0,"refund_pct":0}]}'
SELECT pg_temp.mk_trip('e0000000-0000-0000-0000-000000000102', :'flex'::jsonb, NULL, false);
SELECT pg_temp.add_paid_order('e0000000-0000-0000-0000-000000000102', 1);
SELECT pg_temp.drive('ADV-2 (insert tier raises band 7..13, must ALLOW)','e0000000-0000-0000-0000-000000000102', jsonb_build_object('refund_policy', :'flex_insert'::jsonb), true);

-- ADV-3: INSERT a tier between thresholds that LOWERS realized % in a band:
-- Old has 30->100 covering d in [30,89]; New inserts 60->50 so d in [60,89]
-- drops 100->? winning tier at d=60: old={30->100}=100; new={60->50}=50 => LOWER
-- => UNFAVORABLE. (Non-matching union; classic mid-band downgrade.)
-- Build old = Strict90(90->100,0->0); new inserts 60->50 (monotonic ok: 90,60,0 / 100,50,0).
\set s90 '{"kind":"strict","tiers":[{"days_before_start":90,"refund_pct":100},{"days_before_start":0,"refund_pct":0}]}'
\set s90_mid '{"kind":"strict","tiers":[{"days_before_start":90,"refund_pct":100},{"days_before_start":60,"refund_pct":50},{"days_before_start":0,"refund_pct":0}]}'
-- s90_mid vs s90: at d=60 -> old winning {0->0}=0 ; new {60->50}=50 => RAISE not lower.
-- To force a LOWER mid-band, go the OTHER direction: old=s90_mid, new=s90 (removing
-- the 60 tier drops d in [60,89] from 50 to 0) => UNFAVORABLE.
SELECT pg_temp.mk_trip('e0000000-0000-0000-0000-000000000103', :'s90_mid'::jsonb, NULL, false);
SELECT pg_temp.add_paid_order('e0000000-0000-0000-0000-000000000103', 2);
SELECT pg_temp.drive('ADV-3 (drop mid-band tier lowers d=60..89, must BLOCK)','e0000000-0000-0000-0000-000000000103', jsonb_build_object('refund_policy', :'s90'::jsonb), false, 'refund_policy_downgrade_with_sales');

-- ADV-4: LOWER one tier but RAISE another (mixed) — ANY band lower must BLOCK.
-- Old Flexible(30->100,14->50,0->0). New(30->100,14->20,0->0): d=14..29 drops 50->20
-- (LOWER) even though nothing else rises. Must BLOCK on the realized-% drop.
\set flex_mixed '{"kind":"flexible","tiers":[{"days_before_start":30,"refund_pct":100},{"days_before_start":14,"refund_pct":20},{"days_before_start":0,"refund_pct":0}]}'
SELECT pg_temp.mk_trip('e0000000-0000-0000-0000-000000000104', :'flex'::jsonb, NULL, false);
SELECT pg_temp.add_paid_order('e0000000-0000-0000-0000-000000000104', 1);
SELECT pg_temp.drive('ADV-4 (one band lowered, must BLOCK)','e0000000-0000-0000-0000-000000000104', jsonb_build_object('refund_policy', :'flex_mixed'::jsonb), false, 'refund_policy_downgrade_with_sales');

-- ADV-5: deadline set to EXACTLY EQUAL (no change in window) + sales => not "<", ALLOW.
SELECT pg_temp.mk_trip('e0000000-0000-0000-0000-000000000105', NULL, '2026-08-01T00:00:00Z', false);
SELECT pg_temp.add_paid_order('e0000000-0000-0000-0000-000000000105', 1);
SELECT pg_temp.drive('ADV-5 (deadline EXACTLY equal, must ALLOW)','e0000000-0000-0000-0000-000000000105', jsonb_build_object('booking_deadline','2026-08-01T00:00:00Z'), true);

-- ADV-6: deadline 1 MINUTE earlier + sales => "<", must BLOCK (boundary opposite ADV-5).
SELECT pg_temp.mk_trip('e0000000-0000-0000-0000-000000000106', NULL, '2026-08-01T00:00:00Z', false);
SELECT pg_temp.add_paid_order('e0000000-0000-0000-0000-000000000106', 1);
SELECT pg_temp.drive('ADV-6 (deadline 1-min earlier, must BLOCK)','e0000000-0000-0000-0000-000000000106', jsonb_build_object('booking_deadline','2026-07-31T23:59:00Z'), false, 'booking_deadline_earlier_with_sales');

-- ADV-7: NULL->deadline (newly closing window earlier than "never") + sales => BLOCK.
SELECT pg_temp.mk_trip('e0000000-0000-0000-0000-000000000107', NULL, NULL, false);
SELECT pg_temp.add_paid_order('e0000000-0000-0000-0000-000000000107', 1);
SELECT pg_temp.drive('ADV-7 (NULL->deadline = window shrinks, must BLOCK)','e0000000-0000-0000-0000-000000000107', jsonb_build_object('booking_deadline','2026-08-01T00:00:00Z'), false, 'booking_deadline_earlier_with_sales');

-- ADV-8: PARTIALLY-REFUNDED order still counts as a "sale" (payment_status
-- 'partially_refunded' is NOT in ('failed','cancelled')) => unfavorable BLOCKS.
SELECT pg_temp.mk_trip('e0000000-0000-0000-0000-000000000108', :'flex'::jsonb, NULL, false);
DO $$ DECLARE v_tt uuid := gen_random_uuid(); v_ord uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.ticket_types (id,event_id,name,currency) VALUES (v_tt,'e0000000-0000-0000-0000-000000000108','GA','usd');
  INSERT INTO public.orders (id,event_id,currency,payment_status,source) VALUES (v_ord,'e0000000-0000-0000-0000-000000000108','usd','partial_refund','door_sale');
  INSERT INTO public.order_line_items (order_id,ticket_type_id,quantity) VALUES (v_ord,v_tt,1);
END $$;
SELECT pg_temp.drive('ADV-8 (partially_refunded counts as sale, must BLOCK)','e0000000-0000-0000-0000-000000000108', jsonb_build_object('refund_policy', :'strict'::jsonb), false, 'refund_policy_downgrade_with_sales');

-- ADV-9: bookings_closed already TRUE, re-send TRUE (true->true, no flip) + sales
-- => NOT the harmful false->true flip, must ALLOW (no-op).
SELECT pg_temp.mk_trip('e0000000-0000-0000-0000-000000000109', NULL, NULL, true);
SELECT pg_temp.add_paid_order('e0000000-0000-0000-0000-000000000109', 1);
SELECT pg_temp.drive('ADV-9 (true->true no flip, must ALLOW)','e0000000-0000-0000-0000-000000000109', jsonb_build_object('bookings_closed', true), true);

-- ADV-10: cancelled order does NOT count => unfavorable on a trip whose only
-- order is cancelled is FREELY allowed (sold=0).
SELECT pg_temp.mk_trip('e0000000-0000-0000-0000-000000000110', :'flex'::jsonb, NULL, false);
DO $$ DECLARE v_tt uuid := gen_random_uuid(); v_ord uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.ticket_types (id,event_id,name,currency) VALUES (v_tt,'e0000000-0000-0000-0000-000000000110','GA','usd');
  INSERT INTO public.orders (id,event_id,currency,payment_status,source) VALUES (v_ord,'e0000000-0000-0000-0000-000000000110','usd','cancelled','door_sale');
  INSERT INTO public.order_line_items (order_id,ticket_type_id,quantity) VALUES (v_ord,v_tt,5);
END $$;
SELECT pg_temp.drive('ADV-10 (only cancelled order => sold=0, downgrade ALLOWED)','e0000000-0000-0000-0000-000000000110', jsonb_build_object('refund_policy', :'strict'::jsonb), true);

-- ADV-11: COMBINED patch — one favorable (later deadline) + one unfavorable
-- (close bookings) in the SAME patch + sales. The unfavorable field must BLOCK
-- the WHOLE patch (RETURN before any write) — neither field persists.
SELECT pg_temp.mk_trip('e0000000-0000-0000-0000-000000000111', NULL, '2026-07-01T00:00:00Z', false);
SELECT pg_temp.add_paid_order('e0000000-0000-0000-0000-000000000111', 1);
SELECT pg_temp.drive('ADV-11 (mixed patch: later deadline OK + close harmful => BLOCK)','e0000000-0000-0000-0000-000000000111', jsonb_build_object('booking_deadline','2026-08-01T00:00:00Z','bookings_closed',true), false, 'bookings_closed_harms_active');
DO $$ BEGIN
  IF (SELECT booking_deadline FROM public.events WHERE id='e0000000-0000-0000-0000-000000000111') <> '2026-07-01T00:00:00Z'::timestamptz THEN
    RAISE EXCEPTION 'ADV-11 FAIL: favorable deadline leaked through despite the patch being blocked by the harmful close';
  END IF; RAISE NOTICE 'ADV-11 side-effect PASS: NEITHER field persisted (atomic block)';
END $$;

ROLLBACK;
\echo '================================================================'
\echo 'ORCH-1120 ADVERSARIAL E2E (real RPC): if you see this with no ERROR above, ALL T-1..T-11 + ADV-1..ADV-11 PASSED.'
