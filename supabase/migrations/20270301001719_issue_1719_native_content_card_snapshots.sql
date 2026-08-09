-- #1719 private, immutable source-card snapshots for native Mingla chat.
CREATE TABLE public.content_share_native_snapshots (
  link_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  contract text NOT NULL CHECK (contract = 'native_content_card_snapshot_v1'),
  kind text NOT NULL CHECK (kind IN ('place','curated')),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  preview jsonb NOT NULL CHECK (jsonb_typeof(preview) = 'object'),
  snapshot_fingerprint text NOT NULL CHECK (snapshot_fingerprint ~ '^[0-9a-f]{64}$'),
  snapshot_bytes integer NOT NULL CHECK (snapshot_bytes BETWEEN 2 AND 262144),
  preview_bytes integer NOT NULL CHECK (preview_bytes BETWEEN 2 AND 5120),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (link_id, version),
  FOREIGN KEY (link_id, version) REFERENCES public.content_share_versions(link_id, version) ON DELETE CASCADE
);
ALTER TABLE public.content_share_native_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_share_native_snapshots FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_share_native_snapshots FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.content_share_native_snapshots TO service_role;

CREATE OR REPLACE FUNCTION public.reject_content_share_native_snapshot_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN RAISE EXCEPTION 'immutable_native_content_card_snapshot'; END; $$;
CREATE TRIGGER content_share_native_snapshot_immutable
BEFORE UPDATE OR DELETE ON public.content_share_native_snapshots FOR EACH ROW
EXECUTE FUNCTION public.reject_content_share_native_snapshot_mutation();

