-- Issue #1774 — first truthful People page and manual-add authority.
BEGIN;

CREATE TABLE public.brand_person_manual_add_requests (
  client_request_id uuid PRIMARY KEY,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  actor_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  outcome text NOT NULL CHECK (outcome IN ('created','updated','unchanged','review')),
  person_id uuid NULL REFERENCES public.brand_people(id) ON DELETE SET NULL,
  conflict_id uuid NULL REFERENCES public.brand_person_identity_conflicts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_person_manual_add_requests_shape CHECK (
    (outcome = 'review' AND person_id IS NULL AND conflict_id IS NOT NULL)
    OR (outcome <> 'review' AND person_id IS NOT NULL AND conflict_id IS NULL)
  )
);
ALTER TABLE public.brand_person_manual_add_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.brand_person_manual_add_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.brand_person_manual_add_requests TO service_role;

CREATE OR REPLACE FUNCTION public.biz_get_brand_people_book(
  p_brand_id uuid,
  p_search text DEFAULT NULL,
  p_cursor jsonb DEFAULT NULL,
  p_limit integer DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_search text;
  v_pattern text;
  v_rows jsonb;
  v_book_total bigint;
  v_filtered_total bigint;
BEGIN
  IF v_uid IS NULL OR COALESCE(public.biz_brand_effective_rank(p_brand_id,v_uid),-1) < public.biz_role_rank('marketing_manager') THEN
    RAISE EXCEPTION 'people_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'people_limit_invalid' USING ERRCODE='22023';
  END IF;
  v_search := NULLIF(btrim(p_search),'');
  IF v_search IS NOT NULL AND char_length(v_search) > 120 THEN
    RAISE EXCEPTION 'people_search_invalid' USING ERRCODE='22023';
  END IF;
  IF p_cursor IS NOT NULL AND (
    jsonb_typeof(p_cursor) <> 'object'
    OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_cursor) k) IS DISTINCT FROM ARRAY['personId','updatedAt']::text[]
    OR NULLIF(p_cursor->>'updatedAt','') IS NULL
    OR NULLIF(p_cursor->>'personId','') IS NULL
  ) THEN
    RAISE EXCEPTION 'people_cursor_invalid' USING ERRCODE='22023';
  END IF;
  BEGIN
    IF p_cursor IS NOT NULL THEN
      PERFORM (p_cursor->>'updatedAt')::timestamptz, (p_cursor->>'personId')::uuid;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'people_cursor_invalid' USING ERRCODE='22023';
  END;
  v_pattern := '%' || replace(replace(replace(lower(COALESCE(v_search,'')),'\','\\'),'%','\%'),'_','\_') || '%';

  SELECT count(*) INTO v_book_total
  FROM public.brand_people p WHERE p.brand_id=p_brand_id AND p.record_status='active';
  SELECT count(*) INTO v_filtered_total
  FROM public.brand_people p
  WHERE p.brand_id=p_brand_id AND p.record_status='active'
    AND (v_search IS NULL OR lower(p.display_name) ILIKE v_pattern ESCAPE '\'
      OR EXISTS (SELECT 1 FROM public.brand_person_contact_methods c
        WHERE c.brand_person_id=p.id AND c.record_state='active'
          AND c.provenance_scope='brand_owned'
          AND lower(c.normalized_value) ILIKE v_pattern ESCAPE '\'));

  SELECT COALESCE(jsonb_agg(q.row_value ORDER BY q.updated_at DESC,q.id DESC),'[]'::jsonb) INTO v_rows
  FROM (
    SELECT p.id,p.updated_at,jsonb_build_object(
      'personId',p.id,'displayName',p.display_name,'avatarUrl',p.avatar_url,'updatedAt',p.updated_at,
      'contacts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'channel',c.channel,'value',c.normalized_value,'isPrimary',c.is_primary) ORDER BY c.channel,c.is_primary DESC,c.created_at,c.id)
        FROM public.brand_person_contact_methods c WHERE c.brand_person_id=p.id AND c.record_state='active' AND c.provenance_scope='brand_owned'),'[]'::jsonb),
      'suppressions',COALESCE((SELECT jsonb_agg(jsonb_build_object('channel',s.channel,'scope',s.scope) ORDER BY s.channel,s.scope)
        FROM public.brand_person_channel_suppressions s WHERE s.brand_person_id=p.id AND s.lifted_at IS NULL),'[]'::jsonb)
    ) row_value
    FROM public.brand_people p
    WHERE p.brand_id=p_brand_id AND p.record_status='active'
      AND (v_search IS NULL OR lower(p.display_name) ILIKE v_pattern ESCAPE '\'
        OR EXISTS (SELECT 1 FROM public.brand_person_contact_methods c WHERE c.brand_person_id=p.id
          AND c.record_state='active' AND c.provenance_scope='brand_owned'
          AND lower(c.normalized_value) ILIKE v_pattern ESCAPE '\'))
      AND (p_cursor IS NULL OR (p.updated_at,p.id) < ((p_cursor->>'updatedAt')::timestamptz,(p_cursor->>'personId')::uuid))
    ORDER BY p.updated_at DESC,p.id DESC LIMIT p_limit
  ) q;
  RETURN jsonb_build_object(
    'rows',v_rows,
    'nextCursor',CASE WHEN jsonb_array_length(v_rows)=p_limit THEN jsonb_build_object('updatedAt',v_rows->-1->>'updatedAt','personId',v_rows->-1->>'personId') ELSE NULL END,
    'bookTotal',v_book_total,
    'filteredTotal',v_filtered_total
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_get_brand_person(p_brand_id uuid,p_person_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_uid uuid := auth.uid(); v_result jsonb;
BEGIN
  IF v_uid IS NULL OR COALESCE(public.biz_brand_effective_rank(p_brand_id,v_uid),-1) < public.biz_role_rank('marketing_manager') THEN
    RAISE EXCEPTION 'people_forbidden' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_build_object(
    'personId',p.id,'displayName',p.display_name,'avatarUrl',p.avatar_url,'updatedAt',p.updated_at,
    'contacts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'channel',c.channel,'value',c.normalized_value,'isPrimary',c.is_primary) ORDER BY c.channel,c.is_primary DESC,c.created_at,c.id)
      FROM public.brand_person_contact_methods c WHERE c.brand_person_id=p.id AND c.record_state='active' AND c.provenance_scope='brand_owned'),'[]'::jsonb),
    'suppressions',COALESCE((SELECT jsonb_agg(jsonb_build_object('channel',s.channel,'scope',s.scope) ORDER BY s.channel,s.scope)
      FROM public.brand_person_channel_suppressions s WHERE s.brand_person_id=p.id AND s.lifted_at IS NULL),'[]'::jsonb)
  ) INTO v_result
  FROM public.brand_people p WHERE p.id=p_person_id AND p.brand_id=p_brand_id AND p.record_status='active';
  IF v_result IS NULL THEN RAISE EXCEPTION 'people_not_found' USING ERRCODE='P0002'; END IF;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_add_brand_person(
  p_brand_id uuid,
  p_display_name text,
  p_email text DEFAULT NULL,
  p_phone_e164 text DEFAULT NULL,
  p_phone_country_iso text DEFAULT NULL,
  p_client_request_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_name text; v_norm_name text; v_email text; v_phone text; v_country text;
  v_hash text; v_existing public.brand_person_manual_add_requests%ROWTYPE;
  v_candidates uuid[]; v_person uuid; v_link uuid; v_contact uuid; v_conflict uuid;
  v_candidate_name text; v_outcome text := 'created'; v_changed boolean := false; v_result jsonb;
BEGIN
  IF v_uid IS NULL OR COALESCE(public.biz_brand_effective_rank(p_brand_id,v_uid),-1) < public.biz_role_rank('marketing_manager') THEN
    RAISE EXCEPTION 'people_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_client_request_id IS NULL THEN RAISE EXCEPTION 'people_idempotency_conflict' USING ERRCODE='23505'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_request_id::text,1774));
  v_name := regexp_replace(btrim(COALESCE(p_display_name,'')),'\s+',' ','g');
  IF char_length(v_name)<1 OR char_length(v_name)>120 OR v_name ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'people_name_invalid' USING ERRCODE='22023'; END IF;
  v_norm_name := lower(v_name);
  v_email := CASE WHEN p_email IS NULL OR btrim(p_email)='' THEN NULL ELSE public.issue_1770_normalize_email(p_email) END;
  IF p_email IS NOT NULL AND btrim(p_email)<>'' AND v_email IS NULL THEN RAISE EXCEPTION 'people_email_invalid' USING ERRCODE='22023'; END IF;
  v_phone := CASE WHEN p_phone_e164 IS NULL OR btrim(p_phone_e164)='' THEN NULL ELSE public.issue_1770_normalize_phone(p_phone_e164) END;
  IF p_phone_e164 IS NOT NULL AND btrim(p_phone_e164)<>'' AND v_phone IS NULL THEN RAISE EXCEPTION 'people_phone_invalid' USING ERRCODE='22023'; END IF;
  v_country := CASE WHEN p_phone_country_iso IS NULL THEN NULL ELSE upper(btrim(p_phone_country_iso)) END;
  IF v_country IS NOT NULL AND v_country !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'people_phone_invalid' USING ERRCODE='22023'; END IF;
  IF v_country IS NOT NULL AND v_phone IS NULL THEN RAISE EXCEPTION 'people_phone_invalid' USING ERRCODE='22023'; END IF;
  IF v_email IS NULL AND v_phone IS NULL THEN RAISE EXCEPTION 'people_contact_required' USING ERRCODE='22023'; END IF;
  v_hash := encode(digest(
    format('v1:%s:%s|%s:%s|%s:%s|%s:%s|%s:%s|%s:%s',
      octet_length(p_brand_id::text),p_brand_id,octet_length(v_uid::text),v_uid,
      octet_length(v_norm_name),v_norm_name,octet_length(COALESCE(v_email,'')),COALESCE(v_email,''),
      octet_length(COALESCE(v_phone,'')),COALESCE(v_phone,''),octet_length(COALESCE(v_country,'')),COALESCE(v_country,'')),
    'sha256'),'hex');
  SELECT * INTO v_existing FROM public.brand_person_manual_add_requests WHERE client_request_id=p_client_request_id;
  IF FOUND THEN
    IF v_existing.brand_id IS DISTINCT FROM p_brand_id OR v_existing.actor_user_id IS DISTINCT FROM v_uid OR v_existing.request_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'people_idempotency_conflict' USING ERRCODE='23505';
    END IF;
    IF v_existing.outcome='review' THEN RETURN jsonb_build_object('outcome','review','person',NULL,'conflictId',v_existing.conflict_id); END IF;
    RETURN jsonb_build_object('outcome',v_existing.outcome,'person',public.biz_get_brand_person(p_brand_id,v_existing.person_id),'conflictId',NULL);
  END IF;
  IF v_email IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(p_brand_id::text||':email:'||v_email,1774)); END IF;
  IF v_phone IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(p_brand_id::text||':phone:'||v_phone,1774)); END IF;
  SELECT array_agg(DISTINCT c.brand_person_id ORDER BY c.brand_person_id) INTO v_candidates
  FROM public.brand_person_contact_methods c JOIN public.brand_people p ON p.id=c.brand_person_id
  WHERE c.brand_id=p_brand_id AND p.record_status='active' AND c.record_state='active' AND c.provenance_scope='brand_owned'
    AND ((c.channel='email' AND v_email IS NOT NULL AND c.normalized_value=v_email) OR (c.channel='phone' AND v_phone IS NOT NULL AND c.normalized_value=v_phone));
  IF cardinality(COALESCE(v_candidates,'{}'))>1 THEN
    INSERT INTO public.brand_person_identity_conflicts(brand_id,source_kind,source_id,candidate_person_ids,reason)
      VALUES(p_brand_id,'manual',p_client_request_id,v_candidates,'manual_review')
      ON CONFLICT(source_kind,source_id,status) DO UPDATE SET candidate_person_ids=EXCLUDED.candidate_person_ids RETURNING id INTO v_conflict;
    INSERT INTO public.brand_person_manual_add_requests VALUES(p_client_request_id,p_brand_id,v_uid,v_hash,'review',NULL,v_conflict,now());
    RETURN jsonb_build_object('outcome','review','person',NULL,'conflictId',v_conflict);
  END IF;
  IF cardinality(COALESCE(v_candidates,'{}'))=1 THEN
    v_person:=v_candidates[1]; SELECT lower(regexp_replace(btrim(display_name),'\s+',' ','g')) INTO v_candidate_name FROM public.brand_people WHERE id=v_person;
    IF v_candidate_name NOT IN (v_norm_name,'guest') THEN
      INSERT INTO public.brand_person_identity_conflicts(brand_id,source_kind,source_id,candidate_person_ids,reason)
        VALUES(p_brand_id,'manual',p_client_request_id,v_candidates,'different_nonempty_names')
        ON CONFLICT(source_kind,source_id,status) DO UPDATE SET candidate_person_ids=EXCLUDED.candidate_person_ids RETURNING id INTO v_conflict;
      INSERT INTO public.brand_person_manual_add_requests VALUES(p_client_request_id,p_brand_id,v_uid,v_hash,'review',NULL,v_conflict,now());
      RETURN jsonb_build_object('outcome','review','person',NULL,'conflictId',v_conflict);
    END IF;
    v_outcome:='unchanged';
    v_changed := NOT EXISTS(SELECT 1 FROM public.brand_person_names WHERE brand_person_id=v_person AND active AND normalized_name=v_norm_name)
      OR (v_email IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.brand_person_contact_methods WHERE brand_person_id=v_person AND channel='email' AND normalized_value=v_email AND record_state='active'))
      OR (v_phone IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.brand_person_contact_methods WHERE brand_person_id=v_person AND channel='phone' AND normalized_value=v_phone AND record_state='active'));
  ELSE
    INSERT INTO public.brand_people(brand_id,display_name) VALUES(p_brand_id,v_name) RETURNING id INTO v_person;
  END IF;
  INSERT INTO public.brand_person_source_links(brand_id,brand_person_id,source_kind,source_id,link_method,source_occurred_at)
    VALUES(p_brand_id,v_person,'manual',p_client_request_id,'manual_resolution',now()) RETURNING id INTO v_link;
  INSERT INTO public.brand_person_names(brand_person_id,display_name,normalized_name,name_kind,source_link_id)
    VALUES(v_person,v_name,v_norm_name,CASE WHEN EXISTS(SELECT 1 FROM public.brand_person_names WHERE brand_person_id=v_person AND active AND name_kind='primary') THEN 'alternate' ELSE 'primary' END,v_link)
    ON CONFLICT(brand_person_id,normalized_name) WHERE active DO NOTHING;
  IF v_email IS NOT NULL THEN
    INSERT INTO public.brand_person_contact_methods(brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary)
      VALUES(p_brand_id,v_person,'email',v_email,'brand_owned',true,NOT EXISTS(SELECT 1 FROM public.brand_person_contact_methods WHERE brand_person_id=v_person AND channel='email' AND record_state='active'))
      ON CONFLICT(brand_person_id,channel,normalized_value) WHERE record_state='active' DO UPDATE SET is_exportable=true,updated_at=now() RETURNING id INTO v_contact;
    INSERT INTO public.brand_person_contact_method_sources(contact_method_id,source_link_id,provenance_kind,exportable) VALUES(v_contact,v_link,'manual',true) ON CONFLICT DO NOTHING;
  END IF;
  IF v_phone IS NOT NULL THEN
    INSERT INTO public.brand_person_contact_methods(brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary)
      VALUES(p_brand_id,v_person,'phone',v_phone,'brand_owned',true,NOT EXISTS(SELECT 1 FROM public.brand_person_contact_methods WHERE brand_person_id=v_person AND channel='phone' AND record_state='active'))
      ON CONFLICT(brand_person_id,channel,normalized_value) WHERE record_state='active' DO UPDATE SET is_exportable=true,updated_at=now() RETURNING id INTO v_contact;
    INSERT INTO public.brand_person_contact_method_sources(contact_method_id,source_link_id,provenance_kind,exportable,phone_country_iso) VALUES(v_contact,v_link,'manual',true,v_country) ON CONFLICT DO NOTHING;
  END IF;
  IF v_changed THEN
    UPDATE public.brand_people SET updated_at=now() WHERE id=v_person;
  END IF;
  IF v_outcome='unchanged' AND v_changed THEN v_outcome:='updated'; END IF;
  INSERT INTO public.brand_person_manual_add_requests VALUES(p_client_request_id,p_brand_id,v_uid,v_hash,v_outcome,v_person,NULL,now());
  v_result:=public.biz_get_brand_person(p_brand_id,v_person);
  RETURN jsonb_build_object('outcome',v_outcome,'person',v_result,'conflictId',NULL);
END;
$function$;

REVOKE ALL ON FUNCTION public.biz_get_brand_people_book(uuid,text,jsonb,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.biz_get_brand_person(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.biz_add_brand_person(uuid,text,text,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_get_brand_people_book(uuid,text,jsonb,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.biz_get_brand_person(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.biz_add_brand_person(uuid,text,text,text,text,uuid) TO authenticated;

DO $assert$
DECLARE v_signature text;
BEGIN
  IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='brand_person_manual_add_requests') THEN RAISE EXCEPTION 'people_ledger_policy_forbidden'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.brand_person_manual_add_requests'::regclass) THEN RAISE EXCEPTION 'people_ledger_rls_required'; END IF;
  IF EXISTS(SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='brand_person_manual_add_requests' AND grantee IN ('PUBLIC','anon','authenticated')) THEN RAISE EXCEPTION 'people_ledger_client_grant_forbidden'; END IF;
  FOREACH v_signature IN ARRAY ARRAY[
    'public.biz_get_brand_people_book(uuid,text,jsonb,integer)',
    'public.biz_get_brand_person(uuid,uuid)',
    'public.biz_add_brand_person(uuid,text,text,text,text,uuid)'
  ] LOOP
    IF NOT EXISTS(
      SELECT 1 FROM pg_proc p
      WHERE p.oid=to_regprocedure(v_signature)
        AND p.prosecdef
        AND p.proconfig @> ARRAY['search_path=public, pg_temp']::text[]
    ) OR has_function_privilege('anon',v_signature,'EXECUTE')
      OR NOT has_function_privilege('authenticated',v_signature,'EXECUTE') THEN
      RAISE EXCEPTION 'people_function_security_drift: %',v_signature;
    END IF;
  END LOOP;
  IF EXISTS(
    SELECT 1 FROM unnest(ARRAY[
      'brand_people','brand_person_source_links','brand_person_names','brand_person_contact_methods',
      'brand_person_contact_method_sources','brand_person_identity_conflicts','brand_person_channel_suppressions'
    ]) AS touched(table_name)
    JOIN pg_class c ON c.oid=to_regclass('public.'||touched.table_name)
    WHERE NOT c.relrowsecurity
  ) THEN RAISE EXCEPTION 'people_touched_table_rls_required'; END IF;
END;
$assert$;

COMMIT;
