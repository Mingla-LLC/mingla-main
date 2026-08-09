-- #1615 forward-only immutable portrait resolver.
-- Stable /s links resolve current truth; versioned /og/s images resolve the
-- exact immutable snapshot named by their URL, even after current_version moves.

BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_content_share_version(
  p_code text,
  p_version integer
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT CASE
    WHEN l.id IS NULL OR v.id IS NULL THEN NULL
    WHEN l.state IN ('revoked','deleted')
      OR (l.expires_at IS NOT NULL AND l.expires_at <= now())
      THEN jsonb_build_object('state', l.state, 'gone', true)
    ELSE jsonb_build_object(
      'state', l.state, 'gone', false, 'shortCode', l.short_code,
      'version', v.version, 'facts', v.facts, 'media', v.media_identity,
      'destination', v.destination_manifest - 'publicDetails',
      'publicDetails', COALESCE(v.destination_manifest->'publicDetails', jsonb_build_object('kind', l.entity_kind))
    )
  END
  FROM (SELECT p_code AS requested_code, p_version AS requested_version) request
  LEFT JOIN public.content_share_links l
    ON l.short_code = request.requested_code
      AND p_code ~ '^[0-9A-Za-z]{16}$'
  LEFT JOIN public.content_share_versions v
    ON v.link_id = l.id AND v.version = request.requested_version
  WHERE request.requested_version > 0;
$function$;

REVOKE ALL ON FUNCTION public.resolve_content_share_version(text,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_content_share_version(text,integer)
  TO service_role;

COMMENT ON FUNCTION public.resolve_content_share_version(text,integer) IS
  '#1615 service-role-only exact immutable content-share version resolver for cache-forever portraits.';

-- Current reads expose the same sanitized envelope as exact reads. Private
-- source_reference, source_key, principal and attribution never cross it.
CREATE OR REPLACE FUNCTION public.resolve_content_share_code(p_code text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT CASE
    WHEN l.id IS NULL THEN NULL
    WHEN l.state IN ('revoked','deleted') OR (l.expires_at IS NOT NULL AND l.expires_at <= now())
      THEN jsonb_build_object('state', l.state, 'gone', true)
    ELSE jsonb_build_object(
      'state', l.state, 'gone', false, 'shortCode', l.short_code,
      'version', v.version, 'facts', v.facts, 'media', v.media_identity,
      'destination', v.destination_manifest - 'publicDetails',
      'publicDetails', COALESCE(v.destination_manifest->'publicDetails', jsonb_build_object('kind', l.entity_kind))
    )
  END
  FROM (SELECT p_code AS requested_code) request
  LEFT JOIN public.content_share_links l
    ON l.short_code = request.requested_code AND p_code ~ '^[0-9A-Za-z]{16}$'
  LEFT JOIN public.content_share_versions v
    ON v.link_id = l.id AND v.version = l.current_version;
$function$;
REVOKE ALL ON FUNCTION public.resolve_content_share_code(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_content_share_code(text) TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_content_share_alias(p_share_id text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT CASE
    WHEN a.id IS NULL OR l.id IS NULL THEN NULL
    WHEN l.state IN ('revoked','deleted') THEN jsonb_build_object('state', l.state, 'gone', true)
    ELSE jsonb_build_object(
      'state', l.state, 'gone', false, 'shortCode', l.short_code,
      'version', v.version, 'facts', v.facts, 'media', v.media_identity,
      'destination', v.destination_manifest - 'publicDetails',
      'publicDetails', COALESCE(v.destination_manifest->'publicDetails', jsonb_build_object('kind', l.entity_kind))
    )
  END
  FROM (SELECT p_share_id AS alias_value) request
  LEFT JOIN public.content_share_aliases a
    ON a.alias_kind = 'legacy_snapshot' AND a.alias_value = request.alias_value
  LEFT JOIN public.content_share_links l ON l.id = a.link_id
  LEFT JOIN public.content_share_versions v ON v.link_id = l.id AND v.version = l.current_version;
$function$;
REVOKE ALL ON FUNCTION public.resolve_content_share_alias(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_content_share_alias(text) TO service_role;

-- Repair the already-live lossy legacy bridge by appending (never mutating) a
-- version containing the original public cover and ordered sanitized stops.
DO $legacy_bridge$
DECLARE
  v_old record;
  v_alias record;
  v_result jsonb;
BEGIN
  FOR v_old IN
    SELECT share_id, owner_profile_id, kind, title, cover_url, metadata, stops,
      source_ids, attribution, revoked_at
    FROM public.shared_card_snapshots
    ORDER BY created_at, share_id
  LOOP
    SELECT a.link_id, l.short_code, l.source_key INTO v_alias
    FROM public.content_share_aliases a
    JOIN public.content_share_links l ON l.id = a.link_id
    WHERE a.alias_kind = 'legacy_snapshot' AND a.alias_value = v_old.share_id::text;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF v_alias.source_key IS DISTINCT FROM 'legacy_snapshot:' || v_old.share_id THEN
      RAISE EXCEPTION 'legacy_alias_collision:%', v_old.share_id;
    END IF;
    -- A place cannot satisfy the public destination contract without its
    -- Google identity. Preserve its original /p snapshot instead of exposing
    -- an invalid /s alias or inventing an identifier.
    IF v_old.kind='place' AND NULLIF(v_old.source_ids->>'googlePlaceId','') IS NULL THEN
      DELETE FROM public.content_share_aliases
      WHERE alias_kind='legacy_snapshot' AND alias_value=v_old.share_id::text AND link_id=v_alias.link_id;
      CONTINUE;
    END IF;
    IF v_old.revoked_at IS NOT NULL THEN
      UPDATE public.content_share_links SET state='revoked', revoked_at=v_old.revoked_at, updated_at=now()
      WHERE id=v_alias.link_id AND state='active';
      CONTINUE;
    END IF;
    v_result := public.upsert_content_share_version(
      v_old.kind,
      v_old.owner_profile_id,
      'legacy_snapshot:' || v_old.share_id,
      jsonb_build_object('legacyShareId', v_old.share_id, 'sourceIds', v_old.source_ids),
      COALESCE(v_old.attribution, '{}'::jsonb),
      jsonb_strip_nulls(jsonb_build_object(
        'schemaVersion', 1, 'kind', v_old.kind, 'title', v_old.title,
        'category', NULLIF(v_old.metadata->>'category', ''),
        'area', NULLIF(v_old.metadata->>'location', ''),
        'priceLevel', CASE WHEN v_old.kind='place' THEN NULLIF(v_old.metadata->>'price', '') END,
        'duration', CASE WHEN v_old.kind='curated' THEN NULLIF(v_old.metadata->>'duration', '') END,
        'description', NULLIF(v_old.metadata->>'description', '')
      )),
      CASE WHEN NULLIF(v_old.cover_url, '') IS NULL THEN NULL ELSE
        jsonb_build_object('kind','photo','url',v_old.cover_url,'posterUrl',v_old.cover_url,'alt',v_old.title) END,
      jsonb_strip_nulls(jsonb_build_object(
        'kind', v_old.kind,
        'placeId', CASE WHEN v_old.kind='place' THEN NULLIF(v_old.source_ids->>'googlePlaceId','') END,
        'publicDetails', CASE WHEN v_old.kind='curated' THEN jsonb_build_object(
          'kind','curated','stops',COALESCE((
            SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
              'title',NULLIF(item->>'title',''),'category',NULLIF(item->>'category',''),
              'area',NULLIF(COALESCE(item->>'area',item->>'neighborhood'),'') ,
              'address',NULLIF(item->>'address',''),'description',NULLIF(item->>'description',''),
              'imageUrl',NULLIF(COALESCE(item->>'imageUrl',item->>'image_url'),'')
            )) ORDER BY ordinal)
            FROM jsonb_array_elements(COALESCE(v_old.stops,'[]'::jsonb)) WITH ORDINALITY AS stop(item,ordinal)
            WHERE NULLIF(item->>'title','') IS NOT NULL
          ),'[]'::jsonb)
        ) ELSE jsonb_strip_nulls(jsonb_build_object(
          'kind','place','description',NULLIF(v_old.metadata->>'description',''),
          'address',NULLIF(v_old.metadata->>'location',''),'phone',NULLIF(v_old.metadata->>'phone',''),
          'website',NULLIF(v_old.metadata->>'website','')
        )) END
      ))
    );
    IF v_result->>'shortCode' IS DISTINCT FROM v_alias.short_code THEN
      RAISE EXCEPTION 'legacy_alias_collision:%', v_old.share_id;
    END IF;
  END LOOP;
END;
$legacy_bridge$;

COMMIT;
NOTIFY pgrst, 'reload schema';
