-- ORCH-1150 R2 D-10 [RSVP 'maybe' status] — SQL contract tests (T1 / T2 / T3 / T4).
--
-- Covers the live-DB half of the maybe semantics for migration
-- 20261012000000_orch_1150_rsvp_maybe.sql:
--   T1 = a 'maybe' submit writes rsvp_status='maybe', approval_status='approved'.
--   T2 = a 'maybe' is CAP-NEUTRAL (does not consume a seat; the next Going still fits).
--   T3 = at cap, 1 going + 1 maybe → a 2nd going still fits (maybe didn't fill seat 2).
--   T4 = an invalid status still raises rsvp_status_invalid.
-- These enforce I-PROPOSED-1150-MAYBE-NOT-IN-CAP on the live RPC.
--
-- USAGE (hand-run against the linked remote AFTER the orchestrator applies the
-- migration — NOT run by the implementor):
--
--   cat supabase/migrations/__tests__/orch_1150_maybe.test.sql \
--     | /Users/sethogieva/bin/supabase db remote sql --linked
--
-- Each block is wrapped in BEGIN; … ROLLBACK; so it leaves NO fixture rows.

-- ===========================================================================
-- T1 — submit_event_rsvp(..., 'maybe') for a reachable link guest → the row is
-- rsvp_status='maybe', approval_status='approved'; the RPC returns status maybe.
-- ===========================================================================
BEGIN;
DO $$
DECLARE
  v_user   uuid := gen_random_uuid();
  v_brand  uuid := gen_random_uuid();
  v_event  uuid := gen_random_uuid();
  v_res    jsonb;
  v_status text;
  v_appr   text;
BEGIN
  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
  VALUES (v_brand, v_user, 'orch1150-maybe-t1', 'Maybe T1', 'USD', now(), now());
  INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug, description,
    status, visibility, currency, timezone, party_types, rsvp_approval_mode, created_at, updated_at)
  VALUES (v_event, v_brand, v_user, 'rsvp', 'Maybe Party', 'maybe-party-t1', 'vibes',
    'scheduled', 'public', 'USD', 'UTC', ARRAY['house-party'], 'auto', now(), now());

  v_res := public.submit_event_rsvp(v_event, NULL, 'Mae Beigh', 'mae@example.com', '+15551230001', 'maybe', 0);

  IF (v_res->>'status') <> 'maybe' THEN
    RAISE EXCEPTION 'T1 FAIL: RPC returned status % (expected maybe)', v_res->>'status';
  END IF;
  IF (v_res->>'approvalStatus') <> 'approved' THEN
    RAISE EXCEPTION 'T1 FAIL: RPC returned approvalStatus % (expected approved)', v_res->>'approvalStatus';
  END IF;

  SELECT rsvp_status, approval_status INTO v_status, v_appr
    FROM public.event_rsvps WHERE event_id = v_event AND lower(guest_email) = 'mae@example.com';
  IF v_status <> 'maybe' OR v_appr <> 'approved' THEN
    RAISE EXCEPTION 'T1 FAIL: row is (%, %) expected (maybe, approved)', v_status, v_appr;
  END IF;

  RAISE NOTICE 'T1 PASS: maybe submit → row maybe/approved, RPC returns maybe';
END$$;
ROLLBACK;

-- ===========================================================================
-- T2 — cap-neutral: cap=1, one going+approved already, then a maybe submit.
-- The maybe is written; it does NOT raise rsvp_full and does NOT change the
-- confirmed headcount.
-- ===========================================================================
BEGIN;
DO $$
DECLARE
  v_user   uuid := gen_random_uuid();
  v_brand  uuid := gen_random_uuid();
  v_event  uuid := gen_random_uuid();
  v_res    jsonb;
  v_going  int;
