-- Issue #1365 happy-path SQL contract. Run after the migration in a disposable
-- database. The assertions intentionally inspect the deployed definitions so
-- reverting venue ownership or the exact-venue public join fails.
BEGIN;

DO $test$
DECLARE
  v_view text;
  v_trigger_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'menus'
      AND column_name = 'venue_id'
  ) THEN
    RAISE EXCEPTION 'issue_1365: menus.venue_id missing';
  END IF;

  SELECT pg_get_viewdef('public.public_menus_view'::regclass, true)
  INTO v_view;
  IF v_view NOT LIKE '%v.id = m.venue_id%'
     OR v_view NOT LIKE '%v.claim_status = ''verified''%' THEN
    RAISE EXCEPTION 'issue_1365: public menu is not exact verified venue scoped';
  END IF;

  SELECT count(*)
  INTO v_trigger_count
  FROM pg_trigger
  WHERE tgrelid = 'public.menus'::regclass
    AND NOT tgisinternal
    AND tgname IN ('menus_venue_brand_match', 'menus_require_venue_on_write');
  IF v_trigger_count <> 2 THEN
    RAISE EXCEPTION 'issue_1365: menu venue write guards missing';
  END IF;
END;
$test$;

-- Rollout compatibility: installed pre-#1365 clients omit venue_id. Prefer one
-- verified venue even with a non-public sibling; otherwise one total venue is
-- unambiguous. Two verified venues must never be guessed.
INSERT INTO auth.users (id, email)
VALUES
  ('a1365aaa-0000-4000-8000-000000000001', 'issue1365-single@test.local'),
  ('a1365bbb-0000-4000-8000-000000000002', 'issue1365-multi@test.local'),
  ('a1365ccc-0000-4000-8000-000000000003', 'issue1365-zero@test.local'),
  ('a1365ddd-0000-4000-8000-000000000004', 'issue1365-ambiguous@test.local');

INSERT INTO public.creator_accounts (id)
VALUES
  ('a1365aaa-0000-4000-8000-000000000001'),
  ('a1365bbb-0000-4000-8000-000000000002'),
  ('a1365ccc-0000-4000-8000-000000000003'),
  ('a1365ddd-0000-4000-8000-000000000004');

INSERT INTO public.brands (id, account_id, slug, name, created_at, updated_at)
VALUES
  ('b1365aaa-0000-4000-8000-000000000001', 'a1365aaa-0000-4000-8000-000000000001',
   'issue1365single', 'Issue 1365 Single', now(), now()),
  ('b1365bbb-0000-4000-8000-000000000002', 'a1365bbb-0000-4000-8000-000000000002',
   'issue1365multi', 'Issue 1365 Multi', now(), now()),
  ('b1365ccc-0000-4000-8000-000000000003', 'a1365ccc-0000-4000-8000-000000000003',
   'issue1365zero', 'Issue 1365 Zero', now(), now()),
  ('b1365ddd-0000-4000-8000-000000000004', 'a1365ddd-0000-4000-8000-000000000004',
   'issue1365ambiguous', 'Issue 1365 Ambiguous', now(), now());

INSERT INTO public.venue_listings (
  id, brand_id, slug, name, lat, lng, venue_category, claim_status
)
VALUES
  ('c1365aaa-0000-4000-8000-000000000001', 'b1365aaa-0000-4000-8000-000000000001',
   'singlepending', 'Single Pending', 51.5, -0.1, 'restaurant', 'pending_review'),
  ('c1365bbb-0000-4000-8000-000000000002', 'b1365bbb-0000-4000-8000-000000000002',
   'multiverified', 'Multi Verified', 40.7, -74.0, 'restaurant', 'verified'),
  ('c1365bbb-0000-4000-8000-000000000003', 'b1365bbb-0000-4000-8000-000000000002',
   'multipending', 'Multi Pending', 40.8, -73.9, 'play', 'pending_review'),
  ('c1365ddd-0000-4000-8000-000000000004', 'b1365ddd-0000-4000-8000-000000000004',
   'firstverified', 'First Verified', 34.0, -118.2, 'restaurant', 'verified'),
  ('c1365ddd-0000-4000-8000-000000000005', 'b1365ddd-0000-4000-8000-000000000004',
   'secondverified', 'Second Verified', 34.1, -118.3, 'play', 'verified');

DO $compat$
DECLARE
  v_menu_id uuid;
  v_venue_id uuid;
BEGIN
  -- Legacy INSERT omits venue_id; the only venue is assigned even before
  -- verification. It remains private because public_menus_view is verified-only.
  INSERT INTO public.menus (brand_id, name)
  VALUES ('b1365aaa-0000-4000-8000-000000000001', 'Legacy insert')
  RETURNING id, venue_id INTO v_menu_id, v_venue_id;

  IF v_venue_id <> 'c1365aaa-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'issue_1365: legacy single-venue insert was not assigned';
  END IF;

  -- Explicitly clear venue_id to model an old update payload. The same exact
  -- venue must be restored rather than rejecting the save.
  UPDATE public.menus
     SET venue_id = NULL, description = 'Legacy update'
   WHERE id = v_menu_id
  RETURNING venue_id INTO v_venue_id;

  IF v_venue_id <> 'c1365aaa-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'issue_1365: legacy single-venue update was not assigned';
  END IF;

  -- Production shape: one verified venue plus a pending sibling must resolve
  -- to the verified venue so the existing public menu remains available.
  INSERT INTO public.menus (brand_id, name)
  VALUES ('b1365bbb-0000-4000-8000-000000000002', 'Verified preference')
  RETURNING venue_id INTO v_venue_id;

  IF v_venue_id <> 'c1365bbb-0000-4000-8000-000000000002'::uuid THEN
    RAISE EXCEPTION 'issue_1365: sole verified venue was not preferred';
  END IF;

  BEGIN
    INSERT INTO public.menus (brand_id, name)
    VALUES ('b1365ddd-0000-4000-8000-000000000004', 'Ambiguous legacy insert');
    RAISE EXCEPTION 'issue_1365: two-verified legacy insert unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'menu_venue_ambiguous' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    INSERT INTO public.menus (brand_id, name)
    VALUES ('b1365ccc-0000-4000-8000-000000000003', 'No venue legacy insert');
    RAISE EXCEPTION 'issue_1365: zero-venue legacy insert unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'menu_venue_required' THEN
        RAISE;
      END IF;
  END;
END;
$compat$;

ROLLBACK;
