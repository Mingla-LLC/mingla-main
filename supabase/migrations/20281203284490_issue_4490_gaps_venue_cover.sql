-- #4490 gap list 07-L: use the venue's cover for an event there (N107).
-- Number note: spec 07 reserved 354490 for L; round 1 takes the next free
-- number in the reserved range (conductor ruling), so L is 294490.
--
-- Images and GIFs are copied by the edge (event-cover-attest-selection action
-- copy_venue_cover) into event_covers/<brand>/<event>/ and pass the existing
-- upload branch unchanged. A video cover is not copied: the upload VIDEO branch
-- of assert_event_cover_selection_source now also accepts the linked venue's
-- current video cover when a ready venue / venue_draft job of the same brand
-- produced it. No new provider value, no constraint change; signature, grants
-- and search_path unchanged (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.assert_event_cover_selection_source(
  p_event_id uuid,p_brand_id uuid,p_url text,p_type text,p_poster_url text,
  p_provider text,p_source_url text
) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,storage,pg_temp AS $fn$
DECLARE v_media_path text;v_poster_path text;
BEGIN
  PERFORM public.assert_cover_media_triplet(p_url,p_type,p_poster_url);
  CASE COALESCE(NULLIF(p_provider,''),'upload')
    WHEN 'upload' THEN
      IF p_type='video' THEN
        IF NOT EXISTS(
          SELECT 1 FROM public.event_cover_video_jobs j
          WHERE j.event_id=p_event_id AND j.brand_id=p_brand_id
            AND j.target_kind='event' AND j.status='ready'
            AND j.processed_url=p_url AND j.processed_poster_url=p_poster_url
        )
        -- #4490 07-L: or the event's linked venue's CURRENT video cover, made
        -- by a ready venue (or venue wizard draft) job of the same brand.
        AND NOT EXISTS(
          SELECT 1 FROM public.events e
          JOIN public.venue_listings v ON v.id=e.venue_id
          WHERE e.id=p_event_id AND v.brand_id=p_brand_id
            AND v.cover_media_type='video'
            AND v.cover_media_url=p_url AND v.cover_media_poster_url=p_poster_url
            AND EXISTS(
              SELECT 1 FROM public.event_cover_video_jobs j
              WHERE j.brand_id=p_brand_id AND j.status='ready'
                AND j.target_kind IN ('venue','venue_draft')
                AND (j.target_kind='venue_draft' OR j.venue_id=v.id)
                AND j.processed_url=p_url AND j.processed_poster_url=p_poster_url
            )
        ) THEN RAISE EXCEPTION 'cover_selection_source_unverified';END IF;
      ELSE
        v_media_path:=split_part(p_url,'/storage/v1/object/public/event_covers/',2);
        v_poster_path:=split_part(p_poster_url,'/storage/v1/object/public/event_covers/',2);
        IF v_media_path='' OR v_media_path NOT LIKE p_brand_id::text||'/'||p_event_id::text||'/%'
          OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='event_covers' AND o.name=v_media_path)
          OR (p_type='gif' AND (
            v_poster_path='' OR v_poster_path NOT LIKE p_brand_id::text||'/'||p_event_id::text||'/%'
            OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='event_covers' AND o.name=v_poster_path)
          ))
        THEN RAISE EXCEPTION 'cover_selection_source_unverified';END IF;
      END IF;
    WHEN 'giphy' THEN
      IF p_type<>'gif'
        OR p_url !~ '^https://([a-z0-9-]+\.)?(giphy\.com|giphy\.net)/'
        OR p_poster_url !~ '^https://([a-z0-9-]+\.)?(giphy\.com|giphy\.net)/'
        OR COALESCE(p_source_url,'') !~ '^https://([a-z0-9-]+\.)?giphy\.com/'
      THEN RAISE EXCEPTION 'cover_selection_source_unverified';END IF;
    WHEN 'pexels' THEN
      IF p_type<>'image' OR p_url<>p_poster_url
        OR p_url !~ '^https://images\.pexels\.com/'
        OR COALESCE(p_source_url,'') !~ '^https://([a-z0-9-]+\.)?pexels\.com/'
      THEN RAISE EXCEPTION 'cover_selection_source_unverified';END IF;
    ELSE RAISE EXCEPTION 'cover_selection_provider_unverified';
  END CASE;
END;$fn$;

