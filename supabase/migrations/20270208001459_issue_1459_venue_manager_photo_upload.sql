-- Issue #1459 — make the shared venue gallery honor the canonical
-- event_manager+ venue-management permission and the native media contract.

BEGIN;

-- The gallery uploader writes keys below {brand_id}/gallery/. Venue and Stay
-- inventory already use event_manager as the minimum management rank, so the
-- shared media bucket must use the same boundary. The brand-prefixed key and
-- effective-rank lookup keep the permission fail-closed and brand-scoped.
DROP POLICY IF EXISTS "brand_covers_admin_write" ON storage.objects;
CREATE POLICY "brand_covers_admin_write"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'brand_covers'
  AND public.biz_brand_effective_rank_for_caller(
    (split_part(name, '/', 1))::uuid
  ) >= public.biz_role_rank('event_manager')
);

DROP POLICY IF EXISTS "brand_covers_admin_update" ON storage.objects;
CREATE POLICY "brand_covers_admin_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'brand_covers'
  AND public.biz_brand_effective_rank_for_caller(
    (split_part(name, '/', 1))::uuid
  ) >= public.biz_role_rank('event_manager')
)
WITH CHECK (
  bucket_id = 'brand_covers'
  AND public.biz_brand_effective_rank_for_caller(
    (split_part(name, '/', 1))::uuid
  ) >= public.biz_role_rank('event_manager')
);

DROP POLICY IF EXISTS "brand_covers_admin_delete" ON storage.objects;
CREATE POLICY "brand_covers_admin_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'brand_covers'
  AND public.biz_brand_effective_rank_for_caller(
    (split_part(name, '/', 1))::uuid
  ) >= public.biz_role_rank('event_manager')
);

-- Native galleries can return HEIC/HEIF. Keep the bucket and client on the
-- same 8 MiB ceiling so validation never promises an upload Storage rejects.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/heic',
      'image/heif'
    ],
    file_size_limit = 8388608
WHERE id = 'brand_covers';

DO $verify$
DECLARE
  v_insert text;
  v_update text;
  v_delete text;
  v_mimes text[];
  v_limit bigint;
BEGIN
  SELECT concat_ws(' ', qual, with_check) INTO v_insert
  FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname = 'brand_covers_admin_write';

  SELECT concat_ws(' ', qual, with_check) INTO v_update
  FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname = 'brand_covers_admin_update';

  SELECT qual INTO v_delete
  FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname = 'brand_covers_admin_delete';

  IF v_insert NOT LIKE '%event_manager%'
     OR v_update NOT LIKE '%event_manager%'
     OR v_delete NOT LIKE '%event_manager%' THEN
    RAISE EXCEPTION 'issue_1459_policy_verification_failed';
  END IF;

  SELECT allowed_mime_types, file_size_limit
  INTO v_mimes, v_limit
  FROM storage.buckets
  WHERE id = 'brand_covers';

  IF v_mimes IS DISTINCT FROM ARRAY[
       'image/jpeg', 'image/png', 'image/webp',
       'image/gif', 'image/heic', 'image/heif'
     ]::text[]
     OR v_limit IS DISTINCT FROM 8388608 THEN
    RAISE EXCEPTION 'issue_1459_bucket_contract_verification_failed';
  END IF;
END;
$verify$;

COMMIT;
