-- ORCH-1119B: ADDITIVE event_covers Storage RLS for the 3-segment trip-day-media key.
-- Scope: permits {brandId}/{eventId}/trip-day-media/{file} writes ONLY.
-- Does NOT modify the existing 2-segment cover/experience-stop policies
-- (array_length = 2); those stay exactly as-is. Fail-closed: same brand/event
-- identity + caller-rank->=-event_manager predicate as the 2-segment policy.
-- Ref: Supabase Storage Access Control — subfolder scoping via
-- (storage.foldername(name))[n]; public buckets enforce RLS on INSERT/UPDATE/
-- DELETE/move/copy but bypass it on downloads, so no new SELECT policy is needed
-- (the bucket-wide "Public can read event covers" SELECT already serves reads).
-- https://supabase.com/docs/guides/storage/security/access-control

DROP POLICY IF EXISTS "Event managers can upload trip day media" ON storage.objects;
DROP POLICY IF EXISTS "Event managers can update trip day media" ON storage.objects;
DROP POLICY IF EXISTS "Event managers can delete trip day media" ON storage.objects;

CREATE POLICY "Event managers can upload trip day media"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'event_covers'
  AND array_length(storage.foldername(name), 1) = 3
  AND (storage.foldername(name))[3] = 'trip-day-media'
  AND storage.filename(name) <> ''
  AND EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.brand_id::text = (storage.foldername(name))[1]
      AND e.id::text = (storage.foldername(name))[2]
      AND e.deleted_at IS NULL
      AND public.biz_brand_effective_rank_for_caller(e.brand_id) >= public.biz_role_rank('event_manager')
  )
);

CREATE POLICY "Event managers can update trip day media"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'event_covers'
  AND array_length(storage.foldername(name), 1) = 3
  AND (storage.foldername(name))[3] = 'trip-day-media'
  AND storage.filename(name) <> ''
  AND EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.brand_id::text = (storage.foldername(name))[1]
      AND e.id::text = (storage.foldername(name))[2]
      AND e.deleted_at IS NULL
      AND public.biz_brand_effective_rank_for_caller(e.brand_id) >= public.biz_role_rank('event_manager')
  )
)
WITH CHECK (
  bucket_id = 'event_covers'
  AND array_length(storage.foldername(name), 1) = 3
  AND (storage.foldername(name))[3] = 'trip-day-media'
  AND storage.filename(name) <> ''
  AND EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.brand_id::text = (storage.foldername(name))[1]
      AND e.id::text = (storage.foldername(name))[2]
      AND e.deleted_at IS NULL
      AND public.biz_brand_effective_rank_for_caller(e.brand_id) >= public.biz_role_rank('event_manager')
  )
);

CREATE POLICY "Event managers can delete trip day media"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'event_covers'
  AND array_length(storage.foldername(name), 1) = 3
  AND (storage.foldername(name))[3] = 'trip-day-media'
  AND storage.filename(name) <> ''
  AND EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.brand_id::text = (storage.foldername(name))[1]
      AND e.id::text = (storage.foldername(name))[2]
      AND e.deleted_at IS NULL
      AND public.biz_brand_effective_rank_for_caller(e.brand_id) >= public.biz_role_rank('event_manager')
  )
);
