-- #3988 — private Brand-group gallery metadata and keyset-paged reads.
BEGIN;

ALTER TABLE public.brand_group_files
  ADD COLUMN IF NOT EXISTS media_width integer NULL
    CHECK (media_width IS NULL OR media_width > 0),
  ADD COLUMN IF NOT EXISTS media_height integer NULL
    CHECK (media_height IS NULL OR media_height > 0),
  ADD COLUMN IF NOT EXISTS media_duration_ms integer NULL
    CHECK (media_duration_ms IS NULL OR media_duration_ms >= 0),
  ADD COLUMN IF NOT EXISTS thumb_state text NOT NULL DEFAULT 'pending'
    CHECK (thumb_state IN ('pending', 'ready', 'none')),
  ADD COLUMN IF NOT EXISTS thumb_checked_at timestamptz NULL;

UPDATE public.brand_group_files
SET thumb_state = 'none'
WHERE thumb_state = 'pending'
  AND COALESCE(verified_mime, declared_mime) NOT LIKE 'image/%'
  AND COALESCE(verified_mime, declared_mime) NOT LIKE 'video/%';

CREATE INDEX IF NOT EXISTS brand_group_files_ready_paging_idx
  ON public.brand_group_files (conversation_id, created_at DESC, id DESC)
  WHERE state = 'ready' AND message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.issue_3988_list_brand_group_media(
  p_conversation_id uuid,
  p_kind text,
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 60
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 60), 1), 100);
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.issue_3720_brand_group_can_access(p_conversation_id, auth.uid()) THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('media', 'files') THEN
    RAISE EXCEPTION 'media_kind_invalid' USING ERRCODE = '22023';
  END IF;
  IF (p_cursor_created_at IS NULL) <> (p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'media_cursor_invalid' USING ERRCODE = '22023';
  END IF;

  WITH base AS MATERIALIZED (
    SELECT
      f.id,
      f.message_id,
      f.original_filename,
      f.verified_mime,
      f.verified_size_bytes,
      f.created_at,
      f.media_duration_ms,
      f.media_width,
      f.media_height,
      f.thumb_state,
      COALESCE(
        NULLIF(btrim(m.sender_display_name_snapshot), ''),
        NULLIF(btrim(p.display_name), ''),
        NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
        NULLIF(btrim(p.username), ''),
        'Mingla member'
      ) AS sender_display_name,
      NULLIF(btrim(m.sender_role_snapshot), '') AS sender_role,
      CASE
        WHEN f.verified_mime LIKE 'image/%' THEN 'image'
        WHEN f.verified_mime LIKE 'video/%' THEN 'video'
        ELSE 'file'
      END AS media_kind
    FROM public.brand_group_files f
    JOIN public.messages m
      ON m.id = f.message_id
     AND m.conversation_id = p_conversation_id
     AND m.deleted_at IS NULL
    LEFT JOIN public.profiles p ON p.id = m.sender_id
    WHERE f.conversation_id = p_conversation_id
      AND f.state = 'ready'
  ), candidates AS MATERIALIZED (
    SELECT
      base.*,
      row_number() OVER (ORDER BY base.created_at DESC, base.id DESC) AS ordinal
    FROM base
    WHERE (
      (p_kind = 'media' AND media_kind IN ('image', 'video'))
      OR (p_kind = 'files' AND media_kind = 'file')
    )
      AND (
        p_cursor_created_at IS NULL
        OR (base.created_at, base.id) < (p_cursor_created_at, p_cursor_id)
      )
    ORDER BY base.created_at DESC, base.id DESC
    LIMIT v_limit + 1
  ), page_rows AS (
    SELECT * FROM candidates WHERE ordinal <= v_limit
  ), page AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'fileId', id,
          'messageId', message_id,
          'name', original_filename,
          'mime', verified_mime,
          'sizeBytes', verified_size_bytes,
          'createdAt', created_at,
          'senderDisplayName', sender_display_name,
          'senderRole', sender_role,
          'kind', media_kind,
          'durationMs', media_duration_ms,
          'width', media_width,
          'height', media_height,
          'thumbState', thumb_state
        ) ORDER BY created_at DESC, id DESC
      ),
      '[]'::jsonb
    ) AS rows
    FROM page_rows
  ), next_cursor AS (
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM candidates WHERE ordinal > v_limit) THEN (
        SELECT jsonb_build_object('createdAt', created_at, 'id', id)
        FROM page_rows
        ORDER BY ordinal DESC
        LIMIT 1
      )
      ELSE NULL
    END AS value
  ), totals AS (
    SELECT
      count(*) FILTER (WHERE media_kind IN ('image', 'video'))::integer AS media,
      count(*) FILTER (WHERE media_kind = 'file')::integer AS files
    FROM base
  )
  SELECT jsonb_build_object(
    'schemaVersion', 1,
    'totals', jsonb_build_object('media', totals.media, 'files', totals.files),
    'rows', page.rows,
    'nextCursor', next_cursor.value
  )
  INTO v_result
  FROM totals CROSS JOIN page CROSS JOIN next_cursor;

  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.issue_3988_list_brand_group_media(uuid, text, timestamptz, uuid, integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.issue_3988_list_brand_group_media(uuid, text, timestamptz, uuid, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3988_list_brand_group_media(uuid, text, timestamptz, uuid, integer)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_3988_brand_group_file_media_meta(
  p_conversation_id uuid,
  p_file_ids uuid[]
) RETURNS TABLE(
  file_id uuid,
  kind text,
  duration_ms integer,
  width integer,
  height integer,
  thumb_state text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.issue_3720_brand_group_can_access(p_conversation_id, auth.uid()) THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE = '42501';
  END IF;
  IF cardinality(p_file_ids) IS NULL
     OR cardinality(p_file_ids) = 0
     OR cardinality(p_file_ids) > 200 THEN
    RAISE EXCEPTION 'media_ids_invalid' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    f.id,
    CASE
      WHEN f.verified_mime LIKE 'image/%' THEN 'image'
      WHEN f.verified_mime LIKE 'video/%' THEN 'video'
      ELSE 'file'
    END,
    f.media_duration_ms,
    f.media_width,
    f.media_height,
    f.thumb_state
  FROM public.brand_group_files f
  WHERE f.conversation_id = p_conversation_id
    AND f.id = ANY(p_file_ids)
    AND f.state = 'ready';
END;
$function$;

ALTER FUNCTION public.issue_3988_brand_group_file_media_meta(uuid, uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.issue_3988_brand_group_file_media_meta(uuid, uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3988_brand_group_file_media_meta(uuid, uuid[])
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_3988_set_brand_group_file_media(
  p_file_id uuid,
  p_width integer,
  p_height integer,
  p_duration_ms integer,
  p_thumb_state text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF p_thumb_state IS NULL OR p_thumb_state NOT IN ('pending', 'ready', 'none')
     OR (p_width IS NOT NULL AND p_width <= 0)
     OR (p_height IS NOT NULL AND p_height <= 0)
     OR (p_duration_ms IS NOT NULL AND p_duration_ms < 0) THEN
    RAISE EXCEPTION 'media_metadata_invalid' USING ERRCODE = '22023';
  END IF;

  UPDATE public.brand_group_files
  SET media_width = p_width,
      media_height = p_height,
      media_duration_ms = p_duration_ms,
      thumb_state = p_thumb_state,
      thumb_checked_at = now(),
      updated_at = now()
  WHERE id = p_file_id;
END;
$function$;

ALTER FUNCTION public.issue_3988_set_brand_group_file_media(uuid, integer, integer, integer, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.issue_3988_set_brand_group_file_media(uuid, integer, integer, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3988_set_brand_group_file_media(uuid, integer, integer, integer, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3988_file_thumb_state(p_file_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'thumbState', f.thumb_state,
    'thumbCheckedAt', f.thumb_checked_at,
    'width', f.media_width,
    'height', f.media_height,
    'durationMs', f.media_duration_ms
  )
  FROM public.brand_group_files f
  WHERE f.id = p_file_id AND f.state = 'ready';
$function$;

ALTER FUNCTION public.issue_3988_file_thumb_state(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.issue_3988_file_thumb_state(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3988_file_thumb_state(uuid) TO service_role;

COMMIT;
