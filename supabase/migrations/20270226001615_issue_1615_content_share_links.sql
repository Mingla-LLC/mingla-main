-- #1615 forward-only stable public content-share identity.
--
-- IMPORTANT: 20270225001615_issue_1615_public_share_snapshots.sql is already
-- live. This migration does not alter, replay, rename, or drop that lineage.
-- Legacy /p rows are retained in place and gain private aliases to the new
-- stable link/version model. Deployment must be a reviewed surgical apply;
-- this repository's linked migration history is not safe for broad db push.

BEGIN;

CREATE OR REPLACE FUNCTION public.content_share_random_code()
RETURNS text
LANGUAGE plpgsql VOLATILE
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_bytes bytea := extensions.gen_random_bytes(16);
  v_alphabet constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  v_code text := '';
  v_index integer;
BEGIN
  FOR v_index IN 0..15 LOOP
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, v_index) % 62) + 1, 1);
  END LOOP;
  RETURN v_code;
END;
$function$;

REVOKE ALL ON FUNCTION public.content_share_random_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_share_random_code() TO service_role;

CREATE TABLE public.content_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  short_code text COLLATE "C" NOT NULL DEFAULT public.content_share_random_code()
    CHECK (short_code ~ '^[0-9A-Za-z]{16}$'),
  entity_kind text NOT NULL
    CHECK (entity_kind IN ('place','curated','event','rsvp_event','trip','experience','venue','brand')),
  access_policy text NOT NULL DEFAULT 'public' CHECK (access_policy = 'public'),
  creator_principal uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  source_key text NOT NULL CHECK (char_length(source_key) BETWEEN 1 AND 512),
  source_reference jsonb NOT NULL CHECK (jsonb_typeof(source_reference) = 'object'),
  attribution jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attribution) = 'object'),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','revoked','deleted')),
  current_version integer NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  expires_at timestamptz NULL,
  revoked_at timestamptz NULL,
  deleted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_share_links_short_code_unique UNIQUE (short_code),
  CONSTRAINT content_share_links_state_timestamps CHECK (
    (state <> 'revoked' OR revoked_at IS NOT NULL)
    AND (state <> 'deleted' OR deleted_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX content_share_links_stable_active_source_idx
  ON public.content_share_links (
    COALESCE(creator_principal, '00000000-0000-0000-0000-000000000000'::uuid),
    entity_kind, access_policy, source_key
  ) WHERE state = 'active';
CREATE INDEX content_share_links_state_updated_idx
  ON public.content_share_links (state, updated_at DESC);

CREATE TABLE public.content_share_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  link_id uuid NOT NULL REFERENCES public.content_share_links(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  facts jsonb NOT NULL CHECK (
    jsonb_typeof(facts) = 'object'
    AND facts->>'schemaVersion' = '1'
    AND facts->>'kind' IN ('place','curated','event','rsvp_event','trip','experience','venue','brand')
    AND jsonb_typeof(facts->'title') = 'string'
    AND char_length(btrim(facts->>'title')) BETWEEN 1 AND 160
  ),
  media_identity jsonb NULL CHECK (media_identity IS NULL OR jsonb_typeof(media_identity) = 'object'),
  destination_manifest jsonb NOT NULL CHECK (jsonb_typeof(destination_manifest) = 'object'),
  version_fingerprint text NOT NULL CHECK (version_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_share_versions_link_version_unique UNIQUE (link_id, version)
);
CREATE INDEX content_share_versions_link_created_idx
  ON public.content_share_versions (link_id, created_at DESC);

CREATE TABLE public.content_share_aliases (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alias_kind text NOT NULL CHECK (alias_kind IN ('legacy_snapshot','canonical_route')),
  alias_value text COLLATE "C" NOT NULL CHECK (char_length(alias_value) BETWEEN 1 AND 512),
  link_id uuid NOT NULL REFERENCES public.content_share_links(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_share_aliases_kind_value_unique UNIQUE (alias_kind, alias_value)
);
CREATE INDEX content_share_aliases_link_idx ON public.content_share_aliases (link_id);

ALTER TABLE public.content_share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_share_links FORCE ROW LEVEL SECURITY;
ALTER TABLE public.content_share_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_share_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.content_share_aliases FORCE ROW LEVEL SECURITY;
ALTER TABLE public.content_share_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_share_links, public.content_share_versions, public.content_share_aliases
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.content_share_links, public.content_share_versions, public.content_share_aliases
  TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.content_share_versions_id_seq,
  public.content_share_aliases_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.tg_content_share_version_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'content_share_versions rows are immutable';
END;
$function$;

CREATE TRIGGER content_share_versions_immutable
  BEFORE UPDATE OR DELETE ON public.content_share_versions
  FOR EACH ROW EXECUTE FUNCTION public.tg_content_share_version_immutable();

CREATE OR REPLACE FUNCTION public.upsert_content_share_version(
  p_entity_kind text,
  p_creator_principal uuid,
  p_source_key text,
  p_source_reference jsonb,
  p_attribution jsonb,
  p_facts jsonb,
  p_media_identity jsonb,
  p_destination_manifest jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_link public.content_share_links%ROWTYPE;
  v_code text;
  v_fingerprint text;
  v_current_fingerprint text;
  v_version integer;
  v_created boolean := false;
  v_attempt integer := 0;
BEGIN
  IF p_entity_kind NOT IN ('place','curated','event','rsvp_event','trip','experience','venue','brand')
     OR p_source_key IS NULL OR char_length(p_source_key) NOT BETWEEN 1 AND 512
     OR jsonb_typeof(p_source_reference) <> 'object'
     OR jsonb_typeof(COALESCE(p_attribution, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(p_facts) <> 'object'
     OR p_facts->>'schemaVersion' <> '1'
     OR p_facts->>'kind' IS DISTINCT FROM p_entity_kind
     OR jsonb_typeof(p_facts->'title') <> 'string'
     OR char_length(btrim(p_facts->>'title')) NOT BETWEEN 1 AND 160
     OR (p_media_identity IS NOT NULL AND jsonb_typeof(p_media_identity) <> 'object')
     OR jsonb_typeof(p_destination_manifest) <> 'object' THEN
    RAISE EXCEPTION 'invalid_content_share_contract';
  END IF;
  IF p_creator_principal IS NULL
     AND NOT (p_source_reference @> '{"serverCreated":true}'::jsonb) THEN
    RAISE EXCEPTION 'creator_principal_required';
  END IF;

  SELECT * INTO v_link
  FROM public.content_share_links
  WHERE creator_principal IS NOT DISTINCT FROM p_creator_principal
    AND entity_kind = p_entity_kind
    AND access_policy = 'public'
    AND source_key = p_source_key
    AND state = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    LOOP
      v_attempt := v_attempt + 1;
      IF v_attempt > 8 THEN RAISE EXCEPTION 'short_code_collision_exhausted'; END IF;
      v_code := public.content_share_random_code();
      BEGIN
        INSERT INTO public.content_share_links (
          short_code, entity_kind, creator_principal, source_key, source_reference, attribution
        ) VALUES (
          v_code, p_entity_kind, p_creator_principal, p_source_key, p_source_reference,
          COALESCE(p_attribution, '{}'::jsonb)
        ) RETURNING * INTO v_link;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        SELECT * INTO v_link
        FROM public.content_share_links
        WHERE creator_principal IS NOT DISTINCT FROM p_creator_principal
          AND entity_kind = p_entity_kind AND access_policy = 'public'
          AND source_key = p_source_key AND state = 'active'
        FOR UPDATE;
        IF FOUND THEN EXIT; END IF;
      END;
    END LOOP;
  END IF;

  v_fingerprint := encode(extensions.digest(convert_to(
    p_facts::text || '|' || COALESCE(p_media_identity, 'null'::jsonb)::text
      || '|' || p_destination_manifest::text, 'UTF8'), 'sha256'), 'hex');
  IF v_link.current_version > 0 THEN
    SELECT version_fingerprint INTO v_current_fingerprint
    FROM public.content_share_versions
    WHERE link_id = v_link.id AND version = v_link.current_version;
  END IF;

  IF v_current_fingerprint IS DISTINCT FROM v_fingerprint THEN
    v_version := v_link.current_version + 1;
    INSERT INTO public.content_share_versions (
      link_id, version, facts, media_identity, destination_manifest, version_fingerprint
    ) VALUES (
      v_link.id, v_version, p_facts, p_media_identity, p_destination_manifest, v_fingerprint
    );
    UPDATE public.content_share_links SET
      current_version = v_version,
      source_reference = p_source_reference,
      attribution = COALESCE(p_attribution, '{}'::jsonb),
      updated_at = now()
    WHERE id = v_link.id;
    v_created := true;
  ELSE
    v_version := v_link.current_version;
    UPDATE public.content_share_links SET
      attribution = COALESCE(p_attribution, '{}'::jsonb),
      updated_at = now()
    WHERE id = v_link.id;
  END IF;

  RETURN jsonb_build_object(
    'linkId', v_link.id, 'shortCode', v_link.short_code,
    'version', v_version, 'versionCreated', v_created
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_content_share_version(text,uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_content_share_version(text,uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.attach_content_share_alias(
  p_alias_kind text,
  p_alias_value text,
  p_link_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF p_alias_kind NOT IN ('legacy_snapshot','canonical_route')
     OR p_alias_value IS NULL OR char_length(p_alias_value) NOT BETWEEN 1 AND 512
     OR NOT EXISTS (SELECT 1 FROM public.content_share_links WHERE id = p_link_id) THEN
    RETURN false;
  END IF;
  INSERT INTO public.content_share_aliases(alias_kind, alias_value, link_id)
  VALUES (p_alias_kind, p_alias_value, p_link_id)
  ON CONFLICT (alias_kind, alias_value) DO NOTHING;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.attach_content_share_alias(text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_content_share_alias(text,text,uuid) TO service_role;

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
      'destination', v.destination_manifest
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

-- Lossless bridge: old rows remain authoritative for /p while aliases point at
-- valid V1 facts. The old 90-day expiry is intentionally not copied: public
-- content links are durable; stage 4 switches legacy resolution atomically.
DO $backfill$
DECLARE
  v_old record;
  v_result jsonb;
BEGIN
  FOR v_old IN
    SELECT share_id, owner_profile_id, kind, title, cover_url, metadata,
      source_ids, attribution
    FROM public.shared_card_snapshots
    ORDER BY created_at, share_id
  LOOP
    v_result := public.upsert_content_share_version(
      v_old.kind,
      v_old.owner_profile_id,
      'legacy_snapshot:' || v_old.share_id,
      jsonb_build_object('legacyShareId', v_old.share_id, 'sourceIds', v_old.source_ids),
      COALESCE(v_old.attribution, '{}'::jsonb),
      jsonb_strip_nulls(jsonb_build_object(
        'schemaVersion', 1,
        'kind', v_old.kind,
        'title', v_old.title,
        'category', NULLIF(v_old.metadata->>'category', ''),
        'area', NULLIF(v_old.metadata->>'location', ''),
        'priceLevel', CASE WHEN v_old.kind = 'place' THEN NULLIF(v_old.metadata->>'price', '') END,
        'duration', CASE WHEN v_old.kind = 'curated' THEN NULLIF(v_old.metadata->>'duration', '') END,
        'description', NULLIF(v_old.metadata->>'description', '')
      )),
      NULL,
      jsonb_build_object('kind', v_old.kind, 'legacyShareId', v_old.share_id)
    );
    PERFORM public.attach_content_share_alias(
      'legacy_snapshot', v_old.share_id, (v_result->>'linkId')::uuid
    );
  END LOOP;
END;
$backfill$;

COMMENT ON TABLE public.content_share_links IS
  '#1615 private stable /s identity. Forced RLS; no client grants; source identity and attribution never cross the served boundary.';
COMMENT ON TABLE public.content_share_versions IS
  '#1615 immutable ShareFactsV1 versions. Material facts/media/destination changes advance version; attribution and raw inventory changes do not.';
COMMENT ON TABLE public.content_share_aliases IS
  '#1615 private legacy /p and sanctioned canonical-route aliases; legacy rows remain intact.';

COMMIT;
NOTIFY pgrst, 'reload schema';
