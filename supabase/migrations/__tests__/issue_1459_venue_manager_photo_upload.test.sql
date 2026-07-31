\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, created_at, updated_at
) VALUES
  ('00000000-1459-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a-1459@example.test', now(), now()),
  ('00000000-1459-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b-1459@example.test', now(), now()),
  ('00000000-1459-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manager-1459@example.test', now(), now()),
  ('00000000-1459-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'scanner-1459@example.test', now(), now());

INSERT INTO public.creator_accounts (id, created_at) VALUES
  ('00000000-1459-4000-8000-000000000001', now()),
  ('00000000-1459-4000-8000-000000000002', now());

INSERT INTO public.brands (id, account_id, name, slug, default_currency) VALUES
  ('00000000-1459-4000-8000-000000000011', '00000000-1459-4000-8000-000000000001', 'Issue 1459 Brand A', 'issue-1459-brand-a', 'USD'),
  ('00000000-1459-4000-8000-000000000012', '00000000-1459-4000-8000-000000000002', 'Issue 1459 Brand B', 'issue-1459-brand-b', 'USD');

INSERT INTO public.brand_team_members (brand_id, user_id, role, accepted_at) VALUES
  ('00000000-1459-4000-8000-000000000011', '00000000-1459-4000-8000-000000000003', 'event_manager', now()),
  ('00000000-1459-4000-8000-000000000011', '00000000-1459-4000-8000-000000000004', 'scanner', now());

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-1459-4000-8000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-1459-4000-8000-000000000003","role":"authenticated"}', true);

-- Canonical venue manager can insert, update, and delete within Brand A.
DO $manager_actions$
DECLARE
  v_rows integer;
BEGIN
  INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
  VALUES (
    '00000000-1459-4000-8000-000000000021',
    'brand_covers',
    '00000000-1459-4000-8000-000000000011/gallery/manager.heic',
    '00000000-1459-4000-8000-000000000003',
    '{"mimetype":"image/heic","size":1024}'::jsonb
  );

  UPDATE storage.objects
  SET metadata = '{"mimetype":"image/heic","size":2048}'::jsonb
  WHERE id = '00000000-1459-4000-8000-000000000021';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'issue_1459_manager_update_failed';
  END IF;

  DELETE FROM storage.objects
  WHERE id = '00000000-1459-4000-8000-000000000021';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'issue_1459_manager_delete_failed';
  END IF;
END;
$manager_actions$;

-- A manager cannot escape through a key prefixed by a different brand.
DO $cross_brand$
BEGIN
  BEGIN
    INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
    VALUES (
      '00000000-1459-4000-8000-000000000022',
      'brand_covers',
      '00000000-1459-4000-8000-000000000012/gallery/forged.jpg',
      '00000000-1459-4000-8000-000000000003',
      '{"mimetype":"image/jpeg","size":1024}'::jsonb
    );
    RAISE EXCEPTION 'issue_1459_cross_brand_insert_was_allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$cross_brand$;

-- A lower-ranked staff member cannot write even within their own brand.
SELECT set_config('request.jwt.claim.sub', '00000000-1459-4000-8000-000000000004', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-1459-4000-8000-000000000004","role":"authenticated"}', true);
DO $lower_role$
BEGIN
  BEGIN
    INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
    VALUES (
      '00000000-1459-4000-8000-000000000023',
      'brand_covers',
      '00000000-1459-4000-8000-000000000011/gallery/scanner.jpg',
      '00000000-1459-4000-8000-000000000004',
      '{"mimetype":"image/jpeg","size":1024}'::jsonb
    );
    RAISE EXCEPTION 'issue_1459_lower_role_insert_was_allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$lower_role$;

RESET ROLE;

DO $contract$
DECLARE
  v_mimes text[];
  v_limit bigint;
BEGIN
  SELECT allowed_mime_types, file_size_limit
  INTO v_mimes, v_limit
  FROM storage.buckets
  WHERE id = 'brand_covers';

  IF v_mimes IS DISTINCT FROM ARRAY[
       'image/jpeg', 'image/png', 'image/webp',
       'image/gif', 'image/heic', 'image/heif'
     ]::text[] THEN
    RAISE EXCEPTION 'issue_1459_mime_contract_failed: %', v_mimes;
  END IF;
  IF v_limit IS DISTINCT FROM 8388608 THEN
    RAISE EXCEPTION 'issue_1459_size_contract_failed: %', v_limit;
  END IF;
END;
$contract$;

ROLLBACK;
