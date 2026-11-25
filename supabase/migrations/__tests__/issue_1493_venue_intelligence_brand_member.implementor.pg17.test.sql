-- #1493 — the shared Business Overview intelligence RPC admits every accepted,
-- active brand member, while preserving cross-brand and venue containment.
--
-- MINGLA-INVARIANT: I-1493-VENUE-INTELLIGENCE-MEMBER-READ | issue #1493 |
-- Venue Overview uses the same accepted brand-member read contract on Business
-- web, iOS and Android; an unrelated user and a venue from another brand are
-- refused with 42501.
--
-- FAILS-ON-REVERT: restore the owner-only brands.account_id check and A-1 fails.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES
  ('14930000-0000-4000-8000-000000000001'),
  ('14930000-0000-4000-8000-000000000002'),
  ('14930000-0000-4000-8000-000000000003'),
  ('14930000-0000-4000-8000-000000000004');

INSERT INTO public.creator_accounts (id, email) VALUES
  ('14930000-0000-4000-8000-000000000001', '1493-owner-a@example.test'),
  ('14930000-0000-4000-8000-000000000002', '1493-admin@example.test'),
  ('14930000-0000-4000-8000-000000000003', '1493-outsider@example.test'),
  ('14930000-0000-4000-8000-000000000004', '1493-owner-b@example.test');

INSERT INTO public.brands (id, account_id, name, slug, default_currency) VALUES
  ('14930000-0000-4000-9000-000000000001', '14930000-0000-4000-8000-000000000001', 'Issue 1493 A', 'issue-1493-a', 'NGN'),
  ('14930000-0000-4000-9000-000000000002', '14930000-0000-4000-8000-000000000004', 'Issue 1493 B', 'issue-1493-b', 'NGN');

INSERT INTO public.brand_team_members (brand_id, user_id, role, accepted_at)
VALUES ('14930000-0000-4000-9000-000000000001', '14930000-0000-4000-8000-000000000002', 'brand_admin', now());

INSERT INTO public.venue_listings
  (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code)
VALUES
  ('14930000-0000-4000-a000-000000000001', '14930000-0000-4000-9000-000000000001', 'issue1493a', 'Issue 1493 Venue A', 6.45, 3.40, 'play', 'verified', 'NG'),
  ('14930000-0000-4000-a000-000000000002', '14930000-0000-4000-9000-000000000002', 'issue1493b', 'Issue 1493 Venue B', 6.46, 3.41, 'play', 'verified', 'NG');

DO $test$
DECLARE
  v_result jsonb;
  v_refused boolean;
BEGIN
  -- A-1: the production failure case — an accepted brand_admin is not the
  -- brands.account_id owner, but receives the honest empty intelligence shape.
  PERFORM set_config('request.jwt.claim.sub', '14930000-0000-4000-8000-000000000002', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"14930000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  v_result := public.venue_intelligence_overview(
    '14930000-0000-4000-9000-000000000001',
    '14930000-0000-4000-a000-000000000001'
  );
  IF jsonb_typeof(v_result) <> 'object' OR (v_result->>'order_count')::integer <> 0 THEN
    RAISE EXCEPTION 'A-1 FAIL: accepted brand_admin did not receive the empty intelligence object: %', v_result;
  END IF;
  RAISE NOTICE 'A-1 PASS accepted brand_admin reads Venue Overview intelligence';

  -- A-2: the account owner still reads the same venue.
  PERFORM set_config('request.jwt.claim.sub', '14930000-0000-4000-8000-000000000001', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"14930000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  v_result := public.venue_intelligence_overview(
    '14930000-0000-4000-9000-000000000001',
    '14930000-0000-4000-a000-000000000001'
  );
  IF jsonb_typeof(v_result) <> 'object' THEN
    RAISE EXCEPTION 'A-2 FAIL: brand owner lost intelligence access';
  END IF;
  RAISE NOTICE 'A-2 PASS brand owner retains Venue Overview intelligence';

  -- A-3: an unrelated authenticated user remains fail-closed.
  PERFORM set_config('request.jwt.claim.sub', '14930000-0000-4000-8000-000000000003', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"14930000-0000-4000-8000-000000000003","role":"authenticated"}', true);
  v_refused := false;
  BEGIN
    PERFORM public.venue_intelligence_overview(
      '14930000-0000-4000-9000-000000000001',
      '14930000-0000-4000-a000-000000000001'
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'A-3 FAIL: unrelated user read Venue Overview intelligence';
  END IF;
  RAISE NOTICE 'A-3 PASS unrelated user refused with 42501';

  -- A-4: a valid member cannot smuggle a venue belonging to another brand.
  PERFORM set_config('request.jwt.claim.sub', '14930000-0000-4000-8000-000000000002', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"14930000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  v_refused := false;
  BEGIN
    PERFORM public.venue_intelligence_overview(
      '14930000-0000-4000-9000-000000000001',
      '14930000-0000-4000-a000-000000000002'
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'A-4 FAIL: cross-brand venue was accepted';
  END IF;
  RAISE NOTICE 'A-4 PASS cross-brand venue refused with 42501';
END
$test$;

ROLLBACK;