BEGIN
  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
  VALUES (v_brand, v_user, 'orch1150-maybe-t2', 'Maybe T2', 'USD', now(), now());
  INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug, description,
    status, visibility, currency, timezone, party_types, rsvp_approval_mode, rsvp_capacity, created_at, updated_at)
  VALUES (v_event, v_brand, v_user, 'rsvp', 'Cap1 Party', 'cap1-party-t2', 'vibes',
    'scheduled', 'public', 'USD', 'UTC', ARRAY['house-party'], 'auto', 1, now(), now());

  -- Fill the single seat with a going guest.
  PERFORM public.submit_event_rsvp(v_event, NULL, 'Going One', 'g1@example.com', '+15551230002', 'going', 0);

  -- A maybe must NOT raise rsvp_full at a full cap.
  v_res := public.submit_event_rsvp(v_event, NULL, 'Maybe One', 'm1@example.com', '+15551230003', 'maybe', 0);
  IF (v_res->>'status') <> 'maybe' THEN
    RAISE EXCEPTION 'T2 FAIL: maybe at full cap returned % (expected maybe)', v_res->>'status';
  END IF;

  SELECT COALESCE(SUM(1 + plus_count), 0) INTO v_going
    FROM public.event_rsvps WHERE event_id = v_event
      AND rsvp_status = 'going' AND approval_status = 'approved';
  IF v_going <> 1 THEN
    RAISE EXCEPTION 'T2 FAIL: confirmed headcount is % (expected 1 — maybe must not count)', v_going;
  END IF;

  RAISE NOTICE 'T2 PASS: maybe is cap-neutral (no rsvp_full, headcount unchanged)';
END$$;
ROLLBACK;

-- ===========================================================================
-- T3 — at cap=2 with 1 going + 1 maybe, a 2nd going still fits (the maybe did
-- not occupy seat 2).
-- ===========================================================================
BEGIN;
DO $$
DECLARE
  v_user   uuid := gen_random_uuid();
  v_brand  uuid := gen_random_uuid();
  v_event  uuid := gen_random_uuid();
  v_res    jsonb;
BEGIN
  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
  VALUES (v_brand, v_user, 'orch1150-maybe-t3', 'Maybe T3', 'USD', now(), now());
  INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug, description,
    status, visibility, currency, timezone, party_types, rsvp_approval_mode, rsvp_capacity, created_at, updated_at)
  VALUES (v_event, v_brand, v_user, 'rsvp', 'Cap2 Party', 'cap2-party-t3', 'vibes',
    'scheduled', 'public', 'USD', 'UTC', ARRAY['house-party'], 'auto', 2, now(), now());

  PERFORM public.submit_event_rsvp(v_event, NULL, 'Going A', 'ga@example.com', '+15551230004', 'going', 0);
  PERFORM public.submit_event_rsvp(v_event, NULL, 'Maybe B', 'mb@example.com', '+15551230005', 'maybe', 0);
  -- The 2nd going must succeed (only 1 seat consumed so far).
  v_res := public.submit_event_rsvp(v_event, NULL, 'Going C', 'gc@example.com', '+15551230006', 'going', 0);
  IF (v_res->>'status') <> 'going' THEN
    RAISE EXCEPTION 'T3 FAIL: 2nd going returned % (expected going — maybe should not fill a seat)', v_res->>'status';
  END IF;

  RAISE NOTICE 'T3 PASS: a 2nd going still fits past a maybe (maybe is seatless)';
END$$;
ROLLBACK;

-- ===========================================================================
-- T4 — an invalid rsvp_status still raises rsvp_status_invalid.
-- ===========================================================================
BEGIN;
DO $$
DECLARE
  v_user   uuid := gen_random_uuid();
  v_brand  uuid := gen_random_uuid();
  v_event  uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
  VALUES (v_brand, v_user, 'orch1150-maybe-t4', 'Maybe T4', 'USD', now(), now());
  INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug, description,
    status, visibility, currency, timezone, party_types, rsvp_approval_mode, created_at, updated_at)
  VALUES (v_event, v_brand, v_user, 'rsvp', 'Bad Status', 'bad-status-t4', 'vibes',
    'scheduled', 'public', 'USD', 'UTC', ARRAY['house-party'], 'auto', now(), now());

  BEGIN
    PERFORM public.submit_event_rsvp(v_event, NULL, 'Ban Ana', 'banana@example.com', '+15551230007', 'banana', 0);
    RAISE EXCEPTION 'T4 FAIL: invalid status was accepted (expected rsvp_status_invalid)';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%rsvp_status_invalid%' THEN
      RAISE EXCEPTION 'T4 FAIL: wrong error % (expected rsvp_status_invalid)', SQLERRM;
    END IF;
  END;

  RAISE NOTICE 'T4 PASS: invalid status still rejected with rsvp_status_invalid';
END$$;
ROLLBACK;