CREATE OR REPLACE FUNCTION public.upsert_content_share_version_with_native_snapshot(
  p_entity_kind text, p_creator_principal uuid, p_source_key text,
  p_source_reference jsonb, p_attribution jsonb, p_facts jsonb,
  p_media_identity jsonb, p_destination_manifest jsonb,
  p_native_snapshot jsonb, p_native_preview jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_link public.content_share_links%ROWTYPE; v_code text; v_version integer;
  v_fingerprint text; v_native_fingerprint text; v_current text;
  v_created boolean := false; v_attempt integer := 0;
  v_snapshot_bytes integer; v_preview_bytes integer;
BEGIN
  v_snapshot_bytes := octet_length(convert_to(p_native_snapshot::text,'UTF8'));
  v_preview_bytes := octet_length(convert_to(p_native_preview::text,'UTF8'));
  IF p_entity_kind NOT IN ('place','curated') OR p_source_key IS NULL OR char_length(p_source_key) NOT BETWEEN 1 AND 512
    OR jsonb_typeof(p_source_reference)<>'object' OR jsonb_typeof(COALESCE(p_attribution,'{}'::jsonb))<>'object'
    OR jsonb_typeof(p_facts)<>'object' OR p_facts->>'schemaVersion'<>'1' OR p_facts->>'kind' IS DISTINCT FROM p_entity_kind
    OR jsonb_typeof(p_destination_manifest)<>'object' OR jsonb_typeof(p_native_snapshot)<>'object'
    OR p_native_snapshot->>'contract'<>'native_content_card_snapshot_v1' OR p_native_snapshot->>'version'<>'1'
    OR p_native_snapshot->>'kind' IS DISTINCT FROM p_entity_kind OR jsonb_typeof(p_native_preview)<>'object'
    OR jsonb_typeof(p_native_preview->'title')<>'string' OR char_length(btrim(p_native_preview->>'title')) NOT BETWEEN 1 AND 160
    OR v_snapshot_bytes>262144 OR v_preview_bytes>5120 THEN
    RAISE EXCEPTION 'invalid_native_content_share_contract';
  END IF;
  IF p_creator_principal IS NULL AND NOT (p_source_reference @> '{"serverCreated":true}'::jsonb) THEN
    RAISE EXCEPTION 'creator_principal_required';
  END IF;
  SELECT * INTO v_link FROM public.content_share_links
   WHERE creator_principal IS NOT DISTINCT FROM p_creator_principal AND entity_kind=p_entity_kind
    AND access_policy='public' AND source_key=p_source_key AND state='active' FOR UPDATE;
  IF NOT FOUND THEN
    LOOP
      v_attempt:=v_attempt+1; IF v_attempt>8 THEN RAISE EXCEPTION 'short_code_collision_exhausted'; END IF;
      v_code:=public.content_share_random_code();
      BEGIN
        INSERT INTO public.content_share_links(short_code,entity_kind,creator_principal,source_key,source_reference,attribution)
        VALUES(v_code,p_entity_kind,p_creator_principal,p_source_key,p_source_reference,COALESCE(p_attribution,'{}'::jsonb)) RETURNING * INTO v_link;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        SELECT * INTO v_link FROM public.content_share_links
         WHERE creator_principal IS NOT DISTINCT FROM p_creator_principal AND entity_kind=p_entity_kind
          AND access_policy='public' AND source_key=p_source_key AND state='active' FOR UPDATE;
        IF FOUND THEN EXIT; END IF;
      END;
    END LOOP;
  END IF;
  v_native_fingerprint:=encode(extensions.digest(convert_to(p_native_snapshot::text||'|'||p_native_preview::text,'UTF8'),'sha256'),'hex');
  v_fingerprint:=encode(extensions.digest(convert_to(p_facts::text||'|'||COALESCE(p_media_identity,'null'::jsonb)::text||'|'||p_destination_manifest::text||'|'||v_native_fingerprint,'UTF8'),'sha256'),'hex');
  IF v_link.current_version>0 THEN SELECT version_fingerprint INTO v_current FROM public.content_share_versions WHERE link_id=v_link.id AND version=v_link.current_version; END IF;
  IF v_current IS DISTINCT FROM v_fingerprint THEN
    v_version:=v_link.current_version+1;
    INSERT INTO public.content_share_versions(link_id,version,facts,media_identity,destination_manifest,version_fingerprint)
      VALUES(v_link.id,v_version,p_facts,p_media_identity,p_destination_manifest,v_fingerprint);
    INSERT INTO public.content_share_native_snapshots(link_id,version,contract,kind,snapshot,preview,snapshot_fingerprint,snapshot_bytes,preview_bytes)
      VALUES(v_link.id,v_version,'native_content_card_snapshot_v1',p_entity_kind,p_native_snapshot,p_native_preview,v_native_fingerprint,v_snapshot_bytes,v_preview_bytes);
    UPDATE public.content_share_links SET current_version=v_version,source_reference=p_source_reference,
      attribution=COALESCE(p_attribution,'{}'::jsonb),updated_at=now() WHERE id=v_link.id;
    v_created:=true;
  ELSE
    v_version:=v_link.current_version;
    UPDATE public.content_share_links SET attribution=COALESCE(p_attribution,'{}'::jsonb),updated_at=now() WHERE id=v_link.id;
  END IF;
  RETURN jsonb_build_object('linkId',v_link.id,'shortCode',v_link.short_code,'version',v_version,'versionCreated',v_created);
END $$;
REVOKE ALL ON FUNCTION public.upsert_content_share_version_with_native_snapshot(text,uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_content_share_version_with_native_snapshot(text,uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.attach_native_content_card_descriptor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_native public.content_share_native_snapshots%ROWTYPE;
BEGIN
  IF NEW.message_type<>'card' OR NEW.card_payload->>'contract'<>'content_share_card_v1' THEN RETURN NEW; END IF;
  SELECT n.* INTO v_native FROM public.content_share_links l JOIN public.content_share_native_snapshots n ON n.link_id=l.id
   WHERE l.short_code=NEW.card_payload->>'shareCode' AND n.version=(NEW.card_payload->>'shareVersion')::integer;
  IF FOUND THEN
    NEW.card_payload := (NEW.card_payload - 'publicDetails') || jsonb_build_object('nativeCard',jsonb_build_object(
      'contract','native_content_card_v1','version',1,'kind',v_native.kind,'preview',v_native.preview,
      'snapshotRef',(NEW.card_payload->>'shareCode')||':v'||(NEW.card_payload->>'shareVersion')));
  END IF;
  IF octet_length(convert_to(NEW.card_payload::text,'UTF8'))>5120 THEN RAISE EXCEPTION 'content_share_message_envelope_too_large'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER messages_attach_native_content_card_descriptor
BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.attach_native_content_card_descriptor();

CREATE OR REPLACE FUNCTION public.resolve_native_content_card_snapshots(p_message_ids uuid[])
RETURNS TABLE(message_id uuid,snapshot jsonb) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_user uuid:=auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF p_message_ids IS NULL OR cardinality(p_message_ids) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'invalid_message_batch' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT m.id,n.snapshot FROM public.messages m
   JOIN public.conversation_participants cp ON cp.conversation_id=m.conversation_id AND cp.user_id=v_user
   JOIN public.content_share_links l ON l.short_code=m.card_payload->>'shareCode'
   JOIN public.content_share_native_snapshots n ON n.link_id=l.id AND n.version=(m.card_payload->>'shareVersion')::integer
   WHERE m.id=ANY(p_message_ids) AND m.message_type='card' AND m.card_payload->>'contract'='content_share_card_v1';
END $$;
REVOKE ALL ON FUNCTION public.resolve_native_content_card_snapshots(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resolve_native_content_card_snapshots(uuid[]) TO authenticated,service_role;
